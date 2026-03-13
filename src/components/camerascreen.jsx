import { useRef, useEffect, useState, useCallback } from 'react'
import { useWebSocket } from '../hooks/usewebsocket.js'
import './camerascreen.css'

const FILTERS = [
  { id: 'none',      label: 'Natural' },
  { id: 'grayscale', label: 'Noir'    },
  { id: 'sepia',     label: 'Retro'   },
  { id: 'saturate',  label: 'Vivid'   },
  { id: 'warm',      label: 'Warm'    },
  { id: 'cool',      label: 'Cool'    },
  { id: 'blur',      label: 'Dreamy'  },
  { id: 'edge',      label: 'Edge'    },
]

export default function CameraScreen({ onCapture, onBack }) {
  const [filter,        setFilter]        = useState(FILTERS[0])
  const [frameCount,    setFrameCount]    = useState(3)
  const [showLandmarks, setShowLandmarks] = useState(false)
  const [showEyes,      setShowEyes]      = useState(true)
  const [isMirrored,    setIsMirrored]    = useState(true)
  const [backendOnline, setBackendOnline] = useState(false)
  const [useBackend,    setUseBackend]    = useState(true)

  const videoRef  = useRef(null)
  const streamRef = useRef(null)

  const settings = {
    filter:          filter.id,
    detect_faces:    true,
    show_landmarks:  showLandmarks,
    show_eyes_smile: showEyes,
    mirror:          isMirrored,
  }

  const { connected, liveFrame, faceData, latency, liveFrameRef } =
    useWebSocket(useBackend, settings)

  useEffect(() => {
    fetch('http://localhost:8000/api/status')
      .then(r => r.json())
      .then(() => setBackendOnline(true))
      .catch(() => { setBackendOnline(false); setUseBackend(false) })
  }, [])

  useEffect(() => {
    if (useBackend) return
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1920, height: 1080 }, audio: false })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => {})
    return () => streamRef.current?.getTracks().forEach(t => t.stop())
  }, [useBackend])

  const isMirroredRef = useRef(isMirrored)
  isMirroredRef.current = isMirrored

  // grabFrame reads directly from the ref — never stale
  const grabFrame = useCallback(() => {
    if (useBackend) {
      return liveFrameRef.current ?? null
    }
    const video = videoRef.current
    if (!video) return null
    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth  || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (isMirroredRef.current) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1) }
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  }, [useBackend, liveFrameRef])

  const handleCapture = () => {
    onCapture({ filter, frameCount, grabFrame, faceData })
  }

  return (
    <div className="camera-screen">

      <div className="camera-topbar">
        <button className="camera-back-btn" onClick={onBack}>← Back</button>

        <div className="camera-status">
          <span className={`status-dot ${connected ? 'status-dot--live' : ''}`} />
          <span>{connected ? `LIVE · ${latency}ms` : backendOnline ? 'Connecting…' : 'Browser Mode'}</span>
          {faceData.length > 0 && (
            <span className="face-badge">◉ {faceData.length} face{faceData.length > 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="camera-topbar-right">
          <button
            className={`camera-icon-btn ${isMirrored ? 'camera-icon-btn--on' : ''}`}
            onClick={() => setIsMirrored(m => !m)}
            title="Flip mirror"
          >⇔</button>
        </div>
      </div>

      <div className="camera-viewfinder">
        {useBackend && liveFrame ? (
          <img src={liveFrame} alt="live" className="camera-feed" />
        ) : !useBackend ? (
          <video
            ref={videoRef}
            autoPlay playsInline muted
            className="camera-feed"
            style={{ transform: isMirrored ? 'scaleX(-1)' : 'none' }}
          />
        ) : (
          <div className="camera-nosignal">
            <div className="nosignal-spinner" />
            <p>Connecting to camera…</p>
          </div>
        )}

        <div className="vf-corner vf-corner--tl" />
        <div className="vf-corner vf-corner--tr" />
        <div className="vf-corner vf-corner--bl" />
        <div className="vf-corner vf-corner--br" />

        {faceData.map((face, i) => (
          <div key={i} className="face-box" style={{
            left:   `${face.x * 100}%`,
            top:    `${face.y * 100}%`,
            width:  `${face.w * 100}%`,
            height: `${face.h * 100}%`,
          }} />
        ))}
      </div>

      <aside className="camera-sidebar">
        <div className="sidebar-section">
          <p className="sidebar-label">Filter</p>
          <div className="camera-filters">
            {FILTERS.map(f => (
              <button
                key={f.id}
                className={`filter-chip ${filter.id === f.id ? 'filter-chip--active' : ''}`}
                onClick={() => setFilter(f)}
              >{f.label}</button>
            ))}
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <p className="sidebar-label">Photos</p>
          <div className="frame-picker">
            {[1, 3, 4].map(n => (
              <button
                key={n}
                className={`frame-btn ${frameCount === n ? 'frame-btn--active' : ''}`}
                onClick={() => setFrameCount(n)}
              >{n}</button>
            ))}
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <p className="sidebar-label">Detection</p>
          <div className="opencv-toggles">
            <button
              className={`cv-toggle ${showLandmarks ? 'cv-toggle--on' : ''}`}
              onClick={() => setShowLandmarks(l => !l)}
            ><span className="cv-toggle-dot" />Landmarks</button>
            <button
              className={`cv-toggle ${showEyes ? 'cv-toggle--on' : ''}`}
              onClick={() => setShowEyes(e => !e)}
            ><span className="cv-toggle-dot" />Eyes &amp; Smile</button>
          </div>
        </div>

        <div className="sidebar-shutter">
          <button className="shutter-btn" onClick={handleCapture}>
            <span className="shutter-inner" />
          </button>
          <span className="shutter-label">Take {frameCount} photo{frameCount > 1 ? 's' : ''}</span>
        </div>
      </aside>
    </div>
  )
}