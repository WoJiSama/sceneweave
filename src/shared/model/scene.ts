import type { PathAttachment } from '../path-attachments/contracts.js'
import type { ConnectionRoute } from '../geometry/connection-route.js'
import type { RegionalModel1 } from '../terrain-generation/contracts.js'
import type { GenerationSystem5, VisualSystem3 } from '../terrain-generation/composition-contracts.js'
import type { PreparationContext } from '../ports/runtime.js'
import { cloneJson } from '../validation/json.js'
import type { AggregateCoordinates } from './aggregate.js'
import type { VisualEnvironment } from '../visual/types.js'
import type { ImageEnhancementMetadata } from '../image-enhancement/metadata.js'
import type { AssetRefinementMetadata } from '../asset-refinement/metadata.js'

/** All world coordinates and dimensions are integer millimetres. */
export type Id = string
export type PointMm = { x: number; y: number }
export type BoundsMm = { x: number; y: number; width: number; height: number }
export type Visibility = 'public' | 'gm'
export interface Editable { id: Id; floorId: Id; editLocked: boolean }
export interface Floor {
  id: Id; name: string; boundsMm: BoundsMm
  outputBoundsMm?: BoundsMm
  environment?: VisualEnvironment
}
export interface Vertex extends Editable { xMm: number; yMm: number }
export interface AssetRef {
  id: Id; sha256: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  pixelWidth: number; pixelHeight: number; logicalSizeMm: { width: number; height: number }
  licenseRef: string; origin: { kind: 'original' | 'imported' | 'generated'; attribution: string; canEmbed: boolean }
  imageEnhancement?: ImageEnhancementMetadata
  imageRefinement?: AssetRefinementMetadata
}
export interface Region extends Editable {
  boundaryMm: PointMm[]
  kind: 'terrain' | 'hazard' | 'manualMask'
  blocksMovement: boolean; movementCostMultiplier: number; visibility: Visibility
}
export type SizeMm = { width: number; height: number }
export type VersionRef = { id: Id; version: number }
export type Origin = AssetRef['origin']
export interface DefinitionIdentity { id: Id; catalogId: string; version: number; licenseRef: string; origin: Origin }
export type SurfaceRef = { kind: 'floor' | 'terrainArea' | 'room'; id: Id }
export type GroundSurfaceRef = { kind: 'floor' | 'terrainArea'; id: Id }
export type PropSymbol = 'table' | 'chair' | 'shelf' | 'rug' | 'crate'
export type Appearance = ({ kind: 'image'; assetId: Id } | { kind: 'symbol'; symbol: PropSymbol }) & { tint: string | null; opacity: number }
export interface ShadowStyle { directionDeg: number; offsetMm: number; blurMm: number; opacity: number; color: string }
export type RenderLayer = 'ground' | 'object' | 'canopy'
export type ShadowClass = 'none' | 'furniture' | 'vegetation'
export interface PropDefinition extends DefinitionIdentity {
  name: string; tags: string[]; defaultAppearance: Appearance; defaultVisualBoundsMm: BoundsMm
  defaultFootprintMm: SizeMm; defaultFootprintOffsetMm: PointMm
  defaultBlocksMovement: boolean; defaultBlocksSight: boolean
  defaultRenderLayer: RenderLayer; defaultShadowClass: ShadowClass
}
export interface MaterialRef extends DefinitionIdentity {
  name: string; tags: string[]; textureAssetId: Id; defaultTileSizeMm: SizeMm
  applicableSurfaces: ('room' | 'wall' | 'terrain' | 'path')[]
}
export interface MaterialPaint {
  materialRef: VersionRef; tileSizeMm: SizeMm; rotationDeg: number
  alignment: 'world' | 'surface'; originMm: PointMm; tint: string | null; opacity: number
}
export interface SurfaceOverlay { id: Id; boundaryMm: PointMm[]; paint: MaterialPaint; blendWidthMm: number; renderOrder: number }
export interface SurfaceStyle { base: MaterialPaint; overlays: SurfaceOverlay[] }
export interface Room extends Editable {
  boundaryVertexIds: Id[]; purpose: string; visibility: Visibility
  accessExpectation: 'unspecified' | 'required' | 'intentionalIsolation'
  supportRef: GroundSurfaceRef; groundElevationMm: number; floorStyle: SurfaceStyle | null
}
export interface Wall extends Editable {
  startVertexId: Id; endVertexId: Id; thicknessMm: number; blocksMovement: boolean; blocksSight: boolean
  topStyle: SurfaceStyle | null
}
export interface Opening extends Editable {
  wallId: Id; offsetReferenceVertexId: Id; offsetMm: number; widthMm: number
  kind: 'door' | 'window'; state: 'open' | 'closed'; locked: boolean; secret: boolean; revealed: boolean
}
export interface Prop extends Editable {
  definitionRef: VersionRef | null; appearance: Appearance; visualBoundsMm: BoundsMm
  positionMm: PointMm; rotationDeg: number; footprintMm: SizeMm; footprintOffsetMm: PointMm
  blocksMovement: boolean; blocksSight: boolean; visibility: Visibility; roomId?: Id; supportRef: SurfaceRef
  renderLayer: RenderLayer; renderOrder: number; shadowClass: ShadowClass; shadowOverride: ShadowStyle | null
}
export interface TerrainPoint { id: Id; segmentId: Id; positionMm: PointMm }
export interface TerrainArea extends Editable {
  visibility: Visibility; boundaryMm: TerrainPoint[]; groundElevationMm: number; coveragePriority: number
  surfaceStyle: SurfaceStyle | null; blocksMovement: boolean; blocksSight: boolean; movementCostMultiplier: number
}
export interface EdgeStyle { strokeWidthMm: number; color: string; bandWidthMm: number }
export interface TerrainEdge extends Editable {
  visibility: Visibility; source: { areaId: Id; segmentId: Id }; neighborAreaId: Id | null
  kind: 'shore' | 'cliff' | 'materialTransition'; shoreline: boolean; blocksMovement: boolean; blocksSight: boolean
  surfaceStyle: SurfaceStyle | null; styleOverride: EdgeStyle | null
}
export interface TerrainConnection extends Editable {
  visibility: Visibility; kind: 'stairs' | 'ramp'
  from: { surfaceRef: SurfaceRef; positionMm: PointMm }; to: { surfaceRef: SurfaceRef; positionMm: PointMm }
  widthMm: number; openingId: Id | null; blocksMovement: boolean; movementCostMultiplier: number; surfaceStyle: SurfaceStyle | null
  /** Present only in strict Scene5+; absent preserves the original straight connection. */
  route?: ConnectionRoute
}
export interface Path extends Editable {
  visibility: Visibility; centerlineMm: PointMm[]; widthMm: number; supportRefs: SurfaceRef[]
  surfaceStyle: SurfaceStyle | null; movementCostMultiplier: number; renderOrder: number
}
export type PropTemplate = Pick<Prop, 'definitionRef' | 'appearance' | 'positionMm' | 'rotationDeg' | 'visualBoundsMm' | 'footprintMm' | 'footprintOffsetMm' | 'blocksMovement' | 'blocksSight' | 'renderLayer' | 'renderOrder' | 'shadowClass' | 'shadowOverride'>
export interface PrefabDefinition extends DefinitionIdentity { name: string; tags: string[]; members: { key: string; propTemplate: PropTemplate }[] }
export const PROP_OVERRIDE_FIELDS = ['definitionRef', 'supportRef', 'roomId', 'visibility', 'appearance', 'visualBoundsMm', 'positionMm', 'rotationDeg', 'footprintMm', 'footprintOffsetMm', 'blocksMovement', 'blocksSight', 'shadowClass', 'shadowOverride', 'renderLayer', 'renderOrder'] as const
export type PropOverrideField = typeof PROP_OVERRIDE_FIELDS[number]
export interface PrefabInstance extends Editable {
  visibility: Visibility; definitionRef: VersionRef; anchorMm: PointMm; rotationDeg: number
  members: Record<string, { propId: Id | null; overrideFields: PropOverrideField[] }>
}
export interface ScatterGroup extends Editable {
  visibility: Visibility
  domain: { kind: 'area'; areaId: Id } | { kind: 'path'; pathId: Id } | { kind: 'edgeBand'; edgeId: Id; widthMm: number }
  palette: { key: string; propDefinitionRef: VersionRef; weight: number }[]
  seed: string; algorithmVersion: string; gridOriginMm: PointMm; cellSizeMm: number; densityFactor: number; minDistanceMm: number
  rotationRangeDeg: { min: number; max: number }
  members: Record<string, { propId: Id | null; state: 'managed' | 'manual' | 'deleted' | 'detached'; overrideFields: PropOverrideField[] }>
  exclusions: { id: Id; boundaryMm: PointMm[]; reason: 'manual' | 'delete' | 'entrance'; sourceCandidateKey: string | null }[]
}
/** Compact decoration has no collision, sight-blocking or supporting role. */
export interface Decoration extends Editable {
  visibility: Visibility; definitionRef: VersionRef; supportRef: SurfaceRef
  positionMm: PointMm; rotationDeg: number; scalePpm: number; renderOrder: number
}
export interface DecorationCluster extends Editable {
  visibility: Visibility; supportRef: SurfaceRef; boundsMm: BoundsMm
  seed: string; algorithmVersion: 'cluster-v1'
  palette: { key: string; definitionRef: VersionRef; kind: 'prop' | 'decoration'; weight: number }[]
  maxInstances: number; spacingMm: number; clusterRadiusMm: number; clearanceMm: number
  members: Record<string, { kind: 'prop' | 'decoration'; entityId: Id | null; state: 'managed' | 'manual' | 'deleted' | 'detached' }>
  /** Strict v7 tree-canopy rule; absent on older and ordinary decoration clusters. */
  canopyRule?: { regionsMm: PointMm[][]; channel: 'trees'; paintOrder: number; mode: 'plant' | 'erase'; canopyCoveragePpm: number }
}
/** Strict v8 rules retain the actual painted geometry, including erased holes. */
export interface SurfaceRuleRegion { outerMm: PointMm[]; holesMm: PointMm[][] }
export type SurfaceRuleField = 'material' | 'trees' | 'shrubs' | 'grass'
export interface SurfaceRuleBase extends Editable {
  visibility: Visibility; supportRef: { kind: 'terrainArea'; id: Id }
  field: SurfaceRuleField; paintOrder: number; regionsMm: SurfaceRuleRegion[]
}
export type SurfaceRule = SurfaceRuleBase & (
  | { field: 'material'; paint: MaterialPaint; blendWidthMm: number }
  | { field: 'trees' | 'shrubs' | 'grass'; clusterId: Id; coveragePpm: number }
)
export interface StyleTheme extends DefinitionIdentity {
  name: string; materialSuggestions: VersionRef[]; propSuggestions: VersionRef[]; prefabSuggestions: VersionRef[]
  outline: { widthMm: number; color: string }
  openingStyle: { doorStrokeWidthMm: number; windowStrokeWidthMm: number; frameWidthMm: number; doorFill: string; windowFill: string }
  edgeStyles: Record<'shore' | 'cliff' | 'materialTransition' | 'path', EdgeStyle>
  shadowPresets: Record<'none' | 'furniture' | 'vegetation' | 'wall', ShadowStyle>
  terrainCliff: { directionDeg: number; offsetFactor: number; maxOffsetMm: number; blurMm: number; opacity: number; color: string }
}
export type EntityKind = 'vertex' | 'room' | 'wall' | 'opening' | 'prop' | 'region' | 'note' | 'terrainArea' | 'terrainEdge' | 'terrainConnection' | 'path' | 'prefabInstance' | 'scatterGroup' | 'decoration' | 'decorationCluster' | 'surfaceRule'
export type AnchoredEntityKind = Exclude<EntityKind, 'decoration' | 'decorationCluster' | 'surfaceRule'>
export type Anchor = { type: 'entity'; entityKind: AnchoredEntityKind; entityId: Id } | { type: 'point'; positionMm: PointMm }
export interface Note extends Editable { anchor: Anchor; kind: 'note' | 'clue' | 'label'; title?: string; text: string; visibility: Visibility; discovered?: boolean }

/** User organization is separate from system render bands, Floor and elevation. */
export interface UserLayer { id: Id; floorId: Id; name: string; order: number; editLocked: boolean }
export interface PathCheck {
  id: Id; from: Anchor; to: Anchor; clearanceMm: number
  mode: 'structural' | 'current'; assumedOpenDoorIds: Id[]
}
/** Output paint only; transparency never removes physical ground or privacy masks. */
export type SceneOutputBackground = { mode: 'solid'; color: string } | { mode: 'transparent' }
/** Complete, independent persisted model. No legacy view is used by the native path. */
export interface SceneDocument {
  /** Explicit exterior door/path relation; no layer membership or player metadata. */
  pathAttachments?: Record<Id, PathAttachment>
  format: 'sceneweave-scene'; schemaVersion: 1; sceneId: Id; revision: number
  title: string; createdAt: string; updatedAt: string
  units: { world: 'mm'; display: 'm' | 'ft'; gridSizeMm: number; snapMm: number; gridVisible: boolean }
  exportBoundsMm: BoundsMm
  /** Absent uses the renderer's normal background. Shared by preview and PNG. */
  outputBackground?: SceneOutputBackground
  floors: Record<Id, Floor>; vertices: Record<Id, Vertex>; rooms: Record<Id, Room>
  walls: Record<Id, Wall>; openings: Record<Id, Opening>; props: Record<Id, Prop>
  regions: Record<Id, Region>; notes: Record<Id, Note>; assets: Record<Id, AssetRef>
  propDefinitions: Record<Id, PropDefinition>; materials: Record<Id, MaterialRef>
  terrainAreas: Record<Id, TerrainArea>; terrainEdges: Record<Id, TerrainEdge>
  terrainConnections: Record<Id, TerrainConnection>; paths: Record<Id, Path>
  prefabDefinitions: Record<Id, PrefabDefinition>; prefabInstances: Record<Id, PrefabInstance>
  scatterGroups: Record<Id, ScatterGroup>; styleThemes: Record<Id, StyleTheme>; activeStyleThemeRef: VersionRef | null
  userLayers: Record<Id, UserLayer>; entityLayers: Record<Id, Id>
  presetSnapshot: {
    presetId: string; presetVersion: number; distanceMode: 'metric' | 'grid' | 'abstract'
    source: string; gridSizeMm: number
  }
  constraints: {
    entranceOpeningIds: Id[]; wallEndClearanceMm: number; minDoorWidthMm?: number
    minPathWidthMm?: number; pathChecks: PathCheck[]
  }
  /** Every current project carries the complete scene capability set. */
  mapMode: 'scene' | 'regional'
  generation: GenerationSystem5
  regional: RegionalModel1 | null
  visual: VisualSystem3
  generationMetadata?: { generatorVersion: string; seed: string; summary?: string; adoptedAt: string }
  /** Actual decoration instances and ownership are persisted, never regenerated on open. */
  decorations: Record<Id, Decoration>
  decorationClusters: Record<Id, DecorationCluster>
  /** Continuous material and vegetation rules share one persisted collection. */
  surfaceRules: Record<Id, SurfaceRule>
  /** World materialization in memory; I/O writes member points in local frames. */
  aggregateCoordinates?: AggregateCoordinates
}
/** Transitional symbol for current callers; there is only one persisted shape. */
export type SceneDocument8 = SceneDocument
export interface Issue { code: string; message: string; entityId?: Id }
export const USER_LAYER_LIMIT = 128
export const COMMAND_LIMIT = 256
export const LAYER_ENTITY_COLLECTIONS = [
  'vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes',
  'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups',
] as const
export type LayerEntityCollection = typeof LAYER_ENTITY_COLLECTIONS[number]
export const DECORATION_COLLECTIONS = ['decorations', 'decorationClusters'] as const
export const SURFACE_RULE_COLLECTIONS = ['surfaceRules'] as const
export const collectionFor = {
  vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', prop: 'props', region: 'regions', note: 'notes',
  terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths',
  prefabInstance: 'prefabInstances', scatterGroup: 'scatterGroups',
  decoration: 'decorations', decorationCluster: 'decorationClusters',
  surfaceRule: 'surfaceRules',
} as const
export const newId = (context: PreparationContext): Id => context.ids.nextId()
export const cloneScene = (scene: SceneDocument): SceneDocument => cloneJson(scene)
