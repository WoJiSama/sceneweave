import { describe, expect, it } from 'vitest'
import { layerSceneV3, groupLayerSceneV3, scatterLayerSceneV3, symbolPropV3 } from '../v3/test-fixtures'
import type { PropDefinition, SceneDocumentV3 } from '../v3/types'
import { createHistoryIdentityV4 } from './identity'
import { buildRestorePlanV4 } from './restore'
import type { HistoryIdentityV4, RestoreModeV4 } from './types'

const request = (ids: string[], mode: RestoreModeV4) => ({ ids, mode })
function pair() {
  const historic = layerSceneV3(), current = structuredClone(historic), identity = createHistoryIdentityV4(historic)
  return { current, historic, currentIdentity: structuredClone(identity), historicIdentity: identity }
}
function sameLineageIdentity(scene: SceneDocumentV3): HistoryIdentityV4 {
  return { version: 1, lineageId: 'restore-lineage', rootSceneId: 'restore-root',
    propTokens: Object.fromEntries(Object.keys(scene.props).map(id => [id, `token:${id}`])) }
}
function addSecondLayer(scene: SceneDocumentV3): void {
  scene.userLayers.archive = { id: 'archive', floorId: 'blank-floor', name: 'Archive', order: 1, editLocked: false }
}
function addRoomSupport(scene: SceneDocumentV3, layerId = 'support-layer'): void {
  scene.userLayers[layerId] = { id: layerId, floorId: 'blank-floor', name: 'Support', order: 1, editLocked: false }
  const points = [{ x: 3000, y: 3000 }, { x: 9000, y: 3000 }, { x: 9000, y: 9000 }, { x: 3000, y: 9000 }]
  points.forEach((point, i) => {
    const id = `support-v${i}`, wallId = `support-w${i}`
    scene.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, xMm: point.x, yMm: point.y }
    scene.walls[wallId] = { id: wallId, floorId: 'blank-floor', editLocked: false, startVertexId: id,
      endVertexId: `support-v${(i + 1) % points.length}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.entityLayers[id] = layerId; scene.entityLayers[wallId] = layerId
  })
  scene.rooms.support = { id: 'support', floorId: 'blank-floor', editLocked: false, boundaryVertexIds: points.map((_, i) => `support-v${i}`),
    purpose: 'Support', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'blank-floor' }, groundElevationMm: 0, floorStyle: null }
  scene.entityLayers.support = layerId
  scene.props.item.supportRef = { kind: 'room', id: 'support' }; scene.props.item.roomId = 'support'
}
function addMask(scene: SceneDocumentV3, id: string, min: number, max: number): void {
  scene.regions[id] = { id, floorId: 'blank-floor', editLocked: false, kind: 'manualMask', visibility: 'public',
    boundaryMm: [{ x: min, y: min }, { x: max, y: min }, { x: max, y: max }, { x: min, y: max }], blocksMovement: false, movementCostMultiplier: 1 }
  scene.entityLayers[id] = Object.keys(scene.userLayers)[0]
}
function addImageDefinition(scene: SceneDocumentV3, assetHash = 'a'.repeat(64), version = 1): void {
  const assetId = 'image-asset', definitionId = 'image-definition', origin = { kind: 'original' as const, attribution: 'Sceneweave test', canEmbed: true }
  scene.assets[assetId] = { id: assetId, sha256: assetHash, mimeType: 'image/png', pixelWidth: 8, pixelHeight: 8,
    logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'MIT', origin }
  const definition: PropDefinition = { id: definitionId, catalogId: 'test.restore-image', version, licenseRef: 'MIT', origin,
    name: 'Restorable image', tags: [], defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
    defaultVisualBoundsMm: { x: -100, y: -100, width: 200, height: 200 }, defaultFootprintMm: { width: 200, height: 200 },
    defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  scene.propDefinitions[definitionId] = definition
  scene.props.item.definitionRef = { id: definitionId, version }
  scene.props.item.appearance = structuredClone(definition.defaultAppearance)
  scene.props.item.visualBoundsMm = structuredClone(definition.defaultVisualBoundsMm)
}

describe('v4 independent-prop snapshot restoration', () => {
  it('restores only appearance fields, retaining transform, physical fields, privacy, locks and current objects', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    current.props.item.positionMm = { x: 5000, y: 5000 }; current.props.item.rotationDeg = 90
    current.props.item.visibility = 'gm'; current.props.item.blocksMovement = true; current.props.item.editLocked = false
    current.props.newer = symbolPropV3('newer', 14000, 14000); current.entityLayers.newer = current.entityLayers.item
    currentIdentity.propTokens.newer = 'newer-token'
    addMask(current, 'mask', 4000, 6000)
    historic.props.item.appearance = { kind: 'symbol', symbol: 'chair', tint: '#aabbcc', opacity: 0.8 }
    historic.props.item.visualBoundsMm = { x: -250, y: -150, width: 500, height: 300 }
    historic.props.item.shadowClass = 'furniture'
    historic.props.item.shadowOverride = { directionDeg: 45, offsetMm: 20, blurMm: 10, opacity: 0.5, color: '#333333' }
    historic.props.item.positionMm = { x: 8000, y: 8000 }; historic.props.item.rotationDeg = 180
    historic.props.item.footprintMm = { width: 500, height: 500 }; historic.props.item.visibility = 'public'; historic.props.item.blocksMovement = false
    const plan = buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'appearance'))
    expect(plan.changed).toBe(true)
    expect(plan.document.props.item).toMatchObject({
      appearance: historic.props.item.appearance, visualBoundsMm: historic.props.item.visualBoundsMm,
      shadowClass: historic.props.item.shadowClass, shadowOverride: historic.props.item.shadowOverride,
      positionMm: current.props.item.positionMm, rotationDeg: current.props.item.rotationDeg,
      footprintMm: current.props.item.footprintMm, visibility: 'gm', blocksMovement: true, editLocked: false,
    })
    expect(plan.document.entityLayers.item).toBe(current.entityLayers.item)
    expect(plan.document.props.newer).toEqual(current.props.newer)
    expect(plan.document.sceneId).toBe(current.sceneId); expect(plan.document.revision).toBe(current.revision)
    expect(plan.document.title).toBe(current.title)
  })

  it('restores only position and rotation while preserving the current appearance and entity semantics', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    current.props.item.appearance = { kind: 'symbol', symbol: 'chair', tint: '#112233', opacity: 0.6 }
    current.props.item.positionMm = { x: 5000, y: 5000 }; current.props.item.blocksSight = true; current.props.item.visibility = 'gm'
    addMask(current, 'mask', 4000, 8000)
    historic.props.item.positionMm = { x: 7000, y: 7000 }; historic.props.item.rotationDeg = 45
    historic.props.item.appearance = { kind: 'symbol', symbol: 'shelf', tint: null, opacity: 1 }
    historic.props.item.blocksSight = false; historic.props.item.visibility = 'public'
    const plan = buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'transform'))
    expect(plan.document.props.item.positionMm).toEqual({ x: 7000, y: 7000})
    expect(plan.document.props.item.rotationDeg).toBe(45)
    expect(plan.document.props.item.appearance).toEqual(current.props.item.appearance)
    expect(plan.document.props.item.blocksSight).toBe(true); expect(plan.document.props.item.visibility).toBe('gm')
  })

  it('restores a full entity and its historical layer while preserving the current edit lock', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    addSecondLayer(current); addSecondLayer(historic)
    current.props.item.positionMm = { x: 5000, y: 5000 }; current.props.item.visibility = 'public'
    historic.props.item.positionMm = { x: 7000, y: 7000 }; historic.props.item.visibility = 'gm'; historic.props.item.editLocked = true
    historic.entityLayers.item = 'archive'
    addMask(current, 'mask', 6500, 7500)
    const plan = buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))
    expect(plan.document.props.item.positionMm).toEqual({ x: 7000, y: 7000 })
    expect(plan.document.props.item.visibility).toBe('gm'); expect(plan.document.props.item.editLocked).toBe(false)
    expect(plan.document.entityLayers.item).toBe('archive')
    expect(plan.changes[0]).toMatchObject({ action: 'update', beforeLayerId: current.entityLayers.item, layerId: 'archive', historicalEditLocked: true })
    expect(plan.document.userLayers).toEqual(current.userLayers)
  })

  it('restores physical footprint, support, occlusion and render fields only in entity mode', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    addRoomSupport(current); addRoomSupport(historic)
    current.props.item.supportRef = { kind: 'floor', id: 'blank-floor' }; delete current.props.item.roomId
    historic.props.item.footprintMm = { width: 800, height: 600 }
    historic.props.item.footprintOffsetMm = { x: 50, y: -20 }
    historic.props.item.blocksMovement = true; historic.props.item.blocksSight = true
    historic.props.item.renderLayer = 'canopy'; historic.props.item.renderOrder = 4
    const plan = buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))
    expect(plan.document.props.item).toEqual(historic.props.item)
    expect(plan.document.rooms).toEqual(current.rooms)
    expect(plan.document.walls).toEqual(current.walls)
  })

  it('recreates deleted props only through explicit full-entity mode with their original token', () => {
    const historic = layerSceneV3(), current = structuredClone(historic)
    delete current.props.item; delete current.entityLayers.item
    const identity = sameLineageIdentity(historic), currentIdentity = structuredClone(identity)
    const historyIdentity = structuredClone(identity)
    historic.props.item.editLocked = true
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historyIdentity, request(['item'], 'appearance'))).toThrow(/只能显式/)
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historyIdentity, request(['item'], 'transform'))).toThrow(/只能显式/)
    const plan = buildRestorePlanV4(current, currentIdentity, historic, historyIdentity, request(['item'], 'entity'))
    expect(plan.document.props.item).toEqual({ ...historic.props.item, editLocked: false })
    expect(plan.document.entityLayers.item).toBe(historic.entityLayers.item)
    expect(plan.historyIdentity.propTokens.item).toBe(identity.propTokens.item)
    expect(plan.changes[0]).toMatchObject({ action: 'recreate', beforeLayerId: null, historicalEditLocked: true })
  })

  it('refuses unknown, duplicate, over-limit and structurally invalid restore requests', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request([], 'entity'))).toThrow(/1 至 256/)
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(Array.from({ length: 257 }, (_, i) => `p${i}`), 'entity'))).toThrow(/1 至 256/)
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item', 'item'], 'entity'))).toThrow(/不能重复/)
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, { ...request(['item'], 'entity'), fallback: true } as never)).toThrow(/恢复选择无效/)
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['absent'], 'entity'))).toThrow(/历史物件不存在/)
    let reads = 0
    const accessor = { mode: 'entity' }
    Object.defineProperty(accessor, 'ids', { enumerable: true, get: () => { reads++; return ['item'] } })
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, accessor as never)).toThrow(/访问器/)
    expect(reads).toBe(0)
  })

  it('accepts exactly 256 explicit independent targets as one plan', () => {
    const historic = layerSceneV3(), layerId = historic.entityLayers.item
    for (let i = 1; i < 256; i++) {
      const id = `item-${i}`
      historic.props[id] = symbolPropV3(id, 4000 + i % 16 * 400, 4000 + Math.floor(i / 16) * 400)
      historic.entityLayers[id] = layerId
    }
    const current = structuredClone(historic), identity = sameLineageIdentity(historic)
    for (const prop of Object.values(current.props)) prop.rotationDeg = 90
    const plan = buildRestorePlanV4(current, identity, historic, identity, request(Object.keys(historic.props), 'transform'))
    expect(plan.changes).toHaveLength(256)
    expect(Object.values(plan.document.props).every(prop => prop.rotationDeg === 0)).toBe(true)
  })

  it('refuses current entity, source-layer, destination-layer and support-chain locks', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    current.props.item.editLocked = true
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))).toThrow(/已锁定/)
    current.props.item.editLocked = false
    current.userLayers[current.entityLayers.item].editLocked = true
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'appearance'))).toThrow(/已锁定/)
    current.userLayers[current.entityLayers.item].editLocked = false
    addSecondLayer(current); addSecondLayer(historic)
    historic.entityLayers.item = 'archive'; current.userLayers.archive.editLocked = true
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))).toThrow(/目标图层已锁定/)

    const supportPair = pair()
    addRoomSupport(supportPair.current); addRoomSupport(supportPair.historic)
    supportPair.current.userLayers['support-layer'].editLocked = true
    expect(() => buildRestorePlanV4(supportPair.current, supportPair.currentIdentity, supportPair.historic, supportPair.historicIdentity, request(['item'], 'appearance'))).toThrow(/支撑依赖或图层已锁定/)
  })

  it('rejects an entity restore whose destination support chain is currently locked', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    addRoomSupport(current); addRoomSupport(historic)
    current.props.item.supportRef = { kind: 'floor', id: 'blank-floor' }; delete current.props.item.roomId
    current.userLayers['support-layer'].editLocked = true
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))).toThrow(/支撑依赖或图层已锁定/)
  })

  it('checks indirect room terrain support and a roomId distinct from the physical support', () => {
    const terrain = scatterLayerSceneV3(0), historic = structuredClone(terrain)
    addRoomSupport(terrain); addRoomSupport(historic)
    terrain.rooms.support.supportRef = { kind: 'terrainArea', id: 'domain' }
    historic.rooms.support.supportRef = { kind: 'terrainArea', id: 'domain' }
    terrain.terrainAreas.domain.editLocked = true
    const identity = sameLineageIdentity(terrain)
    expect(() => buildRestorePlanV4(terrain, identity, historic, identity, request(['item'], 'appearance'))).toThrow(/支撑依赖或图层已锁定/)

    terrain.terrainAreas.domain.editLocked = false
    // The terrain covers this footprint, so the distinct physical support must remain that terrain.
    terrain.props.item.supportRef = { kind: 'terrainArea', id: 'domain' }
    terrain.rooms.support.editLocked = true
    expect(() => buildRestorePlanV4(terrain, identity, historic, identity, request(['item'], 'transform'))).toThrow(/支撑依赖或图层已锁定/)
  })

  it('rejects either-side prefab, scatter, anchored-note and path-check dependencies', () => {
    const group = groupLayerSceneV3(), groupIdentity = sameLineageIdentity(group)
    const ungrouped = structuredClone(group)
    delete ungrouped.prefabInstances.group; delete ungrouped.entityLayers.group
    expect(() => buildRestorePlanV4(ungrouped, groupIdentity, group, groupIdentity, request(['left'], 'entity'))).toThrow(/历史.*组合或散布成员/)
    expect(() => buildRestorePlanV4(group, groupIdentity, ungrouped, groupIdentity, request(['left'], 'entity'))).toThrow(/当前.*组合或散布成员/)
    const scatter = scatterLayerSceneV3(1), scatterIdentity = sameLineageIdentity(scatter)
    const unscattered = structuredClone(scatter)
    delete unscattered.scatterGroups.scatter; delete unscattered.entityLayers.scatter
    expect(() => buildRestorePlanV4(unscattered, scatterIdentity, scatter, scatterIdentity, request(['scatter-item-0'], 'entity'))).toThrow(/历史.*组合或散布成员/)
    expect(() => buildRestorePlanV4(scatter, scatterIdentity, unscattered, scatterIdentity, request(['scatter-item-0'], 'entity'))).toThrow(/当前.*组合或散布成员/)
    const withNote = layerSceneV3()
    withNote.notes.anchor = { id: 'anchor', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note', text: 'anchor', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    withNote.entityLayers.anchor = withNote.entityLayers.item
    const noteIdentity = sameLineageIdentity(withNote)
    const withoutNote = structuredClone(withNote)
    delete withoutNote.notes.anchor; delete withoutNote.entityLayers.anchor
    expect(() => buildRestorePlanV4(withoutNote, noteIdentity, withNote, noteIdentity, request(['item'], 'entity'))).toThrow(/历史.*锚点注记依赖/)
    expect(() => buildRestorePlanV4(withNote, noteIdentity, withoutNote, noteIdentity, request(['item'], 'entity'))).toThrow(/当前.*锚点注记依赖/)

    const unsupported = structuredClone(layerSceneV3())
    unsupported.constraints.pathChecks = [{ id: 'path-check', from: { type: 'entity', entityKind: 'prop', entityId: 'item' },
      to: { type: 'point', positionMm: { x: 6000, y: 6000 } }, clearanceMm: 500, mode: 'current', assumedOpenDoorIds: [] }]
    const unsupportedIdentity = sameLineageIdentity(unsupported)
    expect(() => buildRestorePlanV4(unsupported, unsupportedIdentity, unsupported, unsupportedIdentity, request(['item'], 'entity'))).toThrow(/场景无效/)
  })

  it('requires the historical layer to exist in the current document', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    addSecondLayer(historic); historic.entityLayers.item = 'archive'
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))).toThrow(/目标图层不存在/)
  })

  it('merges only the selected fixed definition and its image resource closure', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    addImageDefinition(historic)
    historic.assets['instance-asset'] = { ...historic.assets['image-asset'], id: 'instance-asset', sha256: 'b'.repeat(64) }
    historic.props.item.appearance = { kind: 'image', assetId: 'instance-asset', tint: '#123456', opacity: 0.7 }
    historic.assets['unrelated-asset'] = { ...historic.assets['image-asset'], id: 'unrelated-asset', sha256: 'c'.repeat(64) }
    historic.propDefinitions['unrelated-definition'] = { ...historic.propDefinitions['image-definition'], id: 'unrelated-definition',
      catalogId: 'test.unrelated-image', defaultAppearance: { kind: 'image', assetId: 'unrelated-asset', tint: null, opacity: 1 } }
    historic.props.item.shadowClass = 'furniture'
    const plan = buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'appearance'))
    expect(plan.document.propDefinitions).toEqual({ ...current.propDefinitions, 'image-definition': historic.propDefinitions['image-definition'] })
    expect(plan.document.assets).toEqual({ ...current.assets, 'image-asset': historic.assets['image-asset'], 'instance-asset': historic.assets['instance-asset'] })
    expect(plan.document.propDefinitions).not.toHaveProperty('unrelated-definition')
    expect(plan.document.assets).not.toHaveProperty('unrelated-asset')
    expect(plan.document.props.item.appearance).toEqual(historic.props.item.appearance)
    expect(plan.historyIdentity.propTokens.item).toBe(currentIdentity.propTokens.item)
  })

  it('rejects same-ID fixed definition and resource content conflicts even for a no-op appearance', () => {
    const definitionConflict = pair()
    addImageDefinition(definitionConflict.current, 'a'.repeat(64), 1)
    addImageDefinition(definitionConflict.historic, 'a'.repeat(64), 2)
    expect(() => buildRestorePlanV4(definitionConflict.current, definitionConflict.currentIdentity, definitionConflict.historic,
      definitionConflict.historicIdentity, request(['item'], 'appearance'))).toThrow(/定义 ID 与当前版本或内容冲突/)

    const resourceConflict = pair()
    addImageDefinition(resourceConflict.current, 'a'.repeat(64), 1)
    addImageDefinition(resourceConflict.historic, 'b'.repeat(64), 1)
    expect(() => buildRestorePlanV4(resourceConflict.current, resourceConflict.currentIdentity, resourceConflict.historic,
      resourceConflict.historicIdentity, request(['item'], 'appearance'))).toThrow(/资源 ID 与当前内容冲突/)
  })

  it('rejects an appearance candidate whose larger private visual bounds escape the current player mask', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    current.props.item.visibility = 'gm'; historic.props.item.visibility = 'gm'
    current.props.item.visualBoundsMm = { x: -50, y: -50, width: 100, height: 100 }
    historic.props.item.visualBoundsMm = { x: -1000, y: -1000, width: 2000, height: 2000 }
    addMask(current, 'mask', 3900, 4100); addMask(historic, 'mask', 3000, 5000)
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'appearance'))).toThrow(/遮罩未覆盖/)
  })

  it('runs full document geometry validation before and after composing the partial change', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    historic.props.item.positionMm = { x: 20000, y: 20000 }
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'transform'))).toThrow(/历史场景无效/)
    historic.props.item.positionMm = { x: 10000, y: 10000 }
    historic.props.item.visualBoundsMm = { x: -5000, y: -5000, width: 10000, height: 10000 }
    // Both source documents are valid; historic visual bounds cannot fit at the current position.
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'appearance'))).toThrow(/恢复候选场景无效/)
  })

  it('unions history tombstones while refusing lineage and token mismatches', () => {
    const { current, historic } = pair(), currentIdentity = sameLineageIdentity(current), historicIdentity = sameLineageIdentity(historic)
    currentIdentity.propTokens.deletedHere = 'deleted-current'
    historicIdentity.propTokens.deletedThere = 'deleted-historic'
    const plan = buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'transform'))
    expect(plan.historyIdentity.propTokens).toMatchObject({ deletedHere: 'deleted-current', deletedThere: 'deleted-historic' })
    expect(() => buildRestorePlanV4(current, { ...currentIdentity, lineageId: 'other' }, historic, historicIdentity, request(['item'], 'transform'))).toThrow(/同一 lineage/)
    expect(() => buildRestorePlanV4(current, currentIdentity, historic, { ...historicIdentity, propTokens: { ...historicIdentity.propTokens, item: 'different' } }, request(['item'], 'transform'))).toThrow(/token 冲突/)
  })

  it('rejects deleted prop IDs now occupied by geometry or a user layer, including historical tombstones', () => {
    for (const kind of ['geometry', 'layer'] as const) {
      const { current, historic } = pair(), currentIdentity = sameLineageIdentity(current), historicIdentity = sameLineageIdentity(historic)
      delete current.props.item; delete current.entityLayers.item
      delete currentIdentity.propTokens.item
      if (kind === 'geometry') addMask(current, 'item', 2000, 6000)
      else current.userLayers.item = { id: 'item', floorId: 'blank-floor', name: 'Occupied', order: 1, editLocked: false }
      expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))).toThrow(/身份冲突/)
      delete historic.props.item; delete historic.entityLayers.item
      expect(() => buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))).toThrow(/身份冲突/)
    }
  })

  it('keeps no-op and historical-lock-only changes out of the transaction and preserves source inputs', () => {
    const { current, historic, currentIdentity, historicIdentity } = pair()
    historic.props.item.editLocked = true
    const inputsBefore = structuredClone({ current, historic, currentIdentity, historicIdentity })
    const unchanged = buildRestorePlanV4(current, currentIdentity, historic, historicIdentity, request(['item'], 'entity'))
    expect(unchanged.changed).toBe(false); expect(unchanged.changes).toEqual([])
    expect(unchanged.document).toEqual(current)
    expect(Object.isFrozen(unchanged.document)).toBe(true)
    expect(Object.isFrozen(unchanged.document.props.item)).toBe(true)
    expect({ current, historic, currentIdentity, historicIdentity }).toEqual(inputsBefore)
  })
})
