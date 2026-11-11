import type { VisualFilter } from '../visual/types.js'
import type { BoundsMm, EdgeStyle, MaterialPaint, MaterialRef, Note, PointMm, Prop, StyleTheme, SurfaceStyle, TerrainEdge } from '../model/scene.js'

export type Audience = 'gm' | 'player'
/** Audience-owned paint only; rule identity, ownership and recipes never leave the domain. */
export interface ProjectedMaterialPatch {
  regionsMm: { outerMm: PointMm[]; holesMm: PointMm[][] }[]
  paint: MaterialPaint
  blendWidthMm: number
}
export interface ProjectedSurface { id: string; points: PointMm[]; style: SurfaceStyle | null; elevationMm: number; priority: number; materialPatches?: ProjectedMaterialPatch[] }
export interface ProjectedTerrainEdge { id: string; start: PointMm; end: PointMm; sourceAreaId: string; neighborAreaId: string | null; elevationMm: number; neighborElevationMm: number; kind: TerrainEdge['kind']; shoreline: boolean; style: EdgeStyle; surfaceStyle: SurfaceStyle | null }
export interface ProjectedPath { id: string; points: PointMm[]; style: SurfaceStyle | null; edgeStyle: EdgeStyle }
export interface ProjectedConnection { id: string; kind: 'stairs' | 'ramp'; start: PointMm; end: PointMm; widthMm: number; fromElevationMm: number; toElevationMm: number; blocksMovement: boolean; style: SurfaceStyle | null
  /** Only this audience's complete physical route and finite paint parameters. */
  route?: Pick<import('../geometry/connection-route.js').ConnectionRoute, 'centerlineMm' | 'stairStyle' | 'treadDepthMm' | 'renderProfile'>
  /** Disposable endpoint support IDs, included only after this audience's dependency filtering. */
  surfaceIds?: [string, string]
}
export interface ProjectedOpening { id: string; start: PointMm; end: PointMm; widthMm: number; kind: 'door' | 'window'; state: 'open' | 'closed'; secret: boolean; /** Editor-only symbol suppression preserves the physical wall hole. */ paintSymbol?: boolean }
export interface ProjectedWall { id: string; sourceIds: string[]; /** Added only to visual-v2 projections. */ blocksLight?: boolean; start: PointMm; end: PointMm; thicknessMm: number; style: SurfaceStyle | null; openings: ProjectedOpening[] }
export interface ProjectedNote { id: string; positionMm: PointMm; text: string; kind: Note['kind']; visibility: 'gm' | 'public' }
export interface ProjectedRegion { id: string; points: PointMm[]; kind: 'terrain' | 'hazard' }
/** Disposable fixed-image paint values; no source, cluster, support or manual-state metadata. */
export interface ProjectedDecoration {
  id: string; positionMm: PointMm; rotationDeg: number; visualBoundsMm: BoundsMm
  assetId: string; opacity: number; renderLayer: Prop['renderLayer']; renderOrder: number
}
export interface ProjectedRegionalArea { id: string; points: PointMm[]; kind: 'land' | 'water' | 'forest' | 'hill'; style: { fill: string; stroke: string; strokeWidthMm: number; opacity: number }; relativeElevationMm: number | null }
export interface ProjectedRegionalLine { id: string; points: PointMm[]; kind: 'river' | 'ridge' | 'road'; displayWidthMm: number; actualWidthMm: number | null; style: { fill: string; stroke: string; strokeWidthMm: number; opacity: number } }
export interface ProjectedRegionalLandmark { id: string; positionMm: PointMm; purpose: string; name: string; description: string; assetId: string; visualBoundsMm: BoundsMm; rootAnchorMm: PointMm }
export interface ProjectedRegionalSymbol { id: string; positionMm: PointMm; visualBoundsMm: BoundsMm; assetId: string; rootAnchorMm: PointMm; renderOrder: number; sourceRef: { kind: 'area' | 'line' | 'landmark'; id: string } | null }
/** Disposable visual data. In particular, a player projection has no source document or hidden definitions. */
export interface Projection {
  audience: Audience; sourceRevision: number; bounds: BoundsMm; gridSizeMm: number | null
  /** Present for an explicit target; omitted by the legacy single-Floor call. */
  floorId?: string
  /** Shared preview/export background, independent of physical ground and masks. */
  outputBackground?: import('../model/scene.js').SceneOutputBackground
  rooms: ProjectedSurface[]; terrain: ProjectedSurface[]; walls: ProjectedWall[]
  /** Canonical ground/object/canopy, renderOrder, id order; independent copies of source props. */
  props: Prop[]
  /** Strict complete6+; compact sprites remain distinct from physical Props. */
  decorations?: ProjectedDecoration[]
  /** One audience-filtered order shared by visible physical and compact sprites. */
  spritePaintOrder?: string[]
  /** Only visible near-side instances; no fixed-source or private metadata. */
  propPresentations?: Record<string, import('../appearance/presentation.js').PaintPresentation>
  /** GM editor session only; ignored by formal exports. */
  groundView?: boolean
  edges: ProjectedTerrainEdge[]; paths: ProjectedPath[]; connections: ProjectedConnection[]
  /** Same-floor/layer/elevation public paths, after audience and editor filtering.
   * Only visible IDs survive; style/filter compatibility is checked at paint time. */
  pathJoinGroups?: string[][]
  /** Disposable public path/terrain relationships after audience and editor
   * filtering. Paint-order IDs include incompatible public covers so a lower
   * matching surface cannot remove a road edge through a higher surface. */
  pathTerrainJoins?: {
    terrainPaintOrder: string[]
    roomIds: string[]
    paths: { pathId: string; terrainIds: string[] }[]
  }
  /** Audience-filtered C4 band choice survives GM-only temporary path hiding. */
  pathPaintOrder?: 'over-room-before-connection'
  /** Disposable symbol-band order; only projected public IDs appear in player output. */
  openingPaintOrder?: string[]
  notes: ProjectedNote[]; regions: ProjectedRegion[]; masks: PointMm[][]
  regional?: { areas: ProjectedRegionalArea[]; lines: ProjectedRegionalLine[]; landmarks: ProjectedRegionalLandmark[]; symbols: ProjectedRegionalSymbol[] }
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
export interface ProjectedVisualTransition {
  id: string
  floorId: string
  layerId: string
  boundaryId: string
  kind: import('../terrain-generation/composition-contracts.js').TerrainTransition['kind']
  side: import('../terrain-generation/composition-contracts.js').TerrainTransition['side']
  polygons: { pointsMm: PointMm[]; fillColor: string; opacity: number }[]
  strokes: { pointsMm: PointMm[]; widthMm: number; color: string; opacity: number }[]
  widthMm: number
  enabled: boolean
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
  materializedEdges?: (Pick<import('../terrain-generation/contracts.js').MaterializedEdge,'id'|'kind'|'polygons'|'strokes'|'fillColor'|'opacity'> & {
    /** Source boundary is already visible to this audience; absent on older disposable projections. */
    boundaryId?: string
  })[]
  /** Audience-filtered IDs only; visual2 shares one surface-detail band across both edge representations. */
  edgePaintOrder?: { kind: 'edgeLook' | 'materializedEdge'; id: string }[]
  environment: import('../visual/types.js').VisualEnvironment
  /** Stable export bounds, independent of temporary editor crop. */
  boundsMm: BoundsMm
  boundaries: ProjectedVisualBoundary[]
  /** Audience-filtered strict visual3 terrain transitions. */
  transitions?: ProjectedVisualTransition[]
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
