import { useCallback, useEffect, useRef, useState } from 'react'
import useHandDetection from '../hooks/useHandDetection'
import useSceneInsights from '../hooks/useSceneInsights'

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
}

const PALETTE_COLORS = [
  { label: 'White',  value: '#f0ede6', shadow: 'rgba(240,237,230,0.4)' },
  { label: 'Red',    value: '#ff3a3a', shadow: 'rgba(255,58,58,0.5)' },
  { label: 'Orange', value: '#ff7f50', shadow: 'rgba(255,127,80,0.5)' },
  { label: 'Gold',   value: '#ffd84d', shadow: 'rgba(255,216,77,0.5)' },
  { label: 'Green',  value: '#4cff72', shadow: 'rgba(76,255,114,0.5)' },
  { label: 'Cyan',   value: '#00e5ff', shadow: 'rgba(0,229,255,0.5)' },
  { label: 'Blue',   value: '#5bbcff', shadow: 'rgba(91,188,255,0.5)' },
  { label: 'Purple', value: '#c084fc', shadow: 'rgba(192,132,252,0.5)' },
  { label: 'Pink',   value: '#ff69b4', shadow: 'rgba(255,105,180,0.5)' },
  { label: 'Black',  value: '#0d1221', shadow: 'rgba(255,255,255,0.15)' },
] as const

const BRUSH_WIDTHS = [3, 5, 8, 12, 18]

type Stroke = {
  points: Array<{ x: number; y: number }>
  color: string
  shadow: string
  width: number
}

function replayStrokesOntoCanvas(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue
    ctx.beginPath()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = stroke.width
    ctx.strokeStyle = stroke.color
    ctx.shadowColor = stroke.shadow
    ctx.shadowBlur = 10
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length - 1; i++) {
      const cp = stroke.points[i]
      const end = {
        x: (stroke.points[i].x + stroke.points[i + 1].x) / 2,
        y: (stroke.points[i].y + stroke.points[i + 1].y) / 2,
      }
      ctx.quadraticCurveTo(cp.x, cp.y, end.x, end.y)
    }
    const last = stroke.points[stroke.points.length - 1]
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
  }
}

function CameraView() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null)
  const lastMidPointRef = useRef<{ x: number; y: number } | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const currentStrokeRef = useRef<Stroke | null>(null)
  const paletteIndexRef = useRef(3)             // current color index (starts at Gold)
  const fingerPrevXRef = useRef<number | null>(null)
  const fingerSwipeCooldownRef = useRef(0)

  const [cameraError, setCameraError] = useState<string | null>(null)
  const [selectedBrush, setSelectedBrush] = useState<typeof PALETTE_COLORS[number]>(PALETTE_COLORS[3])
  const [brushSize, setBrushSize] = useState(3)
  const [strokeCount, setStrokeCount] = useState(0)
  const [streamReady, setStreamReady] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [hoveredColorIndex, setHoveredColorIndex] = useState(3)
  const [sceneToggles, setSceneToggles] = useState({
    blinkCounter: false,
    eyeDirection: false,
    people: false,
    smile: false,
    gender: false,
    beauty: false,
  })

  const detection = useHandDetection({
    enabled: streamReady,
    videoRef,
    canvasRef: overlayCanvasRef,
  })
  const sceneInsights = useSceneInsights({
    enabled: streamReady,
    toggles: sceneToggles,
    videoRef,
  })

  const toggleSceneMode = (key: 'blinkCounter' | 'eyeDirection' | 'people' | 'smile' | 'gender' | 'beauty') => {
    setSceneToggles((c) => ({ ...c, [key]: !c[key] }))
  }

  const undoLastStroke = useCallback(() => {
    if (strokesRef.current.length === 0) return
    strokesRef.current = strokesRef.current.slice(0, -1)
    lastDrawPointRef.current = null
    lastMidPointRef.current = null
    currentStrokeRef.current = null
    const ctx = drawingCanvasRef.current?.getContext('2d')
    if (ctx) replayStrokesOntoCanvas(ctx, strokesRef.current)
    setStrokeCount(strokesRef.current.length)
  }, [])

  const clearDrawing = useCallback(() => {
    const drawingCanvas = drawingCanvasRef.current
    const ctx = drawingCanvas?.getContext('2d')
    if (!drawingCanvas || !ctx) return
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height)
    strokesRef.current = []
    currentStrokeRef.current = null
    lastDrawPointRef.current = null
    lastMidPointRef.current = null
    setStrokeCount(0)
  }, [])

  // Index finger swipe → cycle colors when palette is open
  useEffect(() => {
    if (!paletteOpen) {
      fingerPrevXRef.current = null
      fingerSwipeCooldownRef.current = 0
      return
    }

    const tool = detection.drawingTool
    if (!tool || tool.mode !== 'draw') {
      fingerPrevXRef.current = null
      return
    }

    const prevX = fingerPrevXRef.current
    fingerPrevXRef.current = tool.x
    if (prevX === null) return

    fingerSwipeCooldownRef.current = Math.max(0, fingerSwipeCooldownRef.current - 1)
    if (fingerSwipeCooldownRef.current > 0) return

    // tool.x is in camera space (mirrored in display):
    //   swipe right on screen → tool.x decreases → dx negative → next color
    //   swipe left  on screen → tool.x increases → dx positive → prev color
    const dx = tool.x - prevX
    const THRESHOLD = 0.045
    const COOLDOWN = 16

    if (dx < -THRESHOLD) {
      paletteIndexRef.current = (paletteIndexRef.current + 1) % PALETTE_COLORS.length
      fingerSwipeCooldownRef.current = COOLDOWN
      setSelectedBrush(PALETTE_COLORS[paletteIndexRef.current])
      setHoveredColorIndex(paletteIndexRef.current)
    } else if (dx > THRESHOLD) {
      paletteIndexRef.current = (paletteIndexRef.current - 1 + PALETTE_COLORS.length) % PALETTE_COLORS.length
      fingerSwipeCooldownRef.current = COOLDOWN
      setSelectedBrush(PALETTE_COLORS[paletteIndexRef.current])
      setHoveredColorIndex(paletteIndexRef.current)
    }
  }, [detection.drawingTool, paletteOpen])

  // Canvas gestures (all need justCommitted — debounced via gesture state machine)
  useEffect(() => {
    for (const hand of detection.handCounts) {
      if (hand.handedness !== 'Right' || !hand.justCommitted) continue
      if (hand.gesture.id === 'open-palm') {
        setPaletteOpen((prev) => !prev)
        setHoveredColorIndex(paletteIndexRef.current)
      } else if (hand.gesture.id === 'fist') {
        undoLastStroke()
      } else if (hand.gesture.id === 'thumbs-up' && !hand.thumbsDown) {
        setBrushSize((s) => Math.min(s + 1, 5))
      } else if (hand.gesture.id === 'thumbs-up' && hand.thumbsDown) {
        setBrushSize((s) => Math.max(s - 1, 1))
      }
    }
  }, [detection.handCounts, undoLastStroke])

  // Sync drawing canvas size to video
  useEffect(() => {
    const video = videoRef.current
    const drawingCanvas = drawingCanvasRef.current
    if (!video || !drawingCanvas || !streamReady) return
    if (
      video.videoWidth &&
      video.videoHeight &&
      (drawingCanvas.width !== video.videoWidth || drawingCanvas.height !== video.videoHeight)
    ) {
      drawingCanvas.width = video.videoWidth
      drawingCanvas.height = video.videoHeight
    }
  }, [streamReady])

  // Drawing loop with bezier curves for smooth strokes
  useEffect(() => {
    const video = videoRef.current
    const drawingCanvas = drawingCanvasRef.current

    if (!video || !drawingCanvas || !video.videoWidth || !video.videoHeight) {
      if (currentStrokeRef.current && currentStrokeRef.current.points.length > 1) {
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current].slice(-50)
        setStrokeCount(strokesRef.current.length)
      }
      currentStrokeRef.current = null
      lastDrawPointRef.current = null
      lastMidPointRef.current = null
      return
    }

    if (drawingCanvas.width !== video.videoWidth || drawingCanvas.height !== video.videoHeight) {
      drawingCanvas.width = video.videoWidth
      drawingCanvas.height = video.videoHeight
    }

    const ctx = drawingCanvas.getContext('2d')
    if (!ctx) return

    const finalizeStroke = () => {
      if (currentStrokeRef.current && currentStrokeRef.current.points.length > 1) {
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current].slice(-50)
        setStrokeCount(strokesRef.current.length)
      }
      currentStrokeRef.current = null
      lastDrawPointRef.current = null
      lastMidPointRef.current = null
    }

    if (!detection.drawingTool || paletteOpen) {
      finalizeStroke()
      return
    }

    const currentPoint = {
      x: detection.drawingTool.x * drawingCanvas.width,
      y: detection.drawingTool.y * drawingCanvas.height,
    }

    if (detection.drawingTool.mode === 'erase') {
      finalizeStroke()
      const eraserRadius = Math.max(48, drawingCanvas.width * 0.075)
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(currentPoint.x, currentPoint.y, eraserRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    const lineWidth = BRUSH_WIDTHS[brushSize - 1]

    if (!currentStrokeRef.current) {
      currentStrokeRef.current = {
        points: [],
        color: selectedBrush.value,
        shadow: selectedBrush.shadow,
        width: lineWidth,
      }
    }
    currentStrokeRef.current.points.push(currentPoint)

    if (!lastDrawPointRef.current) {
      lastDrawPointRef.current = currentPoint
      return
    }

    const midPoint = {
      x: (lastDrawPointRef.current.x + currentPoint.x) / 2,
      y: (lastDrawPointRef.current.y + currentPoint.y) / 2,
    }

    ctx.beginPath()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = selectedBrush.value
    ctx.shadowColor = selectedBrush.shadow
    ctx.shadowBlur = 10

    if (lastMidPointRef.current) {
      ctx.moveTo(lastMidPointRef.current.x, lastMidPointRef.current.y)
      ctx.quadraticCurveTo(lastDrawPointRef.current.x, lastDrawPointRef.current.y, midPoint.x, midPoint.y)
    } else {
      ctx.moveTo(lastDrawPointRef.current.x, lastDrawPointRef.current.y)
      ctx.lineTo(midPoint.x, midPoint.y)
    }
    ctx.stroke()

    lastMidPointRef.current = midPoint
    lastDrawPointRef.current = currentPoint
  }, [detection.drawingTool, selectedBrush, brushSize, paletteOpen])

  // Camera start/stop
  useEffect(() => {
    let mounted = true
    let currentStream: MediaStream | null = null

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return }
        currentStream = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setStreamReady(true)
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow webcam access and try again.'
            : 'Unable to access the camera. Check that a webcam is connected and not in use by another app.'
        if (mounted) { setCameraError(message); setStreamReady(false) }
      }
    }

    void startCamera()

    return () => {
      mounted = false
      setStreamReady(false)
      currentStream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const statusMessage = cameraError ?? detection.error ?? detection.statusMessage
  const canUndo = strokeCount > 0

  return (
    <div className="workspace">
      <section className="canvas-panel">
        <div className="canvas-toolbar">
          <div className="toolbar-left">
            <div className="brush-chip">
              <span className="brush-swatch" style={{ backgroundColor: selectedBrush.value }} />
              <span>{selectedBrush.label}</span>
            </div>
            <div className="brush-chip">
              <span className="brush-size-label">sz {brushSize}/5</span>
            </div>
          </div>
          <div className="toolbar-actions">
            <button className="secondary-button" type="button" onClick={undoLastStroke} disabled={!canUndo}>
              Undo
            </button>
            <button className="secondary-button" type="button" onClick={clearDrawing}>
              Clear
            </button>
          </div>
        </div>

        <div className="video-stage">
          <video ref={videoRef} className="camera-feed" autoPlay muted playsInline />
          <canvas ref={drawingCanvasRef} className="drawing-overlay" />
          <canvas ref={overlayCanvasRef} className="camera-overlay" />
          <div className="screen-overlay" />

          {paletteOpen && (
            <div className="color-palette">
              {PALETTE_COLORS.map((color, i) => (
                <div
                  key={color.label}
                  className={`palette-swatch${i === hoveredColorIndex ? ' is-hovered' : ''}${color.value === selectedBrush.value ? ' is-selected' : ''}`}
                  style={{ background: color.value }}
                />
              ))}
            </div>
          )}

          <div className="stage-banner">
            {paletteOpen
              ? `point & swipe ← → to change color  ·  ${PALETTE_COLORS[hoveredColorIndex].label}`
              : statusMessage}
          </div>
        </div>

        <div className="mobile-strip">
          <span className="brush-swatch" style={{ backgroundColor: selectedBrush.value }} />
          <span>{selectedBrush.label}</span>
          <span className="mobile-strip-sep">·</span>
          <span>sz {brushSize}/5</span>
          <span className="mobile-strip-sep">·</span>
          <span>{detection.fingerCount !== null ? `${detection.fingerCount} fingers` : 'no hand'}</span>
          <span className="mobile-strip-sep">·</span>
          <span>{detection.activeGesture?.label ?? 'waiting'}</span>
        </div>
      </section>

      <aside className="sidebar">
        <section className="panel-box big-counter">
          <p className="panel-title">Fingers</p>
          <strong className="counter-value">
            {detection.fingerCount !== null ? detection.fingerCount : '--'}
          </strong>
        </section>

        <section className="panel-box">
          <p className="panel-title">Gesture</p>
          <div className="gesture-confidence-track">
            <div
              className={`gesture-confidence-fill${detection.gestureConfidence >= 1 ? ' is-locked' : ''}`}
              style={{ width: `${detection.gestureConfidence * 100}%` }}
            />
          </div>
          <div className="gesture-state-row">
            <span
              className={`gesture-dot${
                !detection.activeGesture
                  ? ' is-idle'
                  : detection.gestureConfidence >= 1
                    ? ' is-locked'
                    : ' is-candidate'
              }`}
            />
            <p className="gesture-name">{detection.activeGesture?.label ?? 'Waiting'}</p>
          </div>
          <p className="panel-copy">{detection.activeGesture?.effect ?? '—'}</p>
        </section>

        <section className="panel-box">
          <p className="panel-title">Hands</p>
          {detection.handCounts.length ? (
            <div className="hands-list">
              {detection.handCounts.map((hand) => (
                <div
                  key={hand.handedness}
                  className={`hand-row${!hand.isHandednessStable ? ' is-stabilizing' : ''}`}
                >
                  <div>
                    <p className="hand-label">{hand.handedness}</p>
                    <p className="hand-pose">{hand.gesture.label}</p>
                  </div>
                  <strong className="hand-count">{hand.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="panel-copy">No hands detected.</p>
          )}
        </section>

        <section className="panel-box">
          <p className="panel-title">Scene</p>
          <div className="toggle-list">
            {(
              [
                ['people', 'People'],
                ['eyeDirection', 'Eye Dir'],
                ['smile', 'Smile'],
                ['blinkCounter', 'Blinks'],
                ['gender', 'Gender'],
                ['beauty', 'Beauty'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`toggle-row${sceneToggles[key] ? ' is-on' : ''}`}
                onClick={() => toggleSceneMode(key)}
              >
                <span>{label}</span>
                <span>{sceneToggles[key] ? 'ON' : 'OFF'}</span>
              </button>
            ))}
          </div>
          <div className="control-list" style={{ marginTop: '7px' }}>
            <div className="control-row"><span>People</span><span>{sceneInsights.peopleCount ?? '--'}</span></div>
            <div className="control-row"><span>Eyes</span><span>{sceneInsights.eyeDirection ?? '--'}</span></div>
            <div className="control-row"><span>Smile</span><span>{sceneInsights.smileDetected === null ? '--' : sceneInsights.smileDetected ? 'YES' : 'NO'}</span></div>
            <div className="control-row"><span>Blinks</span><span>{sceneInsights.blinkCount}</span></div>
            <div className="control-row"><span>Gender</span><span>{sceneInsights.gender ?? '--'}</span></div>
            <div className="control-row"><span>Beauty</span><span>{sceneInsights.beautyScore !== null ? `${sceneInsights.beautyScore} / 10` : '--'}</span></div>
          </div>
          <p className="panel-copy" style={{ marginTop: '6px' }}>{sceneInsights.status}</p>
        </section>

        <section className="panel-box">
          <p className="panel-title">Controls</p>
          <div className="control-list">
            {[
              ['R Palm', 'Toggle palette'],
              ['Point + swipe', 'Change color'],
              ['Point', 'Draw'],
              ['L Palm', 'Erase'],
              ['R Fist', 'Undo'],
              ['R Thumb up', 'Brush +'],
              ['R Thumb down', 'Brush −'],
            ].map(([k, v]) => (
              <div key={k} className="control-row">
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-box">
          <p className="panel-title">Status</p>
          <p className="panel-copy">{statusMessage}</p>
        </section>
      </aside>
    </div>
  )
}

export default CameraView
