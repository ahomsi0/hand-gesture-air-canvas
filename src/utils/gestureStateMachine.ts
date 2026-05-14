const COMMIT_THRESHOLD = 6
const HANDEDNESS_THRESHOLD = 4
const LOCK_FRAMES = 12

type HandState = {
  candidate: string
  candidateFrames: number
  committed: string
  lockFramesRemaining: number
  handednessCandidate: string
  handednessFrames: number
  confirmedHandedness: string
}

export type RawHandInput = {
  index: number
  pattern: string
  rawHandedness: string
}

export type StabilizedHand = {
  index: number
  pattern: string
  confirmedHandedness: string
  gestureConfidence: number
  isHandednessStable: boolean
  justCommitted: boolean
}

export class GestureStateMachine {
  private states = new Map<string, HandState>()

  reset(): void {
    this.states.clear()
  }

  process(hands: RawHandInput[]): {
    stabilized: StabilizedHand[]
    overallConfidence: number
  } {
    const presentKeys = new Set(hands.map((h) => String(h.index)))
    for (const key of this.states.keys()) {
      if (!presentKeys.has(key)) {
        this.states.delete(key)
      }
    }

    const stabilized: StabilizedHand[] = []

    for (const hand of hands) {
      const key = String(hand.index)

      if (!this.states.has(key)) {
        this.states.set(key, {
          candidate: hand.pattern,
          candidateFrames: 1,
          committed: hand.pattern,
          lockFramesRemaining: 0,
          handednessCandidate: hand.rawHandedness,
          handednessFrames: 1,
          confirmedHandedness: hand.rawHandedness,
        })
      }

      const state = this.states.get(key)!

      // Handedness stabilization
      let isHandednessStable: boolean
      if (hand.rawHandedness === state.handednessCandidate) {
        state.handednessFrames = Math.min(
          state.handednessFrames + 1,
          HANDEDNESS_THRESHOLD,
        )
        if (state.handednessFrames >= HANDEDNESS_THRESHOLD) {
          state.confirmedHandedness = hand.rawHandedness
          isHandednessStable = true
        } else {
          isHandednessStable = false
        }
      } else {
        state.handednessCandidate = hand.rawHandedness
        state.handednessFrames = 1
        isHandednessStable = false
      }

      // Gesture debouncing
      let justCommitted = false

      if (state.lockFramesRemaining > 0) {
        state.lockFramesRemaining--
      } else {
        if (hand.pattern === state.candidate) {
          state.candidateFrames = Math.min(
            state.candidateFrames + 1,
            COMMIT_THRESHOLD,
          )
          if (state.candidateFrames >= COMMIT_THRESHOLD) {
            if (state.committed !== hand.pattern) {
              state.committed = hand.pattern
              justCommitted = true
            }
            state.lockFramesRemaining = LOCK_FRAMES
          }
        } else {
          state.candidate = hand.pattern
          state.candidateFrames = 1
        }
      }

      stabilized.push({
        index: hand.index,
        pattern: state.committed,
        confirmedHandedness: state.confirmedHandedness,
        gestureConfidence: state.candidateFrames / COMMIT_THRESHOLD,
        isHandednessStable,
        justCommitted,
      })
    }

    const overallConfidence =
      stabilized.length > 0
        ? Math.max(...stabilized.map((h) => h.gestureConfidence))
        : 0

    return { stabilized, overallConfidence }
  }
}
