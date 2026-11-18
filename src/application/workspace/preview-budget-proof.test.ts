import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import * as budgetModule from '../../shared/budget/command-budget.js'
import { BUDGET_DIMENSIONS, emptyBudgetUsage } from '../../shared/budget/task-budget.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import * as resourceModule from '../../shared/project/resources.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { cloneJson } from '../../shared/validation/json.js'
import { combineManualPreparationUsage } from './prepare.js'
import * as projectModule from './project.js'
import { Workspace, type WorkspaceOptions } from './workspace.js'
import { fixture, pixelPng, runtime, validation } from './test-fixtures.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
})
async function setup(validateCandidate?: WorkspaceOptions['validateCandidate'], project?: projectModule.EditableProject) {
  const repository = new ProjectRepository({ name: `preview-budget-proof-${crypto.randomUUID()}`, runtime, validation })
  repositories.push(repository)
  const workspace = new Workspace(repository, { runtime, validation, validateCandidate })
  workspaces.push(workspace)
  await workspace.adoptNew(project ?? await projectModule.fromBundle(fixture({ image: true }), validation))
  return { workspace, repository, before: workspace.getState().project! }
}
const rotate: CompositionCommand[] = [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 25 } }]
const points = (dy = 0) => Array.from({ length: 200 }, (_, index) => ({ x: 1000 + index * 40, y: 1000 + index % 2 * 20 + dy }))

describe('private registered preview budget proof', () => {
  it('retains cumulative preparation peaks across all dimensions and asserts them without remeasuring adoption', async () => {
    const { workspace, before } = await setup(), layerId = before.document.entityLayers.item
    const preview = await workspace.preview([
      { type: 'createPath', id: 'detailed', floorId: 'blank-floor', layerId, centerlineMm: points(), widthMm: 400, supportRefs: [{ kind: 'floor', id: 'blank-floor' }] },
      { type: 'updatePath', id: 'detailed', changes: { centerlineMm: points(20) } },
    ])
    const policy = preview.budgetProfile!, retained = preview.budgetUsage!
    const measured = budgetModule.measureCommandBudget(before.document, preview.document, { before, after: preview.project }, undefined, policy)
    expect(retained.geometryPoints).toBeGreaterThan(measured.geometryPoints)
    expect(combineManualPreparationUsage(measured, retained, emptyBudgetUsage())).toEqual(retained)
    // Cover every dimension with extra admitted preparation work, including
    // counters absent from a measurement that has no execution input.
    const extraWork = { ...retained }
    for (const key of BUDGET_DIMENSIONS) extraWork[key] = Math.min(policy.limits[key], Math.max(measured[key], retained[key]) + 1)
    extraWork.groupMembers = Math.min(policy.groupMemberLimit, (retained.groupMembers ?? 0) + 1)
    extraWork.externalDependencies = (retained.externalDependencies ?? 0) + 1
    const peak = budgetModule.assertCommandBudget(policy, combineManualPreparationUsage(measured, extraWork, emptyBudgetUsage()))
    expect(combineManualPreparationUsage(measured, peak, emptyBudgetUsage())).toEqual(peak)
    expect(() => budgetModule.assertCommandBudget(policy, { ...retained, candidateAttempts: policy.limits.candidateAttempts + 1 })).toThrow(/candidateAttempts/)
    for (const key of ['gridNodes', 'fieldEvaluations', 'candidateAttempts', 'activeExecutionMs'] as const) expect(measured[key]).toBe(0)

    const measure = vi.spyOn(budgetModule, 'measureCommandBudget'), assertion = vi.spyOn(budgetModule, 'assertCommandBudget')
    await workspace.adoptPreview(preview)
    expect(measure).not.toHaveBeenCalled()
    expect(assertion).toHaveBeenCalledTimes(1)
    expect(assertion.mock.calls[0][0]).toBe(policy)
    expect(assertion.mock.calls[0][1]).toBe(retained)
    for (const key of BUDGET_DIMENSIONS) expect(assertion.mock.calls[0][1][key]).toBe(retained[key])
    expect(workspace.getDocument()!.paths.detailed.centerlineMm).toEqual(points(20))
    expect(workspace.getDocument()!.revision).toBe(before.document.revision + 1)
  })

  it('does not transfer a private proof to a copied preview, another workspace or a second adoption', async () => {
    const first = await setup(), second = await setup(undefined, first.before)
    const preview = await first.workspace.preview(rotate)
    await expect(first.workspace.adoptPreview(Object.freeze({ ...preview }))).rejects.toThrow(/不可重复采用/)
    await expect(second.workspace.adoptPreview(preview)).rejects.toThrow(/不可重复采用/)
    expect(first.workspace.getState().project).toBe(first.before)
    expect(second.workspace.getState().project).toBe(second.before)
    await first.workspace.adoptPreview(preview)
    await expect(first.workspace.adoptPreview(preview)).rejects.toThrow(/不可重复采用/)
    expect(first.workspace.getDocument()!.props.item.rotationDeg).toBe(25)
    expect(second.workspace.getDocument()!.props.item.rotationDeg).toBe(first.before.document.props.item.rotationDeg)
  })

  it('still calls the candidate policy at adoption and preserves the current branch when it rejects', async () => {
    let reject = false
    const validateCandidate = vi.fn(() => { if (reject) throw new Error('candidate policy rejected registered preview') })
    const { workspace, before } = await setup(validateCandidate), preview = await workspace.preview(rotate)
    validateCandidate.mockClear(); reject = true
    await expect(workspace.adoptPreview(preview)).rejects.toThrow('candidate policy rejected registered preview')
    expect(validateCandidate).toHaveBeenCalledWith(preview.document)
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getState().canUndo).toBe(false)
    reject = false
    await expect(workspace.adoptPreview(preview)).rejects.toThrow(/不可重复采用/)
  })

  it('remeasures a valid registered preview when its private baseline proof was unavailable', async () => {
    const { workspace, before } = await setup(), actualVerified = projectModule.getVerifiedEditableProject
    const verified = vi.spyOn(projectModule, 'getVerifiedEditableProject').mockImplementation(input => input === before ? undefined : actualVerified(input))
    let preview: Awaited<ReturnType<Workspace['preview']>>
    try { preview = await workspace.preview(rotate) } finally { verified.mockRestore() }
    const measure = vi.spyOn(budgetModule, 'measureCommandBudget'), assertion = vi.spyOn(budgetModule, 'assertCommandBudget')
    await workspace.adoptPreview(preview)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure).toHaveBeenCalledWith(before.document, preview.document, { before, after: preview.project }, undefined, preview.budgetProfile)
    expect(assertion).toHaveBeenCalledWith(preview.budgetProfile, preview.budgetUsage)
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(25)
  })

  it('keeps adoption atomic if the retained usage is refused by the budget assertion', async () => {
    const { workspace, before } = await setup(), preview = await workspace.preview(rotate)
    const assertion = vi.spyOn(budgetModule, 'assertCommandBudget').mockImplementationOnce(() => { throw new Error('adoption budget refused') })
    await expect(workspace.adoptPreview(preview)).rejects.toThrow('adoption budget refused')
    expect(assertion).toHaveBeenCalledWith(preview.budgetProfile, preview.budgetUsage)
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getState().canUndo).toBe(false)
    await expect(workspace.adoptPreview(preview)).rejects.toThrow(/不可重复采用/)
  })

  it('keeps public capture and actual byte/pixel validation for an unregistered editable wrapper', async () => {
    const decode = vi.fn(validation.images.decode), checking = { images: { ...validation.images, decode } }
    const source = await projectModule.fromBundle(fixture({ image: true }), checking), exact = projectModule.toBundle(source)
    const capture = vi.spyOn(resourceModule, 'captureProjectBundleInput'), copy = Object.freeze({ ...source })
    expect(projectModule.getVerifiedEditableProject(copy)).toBeUndefined()
    const captured = projectModule.toBundle(copy)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(captured).not.toBe(exact)
    expect(captured.project).not.toBe(exact.project)
    expect(resourceModule.getVerifiedProjectBundle(captured)).toBeUndefined()
    decode.mockClear()
    await resourceModule.validateProjectBundle(captured, checking)
    expect(decode).toHaveBeenCalledTimes(1)

    // A PNG with a correct signature, dimensions, declared length and SHA but
    // an actual three-channel scanline must still reach and fail the decoder.
    const invalidPng = pixelPng([200, 100, 50]), hash = sha256Bytes(invalidPng), metadata = cloneJson(captured.project)
    metadata.document.assets.image.sha256 = hash
    metadata.assets = { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: invalidPng.length, pixelWidth: 1, pixelHeight: 1 } }
    const badPixels = { ...metadata, resources: { async read(requested: string) { expect(requested).toBe(hash); return invalidPng.slice() } } }
    const pixelBundle = projectModule.toBundle(badPixels)
    expect(capture).toHaveBeenCalledTimes(2)
    await expect(resourceModule.validateProjectBundle(pixelBundle, checking)).rejects.toThrow(/scanline invalid/)
    expect(decode).toHaveBeenCalledTimes(2)
    await expect(projectModule.validateEditableProject({ ...source, resources: { async read(requested) {
      const bytes = await source.resources.read(requested); bytes[0] ^= 1; return bytes
    } } }, checking)).rejects.toThrow(/字节|SHA|格式/)
    expect(projectModule.getVerifiedEditableProject(source)).toBe(source)
    expect(projectModule.toBundle(source)).toBe(exact)
  })
})
