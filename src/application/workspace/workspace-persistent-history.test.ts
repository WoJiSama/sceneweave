import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { cloneJson } from '../../shared/validation/json.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const repositories: ProjectRepository[] = [], sessions: Workspace[] = [], names = new Set<string>()
function repository(name = `persistent-history-${crypto.randomUUID()}`) {
  const repo = new ProjectRepository({ name, runtime, validation })
  repositories.push(repo); names.add(name)
  return repo
}
async function setup(image = false) {
  const repo = repository(), project = await fromBundle(fixture({ image }), validation)
  const workspace = new Workspace(repo, { runtime, validation })
  sessions.push(workspace); await workspace.adoptNew(project)
  const owner = project.document.sceneId, initial = (await repo.listHistoryVersions(owner)).activeVersionId!
  await workspace.updateProp('item', { rotationDeg: 25 }); await workspace.flush()
  return { repo, workspace, owner, initial }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) repo.close()
  for (const name of names) await Dexie.delete(name)
  names.clear()
})

describe('persistent complete history navigation', () => {
  it('restores both directions with one new revision and keeps both branches after cold reopen', async () => {
    const { repo, workspace, owner, initial } = await setup(true)
    await workspace.updateProp('item', { rotationDeg: 50 }); await workspace.flush()
    const oldTip = (await repo.listHistoryVersions(owner)).activeVersionId!, oldTipHash = projectContentHash(toBundle(workspace.getState().project!).project)

    const protection = await workspace.navigateHistoryVersion(initial)
    expect(protection).toMatchObject({ kind: 'protection', sourceRevision: 2, contentHash: oldTipHash })
    expect(workspace.getState()).toMatchObject({ status: 'saved', canUndo: true, canRedo: false,
      project: { document: { revision: 3, props: { item: { rotationDeg: 0 } } } } })
    const backward = (await repo.listHistoryVersions(owner)).versions.find(version => version.revision === 3)!
    expect(backward.parentId).toBe(initial)
    expect((await repo.loadHistoryVersion(owner, oldTip))!.project.document.props.item.rotationDeg).toBe(50)

    await workspace.updateProp('item', { rotationDeg: 75 }); await workspace.flush()
    await workspace.navigateHistoryVersion(oldTip)
    expect(workspace.getDocument()).toMatchObject({ revision: 5, props: { item: { rotationDeg: 50 } } })
    const forward = (await repo.listHistoryVersions(owner)).versions.find(version => version.revision === 5)!
    expect(forward.parentId).toBe(oldTip)
    expect((await repo.listHistoryVersions(owner)).versions.some(version => version.revision === 4)).toBe(true)

    await workspace.close(); repo.close()
    const reopened = repository(repo.database.name), loaded = (await reopened.load(owner))!
    expect(loaded.project.document).toMatchObject({ revision: 5, props: { item: { rotationDeg: 50 } } })
    expect((await reopened.listHistoryVersions(owner)).activeVersionId).toBe(forward.id)
    expect(projectContentHash((await reopened.loadHistoryVersion(owner, oldTip))!.project)).toBe(oldTipHash)
    expect((await reopened.loadHistoryVersion(owner, initial))!.project.document.props.item.rotationDeg).toBe(0)
  })

  it('leaves the open and persisted version unchanged when protection cannot be saved', async () => {
    const { repo, workspace, owner, initial } = await setup()
    const before = workspace.getState().project!, head = (await repo.listHistoryVersions(owner)).activeVersionId
    vi.spyOn(repo, 'createSnapshot').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(workspace.navigateHistoryVersion(initial)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(workspace.getState().project).toBe(before)
    expect((await repo.listHistoryVersions(owner)).activeVersionId).toBe(head)
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
    expect(await repo.listSnapshots(owner)).toHaveLength(0)
  })

  it('keeps the protection and current branch if the selected source disappears before adoption', async () => {
    const { repo, workspace, owner, initial } = await setup()
    const before = workspace.getState().project!, original = repo.loadHistoryVersion.bind(repo)
    let loads = 0
    vi.spyOn(repo, 'loadHistoryVersion').mockImplementation(async (...args) => ++loads === 2 ? null : original(...args))
    await expect(workspace.navigateHistoryVersion(initial)).rejects.toThrow('不可用')
    expect(workspace.getState().project).toBe(before)
    expect((await repo.load(owner))!.project.document.revision).toBe(1)
    expect((await repo.listSnapshots(owner)).filter(snapshot => snapshot.kind === 'protection')).toHaveLength(1)
  })

  it('rejects a moved persistent current branch before adoption and retains both callers results', async () => {
    const { repo, workspace, owner, initial } = await setup()
    const before = workspace.getState().project!, other = repository(repo.database.name)
    const create = repo.createSnapshot.bind(repo)
    vi.spyOn(repo, 'createSnapshot').mockImplementationOnce(async (...args) => {
      const snapshot = await create(...args), bundle = (await other.load(owner))!, changed = cloneJson(bundle.project)
      changed.document.revision++; changed.document.props.item.rotationDeg = 80
      await other.save({ project: changed, resources: bundle.resources }, 1)
      return snapshot
    })
    await expect(workspace.navigateHistoryVersion(initial)).rejects.toMatchObject({ name: 'ProjectConflictError' })
    expect(workspace.getState().project).toBe(before)
    expect((await other.load(owner))!.project.document.props.item.rotationDeg).toBe(80)
    expect((await repo.listSnapshots(owner)).filter(snapshot => snapshot.kind === 'protection')).toHaveLength(1)
  })

  it('retains the adopted branch and undo when the final save fails, and retries with its selected parent', async () => {
    const { repo, workspace, owner, initial } = await setup()
    vi.spyOn(repo, 'saveSnapshot').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(workspace.navigateHistoryVersion(initial)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(workspace.getState()).toMatchObject({ status: 'error', canUndo: true,
      project: { document: { revision: 2, props: { item: { rotationDeg: 0 } } } } })
    expect((await repo.load(owner))!.project.document).toMatchObject({ revision: 1, props: { item: { rotationDeg: 25 } } })
    await workspace.retrySave()
    const head = await repo.listHistoryVersions(owner)
    expect(head.versions.find(version => version.id === head.activeVersionId)!.parentId).toBe(initial)
    expect((await repo.load(owner))!.project.document).toMatchObject({ revision: 2, props: { item: { rotationDeg: 0 } } })
  })

  it('rejects history from another scene before writing any protection', async () => {
    const { repo, workspace, owner, initial } = await setup()
    const before = workspace.getState().project!
    vi.spyOn(repo, 'loadHistoryVersion').mockResolvedValueOnce(fixture())
    await expect(workspace.navigateHistoryVersion(initial)).rejects.toThrow('身份、格式或内容不一致')
    expect(workspace.getState().project).toBe(before)
    expect(await repo.listSnapshots(owner)).toHaveLength(0)
  })

  it('cancels a loaded history version before protection and releases the editing lock', async () => {
    const repo = repository(), signal = { aborted: false }, project = await fromBundle(fixture(), validation)
    const workspace = new Workspace(repo, { runtime, validation: { ...validation, signal } })
    sessions.push(workspace); await workspace.adoptNew(project)
    const owner = project.document.sceneId, initial = (await repo.listHistoryVersions(owner)).activeVersionId!
    await workspace.updateProp('item', { rotationDeg: 30 }); await workspace.flush()
    const before = workspace.getState().project!, load = repo.loadHistoryVersion.bind(repo)
    vi.spyOn(repo, 'loadHistoryVersion').mockImplementationOnce(async (...args) => {
      const source = await load(...args); signal.aborted = true; return source
    })
    await expect(workspace.navigateHistoryVersion(initial)).rejects.toMatchObject({ name: 'AbortError' })
    expect(workspace.getState().project).toBe(before)
    expect(await repo.listSnapshots(owner)).toHaveLength(0)
    signal.aborted = false
    await workspace.updateProp('item', { rotationDeg: 35 }); await workspace.flush()
    expect(workspace.getDocument()).toMatchObject({ revision: 2, props: { item: { rotationDeg: 35 } } })
  })
})
