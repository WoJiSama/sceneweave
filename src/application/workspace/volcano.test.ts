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
import type { VolcanoGenerationInput } from '../../shared/generation/domains/volcano/contracts.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
const profile = taskBudgetProfile('standard')
const rect = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
async function blank(): Promise<EditableProject> {
  const bundle = fixture({ image: true }), document = cloneJson(bundle.project.document)
  document.sceneId = runtime.ids.nextId(); document.title = '火山生成'
  for (const id of Object.keys(document.props)) delete document.entityLayers[id]
  document.props = {}
  const bounds = { x: 0, y: 0, width: 32000, height: 24000 }
  document.exportBoundsMm = { ...bounds }; Object.values(document.floors)[0].boundsMm = { ...bounds }
  const asset = document.assets.image
  document.materials['volcano-test-material'] = { id: 'volcano-test-material', catalogId: 'test.volcano-material', version: 1, licenseRef: asset.licenseRef, origin: cloneJson(asset.origin), name: 'Licensed fixture terrain', tags: [], textureAssetId: asset.id, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain', 'path'] }
  const content = createCompositionContent(document, runtime), licenseHash = Object.keys(bundle.project.licenses)[0]
  return fromBundle({ project: { ...bundle.project, ...content, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject,
    licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })) }, resources: bundle.resources }, validation)
}
function request(base: EditableProject): VolcanoGenerationInput {
  const floorId = Object.keys(base.document.floors)[0], layerId = Object.keys(base.document.userLayers)[0]
  const material = { id: 'volcano-test-material', version: 1 }
  return { version: 1, algorithmVersion: 1, seed: 'volcano-workspace-stable', parameters: {
    floorId, layerId, boundsMm: { x: 0, y: 0, width: 32000, height: 24000 }, groundElevationMm: 0,
    mountain: { boundaryMm: rect(8000, 4000, 18000, 16000), elevationMm: 2000 },
    crater: { boundaryMm: rect(15000, 9000, 7000, 7000), elevationMm: 500, hazard: true, blocksMovement: false, movementCostMultiplier: 2 },
    platform: { boundaryMm: rect(10000, 10000, 3000, 4000), anchorMm: { x: 11500, y: 12000 } },
    entrance: { positionMm: { x: 3000, y: 7000 }, directionDeg: 0 },
    ascent: { kind: 'stairs', fromMm: { x: 6500, y: 7000 }, toMm: { x: 9500, y: 7000 } },
    descent: { kind: 'ramp', fromMm: { x: 13500, y: 12000 }, toMm: { x: 16500, y: 12000 } },
    route: { widthMm: 1500, toPlatformViaMm: [{ x: 11500, y: 7000 }], toCraterViaMm: [] },
    flow: null, regions: [], materials: { ground: material, mountain: material, crater: material, platform: material, flow: material, route: material },
  } }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
async function setup() {
  const repo = new ProjectRepository({ name: 'volcano-workspace-' + crypto.randomUUID(), runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  return { repo, workspace }
}
describe('volcano complete candidate publication', () => {
  it('previews privately, replays and cold-saves editable v1; later manual hazard changes survive undo and cold-open', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, before = projectContentHash(toBundle(current).project), base = await blank()
    const save = vi.spyOn(repo, 'save'), preview = await workspace.previewVolcanoGeneration(base, request(base), profile)
    expect(save).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current)
    expect(preview.report.connectionIds).toHaveLength(2); expect(preview.report.regionIds.length).toBeGreaterThan(0)
    await expect(workspace.adoptVolcanoGeneration({ ...preview })).rejects.toThrow(/本会话/)
    await workspace.adoptVolcanoGeneration(preview)
    const active = workspace.getState().project!, cold = (await repo.load(active.document.sceneId))!
    expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(preview.project).project))
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(before)
    const round = await importProject(await exportProject(cold, validation), validation)
    expect(projectContentHash(round.project)).toBe(projectContentHash(cold.project))
    const changed = preview.report.regionIds[0]
    await workspace.execute([{ type: 'updateRegion', id: changed, changes: { kind: 'terrain', movementCostMultiplier: 1 } }])
    expect(workspace.getState().project!.document.regions[changed].kind).toBe('terrain')
    workspace.undo(); expect(workspace.getState().project!.document.regions[changed].kind).toBe('hazard')
    workspace.redo(); await workspace.flush()
    const reopened = (await repo.load(active.document.sceneId))!
    expect(reopened.project.document.regions[changed]).toMatchObject({ kind: 'terrain', movementCostMultiplier: 1 })
  }, 30000)
  it('rejects cancelled, stale and failed save/cold-read candidates without replacing the current project', async () => {
    const { repo, workspace } = await setup(), base = await blank()
    const cancelled = await workspace.previewVolcanoGeneration(base, request(base), profile)
    workspace.cancelVolcanoGeneration(cancelled)
    await expect(workspace.adoptVolcanoGeneration(cancelled)).rejects.toThrow(/取消/)
    const stale = await workspace.previewVolcanoGeneration(base, request(base), profile)
    await workspace.updateProp('item', { rotationDeg: 17 }); await workspace.flush()
    await expect(workspace.adoptVolcanoGeneration(stale)).rejects.toThrow(/已有修改|基线/)
    const preview = await workspace.previewVolcanoGeneration(base, request(base), profile), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('quota'))
    await expect(workspace.adoptVolcanoGeneration(preview)).rejects.toThrow(/quota/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    const coldPreview = await workspace.previewVolcanoGeneration(base, request(base), profile)
    vi.spyOn(repo, 'load').mockResolvedValueOnce(null)
    await expect(workspace.adoptVolcanoGeneration(coldPreview)).rejects.toThrow(/冷读/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
  }, 30000)
})
