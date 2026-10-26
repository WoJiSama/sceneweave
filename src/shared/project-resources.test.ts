import { createHash } from 'node:crypto'
import { zlibSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../core/v3/test-fixtures'
import { bitmapVariant, createCompositionContent } from './appearance/graph.js'
import { inspectDependencies } from './geometry/dependencies.js'
import type { AssetRecord, ProjectBundle, ProjectData } from './model/project.js'
import type { SceneDocument } from './model/scene.js'
import type { CompleteValidationOptions, ImageProcessingPort, RasterImage } from './ports/resources.js'
import { crc32 } from './project/binary.js'
import { validateHistoryArchive, type HistoryArchive } from './project/history.js'
import { createMemoryResources, deriveBitmapVariant, getVerifiedProjectBundle, tryDerivedProjectBundle, validateProjectBundle, validateProjectBundles } from './project/resources.js'
import { projectContentHash } from './project/validate.js'
import { cloneJson } from './validation/json.js'

const digest = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex')
const RED = [200, 100, 50, 255], BLUE = [20, 40, 160, 255]
function png(pixel: number[]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
    view.setUint32(0, data.length); result.set(new TextEncoder().encode(type), 4); result.set(data, 8)
    view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)))
    return result
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(new Uint8Array([0, ...pixel]))), chunk('IEND', new Uint8Array())]
  const result = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0; for (const item of chunks) { result.set(item, offset); offset += item.length }
  return result
}
function metadata(document: SceneDocument, pixels: ReadonlyMap<string, Uint8Array>): ProjectData {
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `resource-token-${++sequence}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } })
  const text = 'Sceneweave resource boundary unit fixture', hash = digest(text), subjects = inspectDependencies(content.document).subjects
  return { format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: Object.fromEntries([...pixels].map(([sha256, bytes]) => [sha256, { sha256, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 }])),
    licenses: subjects.length ? { [hash]: { sha256: hash, text } } : {},
    licenseBindings: subjects.map(subject => ({ ...subject, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' })), authoringSources: {} }
}
function fixture(pixel?: number[]): { bundle: ProjectBundle; bytes: Map<string, Uint8Array>; pixels: Map<string, Uint8ClampedArray> } {
  const document: SceneDocument = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 }
  document.sceneId = 'resource-owner'; document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const bytes = new Map<string, Uint8Array>(), pixels = new Map<string, Uint8ClampedArray>()
  if (pixel) {
    const encoded = png(pixel), hash = digest(encoded), prop = document.props.item
    bytes.set(hash, encoded); pixels.set(hash, new Uint8ClampedArray(pixel))
    const origin = { kind: 'original' as const, attribution: 'Sceneweave unit fixture', canEmbed: true }
    document.assets.image = { id: 'image', sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'test-license', origin }
    document.propDefinitions.definition = { id: 'definition', catalogId: 'test.resource-image', version: 1, licenseRef: 'test-license', origin,
      name: '资源测试', tags: [], defaultAppearance: { kind: 'image', assetId: 'image', tint: null, opacity: 1 }, defaultVisualBoundsMm: prop.visualBoundsMm,
      defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false,
      defaultRenderLayer: 'object', defaultShadowClass: 'none' }
    prop.definitionRef = { id: 'definition', version: 1 }; prop.appearance = cloneJson(document.propDefinitions.definition.defaultAppearance)
  }
  return { bundle: { project: metadata(document, bytes), resources: createMemoryResources(bytes) }, bytes, pixels }
}
/** Deliberate Node test double: Chrome tests separately prove real decoding and Canvas pixels. */
function nodeImages(pixels = new Map<string, Uint8ClampedArray>()) {
  const decode = vi.fn(async (_bytes: Uint8Array, record: AssetRecord): Promise<RasterImage> => {
    const rgba = pixels.get(record.sha256)
    if (!rgba) throw new Error('Node image double has no declared fixture pixels')
    return { width: record.pixelWidth, height: record.pixelHeight, rgba: rgba.slice() }
  })
  const transform = vi.fn(async (_image: RasterImage): Promise<RasterImage> => ({ width: 1, height: 1, rgba: new Uint8ClampedArray([100, 50, 25, 255]) }))
  const images: ImageProcessingPort = { decode, transform, async encodePng() { throw new Error('Node validation must not encode') } }
  return { options: { images } satisfies CompleteValidationOptions, images, decode, transform }
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function archiveFixture(image = false): { archive: HistoryArchive; pixels: Map<string, Uint8ClampedArray> } {
  const current = fixture(image ? RED : undefined), historic = fixture(image ? RED : undefined)
  current.bundle.project.document.revision = 9
  historic.bundle.project.document.sceneId = 'historical-document'; historic.bundle.project.document.revision = 7
  return { archive: { current: current.bundle, snapshots: [{ id: 'history-one', ownerSceneId: 'resource-owner', lineageId: historic.bundle.project.historyIdentity.lineageId,
    sourceRevision: 7, name: '历史点', kind: 'named', createdAt: '2026-10-24T01:00:00.000Z', contentHash: projectContentHash(historic.bundle.project), bundle: historic.bundle }] }, pixels: current.pixels }
}
function refreshSnapshotHash(archive: HistoryArchive): void {
  archive.snapshots[0].contentHash = projectContentHash(archive.snapshots[0].bundle.project)
}

describe('complete-v1 owned resources and selected-history boundary (Node image double)', () => {
  it('supports a native family with 64 selected and 20 imported snapshots while rejecting a larger batch', async () => {
    const { bundle } = fixture(), double = nodeImages()
    expect(await validateProjectBundles(Array.from({ length: 85 }, () => bundle), double.options)).toHaveLength(85)
    await expect(validateProjectBundles(Array.from({ length: 86 }, () => bundle), double.options)).rejects.toThrow(/85/)
    expect(double.decode).not.toHaveBeenCalled()
  })
  it('rejects wrapper, nested metadata and reader accessors without invoking them', async () => {
    let getters = 0
    const accessor = { enumerable: true, get() { getters++; throw new Error('untrusted accessor') } }
    const wrapper = fixture().bundle; Object.defineProperty(wrapper, 'project', accessor)
    const nested = fixture().bundle; Object.defineProperty(nested.project.document, 'title', accessor)
    // Use a mutable port to verify reader inspection rather than calling a getter.
    const port = fixture().bundle; port.resources = Object.defineProperty({}, 'read', accessor) as ProjectBundle['resources']
    const options = nodeImages().options
    for (const input of [wrapper, nested, port]) await expect(validateProjectBundle(input, options)).rejects.toThrow()
    expect(getters).toBe(0)
  })

  it('captures metadata and the read method before its first asynchronous boundary', async () => {
    const { bundle, bytes, pixels } = fixture(RED), waiting = gate(), reached = gate(), hash = Object.keys(bundle.project.assets)[0]
    const originalTitle = bundle.project.document.title
    bundle.resources = { async read() { reached.release(); await waiting.promise; return bytes.get(hash)! } }
    const validating = validateProjectBundle(bundle, nodeImages(pixels).options)
    bundle.project.document.title = 'changed after invocation'
    const replacement = vi.fn(async () => { throw new Error('replacement reader must not run') })
    bundle.resources.read = replacement
    await reached.promise; waiting.release()
    const verified = await validating
    expect(verified.project.document.title).toBe(originalTitle); expect(replacement).not.toHaveBeenCalled()
    expect(verified.project).not.toBe(bundle.project); expect(Object.isFrozen(verified.project.document)).toBe(true)
  })

  it('owns actual returned bytes before an asynchronous decoder can observe outside mutation', async () => {
    const { bundle, bytes, pixels } = fixture(RED), hash = Object.keys(bundle.project.assets)[0], source = bytes.get(hash)!, original = source.slice()
    bundle.resources = { async read() { return source } }
    const waiting = gate(), reached = gate(), double = nodeImages(pixels), originalDecode = double.images.decode
    double.images.decode = async (...args) => { reached.release(); await waiting.promise; return originalDecode(...args) }
    const validating = validateProjectBundle(bundle, double.options)
    await reached.promise; source.fill(0); waiting.release()
    const verified = await validating
    expect(await verified.resources.read(hash)).toEqual(original)
    const outward = await verified.resources.read(hash); outward.fill(255)
    expect(await verified.resources.read(hash)).toEqual(original)
  })

  it('captures memory resources independently and rejects accessor collections', async () => {
    const bytes = png(RED), hash = digest(bytes), original = bytes.slice(), port = createMemoryResources({ [hash]: bytes })
    bytes.fill(0)
    const first = await port.read(hash), second = await port.read(hash)
    expect(first).toEqual(original); expect(second).not.toBe(first); first.fill(7)
    expect(await port.read(hash)).toEqual(original)
    let getters = 0
    const record = Object.defineProperty({}, hash, { enumerable: true, get() { getters++; return original } })
    expect(() => createMemoryResources(record)).toThrow(/访问器/); expect(getters).toBe(0)
    await expect(port.read('f'.repeat(64))).rejects.toThrow(/闭包/)
  })

  it('shares an owned union internally while every returned project keeps its own resource scope', async () => {
    const current = fixture(RED), historical = fixture(BLUE), double = nodeImages(new Map([...current.pixels, ...historical.pixels]))
    const [left, right] = await validateProjectBundles([current.bundle, historical.bundle], double.options)
    const currentHash = Object.keys(left.project.assets)[0], historicHash = Object.keys(right.project.assets)[0]
    expect(await left.resources.read(currentHash)).toEqual(current.bytes.get(currentHash))
    expect(await right.resources.read(historicHash)).toEqual(historical.bytes.get(historicHash))
    await expect(left.resources.read(historicHash)).rejects.toThrow(/闭包/)
    await expect(right.resources.read(currentHash)).rejects.toThrow(/闭包/)
  })

  it('rejects the unique union pixel budget before reading or decoding individually valid projects', async () => {
    const bundles = [RED, BLUE, [40, 80, 120, 255]].map(pixel => {
      const { bundle } = fixture(pixel)
      bundle.project.document.assets.image.pixelWidth = 5000; bundle.project.document.assets.image.pixelHeight = 5000
      const record = Object.values(bundle.project.assets)[0]; record.pixelWidth = 5000; record.pixelHeight = 5000
      bundle.resources = { read: vi.fn(async () => { throw new Error('budget rejection must precede byte IO') }) }
      return bundle
    })
    const double = nodeImages()
    await expect(validateProjectBundles(bundles, double.options)).rejects.toThrow(/联合图片/)
    for (const bundle of bundles) expect(bundle.resources.read).not.toHaveBeenCalled()
    expect(double.decode).not.toHaveBeenCalled()
  })

  it('rejects conflicting same-hash records before either resource port is read', async () => {
    const first = fixture(RED).bundle, second = fixture(RED).bundle
    Object.values(second.project.assets)[0].sizeBytes++
    for (const bundle of [first, second]) bundle.resources = { read: vi.fn(async () => { throw new Error('metadata conflict must precede byte IO') }) }
    const double = nodeImages()
    await expect(validateProjectBundles([first, second], double.options)).rejects.toThrow(/同hash图片元数据冲突/)
    expect(first.resources.read).not.toHaveBeenCalled(); expect(second.resources.read).not.toHaveBeenCalled()
    expect(double.decode).not.toHaveBeenCalled()
  })

  it('stops after a cancelled transform before calling the encoder', async () => {
    const { bundle, bytes, pixels } = fixture(RED), record = Object.values(bundle.project.assets)[0], signal = { aborted: false }, double = nodeImages(pixels)
    double.images.transform = async image => { signal.aborted = true; return image }
    const encode = vi.fn(async () => png(RED)); double.images.encodePng = encode
    await expect(deriveBitmapVariant(bytes.get(record.sha256)!, record, { tint: null, brightness: .5 }, { ...double.options, signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(encode).not.toHaveBeenCalled()
  })

  it('recognizes only the exact owned metadata and resource port pair as certified', async () => {
    const { bundle, pixels } = fixture(RED), verified = await validateProjectBundle(bundle, nodeImages(pixels).options)
    expect(getVerifiedProjectBundle(verified)).toBe(verified)
    expect(getVerifiedProjectBundle({ project: verified.project, resources: verified.resources })).toBe(verified)
    expect(getVerifiedProjectBundle(bundle)).toBeUndefined()
    expect(getVerifiedProjectBundle({ project: cloneJson(verified.project), resources: verified.resources })).toBeUndefined()
    expect(getVerifiedProjectBundle({ project: verified.project, resources: { read: verified.resources.read } })).toBeUndefined()
    expect(getVerifiedProjectBundle({ ...verified, validated: true })).toBeUndefined()
  })

  it('reuses only the owned byte closure for a fully rechecked metadata derivation', async () => {
    const { bundle, pixels } = fixture(RED), verified = await validateProjectBundle(bundle, nodeImages(pixels).options)
    const candidateProject = cloneJson(verified.project)
    candidateProject.document.title = 'derived title'
    candidateProject.assets = verified.project.assets
    candidateProject.licenses = verified.project.licenses
    candidateProject.licenseBindings = verified.project.licenseBindings
    candidateProject.authoringSources = verified.project.authoringSources
    const candidate = { project: candidateProject, resources: verified.resources }
    const derived = tryDerivedProjectBundle(candidate, verified)
    expect(derived).toBeDefined()
    expect(derived!.project.document.title).toBe('derived title')
    expect(derived!.resources).toBe(verified.resources)
    expect(getVerifiedProjectBundle(derived!)).toBe(derived)
    expect(await derived!.resources.read(Object.keys(derived!.project.assets)[0])).toEqual(await verified.resources.read(Object.keys(verified.project.assets)[0]))
  })

  it('falls back when any proof branch, resource port, or asset mapping changes', async () => {
    const { bundle, pixels } = fixture(RED), verified = await validateProjectBundle(bundle, nodeImages(pixels).options)
    const cloneWith = (changes: Partial<ProjectData>): ProjectBundle => ({ project: { ...verified.project, ...changes }, resources: verified.resources })
    expect(tryDerivedProjectBundle(cloneWith({ assets: cloneJson(verified.project.assets) }), verified)).toBeUndefined()
    expect(tryDerivedProjectBundle(cloneWith({ licenses: cloneJson(verified.project.licenses) }), verified)).toBeUndefined()
    expect(tryDerivedProjectBundle(cloneWith({ licenseBindings: cloneJson(verified.project.licenseBindings) }), verified)).toBeUndefined()
    expect(tryDerivedProjectBundle(cloneWith({ authoringSources: cloneJson(verified.project.authoringSources) }), verified)).toBeUndefined()
    expect(tryDerivedProjectBundle({ project: verified.project, resources: { read: verified.resources.read } }, verified)).toBeUndefined()
    const redirected = cloneJson(verified.project)
    redirected.document.assets.image.sha256 = 'f'.repeat(64)
    redirected.assets = verified.project.assets
    redirected.licenses = verified.project.licenses
    redirected.licenseBindings = verified.project.licenseBindings
    redirected.authoringSources = verified.project.authoringSources
    expect(tryDerivedProjectBundle({ project: redirected, resources: verified.resources }, verified)).toBeUndefined()
  })

  it('never issues a derived certificate after cancellation', async () => {
    const { bundle, pixels } = fixture(RED), verified = await validateProjectBundle(bundle, nodeImages(pixels).options)
    const candidate = { project: { ...verified.project, document: cloneJson(verified.project.document) }, resources: verified.resources }
    expect(() => tryDerivedProjectBundle(candidate, verified, { signal: { aborted: true } })).toThrow(/取消/)
  })

  it('certifies the captured resource branches when a proxy changes later property reads', async () => {
    const { bundle, pixels } = fixture(RED), verified = await validateProjectBundle(bundle, nodeImages(pixels).options)
    const replacement = cloneJson(verified.project.assets), hash = Object.keys(replacement)[0]
    replacement[hash].sizeBytes++
    let reads = 0
    const project = new Proxy({ ...verified.project }, { get(target, key, receiver) {
      if (key === 'assets') { reads++; return replacement }
      return Reflect.get(target, key, receiver)
    } })
    const derived = tryDerivedProjectBundle({ project, resources: verified.resources }, verified)
    expect(derived).toBeDefined()
    expect(reads).toBe(0)
    expect(derived!.project.assets).toEqual(verified.project.assets)
    expect((await derived!.resources.read(hash)).length).toBe(derived!.project.assets[hash].sizeBytes)
  })

  it('publicly rechecks and decodes even an already certified bundle', async () => {
    const { bundle, pixels } = fixture(RED), double = nodeImages(pixels)
    const first = await validateProjectBundle(bundle, double.options), second = await validateProjectBundle(first, double.options)
    expect(double.decode).toHaveBeenCalledTimes(2)
    expect(second.project).toEqual(first.project); expect(second.project).not.toBe(first.project)
    expect(second.resources).not.toBe(first.resources); expect(getVerifiedProjectBundle(second)).toBe(second)
  })

  it('issues no usable certificate on missing capability, cancellation, decode or raster failure', async () => {
    const missing = fixture().bundle
    await expect(validateProjectBundle(missing, {} as CompleteValidationOptions)).rejects.toMatchObject({ code: 'image-capability-unavailable' })
    expect(getVerifiedProjectBundle(missing)).toBeUndefined()
    for (const mode of ['cancelled-before', 'cancelled-after', 'decode-failed', 'wrong-raster'] as const) {
      const { bundle, pixels } = fixture(RED), double = nodeImages(pixels), signal = { aborted: mode === 'cancelled-before' }
      double.images.decode = async () => {
        if (mode === 'decode-failed') throw new Error('actual decode failure')
        if (mode === 'cancelled-after') signal.aborted = true
        return { width: mode === 'wrong-raster' ? 2 : 1, height: 1, rgba: new Uint8ClampedArray(RED) }
      }
      await expect(validateProjectBundle(bundle, { ...double.options, signal })).rejects.toThrow()
      expect(getVerifiedProjectBundle(bundle)).toBeUndefined()
      // Failure must not retain a result or poison a later clean attempt.
      expect(getVerifiedProjectBundle(await validateProjectBundle(bundle, nodeImages(pixels).options))).toBeDefined()
    }
  })

  it('rejects oversized reader output before decoder work or attacker byte getters', async () => {
    const { bundle, pixels } = fixture(RED), record = Object.values(bundle.project.assets)[0], oversize = new Uint8Array(record.sizeBytes + 1), double = nodeImages(pixels)
    let getters = 0; Object.defineProperty(oversize, 'buffer', { get() { getters++; throw new Error('forged buffer getter') } })
    bundle.resources = { async read() { return oversize } }
    await expect(validateProjectBundle(bundle, double.options)).rejects.toThrow(/读取保护预算/)
    expect(getters).toBe(0); expect(double.decode).not.toHaveBeenCalled(); expect(getVerifiedProjectBundle(bundle)).toBeUndefined()
  })

  it('rejects hash-correct fixed variant bytes whose declared decoded pixels differ', async () => {
    const { bundle, bytes, pixels } = fixture(RED), variant = bitmapVariant('image', null, .5)!, outputBytes = png(BLUE), outputHash = digest(outputBytes)
    const sourceAsset = bundle.project.document.assets.image, definition = bundle.project.document.propDefinitions.definition
    bundle.project.document.assets[variant.outputAssetId] = { ...cloneJson(sourceAsset), id: variant.outputAssetId, sha256: outputHash }
    bundle.project.document.propDefinitions.outputDefinition = { ...cloneJson(definition), id: 'outputDefinition', catalogId: 'test.resource-output',
      defaultAppearance: { kind: 'image', assetId: variant.outputAssetId, tint: null, opacity: 1 } }
    bytes.set(outputHash, outputBytes); pixels.set(outputHash, new Uint8ClampedArray(BLUE))
    bundle.project = metadata(bundle.project.document, bytes); bundle.project.appearance.variants[variant.id] = variant; bundle.resources = createMemoryResources(bytes)
    const double = nodeImages(pixels)
    await expect(validateProjectBundle(bundle, double.options)).rejects.toThrow(/固定派生真实像素/)
    expect(double.transform).toHaveBeenCalledTimes(1); expect(getVerifiedProjectBundle(bundle)).toBeUndefined()
  })

  it('preserves historical document identity and merges tombstones without mutating the input', async () => {
    const { archive } = archiveFixture(), historical = archive.snapshots[0].bundle.project
    historical.historyIdentity.propTokens.retired = 'historical-retired-birth'; refreshSnapshotHash(archive)
    const before = cloneJson(archive.current.project), snapshotBefore = cloneJson(historical)
    const result = await validateHistoryArchive(archive, nodeImages().options)
    expect(result.current.project.historyIdentity.propTokens.retired).toBe('historical-retired-birth')
    expect(result.snapshots[0].ownerSceneId).toBe('resource-owner')
    expect(result.snapshots[0].bundle.project.document).toMatchObject({ sceneId: 'historical-document', revision: 7 })
    expect(archive.current.project).toEqual(before); expect(historical).toEqual(snapshotBefore)
    expect(archive.current.project.historyIdentity.propTokens).not.toHaveProperty('retired')
    expect(getVerifiedProjectBundle(result.current)).toBeDefined()
  })

  it('rejects invalid history summaries, changed births and fixed meanings without changing either source', async () => {
    const changes: ((archive: HistoryArchive) => void)[] = [
      archive => { archive.snapshots[0].ownerSceneId = 'wrong-owner' },
      archive => { archive.snapshots[0].kind = 'imported-auto' },
      archive => { archive.snapshots[0].contentHash = 'f'.repeat(64) },
      archive => { archive.snapshots[0].sourceRevision = 8 },
      archive => { archive.snapshots[0].lineageId = 'wrong-lineage' },
      archive => { archive.snapshots.push({ ...archive.snapshots[0] }) },
      archive => { archive.snapshots[0].bundle.project.historyIdentity.propTokens.item = 'conflicting-birth'; refreshSnapshotHash(archive) },
      archive => { archive.snapshots[0].bundle.project.document.propDefinitions.definition.name = 'changed fixed meaning'; refreshSnapshotHash(archive) },
    ]
    for (const change of changes) {
      const { archive, pixels } = archiveFixture(true); change(archive)
      const before = cloneJson(archive.current.project), historical = cloneJson(archive.snapshots[0].bundle.project), double = nodeImages(pixels)
      await expect(validateHistoryArchive(archive, double.options)).rejects.toThrow()
      expect(archive.current.project).toEqual(before); expect(archive.snapshots[0].bundle.project).toEqual(historical)
      expect(getVerifiedProjectBundle(archive.current)).toBeUndefined(); expect(double.decode).not.toHaveBeenCalled()
    }
  })
})
