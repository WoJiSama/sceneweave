import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { outdoorProject } from '../../../io/v6/test-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { LibraryRepository } from '../library/repository.js'
import { installSavedImageImportItems } from './image-import-library.js'
import { artworkValidation } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { initializeCanonicalSvgRasterizer } from '../ai/svg-raster.js'
import { createBrowserSvgPort } from '../ai/svg-port.js'
import { ProjectRepository } from '../storage/repository.js'
import { createImageImportProject } from './image-import-project.js'
import { toBundle } from '../../../application/workspace/project.js'
import { loadLibraryCapsule } from '../../../shared/library/content.js'

const validation: CompleteValidationOptions = { images: {
  async decode() { throw new Error('Symbol fixture must not decode') },
  async transform() { throw new Error('Library must not transform') }, async encodePng() { throw new Error('Library must not encode') },
} }
const repositories: LibraryRepository[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const repository of repositories.splice(0)) { repository.close(); await Dexie.delete(repository.database.name) }
})

async function fixture() {
  const runtime = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-11-10T00:00:00.000Z' } }
  const source = await outdoorProject(1), document = toCurrentSceneDocument({ ...structuredClone(source.document), format: 'sceneweave-scene', schemaVersion: 1 })
  for (const prop of Object.values(document.props)) prop.definitionRef = { id: 'scatter-definition', version: 1 }
  document.presetSnapshot.presetId = 'image-import-manual'
  const content = createCompositionContent(document, runtime)
  const bundle: ProjectBundle = { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {},
    licenses: source.licenses, licenseBindings: source.licenseBindings, authoringSources: {} }, resources: createMemoryResources({}) }
  const library = new LibraryRepository({ name: `image-import-library-test-${crypto.randomUUID()}`, runtime, validation })
  repositories.push(library)
  const projects = { load: vi.fn(async () => bundle as ProjectBundle | null) }
  return { stores: { projects, library, validation }, sceneId: document.sceneId, propId: Object.keys(document.props)[0] }
}

describe('adopted image items in the native personal library', () => {
  it('atomically installs a saved vector floor with two props and cold-reuses all three entries on retry', async () => {
    await initializeCanonicalSvgRasterizer(new Uint8Array(readFileSync(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm'))))
    const capabilities = { ...artworkValidation(), svg: createBrowserSvgPort() }
    const runtime = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-11-10T00:00:00.000Z' } }
    const raster = (x: number, y: number, width: number, height: number, color: string) => ({ pngBytes: new Uint8Array(), pixelWidth: 1, pixelHeight: 1,
      boundsPx: { x, y, width, height }, targetLongEdgePx: 32,
      sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="${color}"/></svg>` })
    const project = await createImageImportProject({ title: '矢量地板与家具自动入库',
      calibration: { pixelWidth: 100, pixelHeight: 100, first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, distanceMm: 10000 },
      roomPointsPx: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }],
      floor: raster(0, 0, 100, 100, '#806040'),
      layers: [{ ...raster(20, 20, 20, 20, '#CC2222'), id: 'piano', name: '钢琴', renderLayer: 'object', blocksMovement: true },
        { ...raster(55, 55, 20, 20, '#2244CC'), id: 'rug', name: '地毯', renderLayer: 'ground', blocksMovement: false }],
      licenseText: 'Original vector test fixture. Embedding and modification allowed.', attribution: 'Original vector test author' }, undefined, capabilities)
    const projectName = `image-import-vector-library-source-${crypto.randomUUID()}`
    const projects = new ProjectRepository({ name: projectName, runtime, validation: capabilities })
    const library = new LibraryRepository({ name: `image-import-vector-library-${crypto.randomUUID()}`, runtime, validation: capabilities })
    repositories.push(library)
    try {
      await projects.save(toBundle(project), null)
      const commit = vi.spyOn(library, 'commit'), stores = { projects, library, validation: capabilities }
      const first = await installSavedImageImportItems(project.document.sceneId, ['piano', 'rug'], undefined, stores)
      expect(first).toMatchObject({ savedCount: 3, existingCount: 0 })
      expect(commit).toHaveBeenCalledTimes(1)
      expect(commit.mock.calls[0][1].put).toHaveLength(3)
      const installed = await library.read()
      expect(installed.entries.map(row => row.item.selector.kind).sort()).toEqual(['material', 'prop', 'prop'])
      for (const key of first.entryKeys) {
        const capsule = await loadLibraryCapsule(await library.load(key), capabilities)
        expect(Object.keys(capsule.project.authoringSources)).toHaveLength(1)
        expect(capsule.project.licenses).toEqual(project.licenses)
      }
      const retried = await installSavedImageImportItems(project.document.sceneId, ['piano', 'rug'], undefined, stores)
      expect(retried).toEqual({ savedCount: 0, existingCount: 3, entryKeys: first.entryKeys })
      expect(commit).toHaveBeenCalledTimes(1)
      expect((await library.read()).revision).toBe(installed.revision)
    } finally { projects.close(); await Dexie.delete(projectName) }
  }, 20000)

  it('installs once, cold-reads fixed capsules, and preserves personal edits on retry', async () => {
    const { stores, sceneId, propId } = await fixture()
    const first = await installSavedImageImportItems(sceneId, [propId], undefined, stores)
    expect(first).toMatchObject({ savedCount: 1, existingCount: 0 })
    const key = first.entryKeys[0], before = await stores.library.read()
    await stores.library.commit(before.revision, { organization: [{ key, value: { tags: ['图片拆解'], colors: ['蓝'], favorite: true } }] })
    const edited = await stores.library.read()
    const again = await installSavedImageImportItems(sceneId, [propId], undefined, stores)
    expect(again).toEqual({ savedCount: 0, existingCount: 1, entryKeys: [key] })
    const after = await stores.library.read()
    expect(after.revision).toBe(edited.revision)
    expect(after.organizations[key]).toEqual({ tags: ['图片拆解'], colors: ['蓝'], favorite: true })
    expect((await stores.library.load(key)).item.identity.key).toBe(key)
  })

  it('keeps a saved project recoverable when installation fails and succeeds on explicit retry', async () => {
    const { stores, sceneId, propId } = await fixture()
    const commit = vi.spyOn(stores.library, 'commit').mockRejectedValueOnce(new Error('quota fixture'))
    await expect(installSavedImageImportItems(sceneId, [propId], undefined, stores)).rejects.toThrow('quota fixture')
    expect((await stores.library.read()).entries).toHaveLength(0)
    expect(await stores.projects.load()).not.toBeNull()
    commit.mockRestore()
    await expect(installSavedImageImportItems(sceneId, [propId], undefined, stores)).resolves.toMatchObject({ savedCount: 1, existingCount: 0 })
  })

  it('requires a saved project and rejects cancellation before library mutation', async () => {
    const { stores, sceneId, propId } = await fixture()
    stores.projects.load.mockResolvedValueOnce(null)
    await expect(installSavedImageImportItems(sceneId, [propId], undefined, stores)).rejects.toThrow('先采用并保存')
    expect((await stores.library.read()).entries).toHaveLength(0)
    const controller = new AbortController(); controller.abort()
    await expect(installSavedImageImportItems(sceneId, [propId], controller.signal, stores)).rejects.toMatchObject({ name: 'AbortError' })
    expect((await stores.library.read()).entries).toHaveLength(0)
  })
})
