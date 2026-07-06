import * as THREE from 'three'
import type { CameraPipelineModule, XRScene } from '../types/xr8'
import {
  acquireHandLandmarker,
  getVideoElement,
  landmarkToWorld,
  LANDMARK_COUNT,
  MAX_HANDS,
} from './handTracker'

// Per-joint occluder radii, as a fraction of palm length (wrist -> middle-finger base).
const JOINT_RADII: number[] = [
  0.24, 0.2, 0.15, 0.12, 0.1, 0.16, 0.11, 0.1, 0.09, 0.16, 0.11, 0.1, 0.09, 0.16, 0.11, 0.1,
  0.09, 0.15, 0.1, 0.09, 0.08,
]

const CONNECTIONS: Array<[number, number, number]> = [
  [1, 2, 0.14], [2, 3, 0.12], [3, 4, 0.1],
  [5, 6, 0.12], [6, 7, 0.1], [7, 8, 0.09],
  [9, 10, 0.12], [10, 11, 0.1], [11, 12, 0.09],
  [13, 14, 0.12], [14, 15, 0.1], [15, 16, 0.09],
  [17, 18, 0.11], [18, 19, 0.09], [19, 20, 0.08],
  [0, 1, 0.2], [0, 5, 0.2], [0, 9, 0.22], [0, 13, 0.22], [0, 17, 0.2],
  [5, 9, 0.15], [9, 13, 0.15], [13, 17, 0.15],
]

const SPHERES_PER_HAND = LANDMARK_COUNT + CONNECTIONS.length

export interface HandOccluderHandle {
  module: CameraPipelineModule
  dispose: () => void
}

/**
 * Hand occlusion for the AR overlay. MediaPipe HandLandmarker tracks up to two
 * hands on the same camera video the XR8 engine uses. Each hand landmark gets
 * a sphere that writes only to the depth buffer (colorWrite: false), placed
 * slightly in front of the face. Virtual content behind those spheres fails
 * the depth test, so the real hand in the camera feed shows through instead.
 *
 * Add `?debugHands` to the URL to render the occluder spheres in green.
 */
export function createHandOccluderModule(
  getXrScene: () => XRScene | null,
  getFaceDistance: () => number,
): HandOccluderHandle {
  const debug = new URLSearchParams(window.location.search).has('debugHands')

  let landmarker: Awaited<ReturnType<typeof acquireHandLandmarker>> = null
  let group: THREE.Group | null = null
  let spheres: THREE.Mesh[] = []
  let video: HTMLVideoElement | null = null
  let lastVideoTime = -1
  let disposed = false

  const buildScene = () => {
    const xrScene = getXrScene()
    if (!xrScene) return
    group = new THREE.Group()
    group.renderOrder = -1

    const geometry = new THREE.SphereGeometry(1, 10, 10)
    const material = debug
      ? new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.4 })
      : new THREE.MeshBasicMaterial({ colorWrite: false })
    for (let i = 0; i < MAX_HANDS * SPHERES_PER_HAND; i++) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = -1
      mesh.visible = false
      group.add(mesh)
    }
    spheres = group.children as THREE.Mesh[]
    xrScene.scene.add(group)
  }

  const module: CameraPipelineModule = {
    name: 'hand-occluder',
    onStart: () => {
      buildScene()
      void acquireHandLandmarker().then((lm) => {
        landmarker = lm
      })
    },
    onUpdate: () => {
      if (disposed || !landmarker || !group) return
      const xrScene = getXrScene()
      if (!xrScene) return

      video ??= getVideoElement()
      if (!video || video.readyState < 2 || video.videoWidth === 0) return
      if (video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime

      const result = landmarker.detectForVideo(video, performance.now())
      const handCount = Math.min(result.landmarks.length, MAX_HANDS)
      group.visible = handCount > 0

      const depth = getFaceDistance() * 0.8

      for (let h = 0; h < MAX_HANDS; h++) {
        const base = h * SPHERES_PER_HAND
        const landmarks = h < handCount ? result.landmarks[h] : null
        if (!landmarks) {
          for (let i = 0; i < SPHERES_PER_HAND; i++) spheres[base + i].visible = false
          continue
        }

        for (let i = 0; i < LANDMARK_COUNT; i++) {
          const sphere = spheres[base + i]
          landmarkToWorld(landmarks[i], depth, xrScene, video, sphere.position)
          sphere.visible = true
        }

        const palmLen = spheres[base].position.distanceTo(spheres[base + 9].position)
        for (let i = 0; i < LANDMARK_COUNT; i++) {
          spheres[base + i].scale.setScalar(palmLen * JOINT_RADII[i])
        }

        for (let c = 0; c < CONNECTIONS.length; c++) {
          const [a, b, radius] = CONNECTIONS[c]
          const sphere = spheres[base + LANDMARK_COUNT + c]
          sphere.position
            .copy(spheres[base + a].position)
            .add(spheres[base + b].position)
            .multiplyScalar(0.5)
          sphere.scale.setScalar(palmLen * radius)
          sphere.visible = true
        }
      }
    },
    onException: () => {},
  }

  const dispose = () => {
    disposed = true
    landmarker = null
    const xrScene = getXrScene()
    if (group) {
      xrScene?.scene.remove(group)
      const first = spheres[0]
      if (first) {
        first.geometry.dispose()
        ;(first.material as THREE.Material).dispose()
      }
    }
    group = null
    spheres = []
    video = null
  }

  return { module, dispose }
}
