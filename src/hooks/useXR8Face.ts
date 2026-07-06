import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createFaceScenePipelineModule, type FaceSceneHandle } from '../lib/faceScenePipelineModule'
import { createArObjectModule, type ArObjectHandle } from '../lib/arObjectModule'
import { createHandOccluderModule, type HandOccluderHandle } from '../lib/handOccluderModule'
import { releaseHandLandmarker } from '../lib/handTracker'
import { createThreejsPipelineModule, type ThreejsPipelineHandle } from '../lib/threejsPipelineModule'
import { loadXR8 } from '../lib/loadXR8'
import type { XR8Api } from '../types/xr8'

export type FaceTrackingStatus = 'loading' | 'running' | 'error'

export interface FaceTrackingError {
  kind: 'camera' | 'engine'
  message: string
}

export interface UseXR8FaceResult {
  status: FaceTrackingStatus
  error: FaceTrackingError | null
  startGame: () => void
}

export interface UseXR8FaceOptions {
  onBubblePop?: () => void
  onBubbleLost?: () => void
  onGameOver?: () => void
}

/**
 * Owns the full XR8 engine lifecycle for face tracking:
 * load -> configure -> run on mount, and stop -> clear -> dispose on unmount.
 * The canvas is handed over to XR8 and never touched by React re-renders.
 */
export function useXR8Face(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: UseXR8FaceOptions = {},
): UseXR8FaceResult {
  const [status, setStatus] = useState<FaceTrackingStatus>('loading')
  const [error, setError] = useState<FaceTrackingError | null>(null)
  const arObjectsRef = useRef<ArObjectHandle | null>(null)

  const startGame = useCallback(() => {
    arObjectsRef.current?.startGame()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // XR8 is a global singleton: the cancellation flag prevents a stale async
    // boot (e.g. React StrictMode's first mount) from calling run() after cleanup.
    let cancelled = false
    let started = false
    let xr8: XR8Api | null = null
    let threejs: ThreejsPipelineHandle | null = null
    let faceScene: FaceSceneHandle | null = null
    let handOccluder: HandOccluderHandle | null = null
    let arObjects: ArObjectHandle | null = null

    const fail = (kind: FaceTrackingError['kind'], message: string) => {
      if (cancelled) return
      setError({ kind, message })
      setStatus('error')
    }

    // XR8 renders at the canvas's attribute size; keep it matched to the
    // container (the official samples use an XRExtras helper for this).
    // IMPORTANT: measure the container, never the canvas itself — the engine
    // writes inline pixel styles to the canvas, so reading canvas.clientWidth
    // creates a feedback loop that doubles the size on every call.
    const container = canvas.parentElement
    const sizeCanvas = () => {
      if (!container) return
      const pixelRatio = Math.min(window.devicePixelRatio, 2)
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.width = Math.round(container.clientWidth * pixelRatio)
      canvas.height = Math.round(container.clientHeight * pixelRatio)
    }
    window.addEventListener('resize', sizeCanvas)

    const boot = async () => {
      const engine = await loadXR8()
      if (cancelled) return
      xr8 = engine

      engine.FaceController.configure({
        meshGeometry: [engine.FaceController.MeshGeometry.FACE],
        // RIGHT_HANDED matches our three.js camera (which looks down -Z).
        // LEFT_HANDED (used with the engine's built-in Threejs module) would
        // place the face behind the camera here.
        coordinates: { mirroredDisplay: true, axes: 'RIGHT_HANDED' },
      })

      threejs = createThreejsPipelineModule()
      faceScene = createFaceScenePipelineModule(engine, threejs.xrScene, {
        onFirstFrame: () => {
          if (!cancelled) setStatus('running')
        },
        onCameraError: () =>
          fail('camera', 'Camera access was denied or no camera is available. Allow camera access and retry.'),
        onEngineError: (err) =>
          fail('engine', err instanceof Error ? err.message : 'The AR engine failed to initialize.'),
      })

      handOccluder = createHandOccluderModule(threejs.xrScene, faceScene.getFaceDistance)
      arObjects = createArObjectModule(threejs.xrScene, faceScene.getFaceDistance, {
        onPop: options.onBubblePop,
        onLost: options.onBubbleLost,
        onGameOver: options.onGameOver,
      })
      arObjectsRef.current = arObjects

      engine.clearCameraPipelineModules()
      engine.addCameraPipelineModules([
        engine.GlTextureRenderer.pipelineModule(),
        threejs.module,
        engine.FaceController.pipelineModule(),
        faceScene.module,
        handOccluder.module,
        arObjects.module,
      ])

      sizeCanvas()
      engine.run({
        canvas,
        cameraConfig: { direction: engine.XrConfig.camera().FRONT },
        allowedDevices: engine.XrConfig.device().ANY,
      })
      started = true
    }

    boot().catch((err) => {
      fail('engine', err instanceof Error ? err.message : 'The AR engine failed to load.')
    })

    return () => {
      cancelled = true
      window.removeEventListener('resize', sizeCanvas)
      if (xr8 && started) {
        xr8.stop() // stops the camera loop and releases the webcam
        xr8.clearCameraPipelineModules()
      }
      handOccluder?.dispose()
      arObjects?.dispose()
      arObjectsRef.current = null
      faceScene?.dispose()
      threejs?.dispose()
      releaseHandLandmarker()
    }
  }, [canvasRef, options.onBubblePop, options.onBubbleLost, options.onGameOver])

  return { status, error, startGame }
}
