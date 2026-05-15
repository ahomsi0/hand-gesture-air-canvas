import { useEffect, useRef, useState } from 'react'
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import { getFingerStates } from '../utils/countRaisedFingers'
import {
  DEFAULT_GESTURE_ACTION,
  type GestureAction,
  getGesturePattern,
  recognizeGestureFromPattern,
} from '../utils/recognizeGesture'
import {
  GestureStateMachine,
  type RawHandInput,
} from '../utils/gestureStateMachine'

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// Higher = more responsive, lower = smoother. 0.72 balances both well.
const DRAW_ALPHA = 0.72

type UseHandDetectionOptions = {
  enabled: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export type HandCount = {
  handedness: string
  count: number
  gesture: GestureAction
  isHandednessStable: boolean
  gestureConfidence: number
  justCommitted: boolean
  thumbsDown: boolean
}

type DetectionState = {
  error: string | null
  fingerCount: number | null
  activeGesture: GestureAction | null
  handCounts: HandCount[]
  drawingTool: { mode: 'draw' | 'erase'; x: number; y: number } | null
  paletteCursor: { x: number; y: number } | null
  statusMessage: string
  gestureConfidence: number
}

function isPointerPose(fingerStates: ReturnType<typeof getFingerStates>) {
  return (
    fingerStates.index &&
    !fingerStates.middle &&
    !fingerStates.ring &&
    !fingerStates.pinky
  )
}

function isOpenPalmPose(fingerStates: ReturnType<typeof getFingerStates>) {
  return Object.values(fingerStates).every(Boolean)
}

function isFistPose(fingerStates: ReturnType<typeof getFingerStates>) {
  return Object.values(fingerStates).every(v => !v)
}

function drawResults(canvas: HTMLCanvasElement, hands: NormalizedLandmark[][]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!hands.length) return
  const drawer = new DrawingUtils(ctx)
  for (const landmarks of hands) {
    drawer.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: 'rgba(139, 92, 246, 0.7)',
      lineWidth: 2,
    })
    drawer.drawLandmarks(landmarks, {
      color: '#f8fafc',
      fillColor: '#1e1b4b',
      lineWidth: 1,
      radius: 3,
    })
  }
}

function syncCanvasToVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
  if (!video.videoWidth || !video.videoHeight) return false
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }
  return true
}

function getStatusMessage(result: HandLandmarkerResult, fingerCount: number | null): string {
  if (!result.landmarks.length) return 'No hand detected — move into frame or improve lighting.'
  if (fingerCount === null) return 'Hand found — hold steady for a moment.'
  return result.landmarks.length === 1 ? 'Tracking 1 hand.' : 'Tracking 2 hands.'
}

function useHandDetection({ enabled, videoRef, canvasRef }: UseHandDetectionOptions): DetectionState {
  const [fingerCount, setFingerCount] = useState<number | null>(null)
  const [handCounts, setHandCounts] = useState<HandCount[]>([])
  const [activeGesture, setActiveGesture] = useState<GestureAction | null>(null)
  const [drawingTool, setDrawingTool] = useState<DetectionState['drawingTool']>(null)
  const [paletteCursor, setPaletteCursor] = useState<DetectionState['paletteCursor']>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('Waiting for camera...')
  const [gestureConfidence, setGestureConfidence] = useState(0)

  const stateMachineRef = useRef(new GestureStateMachine())
  const smoothedDrawRef = useRef<{ x: number; y: number; mode: 'draw' | 'erase' } | null>(null)

  useEffect(() => {
    if (!enabled) return

    let active = true
    let frameId = 0
    let lastVideoTime = -1
    let handLandmarker: HandLandmarker | null = null

    const runDetection = async () => {
      try {
        setError(null)
        setStatusMessage('Loading hand detection model...')
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        if (!active) return

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        })
        if (!active) return

        setStatusMessage('Ready — show a hand to begin.')

        const processFrame = () => {
          if (!active) return

          const video = videoRef.current
          const canvas = canvasRef.current
          if (!video || !canvas) { frameId = requestAnimationFrame(processFrame); return }
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) { frameId = requestAnimationFrame(processFrame); return }
          if (!syncCanvasToVideo(video, canvas)) { frameId = requestAnimationFrame(processFrame); return }
          if (video.currentTime === lastVideoTime) { frameId = requestAnimationFrame(processFrame); return }
          lastVideoTime = video.currentTime

          const result = handLandmarker?.detectForVideo(video, performance.now())
          drawResults(canvas, result?.landmarks ?? [])

          if (!result) {
            setFingerCount(null); setHandCounts([]); setActiveGesture(null)
            setDrawingTool(null); setPaletteCursor(null); setGestureConfidence(0)
            smoothedDrawRef.current = null
            setStatusMessage('Model warming up — keep hand in view.')
            frameId = requestAnimationFrame(processFrame)
            return
          }

          const perHand = result.landmarks.map((landmarks, index) => {
            const rawHandedness = result.handedness[index]?.[0]?.categoryName ?? `Hand ${index + 1}`
            const fingerStates = getFingerStates(landmarks, rawHandedness)
            return { landmarks, index, rawHandedness, fingerStates }
          })

          const rawInputs: RawHandInput[] = perHand.map(({ index, rawHandedness, fingerStates }) => ({
            index,
            pattern: getGesturePattern(fingerStates),
            rawHandedness,
          }))

          const { stabilized, overallConfidence } = stateMachineRef.current.process(rawInputs)

          // Drawing modes — all use RAW finger states (bypass debounce) for frame accuracy:
          //   any hand pointing  → draw
          //   left fist          → erase  (palm is free; right fist = undo via gesture system)
          //   right open palm    → palette cursor (used for toggle detection in CameraView)
          let nextDrawingTool: DetectionState['drawingTool'] = null
          let nextPaletteCursor: DetectionState['paletteCursor'] = null

          const nextHandCounts: HandCount[] = perHand
            .map(({ landmarks, index, rawHandedness, fingerStates }) => {
              const stab = stabilized.find((s) => s.index === index)
              const confirmedHandedness = stab?.confirmedHandedness ?? rawHandedness
              const gesture = recognizeGestureFromPattern(stab?.pattern ?? getGesturePattern(fingerStates))

              if (!nextDrawingTool && !nextPaletteCursor && isPointerPose(fingerStates)) {
                nextDrawingTool = { mode: 'draw', x: landmarks[8].x, y: landmarks[8].y }
              } else if (!nextDrawingTool && !nextPaletteCursor && confirmedHandedness === 'Left' && isOpenPalmPose(fingerStates)) {
                nextDrawingTool = { mode: 'erase', x: landmarks[9].x, y: landmarks[9].y }
              } else if (!nextPaletteCursor && !nextDrawingTool && confirmedHandedness === 'Right' && isOpenPalmPose(fingerStates)) {
                nextPaletteCursor = { x: landmarks[9].x, y: landmarks[9].y }
              }

              // Thumbs-down: only thumb raised AND tip is below wrist in image space
              const onlyThumb = fingerStates.thumb &&
                !fingerStates.index && !fingerStates.middle &&
                !fingerStates.ring && !fingerStates.pinky
              const thumbsDown = onlyThumb && landmarks[4].y > landmarks[0].y

              return {
                handedness: confirmedHandedness,
                count: Object.values(fingerStates).filter(Boolean).length,
                gesture,
                isHandednessStable: stab?.isHandednessStable ?? false,
                gestureConfidence: stab?.gestureConfidence ?? 0,
                justCommitted: stab?.justCommitted ?? false,
                thumbsDown,
              }
            })
            .sort((a, b) => a.handedness.localeCompare(b.handedness))

          // EMA smoothing on drawing coordinates only
          if (nextDrawingTool) {
            const prev = smoothedDrawRef.current
            if (prev && prev.mode === nextDrawingTool.mode) {
              nextDrawingTool = {
                ...nextDrawingTool,
                x: DRAW_ALPHA * nextDrawingTool.x + (1 - DRAW_ALPHA) * prev.x,
                y: DRAW_ALPHA * nextDrawingTool.y + (1 - DRAW_ALPHA) * prev.y,
              }
            }
            smoothedDrawRef.current = { ...nextDrawingTool }
          } else {
            smoothedDrawRef.current = null
          }

          const count = nextHandCounts.length
            ? nextHandCounts.reduce((total, h) => total + h.count, 0)
            : null

          setFingerCount(count)
          setHandCounts(nextHandCounts)
          setGestureConfidence(overallConfidence)
          setActiveGesture(
            nextHandCounts.find((h) => h.gesture.id !== DEFAULT_GESTURE_ACTION.id)?.gesture ?? null,
          )
          setDrawingTool(nextDrawingTool)
          setPaletteCursor(nextPaletteCursor)
          setStatusMessage(getStatusMessage(result, count))

          frameId = requestAnimationFrame(processFrame)
        }

        frameId = requestAnimationFrame(processFrame)
      } catch {
        if (!active) return
        setError('Hand detection failed — reload and allow webcam access.')
        setStatusMessage('Unable to initialize hand tracking.')
      }
    }

    void runDetection()

    return () => {
      active = false
      cancelAnimationFrame(frameId)
      handLandmarker?.close()
      stateMachineRef.current.reset()
      smoothedDrawRef.current = null
    }
  }, [canvasRef, enabled, videoRef])

  return { error, fingerCount, activeGesture, handCounts, drawingTool, paletteCursor, statusMessage, gestureConfidence }
}

export default useHandDetection
