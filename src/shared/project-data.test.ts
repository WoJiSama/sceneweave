import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { layerSceneV3 } from '../core/v3/test-fixtures'
import { createCompositionContent } from './appearance/graph.js'
import { inspectDependencies } from './geometry/dependencies.js'
import { certifyProjectData, PROJECT_DATA_LIMITS, projectContentHash, projectDataSchema, reviseCertifiedProjectData, validateProjectData } from './project/validate.js'
import { canonicalJson, cloneJson, encodeUtf8, inspectJsonInput } from './validation/json.js'
import { certifyCompositionContent, getCertifiedCompositionContent, validateCompositionDraft } from './validation/content.js'
import { isCertifiedSceneSnapshot } from './validation/snapshots.js'
import { emptyVisualSystem } from './visual/types.js'
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
  it('revises only privately certified metadata and rejects forged proofs and invalid scalars', () => {
    const input = certifyProjectData(fixture(true)), updatedAt = '2026-10-26T00:00:00Z'
    const revised = reviseCertifiedProjectData(input, input.document.revision + 1, updatedAt)!
    expect(revised.document).toEqual({ ...input.document, revision: input.document.revision + 1, updatedAt })
    for (const key of ['historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) expect(revised[key]).toBe(input[key])
    expect(revised.document.props).toBe(input.document.props)
    expect(Object.isFrozen(revised)).toBe(true)
    expect(reviseCertifiedProjectData(revised, revised.document.revision + 1, updatedAt)).toBeDefined()
    for (const fake of [fixture(), validateProjectData(input), Object.freeze({ ...input }), Object.freeze(cloneJson(input))]) {
      expect(reviseCertifiedProjectData(fake, 100, updatedAt)).toBeUndefined()
    }
    for (const revision of [input.document.revision, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => reviseCertifiedProjectData(input, revision, updatedAt)).toThrow()
    }
    expect(() => reviseCertifiedProjectData(input, 100, 'invalid-date')).toThrow()
    expect(input.document.updatedAt).not.toBe(updatedAt)
  })
  it('retains exact JSON byte guards across repeated revisions and timestamp length changes', () => {
    const input = fixture()
    input.document.revision = 9; input.document.updatedAt = '2026-10-24T00:00:00Z'
    input.document.title += 'x'.repeat(PROJECT_DATA_LIMITS.jsonBytes - Buffer.byteLength(JSON.stringify(input.document)) - 1)
    const certified = certifyProjectData(input)
    const exact = reviseCertifiedProjectData(certified, 10, input.document.updatedAt)!
    expect(Buffer.byteLength(JSON.stringify(exact.document))).toBe(PROJECT_DATA_LIMITS.jsonBytes)
    expect(validateProjectData(exact).document).toEqual(exact.document)
    expect(() => reviseCertifiedProjectData(exact, 100, input.document.updatedAt)).toThrow(/20MiB/)
    expect(() => reviseCertifiedProjectData(exact, 11, '2026-10-24T00:00:00.000Z')).toThrow(/20MiB/)
    const shorter = reviseCertifiedProjectData(certifyProjectData({ ...input, document: { ...input.document, updatedAt: '2026-10-24T00:00:00.000Z', title: input.document.title.slice(0, -4) } }), 10, input.document.updatedAt)!
    expect(Buffer.byteLength(JSON.stringify(shorter.document))).toBe(PROJECT_DATA_LIMITS.jsonBytes - 4)
    expect(reviseCertifiedProjectData(shorter, 100, input.document.updatedAt)).toBeDefined()
  })
  it('retains the 300MiB declared expansion guard without granting a resource certificate', () => {
    const input = fixture(true), asset = input.document.assets.image, definition = input.document.propDefinitions.definition
    input.document.revision = 9
    input.assets = {}; input.document.assets = {}; input.document.propDefinitions = {}
    for (let i = 0; i < 15; i++) {
      const id = `budget-image-${i}`, sha256 = digest(id), definitionId = `budget-definition-${i}`
      input.document.assets[id] = { ...asset, id, sha256 }
      input.document.propDefinitions[definitionId] = { ...cloneJson(definition), id: definitionId, catalogId: `test.${definitionId}`, defaultAppearance: { kind: 'image', assetId: id, tint: null, opacity: 1 } }
      input.assets[sha256] = { sha256, mimeType: 'image/png', sizeBytes: PROJECT_DATA_LIMITS.imageBytes, pixelWidth: 2, pixelHeight: 2 }
    }
    input.document.props.item.definitionRef = { id: 'budget-definition-0', version: 1 }
    input.document.props.item.appearance = cloneJson(input.document.propDefinitions['budget-definition-0'].defaultAppearance)
    const fresh = createCompositionContent(input.document, { ids: { nextId: (() => { let i = 0; return () => `budget-token-${++i}` })() }, clock: { now: () => '2026-10-24T00:00:00.000Z' } })
    input.historyIdentity = fresh.historyIdentity; input.appearance = fresh.appearance
    const licensePath = input.licenseBindings[0].licensePath
    input.licenseBindings = inspectDependencies(input.document).subjects.map(subject => ({ ...subject, licensePath, embedding: 'allowed' }))
    const overhead = [input.document, input.historyIdentity, input.appearance, input.authoringSources].reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0)
      + Object.values(input.licenses).reduce((sum, value) => sum + Buffer.byteLength(value.text), 0)
    Object.values(input.assets).at(-1)!.sizeBytes -= overhead
    const certified = certifyProjectData(input)
    expect(() => reviseCertifiedProjectData(certified, 10, input.document.updatedAt)).toThrow(/300MiB/)
    expect('resources' in certified).toBe(false)
  })
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
  it('enforces the exact serialized byte boundary for owned JSON, including multibyte characters and escapes', () => {
    const input = fixture()
    input.document.title = '织境🪨\n\u0000\ud800'
    const padding = PROJECT_DATA_LIMITS.jsonBytes - Buffer.byteLength(canonicalJson(input.document), 'utf8')
    input.document.title += 'x'.repeat(padding)
    expect(Buffer.byteLength(canonicalJson(input.document), 'utf8')).toBe(PROJECT_DATA_LIMITS.jsonBytes)
    expect(validateProjectData(input).document.title).toBe(input.document.title)
    input.document.title += '中'
    expect(() => validateProjectData(input)).toThrow(/20MiB/)
  })
  it('hands off only owned immutable content while keeping public drafts detached and mutable', () => {
    const input = fixture(), certified = certifyProjectData(input)
    const content = (project: ProjectData) => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
    expect(certified).toEqual(input)
    expect(certified.document).not.toBe(input.document)
    expect(getCertifiedCompositionContent(content(certified))).toEqual(content(certified))
    expect(isCertifiedSceneSnapshot(certified.document)).toBe(true)
    expect(Object.isFrozen(certified)).toBe(true)
    expect(Object.isFrozen(certified.document.props.item.positionMm)).toBe(true)
    const publicProject = validateProjectData(cloneJson(certified)), publicFromCertified = validateProjectData(certified), draft = validateCompositionDraft(content(input))
    expect(getCertifiedCompositionContent(content(publicProject))).toBeUndefined()
    expect(getCertifiedCompositionContent(content(publicFromCertified))).toBeUndefined()
    expect(isCertifiedSceneSnapshot(publicProject.document)).toBe(false)
    expect(isCertifiedSceneSnapshot(publicFromCertified.document)).toBe(false)
    publicProject.document.title = 'public mutable copy'; publicFromCertified.document.title = 'mutable handoff'; draft.document.props.item.positionMm.x++
    expect(input.document.title).not.toBe(publicProject.document.title)
    expect(draft.document.props.item.positionMm).not.toEqual(input.document.props.item.positionMm)
    expect(certified.document.props.item.positionMm).toEqual(input.document.props.item.positionMm)
  })
  it('does not transfer a composition proof to a changed identity, graph or cloned scene', () => {
    const input = certifyProjectData(fixture()), content = { document: input.document, historyIdentity: input.historyIdentity, appearance: input.appearance }
    const changedIdentity = { ...content, historyIdentity: cloneJson(content.historyIdentity) }
    delete changedIdentity.historyIdentity.propTokens.item
    expect(getCertifiedCompositionContent(changedIdentity)).toBeUndefined()
    expect(() => certifyCompositionContent(changedIdentity)).toThrow(/身份|token/)
    const changedAppearance = { ...content, appearance: cloneJson(content.appearance) }
    delete changedAppearance.appearance.propSources.item
    expect(() => certifyCompositionContent(changedAppearance)).toThrow(/外观源/)
    const changedScene = { ...content, document: cloneJson(content.document) }
    changedScene.document.props.item.positionMm.x = -100000
    expect(() => certifyCompositionContent(changedScene)).toThrow(/边界|占地/)
    const unissuedFrozen = Object.freeze(cloneJson(content))
    expect(getCertifiedCompositionContent(unissuedFrozen)).toBeUndefined()
    expect(certifyCompositionContent(unissuedFrozen)).not.toBe(unissuedFrozen)
  })
  it('keeps visual v2 domain and identity validation behind the shallower envelopes', () => {
    const input = fixture()
    input.schemaVersion = 2; input.document.schemaVersion = 2; input.document.visual = emptyVisualSystem()
    expect(projectDataSchema.safeParse(input).success).toBe(true)
    expect(certifyProjectData(input).document.visual).toEqual(input.document.visual)
    const badVersion = cloneJson(input); badVersion.schemaVersion = 1
    expect(() => certifyProjectData(badVersion)).toThrow(/版本/)
    const badLight = cloneJson(input)
    badLight.document.visual!.lights.missing = { id: 'missing', floorId: Object.keys(input.document.floors)[0], layerId: 'absent-layer', visibility: 'public', editLocked: false,
      positionMm: { x: 1000, y: 1000 }, radiusMm: 1000, color: '#ffeedd', intensity: .5, wallOcclusion: true, enabled: true }
    expect(() => certifyProjectData(badLight)).toThrow(/用户图层/)
    const unknownScene = cloneJson(input) as unknown as { document: Record<string, unknown> }
    unknownScene.document.secretExtra = 'invalid'
    expect(() => certifyProjectData(unknownScene)).toThrow()
  })
  it('rejects hostile content and metadata wrappers before touching their accessors', () => {
    const input = fixture(), content = { document: input.document, historyIdentity: input.historyIdentity, appearance: input.appearance }
    let calls = 0
    const accessor = { ...content }
    Object.defineProperty(accessor, 'appearance', { enumerable: true, get() { calls++; throw new Error('must not be called') } })
    expect(() => certifyCompositionContent(accessor)).toThrow(); expect(calls).toBe(0)
    for (const key of ['document', 'historyIdentity', 'appearance'] as const) {
      const missing = { ...content } as Partial<typeof content>; delete missing[key]
      expect(() => certifyCompositionContent(missing)).toThrow()
    }
    for (const value of [Object.assign({ ...content }, { extra: 1 }), Object.defineProperty({ ...content }, 'hidden', { value: 1 }), Object.assign({ ...content }, { [Symbol('hidden')]: 1 })]) expect(() => certifyCompositionContent(value)).toThrow()
    const metadata = { ...input }
    Object.defineProperty(metadata, 'assets', { enumerable: true, get() { calls++; throw new Error('must not be called') } })
    expect(() => certifyProjectData(metadata)).toThrow(); expect(calls).toBe(0)
  })
})
