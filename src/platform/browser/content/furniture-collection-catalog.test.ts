import { describe, expect, it, vi } from 'vitest'
import { FURNITURE_CATEGORIES, FURNITURE_ERAS, FURNITURE_STYLES, furnitureDefinitionId, furnitureKey } from '../../../shared/assets/furniture-collection.js'
import { FURNITURE_COLLECTION_ART } from '../../../shared/visual/furniture-collection-art.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { createFurnitureCollectionDocument, createFurnitureStyleRoomDocument, createFurnitureCollectionProject } from './furniture-collection-catalog.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'furniture-unit' }, clock: { now: () => '2026-11-16T00:00:00.000Z' } }, validation: {} }))

describe('96 independent coordinated furniture candidates', () => {
  it('keeps 24 designs per category, eight style families per era, unique fixed keys and supported SVG within budget', () => {
    expect(FURNITURE_COLLECTION_ART).toHaveLength(96)
    expect(new Set(FURNITURE_STYLES.map(row => row.id)).size).toBe(24)
    for (const era of FURNITURE_ERAS) expect(FURNITURE_STYLES.filter(row => row.era === era.id)).toHaveLength(8)
    expect(new Set(FURNITURE_COLLECTION_ART.map(row => row.key)).size).toBe(96)
    for (const category of FURNITURE_CATEGORIES) {
      const scene = createFurnitureCollectionDocument({ category: category.id }), rows = Object.values(scene.propDefinitions)
      expect(rows).toHaveLength(24); expect(validateSceneDocument(scene).ok).toBe(true)
      expect(new Set(FURNITURE_STYLES.map(row => row.designs[category.id])).size).toBe(24)
      const sources = FURNITURE_COLLECTION_ART.filter(row => row.key.startsWith(`${category.id}-`)).map(row => normalizeStaticSvg(row.sourceSvg))
      expect(new Set(sources.map(row => row.normalizedSha256)).size).toBe(24)
      for (const definition of rows) {
        expect(definition.defaultBlocksMovement).toBe(true)
        expect(definition.defaultBlocksSight).toBe(false)
        expect(definition.defaultFootprintMm.width).toBeLessThan(definition.defaultVisualBoundsMm.width)
        expect(definition.defaultFootprintMm.height).toBeLessThan(definition.defaultVisualBoundsMm.height)
      }
    }
  })

  it.each(FURNITURE_STYLES.map(row => [row.id]))('builds %s as one editable full-scale room, with matching props, true openings and clear doorway', styleId => {
    const scene = createFurnitureStyleRoomDocument(styleId), props = Object.values(scene.props)
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(props).toHaveLength(4); expect(Object.keys(scene.rooms)).toHaveLength(1)
    expect(Object.keys(scene.openings)).toHaveLength(2)
    for (const category of FURNITURE_CATEGORIES) {
      const definition = scene.propDefinitions[furnitureDefinitionId(furnitureKey(category.id, styleId))]
      const prop = props.find(row => row.definitionRef?.id === definition.id)!
      expect(prop.visualBoundsMm).toEqual(definition.defaultVisualBoundsMm)
      expect(prop.footprintMm).toEqual(definition.defaultFootprintMm)
      expect(prop.supportRef).toEqual({ kind: 'room', id: 'furniture-style-room' })
    }
    expect(() => assertDoorwayClearances(scene, [{ openingId: 'furniture-style-door', minWidthMm: 1000, approachDepthMm: 1200 }])).not.toThrow()
    for (let i = 0; i < props.length; i++) for (const other of props.slice(i + 1)) {
      const a = props[i], dx = Math.abs(a.positionMm.x - other.positionMm.x), dy = Math.abs(a.positionMm.y - other.positionMm.y)
      expect(dx >= (a.footprintMm.width + other.footprintMm.width) / 2 || dy >= (a.footprintMm.height + other.footprintMm.height) / 2).toBe(true)
    }
  })

  it('rejects unknown or unbounded selections and cancellation before image work, keeping fixed sources independent', async () => {
    expect(() => createFurnitureCollectionDocument()).toThrow(/明确选择/)
    expect(() => createFurnitureCollectionDocument({ styleId: 'missing' })).toThrow(/未知/)
    expect(() => createFurnitureCollectionDocument({ category: 'missing' as 'bed' })).toThrow(/未知/)
    const before = canonicalJson(createFurnitureCollectionDocument({ category: 'bed' }))
    createFurnitureStyleRoomDocument('elven')
    expect(canonicalJson(createFurnitureCollectionDocument({ category: 'bed' }))).toBe(before)
    const abort = new AbortController(); abort.abort()
    await expect(createFurnitureCollectionProject({ category: 'bed' }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
