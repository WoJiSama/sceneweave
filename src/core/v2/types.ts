import type { AssetRef, BoundsMm, Editable, Floor, Id, Issue, PointMm, Region, SceneDocument, Vertex, Visibility } from '../types'

export type { AssetRef, BoundsMm, Editable, Floor, Id, Issue, PointMm, Region, Vertex, Visibility }
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
export interface RoomV2 extends Editable {
  boundaryVertexIds: Id[]; purpose: string; visibility: Visibility
  accessExpectation: 'unspecified' | 'required' | 'intentionalIsolation'
  supportRef: GroundSurfaceRef; groundElevationMm: number; floorStyle: SurfaceStyle | null
}
export interface WallV2 extends Editable {
  startVertexId: Id; endVertexId: Id; thicknessMm: number; blocksMovement: boolean; blocksSight: boolean
  topStyle: SurfaceStyle | null
}
export interface OpeningV2 extends Editable {
  wallId: Id; offsetReferenceVertexId: Id; offsetMm: number; widthMm: number
  kind: 'door' | 'window'; state: 'open' | 'closed'; locked: boolean; secret: boolean; revealed: boolean
}
export interface PropV2 extends Editable {
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
}
export interface PathV2 extends Editable {
  visibility: Visibility; centerlineMm: PointMm[]; widthMm: number; supportRefs: SurfaceRef[]
  surfaceStyle: SurfaceStyle | null; movementCostMultiplier: number; renderOrder: number
}
export type PropTemplate = Pick<PropV2, 'definitionRef' | 'appearance' | 'positionMm' | 'rotationDeg' | 'visualBoundsMm' | 'footprintMm' | 'footprintOffsetMm' | 'blocksMovement' | 'blocksSight' | 'renderLayer' | 'renderOrder' | 'shadowClass' | 'shadowOverride'>
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
export interface StyleTheme extends DefinitionIdentity {
  name: string; materialSuggestions: VersionRef[]; propSuggestions: VersionRef[]; prefabSuggestions: VersionRef[]
  outline: { widthMm: number; color: string }
  openingStyle: { doorStrokeWidthMm: number; windowStrokeWidthMm: number; frameWidthMm: number; doorFill: string; windowFill: string }
  edgeStyles: Record<'shore' | 'cliff' | 'materialTransition' | 'path', EdgeStyle>
  shadowPresets: Record<'none' | 'furniture' | 'vegetation' | 'wall', ShadowStyle>
  terrainCliff: { directionDeg: number; offsetFactor: number; maxOffsetMm: number; blurMm: number; opacity: number; color: string }
}
export type EntityKindV2 = 'vertex' | 'room' | 'wall' | 'opening' | 'prop' | 'region' | 'note' | 'terrainArea' | 'terrainEdge' | 'terrainConnection' | 'path' | 'prefabInstance' | 'scatterGroup'
export type AnchorV2 = { type: 'entity'; entityKind: EntityKindV2; entityId: Id } | { type: 'point'; positionMm: PointMm }
export interface NoteV2 extends Editable { anchor: AnchorV2; kind: 'note' | 'clue' | 'label'; title?: string; text: string; visibility: Visibility; discovered?: boolean }
export interface SceneDocumentV2 extends Omit<SceneDocument, 'schemaVersion' | 'rooms' | 'walls' | 'openings' | 'props' | 'notes' | 'constraints'> {
  schemaVersion: 2; rooms: Record<Id, RoomV2>; walls: Record<Id, WallV2>; openings: Record<Id, OpeningV2>; props: Record<Id, PropV2>; notes: Record<Id, NoteV2>
  propDefinitions: Record<Id, PropDefinition>; materials: Record<Id, MaterialRef>
  terrainAreas: Record<Id, TerrainArea>; terrainEdges: Record<Id, TerrainEdge>; terrainConnections: Record<Id, TerrainConnection>; paths: Record<Id, PathV2>
  prefabDefinitions: Record<Id, PrefabDefinition>; prefabInstances: Record<Id, PrefabInstance>; scatterGroups: Record<Id, ScatterGroup>
  styleThemes: Record<Id, StyleTheme>; activeStyleThemeRef: VersionRef | null
  constraints: Omit<SceneDocument['constraints'], 'pathChecks'> & { pathChecks: { id: Id; from: AnchorV2; to: AnchorV2; clearanceMm: number; mode: 'structural' | 'current'; assumedOpenDoorIds: Id[] }[] }
}
