import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const THUMB_TIP = 4
const THUMB_MCP = 2
const WRIST = 0
const INDEX_MCP = 5
const INDEX_TIP = 8
const INDEX_PIP = 6
const MIDDLE_MCP = 9
const MIDDLE_TIP = 12
const MIDDLE_PIP = 10
const RING_MCP = 13
const RING_TIP = 16
const RING_PIP = 14
const PINKY_MCP = 17
const PINKY_TIP = 20
const PINKY_PIP = 18

const FINGER_PAIRS = [
  [INDEX_TIP, INDEX_PIP, INDEX_MCP],
  [MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP],
  [RING_TIP, RING_PIP, RING_MCP],
  [PINKY_TIP, PINKY_PIP, PINKY_MCP],
] as const

export type Handedness = 'Left' | 'Right'

export type FingerStates = {
  thumb: boolean
  index: boolean
  middle: boolean
  ring: boolean
  pinky: boolean
}

function getDistance(
  first: NormalizedLandmark,
  second: NormalizedLandmark,
) {
  const deltaX = first.x - second.x
  const deltaY = first.y - second.y

  return Math.hypot(deltaX, deltaY)
}

function isVerticalFingerRaised(
  landmarks: NormalizedLandmark[],
  tipIndex: number,
  pipIndex: number,
  mcpIndex: number,
) {
  const tip = landmarks[tipIndex]
  const pip = landmarks[pipIndex]
  const mcp = landmarks[mcpIndex]

  // A truly extended finger should rise progressively from MCP to PIP to tip.
  // This helps prevent curled fingers in a fist or thumbs-up from being
  // mistaken as "up" just because the tip happens to sit above the PIP point.
  return tip.y < pip.y && pip.y < mcp.y
}

function isThumbRaised(
  landmarks: NormalizedLandmark[],
  handedness: Handedness,
) {
  const thumbTip = landmarks[THUMB_TIP]
  const thumbMcp = landmarks[THUMB_MCP]

  // The thumb bends sideways rather than vertically, so we compare x values.
  // Using the MCP joint is more stable than the IP joint for "thumb out"
  // detection, and the direction depends on whether MediaPipe classified the
  // hand as left or right.
  return handedness === 'Right'
    ? thumbTip.x > thumbMcp.x
    : thumbTip.x < thumbMcp.x
}

export function getFingerStates(
  landmarks: NormalizedLandmark[],
  handednessLabel: string,
) {
  const handedness: Handedness =
    handednessLabel === 'Left' ? 'Left' : 'Right'

  const fingerStates: FingerStates = {
    thumb: isThumbRaised(landmarks, handedness),
    index: false,
    middle: false,
    ring: false,
    pinky: false,
  }

  for (const [fingerName, [tipIndex, pipIndex, mcpIndex]] of [
    ['index', FINGER_PAIRS[0]],
    ['middle', FINGER_PAIRS[1]],
    ['ring', FINGER_PAIRS[2]],
    ['pinky', FINGER_PAIRS[3]],
  ] as const) {
    // For the four upright fingers, a fingertip above the PIP joint means the
    // finger is considered raised only if the whole finger chain is extended.
    fingerStates[fingerName] = isVerticalFingerRaised(
      landmarks,
      tipIndex,
      pipIndex,
      mcpIndex,
    )
  }

  return fingerStates
}

export function countRaisedFingers(
  landmarks: NormalizedLandmark[],
  handednessLabel: string,
) {
  const fingerStates = getFingerStates(landmarks, handednessLabel)

  return Object.values(fingerStates).filter(Boolean).length
}

export function isClosedFist(
  landmarks: NormalizedLandmark[],
  fingerStates: FingerStates,
) {
  const foldedStraightFingers =
    !fingerStates.index &&
    !fingerStates.middle &&
    !fingerStates.ring &&
    !fingerStates.pinky

  if (!foldedStraightFingers) {
    return false
  }

  const thumbTip = landmarks[THUMB_TIP]
  const wrist = landmarks[WRIST]
  const indexMcp = landmarks[INDEX_MCP]

  // The thumb detector can be noisy on mirrored/selfie input, especially for a
  // tight fist. Treat the hand as a fist when the four upright fingers are
  // folded and the thumb tip stays tucked near the palm.
  return (
    getDistance(thumbTip, indexMcp) < 0.18 &&
    getDistance(thumbTip, wrist) < 0.32
  )
}
