import { describe, expect, it } from 'vitest'
import { createAppearanceGraphV5, addPropAppearanceSourceV5, addSurfaceAppearanceSourceV5, bitmapVariantV5, ensureSourceAssetRootsV5, freezeEffectivePropAppearanceV5, freezeEffectiveSurfaceAppearanceV5, inspectAppearanceScopeV5, listRequiredVariantsV5, resolveAppearanceV5, syncAppearanceGraphV5 } from './graph'
import { validateAppearanceGraphV5, validateCompositionContentV5, validateCompositionDraftV5 } from './schema'
import { compositionFixtureV5, imageFixtureV5, prefabFixtureV5, resolveMetadataOnlyV5, surfaceFixtureV5 } from './test-fixtures'
import { applyCompositionCommandsV5 } from './commands'

describe('C3 immutable source and effective appearance graph', () => {
  it('creates complete detached sources and conservatively marks existing private prefab definitions', () => {
    const content = prefabFixtureV5(), before = structuredClone(content.document)
    expect(Object.keys(content.appearance.propSources).sort()).toEqual(Object.keys(content.document.props).sort())
    expect(content.appearance.prefabAppearanceTemplates.definition.visibility).toBe('gm')
    delete content.appearance.prefabAppearanceTemplates.definition
    const synced = syncAppearanceGraphV5(content)
    expect(synced.appearance.prefabAppearanceTemplates.definition.visibility).toBe('gm')
    expect(content.document).toEqual(before)
    const publicGroup = structuredClone(before); publicGroup.prefabInstances.group.visibility = 'public'; publicGroup.props.left.visibility = 'gm'
    expect(createAppearanceGraphV5(publicGroup).prefabAppearanceTemplates.definition.visibility).toBe('gm')
  })

  it('deduplicates equal fixed snapshots and refuses cycles, dangling ancestors and wrong source types', () => {
    const content = compositionFixtureV5(), graph = content.appearance
    expect(addPropAppearanceSourceV5(graph, content.document.props.item)).toBe(graph.propSources.item)
    const source = graph.sources[graph.propSources.item]
    const cycle = structuredClone(graph); cycle.sources[source.id].parentSourceId = source.id
    expect(() => validateAppearanceGraphV5(cycle, content.document)).toThrow(/循环/)
    const dangling = structuredClone(graph); dangling.sources[source.id].parentSourceId = 'missing'
    expect(() => validateAppearanceGraphV5(dangling, content.document)).toThrow(/悬空/)
    const wrong = structuredClone(graph); wrong.surfaceSources.item = source.id
    expect(() => validateAppearanceGraphV5(wrong, content.document)).toThrow(/悬空/)
  })

  it('requires a full fixed source for every live target and rejects extra/unsupported semantics', () => {
    const content = compositionFixtureV5(), bad = structuredClone(content)
    delete bad.appearance.propSources.item
    expect(() => validateCompositionContentV5(bad)).toThrow(/缺少外观源/)
    expect(() => validateCompositionContentV5({ ...content, future: true })).toThrow(/无效/)
    expect(() => validateAppearanceGraphV5({ ...content.appearance, version: 2 }, content.document)).toThrow(/无效/)
    bad.appearance.propSources.item = content.appearance.propSources.item
    bad.appearance.instanceAdjustments.item = [{ id: 'unsupported', kind: 'brightness', value: 1, enabled: false }]
    expect(() => validateCompositionContentV5(bad)).toThrow(/不支持/)
  })

  it('enumerates layer-inapplicable kinds and fixed member targets, deduplicating explicit group plus child', () => {
    const content = prefabFixtureV5(), plan = inspectAppearanceScopeV5(content, { kind: 'targets', ids: ['group', 'left'] })
    expect(plan.targetIds.sort()).toEqual(['left', 'right'])
    expect(plan.affectedIds.sort()).toEqual(['group', 'left', 'right'])
    const layer = inspectAppearanceScopeV5(content, { kind: 'layer', layerId: content.document.entityLayers.item }, ['brightness'])
    expect(layer.targetIds).toEqual([])
    expect(layer.inapplicableIds.sort()).toEqual(['group', 'item', 'left', 'right'])
    for (const member of Object.values(content.document.prefabInstances.group.members)) member.propId = null
    expect(() => inspectAppearanceScopeV5(content, { kind: 'targets', ids: ['group'] })).toThrow(/活成员/)
  })

  it('normalizes deterministic variants and refuses missing outputs, changed metadata and stale effective fields', () => {
    const content = imageFixtureV5(), sourceAsset = content.document.props.item.appearance
    if (sourceAsset.kind !== 'image') throw new Error('image fixture expected')
    expect(bitmapVariantV5(sourceAsset.assetId, '#aAbBcC', .8)).toEqual(bitmapVariantV5(sourceAsset.assetId, '#AABBCC', .8))
    expect(bitmapVariantV5(sourceAsset.assetId, null, 1)).toBeNull()
    const draft = applyCompositionCommandsV5(content, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'color', kind: 'tint', value: '#AA8844', enabled: true } }])
    expect(listRequiredVariantsV5(draft)).toHaveLength(1)
    expect(() => resolveAppearanceV5(draft)).toThrow(/尚未完整采用/)
    const adopted = resolveMetadataOnlyV5(draft), variant = Object.values(adopted.appearance.variants)[0]
    expect(adopted.document.props.item.appearance).toMatchObject({ assetId: variant.outputAssetId, tint: null })
    const changed = structuredClone(adopted); changed.document.assets[variant.outputAssetId].pixelWidth += 1
    expect(() => validateCompositionDraftV5(changed)).toThrow(/尺寸/)
    const stale = structuredClone(adopted); stale.document.props.item.appearance.opacity = .4
    expect(() => validateCompositionContentV5(stale)).toThrow(/不一致/)
  })

  it('retains actual variant assets through repeated parameter changes, disable, removal and last-instance deletion', () => {
    const content = imageFixtureV5(), scope = { kind: 'targets' as const, ids: ['item'] }
    let current = resolveMetadataOnlyV5(applyCompositionCommandsV5(content, [{ type: 'setAppearanceAdjustment', scope, adjustment: { id: 'brightness1', kind: 'brightness', value: .6, enabled: true } }]))
    const first = Object.values(current.appearance.variants)[0], retained = Object.values(current.document.propDefinitions).find(definition => definition.defaultAppearance.kind === 'image' && definition.defaultAppearance.assetId === first.outputAssetId)!
    expect(retained.tags).toContain('sceneweave:retained-appearance')
    expect(retained.licenseRef).toBe(current.document.assets[first.outputAssetId].licenseRef)
    expect(retained.defaultFootprintMm).toEqual(content.document.propDefinitions['b2-p-03'].defaultFootprintMm)
    current = resolveMetadataOnlyV5(applyCompositionCommandsV5(current, [{ type: 'setAppearanceAdjustment', scope, adjustment: { id: 'brightness2', kind: 'brightness', value: .8, enabled: true } }]))
    expect(Object.keys(current.appearance.variants)).toHaveLength(2)
    current = resolveMetadataOnlyV5(applyCompositionCommandsV5(current, [{ type: 'toggleAppearanceAdjustment', scope, adjustmentId: 'brightness2', enabled: false }]))
    expect(current.document.props.item.appearance).toEqual(content.document.props.item.appearance)
    current = resolveMetadataOnlyV5(applyCompositionCommandsV5(current, [{ type: 'removeAppearanceAdjustment', scope, adjustmentId: 'brightness1' }, { type: 'removeAppearanceAdjustment', scope, adjustmentId: 'brightness2' }]))
    current = resolveMetadataOnlyV5(applyCompositionCommandsV5(current, [{ type: 'deleteProp', id: 'item' }]))
    expect(current.document.assets[first.outputAssetId]).toBeDefined()
    expect(current.document.propDefinitions[retained.id]).toEqual(retained)
    expect(Object.keys(current.appearance.variants)).toHaveLength(2)
    expect(validateCompositionContentV5(current)).toEqual(current)
  })

  it('retains a source bitmap that differs from its fixed definition default before replacement or deletion', () => {
    const original = imageFixtureV5(), document = structuredClone(original.document), appearance = document.props.item.appearance
    if (appearance.kind !== 'image') throw new Error('image fixture expected')
    const differentId = 'adopted-instance-image'
    document.assets[differentId] = { ...structuredClone(document.assets[appearance.assetId]), id: differentId }
    appearance.assetId = differentId
    const graph = createAppearanceGraphV5(document), content = resolveAppearanceV5({ ...original, document, appearance: graph })
    expect(Object.values(content.document.propDefinitions).some(definition => definition.defaultAppearance.kind === 'image' && definition.defaultAppearance.assetId === differentId)).toBe(true)
    const deleted = resolveMetadataOnlyV5(applyCompositionCommandsV5(content, [{ type: 'deleteProp', id: 'item' }]))
    expect(deleted.document.assets[differentId]).toBeDefined()
    expect(Object.values(deleted.appearance.sources).some(source => source.kind === 'prop' && source.snapshot.appearance.kind === 'image' && source.snapshot.appearance.assetId === differentId)).toBe(true)
  })

  it('rebuilds a historical ancestor asset root before draft validation without materializing pending layer parameters', () => {
    const initial = imageFixtureV5(), scope = { kind: 'targets' as const, ids: ['item'] }
    let historic = resolveMetadataOnlyV5(applyCompositionCommandsV5(initial, [{ type: 'setAppearanceAdjustment', scope, adjustment: { id: 'b', kind: 'brightness', value: .6, enabled: true } }]))
    const parentAsset = historic.document.props.item.appearance
    if (parentAsset.kind !== 'image') throw new Error('image expected')
    historic = resolveMetadataOnlyV5(freezeEffectivePropAppearanceV5(historic, 'item', historic.document.props.item))
    historic = resolveMetadataOnlyV5(applyCompositionCommandsV5(historic, [{ type: 'setAppearanceAdjustment', scope, adjustment: { id: 'c', kind: 'brightness', value: .7, enabled: true } }]))
    historic = resolveMetadataOnlyV5(freezeEffectivePropAppearanceV5(historic, 'item', historic.document.props.item))
    // Historical closure merged source nodes/assets, but its prior carrier definition was outside the selected roots.
    const draft = structuredClone(historic)
    for (const definition of Object.values(draft.document.propDefinitions)) if (definition.defaultAppearance.kind === 'image' && definition.defaultAppearance.assetId === parentAsset.assetId) delete draft.document.propDefinitions[definition.id]
    draft.appearance.instanceAdjustments.item = [{ id: 'pending-color', kind: 'tint', value: '#778899', enabled: true }]
    expect(() => validateCompositionDraftV5(draft)).toThrow(/未被已采用/)
    const before = structuredClone(draft), rooted = ensureSourceAssetRootsV5(draft)
    expect(validateCompositionDraftV5(rooted)).toBeDefined()
    expect(() => resolveAppearanceV5(rooted)).toThrow(/尚未完整采用/)
    expect(rooted.appearance).toEqual(draft.appearance)
    expect(rooted.document.props).toEqual(draft.document.props)
    expect(draft).toEqual(before)
  })

  it('creates immutable derived materials while retaining every paint geometry and overlay field', () => {
    const content = surfaceFixtureV5(), before = structuredClone(content.document.terrainAreas.domain.surfaceStyle!)
    const draft = applyCompositionCommandsV5(content, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['domain'] }, adjustment: { id: 'brightness', kind: 'brightness', value: .6, enabled: true } }])
    const adopted = resolveMetadataOnlyV5(draft), after = adopted.document.terrainAreas.domain.surfaceStyle!
    expect(after.base.materialRef.id).not.toBe(before.base.materialRef.id)
    expect(after.base.tileSizeMm).toEqual(before.base.tileSizeMm)
    expect(after.base.originMm).toEqual(before.base.originMm)
    expect(after.overlays[0]).toMatchObject({ id: before.overlays[0].id, boundaryMm: before.overlays[0].boundaryMm, blendWidthMm: before.overlays[0].blendWidthMm, renderOrder: before.overlays[0].renderOrder })
    expect(adopted.document.materials.material).toEqual(content.document.materials.material)
    expect(after.overlays[0].paint.opacity).toBe(.4)
    expect(() => applyCompositionCommandsV5(content, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['domain'] }, adjustment: { id: 'opacity', kind: 'opacity', value: .5, enabled: true } }])).toThrow(/完全不透明/)
    const unchanged = structuredClone(content)
    expect(() => applyCompositionCommandsV5(content, [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId: content.document.entityLayers.domain }, adjustment: { id: 'layer-opacity', kind: 'opacity', value: .5, enabled: true } }])).toThrow(/完全不透明/)
    expect(content).toEqual(unchanged)
  })

  it('freezes selected historical appearance without modifying current layer rules or other members', () => {
    const original = imageFixtureV5(), current = structuredClone(original), layerId = current.document.entityLayers.item
    current.appearance.layerAdjustments[layerId] = [{ id: 'layer-opacity', kind: 'opacity', value: .2, enabled: true }]
    const effective = resolveAppearanceV5(current), frozen = resolveAppearanceV5(freezeEffectivePropAppearanceV5(effective, 'item', original.document.props.item))
    expect(frozen.document.props.item.appearance).toEqual(original.document.props.item.appearance)
    expect(frozen.document.props.other).toEqual(effective.document.props.other)
    expect(frozen.appearance.layerAdjustments).toEqual(effective.appearance.layerAdjustments)
    expect(frozen.appearance.sources[frozen.appearance.propSources.item].parentSourceId).toBe(original.appearance.propSources.item)
  })

  it('preserves current surface geometry and explicitly refuses unrepresentable opacity isolation', () => {
    const content = surfaceFixtureV5(), historical = structuredClone(content.document.terrainAreas.domain.surfaceStyle!)
    content.document.terrainAreas.domain.surfaceStyle!.base.rotationDeg = 42
    content.appearance.surfaceSources.domain = addSurfaceAppearanceSourceV5(content.appearance, content.document.terrainAreas.domain.surfaceStyle!)
    const frozen = resolveAppearanceV5(freezeEffectiveSurfaceAppearanceV5(content, 'domain', historical))
    expect(frozen.document.terrainAreas.domain.surfaceStyle!.base.rotationDeg).toBe(42)
    content.appearance.layerAdjustments[content.document.entityLayers.domain] = [{ id: 'layer-opacity', kind: 'opacity', value: 1, enabled: true }]
    expect(() => freezeEffectiveSurfaceAppearanceV5(content, 'domain', historical)).toThrow(/不能精确恢复/)
  })

  it('rejects changed fixed definition versions and does not silently switch old instances to a new catalogue record', () => {
    const content = imageFixtureV5(), altered = structuredClone(content)
    altered.document.propDefinitions['b2-p-03'].version = 2
    expect(() => validateCompositionContentV5(altered)).toThrow(/版本/)
    const extra = structuredClone(content), definition = extra.document.propDefinitions['b2-p-03']
    extra.document.propDefinitions.newDefinition = { ...structuredClone(definition), id: 'newDefinition', version: 2 }
    const synced = validateCompositionContentV5(syncAppearanceGraphV5(extra))
    expect(synced.document.props.item.definitionRef).toEqual({ id: 'b2-p-03', version: 1 })
    expect(synced.appearance.propSources.item).toBe(content.appearance.propSources.item)
  })
})
