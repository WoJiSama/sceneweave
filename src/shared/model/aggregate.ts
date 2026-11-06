import type { EntityKind, Id, PointMm, SceneDocument, SurfaceRef } from './scene.js'

/** Session contract identity, independent of the complete-project schema. */
export const AGGREGATE_CONTRACT = 'sceneweave-aggregate-contract@1' as const
export const AGGREGATE_LIMITS = Object.freeze({ groups: 4096, depth: 16, ports: 16384, chunks: 16384, references: 131072 })
export const AGGREGATE_ENTITY_COLLECTIONS = Object.freeze({
  vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', prop: 'props', region: 'regions', note: 'notes',
  terrainArea: 'terrainAreas', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections', path: 'paths',
  prefabInstance: 'prefabInstances', scatterGroup: 'scatterGroups', decoration: 'decorations',
  decorationCluster: 'decorationClusters', surfaceRule: 'surfaceRules',
} as const satisfies Record<EntityKind, keyof SceneDocument>)

export interface AggregateEntityRef { kind: EntityKind; id: Id }
/** Exact integer-mm rigid frame, relative to the unique parent. */
export interface AggregateFrame { translationMm: PointMm; quarterTurns: 0 | 1 | 2 | 3 }
export interface AggregateGroup {
  id: Id; floorId: Id; parentId: Id | null; frame: AggregateFrame
  members: AggregateEntityRef[]; editLocked: boolean
}
/** One geometry at a time: local on disk, a complete world view in memory. */
export interface AggregateCoordinates { encoding: 'world' | 'local'; groups: Record<Id, AggregateGroup> }
export interface AggregateSceneSource { sceneId: Id; revision: number; contentHash: string }

/** Bind real endpoints; geometry is derived by a domain adapter, never self-reported. */
export type AggregatePortEndpoint =
  | { kind: 'opening'; id: Id }
  | { kind: 'path'; id: Id; end: 'start' | 'end' }
  | { kind: 'terrainConnection'; id: Id; end: 'from' | 'to' }
export interface AggregatePort { id: Id; groupId: Id; endpoint: AggregatePortEndpoint }
/** Geometry contract for c/e adapters; a does not create or certify these facts. */
export interface AggregatePortGeometry {
  floorId: Id; positionMm: PointMm; directionDeg: number; widthMm: number; elevationMm: number
  supportRefs: SurfaceRef[]; structuralConnection: boolean; currentlyPassable: boolean
}

/** Spatial keys are independent of group IDs and ownership. */
export interface AggregateChunkKey { floorId: Id; x: number; y: number }
export interface AggregateChunk {
  key: AggregateChunkKey; contentState: 'planned' | 'generated' | 'modified'; entities: AggregateEntityRef[]
}
/** Residency does not certify content and is never serialized into a project. */
export type AggregateChunkResidency =
  | { key: AggregateChunkKey; state: 'unloaded' | 'loading' | 'resident' }
  | { key: AggregateChunkKey; state: 'failed'; reason: string }
/** Read-only proposal, not a persisted second map or an internal-validation witness. */
export interface AggregateContract {
  contract: typeof AGGREGATE_CONTRACT; source: AggregateSceneSource
  groups: Record<Id, AggregateGroup>; ports: Record<Id, AggregatePort>
  chunkSizeMm: number; chunks: AggregateChunk[]
}

export type AggregateRelation = 'geometry' | 'attachment' | 'support' | 'membership' | 'annotation'
export type AggregateRelationRef = AggregateEntityRef | { kind: 'floor'; id: Id }
export interface AggregateDependency {
  from: AggregateEntityRef; to: AggregateRelationRef; relation: AggregateRelation; field: string
  fromOwnerId: Id | null; toOwnerId: Id | null
}
export interface AggregateMemberState {
  entity: AggregateEntityRef; ownerId: Id | null
  /** Current selection lock closure; exact commands still recheck their affected set. */
  lockSources: { kind: 'group' | 'container' | 'entity' | 'dependency' | 'layer'; id: Id }[]
  visibility: 'public' | 'gm' | 'unresolved'
}

/** Declaration of implemented behavior, not permission to edit or skip checks. */
export const AGGREGATE_CAPABILITIES = Object.freeze({
  contractInspection: true, coordinateAuthority: 'scene-local-mm-with-world-view',
  dependencyCoverage: 'entity-relations-with-conservative-fallback', audience: 'gm',
  portGeometry: 'derived-from-validated-endpoints', spatialIndex: 'audience-scoped-broad-phase',
  internalProofSnapshots: 'private-identity-bound-complete-project-hash',
  localCoordinatePersistence: true, representationCommands: true, internalProofReuse: true, internalProofReuseScope: 'aggregate-prop-position-rotation-only', aggregateTransform: true,
  aggregateTransformScope: 'complete-building-and-natural-support-closures-quarter-turns',
  spatialLoading: true, spatialLoadingScope: 'derived-selection-and-editor-prop-bitmaps',
  partitionedStorage: true, partitionedStorageScope: 'complete-json-content-blocks', geometricCut: false, aiTools: false,
} as const)

/** Identity requirements consumed by later commands; no tokens are allocated here. */
export const AGGREGATE_IDENTITY_RULES = Object.freeze({
  representation: Object.freeze({ entities: 'preserve', topology: 'preserve', containers: 'preserve' }),
  reparent: Object.freeze({ entities: 'preserve', topology: 'preserve', containers: 'preserve' }),
  ungroup: Object.freeze({ entities: 'preserve', topology: 'preserve', containers: 'retire-removed' }),
  split: Object.freeze({ entities: 'preserve-survivors', topology: 'invalidate-changed', containers: 'fresh' }),
  merge: Object.freeze({ entities: 'preserve-survivors', topology: 'invalidate-changed', containers: 'fresh' }),
  cut: Object.freeze({ entities: 'fresh-cut-results', topology: 'invalidate-changed', containers: 'fresh' }),
  copy: Object.freeze({ entities: 'fresh', topology: 'fresh', containers: 'fresh' }),
} as const)
export type AggregateIdentityEvent = keyof typeof AGGREGATE_IDENTITY_RULES
