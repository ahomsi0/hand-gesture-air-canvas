import { useState } from 'react'
import CameraView from './components/CameraView'
import './App.css'

function App() {
  const [hasStarted, setHasStarted] = useState(false)

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Browser-based hand tracking</span>
          <h1>Count raised fingers live with your webcam.</h1>
          <p className="hero-text">
            Launch your camera, show one hand, and get a real-time finger count
            directly in the browser with a landmark overlay.
          </p>

          {!hasStarted ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => setHasStarted(true)}
            >
              Start Camera
            </button>
          ) : (
            <p className="inline-note">
              Camera access starts below. If your browser prompts for
              permission, choose allow to continue.
            </p>
          )}
        </div>

        <div className="hero-card-grid" aria-label="Feature highlights">
          <article className="info-card">
            <h2>Real-time overlay</h2>
            <p>Landmarks and hand connections are drawn on top of the video.</p>
          </article>
          <article className="info-card">
            <h2>Finger count</h2>
            <p>
              Counts thumb, index, middle, ring, and pinky using landmark
              positions.
            </p>
          </article>
          <article className="info-card">
            <h2>Fully local</h2>
            <p>No uploads and no backend. Detection stays inside the browser.</p>
          </article>
        </div>
      </section>

      <section className="experience-panel">
        {hasStarted ? (
          <CameraView />
        ) : (
          <div className="placeholder-panel">
            <div className="placeholder-ring" />
            <p>Start the camera to begin hand tracking.</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
