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
import { cloneJson, canonicalJson } from '../../shared/validation/json.js'
import { forestRectangle } from '../../shared/generation/domains/forest/index.js'
import type { MixedGenerationInput } from '../../shared/generation/domains/mixed/index.js'
import { executeDomainExecutionRequest } from '../../shared/generation/execution.js'
import { projectScene } from '../../shared/projection/projection.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
const profile = taskBudgetProfile('standard')
async function blank(): Promise<EditableProject> {
  const bundle = fixture({ image: true }), document = cloneJson(bundle.project.document)
  document.sceneId = runtime.ids.nextId(); document.title = '真实地面混合工程'
  for (const id of Object.keys(document.props)) delete document.entityLayers[id]
  document.props = {}
  Object.values(document.floors)[0].boundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  document.exportBoundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  const def = document.propDefinitions.definition
  def.tags = ['tree']; def.defaultVisualBoundsMm = { x: -250, y: -250, width: 500, height: 500 }; def.defaultFootprintMm = { width: 300, height: 300 }
  const content = createCompositionContent(document, runtime), licenseHash = Object.keys(bundle.project.licenses)[0]
  return fromBundle({ project: { ...bundle.project, ...content, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject,
    licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })) }, resources: bundle.resources }, validation)
}
function request(base: EditableProject): MixedGenerationInput {
  const floorId = Object.keys(base.document.floors)[0], layerId = Object.keys(base.document.userLayers)[0], boundsMm = { x: 1000, y: 1000, width: 38000, height: 30000 }
  return { version: 1, algorithmVersion: 1, seed: 'mixed-delivery', parameters: {
    outdoor: { kind: 'forest', parameters: { floorId, layerId, boundsMm, ground: { kind: 'new', elevationMm: 1000, materialRef: null },
      zones: [{ id: 'wood', supportRef: { kind: 'generated-ground' }, boundaryMm: forestRectangle(boundsMm), vegetation: [{ role: 'tree', coveragePpm: 100, spacingMm: 2000, clusterRadiusMm: 5000, clearanceMm: 200,
        palette: [{ key: 'tree', definitionRef: { id: 'definition', version: 1 }, kind: 'prop', weight: 1 }] }] }], clearings: [],
      entrances: [{ id: 'entry', supportRef: { kind: 'generated-ground' }, positionMm: { x: 2500, y: 2500 }, directionDeg: 0, widthMm: 1200 }], routes: [],
    } },
    building: { floorId, layerId, boundsMm: { x: 14000, y: 10000, width: 8000, height: 7000 }, wallThicknessMm: 200,
      rooms: [{ id: 'bedroom', purpose: '卧室', minAreaMm2: 8_000_000, maxAreaMm2: 100_000_000, minClearSideMm: 2000 }], relations: [], corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null },
      arrangement: { doors: true, entrance: true, furniture: true, doorWidthMm: 1200, clearWidthMm: 1000, palette: [{ role: 'bed', ref: { id: 'definition', version: 1 } }] } },
    approach: { fromMm: { x: 2500, y: 2500 }, viaMm: [], widthMm: 1000, materialRef: null },
  } }
}
async function setup() {
  const repo = new ProjectRepository({ name: 'mixed-workspace-' + crypto.randomUUID(), runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  return { repo, workspace }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
describe('complete mixed candidate delivery', () => {
  it('uses one public transport preview, local replay, save/cold-read and a portable full project; local furnishing respects a manual deletion', async () => {
    const { repo, workspace } = await setup(), base = await blank(), current = workspace.getState().project!, original = projectContentHash(toBundle(current).project)
    const execute = vi.fn(async raw => executeDomainExecutionRequest(raw, { nowMilliseconds: () => 0 }))
    const preview = await workspace.previewGeneration({ kind: 'new-project', domain: 'mixed', base, input: request(base), profile }, { execute, epoch: 4 })
    expect(workspace.getState().project).toBe(current); expect(execute).toHaveBeenCalledTimes(1)
    const roomId = preview.report.roomIds[0], room = preview.project.document.rooms[roomId]
    expect(room.supportRef).toEqual({ kind: 'terrainArea', id: preview.report.supportAreaId }); expect(room.groundElevationMm).toBe(1000)
    expect(preview.project.document.openings[preview.report.entranceOpeningId]).toBeDefined(); expect(preview.project.document.paths[preview.report.approachPathId]).toBeDefined()
    await expect(workspace.adoptGeneration({ kind: 'new-project', domain: 'mixed', preview: { ...preview } })).rejects.toThrow(/本会话/)
    await workspace.adoptGeneration({ kind: 'new-project', domain: 'mixed', preview })
    expect(execute).toHaveBeenCalledTimes(1)
    const cold = (await repo.load(base.document.sceneId))!
    expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(preview.project).project))
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(original)
    const round = await importProject(await exportProject(cold, validation), validation)
    expect(projectContentHash(round.project)).toBe(projectContentHash(cold.project))
    const furniture = Object.values(workspace.getState().project!.document.props).find(prop => prop.roomId === roomId)!
    expect(furniture).toBeDefined()
    await workspace.execute([{ type: 'deleteProp', id: furniture.id }]); await workspace.flush()
    const manual = workspace.getState().project!, building = canonicalJson(manual.document.rooms)
    const local = await workspace.previewGeneration({ kind: 'current-project', input: { version: 1, operation: 'interior-furniture', recipeId: preview.report.buildingRecipeId, roomId, variation: 'next' } })
    expect(local.project.document.props[furniture.id]).toBeUndefined(); expect(canonicalJson(local.project.document.rooms)).toBe(building)
    // A deleted last slot can yield an empty local candidate, so use a real
    // geometry edit for the one-undo/save proof without inventing a new slot.
    workspace.cancelGeneration({ kind: 'current-project', preview: local })
    workspace.undo(); expect(workspace.getState().project!.document.props[furniture.id]).toBeDefined()
    workspace.redo(); await workspace.flush()
    expect((await repo.load(base.document.sceneId))!.project.document.props[furniture.id]).toBeUndefined()
    const beforeDensity = workspace.getState().project!, originalRule = Object.values(beforeDensity.document.surfaceRules).find(rule => rule.field === 'trees')!
    const density = await workspace.previewGeneration({ kind: 'current-project', input: { version: 1, operation: 'forest-density', recipeId: preview.report.outdoorRecipeId, zoneId: 'wood', role: 'tree', coveragePpm: 500 } })
    const adopted = await workspace.adoptGeneration({ kind: 'current-project', preview: density })
    await adopted.save
    expect(adopted.protection).toBeDefined()
    expect(workspace.getState().project!.document.surfaceRules[originalRule.id]).toMatchObject({ field: 'trees', coveragePpm: 500 })
    expect(workspace.getState().project!.document.props[furniture.id]).toBeUndefined()
    expect(canonicalJson(workspace.getState().project!.document.rooms)).toBe(building)
    workspace.undo()
    expect(workspace.getState().project!.document.surfaceRules[originalRule.id]).toMatchObject({ field: 'trees', coveragePpm: 100 })
    expect(workspace.getState().project!.document.props[furniture.id]).toBeUndefined()
    workspace.redo(); await workspace.flush()
    const finalCold = (await repo.load(base.document.sceneId))!
    expect(finalCold.project.document.surfaceRules[originalRule.id]).toMatchObject({ field: 'trees', coveragePpm: 500 })
    expect(finalCold.project.document.props[furniture.id]).toBeUndefined(); expect(canonicalJson(finalCold.project.document.rooms)).toBe(building)
    const beforePrivate = projectContentHash(toBundle(workspace.getState().project!).project)
    // The fixture has no private-geometry mask. A private room must therefore
    // be rejected instead of exposing it through the otherwise public terrain.
    await expect(workspace.execute([{ type: 'updateRoom', id: roomId, changes: { visibility: 'gm' } }])).rejects.toThrow(/玩家输出不安全/)
    expect(projectContentHash(toBundle(workspace.getState().project!).project)).toBe(beforePrivate)
    expect(projectScene(workspace.getState().project!.document, 'player').rooms.some(room => room.id === roomId)).toBe(true)
  }, 30000)
  it('rejects cancellation, changed baselines and failed cold publication without replacing current edits', async () => {
    const { repo, workspace } = await setup(), base = await blank()
    const cancelled = await workspace.previewGeneration({ kind: 'new-project', domain: 'mixed', base, input: request(base), profile })
    workspace.cancelGeneration({ kind: 'new-project', domain: 'mixed', preview: cancelled })
    await expect(workspace.adoptGeneration({ kind: 'new-project', domain: 'mixed', preview: cancelled })).rejects.toThrow(/取消/)
    const stale = await workspace.previewGeneration({ kind: 'new-project', domain: 'mixed', base, input: request(base), profile })
    await workspace.updateProp('item', { rotationDeg: 11 }); await workspace.flush()
    await expect(workspace.adoptGeneration({ kind: 'new-project', domain: 'mixed', preview: stale })).rejects.toThrow(/已有修改|基线/)
    const preview = await workspace.previewGeneration({ kind: 'new-project', domain: 'mixed', base, input: request(base), profile }), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    vi.spyOn(repo, 'load').mockResolvedValueOnce(null)
    await expect(workspace.adoptGeneration({ kind: 'new-project', domain: 'mixed', preview })).rejects.toThrow(/冷读/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
  }, 30000)
})
