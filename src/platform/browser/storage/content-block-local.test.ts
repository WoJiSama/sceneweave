import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { Workspace } from '../../../application/workspace/workspace.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { canonicalProjectCoordinates, decodeProjectCoordinates, encodeProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import type { ProjectData } from '../../../shared/model/project.js'
import * as binary from '../../../shared/project/binary.js'
import * as hashFunctions from '../../../shared/validation/hash.js'
import * as projectResources from '../../../shared/project/resources.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { ProjectRepository } from './repository.js'
import { certifyProjectData, PROJECT_DATA_LIMITS, tryCertifyLocalProjectData, validateProjectData } from '../../../shared/project/validate.js'
import { reviseCompositionContent, tryApplyPropUpdateCompositionTransaction } from '../../../shared/validation/content.js'
import { canonicalJson, cloneJson, encodeUtf8, freezeJson } from '../../../shared/validation/json.js'
import { CONTENT_BLOCK_CACHE_LIMITS, CONTENT_BLOCK_LIMITS, checkedContentBlock, materializeProjectContent, partitionProjectContent, prepareLocalProjectContent } from './content-blocks.js'
import * as contentBlocks from './content-blocks.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
const content = (project: ProjectData) => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
function source(count = 150, grouped = false): ProjectData {
  const project = fixture().project, scene = project.document
  for (let index = 0; index < count; index++) {
    const id = `detail-${index}`
    scene.props[id] = { ...cloneJson(scene.props.item), id, positionMm: { x: 2000 + index % 15 * 800, y: 2000 + Math.floor(index / 15) * 500 } }
    scene.entityLayers[id] = scene.entityLayers.item
  }
  if (grouped) scene.aggregateCoordinates = { encoding: 'world', groups: { local: { id: 'local', floorId: 'blank-floor', parentId: null,
    frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false } } }
  Object.assign(project, createCompositionContent(scene, runtime))
  return certifyProjectData(project)
}
function moved(before: ProjectData, ids: string[] = ['item'], revision = true): ProjectData {
  const transaction = tryApplyPropUpdateCompositionTransaction(content(before), ids.map(id => ({ type: 'updateProp', id, changes: { rotationDeg: 90 } })))!
  expect(transaction).toBeDefined()
  const after = tryCertifyLocalProjectData({ ...before, ...transaction.result }, before)!
  if (!revision) return after
  const revised = reviseCompositionContent(content(after), before.document.revision + 1, '2026-11-06T05:00:00.000Z')
  return tryCertifyLocalProjectData({ ...after, ...revised }, after)!
}
async function restored(partition: ReturnType<typeof partitionProjectContent>) {
  const blocks = new Map(partition.blocks.map(block => [block.sha256, block]))
  return materializeProjectContent(partition.manifest, async hash => blocks.get(hash))
}
const propField = (partition: ReturnType<typeof partitionProjectContent>) => partition.manifest.fields.find(field => field.path.join('.') === 'document.props')!

describe('local complete-content block preparation', () => {
  it('reencodes only changed Prop buckets and revision fields, then consumes an exact detached DB copy', async () => {
    const before = source(), after = moved(before), expected = partitionProjectContent(cloneJson(after))
    const initial = partitionProjectContent(before), prepared = prepareLocalProjectContent(after, validateProjectData(after))!
    expect(prepared).toMatchObject({ rewrittenFields: [['document', 'props'], ['document', 'revision'], ['document', 'updatedAt']], rewrittenPropBuckets: 1 })
    expect(prepared.reusedBlocks).toBeGreaterThan(20)
    const digest = vi.spyOn(binary, 'sha256Bytes')
    const partition = partitionProjectContent(structuredClone(after))
    expect(digest).toHaveBeenCalledTimes(1) // Whole actual canonical SHA remains mandatory.
    digest.mockRestore()
    expect(partition).toEqual(expected)
    for (const field of initial.manifest.fields.filter(field => !prepared.rewrittenFields.some(path => path.join('.') === field.path.join('.')))) {
      expect(partition.manifest.fields.find(next => next.path.join('.') === field.path.join('.'))).toEqual(field)
    }
    expect(canonicalProjectCoordinates(await restored(partition))).toBe(canonicalProjectCoordinates(after))
  })

  it('uses persisted local coordinates and retains unchanged colliding bucket members', async () => {
    const before = source(180, true), buckets = new Map<string, string[]>()
    for (const id of Object.keys(before.document.props).filter(id => id !== 'item')) {
      const key = binary.sha256Bytes(encodeUtf8(canonicalJson(id))).slice(0, 2)
      buckets.set(key, [...(buckets.get(key) ?? []), id])
    }
    const collision = [...buckets.values()].find(ids => ids.length >= 3)!
    expect(collision).toBeDefined()
    const after = moved(before, [collision[0], collision[1], 'item']), complete = partitionProjectContent(cloneJson(after))
    const expectedBuckets = new Set([collision[0], collision[1], 'item'].map(id => binary.sha256Bytes(encodeUtf8(canonicalJson(id))).slice(0, 2))).size
    expect(prepareLocalProjectContent(after, validateProjectData(after))?.rewrittenPropBuckets).toBe(expectedBuckets)
    const partition = partitionProjectContent(encodeProjectCoordinates(after)), stored = await restored(partition)
    expect(partition).toEqual(complete)
    expect(stored.document.aggregateCoordinates?.encoding).toBe('local')
    expect(stored.document.props.item.positionMm).toEqual({ x: 2000, y: -3000 })
    expect(stored.document.props.item.rotationDeg).toBe(0)
    expect(stored.document.props[collision[2]]).toEqual(encodeProjectCoordinates(before).document.props[collision[2]])
    expect(decodeProjectCoordinates(stored)).toEqual(after)
  })

  it('repartitions the whole small field when crossing either side of the exact record threshold', async () => {
    const initial = fixture().project
    const scene = initial.document
    for (let index = 0; ; index++) {
      const id = `threshold-${index}`
      scene.props[id] = { ...cloneJson(scene.props.item), id }
      scene.entityLayers[id] = scene.entityLayers.item
      if (encodeUtf8(canonicalJson(scene.props)).length > CONTENT_BLOCK_LIMITS.bucketThreshold) {
        delete scene.props[id]; delete scene.entityLayers[id]; break
      }
    }
    // Existing IDs occur once as keys and once in their immutable row. Their
    // lengths fill an even byte gap; one render-order digit supplies odd gaps.
    let padding = CONTENT_BLOCK_LIMITS.bucketThreshold - encodeUtf8(canonicalJson(scene.props)).length
    for (const id of Object.keys(scene.props).filter(id => id !== 'item')) {
      const extra = Math.min(Math.floor(padding / 2), 256 - id.length)
      if (!extra) break
      const replacement = `${id}${'x'.repeat(extra)}`
      scene.props[replacement] = { ...scene.props[id], id: replacement }; delete scene.props[id]
      scene.entityLayers[replacement] = scene.entityLayers[id]; delete scene.entityLayers[id]
      padding -= extra * 2
    }
    if (padding) scene.props.item.renderOrder = 10
    Object.assign(initial, createCompositionContent(scene, runtime))
    const before = certifyProjectData(initial)
    expect(encodeUtf8(canonicalJson(before.document.props))).toHaveLength(CONTENT_BLOCK_LIMITS.bucketThreshold)
    expect(propField(partitionProjectContent(before)).mode).toBe('value')
    const after = moved(before, ['item'], false)
    expect(prepareLocalProjectContent(after, validateProjectData(after))).toBeDefined()
    const record = partitionProjectContent(after)
    expect(propField(record).mode).toBe('record')
    expect(await restored(record)).toEqual(after)
    const transaction = tryApplyPropUpdateCompositionTransaction(content(after), [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 0 } }])!
    const back = tryCertifyLocalProjectData({ ...after, ...transaction.result }, after)!
    expect(prepareLocalProjectContent(back, validateProjectData(back))).toBeDefined()
    const value = partitionProjectContent(back)
    expect(propField(value).mode).toBe('value')
    expect(await restored(value)).toEqual(before)
  })

  it('rejects forged receipt wrappers and mismatched complete content without accepting claimed blocks', () => {
    const before = source(), after = moved(before), validated = validateProjectData(after)
    expect(prepareLocalProjectContent({ ...after }, validated)).toBeUndefined()
    expect(prepareLocalProjectContent(freezeJson(cloneJson(after)), validated)).toBeUndefined()
    const mismatch = cloneJson(validated); mismatch.document.title = 'different complete content'
    expect(prepareLocalProjectContent(after, mismatch)).toBeUndefined()
    const accessor = vi.fn(() => after.document)
    const invalid = Object.defineProperty({ ...validated }, 'document', { enumerable: true, get: accessor })
    expect(prepareLocalProjectContent(after, invalid)).toBeUndefined()
    expect(accessor).not.toHaveBeenCalled()
    expect(prepareLocalProjectContent(after, { ...validated, manifest: partitionProjectContent(before).manifest } as ProjectData)).toBeUndefined()
    expect(partitionProjectContent(mismatch).manifest.contentHash).not.toBe(partitionProjectContent(after).manifest.contentHash)
  })

  it('rejects world-space angle aliases before local encoding can normalize them', () => {
    const before = source(40, true), after = moved(before), forged = cloneJson(after)
    forged.document.props.item.rotationDeg = 450
    expect(canonicalProjectCoordinates(forged)).toBe(canonicalProjectCoordinates(after))
    expect(prepareLocalProjectContent(after, forged)).toBeUndefined()
    expect(prepareLocalProjectContent(after, encodeProjectCoordinates(after))).toBeDefined()
  })

  it('owns cached manifests, indexes and bytes independently of every returned mutable value', async () => {
    const before = source(), after = moved(before)
    const baseline = partitionProjectContent(before)
    baseline.blocks.forEach(block => block.bytes.fill(0)); baseline.manifest.fields[0].path[0] = 'polluted'
    const summary = prepareLocalProjectContent(after, validateProjectData(after))!
    summary.rewrittenFields[0][0] = 'polluted-summary'
    const partition = partitionProjectContent(after), expectedHash = partition.manifest.contentHash
    const damaged = partition.blocks[0]; damaged.bytes[0] ^= 1
    expect(() => checkedContentBlock(damaged)).toThrow(/hash/)
    partition.manifest.contentHash = '0'.repeat(64); partition.manifest.fields.splice(0)
    const clean = partitionProjectContent(structuredClone(after))
    expect(clean.manifest.contentHash).toBe(expectedHash)
    expect(canonicalProjectCoordinates(await restored(clean))).toBe(canonicalProjectCoordinates(after))
  })

  it('partitions one captured canonical value when a caller Proxy changes on later reads', async () => {
    const input = cloneJson(source(10)), expected = cloneJson(input)
    let reads = 0
    input.document = new Proxy(input.document, { get(target, key, receiver) {
      if (key === 'title') return reads++ === 0 ? target.title : 'poisoned later read'
      return Reflect.get(target, key, receiver)
    } })
    const partition = partitionProjectContent(input)
    expect(reads).toBe(1)
    expect(canonicalProjectCoordinates(await restored(partition))).toBe(canonicalProjectCoordinates(expected))
    expect(canonicalProjectCoordinates(await restored(partitionProjectContent(expected)))).toBe(canonicalProjectCoordinates(expected))
  })

  it('evicts bounded entries and safely recomputes an older exact content', () => {
    const before = source(), after = moved(before)
    expect(prepareLocalProjectContent(after, validateProjectData(after))).toBeDefined()
    const expected = partitionProjectContent(after)
    for (let index = 0; index < CONTENT_BLOCK_CACHE_LIMITS.entries; index++) {
      const other = cloneJson(after); other.document.title = `eviction-${index}`
      partitionProjectContent(other)
    }
    const digest = vi.spyOn(binary, 'sha256Bytes')
    expect(partitionProjectContent(after)).toEqual(expected)
    expect(digest.mock.calls.length).toBeGreaterThan(1)
  })

  it('still rejects conflicting actual database bytes for a warm prepared candidate block', async () => {
    const repo = new ProjectRepository({ name: `local-block-conflict-${crypto.randomUUID()}`, runtime, validation })
    repositories.push(repo)
    const before = source(50), after = moved(before), resources = createMemoryResources(new Map())
    await repo.save({ project: before, resources }, null)
    expect(prepareLocalProjectContent(after, validateProjectData(after))).toBeDefined()
    const initialHashes = new Set(partitionProjectContent(before).blocks.map(block => block.sha256))
    const added = partitionProjectContent(after).blocks.find(block => !initialHashes.has(block.sha256))!
    expect(added).toBeDefined()
    const corrupt = { sha256: added.sha256, bytes: added.bytes.slice() }; corrupt.bytes[0] ^= 1
    await repo.database.projectContentBlocks.put(corrupt)
    await expect(repo.save({ project: after, resources }, before.document.revision)).rejects.toThrow(/hash|字节|块/)
    expect((await repo.load(before.document.sceneId))!.project.document.revision).toBe(before.document.revision)
  })

  it('consumes a validated workspace snapshot before preparing its one shared encoded content', async () => {
    const repo = new ProjectRepository({ name: `local-block-save-${crypto.randomUUID()}`, runtime, validation })
    const workspace = new Workspace(repo, { runtime, validation })
    repositories.push(repo); workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
    await workspace.updateProp('item', { rotationDeg: 90 })
    const expected = toBundle(workspace.getState().project!).project
    const canonical = canonicalProjectCoordinates(expected), expectedHash = binary.sha256Bytes(encodeUtf8(canonical))
    const events: string[] = [], observations: { hash: string; digests: number; events: string[] }[] = []
    const validate = projectResources.validateProjectSnapshot, prepare = contentBlocks.prepareLocalProjectContent
    const encode = contentBlocks.encodeProjectContent
    const decode = vi.spyOn(validation.images, 'decode')
    // These observers always invoke the real implementation and return its
    // actual result; no validator, receipt or storage API is replaced by a fake.
    vi.spyOn(projectResources, 'validateProjectSnapshot').mockImplementation(async (...args) => {
      const result = await validate(...args)
      events.push('snapshot-validated'); return result
    })
    const preparation = vi.spyOn(contentBlocks, 'prepareLocalProjectContent').mockImplementation((...args) => {
      expect(events).toContain('snapshot-validated')
      const result = prepare(...args)
      if (result) events.push('prepared')
      return result
    })
    const digest = vi.spyOn(hashFunctions, 'sha256Bytes')
    vi.spyOn(contentBlocks, 'encodeProjectContent').mockImplementation(input => {
      const count = digest.mock.calls.length, result = encode(input)
      observations.push({ hash: result.contentHash, digests: digest.mock.calls.length - count, events: [...events] })
      return result
    })
    await workspace.flush()
    expect(decode.mock.calls.length).toBeLessThanOrEqual(1) // An unproved new closure is validated once, never repeatedly during storage.
    expect(preparation.mock.results.some(result => result.type === 'return' && result.value !== undefined)).toBe(true)
    const saved = observations.filter(value => value.hash === expectedHash)
    expect(saved.length).toBeGreaterThan(0)
    for (const value of saved) {
      expect(value.digests).toBe(1) // The actual whole-content SHA still runs.
      expect(value.events).toEqual(expect.arrayContaining(['snapshot-validated']))
    }
    expect(workspace.getState().status).toBe('saved')
    repo.close()
    expect(canonicalProjectCoordinates((await repo.load(expected.document.sceneId))!.project)).toBe(canonical)
  })

  it('rejects missing actual referenced blocks even when both saved and candidate partitions are warm', async () => {
    const repo = new ProjectRepository({ name: `local-block-missing-${crypto.randomUUID()}`, runtime, validation })
    const workspace = new Workspace(repo, { runtime, validation })
    repositories.push(repo); workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle({ project: source(50), resources: createMemoryResources(new Map()) }, validation))
    const before = toBundle(workspace.getState().project!).project, stored = partitionProjectContent(before)
    await workspace.updateProp('item', { rotationDeg: 90 })
    const after = toBundle(workspace.getState().project!).project
    expect(prepareLocalProjectContent(after, validateProjectData(after))).toBeDefined()
    const missing = propField(stored).blocks[0].sha256
    await repo.database.projectContentBlocks.delete(missing)
    await expect(repo.load(before.document.sceneId)).rejects.toThrow(/块/)
    await expect(workspace.flush()).rejects.toThrow(/块/)
    expect(workspace.getState()).toMatchObject({ status: 'error', project: { document: { revision: after.document.revision } } })
    const visible = await new Promise<{ revision: number }>((resolve, reject) => {
      const request = repo.database.backendDB().transaction('projects').objectStore('projects').get(before.document.sceneId)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    expect(visible.revision).toBe(before.document.revision)
    expect(await repo.database.projectContentBlocks.get(missing)).toBeUndefined()
  })

  it('falls back above the cache byte capacity without shrinking valid project or block limits', () => {
    const input = fixture({ image: true }).project, template = input.document.propDefinitions.definition
    input.document.title = 'x'.repeat(PROJECT_DATA_LIMITS.jsonBytes - 40000)
    for (let index = 0; index < 9; index++) {
      const text = `${index}:${'L'.repeat(PROJECT_DATA_LIMITS.licenseBytes - 2)}`, sha256 = binary.sha256Bytes(encodeUtf8(text))
      const id = `cache-capacity-${index}`, licenseRef = `cache-license-${index}`
      input.licenses[sha256] = { sha256, text }
      input.document.propDefinitions[id] = { ...cloneJson(template), id, catalogId: `test.${id}`, licenseRef }
      input.licenseBindings.push({ subjectKind: 'propDefinition', subjectId: id, licenseRef, licensePath: `licenses/${sha256}.txt`, embedding: 'allowed' })
    }
    const before = certifyProjectData(input), after = moved(before), checked = validateProjectData(after)
    expect(encodeUtf8(canonicalProjectCoordinates(checked)).length * 3).toBeGreaterThan(CONTENT_BLOCK_CACHE_LIMITS.retainedBytes)
    expect(prepareLocalProjectContent(after, checked)).toBeUndefined()
    const partition = partitionProjectContent(checked)
    expect(partition.manifest.byteLength).toBeGreaterThan(PROJECT_DATA_LIMITS.jsonBytes)
    expect(partition.manifest.byteLength).toBeLessThan(CONTENT_BLOCK_LIMITS.contentBytes)
    const digest = vi.spyOn(binary, 'sha256Bytes')
    expect(partitionProjectContent(structuredClone(checked)).manifest).toEqual(partition.manifest)
    expect(digest.mock.calls.length).toBeGreaterThan(1)
  }, 30000)
})
