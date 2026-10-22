import { describe, expect, it } from 'vitest'
import { layerSceneV3, symbolPropV3 } from '../v3/test-fixtures'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import type { SceneDocumentV3 } from '../v3/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { createHistoryIdentityV4 } from './identity'
import { StructureContinuitySessionV4 } from './structure-continuity'
import { buildStructureRestorePlanV4, inspectStructureRestoreScopeV4, type StructureRestoreRequestV4 } from './structure-restore'

function fixture(): SceneDocumentV3 {
  const scene = layerSceneV3(), layerId = scene.entityLayers.item
  scene.assets = {}; scene.propDefinitions = {}
  const points: Record<string, [number, number]> = { a: [3000, 3000], b: [9000, 3000], c: [9000, 9000], d: [3000, 9000], e: [15000, 3000], f: [15000, 9000] }
  for (const [id, [xMm, yMm]] of Object.entries(points)) {
    scene.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, xMm, yMm }; scene.entityLayers[id] = layerId
  }
  const walls = { ab: ['a', 'b'], shared: ['b', 'c'], cd: ['c', 'd'], da: ['d', 'a'], be: ['b', 'e'], ef: ['e', 'f'], fc: ['f', 'c'] }
  for (const [id, [startVertexId, endVertexId]] of Object.entries(walls)) {
    scene.walls[id] = { id, floorId: 'blank-floor', editLocked: false, startVertexId, endVertexId, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.entityLayers[id] = layerId
  }
  for (const [id, boundaryVertexIds] of Object.entries({ left: ['a', 'b', 'c', 'd'], right: ['b', 'e', 'f', 'c'] })) {
    scene.rooms[id] = { id, floorId: 'blank-floor', editLocked: false, boundaryVertexIds, purpose: id, visibility: 'public', accessExpectation: 'unspecified',
      supportRef: { kind: 'floor', id: 'blank-floor' }, groundElevationMm: 0, floorStyle: null }; scene.entityLayers[id] = layerId
  }
  scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'shared', offsetReferenceVertexId: 'b', offsetMm: 2000, widthMm: 1000,
    kind: 'door', state: 'closed', locked: false, secret: false, revealed: false }; scene.entityLayers.door = layerId
  scene.notes.clue = { id: 'clue', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'wall', entityId: 'shared' }, kind: 'clue', text: 'past clue', visibility: 'gm' }; scene.entityLayers.clue = layerId
  scene.props.item.supportRef = { kind: 'room', id: 'left' }; scene.props.item.roomId = 'left'
  return scene
}
function pair() {
  const historic = fixture(), current = structuredClone(historic), identity = createHistoryIdentityV4(historic)
  const session = new StructureContinuitySessionV4()
  const prove = () => { session.reset(historic); session.recordSnapshot('source', 'hash', historic); session.advance(historic, current); return session.prove('source', 'hash', current, historic) }
  return { current, historic, identity, session, prove }
}
function acknowledged(current: SceneDocumentV3, historic: SceneDocumentV3, identity: ReturnType<typeof createHistoryIdentityV4>, proof: ReturnType<StructureContinuitySessionV4['prove']>, request: StructureRestoreRequestV4): StructureRestoreRequestV4 {
  const scope = inspectStructureRestoreScopeV4(current, identity, historic, identity, request, proof)
  return { ...request, acknowledgedDependencyIds: scope.dependencyIds, confirmedLayerIds: scope.requiredLayerIds }
}

describe('C2 guarded current-structure restore plan', () => {
  it('restores explicit geometry and properties, keeps the shared wall unique and preserves outside edits and anchored context', () => {
    const { current, historic, identity, prove } = pair()
    current.vertices.b.xMm = 10000; current.vertices.c.xMm = 10000
    current.walls.shared.thicknessMm = 300; current.openings.door.state = 'open'
    current.rooms.left.purpose = 'edited left'; current.rooms.right.purpose = 'new right purpose'
    current.notes.clue.text = 'later clue'
    current.props.newer = symbolPropV3('newer', 17000, 17000); current.entityLayers.newer = current.entityLayers.item; identity.propTokens.newer = 'later-prop-token'
    current.notes.newer = { id: 'newer-note', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'room', entityId: 'left' }, kind: 'note', text: 'new annotation', visibility: 'gm' }
    // Collection keys and stable IDs must still match.
    current.notes['newer-note'] = current.notes.newer; delete current.notes.newer; current.entityLayers['newer-note'] = current.entityLayers.item
    const before = structuredClone({ current, historic }), proof = prove()
    const request = acknowledged(current, historic, identity, proof, { ids: ['left', 'shared', 'door'], mode: 'properties' })
    const plan = buildStructureRestorePlanV4(current, identity, historic, identity, request, proof)
    expect(plan.document.vertices.b.xMm).toBe(9000); expect(plan.document.vertices.c.xMm).toBe(9000)
    expect(plan.document.walls.shared.thicknessMm).toBe(200); expect(plan.document.openings.door.state).toBe('closed')
    expect(plan.document.rooms.left.purpose).toBe('left')
    expect(plan.document.rooms.right).toEqual(current.rooms.right)
    expect(plan.document.notes).toEqual(current.notes); expect(plan.document.props.newer).toEqual(current.props.newer)
    expect(Object.keys(plan.document.walls)).toEqual(Object.keys(current.walls)); expect(Object.values(plan.document.walls).filter(wall => [wall.startVertexId, wall.endVertexId].sort().join() === 'b,c')).toHaveLength(1)
    expect(plan.dependencyIds).toEqual(expect.arrayContaining(['right', 'clue', 'newer-note', 'item', 'b', 'c']))
    expect(plan.impacts.find(impact => impact.id === 'clue')).toMatchObject({ role: 'dependency', fields: [] })
    expect(plan.commandCost).toBe(7); expect(plan.changes.map(change => change.id)).toEqual(expect.arrayContaining(['left', 'shared', 'door', 'b', 'c']))
    expect(plan.document.sceneId).toBe(current.sceneId); expect(plan.document.revision).toBe(current.revision)
    expect(Object.isFrozen(plan.document.vertices.b)).toBe(true); expect({ current, historic }).toEqual(before)
  })

  it('geometry mode preserves current purpose, privacy, door state, material, support, layer and edit locks', () => {
    const { current, historic, identity, prove } = pair()
    current.vertices.b.xMm = 10000; current.openings.door.widthMm = 1500; current.openings.door.state = 'open'; current.rooms.left.purpose = 'current purpose'
    historic.rooms.left.editLocked = true
    const proof = prove(), request = acknowledged(current, historic, identity, proof, { ids: ['left', 'door'], mode: 'geometry' })
    const plan = buildStructureRestorePlanV4(current, identity, historic, identity, request, proof)
    expect(plan.document.rooms.left).toEqual(current.rooms.left); expect(plan.document.openings.door.state).toBe('open'); expect(plan.document.openings.door.widthMm).toBe(1000)
    expect(plan.document.entityLayers).toEqual(current.entityLayers); expect(plan.document.vertices.b.xMm).toBe(9000)
  })

  it('requires exact dependency and cross-layer confirmation, including current new dependencies', () => {
    const { current, historic, identity, prove } = pair()
    current.userLayers.annotations = { id: 'annotations', floorId: 'blank-floor', name: 'Annotations', order: 1, editLocked: false }
    current.entityLayers.clue = 'annotations'; current.vertices.b.xMm = 10000
    const proof = prove(), base: StructureRestoreRequestV4 = { ids: ['left'], mode: 'geometry' }
    const scope = inspectStructureRestoreScopeV4(current, identity, historic, identity, base, proof)
    expect(scope.requiredLayerIds).toContain('annotations')
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, base, proof)).toThrow(/依赖范围尚未完整确认/)
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, { ...base, acknowledgedDependencyIds: scope.dependencyIds }, proof)).toThrow(/跨层影响尚未完整确认/)
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, { ...base, acknowledgedDependencyIds: [...scope.dependencyIds, 'bogus'], confirmedLayerIds: scope.requiredLayerIds }, proof)).toThrow(/范围.*变化/)
    const plan = buildStructureRestorePlanV4(current, identity, historic, identity, acknowledged(current, historic, identity, proof, base), proof)
    expect(plan.document.entityLayers.clue).toBe('annotations')
  })

  it('rejects current root, neighbor, support prop, anchored note and layer locks as one transaction', () => {
    for (const target of ['left', 'right', 'item', 'clue', 'layer']) {
      const { current, historic, identity, prove } = pair()
      if (target === 'layer') current.userLayers[current.entityLayers.clue].editLocked = true
      else if (target === 'left' || target === 'right') current.rooms[target].editLocked = true
      else if (target === 'item') current.props.item.editLocked = true
      else current.notes.clue.editLocked = true
      const proof = prove(), before = structuredClone(current)
      expect(() => inspectStructureRestoreScopeV4(current, identity, historic, identity, { ids: ['left'], mode: 'geometry' }, proof)).toThrow(/已锁定/)
      expect(current).toEqual(before)
    }
  })

  it('refuses absent structures, topology replacement, reverted replacement and forged or stale evidence', () => {
    const { historic, current, identity, session, prove } = pair()
    const proof = prove()
    expect(() => inspectStructureRestoreScopeV4(current, identity, historic, identity, { ids: ['absent'], mode: 'properties' }, proof)).toThrow(/历史结构不存在/)
    expect(() => inspectStructureRestoreScopeV4(current, identity, historic, identity, { ids: ['left'], mode: 'geometry' }, { snapshotId: 'source' })).toThrow(/连续性证据/)
    const next = structuredClone(current); delete next.openings.door; delete next.entityLayers.door
    session.advance(current, next)
    expect(() => inspectStructureRestoreScopeV4(current, identity, historic, identity, { ids: ['left'], mode: 'geometry' }, proof)).toThrow(/连续性证据/)
    const restored = structuredClone(current); session.advance(next, restored)
    const recreatedProof = session.prove('source', 'hash', restored, historic)
    expect(() => inspectStructureRestoreScopeV4(restored, identity, historic, identity, { ids: ['door'], mode: 'properties' }, recreatedProof)).toThrow(/曾删除、重建或改变拓扑/)
    expect(() => inspectStructureRestoreScopeV4(restored, identity, historic, identity, { ids: ['left'], mode: 'geometry' }, recreatedProof)).toThrow(/曾删除、重建或改变拓扑/)
    const reversed = structuredClone(restored); [reversed.walls.shared.startVertexId, reversed.walls.shared.endVertexId] = [reversed.walls.shared.endVertexId, reversed.walls.shared.startVertexId]
    session.advance(restored, reversed); session.advance(reversed, restored)
    expect(() => inspectStructureRestoreScopeV4(restored, identity, historic, identity, { ids: ['shared'], mode: 'properties' }, session.prove('source', 'hash', restored, historic))).toThrow(/改变拓扑/)
  })

  it('rejects lineage/token mismatches, missing current structure and invalid full historical geometry', () => {
    const { current, historic, identity, prove } = pair(), proof = prove()
    expect(() => inspectStructureRestoreScopeV4(current, { ...identity, lineageId: 'other' }, historic, identity, { ids: ['left'], mode: 'geometry' }, proof)).toThrow(/lineage/)
    const missing = structuredClone(current); delete missing.openings.door; delete missing.entityLayers.door
    expect(() => inspectStructureRestoreScopeV4(missing, identity, historic, identity, { ids: ['door'], mode: 'properties' }, proof)).toThrow(/当前不存在/)
    const invalid = structuredClone(historic); invalid.vertices.a.xMm = 30000
    expect(() => inspectStructureRestoreScopeV4(current, identity, invalid, identity, { ids: ['left'], mode: 'geometry' }, proof)).toThrow(/历史场景无效/)
  })

  it('keeps current appearance and requires all current material/bitmap dependencies to remain valid', () => {
    const { current, historic, identity, prove } = pair()
    current.materials.bad = { id: 'bad', catalogId: 'bad-material', version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'test', canEmbed: true }, name: 'missing texture', tags: [], textureAssetId: 'absent', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
    const proof = prove()
    expect(() => inspectStructureRestoreScopeV4(current, identity, historic, identity, { ids: ['left'], mode: 'geometry' }, proof)).toThrow(/当前场景无效.*不存在/)
  })

  it('restores optional note content precisely and checks the full current anchor chain', () => {
    const { current, historic, identity, prove } = pair()
    for (const scene of [current, historic]) {
      scene.notes.child = { id: 'child', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'note', entityId: 'clue' }, kind: 'label', text: 'child', visibility: 'gm' }
      scene.entityLayers.child = scene.entityLayers.clue
    }
    current.notes.child.title = 'later title'; current.notes.child.discovered = true; current.notes.child.text = 'later text'
    const proof = prove(), request = acknowledged(current, historic, identity, proof, { ids: ['child'], mode: 'properties' })
    const plan = buildStructureRestorePlanV4(current, identity, historic, identity, request, proof)
    expect(plan.document.notes.child).toEqual(historic.notes.child)
    expect(plan.dependencyIds).toEqual(expect.arrayContaining(['clue', 'shared']))
    const locked = structuredClone(current); locked.walls.shared.editLocked = true
    const session = new StructureContinuitySessionV4(); session.reset(historic); session.recordSnapshot('source', 'hash', historic); session.advance(historic, locked)
    expect(() => inspectStructureRestoreScopeV4(locked, identity, historic, identity, { ids: ['child'], mode: 'properties' }, session.prove('source', 'hash', locked, historic))).toThrow(/已锁定/)
  })

  it('requires cross-layer acknowledgement even when another selected root belongs to that layer', () => {
    const { current, historic, identity, prove } = pair()
    for (const scene of [current, historic]) {
      scene.userLayers.other = { id: 'other', floorId: 'blank-floor', name: 'Other', order: 1, editLocked: false }
      scene.entityLayers.right = 'other'
    }
    const proof = prove(), base: StructureRestoreRequestV4 = { ids: ['left', 'right'], mode: 'properties' }
    const scope = inspectStructureRestoreScopeV4(current, identity, historic, identity, base, proof)
    expect(scope.requiredLayerIds).toEqual(['other'])
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, { ...base, acknowledgedDependencyIds: scope.dependencyIds }, proof)).toThrow(/跨层影响/)
  })

  it('enforces one 256-operation budget over the complete vertex expansion', () => {
    const historic = fixture(), layerId = historic.entityLayers.left
    for (let i = 0; i < 254; i++) {
      const id = `isolated-${i}`; historic.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, xMm: 1000 + i, yMm: 15000 }; historic.entityLayers[id] = layerId
    }
    const current = structuredClone(historic), identity = createHistoryIdentityV4(historic), session = new StructureContinuitySessionV4()
    session.reset(historic); session.recordSnapshot('source', 'hash', historic); session.advance(historic, current)
    const proof = session.prove('source', 'hash', current, historic)
    const ids = ['left', ...Object.keys(current.vertices).filter(id => id.startsWith('isolated-'))]
    expect(ids).toHaveLength(255)
    expect(() => inspectStructureRestoreScopeV4(current, identity, historic, identity, { ids, mode: 'geometry' }, proof)).toThrow(/超过单次 256 条预算/)
    const allowed = inspectStructureRestoreScopeV4(current, identity, historic, identity, { ids: ids.slice(0, -2), mode: 'geometry' }, proof)
    expect(allowed.commandCost).toBe(256)
  })

  it('can restore a continuous point-anchored note without mistaking a coordinate edit for a new identity', () => {
    const { current, historic, identity, prove } = pair()
    historic.notes.clue.anchor = { type: 'point', positionMm: { x: 4000, y: 4000 } }
    current.notes.clue.anchor = { type: 'point', positionMm: { x: 5000, y: 5000 } }
    const proof = prove(), plan = buildStructureRestorePlanV4(current, identity, historic, identity, { ids: ['clue'], mode: 'geometry' }, proof)
    expect(plan.document.notes.clue.anchor).toEqual(historic.notes.clue.anchor)
    expect(plan.document.notes.clue.text).toBe(current.notes.clue.text)
  })

  it('rechecks the player mask when geometry enlarges a current private room', () => {
    const { current, historic, identity, prove } = pair()
    current.rooms.left.visibility = 'gm'; historic.rooms.left.visibility = 'gm'
    current.vertices.b.xMm = 8000; current.vertices.c.xMm = 8000
    const addMask = (scene: SceneDocumentV3, max: number) => {
      scene.regions.mask = { id: 'mask', floorId: 'blank-floor', editLocked: false, kind: 'manualMask', visibility: 'public', boundaryMm: [{ x: 2000, y: 2000 }, { x: max, y: 2000 }, { x: max, y: 10000 }, { x: 2000, y: 10000 }], blocksMovement: false, movementCostMultiplier: 1 }; scene.entityLayers.mask = scene.entityLayers.left
    }
    addMask(current, 8400); addMask(historic, 9400)
    expect(() => projectSceneV3(current, 'player')).not.toThrow()
    const proof = prove(), request = acknowledged(current, historic, identity, proof, { ids: ['left'], mode: 'geometry' })
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, request, proof)).toThrow(/遮罩未覆盖/)
  })

  it('enforces strict request shape and treats historical lock-only differences as a no-op', () => {
    const { current, historic, identity, prove } = pair()
    historic.rooms.left.editLocked = true
    const proof = prove(), request = acknowledged(current, historic, identity, proof, { ids: ['left'], mode: 'properties' })
    const plan = buildStructureRestorePlanV4(current, identity, historic, identity, request, proof)
    expect(plan.changed).toBe(false); expect(plan.changes).toEqual([]); expect(plan.document.rooms.left.editLocked).toBe(false)
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, { ...request, extra: true } as never, proof)).toThrow(/选择无效/)
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, { ids: ['left', 'left'], mode: 'geometry' }, proof)).toThrow(/不能重复/)
    let reads = 0; const accessor = { mode: 'geometry' }
    Object.defineProperty(accessor, 'ids', { enumerable: true, get: () => { reads++; return ['left'] } })
    expect(() => buildStructureRestorePlanV4(current, identity, historic, identity, accessor as never, proof)).toThrow(/访问器/); expect(reads).toBe(0)
    expect(validateSceneSnapshotV3(plan.document).ok).toBe(true)
  })
})
