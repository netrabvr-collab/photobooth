import { useMemo } from 'react'
import './bokeh.css'

export default function Bokeh({ count = 18, dark = false }) {
  const particles = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      size:    Math.random() * 10 + 3,
      left:    Math.random() * 100,
      delay:   Math.random() * 8,
      duration: Math.random() * 6 + 6,
      opacity: Math.random() * 0.5 + 0.2,
    }))
  , [count])

  return (
    <div className={`bokeh-wrap ${dark ? 'bokeh-dark' : ''}`}>
      {particles.map(p => (
        <span key={p.id} className="bokeh-dot" style={{
          width:            p.size,
          height:           p.size,
          left:             `${p.left}%`,
          bottom:           '-20px',
          animationDelay:   `${p.delay}s`,
          animationDuration:`${p.duration}s`,
          opacity:          p.opacity,
        }} />
      ))}
    </div>
  )
}
