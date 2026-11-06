import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { canonicalProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { PROJECT_DATA_LIMITS, validateProjectData } from '../../../shared/project/validate.js'
import { ProjectRepository, ProjectConflictError } from './repository.js'
import { checkedContentBlock, materializeProjectContent, partitionProjectContent } from './content-blocks.js'

const opened: ProjectRepository[] = []
afterEach(async () => { for (const repo of opened.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) } })
const repository = () => { const repo = new ProjectRepository({ name: `content-blocks-${crypto.randomUUID()}`, runtime, validation }); opened.push(repo); return repo }
const raw = <T>(repo: ProjectRepository, table: string, key: IDBValidKey): Promise<T> => new Promise((resolve, reject) => {
  const tx = repo.database.backendDB().transaction(table), request = tx.objectStore(table).get(key)
  request.onsuccess = () => resolve(request.result as T); request.onerror = () => reject(request.error)
})
function detailed() {
  const source = fixture(), scene = source.project.document
  for (let index = 0; index < 150; index++) {
    const id = `detail-${index}`
    scene.props[id] = { ...structuredClone(scene.props.item), id, positionMm: { x: 1000 + index % 15 * 1000, y: 1000 + Math.floor(index / 15) * 1000 } }
    scene.entityLayers[id] = scene.entityLayers.item
  }
  Object.assign(source.project, createCompositionContent(scene, runtime))
  return source
}

describe('immutable complete project content blocks', () => {
  it('reconstructs exact actual content in arbitrary block order and rejects missing/corrupt/duplicate fields', async () => {
    const source = detailed().project, partition = partitionProjectContent(source), blocks = new Map(partition.blocks.reverse().map(row => [row.sha256, row]))
    expect(canonicalProjectCoordinates(await materializeProjectContent(partition.manifest, async hash => blocks.get(hash)))).toBe(canonicalProjectCoordinates(source))
    await expect(materializeProjectContent(partition.manifest, async () => undefined)).rejects.toThrow(/块/)
    const bad = structuredClone(partition.blocks[0]); bad.bytes[0] ^= 1
    expect(() => checkedContentBlock(bad)).toThrow(/hash/)
    const duplicate = structuredClone(partition.manifest); duplicate.fields.push(duplicate.fields[0])
    await expect(materializeProjectContent(duplicate, async hash => blocks.get(hash))).rejects.toThrow(/重复/)
  })

  it('returns independent mutable fields when their immutable block hashes are shared', async () => {
    const source = fixture().project, partition = partitionProjectContent(source)
    const blocks = new Map(partition.blocks.map(row => [row.sha256, row]))
    const restored = await materializeProjectContent(partition.manifest, async hash => blocks.get(hash))
    expect(restored.authoringSources).not.toBe(restored.document.notes)
    expect(restored.authoringSources).not.toBe(restored.assets)
    expect(restored.authoringSources).not.toBe(restored.appearance.instanceAdjustments)
    restored.authoringSources.orphan = {} as never
    expect(restored.document.notes).toEqual({})
    expect(restored.assets).toEqual({})
    expect(restored.appearance.instanceAdjustments).toEqual({})
    expect(source.authoringSources).toEqual({})
  })

  it('round-trips a valid complete project above 20MiB without shrinking its independent domain budgets', async () => {
    const source = fixture({ image: true }).project, template = source.document.propDefinitions.definition
    // A small scene with real licensed definitions isolates the previous total
    // size regression without allocating complex geometry or saving it twice.
    for (let index = 0; index < 82; index++) {
      const id = `large-license-definition-${index}`, licenseRef = `large-license-${index}`
      const text = `${String(index).padStart(4, '0')}:${'L'.repeat(PROJECT_DATA_LIMITS.licenseBytes - 5)}`
      const hash = sha256Bytes(new TextEncoder().encode(text))
      source.document.propDefinitions[id] = { ...structuredClone(template), id, catalogId: `test.large-license.${index}`, licenseRef }
      source.licenses[hash] = { sha256: hash, text }
      source.licenseBindings.push({ subjectKind: 'propDefinition', subjectId: id, licenseRef, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' })
    }
    const checked = validateProjectData(source), partition = partitionProjectContent(checked)
    expect(partition.manifest.byteLength).toBeGreaterThan(PROJECT_DATA_LIMITS.jsonBytes)
    for (const domain of [checked.document, checked.historyIdentity, checked.appearance]) {
      expect(new TextEncoder().encode(canonicalJson(domain)).length).toBeLessThan(PROJECT_DATA_LIMITS.jsonBytes)
    }
    const blocks = new Map(partition.blocks.map(row => [row.sha256, row]))
    const restored = await materializeProjectContent(partition.manifest, async hash => blocks.get(hash))
    const restoredBytes = new TextEncoder().encode(canonicalProjectCoordinates(restored))
    expect(restoredBytes.length).toBe(partition.manifest.byteLength)
    expect(sha256Bytes(restoredBytes)).toBe(partition.manifest.contentHash)
    expect(Object.keys(restored.licenses)).toHaveLength(Object.keys(checked.licenses).length)
  }, 90000)

  it('writes fewer real block bytes for a small edit and preserves full cold read, history and offline package', async () => {
    const repo = repository(), source = detailed(), sceneId = source.project.document.sceneId
    await repo.save(source, null)
    const initialBlockBytes = (await repo.database.projectContentBlocks.toArray()).reduce((sum, row) => sum + row.bytes.length, 0)
    const before = repo.database.contentBlockWrites(), cold = (await repo.load(sceneId))!
    expect(cold.project).toEqual(source.project)
    const stored = await raw<{ project: { format: string } }>(repo, 'projects', sceneId)
    expect(stored.project.format).toBe('sceneweave-project-content-blocks')
    const changed = structuredClone(source.project)
    changed.document.props['detail-17'].rotationDeg = 90; changed.document.revision++
    await repo.save({ project: changed, resources: source.resources }, 0)
    const after = repo.database.contentBlockWrites(), written = after.bytes - before.bytes
    expect((await repo.database.projectContentBlocks.toArray()).reduce((sum, row) => sum + row.bytes.length, 0) - initialBlockBytes).toBe(written)
    const fullProjectBytes = new TextEncoder().encode(canonicalProjectCoordinates(changed)).length
    const contentWriteBytes = written + after.recordBytes - before.recordBytes
    console.info('T2-h committed canonical content bytes', { fullProjectBytes, initialBlockBytes, newBlockBytes: written, manifestAndHistoryRowBytes: after.recordBytes - before.recordBytes, contentWriteBytes })
    expect(contentWriteBytes).toBeLessThan(fullProjectBytes)
    expect(written).toBeGreaterThan(0)
    expect(written).toBeLessThan(new TextEncoder().encode(canonicalProjectCoordinates(changed)).length / 3)
    const versions = await repo.listHistoryVersions(sceneId)
    expect(versions.versions).toHaveLength(2)
    expect((await repo.loadHistoryVersion(sceneId, versions.versions.find(row => row.revision === 0)!.id))!.project).toEqual(source.project)
    repo.close()
    const restored = (await repo.load(sceneId))!
    expect(restored.project).toEqual(changed)
    const bytes = await exportProject(restored, validation), imported = await importProject(bytes, validation)
    const empty = repository(); await empty.save(imported, null)
    expect((await empty.load(sceneId))!.project).toEqual(changed)
    expect((await repo.usage(sceneId)).documentBytes).toBeGreaterThan(written)
  }, 90000)

  it('keeps saved head and block closure unchanged on CAS and cancellation failure', async () => {
    const repo = repository(), source = fixture(); await repo.save(source, null)
    const hashes = await repo.database.projectContentBlocks.toArray(), initial = (await repo.load(source.project.document.sceneId))!
    const changed = structuredClone(source.project); changed.document.revision = 1; changed.document.title = 'candidate'
    await expect(repo.save({ project: changed, resources: source.resources }, 99)).rejects.toBeInstanceOf(ProjectConflictError)
    const controller = new AbortController(); controller.abort()
    await expect(repo.save({ project: changed, resources: source.resources }, 0, { signal: controller.signal })).rejects.toThrow()
    expect(await repo.database.projectContentBlocks.toArray()).toEqual(hashes)
    expect((await repo.load(source.project.document.sceneId))!.project).toEqual(initial.project)
  }, 30000)

  for (const mode of ['quota', 'late-cancel'] as const) it(`rolls back blocks already inserted before ${mode} rejects publication`, async () => {
    const repo = repository(), source = fixture(), controller = new AbortController()
    let fail = false
    repo.database.use({ stack: 'dbcore', name: `block-failure-${mode}`, level: .5, create: down => ({ ...down, table: name => {
      const table = down.table(name)
      if (name !== 'projects') return table
      return { ...table, mutate: request => {
        if (fail && mode === 'quota' && request.type === 'put') return Dexie.Promise.reject(new DOMException('simulated native quota', 'QuotaExceededError'))
        return table.mutate(request)
      } }
    } }) })
    await repo.save(source, null)
    const before = await repo.database.projectContentBlocks.toArray(), metrics = repo.database.contentBlockWrites()
    const changed = structuredClone(source.project); changed.document.revision = 1; changed.document.title = mode
    const observe = repo.database.onContentBlockWrite
    repo.database.onContentBlockWrite = () => { observe?.(); if (fail && mode === 'late-cancel') controller.abort() }
    fail = true
    await expect(repo.save({ project: changed, resources: source.resources }, 0, { signal: controller.signal })).rejects.toThrow()
    fail = false
    expect(await repo.database.projectContentBlocks.toArray()).toEqual(before)
    expect(repo.database.contentBlockWrites()).toEqual(metrics)
    expect((await repo.load(source.project.document.sceneId))!.project).toEqual(source.project)
    expect((await repo.listHistoryVersions(source.project.document.sceneId)).versions).toHaveLength(1)
  }, 30000)

  it('rejects corrupt native block bytes while retaining every visible row and reference', async () => {
    const repo = repository(), source = fixture(); await repo.save(source, null)
    const stored = await raw<{ project: ReturnType<typeof partitionProjectContent>['manifest'] }>(repo, 'projects', source.project.document.sceneId)
    const hash = stored.project.fields[0].blocks[0].sha256, block = await repo.database.projectContentBlocks.get(hash)
    block!.bytes[0] ^= 1
    await repo.database.projectContentBlocks.put(block!)
    repo.close()
    await expect(repo.load(source.project.document.sceneId)).rejects.toThrow(/hash/)
    expect(await raw(repo, 'projects', source.project.document.sceneId)).toEqual(stored)
  }, 30000)

  it('fails closed on a missing actual block instead of reading an empty scene', async () => {
    const repo = repository(), source = fixture(); await repo.save(source, null)
    const stored = await raw<{ project: ReturnType<typeof partitionProjectContent>['manifest'] }>(repo, 'projects', source.project.document.sceneId)
    await repo.database.projectContentBlocks.delete(stored.project.fields[0].blocks[0].sha256)
    repo.close()
    await expect(repo.load(source.project.document.sceneId)).rejects.toThrow(/块/)
    expect(canonicalJson(source.project)).toContain(source.project.document.sceneId)
  }, 30000)
})
