import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { applyAuthoringStep, replayAuthoring } from '../../shared/ai/authoring.js'
import type { AuthoringDraft, DraftLease } from '../../shared/ai/authoring-protocol.js'
import { cloneJson } from '../../shared/validation/json.js'
import { type AtomicCandidate } from './atomic.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const sessions: Workspace[] = [], repos: ProjectRepository[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
async function setup(version: 3 | 4 | 5 | 6 | 7) {
  const repo = new ProjectRepository({ name: `current-authoring-${crypto.randomUUID()}`, runtime, validation })
  repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  await workspace.enableVisualCopy(); await workspace.enableTerrainCopy()
  if (version >= 4) await workspace.enableCompositionCopy()
  if (version >= 5) await workspace.enableConnectionCopy()
  if (version >= 6) await workspace.enableDecorationCopy()
  if (version >= 7) await workspace.enableCanopyCopy()
  const authorization = await workspace.authorizeCurrentAtomic({ targetIds: ['item'], operations: ['transform', 'opacity'], placement: null })
  const draft: AuthoringDraft = { schemaVersion: 4, taskId: 'current-authoring-task', generation: 1, start: authorization.start,
    state: applyAuthoringStep(authorization.start, replayAuthoring(authorization.start, []).state,
      [{ kind: 'transform', id: 'item', rotationDeg: 30 }], 'rotate-existing').state }
  return { repo, workspace, authorization, draft }
}
function lease(candidate: AtomicCandidate): DraftLease {
  if (candidate.schemaVersion !== 4 || !candidate.budgetIdentity) throw new Error('Expected an exact current-authoring credential')
  return { schemaVersion: 4, taskId: candidate.taskId, generation: candidate.generation, draftRevision: candidate.draftRevision,
    contentHash: candidate.contentHash, ...candidate.budgetIdentity, claimId: crypto.randomUUID(), serverNow: 1000, expiresAt: 31000 }
}

describe('current authoring4 workspace publication boundary', () => {
  it.each([3, 4, 5, 6, 7] as const)('edits complete%s in place with full resources, protection, one undo and cold persistence', async version => {
    const { repo, workspace, authorization, draft } = await setup(version), original = workspace.getState().project!
    expect(authorization.start.source).toMatchObject({ version: 4, kind: 'current-baseline', preservation: { sceneId: original.document.sceneId } })
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft)
    expect(workspace.getState().project).toBe(original)
    expect(candidate.operationCost).toBe(1); expect(candidate.budgetIdentity).toBeDefined()
    const result = await workspace.adoptAtomicCandidate(candidate, { claim: async () => lease(candidate) }); await result.save
    expect(workspace.getDocument()).toMatchObject({ schemaVersion: version, sceneId: original.document.sceneId, revision: 1 })
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(30)
    expect(result.protection!.project.document).toEqual(original.document)
    const cold = (await repo.load(original.document.sceneId))!
    expect(cold.project).toEqual(toBundle(workspace.getState().project!).project)
    for (const hash of Object.keys(original.assets)) expect(await cold.resources.read(hash)).toEqual(await original.resources.read(hash))
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(2); expect(workspace.getDocument()!.props.item.rotationDeg).toBe(original.document.props.item.rotationDeg)
    workspace.redo(); expect(workspace.getDocument()!.revision).toBe(3); expect(workspace.getDocument()!.props.item.rotationDeg).toBe(30)
    await workspace.flush()
    expect((await repo.load(original.document.sceneId))!.project.document.revision).toBe(3)
  }, 30000)

  it('reattaches the exact current source while rejecting tampered budgets and stale local edits before claiming', async () => {
    const { repo, workspace, authorization, draft } = await setup(6)
    const rebound = await workspace.reattachAtomic(draft.start)
    expect(rebound.start).toEqual(authorization.start)
    const wrong = cloneJson(draft); if (wrong.state.schemaVersion !== 4) throw new Error('Expected authoring4')
    wrong.state.budgetStateHash = '0'.repeat(64)
    await expect(workspace.prepareAtomicCandidate(rebound, wrong)).rejects.toThrow(/重放/)
    const candidate = await workspace.prepareAtomicCandidate(rebound, draft)
    await workspace.updateProp('other', { rotationDeg: 15 }); await workspace.flush()
    const afterManual = workspace.getState().project!, claim = vi.fn(async () => lease(candidate))
    await expect(workspace.adoptAtomicCandidate(candidate, { claim })).rejects.toThrow(/已有修改|基线/)
    await expect(workspace.reattachAtomic(draft.start)).rejects.toThrow(/基线/)
    expect(claim).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(afterManual)
    expect((await repo.listSnapshots(afterManual.document.sceneId)).filter(row => row.kind === 'protection')).toHaveLength(0)
  }, 30000)

  it('rejects a changed lease identity after protecting the current map and preserves both map and undo', async () => {
    const { repo, workspace, authorization, draft } = await setup(6), before = workspace.getState().project!
    const candidate = await workspace.prepareAtomicCandidate(authorization, draft)
    await expect(workspace.adoptAtomicCandidate(candidate, { claim: async () => ({ ...lease(candidate), sourceHash: '0'.repeat(64) }) })).rejects.toThrow(/预算身份/)
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getState().canUndo).toBe(false)
    expect((await repo.listSnapshots(before.document.sceneId)).filter(row => row.kind === 'protection')).toHaveLength(1)
    expect((await repo.load(before.document.sceneId))!.project.document).toEqual(before.document)
  }, 30000)
})
