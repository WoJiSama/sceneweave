import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { advanceHistoryIdentity, mergeIdentityRecords, validateHistoryIdentity, validateHistoryIdentityShape } from '../history/identity.js'
import { cloneJson } from '../validation/json.js'
import type { AggregateGroup } from '../model/aggregate.js'
import type { CompositionContent } from '../model/appearance.js'
import { advanceExtendedIdentityDescriptors } from '../terrain-generation/identities.js'

const group = (id: string): AggregateGroup => ({ id, floorId: 'blank-floor', parentId: null, editLocked: false,
  frame: { translationMm: { x: 1000, y: -300 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }, { kind: 'prop', id: 'other' }] })
function source() {
  const { document, historyIdentity, appearance } = fixture().project
  return applyCompositionCommands({ document, historyIdentity, appearance }, [{ type: 'createAggregateGroup', group: group('original') }], runtime)
}
function split(content: CompositionContent) {
  return applyCompositionCommands(content, [{ type: 'splitAggregateGroup', id: 'original', parts: [
    { id: 'left', members: [{ kind: 'prop', id: 'item' }], childGroupIds: [] }, { id: 'right', members: [{ kind: 'prop', id: 'other' }], childGroupIds: [] },
  ] }], runtime)
}

describe('persistent aggregate container birth ledger', () => {
  it('retires original and split containers across transactions instead of accepting an old ID as a fresh merge/create/copy result', () => {
    const initial = source(), divided = split(initial), before = cloneJson(divided)
    expect(divided.historyIdentity.aggregateTokens!.original).toBe(initial.historyIdentity.aggregateTokens!.original)
    expect(new Set(Object.values(divided.historyIdentity.aggregateTokens!)).size).toBe(3)
    expect(() => applyCompositionCommands(divided, [{ type: 'mergeAggregateGroups', ids: ['left', 'right'], newId: 'original' }], runtime)).toThrow(/已分配/)
    expect(() => applyCompositionCommands(divided, [{ type: 'createAggregateGroup', group: { ...group('original'), members: [] } }], runtime)).toThrow(/已分配/)
    expect(() => applyCompositionCommands(divided, [{ type: 'copyProp', id: 'item', newId: 'original', offsetMm: { x: 0, y: 0 } }], runtime)).toThrow(/已分配/)
    const merged = applyCompositionCommands(divided, [{ type: 'mergeAggregateGroups', ids: ['left', 'right'], newId: 'merged' }], runtime)
    expect(merged.historyIdentity.aggregateTokens).toMatchObject(divided.historyIdentity.aggregateTokens!)
    expect(merged.historyIdentity.aggregateTokens!.merged).toBeDefined()
    expect(merged.historyIdentity.propTokens).toEqual(initial.historyIdentity.propTokens)
    expect(divided).toEqual(before)
  })

  it('rejects same-batch delete/recreate of a container even when the final geometry and membership match', () => {
    const initial = source(), before = cloneJson(initial)
    expect(() => applyCompositionCommands(initial, [
      { type: 'dissolveAggregateGroup', id: 'original' }, { type: 'createAggregateGroup', group: group('original') },
    ], runtime)).toThrow(/已分配|已占用/)
    expect(initial).toEqual(before)
  })

  it('restores the genuine prior container with the same birth on undo/redo while retaining every later tombstone', () => {
    const initial = source(), divided = split(initial), merged = applyCompositionCommands(divided, [{ type: 'mergeAggregateGroups', ids: ['left', 'right'], newId: 'merged' }], runtime)
    const undoIdentity = advanceHistoryIdentity(merged.historyIdentity, merged.document, divided.document, runtime, { allowResurrection: true })
    expect(undoIdentity.aggregateTokens).toEqual(merged.historyIdentity.aggregateTokens)
    const undo = validateHistoryIdentity(mergeIdentityRecords(divided.historyIdentity, [undoIdentity]), divided.document)
    const redo = advanceHistoryIdentity(undo, divided.document, merged.document, runtime, { allowResurrection: true })
    expect(redo.aggregateTokens).toEqual(merged.historyIdentity.aggregateTokens)
    expect(redo.propTokens).toEqual(initial.historyIdentity.propTokens)
    expect(() => advanceHistoryIdentity(merged.historyIdentity, merged.document, divided.document, runtime)).toThrow(/不能复用/)
  })

  it('requires live groups to have real births, enforces token/ID uniqueness and includes container tombstones in the common 65536 bound', () => {
    const initial = source(), missing = cloneJson(initial.historyIdentity)
    delete missing.aggregateTokens
    expect(() => validateHistoryIdentity(missing, initial.document)).toThrow(/聚合容器缺少出生/)
    const duplicateToken = cloneJson(initial.historyIdentity); duplicateToken.aggregateTokens!.original = duplicateToken.propTokens.item
    expect(() => validateHistoryIdentityShape(duplicateToken)).toThrow(/全局唯一/)
    const duplicateId = cloneJson(initial.historyIdentity); duplicateId.aggregateTokens!.item = 'different-token'
    expect(() => validateHistoryIdentityShape(duplicateId)).toThrow(/ID重复/)
    const tooMany = cloneJson(initial.historyIdentity)
    tooMany.aggregateTokens = Object.fromEntries(Array.from({ length: 65536 }, (_, i) => [`retired-${i}`, `token-${i}`]))
    expect(() => validateHistoryIdentityShape(tooMany)).toThrow(/65536/)
  })

  it('preserves exact birth ledger across reparent/dissolve and rejects conflicting historical birth meanings', () => {
    const initial = source(), parent = applyCompositionCommands(initial, [{ type: 'createAggregateGroup', group: { ...group('parent'), members: [] } }], runtime)
    const reparented = applyCompositionCommands(parent, [{ type: 'reparentAggregateGroup', id: 'original', parentId: 'parent' }], runtime)
    const dissolved = applyCompositionCommands(reparented, [{ type: 'dissolveAggregateGroup', id: 'original' }], runtime)
    expect(dissolved.historyIdentity.aggregateTokens).toEqual(parent.historyIdentity.aggregateTokens)
    const conflict = cloneJson(initial.historyIdentity); conflict.aggregateTokens!.original = 'forged-birth'
    expect(() => mergeIdentityRecords(parent.historyIdentity, [conflict])).toThrow(/聚合容器出生身份冲突/)
  })

  it('rejects cross-pool IDs in both directions for outdoor, terrain, decoration, surface rules, generation, regional and presentation births', () => {
    const initial = source()
    const pools = [
      ['outdoorTokens', 'path'], ['terrainTokens', 'terrainFeature'], ['decorationTokens', 'decoration'],
      ['surfaceRuleTokens', 'surfaceRule'], ['generationTokens', 'generationRule'], ['regionalTokens', 'regionalArea'], ['presentationTokens', 'surfaceOverlay'],
    ] as const
    for (const [field, kind] of pools) {
      const record = { kind, token: `foreign-birth-${field}`, topologyToken: `foreign-topology-${field}`, topologyHash: 'a'.repeat(64) }
      const duplicate = cloneJson(initial.historyIdentity)
      ;(duplicate as unknown as Record<string, unknown>)[field] = { original: record }
      expect(() => validateHistoryIdentityShape(duplicate)).toThrow(/ID重复/)
      const tombstone = cloneJson(initial)
      ;(tombstone.historyIdentity as unknown as Record<string, unknown>)[field] = { 'retired-foreign': record }
      expect(() => applyCompositionCommands(tombstone, [{ type: 'createAggregateGroup', group: { ...group('retired-foreign'), members: [] } }], runtime)).toThrow(/已分配/)
    }
    for (const [field, kind] of [['generationTokens', 'generationRule'], ['regionalTokens', 'regionalArea'], ['presentationTokens', 'surfaceOverlay']] as const) {
      const identity = cloneJson(initial.historyIdentity)
      expect(() => advanceExtendedIdentityDescriptors(identity, {}, { original: { field, kind, topologyHash: 'b'.repeat(64) } }, runtime)).toThrow(/已分配身份冲突/)
    }
  })
})
