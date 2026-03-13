import './introscreen.css'
import Bokeh from './bokeh.jsx'

export default function IntroScreen({ onStart }) {
  return (
    <div className="intro-screen">
      <Bokeh count={22} />

      <div className="intro-content">
        <div className="intro-icon">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="26" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5"/>
            <circle cx="28" cy="28" r="14" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
            <circle cx="28" cy="28" r="7"  fill="rgba(255,255,255,0.7)"/>
            <rect x="10" y="20" width="8" height="6" rx="2" fill="rgba(255,255,255,0.4)"/>
          </svg>
        </div>

        <p className="intro-eyebrow">Welcome to</p>
        <h1 className="intro-title">Photo<br/>Booth</h1>
        <p className="intro-subtitle">Capture your perfect moment</p>

        <button className="intro-start-btn" onClick={onStart}>
          Start
        </button>
      </div>

      <div className="intro-footer">
        <p>Tap to begin your session</p>
      </div>
    </div>
  )
}
