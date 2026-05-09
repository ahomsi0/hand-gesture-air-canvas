import { useEffect, useRef, useState } from 'react'
import useHandDetection from '../hooks/useHandDetection'

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
}

const BRUSH_COLORS = {
  2: {
    label: 'Black',
    value: '#020617',
    shadow: 'rgba(248, 250, 252, 0.24)',
  },
  3: {
    label: 'Green',
    value: '#22c55e',
    shadow: 'rgba(34, 197, 94, 0.4)',
  },
  4: {
    label: 'Blue',
    value: '#38bdf8',
    shadow: 'rgba(56, 189, 248, 0.42)',
  },
  5: {
    label: 'Pink',
    value: '#f472b6',
    shadow: 'rgba(244, 114, 182, 0.42)',
  },
} as const

const DEFAULT_BRUSH = {
  label: 'Gold',
  value: '#fde68a',
  shadow: 'rgba(251, 191, 36, 0.45)',
}

function CameraView() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [selectedBrush, setSelectedBrush] = useState(DEFAULT_BRUSH)
  const [streamReady, setStreamReady] = useState(false)

  const detection = useHandDetection({
    enabled: streamReady,
    videoRef,
    canvasRef: overlayCanvasRef,
  })

  useEffect(() => {
    if (detection.handCounts.length !== 1 || detection.drawingTool?.mode === 'draw') {
      return
    }

    if (detection.handCounts[0].handedness !== 'Right') {
      return
    }

    const selectedCount = detection.handCounts[0].count as 2 | 3 | 4 | 5
    const nextBrush = BRUSH_COLORS[selectedCount]

    if (nextBrush && nextBrush.value !== selectedBrush.value) {
      const frameId = window.requestAnimationFrame(() => {
        setSelectedBrush(nextBrush)
      })

      return () => window.cancelAnimationFrame(frameId)
    }
  }, [detection.drawingTool, detection.handCounts, selectedBrush.value])

  useEffect(() => {
    const video = videoRef.current
    const drawingCanvas = drawingCanvasRef.current

    if (!video || !drawingCanvas || !streamReady) {
      return
    }

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

  useEffect(() => {
    const video = videoRef.current
    const drawingCanvas = drawingCanvasRef.current

    if (!video || !drawingCanvas || !video.videoWidth || !video.videoHeight) {
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

    if (!ctx) {
      return
    }

    if (!detection.drawingTool) {
      lastDrawPointRef.current = null
      return
    }

    const currentPoint = {
      x: detection.drawingTool.x * drawingCanvas.width,
      y: detection.drawingTool.y * drawingCanvas.height,
    }

    if (detection.drawingTool.mode === 'erase') {
      const eraserRadius = Math.max(42, drawingCanvas.width * 0.065)
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(
        currentPoint.x,
        currentPoint.y,
        eraserRadius,
        0,
        Math.PI * 2,
      )
      ctx.fill()
      ctx.restore()
      lastDrawPointRef.current = null
      return
    }

    if (!lastDrawPointRef.current) {
      lastDrawPointRef.current = currentPoint
      return
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(4, drawingCanvas.width * 0.006)
    ctx.strokeStyle = selectedBrush.value
    ctx.shadowColor = selectedBrush.shadow
    ctx.shadowBlur = 18
    ctx.beginPath()
    ctx.moveTo(lastDrawPointRef.current.x, lastDrawPointRef.current.y)
    ctx.lineTo(currentPoint.x, currentPoint.y)
    ctx.stroke()

    lastDrawPointRef.current = currentPoint
  }, [detection.drawingTool, selectedBrush])

  const clearDrawing = () => {
    const drawingCanvas = drawingCanvasRef.current
    const ctx = drawingCanvas?.getContext('2d')

    if (!drawingCanvas || !ctx) {
      return
    }

    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height)
    lastDrawPointRef.current = null
  }

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

        if (!video) {
          return
        }

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

  return (
    <div
      className="camera-layout"
      data-gesture={detection.activeGesture?.id ?? 'idle'}
    >
      <div className="video-panel">
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
        </div>
      </div>

      <aside className="status-panel">
        <div className="result-card">
          <span className="result-label">Detected Count</span>
          <strong className="result-value">
            {detection.fingerCount !== null ? detection.fingerCount : '--'}
          </strong>
          <p className="result-text">
            {detection.fingerCount !== null
              ? `You are holding up ${detection.fingerCount} finger${
                  detection.fingerCount === 1 ? '' : 's'
                } in total.`
              : 'Show one or two hands to see the live finger count.'}
          </p>

          {detection.handCounts.length ? (
            <div className="hand-breakdown" aria-label="Per-hand counts">
              {detection.handCounts.map((hand) => (
                <span key={hand.handedness} className="hand-pill">
                  {hand.handedness}: {hand.count} · {hand.gesture.label}
                </span>
              ))}
            </div>
          ) : null}

          <div className="brush-card" aria-label="Selected brush color">
            <span
              className="brush-swatch"
              style={{ backgroundColor: selectedBrush.value }}
            />
            <span className="brush-text">Selected brush: {selectedBrush.label}</span>
          </div>
        </div>

        <div className="status-card gesture-card">
          <h2>Gesture Action</h2>
          {detection.activeGesture ? (
            <>
              <p className="gesture-headline">
                {detection.activeGesture.label} activates{' '}
                {detection.activeGesture.effect}.
              </p>
              <p>{detection.activeGesture.description}</p>
            </>
          ) : (
            <>
              <p className="gesture-headline">No mapped gesture is active yet.</p>
              <p>
                Try a fist, thumbs up, point, peace sign, shaka, or open palm.
              </p>
            </>
          )}

          <div className="drawing-actions">
            <button className="secondary-button" type="button" onClick={clearDrawing}>
              Clear Drawing
            </button>
          </div>
        </div>

        <div className="status-card">
          <h2>Tracking Status</h2>
          <p>{statusMessage}</p>
        </div>

        <div className="status-card">
          <h2>Tips</h2>
          <ul className="tips-list">
            <li>Keep one or two hands inside the frame.</li>
            <li>Spread your fingers slightly for a more stable count.</li>
            <li>Face a light source if your hand is hard to detect.</li>
            <li>Mapped gestures: fist, thumbs up, point, peace, shaka, open palm.</li>
            <li>Point with your index finger to draw, and show your left open palm to erase.</li>
            <li>Use your right hand with 2 fingers for black, 3 for green, 4 for blue, 5 for pink.</li>
          </ul>
        </div>
      </aside>
    </div>
  )
}

export default CameraView
