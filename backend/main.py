"""
Photo Booth Backend
────────────────────
FastAPI + OpenCV WebSocket stream + REST endpoints
"""

import asyncio
import base64
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
PHOTOS_DIR = BASE_DIR / "photos"
PHOTOS_DIR.mkdir(exist_ok=True)

# ── Haar cascades ─────────────────────────────────────────────────────────────
CASCADE_DIR   = Path(cv2.data.haarcascades)
face_cascade  = cv2.CascadeClassifier(str(CASCADE_DIR / "haarcascade_frontalface_default.xml"))
eye_cascade   = cv2.CascadeClassifier(str(CASCADE_DIR / "haarcascade_eye.xml"))
smile_cascade = cv2.CascadeClassifier(str(CASCADE_DIR / "haarcascade_smile.xml"))

# ── Optional dlib ─────────────────────────────────────────────────────────────
dlib_available = False
predictor      = None
try:
    import importlib as _il
    _dlib     = _il.import_module("dlib")
    _detector = _dlib.get_frontal_face_detector()
    _lm_model = BASE_DIR / "shape_predictor_68_face_landmarks.dat"
    predictor = _dlib.shape_predictor(str(_lm_model)) if _lm_model.exists() else None
    dlib_available = True
except Exception:
    pass

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="PhotoBooth API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Filters ───────────────────────────────────────────────────────────────────
def apply_filter(frame: np.ndarray, filter_name: str) -> np.ndarray:
    if filter_name == "grayscale":
        return cv2.cvtColor(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    elif filter_name == "sepia":
        k = np.array([[0.272,0.534,0.131],[0.349,0.686,0.168],[0.393,0.769,0.189]])
        return np.clip(cv2.transform(frame.astype(np.float64), k), 0, 255).astype(np.uint8)
    elif filter_name == "saturate":
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:,:,1] = np.clip(hsv[:,:,1] * 1.8, 0, 255)
        return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    elif filter_name == "warm":
        f = frame.copy()
        f[:,:,2] = cv2.LUT(f[:,:,2], np.array([min(255,int(i*1.1)) for i in range(256)], dtype=np.uint8))
        f[:,:,0] = cv2.LUT(f[:,:,0], np.array([max(0,i-20) for i in range(256)], dtype=np.uint8))
        return f
    elif filter_name == "cool":
        f = frame.copy()
        f[:,:,0] = cv2.LUT(f[:,:,0], np.array([min(255,i+20) for i in range(256)], dtype=np.uint8))
        f[:,:,2] = cv2.LUT(f[:,:,2], np.array([max(0,i-20) for i in range(256)], dtype=np.uint8))
        return f
    elif filter_name == "blur":
        return cv2.GaussianBlur(frame, (21, 21), 0)
    elif filter_name == "edge":
        return cv2.cvtColor(cv2.Canny(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 60, 160), cv2.COLOR_GRAY2BGR)
    elif filter_name == "emboss":
        k = np.array([[-2,-1,0],[-1,1,1],[0,1,2]])
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.cvtColor(np.clip(cv2.filter2D(gray,-1,k)+128,0,255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    return frame

def detect_faces(frame: np.ndarray, detect: bool = True) -> list:
    if not detect:
        return []
    h, w = frame.shape[:2]
    gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(50,50))
    return [{"x":int(fx)/w,"y":int(fy)/h,"w":int(fw)/w,"h":int(fh)/h} for fx,fy,fw,fh in faces] if len(faces) else []

def draw_overlays(frame: np.ndarray, settings: dict) -> np.ndarray:
    gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(50,50))
    for (fx,fy,fw,fh) in faces:
        cv2.rectangle(frame, (fx,fy), (fx+fw,fy+fh), (131,131,248), 1)
        if settings.get("show_eyes_smile"):
            roi_g = gray[fy:fy+fh, fx:fx+fw]
            roi_c = frame[fy:fy+fh, fx:fx+fw]
            for (ex,ey,ew,eh) in eye_cascade.detectMultiScale(roi_g, 1.1, 10):
                cv2.circle(roi_c, (ex+ew//2,ey+eh//2), ew//2, (200,131,248), 1)
            for (sx,sy,sw,sh) in smile_cascade.detectMultiScale(roi_g, 1.7, 22):
                cv2.rectangle(roi_c, (sx,sy), (sx+sw,sy+sh), (131,200,248), 1)
    return frame

def frame_to_b64(frame: np.ndarray, quality: int = 70) -> str:
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode()

# ── Camera ────────────────────────────────────────────────────────────────────
class CameraManager:
    def __init__(self):
        self.cap  = None

    def open(self):
        if self.cap is None or not self.cap.isOpened():
            self.cap = cv2.VideoCapture(0)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
            # Set buffer size to 1 so we always get the latest frame
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    def read_fresh(self) -> Optional[np.ndarray]:
        """Flush the internal buffer and return a genuinely new frame."""
        if not self.cap or not self.cap.isOpened():
            return None
        # Drain the entire buffer — grab without decode (fast)
        for _ in range(10):
            self.cap.grab()
        # Small sleep so the sensor physically captures a new exposure
        time.sleep(0.15)
        # Grab one more time after the sleep — this is the live frame
        self.cap.grab()
        ok, frame = self.cap.retrieve()
        return frame if ok else None

    def read(self) -> Optional[np.ndarray]:
        if self.cap and self.cap.isOpened():
            ok, frame = self.cap.read()
            return frame if ok else None
        return None

camera = CameraManager()

# ── REST ──────────────────────────────────────────────────────────────────────
@app.get("/api/status")
def status():
    return {
        "ok":             True,
        "opencv_version": cv2.__version__,
        "dlib":           dlib_available,
        "landmarks":      predictor is not None,
        "camera_open":    camera.cap is not None and camera.cap.isOpened(),
    }


@app.get("/api/snapshot")
async def snapshot(filter: str = "none", mirror: bool = True,
                   detect: bool = True, eyes: bool = True):
    """
    Grab a FRESH frame directly from the camera — used by the frontend
    for each photo capture. Bypasses the WS stream buffer entirely.
    """
    camera.open()
    frame = await asyncio.get_event_loop().run_in_executor(None, camera.read_fresh)
    if frame is None:
        return JSONResponse({"error": "camera not available"}, status_code=503)

    if mirror:
        frame = cv2.flip(frame, 1)
    frame = apply_filter(frame, filter)
    if detect:
        draw_overlays(frame, {"show_eyes_smile": eyes})

    b64 = frame_to_b64(frame, quality=90)
    return {"image": f"data:image/jpeg;base64,{b64}"}


@app.post("/api/capture")
async def capture(payload: dict):
    try:
        raw   = base64.b64decode(payload["image_b64"].split(",")[-1])
        arr   = np.frombuffer(raw, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if payload.get("mirror"):
            frame = cv2.flip(frame, 1)
        frame = apply_filter(frame, payload.get("filter_name", "none"))
        if payload.get("detect_faces"):
            draw_overlays(frame, payload)
        ts       = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"photo_{ts}.jpg"
        cv2.imwrite(str(PHOTOS_DIR / filename), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        return {"success": True, "filename": filename}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/photos")
def list_photos():
    files = sorted(PHOTOS_DIR.glob("*.jpg"), key=os.path.getmtime, reverse=True)
    return {"photos": [f.name for f in files]}

@app.get("/api/photos/{filename}")
def get_photo(filename: str):
    path = PHOTOS_DIR / filename
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(str(path), media_type="image/jpeg")


# ── WebSocket stream ──────────────────────────────────────────────────────────
@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket):
    await ws.accept()
    camera.open()

    settings = {
        "filter": "none", "detect_faces": True,
        "show_landmarks": False, "show_eyes_smile": True, "mirror": True,
    }

    async def recv_settings():
        try:
            data = await asyncio.wait_for(ws.receive_text(), timeout=0.01)
            settings.update(json.loads(data))
        except Exception:
            pass

    try:
        while True:
            t0    = time.perf_counter()
            frame = await asyncio.get_event_loop().run_in_executor(None, camera.read)
            if frame is None:
                await asyncio.sleep(0.05)
                continue
            if settings.get("mirror"):
                frame = cv2.flip(frame, 1)
            frame = apply_filter(frame, settings.get("filter", "none"))
            faces = detect_faces(frame, settings.get("detect_faces", True))
            if settings.get("detect_faces"):
                draw_overlays(frame, settings)
            b64 = await asyncio.get_event_loop().run_in_executor(
                None, lambda f=frame: frame_to_b64(f, quality=65))
            await ws.send_text(json.dumps({"type":"frame","data":b64,"faces":faces}))
            await recv_settings()
            elapsed = time.perf_counter() - t0
            await asyncio.sleep(max(0, 0.04 - elapsed))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)