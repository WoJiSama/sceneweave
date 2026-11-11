import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { initializeCanonicalSvgRasterizer } from '../ai/svg-raster.js'
import { createBrowserSvgPort } from '../ai/svg-port.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { transformRgba } from '../../../shared/project/pixels.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { loadLibraryCapsule } from '../../../shared/library/content.js'
import { ProjectRepository } from '../storage/repository.js'
import { createImageImportProject, IMAGE_IMPORT_IDS, type ImageImportProjectInput } from './image-import-project.js'
import { materializeImageImportSvg } from './image-import-vector.js'
import { prepareImageImportItemVariant, prepareImageImportMaterialVariant, readImageImportItemSvg } from './image-import-item.js'

const redSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="#CC2222"/></svg>'
const blueSvg = redSvg.replace('#CC2222', '#2244CC')
const capabilities: CompleteValidationOptions = { images: {
  async decode(bytes) { return decodeCanonicalPng(bytes) },
  async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
  async encodePng(image) { return encodeCanonicalPng(image) },
}, svg: createBrowserSvgPort() }
beforeAll(async () => { await initializeCanonicalSvgRasterizer(new Uint8Array(readFileSync(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm')))) })
function input(): ImageImportProjectInput {
  const vector = (x: number, y: number, width: number, height: number, sourceSvg: string) => ({ sourceSvg, targetLongEdgePx: 32,
    pngBytes: new Uint8Array([1, 2, 3]), pixelWidth: 999, pixelHeight: 999, boundsPx: { x, y, width, height } })
  return { title: '矢量图片工程', calibration: { pixelWidth: 100, pixelHeight: 100, first: { x: 0, y: 0 }, second: { x: 10, y: 0 }, distanceMm: 1000 },
    roomPointsPx: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], floor: vector(0, 0, 100, 100, blueSvg),
    layers: [{ ...vector(30, 30, 20, 20, redSvg), id: 'vector-piano', name: '矢量钢琴', renderLayer: 'object', blocksMovement: true }],
    licenseText: 'Vector fixture licence. Embedding and modification allowed.', attribution: 'Original vector test fixture', sceneId: `vector-import-${crypto.randomUUID()}`, now: '2026-11-10T00:00:00.000Z' }
}

describe('persistent canonical vectors in image import', () => {
  it('replaces untrusted PNG input, preserves actual SVG/processor bytes and survives file and IndexedDB cold reads', async () => {
    const project = await createImageImportProject(input(), undefined, capabilities), definitionId = project.document.props['vector-piano'].definitionRef!.id
    const appearance = project.document.propDefinitions[definitionId].defaultAppearance
    if (appearance.kind !== 'image') throw new Error('Expected image')
    const asset = project.document.assets[appearance.assetId], proof = project.authoringSources[asset.id]
    expect(asset).toMatchObject({ pixelWidth: 32, pixelHeight: 32 })
    expect(proof).toMatchObject({ processorVersion: 2, rasterSha256: asset.sha256 })
    expect(await readImageImportItemSvg(project, definitionId)).toBe(redSvg)
    expect(sha256Bytes(await project.resources.read(proof.sourceSha256))).toBe(proof.sourceSha256)
    expect(decodeCanonicalPng(await project.resources.read(asset.sha256)).rgba.slice(0, 4)).toEqual(new Uint8ClampedArray([204, 34, 34, 255]))
    const file = await exportProject(toBundle(project), capabilities), cold = await fromBundle(await importProject(file, capabilities), capabilities)
    expect(await readImageImportItemSvg(cold, definitionId)).toBe(redSvg)
    expect(cold.authoringSources).toEqual(project.authoringSources)
    const name = `vector-image-import-storage-${crypto.randomUUID()}`
    const repository = new ProjectRepository({ name, validation: capabilities, runtime: { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-11-10T00:00:00.000Z' } } })
    try {
      await repository.save(toBundle(project), null)
      const stored = await repository.load(project.document.sceneId)
      expect(stored).not.toBeNull()
      const reopened = await fromBundle(stored!, capabilities)
      expect(await readImageImportItemSvg(reopened, definitionId)).toBe(redSvg)
      expect(await readImageImportItemSvg(reopened, IMAGE_IMPORT_IDS.floorMaterial)).toBe(blueSvg)
    } finally { repository.close(); await Dexie.delete(name) }
  }, 20000)

  it('preserves distinct exact sources even when their canonical pixels match', async () => {
    const options = input()
    options.layers.push({ ...options.layers[0], id: 'same-pixels-new-source', name: '另一份矢量', sourceSvg: redSvg.replace('<rect', '\n<rect') })
    const project = await createImageImportProject(options, undefined, capabilities)
    const ids = ['vector-piano', 'same-pixels-new-source'].map(id => project.document.props[id].definitionRef!.id)
    const assetIds = ids.map(id => { const appearance = project.document.propDefinitions[id].defaultAppearance; if (appearance.kind !== 'image') throw new Error(); return appearance.assetId })
    expect(project.document.assets[assetIds[0]].sha256).toBe(project.document.assets[assetIds[1]].sha256)
    expect(project.authoringSources[assetIds[0]].sourceSha256).not.toBe(project.authoringSources[assetIds[1]].sourceSha256)
    expect(await readImageImportItemSvg(project, ids[0])).toBe(redSvg)
    expect(await readImageImportItemSvg(project, ids[1])).toBe(redSvg.replace('<rect', '\n<rect'))
  })

  it('edits prop and wood material SVG into cold-readable fixed copies without changing their source project', async () => {
    const project = await createImageImportProject(input(), undefined, capabilities), before = canonicalJson(toBundle(project).project)
    const definitionId = project.document.props['vector-piano'].definitionRef!.id
    const entry = await prepareImageImportItemVariant(project, definitionId, { name: '蓝色矢量钢琴', widthMm: 2100, heightMm: 1800,
      footprintWidthMm: 1700, footprintHeightMm: 1500, blocksMovement: true, sourceSvg: blueSvg, targetLongEdgePx: 64 }, undefined, capabilities)
    const edited = await fromBundle(await loadLibraryCapsule(entry, capabilities), capabilities)
    expect(await readImageImportItemSvg(edited, entry.item.selector.definitionId)).toBe(blueSvg)
    expect(edited.licenses).toEqual(project.licenses)
    const prop = edited.document.propDefinitions[entry.item.selector.definitionId]
    if (prop.defaultAppearance.kind !== 'image') throw new Error()
    expect(edited.document.assets[prop.defaultAppearance.assetId]).toMatchObject({ pixelWidth: 64, pixelHeight: 64 })
    const floorEntry = await prepareImageImportMaterialVariant(project, IMAGE_IMPORT_IDS.floorMaterial,
      { name: '红色矢量地板', widthMm: 5000, heightMm: 5000, sourceSvg: redSvg, targetLongEdgePx: 64 }, undefined, capabilities)
    expect(floorEntry.item.selector.kind).toBe('material')
    const floor = await fromBundle(await loadLibraryCapsule(floorEntry, capabilities), capabilities)
    expect(await readImageImportItemSvg(floor, floorEntry.item.selector.definitionId)).toBe(redSvg)
    expect(floor.document.materials[floorEntry.item.selector.definitionId].defaultTileSizeMm).toEqual({ width: 5000, height: 5000 })
    expect(floor.licenses).toEqual(project.licenses)
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })

  it('rejects scripts, external images, excessive raster sizes and cancellation', async () => {
    await expect(materializeImageImportSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>', 32)).rejects.toThrow()
    await expect(materializeImageImportSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.com/a.png"/></svg>', 32)).rejects.toThrow()
    await expect(materializeImageImportSvg(redSvg, 8192)).rejects.toThrow('4096')
    const controller = new AbortController(); controller.abort()
    await expect(createImageImportProject(input(), controller.signal, capabilities)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('admits 63 pixel props with a vector floor and rejects 64 before preparing an unsavable library batch', async () => {
    const options = input(), pixel = await materializeImageImportSvg(redSvg, 1)
    const layer = { pngBytes: pixel.pngBytes, pixelWidth: 1, pixelHeight: 1, boundsPx: { x: 30, y: 30, width: 20, height: 20 },
      renderLayer: 'object' as const, blocksMovement: false }
    options.layers = Array.from({ length: 63 }, (_, index) => ({ ...layer, id: `item-${index}`, name: `物件${index}` }))
    const accepted = await createImageImportProject(options, undefined, capabilities)
    expect(Object.keys(accepted.document.props)).toHaveLength(63)
    expect(Object.keys(accepted.authoringSources)).toHaveLength(1)
    options.layers.push({ ...layer, id: 'item-64', name: '第64件' })
    await expect(createImageImportProject(options, undefined, capabilities)).rejects.toThrow('合计最多64项')
  }, 20000)
})
