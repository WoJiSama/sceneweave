import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { applyAuthoringStep, replayAuthoring } from '../../shared/ai/authoring.js'
import type { AuthoringOperation, AuthoringScope, AuthoringStep, DraftLease } from '../../shared/ai/authoring-protocol.js'
import type { AuthoringDraft } from '../../shared/ai/authoring-protocol-v1.js'
import { cloneJson } from '../../shared/validation/json.js'
import { assertAtomicLease, atomicChanges, type AtomicCandidate } from './atomic.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = [], names: string[] = []
async function setup() {
  const name = `m22-atomic-${crypto.randomUUID()}`, repo = new ProjectRepository({ name, runtime, validation })
  repos.push(repo); names.push(name)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  const document = workspace.getDocument()!, floor = Object.values(document.floors)[0]
  const scope: AuthoringScope = { targetIds: ['item'], operations: ['place', 'opacity', 'transform', 'delete'],
    placement: { floorId: floor.id, layerId: document.entityLayers.item, supportRef: { kind: 'floor', id: floor.id }, boundsMm: floor.boundsMm, definitionIds: ['definition'] } }
  const authorization = await workspace.authorizeAtomic(scope)
  const draft = (operations: AuthoringOperation[]): AuthoringDraft => ({ schemaVersion: 1, taskId: 'atomic-task', generation: 1, start: authorization.start,
    state: operations.length ? applyAuthoringStep(authorization.start, replayAuthoring(authorization.start, []).state, operations, 'step-1').state
      : replayAuthoring(authorization.start, []).state })
  return { repo, workspace, scope, authorization, draft }
}
function lease(candidate: AtomicCandidate, changes: Partial<import('../../shared/ai/authoring-protocol-v1.js').DraftLease> = {}): DraftLease {
  return { schemaVersion: 1, taskId: candidate.taskId, generation: candidate.generation, draftRevision: candidate.draftRevision, contentHash: candidate.contentHash,
    claimId: crypto.randomUUID(), serverNow: 1000, expiresAt: 31_000, ...changes }
}
const move: AuthoringOperation[] = [{ kind: 'transform', id: 'item', rotationDeg: 30 }]
afterEach(async () => {
  vi.restoreAllMocks()
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('task-scoped local authority and atomic adoption', () => {
  it('summarizes touched building entities and project constraints for explicit review', () => {
    const before = fixture({ building: true }).project, after = cloneJson(before)
    after.document.rooms.room.purpose = 'guard room'
    after.document.constraints.entranceOpeningIds = ['door-1']
    const changes = atomicChanges(before, after, ['room'])
    expect(changes).toContainEqual(expect.objectContaining({ id: 'room', collection: 'rooms', fields: expect.arrayContaining(['entity']) }))
    expect(changes).toContainEqual(expect.objectContaining({ id: 'scene-constraints', collection: 'constraints' }))
    expect(atomicChanges(before, after, ['item'])).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'scene-constraints' })]))
  })

  it('replays place, opacity and move as one protected revision and one monotonic undo/redo', async () => {
    const { workspace, repo, authorization, draft } = await setup(), before = workspace.getState().project!
    const remote = draft([{ kind: 'place', definitionId: 'definition', positionMm: { x: 7000, y: 7000 } }])
    const id = remote.state.changedIds[0]
    remote.state = applyAuthoringStep(remote.start, remote.state, [{ kind: 'opacity', id, value: 0.4 }], 'step-2').state
    remote.state = applyAuthoringStep(remote.start, remote.state, [{ kind: 'transform', id, positionMm: { x: 8000, y: 7000 } }], 'step-3').state
    const candidate = await workspace.prepareAtomicCandidate(authorization, remote)
    expect(candidate.operationCost).toBe(3); expect(candidate.changes.map(row => row.id)).toEqual([id])
    expect(workspace.getState().project).toBe(before)
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => lease(candidate) })
    expect(result.revision).toBe(1); expect(workspace.getDocument()!.props[id]).toMatchObject({ positionMm: { x: 8000, y: 7000 }, appearance: { opacity: 0.4 } })
    await result.save
    expect((await repo.usage(before.document.sceneId)).protectionCount).toBe(1)
    expect(result.protection!.project.document).toEqual(before.document)
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(2); expect(workspace.getDocument()!.props[id]).toBeUndefined(); expect(workspace.getState().canUndo).toBe(false)
    workspace.redo(); expect(workspace.getDocument()!.revision).toBe(3); expect(workspace.getDocument()!.props[id].appearance.opacity).toBe(0.4)
    await workspace.flush()
    expect((await repo.load(before.document.sceneId))!.project.document.revision).toBe(3)
    await expect(workspace.adoptAtomicCandidate(candidate, { claim: async () => lease(candidate) })).rejects.toThrow(/已采用|已取消/)
  })

  it('rejects copied authorities, copied candidates, accessor input and tampered scope/state/cost', async () => {
    const { workspace, authorization, draft } = await setup(), remote = draft(move), before = workspace.getState().project
    await expect(workspace.prepareAtomicCandidate({ ...authorization }, remote)).rejects.toThrow(/授权/)
    const wrongScope = cloneJson(remote); wrongScope.start.scope.operations = ['transform']
    await expect(workspace.prepareAtomicCandidate(authorization, wrongScope)).rejects.toThrow(/基线和范围/)
    const wrongCost = cloneJson(remote); wrongCost.state.operationCost = 0
    await expect(workspace.prepareAtomicCandidate(authorization, wrongCost)).rejects.toThrow(/重放/)
    const wrongCommands = cloneJson(remote); wrongCommands.state.steps[0].operations = [{ kind: 'delete', id: 'other' }]
    await expect(workspace.prepareAtomicCandidate(authorization, wrongCommands)).rejects.toThrow(/范围/)
    let access = 0
    const accessor = { ...remote }; Object.defineProperty(accessor, 'state', { enumerable: true, get() { access++; return remote.state } })
    await expect(workspace.prepareAtomicCandidate(authorization, accessor)).rejects.toThrow(/访问器/); expect(access).toBe(0)
    const candidate = await workspace.prepareAtomicCandidate(authorization, remote)
    await expect(workspace.adoptAtomicCandidate({ ...candidate }, { claim: async () => lease(candidate) })).rejects.toThrow(/不属于/)
    expect(workspace.getState().project).toBe(before)
  })

  it('marks an explicitly allowed empty replay as review-only and never claims it for adoption', async () => {
    const { workspace, authorization, draft } = await setup()
    const review = await workspace.prepareAtomicCandidate(authorization, draft([]), { allowEmpty: true })
    expect(review.reviewOnly).toBe(true)
    expect(review.changes).toHaveLength(0)
    const claim = vi.fn(async () => lease(review))
    await expect(workspace.adoptAtomicCandidate(review, { claim })).rejects.toThrow(/审阅凭证只能用于独立下钻/)
    expect(claim).not.toHaveBeenCalled()
  })

  it('rejects more than 256 cumulative operations even when the final state reports only 256', async () => {
    const { workspace, authorization } = await setup()
    const steps: AuthoringStep[] = Array.from({ length: 16 }, (_, index) => ({ index: index + 1, stepId: `step-${index + 1}`,
      operations: Array.from({ length: 16 }, () => ({ kind: 'transform' as const, id: 'item', rotationDeg: 30 })) }))
    const remote: AuthoringDraft = { schemaVersion: 1, taskId: 'budget-task', generation: 1, start: authorization.start, state: replayAuthoring(authorization.start, steps).state }
    expect((await workspace.prepareAtomicCandidate(authorization, remote)).operationCost).toBe(256)
    remote.state.steps.push({ index: 17, stepId: 'overflow', operations: move }); remote.state.draftRevision = 17
    await expect(workspace.prepareAtomicCandidate(authorization, remote)).rejects.toThrow(/256/)
    expect(workspace.getDocument()!.revision).toBe(0)
  }, 20_000)

  it('keeps old drafts available for inspection but rejects adoption after manual edit, undo or reopen', async () => {
    const { workspace, authorization, draft } = await setup(), remote = draft(move)
    await workspace.updateProp('other', { rotationDeg: 50 }); workspace.undo(); await workspace.flush()
    const candidate = await workspace.prepareAtomicCandidate(authorization, remote)
    expect(candidate.document.props.item.rotationDeg).toBe(30)
    const claim = vi.fn(async () => lease(candidate))
    await expect(workspace.adoptAtomicCandidate(candidate, { claim })).rejects.toThrow(/已有修改/); expect(claim).not.toHaveBeenCalled()
    await expect(workspace.reattachAtomic(remote.start)).rejects.toThrow(/基线/)
    const fresh = await workspace.authorizeAtomic(authorization.scope), freshRemote = { ...remote, start: fresh.start, state: replayAuthoring(fresh.start, remote.state.steps).state }
    const freshCandidate = await workspace.prepareAtomicCandidate(fresh, freshRemote)
    await workspace.openPersisted(workspace.getState().project!)
    await expect(workspace.adoptAtomicCandidate(freshCandidate, { claim: async () => lease(freshCandidate) })).rejects.toThrow(/已有修改/)
  })

  it('re-attaches only an explicit exact current baseline and does not let locked targets grant authority', async () => {
    const { workspace, authorization, draft } = await setup(), remote = draft(move)
    const rebound = await workspace.reattachAtomic(remote.start)
    expect(rebound).not.toBe(authorization)
    expect((await workspace.prepareAtomicCandidate(rebound, remote)).contentHash).toBe(remote.state.contentHash)
    await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: 'item', locked: true }])
    await expect(workspace.authorizeAtomic(authorization.scope)).rejects.toThrow(/锁/)
    const stillViewable = await workspace.prepareAtomicCandidate(authorization, remote)
    await expect(workspace.adoptAtomicCandidate(stillViewable, { claim: async () => lease(stillViewable) })).rejects.toThrow(/已有修改/)
  })

  it('keeps the current branch on protection failure and never claims that task', async () => {
    const { workspace, repo, authorization, draft } = await setup(), before = workspace.getState().project
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft(move)), claim = vi.fn(async () => lease(candidate))
    vi.spyOn(repo, 'createSnapshot').mockRejectedValueOnce(new Error('quota denied'))
    await expect(workspace.adoptAtomicCandidate(candidate, { claim })).rejects.toThrow(/quota/)
    expect(workspace.getState().project).toBe(before); expect(claim).not.toHaveBeenCalled()
    expect(workspace.getAtomicCandidateStatus(candidate)).toBe('cancelled')
  })

  it.each(['generation', 'cancelled', 'expired', 'metadata', 'protection', 'persistent revision'] as const)('rejects %s after protection without changing the main branch', async failure => {
    const { workspace, repo, authorization, draft } = await setup(), before = workspace.getState().project!, owner = before.document.sceneId
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft(move)), signal = { aborted: false }
    const claim = async () => {
      if (failure === 'cancelled') signal.aborted = true
      if (failure === 'metadata') await repo.database.historyMetadata.update(owner, { metadataVersion: 9 })
      if (failure === 'protection') await repo.database.snapshots.where('ownerSceneId').equals(owner).delete()
      if (failure === 'persistent revision') {
        const other = new Workspace(repo, { runtime, validation }); sessions.push(other)
        await other.openPersisted(await fromBundle((await repo.load(owner))!, validation)); await other.updateProp('other', { rotationDeg: 80 }); await other.flush()
      }
      return lease(candidate, failure === 'generation' ? { generation: 2 } : failure === 'expired' ? { expiresAt: 1000 } : {})
    }
    await expect(workspace.adoptAtomicCandidate(candidate, { claim, signal })).rejects.toThrow()
    expect(workspace.getState().project).toBe(before); expect(workspace.getState().canUndo).toBe(false)
    expect((await repo.listSnapshots(owner)).length).toBe(failure === 'protection' ? 0 : 1)
  })

  it('checks metadata and protection in the final save transaction, preserving the adopted in-memory branch on failure', async () => {
    const { workspace, repo, authorization, draft } = await setup(), owner = workspace.getDocument()!.sceneId
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft(move)), realSave = repo.save.bind(repo)
    vi.spyOn(repo, 'save').mockImplementationOnce(async (bundle, revision, options) => {
      await repo.database.historyMetadata.update(owner, { metadataVersion: 44 })
      return realSave(bundle, revision, options)
    })
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => lease(candidate) })
    await expect(result.save).rejects.toThrow(/历史元数据/)
    expect(workspace.getDocument()).toMatchObject({ revision: 1, props: { item: { rotationDeg: 30 } } })
    expect(workspace.getState()).toMatchObject({ status: 'error', canUndo: true })
    expect((await repo.load(owner))!.project.document.revision).toBe(0)
    expect((await repo.listSnapshots(owner))).toHaveLength(1)
    await expect(workspace.retrySave()).rejects.toThrow(/历史元数据/)
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(2)
    await expect(workspace.flush()).rejects.toThrow(/历史元数据/)
  })

  it('retains the required protection guard across later edits after a failed adopted save', async () => {
    const { workspace, repo, authorization, draft } = await setup(), owner = workspace.getDocument()!.sceneId
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft(move))
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('storage unavailable'))
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => lease(candidate) })
    await expect(result.save).rejects.toThrow(/storage/)
    await repo.deleteSnapshot(owner, result.protection!.id, result.protection!.contentHash, (await repo.usage(owner)).metadataVersion)
    await workspace.updateProp('other', { rotationDeg: 45 })
    await expect(workspace.retrySave()).rejects.toThrow(/历史元数据/)
    expect((await repo.load(owner))!.project.document.revision).toBe(0)
    expect(workspace.getDocument()!.revision).toBe(2)
  })

  it('rejects protection deletion inside the final save even if its metadata version was not advanced', async () => {
    const { workspace, repo, authorization, draft } = await setup(), owner = workspace.getDocument()!.sceneId
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft(move)), realSave = repo.save.bind(repo)
    vi.spyOn(repo, 'save').mockImplementationOnce(async (...args) => {
      await repo.database.snapshots.where('ownerSceneId').equals(owner).delete()
      return realSave(...args)
    })
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => lease(candidate) })
    await expect(result.save).rejects.toThrow(/历史元数据/)
    expect((await repo.load(owner))!.project.document.revision).toBe(0)
    expect(workspace.getDocument()!.revision).toBe(1); expect(workspace.getState().canUndo).toBe(true)
  })

  it('runs actual resource validation during both local preparation and adoption', async () => {
    const { workspace, authorization, draft } = await setup(), remote = draft(move)
    const decode = vi.spyOn(validation.images, 'decode').mockRejectedValueOnce(new Error('invalid actual pixels'))
    await expect(workspace.prepareAtomicCandidate(authorization, remote)).rejects.toThrow(/actual pixels/)
    const candidate = await workspace.prepareAtomicCandidate(authorization, remote)
    decode.mockRejectedValueOnce(new Error('adopt actual pixels failed'))
    const claim = vi.fn(async () => lease(candidate))
    await expect(workspace.adoptAtomicCandidate(candidate, { claim })).rejects.toThrow(/actual pixels/)
    expect(claim).not.toHaveBeenCalled(); expect(workspace.getDocument()!.revision).toBe(0)
  })

  it('blocks writes throughout claim and save while keeping reads and the new result available', async () => {
    const { workspace, repo, authorization, draft } = await setup()
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft(move)), realSave = repo.save.bind(repo)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(repo, 'save').mockImplementationOnce(async (...args) => { await gate; return realSave(...args) })
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => {
      expect(() => workspace.undo()).toThrow(/正在保护/)
      await expect(workspace.updateProp('other', { rotationDeg: 15 })).rejects.toThrow(/正在保护/)
      expect(workspace.getState().project).not.toBeNull()
      return lease(candidate)
    } })
    expect(workspace.getDocument()!.revision).toBe(1)
    expect(() => workspace.undo()).toThrow(/正在保护/)
    await expect(workspace.close()).rejects.toThrow(/正在保护/)
    release(); await result.save
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(2)
  })

  it('uses elapsed monotonic time and rejects foreign/expired lease stamps', async () => {
    const { workspace, authorization, draft } = await setup(), candidate = await workspace.prepareAtomicCandidate(authorization, draft(move))
    expect(() => assertAtomicLease(lease(candidate), candidate, 10, 30_010)).toThrow(/过期/)
    expect(() => assertAtomicLease(lease(candidate, { contentHash: '0'.repeat(64) }), candidate, 10, 11)).toThrow(/不一致/)
    workspace.cancelAtomicCandidate(candidate)
    await expect(workspace.adoptAtomicCandidate(candidate, { claim: async () => lease(candidate) })).rejects.toThrow(/已取消/)
    expect(candidate.document.props.item.rotationDeg).toBe(30)
    expect(toBundle(candidate.project).project.document.sceneId).toBe(workspace.getDocument()!.sceneId)
  })
})
