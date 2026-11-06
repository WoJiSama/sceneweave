import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../commands/commands.js'
import { validateSceneDocument } from '../validation/scene.js'
import {
  AGGREGATE_CAPABILITIES, AGGREGATE_CONTRACT, AGGREGATE_IDENTITY_RULES, type AggregateContract, type AggregateEntityRef,
} from '../model/aggregate.js'
import { aggregateChunkResidencySchema, aggregateFrameSchema, aggregateSceneSource, inspectAggregateContract } from './contracts.js'
import type { SceneDocument } from '../model/scene.js'

const rectangle = (x: number, y: number, width: number, height: number) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]

function fixture() {
  const base = createShoreBlankDocument('island', {
    sceneId: 'aggregate-contracts', title: 'Aggregate contracts', now: '2026-11-05T00:00:00.000Z',
    widthMm: 20000, heightMm: 16000, preset: 'narrative',
  })
  let sequence = 0
  const runtime = { clock: { now: () => base.updatedAt }, ids: { nextId: () => `aggregate-${++sequence}` } }
  let scene = applyCommands(base, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(0, 0, 20000, 16000), groundElevationMm: 0, coveragePriority: 0 },
    { type: 'createRoom', id: 'left-room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(2000, 4000, 6000, 6000), thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'ground' } },
    { type: 'createRoom', id: 'right-room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(8000, 4000, 6000, 6000), thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime)
  const sharedWall = Object.values(scene.walls).find(wall => {
    const start = scene.vertices[wall.startVertexId], end = scene.vertices[wall.endVertexId]
    return start.xMm === 8000 && end.xMm === 8000 && Math.min(start.yMm, end.yMm) === 4000 && Math.max(start.yMm, end.yMm) === 10000
  })
  if (!sharedWall) throw new Error('Fixture did not create one shared wall.')
  const outsideWall = Object.values(scene.walls).find(wall => {
    const start = scene.vertices[wall.startVertexId], end = scene.vertices[wall.endVertexId]
    return start.yMm === 4000 && end.yMm === 4000 && Math.max(start.xMm, end.xMm) <= 8000
  })
  if (!outsideWall) throw new Error('Fixture did not create an exterior wall.')
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'entrance', wallId: outsideWall.id,
    offsetReferenceVertexId: outsideWall.startVertexId, offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
  scene = applyCommands(scene, [{ type: 'createPath', id: 'route', floorId: 'visual-floor', layerId: 'visual-layer-ground',
    centerlineMm: [{ x: 3000, y: 2000 }, { x: 12000, y: 2000 }], widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: 'ground' }] }], runtime)
  return { scene, sharedWall, outsideWall }
}

function group(id: string, parentId: string | null, members: AggregateEntityRef[] = [], options: { floorId?: string; editLocked?: boolean } = {}) {
  return { id, floorId: options.floorId ?? 'visual-floor', parentId, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 as const }, members, editLocked: options.editLocked ?? false }
}

function contract(scene: SceneDocument): AggregateContract {
  const sharedWall = Object.values(scene.walls).find(wall => scene.vertices[wall.startVertexId].xMm === 8000 && scene.vertices[wall.endVertexId].xMm === 8000)
  if (!sharedWall) throw new Error('Fixture lacks shared wall.')
  return {
    contract: AGGREGATE_CONTRACT,
    source: aggregateSceneSource(scene),
    groups: {
      root: group('root', null, [{ kind: 'wall', id: sharedWall.id }, { kind: 'path', id: 'route' }]),
      left: group('left', 'root', [{ kind: 'room', id: 'left-room' }, { kind: 'opening', id: 'entrance' }]),
      right: group('right', 'root', [{ kind: 'room', id: 'right-room' }]),
    },
    ports: {
      entrance: { id: 'entrance', groupId: 'left', endpoint: { kind: 'opening', id: 'entrance' } },
      route: { id: 'route', groupId: 'root', endpoint: { kind: 'path', id: 'route', end: 'start' } },
    },
    chunkSizeMm: 10000,
    chunks: [
      { key: { floorId: 'visual-floor', x: 0, y: 0 }, contentState: 'generated', entities: [{ kind: 'wall', id: sharedWall.id }] },
      { key: { floorId: 'visual-floor', x: 1, y: 0 }, contentState: 'modified', entities: [{ kind: 'wall', id: sharedWall.id }] },
      { key: { floorId: 'visual-floor', x: 0, y: 1 }, contentState: 'planned', entities: [] },
    ],
  }
}

function errors(scene: unknown, value: unknown) {
  const result = inspectAggregateContract(scene, value)
  return result.ok ? [] : result.errors.map(issue => issue.code)
}

describe('read-only aggregate contract inspection', () => {
  it('accepts nested ownership and ungrouped entities while finding shared-wall LCA and cross-chunk references', () => {
    const { scene, sharedWall } = fixture(), value = contract(scene), originalScene = structuredClone(scene)
    const result = inspectAggregateContract(scene, value)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inspection.members.find(member => member.entity.id === 'left-room')?.ownerId).toBe('left')
    expect(result.inspection.members.find(member => member.entity.id === sharedWall.id)?.ownerId).toBe('root')
    expect(result.inspection.ungrouped.some(member => member.kind === 'vertex')).toBe(true)
    expect(result.inspection.crossGroupDependencies).toContainEqual(expect.objectContaining({
      from: { kind: 'room', id: 'left-room' }, to: { kind: 'wall', id: sharedWall.id }, fromOwnerId: 'left', toOwnerId: 'root',
    }))
    expect(result.inspection.ports).toHaveLength(2)
    expect(result.inspection.ports[0]).toMatchObject({ role: 'door', port: { endpoint: { kind: 'opening', id: 'entrance' } } })
    expect(result.inspection.ports[0].sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.inspection.unindexed.some(member => member.id === sharedWall.id)).toBe(false)
    expect(scene).toEqual(originalScene)
    expect(Object.isFrozen(scene)).toBe(false)
  })

  it('rejects duplicate ownership, parent cycles, excessive depth, missing parents and cross-Floor ancestry', () => {
    const { scene, sharedWall } = fixture(), base = contract(scene)
    const duplicate = structuredClone(base)
    duplicate.groups.root.members.push({ kind: 'room', id: 'left-room' })
    expect(errors(scene, duplicate)).toContain('AGGREGATE_DUPLICATE_OWNER')

    const cycle = structuredClone(base)
    cycle.groups.root.parentId = 'left'
    expect(errors(scene, cycle)).toContain('AGGREGATE_CYCLE')

    const tooDeep = structuredClone(base)
    tooDeep.groups = Object.fromEntries(Array.from({ length: 17 }, (_, index) => {
      const id = `depth-${index}`
      return [id, group(id, index === 0 ? null : `depth-${index - 1}`)]
    }))
    expect(errors(scene, tooDeep)).toContain('AGGREGATE_DEPTH')

    const missingParent = structuredClone(base)
    missingParent.groups.left.parentId = 'missing'
    expect(errors(scene, missingParent)).toContain('AGGREGATE_PARENT')

    const crossFloor = structuredClone(base)
    crossFloor.groups.right.floorId = 'other'
    expect(errors(scene, crossFloor)).toContain('AGGREGATE_CROSS_FLOOR')

    const missingLca = structuredClone(base)
    missingLca.groups.root.members = missingLca.groups.root.members.filter(member => member.id !== sharedWall.id)
    expect(errors(scene, missingLca)).toContain('AGGREGATE_SHARED_WALL_OWNER')
  })

  it('binds ports to actual owned endpoints and rejects stale revision or same-revision content', () => {
    const { scene } = fixture(), value = contract(scene)
    const missingEndpoint = structuredClone(value)
    missingEndpoint.ports.entrance.endpoint.id = 'not-an-opening'
    expect(errors(scene, missingEndpoint)).toContain('AGGREGATE_PORT_BINDING')

    const changedRevision = structuredClone(scene)
    changedRevision.revision += 1
    expect(errors(changedRevision, value)).toContain('AGGREGATE_STALE_SOURCE')

    const changedContent = structuredClone(scene)
    changedContent.openings.entrance.locked = true
    expect(changedContent.revision).toBe(scene.revision)
    expect(errors(changedContent, value)).toContain('AGGREGATE_STALE_SOURCE')

    const before = inspectAggregateContract(scene, value)
    value.source = aggregateSceneSource(changedContent)
    const after = inspectAggregateContract(changedContent, value)
    expect(before.ok && after.ok).toBe(true)
    if (before.ok && after.ok) expect(after.inspection.ports.find(row => row.port.id === 'entrance')?.sourceHash)
      .not.toBe(before.inspection.ports.find(row => row.port.id === 'entrance')?.sourceHash)
  })

  it('keeps Floor support as a read-only world dependency outside aggregate ownership', () => {
    const { scene } = fixture()
    for (const room of Object.values(scene.rooms)) room.supportRef = { kind: 'floor', id: 'visual-floor' }
    scene.paths.route.supportRefs = [{ kind: 'floor', id: 'visual-floor' }]
    delete scene.terrainAreas.ground
    delete scene.entityLayers.ground
    const result = inspectAggregateContract(scene, contract(scene))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inspection.crossGroupDependencies).toContainEqual({
      from: { kind: 'room', id: 'left-room' }, to: { kind: 'floor', id: 'visual-floor' }, relation: 'support',
      field: 'supportRef', fromOwnerId: 'left', toOwnerId: null,
    })
    expect(result.inspection.members.some(member => member.entity.id === 'visual-floor')).toBe(false)
  })

  it('reports group, entity and layer locks independently and classifies secret support conservatively', () => {
    const { scene } = fixture()
    scene.terrainAreas.ground.visibility = 'gm'
    scene.rooms['left-room'].editLocked = true
    scene.userLayers['visual-layer-ground'].editLocked = true
    scene.openings.entrance.secret = true
    scene.openings.entrance.revealed = false
    const value = contract(scene)
    value.groups.root.editLocked = true
    const result = inspectAggregateContract(scene, value)
    expect(result.ok, result.ok ? '' : JSON.stringify(result.errors)).toBe(true)
    if (!result.ok) return
    expect(result.inspection.members.find(member => member.entity.id === 'left-room')).toMatchObject({ visibility: 'gm', lockSources: [
      { kind: 'group', id: 'root' }, { kind: 'entity', id: 'left-room' }, { kind: 'layer', id: 'visual-layer-ground' },
    ] })
    expect(result.inspection.members.find(member => member.entity.id === 'entrance')?.visibility).toBe('gm')
    expect(result.inspection.members.find(member => member.entity.id === 'ground')?.visibility).toBe('gm')
    expect(result.inspection.members.filter(member => member.entity.kind === 'vertex').every(member => member.visibility === 'unresolved')).toBe(true)
  })

  it('preserves a fixed prefab parent lock and private membership in the aggregate view', () => {
    const { scene } = fixture()
    scene.props.member = {
      id: 'member', floorId: 'visual-floor', editLocked: false, definitionRef: null,
      appearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
      visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 }, positionMm: { x: 16000, y: 12000 }, rotationDeg: 0,
      footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
      visibility: 'public', supportRef: { kind: 'terrainArea', id: 'ground' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null,
    }
    const { id: _id, floorId: _floorId, editLocked: _editLocked, visibility: _visibility, supportRef: _supportRef, ...propTemplate } = scene.props.member
    scene.prefabDefinitions['furniture-definition'] = { id: 'furniture-definition', catalogId: 'test.aggregate-furniture', version: 1, licenseRef: 'MIT',
      origin: { kind: 'original', attribution: 'Sceneweave tests', canEmbed: true }, name: 'Furniture', tags: [], members: [{ key: 'member', propTemplate }] }
    scene.prefabInstances.furniture = { id: 'furniture', floorId: 'visual-floor', editLocked: true, visibility: 'gm', definitionRef: { id: 'furniture-definition', version: 1 },
      anchorMm: { x: 16000, y: 12000 }, rotationDeg: 0, members: { member: { propId: 'member', overrideFields: [] } } }
    scene.entityLayers.member = 'visual-layer-ground'
    scene.entityLayers.furniture = 'visual-layer-ground'
    const value = contract(scene)
    value.groups.root.members.push({ kind: 'prop', id: 'member' })
    const result = inspectAggregateContract(scene, value)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inspection.members.find(member => member.entity.id === 'member')).toMatchObject({
      visibility: 'gm', lockSources: [{ kind: 'container', id: 'furniture' }],
    })
  })

  it('retains recursive locked annotation dependencies from the existing selection guard', () => {
    const { scene } = fixture()
    scene.notes.first = { id: 'first', floorId: 'visual-floor', editLocked: false, kind: 'note', text: 'First', visibility: 'gm',
      anchor: { type: 'entity', entityKind: 'opening', entityId: 'entrance' } }
    scene.notes.second = { id: 'second', floorId: 'visual-floor', editLocked: true, kind: 'note', text: 'Second', visibility: 'gm',
      anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    scene.entityLayers.first = 'visual-layer-ground'
    scene.entityLayers.second = 'visual-layer-ground'
    const result = inspectAggregateContract(scene, contract(scene))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inspection.members.find(member => member.entity.id === 'entrance')?.lockSources)
      .toContainEqual({ kind: 'dependency', id: 'second' })
  })

  it('deduplicates chunk keys, permits cross-chunk indexing without duplicate ownership and rejects planned content', () => {
    const { scene, sharedWall } = fixture(), base = contract(scene)
    const duplicateKey = structuredClone(base)
    duplicateKey.chunks[1].key = structuredClone(duplicateKey.chunks[0].key)
    expect(errors(scene, duplicateKey)).toContain('AGGREGATE_DUPLICATE_CHUNK')

    const plannedContent = structuredClone(base)
    plannedContent.chunks[2].entities.push({ kind: 'wall', id: sharedWall.id })
    expect(errors(scene, plannedContent)).toContain('AGGREGATE_PLANNED_CONTENT')

    const valid = inspectAggregateContract(scene, base)
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.inspection.members.find(member => member.entity.id === sharedWall.id)?.ownerId).toBe('root')
  })

  it('rejects unknown fields without executing accessors and returns a detached deep-frozen inspection', () => {
    const { scene } = fixture(), value = contract(scene), original = structuredClone(value)
    expect(errors(scene, { ...value, unsupported: true })).toContain('AGGREGATE_SCHEMA')
    expect(validateSceneDocument({ ...scene, aggregates: value.groups }).ok).toBe(false)

    let getterCalls = 0
    const accessor = structuredClone(value)
    Object.defineProperty(accessor, 'source', { enumerable: true, get() { getterCalls += 1; return value.source } })
    expect(errors(scene, accessor)).toContain('NON_JSON_INPUT')
    expect(getterCalls).toBe(0)

    const result = inspectAggregateContract(scene, value)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.isFrozen(result.inspection)).toBe(true)
    expect(Object.isFrozen(result.inspection.contract.groups.left.members)).toBe(true)
    expect(Object.isFrozen(value)).toBe(false)
    expect(value).toEqual(original)
    expect(result.inspection.contract).not.toBe(value)
    value.groups.left.members.length = 0
    scene.openings.entrance.widthMm = 1000
    expect(result.inspection.contract.groups.left.members).toEqual(original.groups.left.members)
    expect(result.inspection.ports[0].port).toEqual(original.ports.entrance)
  })

  it('declares the finite building transform while inspection grants no edit permission or AI capability', () => {
    expect(AGGREGATE_CAPABILITIES).toMatchObject({
      contractInspection: true, localCoordinatePersistence: true, representationCommands: true, internalProofReuse: true, internalProofReuseScope: 'aggregate-prop-position-rotation-only',
      aggregateTransform: true, aggregateTransformScope: 'complete-building-and-natural-support-closures-quarter-turns', spatialLoading: true, spatialLoadingScope: 'derived-selection-and-editor-prop-bitmaps', partitionedStorage: true, partitionedStorageScope: 'complete-json-content-blocks', geometricCut: false, aiTools: false,
    })
    expect(AGGREGATE_CAPABILITIES.coordinateAuthority).toBe('scene-local-mm-with-world-view')
  })

  it('rejects unsupported transforms and keeps identity and residency declarations separate from proof', () => {
    const frame = { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }
    expect(aggregateFrameSchema.safeParse({ ...frame, quarterTurns: 0.5 }).success).toBe(false)
    expect(aggregateFrameSchema.safeParse({ ...frame, scale: 2 }).success).toBe(false)
    expect(AGGREGATE_IDENTITY_RULES.representation).toEqual({ entities: 'preserve', topology: 'preserve', containers: 'preserve' })
    expect(AGGREGATE_IDENTITY_RULES.copy).toEqual({ entities: 'fresh', topology: 'fresh', containers: 'fresh' })
    expect(AGGREGATE_IDENTITY_RULES.cut).toEqual({ entities: 'fresh-cut-results', topology: 'invalidate-changed', containers: 'fresh' })
    const resident = { key: { floorId: 'visual-floor', x: 0, y: 0 }, state: 'resident' }
    expect(aggregateChunkResidencySchema.safeParse(resident).success).toBe(true)
    expect(aggregateChunkResidencySchema.safeParse({ ...resident, verified: true }).success).toBe(false)
    expect(AGGREGATE_CAPABILITIES.internalProofReuse).toBe(true)
    expect(AGGREGATE_CAPABILITIES.internalProofReuseScope).toBe('aggregate-prop-position-rotation-only')
  })
})
