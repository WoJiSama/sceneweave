import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../../core/v3/test-fixtures.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { ProjectData, SnapshotSummary } from '../../../shared/model/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import { applyProjectDelta } from '../../../shared/project/delta.js'
import * as projectDelta from '../../../shared/project/delta.js'
import { projectContentHash } from '../../../shared/project/validate.js'
import * as projectValidation from '../../../shared/project/validate.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { ProjectDatabase, PROJECT_STORES_V1, PROJECT_STORES_V2, PROJECT_STORES_V3, PROJECT_TABLES, inspectProjectDatabase, type StoredProject, type StoredSnapshot } from './database.js'
import { INCREMENTAL_HISTORY_LIMITS, IncrementalHistory, captureHistoryGraph, historyGraphProjects, readHistoryGraphVersion, historyVersionBytes, historyPinBytes, historyHeadBytes, migrationManifest, type HistoryVersion } from './incremental-history.js'

const NOW = '2026-10-30T00:00:00.000Z'
const connections: Dexie[] = [], names = new Set<string>()
let sequence = 0
function project(): ProjectData {
  const document: SceneDocument = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 })
  document.sceneId = 'history-owner'; document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const content = createCompositionContent(document, { ids: { nextId: () => `history-token-${++sequence}` }, clock: { now: () => NOW } })
  return { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} }
}
function row(input = project(), revision = 0): StoredProject {
  const data = cloneJson(input); data.document.revision = revision; data.document.title = `历史版本 ${revision}`
  return { sceneId: data.document.sceneId, revision, savedAt: NOW, contentHash: projectContentHash(data), status: 'ready', conversionJobId: null, project: data }
}
function withFixedSource(input: ProjectData, opacity: number): ProjectData {
  const data = cloneJson(input), original = data.appearance.sources[data.appearance.propSources.item]
  if (original.kind !== 'prop') throw new Error('test requires a prop source')
  const source = cloneJson(original); source.id = 'retained-fixed-source'; source.snapshot.appearance.opacity = opacity
  data.appearance.sources[source.id] = source
  data.appearance.presentations![source.id] = cloneJson(data.appearance.presentations![original.id])
  return data
}
function db(name = `incremental-${crypto.randomUUID()}`): ProjectDatabase {
  names.add(name); const database = new ProjectDatabase(name); connections.push(database); return database
}
function snapshot(current: StoredProject, id = 'named-id'): StoredSnapshot {
  return { id, ownerSceneId: current.sceneId, lineageId: current.project.historyIdentity.lineageId, sourceRevision: current.revision,
    name: id, kind: 'named', createdAt: NOW, contentHash: current.contentHash, project: current.project }
}
function summary(input: StoredSnapshot): SnapshotSummary { const { project: _project, ...rest } = input; return rest }
function reseal<T extends { recordHash: string }>(input: T): T {
  const { recordHash: _hash, ...body } = input
  return { ...input, recordHash: sha256Bytes(encodeUtf8(canonicalJson(body))) }
}
async function transaction<T>(database: ProjectDatabase, run: (history: IncrementalHistory) => Promise<T>): Promise<T> {
  return database.transaction('rw', PROJECT_TABLES, async () => run(new IncrementalHistory(database)))
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const connection of connections.splice(0)) connection.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('incremental local history graph', () => {
  it('persists a complete baseline, bidirectional differences, reference-only pins and actual storage bytes', async () => {
    const database = db(); await database.open()
    const first = row(), second = row(first.project, 1), owner = first.sceneId
    await transaction(database, history => history.append(first, null, 'v0'))
    const next = await transaction(database, history => history.append(second, first, 'v1'))
    expect(next.checkpoint).toBeNull(); expect(next.delta).not.toBeNull(); expect(next.parentId).toBe('v0')
    expect(historyVersionBytes(next)).toBeLessThan(encodeUtf8(canonicalJson(second.project)).length)
    expect(applyProjectDelta(second.project, next.delta, 'backward')).toEqual(first.project)
    const named = snapshot(second)
    await transaction(database, history => history.pin(summary(named)))
    const pin = (await database.historyPins.get([owner, named.id]))!
    expect(pin.versionId).toBe('v1'); expect('project' in pin).toBe(false)
    expect(historyPinBytes(pin)).toBeLessThan(1024)
    const result = await transaction(database, async history => ({ current: await history.readVersion(owner, 'v1'), named: await history.readPin(owner, named.id), audit: await history.audit(owner) }))
    expect(result.current!.project).toEqual(second.project); expect(result.named).toEqual(named)
    const head = (await database.historyHeads.get(owner))!
    expect(result.audit.documentBytes).toBe(historyHeadBytes(head) + historyPinBytes(pin)
      + historyVersionBytes((await database.historyVersions.get([owner, 'v0']))!) + historyVersionBytes(next))
  })
  it('retains both children when a new monotonic save branches from an older immutable version, including after reopen', async () => {
    const database = db(); await database.open()
    const first = row(), next = row(first.project, 1), fork = row(first.project, 2)
    await transaction(database, history => history.append(first, null, 'v0'))
    await transaction(database, history => history.append(next, first, 'original-child'))
    await transaction(database, history => history.append(fork, next, 'new-child', 'v0'))
    database.close()
    const reopened = db(database.name); await reopened.open()
    await transaction(reopened, async history => {
      expect((await history.readVersion(first.sceneId, 'original-child'))!.project).toEqual(next.project)
      expect((await history.readVersion(first.sceneId, 'new-child'))!.project).toEqual(fork.project)
      expect((await history.versions(first.sceneId)).filter(value => value.parentId === 'v0').map(value => value.id).sort()).toEqual(['new-child', 'original-child'])
      expect((await history.head(first.sceneId))!.savedRevision).toBe(2)
    })
  })
  it('stages complete historical copies as independent roots and requires exact activation metadata', async () => {
    const database = db(); await database.open()
    const current = row(), named = snapshot(current), importedProject = row(current.project, 8)
    importedProject.project.document.sceneId = 'foreign-history-owner'; importedProject.contentHash = projectContentHash(importedProject.project)
    const imported: StoredSnapshot = { ...snapshot(importedProject, 'imported'), ownerSceneId: current.sceneId, kind: 'imported-auto' }
    const automatic = [{ ownerSceneId: current.sceneId, revision: current.revision, savedAt: NOW, contentHash: current.contentHash, project: current.project }]
    await transaction(database, history => history.initialize(current, automatic, [named], [imported], 7))
    await transaction(database, async history => {
      const head = (await history.head(current.sceneId))!
      expect(head.status).toBe('staged')
      expect(head.migration!.sourceManifestHash).toBe(migrationManifest(current, automatic, [named], [imported], 7))
      expect((await history.versions(current.sceneId)).every(value => value.parentId === null)).toBe(true)
      expect(await history.readPin(current.sceneId, imported.id)).toEqual(imported)
    })
    await expect(transaction(database, history => history.activate(current.sceneId, current.contentHash, 0, 8))).rejects.toThrow(/基线/)
    await transaction(database, history => history.activate(current.sceneId, current.contentHash, 0, 7))
    expect((await database.historyHeads.get(current.sceneId))!.status).toBe('ready')
    expect(await database.projects.count()).toBe(0); expect(await database.snapshots.count()).toBe(0)
  })
  it('reuses a strictly rebuilt chain across fresh reads only inside its owning operation and detaches all returned data', async () => {
    const database = db(); await database.open()
    const first = row(), second = row(first.project, 1), owner = first.sceneId
    await transaction(database, history => history.append(first, null, 'v0'))
    await transaction(database, history => history.append(second, first, 'v1'))
    const history = new IncrementalHistory(database), session = history.beginRead()
    const rebuild = vi.spyOn(projectDelta, 'applyProjectDeltaChain')
    const read = () => database.transaction('r', PROJECT_TABLES, () => history.readVersion(owner, 'v1', session))
    const exposed = (await read())!
    exposed.project.document.title = 'caller mutation'
    exposed.version.delta!.afterHash = 'f'.repeat(64)
    expect((await read())!.project).toEqual(second.project)
    expect(rebuild).toHaveBeenCalledTimes(1)
    // An ordinary public cold read cannot inherit operation authority.
    expect((await database.transaction('r', PROJECT_TABLES, () => history.readVersion(owner, 'v1')))!.project).toEqual(second.project)
    expect(rebuild).toHaveBeenCalledTimes(2)
    session.close()
    await expect(read()).rejects.toThrow(/会话/)
    const foreign = new IncrementalHistory(database).beginRead()
    await expect(history.readVersion(owner, 'v1', foreign)).rejects.toThrow(/会话/)
    const next = history.beginRead()
    expect((await history.readVersion(owner, 'v1', next))!.project).toEqual(second.project)
    expect(rebuild).toHaveBeenCalledTimes(3)
    foreign.close(); next.close()
  })
  it.each(['checkpoint schema', 'checkpoint hash', 'delta precondition', 'delta after hash', 'missing ancestor'] as const)(
    'does not reuse a cached chain after fresh %s corruption, even with resealed records', async kind => {
      const database = db(); await database.open()
      const first = row(), second = row(first.project, 1), owner = first.sceneId
      await transaction(database, history => history.append(first, null, 'v0'))
      await transaction(database, history => history.append(second, first, 'v1'))
      const history = new IncrementalHistory(database), session = history.beginRead()
      const read = () => database.transaction('r', PROJECT_TABLES, () => history.readVersion(owner, 'v1', session))
      expect((await read())!.project).toEqual(second.project)
      const key: [string, string] = [owner, kind.startsWith('delta') ? 'v1' : 'v0']
      const original = (await database.historyVersions.get(key))!
      const changed = cloneJson(original)
      if (kind === 'missing ancestor') await database.historyVersions.delete(key)
      else {
        if (kind === 'checkpoint schema') changed.checkpoint!.document.units.gridSizeMm = -1
        if (kind === 'checkpoint hash') changed.checkpoint!.document.title = 'resealed but false content'
        if (kind.startsWith('delta')) {
          const change = changed.delta!.changes.find(change => change.path.join('.') === 'document.title')!
          if (kind === 'delta precondition') change.before = { present: true, value: 'incorrect old title' }
          else change.after = { present: true, value: 'incorrect new title' }
        }
        await database.historyVersions.put(reseal(changed))
      }
      await expect(read()).rejects.toThrow()
      await database.historyVersions.put(original)
      // Repairing storage does not revive a failed operation's proof.
      await expect(read()).rejects.toThrow(/会话/)
      expect((await history.readVersion(owner, 'v1'))!.project).toEqual(second.project)
    })
  it('freshly validates the immediate parent of a cached complete checkpoint', async () => {
    const database = db(); await database.open()
    const first = row(), second = row(first.project, 1), owner = first.sceneId
    const root = await transaction(database, history => history.append(first, null, 'v0'))
    const checkpoint = reseal({ ...root, id: 'checkpoint', revision: second.revision, contentHash: second.contentHash,
      parentId: root.id, parentHash: root.contentHash, checkpoint: second.project })
    await database.historyVersions.add(checkpoint)
    const history = new IncrementalHistory(database), session = history.beginRead()
    expect((await history.readVersion(owner, checkpoint.id, session))!.project).toEqual(second.project)
    const corrupt = cloneJson(root); corrupt.checkpoint!.document.units.gridSizeMm = -1
    await database.historyVersions.put(reseal(corrupt))
    await expect(history.readVersion(owner, checkpoint.id, session)).rejects.toThrow()
  })
  it('falls back to complete reconstruction when the operation proof exceeds its character budget', async () => {
    const database = db(); await database.open()
    const first = row()
    first.project.document.notes.long = { id: 'long', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note',
      anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } }, text: 'x'.repeat(4 * 1024 * 1024) }
    first.project.document.entityLayers.long = first.project.document.entityLayers.item
    first.contentHash = projectContentHash(first.project)
    await transaction(database, history => history.append(first, null, 'large-root'))
    const history = new IncrementalHistory(database), session = history.beginRead(), rebuild = vi.spyOn(projectDelta, 'applyProjectDeltaChain')
    for (let index = 0; index < 2; index++) {
      expect((await history.readVersion(first.sceneId, 'large-root', session))!.project).toEqual(first.project)
    }
    expect(rebuild).toHaveBeenCalledTimes(2)
    session.close()
  })
  it('rejects conflicting fixed meanings across migration roots even when current removed the identity', async () => {
    const database = db(); await database.open()
    const current = row(), old = row(withFixedSource(current.project, .25), 1), conflicting = row(withFixedSource(current.project, .75), 2)
    await expect(transaction(database, history => history.initialize(current, [], [snapshot(old, 'first'), snapshot(conflicting, 'second')], [], 0))).rejects.toThrow(/固定来源/)
    expect(await database.historyVersions.count()).toBe(0); expect(await database.historyPins.count()).toBe(0); expect(await database.historyHeads.count()).toBe(0)
  })
  it('rejects reintroduced fixed meanings from a retained branch and leaves ordinary saves on the adjacent path', async () => {
    const database = db(); await database.open()
    const original = row(withFixedSource(project(), .25)), removed = row(original.project, 1)
    delete removed.project.appearance.sources['retained-fixed-source']; delete removed.project.appearance.presentations!['retained-fixed-source']; removed.contentHash = projectContentHash(removed.project)
    await transaction(database, history => history.append(original, null, 'original'))
    await transaction(database, history => history.append(removed, original, 'removed'))
    const changed = row(withFixedSource(removed.project, .75), 2)
    await expect(transaction(database, history => history.append(changed, removed, 'conflict', 'original'))).rejects.toThrow(/固定来源/)
    expect(await database.historyVersions.count()).toBe(2)
    expect((await database.historyHeads.get(original.sceneId))!.activeVersionId).toBe('removed')
    const spy = vi.spyOn(Object.getPrototypeOf(database.historyVersions.where('ownerSceneId').equals(original.sceneId)), 'toArray')
    const ordinary = row(removed.project, 2); ordinary.project.document.props.item.positionMm.x += 100; ordinary.contentHash = projectContentHash(ordinary.project)
    await transaction(database, history => history.append(ordinary, removed, 'moved'))
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore()
    const restored = row(withFixedSource(ordinary.project, .25), 3)
    await transaction(database, history => history.append(restored, ordinary, 'restored'))
    expect((await transaction(database, history => history.readVersion(original.sceneId, 'restored')))!.project).toEqual(restored.project)
  })
  it('audits both old unpinned branches beyond the latest twenty even when current removed their fixed identity', async () => {
    const database = db(); await database.open()
    const original = row(withFixedSource(project(), .25)), owner = original.sceneId
    const first = await transaction(database, history => history.append(original, null, 'old-first'))
    let current = original
    for (let revision = 1; revision <= 22; revision++) {
      const next = row(current.project, revision); delete next.project.appearance.sources['retained-fixed-source']; delete next.project.appearance.presentations!['retained-fixed-source']; next.contentHash = projectContentHash(next.project)
      await transaction(database, history => history.append(next, current, `v${revision}`)); current = next
    }
    const conflicting = row(withFixedSource(current.project, .75), 1)
    const oldBranch: HistoryVersion = reseal({ ...first, id: 'old-second', revision: conflicting.revision, contentHash: conflicting.contentHash,
      parentId: first.id, parentHash: first.contentHash, checkpoint: conflicting.project, automatic: false })
    await database.historyVersions.add(oldBranch)
    const graph = { head: (await database.historyHeads.get(owner))!, versions: await database.historyVersions.where('ownerSceneId').equals(owner).toArray(), pins: [] }
    const latestTwenty = graph.versions.filter(version => version.automatic).sort((a, b) => b.revision - a.revision).slice(0, 20)
    expect(latestTwenty.some(version => version.id === first.id || version.id === oldBranch.id)).toBe(false)
    expect(await database.historyPins.count()).toBe(0); expect(current.project.appearance.sources['retained-fixed-source']).toBeUndefined()
    expect(() => captureHistoryGraph(graph)).toThrow(/固定来源/)
    await expect(transaction(database, history => history.audit(owner))).rejects.toThrow(/固定来源/)
  }, 30_000)
  it('detects missing parents, altered record hashes, and recomputed false chain accounting', async () => {
    const database = db(); await database.open(); const first = row(), second = row(first.project, 1)
    await transaction(database, history => history.append(first, null, 'v0'))
    const stored = await transaction(database, history => history.append(second, first, 'v1'))
    await database.historyVersions.put({ ...stored, contentHash: 'f'.repeat(64) })
    await expect(transaction(database, history => history.readVersion(first.sceneId, 'v1'))).rejects.toThrow(/hash/)
    await database.historyVersions.put(reseal({ ...stored, depth: stored.depth + 1 }))
    await expect(transaction(database, history => history.readVersion(first.sceneId, 'v1'))).rejects.toThrow(/链长/)
    await database.historyVersions.put(stored); await database.historyVersions.delete([first.sceneId, 'v0'])
    await expect(transaction(database, history => history.readVersion(first.sceneId, 'v1'))).rejects.toThrow(/父版本缺失/)
  })
  it('cold-validates each root once and retains strict public graph row/hash binding without rehashing rebuilt outputs', async () => {
    const database = db(); await database.open(); const first = row(), second = row(first.project, 1)
    await transaction(database, history => history.append(first, null, 'v0'))
    await transaction(database, history => history.append(second, first, 'v1'))
    const graph = { head: (await database.historyHeads.get(first.sceneId))!, versions: await database.historyVersions.toArray(), pins: [] }
    const hash = vi.spyOn(projectValidation, 'projectContentHash')
    const validate = vi.spyOn(projectValidation, 'validateProjectData')
    const cold = await transaction(database, history => history.readVersion(first.sceneId, 'v1'))
    expect(hash).not.toHaveBeenCalled(); expect(validate).toHaveBeenCalledTimes(2)
    expect(cold!.project).toEqual(second.project)
    validate.mockRestore()
    hash.mockClear()
    const publicResult = readHistoryGraphVersion(graph, 'v1')
    expect(hash).toHaveBeenCalledTimes(1); expect(publicResult).toEqual(second.project)
    publicResult.document.title = 'separate returned project'
    expect(graph.versions.find(version => version.id === 'v0')!.checkpoint!.document.title).toBe(first.project.document.title)
    hash.mockRestore()
    const changed = cloneJson(graph), delta = changed.versions.find(version => version.id === 'v1')!
    delta.contentHash = 'f'.repeat(64)
    changed.versions[changed.versions.indexOf(delta)] = reseal(delta)
    expect(() => readHistoryGraphVersion(changed, 'v1')).toThrow(/差异与前后hash/)
    const rootChanged = cloneJson(graph); rootChanged.versions.find(version => version.id === 'v0')!.checkpoint!.document.title = 'unsealed root mutation'
    expect(() => readHistoryGraphVersion(rootChanged, 'v1')).toThrow(/hash/)
  })
  it('fully validates empty and nonempty cold roots even when corrupt checkpoint records are resealed', async () => {
    const database = db(); await database.open(); const first = row(), second = row(first.project, 1)
    await transaction(database, history => history.append(first, null, 'v0'))
    await transaction(database, history => history.append(second, first, 'v1'))
    const root = (await database.historyVersions.get([first.sceneId, 'v0']))!
    const badHash = cloneJson(root); badHash.checkpoint!.document.title = 'resealed false content'
    const badSchema = cloneJson(root); badSchema.checkpoint!.document.units.gridSizeMm = -1
    const badRevision = cloneJson(root); badRevision.checkpoint!.document.revision++
    for (const corrupt of [badHash, badSchema, badRevision]) {
      await database.historyVersions.put(reseal(corrupt))
      for (const id of ['v0', 'v1']) await expect(transaction(database, history => history.readVersion(first.sceneId, id))).rejects.toThrow()
      expect(() => historyVersionBytes(reseal(corrupt))).toThrow()
    }
  })
  it('keeps complete checkpoint-parent validation and strict standalone byte accounting', async () => {
    const database = db(); await database.open(); const first = row(), second = row(first.project, 1)
    const root = await transaction(database, history => history.append(first, null, 'v0'))
    const checkpoint = reseal({ ...root, id: 'checkpoint', revision: second.revision, contentHash: second.contentHash,
      parentId: root.id, parentHash: root.contentHash, checkpoint: second.project })
    await database.historyVersions.add(checkpoint)
    const checking = vi.fn(projectContentHash)
    const history = new IncrementalHistory(database, checking)
    expect(history.versionBytes(checkpoint)).toBe(historyVersionBytes(checkpoint))
    expect(checking).toHaveBeenCalledTimes(1)
    const corrupt = cloneJson(root); corrupt.checkpoint!.document.title = 'bad parent actual content'
    await database.historyVersions.put(reseal(corrupt))
    await expect(transaction(database, history => history.readVersion(first.sceneId, checkpoint.id))).rejects.toThrow(/hash/)
    let getters = 0
    const accessor = cloneJson(checkpoint)
    Object.defineProperty(accessor.checkpoint!.document, 'title', { enumerable: true, get() { getters++; return 'unsafe' } })
    expect(() => historyVersionBytes(accessor)).toThrow(/访问器/)
    expect(getters).toBe(0)
  })
  it('checks one shared checkpoint once while listing pins and returns independent current-pin projects', async () => {
    const database = db(); await database.open(); const first = row(), owner = first.sceneId
    await transaction(database, history => history.append(first, null, 'v0'))
    for (let index = 0; index < 3; index++) await transaction(database, history => history.pin(summary(snapshot(first, `pin-${index}`)), first.project))
    const checkedHash = vi.fn(projectContentHash)
    await database.transaction('rw', PROJECT_TABLES, async () => {
      const history = new IncrementalHistory(database, checkedHash)
      expect(await history.pins(owner)).toHaveLength(3)
      expect(checkedHash).toHaveBeenCalledTimes(1)
      checkedHash.mockClear()
      const restored = await history.readPin(owner, 'pin-0', first)
      expect(checkedHash).toHaveBeenCalledTimes(2)
      restored!.project.document.title = 'caller edit'
      expect(first.project.document.title).not.toBe('caller edit')
      expect((await database.historyVersions.get([owner, 'v0']))!.checkpoint!.document.title).not.toBe('caller edit')
    })
    // Supplying a current project never grants authority to a declared hash.
    const changed = cloneJson(first.project); changed.document.title = 'different current content'
    await expect(transaction(database, history => history.pin(summary(snapshot(first, 'mismatched')), changed))).rejects.toThrow(/内容不符/)
    expect(await database.historyPins.get([owner, 'mismatched'])).toBeUndefined()
  })
  it('creates a complete checkpoint at the finite chain boundary while preserving its parent link', async () => {
    const database = db(); await database.open(); let current = row()
    current.project.document.notes.long = { id: 'long', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note',
      anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } }, text: 'constant historical document payload '.repeat(2000) }
    current.project.document.entityLayers.long = current.project.document.entityLayers.item
    current.contentHash = projectContentHash(current.project)
    await transaction(database, history => history.append(current, null, 'v0'))
    const createDelta = vi.spyOn(projectDelta, 'createProjectDelta')
    let last: HistoryVersion | null = null
    const boundary = INCREMENTAL_HISTORY_LIMITS.chainLength
    for (let revision = 1; revision <= boundary; revision++) {
      const next = row(current.project, revision)
      if (revision === boundary) createDelta.mockClear()
      last = await transaction(database, history => history.append(next, current, `v${revision}`)); current = next
    }
    expect(createDelta).not.toHaveBeenCalled(); createDelta.mockRestore()
    const summaries = await transaction(database, history => history.versions(current.sceneId))
    expect(summaries.filter(item => item.checkpoint && item.parentId !== null)).toHaveLength(1)
    expect(last!.checkpoint).not.toBeNull(); expect(last!.depth).toBe(0); expect(last!.parentId).toBe(`v${boundary - 1}`)
    const rows = await database.historyVersions.where('ownerSceneId').equals(current.sceneId).toArray()
    const chains = await Promise.all(rows.map(item => transaction(database, history => history.readVersion(current.sceneId, item.id))))
    expect(chains.every(Boolean)).toBe(true)
    expect((await transaction(database, history => history.readVersion(current.sceneId, `v${boundary}`)))!.project).toEqual(current.project)
  }, 30_000)
  it('cold-rebuilds one strict bounded chain and checks every returned state against its immutable version', async () => {
    const database = db(); await database.open(); let current = row()
    current.project.document.notes.long = { id: 'long', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'note',
      anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } }, text: 'constant bounded reconstruction payload '.repeat(2000) }
    current.project.document.entityLayers.long = current.project.document.entityLayers.item
    current.contentHash = projectContentHash(current.project)
    await transaction(database, history => history.append(current, null, 'v0'))
    for (let revision = 1; revision < INCREMENTAL_HISTORY_LIMITS.chainLength; revision++) {
      const next = row(current.project, revision * 10)
      await transaction(database, history => history.append(next, current, `v${revision}`)); current = next
    }
    const applyChain = vi.spyOn(projectDelta, 'applyProjectDeltaChain')
    const singleStep = vi.spyOn(projectDelta, 'applyProjectDelta')
    const lastId = `v${INCREMENTAL_HISTORY_LIMITS.chainLength - 1}`
    expect((await transaction(database, history => history.readVersion(current.sceneId, lastId)))!.project).toEqual(current.project)
    expect(applyChain).toHaveBeenCalledTimes(1)
    expect(applyChain.mock.calls[0][1]).toHaveLength(INCREMENTAL_HISTORY_LIMITS.chainLength - 1)
    expect(singleStep).not.toHaveBeenCalled()
    const altered = (await database.historyVersions.get([current.sceneId, 'v1']))!
    // The hashes and chain are still honest; the row revision lies about the
    // actual complete document produced by the first delta.
    await database.historyVersions.put(reseal({ ...altered, revision: altered.revision + 1 }))
    await expect(transaction(database, history => history.readVersion(current.sceneId, lastId))).rejects.toThrow(/重建完整hash或修订/)
  })
  it('reconstructs each linear delta once per graph operation, including pins, and isolates yielded content from its private cache', async () => {
    const database = db(); await database.open(); let current = row()
    await transaction(database, history => history.append(current, null, 'v0'))
    await transaction(database, history => history.pin(summary(snapshot(current, 'first-pin'))))
    for (let revision = 1; revision < INCREMENTAL_HISTORY_LIMITS.chainLength; revision++) {
      const next = row(current.project, revision)
      await transaction(database, history => history.append(next, current, `v${revision}`)); current = next
    }
    await transaction(database, history => history.pin(summary(snapshot(current, 'last-pin'))))
    const graph = { head: (await database.historyHeads.get(current.sceneId))!,
      versions: (await database.historyVersions.where('ownerSceneId').equals(current.sceneId).toArray()).reverse(),
      pins: await database.historyPins.where('ownerSceneId').equals(current.sceneId).toArray() }
    const deltaCount = graph.versions.filter(version => version.delta !== null).length
    const spy = vi.spyOn(projectDelta, 'applyProjectDelta')
    captureHistoryGraph(graph); expect(spy).toHaveBeenCalledTimes(deltaCount)
    spy.mockClear(); await transaction(database, history => history.audit(current.sceneId)); expect(spy).toHaveBeenCalledTimes(deltaCount)
    spy.mockClear()
    const iterator = historyGraphProjects(graph), first = iterator.next().value!
    first.document.title = 'consumer mutation'; first.document.props.item.positionMm.x = 9999
    const remaining = [...iterator]
    expect(remaining.at(-1)).toEqual(current.project); expect(spy).toHaveBeenCalledTimes(deltaCount)
    spy.mockRestore()
    // Every later operation owns a new cache and cold-rebuilds its real payload.
    expect([...historyGraphProjects(graph)][0].document.title).not.toBe('consumer mutation')
  })
  it('rejects conflicting save baselines and atomically rolls back appended versions', async () => {
    const database = db(); await database.open(); const first = row(), second = row(first.project, 1)
    await transaction(database, history => history.append(first, null, 'v0'))
    await expect(transaction(database, async history => {
      await history.append(second, first, 'never-published'); throw new DOMException('quota simulation', 'QuotaExceededError')
    })).rejects.toThrow(/quota/)
    expect(await database.historyVersions.count()).toBe(1)
    expect((await database.historyHeads.get(first.sceneId))!.activeVersionId).toBe('v0')
    await expect(transaction(database, history => history.append(row(first.project, 2), second, 'conflict'))).rejects.toThrow(/冲突/)
  })
})

describe('explicit native IndexedDB schema4 upgrade', () => {
  for (const [version, stores] of [[1, PROJECT_STORES_V1], [2, PROJECT_STORES_V2], [3, PROJECT_STORES_V3]] as const) it(`preserves every schema${version} source row while adding private history stores`, async () => {
    const name = `history-upgrade-${crypto.randomUUID()}`; names.add(name)
    const source = new Dexie(name); connections.push(source); source.version(version).stores(stores); await source.open()
    const retained = row(); await source.table('projects').add(retained); source.close()
    await inspectProjectDatabase(name)
    const upgraded = db(name); await upgraded.open()
    expect(upgraded.verno).toBe(4); expect(upgraded.backendDB().version).toBe(40)
    expect(await upgraded.projects.get(retained.sceneId)).toEqual(retained)
    expect(await upgraded.historyVersions.count()).toBe(0)
  })
  it('refuses an impostor schema2 without changing any source table or version', async () => {
    const name = `history-foreign-${crypto.randomUUID()}`; names.add(name)
    const foreign = new Dexie(name); connections.push(foreign); foreign.version(2).stores({ external: 'id' }); await foreign.open(); await foreign.table('external').add({ id: 'source', original: true }); foreign.close()
    await expect(inspectProjectDatabase(name)).rejects.toThrow(/结构/)
    const candidate = db(name); await expect(candidate.open()).rejects.toThrow(/不支持/); candidate.close()
    const retained = new Dexie(name); connections.push(retained); await retained.open()
    expect(retained.verno).toBe(2); expect(await retained.table('external').get('source')).toEqual({ id: 'source', original: true })
  })
})
