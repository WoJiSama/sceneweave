import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from './workspace.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { taskBudgetProfile } from '../../shared/budget/task-budget.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { cloneJson } from '../../shared/validation/json.js'
import type { InteriorGenerationInput } from '../../shared/generation/domains/interior/contracts.js'
import { executeDomainExecutionRequest, type DomainExecutionResponse } from '../../shared/generation/execution.js'
import { hashGenerationValue } from '../../shared/generation/contracts.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
const profile = taskBudgetProfile('small')
async function blank(): Promise<EditableProject> {
  const bundle = fixture({ image: true }), document = cloneJson(bundle.project.document)
  document.sceneId = runtime.ids.nextId(); document.title = '参数化室内候选'
  for (const id of Object.keys(document.props)) delete document.entityLayers[id]
  document.props = {}
  const asset = document.assets.image
  document.materials['floor-material'] = { id: 'floor-material', catalogId: 'test.interior.floor', version: 1, name: '实际像素地板', tags: [],
    licenseRef: asset.licenseRef, origin: cloneJson(asset.origin), textureAssetId: asset.id, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room', 'wall'] }
  const content = createCompositionContent(document, runtime), licenseHash = Object.keys(bundle.project.licenses)[0]
  return fromBundle({ project: { ...bundle.project, ...content, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject,
    licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })) }, resources: bundle.resources }, validation)
}
function request(base: EditableProject): InteriorGenerationInput {
  return { version: 1, algorithmVersion: 2, seed: 'interior-workspace-fixed', parameters: {
    floorId: Object.keys(base.document.floors)[0], layerId: Object.keys(base.document.userLayers)[0], boundsMm: { x: 1000, y: 1000, width: 14000, height: 12000 }, wallThicknessMm: 200,
    rooms: ['lobby', 'study'].map(id => ({ id, purpose: id, minAreaMm2: 8_000_000, maxAreaMm2: 140_000_000, minClearSideMm: 2000 })),
    relations: [{ a: 'lobby', b: 'study', kind: 'adjacent', minimumSharedWallMm: 1000 }], corridor: { axis: 'none', clearWidthMm: 1200 },
    materials: { floor: { id: 'floor-material', version: 1 }, wall: null }, arrangement: { doors: false, entrance: false, furniture: false, doorWidthMm: 1200, clearWidthMm: 1000, palette: [] },
  } }
}
async function setup() {
  const repo = new ProjectRepository({ name: 'interior-workspace-' + crypto.randomUUID(), runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  return { repo, workspace }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

describe('complete interior candidate and independent project publication', () => {
  it('reuses exact generation resources while still checking public save and actual cold read pixels', async () => {
    const { repo, workspace } = await setup(), decode = vi.spyOn(validation.images, 'decode'), base = await blank()
    decode.mockClear()
    const preview = await workspace.previewInteriorGeneration(base, request(base), profile)
    expect(decode).not.toHaveBeenCalled()
    const load = vi.spyOn(repo, 'load'), save = vi.spyOn(repo, 'save')
    await workspace.adoptInteriorGeneration(preview)
    expect(save).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(2)
    expect(projectContentHash(toBundle(workspace.getState().project!).project)).toBe(projectContentHash(toBundle(preview.project).project))
  }, 30000)

  it('uses the public entry for an executor preview and replays locally before cold publication', async () => {
    const { repo, workspace } = await setup(), base = await blank(), current = workspace.getState().project!
    const execute = vi.fn(async raw => {
      expect(raw.context).toEqual({ workspaceId: current.document.sceneId, checkpoint: workspace.checkpoint(), epoch: 7 })
      return executeDomainExecutionRequest(raw, { nowMilliseconds: () => 0 })
    })
    const preview = await workspace.previewGeneration({ kind: 'new-project', domain: 'interior', base, input: request(base), profile }, { execute, epoch: 7 })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(workspace.getState().project).toBe(current)
    // An authentic candidate is still bound to its own domain. Incorrect
    // dispatch must neither adopt it nor cancel the rightful lifecycle.
    workspace.cancelGeneration({ kind: 'new-project', domain: 'forest', preview: preview as never })
    await expect(workspace.adoptGeneration({ kind: 'new-project', domain: 'forest', preview: preview as never })).rejects.toThrow(/本会话领域/)
    await workspace.adoptGeneration({ kind: 'new-project', domain: 'interior', preview })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(projectContentHash((await repo.load(base.document.sceneId))!.project)).toBe(projectContentHash(toBundle(preview.project).project))
  }, 30000)

  it('rechecks a processing method replaced while awaiting an executor without publishing a candidate', async () => {
    const { repo, workspace } = await setup(), base = await blank(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const save = vi.spyOn(repo, 'save')
    await expect(workspace.previewInteriorGeneration(base, request(base), profile, { execute: async raw => {
      const result = executeDomainExecutionRequest(raw, { nowMilliseconds: () => 0 })
      vi.spyOn(validation.images, 'decode').mockRejectedValue(new Error('executor changed decoder'))
      return result
    } })).rejects.toThrow('executor changed decoder')
    expect(save).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
  }, 30000)

  it.each(['valid-reader', 'corrupt-reader', 'changed-capability', 'cancelled'] as const)('checks cold publication for %s instead of trusting a repository wrapper', async kind => {
    const { repo, workspace } = await setup(), base = await blank()
    const preview = await workspace.previewInteriorGeneration(base, request(base), profile), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const originalLoad = repo.load.bind(repo), decode = vi.spyOn(validation.images, 'decode'), signal = { aborted: false }
    vi.spyOn(repo, 'load').mockImplementationOnce(async (...args) => {
      const cold = (await originalLoad(...args))!
      decode.mockClear()
      if (kind === 'changed-capability') {
        validation.images.decode = vi.fn(async () => { throw new Error('cold changed decoder') })
        return cold
      }
      if (kind === 'cancelled') { signal.aborted = true; return cold }
      return { project: cloneJson(cold.project), resources: { async read(hash) {
        const bytes = await cold.resources.read(hash)
        if (kind === 'corrupt-reader') bytes[0] ^= 1
        return bytes
      } } }
    })
    // The capability case deliberately replaces the method itself, not a spy's
    // implementation: the actual function identity is part of the certificate.
    try {
      if (kind === 'valid-reader') {
        await workspace.adoptInteriorGeneration(preview, { signal })
        expect(decode).toHaveBeenCalledTimes(1)
        expect(workspace.getState().project!.document.sceneId).toBe(base.document.sceneId)
      } else {
        await expect(workspace.adoptInteriorGeneration(preview, { signal })).rejects.toThrow()
        expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
        if (kind === 'changed-capability') expect(validation.images.decode).toHaveBeenCalledTimes(1)
      }
    } finally { validation.images.decode = decode }
  }, 30000)

  it('rejects a self-consistent rehashed transport proposal at local adoption without saving it', async () => {
    const { repo, workspace } = await setup(), base = await blank(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const save = vi.spyOn(repo, 'save')
    const preview = await workspace.previewGeneration({ kind: 'new-project', domain: 'interior', base, input: request(base), profile }, { execute: async raw => {
      const response = cloneJson(executeDomainExecutionRequest(raw, { nowMilliseconds: () => 0 })) as DomainExecutionResponse<'interior'>
      const result = response.result, candidate = result.candidate
      // Public digests have no authority: a transport can rehash a valid scene.
      const document = cloneJson(candidate.document) as typeof base.document
      document.title = 'transport title with recomputed hashes'
      const stages = cloneJson(candidate.stages).map(row => ({ ...row }))
      const documentHash = hashGenerationValue(document); stages.at(-1)!.afterHash = documentHash
      const changed = { ...candidate, document, documentHash, stages }
      return { ...response, result: { ...result, candidate: changed,
        resultHash: hashGenerationValue({ input: result.input, layout: result.layout, report: result.report, documentHash, outputHash: changed.outputHash, stages }) } }
    } })
    expect(preview.project.document.title).toBe('transport title with recomputed hashes')
    await expect(workspace.adoptGeneration({ kind: 'new-project', domain: 'interior', preview })).rejects.toThrow(/完整重放/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(save).not.toHaveBeenCalled(); expect(await repo.load(base.document.sceneId)).toBeNull()
  }, 30000)

  it('discards an executor response arriving after the workspace baseline changes', async () => {
    const { workspace } = await setup(), base = await blank()
    let deliver!: (response: DomainExecutionResponse) => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let result!: DomainExecutionResponse
    const pending = workspace.previewGeneration({ kind: 'new-project', domain: 'interior', base, input: request(base), profile }, { execute: raw => {
      result = executeDomainExecutionRequest(raw, { nowMilliseconds: () => 0 }); entered()
      return new Promise(resolve => { deliver = resolve })
    } })
    const rejected = expect(pending).rejects.toThrow(/已有修改|基线/)
    await started; await workspace.updateProp('item', { rotationDeg: 23 }); deliver(result)
    await rejected
    expect(workspace.getState().project!.document.props.item.rotationDeg).toBe(23)
  }, 30000)

  it('previews without writes, replays exact identity/resources and saves then cold-opens a full v1 once', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, hash = projectContentHash(toBundle(current).project)
    const base = await blank(), checkpoint = workspace.checkpoint(), save = vi.spyOn(repo, 'save')
    const input = request(base)
    input.parameters.arrangement = { doors: true, entrance: true, furniture: true, doorWidthMm: 1200, clearWidthMm: 900,
      palette: ['table', 'seat', 'work', 'shelf'].map(role => ({ role: role as 'table' | 'seat' | 'work' | 'shelf', ref: { id: 'definition', version: 1 } })) }
    const preview = await workspace.previewInteriorGeneration(base, input, profile)
    expect(save).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(preview.layout.rooms).toHaveLength(2); expect(Object.keys(preview.project.document.rooms)).toHaveLength(2)
    expect(Object.keys(preview.project.document.openings)).toHaveLength(2)
    expect(preview.report.connectivity.routes.every(route => route.status === 'clear')).toBe(true)
    expect(preview.report.furnishing.propIds.length).toBeGreaterThan(0)
    expect(preview.project.schemaVersion).toBe(1); expect(preview.usage.assetBytes).toBeGreaterThan(0)
    expect(preview.usage.metadataRecords).toBeGreaterThan(0)
    expect(Object.values(preview.project.document.rooms).every(room => room.floorStyle?.base.materialRef.id === 'floor-material')).toBe(true)
    await expect(workspace.adoptInteriorGeneration({ ...preview })).rejects.toThrow(/本会话/)
    await workspace.adoptInteriorGeneration(preview)
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][1]).toBeNull()
    const active = workspace.getState().project!, cold = (await repo.load(active.document.sceneId))!
    expect(active.document.sceneId).toBe(base.document.sceneId)
    expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(preview.project).project))
    expect(projectContentHash(toBundle(active).project)).toBe(projectContentHash(cold.project))
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(hash)
    const round = await importProject(await exportProject(cold, validation), validation)
    expect(projectContentHash(round.project)).toBe(projectContentHash(cold.project))
    await expect(workspace.adoptInteriorGeneration(preview)).rejects.toThrow(/已采用/)
    const deleted = preview.report.furnishing.propIds[0], door = preview.report.connectivity.openingIds[0]
    await workspace.execute([{ type: 'deleteProp', id: deleted }, { type: 'deleteOpening', id: door }])
    expect(workspace.getState().project!.document.props[deleted]).toBeUndefined()
    expect(workspace.getState().project!.document.openings[door]).toBeUndefined()
    workspace.undo()
    expect(workspace.getState().project!.document.props[deleted]).toBeDefined()
    workspace.redo(); await workspace.flush()
    const afterDelete = (await repo.load(active.document.sceneId))!
    expect(afterDelete.project.document.props[deleted]).toBeUndefined()
    expect(afterDelete.project.document.openings[door]).toBeUndefined()
    expect(afterDelete.project.document.constraints.pathChecks).toEqual([])
    expect(afterDelete.project.document.constraints.entranceOpeningIds).toEqual([])
  }, 30000)

  it('rejects cancelled, stale and unsupported candidates without changing the current project', async () => {
    const { repo, workspace } = await setup(), base = await blank()
    const cancelled = await workspace.previewInteriorGeneration(base, request(base), profile)
    workspace.cancelInteriorGeneration(cancelled)
    await expect(workspace.adoptInteriorGeneration(cancelled)).rejects.toThrow(/取消/)
    const stale = await workspace.previewInteriorGeneration(base, request(base), profile)
    await workspace.updateProp('item', { rotationDeg: 17 }); await workspace.flush()
    await expect(workspace.adoptInteriorGeneration(stale)).rejects.toThrow(/已有修改|基线/)
    const before = workspace.getState().project!, checkpoint = workspace.checkpoint(), save = vi.spyOn(repo, 'save')
    const unsupported = request(base); unsupported.parameters.floorId = 'missing-floor'
    await expect(workspace.previewInteriorGeneration(base, unsupported, profile)).rejects.toThrow()
    await expect(workspace.previewInteriorGeneration(base, request(base), profile, { signal: { aborted: true } })).rejects.toThrow(/取消/)
    expect(workspace.getState().project).toBe(before); expect(workspace.checkpoint()).toBe(checkpoint); expect(save).not.toHaveBeenCalled()
  }, 30000)

  it.each(['save', 'cold-read'] as const)('preserves the active project when %s fails', async failure => {
    const { repo, workspace } = await setup(), base = await blank(), preview = await workspace.previewInteriorGeneration(base, request(base), profile)
    const before = workspace.getState().project!, checkpoint = workspace.checkpoint()
    if (failure === 'save') vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('quota'))
    else vi.spyOn(repo, 'load').mockResolvedValueOnce(null)
    await expect(workspace.adoptInteriorGeneration(preview)).rejects.toThrow(failure === 'save' ? /quota/ : /冷读/)
    expect(workspace.getState().project).toBe(before); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(workspace.getState().canUndo).toBe(false)
  }, 30000)
})
