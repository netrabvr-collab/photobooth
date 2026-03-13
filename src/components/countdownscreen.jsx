import { useEffect, useState } from 'react'
import Bokeh from './bokeh.jsx'
import './countdownscreen.css'

const STEPS = [3, 2, 1, '✦']

export default function CountdownScreen({ onDone }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (step >= STEPS.length) { onDone(); return }
    const t = setTimeout(() => setStep(s => s + 1), step === STEPS.length - 1 ? 800 : 1000)
    return () => clearTimeout(t)
  }, [step, onDone])

  const current = STEPS[step] ?? null

  return (
    <div className="countdown-screen">
      <Bokeh count={16} dark />

      {/* Stars overlay */}
      <div className="star-field">
        {Array.from({ length: 40 }).map((_, i) => (
          <span key={i} className="star" style={{
            left:              `${Math.random() * 100}%`,
            top:               `${Math.random() * 100}%`,
            animationDelay:    `${Math.random() * 3}s`,
            animationDuration: `${Math.random() * 2 + 2}s`,
            width:             `${Math.random() * 2 + 1}px`,
            height:            `${Math.random() * 2 + 1}px`,
          }} />
        ))}
      </div>

      <div className="countdown-content">
        {current !== null && (
          <div className="countdown-number" key={step}>
            {current === '✦' ? (
              <span className="countdown-smile">Smile!</span>
            ) : (
              <span className="countdown-digit">{current}</span>
            )}
          </div>
        )}
        <p className="countdown-label">
          {step < 3 ? 'Get ready…' : 'Say cheese!'}
        </p>
      </div>

      {/* Progress dots */}
      <div className="countdown-dots">
        {STEPS.map((_, i) => (
          <span key={i} className={`cdot ${i <= step ? 'cdot--active' : ''}`} />
        ))}
      </div>
    </div>
  )
}
