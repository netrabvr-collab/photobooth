import { useEffect, useRef, useState, useCallback } from 'react'

const WS_URL = 'ws://localhost:8000/ws/stream'

export function useWebSocket(enabled, settings) {
  const [connected, setConnected] = useState(false)
  const [liveFrame, setLiveFrame] = useState(null)
  const [faceData,  setFaceData]  = useState([])
  const [latency,   setLatency]   = useState(0)

  const wsRef        = useRef(null)
  const liveFrameRef = useRef(null)   // always holds the LATEST frame string
  const settingsRef  = useRef(settings)
  settingsRef.current = settings

  const sendSettings = useCallback((socket) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(settingsRef.current))
  }, [])

  useEffect(() => {
    if (!enabled) return

    let active     = true
    let retryTimer = null
    let socket     = null
    let pingTs     = 0

    function connect() {
      if (!active) return
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.onclose = () => { if (active) connect() }
        socket.close()
        return
      }

      socket = new WebSocket(WS_URL)
      wsRef.current = socket

      socket.onopen = () => {
        if (!active) { socket.close(); return }
        setConnected(true)
        sendSettings(socket)
      }

      socket.onmessage = (e) => {
        if (!active) return
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'frame') {
            const frame = `data:image/jpeg;base64,${msg.data}`
            liveFrameRef.current = frame   // update ref first, synchronously
            setLiveFrame(frame)
            setFaceData(msg.faces ?? [])
            if (pingTs) setLatency(Math.round(Date.now() - pingTs))
            pingTs = Date.now()
          }
        } catch {}
      }

      socket.onerror = () => socket.close()

      socket.onclose = () => {
        if (!active) return
        setConnected(false)
        retryTimer = setTimeout(connect, 2000)
      }
    }

    connect()

    return () => {
      active = false
      clearTimeout(retryTimer)
      setConnected(false)
      if (socket) {
        socket.onclose = null
        socket.onerror = null
        socket.onopen  = null
        socket.close()
      }
      wsRef.current = null
    }
  }, [enabled, sendSettings])

  useEffect(() => {
    sendSettings(wsRef.current)
  }, [settings, sendSettings])

  // Return the ref itself so callers always read the latest frame
  // even inside memoized callbacks or async loops
  const grabFrame = useCallback(() => liveFrameRef.current, [])

  return { connected, liveFrame, faceData, latency, grabFrame, liveFrameRef }
}