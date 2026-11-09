import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { applyCompositionCommands } from '../../shared/appearance/commands.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { MANUAL_TRANSACTION_BUDGET, measureCommandBudget, type CommandBudgetUsage } from '../../shared/budget/command-budget.js'
import { BUDGET_DIMENSIONS } from '../../shared/budget/task-budget.js'
import type { CompositionCommand, CompositionContent } from '../../shared/model/appearance.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { PROJECT_DATA_LIMITS, tryCertifyLocalProjectData, validateProjectData } from '../../shared/project/validate.js'
import { getCertifiedCompositionContent, getCompositionRevisionTransaction, getPropUpdateCompositionTransaction, releaseCompositionRevisionTransaction, releasePropUpdateCompositionTransaction, reviseCompositionContent, tryApplyPropUpdateCompositionTransaction } from '../../shared/validation/content.js'
import { cloneJson, encodeUtf8, freezeJson } from '../../shared/validation/json.js'
import { getPropUpdateTransaction, releasePropUpdateTransaction } from '../../shared/validation/snapshots.js'
import { materializeProject, prepareCompositionCommands } from './prepare.js'
import { fromBundle, getVerifiedEditableProject, toBundle, tryDeriveEditableProject, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const budget = MANUAL_TRANSACTION_BUDGET
const content = (project: Pick<CompositionContent, 'document' | 'historyIdentity' | 'appearance'>): CompositionContent => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
const move = (x: number, id = 'item'): CompositionCommand => ({ type: 'updateProp', id, changes: { positionMm: { x, y: 4000 } } })
const angle = (rotationDeg: number, id = 'item'): CompositionCommand => ({ type: 'updateProp', id, changes: { rotationDeg } })
async function source(grouped = false) {
  const bundle = fixture({ image: true, building: true })
  if (grouped) {
    bundle.project.document.aggregateCoordinates = { encoding: 'world', groups: { local: { id: 'local', floorId: 'blank-floor', parentId: null,
      frame: { translationMm: { x: 2000, y: 1000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false } } }
    Object.assign(bundle.project, createCompositionContent(bundle.project.document, runtime))
  }
  return fromBundle(bundle, validation)
}
const fullBudget = (before: CompositionContent, after: CompositionContent & { assets?: EditableProject['assets'] }, execution = {}) => {
  const first = cloneJson(before), second = cloneJson(after)
  return measureCommandBudget(first.document, second.document, { before: first, after: second }, execution, budget)
}
function trackedValidation() {
  const decode = vi.fn(validation.images.decode)
  const checked: CompleteValidationOptions = { ...validation, images: { ...validation.images, decode } }
  return { checked, decode }
}
const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

describe('controlled local Prop preparation against full validators', () => {
  it('matches complete materialization for independent, grouped, rotated and repeated edits while retaining actual owned bytes', async () => {
    for (const grouped of [false, true]) {
      const before = await source(grouped)
      for (const commands of [[move(4500)], [angle(90)], [move(4500), angle(90), move(5000)], [move(4500), move(4000)]]) {
        const { checked, decode } = trackedValidation()
        const prepared = await prepareCompositionCommands(before, commands, { validation: checked, runtime, budget })
        expect(decode).not.toHaveBeenCalled()
        expect(prepared.resources).toBe(before.resources)
        expect(prepared.assets).toBe(before.assets)
        expect(prepared.historyIdentity).toBe(before.historyIdentity)
        expect(prepared.appearance).toBe(before.appearance)
        expect(getVerifiedEditableProject(prepared)).toBe(prepared)
        const complete = applyCompositionCommands(content(before), commands, runtime, { budget })
        const fullyChecked = await fromBundle({ project: { ...cloneJson(toBundle(before).project), ...complete }, resources: before.resources }, validation)
        expect(toBundle(prepared).project).toEqual(toBundle(fullyChecked).project)
        for (const hash of Object.keys(before.assets)) expect(await prepared.resources.read(hash)).toEqual(await fullyChecked.resources.read(hash))
      }
    }
  })

  it('matches every budget dimension with the cloned full meter, including local pairs, prefixes and supplied execution work', async () => {
    for (const grouped of [false, true]) {
      const before = await source(grouped), transaction = tryApplyPropUpdateCompositionTransaction(content(before), [move(4500), angle(90), move(5000), move(5000)])!
      const after = { ...transaction.result, assets: before.assets }
      const work = Object.fromEntries(BUDGET_DIMENSIONS.map(key => [key, 3]))
      for (const execution of [{}, work]) {
        expect(measureCommandBudget(before.document, after.document, { before, after }, execution, budget)).toEqual(fullBudget(content(before), after, execution))
        for (const step of transaction.steps) {
          expect(measureCommandBudget(step.before.document, step.after.document, { before: step.before, after: step.after }, execution, budget)).toEqual(fullBudget(step.before, step.after, execution))
          expect(measureCommandBudget(before.document, step.after.document, { before, after: step.after }, execution, budget)).toEqual(fullBudget(content(before), step.after, execution))
        }
      }
      expect(measureCommandBudget(before.document, before.document, { before, after: before }, {}, budget)).toEqual(fullBudget(content(before), { ...content(before), assets: before.assets }))
    }
  })

  it('charges both real moves in a net-noop batch without creating a changed semantic target', async () => {
    const before = await source(), usage: CommandBudgetUsage[] = [], commands = [move(4500), move(4500), move(4000)]
    const prepared = await prepareCompositionCommands(before, commands, { validation, runtime, budget, onBudgetUsage: value => usage.push(value) })
    expect(prepared.document).toBe(before.document)
    expect(usage).toHaveLength(1)
    const base = fullBudget(content(before), { ...content(before), assets: before.assets })
    const moved = applyCompositionCommands(content(before), [commands[0]], runtime, { budget })
    const forward = fullBudget(content(before), moved), backward = fullBudget(moved, content(before))
    expect(usage[0]).toEqual({ ...base, geometryPoints: forward.geometryPoints + backward.geometryPoints,
      geometrySegments: forward.geometrySegments + backward.geometrySegments, curveSegments: forward.curveSegments + backward.curveSegments,
      intersectionPairs: forward.intersectionPairs + backward.intersectionPairs })
    expect(usage[0]).toMatchObject({ semanticTargets: 0, geometryPoints: 10, geometrySegments: 8 })
  })

  it('refuses forged write-set proof and validates replacement resource ports and metadata', async () => {
    const before = await source(), transaction = tryApplyPropUpdateCompositionTransaction(content(before), [move(4500)])!
    const candidate = { ...before, ...transaction.result }
    expect(tryDeriveEditableProject(candidate, before, validation)).toBeDefined()
    for (const key of ['assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) {
      expect(tryDeriveEditableProject({ ...candidate, [key]: cloneJson(candidate[key]) }, before, validation)).toBeUndefined()
    }
    const bytes = vi.fn((hash: string) => before.resources.read(hash)), { checked, decode } = trackedValidation()
    const replaced = await materializeProject({ ...candidate, resources: { read: bytes } }, { validation: checked, runtime, baseline: before, budget })
    expect(bytes).toHaveBeenCalled(); expect(decode).toHaveBeenCalled()
    expect(toBundle(replaced).project).toEqual(toBundle(tryDeriveEditableProject(candidate, before, validation)!).project)
    await expect(materializeProject({ ...candidate, resources: { read: async () => new Uint8Array([1, 2, 3]) } }, { validation, runtime, baseline: before, budget })).rejects.toThrow(/字节|hash|长度/)
    await expect(materializeProject({ ...candidate, licenseBindings: [] }, { validation, runtime, baseline: before, budget })).rejects.toThrow(/许可/)
    const forged = freezeJson(cloneJson(transaction.result)) // A caller's frozen clone carries no executor witness.
    expect(getPropUpdateCompositionTransaction(forged, content(before))).toBeUndefined()
    const invalid = cloneJson(transaction.result); invalid.document.props.item.positionMm.x = -100000
    const getter = vi.fn(() => before.appearance)
    const accessor = Object.defineProperty({ ...candidate }, 'appearance', { enumerable: true, get: getter })
    await expect(materializeProject(accessor, { validation, runtime, baseline: before, budget })).rejects.toThrow(/访问器/)
    expect(getter).not.toHaveBeenCalled()
    await expect(materializeProject({ ...candidate, ...freezeJson(invalid) }, { validation, runtime, baseline: before, budget })).rejects.toThrow(/边界|占地/)
  })

  it('honors cancellation both before preparation and after the local async handoff', async () => {
    const before = await source(), signal = { aborted: true }, usage = vi.fn(), { checked, decode } = trackedValidation()
    await expect(prepareCompositionCommands(before, [move(4500)], { validation: checked, runtime, budget, signal, onBudgetUsage: usage })).rejects.toMatchObject({ name: 'AbortError' })
    signal.aborted = false
    const pending = prepareCompositionCommands(before, [move(4500)], { validation: checked, runtime, budget, signal, onBudgetUsage: usage })
    signal.aborted = true
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(usage).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled()
    expect(before.document.props.item.positionMm.x).toBe(4000)
  })

  it('uses exact UTF-8 size deltas at the document byte limit and agrees with full rejection', async () => {
    const bundle = fixture(); bundle.project.document.title = ''
    const overhead = encodeUtf8(JSON.stringify(bundle.project.document)).length
    bundle.project.document.title = 'x'.repeat(PROJECT_DATA_LIMITS.jsonBytes - overhead - 1)
    const before = await fromBundle(bundle, validation), base = toBundle(before).project
    expect(encodeUtf8(JSON.stringify(before.document))).toHaveLength(PROJECT_DATA_LIMITS.jsonBytes - 1)
    const fits = tryApplyPropUpdateCompositionTransaction(content(before), [move(10000)])!
    const atLimit = { ...base, ...fits.result }, certified = tryCertifyLocalProjectData(atLimit, base)!
    expect(certified).toBeDefined()
    expect(encodeUtf8(JSON.stringify(certified.document))).toHaveLength(PROJECT_DATA_LIMITS.jsonBytes)
    expect(validateProjectData(atLimit)).toEqual(certified)
    const tooLarge = tryApplyPropUpdateCompositionTransaction(content(before), [angle(359)])!
    const rejected = { ...base, ...tooLarge.result }
    expect(() => tryCertifyLocalProjectData(rejected, base)).toThrow(/20MiB/)
    expect(() => validateProjectData(rejected)).toThrow(/20MiB/)
    expect(tryDeriveEditableProject({ ...before, ...tooLarge.result }, before, validation)).toBeUndefined()
  }, 30000)

  it('releases only actual issued receipts while leaving immutable content usable for full validation', async () => {
    const before = await source(), transaction = tryApplyPropUpdateCompositionTransaction(content(before), [move(4500), angle(90)])!
    const first = transaction.steps[0].after
    releasePropUpdateCompositionTransaction({ ...transaction })
    releasePropUpdateTransaction({ ...transaction.sceneTransaction })
    expect(getPropUpdateCompositionTransaction(transaction.result, content(before))).toBe(transaction)
    releasePropUpdateCompositionTransaction(transaction)
    expect(getPropUpdateCompositionTransaction(transaction.result)).toBeUndefined()
    expect(getPropUpdateCompositionTransaction(first)).toBeUndefined()
    expect(getPropUpdateTransaction(transaction.result.document)).toBeUndefined()
    expect(getPropUpdateTransaction(first.document)).toBeUndefined()
    expect(getCertifiedCompositionContent(transaction.result)).toBe(transaction.result)
    const revision = reviseCompositionContent(transaction.result, 1, '2026-11-06T01:00:00.000Z'), receipt = getCompositionRevisionTransaction(revision)!
    releaseCompositionRevisionTransaction({ ...receipt })
    expect(getCompositionRevisionTransaction(revision)).toBe(receipt)
    releaseCompositionRevisionTransaction(receipt)
    expect(getCompositionRevisionTransaction(revision)).toBeUndefined()
    expect(validateProjectData({ ...toBundle(before).project, ...revision }).document.revision).toBe(1)
  })

  it('saves one local edit and preserves monotonic undo/redo after a cold read', async () => {
    const repo = new ProjectRepository({ name: `prop-local-${crypto.randomUUID()}`, runtime, validation }), workspace = new Workspace(repo, { runtime, validation })
    repositories.push(repo); workspaces.push(workspace)
    const before = await source(true), owner = before.document.sceneId
    await workspace.adoptNew(before)
    await workspace.updateProp('item', { positionMm: { x: 4500, y: 4000 }, rotationDeg: 90 }); await workspace.flush()
    expect(workspace.getState()).toMatchObject({ status: 'saved', canUndo: true, canRedo: false })
    expect((await repo.load(owner))!.project.document).toMatchObject({ revision: 1, props: { item: { positionMm: { x: 4500, y: 4000 }, rotationDeg: 90 } } })
    workspace.undo(); await workspace.flush()
    expect((await repo.load(owner))!.project.document).toMatchObject({ revision: 2, props: { item: { positionMm: { x: 4000, y: 4000 }, rotationDeg: 0 } } })
    workspace.redo(); await workspace.flush()
    const cold = await repo.load(owner)
    expect(cold!.project.document).toMatchObject({ revision: 3, props: { item: { positionMm: { x: 4500, y: 4000 }, rotationDeg: 90 } } })
    expect(cold!.project.historyIdentity).toEqual(before.historyIdentity)
  })
})
