import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { groupLayerSceneV3, scatterLayerSceneV3 } from '../../core/v3/test-fixtures.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { applyCommands, applySnapshotCommands, type SceneCommand } from './commands.js'
import { previewOutdoorCommands } from './outdoor.js'

const blocking = (id: string, blocksMovement = true): SceneCommand => ({ type: 'setPropBlocking', id, blocksMovement })
const scatter = (count = 1) => toCurrentSceneDocument({ ...scatterLayerSceneV3(count), format: 'sceneweave-scene' })
const group = () => toCurrentSceneDocument({ ...groupLayerSceneV3(), format: 'sceneweave-scene' })
function notes(scene: SceneDocument, propId: string) {
  scene.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: propId }, kind: 'note', text: 'first', visibility: 'gm' }
  scene.notes.second = { id: 'second', floorId: 'blank-floor', editLocked: true, anchor: { type: 'entity', entityKind: 'note', entityId: 'first' }, kind: 'note', text: 'second', visibility: 'gm' }
  scene.entityLayers.first = scene.entityLayers[propId]; scene.entityLayers.second = scene.entityLayers[propId]
}

describe('instance movement blocking command', () => {
  it('changes only the selected flag, preserving fixed defaults, image, support, sight and other objects', () => {
    const source = fixture({ image: true }).project.document, before = cloneJson(source)
    const next = applyCommands(source, [blocking('item')], runtime)
    expect(next).toEqual({ ...before, props: { ...before.props, item: { ...before.props.item, blocksMovement: true } } })
    expect(source).toEqual(before)
    expect(next.propDefinitions.definition.defaultBlocksMovement).toBe(false)
    expect(applyCommands(next, [blocking('item', false)], runtime)).toEqual(before)
  })

  it.each([
    { type: 'setPropBlocking', id: 'item', blocksMovement: 'true' },
    { type: 'setPropBlocking', id: 'item', blocksMovement: true, blocksSight: true },
    { type: 'setPropBlocking', id: 'item' },
    { type: 'updateProp', id: 'item', changes: { blocksMovement: true } },
  ])('rejects malformed or overbroad commands without mutating input: %j', command => {
    const source = fixture().project.document, before = cloneJson(source)
    expect(() => applyCommands(source, [command as unknown as SceneCommand], runtime)).toThrow(/指令|命令/)
    expect(source).toEqual(before)
  })

  it('revalidates an immutable candidate and changes actual full-width route obstruction', () => {
    const source = fixture().project.document
    source.props.item.rotationDeg = 45; source.props.item.footprintMm = { width: 1000, height: 1000 }
    const certified = validateSceneSnapshot(source)
    if (!certified.ok) throw new Error(JSON.stringify(certified.errors))
    const request = { floorId: 'blank-floor', pointsMm: [{ x: 2000, y: 4000 }, { x: 6000, y: 4000 }], widthMm: 500 }
    expect(checkTerrainRoute(certified.document, request).ok).toBe(true)
    const next = applySnapshotCommands(certified.document, [blocking('item')], runtime)
    expect(Object.isFrozen(next.props.item)).toBe(true)
    expect(checkTerrainRoute(next, request)).toMatchObject({ ok: false, issues: [{ entityId: 'item' }] })
    expect(applySnapshotCommands(next, [blocking('item')], runtime)).toBe(next)
    expect(checkTerrainRoute(applySnapshotCommands(next, [blocking('item', false)], runtime), request).ok).toBe(true)
  })

  it.each(['entity', 'layer', 'prefab', 'scatter', 'recursive-note', 'note-layer'] as const)('rejects the complete transaction under a %s lock', kind => {
    const source = kind === 'prefab' ? group() : kind === 'scatter' ? scatter() : fixture().project.document
    const id = kind === 'prefab' ? 'left' : kind === 'scatter' ? 'scatter-item-0' : 'item'
    if (kind === 'entity') source.props[id].editLocked = true
    if (kind === 'layer') source.userLayers[source.entityLayers[id]].editLocked = true
    if (kind === 'prefab') source.prefabInstances.group.editLocked = true
    if (kind === 'scatter') source.scatterGroups.scatter.editLocked = true
    if (kind === 'recursive-note' || kind === 'note-layer') {
      notes(source, id)
      if (kind === 'note-layer') {
        source.notes.second.editLocked = false
        source.userLayers.protected = { id: 'protected', floorId: 'blank-floor', name: 'notes', order: 1, editLocked: true }
        source.entityLayers.second = 'protected'
      }
    }
    const before = cloneJson(source)
    expect(() => applyCommands(source, [blocking('item'), blocking(id)], runtime)).toThrow(/锁定/)
    expect(source).toEqual(before)
  })

  it('retains prefab manual overrides, deleted members and effective secrecy', () => {
    const source = group(), before = cloneJson(source)
    const next = applyCommands(source, [blocking('left')], runtime)
    expect(next.prefabInstances.group.members.left.overrideFields).toEqual(['positionMm', 'blocksMovement'])
    const expected = cloneJson(before)
    expected.props.left.blocksMovement = true
    expected.prefabInstances.group.members.left.overrideFields.push('blocksMovement')
    expect(next).toEqual(expected)
    expect(source).toEqual(before)
  })

  it('records a scatter flag as manual and keeps it through regeneration and deletion suppression', () => {
    const source = scatter(2), key = Object.keys(source.scatterGroups.scatter.members)[0]
    source.scatterGroups.scatter.members[key] = { propId: 'scatter-item-0', state: 'managed', overrideFields: [] }
    const before = cloneJson(source), command = blocking('scatter-item-0')
    const preview = previewOutdoorCommands(source, [command as { type: 'setPropBlocking'; id: string; blocksMovement: boolean }], runtime)
    expect(preview.reason).toBeNull()
    expect(preview.changedIds).toEqual(expect.arrayContaining(['scatter-item-0', 'scatter']))
    const edited = applyCommands(source, [command], runtime)
    expect(edited.scatterGroups.scatter.members[key]).toEqual({ propId: 'scatter-item-0', state: 'manual', overrideFields: ['blocksMovement'] })
    const deleted = applyCommands(edited, [{ type: 'deleteProp', id: 'scatter-item-1' }], runtime)
    const regenerated = applyCommands(deleted, [{ type: 'regenerateScatter', id: 'scatter', densityFactor: .1 }], runtime)
    expect(regenerated.props['scatter-item-0']).toEqual(edited.props['scatter-item-0'])
    expect(regenerated.scatterGroups.scatter.members[key]).toEqual(edited.scatterGroups.scatter.members[key])
    expect(regenerated.props['scatter-item-1']).toBeUndefined()
    expect(regenerated.scatterGroups.scatter.exclusions).toEqual(deleted.scatterGroups.scatter.exclusions)
    expect(source).toEqual(before)
  })

  it('charges changed member records against the same expanded transaction budget', () => {
    const source = scatter(129), before = cloneJson(source)
    const commands = Object.values(source.scatterGroups.scatter.members).map(member => blocking(member.propId!))
    expect(commands).toHaveLength(129)
    expect(() => applyCommands(source, commands, runtime)).toThrow(/256|预算/)
    expect(source).toEqual(before)
  })
})
