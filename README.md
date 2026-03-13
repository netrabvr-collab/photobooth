# 📸 Photo Booth

A beautiful photo booth web app built with **React + Vite** (frontend) and **FastAPI + OpenCV** (backend).

---

## ✨ Features

- 🌸 Pink / rose aesthetic matching Figma prototype
- 📷 Live webcam feed via WebSocket
- 🎨 8 real-time OpenCV filters (Noir, Retro, Vivid, Warm, Cool, Dreamy, Edge)
- 👤 Face detection, eye & smile detection overlays
- ⏱ Animated countdown (3 → 2 → 1 → Smile!)
- 🎞 Auto-generates downloadable film strip
- 📱 Phone-frame layout on desktop

---

## 🚀 Quick Start

### 1 · Backend

```bash
cd backend

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server
python main.py
# → running on http://localhost:8000
```

### 2 · Frontend

```bash
# From the project root
npm install
npm run dev
# → open http://localhost:5173
```

---

## 📁 Project Structure

```
photobooth/
├── index.html
├── vite.config.js
├── package.json
│
├── src/
│   ├── main.jsx
│   ├── App.jsx / App.css          ← screen router + phone shell
│   ├── index.css                  ← global tokens + animations
│   │
│   ├── hooks/
│   │   └── useWebSocket.js        ← WS connection with auto-reconnect
│   │
│   └── components/
│       ├── IntroScreen            ← landing / start
│       ├── CameraScreen           ← live feed + filters + controls
│       ├── CountdownScreen        ← 3 → 2 → 1 → Smile!
│       ├── CaptureScreen          ← orchestrates shots + flash
│       ├── ResultScreen           ← strip preview + download
│       └── Bokeh                  ← floating particle effect
│
└── backend/
    ├── main.py                    ← FastAPI + OpenCV server
    ├── requirements.txt
    └── photos/                    ← saved captures (auto-created)
```

---

## ⚙️ How it works

```
Browser  ──WS──▶  FastAPI  ──▶  OpenCV (camera → filter → face detect)
                                      │
                                      └──▶  base64 JPEG frame ──▶ Browser
```

The browser connects via WebSocket to `/ws/stream`. The backend reads from the webcam at ~25 fps, applies the selected filter and OpenCV detections, and streams JPEG frames back as base64. Settings (filter, mirror, detections) are pushed from the browser as JSON messages on the same socket.

---

## 🎨 Filters

| Name    | OpenCV technique         |
|---------|--------------------------|
| Natural | Passthrough              |
| Noir    | Grayscale                |
| Retro   | Sepia matrix transform   |
| Vivid   | HSV saturation boost     |
| Warm    | Red channel LUT boost    |
| Cool    | Blue channel LUT boost   |
| Dreamy  | Gaussian blur            |
| Edge    | Canny edge detection     |

---

## 🔧 Optional: dlib Facial Landmarks

For 68-point landmark detection:

```bash
pip install dlib

# Download the model (99MB)
wget http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2
bzip2 -d shape_predictor_68_face_landmarks.dat.bz2
mv shape_predictor_68_face_landmarks.dat backend/
```

---

## 🌐 Browser-only mode

If the backend is offline the app automatically falls back to using the browser's native `getUserMedia` webcam API. Filters are still selectable (applied server-side if backend comes online, otherwise cosmetic).
