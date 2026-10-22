import { describe, expect, it } from 'vitest'
import { symbolPropV3, scatterLayerSceneV3 } from '../v3/test-fixtures'
import { applyCompositionCommandsV5 } from './commands'
import { createCompositionContentV5, resolveAppearanceV5, syncAppearanceGraphV5 } from './graph'
import { compositionFixtureV5, imageFixtureV5, prefabFixtureV5, resolveMetadataOnlyV5, surfaceFixtureV5 } from './test-fixtures'
import type { AppearanceAdjustmentV5, AppearanceScopeV5, CompositionCommandV5, CompositionContentV5 } from './types'
import { validateCompositionContentV5 } from './schema'

const apply = (content: CompositionContentV5, ...commands: CompositionCommandV5[]) => validateCompositionContentV5(resolveAppearanceV5(applyCompositionCommandsV5(content, commands)))
const set = (scope: AppearanceScopeV5, adjustment: AppearanceAdjustmentV5): CompositionCommandV5 => ({ type: 'setAppearanceAdjustment', scope, adjustment })
const target = (id = 'item'): AppearanceScopeV5 => ({ kind: 'targets', ids: [id] })
const opacity = (id: string, value: number, enabled = true): AppearanceAdjustmentV5 => ({ id, kind: 'opacity', value, enabled })
const create: Extract<CompositionCommandV5, { type: 'createPrefab' }> = { type: 'createPrefab', id: 'new-group', definitionId: 'new-definition', name: 'Frozen furniture', ids: ['item', 'other'], anchorMm: { x: 5000, y: 4000 } }

describe('C3 finite composition commands', () => {
  it('applies source → layer → instance priority and removes/toggles parameters independently', () => {
    const initial = compositionFixtureV5(), scope: AppearanceScopeV5 = { kind: 'layer', layerId: initial.document.entityLayers.item }
    const layered = apply(initial, set(scope, opacity('layer', .25)))
    const instance = apply(layered, set(target(), opacity('instance', .7)), set(target(), { id: 'shadow', kind: 'shadowClass', value: 'furniture', enabled: true }))
    expect(instance.document.props.item.appearance.opacity).toBe(.7)
    expect(instance.document.props.other.appearance.opacity).toBe(.25)
    const disabled = apply(instance, { type: 'toggleAppearanceAdjustment', scope: target(), adjustmentId: 'instance', enabled: false })
    expect(disabled.document.props.item.appearance.opacity).toBe(.25)
    expect(disabled.document.props.item.shadowClass).toBe('furniture')
    const removed = apply(disabled, { type: 'removeAppearanceAdjustment', scope: target(), adjustmentId: 'shadow' })
    expect(removed.document.props.item.shadowClass).toBe('none')
    expect(initial.appearance.instanceAdjustments).toEqual({})
    expect(removed.document.revision).toBe(initial.document.revision)
    expect(removed.document.props.item.footprintMm).toEqual(initial.document.props.item.footprintMm)
  })

  it('lets repeated sets replace the enabled value, and toggling old records is mutually exclusive', () => {
    let content = apply(compositionFixtureV5(), set(target(), opacity('first', .2)))
    content = apply(content, set(target(), opacity('second', .8)))
    expect(content.appearance.instanceAdjustments.item.map(record => [record.id, record.enabled])).toEqual([['first', false], ['second', true]])
    expect(content.document.props.item.appearance.opacity).toBe(.8)
    content = apply(content, { type: 'toggleAppearanceAdjustment', scope: target(), adjustmentId: 'first', enabled: true })
    expect(content.document.props.item.appearance.opacity).toBe(.2)
    expect(content.appearance.instanceAdjustments.item.filter(record => record.enabled)).toHaveLength(1)
    expect(() => apply(content, set(target(), { id: 'first', kind: 'shadowClass', value: 'none', enabled: true }))).toThrow(/固定ID/)
  })

  it('keeps layer rules continuous while copied/fixed targets inherit only their own instance records', () => {
    const initial = compositionFixtureV5(), layerId = initial.document.entityLayers.item
    let content = apply(initial, { type: 'createLayer', id: 'second-layer', floorId: 'blank-floor', name: 'Other layer' })
    content = apply(content, set({ kind: 'layer', layerId }, opacity('layer', .25)), set(target(), opacity('instance', .7)))
    const copied = apply(content, { type: 'copyProp', id: 'item', newId: 'copy', offsetMm: { x: 1000, y: 1000 } })
    expect(copied.appearance.propSources.copy).toBe(copied.appearance.propSources.item)
    expect(copied.appearance.instanceAdjustments.copy).toEqual(copied.appearance.instanceAdjustments.item)
    const moved = apply(copied, { type: 'moveEntitiesToLayer', ids: ['other'], layerId: 'second-layer' })
    expect(moved.document.props.other.appearance.opacity).toBe(1)
    expect(moved.document.props.item.appearance.opacity).toBe(.7)
    expect(moved.appearance.propSources).toEqual(copied.appearance.propSources)
  })

  it('rejects whole explicit mixed unsupported scopes and respects member, parent and layer locks', () => {
    const image = imageFixtureV5(), before = structuredClone(image)
    expect(() => applyCompositionCommandsV5(image, [set({ kind: 'targets', ids: ['item', 'other'] }, { id: 'brightness', kind: 'brightness', value: .5, enabled: true })])).toThrow(/不支持/)
    expect(image).toEqual(before)
    for (const lock of ['member', 'parent', 'layer'] as const) {
      const content = prefabFixtureV5()
      if (lock === 'member') content.document.props.left.editLocked = true
      if (lock === 'parent') content.document.prefabInstances.group.editLocked = true
      if (lock === 'layer') content.document.userLayers[content.document.entityLayers.left].editLocked = true
      expect(() => apply(content, set(target('left'), opacity('locked', .5)))).toThrow(/锁定/)
    }
  })

  it('does not leak partially successful changes when a later scope or resource preparation fails', () => {
    const content = imageFixtureV5(), before = structuredClone(content)
    expect(() => applyCompositionCommandsV5(content, [set(target(), opacity('valid', .5)), set(target('missing'), opacity('invalid', .2))])).toThrow()
    const draft = applyCompositionCommandsV5(content, [set(target(), { id: 'brightness', kind: 'brightness', value: .5, enabled: true })])
    expect(() => validateCompositionContentV5(draft)).toThrow(/派生位图/)
    expect(content).toEqual(before)
    const resolved = resolveMetadataOnlyV5(draft)
    expect(resolved.document.props.item.appearance).toMatchObject({ kind: 'image', tint: null })
    expect(resolved.document.props.item.positionMm).toEqual(content.document.props.item.positionMm)
  })

  it('keeps actual source edits separate from effective overrides and explicitly rejects the 17th source generation', () => {
    let content = surfaceFixtureV5()
    const source = content.appearance.surfaceSources.domain
    const unchanged = apply(content, { type: 'setSurfacePaint', kind: 'terrainArea', id: 'domain', changes: { rotationDeg: 0 } })
    expect(unchanged.appearance.surfaceSources.domain).toBe(source)
    for (let i = 1; i < 16; i++) content = apply(content, { type: 'setSurfacePaint', kind: 'terrainArea', id: 'domain', changes: { rotationDeg: i } })
    const before = structuredClone(content)
    expect(() => apply(content, { type: 'setSurfacePaint', kind: 'terrainArea', id: 'domain', changes: { rotationDeg: 16 } })).toThrow(/16层/)
    expect(content).toEqual(before)
  })

  it('captures selected effective appearance into a private fixed reusable definition without retaining layer links', () => {
    let content = compositionFixtureV5(); content.document.props.item.visibility = 'gm'
    content = apply(content, set({ kind: 'layer', layerId: content.document.entityLayers.item }, opacity('layer', .3)))
    const created = apply(content, create)
    expect(created.document.prefabInstances['new-group'].visibility).toBe('gm')
    expect(created.appearance.prefabAppearanceTemplates['new-definition'].visibility).toBe('gm')
    expect(created.historyIdentity.prefabTokens['new-group']).toBeTruthy()
    expect(created.historyIdentity.propTokens.item).toBe(content.historyIdentity.propTokens.item)
    const changed = apply(created, set({ kind: 'layer', layerId: content.document.entityLayers.item }, opacity('changed-layer', .8)))
    const placed = apply(changed, { type: 'instantiatePrefab', id: 'placed', definitionRef: { id: 'new-definition', version: 1 }, memberIds: { 'member-1': 'p1', 'member-2': 'p2' }, anchorMm: { x: 5000, y: 8000 }, layerId: content.document.entityLayers.item, supportRef: { kind: 'floor', id: 'blank-floor' } })
    expect(placed.document.props.p1.appearance.opacity).toBe(.3)
    expect(placed.document.props.item.appearance.opacity).toBe(.8)
    expect(placed.document.props.p1.visibility).toBe('gm')
    expect(placed.document.props.p1.positionMm).toEqual({ x: 4000, y: 8000 })
    expect(placed.document.prefabDefinitions['new-definition']).toEqual(created.document.prefabDefinitions['new-definition'])
    expect(() => apply(placed, { ...create, id: 'another-group', ids: ['p1'], definitionId: 'new-definition' })).toThrow()
  })

  it('duplicates full current member state, deleted slots, ordering and private semantics with fresh identities', () => {
    const source = prefabFixtureV5(), before = structuredClone(source)
    source.document.props.left.renderOrder = 7; source.document.props.right.renderOrder = 2
    const copied = apply(source, { type: 'duplicatePrefab', id: 'group', newId: 'copy-group', memberIds: { left: 'copy-left', right: 'copy-right' }, offsetMm: { x: 1000, y: 3000 } })
    expect(copied.document.prefabInstances['copy-group'].members.removed).toEqual(source.document.prefabInstances.group.members.removed)
    expect(copied.document.prefabInstances['copy-group'].members.left.overrideFields).toEqual(['positionMm'])
    expect(copied.document.props['copy-left'].appearance).toEqual(source.document.props.left.appearance)
    expect(copied.document.props['copy-left'].visibility).toBe('gm')
    expect(copied.document.props['copy-left'].renderOrder).toBeGreaterThan(copied.document.props['copy-right'].renderOrder)
    expect(copied.historyIdentity.prefabTokens['copy-group']).not.toBe(source.historyIdentity.prefabTokens.group)
    expect(copied.historyIdentity.propTokens['copy-left']).not.toBe(source.historyIdentity.propTokens.left)
    expect(source.document.prefabInstances).toEqual(before.document.prefabInstances)
  })

  it('requires complete group deletion scope and reserves all deleted group/member identities', () => {
    const content = prefabFixtureV5()
    expect(() => apply(content, { type: 'deletePrefab', id: 'group', memberIds: ['left'] })).toThrow(/全部/)
    const deleted = apply(content, { type: 'deletePrefab', id: 'group', memberIds: ['left', 'right'] })
    expect(deleted.document.prefabInstances.group).toBeUndefined()
    expect(deleted.appearance.propSources.left).toBeUndefined()
    expect(deleted.historyIdentity).toEqual(content.historyIdentity)
    expect(() => apply(deleted, { type: 'instantiatePrefab', id: 'group', definitionRef: { id: 'definition', version: 1 }, memberIds: { left: 'a', right: 'b', removed: 'c' }, anchorMm: { x: 1000, y: 1000 }, layerId: deleted.document.entityLayers.item, supportRef: { kind: 'floor', id: 'blank-floor' } })).toThrow(/复用/)
  })

  it('detaches/unpacks without publishing inherited private members and preserves their graph and identity', () => {
    const content = prefabFixtureV5()
    const detached = apply(content, { type: 'detachPrefabMember', groupId: 'group', propId: 'left' })
    expect(detached.document.prefabInstances.group.members.left.propId).toBeNull()
    expect(detached.document.props.left.visibility).toBe('gm')
    expect(detached.appearance.propSources.left).toBe(content.appearance.propSources.left)
    const unpacked = apply(content, { type: 'unpackPrefab', id: 'group' })
    expect(unpacked.document.prefabInstances.group).toBeUndefined()
    expect(unpacked.document.props.right.visibility).toBe('gm')
    expect(unpacked.historyIdentity).toEqual(content.historyIdentity)
  })

  it('resets current members to the fixed template and rebuilds deleted slots only with a fresh ID and explicit support', () => {
    const content = prefabFixtureV5()
    const changed = apply(content, set(target('left'), opacity('manual', .2)))
    const reset = apply(changed, { type: 'resetPrefabMember', groupId: 'group', key: 'left' })
    expect(reset.document.props.left.appearance.opacity).toBe(1)
    expect(reset.document.prefabInstances.group.members.left.overrideFields).toEqual([])
    expect(reset.historyIdentity.propTokens.left).toBe(content.historyIdentity.propTokens.left)
    expect(() => apply(content, { type: 'resetPrefabMember', groupId: 'group', key: 'removed' })).toThrow(/新ID和支撑/)
    const rebuilt = apply(content, { type: 'resetPrefabMember', groupId: 'group', key: 'removed', newId: 'rebuilt', supportRef: { kind: 'floor', id: 'blank-floor' } })
    expect(rebuilt.document.prefabInstances.group.members.removed.propId).toBe('rebuilt')
    expect(rebuilt.document.props.rebuilt.visibility).toBe('gm')
    expect(rebuilt.historyIdentity.propTokens.rebuilt).toBeTruthy()
  })

  it('rejects group/scatter membership, fixed definition conflicts, locked supports and outside geometry atomically', () => {
    const grouped = prefabFixtureV5()
    expect(() => apply(grouped, { ...create, ids: ['left'] })).toThrow(/独立物件/)
    const scatter = createCompositionContentV5(scatterLayerSceneV3(1))
    expect(() => apply(scatter, { ...create, ids: ['scatter-item-0'] })).toThrow(/独立物件/)
    expect(() => apply(compositionFixtureV5(), { ...create, definitionId: 'b2-p-03' })).toThrow(/复用/)
    expect(() => apply(grouped, { type: 'instantiatePrefab', id: 'fresh', definitionRef: { id: 'definition', version: 2 }, memberIds: { left: 'a', right: 'b', removed: 'c' }, anchorMm: { x: 1000, y: 1000 }, layerId: grouped.document.entityLayers.item, supportRef: { kind: 'floor', id: 'blank-floor' } })).toThrow(/版本/)
    const before = structuredClone(grouped)
    expect(() => apply(grouped, { type: 'duplicatePrefab', id: 'group', newId: 'copy', memberIds: { left: 'a', right: 'b' }, offsetMm: { x: 20000, y: 20000 } })).toThrow()
    expect(grouped).toEqual(before)
    const terrainGroup = apply(scatter, { ...create, ids: ['item'] })
    terrainGroup.document.terrainAreas.domain.editLocked = true
    expect(() => apply(terrainGroup, { type: 'instantiatePrefab', id: 'placed-on-locked', definitionRef: { id: create.definitionId, version: 1 }, memberIds: { 'member-1': 'locked-member' }, anchorMm: { x: 6000, y: 6000 }, layerId: terrainGroup.document.entityLayers.item, supportRef: { kind: 'terrainArea', id: 'domain' } })).toThrow(/锁定/)
  })

  it('rejects raw and expanded transaction budgets without splitting or mutating the source', () => {
    const content = compositionFixtureV5(), before = structuredClone(content)
    expect(() => applyCompositionCommandsV5(content, Array.from({ length: 257 }, (_, i) => set(target(), opacity(`a${i}`, .5))))).toThrow(/256/)
    const document = content.document
    for (let i = 0; i < 255; i++) { const id = `extra-${i}`; document.props[id] = symbolPropV3(id, 1000 + i % 20 * 500, 1000 + Math.floor(i / 20) * 500); document.entityLayers[id] = document.entityLayers.item }
    const large = createCompositionContentV5(document)
    expect(() => apply(large, set({ kind: 'layer', layerId: document.entityLayers.item }, opacity('layer', .5)))).toThrow(/256/)
    expect(large.appearance.layerAdjustments).toEqual({})
    expect(before.appearance.layerAdjustments).toEqual({})
  })

  it('strictly rejects unknown/accessor commands and mixed source capture before materialization', () => {
    const content = compositionFixtureV5()
    expect(() => applyCompositionCommandsV5(content, [{ ...create, future: true } as never])).toThrow(/无效/)
    expect(() => apply(content, set(target(), opacity('o', .5)), create)).toThrow(/资源准备/)
    expect(() => apply(content, set(target(), opacity('o', .5)), { type: 'updateProp', id: 'item', changes: { rotationDeg: 10 } })).toThrow(/混批/)
    let reads = 0; const command = { type: 'setAppearanceAdjustment', scope: target() }
    Object.defineProperty(command, 'adjustment', { enumerable: true, get: () => { reads++; return opacity('o', .5) } })
    expect(() => applyCompositionCommandsV5(content, [command as never])).toThrow(/访问器/)
    expect(reads).toBe(0)
  })
})
