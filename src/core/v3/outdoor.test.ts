import { describe, expect, it } from 'vitest'
import { terrainFixtureV2 } from '../v2/b3.test-helpers'
import { applyCompositionCommandsV5 } from '../v5/commands'
import { createCompositionContentV5 } from '../v5/graph'
import { resolveMetadataOnlyV5 } from '../v5/test-fixtures'
import { applyCommandsV3 } from './commands'
import { canonicalTerrainEdgeV3, inspectOutdoorChangesV3, outdoorDependenciesV3, previewOutdoorCommandsV3, reconcileTerrainBoundaryV3, type OutdoorCommandV3 } from './outdoor'
import { migrateSceneV2 } from './migration'
import { validateSceneV3 } from './schema'
import { layerSceneV3, scatterLayerSceneV3 } from './test-fixtures'
import type { PointMm, SceneDocumentV3 } from './types'

const rectangle = (x = 1000, y = 1000, width = 8000, height = 8000): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function blank(): SceneDocumentV3 {
  const scene = layerSceneV3()
  delete scene.props.item; delete scene.entityLayers.item
  return scene
}
const area = (id = 'area', boundaryMm = rectangle()): OutdoorCommandV3 => ({ type: 'createTerrainArea', id, floorId: 'blank-floor', boundaryMm })
const populate = (scene: ReturnType<typeof createCompositionContentV5>, densityFactor = 1) => applyCompositionCommandsV5(scene, [{ type: 'regenerateScatter', id: 'scatter', densityFactor }])

describe('C4 terrain boundary identity mapping', () => {
  const old = rectangle().map((positionMm, index) => ({ id: `point-${index}`, segmentId: `segment-${index}`, positionMm }))
  const allocate = () => {
    let next = 0
    return (kind: 'point' | 'segment') => `fresh-${kind}-${next++}`
  }

  it('preserves actual point and directed-segment identity through a cyclic row rotation', () => {
    const result = reconcileTerrainBoundaryV3(old, [old[2].positionMm, old[3].positionMm, old[0].positionMm, old[1].positionMm], allocate())
    expect(result.map(point => point.id)).toEqual(['point-2', 'point-3', 'point-0', 'point-1'])
    expect(result.map(point => point.segmentId)).toEqual(['segment-2', 'segment-3', 'segment-0', 'segment-1'])
  })

  it('maps a moved vertex through a cyclic row rotation using the remaining exact anchors', () => {
    const moved = { x: old[1].positionMm.x - 250, y: old[1].positionMm.y + 150 }
    const result = reconcileTerrainBoundaryV3(old, [old[2].positionMm, old[3].positionMm, old[0].positionMm, moved], allocate())
    expect(result.map(point => point.id)).toEqual(['point-2', 'point-3', 'point-0', 'point-1'])
    expect(result.map(point => point.segmentId)).toEqual(['segment-2', 'segment-3', 'segment-0', 'segment-1'])
    expect(result[3].positionMm).toEqual(moved)
  })

  it('normalizes reverse row order to the strict positive winding without changing edge identity', () => {
    const result = reconcileTerrainBoundaryV3(old, old.map(point => point.positionMm).reverse(), allocate())
    expect(result).toEqual(old)
  })

  it('keeps point and directed-segment identity for an ordinary moved vertex', () => {
    const positions = old.map(point => ({ ...point.positionMm }))
    positions[1] = { x: positions[1].x - 300, y: positions[1].y + 200 }
    const result = reconcileTerrainBoundaryV3(old, positions, allocate())
    expect(result.map(point => point.id)).toEqual(old.map(point => point.id))
    expect(result.map(point => point.segmentId)).toEqual(old.map(point => point.segmentId))
    expect(result[1].positionMm).toEqual(positions[1])
  })

  it('keeps exact point identities and only untouched directed edges when inserting or deleting vertices', () => {
    const inserted = reconcileTerrainBoundaryV3(old, [old[0].positionMm, { x: 5000, y: 1000 }, ...old.slice(1).map(point => point.positionMm)], allocate())
    expect(inserted.map(point => point.id)).toEqual(['point-0', expect.any(String), 'point-1', 'point-2', 'point-3'])
    expect(inserted.slice(2).map(point => point.segmentId)).toEqual(['segment-1', 'segment-2', 'segment-3'])
    expect(inserted[0].segmentId).not.toBe('segment-0')
    expect(inserted[1].segmentId).not.toBe('segment-0')

    const deleted = reconcileTerrainBoundaryV3(old, [old[0].positionMm, old[2].positionMm, old[3].positionMm], allocate())
    expect(deleted.map(point => point.id)).toEqual(['point-0', 'point-2', 'point-3'])
    expect(deleted.map(point => point.segmentId)).toEqual([expect.not.stringMatching(/^segment-/), 'segment-2', 'segment-3'])
  })

  it('keeps input-order identity when every point moves, but rejects ambiguous matches and mixed insert/move edits', () => {
    const movedAll = old.map((point, index) => ({ x: point.positionMm.x + index * 10 + 1, y: point.positionMm.y + 25 }))
    expect(reconcileTerrainBoundaryV3(old, movedAll, allocate()).map(point => point.id)).toEqual(old.map(point => point.id))
    const oneAnchorAtSameIndex = old.map((point, index) => index === 1 ? point.positionMm : { x: point.positionMm.x + 100 + index, y: point.positionMm.y + 200 })
    expect(reconcileTerrainBoundaryV3(old, oneAnchorAtSameIndex, allocate()).map(point => point.id)).toEqual(old.map(point => point.id))
    expect(() => reconcileTerrainBoundaryV3(old, [{ x: 3000, y: 2000 }, old[2].positionMm, { x: 7000, y: 3000 }, { x: 4000, y: 8000 }], allocate())).toThrow(/一个匹配点/)
    expect(() => reconcileTerrainBoundaryV3(old, [old[0].positionMm, { x: 8000, y: 3000 }, old[2].positionMm, { x: 3000, y: 8000 }], allocate())).toThrow(/唯一的循环或反向映射/)
    expect(() => reconcileTerrainBoundaryV3(old, [old[0].positionMm, { x: 5000, y: 1000 }, { x: 9001, y: 1000 }, old[2].positionMm, old[3].positionMm], allocate())).toThrow(/插入\/删除与移动混在同一次/)
  })

  it('rejects duplicate coordinates rather than assigning duplicate point identity', () => {
    expect(() => reconcileTerrainBoundaryV3(old, [old[0].positionMm, old[1].positionMm, old[1].positionMm, old[3].positionMm], allocate())).toThrow(/坐标不能重复/)
  })
})

describe('C4 scatter birth identity compatibility', () => {
  it('keeps stable candidate slots, gives new births fresh IDs through repeated density cycles and serialized metadata', () => {
    const initial = createCompositionContentV5(scatterLayerSceneV3(0)), first = populate(initial)
    const keys = Object.keys(first.document.scatterGroups.scatter.members), firstIds = Object.values(first.document.scatterGroups.scatter.members).flatMap(member => member.propId ?? [])
    expect(firstIds.length).toBeGreaterThan(20)
    let current = first
    for (let i = 0; i < 3; i++) {
      const previousIds = Object.keys(current.historyIdentity.propTokens)
      const empty = populate(current, 0)
      current = populate(JSON.parse(JSON.stringify(empty)))
      expect(Object.keys(current.document.scatterGroups.scatter.members)).toEqual(keys)
      expect(Object.values(current.document.scatterGroups.scatter.members).every(member => !previousIds.includes(member.propId!))).toBe(true)
      expect(previousIds.every(id => current.historyIdentity.propTokens[id] === empty.historyIdentity.propTokens[id])).toBe(true)
    }
    expect(populate(current)).toEqual(current)
    expect(initial.document.scatterGroups.scatter.members).toEqual({})
  })
  it('retains manual appearance, live IDs, layer rules, deletion, detach and locked obstacles', () => {
    let content = populate(createCompositionContentV5(scatterLayerSceneV3(0)), .7)
    const entries = Object.entries(content.document.scatterGroups.scatter.members), [[manualKey, manual], [deletedKey, deleted], [detachedKey, detached], [lockedKey, locked]] = entries
    content = resolveMetadataOnlyV5(applyCompositionCommandsV5(content, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: [manual.propId!] }, adjustment: { id: 'manual-opacity', kind: 'opacity', enabled: true, value: .6 } }]))
    content = applyCompositionCommandsV5(content, [{ type: 'deleteProp', id: deleted.propId! }, { type: 'detachScatterMember', groupId: 'scatter', propId: detached.propId! }])
    content = applyCompositionCommandsV5(content, [{ type: 'setEditLock', kind: 'prop', id: locked.propId!, locked: true }])
    const before = structuredClone(content)
    content = populate(content)
    for (const value of [manual, detached, locked]) expect(content.document.props[value.propId!]).toEqual(before.document.props[value.propId!])
    expect(content.document.scatterGroups.scatter.members[manualKey].state).toBe('manual')
    expect(content.document.scatterGroups.scatter.members[deletedKey]).toEqual(before.document.scatterGroups.scatter.members[deletedKey])
    expect(content.document.scatterGroups.scatter.members[detachedKey].state).toBe('detached')
    expect(content.document.scatterGroups.scatter.members[lockedKey].propId).toBe(locked.propId)
    expect(content.document.scatterGroups.scatter.exclusions).toEqual(before.document.scatterGroups.scatter.exclusions)
    expect(content.appearance.propSources[manual.propId!]).toEqual(before.appearance.propSources[manual.propId!])
    expect(content.appearance.instanceAdjustments[manual.propId!]).toEqual(before.appearance.instanceAdjustments[manual.propId!])
  })
  it('charges actual props and member records instead of a single regenerate command', () => {
    const scene = scatterLayerSceneV3(0), before = structuredClone(scene)
    expect(() => applyCommandsV3(scene, [{ type: 'configureScatter', id: 'scatter', changes: { cellSizeMm: 1200 } }, { type: 'regenerateScatter', id: 'scatter', densityFactor: 1 }])).toThrow(/256/)
    expect(scene).toEqual(before)
    const plan = previewOutdoorCommandsV3(scene, [{ type: 'regenerateScatter', id: 'scatter', densityFactor: 1 }])
    expect(plan.commandCost).toBeGreaterThan(plan.createdIds.length)
    expect(plan.reason).toBeNull()
  })
  it('retains the actual rejected write count in an over-budget preview', () => {
    const scene = applyCommandsV3(scatterLayerSceneV3(0), [{ type: 'configureScatter', id: 'scatter', changes: { cellSizeMm: 1200 } }])
    const plan = previewOutdoorCommandsV3(scene, [{ type: 'regenerateScatter', id: 'scatter', densityFactor: 1 }])
    expect(plan.reason).toMatch(/256/); expect(plan.commandCost).toBeGreaterThan(256)
    expect(plan.commandCost).toBe(2 * plan.createdIds.length + 1)
    expect(scene.scatterGroups.scatter.members).toEqual({})
  })
  it('checks recursive locked notes on genuinely regenerated members without charging read-only locked obstacles', () => {
    let scene = populate(createCompositionContentV5(scatterLayerSceneV3(0)), .7).document
    scene = applyCommandsV3(scene, [{ type: 'configureScatter', id: 'scatter', changes: { rotationRangeDeg: { min: 0, max: 0 } } }])
    const member = Object.values(scene.scatterGroups.scatter.members)[0], layerId = scene.entityLayers.scatter
    scene.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: member.propId! }, kind: 'note', visibility: 'gm', text: 'a' }
    scene.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, anchor: { type: 'entity', entityKind: 'note', entityId: 'first' }, kind: 'note', visibility: 'gm', text: 'b' }
    scene.entityLayers.first = layerId; scene.entityLayers.second = layerId
    const before = JSON.stringify(scene)
    expect(() => applyCommandsV3(scene, [{ type: 'regenerateScatter', id: 'scatter' }])).toThrow(/second/)
    expect(JSON.stringify(scene)).toBe(before)
    const retained = structuredClone(scene); retained.props[member.propId!].editLocked = true
    const next = applyCommandsV3(retained, [{ type: 'regenerateScatter', id: 'scatter' }])
    expect(next.props[member.propId!]).toEqual(retained.props[member.propId!])
    expect(next.notes.second).toEqual(retained.notes.second)
  })
  it('preserves tombstones/exclusion records against ordinary configuration removal', () => {
    const populated = populate(createCompositionContentV5(scatterLayerSceneV3(0))), member = Object.values(populated.document.scatterGroups.scatter.members)[0]
    const removed = applyCompositionCommandsV5(populated, [{ type: 'deleteProp', id: member.propId! }]), exclusion = removed.document.scatterGroups.scatter.exclusions[0]
    expect(() => applyCommandsV3(removed.document, [{ type: 'removeScatterExclusion', groupId: 'scatter', exclusionId: exclusion.id }])).toThrow(/人工删除/)
    expect(() => applyCommandsV3(removed.document, [{ type: 'configureScatter', id: 'scatter', changes: { members: {} } } as never])).toThrow(/无效/)
  })
})

describe('C4 finite outdoor native commands', () => {
  it('creates integer terrain with stable points/segments, canonical source edges and native layer membership', () => {
    const scene = blank(), before = structuredClone(scene)
    const commands: OutdoorCommandV3[] = [area(), { type: 'createTerrainEdge', id: 'edge', source: { areaId: 'area', segmentId: 'area:segment:0' } }]
    const plan = previewOutdoorCommandsV3(scene, commands), next = applyCommandsV3(scene, commands)
    expect(plan.reason).toBeNull(); expect(plan.createdIds).toEqual(['area', 'edge']); expect(plan.commandCost).toBe(10)
    expect(next.terrainAreas.area.boundaryMm).toEqual(rectangle().map((positionMm, i) => ({ id: `area:point:${i}`, segmentId: `area:segment:${i}`, positionMm })))
    expect(next.entityLayers.edge).toBe(next.entityLayers.area)
    expect(next.terrainEdges.edge).toMatchObject({ source: { areaId: 'area', segmentId: 'area:segment:0' }, neighborAreaId: null, kind: 'materialTransition' })
    expect(scene).toEqual(before); expect(next.revision).toBe(scene.revision); expect(validateSceneV3(next).ok).toBe(true)
  })
  it('normalizes a newly drawn reverse boundary without dropping intentional integer control points', () => {
    const input = rectangle().reverse(), next = applyCommandsV3(blank(), [area('reverse', [...input, input[0]])])
    expect(next.terrainAreas.reverse.boundaryMm).toHaveLength(4)
    expect(validateSceneV3(next).ok).toBe(true)
    expect(() => applyCommandsV3(blank(), [area('fraction', [{ x: .5, y: 1000 }, ...rectangle().slice(1)])])).toThrow(/无效/)
    expect(() => applyCommandsV3(blank(), [area('cross', [{ x: 1000, y: 1000 }, { x: 9000, y: 9000 }, { x: 9000, y: 1000 }, { x: 1000, y: 9000 }])])).toThrow(/事务未采用/)
  })
  it('canonicalizes shared sources once and forces explicit cliff blocking for different elevations', () => {
    const base = applyCommandsV3(blank(), [area('a', rectangle(1000, 1000, 4000, 8000)), { ...area('b', rectangle(5000, 1000, 4000, 8000)), groundElevationMm: 1000 } as OutdoorCommandV3])
    expect(canonicalTerrainEdgeV3(base, { areaId: 'b', segmentId: 'b:segment:3' })).toEqual({ source: { areaId: 'a', segmentId: 'a:segment:1' }, neighborAreaId: 'b', requiresCliff: true })
    const next = applyCommandsV3(base, [{ type: 'createTerrainEdge', id: 'shared', source: { areaId: 'b', segmentId: 'b:segment:3' } }])
    expect(next.terrainEdges.shared).toMatchObject({ source: { areaId: 'a', segmentId: 'a:segment:1' }, neighborAreaId: 'b', kind: 'cliff', blocksMovement: true })
    expect(() => applyCommandsV3(next, [{ type: 'createTerrainEdge', id: 'duplicate', source: { areaId: 'a', segmentId: 'a:segment:1' } }])).toThrow(/至多一个/)
    expect(() => applyCommandsV3(next, [{ type: 'updateTerrainEdge', id: 'shared', changes: { blocksMovement: false } }])).toThrow(/cliff/)
  })
  it('does not silently rebind or remove an edge when editing topology', () => {
    const source = applyCommandsV3(blank(), [area(), { type: 'createTerrainEdge', id: 'edge', source: { areaId: 'area', segmentId: 'area:segment:0' } }])
    const replacement = source.terrainAreas.area.boundaryMm.map((point, i) => ({ ...point, segmentId: i === 0 ? 'fresh-segment' : point.segmentId }))
    expect(() => applyCommandsV3(source, [{ type: 'updateTerrainArea', id: 'area', changes: { boundaryMm: replacement } }])).toThrow(/边段/)
    const seen: { type: string; segmentId: string; edgeSegmentId: string }[] = []
    const next = applyCommandsV3(source, [{ type: 'updateTerrainArea', id: 'area', changes: { boundaryMm: replacement } }, { type: 'updateTerrainEdge', id: 'edge', changes: { source: { areaId: 'area', segmentId: 'fresh-segment' } } }], {
      onOutdoorDraft(draft, command) { seen.push({ type: command.type, segmentId: draft.terrainAreas.area.boundaryMm[0].segmentId, edgeSegmentId: draft.terrainEdges.edge.source.segmentId }) },
    })
    expect(next.terrainEdges.edge.source.segmentId).toBe('fresh-segment')
    expect(seen).toEqual([{ type: 'updateTerrainArea', segmentId: 'fresh-segment', edgeSegmentId: 'area:segment:0' }, { type: 'updateTerrainEdge', segmentId: 'fresh-segment', edgeSegmentId: 'fresh-segment' }])
    expect(source.terrainAreas.area.boundaryMm[0].segmentId).toBe('area:segment:0')
  })
  it('keeps source edges on their true directed endpoint pair and requires explicit remapping after a split', () => {
    const source = applyCommandsV3(blank(), [area(), { type: 'createTerrainEdge', id: 'edge', source: { areaId: 'area', segmentId: 'area:segment:0' } }])
    const original = source.terrainAreas.area.boundaryMm
    const cyclic = reconcileTerrainBoundaryV3(original, [original[2].positionMm, original[3].positionMm, original[0].positionMm, original[1].positionMm])
    const cyclicResult = applyCommandsV3(source, [{ type: 'updateTerrainArea', id: 'area', changes: { boundaryMm: cyclic } }])
    expect(cyclicResult.terrainEdges.edge.source.segmentId).toBe(original[0].segmentId)
    expect(cyclicResult.terrainAreas.area.boundaryMm.findIndex(point => point.segmentId === original[0].segmentId)).toBe(2)

    const reversed = reconcileTerrainBoundaryV3(original, original.map(point => point.positionMm).reverse())
    expect(reversed.map(point => point.id)).toEqual(original.map(point => point.id))
    expect(applyCommandsV3(source, [{ type: 'updateTerrainArea', id: 'area', changes: { boundaryMm: reversed } }]).terrainEdges.edge.source.segmentId).toBe(original[0].segmentId)

    const inserted = reconcileTerrainBoundaryV3(original, [original[0].positionMm, { x: 5000, y: 1000 }, ...original.slice(1).map(point => point.positionMm)])
    expect(() => applyCommandsV3(source, [{ type: 'updateTerrainArea', id: 'area', changes: { boundaryMm: inserted } }])).toThrow(/边段/)
    const candidate = structuredClone(source); candidate.terrainAreas.area.boundaryMm = inserted
    const relation = canonicalTerrainEdgeV3(candidate, { areaId: 'area', segmentId: inserted[0].segmentId })
    const remapped = applyCommandsV3(source, [
      { type: 'updateTerrainArea', id: 'area', changes: { boundaryMm: inserted } },
      { type: 'updateTerrainEdge', id: 'edge', changes: { source: relation.source, neighborAreaId: relation.neighborAreaId } },
    ])
    expect(remapped.terrainEdges.edge.source.segmentId).toBe(inserted[0].segmentId)
    expect(validateSceneV3(remapped).ok).toBe(true)
  })
  it('lists actual unchanged support/notes and honors their current cross-layer locks', () => {
    const scene = scatterLayerSceneV3(0), layerId = scene.entityLayers.domain
    scene.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' }, kind: 'note', visibility: 'public', text: 'a' }
    scene.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, anchor: { type: 'entity', entityKind: 'note', entityId: 'first' }, kind: 'note', visibility: 'public', text: 'b' }
    scene.entityLayers.first = layerId; scene.entityLayers.second = layerId
    const command: OutdoorCommandV3 = { type: 'setTerrainElevation', id: 'domain', groundElevationMm: 500 }
    const plan = previewOutdoorCommandsV3(scene, [command])
    expect(plan.affectedIds).toEqual(expect.arrayContaining(['domain', 'item', 'scatter', 'first', 'second']))
    expect(plan.reason).toMatch(/second/)
    expect(() => applyCommandsV3(scene, [command])).toThrow(/second/)
    expect(outdoorDependenciesV3(scene, ['domain'])).toEqual(expect.arrayContaining(['item', 'first', 'second']))
  })
  it('detects floor-supported locked objects whose support meaning changes under a new terrain', () => {
    const scene = layerSceneV3(); scene.props.item.editLocked = true
    expect(() => applyCommandsV3(scene, [area()])).toThrow(/item/)
  })
  it('includes supported room walls, openings and their recursive notes in terrain dependency locks', () => {
    let scene = applyCommandsV3(blank(), [area(), { type: 'createRoom', id: 'room', floorId: 'blank-floor', boundaryMm: rectangle(2000, 2000, 4000, 4000), thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'area' } }])
    const wall = Object.values(scene.walls)[0]
    scene = applyCommandsV3(scene, [{ type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1000, widthMm: 1000, kind: 'door' }])
    const layerId = scene.entityLayers.room
    scene.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, kind: 'note', visibility: 'public', text: 'wall', anchor: { type: 'entity', entityKind: 'wall', entityId: wall.id } }
    scene.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, kind: 'note', visibility: 'public', text: 'dependent', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    scene.entityLayers.first = layerId; scene.entityLayers.second = layerId
    expect(outdoorDependenciesV3(scene, ['area'])).toEqual(expect.arrayContaining(['room', wall.id, 'door', 'first', 'second']))
    const before = JSON.stringify(scene)
    expect(() => applyCommandsV3(scene, [{ type: 'setTerrainElevation', id: 'area', groundElevationMm: 500 }])).toThrow(/second/)
    expect(JSON.stringify(scene)).toBe(before)
  })
  it('supports a visible path definition and Region/Prop/Note map without Room conversion', () => {
    const scene = blank(), path = { type: 'createPath' as const, id: 'path', floorId: 'blank-floor', centerlineMm: [{ x: 2000, y: 5000 }, { x: 8000, y: 5000 }], widthMm: 1000, supportRefs: [{ kind: 'floor' as const, id: 'blank-floor' }] }
    const next = applyCommandsV3(scene, [path, { type: 'createRegion', id: 'hazard', floorId: 'blank-floor', boundaryMm: rectangle(10000, 2000, 3000, 4000), kind: 'hazard', blocksMovement: true }])
    expect(next.rooms).toEqual({}); expect(next.paths.path.widthMm).toBe(1000); expect(next.regions.hazard.blocksMovement).toBe(true)
    expect(() => applyCommandsV3(next, [{ type: 'updatePath', id: 'path', changes: { widthMm: 18000 } }])).toThrow(/事务未采用/)
    expect(() => applyCommandsV3(next, [{ type: 'createRegion', id: 'mask', floorId: 'blank-floor', boundaryMm: rectangle(), kind: 'manualMask' } as never])).toThrow(/无效/)
  })
  it('separates path/edge entity locking from content and respects the current layer lock', () => {
    let scene = applyCommandsV3(blank(), [area(), { type: 'createTerrainEdge', id: 'edge', source: { areaId: 'area', segmentId: 'area:segment:0' } }])
    scene = applyCommandsV3(scene, [{ type: 'setEditLock', kind: 'terrainEdge', id: 'edge', locked: true }])
    expect(() => applyCommandsV3(scene, [{ type: 'updateTerrainEdge', id: 'edge', changes: { shoreline: true } }])).toThrow(/锁定/)
    expect(() => applyCommandsV3(scene, [{ type: 'setEditLock', kind: 'terrainEdge', id: 'edge', locked: false }, { type: 'updateTerrainEdge', id: 'edge', changes: { shoreline: true } }])).toThrow(/分别独立/)
    const layerId = scene.entityLayers.area
    scene.userLayers[layerId].editLocked = true
    expect(() => applyCommandsV3(scene, [{ type: 'setEditLock', kind: 'terrainEdge', id: 'edge', locked: false }])).toThrow(/图层已锁定/)
  })
  it('rejects referenced deletions instead of deleting or reassigning support', () => {
    const scene = scatterLayerSceneV3(0), before = structuredClone(scene)
    expect(() => applyCommandsV3(scene, [{ type: 'deleteOutdoorEntity', kind: 'terrainArea', id: 'domain' }])).toThrow(/引用/)
    expect(scene).toEqual(before)
    const noGroup = applyCommandsV3(blank(), [area()]), deleted = applyCommandsV3(noGroup, [{ type: 'deleteOutdoorEntity', kind: 'terrainArea', id: 'area' }])
    expect(deleted.terrainAreas).toEqual({}); expect(deleted.entityLayers.area).toBeUndefined()
  })
  it('creates a fixed scatter configuration and rejects unsupported operations/unknown fields atomically', () => {
    const scene = scatterLayerSceneV3(0), before = structuredClone(scene), group = scene.scatterGroups.scatter
    const command: OutdoorCommandV3 = { type: 'createScatter', id: 'new-scatter', floorId: group.floorId, domain: group.domain, palette: group.palette, seed: 'new', cellSizeMm: 3000 }
    const next = applyCommandsV3(scene, [command, { type: 'regenerateScatter', id: 'new-scatter', densityFactor: .3 }])
    expect(next.scatterGroups['new-scatter'].algorithmVersion).toBe('scatter-cell-v1')
    expect(next.scatterGroups['new-scatter'].members).not.toEqual({})
    expect(() => applyCommandsV3(scene, [area('valid', rectangle(1000, 1000, 1000, 1000)), { ...command, historyIdentity: {} } as never])).toThrow(/无效/)
    expect(scene).toEqual(before)
  })
  it('creates/edits explicit high-difference connections and keeps their anchored notes on safe deletion refusal', () => {
    const scene = migrateSceneV2(terrainFixtureV2(), { sceneId: 'outdoor-connection', now: '2026-10-22T00:00:00.000Z' })
    const previous = scene.terrainConnections['island-stairs']
    const without = applyCommandsV3(scene, [{ type: 'deleteOutdoorEntity', kind: 'terrainConnection', id: previous.id }])
    const restored = applyCommandsV3(without, [{ type: 'createTerrainConnection', id: 'manual-stairs', floorId: previous.floorId, kind: 'stairs', from: previous.from, to: previous.to, widthMm: 2000 }])
    expect(restored.terrainConnections['manual-stairs'].from).toEqual(previous.from)
    const edited = applyCommandsV3(restored, [{ type: 'updateTerrainConnection', id: 'manual-stairs', changes: { widthMm: 1200, blocksMovement: true } }])
    expect(edited.terrainConnections['manual-stairs'].widthMm).toBe(1200)
    edited.notes.anchored = { id: 'anchored', floorId: previous.floorId, editLocked: false, kind: 'note', visibility: 'public', text: 'stairs', anchor: { type: 'entity', entityKind: 'terrainConnection', entityId: 'manual-stairs' } }
    edited.entityLayers.anchored = edited.entityLayers['manual-stairs']
    expect(() => applyCommandsV3(edited, [{ type: 'deleteOutdoorEntity', kind: 'terrainConnection', id: 'manual-stairs' }])).toThrow(/anchored/)
  })
  it('uses only an adopted applicable material version and preserves its fixed tiling phase', () => {
    const scene = blank(), asset = Object.values(scene.assets)[0]
    scene.materials.ground = { id: 'ground', catalogId: 'test.outdoor-ground', version: 1, licenseRef: asset.licenseRef, origin: asset.origin, name: 'ground', tags: [], textureAssetId: asset.id, defaultTileSizeMm: { width: 1250, height: 1750 }, applicableSurfaces: ['terrain', 'path'] }
    const next = applyCommandsV3(scene, [{ type: 'createTerrainArea', id: 'painted', floorId: 'blank-floor', boundaryMm: rectangle(), materialRef: { id: 'ground', version: 1 } }])
    expect(next.terrainAreas.painted.surfaceStyle?.base).toMatchObject({ materialRef: { id: 'ground', version: 1 }, tileSizeMm: { width: 1250, height: 1750 }, alignment: 'world', originMm: { x: 0, y: 0 }, opacity: 1 })
    expect(() => applyCommandsV3(scene, [{ type: 'createTerrainArea', id: 'bad', floorId: 'blank-floor', boundaryMm: rectangle(), materialRef: { id: 'ground', version: 2 } }])).toThrow(/版本/)
    expect(() => applyCommandsV3(scene, [{ type: 'createTerrainArea', id: 'ambiguous', floorId: 'blank-floor', boundaryMm: rectangle(), materialRef: { id: 'ground', version: 1 }, surfaceStyle: null }])).toThrow(/同时/)
  })
  it('previews and adopts manual/entrance exclusions with regeneration without changing deletion suppression', () => {
    const scene = populate(createCompositionContentV5(scatterLayerSceneV3(0))).document
    const exclusion = { id: 'reserved-entrance', boundaryMm: rectangle(2000, 2000, 3000, 3000), reason: 'entrance' as const }
    const next = applyCommandsV3(scene, [{ type: 'upsertScatterExclusion', groupId: 'scatter', exclusion }, { type: 'regenerateScatter', id: 'scatter' }])
    expect(next.scatterGroups.scatter.exclusions).toEqual([{ ...exclusion, sourceCandidateKey: null }])
    const removed = applyCommandsV3(next, [{ type: 'removeScatterExclusion', groupId: 'scatter', exclusionId: exclusion.id }])
    expect(removed.scatterGroups.scatter.exclusions).toEqual([])
  })
  it('charges embedded terrain point/segment writes and does not use format capacity to bypass the transaction budget', () => {
    const scene = blank(), boundaryMm = Array.from({ length: 129 }, (_, i) => ({ x: Math.round(10000 + Math.cos(i * Math.PI * 2 / 129) * 5000), y: Math.round(10000 + Math.sin(i * Math.PI * 2 / 129) * 5000) }))
    expect(() => applyCommandsV3(scene, [area('large', boundaryMm)])).toThrow(/256/)
    expect(scene.terrainAreas).toEqual({})
  })
  it('inspects exact prepared scatter birth IDs without rebuilding a different random proposal', () => {
    const scene = scatterLayerSceneV3(0), prepared = applyCommandsV3(scene, [{ type: 'regenerateScatter', id: 'scatter', densityFactor: .5 }])
    const actual = inspectOutdoorChangesV3(scene, prepared, ['scatter'])
    expect(actual.createdIds).toEqual(Object.values(prepared.scatterGroups.scatter.members).map(member => member.propId!).sort())
    expect(actual.commandCost).toBe(2 * actual.createdIds.length + 1)
  })
  it('counts each scatter deletion, membership tombstone and exclusion in one cumulative 256-write budget', () => {
    const scene = scatterLayerSceneV3(65), before = structuredClone(scene)
    const commands = Object.values(scene.scatterGroups.scatter.members).map(member => ({ type: 'deleteProp' as const, id: member.propId! }))
    expect(() => applyCommandsV3(scene, commands)).toThrow(/256/)
    expect(scene).toEqual(before)
    const next = applyCommandsV3(scene, commands.slice(0, 64))
    expect(next.scatterGroups.scatter.exclusions).toHaveLength(64)
    expect(Object.values(next.scatterGroups.scatter.members).filter(member => member.state === 'deleted')).toHaveLength(64)
    expect(Object.values(next.scatterGroups.scatter.members).filter(member => member.propId !== null)).toHaveLength(1)
  })
  it('expands scatter-member transforms and appearance replacement while keeping independent props on the legacy fast path', () => {
    const scene = scatterLayerSceneV3(86)
    const rotation = Object.values(scene.scatterGroups.scatter.members).map(member => ({ type: 'updateProp' as const, id: member.propId!, changes: { rotationDeg: 1 } }))
    expect(() => applyCommandsV3(scene, rotation)).toThrow(/256/)
    expect(scene.scatterGroups.scatter.members[Object.keys(scene.scatterGroups.scatter.members)[0]].overrideFields).toEqual(['positionMm'])
    const under = applyCommandsV3(scene, rotation.slice(0, 85))
    expect(Object.values(under.scatterGroups.scatter.members).filter(member => member.overrideFields.includes('rotationDeg'))).toHaveLength(85)
    expect(previewOutdoorCommandsV3(under, rotation.slice(0, 85)).commandCost).toBe(0)
    expect(previewOutdoorCommandsV3(under, rotation.slice(0, 85).map(command => ({ ...command, changes: { rotationDeg: 2 } }))).commandCost).toBe(85)
    expect(applyCommandsV3(scene, [...rotation.slice(0, 85), { type: 'updateProp', id: 'item', changes: { rotationDeg: 1 } }]).props.item.rotationDeg).toBe(1)
    expect(() => applyCommandsV3(scene, [...rotation.slice(0, 85), { type: 'updateProp', id: 'item', changes: { rotationDeg: 1 } }, { type: 'updateProp', id: 'item', changes: { rotationDeg: 2 } }])).toThrow(/256/)

    const appearanceScene = scatterLayerSceneV3(86), source = appearanceScene.propDefinitions['scatter-definition']
    appearanceScene.propDefinitions.alternate = { ...structuredClone(source), id: 'alternate', catalogId: 'test.layer-scatter-alternate', defaultAppearance: { kind: 'symbol', symbol: 'chair', tint: null, opacity: 1 } }
    const replace = Object.values(appearanceScene.scatterGroups.scatter.members).map(member => ({ type: 'replacePropAppearance' as const, id: member.propId!, definitionRef: { id: 'alternate', version: 1 } }))
    expect(() => applyCommandsV3(appearanceScene, replace)).toThrow(/256/)
    const appearanceUnder = applyCommandsV3(appearanceScene, replace.slice(0, 85))
    expect(Object.values(appearanceUnder.scatterGroups.scatter.members).filter(member => member.overrideFields.includes('appearance'))).toHaveLength(85)

    const independent = layerSceneV3()
    expect(applyCommandsV3(independent, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 1 } }]).props.item.rotationDeg).toBe(1)
  })
  it('does not let an unrelated locked scatter sibling block an unlocked member edit', () => {
    const scene = scatterLayerSceneV3(2), members = Object.values(scene.scatterGroups.scatter.members), lockedId = members[1].propId!
    scene.props[lockedId].editLocked = true
    const targetId = members[0].propId!
    const next = applyCommandsV3(scene, [{ type: 'updateProp', id: targetId, changes: { rotationDeg: 1 } }])
    expect(next.props[targetId].rotationDeg).toBe(1)
    expect(next.props[lockedId].editLocked).toBe(true)
  })
  it('checks recursive target and parent-group notes for member edits without adding sibling locks', () => {
    let scene = scatterLayerSceneV3(2)
    const targetId = Object.values(scene.scatterGroups.scatter.members)[0].propId!, layerId = scene.entityLayers.scatter
    scene = applyCommandsV3(scene, [{ type: 'updateProp', id: targetId, changes: { rotationDeg: 1 } }])
    const source = scene.propDefinitions['scatter-definition']
    scene.propDefinitions.alternate = { ...structuredClone(source), id: 'alternate', catalogId: 'test.layer-scatter-alternate', defaultAppearance: { kind: 'symbol', symbol: 'chair', tint: null, opacity: 1 } }
    scene.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, kind: 'note', visibility: 'public', text: 'target', anchor: { type: 'entity', entityKind: 'prop', entityId: targetId } }
    scene.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, kind: 'note', visibility: 'public', text: 'dependent', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    scene.entityLayers.first = layerId; scene.entityLayers.second = layerId
    expect(() => applyCommandsV3(scene, [{ type: 'replacePropAppearance', id: targetId, definitionRef: { id: 'alternate', version: 1 } }])).toThrow(/second/)
    scene.notes.first.anchor = { type: 'entity', entityKind: 'scatterGroup', entityId: 'scatter' }
    expect(() => applyCommandsV3(scene, [{ type: 'updateProp', id: targetId, changes: { rotationDeg: 2 } }])).toThrow(/second/)
  })
  it('refuses deletion through anchored-note chains and retains every original byte on rejection', () => {
    const scene = applyCommandsV3(blank(), [area()]), layerId = scene.entityLayers.area
    scene.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, kind: 'note', visibility: 'public', text: 'a', anchor: { type: 'entity', entityKind: 'terrainArea', entityId: 'area' } }
    scene.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, kind: 'note', visibility: 'public', text: 'b', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
    scene.entityLayers.first = layerId; scene.entityLayers.second = layerId
    const before = JSON.stringify(scene)
    expect(() => applyCommandsV3(scene, [{ type: 'deleteOutdoorEntity', kind: 'terrainArea', id: 'area' }])).toThrow(/first/)
    expect(JSON.stringify(scene)).toBe(before)
    expect(previewOutdoorCommandsV3(scene, [{ type: 'updateTerrainArea', id: 'area', changes: { groundElevationMm: 1000 } }]).affectedIds).toEqual(expect.arrayContaining(['first', 'second']))
  })
  it('never persists effective layer locks into unrelated entity lock fields during member detach/delete', () => {
    let scene = scatterLayerSceneV3(2)
    const layer = scene.entityLayers.item
    scene = applyCommandsV3(scene, [{ type: 'createLayer', id: 'locked-other', floorId: 'blank-floor', name: 'other' }])
    scene = applyCommandsV3(scene, [{ type: 'moveEntitiesToLayer', ids: ['item'], layerId: 'locked-other' }])
    scene = applyCommandsV3(scene, [{ type: 'setLayerLock', id: 'locked-other', locked: true }])
    const first = Object.values(scene.scatterGroups.scatter.members)[0].propId!
    const next = applyCommandsV3(scene, [{ type: 'detachScatterMember', groupId: 'scatter', propId: first }])
    expect(next.props.item.editLocked).toBe(false); expect(next.userLayers['locked-other'].editLocked).toBe(true)
    expect(next.entityLayers[first]).toBe(layer)
  })
})
