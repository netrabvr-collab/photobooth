import { useState, useEffect, useCallback, useRef } from 'react'
import './capturescreen.css'

const API = 'http://localhost:8000'

export default function CaptureScreen({ grabFrame, frameCount, filter, onDone }) {
  const [num,      setNum]      = useState(3)      // countdown number shown
  const [label,    setLabel]    = useState(null)   // "Smile!" or "Photo X of Y"
  const [flashOn,  setFlashOn]  = useState(false)
  const [taken,    setTaken]    = useState(0)

  const framesRef = useRef([])
  const startedRef = useRef(false)

  const captureShot = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        filter: filter?.id ?? 'none',
        mirror: true,
        detect: true,
        eyes:   true,
      })
      const res  = await fetch(`${API}/api/snapshot?${params}`)
      const data = await res.json()
      if (data.image) return data.image
    } catch {}
    return grabFrame()
  }, [filter, grabFrame])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const run = async () => {
      framesRef.current = []

      for (let i = 0; i < frameCount; i++) {
        // ── 3-2-1 before every shot ────────────────────────────────────────
        setLabel(`Photo ${i + 1} of ${frameCount}`)
        for (const n of [3, 2, 1]) {
          setNum(n)
          await new Promise(r => setTimeout(r, 1000))
        }

        // ── Smile! ─────────────────────────────────────────────────────────
        setNum(null)
        setLabel('Smile!')
        await new Promise(r => setTimeout(r, 700))

        // ── Flash + capture ────────────────────────────────────────────────
        setFlashOn(true)
        await new Promise(r => setTimeout(r, 150))
        setFlashOn(false)

        await new Promise(r => setTimeout(r, 200))
        const frame = await captureShot()
        if (frame) {
          framesRef.current = [...framesRef.current, frame]
          setTaken(framesRef.current.length)
        }

        // Gap between shots
        if (i < frameCount - 1) {
          setLabel(null)
          setNum(null)
          await new Promise(r => setTimeout(r, 500))
        }
      }

      onDone(framesRef.current)
    }

    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="capture-screen">
      {flashOn && <div className="capture-flash" />}

      <div className="capture-indicator">

        {num !== null ? (
          <span className="capture-inter-num" key={num}>{num}</span>
        ) : label === 'Smile!' ? (
          <span className="capture-smile-text">Smile!</span>
        ) : (
          <div className="capture-spinner" />
        )}

        {label && label !== 'Smile!' && (
          <p className="capture-text">{label}</p>
        )}

        <div className="capture-dots">
          {Array.from({ length: frameCount }).map((_, i) => (
            <span key={i} className={`cap-dot ${
              i < taken
                ? 'cap-dot--taken'
                : i === taken
                ? 'cap-dot--active'
                : ''
            }`} />
          ))}
        </div>

      </div>
    </div>
  )
}