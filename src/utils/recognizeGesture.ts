import type { FingerStates } from './countRaisedFingers'

export type GestureAction = {
  id: string
  label: string
  effect: string
  description: string
  pattern: string
  category: 'color' | 'tool' | 'canvas' | 'effect'
}

const GESTURE_LIBRARY: Record<string, GestureAction> = {
  '00000': {
    id: 'fist',
    label: 'Fist',
    effect: 'Undo',
    description: 'Undoes the last drawn stroke.',
    pattern: '00000',
    category: 'canvas',
  },
  '10000': {
    id: 'thumbs-up',
    label: 'Thumbs Up',
    effect: 'Brush Size Up',
    description: 'Increases the active brush size by one step.',
    pattern: '10000',
    category: 'canvas',
  },
  '01000': {
    id: 'point',
    label: 'Point',
    effect: 'Pointer Mode',
    description: 'Sharpens the stage with an amber directional highlight.',
    pattern: '01000',
    category: 'tool',
  },
  '01100': {
    id: 'peace',
    label: 'Peace',
    effect: 'Focus Mode',
    description: 'Switches the app into a cool cyan focus scene.',
    pattern: '01100',
    category: 'effect',
  },
  '10001': {
    id: 'shaka',
    label: 'Shaka',
    effect: 'Chill Wave',
    description: 'Applies a warm sunset gradient with relaxed motion.',
    pattern: '10001',
    category: 'effect',
  },
  '11111': {
    id: 'open-palm',
    label: 'Open Palm',
    effect: 'Aurora Burst',
    description: 'Expands the background into a bright multi-color glow.',
    pattern: '11111',
    category: 'tool',
  },
  '00001': {
    id: 'pinky',
    label: 'Pinky',
    effect: 'Brush Size Down',
    description: 'Decreases the active brush size by one step.',
    pattern: '00001',
    category: 'canvas',
  },
}

export const DEFAULT_GESTURE_ACTION: GestureAction = {
  id: 'unknown',
  label: 'Unmapped',
  effect: 'Explorer Mode',
  description:
    'The hand is visible, but this pose is not mapped to a special action yet.',
  pattern: '',
  category: 'effect',
}

export function getGesturePattern(fingerStates: FingerStates) {
  return [
    fingerStates.thumb,
    fingerStates.index,
    fingerStates.middle,
    fingerStates.ring,
    fingerStates.pinky,
  ]
    .map((isUp) => (isUp ? '1' : '0'))
    .join('')
}

export function recognizeGesture(fingerStates: FingerStates): GestureAction {
  const pattern = getGesturePattern(fingerStates)
  return GESTURE_LIBRARY[pattern] ?? { ...DEFAULT_GESTURE_ACTION, pattern }
}

export function recognizeGestureFromPattern(pattern: string): GestureAction {
  return GESTURE_LIBRARY[pattern] ?? { ...DEFAULT_GESTURE_ACTION, pattern }
}
