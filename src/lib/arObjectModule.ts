import * as THREE from 'three'
import type { ArObjectMode } from '../config/arObjectMode'
import { AR_OBJECT_MODE } from '../config/arObjectMode'
import type { CameraPipelineModule, XRScene } from '../types/xr8'
import { createBubblePopSound } from './bubblePopSound'
import { createDynamiteExplosionSound } from './dynamiteExplosionSound'
import { createGameSounds } from './gameSounds'
import {
  acquireHandLandmarker,
  getVideoElement,
  fingertipPadLandmark,
  landmarkToWorld,
  ndcToWorld,
  type HandLandmarks,
} from './handTracker'

export interface ArObjectModuleOptions {
  mode?: ArObjectMode
  onPop?: () => void
  onLost?: () => void
  onGameOver?: () => void
}

export interface ArObjectHandle {
  module: CameraPipelineModule
  startGame: () => void
  dispose: () => void
}

const OBJECT_COUNT = 8
const EXPLODE_MS = 520
const MEGA_EXPLODE_MS = 1400
const PARTICLES_PER_POP = 18
const MEGA_PARTICLES = 40
const SPAWN_GRACE_MS = 450
const DYNAMITE_CHANCE = 0.14

const DYNAMITE_SPEC = { size: 0.034, speed: 0.22 } as const

/** Balloon-only tuning — bigger on screen, wider spawn band. */
const BALLOON_SIZE_SCALE = 2.45
const DYNAMITE_SIZE_SCALE = 2.2
const BALLOON_SPAWN_X = 0.78
/** Start above the top edge (NDC y>1) so objects fall into view — never pop mid-screen. */
const BALLOON_SPAWN_Y = { min: 1.06, max: 1.34 }
const BALLOON_ENTER_Y = 0.98
const BALLOON_NDC_X_CLAMP = 0.82
const BUBBLE_SPAWN_X = 0.68
const BUBBLE_SPAWN_Y = { min: 0.72, max: 1.08 }
const SIZE_REF = 0.028
/** Balloons fall at a comfortable pace; dynamite faster but not extreme. */
const BALLOON_FALL_MULT = 0.92
const DYNAMITE_FALL_MULT = 1.38
/** Fingertip pad hit — generous enough to pop reliably. */
const FINGERTIP_PAD_FRAC = 0.028

const SPAWN_STAGGER_MS = { min: 400, max: 1200 }

/** Bigger objects fall slower; returns NDC-units per second. */
const fallSpeedForSize = (size: number, isBalloon: boolean) => {
  const speed = 0.19 * Math.pow(SIZE_REF / size, 0.62)
  return speed * (isBalloon ? 0.72 : 1)
}

let latexTexture: THREE.CanvasTexture | null = null

const createLatexTexture = () => {
  if (latexTexture) return latexTexture
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size * 0.38, size * 0.32, 0, size * 0.5, size * 0.5, size * 0.55)
  grad.addColorStop(0, 'rgba(255,255,255,0.35)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  grad.addColorStop(1, 'rgba(0,0,0,0.18)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22
    img.data[i] = Math.max(0, Math.min(255, 128 + n))
    img.data[i + 1] = Math.max(0, Math.min(255, 128 + n))
    img.data[i + 2] = Math.max(0, Math.min(255, 128 + n))
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  latexTexture = new THREE.CanvasTexture(canvas)
  latexTexture.colorSpace = THREE.SRGBColorSpace
  return latexTexture
}

/** Maps world radius to pop sound pitch/volume (larger → deeper & louder). */
const popSoundScale = (radius: number, faceDist: number, isBalloon: boolean) => {
  const ref = faceDist * SIZE_REF * (isBalloon ? BALLOON_SIZE_SCALE * 1.12 : 1)
  return Math.min(2.5, Math.max(0.35, radius / ref))
}

const IRIDESCENCE = [0x88ccff, 0xff88cc, 0xccff88, 0xffcc88] as const

const OBJECT_SPECS = [
  { film: 0xff3b6a, rim: 0xff8fab, size: 0.018, speed: 0.22 },
  { film: 0x00b4d8, rim: 0x90e0ef, size: 0.034, speed: 0.09 },
  { film: 0xffd60a, rim: 0xfff3a3, size: 0.026, speed: 0.18 },
  { film: 0x9b5de5, rim: 0xe0aaff, size: 0.042, speed: 0.07 },
  { film: 0x06d6a0, rim: 0x95ffc9, size: 0.022, speed: 0.2 },
  { film: 0xff6b35, rim: 0xffb48a, size: 0.038, speed: 0.11 },
  { film: 0x4cc9f0, rim: 0xbde0fe, size: 0.015, speed: 0.25 },
  { film: 0xf72585, rim: 0xff99c8, size: 0.031, speed: 0.14 },
] as const

type ObjectSpec = (typeof OBJECT_SPECS)[number]

interface Particle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
}

interface VisualRefs {
  highlight: THREE.Mesh
  specular2?: THREE.Mesh
  iridescence?: THREE.Mesh[]
}

interface Floater {
  group: THREE.Group
  normalVisual: THREE.Group
  dynamiteVisual: THREE.Group
  fuseSpark: THREE.Mesh
  fuseGlow: THREE.Mesh | null
  visuals: VisualRefs
  spec: ObjectSpec
  kind: 'normal' | 'dynamite'
  ndcX: number
  ndcY: number
  depth: number
  radius: number
  fallSpeed: number
  nextSpawnAt: number
  driftPhase: number
  wobblePhase: number
  wobbleAmp: number
  pulsePhase: number
  swayPhase: number
  alive: boolean
  exploding: boolean
  explodeStart: number
  spawnedAt: number
  particles: Particle[]
}

interface MegaBurst {
  start: number
  position: THREE.Vector3
  shockwave: THREE.Mesh
  flash: THREE.Mesh
  particles: Particle[]
}

/** @deprecated Use createArObjectModule */
export const createBubbleModule = createArObjectModule

export function createArObjectModule(
  getXrScene: () => XRScene | null,
  getFaceDistance: () => number,
  options: ArObjectModuleOptions = {},
): ArObjectHandle {
  const mode = options.mode ?? AR_OBJECT_MODE

  let root: THREE.Group | null = null
  let floaters: Floater[] = []
  let megaBurst: MegaBurst | null = null
  let gameOver = false
  let landmarker: Awaited<ReturnType<typeof acquireHandLandmarker>> = null
  let video: HTMLVideoElement | null = null
  let lastVideoTime = -1
  let lastFrameTime = performance.now()
  let disposed = false
  let cachedHands: HandLandmarks[] = []
  const popSound = createBubblePopSound()
  const boomSound = createDynamiteExplosionSound()
  const gameSounds = createGameSounds()
  let gameActive = false

  const worldPos = new THREE.Vector3()
  const fingertipHitWorld = new THREE.Vector3()
  const scratch = new THREE.Vector3()
  const camDir = new THREE.Vector3()

  const createBubbleMesh = (spec: ObjectSpec, index: number): THREE.Group => {
    const group = new THREE.Group()
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 40, 40),
        new THREE.MeshBasicMaterial({ color: spec.film, transparent: true, opacity: 0.28, depthWrite: false }),
      ),
    )
    const innerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 28, 28),
      new THREE.MeshBasicMaterial({ color: spec.rim, transparent: true, opacity: 0.14, depthWrite: false }),
    )
    innerGlow.position.y = -0.08
    group.add(innerGlow)
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1, 40, 40),
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          metalness: 0.02,
          roughness: 0.015,
          transmission: 0.98,
          thickness: 0.18,
          ior: 1.33,
          attenuationColor: new THREE.Color(spec.film),
          attenuationDistance: 0.4,
          transparent: true,
          opacity: 0.38,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          specularIntensity: 1,
          depthWrite: false,
        }),
      ),
    )
    for (let i = 0; i < IRIDESCENCE.length; i++) {
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.01 + i * 0.015, 32, 32),
          new THREE.MeshBasicMaterial({
            color: IRIDESCENCE[(index + i) % IRIDESCENCE.length],
            transparent: true,
            opacity: 0.07,
            depthWrite: false,
            side: THREE.BackSide,
          }),
        ),
      )
    }
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.05, 32, 32),
        new THREE.MeshBasicMaterial({
          color: spec.rim,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          side: THREE.BackSide,
        }),
      ),
    )
    const highlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    )
    group.add(highlight)
    const specular2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
    )
    group.add(specular2)
    return group
  }

  const createBalloonMesh = (spec: ObjectSpec): THREE.Group => {
    const group = new THREE.Group()

    const profile = [
      new THREE.Vector2(0.055, -0.62),
      new THREE.Vector2(0.1, -0.48),
      new THREE.Vector2(0.16, -0.28),
      new THREE.Vector2(0.36, 0.02),
      new THREE.Vector2(0.44, 0.32),
      new THREE.Vector2(0.36, 0.52),
      new THREE.Vector2(0.14, 0.68),
      new THREE.Vector2(0.05, 0.74),
    ]
    const body = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 40),
      new THREE.MeshPhysicalMaterial({
        color: spec.film,
        map: createLatexTexture(),
        roughness: 0.35,
        metalness: 0.02,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
        sheen: 0.3,
        sheenRoughness: 0.4,
        emissive: new THREE.Color(spec.film),
        emissiveIntensity: 0.05,
      }),
    )
    body.position.y = 0.08
    group.add(body)

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.09, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: spec.film, roughness: 0.5, metalness: 0.02 }),
    )
    neck.position.y = -0.52
    group.add(neck)

    const knot = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x1e1410, roughness: 0.85, metalness: 0.05 }),
    )
    knot.scale.set(1.1, 0.65, 1.1)
    knot.position.y = -0.6
    group.add(knot)

    const stringMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.9, metalness: 0 })
    const stringSegs = [
      [0.0, -0.72, 0.0],
      [0.02, -0.88, 0.01],
      [-0.01, -1.02, -0.01],
      [0.015, -1.16, 0.02],
      [-0.02, -1.3, -0.015],
    ]
    for (let i = 0; i < stringSegs.length - 1; i++) {
      const a = new THREE.Vector3(...stringSegs[i])
      const b = new THREE.Vector3(...stringSegs[i + 1])
      const mid = a.clone().add(b).multiplyScalar(0.5)
      const len = a.distanceTo(b)
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, len, 5), stringMat)
      seg.position.copy(mid)
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
      group.add(seg)
    }

    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, depthWrite: false }),
    )
    shine.name = 'shine'
    shine.position.set(-0.22, 0.38, 0.28)
    group.add(shine)

    const spec2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }),
    )
    spec2.name = 'spec2'
    spec2.position.set(0.18, 0.1, -0.22)
    group.add(spec2)

    const innerHull = new THREE.Mesh(
      new THREE.LatheGeometry(profile.map((p) => p.clone().multiplyScalar(0.92)), 32),
      new THREE.MeshBasicMaterial({
        color: spec.rim,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    )
    innerHull.position.y = 0.08
    group.add(innerHull)

    const rimShade = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    )
    rimShade.position.set(0.12, -0.05, -0.2)
    group.add(rimShade)

    return group
  }

  const createDynamiteVisual = (): { group: THREE.Group; fuseSpark: THREE.Mesh; fuseGlow: THREE.Mesh } => {
    const group = new THREE.Group()

    const stickColors = [0xb81818, 0xc41e1e, 0xa01515]
    const stickAngles = [-0.28, 0, 0.32]

    for (let i = 0; i < 3; i++) {
      const stickGroup = new THREE.Group()
      stickGroup.rotation.z = stickAngles[i]
      stickGroup.position.x = (i - 1) * 0.1

      const stickMat = new THREE.MeshStandardMaterial({
        color: stickColors[i],
        roughness: 0.72,
        metalness: 0.03,
      })
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.17, 1.08, 14), stickMat)
      stickGroup.add(stick)

      const capMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.85 })
      const topCap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat)
      topCap.position.y = 0.54
      stickGroup.add(topCap)
      const botCap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), capMat)
      botCap.position.y = -0.54
      stickGroup.add(botCap)

      if (i === 1) {
        const label = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.42, 0.01),
          new THREE.MeshStandardMaterial({ color: 0xf0d060, roughness: 0.6 }),
        )
        label.position.set(0.175, 0.05, 0)
        label.rotation.z = 0.08
        stickGroup.add(label)
      }

      group.add(stickGroup)
    }

    for (const y of [0.18, -0.22]) {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.09, 14),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.55, metalness: 0.2 }),
      )
      band.position.y = y
      group.add(band)
    }

    const twine = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.028, 6, 18),
      new THREE.MeshStandardMaterial({ color: 0xc9a66b, roughness: 0.95 }),
    )
    twine.rotation.x = Math.PI / 2
    twine.position.y = 0.02
    group.add(twine)

    const fusePoints = [
      new THREE.Vector3(0, 0.58, 0),
      new THREE.Vector3(0.04, 0.72, 0.02),
      new THREE.Vector3(0.08, 0.86, 0.01),
      new THREE.Vector3(0.1, 0.98, -0.01),
    ]
    const fuseCurve = new THREE.CatmullRomCurve3(fusePoints)
    const fuse = new THREE.Mesh(
      new THREE.TubeGeometry(fuseCurve, 12, 0.028, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x5c3d22, roughness: 0.92 }),
    )
    group.add(fuse)

    const fuseGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.35, depthWrite: false }),
    )
    fuseGlow.position.copy(fusePoints[3])
    group.add(fuseGlow)

    const fuseSpark = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffee55, transparent: true, opacity: 0.95, depthWrite: false }),
    )
    fuseSpark.position.copy(fusePoints[3]).y += 0.04
    group.add(fuseSpark)

    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.8, depthWrite: false }),
    )
    ember.position.copy(fuseSpark.position).add(new THREE.Vector3(0.03, 0.02, 0))
    group.add(ember)

    return { group, fuseSpark, fuseGlow }
  }

  const createNormalVisual = (spec: ObjectSpec, index: number) =>
    mode === 'balloon' ? createBalloonMesh(spec) : createBubbleMesh(spec, index)

  const extractVisuals = (normalVisual: THREE.Group): VisualRefs => {
    if (mode === 'balloon') {
      const shine = normalVisual.getObjectByName('shine') as THREE.Mesh | undefined
      return { highlight: shine ?? (normalVisual.children[4] as THREE.Mesh) }
    }
    const children = normalVisual.children
    return {
      highlight: children[children.length - 2] as THREE.Mesh,
      specular2: children[children.length - 1] as THREE.Mesh,
    }
  }

  const createParticleMesh = (color: number, flat = false): THREE.Mesh => {
    const geometry = flat
      ? new THREE.PlaneGeometry(1, 0.55)
      : new THREE.SphereGeometry(1, 8, 8)
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    if (flat) mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    return mesh
  }

  const rollKind = (allowDynamite: boolean): 'normal' | 'dynamite' =>
    allowDynamite && !gameOver && Math.random() < DYNAMITE_CHANCE ? 'dynamite' : 'normal'

  const scheduleSpawn = (floater: Floater, delayMs = 0) => {
    floater.alive = false
    floater.group.visible = false
    floater.nextSpawnAt =
      performance.now() +
      delayMs +
      SPAWN_STAGGER_MS.min +
      Math.random() * (SPAWN_STAGGER_MS.max - SPAWN_STAGGER_MS.min)
  }

  const spawnFloater = (
    floater: Floater,
    xrScene: XRScene,
    forceNormal = false,
  ) => {
    floater.kind = forceNormal ? 'normal' : rollKind(true)
    const isDynamite = floater.kind === 'dynamite'

    const depth = getFaceDistance() * (0.86 + (isDynamite ? DYNAMITE_SPEC.size : floater.spec.size) * 3.2)
    floater.depth = depth
    floater.radius =
      depth *
      (isDynamite
        ? DYNAMITE_SPEC.size * DYNAMITE_SIZE_SCALE
        : floater.spec.size * (mode === 'balloon' ? BALLOON_SIZE_SCALE * 1.12 : 1))
    floater.fallSpeed = isDynamite
      ? DYNAMITE_SPEC.speed
      : fallSpeedForSize(floater.spec.size, mode === 'balloon')

    const spawnX = mode === 'balloon' ? BALLOON_SPAWN_X : BUBBLE_SPAWN_X
    const spawnY = mode === 'balloon' ? BALLOON_SPAWN_Y : BUBBLE_SPAWN_Y
    floater.ndcX = (Math.random() - 0.5) * 2 * spawnX
    floater.ndcY = spawnY.min + Math.random() * (spawnY.max - spawnY.min)

    floater.nextSpawnAt = 0
    floater.wobblePhase = Math.random() * Math.PI * 2
    floater.wobbleAmp =
      0.008 +
      floater.spec.size *
        (isDynamite ? 0.08 : mode === 'balloon' ? 0.22 : 0.25)
    floater.swayPhase = Math.random() * Math.PI * 2
    floater.driftPhase = Math.random() * Math.PI * 2
    floater.alive = !gameOver
    floater.exploding = false
    floater.explodeStart = 0
    floater.spawnedAt = performance.now()

    floater.normalVisual.visible = !isDynamite
    floater.dynamiteVisual.visible = isDynamite

    for (const p of floater.particles) {
      p.mesh.visible = false
      p.life = 0
    }
    // Hidden until above-screen spawn crosses into the viewport.
    floater.group.visible = !gameOver && floater.ndcY <= BALLOON_ENTER_Y
    placeFloater(floater, xrScene, 0)
  }

  const placeFloater = (floater: Floater, xrScene: XRScene, time: number) => {
    const isDynamite = floater.kind === 'dynamite'
    const driftScale = isDynamite ? 0.22 : mode === 'balloon' ? 0.75 : 1
    let wobbleX =
      floater.ndcX +
      Math.sin(time * (isDynamite ? 2.8 : 1.4) + floater.wobblePhase) * floater.wobbleAmp * driftScale
    const wobbleY =
      floater.ndcY +
      Math.cos(time * (isDynamite ? 3.2 : 1.0) + floater.wobblePhase) * floater.wobbleAmp * 0.35
    if (mode === 'balloon' && !isDynamite) {
      wobbleX = Math.max(-BALLOON_NDC_X_CLAMP, Math.min(BALLOON_NDC_X_CLAMP, wobbleX))
    }
    ndcToWorld(wobbleX, wobbleY, floater.depth, xrScene, worldPos)
    floater.group.position.copy(worldPos)

    if (floater.kind === 'dynamite') {
      const pulse = 1 + Math.sin(time * 8) * 0.04
      floater.group.scale.setScalar(floater.radius * pulse)
      floater.group.rotation.z = Math.sin(time * 5.5 + floater.swayPhase) * 0.28
      const sparkMat = floater.fuseSpark.material as THREE.MeshBasicMaterial
      sparkMat.opacity = 0.5 + Math.sin(time * 26) * 0.5
      sparkMat.color.setHex(Math.sin(time * 20) > 0 ? 0xfff0aa : 0xff6600)
      if (floater.fuseGlow) {
        const glowMat = floater.fuseGlow.material as THREE.MeshBasicMaterial
        glowMat.opacity = 0.2 + Math.sin(time * 18) * 0.2
        floater.fuseGlow.scale.setScalar(1 + Math.sin(time * 22) * 0.25)
      }
      return
    }

    if (mode === 'balloon') {
      const sway = Math.sin(time * 1.1 + floater.swayPhase) * 0.22
      floater.group.rotation.z = sway
      floater.group.scale.setScalar(floater.radius)
      camDir.copy(worldPos).sub(xrScene.camera.position).normalize()
      floater.visuals.highlight.position
        .copy(camDir)
        .multiplyScalar(0.36)
        .add(new THREE.Vector3(0, 0.12, 0))
      const spec2 = floater.normalVisual.getObjectByName('spec2') as THREE.Mesh | undefined
      if (spec2) {
        spec2.position
          .copy(camDir)
          .multiplyScalar(-0.28)
          .add(new THREE.Vector3(0.1, -0.05, -0.15))
      }
      return
    }

    const pulse = 1 + Math.sin(time * 2.4 + floater.pulsePhase) * 0.035
    const squash = 1 + Math.sin(time * 3.1 + floater.pulsePhase) * 0.02
    floater.group.scale.set(floater.radius * pulse, floater.radius * squash, floater.radius * pulse)
    camDir.copy(worldPos).sub(xrScene.camera.position).normalize()
    floater.visuals.highlight.position.copy(camDir).multiplyScalar(0.46)
    floater.visuals.specular2?.position
      .copy(camDir)
      .multiplyScalar(0.38)
      .add(new THREE.Vector3(0.12, -0.18, 0.08))
  }

  const buildScene = () => {
    const xrScene = getXrScene()
    if (!xrScene) return

    root = new THREE.Group()
    root.renderOrder = 10

    xrScene.scene.add(
      new THREE.HemisphereLight(0xffffff, 0x99aabb, 1.6),
      new THREE.DirectionalLight(0xffffff, 1.1),
      new THREE.DirectionalLight(0xaaccff, 0.35),
    )

    floaters = []
    for (let i = 0; i < OBJECT_COUNT; i++) {
      const spec = OBJECT_SPECS[i]
      const normalVisual = createNormalVisual(spec, i)
      const visuals = extractVisuals(normalVisual)
      const { group: dynamiteVisual, fuseSpark, fuseGlow } = createDynamiteVisual()
      dynamiteVisual.visible = false

      const group = new THREE.Group()
      group.add(normalVisual, dynamiteVisual)

      const particles: Particle[] = []
      for (let p = 0; p < PARTICLES_PER_POP; p++) {
        const mesh = createParticleMesh(spec.film, mode === 'balloon' ? p % 2 === 0 : p % 3 === 0)
        mesh.visible = false
        root.add(mesh)
        particles.push({ mesh, velocity: new THREE.Vector3(), life: 0 })
      }
      root.add(group)

      const floater: Floater = {
        group,
        normalVisual,
        dynamiteVisual,
        fuseSpark,
        fuseGlow,
        visuals,
        spec,
        kind: 'normal',
        ndcX: 0,
        ndcY: 0,
        depth: 0.3,
        radius: 0.02,
        fallSpeed: spec.speed,
        nextSpawnAt: 0,
        driftPhase: 0,
        wobblePhase: 0,
        wobbleAmp: 0.01,
        pulsePhase: Math.random() * Math.PI * 2,
        swayPhase: 0,
        alive: false,
        exploding: false,
        explodeStart: 0,
        spawnedAt: 0,
        particles,
      }
      floater.group.visible = false
      floaters.push(floater)
    }

    xrScene.scene.add(root)
  }

  const startGame = () => {
    gameActive = true
    const xrScene = getXrScene()
    if (!xrScene) return
    for (let i = 0; i < floaters.length; i++) {
      scheduleSpawn(floaters[i], i * 350)
    }
  }

  const startMegaExplosion = (pos: THREE.Vector3, radius: number, now: number) => {
    if (!root || megaBurst) return
    gameOver = true
    boomSound.play()
    options.onGameOver?.()

    for (const floater of floaters) {
      floater.alive = false
      floater.group.visible = false
    }

    const shockwave = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    )
    shockwave.position.copy(pos)
    shockwave.scale.setScalar(radius * 0.5)
    root.add(shockwave)

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffffcc,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    )
    flash.position.copy(pos)
    flash.scale.setScalar(radius * 0.2)
    root.add(flash)

    const fireColors = [0xff4400, 0xffaa00, 0xff2200, 0x888888, 0x333333]
    const particles: Particle[] = []
    for (let i = 0; i < MEGA_PARTICLES; i++) {
      const mesh = createParticleMesh(fireColors[i % fireColors.length], i % 4 === 0)
      mesh.visible = true
      mesh.position.copy(pos)
      mesh.scale.setScalar(radius * (0.2 + Math.random() * 0.5))
      root.add(mesh)
      scratch
        .set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(radius * (6 + Math.random() * 10))
      particles.push({ mesh, velocity: scratch.clone(), life: 1 })
    }

    megaBurst = { start: now, position: pos.clone(), shockwave, flash, particles }
  }

  const updateMegaExplosion = (dt: number, now: number) => {
    if (!megaBurst) return
    const t = (now - megaBurst.start) / MEGA_EXPLODE_MS
    if (t >= 1) return

    const shockMat = megaBurst.shockwave.material as THREE.MeshBasicMaterial
    const flashMat = megaBurst.flash.material as THREE.MeshBasicMaterial
    const base = floaters[0]?.radius ?? 0.03
    megaBurst.shockwave.scale.setScalar(base * (0.5 + t * 14))
    shockMat.opacity = 0.75 * (1 - t)
    megaBurst.flash.scale.setScalar(base * (0.2 + t * 10))
    flashMat.opacity = 0.95 * Math.max(0, 1 - t * 2.5)

    for (const p of megaBurst.particles) {
      p.mesh.position.addScaledVector(p.velocity, dt)
      p.velocity.y -= base * 8 * dt
      p.velocity.multiplyScalar(1 - dt * 0.35)
      p.life = 1 - t
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = p.life * 0.9
      p.mesh.scale.multiplyScalar(1 + dt * 0.4)
    }
  }

  const explodeFloater = (floater: Floater, now: number) => {
    if (floater.kind === 'dynamite') {
      worldPos.copy(floater.group.position)
      startMegaExplosion(worldPos, floater.radius, now)
      return
    }

    floater.exploding = true
    floater.explodeStart = now
    floater.group.visible = false
    options.onPop?.()
    popSound.play(popSoundScale(floater.radius, getFaceDistance(), mode === 'balloon'))

    worldPos.copy(floater.group.position)
    const popScale = floater.radius

    for (const p of floater.particles) {
      scratch
        .set(Math.random() - 0.5, Math.random() - 0.15, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(popScale * (2.8 + Math.random() * 5))
      p.velocity.copy(scratch)
      p.life = 1
      p.mesh.position.copy(worldPos)
      p.mesh.scale.setScalar(popScale * (0.12 + Math.random() * 0.3))
      p.mesh.visible = true
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = 0.92
      mat.color.setHex(Math.random() > 0.5 ? floater.spec.film : floater.spec.rim)
    }
  }

  const updateExplosion = (floater: Floater, dt: number, now: number) => {
    const t = (now - floater.explodeStart) / EXPLODE_MS
    if (t >= 1) {
      floater.exploding = false
      scheduleSpawn(floater)
      return
    }

    for (const p of floater.particles) {
      if (p.life <= 0) continue
      p.mesh.position.addScaledVector(p.velocity, dt)
      p.velocity.y -= floater.radius * 5 * dt
      p.velocity.multiplyScalar(1 - dt * 0.6)
      p.life = 1 - t
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = p.life * 0.8
      p.mesh.scale.multiplyScalar(1 + dt * 0.5)
    }
  }

  const fingertipPadLm = { x: 0, y: 0, z: 0 }

  const fingertipHitsFloater = (
    landmarks: HandLandmarks,
    floater: Floater,
    xrScene: XRScene,
    now: number,
  ): boolean => {
    if (now - floater.spawnedAt < SPAWN_GRACE_MS) return false
    if (!video) return false

    fingertipPadLandmark(landmarks, fingertipPadLm)
    landmarkToWorld(fingertipPadLm, floater.depth, xrScene, video, fingertipHitWorld)

    const padRadius = getFaceDistance() * FINGERTIP_PAD_FRAC
    const touchSlop = floater.radius * (floater.kind === 'dynamite' ? 0.28 : 0.48)
    return fingertipHitWorld.distanceTo(floater.group.position) < padRadius + touchSlop
  }

  const tryPop = (xrScene: XRScene, now: number) => {
    if (gameOver || !gameActive || !video || cachedHands.length === 0) return

    for (const landmarks of cachedHands) {
      for (const floater of floaters) {
        if (!floater.alive || floater.exploding) continue
        if (fingertipHitsFloater(landmarks, floater, xrScene, now)) {
          explodeFloater(floater, now)
          break
        }
      }
    }
  }

  const module: CameraPipelineModule = {
    name: mode === 'balloon' ? 'balloons' : 'bubbles',
    onStart: () => {
      buildScene()
      void acquireHandLandmarker().then((lm) => {
        landmarker = lm
      })
    },
    onUpdate: () => {
      if (disposed || !root) return
      const xrScene = getXrScene()
      if (!xrScene) return

      const now = performance.now()
      const dt = Math.min((now - lastFrameTime) / 1000, 0.05)
      lastFrameTime = now
      const time = now / 1000

      const vid = getVideoElement()
      if (vid && vid.readyState >= 2 && vid.videoWidth > 0) video = vid

      if (!landmarker) {
        void acquireHandLandmarker().then((lm) => {
          landmarker = lm
        })
      }

      if (megaBurst) {
        updateMegaExplosion(dt, now)
        return
      }

      if (gameOver) return

      if (!gameActive) {
        if (landmarker && video) {
          const newFrame = video.currentTime !== lastVideoTime
          if (newFrame) {
            lastVideoTime = video.currentTime
            const result = landmarker.detectForVideo(video, now)
            cachedHands = result.landmarks
          }
        }
        return
      }

      for (const floater of floaters) {
        if (floater.exploding) {
          updateExplosion(floater, dt, now)
          continue
        }

        if (!floater.alive) {
          if (now >= floater.nextSpawnAt) {
            spawnFloater(floater, xrScene)
            placeFloater(floater, xrScene, time)
          }
          continue
        }

        const isDynamite = floater.kind === 'dynamite'
        const fallRate = isDynamite
          ? floater.fallSpeed * DYNAMITE_FALL_MULT
          : floater.fallSpeed * BALLOON_FALL_MULT
        floater.ndcY -= fallRate * dt

        if (mode === 'balloon' && !isDynamite) {
          const clamp = BALLOON_NDC_X_CLAMP
          floater.ndcX = Math.max(-clamp, Math.min(clamp, floater.ndcX))
        }

        if (mode === 'balloon' && floater.ndcY <= BALLOON_ENTER_Y) {
          floater.group.visible = !gameOver
        }

        const offBottom = floater.ndcY < -1.15
        const offBottomBubble = mode !== 'balloon' && floater.ndcY < -1.15

        if (offBottom || offBottomBubble) {
          if (floater.kind === 'dynamite') {
            scheduleSpawn(floater)
          } else {
            gameSounds.playMiss()
            options.onLost?.()
            scheduleSpawn(floater)
          }
        } else {
          placeFloater(floater, xrScene, time)
        }
      }

      if (landmarker && video) {
        const newFrame = video.currentTime !== lastVideoTime
        if (newFrame) {
          lastVideoTime = video.currentTime
          const result = landmarker.detectForVideo(video, now)
          cachedHands = result.landmarks
        }
      }

      tryPop(xrScene, now)
    },
    onException: () => {},
  }

  const dispose = () => {
    disposed = true
    gameActive = false
    cachedHands = []
    popSound.dispose()
    boomSound.dispose()
    gameSounds.dispose()
    latexTexture?.dispose()
    latexTexture = null
    const xrScene = getXrScene()
    if (root) {
      xrScene?.scene.remove(root)
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) material.dispose()
        }
      })
    }
    root = null
    floaters = []
    megaBurst = null
    landmarker = null
    video = null
  }

  return { module, startGame, dispose }
}
