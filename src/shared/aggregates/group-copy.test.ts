import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent, resolveAppearance } from '../appearance/graph.js'
import type { AggregateGroup } from '../model/aggregate.js'
import { cloneJson } from '../validation/json.js'
import { inspectAggregateCopy, planAggregateCopy } from './group-copy.js'
import { aggregateWorldFrames } from './state.js'

const group = (id: string, parentId: string | null, members: AggregateGroup['members'], x = 0, turn: 0 | 1 | 2 | 3 = 0): AggregateGroup => ({
  id, parentId, members, floorId: 'blank-floor', editLocked: false, frame: { translationMm: { x, y: 500 }, quarterTurns: turn },
})
function source() {
  const bundle = fixture({ building: true }), scene = bundle.project.document
  scene.props.item.supportRef = { kind: 'room', id: 'room' }; scene.props.item.roomId = 'room'
  scene.rooms.room.visibility = 'gm'
  scene.notes.attached = { id: 'attached', floorId: 'blank-floor', editLocked: false, kind: 'clue', text: 'Private clue', title: 'Keep title',
    visibility: 'gm', discovered: false, anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  scene.notes.recursive = { id: 'recursive', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'Recursive clue',
    visibility: 'gm', anchor: { type: 'entity', entityKind: 'note', entityId: 'attached' } }
  scene.entityLayers.attached = scene.entityLayers.item; scene.entityLayers.recursive = scene.entityLayers.item
  scene.aggregateCoordinates = { encoding: 'world', groups: {
    outer: group('outer', null, [], 1500, 1),
    source: group('source', 'outer', [{ kind: 'prop', id: 'item' }], 700, 3),
    child: group('child', 'source', [{ kind: 'note', id: 'recursive' }, { kind: 'note', id: 'attached' }], -300, 2),
  } }
  Object.assign(bundle.project, createCompositionContent(scene, runtime))
  const { document, historyIdentity, appearance } = bundle.project
  return { document, historyIdentity, appearance }
}
const idMap = { source: 'copy-root', child: 'copy-child', item: 'copy-item', attached: 'copy-attached', recursive: 'copy-recursive' }

describe('finite independent-object aggregate copy', () => {
  it('copies a complete subtree with fresh instance identities and remaps internal recursive annotations while preserving explicit external support', () => {
    const original = source(), before = cloneJson(original), scope = inspectAggregateCopy(original.document, 'source')
    expect(scope.externalRefs).toEqual([{ kind: 'room', id: 'room' }])
    const commands = planAggregateCopy(original.document, 'source', { offsetMm: { x: 500, y: 300 }, idMap, externalRefs: scope.externalRefs })
    expect(commands.map(command => command.type)).toEqual(['copyProp', 'createNote', 'createNote', 'createAggregateGroup', 'createAggregateGroup'])
    const copy = applyCompositionCommands(original, commands, runtime), scene = copy.document
    expect(scene.props['copy-item'].positionMm).toEqual({ x: 4500, y: 4300 })
    expect(scene.props['copy-item'].supportRef).toEqual({ kind: 'room', id: 'room' })
    expect(scene.props['copy-item'].roomId).toBe('room')
    expect(scene.props['copy-item'].visibility).toBe('gm')
    expect(scene.notes['copy-attached']).toMatchObject({ text: 'Private clue', title: 'Keep title', visibility: 'gm', discovered: false,
      anchor: { type: 'entity', entityKind: 'prop', entityId: 'copy-item' } })
    expect(scene.notes['copy-recursive'].anchor).toEqual({ type: 'entity', entityKind: 'note', entityId: 'copy-attached' })
    expect(scene.aggregateCoordinates!.groups['copy-root'].parentId).toBeNull()
    expect(scene.aggregateCoordinates!.groups['copy-child'].parentId).toBe('copy-root')
    const oldFrame = aggregateWorldFrames(original.document.aggregateCoordinates!).get('source')!, frame = aggregateWorldFrames(scene.aggregateCoordinates!).get('copy-root')!
    expect(frame).toEqual({ ...oldFrame, translationMm: { x: oldFrame.translationMm.x + 500, y: oldFrame.translationMm.y + 300 } })
    expect(copy.appearance.propSources['copy-item']).toBe(original.appearance.propSources.item)
    expect(scene.entityLayers['copy-item']).toBe(scene.entityLayers.item)
    expect(copy.historyIdentity.propTokens['copy-item']).not.toBe(original.historyIdentity.propTokens.item)
    expect(copy.historyIdentity.propTokens.item).toBe(original.historyIdentity.propTokens.item)
    expect(original).toEqual(before)
  })

  it('retains current manual appearance adjustments and actual positions without replaying a source or resetting to a material default', () => {
    const base = source(), adjusted = resolveAppearance(applyCompositionCommands(base, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'manual-opacity', kind: 'opacity', enabled: true, value: 0.35 } }], runtime))
    const commands = planAggregateCopy(adjusted.document, 'source', { offsetMm: { x: 500, y: 300 }, idMap,
      externalRefs: inspectAggregateCopy(adjusted.document, 'source').externalRefs })
    const copy = applyCompositionCommands(adjusted, commands, runtime)
    expect(copy.appearance.instanceAdjustments['copy-item']).toEqual(adjusted.appearance.instanceAdjustments.item)
    expect(copy.document.props['copy-item'].appearance).toEqual(adjusted.document.props.item.appearance)
  })

  it('rejects missing or extra mappings, duplicate/familiar result IDs and unknown external references before producing a command batch', () => {
    const original = source(), before = cloneJson(original), valid = { offsetMm: { x: 500, y: 300 }, idMap, externalRefs: [{ kind: 'room' as const, id: 'room' }] }
    for (const input of [
      { ...valid, externalRefs: [] },
      { ...valid, externalRefs: [...valid.externalRefs, { kind: 'floor' as const, id: 'blank-floor' }] },
      { ...valid, idMap: { ...idMap, extra: 'extra-copy' } },
      { ...valid, idMap: { ...idMap, item: 'item' } },
      { ...valid, idMap: { ...idMap, item: 'copy-root' } },
    ]) expect(() => planAggregateCopy(original.document, 'source', input)).toThrow()
    expect(() => planAggregateCopy(original.document, 'source', { ...valid, moveSource: true } as never)).toThrow()
    expect(original).toEqual(before)
  })

  it('rejects protected sources and unsupported physical/container members rather than flattening or reviving them', () => {
    const original = source()
    const locked = cloneJson(original.document); locked.notes.attached.editLocked = true
    expect(() => inspectAggregateCopy(locked, 'source')).toThrow(/锁/)
    for (const id of ['outer', 'source', 'child']) {
      const lockedGroup = cloneJson(original.document); lockedGroup.aggregateCoordinates!.groups[id].editLocked = true
      expect(() => inspectAggregateCopy(lockedGroup, 'source')).toThrow(/锁定的组/)
    }
    const structural = cloneJson(original.document)
    structural.aggregateCoordinates!.groups.source.members.push({ kind: 'room', id: 'room' })
    expect(() => inspectAggregateCopy(structural, 'source')).toThrow(/仅支持独立物件/)
    const scatter = cloneJson(original.document)
    scatter.scatterGroups.fake = { members: { gone: { propId: 'item', state: 'detached', overrideFields: ['positionMm'] } } } as never
    expect(() => inspectAggregateCopy(scatter, 'source')).toThrow(/退出及删除记录/)
  })

  it('keeps the explicit 256 command envelope instead of quietly splitting a large copy', () => {
    const scene = fixture().project.document
    const members: AggregateGroup['members'] = [], mapping: Record<string, string> = { large: 'copy-large' }
    for (let i = 0; i < 256; i++) {
      const id = `many-${i}`
      scene.props[id] = { ...cloneJson(scene.props.item), id }; scene.entityLayers[id] = scene.entityLayers.item
      members.push({ kind: 'prop', id }); mapping[id] = `copy-${id}`
    }
    scene.aggregateCoordinates = { encoding: 'world', groups: { large: group('large', null, members) } }
    expect(() => planAggregateCopy(scene, 'large', { offsetMm: { x: 1, y: 1 }, idMap: mapping, externalRefs: [{ kind: 'floor', id: 'blank-floor' }] })).toThrow(/256.*不能拆批/)
  })
})
