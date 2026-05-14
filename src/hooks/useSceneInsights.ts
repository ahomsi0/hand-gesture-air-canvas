import { useEffect, useState } from 'react'
import {
  FaceLandmarker,
  FilesetResolver,
  type Category,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export type SceneToggleState = {
  eyeDirection: boolean
  blinkCounter: boolean
  people: boolean
  smile: boolean
  gender: boolean
}

export type SceneInsights = {
  blinkCount: number
  eyeDirection: string | null
  peopleCount: number | null
  smileDetected: boolean | null
  gender: 'Male' | 'Female' | null
  status: string
}

type UseSceneInsightsOptions = {
  enabled: boolean
  toggles: SceneToggleState
  videoRef: React.RefObject<HTMLVideoElement | null>
}

function getTopBlendshapeScore(
  categories: Category[] | undefined,
  targets: string[],
) {
  if (!categories?.length) return 0
  return categories
    .filter((c) => targets.includes(c.categoryName))
    .reduce((max, c) => Math.max(max, c.score), 0)
}

function getEyeDirectionLabel(categories: Category[] | undefined) {
  if (!categories?.length) return null

  const lookLeft = Math.max(
    getTopBlendshapeScore(categories, ['eyeLookOutLeft', 'eyeLookInRight']),
    getTopBlendshapeScore(categories, ['eyeLookUpLeft', 'eyeLookUpRight']) * 0.35,
  )
  const lookRight = Math.max(
    getTopBlendshapeScore(categories, ['eyeLookInLeft', 'eyeLookOutRight']),
    getTopBlendshapeScore(categories, ['eyeLookDownLeft', 'eyeLookDownRight']) * 0.35,
  )
  const lookUp = getTopBlendshapeScore(categories, ['eyeLookUpLeft', 'eyeLookUpRight'])
  const lookDown = getTopBlendshapeScore(categories, ['eyeLookDownLeft', 'eyeLookDownRight'])

  const strongest = Math.max(lookLeft, lookRight, lookUp, lookDown)
  if (strongest < 0.2) return 'Center'
  if (strongest === lookLeft) return 'Left'
  if (strongest === lookRight) return 'Right'
  if (strongest === lookUp) return 'Up'
  return 'Down'
}

function isSmiling(categories: Category[] | undefined) {
  if (!categories?.length) return null
  const smileScore = Math.max(
    getTopBlendshapeScore(categories, ['mouthSmileLeft']),
    getTopBlendshapeScore(categories, ['mouthSmileRight']),
  )
  return smileScore > 0.45
}

function getBlinkSignal(categories: Category[] | undefined) {
  if (!categories?.length) return 0
  const leftBlink = getTopBlendshapeScore(categories, ['eyeBlinkLeft'])
  const rightBlink = getTopBlendshapeScore(categories, ['eyeBlinkRight'])
  return (leftBlink + rightBlink) / 2
}

// Estimates perceived gender from face landmark geometry.
// Uses jaw-to-face width ratio and face proportions as rough heuristics.
// Not accurate — for entertainment/demo purposes only.
function estimateGender(landmarks: NormalizedLandmark[]): 'Male' | 'Female' | null {
  if (landmarks.length < 468) return null

  const faceWidth = Math.abs(landmarks[454].x - landmarks[234].x)
  const faceHeight = Math.abs(landmarks[152].y - landmarks[10].y)
  const jawWidth = Math.abs(landmarks[397].x - landmarks[172].x)
  const lowerFace = Math.abs(landmarks[152].y - landmarks[4].y)

  if (faceWidth < 0.01 || faceHeight < 0.01) return null

  const jawToFaceRatio = jawWidth / faceWidth
  const aspectRatio = faceHeight / faceWidth
  const lowerFaceRatio = lowerFace / faceHeight

  // Positive = male leaning, negative = female leaning
  let score = 0
  score += (jawToFaceRatio - 0.70) * 12
  score += (lowerFaceRatio - 0.36) * 8
  score -= (aspectRatio - 1.25) * 3

  return score > 0 ? 'Male' : 'Female'
}

function getStatusMessage(
  toggles: SceneToggleState,
  peopleCount: number | null,
  eyeDirection: string | null,
  smileDetected: boolean | null,
) {
  const anyOn =
    toggles.people ||
    toggles.eyeDirection ||
    toggles.smile ||
    toggles.blinkCounter ||
    toggles.gender

  if (!anyOn) return 'Extra scene analysis is turned off.'
  if (toggles.people && peopleCount === null) return 'Scanning the frame for faces and people.'
  if (toggles.eyeDirection && eyeDirection === null) return 'Face found. Waiting for eye direction confidence.'
  if (toggles.smile && smileDetected === null) return 'Face found. Waiting for smile confidence.'
  return 'Scene analysis is active.'
}

function useSceneInsights({
  enabled,
  toggles,
  videoRef,
}: UseSceneInsightsOptions): SceneInsights {
  const [blinkCount, setBlinkCount] = useState(0)
  const [peopleCount, setPeopleCount] = useState<number | null>(null)
  const [eyeDirection, setEyeDirection] = useState<string | null>(null)
  const [smileDetected, setSmileDetected] = useState<boolean | null>(null)
  const [gender, setGender] = useState<'Male' | 'Female' | null>(null)
  const [status, setStatus] = useState('Extra scene analysis is turned off.')

  useEffect(() => {
    const anyOn =
      toggles.people ||
      toggles.eyeDirection ||
      toggles.smile ||
      toggles.blinkCounter ||
      toggles.gender

    if (!enabled || !anyOn) {
      const frameId = window.requestAnimationFrame(() => {
        setBlinkCount(0)
        setPeopleCount(null)
        setEyeDirection(null)
        setSmileDetected(null)
        setGender(null)
        setStatus('Extra scene analysis is turned off.')
      })
      return () => window.cancelAnimationFrame(frameId)
    }

    let active = true
    let frameId = 0
    let lastVideoTime = -1
    let blinkArmed = true
    let faceLandmarker: FaceLandmarker | null = null

    const runAnalysis = async () => {
      try {
        setStatus('Loading face analysis...')
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        if (!active) return

        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL },
          runningMode: 'VIDEO',
          numFaces: 4,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes:
            toggles.eyeDirection || toggles.smile || toggles.blinkCounter,
        })

        const processFrame = () => {
          if (!active) return

          const video = videoRef.current
          if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            frameId = requestAnimationFrame(processFrame)
            return
          }
          if (video.currentTime === lastVideoTime) {
            frameId = requestAnimationFrame(processFrame)
            return
          }
          lastVideoTime = video.currentTime

          const result = faceLandmarker?.detectForVideo(video, performance.now())
          const detectedFaces = result?.faceLandmarks.length ?? 0
          const primaryBlendshapes = result?.faceBlendshapes[0]?.categories
          const primaryLandmarks = result?.faceLandmarks[0]

          const nextPeopleCount = toggles.people ? detectedFaces : null
          const nextEyeDirection =
            toggles.eyeDirection && detectedFaces
              ? getEyeDirectionLabel(primaryBlendshapes)
              : null
          const nextSmileDetected =
            toggles.smile && detectedFaces ? isSmiling(primaryBlendshapes) : null
          const nextGender =
            toggles.gender && detectedFaces && primaryLandmarks
              ? estimateGender(primaryLandmarks)
              : null

          if (toggles.blinkCounter && detectedFaces) {
            const blinkSignal = getBlinkSignal(primaryBlendshapes)
            if (blinkSignal > 0.55 && blinkArmed) {
              blinkArmed = false
              setBlinkCount((c) => c + 1)
            } else if (blinkSignal < 0.3) {
              blinkArmed = true
            }
          } else {
            blinkArmed = true
          }

          setPeopleCount(nextPeopleCount)
          setEyeDirection(nextEyeDirection)
          setSmileDetected(nextSmileDetected)
          setGender(nextGender)
          setStatus(
            getStatusMessage(toggles, nextPeopleCount, nextEyeDirection, nextSmileDetected),
          )

          frameId = requestAnimationFrame(processFrame)
        }

        frameId = requestAnimationFrame(processFrame)
      } catch {
        if (!active) return
        setBlinkCount(0)
        setPeopleCount(null)
        setEyeDirection(null)
        setSmileDetected(null)
        setGender(null)
        setStatus('Scene analysis could not be started in this browser session.')
      }
    }

    void runAnalysis()

    return () => {
      active = false
      cancelAnimationFrame(frameId)
      faceLandmarker?.close()
    }
  }, [enabled, toggles, videoRef])

  return { blinkCount, eyeDirection, peopleCount, smileDetected, gender, status }
}

export default useSceneInsights
