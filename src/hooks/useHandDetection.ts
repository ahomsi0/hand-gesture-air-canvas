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
}

type DetectionState = {
  error: string | null
  fingerCount: number | null
  activeGesture: GestureAction | null
  handCounts: HandCount[]
  drawingTool: {
    mode: 'draw' | 'erase'
    x: number
    y: number
  } | null
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

function drawResults(
  canvas: HTMLCanvasElement,
  hands: NormalizedLandmark[][],
) {
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  if (!hands.length) {
    return
  }

  const drawer = new DrawingUtils(ctx)

  for (const landmarks of hands) {
    drawer.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: '#8b5cf6',
      lineWidth: 4,
    })
    drawer.drawLandmarks(landmarks, {
      color: '#f8fafc',
      fillColor: '#0f172a',
      lineWidth: 2,
      radius: 4,
    })
  }
}

function syncCanvasToVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): boolean {
  if (!video.videoWidth || !video.videoHeight) {
    return false
  }

  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }

  return true
}

function getStatusMessage(
  result: HandLandmarkerResult,
  fingerCount: number | null,
): string {
  if (!result.landmarks.length) {
    return 'No hand detected. Move your hand into frame or improve the lighting.'
  }

  if (fingerCount === null) {
    return 'Hand found, but the pose is not clear enough yet. Hold steady for a moment.'
  }

  return result.landmarks.length === 1
    ? 'One hand detected successfully. The finger count is updating in real time.'
    : 'Two hands detected successfully. The total finger count is updating in real time.'
}

function useHandDetection({
  enabled,
  videoRef,
  canvasRef,
}: UseHandDetectionOptions): DetectionState {
  const [fingerCount, setFingerCount] = useState<number | null>(null)
  const [handCounts, setHandCounts] = useState<HandCount[]>([])
  const [activeGesture, setActiveGesture] = useState<GestureAction | null>(null)
  const [drawingTool, setDrawingTool] = useState<{
    mode: 'draw' | 'erase'
    x: number
    y: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState(
    'Waiting for the camera feed...',
  )
  const [gestureConfidence, setGestureConfidence] = useState(0)

  const stateMachineRef = useRef(new GestureStateMachine())

  useEffect(() => {
    if (!enabled) {
      return
    }

    let active = true
    let frameId = 0
    let lastVideoTime = -1
    let handLandmarker: HandLandmarker | null = null

    const runDetection = async () => {
      try {
        setError(null)
        setStatusMessage('Loading hand detection model...')

        const vision = await FilesetResolver.forVisionTasks(WASM_URL)

        if (!active) {
          return
        }

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
          },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        })

        if (!active) {
          return
        }

        setStatusMessage('Camera ready. Show one hand to begin tracking.')

        const processFrame = () => {
          if (!active) {
            return
          }

          const video = videoRef.current
          const canvas = canvasRef.current

          if (!video || !canvas) {
            frameId = requestAnimationFrame(processFrame)
            return
          }

          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            frameId = requestAnimationFrame(processFrame)
            return
          }

          if (!syncCanvasToVideo(video, canvas)) {
            frameId = requestAnimationFrame(processFrame)
            return
          }

          if (video.currentTime === lastVideoTime) {
            frameId = requestAnimationFrame(processFrame)
            return
          }

          lastVideoTime = video.currentTime

          const result = handLandmarker?.detectForVideo(video, performance.now())
          const hands = result?.landmarks ?? []
          drawResults(canvas, hands)

          if (!result) {
            setFingerCount(null)
            setHandCounts([])
            setActiveGesture(null)
            setDrawingTool(null)
            setGestureConfidence(0)
            setStatusMessage('The model is warming up. Keep your hand in view.')
            frameId = requestAnimationFrame(processFrame)
            return
          }

          // Compute per-hand finger states once — reused for state machine and drawing tool
          const perHand = result.landmarks.map((landmarks, index) => {
            const rawHandedness =
              result.handedness[index]?.[0]?.categoryName ?? `Hand ${index + 1}`
            const fingerStates = getFingerStates(landmarks, rawHandedness)
            return { landmarks, index, rawHandedness, fingerStates }
          })

          const rawInputs: RawHandInput[] = perHand.map(
            ({ index, rawHandedness, fingerStates }) => ({
              index,
              pattern: getGesturePattern(fingerStates),
              rawHandedness,
            }),
          )

          const { stabilized, overallConfidence } =
            stateMachineRef.current.process(rawInputs)

          // Drawing tool uses RAW finger states — bypass debounce for frame accuracy
          let nextDrawingTool: DetectionState['drawingTool'] = null

          const nextHandCounts: HandCount[] = perHand
            .map(({ landmarks, index, rawHandedness, fingerStates }) => {
              const stab = stabilized.find((s) => s.index === index)
              const confirmedHandedness =
                stab?.confirmedHandedness ?? rawHandedness
              const gesture = recognizeGestureFromPattern(
                stab?.pattern ?? getGesturePattern(fingerStates),
              )

              if (!nextDrawingTool && isPointerPose(fingerStates)) {
                const indexTip = landmarks[8]
                nextDrawingTool = {
                  mode: 'draw',
                  x: indexTip.x,
                  y: indexTip.y,
                }
              } else if (
                !nextDrawingTool &&
                confirmedHandedness === 'Left' &&
                isOpenPalmPose(fingerStates)
              ) {
                const anchor = landmarks[5]
                nextDrawingTool = {
                  mode: 'erase',
                  x: anchor.x,
                  y: anchor.y,
                }
              }

              return {
                handedness: confirmedHandedness,
                count: Object.values(fingerStates).filter(Boolean).length,
                gesture,
                isHandednessStable: stab?.isHandednessStable ?? false,
                gestureConfidence: stab?.gestureConfidence ?? 0,
                justCommitted: stab?.justCommitted ?? false,
              }
            })
            .sort((a, b) => a.handedness.localeCompare(b.handedness))

          const count = nextHandCounts.length
            ? nextHandCounts.reduce((total, hand) => total + hand.count, 0)
            : null

          setFingerCount(count)
          setHandCounts(nextHandCounts)
          setGestureConfidence(overallConfidence)
          setActiveGesture(
            nextHandCounts.find(
              (hand) => hand.gesture.id !== DEFAULT_GESTURE_ACTION.id,
            )?.gesture ?? null,
          )
          setDrawingTool(nextDrawingTool)
          setStatusMessage(getStatusMessage(result, count))

          frameId = requestAnimationFrame(processFrame)
        }

        frameId = requestAnimationFrame(processFrame)
      } catch {
        if (!active) {
          return
        }

        setError(
          'Hand detection failed to start. Reload the page and confirm your browser supports webcam access.',
        )
        setStatusMessage('Unable to initialize hand tracking.')
      }
    }

    void runDetection()

    return () => {
      active = false
      cancelAnimationFrame(frameId)
      handLandmarker?.close()
      stateMachineRef.current.reset()
    }
  }, [canvasRef, enabled, videoRef])

  return {
    error,
    fingerCount,
    activeGesture,
    handCounts,
    drawingTool,
    statusMessage,
    gestureConfidence,
  }
}

export default useHandDetection
