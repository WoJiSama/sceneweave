import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { createCompositionContent } from '../appearance/graph.js'
import { runtime } from '../../application/workspace/test-fixtures.js'
import type { CatalogSelector, PreparedLibraryEntry } from './types.js'
import type { CompleteValidationOptions } from '../ports/resources.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../project/png-rgba.js'
import { transformRgba } from '../project/pixels.js'
import { projectResourceHashes } from '../project/source-resources.js'
import { canonicalJson } from '../validation/json.js'
import { initializeCanonicalSvgRasterizer } from '../../platform/browser/ai/svg-raster.js'
import { createBrowserSvgPort } from '../../platform/browser/ai/svg-port.js'
import { loadLibraryCapsule, prepareLibraryEntries } from './content.js'

beforeAll(async () => { await initializeCanonicalSvgRasterizer(new Uint8Array(readFileSync(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm')))) })
function capabilities(): CompleteValidationOptions {
  return { images: {
    async decode(bytes) { return decodeCanonicalPng(bytes) },
    async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
    async encodePng(image) { return encodeCanonicalPng(image) },
  }, svg: createBrowserSvgPort() }
}
function fixture() {
  const source = svgProjectFixture(), project = source.bundle.project, asset = project.document.assets.image
  project.document.materials.material = { id: 'material', catalogId: 'test.svg-material', version: 1, name: 'SVG floor', tags: ['test'],
    licenseRef: asset.licenseRef, origin: { ...asset.origin }, textureAssetId: 'image', defaultTileSizeMm: { width: 200, height: 200 }, applicableSurfaces: ['room'] }
  project.licenseBindings.push({ ...project.licenseBindings.find(binding => binding.subjectKind === 'asset')!, subjectKind: 'material', subjectId: 'material' })
  Object.assign(project, createCompositionContent(project.document, runtime))
  const selectors: CatalogSelector[] = [{ kind: 'prop', definitionId: 'definition' }, { kind: 'material', definitionId: 'material' }]
  return { ...source, selectors }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

describe('one-source complete library batch preparation', () => {
  it('fully captures and validates one SVG source once while each prop and material capsule is independently pixel-verified', async () => {
    const { bundle, selectors, bytes } = fixture(), reads = new Map<string, number>(), validation = capabilities()
    const rasterize = vi.spyOn(validation.svg!, 'rasterize')
    bundle.resources = { async read(hash) { reads.set(hash, (reads.get(hash) ?? 0) + 1); const value = bytes.get(hash); if (!value) throw new Error('missing fixture resource'); return value.slice() } }
    const entries = await prepareLibraryEntries(bundle, selectors, validation)
    expect(entries.map(entry => entry.item.selector)).toEqual(selectors)
    expect([...reads.keys()].sort()).toEqual(projectResourceHashes(bundle.project).sort())
    expect([...reads.values()]).toEqual([...reads.values()].map(() => 1))
    // One full source SVG check plus a separate full SVG check for each neutral export.
    expect(rasterize).toHaveBeenCalledTimes(3)
    for (const entry of entries) {
      const cold = await loadLibraryCapsule(entry, capabilities())
      expect(cold.project.document.sceneId).toBe('sceneweave-catalog-capsule-v1')
      expect(cold.project.document.props).toEqual({})
      expect(cold.project.authoringSources).toEqual(bundle.project.authoringSources)
      expect(cold.project.licenses).toEqual(bundle.project.licenses)
      for (const hash of projectResourceHashes(cold.project)) expect(await cold.resources.read(hash)).toEqual(bytes.get(hash))
    }
  })

  it('isolates in-flight source and selector metadata while rechecking changed metadata and actual bytes on the next call', async () => {
    const { bundle, selectors, bytes } = fixture(), entered = deferred(), release = deferred()
    let first = true
    bundle.resources = { async read(hash) { if (first) { first = false; entered.resolve(); await release.promise } const data = bytes.get(hash); if (!data) throw new Error('missing fixture resource'); return data.slice() } }
    const pending = prepareLibraryEntries(bundle, selectors, capabilities())
    await entered.promise
    bundle.project.document.propDefinitions.definition.name = 'Caller changed during await'
    selectors[0].definitionId = 'missing-after-capture'
    release.resolve()
    const entries = await pending
    expect(entries[0].item.name).toBe('SVG fixture')
    expect(entries[0].item.selector.definitionId).toBe('definition')
    selectors[0].definitionId = 'definition'
    const changed = await prepareLibraryEntries(bundle, selectors, capabilities())
    expect(changed[0].item.name).toBe('Caller changed during await')
    expect(changed[0].item.identity.key).not.toBe(entries[0].item.identity.key)
    const sourceHash = bundle.project.authoringSources.image.sourceSha256, original = bytes.get(sourceHash)!
    const corrupt = original.slice(); corrupt[corrupt.length - 2] ^= 1; bytes.set(sourceHash, corrupt)
    await expect(prepareLibraryEntries(bundle, selectors, capabilities())).rejects.toThrow()
    bytes.set(sourceHash, original)
    const pngHash = bundle.project.document.assets.image.sha256, png = bytes.get(pngHash)!.slice(); png[png.length - 1] ^= 1; bytes.set(pngHash, png)
    await expect(prepareLibraryEntries(bundle, selectors, capabilities())).rejects.toThrow(/SHA256|字节/)
    expect(entries).toHaveLength(2)
  })

  it('rejects unsafe selector arrays and accessors before reading any resource', async () => {
    const { bundle, selectors } = fixture(), read = vi.fn(bundle.resources.read)
    bundle.resources = { read }
    const getter = vi.fn(() => selectors[0]), sparse = new Array<CatalogSelector>(1), indexed = [selectors[0]]
    Object.defineProperty(indexed, '0', { enumerable: true, get: getter })
    const extra = Object.assign([selectors[0]], { extra: true }), hidden = [selectors[0]], symbolic = [selectors[0]]
    Object.defineProperty(hidden, 'hidden', { value: true }); Object.defineProperty(symbolic, Symbol('hidden'), { value: true })
    const selectorGetter = { kind: 'prop', get definitionId() { getter(); return 'definition' } } as CatalogSelector
    for (const invalid of [[], new Array(65).fill(selectors[0]), sparse, indexed, extra, hidden, symbolic, [selectorGetter]]) {
      await expect(prepareLibraryEntries(bundle, invalid, capabilities())).rejects.toThrow()
    }
    expect(getter).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('returns no partial array when cancellation happens during the second actual capsule pixel check', async () => {
    const { bundle, selectors } = fixture(), controller = new AbortController(), validation = capabilities(), original = validation.svg!.rasterize
    let checks = 0, published: PreparedLibraryEntry[] | undefined
    validation.svg!.rasterize = async (...args) => {
      const result = await original(...args)
      if (++checks === 3) controller.abort()
      return result
    }
    await expect(prepareLibraryEntries(bundle, selectors, { ...validation, signal: controller.signal }).then(result => { published = result })).rejects.toMatchObject({ name: 'AbortError' })
    expect(checks).toBe(3)
    expect(published).toBeUndefined()
    expect(canonicalJson(bundle.project)).not.toContain('素材目录载体')
  })
})
