import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from './workspace.js'
import { prepareVolcanoProject } from './volcano.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { taskBudgetProfile } from '../../shared/budget/task-budget.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { canonicalJson, cloneJson } from '../../shared/validation/json.js'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../../shared/terrain-generation/integrity.js'
import type { VolcanoGenerationInput } from '../../shared/generation/domains/volcano/contracts.js'
import type { LocalGenerationRequest } from '../../shared/generation/local.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
const profile = taskBudgetProfile('standard')
const rect = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const craterRing = (radiusMm: number) => Array.from({ length: 64 }, (_, index) => ({
  x: 18500 + Math.round(radiusMm * Math.cos(index * Math.PI / 32)), y: 12500 + Math.round(radiusMm * Math.sin(index * Math.PI / 32)),
}))
async function blank(): Promise<EditableProject> {
  const bundle = fixture({ image: true }), document = cloneJson(bundle.project.document)
  document.sceneId = runtime.ids.nextId(); document.title = '局部生成'
  for (const id of Object.keys(document.props)) delete document.entityLayers[id]
  document.props = {}
  const bounds = { x: 0, y: 0, width: 32000, height: 24000 }
  document.exportBoundsMm = { ...bounds }; Object.values(document.floors)[0].boundsMm = { ...bounds }
  const asset = document.assets.image
  for (const id of ['volcano-test-material', 'volcano-local-material']) document.materials[id] = {
    id, catalogId: `test.${id}`, version: 1, licenseRef: asset.licenseRef, origin: cloneJson(asset.origin), name: id, tags: [],
    textureAssetId: asset.id, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain', 'path'],
  }
  const content = createCompositionContent(document, runtime), licenseHash = Object.keys(bundle.project.licenses)[0]
  return fromBundle({ project: { ...bundle.project, ...content, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject,
    licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })) }, resources: bundle.resources }, validation)
}
function request(base: EditableProject, dense = false): VolcanoGenerationInput {
  const floorId = Object.keys(base.document.floors)[0], layerId = Object.keys(base.document.userLayers)[0], material = { id: 'volcano-test-material', version: 1 }
  return { version: 1, algorithmVersion: 1, seed: 'volcano-local-workspace', parameters: {
    floorId, layerId, boundsMm: { x: 0, y: 0, width: 32000, height: 24000 }, groundElevationMm: 0,
    mountain: { boundaryMm: rect(8000, 4000, 18000, 16000), elevationMm: 2000 },
    crater: { boundaryMm: dense ? craterRing(3000) : rect(15000, 9000, 7000, 7000), elevationMm: 500, hazard: true, blocksMovement: false, movementCostMultiplier: 2 },
    platform: { boundaryMm: rect(10000, 10000, 3000, 4000), anchorMm: { x: 11500, y: 12000 } },
    entrance: { positionMm: { x: 3000, y: 7000 }, directionDeg: 0 },
    ascent: { kind: 'stairs', fromMm: { x: 6500, y: 7000 }, toMm: { x: 9500, y: 7000 } },
    descent: { kind: 'ramp', fromMm: { x: 13500, y: 12000 }, toMm: { x: 16500, y: 12000 } },
    route: { widthMm: 1500, toPlatformViaMm: [{ x: 11500, y: 7000 }], toCraterViaMm: [] }, flow: null, regions: [],
    materials: { ground: material, mountain: material, crater: material, platform: material, flow: material, route: material },
  } }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
async function setup(dense = false) {
  const repo = new ProjectRepository({ name: 'generation-local-' + crypto.randomUUID(), runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  const base = await blank(), generated = await prepareVolcanoProject(base, request(base, dense), { runtime, validation, profile })
  const recipeId = Object.values(getLegacyGeneration(generated.project.document)!.recipes).find(row => 'domain' in row && row.domain === 'volcano')!.id
  const areaId = generated.report.craterAreaId
  let project = generated.project
  if (dense) {
    // Retain many finite overlay boundaries in the crater source so a
    // material-only local write has a real full metadata expansion above 256.
    const data = cloneJson(toBundle(project).project), area = data.document.terrainAreas[areaId], sourceId = data.appearance.surfaceSources[areaId], source = sourceId && data.appearance.sources[sourceId]
    if (!area.surfaceStyle || !source || source.kind !== 'surface') throw new Error('dense budget fixture missing crater surface')
    const basePaint = cloneJson(area.surfaceStyle.base)
    area.surfaceStyle.overlays = Array.from({ length: 80 }, (_, index) => ({
      id: `budget-overlay-${index}`,
      boundaryMm: rect(15010 + (index % 8) * 800, 9010 + Math.floor(index / 8) * 600, 500, 350),
      paint: cloneJson(basePaint), blendWidthMm: 10, renderOrder: index,
    }))
    source.snapshot = cloneJson(area.surfaceStyle)
    for (const rule of Object.values(data.document.generation.legacy.rules)) {
      rule.inputHash = generationInputHash(data.document, rule)
      rule.managedOutputHash = managedOutputHash(data.document, rule)
    }
    // This is a new test fixture before its first save, not a production edit.
    Object.assign(data, createCompositionContent(data.document, runtime))
    project = await fromBundle({ project: data, resources: project.resources }, validation)
  }
  await workspace.adoptNew(project)
  const material: LocalGenerationRequest = { version: 1, operation: 'volcano-material', recipeId, areaId, materialRef: { id: 'volcano-local-material', version: 1 } }
  const boundary: LocalGenerationRequest = { version: 1, operation: 'volcano-boundary', recipeId, areaId, positionsMm: dense ? craterRing(3100) : rect(15000, 9000, 8000, 7000) }
  return { repo, workspace, material, boundary, areaId }
}
describe('bounded domain local generation lifecycle', () => {
  it('privately previews exact full changes, replays and adopts a material with one undo unit and cold preservation', async () => {
    const { repo, workspace, material, areaId } = await setup(), before = workspace.getState().project!, checkpoint = workspace.checkpoint(), save = vi.spyOn(repo, 'saveSnapshot')
    const decode = vi.spyOn(validation.images, 'decode')
    const preview = await workspace.previewLocalGeneration(material, { budget: taskBudgetProfile('expanded') })
    expect(save).not.toHaveBeenCalled(); expect(decode).toHaveBeenCalled()
    expect(workspace.getState().project).toBe(before); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(preview.cost.total).toBeGreaterThan(1); expect(preview.cost.limit).toBe(256); expect(preview.cost.total).toBeLessThanOrEqual(256)
    expect(preview.changes.some(change => change.collection === 'appearance.sources')).toBe(true)
    expect(preview.changes.some(change => change.collection === 'appearance.surfaceSources' && change.id === areaId)).toBe(true)
    expect(preview.writeIds).toContain(areaId); expect(preview.readIds).toContain(material.recipeId)
    const replay = await workspace.previewLocalGeneration(material, { budget: taskBudgetProfile('expanded') })
    expect(projectContentHash(toBundle(replay.project).project)).toBe(projectContentHash(toBundle(preview.project).project))
    await expect(workspace.adoptLocalGeneration({ ...preview })).rejects.toThrow(/本会话/)
    const snapshot = vi.spyOn(repo, 'createSnapshot'), check = vi.spyOn(repo, 'checkProtection'), adopted = await workspace.adoptLocalGeneration(preview)
    await adopted.save
    expect(snapshot).toHaveBeenCalledTimes(1); expect(check).toHaveBeenCalledTimes(1)
    const active = workspace.getState().project!, original = before.document.terrainAreas[areaId], result = active.document.terrainAreas[areaId]
    expect(result.surfaceStyle!.base.materialRef.id).toBe('volcano-local-material')
    expect({ ...result, surfaceStyle: original.surfaceStyle }).toEqual(original)
    expect(active.document.regions).toEqual(before.document.regions); expect(active.document.terrainConnections).toEqual(before.document.terrainConnections)
    expect(active.historyIdentity).toEqual(before.historyIdentity)
    expect(active.appearance.sources[before.appearance.surfaceSources[areaId]]).toEqual(before.appearance.sources[before.appearance.surfaceSources[areaId]])
    const owner = Object.values(getLegacyGeneration(active.document)!.ownership).find(row => row.target.entityId === areaId)!
    expect(owner.state).toBe('managed'); expect(owner.manualFields).not.toContain('surface')
    const cold = (await repo.load(active.document.sceneId))!
    expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(active).project))
    expect(active.document.revision).toBe(before.document.revision + 1)
    workspace.undo(); expect(workspace.getDocument()!.terrainAreas[areaId].surfaceStyle).toEqual(original.surfaceStyle)
    workspace.redo(); expect(workspace.getDocument()!.terrainAreas[areaId].surfaceStyle).toEqual(result.surfaceStyle)
    expect(workspace.getDocument()!.revision).toBe(before.document.revision + 3)
    await workspace.flush(); await expect(workspace.adoptLocalGeneration(preview)).rejects.toThrow(/采用/)
  }, 30000)

  it('adopts a real same-topology crater update while keeping current identities and outside physical state', async () => {
    const { repo, workspace, boundary, areaId } = await setup(), before = workspace.getState().project!, preview = await workspace.previewLocalGeneration(boundary)
    expect(preview.document.terrainAreas[areaId].boundaryMm.map(point => point.positionMm)).toEqual(boundary.operation === 'volcano-boundary' ? boundary.positionsMm : [])
    expect(preview.document.terrainAreas[areaId].boundaryMm.map(point => [point.id, point.segmentId])).toEqual(before.document.terrainAreas[areaId].boundaryMm.map(point => [point.id, point.segmentId]))
    expect(preview.project.historyIdentity).toEqual(before.historyIdentity)
    expect(preview.document.paths).toEqual(before.document.paths); expect(preview.document.terrainConnections).toEqual(before.document.terrainConnections)
    const adopted = await workspace.adoptLocalGeneration(preview); await adopted.save
    expect((await repo.load(before.document.sceneId))!.project.document.terrainAreas[areaId].boundaryMm).toEqual(preview.document.terrainAreas[areaId].boundaryMm)
    const second = await workspace.previewLocalGeneration({ ...boundary, operation: 'volcano-boundary', positionsMm: rect(15000, 9000, 7500, 7000) })
    expect(second.result.writes.some(write => write.entityId === areaId && write.fields.includes('geometry'))).toBe(true)
    workspace.cancelLocalGeneration(second)
    const ring = cloneJson(workspace.getDocument()!.terrainAreas[areaId].boundaryMm)
    const a = ring[1].positionMm, b = ring[2].positionMm
    ring.splice(2, 0, { id: 'manual-crater-point', segmentId: 'manual-crater-segment', positionMm: { x: a.x, y: Math.round((a.y + b.y) / 2) } })
    await workspace.execute([{ type: 'updateTerrainArea', id: areaId, changes: { boundaryMm: ring } }]); await workspace.flush()
    workspace.undo(); await workspace.flush()
    expect(workspace.getDocument()!.terrainAreas[areaId].boundaryMm).toEqual(preview.document.terrainAreas[areaId].boundaryMm)
    await expect(workspace.previewLocalGeneration({ ...boundary, operation: 'volcano-boundary', positionsMm: rect(15000, 9000, 7500, 7000) })).rejects.toThrow(/人工/)
  }, 30000)

  it('refuses stale/cancelled or failed protection candidates before changing the current branch', async () => {
    const { repo, workspace, material, areaId } = await setup(), before = workspace.getState().project!, cancelled = await workspace.previewLocalGeneration(material)
    workspace.cancelLocalGeneration(cancelled); await expect(workspace.adoptLocalGeneration(cancelled)).rejects.toThrow(/取消/)
    const stale = await workspace.previewLocalGeneration(material)
    await workspace.execute([{ type: 'updateTerrainArea', id: areaId, changes: { movementCostMultiplier: 3 } }]); await workspace.flush()
    await expect(workspace.adoptLocalGeneration(stale)).rejects.toThrow(/修改|基线/)
    const current = workspace.getState().project!, preview = await workspace.previewLocalGeneration(material)
    vi.spyOn(repo, 'checkProtection').mockRejectedValueOnce(new Error('local metadata moved'))
    await expect(workspace.adoptLocalGeneration(preview)).rejects.toThrow(/metadata moved/)
    expect(workspace.getState().project).toBe(current)
    expect(workspace.getDocument()!.terrainAreas[areaId].surfaceStyle).toEqual(before.document.terrainAreas[areaId].surfaceStyle)
  }, 30000)

  it('observes cancellation during adoption and retains undo/current memory when the final save fails', async () => {
    const { repo, workspace, material } = await setup(), before = workspace.getState().project!, preview = await workspace.previewLocalGeneration(material)
    const originalCheck = repo.checkProtection.bind(repo)
    vi.spyOn(repo, 'checkProtection').mockImplementationOnce(async (...args) => { workspace.cancelLocalGeneration(preview); return originalCheck(...args) })
    await expect(workspace.adoptLocalGeneration(preview)).rejects.toThrow(/取消/)
    expect(workspace.getState().project).toBe(before)
    const second = await workspace.previewLocalGeneration(material)
    vi.spyOn(repo, 'saveSnapshot').mockRejectedValueOnce(new Error('local quota'))
    const adopted = await workspace.adoptLocalGeneration(second); await expect(adopted.save).rejects.toThrow(/quota/)
    expect(workspace.getState().status).toBe('error'); expect(workspace.getState().canUndo).toBe(true)
    expect((await repo.load(before.document.sceneId))!.project.document.revision).toBe(before.document.revision)
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(before.document.revision + 2)
    expect(canonicalJson(workspace.getDocument()!.terrainAreas)).toBe(canonicalJson(before.document.terrainAreas))
    await workspace.retry()
  }, 30000)

  it('refuses full appearance expansion beyond ordinary256 even with an expanded search profile', async () => {
    const { repo, workspace, material } = await setup(true), current = workspace.getState().project!, checkpoint = workspace.checkpoint(), snapshot = vi.spyOn(repo, 'createSnapshot')
    await expect(workspace.previewLocalGeneration(material, { budget: taskBudgetProfile('expanded') })).rejects.toThrow(/256/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint); expect(snapshot).not.toHaveBeenCalled()
  }, 30000)

})
