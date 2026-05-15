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
  beauty: boolean
}

export type SceneInsights = {
  blinkCount: number
  eyeDirection: string | null
  peopleCount: number | null
  smileDetected: boolean | null
  gender: 'Male' | 'Female' | null
  beautyScore: number | null
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
// Uses multiple facial proportions as heuristics — not a real classifier.
// For entertainment/demo purposes only.
function estimateGender(landmarks: NormalizedLandmark[]): 'Male' | 'Female' | null {
  if (landmarks.length < 468) return null

  // Core measurements
  const faceWidth  = Math.abs(landmarks[454].x - landmarks[234].x) // cheekbone span
  const faceHeight = Math.abs(landmarks[152].y - landmarks[10].y)  // chin to crown
  if (faceWidth < 0.01 || faceHeight < 0.01) return null

  // Jaw width — lower jaw corners (more squared = masculine)
  const jawWidth = Math.abs(landmarks[397].x - landmarks[172].x)

  // Nose width — alar base (wider = masculine)
  const noseWidth = Math.abs(landmarks[358].x - landmarks[129].x)

  // Chin width — narrow tapered chin = feminine, wide flat chin = masculine
  const chinWidth = Math.abs(landmarks[394].x - landmarks[169].x)

  // Brow-to-eye distance — closer brow ridge = masculine
  const leftBrowY  = (landmarks[70].y  + landmarks[63].y)  / 2   // left brow mid
  const leftEyeY   = (landmarks[159].y + landmarks[145].y) / 2   // left eye mid
  const rightBrowY = (landmarks[300].y + landmarks[293].y) / 2
  const rightEyeY  = (landmarks[386].y + landmarks[374].y) / 2
  const browEyeGap = ((Math.abs(leftEyeY - leftBrowY) + Math.abs(rightEyeY - rightBrowY)) / 2) / faceHeight

  // Derived ratios
  const jawRatio   = jawWidth  / faceWidth   // higher → masculine
  const noseRatio  = noseWidth / faceWidth   // higher → masculine
  const chinRatio  = chinWidth / faceWidth   // higher → masculine
  const aspect     = faceHeight / faceWidth  // higher → feminine (taller/narrower face)

  // Weighted score — positive = masculine, negative = feminine
  // Thresholds tuned to average population midpoints
  let score = 0
  score += (jawRatio  - 0.68) * 14   // jaw squareness is the strongest signal
  score += (noseRatio - 0.22) * 10   // nose breadth
  score += (chinRatio - 0.38) * 8    // chin breadth
  score -= (aspect    - 1.45) * 6    // face height/width (oval = feminine)
  score -= (browEyeGap - 0.085) * 12 // small brow-eye gap = masculine brow ridge

  return score > 0 ? 'Male' : 'Female'
}

// Estimates a beauty score 1–10 using facial symmetry and golden-ratio proportions.
// Heuristic only — for entertainment/demo purposes.
function estimateBeauty(landmarks: NormalizedLandmark[]): number | null {
  if (landmarks.length < 468) return null

  const faceWidth = Math.abs(landmarks[454].x - landmarks[234].x)
  const faceHeight = Math.abs(landmarks[152].y - landmarks[10].y)
  if (faceWidth < 0.01 || faceHeight < 0.01) return null

  const faceCenterX = (landmarks[454].x + landmarks[234].x) / 2

  // Eye geometry
  const reOuterX = landmarks[33].x
  const reInnerX = landmarks[133].x
  const leInnerX = landmarks[362].x
  const leOuterX = landmarks[263].x
  const rightEyeWidth = Math.abs(reOuterX - reInnerX)
  const leftEyeWidth = Math.abs(leOuterX - leInnerX)
  const rightEyeCenterX = (reOuterX + reInnerX) / 2
  const leftEyeCenterX = (leOuterX + leInnerX) / 2

  // Symmetry scores
  const eyeWidthSym = 1 - Math.abs(rightEyeWidth - leftEyeWidth) / (Math.max(rightEyeWidth, leftEyeWidth, 0.001))
  const rightFromCenter = Math.abs(rightEyeCenterX - faceCenterX)
  const leftFromCenter = Math.abs(leftEyeCenterX - faceCenterX)
  const eyePosSym = 1 - Math.abs(rightFromCenter - leftFromCenter) / faceWidth
  const mouthLeftX = landmarks[61].x
  const mouthRightX = landmarks[291].x
  const mouthSym = 1 - Math.abs(Math.abs(mouthLeftX - faceCenterX) - Math.abs(mouthRightX - faceCenterX)) / faceWidth
  const symmetryScore = eyeWidthSym * 0.4 + eyePosSym * 0.4 + mouthSym * 0.2

  // Proportion scores (golden ratio targets)
  const aspectScore = 1 - Math.min(Math.abs(faceHeight / faceWidth - 1.618) / 1.0, 1)
  const totalEyeWidth = rightEyeWidth + leftEyeWidth
  const eyeRatioScore = 1 - Math.min(Math.abs(totalEyeWidth / faceWidth - 0.38) / 0.2, 1)
  const ipd = Math.abs(rightEyeCenterX - leftEyeCenterX)
  const ipdScore = 1 - Math.min(Math.abs(ipd / faceWidth - 0.46) / 0.2, 1)
  const mouthWidth = Math.abs(mouthRightX - mouthLeftX)
  const mouthRatioScore = 1 - Math.min(Math.abs(mouthWidth / faceWidth - 0.44) / 0.2, 1)

  // Eye openness (larger = more prominent)
  const rightEyeH = Math.abs(landmarks[159].y - landmarks[145].y)
  const leftEyeH = Math.abs(landmarks[386].y - landmarks[374].y)
  const eyeOpenScore = Math.min(((rightEyeH + leftEyeH) / 2) / faceHeight / 0.04, 1)

  const proportionScore = aspectScore * 0.25 + eyeRatioScore * 0.2 + ipdScore * 0.2 + eyeOpenScore * 0.2 + mouthRatioScore * 0.15
  const raw = symmetryScore * 0.5 + proportionScore * 0.5
  return Math.round((1 + raw * 9) * 10) / 10
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
    toggles.gender ||
    toggles.beauty

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
  const [beautyScore, setBeautyScore] = useState<number | null>(null)
  const [status, setStatus] = useState('Extra scene analysis is turned off.')

  useEffect(() => {
    const anyOn =
      toggles.people ||
      toggles.eyeDirection ||
      toggles.smile ||
      toggles.blinkCounter ||
      toggles.gender ||
      toggles.beauty

    if (!enabled || !anyOn) {
      const frameId = window.requestAnimationFrame(() => {
        setBlinkCount(0)
        setPeopleCount(null)
        setEyeDirection(null)
        setSmileDetected(null)
        setGender(null)
        setBeautyScore(null)
        setStatus('Extra scene analysis is turned off.')
      })
      return () => window.cancelAnimationFrame(frameId)
    }

    let active = true
    let frameId = 0
    let lastVideoTime = -1
    let blinkArmed = true
    let smoothedBeauty: number | null = null
    // Gender hysteresis: only commit after GENDER_LOCK consecutive matching frames
    const GENDER_LOCK = 50
    let genderCandidate: { label: 'Male' | 'Female' | null; frames: number } = { label: null, frames: 0 }
    let lockedGender: 'Male' | 'Female' | null = null
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
          let nextGender: 'Male' | 'Female' | null = null
          if (toggles.gender && detectedFaces && primaryLandmarks) {
            const raw = estimateGender(primaryLandmarks)
            if (raw === genderCandidate.label) {
              genderCandidate.frames++
              if (genderCandidate.frames >= GENDER_LOCK) lockedGender = raw
            } else {
              genderCandidate = { label: raw, frames: 1 }
            }
            nextGender = lockedGender
          } else {
            genderCandidate = { label: null, frames: 0 }
            lockedGender = null
          }

          let nextBeauty: number | null = null
          if (toggles.beauty && detectedFaces && primaryLandmarks) {
            const raw = estimateBeauty(primaryLandmarks)
            if (raw !== null) {
              smoothedBeauty = smoothedBeauty === null ? raw : 0.08 * raw + 0.92 * smoothedBeauty
              nextBeauty = Math.round(smoothedBeauty * 10) / 10
            }
          } else {
            smoothedBeauty = null
          }

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
          setBeautyScore(nextBeauty)
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
        setBeautyScore(null)
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

  return { blinkCount, eyeDirection, peopleCount, smileDetected, gender, beautyScore, status }
}

export default useSceneInsights
