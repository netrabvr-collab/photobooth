# 📷 PhotoBooth — Full Stack (FastAPI + OpenCV + React)

Real-time photobooth with face detection, face landmarks, custom OpenCV filters,
WebSocket live streaming, and REST-based photo saving.

---

## Architecture

```
Browser (React)
   │
   ├── WebSocket ws://localhost:8000/ws/stream   ← live OpenCV frames @ 30fps
   │                                              face detection overlays baked in
   │
   └── REST  http://localhost:8000/api/          ← capture, save, gallery
                ├── POST /api/capture            ← send frame → process → save
                ├── GET  /api/photos             ← list saved photos
                ├── GET  /api/photos/{filename}  ← serve a saved photo
                └── GET  /api/status             ← backend capabilities
```

---

## Backend Setup

### 1. Install Python dependencies

```bash
cd photobooth-backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. (Optional) Enable face landmarks with dlib

Face landmarks require dlib and its 68-point model file.

```bash
pip install dlib                # needs cmake: brew install cmake / apt install cmake

# Download the model (~100 MB)
curl -L http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2 \
  | bunzip2 > shape_predictor_68_face_landmarks.dat
```

Place `shape_predictor_68_face_landmarks.dat` in the same folder as `main.py`.

### 3. Run the backend

```bash
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Backend starts at **http://localhost:8000**
- API docs: http://localhost:8000/docs

---

## Frontend Setup

### Option A — Vite + React (recommended)

```bash
npm create vite@latest photobooth-app -- --template react
cd photobooth-app
cp ../photobooth-frontend/photobooth.jsx src/App.jsx
npm install
npm run dev
```

### Option B — Create React App

```bash
npx create-react-app photobooth-app
cd photobooth-app
cp ../photobooth-frontend/photobooth.jsx src/App.jsx
npm start
```

Frontend starts at **http://localhost:5173** (Vite) or **http://localhost:3000** (CRA).

---

## Features

### Backend (Python / FastAPI / OpenCV)

| Feature | Details |
|---|---|
| **WebSocket stream** | Sends processed JPEG frames at ~30 fps |
| **Haar face detection** | `haarcascade_frontalface_default.xml` |
| **Eye detection** | `haarcascade_eye.xml` |
| **Smile detection** | `haarcascade_smile.xml` |
| **Face landmarks** | 68-point dlib model (optional) |
| **11 OpenCV filters** | RAW, NOIR, RETRO, VIVID, X-RAY, GOLDEN, ICE, TOON, EDGE, EMBOSS, DREAM |
| **Photo saving** | Timestamped JPEGs in `./saved_photos/` |
| **REST API** | Capture, list, serve photos |

### Frontend (React)

| Feature | Details |
|---|---|
| **Dual mode** | ⚡ OpenCV (WebSocket) or 🌐 Browser (getUserMedia) |
| **Live feed** | WS frames rendered as `<img>` tag |
| **Filter picker** | 11 filters, synced to backend in real time |
| **Detection toggles** | Landmarks, Eyes & Smile, Mirror |
| **Multi-frame capture** | 1 / 3 / 4 frames with countdown |
| **Flash effect** | On each capture |
| **Film strip builder** | Canvas-rendered strip with sprocket holes |
| **Download strip** | Save as JPEG |
| **Server gallery** | Browse & download all saved server photos |
| **Status bar** | Backend online, WS latency, face count |

---

## Available Filters

| ID | Name | Effect |
|---|---|---|
| `none` | RAW | No filter |
| `grayscale` | NOIR | Grayscale + contrast |
| `sepia` | RETRO | Warm sepia tone |
| `saturate` | VIVID | Boosted saturation |
| `invert` | X-RAY | Inverted colors |
| `warm` | GOLDEN | Red +30, Blue -20 |
| `cool` | ICE | Red -20, Blue +30 |
| `cartoon` | TOON | Bilateral + edge mask |
| `edge` | EDGE | Canny edge detection |
| `emboss` | EMBOSS | Emboss kernel |
| `blur` | DREAM | Gaussian blur |

---

## WebSocket Protocol

### Client → Server (JSON settings update)
```json
{
  "filter": "cartoon",
  "detect_faces": true,
  "show_landmarks": false,
  "show_eyes_smile": true,
  "mirror": true,
  "quality": 70
}
```

### Server → Client (per frame)
```json
{
  "type": "frame",
  "data": "<base64 JPEG>",
  "faces": [{ "x": 120, "y": 80, "w": 200, "h": 200 }],
  "ts": 1710000000.123
}
```

---

## REST API

### `GET /api/status`
Returns backend capabilities:
```json
{
  "camera": true,
  "dlib": true,
  "landmarks": true,
  "filters": ["none", "grayscale", ...],
  "opencv_version": "4.9.0"
}
```

### `POST /api/capture`
Send a captured frame for server-side processing and saving.
```json
{
  "image_b64": "data:image/jpeg;base64,...",
  "filter_name": "cartoon",
  "detect_faces": true,
  "show_landmarks": false,
  "mirror": false
}
```
Returns:
```json
{
  "success": true,
  "filename": "20240315_142300_a1b2c3.jpg",
  "faces_detected": 2,
  "faces": [{ "x": 120, "y": 80, "w": 200, "h": 200 }],
  "processed_image": "data:image/jpeg;base64,..."
}
```

### `GET /api/photos`
Returns list of saved photo filenames.

### `GET /api/photos/{filename}`
Serves a specific saved photo.

---

## Project Structure

```
photobooth/
├── photobooth-backend/
│   ├── main.py              ← FastAPI + WebSocket server
│   ├── requirements.txt
│   └── saved_photos/        ← auto-created, saved captures
│       └── *.jpg
│
└── photobooth-frontend/
    └── photobooth.jsx       ← React component (single file)
```

---

## Requirements

- Python 3.9+
- Webcam connected to backend machine
- Node.js 18+ (for frontend)
- cmake (only if using dlib landmarks)
