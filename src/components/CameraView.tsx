import { useCallback, useEffect, useRef, useState } from 'react'
import useHandDetection from '../hooks/useHandDetection'
import useSceneInsights from '../hooks/useSceneInsights'

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
}

const BRUSH_COLORS = {
  2: { label: 'Black', value: '#101820', shadow: 'rgba(255, 255, 255, 0.18)' },
  3: { label: 'Green', value: '#66ff66', shadow: 'rgba(102, 255, 102, 0.38)' },
  4: { label: 'Blue', value: '#5bbcff', shadow: 'rgba(91, 188, 255, 0.42)' },
  5: { label: 'Pink', value: '#ff69b4', shadow: 'rgba(255, 105, 180, 0.42)' },
} as const

const DEFAULT_BRUSH = {
  label: 'Gold',
  value: '#ffd84d',
  shadow: 'rgba(255, 216, 77, 0.4)',
}

const BRUSH_WIDTHS = [3, 5, 8, 12, 18]

type Stroke = {
  points: Array<{ x: number; y: number }>
  color: string
  shadow: string
  width: number
}

function replayStrokesOntoCanvas(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
) {
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

  const [cameraError, setCameraError] = useState<string | null>(null)
  const [selectedBrush, setSelectedBrush] = useState(DEFAULT_BRUSH)
  const [brushSize, setBrushSize] = useState(3)
  const [strokeCount, setStrokeCount] = useState(0)
  const [streamReady, setStreamReady] = useState(false)
  const [sceneToggles, setSceneToggles] = useState({
    blinkCounter: false,
    eyeDirection: false,
    people: false,
    smile: false,
    gender: false,
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

  const toggleSceneMode = (
    key: 'blinkCounter' | 'eyeDirection' | 'people' | 'smile' | 'gender',
  ) => {
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

  // Color selection: right hand, count 2–5, gesture committed, not a canvas gesture
  useEffect(() => {
    if (
      detection.handCounts.length !== 1 ||
      detection.drawingTool?.mode === 'draw'
    ) return

    const hand = detection.handCounts[0]
    if (hand.handedness !== 'Right') return
    if (hand.gesture.category === 'canvas') return
    if (hand.gestureConfidence < 1) return

    const selectedCount = hand.count as 2 | 3 | 4 | 5
    const nextBrush = BRUSH_COLORS[selectedCount]
    if (nextBrush && nextBrush.value !== selectedBrush.value) {
      const frameId = window.requestAnimationFrame(() => setSelectedBrush(nextBrush))
      return () => window.cancelAnimationFrame(frameId)
    }
  }, [detection.drawingTool, detection.handCounts, selectedBrush.value])

  // Canvas gestures: right hand fist=undo, thumbs-up=brush+, pinky=brush-
  useEffect(() => {
    for (const hand of detection.handCounts) {
      if (hand.handedness !== 'Right' || !hand.justCommitted) continue
      if (hand.gesture.id === 'thumbs-up') setBrushSize((s) => Math.min(s + 1, 5))
      else if (hand.gesture.id === 'pinky') setBrushSize((s) => Math.max(s - 1, 1))
      else if (hand.gesture.id === 'fist') undoLastStroke()
    }
  }, [detection.handCounts, undoLastStroke])

  // Sync drawing canvas size
  useEffect(() => {
    const video = videoRef.current
    const drawingCanvas = drawingCanvasRef.current
    if (!video || !drawingCanvas || !streamReady) return
    if (
      video.videoWidth &&
      video.videoHeight &&
      (drawingCanvas.width !== video.videoWidth ||
        drawingCanvas.height !== video.videoHeight)
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

    if (
      drawingCanvas.width !== video.videoWidth ||
      drawingCanvas.height !== video.videoHeight
    ) {
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

    if (!detection.drawingTool) {
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

    // Draw mode — quadratic bezier for smooth strokes
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
      ctx.quadraticCurveTo(
        lastDrawPointRef.current.x,
        lastDrawPointRef.current.y,
        midPoint.x,
        midPoint.y,
      )
    } else {
      ctx.moveTo(lastDrawPointRef.current.x, lastDrawPointRef.current.y)
      ctx.lineTo(midPoint.x, midPoint.y)
    }
    ctx.stroke()

    lastMidPointRef.current = midPoint
    lastDrawPointRef.current = currentPoint
  }, [detection.drawingTool, selectedBrush, brushSize])

  // Camera start/stop
  useEffect(() => {
    let mounted = true
    let currentStream: MediaStream | null = null

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
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
        if (mounted) {
          setCameraError(message)
          setStreamReady(false)
        }
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
            <button
              className="secondary-button"
              type="button"
              onClick={undoLastStroke}
              disabled={!canUndo}
            >
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
          {!streamReady && !cameraError ? (
            <div className="stage-banner">Requesting camera access...</div>
          ) : null}
          <div className="screen-overlay" />
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
              className={`gesture-confidence-fill ${detection.gestureConfidence >= 1 ? 'is-locked' : ''}`}
              style={{ width: `${detection.gestureConfidence * 100}%` }}
            />
          </div>
          <div className="gesture-state-row">
            <span
              className={`gesture-dot ${
                !detection.activeGesture
                  ? 'is-idle'
                  : detection.gestureConfidence >= 1
                    ? 'is-locked'
                    : 'is-candidate'
              }`}
            />
            <p className="gesture-name">
              {detection.activeGesture?.label ?? 'Waiting'}
            </p>
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
                  className={`hand-row ${!hand.isHandednessStable ? 'is-stabilizing' : ''}`}
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
          <p className="panel-title">Scene Toggles</p>
          <div className="toggle-list">
            {(
              [
                ['people', 'People'],
                ['eyeDirection', 'Eye Dir'],
                ['smile', 'Smile'],
                ['blinkCounter', 'Blinks'],
                ['gender', 'Gender'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`toggle-row ${sceneToggles[key] ? 'is-on' : ''}`}
                onClick={() => toggleSceneMode(key)}
              >
                <span>{label}</span>
                <span>{sceneToggles[key] ? 'ON' : 'OFF'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-box">
          <p className="panel-title">Scene</p>
          <div className="control-list">
            <div className="control-row">
              <span>People</span>
              <span>{sceneInsights.peopleCount ?? '--'}</span>
            </div>
            <div className="control-row">
              <span>Eyes</span>
              <span>{sceneInsights.eyeDirection ?? '--'}</span>
            </div>
            <div className="control-row">
              <span>Smile</span>
              <span>
                {sceneInsights.smileDetected === null
                  ? '--'
                  : sceneInsights.smileDetected
                    ? 'YES'
                    : 'NO'}
              </span>
            </div>
            <div className="control-row">
              <span>Blinks</span>
              <span>{sceneInsights.blinkCount}</span>
            </div>
            <div className="control-row">
              <span>Gender</span>
              <span>{sceneInsights.gender ?? '--'}</span>
            </div>
          </div>
          <p className="panel-copy">{sceneInsights.status}</p>
        </section>

        <section className="panel-box">
          <p className="panel-title">Controls</p>
          <div className="control-list">
            {[
              ['R 2–5 fingers', 'Color'],
              ['R Fist', 'Undo'],
              ['R 👍', 'Brush +'],
              ['R Pinky', 'Brush −'],
              ['Point', 'Draw'],
              ['L Palm', 'Erase'],
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
