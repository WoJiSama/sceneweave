import { describe, expect, it } from 'vitest'
import { groupLayerSceneV3, layerSceneV3, scatterLayerSceneV3, symbolPropV3 } from '../v3/test-fixtures'
import type { SceneDocumentV3 } from '../v3/types'
import { StructureContinuitySessionV4 } from '../v4/structure-continuity'
import { addSurfaceAppearanceSourceV5, bitmapVariantV5, createAppearanceGraphV5, createCompositionContentV5, resolveAppearanceV5, syncAppearanceGraphV5 } from './graph'
import { advanceHistoryIdentityV5 } from './identity'
import { buildRestorePlanV5 } from './restore'
import type { CompositionContentV5 } from './types'

function scene(): SceneDocumentV3 {
  const value = layerSceneV3()
  value.assets = {}; value.propDefinitions = {}
  value.props.later = symbolPropV3('later', 7000, 7000)
  value.entityLayers.later = value.entityLayers.item
  return value
}
function group(): CompositionContentV5 {
  const value = groupLayerSceneV3()
  value.assets = {}; value.propDefinitions = {}; value.prefabInstances.group.visibility = 'public'
  return createCompositionContentV5(value)
}
function removed(content: CompositionContentV5, id: string): CompositionContentV5 {
  const next = structuredClone(content)
  delete next.document.props[id]; delete next.document.entityLayers[id]
  for (const group of Object.values(next.document.prefabInstances)) for (const member of Object.values(group.members)) if (member.propId === id) member.propId = null
  next.historyIdentity = advanceHistoryIdentityV5(content.historyIdentity, content.document, next.document)
  return syncAppearanceGraphV5(next)
}
function surface(): CompositionContentV5 {
  const document = layerSceneV3(), asset = Object.values(document.assets)[0], layerId = document.entityLayers.item
  const points = [{ xMm: 2000, yMm: 2000 }, { xMm: 12000, yMm: 2000 }, { xMm: 12000, yMm: 12000 }, { xMm: 2000, yMm: 12000 }]
  points.forEach((point, index) => {
    const id = `vertex-${index}`, wallId = `wall-${index}`
    document.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, ...point }
    document.walls[wallId] = { id: wallId, floorId: 'blank-floor', editLocked: false, startVertexId: id, endVertexId: `vertex-${(index + 1) % 4}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    document.entityLayers[id] = layerId; document.entityLayers[wallId] = layerId
  })
  document.materials.surfaceMaterial = { id: 'surfaceMaterial', catalogId: 'test.surface-material', version: 1, licenseRef: asset.licenseRef, origin: asset.origin,
    name: 'Test surface', tags: [], textureAssetId: asset.id, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room', 'terrain'] }
  const paint = { materialRef: { id: 'surfaceMaterial', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0,
    alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
  document.rooms.room = { id: 'room', floorId: 'blank-floor', editLocked: false, boundaryVertexIds: points.map((_, index) => `vertex-${index}`), purpose: '', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'blank-floor' }, groundElevationMm: 0,
    floorStyle: { base: paint, overlays: [{ id: 'overlay', paint: { ...paint }, boundaryMm: [{ x: 3000, y: 3000 }, { x: 4000, y: 3000 }, { x: 4000, y: 4000 }, { x: 3000, y: 4000 }], blendWidthMm: 0, renderOrder: 0 }] } }
  document.entityLayers.room = layerId
  return createCompositionContentV5(document)
}
function surfaceEvidence(current: CompositionContentV5, historic: CompositionContentV5) {
  const session = new StructureContinuitySessionV4()
  session.reset(historic.document); session.recordSnapshot('source', 'hash', historic.document)
  session.advance(historic.document, current.document)
  return { surfaceContinuity: session.prove('source', 'hash', current.document, historic.document) }
}

describe('C3 explicit composition restore plans', () => {
  it('freezes only the chosen historic effective appearance against a later layer and instance rule', () => {
    const document = scene(); document.props.item.appearance.opacity = .8
    const historic = createCompositionContentV5(document), layerId = document.entityLayers.item
    const draft = structuredClone(historic)
    draft.appearance.layerAdjustments[layerId] = [{ id: 'layer-opacity', kind: 'opacity', value: .2, enabled: true }]
    draft.appearance.instanceAdjustments.item = [{ id: 'item-opacity', kind: 'opacity', value: .4, enabled: true }]
    draft.appearance.instanceAdjustments.later = [{ id: 'later-opacity', kind: 'opacity', value: .6, enabled: true }]
    draft.document.props.item.rotationDeg = 35
    draft.document.props.later.positionMm.x = 8500
    const current = resolveAppearanceV5(draft), before = structuredClone(current)
    const plan = buildRestorePlanV5(current, historic, { ids: ['item'], mode: 'appearance' }), result = resolveAppearanceV5(plan)
    expect(result.document.props.item.appearance).toEqual(historic.document.props.item.appearance)
    expect(result.document.props.item.rotationDeg).toBe(35)
    expect(result.document.props.item.footprintMm).toEqual(current.document.props.item.footprintMm)
    expect(result.document.props.later).toEqual(current.document.props.later)
    expect(result.appearance.layerAdjustments).toEqual(current.appearance.layerAdjustments)
    expect(result.appearance.instanceAdjustments.later).toEqual(current.appearance.instanceAdjustments.later)
    expect(plan.affectedIds).toEqual(['item'])
    expect(current).toEqual(before)
  })

  it('offers historic source/parameters under the current layer as a distinct explicit mode', () => {
    const historic = createCompositionContentV5(scene()), draft = structuredClone(historic), layerId = draft.document.entityLayers.item
    draft.appearance.layerAdjustments[layerId] = [{ id: 'layer', kind: 'opacity', value: .25, enabled: true }]
    draft.appearance.instanceAdjustments.item = [{ id: 'instance', kind: 'opacity', value: .7, enabled: true }]
    const current = resolveAppearanceV5(draft), result = resolveAppearanceV5(buildRestorePlanV5(current, historic, { ids: ['item'], mode: 'source' }))
    expect(result.appearance.propSources.item).toBe(historic.appearance.propSources.item)
    expect(result.appearance.instanceAdjustments.item).toBeUndefined()
    expect(result.document.props.item.appearance.opacity).toBe(.25)
    expect(result.appearance.layerAdjustments).toEqual(current.appearance.layerAdjustments)
  })

  it('restores a chosen member while preserving the other member and explicitly recording the parent override', () => {
    const historic = group(), current = structuredClone(historic)
    current.document.props.left.rotationDeg = 45
    current.document.props.right.positionMm.y += 800
    const plan = buildRestorePlanV5(current, historic, { ids: ['left'], mode: 'transform' })
    expect(plan.document.props.left.rotationDeg).toBe(0)
    expect(plan.document.props.right).toEqual(current.document.props.right)
    expect(plan.document.prefabInstances.group.members.left.overrideFields).toContain('rotationDeg')
    expect(plan.affectedIds).toEqual(['group', 'left'])
    expect(plan.changes.some(change => change.id === 'group')).toBe(true)
    expect(plan.historyIdentity.prefabTokens).toEqual(current.historyIdentity.prefabTokens)
  })

  it('does not revive deleted group slots in ordinary appearance/transform restore', () => {
    const historic = group(), current = removed(historic, 'right')
    current.document.props.left.rotationDeg = 45
    const plan = buildRestorePlanV5(current, historic, { ids: ['group'], mode: 'transform' })
    expect(plan.document.props.right).toBeUndefined()
    expect(plan.document.prefabInstances.group.members.right.propId).toBeNull()
    expect(plan.document.prefabInstances.group.members.removed).toEqual(current.document.prefabInstances.group.members.removed)
    expect(plan.document.props.left.rotationDeg).toBe(0)
    expect(() => buildRestorePlanV5(current, historic, { ids: ['group', 'left'], mode: 'transform' })).toThrow(/重复/)
  })

  it('restores complete relations with original tokens, deleted records and an explicit expanded budget', () => {
    const historic = group(), current = removed(historic, 'right')
    current.document.props.left.rotationDeg = 45
    current.document.prefabInstances.group.members.removed.overrideFields = []
    const plan = buildRestorePlanV5(current, historic, { ids: ['group'], mode: 'relationship' })
    expect(plan.document.prefabInstances.group.members).toEqual(historic.document.prefabInstances.group.members)
    expect(plan.document.props.right).toEqual(historic.document.props.right)
    expect(plan.historyIdentity.propTokens.right).toBe(historic.historyIdentity.propTokens.right)
    expect(plan.historyIdentity.prefabTokens.group).toBe(historic.historyIdentity.prefabTokens.group)
    expect(plan.changes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'right', action: 'recreate' })]))
    expect(plan.commandCost).toBe(6) // root, two live members, and all three persisted membership slots
    expect(plan.document.props.item).toEqual(current.document.props.item)
  })

  it('explicit relationship restore can delete a later member while preserving unrelated edits and tombstones', () => {
    const original = group(), historic = removed(original, 'right'), current = structuredClone(original)
    current.document.props.item.rotationDeg = 31
    const plan = buildRestorePlanV5(current, historic, { ids: ['group'], mode: 'relationship' })
    expect(plan.document.props.right).toBeUndefined()
    expect(plan.document.prefabInstances.group.members.right.propId).toBeNull()
    expect(plan.appearance.propSources.right).toBeUndefined()
    expect(plan.historyIdentity.propTokens.right).toBe(original.historyIdentity.propTokens.right)
    expect(plan.document.props.item.rotationDeg).toBe(31)
    expect(plan.changes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'right', action: 'delete' })]))
  })

  it('can recover an explicitly selected deleted group and members without regenerating its excluded slot', () => {
    const historic = group(), current = removed(removed(historic, 'left'), 'right')
    delete current.document.prefabInstances.group; delete current.document.entityLayers.group
    const plan = buildRestorePlanV5(current, historic, { ids: ['group'], mode: 'relationship' })
    expect(plan.document.prefabInstances.group).toEqual(historic.document.prefabInstances.group)
    expect(plan.document.prefabInstances.group.members.removed.propId).toBeNull()
    expect(plan.changes.filter(change => change.action === 'recreate')).toHaveLength(3)
  })

  it('enumerates current layer members instead of replaying the historic member list and rejects their current locks', () => {
    const historic = createCompositionContentV5(scene()), layerId = historic.document.entityLayers.item
    historic.appearance.layerAdjustments[layerId] = [{ id: 'layer', kind: 'opacity', value: .7, enabled: true }]
    const historical = resolveAppearanceV5(historic), current = structuredClone(historical)
    current.appearance.layerAdjustments[layerId][0] = { id: 'layer', kind: 'opacity', value: .2, enabled: true }
    current.document.props.fresh = symbolPropV3('fresh', 10000, 10000); current.document.entityLayers.fresh = layerId
    current.historyIdentity = advanceHistoryIdentityV5(current.historyIdentity, historical.document, current.document)
    const prepared = resolveAppearanceV5(syncAppearanceGraphV5(current))
    const plan = buildRestorePlanV5(prepared, historical, { ids: [layerId], mode: 'layer' }), result = resolveAppearanceV5(plan)
    expect(plan.affectedIds).toContain('fresh')
    expect(result.document.props.fresh.appearance.opacity).toBe(.7)
    prepared.document.props.fresh.editLocked = true
    expect(() => buildRestorePlanV5(prepared, historical, { ids: [layerId], mode: 'layer' })).toThrow(/锁定/)
  })

  it('rejects parent locks, member identity swaps, foreign lineage and conflicting prefab tokens', () => {
    const historic = group(), current = structuredClone(historic)
    current.document.prefabInstances.group.editLocked = true
    expect(() => buildRestorePlanV5(current, historic, { ids: ['left'], mode: 'appearance' })).toThrow(/锁定/)
    current.document.prefabInstances.group.editLocked = false
    const changedToken = structuredClone(historic)
    changedToken.historyIdentity.prefabTokens.group = 'other-token'
    expect(() => buildRestorePlanV5(current, changedToken, { ids: ['group'], mode: 'relationship' })).toThrow(/token/)
    changedToken.historyIdentity = { ...historic.historyIdentity, lineageId: 'foreign' }
    expect(() => buildRestorePlanV5(current, changedToken, { ids: ['group'], mode: 'relationship' })).toThrow(/lineage/)
    const left = current.document.prefabInstances.group.members.left.propId
    current.document.prefabInstances.group.members.left.propId = 'right'; current.document.prefabInstances.group.members.right.propId = left
    expect(() => buildRestorePlanV5(current, historic, { ids: ['group'], mode: 'transform' })).toThrow(/映射/)
  })

  it('rejects scatter and anchored dependencies and keeps current privacy/physical fields for appearance', () => {
    const scatter = scatterLayerSceneV3(1); scatter.scatterGroups.scatter.visibility = 'public'
    const content = createCompositionContentV5(scatter)
    expect(() => buildRestorePlanV5(content, content, { ids: ['scatter-item-0'], mode: 'appearance' })).toThrow(/散布/)
    const historic = createCompositionContentV5(scene()), current = structuredClone(historic)
    current.document.notes.anchor = { id: 'anchor', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'anchor', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    current.document.entityLayers.anchor = current.document.entityLayers.item
    expect(() => buildRestorePlanV5(current, historic, { ids: ['item'], mode: 'appearance' })).toThrow(/注记依赖/)
  })

  it('does not write a transaction for equal independent content, and validates unknown/accessor requests', () => {
    const historic = createCompositionContentV5(scene())
    const plan = buildRestorePlanV5(historic, historic, { ids: ['item'], mode: 'appearance' })
    expect(plan.changed).toBe(false); expect(plan.changes).toEqual([])
    expect(() => buildRestorePlanV5(historic, historic, { ids: ['item', 'item'], mode: 'appearance' })).toThrow(/重复/)
    expect(() => buildRestorePlanV5(historic, historic, { ids: ['item'], mode: 'appearance', force: true } as never)).toThrow(/无效/)
    let reads = 0
    const request = { mode: 'appearance' }
    Object.defineProperty(request, 'ids', { enumerable: true, get: () => { reads++; return ['item'] } })
    expect(() => buildRestorePlanV5(historic, historic, request as never)).toThrow(/访问器/)
    expect(reads).toBe(0)
  })

  it('restores supported surface appearance without changing current paint geometry, overlays or current layer rules', () => {
    const historic = surface(), currentDraft = structuredClone(historic), layerId = historic.document.entityLayers.room
    const style = currentDraft.document.rooms.room.floorStyle!
    style.base.rotationDeg = 35; style.base.originMm = { x: 500, y: 600 }
    style.overlays[0].boundaryMm = style.overlays[0].boundaryMm.map(point => ({ x: point.x + 500, y: point.y }))
    currentDraft.appearance.surfaceSources.room = addSurfaceAppearanceSourceV5(currentDraft.appearance, style, currentDraft.appearance.surfaceSources.room)
    currentDraft.appearance.layerAdjustments[layerId] = [{ id: 'today-opacity', kind: 'opacity', value: 1, enabled: true }]
    const current = resolveAppearanceV5(currentDraft), plan = buildRestorePlanV5(current, historic, { ids: ['room'], mode: 'appearance' }, surfaceEvidence(current, historic)), result = resolveAppearanceV5(plan)
    const restored = result.document.rooms.room.floorStyle!
    expect(restored.base.opacity).toBe(1)
    expect(restored.base.rotationDeg).toBe(35); expect(restored.base.originMm).toEqual({ x: 500, y: 600 })
    expect(restored.overlays[0].boundaryMm).toEqual(current.document.rooms.room.floorStyle!.overlays[0].boundaryMm)
    expect(result.document.rooms.room.groundElevationMm).toBe(current.document.rooms.room.groundElevationMm)
    expect(result.appearance.layerAdjustments).toEqual(current.appearance.layerAdjustments)
    expect(result.document.props).toEqual(current.document.props)
    expect(plan.changes[0].kind).toBe('surface')
  })

  it('refuses inexpressible per-paint historic opacity under a current layer override and offers source mode', () => {
    const initial = surface(), historicDraft = structuredClone(initial), style = historicDraft.document.rooms.room.floorStyle!
    style.overlays[0].paint.opacity = .3
    historicDraft.appearance.surfaceSources.room = addSurfaceAppearanceSourceV5(historicDraft.appearance, style)
    const historic = resolveAppearanceV5(historicDraft), currentDraft = structuredClone(historic), layerId = historic.document.entityLayers.room
    currentDraft.appearance.layerAdjustments[layerId] = [{ id: 'today-opacity', kind: 'opacity', value: 1, enabled: true }]
    const current = resolveAppearanceV5(currentDraft)
    expect(() => buildRestorePlanV5(current, historic, { ids: ['room'], mode: 'appearance' }, surfaceEvidence(current, historic))).toThrow(/不能精确恢复/)
    const source = resolveAppearanceV5(buildRestorePlanV5(current, historic, { ids: ['room'], mode: 'source' }, surfaceEvidence(current, historic)))
    expect(source.document.rooms.room.floorStyle!.base.opacity).toBe(1)
    expect(source.document.rooms.room.floorStyle!.overlays[0].paint.opacity).toBe(1)
  })

  it('requires opaque session identity for room/wall appearance and leaves terrain restoration to C4', () => {
    const historic = surface(), current = structuredClone(historic)
    expect(() => buildRestorePlanV5(current, historic, { ids: ['room'], mode: 'appearance' })).toThrow(/本会话/)
    expect(() => buildRestorePlanV5(current, historic, { ids: ['room'], mode: 'source' }, { surfaceContinuity: { snapshotId: 'forged' } })).toThrow(/可验证/)
    const session = new StructureContinuitySessionV4()
    session.reset(historic.document); session.recordSnapshot('old', 'hash', historic.document)
    session.advance(historic.document, current.document, ['room'])
    const proof = session.prove('old', 'hash', current.document, historic.document)
    expect(() => buildRestorePlanV5(current, historic, { ids: ['room'], mode: 'appearance' }, { surfaceContinuity: proof })).toThrow(/删除|重建/)
    const terrain = scatterLayerSceneV3(0)
    terrain.materials = structuredClone(historic.document.materials)
    terrain.terrainAreas.domain.surfaceStyle = structuredClone(historic.document.rooms.room.floorStyle)
    const terrainContent = createCompositionContentV5(terrain)
    expect(() => buildRestorePlanV5(terrainContent, terrainContent, { ids: ['domain'], mode: 'appearance' })).toThrow(/C4/)
  })

  it('counts every explicit complete membership record and rejects a 128-member relationship over 256', () => {
    const document = scene(), first = document.props.item
    document.prefabDefinitions.definition = { id: 'definition', catalogId: 'budget-group', version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave tests', canEmbed: true }, name: 'Budget group', tags: [], members: [] }
    const group = document.prefabInstances.group = { id: 'group', floorId: 'blank-floor', editLocked: false, visibility: 'public' as const, definitionRef: { id: 'definition', version: 1 }, anchorMm: { x: 4000, y: 4000 }, rotationDeg: 0, members: {} as Record<string, { propId: string; overrideFields: [] }> }
    document.entityLayers.group = document.entityLayers.item
    const { id: _id, floorId: _floor, editLocked: _lock, visibility: _vis, supportRef: _support, ...template } = first
    for (let index = 0; index < 128; index++) {
      const id = `member-${index}`
      document.props[id] = symbolPropV3(id, 4000 + index % 16 * 400, 4000 + Math.floor(index / 16) * 400)
      document.entityLayers[id] = document.entityLayers.item
      group.members[id] = { propId: id, overrideFields: [] }
      document.prefabDefinitions.definition.members.push({ key: id, propTemplate: template })
    }
    const content = createCompositionContentV5(document)
    expect(() => buildRestorePlanV5(content, content, { ids: ['group'], mode: 'relationship' })).toThrow(/256/)
  }, 15_000)

  it('merges the selected fixed source, derived bitmap ancestry and license subjects without unrelated catalog resources', () => {
    const document = scene(), origin = { kind: 'original' as const, attribution: 'Sceneweave test', canEmbed: true }
    const asset = document.assets.image = { id: 'image', sha256: 'a'.repeat(64), mimeType: 'image/png' as const, pixelWidth: 8, pixelHeight: 8, logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'MIT', origin }
    const definition = document.propDefinitions.imageDefinition = { id: 'imageDefinition', catalogId: 'test.image', version: 1, licenseRef: 'MIT', origin, name: 'Image', tags: [],
      defaultAppearance: { kind: 'image' as const, assetId: 'image', tint: null, opacity: 1 }, defaultVisualBoundsMm: document.props.item.visualBoundsMm,
      defaultFootprintMm: document.props.item.footprintMm, defaultFootprintOffsetMm: document.props.item.footprintOffsetMm,
      defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object' as const, defaultShadowClass: 'none' as const }
    document.props.item.definitionRef = { id: definition.id, version: 1 }; document.props.item.appearance = structuredClone(definition.defaultAppearance)
    const draft = createCompositionContentV5(document), variant = bitmapVariantV5('image', '#AABBCC', 1)!
    draft.document.assets[variant.outputAssetId] = { ...asset, id: variant.outputAssetId, sha256: 'b'.repeat(64) }
    draft.document.assets.unrelated = { ...asset, id: 'unrelated', sha256: 'c'.repeat(64) }
    draft.document.propDefinitions.unrelatedDefinition = { ...definition, id: 'unrelatedDefinition', catalogId: 'test.unrelated', defaultAppearance: { kind: 'image', assetId: 'unrelated', tint: null, opacity: 1 } }
    draft.appearance.variants[variant.id] = variant
    draft.appearance.instanceAdjustments.item = [{ id: 'tint', kind: 'tint', value: '#AABBCC', enabled: true }]
    const historic = resolveAppearanceV5(draft), current = structuredClone(historic)
    current.document.assets = {}; current.document.propDefinitions = {}; current.document.props.item = symbolPropV3('item')
    current.appearance = createAppearanceGraphV5(current.document)
    const plan = buildRestorePlanV5(current, historic, { ids: ['item'], mode: 'appearance' }), restored = resolveAppearanceV5(plan)
    expect(Object.keys(plan.document.assets).sort()).toEqual(['image', variant.outputAssetId].sort())
    expect(plan.appearance.variants[variant.id]).toEqual(variant)
    expect(plan.adoptedSubjects).toEqual(expect.arrayContaining([
      { subjectKind: 'asset', subjectId: 'image' }, { subjectKind: 'asset', subjectId: variant.outputAssetId },
      { subjectKind: 'propDefinition', subjectId: 'imageDefinition' },
    ]))
    for (const definition of Object.values(plan.document.propDefinitions)) expect(plan.adoptedSubjects).toContainEqual({ subjectKind: 'propDefinition', subjectId: definition.id })
    expect(restored.document.props.item.appearance).toEqual(historic.document.props.item.appearance)
    const conflicting = structuredClone(historic); conflicting.document.assets.image.sha256 = 'd'.repeat(64)
    expect(() => buildRestorePlanV5(conflicting, historic, { ids: ['item'], mode: 'appearance' })).toThrow(/固定内容冲突/)
  })

  it('keeps current secrecy and physical fields and rejects a historic visual envelope escaping the current fixed mask', () => {
    const historic = createCompositionContentV5(scene()), draft = structuredClone(historic)
    draft.document.props.item.visibility = 'gm'; draft.document.props.item.blocksMovement = true
    draft.document.regions.mask = { id: 'mask', floorId: 'blank-floor', editLocked: false, kind: 'manualMask', visibility: 'public',
      boundaryMm: [{ x: 3500, y: 3500 }, { x: 4500, y: 3500 }, { x: 4500, y: 4500 }, { x: 3500, y: 4500 }], blocksMovement: false, movementCostMultiplier: 1 }
    draft.document.entityLayers.mask = draft.document.entityLayers.item
    draft.appearance.instanceAdjustments.item = [{ id: 'opacity', kind: 'opacity', value: .4, enabled: true }]
    const current = resolveAppearanceV5(draft), result = resolveAppearanceV5(buildRestorePlanV5(current, historic, { ids: ['item'], mode: 'appearance' }))
    expect(result.document.props.item).toMatchObject({ visibility: 'gm', blocksMovement: true, footprintMm: current.document.props.item.footprintMm })
    const larger = structuredClone(historic)
    larger.document.props.item.visualBoundsMm = { x: -1000, y: -1000, width: 2000, height: 2000 }
    larger.appearance = createAppearanceGraphV5(larger.document)
    expect(() => buildRestorePlanV5(current, larger, { ids: ['item'], mode: 'appearance' })).toThrow(/遮罩未覆盖/)
  })
})
