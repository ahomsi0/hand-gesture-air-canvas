import { useState } from 'react'
import CameraView from './components/CameraView'
import './App.css'

function App() {
  const [hasStarted, setHasStarted] = useState(false)

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-label">Gesture Paint</span>
          <h1>Air Canvas</h1>
        </div>

        {!hasStarted ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setHasStarted(true)}
          >
            Start Camera
          </button>
        ) : (
          <div className="topbar-hints">
            <span>R palm → palette</span>
            <span>Point → draw</span>
            <span>L palm → erase</span>
          </div>
        )}
      </header>

      <section className="main-panel">
        {hasStarted ? (
          <CameraView />
        ) : (
          <div className="idle-screen">
            <div className="idle-box">
              <p className="idle-title">Ready</p>
              <p className="idle-copy">
                Start the camera to open the live canvas. No data leaves your device.
              </p>
            </div>
            <div className="help-grid">
              <article className="help-card">
                <h2>Colors</h2>
                <p>Open your right palm to reveal the palette. Hover over a color to select it.</p>
              </article>
              <article className="help-card">
                <h2>Draw</h2>
                <p>Point with your index finger to sketch. Thumbs up / pinky to resize the brush.</p>
              </article>
              <article className="help-card">
                <h2>Erase</h2>
                <p>Left open palm erases. Right fist undoes the last stroke.</p>
              </article>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
