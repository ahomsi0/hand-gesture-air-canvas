# Hand Gesture Air Canvas

A browser-based hand tracking and drawing app built with React, Vite, and TypeScript. It uses the laptop webcam and MediaPipe Hands to detect up to two hands in real time, count raised fingers, recognize gesture patterns, and turn hand poses into drawing interactions.

## Overview

This project combines live hand landmark detection with an interactive air-canvas experience:

- Start the webcam directly in the browser
- Detect and track up to two hands in real time
- Draw landmarks and hand connections on a canvas overlay
- Count raised fingers using landmark comparisons
- Use the right hand to choose drawing colors
- Use the pointing gesture to draw
- Use the left open palm as an eraser

Everything runs client-side. No backend or server-side inference is used.

## Built With

- React 19
- Vite 8
- TypeScript 6
- MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
- Browser webcam access via `navigator.mediaDevices.getUserMedia`
- HTML video and canvas overlays

## How It Works

### Hand Detection

The app uses MediaPipe Hand Landmarker in `VIDEO` mode. Each frame from the live webcam feed is passed into the detector, which returns:

- 21 hand landmarks per detected hand
- handedness classification (`Left` or `Right`)
- continuous tracking across frames

### Finger Counting

Finger counting is based on landmark geometry:

- Index, middle, ring, and pinky are considered raised when the finger is extended from MCP to PIP to tip
- The thumb uses horizontal comparison because it bends sideways instead of vertically
- The total count is computed per hand and then summed when both hands are visible

### Gesture Behavior

The app maps hand poses to interactions:

- Right hand `2` fingers: select black brush
- Right hand `3` fingers: select green brush
- Right hand `4` fingers: select blue brush
- Right hand `5` fingers: select pink brush
- Pointing gesture: draw using the currently selected brush color
- Left open palm: erase

The selected brush color persists, so you can choose a color first and then go back to the pointing gesture to keep drawing with it.

## User Flow

1. Open the app
2. Click `Start Camera`
3. Allow webcam permission
4. Show your right hand with `2`, `3`, `4`, or `5` fingers to choose a color
5. Make a pointing gesture to draw
6. Show your left open palm to erase
7. Use the `Clear Drawing` button to wipe the whole canvas

## Project Structure

```text
.
├── public/
├── src/
│   ├── components/
│   │   └── CameraView.tsx
│   ├── hooks/
│   │   └── useHandDetection.ts
│   ├── utils/
│   │   ├── countRaisedFingers.ts
│   │   └── recognizeGesture.ts
│   ├── App.tsx
│   ├── App.css
│   ├── index.css
│   └── main.tsx
├── index.html
├── package.json
└── README.md
```

## Local Development

### Prerequisites

- Node.js 20+ recommended
- npm
- A webcam-enabled browser

### Install

```bash
npm install
```

### Run the App

```bash
npm run dev
```

Vite will start a local development server, usually at:

```text
http://127.0.0.1:5173
```

### Production Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## Using the Website

### Start the Camera

- Launch the app
- Click `Start Camera`
- Accept webcam permission when prompted

### Select a Color

Use only your right hand for color selection:

- `2` fingers selects black
- `3` fingers selects green
- `4` fingers selects blue
- `5` fingers selects pink

The selected brush appears in the interface and remains active until you change it.

### Draw

- Make a pointing gesture with one hand
- Move your index finger to draw in the air
- The stroke is drawn on the canvas overlay using the active brush color

### Erase

- Show your left hand with an open palm
- Move it across the drawing area to erase

### Clear Everything

- Press the `Clear Drawing` button to wipe the canvas completely

## Notes and Limitations

- Bright, even lighting improves hand tracking
- Gesture recognition can become less stable if the hand is partially out of frame
- Very fast motion may reduce accuracy
- MediaPipe handedness can occasionally flicker if the hand is rotated aggressively

## Future Improvements

- Smoother pointer interpolation
- Dynamic brush size
- Undo / redo
- Save drawing as image
- Gesture calibration
- Better confidence-based gesture debouncing

## Author

Ahmad Homsi
