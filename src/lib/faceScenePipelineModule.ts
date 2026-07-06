import type { CameraPipelineModule, FaceEventDetail, XR8Api, XRScene } from '../types/xr8'

export interface FaceSceneCallbacks {
  onFirstFrame: () => void
  onCameraError: () => void
  onEngineError: (error: unknown) => void
}

export interface FaceSceneHandle {
  module: CameraPipelineModule
  getFaceDistance: () => number
  dispose: () => void
}

/**
 * Face tracking only — no visible face effects. Tracks face distance for
 * bubble sizing / hand depth and wires engine lifecycle callbacks.
 */
export function createFaceScenePipelineModule(
  _xr8: XR8Api,
  _getXrScene: () => XRScene | null,
  callbacks: FaceSceneCallbacks,
): FaceSceneHandle {
  let firstFrameReported = false
  let disposed = false
  let faceDistance = 0.4

  const onFaceUpdate = ({ detail }: { detail: FaceEventDetail }) => {
    const { position } = detail.transform
    faceDistance = Math.hypot(position.x, position.y, position.z)
  }

  const module: CameraPipelineModule = {
    name: 'face-scene',
    onUpdate: () => {
      if (disposed) return
      if (!firstFrameReported) {
        firstFrameReported = true
        callbacks.onFirstFrame()
      }
    },
    onCameraStatusChange: ({ status }) => {
      if (status === 'failed' && !disposed) callbacks.onCameraError()
    },
    onException: (error) => {
      if (!disposed) callbacks.onEngineError(error)
    },
    listeners: [
      { event: 'facecontroller.facefound', process: onFaceUpdate },
      { event: 'facecontroller.faceupdated', process: onFaceUpdate },
      { event: 'facecontroller.facelost', process: () => {} },
    ],
  }

  return {
    module,
    getFaceDistance: () => faceDistance,
    dispose: () => {
      disposed = true
    },
  }
}
