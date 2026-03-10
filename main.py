"""
PhotoBooth Backend — FastAPI + WebSocket + OpenCV
Provides:
  - Real-time video stream over WebSocket with face detection overlays
  - REST endpoint to capture & save a photo with server-side processing
  - Face detection (Haar cascades)
  - Face landmarks (dlib)
  - Custom OpenCV filters
"""

import asyncio
import base64
import json
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Optional: dlib for landmarks ─────────────────────────────────────────────
try:
    import dlib  # type: ignore[import-untyped]
    DLIB_AVAILABLE = True
    PREDICTOR_PATH = "shape_predictor_68_face_landmarks.dat"
    detector_dlib = dlib.get_frontal_face_detector()
    predictor = dlib.shape_predictor(PREDICTOR_PATH) if Path(PREDICTOR_PATH).exists() else None
except (ImportError, ModuleNotFoundError):
    DLIB_AVAILABLE = False
    predictor = None
    detector_dlib = None

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="PhotoBooth API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SAVE_DIR = Path("saved_photos")
SAVE_DIR.mkdir(exist_ok=True)

# ── Haar cascade ──────────────────────────────────────────────────────────────
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)
eye_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_eye.xml"
)
smile_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_smile.xml"
)

# ── Filter helper functions (defined before FILTERS dict) ────────────────────
def _color_shift(frame: np.ndarray, r: int = 0, g: int = 0, b: int = 0) -> np.ndarray:
    out = frame.astype(np.int16)
    out[:, :, 2] = np.clip(out[:, :, 2] + r, 0, 255)
    out[:, :, 1] = np.clip(out[:, :, 1] + g, 0, 255)
    out[:, :, 0] = np.clip(out[:, :, 0] + b, 0, 255)
    return out.astype(np.uint8)


def _cartoon_filter(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray_blur = cv2.medianBlur(gray, 5)
    edges = cv2.adaptiveThreshold(
        gray_blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 9, 9
    )
    color = cv2.bilateralFilter(frame, 9, 300, 300)
    return cv2.bitwise_and(color, color, mask=edges)


# ── Filter implementations ────────────────────────────────────────────────────
FILTERS = {
    "none":      lambda f: f,
    "grayscale": lambda f: cv2.cvtColor(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR),
    "sepia": lambda f: cv2.transform(
        np.clip(f.astype(np.float64), 0, 255),
        np.array([[0.272, 0.534, 0.131],
                  [0.349, 0.686, 0.168],
                  [0.393, 0.769, 0.189]])
    ).clip(0, 255).astype(np.uint8),
    "saturate": lambda f: cv2.convertScaleAbs(
        cv2.cvtColor(
            np.clip(
                cv2.cvtColor(f, cv2.COLOR_BGR2HSV).astype(np.float32) * [1, 1.8, 1.1],
                0, 255
            ).astype(np.uint8),
            cv2.COLOR_HSV2BGR
        )
    ),
    "invert":  lambda f: cv2.bitwise_not(f),
    "blur":    lambda f: cv2.GaussianBlur(f, (15, 15), 0),
    "edge":    lambda f: cv2.cvtColor(
        cv2.Canny(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), 80, 200), cv2.COLOR_GRAY2BGR
    ),
    "warm":    lambda f: _color_shift(f, r=+30, b=-20),
    "cool":    lambda f: _color_shift(f, r=-20, b=+30),
    "emboss":  lambda f: cv2.filter2D(f, -1, np.array([[-2, -1, 0], [-1, 1, 1], [0, 1, 2]])),
    "cartoon": _cartoon_filter,
}


# ── Face detection helpers ────────────────────────────────────────────────────
def detect_faces_haar(gray):
    return face_cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
    )

def draw_face_boxes(frame, faces, color=(0, 245, 255)):
    """Draw neon bounding boxes with corner marks."""
    for (x, y, w, h) in faces:
        c = 20  # corner length
        thickness = 2
        # corner lines
        for (px, py, dx, dy) in [(x,y,1,1),(x+w,y,-1,1),(x,y+h,1,-1),(x+w,y+h,-1,-1)]:
            cv2.line(frame, (px, py), (px + dx*c, py), color, thickness)
            cv2.line(frame, (px, py), (px, py + dy*c), color, thickness)
        # subtle fill
        overlay = frame.copy()
        cv2.rectangle(overlay, (x, y), (x+w, y+h), color, -1)
        cv2.addWeighted(overlay, 0.04, frame, 0.96, 0, frame)
    return frame

def draw_landmarks(frame, gray, faces):
    if not DLIB_AVAILABLE or predictor is None:
        return frame
    for (x, y, w, h) in faces:
        rect = dlib.rectangle(int(x), int(y), int(x+w), int(y+h))
        shape = predictor(gray, rect)
        for i in range(68):
            px = shape.part(i).x
            py = shape.part(i).y
            cv2.circle(frame, (px, py), 2, (255, 100, 0), -1)
    return frame

def draw_smile_eyes(frame, gray, faces):
    for (x, y, w, h) in faces:
        roi_gray  = gray[y:y+h, x:x+w]
        roi_color = frame[y:y+h, x:x+w]
        eyes = eye_cascade.detectMultiScale(roi_gray, 1.1, 10, minSize=(20,20))
        for (ex, ey, ew, eh) in eyes:
            cv2.circle(roi_color, (ex + ew//2, ey + eh//2), ew//2, (0, 255, 150), 1)
        smiles = smile_cascade.detectMultiScale(roi_gray[h//2:], 1.7, 20)
        for (sx, sy, sw, sh) in smiles:
            cv2.rectangle(roi_color, (sx, sy + h//2), (sx+sw, sy+sh+h//2), (0, 200, 255), 1)
    return frame


# ── Frame processor ───────────────────────────────────────────────────────────
def process_frame(
    frame: np.ndarray,
    filter_name: str = "none",
    detect_faces: bool = True,
    show_landmarks: bool = False,
    show_eyes_smile: bool = True,
    mirror: bool = True,
) -> tuple[np.ndarray, list]:
    if mirror:
        frame = cv2.flip(frame, 1)

    # Apply filter
    fn = FILTERS.get(filter_name, FILTERS["none"])
    frame = fn(frame)

    face_data = []
    if detect_faces:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = detect_faces_haar(gray)
        face_data = [{"x": int(x), "y": int(y), "w": int(w), "h": int(h)} for (x,y,w,h) in faces]

        frame = draw_face_boxes(frame, faces)
        if show_eyes_smile:
            frame = draw_smile_eyes(frame, gray, faces)
        if show_landmarks:
            frame = draw_landmarks(frame, gray, faces)

        # Face count HUD
        label = f"FACES: {len(faces)}"
        cv2.putText(frame, label, (10, frame.shape[0] - 12),
                    cv2.FONT_HERSHEY_PLAIN, 1.0, (0, 245, 255), 1, cv2.LINE_AA)

    # Timestamp HUD
    ts = datetime.now().strftime("%H:%M:%S")
    cv2.putText(frame, ts, (frame.shape[1] - 80, frame.shape[0] - 12),
                cv2.FONT_HERSHEY_PLAIN, 1.0, (80, 80, 80), 1, cv2.LINE_AA)

    return frame, face_data


def encode_frame(frame: np.ndarray, quality: int = 75) -> str:
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode("utf-8")


# ── WebSocket: live stream ────────────────────────────────────────────────────
@app.websocket("/ws/stream")
async def websocket_stream(ws: WebSocket):
    await ws.accept()
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)

    settings = {
        "filter": "none",
        "detect_faces": True,
        "show_landmarks": False,
        "show_eyes_smile": True,
        "mirror": True,
        "quality": 70,
    }

    try:
        while True:
            # Non-blocking settings update
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=0.01)
                patch = json.loads(msg)
                settings.update(patch)
            except asyncio.TimeoutError:
                pass

            ret, frame = cap.read()
            if not ret:
                await asyncio.sleep(0.033)
                continue

            processed, faces = process_frame(
                frame,
                filter_name=settings["filter"],
                detect_faces=settings["detect_faces"],
                show_landmarks=settings["show_landmarks"],
                show_eyes_smile=settings["show_eyes_smile"],
                mirror=settings["mirror"],
            )

            payload = {
                "type": "frame",
                "data": encode_frame(processed, settings["quality"]),
                "faces": faces,
                "ts": time.time(),
            }
            await ws.send_text(json.dumps(payload))
            await asyncio.sleep(1 / 30)

    except WebSocketDisconnect:
        pass
    finally:
        cap.release()


# ── REST: capture & save ──────────────────────────────────────────────────────
class CaptureRequest(BaseModel):
    image_b64: str                  # base64 JPEG from browser canvas
    filter_name: str = "none"
    detect_faces: bool = True
    show_landmarks: bool = False
    mirror: bool = False            # already mirrored on client


@app.post("/api/capture")
async def capture(req: CaptureRequest):
    try:
        img_bytes = base64.b64decode(req.image_b64.split(",")[-1])
        arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        processed, faces = process_frame(
            frame,
            filter_name=req.filter_name,
            detect_faces=req.detect_faces,
            show_landmarks=req.show_landmarks,
            mirror=req.mirror,
        )

        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.jpg"
        filepath = SAVE_DIR / filename
        cv2.imwrite(str(filepath), processed, [cv2.IMWRITE_JPEG_QUALITY, 95])

        processed_b64 = encode_frame(processed, 90)

        return JSONResponse({
            "success": True,
            "filename": filename,
            "faces_detected": len(faces),
            "faces": faces,
            "processed_image": f"data:image/jpeg;base64,{processed_b64}",
        })
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/photos")
async def list_photos():
    files = sorted(SAVE_DIR.glob("*.jpg"), key=lambda f: f.stat().st_mtime, reverse=True)
    return {"photos": [f.name for f in files[:50]]}


@app.get("/api/photos/{filename}")
async def get_photo(filename: str):
    path = SAVE_DIR / filename
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(str(path))


@app.get("/api/status")
async def status():
    cap = cv2.VideoCapture(0)
    camera_ok = cap.isOpened()
    cap.release()
    return {
        "camera": camera_ok,
        "dlib": DLIB_AVAILABLE,
        "landmarks": predictor is not None,
        "filters": list(FILTERS.keys()),
        "opencv_version": cv2.__version__,
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)