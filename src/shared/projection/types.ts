import type { VisualFilter } from '../visual/types.js'
import type { BoundsMm, EdgeStyle, MaterialPaint, MaterialRef, Note, PointMm, Prop, StyleTheme, SurfaceStyle, TerrainEdge } from '../model/scene.js'

export type Audience = 'gm' | 'player'
/** Audience-owned paint only; rule identity, ownership and recipes never leave the domain. */
export interface ProjectedMaterialPatch {
  regionsMm: { outerMm: PointMm[]; holesMm: PointMm[][] }[]
  paint: MaterialPaint
  blendWidthMm: number
}
export interface ProjectedSurface { id: string; points: PointMm[]; style: SurfaceStyle | null; elevationMm: number; priority: number; materialPatches?: ProjectedMaterialPatch[]
  boundaryBlendMm?: number
  facade?: import('../appearance/terrain-facade.js').TerrainFacade
  /** Generated solid support, with the default paint supplied by its bridge. */
  bridgeSupport?: true
  waterSurface?: import('../ocean/contracts.js').WaterSurface
  relief?: import('../geometry/terrain-relief.js').TerrainRelief
  reliefFinish?: import('../model/scene.js').TerrainArea['reliefFinish']
  /** Actual audience-owned top after visible cuts; source footprint stays in points for selection. */
  regionsMm?: { outerMm: PointMm[]; holesMm: PointMm[][] }[]
}
export interface ProjectedRock {
  id: string
  patches: { kind: 'walk' | 'apron'; pointsMm: PointMm[]; elevationsMm: number[] }[]
  facets: { id: string; pointsMm: PointMm[]; fill: string; opacity: number; kind: 'wall' | 'stratum' | 'joint' }[]
  strokes: { id: string; pointsMm: PointMm[]; color: string; widthMm: number; opacity: number }[]
  spatial?: {
    walls: Pick<import('../carved-rock/contracts.js').CarvedRockWall, 'a' | 'b' | 'normal' | 'highMm' | 'lowMm'>[]
    shellFaces: import('../rock-shell/contracts.js').RockShellTriangle['verticesMm'][]
  }
}
/** Audience-owned actual geometry only; no frozen source, identity or recipe. */
export interface ProjectedTerrainInlay {
  id: string
  finish?: import('../terrain-inlay/persistence.js').TerrainInlayFinish
  /** Complete audience-owned walk and width, only for explicit surface finish. */
  finishRoute?: { centerlineMm: PointMm[]; widthMm: number }
  footprintMm: PointMm[]
  walkFootprintMm: PointMm[]
  patches: { kind: 'walk' | 'apron'; pointsMm: PointMm[]; elevationsMm: number[] }[]
  /** Disjoint actual apron ownership, already filtered with both source tops. */
  apronSurfaces: { sourceAreaId: string; regionsMm: NonNullable<ProjectedSurface['regionsMm']> }[]
  /** Present only for explicit continuous source-ground paint. Covers both
   * walk and apron without turning their classification into a painted seam. */
  groundSurfaces?: { sourceAreaId: string; regionsMm: NonNullable<ProjectedSurface['regionsMm']> }[]
  walls: { a: PointMm; b: PointMm; highMm: [number, number]; lowMm: [number, number]; normal: PointMm; lowSourceAreaId: string | null }[]
  /** Only the changed carriers; original raw source identities never leave the domain. */
  changedCarriers: { a: PointMm; b: PointMm }[]
  paintBoundsMm: BoundsMm
  /** Existing source-bound paint locally covered by the actual influence;
   * preserved in the source and explicitly listed for candidate review. */
  scopedPaintIds?: string[]
}
export interface ProjectedTerrainEdge { id: string; start: PointMm; end: PointMm; sourceAreaId: string; neighborAreaId: string | null; elevationMm: number; neighborElevationMm: number; kind: TerrainEdge['kind']; shoreline: boolean; style: EdgeStyle; surfaceStyle: SurfaceStyle | null
  /** The carrier of a visible subsegment, used to keep visual boundary ownership after a cut. */
  sourceSpanMm?: [PointMm, PointMm]
  /** A declared band width is an explicit paint dimension. */
  customFinish?: true
  /** Derived from this audience's declared edge and its visible neighboring terrain. */
  shorePaint?: { style: EdgeStyle; waterSide: 'source' | 'neighbor' }
}
export interface ProjectedBridge {
  outline: PointMm[]
  centerlineMm: PointMm[]
  widthMm: number
  finish: 'steel' | 'timber'
  relief?: { depthMm: number; shadowOpacity: number; elevationMm: number; ribSpacingMm: number }
  structure?: { palette: 'riveted' | 'alloy'; landings: { side: 'start' | 'end'; outline: [PointMm, PointMm, PointMm, PointMm] }[] }
}
export interface ProjectedFloorShadow {
  caster: NonNullable<ProjectedSurface['regionsMm']>
  receiver: NonNullable<ProjectedSurface['regionsMm']>
  offsetMm: PointMm
  blurMm: number
  opacity: number
}
export interface ProjectedDoorThreshold {
  end: 'start' | 'end'
  cap: [PointMm, PointMm]
  inside: [PointMm, PointMm]
}
export interface ProjectedPath {
  id: string; points: PointMm[]; style: SurfaceStyle | null; edgeStyle: EdgeStyle; bridge?: ProjectedBridge
  gradedSurface?: import('../geometry/road-surface.js').RoadSurfaceGeometry
  roadFinish?: import('../model/scene.js').Path['roadFinish']
  gradedFinish?: { preset: import('../stairs/contracts.js').StaircasePresetId; material: import('../stairs/contracts.js').StaircaseMaterialId
    covers: import('../stairs/geometry.js').StaircaseGeometry['covers'] }
  /** Inward paint blend over the already audience-filtered ground. */
  groundBlendMm?: number
  groundBlendEnds?: { point: PointMm; inward: PointMm; widthMm: number }[]
  paving?: import('./route-paving.js').ProjectedPavingCourse[]
  stairs?: { centerlineMm: PointMm[]; widthMm: number; widthSections?: import('../geometry/route-width.js').RouteWidthSection[]; config: import('../stairs/contracts.js').StaircaseConfig }
  /** Paint-only continuation through an audience-visible attached doorway. */
  doorThresholds?: ProjectedDoorThreshold[]
}
/** Paint for a supported terminal, referencing only this audience's geometry. */
export interface ProjectedBridgeEntrance {
  bridgeId: string
  end: 'start' | 'end'
  platform?: {
    id: string; contactMm: PointMm; shoulderCut: NonNullable<ProjectedSurface['regionsMm']>; edgeOpening: NonNullable<ProjectedSurface['regionsMm']>; laneReachMm?: number
    /** Projection of the steel section at this entrance. Zero denotes a flush deck. */
    girderOffsetMm?: PointMm
  }
  approach?: { pathId: string; end: 'start' | 'end'; cap: [PointMm, PointMm]; sides: [PointMm[], PointMm[]]; from: PointMm; to: PointMm; deckEdgeMm?: PointMm }
}
export interface ProjectedConnection { id: string; kind: 'stairs' | 'ramp'; start: PointMm; end: PointMm; widthMm: number; fromElevationMm: number; toElevationMm: number; blocksMovement: boolean; style: SurfaceStyle | null
  staircase?: import('../stairs/contracts.js').StaircaseConfig
  staircaseCenterlineMm?: PointMm[]
  /** Only this audience's complete physical route and finite paint parameters. */
  route?: Pick<import('../geometry/connection-route.js').ConnectionRoute, 'centerlineMm' | 'stairStyle' | 'treadDepthMm' | 'renderProfile'>
  /** Disposable endpoint support IDs, included only after this audience's dependency filtering. */
  surfaceIds?: [string, string]
  /** Exact butt-ended physical polygon, never redrawn as a regular stair band. */
  carvedFootprintMm?: PointMm[]
  /** A multi-source actual walk, never reconstructed as a stair/straight band. */
  inlayFootprintMm?: PointMm[]
  inlayCenterlineMm?: PointMm[]
  /** Source-ground is already painted by the actual inlay, before connections. */
  inlayAppearance?: 'source-ground'
}
export interface ProjectedOpening { id: string; start: PointMm; end: PointMm; widthMm: number; kind: 'door' | 'window'; state: 'open' | 'closed'; secret: boolean; vertical?: import('../model/building-height.js').OpeningHeight; /** Editor-only symbol suppression preserves the physical wall hole. */ paintSymbol?: boolean }
export interface ProjectedWall { id: string; sourceIds: string[]; /** Added only to visual-v2 projections. */ blocksLight?: boolean; start: PointMm; end: PointMm; thicknessMm: number; heightMm?: number; edgeProfile?: 'stone-blocks-v1'; style: SurfaceStyle | null; openings: ProjectedOpening[] }
export interface ProjectedNote { id: string; positionMm: PointMm; text: string; kind: Note['kind']; visibility: 'gm' | 'public' }
export interface ProjectedRegion { id: string; points: PointMm[]; kind: 'terrain' | 'hazard' }
/** Disposable fixed-image paint values; no source, cluster, support or manual-state metadata. */
export interface ProjectedDecoration {
  id: string; positionMm: PointMm; rotationDeg: number; visualBoundsMm: BoundsMm
  assetId: string; opacity: number; renderLayer: Prop['renderLayer']; renderOrder: number
  /** Explicit low foliage relief, evaluated only for the spatial renderer. */
  moundHeightMm?: number
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
  floorArtwork?: import('../model/scene.js').FloorArtwork
  artStyles?: import('../visual/art-style.js').ActiveArtStyles
  materialBrushes?: Record<string, import('./material-drawing.js').MaterialBrush>
  rooms: ProjectedSurface[]; terrain: ProjectedSurface[]; walls: ProjectedWall[]
  /** Canonical ground/object/canopy, renderOrder, id order; independent copies of source props. */
  props: Prop[]
  /** Opt-in data for an independently prepared spatial view. */
  propVolumes?: Record<string, import('./spatial-props.js').ProjectedPropVolume>
  /** Strict complete6+; compact sprites remain distinct from physical Props. */
  decorations?: ProjectedDecoration[]
  /** One audience-filtered order shared by visible physical and compact sprites. */
  spritePaintOrder?: string[]
  /** Only visible near-side instances; no fixed-source or private metadata. */
  propPresentations?: Record<string, import('../appearance/presentation.js').PaintPresentation>
  /** GM editor session only; ignored by formal exports. */
  groundView?: boolean
  edges: ProjectedTerrainEdge[]; paths: ProjectedPath[]; connections: ProjectedConnection[]
  /** Visible, level dry/wet boundaries without a declared shore stroke. */
  lineArtShorelines?: [PointMm, PointMm][]
  rocks?: ProjectedRock[]
  /** Undeclared edges between equal base heights can still separate actual relief surfaces. */
  spatialReliefEdges?: ProjectedTerrainEdge[]
  inlays?: ProjectedTerrainInlay[]
  /** Same-floor/elevation public paths across visible editing layers, after audience and editor filtering.
   * Only visible IDs survive; style/filter compatibility is checked at paint time. */
  pathJoinGroups?: string[][]
  bridgeEntrances?: ProjectedBridgeEntrance[]
  /** Public paths in actual paint order, including incompatible covers.
   * Private paths never participate in public seam decisions. */
  pathJoinPaintOrder?: string[]
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
  /** Per-mask holes derived exclusively from this audience's public room
   * interiors. No private room IDs, rings, props or source metadata survive. */
  maskPublicRooms?: PointMm[][][]
  regional?: { areas: ProjectedRegionalArea[]; lines: ProjectedRegionalLine[]; landmarks: ProjectedRegionalLandmark[]; symbols: ProjectedRegionalSymbol[] }
  theme: Pick<StyleTheme, 'outline' | 'openingStyle' | 'shadowPresets' | 'edgeStyles' | 'terrainCliff'> | null
  materials: Record<string, Pick<MaterialRef, 'id' | 'version' | 'textureAssetId'> & { bankMaterial?: import('./road-material.js').RoadBankMaterial }>
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
  /** Explicit world decoration, rather than an unresolved path binding. */
  decorationOnly?: true
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
  /** Exact owned old paint replaced by visible inlays, indexed by paint ID. */
  inlayExclusions?: { paintId: string; regionsMm: { outerMm: PointMm[]; holesMm: PointMm[][] }[] }[]
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
  lights: import('../visual/light-geometry.js').ProjectedLight[]
  /** Ground glow derived from actual visible fixtures after audience filtering. */
  fixtureGlows?: (import('../path-assembly/contracts.js').FixtureGlow & { positionMm: PointMm; wallOcclusion?: true; beam?: import('../validation/primitives.js').LightBeam; emitterOccluder?: PointMm[] })[]
  fogs: import('../visual/types.js').VisualFog[]
  filters: ProjectedVisualFilter[]
  /** Full visible physical occluders and contact footprints, independent of editor LOD/crop. */
  occluderRings: PointMm[][]
  occluderLines?: PointMm[][]
  contactRings: PointMm[][]
  /** Default edge paint replaced by continuous boundary decoration. */
  suppressedTerrainEdgeIds: string[]
}
