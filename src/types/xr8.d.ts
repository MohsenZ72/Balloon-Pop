import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  w: number
  x: number
  y: number
  z: number
}

export interface FaceTransform {
  position: Vec3
  rotation: Quat
  scale: number
  scaledWidth: number
  scaledHeight: number
  scaledDepth: number
}

export interface FaceEventDetail {
  id: number
  transform: FaceTransform
  vertices: Vec3[]
  normals: Vec3[]
  attachmentPoints: Record<string, { position: Vec3 }>
}

export type CameraStatus = 'requesting' | 'hasStream' | 'hasVideo' | 'failed'

/** Per-frame camera pose emitted by the active reality source (face controller here). */
export interface RealitySource {
  rotation?: Quat
  position?: Vec3
  intrinsics?: number[]
}

export interface ProcessCpuResult {
  reality?: RealitySource
  facecontroller?: RealitySource
}

export interface PipelineStartArgs {
  canvas: HTMLCanvasElement
  canvasWidth: number
  canvasHeight: number
  GLctx: WebGLRenderingContext
}

export interface CameraPipelineModule {
  name: string
  onStart?: (args: PipelineStartArgs) => void
  onAttach?: (args: PipelineStartArgs) => void
  onDetach?: () => void
  onUpdate?: (args: { processCpuResult: ProcessCpuResult }) => void
  onRender?: () => void
  onCanvasSizeChange?: (args: { canvasWidth: number; canvasHeight: number }) => void
  onCameraStatusChange?: (args: { status: CameraStatus }) => void
  onException?: (error: unknown) => void
  listeners?: Array<{
    event: string
    process: (event: { detail: FaceEventDetail }) => void
  }>
}

export interface XRScene {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
}

export interface FaceControllerConfig {
  nearClip?: number
  farClip?: number
  meshGeometry?: string[]
  maxDetections?: 1 | 2 | 3
  coordinates?: {
    mirroredDisplay?: boolean
    axes?: 'LEFT_HANDED' | 'RIGHT_HANDED'
    scale?: number
  }
}

export interface XR8Api {
  addCameraPipelineModules(modules: CameraPipelineModule[]): void
  clearCameraPipelineModules(): void
  loadChunk(chunk: 'face' | 'slam'): Promise<void>
  run(config: {
    canvas: HTMLCanvasElement
    cameraConfig?: { direction: string }
    allowedDevices?: string
  }): void
  stop(): void
  GlTextureRenderer: {
    pipelineModule(): CameraPipelineModule
  }
  FaceController: {
    pipelineModule(): CameraPipelineModule
    configure(config: FaceControllerConfig): void
    AttachmentPoints: Record<string, string>
    MeshGeometry: Record<string, string>
  }
  XrConfig: {
    camera(): { FRONT: string; BACK: string }
    device(): { ANY: string; MOBILE: string; MOBILE_AND_HEADSETS: string }
  }
}

declare global {
  interface Window {
    XR8?: XR8Api
    THREE?: typeof import('three')
  }
}
