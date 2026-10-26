import type { VisualFilter } from '../visual/types.js'
import type { BoundsMm, EdgeStyle, MaterialRef, Note, PointMm, Prop, StyleTheme, SurfaceStyle, TerrainEdge } from '../model/scene.js'

export type Audience = 'gm' | 'player'
export interface ProjectedSurface { id: string; points: PointMm[]; style: SurfaceStyle | null; elevationMm: number; priority: number }
export interface ProjectedTerrainEdge { id: string; start: PointMm; end: PointMm; sourceAreaId: string; neighborAreaId: string | null; elevationMm: number; neighborElevationMm: number; kind: TerrainEdge['kind']; shoreline: boolean; style: EdgeStyle; surfaceStyle: SurfaceStyle | null }
export interface ProjectedPath { id: string; points: PointMm[]; style: SurfaceStyle | null; edgeStyle: EdgeStyle }
export interface ProjectedConnection { id: string; kind: 'stairs' | 'ramp'; start: PointMm; end: PointMm; widthMm: number; fromElevationMm: number; toElevationMm: number; blocksMovement: boolean; style: SurfaceStyle | null }
export interface ProjectedOpening { id: string; start: PointMm; end: PointMm; widthMm: number; kind: 'door' | 'window'; state: 'open' | 'closed'; secret: boolean; /** Editor-only symbol suppression preserves the physical wall hole. */ paintSymbol?: boolean }
export interface ProjectedWall { id: string; sourceIds: string[]; /** Added only to visual-v2 projections. */ blocksLight?: boolean; start: PointMm; end: PointMm; thicknessMm: number; style: SurfaceStyle | null; openings: ProjectedOpening[] }
export interface ProjectedNote { id: string; positionMm: PointMm; text: string; kind: Note['kind']; visibility: 'gm' | 'public' }
export interface ProjectedRegion { id: string; points: PointMm[]; kind: 'terrain' | 'hazard' }
/** Disposable visual data. In particular, a player projection has no source document or hidden definitions. */
export interface Projection {
  audience: Audience; sourceRevision: number; bounds: BoundsMm; gridSizeMm: number | null
  rooms: ProjectedSurface[]; terrain: ProjectedSurface[]; walls: ProjectedWall[]
  /** Canonical ground/object/canopy, renderOrder, id order; independent copies of source props. */
  props: Prop[]
  edges: ProjectedTerrainEdge[]; paths: ProjectedPath[]; connections: ProjectedConnection[]
  /** Audience-filtered C4 band choice survives GM-only temporary path hiding. */
  pathPaintOrder?: 'over-room-before-connection'
  /** Disposable symbol-band order; only projected public IDs appear in player output. */
  openingPaintOrder?: string[]
  notes: ProjectedNote[]; regions: ProjectedRegion[]; masks: PointMm[][]
  theme: Pick<StyleTheme, 'outline' | 'openingStyle' | 'shadowPresets' | 'edgeStyles' | 'terrainCliff'> | null
  materials: Record<string, Pick<MaterialRef, 'id' | 'version' | 'textureAssetId'>>
  visual?: ProjectedVisualSystem
  assetIds: string[]; limitations: string[]; diagnostics: string[]
}

/** All members are disposable copies made after audience and editor-layer filtering. */
export interface ProjectedVisualBoundary {
  id: string
  points: PointMm[]
  samples: import('../visual/types.js').BoundarySample[]
  lengthMm: number
  closed: boolean
  /** Public, projected supports only; no hidden relationship metadata is retained. */
  terrainAreaIds: string[]
}
export interface ProjectedVisualFilter extends Omit<VisualFilter, 'target' | 'floorId' | 'layerId' | 'visibility' | 'editLocked'> {
  /** null means the entire scene. Other targets are frozen to visible geometry now. */
  targetRings: PointMm[][] | null
  /** Entities/layers are filtered before compositing; scene/region filters are applied to the final picture. */
  sourceEntityIds?: string[]
  targetBoundsMm: BoundsMm
  /** Derived world-space inward falloff for regional grades only. */
  regionFeatherMm?: number
}
export interface ProjectedVisualSystem {
  environment: import('../visual/types.js').VisualEnvironment
  /** Stable export bounds, independent of temporary editor crop. */
  boundsMm: BoundsMm
  boundaries: ProjectedVisualBoundary[]
  edgeLooks: import('../visual/types.js').VisualEdgeLook[]
  lights: import('../visual/types.js').VisualLight[]
  fogs: import('../visual/types.js').VisualFog[]
  filters: ProjectedVisualFilter[]
  /** Full visible physical occluders and contact footprints, independent of editor LOD/crop. */
  occluderRings: PointMm[][]
  contactRings: PointMm[][]
  /** Default edge paint replaced by continuous boundary decoration. */
  suppressedTerrainEdgeIds: string[]
}
