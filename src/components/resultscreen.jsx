import { useEffect, useRef, useState } from 'react'
import Bokeh from './bokeh.jsx'
import './resultscreen.css'

export default function ResultScreen({ photos, onRetake, onHome }) {
  const stripRef   = useRef(null)
  const [stripUrl, setStripUrl] = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const showStrip  = photos.length >= 3
  const showGrid   = photos.length > 0 && !showStrip

  // Build film strip for 3+ photos
  useEffect(() => {
    if (!showStrip || !photos.length) return
    const canvas = stripRef.current
    if (!canvas) return

    const W   = 320
    const PAD = 14
    const FW  = W - PAD * 2
    const FH  = Math.round(FW * 3 / 4)
    const GAP = 8
    const FOOT = 52
    const H   = PAD + photos.length * (FH + GAP) - GAP + PAD + FOOT

    canvas.width  = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, W, H)
    bg.addColorStop(0, '#fff8f9')
    bg.addColorStop(1, '#fce4ec')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Subtle grain
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(180,60,100,${Math.random() * 0.025})`
      ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1)
    }

    const draws = photos.map((src, i) => new Promise(res => {
      const img = new Image()
      img.src = src
      img.onload = () => {
        const y = PAD + i * (FH + GAP)
        ctx.shadowColor  = 'rgba(180,60,100,0.15)'
        ctx.shadowBlur   = 10
        ctx.shadowOffsetY = 3
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(PAD, y, FW, FH, 6)
        ctx.clip()
        const aspect = img.width / img.height
        let dw = FW, dh = FH
        if (FW / FH > aspect) dw = FH * aspect
        else dh = FW / aspect
        ctx.drawImage(img, PAD + (FW - dw) / 2, y + (FH - dh) / 2, dw, dh)
        ctx.restore()
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
        res()
      }
      img.onerror = res
    }))

    Promise.all(draws).then(() => {
      const fy = H - FOOT + 10
      ctx.fillStyle = 'rgba(200,80,120,0.5)'
      ctx.font = "italic 700 16px 'Playfair Display', Georgia, serif"
      ctx.textAlign = 'center'
      ctx.fillText('Photo Booth', W / 2, fy + 16)
      ctx.fillStyle = 'rgba(180,60,100,0.3)'
      ctx.font = "300 10px 'DM Sans', sans-serif"
      ctx.fillText(
        new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        W / 2, fy + 34
      )
      setStripUrl(canvas.toDataURL('image/jpeg', 0.95))
    })
  }, [photos, showStrip])

  const handleDownload = () => {
    setSaving(true)
    if (showStrip && stripUrl) {
      const a = document.createElement('a')
      a.download = `photobooth_strip_${Date.now()}.jpg`
      a.href = stripUrl
      a.click()
    } else if (photos.length === 1) {
      const a = document.createElement('a')
      a.download = `photobooth_${Date.now()}.jpg`
      a.href = photos[0]
      a.click()
    }
    setTimeout(() => { setSaving(false); setSaved(true) }, 600)
  }

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <div className="result-screen">
      <Bokeh count={20} />

      {/* ── Left — photo display ────────────────────────────────────────── */}
      <div className="result-left">
        {showStrip ? (
          <div className="result-strip-wrap">
            {stripUrl
              ? <img src={stripUrl} alt="strip" className="result-strip-img" />
              : <div className="result-loading"><div className="result-spinner" /></div>
            }
            <canvas ref={stripRef} style={{ display: 'none' }} />
          </div>
        ) : (
          <div className="result-photos-grid">
            {photos.map((src, i) => (
              <div key={i} className="result-photo-card" style={{ animationDelay: `${i * 0.08}s` }}>
                <img src={src} alt={`Photo ${i + 1}`} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Right — info + actions ──────────────────────────────────────── */}
      <div className="result-right">
        <div className="result-header">
          <p className="result-eyebrow">Your session</p>
          <h2 className="result-title">Looking<br/>great!</h2>
          <p className="result-meta">{photos.length} photo{photos.length > 1 ? 's' : ''} · {dateStr}</p>
        </div>

        <div className="result-actions">
          <button
            className={`result-save-btn ${saved ? 'result-save-btn--saved' : ''}`}
            onClick={handleDownload}
            disabled={saving || (showStrip && !stripUrl)}
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : `↓ Save ${showStrip ? 'Strip' : 'Photo'}`}
          </button>

          <div className="result-secondary">
            <button className="result-ghost-btn" onClick={onRetake}>Retake</button>
            <button className="result-ghost-btn" onClick={onHome}>New Session</button>
          </div>
        </div>
      </div>
    </div>
  )
}
