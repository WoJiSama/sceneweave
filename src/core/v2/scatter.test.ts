import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { scatterFixtureV2 } from './b3.test-helpers'
import { applyCommandsV2 } from './commands'
import { pathPolygonV2, polygonDistance, polygonInside, propFootprintV2 } from './geometry'
import { buildScatterRegenerationV2, roundScatterMmV2, sampleScatterCellV1, sha256TextV2 } from './scatter'
import { validateSceneV2 } from './schema'

const regenerate = (scene: ReturnType<typeof scatterFixtureV2>, densityFactor?: number) => applyCommandsV2(scene, [{ type: 'regenerateScatter', id: 'trees', ...(densityFactor === undefined ? {} : { densityFactor }) }])
const entries = (scene: ReturnType<typeof scatterFixtureV2>) => Object.entries(scene.scatterGroups.trees.members).filter(([, member]) => member.propId !== null)

describe('scatter-cell-v1 exact streams', () => {
  it('matches SHA-256 UTF-8 standard vectors and independent node crypto across blocks', () => {
    expect(sha256TextV2('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256TextV2('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const text of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), '树🌿礁岸'.repeat(40)]) expect(sha256TextV2(text)).toBe(createHash('sha256').update(text).digest('hex'))
  })
  it('keeps concrete signed-grid UTF-8/hash/position/rotation/palette vectors', () => {
    const group = scatterFixtureV2().scatterGroups.trees
    expect(sampleScatterCellV1(group, -2, 3)).toEqual({ candidateKey: '3166fdff089b32a745565df6c8265347407b34cfbb8579052c3671e92dbdcb96', density: 0.3329892946460864, positionMm: { x: -2711, y: 5691 }, rotationDeg: 207.281, paletteKey: 'a-shrub', definitionRef: { id: 'shrub', version: 1 } })
    group.seed = 'sceneweave'
    expect(sampleScatterCellV1(group, 0, 0)).toEqual({ candidateKey: '90350e626162e91578ab5f3d421f58232ac7e8261f5e94aeac7777c6cc53b07f', density: 0.3719807300694229, positionMm: { x: 819, y: -402 }, rotationDeg: 172.826, paletteKey: 'z-tree', definitionRef: { id: 'tree', version: 1 } })
    expect([roundScatterMmV2(-1.5), roundScatterMmV2(1.5), roundScatterMmV2(-0.1)]).toEqual([-2, 2, 0])
    group.palette.reverse(); expect(sampleScatterCellV1(group, 0, 0).paletteKey).toBe('z-tree')
  })
})

describe('atomic persisted scatter adoption and regeneration', () => {
  it('prepares and adopts exact deterministic concrete props without changing the source or revision', () => {
    const scene = scatterFixtureV2(), before = structuredClone(scene)
    const proposal = buildScatterRegenerationV2(scene, 'trees'), adopted = regenerate(scene)
    expect(scene).toEqual(before); expect(proposal.props.length).toBeGreaterThan(20)
    expect(adopted.revision).toBe(scene.revision); expect(adopted.updatedAt).toBe(scene.updatedAt)
    expect(validateSceneV2(adopted).ok).toBe(true); expect(regenerate(adopted)).toEqual(adopted)
    expect(proposal.props).toEqual(Object.values(adopted.props))
    for (const [key, member] of entries(adopted)) expect(member).toMatchObject({ state: 'managed', propId: expect.any(String) })
    for (const prop of Object.values(adopted.props)) expect(polygonDistance(propFootprintV2(prop), adopted.scatterGroups.trees.exclusions[0].boundaryMm)).toBeGreaterThan(0)
  })
  it('preserves manual, deleted, detached and locked members, stable IDs and world exclusions at greater density', () => {
    let scene = regenerate(scatterFixtureV2())
    const members = entries(scene), [manualKey, manual] = members[0], [deletedKey, deleted] = members[1], [detachedKey, detached] = members[2], [lockedKey, locked] = members[3]
    const manualId = manual.propId!, deletedId = deleted.propId!, detachedId = detached.propId!, lockedId = locked.propId!
    scene = applyCommandsV2(scene, [{ type: 'updateProp', id: manualId, changes: { rotationDeg: 22.123 } }, { type: 'deleteProp', id: deletedId }, { type: 'detachScatterMember', groupId: 'trees', propId: detachedId }, { type: 'setEditLock', kind: 'prop', id: lockedId, locked: true }])
    const manualProp = structuredClone(scene.props[manualId]), detachedProp = structuredClone(scene.props[detachedId]), lockedProp = structuredClone(scene.props[lockedId]), exclusion = structuredClone(scene.scatterGroups.trees.exclusions)
    const next = regenerate(scene, 1)
    expect(next.props[manualId]).toEqual(manualProp); expect(next.props[detachedId]).toEqual(detachedProp); expect(next.props[lockedId]).toEqual(lockedProp)
    expect(next.scatterGroups.trees.members[manualKey]).toMatchObject({ state: 'manual', overrideFields: ['rotationDeg'] })
    expect(next.scatterGroups.trees.members[deletedKey]).toMatchObject({ state: 'deleted', propId: null }); expect(next.props[deletedId]).toBeUndefined()
    expect(next.scatterGroups.trees.members[detachedKey]).toMatchObject({ state: 'detached', propId: null }); expect(next.scatterGroups.trees.members[lockedKey].propId).toBe(lockedId)
    expect(next.scatterGroups.trees.exclusions).toEqual(exclusion)
    for (const [, member] of entries(next)) if (member.state === 'managed' && !next.props[member.propId!].editLocked) expect(polygonDistance(propFootprintV2(next.props[member.propId!]), propFootprintV2(lockedProp))).toBeGreaterThanOrEqual(scene.scatterGroups.trees.minDistanceMm - 1e-7)
    expect(validateSceneV2(next).ok).toBe(true)
  })
  it('saves conservative rotated pre-delete AABB plus minDistance, with no resurrection at changed density', () => {
    let scene = regenerate(scatterFixtureV2()), [key, member] = entries(scene)[0]
    const propId = member.propId!, prop = scene.props[propId], footprint = propFootprintV2(prop), distance = scene.scatterGroups.trees.minDistanceMm
    scene = applyCommandsV2(scene, [{ type: 'deleteProp', id: propId }])
    const box = scene.scatterGroups.trees.exclusions.find(item => item.sourceCandidateKey === key)!
    expect(box.boundaryMm).toEqual([{ x: Math.floor(Math.min(...footprint.map(p => p.x))) - distance, y: Math.floor(Math.min(...footprint.map(p => p.y))) - distance }, { x: Math.ceil(Math.max(...footprint.map(p => p.x))) + distance, y: Math.floor(Math.min(...footprint.map(p => p.y))) - distance }, { x: Math.ceil(Math.max(...footprint.map(p => p.x))) + distance, y: Math.ceil(Math.max(...footprint.map(p => p.y))) + distance }, { x: Math.floor(Math.min(...footprint.map(p => p.x))) - distance, y: Math.ceil(Math.max(...footprint.map(p => p.y))) + distance }])
    const next = regenerate(regenerate(scene, 0), 1)
    expect(next.scatterGroups.trees.members[key].state).toBe('deleted'); expect(next.props[propId]).toBeUndefined()
  })
  it('keeps a locked managed instance at zero density and rejects actual locked/group edits atomically', () => {
    let scene = regenerate(scatterFixtureV2()), propId = entries(scene)[0][1].propId!
    scene = applyCommandsV2(scene, [{ type: 'setEditLock', kind: 'prop', id: propId, locked: true }])
    expect(entries(regenerate(scene, 0))).toHaveLength(1)
    expect(() => applyCommandsV2(scene, [{ type: 'updateProp', id: propId, changes: { rotationDeg: 12 } }])).toThrow(/锁定/)
    const lockedGroup = applyCommandsV2(scene, [{ type: 'setEditLock', kind: 'scatterGroup', id: 'trees', locked: true }]), before = structuredClone(lockedGroup)
    expect(() => regenerate(lockedGroup, 0)).toThrow(/锁定/); expect(lockedGroup).toEqual(before)
    expect(() => applyCommandsV2(lockedGroup, [{ type: 'setEditLock', kind: 'prop', id: propId, locked: false }])).toThrow(/锁定/)
  })
  it('retains unknown-algorithm concrete results and permits direct manual edits while regeneration is disabled', () => {
    const scene = regenerate(scatterFixtureV2()), propId = entries(scene)[0][1].propId!, key = entries(scene)[0][0]
    scene.scatterGroups.trees.algorithmVersion = 'future-scatter-v9'
    expect(validateSceneV2(scene).ok).toBe(true)
    expect(() => regenerate(scene)).toThrow(/不可重新生成/)
    const next = applyCommandsV2(scene, [{ type: 'updateProp', id: propId, changes: { rotationDeg: 23 } }])
    expect(next.scatterGroups.trees.members[key].state).toBe('manual')
  })
  it('does not drop anchored notes or apply an earlier command when a later regeneration would remove their prop', () => {
    const scene = regenerate(scatterFixtureV2()), propId = entries(scene)[0][1].propId!
    scene.notes.anchored = { id: 'anchored', floorId: 'f-a1', editLocked: false, visibility: 'public', anchor: { type: 'entity', entityKind: 'prop', entityId: propId }, kind: 'note', text: 'keep anchor' }
    const before = structuredClone(scene)
    expect(() => applyCommandsV2(scene, [{ type: 'setTerrainElevation', id: 'island-high', groundElevationMm: 4000 }, { type: 'regenerateScatter', id: 'trees', densityFactor: 0 }])).toThrow(/注记引用/)
    expect(scene).toEqual(before)
  })
  it('retains an edited member outside the scatter domain with a warning while its real support remains valid', () => {
    const scene = regenerate(scatterFixtureV2()), propId = entries(scene)[0][1].propId!
    scene.scatterGroups.trees.domain = { kind: 'edgeBand', edgeId: 'cliff', widthMm: 1000 }
    for (const member of Object.values(scene.scatterGroups.trees.members)) member.state = 'manual'
    const validation = validateSceneV2(scene)
    expect(validation.ok).toBe(true)
    if (validation.ok) expect(validation.warnings.some(w => w.code === 'MANUAL_SCATTER_OUTSIDE_DOMAIN' && w.entityId === propId)).toBe(true)
    expect(regenerate(scene).props[propId]).toEqual(scene.props[propId])
  })
  it('supports explicit path and edge-band domains with full rotated support on one side of a cliff', () => {
    const scene = scatterFixtureV2()
    scene.paths.path = { id: 'path', floorId: 'f-a1', editLocked: false, visibility: 'public', centerlineMm: [{ x: 3000, y: 3000 }, { x: 3000, y: 16000 }], widthMm: 2000, supportRefs: [{ kind: 'terrainArea', id: 'island-low' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    scene.scatterGroups.trees.domain = { kind: 'path', pathId: 'path' }
    const path = regenerate(scene)
    expect(Object.keys(path.props).length).toBeGreaterThan(3)
    for (const prop of Object.values(path.props)) expect(polygonInside(propFootprintV2(prop), pathPolygonV2(path.paths.path))).toBe(true)
    scene.scatterGroups.trees.domain = { kind: 'edgeBand', edgeId: 'cliff', widthMm: 3000 }
    const band = regenerate(scene)
    expect(Object.keys(band.props).length).toBeGreaterThan(8)
    expect(new Set(Object.values(band.props).map(prop => prop.supportRef.id))).toEqual(new Set(['island-low', 'island-high']))
    expect(validateSceneV2(band).ok).toBe(true)
  })
  it('keeps a same-configuration regeneration a byte-for-byte no-op after manual edits', () => {
    let scene = regenerate(scatterFixtureV2()), propId = entries(scene)[2][1].propId!
    scene = applyCommandsV2(scene, [{ type: 'updateProp', id: propId, changes: { rotationDeg: 22 } }])
    expect(JSON.stringify(regenerate(scene))).toBe(JSON.stringify(scene))
  })
  it('rejects excessive grids and unknown nested command fields without mutating the scene', () => {
    const scene = scatterFixtureV2(); scene.scatterGroups.trees.cellSizeMm = 1
    const before = structuredClone(scene)
    expect(() => regenerate(scene)).toThrow(/250000/); expect(scene).toEqual(before)
    expect(() => applyCommandsV2(scatterFixtureV2(), [{ type: 'regenerateScatter', id: 'trees', seed: 'silent-rebuild' } as never])).toThrow(/指令无效/)
  })
})
