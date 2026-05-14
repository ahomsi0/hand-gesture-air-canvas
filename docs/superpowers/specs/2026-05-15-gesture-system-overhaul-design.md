# Gesture System Overhaul — Design Spec

**Date:** 2026-05-15
**Project:** Hand Gesture Air Canvas (Gesture Paint 96)
**Status:** Approved

## Problem

The gesture system has four compounding pain points:

1. **False triggers** — gestures fire or flicker when the hand transitions between poses
2. **Limited gesture vocabulary** — only color selection and draw/erase are mapped; no brush size or undo
3. **Handedness confusion** — MediaPipe occasionally misclassifies Left/Right on rotated hands, causing wrong color selection or erase misfires
4. **No visual confirmation** — users cannot tell which gesture is active or when it has locked in

## Chosen Approach

**Gesture State Machine + Debounce Layer (Option A)**

A `GestureStateMachine` class sits between raw MediaPipe output and the rest of the app. It stabilizes gestures and handedness over a window of consecutive frames before committing them. Drawing tool detection (point/erase) bypasses the debounce to stay frame-accurate. A new `gestureConfidence` field drives visual lock indicators in the UI.

---

## Architecture

### New file
- `src/utils/gestureStateMachine.ts` — pure TypeScript class, no React, no side effects

### Modified files
- `src/hooks/useHandDetection.ts` — instantiates the state machine via `useRef`, calls it each `processFrame` tick, adds `gestureConfidence` to the return type
- `src/utils/recognizeGesture.ts` — extends `GESTURE_LIBRARY` with new gesture mappings and a `category` field
- `src/components/CameraView.tsx` — consumes `gestureConfidence`, adds confidence indicator UI, manages `brushSize` and stroke history for undo

### Unchanged
- `src/App.tsx`
- `src/App.css`
- `src/index.css`
- `src/utils/countRaisedFingers.ts`
- `src/hooks/useSceneInsights.ts`

The hook's return type gains one new field (`gestureConfidence: number`) but all existing fields remain identical in shape, so consumers need no structural changes.

---

## Gesture State Machine Logic

**File:** `src/utils/gestureStateMachine.ts`

State is tracked per hand in a `Map<string, HandState>` keyed by handedness label.

```ts
type HandState = {
  candidate: string        // finger pattern currently observed
  candidateFrames: number  // consecutive frames this candidate has been seen
  committed: string        // last confirmed pattern
  lockFramesRemaining: number // frames remaining in post-commit lock period
  handednessCandidate: string
  handednessFrames: number
  confirmedHandedness: string
}
```

**Thresholds:**

| Constant | Value | Rationale |
|---|---|---|
| `COMMIT_THRESHOLD` | 6 frames | ~100ms at 60fps — absorbs transitional hand poses |
| `HANDEDNESS_THRESHOLD` | 4 frames | Absorbs brief MediaPipe left/right flips |
| `LOCK_FRAMES` | 12 frames | Prevents immediate re-evaluation after commit |
| `BRUSH_SIZE_COOLDOWN` | 30 frames | Prevents rapid repeated brush size changes |

**Commit rule:** If `candidate === current pattern` for `COMMIT_THRESHOLD` consecutive frames AND `lockFramesRemaining === 0`, the gesture commits and the lock period starts.

**Handedness rule:** The raw handedness label must match for `HANDEDNESS_THRESHOLD` consecutive frames before `confirmedHandedness` updates. Until then, the previous confirmed label is used for all gesture routing logic.

**Drawing tool bypass:** `isPointerPose` and `isOpenPalmPose` checks run on raw landmarks every frame, independent of the state machine. This keeps drawing and erasing frame-accurate and responsive.

**`gestureConfidence`:** `candidateFrames / COMMIT_THRESHOLD` clamped to `[0, 1]`. Emitted as the maximum confidence across all tracked hands.

**Reset:** All `HandState` entries are cleared when `enabled` flips to false, preventing stale committed gestures on camera restart.

---

## Gesture Library Expansion

**File:** `src/utils/recognizeGesture.ts`

A new `category` field is added to `GestureAction`:

```ts
type GestureAction = {
  id: string
  label: string
  effect: string
  description: string
  pattern: string
  category: 'color' | 'tool' | 'canvas' | 'effect'
}
```

**New mappings added to `GESTURE_LIBRARY`:**

| Pattern | Gesture | Action | Category | Hand |
|---|---|---|---|---|
| `01000` | Point | Draw | `tool` | Either |
| `11111` | Open Palm | Erase (left) / Color reset (right) | `tool` | Either |
| `01100` | Peace / V | Increase brush size | `canvas` | Right |
| `00001` | Pinky | Decrease brush size | `canvas` | Right |
| `11000` | Thumb + Index | Undo last stroke | `canvas` | Right |

Existing entries (`fist`, `thumbs-up`, `shaka`) keep their `effect` labels and are recategorised as `effect`.

Color selection (right hand 2/3/4/5 fingers) continues to be handled in `CameraView`'s `useEffect` watching `handCounts` — no change needed there.

---

## Brush Size & Undo State

**Brush size** is new state in `CameraView`:

- Type: `number`, range 1–5
- Default: 3
- Maps to pixel line widths: `[3, 5, 8, 12, 18]`
- Peace/V gesture increments; Pinky gesture decrements; clamped at bounds
- Each fires **once per commit** — the lock period + 30-frame cooldown prevent repeated firing while the gesture is held
- The 30-frame cooldown is enforced inside the state machine using `BRUSH_SIZE_COOLDOWN`
- `drawingTool` gains an optional `brushSize?: number` field that `CameraView` reads when stroking

**Undo** requires storing strokes as path data instead of blitting directly:

```ts
type Stroke = {
  points: Array<{ x: number; y: number }>
  color: string
  width: number
}
```

- Stored in a `useRef<Stroke[]>` in `CameraView`
- Capped at 50 strokes to bound memory
- On undo: drawing canvas is cleared, all strokes except the last are replayed
- A `canUndo` boolean (derived from `strokes.length > 0`) enables/disables a new Undo button in the canvas toolbar

---

## Visual Feedback

All changes are additive — new class names and small JSX additions in `CameraView.tsx`.

**1. Gesture lock progress bar**
- Placed below the "Current Gesture" panel title
- Width: `gestureConfidence * 100%` via inline style
- Color: amber (`#ffd84d`) while filling, green (`#66ff66`) when locked (confidence === 1)
- CSS transition: `width 80ms linear`
- Brief flash on commit: a CSS keyframe animation triggered by a class swap

**2. Active gesture state dot**
- A small circle (10px) to the left of the `gesture-name` text
- Grey: no gesture / unmapped
- Amber: candidate in progress
- Green: committed and locked

**3. Handedness stability indicator**
- Each hand row in "Detected Hands" gets a `data-stable` attribute
- Stable: default border (`#20283a`)
- Stabilizing: amber dashed border (`2px dashed #ffd84d`)

---

## Error Handling & Edge Cases

**Gesture conflicts:** If both hands show a `tool` gesture simultaneously, draw takes priority over erase. Canvas gestures (undo, brush size) only fire from confirmed right hand — left-hand open palm remains unambiguously erase.

**Stroke history cap:** `Stroke[]` array is capped at 50. When full, the oldest stroke is dropped (FIFO) so undo always works on recent history.

**State machine reset:** Called when `enabled` flips false (camera stopped). Prevents stale committed gestures from persisting on restart.

**Brush size bounds:** Clamped at 1 and 5. Gestures beyond the bounds are silently ignored (no error, no feedback needed).

**No regression to existing drawing:** The drawing loop in `CameraView` is structurally unchanged. It still reads `detection.drawingTool` and strokes on canvas — additions are `brushSize` read and `canUndo` flag for the undo button.

---

## Files Changed Summary

| File | Change type |
|---|---|
| `src/utils/gestureStateMachine.ts` | New |
| `src/utils/recognizeGesture.ts` | Extend gesture library, add `category` field |
| `src/hooks/useHandDetection.ts` | Integrate state machine, emit `gestureConfidence` |
| `src/components/CameraView.tsx` | Confidence UI, brush size state, stroke history, undo button |
