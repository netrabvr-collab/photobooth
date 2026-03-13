import { useState, useCallback, useRef } from 'react'
import IntroScreen    from './components/introscreen.jsx'
import CameraScreen   from './components/camerascreen.jsx'
import CaptureScreen  from './components/capturescreen.jsx'
import ResultScreen   from './components/resultscreen.jsx'
import './app.css'

// Screens: intro → camera → capture → result
export default function App() {
  const [screen,     setScreen]     = useState('intro')
  const [photos,     setPhotos]     = useState([])
  const captureConfig = useRef(null) // { grabFrame, frameCount, filter }

  const handleStart = useCallback(() => {
    setScreen('camera')
  }, [])

  const handleCapture = useCallback((config) => {
    captureConfig.current = config
    setScreen('capture')
  }, [])

  const handleCaptured = useCallback((frames) => {
    setPhotos(frames)
    setScreen('result')
  }, [])

  const handleRetake = useCallback(() => {
    setPhotos([])
    setScreen('camera')
  }, [])

  const handleHome = useCallback(() => {
    setPhotos([])
    captureConfig.current = null
    setScreen('intro')
  }, [])

  return (
    <div className="app-shell">
      <div className="app-frame">
        {screen === 'intro' && (
          <IntroScreen onStart={handleStart} />
        )}

        {screen === 'camera' && (
          <CameraScreen
            onCapture={handleCapture}
            onBack={handleHome}
          />
        )}

        {screen === 'capture' && captureConfig.current && (
          <CaptureScreen
            grabFrame={captureConfig.current.grabFrame}
            frameCount={captureConfig.current.frameCount}
            filter={captureConfig.current.filter}
            onDone={handleCaptured}
          />
        )}

        {screen === 'result' && (
          <ResultScreen
            photos={photos}
            onRetake={handleRetake}
            onHome={handleHome}
          />
        )}
      </div>
    </div>
  )
}
