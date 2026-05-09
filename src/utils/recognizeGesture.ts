import type { FingerStates } from './countRaisedFingers'

export type GestureAction = {
  id: string
  label: string
  effect: string
  description: string
  pattern: string
}

const GESTURE_LIBRARY: Record<string, GestureAction> = {
  '00000': {
    id: 'fist',
    label: 'Fist',
    effect: 'Reset Pulse',
    description: 'Drops the interface back to a steady neutral pulse.',
    pattern: '00000',
  },
  '10000': {
    id: 'thumbs-up',
    label: 'Thumbs Up',
    effect: 'Victory Glow',
    description: 'Turns the experience into a confident green success state.',
    pattern: '10000',
  },
  '01000': {
    id: 'point',
    label: 'Point',
    effect: 'Pointer Mode',
    description: 'Sharpens the stage with an amber directional highlight.',
    pattern: '01000',
  },
  '01100': {
    id: 'peace',
    label: 'Peace',
    effect: 'Focus Mode',
    description: 'Switches the app into a cool cyan focus scene.',
    pattern: '01100',
  },
  '10001': {
    id: 'shaka',
    label: 'Shaka',
    effect: 'Chill Wave',
    description: 'Applies a warm sunset gradient with relaxed motion.',
    pattern: '10001',
  },
  '11111': {
    id: 'open-palm',
    label: 'Open Palm',
    effect: 'Aurora Burst',
    description: 'Expands the background into a bright multi-color glow.',
    pattern: '11111',
  },
}

export const DEFAULT_GESTURE_ACTION: GestureAction = {
  id: 'unknown',
  label: 'Unmapped',
  effect: 'Explorer Mode',
  description:
    'The hand is visible, but this pose is not mapped to a special action yet.',
  pattern: '',
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

  return GESTURE_LIBRARY[pattern] ?? {
    ...DEFAULT_GESTURE_ACTION,
    pattern,
  }
}
