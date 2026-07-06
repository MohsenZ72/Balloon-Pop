import * as THREE from 'three'
import type { CameraPipelineModule, ProcessCpuResult, XRScene } from '../types/xr8'

export interface ThreejsPipelineHandle {
  module: CameraPipelineModule
  xrScene: () => XRScene | null
  dispose: () => void
}

/**
 * Custom replacement for XR8.Threejs.pipelineModule(), based on 8th Wall's
 * official custom-pipeline-module example. Two reasons to use it:
 * 1. It is built on our own npm three.js (no engine-bundled THREE version coupling).
 * 2. The engine's built-in Threejs module requires XR8.XrController (the SLAM
 *    chunk) at startup; with only the `face` chunk loaded it crashes. This one
 *    drives the camera directly from the face controller's per-frame result.
 */
export function createThreejsPipelineModule(): ThreejsPipelineHandle {
  let xrScene: XRScene | null = null
  let engaged = false

  const engage = ({
    canvas,
    canvasWidth,
    canvasHeight,
    GLctx,
  }: {
    canvas: HTMLCanvasElement
    canvasWidth: number
    canvasHeight: number
    GLctx: WebGLRenderingContext
  }) => {
    if (engaged) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, canvasWidth / canvasHeight, 0.01, 1000)
    scene.add(camera)

    const renderer = new THREE.WebGLRenderer({
      canvas,
      context: GLctx,
      alpha: false,
      antialias: true,
    })
    renderer.autoClear = false
    renderer.setSize(canvasWidth, canvasHeight)

    xrScene = { scene, camera, renderer }
    engaged = true

    if (import.meta.env.DEV) {
      // Console-inspectable handle for debugging the AR scene in dev builds.
      ;(window as unknown as Record<string, unknown>).__xrScene = xrScene
    }
  }

  const module: CameraPipelineModule = {
    name: 'custom-threejs',
    onStart: (args) => engage(args),
    onAttach: (args) => engage(args),
    onDetach: () => {
      engaged = false
    },
    onUpdate: ({ processCpuResult }: { processCpuResult: ProcessCpuResult }) => {
      const realitySource = processCpuResult.reality || processCpuResult.facecontroller
      if (!realitySource || !xrScene) return

      const { rotation, position, intrinsics } = realitySource
      const { camera } = xrScene

      if (intrinsics) {
        for (let i = 0; i < 16; i++) {
          camera.projectionMatrix.elements[i] = intrinsics[i]
        }
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      }
      if (rotation) {
        camera.setRotationFromQuaternion(rotation as THREE.Quaternion)
      }
      if (position) {
        camera.position.set(position.x, position.y, position.z)
      }
    },
    onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => {
      xrScene?.renderer.setSize(canvasWidth, canvasHeight)
    },
    onRender: () => {
      if (!xrScene) return
      xrScene.renderer.clearDepth()
      xrScene.renderer.render(xrScene.scene, xrScene.camera)
    },
  }

  const dispose = () => {
    xrScene?.renderer.dispose()
    xrScene = null
    engaged = false
  }

  return { module, xrScene: () => xrScene, dispose }
}
