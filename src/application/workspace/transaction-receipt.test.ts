import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { applyCompositionCommands, completeCompositionTransactionReceipt, getCompositionTransactionReceipt, isIssuedCompositionTransactionReceipt, releaseCompositionTransactionReceipt } from '../../shared/appearance/commands.js'
import { MANUAL_TRANSACTION_BUDGET } from '../../shared/budget/command-budget.js'
import type { CompositionCommand, CompositionContent } from '../../shared/model/appearance.js'
import { applyProjectDelta, createProjectDelta, tryCreateLocalProjectDelta } from '../../shared/project/delta.js'
import { completeProjectTransactionReceipt, getProjectLocalTransaction, getProjectTransactionReceipt, releaseProjectLocalTransaction, releaseProjectTransactionReceipt } from '../../shared/project/validate.js'
import type { TransactionReceipt } from '../../shared/transaction/receipt.js'
import { certifyCompositionContent, getPropUpdateCompositionTransaction, reviseCompositionContent } from '../../shared/validation/content.js'
import { cloneJson } from '../../shared/validation/json.js'
import { getPropUpdateTransaction } from '../../shared/validation/snapshots.js'
import { visualBase } from '../../shared/visual/base.js'
import { prepareCompositionCommands } from './prepare.js'
import { fromBundle, toBundle, tryDeriveEditableProject, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const content = (project: CompositionContent): CompositionContent => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
const move = (x: number): CompositionCommand => ({ type: 'updateProp', id: 'item', changes: { positionMm: { x, y: 4000 } } })
const terrainMove: CompositionCommand = { type: 'moveTerrainPoint', areaId: 'land', pointId: 'land:point:1', positionMm: { x: 18500, y: 12000 } }
const buildingMove: CompositionCommand = { type: 'transformBuilding', id: 'room', offsetMm: { x: 500, y: 0 }, pivotMm: { x: 0, y: 0 }, quarterTurns: 0 }
const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function source(kind: 'prop' | 'terrain' | 'building' = 'prop'): Promise<EditableProject> {
  const bundle = fixture({ building: kind === 'building' })
  if (kind === 'terrain') Object.assign(bundle.project, applyCompositionCommands(content(bundle.project), [{ type: 'createTerrainArea', id: 'land', floorId: 'blank-floor',
    layerId: bundle.project.document.entityLayers.item, boundaryMm: [{ x: 12000, y: 12000 }, { x: 18000, y: 12000 }, { x: 18000, y: 18000 }, { x: 12000, y: 18000 }] }], runtime))
  return fromBundle(bundle, validation)
}
async function commitPrepared(before: EditableProject, commands: readonly CompositionCommand[]) {
  const prepared = await prepareCompositionCommands(before, commands, { validation, runtime, budget: MANUAL_TRANSACTION_BUDGET })
  const revised = reviseCompositionContent(content(prepared), before.document.revision + 1, runtime.clock.now())
  const committed = tryDeriveEditableProject({ ...prepared, ...revised }, prepared, validation)
  expect(committed).toBeDefined()
  return { prepared, committed: committed! }
}
async function saveLifecycleWorkspace(label: string) {
  const repository = new ProjectRepository({ name: `receipt-save-${label}-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
  const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
  await workspace.adoptNew(await source())
  // Drive every save explicitly with flush/retry. Keep real IndexedDB timers;
  // only the workspace's 120 ms debounce callback is prevented from firing.
  const schedule = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => schedule(delay === 120 ? () => {} : callback, delay, ...args))
  return { repository, workspace }
}
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
  vi.restoreAllMocks()
})

describe('executor-owned common transaction receipts', () => {
  it('retains actual Prop work in a net-noop and refuses copied receipts, snapshots and different materialization', async () => {
    const before = await source()
    let invocation: TransactionReceipt | undefined
    const after = await prepareCompositionCommands(before, [move(4500), move(4500), move(4000)], { runtime, validation, budget: MANUAL_TRANSACTION_BUDGET,
      onTransactionReceipt: receipt => { invocation = receipt } })
    const receipt = invocation!
    expect(receipt).toBeDefined()
    expect(receipt.validation.mode).toBe('prop-proof')
    expect(receipt.steps.map(step => step.writes.length)).toEqual([1, 0, 1])
    expect(receipt.budget.commandCosts).toEqual([1, 1, 1])
    expect(receipt.changes).toEqual([])
    expect(receipt.result.document).toBe(before.document)
    expect(getCompositionTransactionReceipt(content(after))).toBeUndefined()
    expect(completeProjectTransactionReceipt(toBundle(before).project, toBundle(after).project, receipt)).toBeUndefined()
    expect(Object.isFrozen(receipt.steps[0].after.document)).toBe(true)
    expect(isIssuedCompositionTransactionReceipt(cloneJson(receipt))).toBe(false)
    expect(getCompositionTransactionReceipt(cloneJson(receipt.result))).toBeUndefined()
    const changed = cloneJson(receipt.result); changed.document.title += ' unrelated'
    expect(completeCompositionTransactionReceipt(certifyCompositionContent(changed), receipt)).toBeUndefined()
    expect(completeCompositionTransactionReceipt(receipt.result, cloneJson(receipt))).toBeUndefined()
    expect(completeProjectTransactionReceipt(toBundle(before).project, toBundle(after).project, cloneJson(receipt))).toBeUndefined()
  })

  it.each(['prop', 'terrain', 'building'] as const)('carries %s execution through revision and exact persisted forward/backward delta', async kind => {
    const before = await source(kind), command = kind === 'prop' ? move(4500) : kind === 'terrain' ? terrainMove : buildingMove
    const { prepared, committed } = await commitPrepared(before, [command]), sourceData = toBundle(before).project, targetData = toBundle(committed).project
    const receipt = getCompositionTransactionReceipt(content(prepared), content(before))!
    expect(receipt).toBeDefined()
    expect(receipt.steps[0].command?.type).toBe(command.type)
    expect(receipt.changes.length).toBeGreaterThan(0)
    expect(receipt.dependencies.some(edge => edge.kind === 'domain-scope' && edge.owner === (kind === 'terrain' ? 'outdoor' : kind))).toBe(true)
    if (kind === 'terrain') {
      expect(receipt.changes.some(write => write.path.join('.') === 'document.terrainAreas.land.boundaryMm')).toBe(true)
      expect(prepared.historyIdentity.outdoorTokens.land).toEqual(before.historyIdentity.outdoorTokens.land)
    }
    if (kind === 'building') expect(receipt.changes.some(write => write.path[1] === 'vertices')).toBe(true)
    const projectReceipt = getProjectTransactionReceipt(targetData)!
    expect(projectReceipt).toBeDefined()
    expect(projectReceipt.baseline).toBe(sourceData)
    expect(projectReceipt.composition.steps.at(-1)?.phase).toBe('revision')
    const delta = tryCreateLocalProjectDelta(sourceData, targetData, targetData)!
    expect(delta).toBeDefined()
    expect(delta.beforeHash).toBe(createProjectDelta(sourceData, targetData).beforeHash)
    expect(delta.afterHash).toBe(createProjectDelta(sourceData, targetData).afterHash)
    expect(applyProjectDelta(sourceData, delta, 'forward')).toEqual(applyProjectDelta(sourceData, createProjectDelta(sourceData, targetData), 'forward'))
    expect(applyProjectDelta(targetData, delta, 'backward')).toEqual(applyProjectDelta(targetData, createProjectDelta(sourceData, targetData), 'backward'))
    const stale = cloneJson(sourceData); stale.document.title += ' stale database row'
    expect(tryCreateLocalProjectDelta(stale, targetData, targetData)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(sourceData, targetData, cloneJson(targetData))).toBeUndefined()
  })

  it.each(['project', 'composition'] as const)('revokes common delta reuse when its %s receipt is released', async owner => {
    const before = await source('terrain'), { committed } = await commitPrepared(before, [terrainMove])
    const sourceData = toBundle(before).project, targetData = toBundle(committed).project
    const receipt = getProjectTransactionReceipt(targetData)!
    expect(receipt).toBeDefined()
    // Revision-only derivation has its own independent legacy proof. Isolate
    // the common receipt here so it cannot mask the revocation under test.
    expect(getProjectLocalTransaction(targetData)?.stage).toBe('revision')
    releaseProjectLocalTransaction(targetData)
    expect(getProjectLocalTransaction(targetData)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(sourceData, targetData, targetData)).toBeDefined()
    if (owner === 'project') releaseProjectTransactionReceipt(targetData)
    else releaseCompositionTransactionReceipt(receipt.composition)
    expect(getProjectTransactionReceipt(targetData)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(sourceData, targetData, targetData)).toBeUndefined()
    const full = createProjectDelta(sourceData, targetData)
    expect(applyProjectDelta(sourceData, full, 'forward')).toEqual(targetData)
  })

  it('keeps an earlier prepared Prop proof when a later invocation returns its exact snapshot', async () => {
    const before = await source(), prepared = await prepareCompositionCommands(before, [move(4500)], { runtime, validation, budget: MANUAL_TRANSACTION_BUDGET })
    const data = toBundle(prepared).project, projectProof = getProjectLocalTransaction(data), compositionProof = getPropUpdateCompositionTransaction(content(prepared))
    const sceneProof = getPropUpdateTransaction(prepared.document), common = getCompositionTransactionReceipt(content(prepared)), projectReceipt = getProjectTransactionReceipt(data)
    expect(projectProof).toBeDefined(); expect(compositionProof).toBeDefined(); expect(sceneProof).toBeDefined()
    let invocation: TransactionReceipt | undefined
    const noop = await prepareCompositionCommands(prepared, [move(5000), move(4500)], { runtime, validation, budget: MANUAL_TRANSACTION_BUDGET,
      onTransactionReceipt: receipt => { invocation = receipt } })
    expect(toBundle(noop).project).toBe(data)
    expect(getProjectLocalTransaction(data)).toBe(projectProof)
    expect(getPropUpdateCompositionTransaction(content(prepared))).toBe(compositionProof)
    expect(getPropUpdateTransaction(prepared.document)).toBe(sceneProof)
    expect(getCompositionTransactionReceipt(content(prepared))).toBe(common)
    expect(getProjectTransactionReceipt(data)).toBe(projectReceipt)
    expect(invocation).toBeDefined()
    releaseProjectTransactionReceipt(data, invocation)
    releaseCompositionTransactionReceipt(invocation!)
    expect(getProjectTransactionReceipt(data)).toBe(projectReceipt)
    expect(getCompositionTransactionReceipt(content(prepared))).toBe(common)
  })

  it('preserves intermediate structural invalidation when two reversals restore the exact wall fields', async () => {
    const before = await source('building'), commands: CompositionCommand[] = [{ type: 'reverseWall', id: 'wall-0' }, { type: 'reverseWall', id: 'wall-0' }]
    const after = await prepareCompositionCommands(before, commands, { runtime, validation, budget: MANUAL_TRANSACTION_BUDGET })
    const receipt = getCompositionTransactionReceipt(content(after), content(before))!
    expect(after.document).toEqual(before.document)
    const previous = before.historyIdentity.structureTokens!['wall-0'], current = after.historyIdentity.structureTokens!['wall-0']
    expect(current.token).toBe(previous.token)
    expect(current.topologyHash).toBe(previous.topologyHash)
    expect(current.topologyToken).not.toBe(previous.topologyToken)
    expect(receipt.changes).toEqual([{ path: ['historyIdentity', 'structureTokens', 'wall-0', 'topologyToken'],
      before: { present: true, value: previous.topologyToken }, after: { present: true, value: current.topologyToken } }])
    expect(receipt.steps.filter(step => step.phase === 'command')).toHaveLength(2)
    expect(receipt.invalidation.structureIds).toContain('wall-0')
    expect(receipt.identityEvents.filter(event => event.kind === 'topology' && event.target.id === 'wall-0')).toHaveLength(2)
  })

  it('keeps visual deletion and recreation visible even when the final effect is identical', async () => {
    const initial = await source(), light = { id: 'receipt-light', floorId: 'blank-floor', layerId: initial.document.entityLayers.item, visibility: 'public' as const,
      editLocked: false, positionMm: { x: 5000, y: 5000 }, radiusMm: 1000, color: '#FFD080', intensity: .3, wallOcclusion: true, enabled: true }
    const before = await prepareCompositionCommands(initial, [{ type: 'upsertVisualLight', light }], { runtime, validation })
    const after = await prepareCompositionCommands(before, [{ type: 'removeVisualEffect', kind: 'light', id: light.id }, { type: 'upsertVisualLight', light }], { runtime, validation })
    const receipt = getCompositionTransactionReceipt(content(after), content(before))!
    expect(visualBase(after.document)!.lights).toEqual(visualBase(before.document)!.lights)
    expect(receipt.invalidation.visualIds).toContain(light.id)
    expect(receipt.identityEvents.filter(event => event.kind === 'topology' && event.target.id === light.id)).toHaveLength(2)
  })

  it('keeps full fallback for unclassified commands and preserves resources and manual lock refusal', async () => {
    const before = await source(), after = await prepareCompositionCommands(before, [{ type: 'renameScene', title: 'Receipt fallback' }], { runtime, validation })
    const receipt = getCompositionTransactionReceipt(content(after), content(before))!
    expect(receipt.validation).toEqual({ mode: 'full', dependencyCoverage: 'full-fallback' })
    expect(receipt.invalidation.requiresFullProjection).toBe(true)
    expect(receipt.resources.requiresByteValidation).toBe(true)
    const locked = fixture(); locked.project.document.props.item.editLocked = true
    const sourceLocked = await fromBundle(locked, validation)
    await expect(prepareCompositionCommands(sourceLocked, [move(4500)], { runtime, validation })).rejects.toThrow(/锁/)
    expect(sourceLocked.document.props.item.positionMm.x).toBe(4000)
  })

  it.each(['prop', 'terrain', 'building'] as const)('uses the same %s candidate for preview, adoption, undo, redo and cold storage', async kind => {
    const repository = new ProjectRepository({ name: `common-receipt-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await source(kind))
    const before = workspace.getState().project!, beforeDocument = before.document
    const command = kind === 'prop' ? move(4500) : kind === 'terrain' ? terrainMove : buildingMove
    const preview = await workspace.preview([command])
    expect(workspace.getState().project).toBe(before)
    expect(getCompositionTransactionReceipt(content(preview.project), content(before))).toBeDefined()
    await workspace.adoptPreview(preview); await workspace.flush()
    const after = workspace.getState().project!, afterDocument = after.document
    expect(afterDocument.revision).toBe(beforeDocument.revision + 1)
    expect((await repository.load(afterDocument.sceneId))!.project).toEqual(toBundle(after).project)
    workspace.undo(); await workspace.flush()
    expect(workspace.getDocument()!.props).toEqual(beforeDocument.props)
    expect(workspace.getDocument()!.terrainAreas).toEqual(beforeDocument.terrainAreas)
    expect(workspace.getDocument()!.vertices).toEqual(beforeDocument.vertices)
    workspace.redo(); await workspace.flush()
    expect(workspace.getDocument()!.props).toEqual(afterDocument.props)
    expect(workspace.getDocument()!.terrainAreas).toEqual(afterDocument.terrainAreas)
    expect(workspace.getDocument()!.vertices).toEqual(afterDocument.vertices)
    expect(workspace.getDocument()!.revision).toBe(afterDocument.revision + 2)
  })

  it.each(['noop', 'roundtrip', 'empty'] as const)('preserves the adopted pending-save receipt through %s preparation and cancelled preview', async kind => {
    const repository = new ProjectRepository({ name: `common-receipt-pending-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await source())
    const baseline = workspace.getState().project!, sourceData = toBundle(baseline).project
    const entered = deferred(), release = deferred(), write = repository.saveSnapshot.bind(repository)
    vi.spyOn(repository, 'saveSnapshot').mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return write(...args)
    })
    let flushing: Promise<void> | undefined
    try {
      await workspace.adoptPreview(await workspace.preview([move(4500)]))
      flushing = workspace.flush(); await entered.promise
      const committed = workspace.getState().project!, targetData = toBundle(committed).project
      const savedReceipt = getProjectTransactionReceipt(targetData)!, savedComposition = getCompositionTransactionReceipt(content(committed))!
      expect(savedReceipt).toBeDefined(); expect(savedComposition).toBeDefined()
      expect(savedReceipt.baseline).toBe(sourceData)
      expect(savedReceipt.composition).toBe(savedComposition)
      const commands = kind === 'noop' ? [move(4500)] : kind === 'roundtrip' ? [move(5000), move(4500)] : []
      let invocation: TransactionReceipt | undefined
      const prepared = await prepareCompositionCommands(committed, commands, { runtime, validation, budget: MANUAL_TRANSACTION_BUDGET,
        onTransactionReceipt: receipt => { invocation = receipt } })
      expect(prepared.document).toBe(committed.document)
      if (commands.length) {
        expect(invocation).toBeDefined()
        expect(invocation!.baseline.document).toBe(committed.document)
        expect(invocation!.result.document).toBe(committed.document)
        expect(invocation!.changes).toEqual([])
        // Releasing this invocation must never release the unchanged
        // snapshot's previous edit, even when both ProjectData objects match.
        releaseProjectTransactionReceipt(targetData, invocation)
        releaseCompositionTransactionReceipt(invocation!)
      } else expect(invocation).toBeUndefined()
      expect(getProjectTransactionReceipt(targetData)).toBe(savedReceipt)
      expect(getCompositionTransactionReceipt(content(committed))).toBe(savedComposition)
      const preview = await workspace.preview(commands)
      if (commands.length) {
        expect(preview.transaction).toBeDefined()
        expect(preview.transaction).not.toBe(savedComposition)
      } else expect(preview.transaction).toBeUndefined()
      workspace.cancelPreview(preview)
      if (preview.transaction) expect(isIssuedCompositionTransactionReceipt(preview.transaction)).toBe(false)
      expect(getProjectTransactionReceipt(targetData)).toBe(savedReceipt)
      expect(getCompositionTransactionReceipt(content(committed))).toBe(savedComposition)
      expect(isIssuedCompositionTransactionReceipt(savedComposition)).toBe(true)
      expect(savedReceipt.baseline).toBe(sourceData)
      expect(tryCreateLocalProjectDelta(sourceData, targetData, targetData)).toBeDefined()
      release.resolve(); await flushing
      expect((await repository.load(committed.document.sceneId))!.project).toEqual(targetData)
      expect(workspace.getState().status).toBe('saved')
    } finally { release.resolve(); await flushing?.catch(() => {}) }
  })

  it('releases an unstarted save replaced within the debounce while retaining the next proof and undo document', async () => {
    const { repository, workspace } = await saveLifecycleWorkspace('coalesced')
    const baseline = workspace.getState().project!, baselineData = toBundle(baseline).project
    const save = vi.spyOn(repository, 'saveSnapshot')
    await workspace.execute([move(4500)])
    const first = workspace.getState().project!, firstData = toBundle(first).project, firstReceipt = getProjectTransactionReceipt(firstData)!
    expect(firstReceipt).toBeDefined(); expect(getProjectLocalTransaction(firstData)).toBeDefined()
    await workspace.execute([move(5000)])
    const second = workspace.getState().project!, secondData = toBundle(second).project, secondReceipt = getProjectTransactionReceipt(secondData)!
    expect(save).not.toHaveBeenCalled()
    expect(getProjectTransactionReceipt(firstData)).toBeUndefined()
    expect(getProjectLocalTransaction(firstData)).toBeUndefined()
    expect(isIssuedCompositionTransactionReceipt(firstReceipt.composition)).toBe(false)
    expect(secondReceipt).toBeDefined(); expect(secondReceipt.baseline).toBe(firstData)
    expect(isIssuedCompositionTransactionReceipt(secondReceipt.composition)).toBe(true)
    expect(tryCreateLocalProjectDelta(firstData, secondData, secondData)).toBeDefined()
    expect(tryCreateLocalProjectDelta(baselineData, secondData, secondData)).toBeUndefined()
    await workspace.flush()
    expect(save.mock.calls.map(([bundle, expected]) => [bundle.project.document.revision, expected])).toEqual([[2, 0]])
    expect((await repository.load(second.document.sceneId))!.project).toEqual(secondData)
    expect(getProjectTransactionReceipt(secondData)).toBeUndefined()
    workspace.undo()
    expect(workspace.getDocument()!.props).toEqual(first.document.props)
    await workspace.flush()
    expect((await repository.load(second.document.sceneId))!.project).toEqual(toBundle(workspace.getState().project!).project)
  })

  it('keeps in-flight evidence until its write finishes and does not revoke the following pending save', async () => {
    const { repository, workspace } = await saveLifecycleWorkspace('inflight')
    const enteredFirst = deferred(), releaseFirst = deferred(), enteredSecond = deferred(), releaseSecond = deferred()
    const write = repository.saveSnapshot.bind(repository)
    const save = vi.spyOn(repository, 'saveSnapshot')
      .mockImplementationOnce(async (...args) => { enteredFirst.resolve(); await releaseFirst.promise; return write(...args) })
      .mockImplementationOnce(async (...args) => { enteredSecond.resolve(); await releaseSecond.promise; return write(...args) })
    let flushing: Promise<void> | undefined
    try {
      await workspace.execute([move(4500)])
      const first = workspace.getState().project!, firstData = toBundle(first).project, firstReceipt = getProjectTransactionReceipt(firstData)!
      expect(firstReceipt).toBeDefined()
      flushing = workspace.flush(); await enteredFirst.promise
      await workspace.execute([move(5000)])
      const second = workspace.getState().project!, secondData = toBundle(second).project, secondReceipt = getProjectTransactionReceipt(secondData)!
      expect(secondReceipt).toBeDefined()
      expect(getProjectTransactionReceipt(firstData)).toBe(firstReceipt)
      expect(getProjectLocalTransaction(firstData)).toBeDefined()
      expect(isIssuedCompositionTransactionReceipt(firstReceipt.composition)).toBe(true)
      releaseFirst.resolve(); await enteredSecond.promise
      expect(getProjectTransactionReceipt(firstData)).toBeUndefined()
      expect(getProjectLocalTransaction(firstData)).toBeUndefined()
      expect(getProjectTransactionReceipt(secondData)).toBe(secondReceipt)
      expect(isIssuedCompositionTransactionReceipt(secondReceipt.composition)).toBe(true)
      expect(tryCreateLocalProjectDelta(firstData, secondData, secondData)).toBeDefined()
      expect((await repository.load(first.document.sceneId))!.project).toEqual(firstData)
      releaseSecond.resolve(); await flushing
      expect(save.mock.calls.map(([bundle, expected]) => [bundle.project.document.revision, expected])).toEqual([[1, 0], [2, 1]])
      expect((await repository.load(second.document.sceneId))!.project).toEqual(secondData)
      expect(getProjectTransactionReceipt(secondData)).toBeUndefined()
      workspace.undo()
      expect(workspace.getDocument()!.props).toEqual(first.document.props)
      await workspace.flush()
      expect((await repository.load(second.document.sceneId))!.project).toEqual(toBundle(workspace.getState().project!).project)
    } finally { releaseFirst.resolve(); releaseSecond.resolve(); await flushing?.catch(() => {}) }
  })

  it('releases a failed older save only after rejection and retries the newer complete project with undo intact', async () => {
    const { repository, workspace } = await saveLifecycleWorkspace('failed')
    const baseline = workspace.getState().project!, baselineData = toBundle(baseline).project
    const entered = deferred(), fail = deferred(), write = repository.saveSnapshot.bind(repository)
    const save = vi.spyOn(repository, 'saveSnapshot').mockImplementationOnce(async (bundle, _expected, options) => {
      entered.resolve(); await fail.promise
      // Reject in the real repository's final CAS, before it changes any rows.
      return write(bundle, 999, options)
    })
    let flushing: Promise<void> | undefined
    try {
      await workspace.execute([move(4500)])
      const first = workspace.getState().project!, firstData = toBundle(first).project, firstReceipt = getProjectTransactionReceipt(firstData)!
      expect(firstReceipt).toBeDefined()
      flushing = workspace.flush()
      const rejected = expect(flushing).rejects.toMatchObject({ name: 'ProjectConflictError' })
      await entered.promise
      await workspace.execute([move(5000)])
      const second = workspace.getState().project!, secondData = toBundle(second).project, secondReceipt = getProjectTransactionReceipt(secondData)!
      expect(secondReceipt).toBeDefined(); expect(getProjectTransactionReceipt(firstData)).toBe(firstReceipt)
      fail.resolve(); await rejected
      expect(getProjectTransactionReceipt(firstData)).toBeUndefined()
      expect(getProjectLocalTransaction(firstData)).toBeUndefined()
      expect(isIssuedCompositionTransactionReceipt(firstReceipt.composition)).toBe(false)
      expect(getProjectTransactionReceipt(secondData)).toBe(secondReceipt)
      expect(getProjectLocalTransaction(secondData)).toBeDefined()
      expect(workspace.getState()).toMatchObject({ status: 'conflict', canUndo: true })
      expect(workspace.getState().project).toBe(second)
      expect((await repository.load(baseline.document.sceneId))!.project).toEqual(baselineData)
      await workspace.retry()
      expect(save.mock.calls.map(([bundle, expected]) => [bundle.project.document.revision, expected])).toEqual([[1, 0], [2, 0]])
      expect((await repository.load(second.document.sceneId))!.project).toEqual(secondData)
      expect(getProjectTransactionReceipt(secondData)).toBeUndefined()
      workspace.undo()
      expect(workspace.getDocument()!.props).toEqual(first.document.props)
      await workspace.flush()
      expect((await repository.load(second.document.sceneId))!.project).toEqual(toBundle(workspace.getState().project!).project)
    } finally { fail.resolve(); await flushing?.catch(() => {}) }
  })

  it('keeps pending evidence after copy failure and releases it only when an independent copy is installed', async () => {
    const { repository, workspace } = await saveLifecycleWorkspace('copy')
    const original = workspace.getState().project!, originalData = toBundle(original).project
    await workspace.execute([move(4500)])
    const pending = workspace.getState().project!, pendingData = toBundle(pending).project, receipt = getProjectTransactionReceipt(pendingData)!
    expect(receipt).toBeDefined(); expect(getProjectLocalTransaction(pendingData)).toBeDefined()
    const write = repository.save.bind(repository)
    vi.spyOn(repository, 'save').mockImplementationOnce((bundle, _expected, options) => write(bundle, 999, options))
    await expect(workspace.saveAsCopy()).rejects.toMatchObject({ name: 'ProjectConflictError' })
    expect(workspace.getState().project).toBe(pending)
    expect(getProjectTransactionReceipt(pendingData)).toBe(receipt)
    expect(getProjectLocalTransaction(pendingData)).toBeDefined()
    await workspace.saveAsCopy()
    const copied = workspace.getState().project!
    expect(copied.document.sceneId).not.toBe(original.document.sceneId)
    expect(copied.document.props).toEqual(pending.document.props)
    expect(getProjectTransactionReceipt(pendingData)).toBeUndefined()
    expect(getProjectLocalTransaction(pendingData)).toBeUndefined()
    expect(isIssuedCompositionTransactionReceipt(receipt.composition)).toBe(false)
    expect((await repository.load(original.document.sceneId))!.project).toEqual(originalData)
    expect((await repository.load(copied.document.sceneId))!.project).toEqual(toBundle(copied).project)
  })

  it('does not extend a receipt across distinct edits or accept a stale/cancelled candidate', async () => {
    const repository = new ProjectRepository({ name: `common-receipt-stale-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await source())
    const first = await workspace.preview([move(4500)])
    workspace.cancelPreview(first)
    await expect(workspace.adoptPreview(first)).rejects.toThrow(/取消|重复/)
    const stale = await workspace.preview([move(5000)])
    await workspace.execute([move(5500)])
    await expect(workspace.adoptPreview(stale)).rejects.toThrow(/变化|修改/)
    expect(workspace.getDocument()!.props.item.positionMm.x).toBe(5500)
  })
})
