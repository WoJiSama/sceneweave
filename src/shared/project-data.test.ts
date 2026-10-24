import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { layerSceneV3 } from '../core/v3/test-fixtures'
import { createCompositionContent } from './appearance/graph.js'
import { inspectDependencies } from './geometry/dependencies.js'
import { projectContentHash, projectDataSchema, validateProjectData } from './project/validate.js'
import { canonicalJson, cloneJson, encodeUtf8, inspectJsonInput } from './validation/json.js'
import type { SceneDocument } from './model/scene.js'
import type { ProjectData } from './model/project.js'
import type { PreparationContext } from './ports/runtime.js'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
function fixture(image = false): ProjectData {
  let next = 0
  const context: PreparationContext = { ids: { nextId: () => `project-token-${++next}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } }
  const document: SceneDocument = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 }
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  if (image) {
    const prop = document.props.item, sha256 = digest('metadata fixture; intentionally not decoded pixels')
    document.assets.image = { id: 'image', sha256, mimeType: 'image/png', pixelWidth: 2, pixelHeight: 2, logicalSizeMm: { width: 200, height: 200 },
      licenseRef: 'test-license', origin: { kind: 'original', attribution: 'Sceneweave tests', canEmbed: true } }
    document.propDefinitions.definition = { id: 'definition', catalogId: 'test.project-image', version: 1, licenseRef: 'test-license', origin: document.assets.image.origin,
      name: 'Image', tags: [], defaultAppearance: { kind: 'image', assetId: 'image', tint: null, opacity: 1 }, defaultVisualBoundsMm: prop.visualBoundsMm,
      defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false,
      defaultRenderLayer: 'object', defaultShadowClass: 'none' }
    prop.definitionRef = { id: 'definition', version: 1 }; prop.appearance = document.propDefinitions.definition.defaultAppearance
  }
  const content = createCompositionContent(document, context), license = 'Sceneweave test license', licenseHash = digest(license)
  const subjects = inspectDependencies(content.document).subjects
  return { format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: Object.fromEntries(Object.values(document.assets).map(asset => [asset.sha256, { sha256: asset.sha256, mimeType: asset.mimeType, sizeBytes: 50, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight }])),
    licenses: subjects.length ? { [licenseHash]: { sha256: licenseHash, text: license } } : {},
    licenseBindings: subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources: {} }
}

describe('native complete-v1 pure metadata contract', () => {
  it('owns strict complete JSON while preserving all three content parts', () => {
    const input = fixture(), parsed = validateProjectData(input)
    expect(parsed).toEqual(input); expect(parsed).not.toBe(input); expect(parsed.document).not.toBe(input.document)
    parsed.document.title = 'owned'; expect(input.document.title).not.toBe('owned')
    expect(Object.keys(parsed).sort()).toEqual(['format', 'schemaVersion', 'document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'].sort())
  })
  it('distinguishes old format/version and rejects unknown task/credential fields', () => {
    const input = fixture()
    for (const changed of [{ ...input, format: 'sceneweave-project' }, { ...input, schemaVersion: 6 }, { ...input, task: {} }, { ...input, apiKey: 'example' }, { ...input, historyIdentity: { ...input.historyIdentity, version: 3 } }]) expect(() => validateProjectData(changed)).toThrow()
  })
  it('keeps exact resource and subject/license metadata closure without claiming image decoding', () => {
    const input = fixture(true), parsed = validateProjectData(input)
    expect(parsed).toEqual(input); expect(projectDataSchema.safeParse(input).success).toBe(true)
    // These metadata intentionally have no usable PNG bytes. Full resource verification belongs to c.
    expect('resources' in parsed || 'validated' in parsed).toBe(false)
    expect(() => validateProjectData({ ...input, assets: {} })).toThrow(/图片/)
    expect(() => validateProjectData({ ...input, licenseBindings: [] })).toThrow(/许可/)
    const extra = cloneJson(input); extra.assets['f'.repeat(64)] = { ...Object.values(extra.assets)[0], sha256: 'f'.repeat(64) }
    expect(() => validateProjectData(extra)).toThrow(/闭包/)
  })
  it('rejects inconsistent image metadata and cumulative pixel guards', () => {
    const input = fixture(true), hash = Object.keys(input.assets)[0]
    input.assets[hash].pixelWidth = 3
    expect(() => validateProjectData(input)).toThrow(/不匹配/)
    input.assets[hash].pixelWidth = 8193; expect(() => validateProjectData(input)).toThrow()
  })
  it('requires exact embeddable bindings and actual license text hash', () => {
    const input = fixture(true), hash = Object.keys(input.licenses)[0]
    const bad = cloneJson(input); bad.licenses[hash].text += ' changed'
    expect(() => validateProjectData(bad)).toThrow(/正文hash/)
    const blocked = cloneJson(input); blocked.document.propDefinitions.definition.origin.canEmbed = false
    expect(() => validateProjectData(blocked)).toThrow(/嵌入/)
    const duplicate = cloneJson(input); duplicate.licenseBindings.push(duplicate.licenseBindings[0])
    expect(() => validateProjectData(duplicate)).toThrow(/重复/)
    const invalidUnicode = cloneJson(input), text = 'license\ud800', newHash = digest(text)
    invalidUnicode.licenses = { [newHash]: { sha256: newHash, text } }
    invalidUnicode.licenseBindings.forEach(binding => { binding.licensePath = `licenses/${newHash}.txt` })
    expect(() => validateProjectData(invalidUnicode)).toThrow(/编码/)
  })
  it('accepts exact SVG metadata only for a bounded PNG while leaving byte/pixel verification to the resource boundary', () => {
    const input = fixture(true)
    input.authoringSources.image = { kind: 'svg', sourceSha256: 'a'.repeat(64), normalizedSha256: 'b'.repeat(64), sourceSizeBytes: 20, normalizedSizeBytes: 20,
      rasterSha256: Object.keys(input.assets)[0], processorId: 'sceneweave-static-svg', processorVersion: 1 }
    expect(validateProjectData(input).authoringSources).toEqual(input.authoringSources)
    const unknown = cloneJson(input); unknown.authoringSources.unknown = unknown.authoringSources.image; delete unknown.authoringSources.image
    expect(() => validateProjectData(unknown)).toThrow(/SVG/)
    const wrongRaster = cloneJson(input); wrongRaster.authoringSources.image.rasterSha256 = 'c'.repeat(64)
    expect(() => validateProjectData(wrongRaster)).toThrow(/SVG/)
    const conflictingSize = cloneJson(input); conflictingSize.authoringSources.image.normalizedSha256 = conflictingSize.authoringSources.image.sourceSha256; conflictingSize.authoringSources.image.normalizedSizeBytes++
    expect(() => validateProjectData(conflictingSize)).toThrow(/冲突/)
  })
  it('hashes complete new JSON deterministically and includes supported metadata', () => {
    const input = fixture(), reordered = Object.fromEntries(Object.entries(input).reverse())
    expect(projectContentHash(reordered)).toBe(projectContentHash(input))
    expect(projectContentHash(input)).toBe(digest(canonicalJson(input)))
    input.document.title += ' changed'; expect(projectContentHash(input)).not.toBe(projectContentHash(fixture()))
    expect(canonicalJson({ Z: 1, a: 2, A: 3, '中': 4 })).toBe('{"A":3,"Z":1,"a":2,"中":4}')
  })
  it('never executes external accessors, and rejects values ignored by JSON serialization', () => {
    let calls = 0; const input = fixture()
    Object.defineProperty(input, 'assets', { enumerable: true, get() { calls++; throw new Error('getter') } })
    expect(() => validateProjectData(input)).toThrow(); expect(calls).toBe(0)
    for (const value of [undefined, NaN, Infinity, 1n, () => 0, { value: undefined }, new Map(), [, 1], Object.assign([1], { hidden: true })]) expect(inspectJsonInput(value)).toBeDefined()
    const frozen = Object.freeze({ child: { value: 1 } }); expect(inspectJsonInput(frozen)).toBeUndefined()
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; expect(inspectJsonInput(cyclic)).toBeDefined()
  })
  it('uses the same UTF-8 and SHA rules for Chinese, astral characters and lone surrogates', () => {
    for (const text of ['', '织境', '🪨🌋', '\ud800', 'a\udc00b']) expect(encodeUtf8(text)).toEqual(new TextEncoder().encode(text))
  })
})
