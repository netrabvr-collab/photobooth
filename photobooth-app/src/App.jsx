import { useState, useRef, useEffect, useCallback } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE  = "http://localhost:8000";
const WS_URL    = "ws://localhost:8000/ws/stream";

const FILTERS = [
  { id: "none",      label: "RAW",     icon: "◉" },
  { id: "grayscale", label: "NOIR",    icon: "◑" },
  { id: "sepia",     label: "RETRO",   icon: "◐" },
  { id: "saturate",  label: "VIVID",   icon: "◈" },
  { id: "invert",    label: "X-RAY",   icon: "◆" },
  { id: "warm",      label: "GOLDEN",  icon: "◎" },
  { id: "cool",      label: "ICE",     icon: "◍" },
  { id: "cartoon",   label: "TOON",    icon: "◇" },
  { id: "edge",      label: "EDGE",    icon: "▣" },
  { id: "emboss",    label: "EMBOSS",  icon: "▤" },
  { id: "blur",      label: "DREAM",   icon: "◌" },
];

const FRAME_COUNTS = [1, 3, 4];

// ── Connection mode selector ──────────────────────────────────────────────────
// "ws"      = backend WebSocket stream (OpenCV processed)
// "browser" = local webcam fallback (no backend)
const MODE_WS      = "ws";
const MODE_BROWSER = "browser";

// ─────────────────────────────────────────────────────────────────────────────
export default function PhotoBooth() {
  // Refs
  const wsRef          = useRef(null);
  const videoRef       = useRef(null);   // browser mode
  const streamRef      = useRef(null);
  const canvasRef      = useRef(null);   // browser capture
  const stripCanvasRef = useRef(null);
  const liveFrameRef   = useRef(null);   // always holds latest WS frame (fixes stale closure)

  // Connection / mode
  const [mode,        setMode]        = useState(MODE_WS);
  const [wsConnected, setWsConnected] = useState(false);
  const [backendStatus, setBackendStatus] = useState(null); // from /api/status
  const [liveFrame,   setLiveFrame]   = useState(null);     // base64 from WS
  const [faceCount,   setFaceCount]   = useState(0);
  const [latency,     setLatency]     = useState(0);

  // UI state
  const [activeFilter,  setActiveFilter]  = useState(FILTERS[0]);
  const [frameCount,    setFrameCount]    = useState(3);
  const [photos,        setPhotos]        = useState([]);
  const [isCapturing,   setIsCapturing]   = useState(false);
  const [countdown,     setCountdown]     = useState(null);
  const [captureIndex,  setCaptureIndex]  = useState(0);
  const [flashActive,   setFlashActive]   = useState(false);
  const [stripReady,    setStripReady]    = useState(false);
  const [isMirrored,    setIsMirrored]    = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [showEyes,      setShowEyes]      = useState(true);
  const [savedPhotos,   setSavedPhotos]   = useState([]);
  const [activeTab,     setActiveTab]     = useState("capture"); // capture | gallery

  // ── Ping backend status ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then(r => r.json())
      .then(d => setBackendStatus(d))
      .catch(() => setBackendStatus(null));
  }, []);

  // ── WebSocket connection ────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== MODE_WS) return;
    let ws;
    let pingTs = 0;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        sendSettings(ws);
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "frame") {
          const frameData = `data:image/jpeg;base64,${msg.data}`;
          setLiveFrame(frameData);
          liveFrameRef.current = frameData;
          setFaceCount(msg.faces?.length ?? 0);
          if (pingTs) setLatency(Math.round((Date.now() - pingTs)));
          pingTs = Date.now();
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Reconnect after 2s
        setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => { ws?.close(); };
  }, [mode]);

  // Push settings to backend over WS
  const sendSettings = useCallback((ws) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      filter: activeFilter.id,
      detect_faces: true,
      show_landmarks: showLandmarks,
      show_eyes_smile: showEyes,
      mirror: isMirrored,
    }));
  }, [activeFilter, showLandmarks, showEyes, isMirrored]);

  useEffect(() => {
    if (wsRef.current) sendSettings(wsRef.current);
  }, [sendSettings]);

  // ── Browser camera fallback ─────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== MODE_BROWSER) return;
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {});
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, [mode]);

  // ── Capture helpers ─────────────────────────────────────────────────────────
  const triggerFlash = () => {
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 280);
  };

  // Grab a single frame as base64
  const grabFrame = useCallback(() => {
    if (mode === MODE_WS) {
      // Use ref to always get the LATEST frame, never stale closure value
      return liveFrameRef.current ?? null;
    }
    // Browser canvas capture
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const ctx = canvas.getContext("2d");
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    if (isMirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, [mode, isMirrored]);

  // POST to backend to save & re-process
  const saveToBackend = async (b64) => {
    try {
      const res = await fetch(`${API_BASE}/api/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: b64,
          filter_name: mode === MODE_BROWSER ? activeFilter.id : "none", // already filtered if WS
          detect_faces: true,
          show_landmarks: showLandmarks,
          mirror: false,
        }),
      });
      return await res.json();
    } catch {
      return null;
    }
  };

  const runCapture = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    setStripReady(false);
    setPhotos([]);
    const frames = [];

    for (let i = 0; i < frameCount; i++) {
      setCaptureIndex(i + 1);
      for (let c = 3; c >= 1; c--) {
        setCountdown(c);
        await new Promise(r => setTimeout(r, 900));
      }
      setCountdown("📸");
      await new Promise(r => setTimeout(r, 150));
      triggerFlash();

      const img = grabFrame();
      if (img) {
        frames.push(img);
        setPhotos([...frames]);
        // Save to backend in background
        saveToBackend(img).then(result => {
          if (result?.success) {
            setSavedPhotos(prev => [result.filename, ...prev]);
          }
        });
      }
      setCountdown(null);
      if (i < frameCount - 1) await new Promise(r => setTimeout(r, 700));
    }

    setCaptureIndex(0);
    setIsCapturing(false);
    await new Promise(r => setTimeout(r, 80));
    buildStrip(frames);
  }, [isCapturing, frameCount, grabFrame, showLandmarks]);

  // ── Film strip builder ──────────────────────────────────────────────────────
  const buildStrip = useCallback((frames) => {
    const strip = stripCanvasRef.current;
    if (!strip || !frames.length) return;

    // Fixed strip dimensions: 600x800px
    const STRIP_W = 600;
    const STRIP_H = 800;
    const PAD     = 20;
    const LABEL_H = 60;
    const n       = frames.length;
    // Frame height fills remaining space equally
    const FW = STRIP_W - PAD * 2;
    const FH = Math.floor((STRIP_H - LABEL_H - PAD * (n + 1)) / n);

    strip.width  = STRIP_W;
    strip.height = STRIP_H;
    const ctx = strip.getContext("2d");

    ctx.fillStyle = "#080810";
    ctx.fillRect(0, 0, STRIP_W, STRIP_H);

    // Sprocket holes
    ctx.fillStyle = "#12122a";
    for (let i = 0; i < Math.ceil(STRIP_H / 18); i++) {
      [[3, i*18+7],[STRIP_W-11, i*18+7]].forEach(([x,y]) => {
        ctx.beginPath(); ctx.roundRect(x, y, 8, 10, 2); ctx.fill();
      });
    }

    const loadAndDraw = frames.map((src, i) => new Promise(res => {
      const img = new Image(); img.src = src;
      img.onload = () => {
        const y = PAD + i * (FH + PAD);
        ctx.shadowColor = "#00f5ff"; ctx.shadowBlur = 8;
        ctx.strokeStyle = "#00f5ff"; ctx.lineWidth = 1.5;
        ctx.strokeRect(PAD, y, FW, FH); ctx.shadowBlur = 0;
        ctx.drawImage(img, PAD, y, FW, FH);
        res();
      };
      img.onerror = res;
    }));

    Promise.all(loadAndDraw).then(() => {
      const ly = STRIP_H - 36;
      ctx.fillStyle = "#00f5ff";
      ctx.font = "bold 13px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("◉ PHOTOBOOTH ◉", STRIP_W / 2, ly);
      ctx.fillStyle = "#444";
      ctx.font = "10px 'Courier New', monospace";
      ctx.fillText(new Date().toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" }), STRIP_W / 2, ly + 18);
      setStripReady(true);
    });
  }, []);

  const downloadStrip = () => {
    const strip = stripCanvasRef.current;
    if (!strip) return;
    const a = document.createElement("a");
    a.download = `photobooth_${Date.now()}.jpg`;
    a.href = strip.toDataURL("image/jpeg", 0.95);
    a.click();
  };

  // ── Gallery loader ──────────────────────────────────────────────────────────
  const loadGallery = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/photos`);
      const data = await res.json();
      setSavedPhotos(data.photos || []);
    } catch {}
  }, []);

  useEffect(() => { if (activeTab === "gallery") loadGallery(); }, [activeTab]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const backendOnline = backendStatus !== null;

  return (
    <div style={s.root}>
      <div style={s.scanlines} />
      {flashActive && <div style={s.flash} />}

      {/* Header */}
      <header style={s.header}>
        <div style={s.logo}>
          <span style={s.logoIcon}>⬡</span>
          <span style={s.logoText}>PHOTOBOOTH<span style={s.logoDot}>.EXE</span></span>
        </div>
        <div style={s.statusRow}>
          {/* Backend status */}
          <div style={s.pill}>
            <span style={{ ...s.dot, background: backendOnline ? "#00f5ff" : "#ff4466" }} />
            <span style={s.pillText}>{backendOnline ? "BACKEND ONLINE" : "BACKEND OFFLINE"}</span>
          </div>
          {/* WS status */}
          {mode === MODE_WS && (
            <div style={s.pill}>
              <span style={{ ...s.dot, background: wsConnected ? "#ffe600" : "#ff4466" }} />
              <span style={s.pillText}>{wsConnected ? `WS ${latency}ms` : "WS CONNECTING…"}</span>
            </div>
          )}
          {/* Faces */}
          {wsConnected && (
            <div style={s.pill}>
              <span style={s.pillText}>◉ FACES: {faceCount}</span>
            </div>
          )}
          {/* Mode toggle */}
          <button
            style={{ ...s.modeBtn, ...(mode === MODE_WS ? s.modeBtnActive : {}) }}
            onClick={() => setMode(m => m === MODE_WS ? MODE_BROWSER : MODE_WS)}
          >
            {mode === MODE_WS ? "⚡ OPENCV" : "🌐 BROWSER"}
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div style={s.tabs}>
        {["capture","gallery"].map(t => (
          <button key={t} style={{ ...s.tab, ...(activeTab === t ? s.tabActive : {}) }}
            onClick={() => setActiveTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {activeTab === "capture" ? (
        <main style={s.main}>
          {/* ── Left: viewfinder ───────────────────────────────────────── */}
          <section style={s.leftCol}>
            <div style={s.viewfinder}>
              <Corner pos="TL" /><Corner pos="TR" /><Corner pos="BL" /><Corner pos="BR" />

              {/* WS mode: img tag fed from WebSocket */}
              {mode === MODE_WS ? (
                liveFrame
                  ? <img src={liveFrame} alt="live" style={s.liveImg} />
                  : <div style={s.noSignal}><span style={s.noSignalIcon}>◌</span><p style={s.noSignalText}>{wsConnected ? "WAITING FOR FRAME…" : "CONNECTING TO BACKEND…"}</p></div>
              ) : (
                <video ref={videoRef} autoPlay playsInline muted
                  style={{ ...s.liveImg, transform: isMirrored ? "scaleX(-1)" : "none" }} />
              )}

              {/* Countdown overlay */}
              {countdown !== null && (
                <div style={s.countdownOverlay}>
                  <span style={s.countdownNum}>{countdown}</span>
                  {frameCount > 1 && <span style={s.frameTrack}>{captureIndex} / {frameCount}</span>}
                </div>
              )}

              {/* Footer bar */}
              <div style={s.vfFooter}>
                <span style={s.recDot}>●</span>
                <span style={s.recText}>REC</span>
                <span style={{ flex:1 }} />
                {mode === MODE_BROWSER && (
                  <button style={s.toggleBtn} onClick={() => setIsMirrored(!isMirrored)}>
                    ⇔ {isMirrored ? "MIRROR" : "NORMAL"}
                  </button>
                )}
              </div>
            </div>

            {/* OpenCV toggles (WS only) */}
            {mode === MODE_WS && (
              <div style={s.toggleRow}>
                <ToggleChip label="LANDMARKS" active={showLandmarks} disabled={!backendStatus?.landmarks}
                  onClick={() => setShowLandmarks(!showLandmarks)} />
                <ToggleChip label="EYES & SMILE" active={showEyes}
                  onClick={() => setShowEyes(!showEyes)} />
                <ToggleChip label="MIRROR" active={isMirrored}
                  onClick={() => setIsMirrored(!isMirrored)} />
              </div>
            )}

            {/* Filters */}
            <div style={s.filtersGrid}>
              {FILTERS.map(f => (
                <button key={f.id}
                  style={{ ...s.filterBtn, ...(activeFilter.id === f.id ? s.filterBtnOn : {}) }}
                  onClick={() => setActiveFilter(f)}>
                  <span style={s.fIcon}>{f.icon}</span>
                  <span style={s.fLabel}>{f.label}</span>
                </button>
              ))}
            </div>

            {/* Controls */}
            <div style={s.controls}>
              <div style={s.framePicker}>
                <span style={s.fpLabel}>FRAMES</span>
                {FRAME_COUNTS.map(n => (
                  <button key={n}
                    style={{ ...s.fpBtn, ...(frameCount === n ? s.fpBtnOn : {}) }}
                    onClick={() => !isCapturing && setFrameCount(n)}>{n}</button>
                ))}
              </div>
              <button style={{ ...s.captureBtn, ...(isCapturing ? s.captureBtnOff : {}) }}
                onClick={runCapture} disabled={isCapturing}>
                {isCapturing
                  ? <><span style={s.spinner}>◌</span> CAPTURING…</>
                  : <><span>◉</span> CAPTURE</>}
              </button>
            </div>
          </section>

          {/* ── Right: strip ───────────────────────────────────────────── */}
          <section style={s.rightCol}>
            <div style={s.stripHeader}>
              <span style={s.stripTitle}>FILM STRIP</span>
              {stripReady && <button style={s.dlBtn} onClick={downloadStrip}>↓ SAVE</button>}
            </div>

            <div style={s.thumbGrid}>
              {photos.length === 0 && !isCapturing
                ? <div style={s.emptyStrip}><span style={{ fontSize:36, opacity:.25 }}>🎞</span><p style={s.emptyTxt}>No photos yet</p></div>
                : <>
                    {photos.map((src,i) => (
                      <div key={i} style={s.thumb}>
                        <img src={src} alt={`#${i+1}`} style={s.thumbImg}/>
                        <span style={s.thumbNum}>#{String(i+1).padStart(2,"0")}</span>
                      </div>
                    ))}
                    {isCapturing && Array.from({length: frameCount - photos.length}).map((_,i) => (
                      <div key={`ph${i}`} style={{ ...s.thumb, ...s.thumbPH }}>
                        <span style={{ color:"#1a1a30", fontSize:22 }}>◌</span>
                      </div>
                    ))}
                  </>
              }
            </div>

            {stripReady && (
              <div style={s.stripPreview}>
                <p style={s.previewLabel}>STRIP PREVIEW</p>
                <img src={stripCanvasRef.current?.toDataURL("image/jpeg", 0.88)} alt="strip" style={s.previewImg}/>
              </div>
            )}

            <canvas ref={stripCanvasRef} style={{ display:"none" }} />
            <canvas ref={canvasRef}      style={{ display:"none" }} />
          </section>
        </main>
      ) : (
        /* ── Gallery tab ─────────────────────────────────────────────── */
        <div style={s.gallery}>
          <div style={s.galleryHeader}>
            <span style={s.stripTitle}>SERVER GALLERY — {savedPhotos.length} PHOTOS</span>
            <button style={s.dlBtn} onClick={loadGallery}>↺ REFRESH</button>
          </div>
          {savedPhotos.length === 0
            ? <div style={s.emptyStrip}><span style={{ fontSize:48, opacity:.2 }}>📂</span><p style={s.emptyTxt}>No saved photos on server</p></div>
            : <div style={s.galleryGrid}>
                {savedPhotos.map(name => (
                  <a key={name} href={`${API_BASE}/api/photos/${name}`} target="_blank" rel="noreferrer" style={s.galleryItem}>
                    <img src={`${API_BASE}/api/photos/${name}`} alt={name} style={s.galleryImg}/>
                    <span style={s.galleryName}>{name.slice(0,18)}</span>
                  </a>
                ))}
              </div>
          }
        </div>
      )}

      <footer style={s.footer}>
        <span style={s.footerTxt}>
          ◈ PHOTOBOOTH.EXE — OPENCV {backendStatus?.opencv_version ?? "?"} · DLIB {backendStatus?.dlib ? "✓" : "✗"} · LANDMARKS {backendStatus?.landmarks ? "✓" : "✗"} ◈
        </span>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#050508;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes glow{0%,100%{text-shadow:0 0 8px #00f5ff}50%{text-shadow:0 0 24px #00f5ff,0 0 48px #00f5ff}}
      `}</style>
    </div>
  );
}

// ── Small sub-components ──────────────────────────────────────────────────────
function Corner({ pos }) {
  const t = pos[0]==="T", l = pos[1]==="L";
  return <div style={{
    position:"absolute",
    [t?"top":"bottom"]: 8,
    [l?"left":"right"]: 8,
    width:16, height:16,
    borderTop:    t ? "2px solid #00f5ff" : "none",
    borderBottom: !t? "2px solid #00f5ff" : "none",
    borderLeft:   l ? "2px solid #00f5ff" : "none",
    borderRight:  !l? "2px solid #00f5ff" : "none",
    zIndex:10,
  }} />;
}

function ToggleChip({ label, active, onClick, disabled=false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? "rgba(0,245,255,0.08)" : "transparent",
        border: `1px solid ${active ? "#00f5ff" : "#1a1a30"}`,
        color: disabled ? "#333" : active ? "#00f5ff" : "#445566",
        fontFamily:"'Share Tech Mono',monospace",
        fontSize:10, letterSpacing:1.5,
        padding:"5px 12px", cursor: disabled ? "default" : "pointer",
        transition:"all .15s",
      }}>
      {label}
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const C = { bg:"#050508", panel:"#0d0d16", border:"#1a1a30", cyan:"#00f5ff", pink:"#ff2d78", yellow:"#ffe600", text:"#c8d8e8", muted:"#445566" };

const s = {
  root:{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Share Tech Mono','Courier New',monospace", display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" },
  scanlines:{ position:"fixed", inset:0, background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,245,255,.012) 2px,rgba(0,245,255,.012) 4px)", pointerEvents:"none", zIndex:9998 },
  flash:{ position:"fixed", inset:0, background:"rgba(255,255,255,.85)", zIndex:9999, pointerEvents:"none" },
  header:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 24px", borderBottom:`1px solid ${C.border}` },
  logo:{ display:"flex", alignItems:"center", gap:10 },
  logoIcon:{ fontSize:20, color:C.cyan, animation:"glow 3s ease-in-out infinite" },
  logoText:{ fontFamily:"'Orbitron',sans-serif", fontSize:16, fontWeight:900, color:"#f0f8ff", letterSpacing:2 },
  logoDot:{ color:C.cyan, fontSize:13 },
  statusRow:{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" },
  pill:{ display:"flex", alignItems:"center", gap:6, background:C.panel, border:`1px solid ${C.border}`, padding:"4px 10px" },
  dot:{ width:7, height:7, borderRadius:"50%", animation:"blink 1.5s ease-in-out infinite" },
  pillText:{ fontSize:10, color:C.muted, letterSpacing:1.5 },
  modeBtn:{ background:"transparent", border:`1px solid ${C.border}`, color:C.muted, fontFamily:"'Share Tech Mono',monospace", fontSize:10, padding:"5px 12px", cursor:"pointer", letterSpacing:1.5 },
  modeBtnActive:{ border:`1px solid ${C.cyan}`, color:C.cyan, background:"rgba(0,245,255,.05)" },
  tabs:{ display:"flex", borderBottom:`1px solid ${C.border}` },
  tab:{ background:"transparent", border:"none", borderBottom:"2px solid transparent", color:C.muted, fontFamily:"'Share Tech Mono',monospace", fontSize:11, letterSpacing:2, padding:"10px 24px", cursor:"pointer" },
  tabActive:{ color:C.cyan, borderBottomColor:C.cyan },
  main:{ flex:1, display:"flex", gap:20, padding:"20px 24px", alignItems:"flex-start" },
  leftCol:{ flex:"0 0 auto", width:500, display:"flex", flexDirection:"column", gap:14 },
  viewfinder:{ position:"relative", background:"#000", border:`1px solid ${C.border}`, aspectRatio:"4/3", overflow:"hidden", boxShadow:`0 0 24px rgba(0,245,255,.07)` },
  liveImg:{ width:"100%", height:"calc(100% - 28px)", objectFit:"cover", display:"block" },
  noSignal:{ width:"100%", height:"calc(100% - 28px)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 },
  noSignalIcon:{ fontSize:36, color:C.border, animation:"blink 1.2s ease-in-out infinite" },
  noSignalText:{ fontSize:11, color:C.muted, letterSpacing:2 },
  countdownOverlay:{ position:"absolute", inset:0, background:"rgba(0,0,0,.5)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:20 },
  countdownNum:{ fontFamily:"'Orbitron',sans-serif", fontSize:80, fontWeight:900, color:C.cyan, textShadow:`0 0 30px ${C.cyan}`, lineHeight:1 },
  frameTrack:{ color:C.muted, fontSize:12, marginTop:10, letterSpacing:3 },
  vfFooter:{ position:"absolute", bottom:0, left:0, right:0, height:28, background:"rgba(0,0,0,.8)", display:"flex", alignItems:"center", padding:"0 10px", gap:6, borderTop:`1px solid ${C.border}` },
  recDot:{ color:"#ff2d78", fontSize:9, animation:"blink 1s ease-in-out infinite" },
  recText:{ color:"#ff2d78", fontSize:9, letterSpacing:2 },
  toggleBtn:{ background:"transparent", border:"none", color:C.muted, fontFamily:"'Share Tech Mono',monospace", fontSize:9, cursor:"pointer", letterSpacing:1 },
  toggleRow:{ display:"flex", gap:8, flexWrap:"wrap" },
  filtersGrid:{ display:"grid", gridTemplateColumns:"repeat(11,1fr)", gap:4 },
  filterBtn:{ background:C.panel, border:`1px solid ${C.border}`, color:C.muted, padding:"6px 2px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2, fontFamily:"'Share Tech Mono',monospace", transition:"all .15s" },
  filterBtnOn:{ border:`1px solid ${C.cyan}`, color:C.cyan, background:"rgba(0,245,255,.06)", boxShadow:`0 0 8px rgba(0,245,255,.15)` },
  fIcon:{ fontSize:12 },
  fLabel:{ fontSize:7, letterSpacing:.5 },
  controls:{ display:"flex", alignItems:"center", gap:12 },
  framePicker:{ display:"flex", alignItems:"center", gap:8 },
  fpLabel:{ fontSize:9, color:C.muted, letterSpacing:2 },
  fpBtn:{ width:32, height:32, background:C.panel, border:`1px solid ${C.border}`, color:C.muted, cursor:"pointer", fontFamily:"'Share Tech Mono',monospace", fontSize:13, transition:"all .15s" },
  fpBtnOn:{ border:`1px solid ${C.yellow}`, color:C.yellow, background:"rgba(255,230,0,.05)" },
  captureBtn:{ flex:2, background:C.cyan, border:"none", color:"#000", fontFamily:"'Orbitron',sans-serif", fontWeight:700, fontSize:13, padding:"12px 20px", cursor:"pointer", letterSpacing:2, display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:`0 0 18px rgba(0,245,255,.4)`, transition:"all .15s" },
  captureBtnOff:{ background:"#00a8b5", cursor:"not-allowed", boxShadow:"none", opacity:.7 },
  spinner:{ display:"inline-block", animation:"spin 1s linear infinite" },
  rightCol:{ flex:1, display:"flex", flexDirection:"column", gap:14 },
  stripHeader:{ display:"flex", alignItems:"center", justifyContent:"space-between" },
  stripTitle:{ fontSize:10, color:C.muted, letterSpacing:3 },
  dlBtn:{ background:"transparent", border:`1px solid ${C.pink}`, color:C.pink, fontFamily:"'Share Tech Mono',monospace", fontSize:10, padding:"5px 14px", cursor:"pointer", letterSpacing:2 },
  thumbGrid:{ background:C.panel, border:`1px solid ${C.border}`, padding:14, minHeight:180, display:"flex", flexWrap:"wrap", gap:10, alignContent:"flex-start" },
  emptyStrip:{ width:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, minHeight:120 },
  emptyTxt:{ fontSize:11, color:C.muted, letterSpacing:1 },
  thumb:{ position:"relative", border:`1px solid ${C.border}`, overflow:"hidden", background:"#000", width:120, height:90 },
  thumbImg:{ width:"100%", height:"100%", objectFit:"cover", display:"block" },
  thumbNum:{ position:"absolute", bottom:0, left:0, right:0, background:"rgba(0,0,0,.7)", color:C.cyan, fontSize:8, textAlign:"center", padding:"2px 0", letterSpacing:2 },
  thumbPH:{ display:"flex", alignItems:"center", justifyContent:"center", background:"#080810" },
  stripPreview:{ display:"flex", flexDirection:"column", gap:8 },
  previewLabel:{ fontSize:9, color:C.muted, letterSpacing:3 },
  previewImg:{ maxHeight:380, border:`1px solid ${C.border}`, boxShadow:`0 0 16px rgba(0,245,255,.1)` },
  gallery:{ flex:1, padding:"20px 24px", display:"flex", flexDirection:"column", gap:14 },
  galleryHeader:{ display:"flex", alignItems:"center", justifyContent:"space-between" },
  galleryGrid:{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px,1fr))", gap:12 },
  galleryItem:{ display:"flex", flexDirection:"column", gap:4, textDecoration:"none", border:`1px solid ${C.border}`, overflow:"hidden", background:C.panel, transition:"border-color .15s" },
  galleryImg:{ width:"100%", aspectRatio:"4/3", objectFit:"cover", display:"block" },
  galleryName:{ fontSize:9, color:C.muted, letterSpacing:1, padding:"4px 8px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
  footer:{ padding:"10px 24px", borderTop:`1px solid ${C.border}`, textAlign:"center" },
  footerTxt:{ fontSize:9, color:C.muted, letterSpacing:1.5 },
};