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
import { forestRectangle, type ForestGenerationInput } from '../../shared/generation/domains/forest/index.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
const profile = taskBudgetProfile('standard')
async function blank(): Promise<EditableProject> {
  const bundle = fixture({ image: true }), document = cloneJson(bundle.project.document)
  document.sceneId = runtime.ids.nextId(); document.title = '森林与营地'
  for (const id of Object.keys(document.props)) delete document.entityLayers[id]
  document.props = {}; document.propDefinitions.definition.tags = ['tree']
  // A real licensed image fixture with exact immutable physical dimensions.
  document.propDefinitions.definition.defaultVisualBoundsMm = { x: -1000, y: -1000, width: 2000, height: 2000 }
  document.propDefinitions.definition.defaultFootprintMm = { width: 400, height: 400 }
  const content = createCompositionContent(document, runtime), licenseHash = Object.keys(bundle.project.licenses)[0]
  return fromBundle({ project: { ...bundle.project, ...content, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject,
    licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })) }, resources: bundle.resources }, validation)
}
function request(base: EditableProject): ForestGenerationInput {
  const floorId = Object.keys(base.document.floors)[0], layerId = Object.keys(base.document.userLayers)[0], boundsMm = { x: 1000, y: 1000, width: 14000, height: 12000 }
  const supportRef = { kind: 'generated-ground' as const }
  return { version: 1, algorithmVersion: 1, seed: 'forest-workspace-stable', parameters: {
    floorId, layerId, boundsMm, ground: { kind: 'new', elevationMm: 0, materialRef: null },
    zones: [{ id: 'wood', supportRef, boundaryMm: forestRectangle(boundsMm), vegetation: [{ role: 'tree', coveragePpm: 100000, spacingMm: 1000, clusterRadiusMm: 5000, clearanceMm: 200,
      palette: [{ key: 'tree', definitionRef: { id: 'definition', version: 1 }, kind: 'prop', weight: 1 }] }] }],
    clearings: [{ id: 'camp', supportRef, boundaryMm: forestRectangle({ x: 6000, y: 5000, width: 4000, height: 4000 }), anchorMm: { x: 8000, y: 7000 }, clearanceMm: 200 }],
    entrances: [{ id: 'entry', supportRef, positionMm: { x: 2200, y: 7000 }, directionDeg: 0, widthMm: 1600 }],
    routes: [{ id: 'entry-camp', fromEntranceId: 'entry', toClearingId: 'camp', viaMm: [], widthMm: 1600, materialRef: null }],
  } }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})
async function setup() {
  const repo = new ProjectRepository({ name: 'forest-workspace-' + crypto.randomUUID(), runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  return { repo, workspace }
}
describe('forest complete candidate publication', () => {
  it('previews without writes, fully replays and cold-saves an editable v1 with deletion/undo preserved', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, before = projectContentHash(toBundle(current).project), base = await blank()
    const save = vi.spyOn(repo, 'save'), preview = await workspace.previewForestGeneration(base, request(base), profile)
    expect(save).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current)
    expect(preview.report.propIds.length).toBeGreaterThan(0); expect(preview.report.pathIds).toHaveLength(1)
    await expect(workspace.adoptForestGeneration({ ...preview })).rejects.toThrow(/本会话/)
    await workspace.adoptForestGeneration(preview)
    const active = workspace.getState().project!, cold = (await repo.load(active.document.sceneId))!
    expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(preview.project).project))
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(before)
    const round = await importProject(await exportProject(cold, validation), validation)
    expect(projectContentHash(round.project)).toBe(projectContentHash(cold.project))
    const removed = preview.report.propIds[0]
    await workspace.execute([{ type: 'deleteProp', id: removed }])
    expect(workspace.getState().project!.document.props[removed]).toBeUndefined()
    workspace.undo(); expect(workspace.getState().project!.document.props[removed]).toBeDefined()
    workspace.redo(); await workspace.flush()
    const reopened = (await repo.load(active.document.sceneId))!
    expect(reopened.project.document.props[removed]).toBeUndefined()
    expect(Object.values(reopened.project.document.decorationClusters).some(cluster => Object.values(cluster.members).some(member => member.state === 'deleted'))).toBe(true)
  }, 30000)
  it('rejects cancellation, stale or failed publication without replacing the current project', async () => {
    const { repo, workspace } = await setup(), base = await blank()
    const cancelled = await workspace.previewForestGeneration(base, request(base), profile)
    workspace.cancelForestGeneration(cancelled)
    await expect(workspace.adoptForestGeneration(cancelled)).rejects.toThrow(/取消/)
    const stale = await workspace.previewForestGeneration(base, request(base), profile)
    await workspace.updateProp('item', { rotationDeg: 17 }); await workspace.flush()
    await expect(workspace.adoptForestGeneration(stale)).rejects.toThrow(/已有修改|基线/)
    const preview = await workspace.previewForestGeneration(base, request(base), profile), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('quota'))
    await expect(workspace.adoptForestGeneration(preview)).rejects.toThrow(/quota/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    const coldPreview = await workspace.previewForestGeneration(base, request(base), profile)
    vi.spyOn(repo, 'load').mockResolvedValueOnce(null)
    await expect(workspace.adoptForestGeneration(coldPreview)).rejects.toThrow(/冷读/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
  }, 30000)
})
