import { useCallback, useEffect, useRef, useState } from 'react'
import useHandDetection from '../hooks/useHandDetection'
import useSceneInsights from '../hooks/useSceneInsights'

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
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

function CameraView() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null)
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
    key: 'blinkCounter' | 'eyeDirection' | 'people' | 'smile',
  ) => {
    setSceneToggles((current) => ({ ...current, [key]: !current[key] }))
  }

  const replayStrokes = useCallback(() => {
    const drawingCanvas = drawingCanvasRef.current
    const ctx = drawingCanvas?.getContext('2d')
    if (!drawingCanvas || !ctx) return

    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height)

    for (const stroke of strokesRef.current) {
      if (stroke.points.length < 2) continue
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = stroke.width
      ctx.strokeStyle = stroke.color
      ctx.shadowColor = stroke.shadow
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      ctx.stroke()
    }
  }, [])

  const undoLastStroke = useCallback(() => {
    if (strokesRef.current.length === 0) return
    strokesRef.current = strokesRef.current.slice(0, -1)
    lastDrawPointRef.current = null
    currentStrokeRef.current = null
    replayStrokes()
    setStrokeCount(strokesRef.current.length)
  }, [replayStrokes])

  const clearDrawing = useCallback(() => {
    const drawingCanvas = drawingCanvasRef.current
    const ctx = drawingCanvas?.getContext('2d')
    if (!drawingCanvas || !ctx) return
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height)
    strokesRef.current = []
    currentStrokeRef.current = null
    lastDrawPointRef.current = null
    setStrokeCount(0)
  }, [])

  // Color selection: right hand, count 2–5, gesture committed, not a canvas gesture
  useEffect(() => {
    if (
      detection.handCounts.length !== 1 ||
      detection.drawingTool?.mode === 'draw'
    ) {
      return
    }

    const hand = detection.handCounts[0]
    if (hand.handedness !== 'Right') return
    if (hand.gesture.category === 'canvas') return
    if (hand.gestureConfidence < 1) return

    const selectedCount = hand.count as 2 | 3 | 4 | 5
    const nextBrush = BRUSH_COLORS[selectedCount]

    if (nextBrush && nextBrush.value !== selectedBrush.value) {
      const frameId = window.requestAnimationFrame(() => {
        setSelectedBrush(nextBrush)
      })
      return () => window.cancelAnimationFrame(frameId)
    }
  }, [detection.drawingTool, detection.handCounts, selectedBrush.value])

  // Canvas gestures: right hand fist=undo, thumbs-up=brush+, pinky=brush-
  useEffect(() => {
    for (const hand of detection.handCounts) {
      if (hand.handedness !== 'Right' || !hand.justCommitted) continue

      if (hand.gesture.id === 'thumbs-up') {
        setBrushSize((s) => Math.min(s + 1, 5))
      } else if (hand.gesture.id === 'pinky') {
        setBrushSize((s) => Math.max(s - 1, 1))
      } else if (hand.gesture.id === 'fist') {
        undoLastStroke()
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
      (drawingCanvas.width !== video.videoWidth ||
        drawingCanvas.height !== video.videoHeight)
    ) {
      drawingCanvas.width = video.videoWidth
      drawingCanvas.height = video.videoHeight
    }
  }, [streamReady])

  // Drawing loop — stroke lifecycle + canvas rendering
  useEffect(() => {
    const video = videoRef.current
    const drawingCanvas = drawingCanvasRef.current

    if (!video || !drawingCanvas || !video.videoWidth || !video.videoHeight) {
      if (
        currentStrokeRef.current &&
        currentStrokeRef.current.points.length > 1
      ) {
        strokesRef.current = [
          ...strokesRef.current,
          currentStrokeRef.current,
        ].slice(-50)
        setStrokeCount(strokesRef.current.length)
      }
      currentStrokeRef.current = null
      lastDrawPointRef.current = null
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

    if (!detection.drawingTool) {
      if (
        currentStrokeRef.current &&
        currentStrokeRef.current.points.length > 1
      ) {
        strokesRef.current = [
          ...strokesRef.current,
          currentStrokeRef.current,
        ].slice(-50)
        setStrokeCount(strokesRef.current.length)
      }
      currentStrokeRef.current = null
      lastDrawPointRef.current = null
      return
    }

    const currentPoint = {
      x: detection.drawingTool.x * drawingCanvas.width,
      y: detection.drawingTool.y * drawingCanvas.height,
    }

    if (detection.drawingTool.mode === 'erase') {
      if (
        currentStrokeRef.current &&
        currentStrokeRef.current.points.length > 1
      ) {
        strokesRef.current = [
          ...strokesRef.current,
          currentStrokeRef.current,
        ].slice(-50)
        setStrokeCount(strokesRef.current.length)
      }
      currentStrokeRef.current = null
      lastDrawPointRef.current = null

      const eraserRadius = Math.max(48, drawingCanvas.width * 0.075)
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(currentPoint.x, currentPoint.y, eraserRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    // Draw mode
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

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = selectedBrush.value
    ctx.shadowColor = selectedBrush.shadow
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.moveTo(lastDrawPointRef.current.x, lastDrawPointRef.current.y)
    ctx.lineTo(currentPoint.x, currentPoint.y)
    ctx.stroke()

    lastDrawPointRef.current = currentPoint
  }, [detection.drawingTool, selectedBrush, brushSize])

  // Camera start/stop
  useEffect(() => {
    let mounted = true
    let currentStream: MediaStream | null = null

    const startCamera = async () => {
      try {
        const stream =
          await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)

        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop())
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
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const statusMessage = cameraError
    ? cameraError
    : detection.error
      ? detection.error
      : detection.statusMessage

  const canUndo = strokeCount > 0

  return (
    <div className="workspace">
      <section className="canvas-panel">
        <div className="canvas-toolbar">
          <div className="toolbar-block">
            <span className="toolbar-label">Brush</span>
            <div className="brush-chip">
              <span
                className="brush-swatch"
                style={{ backgroundColor: selectedBrush.value }}
              />
              <span>{selectedBrush.label}</span>
            </div>
          </div>

          <div className="toolbar-block">
            <span className="toolbar-label">Size</span>
            <div className="brush-chip">
              <span className="brush-size-label">{brushSize} / 5</span>
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
            <button
              className="secondary-button"
              type="button"
              onClick={clearDrawing}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="video-stage">
          <video
            ref={videoRef}
            className="camera-feed"
            autoPlay
            muted
            playsInline
          />
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
          <p className="panel-title">Finger Count</p>
          <strong className="counter-value">
            {detection.fingerCount !== null ? detection.fingerCount : '--'}
          </strong>
          <p className="panel-copy">
            {detection.fingerCount !== null
              ? `${detection.fingerCount} finger${detection.fingerCount === 1 ? '' : 's'} visible`
              : 'No hands in frame'}
          </p>
        </section>

        <section className="panel-box">
          <p className="panel-title">Current Gesture</p>
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
          <p className="panel-copy">
            {detection.activeGesture?.description ??
              'Bring your hands into the frame to start tracking.'}
          </p>
        </section>

        <section className="panel-box">
          <p className="panel-title">Detection Toggles</p>
          <div className="toggle-list">
            <button
              type="button"
              className={`toggle-row ${sceneToggles.people ? 'is-on' : ''}`}
              onClick={() => toggleSceneMode('people')}
            >
              <span>Detect People</span>
              <span>{sceneToggles.people ? 'ON' : 'OFF'}</span>
            </button>
            <button
              type="button"
              className={`toggle-row ${sceneToggles.eyeDirection ? 'is-on' : ''}`}
              onClick={() => toggleSceneMode('eyeDirection')}
            >
              <span>Detect Eye Direction</span>
              <span>{sceneToggles.eyeDirection ? 'ON' : 'OFF'}</span>
            </button>
            <button
              type="button"
              className={`toggle-row ${sceneToggles.smile ? 'is-on' : ''}`}
              onClick={() => toggleSceneMode('smile')}
            >
              <span>Detect Smile</span>
              <span>{sceneToggles.smile ? 'ON' : 'OFF'}</span>
            </button>
            <button
              type="button"
              className={`toggle-row ${sceneToggles.blinkCounter ? 'is-on' : ''}`}
              onClick={() => toggleSceneMode('blinkCounter')}
            >
              <span>Blink Counter</span>
              <span>{sceneToggles.blinkCounter ? 'ON' : 'OFF'}</span>
            </button>
          </div>
          <p className="panel-copy">
            Gender detection is not available. These toggles stay on-device and
            focus on visible motion and expression instead.
          </p>
        </section>

        <section className="panel-box">
          <p className="panel-title">Scene Analysis</p>
          <div className="control-list">
            <div className="control-row">
              <span>People</span>
              <span>
                {sceneInsights.peopleCount !== null
                  ? sceneInsights.peopleCount
                  : '--'}
              </span>
            </div>
            <div className="control-row">
              <span>Eye Direction</span>
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
          </div>
          <p className="panel-copy">{sceneInsights.status}</p>
        </section>

        <section className="panel-box">
          <p className="panel-title">Controls</p>
          <div className="control-list">
            <div className="control-row">
              <span>Right 2</span>
              <span>Black</span>
            </div>
            <div className="control-row">
              <span>Right 3</span>
              <span>Green</span>
            </div>
            <div className="control-row">
              <span>Right 4</span>
              <span>Blue</span>
            </div>
            <div className="control-row">
              <span>Right 5</span>
              <span>Pink</span>
            </div>
            <div className="control-row">
              <span>Right Fist</span>
              <span>Undo</span>
            </div>
            <div className="control-row">
              <span>Right 👍</span>
              <span>Brush +</span>
            </div>
            <div className="control-row">
              <span>Right Pinky</span>
              <span>Brush −</span>
            </div>
            <div className="control-row">
              <span>Point</span>
              <span>Draw</span>
            </div>
            <div className="control-row">
              <span>Left Palm</span>
              <span>Erase</span>
            </div>
          </div>
        </section>

        <section className="panel-box">
          <p className="panel-title">Detected Hands</p>
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
            <p className="panel-copy">No hands detected yet.</p>
          )}
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
