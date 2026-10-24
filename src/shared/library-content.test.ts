import { unzipSync, unzlibSync, zlibSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { describeCatalogItems } from '../catalog/content'
import { addPropAppearanceSourceV6, bitmapVariantV6, ensureSourceAssetRootsV6 } from '../core/v6/graph'
import type { PropTemplate } from '../core/v3/types'
import { concatBytes, emptyProject, imageProject, imageRecord, outdoorProject, pixelPng, pngChunk } from '../io/v6/test-fixtures'
import type { CompleteProjectV6 } from '../io/v6/types'
import type { ProjectBundle } from './model/project.js'
import type { CompleteValidationOptions, RasterImage } from './ports/resources.js'
import { createMemoryResources } from './project/resources.js'
import { exportProject } from './project/file.js'
import { sha256Bytes } from './project/binary.js'
import { canonicalJson } from './validation/json.js'
import { adoptLibraryEntries, captureLibraryEntries, listCatalogItems, loadLibraryCapsule, prepareLibraryEntry, validateLibraryEntry } from './library/content.js'
import { LIBRARY_LIMITS } from './library/types.js'

/** Intentional unit adapter: PNG bytes/CRC/hash are real; Chrome separately verifies native Canvas. */
const validation: CompleteValidationOptions = { images: {
  async decode(bytes): Promise<RasterImage> {
    const chunks: Uint8Array[] = []
    for (let offset = 8; offset < bytes.length;) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0)
      if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
      offset += length + 12
    }
    return { width: 1, height: 1, rgba: new Uint8ClampedArray(unzlibSync(concatBytes(chunks)).slice(1)) }
  },
  async transform(image, parameters) {
    const channels = parameters.tint ? [1, 3, 5].map(index => parseInt(parameters.tint!.slice(index, index + 2), 16) / 255) : [1, 1, 1]
    return { ...image, rgba: new Uint8ClampedArray(Array.from(image.rgba, (value, index) => index % 4 === 3 ? value : value * channels[index % 4] * parameters.brightness)) }
  },
  async encodePng() { throw new Error('validation never encodes') },
} }
async function unified(input: CompleteProjectV6): Promise<ProjectBundle> {
  const bytes = new Map<string, Uint8Array>()
  for (const [hash, asset] of Object.entries(input.assets)) bytes.set(hash, new Uint8Array(await asset.blob.arrayBuffer()))
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1,
    document: { ...structuredClone(input.document), format: 'sceneweave-scene', schemaVersion: 1 },
    historyIdentity: { ...structuredClone(input.historyIdentity), version: 1 }, appearance: structuredClone(input.appearance), authoringSources: {},
    assets: Object.fromEntries(Object.entries(input.assets).map(([hash, { blob: _blob, ...record }]) => [hash, record])),
    licenses: structuredClone(input.licenses), licenseBindings: structuredClone(input.licenseBindings),
  }, resources: createMemoryResources(bytes) }
}
async function privatePrefabProject(members = 1): Promise<CompleteProjectV6> {
  const project = await outdoorProject(1), original = project.document.props['scatter-item-0'], originalDefinition = project.document.propDefinitions['scatter-definition']
  const template: PropTemplate = { definitionRef: { id: originalDefinition.id, version: 1 }, appearance: structuredClone(original.appearance), visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 },
    positionMm: { x: 0, y: 0 }, rotationDeg: 0, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: -100, y: -100 }, blocksMovement: false, blocksSight: false, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
  const definition = { id: 'private-prefab', catalogId: 'test.private-prefab', version: 1, licenseRef: originalDefinition.licenseRef, origin: originalDefinition.origin, name: '私密组合', tags: ['固定标签'], members: [] as { key: string; propTemplate: PropTemplate }[] }
  const fixedMembers: CompleteProjectV6['appearance']['prefabAppearanceTemplates'][string]['members'] = {}
  for (let index = 0; index < members; index++) {
    const prop = structuredClone(template), key = `member-${index}`
    if (members > 1) {
      const id = `distinct-prop-${index}`
      project.document.propDefinitions[id] = { ...structuredClone(originalDefinition), id, catalogId: id }
      project.licenseBindings.push({ ...project.licenseBindings[0], subjectId: id }); prop.definitionRef = { id, version: 1 }
    }
    const ancestor = addPropAppearanceSourceV6(project.appearance, prop), child = addPropAppearanceSourceV6(project.appearance, { ...prop, appearance: { ...prop.appearance, opacity: .7 } }, ancestor)
    definition.members.push({ key, propTemplate: prop }); fixedMembers[key] = { sourceId: child, adjustments: [{ id: `opacity-${index}`, kind: 'opacity', value: .5, enabled: true }] }
  }
  project.document.prefabDefinitions[definition.id] = definition
  project.appearance.prefabAppearanceTemplates[definition.id] = { definitionRef: { id: definition.id, version: 1 }, visibility: 'gm', members: fixedMembers }
  project.licenseBindings.push({ ...project.licenseBindings[0], subjectKind: 'prefabDefinition', subjectId: definition.id })
  return project
}

describe('M2-0e complete-v1 neutral library capsules', () => {
  it('preserves old algorithm1 item/key for prop, material and private prefab; incidental scene metadata is excluded', async () => {
    for (const old of [await outdoorProject(1), await imageProject(), await privatePrefabProject()]) {
      const bundle = await unified(old), items = listCatalogItems(bundle)
      expect(items).toEqual(describeCatalogItems(old))
      bundle.project.document.title = '场景秘密'; bundle.project.document.revision++
      for (const item of items) {
        const entry = await prepareLibraryEntry(bundle, item.selector, validation), loaded = await loadLibraryCapsule(entry, validation)
        expect(entry.item).toEqual(item)
        expect(loaded.project).toMatchObject({ format: 'sceneweave-complete-project', schemaVersion: 1, authoringSources: {},
          document: { format: 'sceneweave-scene', schemaVersion: 1, title: '素材目录载体', revision: 0, props: {}, rooms: {}, notes: {} },
          historyIdentity: { version: 1, propTokens: {}, prefabTokens: {}, outdoorTokens: {} } })
        expect(loaded.project.appearance.propSources).toEqual({}); expect(loaded.project.appearance.layerAdjustments).toEqual({})
        expect(new TextDecoder().decode(unzipSync(entry.capsule)['scene.json'])).not.toContain('场景秘密')
        expect(await validateLibraryEntry(entry, validation)).toEqual(entry)
      }
    }
  })

  it('preserves private template visibility, complete source ancestors and append-only adoption identity', async () => {
    const source = await unified(await privatePrefabProject()), entry = await prepareLibraryEntry(source, { kind: 'prefab', definitionId: 'private-prefab' }, validation)
    const loaded = await loadLibraryCapsule(entry, validation), target = await unified(emptyProject()), before = canonicalJson(target.project)
    expect(entry.item.visibility).toBe('gm'); expect(Object.keys(loaded.project.appearance.sources)).toHaveLength(2)
    expect(loaded.project.appearance.prefabAppearanceTemplates).toEqual(source.project.appearance.prefabAppearanceTemplates)
    const adopted = await adoptLibraryEntries(target, [entry], validation)
    expect(canonicalJson(target.project)).toBe(before)
    expect(adopted.bundle.project.document.props).toEqual(target.project.document.props)
    expect(adopted.bundle.project.historyIdentity).toEqual(target.project.historyIdentity)
    expect(adopted.bundle.project.document.revision).toBe(target.project.document.revision)
    expect((await adoptLibraryEntries(adopted.bundle, [entry], validation)).operationCost).toBe(0)
  })

  it('retains actual inactive variant input/output pixels, licensed bytes and fixed roots', async () => {
    let old = await imageProject()
    const inputAsset = old.document.assets['test-image'], variant = bitmapVariantV6(inputAsset.id, '#808080', 1)!, original = pixelPng()
    const png = concatBytes([original.subarray(0, 8), original.subarray(8, 33), pngChunk('IDAT', zlibSync(new Uint8Array([0, 10, 25, 40, 200]))), pngChunk('IEND', new Uint8Array())]), output = await imageRecord(png)
    old.document.assets[variant.outputAssetId] = { ...inputAsset, id: variant.outputAssetId, sha256: output.sha256 }
    old.assets[output.sha256] = output; old.appearance.variants[variant.id] = variant
    const prop = { id: 'derived-prop', catalogId: 'test.derived-prop', version: 1, licenseRef: inputAsset.licenseRef, origin: inputAsset.origin, name: '固定派生', tags: [], defaultAppearance: { kind: 'image' as const, assetId: variant.outputAssetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, defaultFootprintMm: { width: 1000, height: 1000 }, defaultFootprintOffsetMm: { x: -500, y: -500 }, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object' as const, defaultShadowClass: 'none' as const }
    old.document.propDefinitions[prop.id] = prop
    old.licenseBindings.push({ ...old.licenseBindings[0], subjectId: variant.outputAssetId }, { ...old.licenseBindings[0], subjectKind: 'propDefinition', subjectId: prop.id })
    old = { ...old, ...ensureSourceAssetRootsV6(old) }
    const bundle = await unified(old), entry = await prepareLibraryEntry(bundle, { kind: 'prop', definitionId: prop.id }, validation), loaded = await loadLibraryCapsule(entry, validation)
    expect(entry.item).toEqual(describeCatalogItems(old).find(item => item.selector.definitionId === prop.id))
    expect(loaded.project.appearance.variants[variant.id]).toEqual(variant)
    expect(Object.keys(loaded.project.assets)).toHaveLength(2)
    expect(loaded.project.document.materials['test-material']).toEqual(old.document.materials['test-material'])
    expect(await loaded.resources.read(output.sha256)).toEqual(png)
    const badPixels = { ...validation, images: { ...validation.images, async transform(image: RasterImage) { return image } } }
    await expect(loadLibraryCapsule(entry, badPixels)).rejects.toThrow(/像素/)
  })

  it('rejects forged metadata, accessors, corrupt bytes and a valid whole map disguised as a capsule', async () => {
    const bundle = await unified(await outdoorProject(1)), entry = await prepareLibraryEntry(bundle, { kind: 'prop', definitionId: 'scatter-definition' }, validation)
    await expect(loadLibraryCapsule({ ...entry, item: { ...entry.item, name: '伪造' } }, validation)).rejects.toThrow(/不一致/)
    await expect(loadLibraryCapsule({ ...entry, unsupported: true } as never, validation)).rejects.toThrow(/字段/)
    await expect(loadLibraryCapsule({ ...entry, capsule: new Uint8Array([0]) }, validation)).rejects.toThrow(/摘要/)
    const capsule = await exportProject(bundle, validation)
    await expect(loadLibraryCapsule({ ...entry, capsule, capsuleSha256: sha256Bytes(capsule) }, validation)).rejects.toThrow(/场景信息/)
    const getter = vi.fn(), malicious = { ...entry, item: { ...entry.item } }
    Object.defineProperty(malicious.item, 'name', { get: getter, enumerable: true })
    await expect(loadLibraryCapsule(malicious, validation)).rejects.toThrow(/访问器/); expect(getter).not.toHaveBeenCalled()
  })

  it('captures caller bytes and item before awaits, and honors cancellation', async () => {
    const bundle = await unified(await outdoorProject(1)), entry = await prepareLibraryEntry(bundle, { kind: 'prop', definitionId: 'scatter-definition' }, validation)
    const loading = loadLibraryCapsule(entry, validation)
    entry.capsule.fill(0); entry.item.name = 'later mutation'
    expect((await loading).project.document.propDefinitions['scatter-definition'].name).not.toBe('later mutation')
    await expect(prepareLibraryEntry(bundle, entry.item.selector, { ...validation, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('checks aggregate capsule bytes before copying or reading any item metadata', () => {
    const capsule = new Uint8Array(LIBRARY_LIMITS.capsuleBytes), getter = vi.fn()
    const entry = Object.defineProperty({ capsule, capsuleSha256: '0'.repeat(64) }, 'item', { enumerable: true, get: getter })
    expect(() => captureLibraryEntries(Array.from({ length: 5 }, () => entry) as never)).toThrow(/联合字节/)
    expect(getter).not.toHaveBeenCalled()
  })

  it('rejects logical conflicts and actual expanded adoption above256 without mutating current', async () => {
    const source = await unified(await outdoorProject(1)), entry = await prepareLibraryEntry(source, { kind: 'prop', definitionId: 'scatter-definition' }, validation)
    source.project.document.propDefinitions['scatter-definition'].name = 'same identity different content'
    const before = canonicalJson(source.project)
    await expect(adoptLibraryEntries(source, [entry], validation)).rejects.toThrow(/逻辑/)
    expect(canonicalJson(source.project)).toBe(before)
    const large = await prepareLibraryEntry(await unified(await privatePrefabProject(85)), { kind: 'prefab', definitionId: 'private-prefab' }, validation)
    const target = await unified(emptyProject()), targetBefore = canonicalJson(target.project)
    await expect(adoptLibraryEntries(target, [large], validation)).rejects.toThrow(/超过256/)
    expect(canonicalJson(target.project)).toBe(targetBefore)
  })
})
