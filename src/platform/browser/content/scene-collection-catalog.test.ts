import { describe, expect, it, vi } from 'vitest'
import { SCENE_COLLECTION_GROUPS, SCENE_COLLECTION_CATEGORIES, SCENE_COLLECTION_SCENARIOS } from '../../../shared/assets/scene-collection-plan.js'
import { STORAGE_DESIGNS, STORAGE_CATEGORIES } from '../../../shared/assets/storage-collection.js'
import { STORAGE_COLLECTION_ART } from '../../../shared/visual/storage-collection-art.js'
import { TRADE_COLLECTION_ART } from '../../../shared/visual/trade-collection-art.js'
import { TRADE_CATEGORIES, TRADE_DESIGNS } from '../../../shared/assets/trade-collection.js'
import { SCENE_COLLECTION_AVAILABLE_CATEGORIES, SCENE_COLLECTION_ITEMS } from '../../../shared/assets/scene-collection.js'
import { KITCHEN_COLLECTION_ART } from '../../../shared/visual/kitchen-collection-art.js'
import { WASH_COLLECTION_ART } from '../../../shared/visual/wash-collection-art.js'
import { LIGHTING_COLLECTION_ART } from '../../../shared/visual/lighting-collection-art.js'
import { createFurnitureCollectionDocument } from './furniture-collection-catalog.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { applyCommands } from '../../../shared/commands/commands.js'
import { SCENE_COLLECTION_ARTWORK, createSceneCollectionDocument, createSceneCollectionProject, createSceneCollectionStorageRoomDocument, SCENE_COLLECTION_STORAGE_ROOMS, createSceneCollectionTradeSceneDocument, SCENE_COLLECTION_TRADE_SCENES } from './scene-collection-catalog.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'collection-unit' }, clock: { now: () => '2026-11-16T00:00:00.000Z' } }, validation: {} }))

describe('whole-scene coverage and storage candidates', () => {
  it('keeps explicit category targets, representative uses and available art separate', () => {
    expect(SCENE_COLLECTION_GROUPS).toHaveLength(14)
    expect(SCENE_COLLECTION_SCENARIOS).toHaveLength(24)
    for (const row of SCENE_COLLECTION_CATEGORIES) expect(row.target).toBeGreaterThanOrEqual(row.tier === 'major' ? 20 : 6)
    expect(new Set(SCENE_COLLECTION_CATEGORIES.map(row => row.id)).size).toBe(SCENE_COLLECTION_CATEGORIES.length)
    expect(() => createSceneCollectionDocument('not-available')).toThrow(/尚无可加载/)
  })
  it('registers the complete finite coverage without counting materials as placed objects or source variants as new designs', () => {
    expect(SCENE_COLLECTION_AVAILABLE_CATEGORIES).toHaveLength(164)
    expect(SCENE_COLLECTION_ITEMS).toHaveLength(3030)
    expect(new Set(SCENE_COLLECTION_ITEMS.map(row => row.assetId)).size).toBe(3030)
    for (const category of SCENE_COLLECTION_CATEGORIES) {
      expect(SCENE_COLLECTION_AVAILABLE_CATEGORIES.find(row => row.id === category.id)?.count).toBe(category.target)
      const scene = createSceneCollectionDocument(category.id)
      expect(Object.keys(category.tier === 'material' ? scene.materials : scene.propDefinitions)).toHaveLength(category.target)
      expect(Object.keys(category.tier === 'material' ? scene.propDefinitions : scene.materials)).toHaveLength(0)
    }
  })
  it.each(['bed', 'table', 'chair', 'cabinet'] as const)('%s discovery retains the exact previously delivered furniture definitions and origin', category => {
    const previous = createFurnitureCollectionDocument({ category }), discovered = createSceneCollectionDocument(category)
    expect(discovered.propDefinitions).toEqual(previous.propDefinitions)
    expect(discovered.assets).toEqual(previous.assets)
  })
  it.each(STORAGE_CATEGORIES.map(row => [row.id]))('%s has 24 fixed sources with eight designs per era and full original metadata', category => {
    const rows = STORAGE_DESIGNS.filter(row => row.category === category), scene = createSceneCollectionDocument(category)
    expect(rows).toHaveLength(24)
    expect(new Set(rows.map(row => row.design)).size).toBe(24)
    for (const era of ['medieval', 'fantasy', '1920s']) expect(rows.filter(row => row.era === era)).toHaveLength(8)
    expect(Object.keys(scene.propDefinitions)).toHaveLength(24)
    const sources = STORAGE_COLLECTION_ART.filter(row => rows.some(design => design.key === row.key)).map(row => normalizeStaticSvg(row.sourceSvg))
    expect(new Set(sources.map(row => row.normalizedSha256)).size).toBe(24)
    expect(validateSceneDocument(scene).ok).toBe(true)
    for (const definition of Object.values(scene.propDefinitions)) {
      expect(definition.origin.canEmbed).toBe(true)
      expect(definition.defaultFootprintMm.width).toBeLessThan(definition.defaultVisualBoundsMm.width)
      expect(definition.defaultFootprintMm.height).toBeLessThan(definition.defaultVisualBoundsMm.height)
    }
  })
  it.each(SCENE_COLLECTION_STORAGE_ROOMS.map(row => [row.id]))('%s retains independent editable cargo, actual room support and door access', id => {
    const scene = createSceneCollectionStorageRoomDocument(id)
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(Object.keys(scene.props)).toHaveLength(12)
    expect(Object.keys(scene.prefabInstances)).toHaveLength(1)
    const unpacked = applyCommands(scene, [{ type: 'unpackPrefab', id: 'collection-cargo-group' }], { ids: { nextId: () => 'unused' }, clock: { now: () => scene.updatedAt } })
    expect(Object.keys(unpacked.prefabInstances)).toHaveLength(0)
    expect(unpacked.props).toEqual(scene.props)
    for (const prop of Object.values(scene.props)) {
      expect(prop.supportRef).toEqual({ kind: 'room', id: 'collection-storage-room' })
      expect(prop.visualBoundsMm).toEqual(scene.propDefinitions[prop.definitionRef!.id].defaultVisualBoundsMm)
    }
    expect(() => assertDoorwayClearances(scene, [{ openingId: 'collection-storage-door', minWidthMm: 1800, approachDepthMm: 1600 }])).not.toThrow()
  })
  it('rejects unavailable categories and aborted image work without changing fixed sources', async () => {
    const before = canonicalJson(createSceneCollectionDocument('chest'))
    createSceneCollectionStorageRoomDocument('fantasy-store')
    expect(canonicalJson(createSceneCollectionDocument('chest'))).toBe(before)
    const controller = new AbortController(); controller.abort()
    await expect(createSceneCollectionProject('chest', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(() => createSceneCollectionStorageRoomDocument('missing')).toThrow(/未知/)
  })
  it.each(TRADE_CATEGORIES.map(row => [row.id]))('%s preserves explicit base designs, small-detail counts and supported original sources', category => {
    const expected = ['shelf','shop-counter','market-stall'].includes(category) ? 24 : 8
    const scene = createSceneCollectionDocument(category), designs = TRADE_DESIGNS.filter(row => row.category === category)
    expect(designs).toHaveLength(expected)
    expect(new Set(designs.map(row => row.design)).size).toBe(expected)
    expect(Object.keys(scene.propDefinitions)).toHaveLength(expected)
    const sources = TRADE_COLLECTION_ART.filter(row => designs.some(design => design.key === row.key)).map(row => normalizeStaticSvg(row.sourceSvg))
    expect(new Set(sources.map(row => row.normalizedSha256)).size).toBe(expected)
    for (const row of Object.values(scene.propDefinitions)) expect(row.origin.canEmbed).toBe(true)
  })
  it.each(SCENE_COLLECTION_AVAILABLE_CATEGORIES.filter(row => !['storage'].includes(row.group)).map(row => [row.id]))('%s binds its actual independent sources, dimensions, era and physical semantics', category => {
    const plan = SCENE_COLLECTION_CATEGORIES.find(row => row.id === category)!
    const designs = SCENE_COLLECTION_ITEMS.filter(row => row.category === category)
    const scene = createSceneCollectionDocument(category)
    expect(designs).toHaveLength(plan.target)
    expect(new Set(designs.map(row => row.design)).size).toBe(plan.target)
    expect(new Set(designs.map(row => row.key)).size).toBe(plan.target)
    if (plan.tier === 'major' && !['period-equipment','nature','transport'].includes(designs[0].group)) for (const era of ['medieval','fantasy','1920s']) expect(designs.filter(row => row.era === era)).toHaveLength(8)
    const artwork = SCENE_COLLECTION_ARTWORK.filter(row => designs.some(design => design.key === row.key))
    expect(artwork).toHaveLength(plan.target)
    expect(new Set(artwork.map(row => normalizeStaticSvg(row.sourceSvg).normalizedSha256)).size).toBe(plan.target)
    for (const design of designs) {
      const art = artwork.find(row => row.key === design.key)!
      const definition = art.kind === 'material' ? scene.materials[design.definitionId] : scene.propDefinitions[design.definitionId]
      if ('defaultFootprintMm' in definition) {
        expect(definition.defaultFootprintMm).toEqual(art.footprintMm)
        expect(definition.defaultBlocksMovement).toBe(art.blocksMovement)
        expect(definition.defaultRenderLayer).toBe(art.renderLayer)
      } else {
        expect(definition.textureAssetId).toBe(design.assetId)
        expect(definition.defaultTileSizeMm).toEqual({width:design.widthMm,height:design.heightMm})
        expect(scene.propDefinitions[design.definitionId]).toBeUndefined()
        expect(definition.applicableSurfaces).toEqual(['room','wall','terrain','path'])
      }
      expect(scene.assets[design.assetId].logicalSizeMm).toEqual({width:design.widthMm,height:design.heightMm})
      expect(definition.tags).toContain(design.era)
      expect(definition.origin.canEmbed).toBe(true)
    }
    expect(validateSceneDocument(scene).ok).toBe(true)
  })
  it.each(SCENE_COLLECTION_TRADE_SCENES.map(row => [row.id]))('%s has a room on real yard support, independent cargo and an accessible door', id => {
    const scene = createSceneCollectionTradeSceneDocument(id)
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(Object.keys(scene.rooms)).toHaveLength(1); expect(Object.keys(scene.terrainAreas)).toHaveLength(1)
    expect(Object.keys(scene.props)).toHaveLength(22)
    expect(scene.rooms['collection-trade-store'].supportRef).toEqual({kind:'terrainArea',id:'collection-trade-yard'})
    expect(() => assertDoorwayClearances(scene,[{openingId:'collection-trade-door',minWidthMm:1800,approachDepthMm:1200}])).not.toThrow()
    for (const prop of Object.values(scene.props)) expect(prop.supportRef.kind === 'room' || prop.supportRef.id === 'collection-trade-yard').toBe(true)
    const stalls=Object.values(scene.props).filter(prop=>prop.definitionRef!.id.includes('market-stall'))
    expect(stalls).toHaveLength(2)
    for(const prop of stalls) expect(scene.propDefinitions[prop.definitionRef!.id].tags).toContain('非可进入建筑')
  })
})
