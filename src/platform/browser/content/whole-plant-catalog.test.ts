import { describe, expect, it, vi } from 'vitest'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { WHOLE_PLANT_ART, WHOLE_PLANT_SPECS } from '../../../shared/visual/whole-plant-art.js'
import { createVegetationDetailCatalogDocument } from './vegetation-detail-catalog.js'
import { appendWholePlantDefinitions, createWholePlantCatalogDocument, materializeWholePlantScene } from './whole-plant-catalog.js'

vi.mock('../runtime.js', () => ({ runtime: { ids: { nextId: () => 'whole-plant-unit' }, clock: { now: () => '2026-11-13T00:00:00.000Z' } }, validation: {} }))

describe('whole plants as independently placeable fixed items', () => {
  it('supplies twelve distinct supported SVGs with root positions inside their full image and separate physical footprints', () => {
    const document = createWholePlantCatalogDocument()
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(Object.keys(document.props)).toHaveLength(0)
    expect(WHOLE_PLANT_ART.filter(art => art.role === 'tree')).toHaveLength(4)
    expect(WHOLE_PLANT_ART.filter(art => art.role === 'shrub')).toHaveLength(3)
    expect(WHOLE_PLANT_ART.filter(art => art.role === 'groundcover')).toHaveLength(5)
    const hashes = WHOLE_PLANT_ART.map(art => sha256Text(normalizeStaticSvg(art.sourceSvg).normalizedSource))
    expect(new Set(hashes).size).toBe(12)
    for (const spec of WHOLE_PLANT_SPECS) {
      const definition = document.propDefinitions[spec.definitionId], bounds = definition.defaultVisualBoundsMm
      expect(bounds.x).toBeLessThan(0); expect(bounds.y).toBeLessThan(0)
      expect(bounds.x + bounds.width).toBeGreaterThan(0); expect(bounds.y + bounds.height).toBeGreaterThan(0)
      expect(definition.defaultFootprintMm.width).toBeLessThan(bounds.width)
      expect(definition.defaultFootprintMm.height).toBeLessThan(bounds.height)
      expect(Math.abs(bounds.x + spec.rootPixel.x / 512 * spec.widthMm)).toBeLessThanOrEqual(.5)
      expect(Math.abs(bounds.y + spec.rootPixel.y / 512 * spec.heightMm)).toBeLessThanOrEqual(.5)
    }
  })

  it('leaves the old six plants unchanged and refuses late or cross-kind identity occupation without partial additions', () => {
    const old = createVegetationDetailCatalogDocument(), saved = canonicalJson(old), result = appendWholePlantDefinitions(old)
    expect(canonicalJson(old)).toBe(saved)
    for (const [id, definition] of Object.entries(old.propDefinitions)) expect(result.propDefinitions[id]).toEqual(definition)
    expect(Object.keys(result.propDefinitions)).toHaveLength(18)
    const occupied = cloneJson(old), id = WHOLE_PLANT_SPECS.at(-1)!.assetId, floorId = Object.keys(old.floors)[0]
    occupied.userLayers[id] = { id, floorId, name: 'User layer', order: 1, editLocked: false }
    const before = canonicalJson(occupied)
    expect(() => appendWholePlantDefinitions(occupied)).toThrow(/不覆盖/)
    expect(canonicalJson(occupied)).toBe(before)
    expect(() => appendWholePlantDefinitions(result)).toThrow(/不覆盖/)
  })

  it('refuses changed fixed calibration and cancellation before attempting any rasterization', async () => {
    const changed = createWholePlantCatalogDocument()
    changed.propDefinitions[WHOLE_PLANT_SPECS[3].definitionId].defaultFootprintMm.width++
    await expect(materializeWholePlantScene(changed)).rejects.toThrow(/固定定义或标定不匹配/)
    const controller = new AbortController(); controller.abort()
    await expect(materializeWholePlantScene(createWholePlantCatalogDocument(), [], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
