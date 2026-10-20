/** All world coordinates and dimensions are integer millimetres. */
export type Id = string
export type PointMm = { x: number; y: number }
export type BoundsMm = { x: number; y: number; width: number; height: number }
export type Visibility = 'public' | 'gm'
export type EntityKind = 'vertex' | 'room' | 'wall' | 'opening' | 'prop' | 'region' | 'note'
export interface Editable { id: Id; floorId: Id; editLocked: boolean }
export interface Floor { id: Id; name: string; boundsMm: BoundsMm }
export interface Vertex extends Editable { xMm: number; yMm: number }
export interface Room extends Editable {
  boundaryVertexIds: Id[]
  purpose: string
  visibility: Visibility
  accessExpectation: 'unspecified' | 'required' | 'intentionalIsolation'
}
export interface Wall extends Editable {
  startVertexId: Id; endVertexId: Id; thicknessMm: number
  blocksMovement: boolean; blocksSight: boolean
}
export interface Opening extends Editable {
  wallId: Id; offsetMm: number; widthMm: number
  kind: 'door' | 'window'; state: 'open' | 'closed'
  locked: boolean; secret: boolean; revealed: boolean
}
export interface Prop extends Editable {
  /** null is an original procedural furniture symbol; M0 imports no external textures. */
  assetId: Id | null
  symbol: 'table' | 'chair' | 'shelf' | 'rug' | 'crate'
  positionMm: PointMm; rotationDeg: number
  footprintMm: { width: number; height: number }
  blocksMovement: boolean; blocksSight: boolean
  visibility: Visibility; roomId?: Id
}
export interface Region extends Editable {
  boundaryMm: PointMm[]
  kind: 'terrain' | 'hazard' | 'manualMask'
  blocksMovement: boolean; movementCostMultiplier: number; visibility: Visibility
}
export type Anchor = { type: 'entity'; entityKind: EntityKind; entityId: Id } | { type: 'point'; positionMm: PointMm }
export interface Note extends Editable {
  anchor: Anchor; kind: 'note' | 'clue' | 'label'
  title?: string; text: string; visibility: Visibility; discovered?: boolean
}
export interface AssetRef {
  id: Id; sha256: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  pixelWidth: number; pixelHeight: number; logicalSizeMm: { width: number; height: number }
  licenseRef: string; origin: { kind: 'original' | 'imported' | 'generated'; attribution: string; canEmbed: boolean }
}
export interface PathCheck {
  id: Id; from: Anchor; to: Anchor; clearanceMm: number
  mode: 'structural' | 'current'; assumedOpenDoorIds: Id[]
}
export interface SceneDocument {
  format: 'sceneweave'; schemaVersion: 1; sceneId: Id; revision: number
  title: string; createdAt: string; updatedAt: string
  units: { world: 'mm'; display: 'm' | 'ft'; gridSizeMm: number; snapMm: number; gridVisible: boolean }
  exportBoundsMm: BoundsMm
  floors: Record<Id, Floor>; vertices: Record<Id, Vertex>; rooms: Record<Id, Room>
  walls: Record<Id, Wall>; openings: Record<Id, Opening>; props: Record<Id, Prop>
  regions: Record<Id, Region>; notes: Record<Id, Note>; assets: Record<Id, AssetRef>
  presetSnapshot: {
    presetId: string; presetVersion: number; distanceMode: 'metric' | 'grid' | 'abstract'
    source: string; gridSizeMm: number
  }
  constraints: {
    entranceOpeningIds: Id[]; wallEndClearanceMm: number; minDoorWidthMm?: number
    minPathWidthMm?: number; pathChecks: PathCheck[]
  }
  generationMetadata?: { generatorVersion: string; seed: string; summary?: string; adoptedAt: string }
}
export type Operation =
  | { type: 'moveProp'; id: Id; positionMm: PointMm }
  | { type: 'updateProp'; id: Id; changes: Partial<Pick<Prop, 'rotationDeg' | 'visibility' | 'blocksMovement' | 'blocksSight'>> }
  | { type: 'moveVertices'; positions: Record<Id, PointMm> }
  | { type: 'moveOpening'; id: Id; offsetMm: number }
  | { type: 'updateOpening'; id: Id; changes: Partial<Pick<Opening, 'state' | 'locked' | 'secret' | 'revealed' | 'widthMm'>> }
  | { type: 'reverseWall'; id: Id }
  | { type: 'splitWall'; id: Id; atMm: number; vertexId: Id; newWallId: Id }
  | { type: 'updateNote'; id: Id; changes: Partial<Pick<Note, 'text' | 'title' | 'visibility' | 'discovered'>> }
  | { type: 'updateRoom'; id: Id; changes: Partial<Pick<Room, 'visibility' | 'purpose' | 'accessExpectation'>> }
  | { type: 'setEditLock'; entityKind: EntityKind; id: Id; locked: boolean }
export interface CommandBatch {
  batchId: Id; sceneId: Id; baseRevision: number
  source: 'manual' | 'ai' | 'import' | 'history' | 'migration'
  origin?: { requestId?: Id; proposalId?: Id }
  scope: { entityIds: Id[] | null }; operations: Operation[]; label: string
}
export interface Issue { code: string; message: string; entityId?: Id }
export type TransactionResult = { ok: true; document: SceneDocument; affectedIds: Id[]; elapsedMs: number } | { ok: false; errors: Issue[] }
export const collectionFor = {
  vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', prop: 'props', region: 'regions', note: 'notes',
} as const
export const newId = (): Id => crypto.randomUUID()
export const cloneScene = (scene: SceneDocument): SceneDocument => structuredClone(scene)
