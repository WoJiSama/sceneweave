import { describe, expect, it } from 'vitest'
import { FURNITURE_CATEGORIES, FURNITURE_STYLES, furnitureKey } from '../assets/furniture-collection.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { PropDefinition, SceneDocument } from '../model/scene.js'
import {
  assertFurnishingPalette, currentFurnishingPalette, furnishingPaletteMatches, furnishingStyle,
  type FurnishingPalette, type StyledRoomFurnishing,
} from './palette.js'

function definition(overrides: Partial<PropDefinition> = {}): PropDefinition {
  return {
    id: 'fixture', catalogId: 'fixture.unknown', version: 1, licenseRef: 'MIT',
    origin: { kind: 'original', attribution: 'test fixture', canEmbed: true }, name: 'Fixture', tags: [],
    defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
    defaultVisualBoundsMm: { x: -100, y: -100, width: 200, height: 200 },
    defaultFootprintMm: { width: 100, height: 100 }, defaultFootprintOffsetMm: { x: 0, y: 0 },
    defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none',
    ...overrides,
  }
}

function documentWith(...definitions: PropDefinition[]): SceneDocument {
  const bounds = { x: 0, y: 0, width: 24000, height: 24000 }, stamp = '2026-11-05T00:00:00.000Z'
  return toCurrentSceneDocument({
    format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'palette-fixture', revision: 0, title: 'Palette fixture', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } },
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {},
    propDefinitions: Object.fromEntries(definitions.map(row => [row.id, row])), materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {},
    styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'test fixture', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] },
  })
}

const elvenCatalogId = 'prop.sceneweave.furniture-collection.bed-elven'
const elvenPalette: FurnishingPalette = { source: 'collection', era: 'fantasy', styleId: 'elven', allowMixed: false }
const unknownStyle = { era: null, styleId: null, name: '风格未标注' }
const elvenStyle = { era: 'fantasy', styleId: 'elven', name: '精灵枝蔓' }
const innStyle = { era: 'medieval', styleId: 'gray-oak', name: '灰橡旅舍' }

function furnishingRow(functions: StyledRoomFurnishing['request']['functions'], palette = elvenPalette): StyledRoomFurnishing {
  return { palette: { ...palette }, request: { roomId: 'room', layerId: 'layer', purpose: 'bedroom', variation: 'fixture', functions, movableIds: [], restoreDeletedKeys: [] } }
}

describe('furnishing style discovery', () => {
  it('recognizes all 96 fixed catalog identities at version 1 before consulting tags', () => {
    const catalogIds = new Set<string>()
    for (const style of FURNITURE_STYLES) for (const category of FURNITURE_CATEGORIES) {
      const catalogId = `prop.sceneweave.furniture-collection.${furnitureKey(category.id, style.id)}`
      catalogIds.add(catalogId)
      const value = definition({ catalogId, tags: ['medieval', 'fantasy', '1920s'] })
      expect(furnishingStyle(value)).toEqual({ era: style.era, styleId: style.id, name: style.name })
      value.version = 2
      value.tags = ['1920s']
      expect(furnishingStyle(value)).toEqual({ era: '1920s', styleId: null, name: '风格未标注' })
    }
    expect(catalogIds.size).toBe(96)
  })

  it('recognizes only the exact version-1 inn namespace', () => {
    const value = definition({ catalogId: 'sceneweave.inn-function.prop.bed', tags: ['fantasy'] })
    expect(furnishingStyle(value)).toEqual(innStyle)
    value.version = 2
    expect(furnishingStyle(value)).toEqual({ era: 'fantasy', styleId: null, name: '风格未标注' })
    for (const catalogId of ['sceneweave.inn-function.prop', 'sceneweave.inn-function.property.bed', 'custom.sceneweave.inn-function.prop.bed']) {
      expect(furnishingStyle(definition({ catalogId }))).toEqual(unknownStyle)
    }
  })

  it.each([
    { tags: [], era: null },
    { tags: ['unrelated', 'elven', '精灵枝蔓'], era: null },
    { tags: ['medieval'], era: 'medieval' },
    { tags: ['unrelated', 'fantasy'], era: 'fantasy' },
    { tags: ['1920s', '1920s'], era: '1920s' },
    { tags: ['medieval', 'fantasy'], era: null },
    { tags: ['medieval', 'fantasy', '1920s'], era: null },
  ])('uses one distinct recognized era from unknown definition tags: $tags', ({ tags, era }) => {
    expect(furnishingStyle(definition({ tags }))).toEqual({ era, styleId: null, name: '风格未标注' })
  })

  it('does not infer collection identities from suffixes or similar catalog IDs', () => {
    for (const catalogId of [
      `${elvenCatalogId}-custom`, `${elvenCatalogId}.custom`, `custom.${elvenCatalogId}`,
      'prop.sceneweave.furniture-collection.bed-unknown', 'prop.sceneweave.furniture-collection.elven',
    ]) expect(furnishingStyle(definition({ catalogId, tags: ['elven'] }))).toEqual(unknownStyle)
  })

  it('reads current tags, catalog identity and version when the same input object changes', () => {
    const value = definition({ tags: ['medieval'] })
    const before = structuredClone(value)
    expect(furnishingStyle(value)).toEqual({ era: 'medieval', styleId: null, name: '风格未标注' })
    expect(value).toEqual(before)
    value.tags.splice(0, 1, 'fantasy')
    expect(furnishingStyle(value)).toEqual({ era: 'fantasy', styleId: null, name: '风格未标注' })
    value.catalogId = elvenCatalogId
    value.tags.push('medieval')
    expect(furnishingStyle(value)).toEqual(elvenStyle)
    value.version = 2
    expect(furnishingStyle(value)).toEqual(unknownStyle)
    value.tags.splice(0, value.tags.length, '1920s')
    expect(furnishingStyle(value)).toEqual({ era: '1920s', styleId: null, name: '风格未标注' })
    value.catalogId = 'sceneweave.inn-function.prop.bed'
    value.version = 1
    expect(furnishingStyle(value)).toEqual(innStyle)
    value.catalogId = 'fixture.unknown'
    expect(furnishingStyle(value)).toEqual({ era: '1920s', styleId: null, name: '风格未标注' })
  })

  it.each([
    { catalogId: elvenCatalogId, expected: elvenStyle },
    { catalogId: 'sceneweave.inn-function.prop.bed', expected: innStyle },
    { catalogId: 'fixture.unknown', expected: unknownStyle },
  ])('returns isolated discovery values for $catalogId', ({ catalogId, expected }) => {
    const value = definition({ catalogId }), first = furnishingStyle(value), second = furnishingStyle(value)
    expect(first).not.toBe(second)
    first.era = '1920s'
    first.styleId = 'custom'
    first.name = 'Changed by caller'
    expect(second).toEqual(expected)
    expect(furnishingStyle(value)).toEqual(expected)
    expect(furnishingStyle(definition({ id: 'another', catalogId }))).toEqual(expected)
  })
})

describe('furnishing palette enforcement', () => {
  it('matches era and style independently, with explicit all filters', () => {
    const value = definition({ catalogId: elvenCatalogId })
    expect(furnishingPaletteMatches(value, elvenPalette)).toBe(true)
    expect(furnishingPaletteMatches(value, currentFurnishingPalette())).toBe(true)
    expect(furnishingPaletteMatches(value, { ...elvenPalette, era: 'all' })).toBe(true)
    expect(furnishingPaletteMatches(value, { ...elvenPalette, styleId: 'all' })).toBe(true)
    expect(furnishingPaletteMatches(value, { ...elvenPalette, era: 'medieval' })).toBe(false)
    expect(furnishingPaletteMatches(value, { ...elvenPalette, styleId: 'dwarven' })).toBe(false)
    expect(furnishingPaletteMatches(value, { ...elvenPalette, styleId: 'dwarven', allowMixed: true })).toBe(false)
    expect(furnishingPaletteMatches(definition(), currentFurnishingPalette())).toBe(true)
    expect(furnishingPaletteMatches(definition(), elvenPalette)).toBe(false)
  })

  it('requires explicit mixed-style confirmation and leaves the document and request unchanged', () => {
    const document = documentWith(definition({ id: 'elven', catalogId: elvenCatalogId }), definition({ id: 'unknown' }))
    const row = furnishingRow([
      { role: 'bed', count: 1, definitionRef: { id: 'elven', version: 1 } },
      { role: 'storage', count: 1, definitionRef: { id: 'unknown', version: 1 } },
    ])
    const before = structuredClone({ document, row })
    expect(() => assertFurnishingPalette(document, row)).toThrow('请明确确认混搭')
    expect({ document, row }).toEqual(before)
    row.palette.allowMixed = true
    const confirmed = structuredClone({ document, row })
    expect(() => assertFurnishingPalette(document, row)).not.toThrow()
    expect({ document, row }).toEqual(confirmed)
  })

  it('ignores style mismatch for zero requested count while retaining definition checks', () => {
    const document = documentWith(definition({ id: 'unknown' }))
    const row = furnishingRow([{ role: 'storage', count: 0, definitionRef: { id: 'unknown', version: 1 } }])
    expect(() => assertFurnishingPalette(document, row)).not.toThrow()
    row.request.functions[0].definitionRef.version = 2
    expect(() => assertFurnishingPalette(document, row)).toThrow('实际存在的固定素材及版本')
  })

  it.each([
    { id: 'elven', version: 2 },
    { id: 'missing', version: 1 },
  ])('rejects unavailable definition $id at version $version even when mixing is confirmed', definitionRef => {
    const document = documentWith(definition({ id: 'elven', catalogId: elvenCatalogId }))
    const row = furnishingRow([{ role: 'bed', count: 1, definitionRef }], { ...elvenPalette, allowMixed: true })
    expect(() => assertFurnishingPalette(document, row)).toThrow('实际存在的固定素材及版本')
  })
})
