import type { PointMm, Visibility } from '../model/scene.js'

/** A persisted, bounded visual system. Curves own their sampled terrain/path geometry. */
export interface VisualEntity {
  id: string
  floorId: string
  layerId: string
  visibility: Visibility
  editLocked: boolean
}
export interface CubicSegment {
  id: string
  start: PointMm
  control1: PointMm
  control2: PointMm
  end: PointMm
}
export interface TerrainBoundarySide {
  areaId: string
  /** Directed, inclusive chain on the area's positive-winding ring. */
  startPointId: string
  endPointId: string
  /** The area's directed chain is the reverse of the curve's sample order. */
  reverse: boolean
}
export type BoundaryBinding =
  | { kind: 'terrain'; sides: TerrainBoundarySide[] }
  | { kind: 'path'; pathId: string }
  | { kind: 'decoration' }
export interface VisualBoundary extends VisualEntity {
  closed: boolean
  segments: CubicSegment[]
  /** Deterministic, view-independent subdivision parameters, in world millimetres. */
  sampleSpacingMm: number
  toleranceMm: number
  binding: BoundaryBinding
}
export interface VisualEdgeLook extends VisualEntity {
  boundaryId: string
  kind: 'shore' | 'cliff' | 'grass' | 'path' | 'fence'
  side: 'left' | 'right' | 'both'
  widthMm: number
  color: string
  accentColor: string
  opacity: number
  intensity: number
  seed: string
  repeatMm: number
  enabled: boolean
}
export interface VisualLight extends VisualEntity {
  positionMm: PointMm
  radiusMm: number
  color: string
  intensity: number
  wallOcclusion: boolean
  enabled: boolean
}
export interface VisualFog extends VisualEntity {
  boundaryMm: PointMm[]
  color: string
  opacity: number
  directionDeg: number
  scaleMm: number
  seed: string
  enabled: boolean
}
export type VisualFilterTarget =
  | { kind: 'scene' }
  | { kind: 'region'; boundaryMm: PointMm[] }
  | { kind: 'entities'; ids: string[] }
  | { kind: 'layer'; layerId: string }
export interface VisualFilter extends VisualEntity {
  target: VisualFilterTarget
  preset: 'neutral' | 'warm' | 'cool' | 'aged' | 'moonlight'
  exposure: number
  saturation: number
  contrast: number
  vignette: number
  grain: number
  seed: string
  enabled: boolean
}
export interface VisualEnvironment {
  ambientColor: string
  ambientOpacity: number
  exposure: number
  lightDirectionDeg: number
  contactShadowMm: number
  contactShadowOpacity: number
}
export interface VisualSystem {
  version: 1
  boundaries: Record<string, VisualBoundary>
  edgeLooks: Record<string, VisualEdgeLook>
  lights: Record<string, VisualLight>
  fogs: Record<string, VisualFog>
  filters: Record<string, VisualFilter>
  environment: VisualEnvironment
}
export interface BoundarySample { positionMm: PointMm; distanceMm: number; tangent: PointMm; normal: PointMm }
export interface SampledBoundary { points: PointMm[]; samples: BoundarySample[]; lengthMm: number; closed: boolean }
export const VISUAL_LIMITS = Object.freeze({ boundaries: 64, segmentsPerBoundary: 32, samplesPerBoundary: 512, edgeLooks: 128,
  lights: 16, fogs: 16, filters: 16, totalSamples: 4096, totalCurveSegments: 256, regionPoints: 128, decorationsPerEdge: 1024 })
export function emptyVisualSystem(): VisualSystem {
  return { version: 1, boundaries: {}, edgeLooks: {}, lights: {}, fogs: {}, filters: {},
    environment: { ambientColor: '#FFFFFF', ambientOpacity: 0, exposure: 1, lightDirectionDeg: 135, contactShadowMm: 0, contactShadowOpacity: 0 } }
}
