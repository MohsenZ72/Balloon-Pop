import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import * as THREE from 'three'
import type { XRScene } from '../types/xr8'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export const MAX_HANDS = 2
export const LANDMARK_COUNT = 21

export type HandLandmark = { x: number; y: number; z: number }
export type HandLandmarks = HandLandmark[]

let landmarker: HandLandmarker | null = null
let initPromise: Promise<HandLandmarker | null> | null = null
let disposed = false

/** One shared HandLandmarker instance for occlusion, glass ball, etc. */
export function acquireHandLandmarker(): Promise<HandLandmarker | null> {
  disposed = false
  if (landmarker) return Promise.resolve(landmarker)
  initPromise ??= (async () => {
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' as const },
        runningMode: 'VIDEO' as const,
        numHands: MAX_HANDS,
      }
      try {
        landmarker = await HandLandmarker.createFromOptions(fileset, options)
      } catch {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' },
        })
      }
      if (disposed) {
        landmarker?.close()
        landmarker = null
      }
      return landmarker
    } catch {
      console.warn('Hand tracking disabled: MediaPipe failed to load.')
      return null
    }
  })()
  return initPromise
}

export function releaseHandLandmarker() {
  disposed = true
  landmarker?.close()
  landmarker = null
  initPromise = null
}

export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video')
}

/**
 * Maps a raw-video normalized landmark to a world position at `depth`,
 * accounting for cover-fit crop and mirrored selfie display.
 */
export function landmarkToWorld(
  lm: { x: number; y: number },
  depth: number,
  xrScene: XRScene,
  video: HTMLVideoElement,
  out: THREE.Vector3,
) {
  const canvas = xrScene.renderer.domElement
  const videoAspect = video.videoWidth / video.videoHeight
  const canvasAspect = canvas.width / canvas.height

  let u = lm.x
  let v = lm.y
  if (videoAspect > canvasAspect) {
    const shown = canvasAspect / videoAspect
    u = (u - (1 - shown) / 2) / shown
  } else {
    const shown = videoAspect / canvasAspect
    v = (v - (1 - shown) / 2) / shown
  }
  u = 1 - u

  const ndcX = u * 2 - 1
  const ndcY = -(v * 2 - 1)

  const { camera } = xrScene
  const rayPoint = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera)
  const rayDir = rayPoint.sub(camera.position).normalize()
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  const along = rayDir.dot(forward)
  out.copy(camera.position).addScaledVector(rayDir, depth / Math.max(along, 1e-6))
}

/** Maps a viewport NDC point (not mirrored) to world space at `depth`. */
export function ndcToWorld(
  ndcX: number,
  ndcY: number,
  depth: number,
  xrScene: XRScene,
  out: THREE.Vector3,
) {
  const { camera } = xrScene
  const rayPoint = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera)
  const rayDir = rayPoint.sub(camera.position).normalize()
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  const along = rayDir.dot(forward)
  out.copy(camera.position).addScaledVector(rayDir, depth / Math.max(along, 1e-6))
}

export function palmCenter(landmarks: HandLandmarks, out: THREE.Vector3) {
  const ids = [0, 5, 9, 13, 17]
  let x = 0
  let y = 0
  let z = 0
  for (const id of ids) {
    x += landmarks[id].x
    y += landmarks[id].y
    z += landmarks[id].z
  }
  const n = ids.length
  out.set(x / n, y / n, z / n)
  return out
}

/** Fingers curled inward as if cupping a small object. */
export function isHoldingPose(landmarks: HandLandmarks): boolean {
  const wrist = landmarks[0]
  const middleBase = landmarks[9]
  const palmSize = Math.hypot(
    middleBase.x - wrist.x,
    middleBase.y - wrist.y,
    middleBase.z - wrist.z,
  )
  if (palmSize < 1e-4) return false

  const center = { x: 0, y: 0, z: 0 }
  const ids = [0, 5, 9, 13, 17]
  for (const id of ids) {
    center.x += landmarks[id].x
    center.y += landmarks[id].y
    center.z += landmarks[id].z
  }
  center.x /= ids.length
  center.y /= ids.length
  center.z /= ids.length
  const tips = [4, 8, 12, 16, 20]
  let avg = 0
  for (const tip of tips) {
    const lm = landmarks[tip]
    avg += Math.hypot(lm.x - center.x, lm.y - center.y, lm.z - center.z)
  }
  avg /= tips.length
  return avg < palmSize * 0.9
}

export function palmSize(landmarks: HandLandmarks): number {
  const wrist = landmarks[0]
  const middleBase = landmarks[9]
  return Math.hypot(middleBase.x - wrist.x, middleBase.y - wrist.y, middleBase.z - wrist.z)
}

/** Index finger extended enough to poke a bubble. */
export function isIndexExtended(landmarks: HandLandmarks): boolean {
  const dist = (a: HandLandmark, b: HandLandmark) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  return dist(landmarks[5], landmarks[8]) > dist(landmarks[6], landmarks[8]) * 1.12
}

/** Index finger extended, other fingers relaxed — a point gesture. */
export function isPointing(landmarks: HandLandmarks): boolean {
  const dist = (a: HandLandmark, b: HandLandmark) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

  const indexLen = dist(landmarks[5], landmarks[8])
  const indexFold = dist(landmarks[6], landmarks[8])
  const indexExtended = indexLen > indexFold * 1.2

  const middleLen = dist(landmarks[9], landmarks[12])
  const ringLen = dist(landmarks[13], landmarks[16])
  const othersShort = middleLen < indexLen * 0.9 && ringLen < indexLen * 0.85

  return indexExtended && othersShort
}

/** Index fingertip landmark for hit tests. */
export const INDEX_TIP = 8
export const INDEX_DIP = 7
/** The very end of the index finger pad — tight pop target. */
export function fingertipPadLandmark(landmarks: HandLandmarks, out: HandLandmark) {
  const dip = landmarks[INDEX_DIP]
  const tip = landmarks[INDEX_TIP]
  const t = 1.06
  out.x = dip.x + (tip.x - dip.x) * t
  out.y = dip.y + (tip.y - dip.y) * t
  out.z = dip.z + (tip.z - dip.z) * t
  return out
}

export const THUMB_TIP = 4
export const THUMB_IP = 3

const dist = (a: HandLandmark, b: HandLandmark) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Closed fist — punch gesture to pop balloons. */
export function isPunchFist(landmarks: HandLandmarks): boolean {
  const size = palmSize(landmarks)
  if (size < 1e-4) return false

  const wrist = landmarks[0]
  const tips = [8, 12, 16, 20] as const
  const mcps = [5, 9, 13, 17] as const

  let curled = 0
  for (let i = 0; i < 4; i++) {
    const tipToMcp = dist(landmarks[mcps[i]], landmarks[tips[i]])
    const mcpToWrist = dist(wrist, landmarks[mcps[i]])
    if (tipToMcp < mcpToWrist * 0.88) curled++
  }
  if (curled < 3) return false

  const thumbToIndex = dist(landmarks[THUMB_TIP], landmarks[5])
  if (thumbToIndex > size * 0.58) return false

  return true
}

/** Strike point between fingers (horizontal knuckle line). */
export function punchHitLandmark(landmarks: HandLandmarks, out: HandLandmark) {
  const ids = [5, 9, 13] as const
  out.x = 0
  out.y = 0
  out.z = 0
  for (const id of ids) {
    out.x += landmarks[id].x
    out.y += landmarks[id].y
    out.z += landmarks[id].z
  }
  out.x /= ids.length
  out.y /= ids.length
  out.z /= ids.length
  return out
}

/** @deprecated Use isPunchFist */
export const isNeedleGrip = isPunchFist
