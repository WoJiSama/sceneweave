import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOutdoorBlankProject } from '../../../editor/v6/blank-project'
import { extendBuiltinCatalogProject } from '../../../editor/v6/themed-catalog'
import { describeCatalogItems } from '../../../catalog/content'
import oldCuration from '../../../catalog/curation-data.json'
import { listCatalogItems } from '../../../shared/library/content.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { getVerifiedProjectBundle } from '../../../shared/project/resources.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { loadBuiltinCatalog, builtinIdentityAudit } from './builtin.js'
import { CATALOG_CURATION, catalogCurationFor } from './curation.js'

// Explicit Node image-port double: real Chrome checks separately decode all 57 images.
const validation: CompleteValidationOptions = { images: {
  async decode(_bytes, record) { return { width: record.pixelWidth, height: record.pixelHeight, rgba: new Uint8ClampedArray(record.pixelWidth * record.pixelHeight * 4) } },
  async transform() { throw new Error('No builtin variants') }, async encodePng() { throw new Error('Provider does not encode') },
} }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(await readFile(resolve('public', path.replace(/^\//, ''))))))
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer)
    return { width: view.getUint32(16), height: view.getUint32(20), close() {} }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('M2-0e standalone native-v1 immutable builtin fixed content', () => {
  it('has no runtime path to editor factories or legacy catalog code', async () => {
    const pending = [resolve('src/platform/browser/content/index.ts')], visited = new Set<string>()
    while (pending.length) {
      const path = pending.pop()!
      if (visited.has(path)) continue
      visited.add(path)
      expect(path).not.toContain('/src/editor/'); expect(path).not.toMatch(/\/src\/catalog\/.*\.ts$/)
      const source = await readFile(path, 'utf8')
      for (const match of source.matchAll(/(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('.') || match[1].endsWith('.json')) continue
        const dependency = resolve(path, '..', match[1].replace(/\.js$/, '.ts'))
        pending.push(dependency.endsWith('.ts') ? dependency : `${dependency}.ts`)
      }
    }
    expect(visited.size).toBeGreaterThan(10)
  })

  it('recomputes all 62 exact old keys, full metadata, 57 actual bytes and six refinement references without changing fixed defaults', async () => {
    const old = await extendBuiltinCatalogProject(await createOutdoorBlankProject({ title: 'Old independent provider', widthMm: 20_000, heightMm: 20_000, preset: 'investigation' }))
    const native = await loadBuiltinCatalog(validation), oldItems = describeCatalogItems(old), newItems = listCatalogItems(native)
    expect(getVerifiedProjectBundle(native)).toBe(native)
    expect(builtinIdentityAudit(native)).toEqual({ items: 62, images: 57, curations: 62, refines: 6 })
    expect(new Map(newItems.map(item => [item.identity.key, item]))).toEqual(new Map(oldItems.map(item => [item.identity.key, item])))
    for (const collection of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) expect(native.project.document[collection]).toEqual(old.document[collection])
    for (const collection of ['sources', 'variants', 'prefabAppearanceTemplates'] as const) expect(native.project.appearance[collection]).toEqual(old.appearance[collection])
    expect(native.project.licenses).toEqual(old.licenses); expect(native.project.licenseBindings).toEqual(old.licenseBindings)
    expect(native.project.authoringSources).toEqual({}); expect(native.project.document.sceneId).toBe('sceneweave-builtin-content-v1')
    for (const [hash, record] of Object.entries(old.assets)) {
      const bytes = await native.resources.read(hash)
      expect(bytes).toEqual(new Uint8Array(await record.blob.arrayBuffer())); expect(sha256Bytes(bytes)).toBe(hash)
      bytes[0] ^= 1
      expect(sha256Bytes(await native.resources.read(hash))).toBe(hash)
    }
    const byKey = new Map(newItems.map(item => [item.identity.key, item]))
    for (const record of oldCuration.records) {
      expect(CATALOG_CURATION.get(record.key)).toEqual(record)
      expect(catalogCurationFor(byKey.get(record.key)!)).toEqual(record)
      if (record.refines) {
        const refined = byKey.get(record.key)!, source = byKey.get(record.refines)!
        expect(refined.identity.catalogId).not.toBe(source.identity.catalogId)
        expect(refined.identity.namespace).toBe(source.identity.namespace)
        const changed = structuredClone(refined); changed.identity.contentHash = 'a'.repeat(64); changed.identity.key = JSON.stringify([1, changed.identity.namespace, changed.identity.kind, changed.identity.catalogId, changed.identity.fixedVersion, changed.identity.contentHash])
        expect(catalogCurationFor(changed)).toBeUndefined()
      }
    }
  })

  it('rejects a failed fetch and altered actual source bytes instead of publishing a partial provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await expect(loadBuiltinCatalog(validation)).rejects.toThrow('404')
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const bytes = new Uint8Array(await readFile(resolve('public', path.replace(/^\//, '')))); bytes[bytes.length - 1] ^= 1
      return new Response(bytes)
    }))
    await expect(loadBuiltinCatalog(validation)).rejects.toThrow(/SHA256/)
  })

  it('handles structural cancellation without passing a foreign AbortSignal to fetch and cancels oversized response streams', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(loadBuiltinCatalog({ ...validation, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
    const cancelled = vi.fn(), oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1)) }, cancel: cancelled })
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (_path: string, options: RequestInit) => {
      expect(options.signal).toBeInstanceOf(AbortSignal)
      if (++requests === 1) return new Response(oversized)
      return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    }))
    await expect(loadBuiltinCatalog({ ...validation, signal: { aborted: false } })).rejects.toThrow('超过固定字节预算')
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
