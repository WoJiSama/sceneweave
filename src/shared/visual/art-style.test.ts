import { expect, test } from 'vitest'
import { normalizeStaticSvg } from '../ai/svg.js'
import { applyCommands } from '../commands/commands.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { AssetRef, SceneDocument } from '../model/scene.js'
import { projectScene } from '../projection/projection.js'
import { artStyleSource } from './art-style-sources.js'
import { activeArtStyles, activeLineArt, ART_STYLE_DEFAULTS, artStyleBrushKey, CURRENT_ART_STYLE_PAINT_VERSION, CURRENT_BITMAP_LINE_VERSION, CURRENT_LINE_ART_PAINT_VERSION, preservesBitmapContours,
  defaultSceneArtStyle, enabledArtStylePresets, sceneArtStyleSchema, setArtStyleEnabled, upgradeSceneArtStyle, type LegacySceneArtStyle } from './art-style.js'
import { THEME_PACK_ART } from './theme-pack-art.js'
import { HANDDRAWN_SURFACE_ART } from './handdrawn-surfaces.js'
import builtin from '../../platform/browser/content/builtin-data.json'
import { colorFilterSchema, colorCurveTable, neutralColorFilter } from './color-filter.js'

const legacy = (): LegacySceneArtStyle => ({ version: 1, active: 'original', presets: structuredClone(ART_STYLE_DEFAULTS) })

test('commits one presentation setting and projects only the enabled presets in paint order', () => {
  const scene = toCurrentSceneDocument(structuredClone(builtin.project.document) as unknown as SceneDocument)
  const runtime = { ids: { nextId: () => 'unused-id' }, clock: { now: () => '2026-11-21T12:00:00.000Z' } }
  const style = legacy()
  expect(projectScene(scene, 'player').artStyles).toBeUndefined()
  style.active = 'both'
  style.presets.handDrawn.warmth = -22
  const next = applyCommands(scene, [{ type: 'setSceneArtStyle', style }], runtime)
  expect(scene.artStyle).toBeUndefined()
  expect(next.artStyle).toEqual(style)
  const floorId = Object.keys(scene.floors)[0]
  for (const audience of ['player', 'gm'] as const) {
    const { artStyles, sourceRevision: _, ...drawing } = projectScene(next, audience, undefined, { floorId })
    const { sourceRevision: __, ...original } = projectScene(scene, audience, undefined, { floorId })
    expect(artStyles).toEqual([
      { preset: 'handDrawn', parameters: style.presets.handDrawn },
      { preset: 'tea', parameters: style.presets.tea },
    ])
    expect(drawing).toEqual(original)
  }
  const off = applyCommands(next, [{ type: 'setSceneArtStyle', style: { ...style, active: 'original' } }], runtime)
  expect(off.artStyle?.presets.handDrawn).toMatchObject({ warmth: -22 })
  expect(activeArtStyles(off.artStyle)).toBeUndefined()
})

test('toggles styles independently and preserves the saved meaning of single-style projects', () => {
  expect(enabledArtStylePresets('original')).toEqual([])
  expect(setArtStyleEnabled('original', 'handDrawn', true)).toBe('handDrawn')
  expect(setArtStyleEnabled('original', 'tea', true)).toBe('tea')
  expect(setArtStyleEnabled('handDrawn', 'tea', true)).toBe('both')
  expect(setArtStyleEnabled('tea', 'handDrawn', true)).toBe('both')
  expect(setArtStyleEnabled('both', 'tea', false)).toBe('handDrawn')
  expect(setArtStyleEnabled('both', 'handDrawn', false)).toBe('tea')
  expect(setArtStyleEnabled('tea', 'tea', false)).toBe('original')
  for (const preset of ['tea', 'handDrawn'] as const) {
    const saved = sceneArtStyleSchema.parse({ ...legacy(), active: preset })
    expect(activeArtStyles(saved)).toEqual([{ preset, parameters: saved.presets[preset] }])
  }
})

test('keeps old two-preset projects and applies new stacks with line art before the washes', () => {
  const style = legacy()
  const { lineArt, ...oldPresets } = style.presets
  const old = { ...style, active: 'both' as const, presets: oldPresets }
  expect(sceneArtStyleSchema.parse(old)).toEqual(old)
  expect(activeArtStyles(old)?.map(look => look.preset)).toEqual(['handDrawn', 'tea'])
  expect(sceneArtStyleSchema.safeParse({ ...old, active: 'all' }).success).toBe(false)
  expect(setArtStyleEnabled('tea', 'lineArt', true)).toBe('lineArtTea')
  expect(setArtStyleEnabled('lineArt', 'handDrawn', true)).toBe('lineArtHandDrawn')
  expect(setArtStyleEnabled('lineArtTea', 'handDrawn', true)).toBe('all')
  expect(setArtStyleEnabled('all', 'lineArt', false)).toBe('both')
  expect(setArtStyleEnabled('lineArtHandDrawn', 'handDrawn', false)).toBe('lineArt')
  const stacked = sceneArtStyleSchema.parse({ ...style, active: 'all' })
  if (stacked.version !== 1) throw new Error('Saved legacy recipe changed versions.')
  expect(stacked.presets.lineArt).toEqual(lineArt)
  expect(activeArtStyles(stacked)?.map(look => look.preset)).toEqual(['lineArt', 'handDrawn', 'tea'])
  stacked.presets.lineArt!.strength = 0
  expect(activeArtStyles(stacked)).toEqual(activeArtStyles(old))
})

test('keeps the original line art recipe and versions the local bitmap extraction independently', () => {
  const style = legacy()
  style.active = 'lineArt'
  const current = sceneArtStyleSchema.parse(style)
  if (current.version !== 1) throw new Error('Saved legacy recipe changed versions.')
  expect(current.presets.lineArt?.paintVersion).toBe(CURRENT_LINE_ART_PAINT_VERSION)
  const old = { ...current, presets: { ...current.presets, lineArt: { ...current.presets.lineArt!, paintVersion: 3 as const } } }
  expect(sceneArtStyleSchema.parse(old)).toEqual(old)
  expect(artStyleBrushKey(activeArtStyles(old))).not.toBe(artStyleBrushKey(activeArtStyles(current)))
  expect(sceneArtStyleSchema.safeParse({ ...current,
    presets: { ...current.presets, lineArt: { ...current.presets.lineArt, paintVersion: 2 } },
  }).success).toBe(false)
})

test('validates both remembered percent recipes strictly', () => {
  const valid = legacy()
  expect(sceneArtStyleSchema.safeParse(valid).success).toBe(true)
  for (const params of [{ grain: 101 }, { depth: -1 }, { warmth: 20.1 }, { contrast: Infinity }, { strokes: 1 }]) {
    expect(sceneArtStyleSchema.safeParse({ ...valid, presets: { ...valid.presets, tea: { ...valid.presets.tea, ...params } } }).success).toBe(false)
  }
  expect(sceneArtStyleSchema.safeParse({ ...valid, version: 2 }).success).toBe(false)
  const { paintVersion, ...legacyTea } = valid.presets.tea
  expect(paintVersion).toBe(CURRENT_ART_STYLE_PAINT_VERSION)
  const saved = { ...valid, active: 'tea', presets: { ...valid.presets, tea: legacyTea } }
  const parsed = sceneArtStyleSchema.parse(saved)
  expect(parsed).toEqual(saved)
  expect(activeArtStyles(parsed)).toEqual([{ preset: 'tea', parameters: legacyTea }])
  expect(sceneArtStyleSchema.safeParse({ ...saved, presets: { ...saved.presets, tea: { ...legacyTea, paintVersion: 4 } } }).success).toBe(false)
  expect(sceneArtStyleSchema.safeParse({ ...saved, presets: { ...saved.presets, tea: { ...legacyTea, paintVersion: 2 } } }).success).toBe(true)
  const presets = { ...valid.presets, tea: { ...valid.presets.tea, strength: 0 } }
  expect(activeArtStyles({ ...valid, active: 'tea', presets })).toBeUndefined()
  expect(activeArtStyles({ ...valid, active: 'both', presets })).toEqual([{ preset: 'handDrawn', parameters: presets.handDrawn }])
})

test('differentiates authored vector geometry from legacy paint and bitmap traces', () => {
  const svg = normalizeStaticSvg(THEME_PACK_ART.fantasy.find(value => value.key === 'barrel')!.sourceSvg)
  const asset = { sha256: 'a'.repeat(64), origin: { kind: 'original' } } as AssetRef
  const source = { ...svg, kind: 'svg' as const, rasterSha256: asset.sha256 }
  expect(artStyleSource(asset, source, 2)).toBeUndefined()
  expect(artStyleSource(asset, source, CURRENT_ART_STYLE_PAINT_VERSION)).toBe('svg')
  expect(artStyleSource(asset, undefined, CURRENT_ART_STYLE_PAINT_VERSION)).toBeUndefined()
  const trace = { ...asset, imageRefinement: { kind: 'vector', algorithm: 'regional-tones-v1' } } as AssetRef
  expect(artStyleSource(trace, source, CURRENT_ART_STYLE_PAINT_VERSION)).toBeUndefined()
  const reviewed = { ...asset, origin: { ...asset.origin, kind: 'imported' }, imageRefinement: { kind: 'vector', algorithm: 'structure-plan-v1' } } as AssetRef
  expect(artStyleSource(reviewed, source, CURRENT_ART_STYLE_PAINT_VERSION)).toBe('svg')
})

test('keeps the preview brushwork identity stable across grading adjustments', () => {
  const style = legacy()
  style.active = 'both'
  const key = () => artStyleBrushKey(activeArtStyles(style))
  const original = key()
  style.presets.tea.warmth = -50
  style.presets.handDrawn.grain = 100
  expect(key()).toBe(original)
  style.presets.tea.ink = 0
  expect(key()).not.toBe(original)
  style.active = 'lineArt'
  const lineKey = key()
  style.presets.lineArt!.ink = 20
  style.presets.lineArt!.depth = 50
  expect(key()).toBe(lineKey)
  style.presets.lineArt!.strength = 50
  expect(key()).not.toBe(lineKey)
})

test('only an explicit upgrade replaces legacy paint and preserves the saved adjustments', () => {
  const saved = legacy()
  saved.active = 'lineArtTea'
  saved.presets.tea.warmth = -19
  saved.presets.lineArt!.contrast = 90
  const original = structuredClone(saved), upgrade = upgradeSceneArtStyle(saved)
  expect(saved).toEqual(original)
  expect(sceneArtStyleSchema.parse(original)).toEqual(original)
  expect(sceneArtStyleSchema.parse(upgrade)).toEqual(upgrade)
  expect(upgrade.active).toBe(saved.active)
  expect(upgrade.presets.tea.filter.warmth).toBe(-19)
  expect(upgrade.presets.tea.effects.grain).toBe(saved.presets.tea.grain)
  expect(upgrade.presets.lineArt.filter.contrast).toBe(0)
  expect(upgrade.presets.lineArt.effects.edgeDetail).toBe(69)
})

test('uses one strict curve schema and interpolates through bounded channel knots', () => {
  const filter = neutralColorFilter()
  const rgb = [{ input: 0, output: 13 }, { input: 100, output: 99 }, { input: 164, output: 61 }, { input: 255, output: 249 }]
  filter.curves.rgb = rgb
  const table = colorCurveTable(rgb)
  expect(rgb.map(point => table[point.input])).toEqual(rgb.map(point => point.output))
  expect(Math.min(...table.slice(100, 165))).toBe(61)
  expect(Math.max(...table.slice(100, 165))).toBe(99)
  expect(colorFilterSchema.parse(filter)).toEqual(filter)
  for (const invalid of [[], rgb.slice(1), [rgb[0], rgb[1], rgb[1], rgb[3]], [rgb[0], { input: 255, output: 256 }]]) {
    expect(colorFilterSchema.safeParse({ ...filter, curves: { ...filter.curves, rgb: invalid } }).success).toBe(false)
  }
})

test('keeps the earlier saved bitmap recipe and invalidates the preview frame on explicit upgrade', () => {
  const style = defaultSceneArtStyle()
  style.active = 'lineArt'
  const old = structuredClone(style)
  delete old.presets.lineArt.effects.bitmapLineVersion
  const stored = sceneArtStyleSchema.parse(old)
  expect(stored).toEqual(old)
  expect(style.presets.lineArt.effects.bitmapLineVersion).toBe(CURRENT_BITMAP_LINE_VERSION)
  expect(preservesBitmapContours(activeLineArt(activeArtStyles(stored)))).toBe(false)
  expect(preservesBitmapContours(activeLineArt(activeArtStyles(style)))).toBe(true)
  expect(artStyleBrushKey(activeArtStyles(stored))).not.toBe(artStyleBrushKey(activeArtStyles(style)))
})

test('allows tone on the original and leaves brushwork caching independent of color controls', () => {
  const style = defaultSceneArtStyle()
  expect(activeArtStyles(style)).toBeUndefined()
  style.original.enabled = true
  style.original.curves.green[1].output = 208
  const [original] = activeArtStyles(style)!
  expect(original.preset).toBe('original')
  original.filter!.curves.green[1].output = 255
  expect(style.original.curves.green[1].output).toBe(208)
  style.active = 'lineArtTea'
  const before = artStyleBrushKey(activeArtStyles(style))
  style.presets.tea.filter.warmth = 23
  style.presets.lineArt.effects.edgeDetail = 80
  expect(artStyleBrushKey(activeArtStyles(style))).toBe(before)
  style.presets.lineArt.effects.lightFade = 0
  expect(artStyleBrushKey(activeArtStyles(style))).not.toBe(before)
  style.presets.lineArt.effects.enabled = false
  expect(activeArtStyles(style)?.[0].parameters.strength).toBe(0)
})

test('registers known vector geometry by content rather than the asset name', () => {
  const knownArt = [
    [THEME_PACK_ART.fantasy, 'straw-bed', 'strawBed'],
    [THEME_PACK_ART.fantasy, 'tavern-plank', 'tavernTile'],
    [THEME_PACK_ART.fantasy, 'trestle-table', 'longTable'],
    [HANDDRAWN_SURFACE_ART, 'weathered-oak', 'oakTile'],
  ] as const
  for (const [catalog, key, guide] of knownArt) {
    const svg = normalizeStaticSvg(catalog.find(value => value.key === key)!.sourceSvg)
    const asset = { id: 'arbitrary-id', sha256: 'a'.repeat(64), origin: { kind: 'original' } } as AssetRef
    const source = { ...svg, kind: 'svg' as const, rasterSha256: asset.sha256 }
    expect(artStyleSource(asset, source)).toBe(guide)
    expect(artStyleSource(asset, source, CURRENT_ART_STYLE_PAINT_VERSION)).toBe(guide)
    expect(artStyleSource(asset, { ...source, rasterSha256: 'b'.repeat(64) })).toBeUndefined()
    expect(artStyleSource({ ...asset, origin: { ...asset.origin, kind: 'imported' } }, source)).toBeUndefined()
  }
})
