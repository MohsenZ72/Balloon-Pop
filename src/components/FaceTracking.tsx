import { useCallback, useEffect, useRef, useState } from 'react'
import { useXR8Face } from '../hooks/useXR8Face'
import { createGameSounds } from '../lib/gameSounds'
import './FaceTracking.css'

type GamePhase = 'ready' | 'countdown' | 'playing'

const COUNTDOWN_TICKS: (number | 'go')[] = [3, 2, 1, 'go']

/**
 * One AR session: the canvas handed to XR8 plus status overlays.
 * Remounted (fresh canvas + fresh engine boot) on every retry via `key`.
 */
function FaceTrackingSession({ onRetry }: { onRetry: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [popped, setPopped] = useState(0)
  const [lost, setLost] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [phase, setPhase] = useState<GamePhase>('ready')
  const [countdownTick, setCountdownTick] = useState<number | 'go' | null>(null)
  const [scoreBump, setScoreBump] = useState(false)
  const [lostBump, setLostBump] = useState(false)
  const bumpTimer = useRef<number>()
  const lostBumpTimer = useRef<number>()
  const countdownTimer = useRef<number>()
  const gameSounds = useRef(createGameSounds())

  const onBubblePop = useCallback(() => {
    setPopped((n) => n + 1)
    setScoreBump(true)
    window.clearTimeout(bumpTimer.current)
    bumpTimer.current = window.setTimeout(() => setScoreBump(false), 420)
  }, [])

  const onBubbleLost = useCallback(() => {
    setLost((n) => n + 1)
    setLostBump(true)
    window.clearTimeout(lostBumpTimer.current)
    lostBumpTimer.current = window.setTimeout(() => setLostBump(false), 420)
  }, [])

  const onGameOver = useCallback(() => setGameOver(true), [])

  const { status, error, startGame } = useXR8Face(canvasRef, {
    onBubblePop,
    onBubbleLost,
    onGameOver,
  })

  const handleStart = useCallback(() => {
    gameSounds.current.resume()
    gameSounds.current.playStart()
    setPhase('countdown')
    setCountdownTick(3)
    gameSounds.current.playCountdown(3)
  }, [])

  useEffect(() => {
    if (phase !== 'countdown') return

    let step = 0
    const advance = () => {
      step += 1
      if (step >= COUNTDOWN_TICKS.length) {
        setCountdownTick(null)
        setPhase('playing')
        startGame()
        return
      }
      const tick = COUNTDOWN_TICKS[step]
      setCountdownTick(tick)
      gameSounds.current.playCountdown(tick)
      countdownTimer.current = window.setTimeout(advance, tick === 'go' ? 700 : 800)
    }

    countdownTimer.current = window.setTimeout(advance, 800)

    return () => window.clearTimeout(countdownTimer.current)
  }, [phase, startGame])

  useEffect(() => {
    return () => {
      window.clearTimeout(bumpTimer.current)
      window.clearTimeout(lostBumpTimer.current)
      window.clearTimeout(countdownTimer.current)
      gameSounds.current.dispose()
    }
  }, [])

  const isPlaying = phase === 'playing' && status === 'running' && !gameOver

  return (
    <>
      <canvas ref={canvasRef} className="face-tracking__canvas" />

      {gameOver && <div className="face-tracking__boom-flash" aria-hidden="true" />}

      {isPlaying && (
        <div className="face-tracking__score-panel" aria-live="polite">
          <div className="face-tracking__score-bubbles" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className={`face-tracking__score ${scoreBump ? 'is-bump' : ''}`}>
            <span className="face-tracking__score-label">Popped</span>
            <span className="face-tracking__score-value">{popped}</span>
          </div>
          <div className={`face-tracking__score face-tracking__score--lost ${lostBump ? 'is-bump' : ''}`}>
            <span className="face-tracking__score-label">Lost</span>
            <span className="face-tracking__score-value">{lost}</span>
          </div>
        </div>
      )}

      {status === 'running' && phase === 'ready' && !gameOver && (
        <div className="face-tracking__overlay face-tracking__overlay--start">
          <h1 className="face-tracking__title">Balloon Pop</h1>
          <p className="face-tracking__tagline">Pop the balloons. Avoid the dynamite.</p>
          <p className="face-tracking__instructions">
            Touch balloons with your fingertip
          </p>
          <button className="face-tracking__start" type="button" onClick={handleStart}>
            Start
          </button>
        </div>
      )}

      {status === 'running' && phase === 'countdown' && countdownTick !== null && (
        <div className="face-tracking__overlay face-tracking__overlay--countdown" aria-live="assertive">
          <span
            key={String(countdownTick)}
            className={`face-tracking__countdown ${countdownTick === 'go' ? 'is-go' : ''}`}
          >
            {countdownTick === 'go' ? 'GO!' : countdownTick}
          </span>
        </div>
      )}

      {status === 'running' && gameOver && (
        <div className="face-tracking__overlay face-tracking__overlay--gameover">
          <h2 className="face-tracking__gameover-title">BOOM!</h2>
          <p className="face-tracking__gameover-sub">You popped the dynamite</p>
          <div className="face-tracking__gameover-stats">
            <span>Popped: {popped}</span>
            <span>Lost: {lost}</span>
          </div>
          <button className="face-tracking__retry" type="button" onClick={onRetry}>
            Play again
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="face-tracking__overlay">
          <div className="face-tracking__spinner" />
          <p>Starting camera&hellip;</p>
        </div>
      )}

      {status === 'error' && error && (
        <div className="face-tracking__overlay">
          <h2 className="face-tracking__error-title">
            {error.kind === 'camera' ? 'Camera unavailable' : 'AR failed to start'}
          </h2>
          <p className="face-tracking__error-message">{error.message}</p>
          <button className="face-tracking__retry" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </>
  )
}

export function FaceTracking() {
  const [attempt, setAttempt] = useState(0)

  return (
    <div className="face-tracking">
      <FaceTrackingSession key={attempt} onRetry={() => setAttempt((n) => n + 1)} />
    </div>
  )
}
