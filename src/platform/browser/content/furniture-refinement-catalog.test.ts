import { describe, expect, it, vi } from 'vitest'
import { FURNITURE_CATEGORIES, furnitureAssetId, furnitureDefinitionId } from '../../../shared/assets/furniture-collection.js'
import { FURNITURE_COLLECTION_REFINEMENT_CANDIDATES } from '../../../shared/visual/furniture-collection-refinement-art.js'
import { FURNITURE_COLLECTION_ART } from '../../../shared/visual/furniture-collection-art.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { createFurnitureCollectionDocument } from './furniture-collection-catalog.js'
import { createFurnitureRefinementDocument, createFurnitureRefinementProject } from './furniture-refinement-catalog.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'refinement-test' }, clock: { now: () => '2026-11-17T00:00:00.000Z' } }, validation: {} }))
describe('separate fixed furniture material editions', () => {
  it.each(FURNITURE_CATEGORIES)('$id retains the original identities and all physical semantics', category => {
    const original = createFurnitureCollectionDocument({ category: category.id }), before = JSON.stringify(original)
    const revised = createFurnitureRefinementDocument(category.id)
    expect(Object.keys(revised.propDefinitions)).toHaveLength(24)
    for (const candidate of FURNITURE_COLLECTION_REFINEMENT_CANDIDATES.filter(row => row.category === category.id)) {
      const source = original.propDefinitions[furnitureDefinitionId(candidate.sourceKey)], next = revised.propDefinitions[furnitureDefinitionId(candidate.art.key)]
      const { id: _id, catalogId: _catalogId, name: _name, tags: _tags, origin: _origin, defaultAppearance: _appearance, ...geometry } = source
      const { id: _nextId, catalogId: _nextCatalogId, name: _nextName, tags: _nextTags, origin: _nextOrigin, defaultAppearance: _nextAppearance, ...nextGeometry } = next
      expect(nextGeometry).toEqual(geometry)
      expect(next.id).not.toBe(source.id); expect(next.catalogId).not.toBe(source.catalogId)
      expect(candidate.derivation.sourceSvgSha256).toBe(sha256Text(FURNITURE_COLLECTION_ART.find(row => row.key === candidate.sourceKey)!.sourceSvg))
      expect(next.origin.attribution).toContain(candidate.derivation.sourceSvgSha256)
      expect(next.defaultAppearance.kind === 'image' && next.defaultAppearance.assetId).toBe(furnitureAssetId(candidate.art.key))
      expect(revised.assets[furnitureAssetId(candidate.sourceKey)]).toBeUndefined()
      expect(candidate.derivation.baseDesignContribution).toBe(0)
    }
    expect(JSON.stringify(original)).toBe(before)
    expect(createFurnitureCollectionDocument({ category: category.id })).toEqual(original)
  })
  it('rejects unknown categories and cancellation before raster work', async () => {
    expect(() => createFurnitureRefinementDocument('missing' as 'bed')).toThrow('未知')
    const controller = new AbortController(); controller.abort()
    await expect(createFurnitureRefinementProject('bed', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
