import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { addPropAppearanceSource, createCompositionContent } from '../../shared/appearance/graph.js'
import { applyCompositionDraftCommands } from '../../shared/appearance/commands.js'
import { emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { planTerrainDressing } from '../../shared/visual/terrain-dressing.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { canonicalJson, cloneJson } from '../../shared/validation/json.js'
import { captureEditableDraft, fromBundle, toBundle, type EditableProject } from './project.js'
import { prepareCompositionCommands } from './prepare.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'

vi.mock('../../shared/visual/terrain-dressing.js', () => ({ planTerrainDressing: vi.fn() }))
const repos: ProjectRepository[] = [], sessions: Workspace[] = [], names: string[] = []
afterEach(async () => {
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
  vi.clearAllMocks(); vi.restoreAllMocks()
})
async function setup() {
  const input = fixture({ image: true }), document = emptyTerrainDocument({ ...input.project.document, schemaVersion: 2, visual: emptyVisualSystem() })
  const content = createCompositionContent(document, runtime)
  const current = await fromBundle({ ...input, project: { ...input.project, schemaVersion: 3, ...content } }, validation)
  const name = `terrain-dressing-workspace-${crypto.randomUUID()}`, repo = new ProjectRepository({ name, runtime, validation })
  repos.push(repo); names.push(name)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(current)
  return { workspace, repo, current: workspace.getState().project! }
}
function appended(current: EditableProject) {
  const catalog = captureEditableDraft(current), asset = cloneJson(catalog.document.assets.image), original = catalog.document.propDefinitions.definition
  const assetId = 'dressing-image', definitionId = 'dressing-definition'
  catalog.document.assets[assetId] = { ...asset, id: assetId, logicalSizeMm: { width: 400, height: 600 } }
  const definition = { ...cloneJson(original), id: definitionId, catalogId: 'prop.test.terrain-dressing',
    defaultAppearance: { kind: 'image' as const, assetId, tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -200, y: -300, width: 400, height: 600 },
    defaultFootprintMm: { width: 100, height: 100 }, defaultFootprintOffsetMm: { x: 0, y: 0 } }
  catalog.document.propDefinitions[definitionId] = definition
  const baseBinding = catalog.licenseBindings[0]
  catalog.licenseBindings.push({ ...baseBinding, subjectKind: 'asset', subjectId: assetId }, { ...baseBinding, subjectKind: 'propDefinition', subjectId: definitionId })
  addPropAppearanceSource(catalog.appearance, { definitionRef: { id: definitionId, version: 1 }, appearance: definition.defaultAppearance,
    visualBoundsMm: definition.defaultVisualBoundsMm, shadowClass: definition.defaultShadowClass, shadowOverride: null }, null,
  { mode: 'nearSide', rootAnchorMm: { x: 0, y: 180 }, orientation: 'fixedUpright', fixedRotationDeg: 0, footprintAxes: 'world', groundShadowMm: [{ x: -50, y: -50 }, { x: 250, y: -50 }, { x: 250, y: 50 }, { x: -50, y: 50 }] })
  return catalog
}
function request(current: EditableProject) { return { sceneId: current.document.sceneId, floorId: Object.keys(current.document.floors)[0], seed: 'dressing-application-test' } }
function plan(current: EditableProject, commands: CompositionCommand[] = [{ type: 'addProp', id: 'new-dressing', floorId: Object.keys(current.document.floors)[0],
  layerId: current.document.entityLayers.item, definitionRef: { id: 'dressing-definition', version: 1 }, positionMm: { x: 12000, y: 12000 }, supportRef: { kind: 'floor', id: Object.keys(current.document.floors)[0] }, rotationDeg: 0 }]) {
  const result = { commands, input: request(current), report: { boundaryIds: [], groupIds: [], preservedIds: ['item'], notes: ['unit planner recipe'] } }
  vi.mocked(planTerrainDressing).mockReturnValue(result)
  return result
}

describe('terrain dressing stays one ordinary protected workspace preview', () => {
  it('appends fixed sources and prepares commands without writing, then adopts once with undo and exact cold storage', async () => {
    const { workspace, repo, current } = await setup(), catalog = appended(current), raw = request(current), recipe = plan(current)
    const currentBefore = canonicalJson(toBundle(current).project), catalogBefore = canonicalJson(toBundle(catalog).project), checkpoint = workspace.checkpoint()
    const wrapper = await workspace.previewTerrainDressing(catalog, raw, { checkpoint })
    expect(workspace.getState().project).toBe(current); expect(workspace.getState().canUndo).toBe(false)
    expect(planTerrainDressing).toHaveBeenCalledWith({ document: expect.objectContaining({ propDefinitions: expect.objectContaining({ 'dressing-definition': expect.anything() }) }), appearance: expect.objectContaining({ presentations: expect.anything() }) }, raw)
    expect(wrapper.preview.commands).toEqual(recipe.commands); expect(wrapper.report).toEqual(recipe.report)
    expect(wrapper.cost.total).toBeGreaterThan(1); expect(wrapper.cost).toMatchObject({ limit: 256 })
    expect(wrapper.preview.document.props['new-dressing'].rotationDeg).toBe(0)
    expect(canonicalJson(toBundle(catalog).project)).toBe(catalogBefore); expect(canonicalJson(toBundle(current).project)).toBe(currentBefore)
    await workspace.adoptPreview(wrapper.preview)
    expect(workspace.getDocument()!.revision).toBe(current.document.revision + 1)
    expect(workspace.getDocument()!.props.item).toEqual(current.document.props.item)
    await expect(workspace.adoptPreview(wrapper.preview)).rejects.toThrow(/重复采用/)
    await workspace.flush()
    const cold = await repo.load(current.document.sceneId)
    expect(projectContentHash(cold!.project)).toBe(projectContentHash(toBundle(workspace.getState().project!).project))
    expect(cold!.project.appearance.presentations).toEqual(workspace.getState().project!.appearance.presentations)
    workspace.undo(); expect(workspace.getDocument()!.props['new-dressing']).toBeUndefined()
    workspace.redo(); expect(workspace.getDocument()!.props['new-dressing']).toBeDefined()
  })

  it.each(['scene', 'identity', 'definition', 'source'] as const)('rejects catalog mutation of existing %s before the planner can alter anything', async kind => {
    const { workspace, current } = await setup(), catalog = appended(current); plan(current)
    if (kind === 'scene') catalog.document.title += ' forged'
    else if (kind === 'identity') catalog.historyIdentity.lineageId += '-forged'
    else if (kind === 'definition') catalog.document.propDefinitions.definition.name += ' forged'
    else catalog.document.assets.image.logicalSizeMm.width += 1
    const before = canonicalJson(toBundle(workspace.getState().project!).project)
    await expect(workspace.previewTerrainDressing(catalog, request(current))).rejects.toThrow()
    expect(planTerrainDressing).not.toHaveBeenCalled(); expect(canonicalJson(toBundle(workspace.getState().project!).project)).toBe(before)
  })

  it('still rejects arbitrary prepared scene changes while allowing append-only fixed presentation roots', async () => {
    const { workspace, current } = await setup(), catalog = appended(current)
    const importPreview = await workspace.previewPrepared(catalog)
    expect(importPreview.document.props).toEqual(current.document.props); workspace.cancelPreview(importPreview)
    catalog.document.props.item.positionMm.x += 100
    await expect(workspace.previewPrepared(catalog)).rejects.toThrow(/只能新增固定素材/)
  })

  it('rejects combined source additions plus a cumulative change-then-restore batch even when its final entity delta is zero', async () => {
    const { workspace, current } = await setup(), catalog = appended(current), rotation = current.document.props.item.rotationDeg
    const commands: CompositionCommand[] = Array.from({ length: 256 }, (_, index) => ({ type: 'updateProp', id: 'item', changes: { rotationDeg: index % 2 ? rotation : (rotation + 1) % 360 } }))
    plan(current, commands)
    const before = canonicalJson(toBundle(workspace.getState().project!).project)
    await expect(workspace.previewTerrainDressing(catalog, request(current))).rejects.toThrow(/256/)
    expect(canonicalJson(toBundle(workspace.getState().project!).project)).toBe(before)
  })

  it('rejects oversized catalog additions before planning, rather than treating fixed source records as free', async () => {
    const { workspace, current } = await setup(), catalog = appended(current); plan(current)
    const original = catalog.document.propDefinitions.definition, binding = catalog.licenseBindings.find(row => row.subjectId === 'definition')!
    for (let index = 0; index < 130; index++) {
      const id = `extra-fixed-${index}`
      catalog.document.propDefinitions[id] = { ...cloneJson(original), id, catalogId: `test.extra.${index}` }
      catalog.licenseBindings.push({ ...binding, subjectId: id })
    }
    await expect(workspace.previewTerrainDressing(catalog, request(current))).rejects.toThrow(/256/)
    expect(planTerrainDressing).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current)
  })

  it('honors pre-abort, cancellation after planning, and stale adoption without changing current work', async () => {
    const { workspace, current } = await setup(), catalog = appended(current), abort = new AbortController(); plan(current); abort.abort()
    await expect(workspace.previewTerrainDressing(catalog, request(current), { signal: abort.signal })).rejects.toThrow()
    expect(planTerrainDressing).not.toHaveBeenCalled()
    const during = new AbortController(), recipe = plan(current)
    vi.mocked(planTerrainDressing).mockImplementationOnce(() => { during.abort(); return recipe })
    await expect(workspace.previewTerrainDressing(catalog, request(current), { signal: during.signal })).rejects.toThrow()
    expect(workspace.getState().project).toBe(current)
    const wrapper = await workspace.previewTerrainDressing(catalog, request(current))
    await workspace.execute([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 15 } }])
    await expect(workspace.adoptPreview(wrapper.preview)).rejects.toThrow(/已有修改/)
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(15)
  })

  it('validates internal initial costs before even an empty batch and reports successful cumulative costs without changing default output', async () => {
    const { current } = await setup(), content = { document: current.document, historyIdentity: current.historyIdentity, appearance: current.appearance }
    for (const initialOperationCost of [-1, 257, 1.5, Number.NaN, null as unknown as number]) expect(() => applyCompositionDraftCommands(content, [], runtime, { initialOperationCost })).toThrow(/预算/)
    const receipt = vi.fn(), commands: CompositionCommand[] = [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 10 } }, { type: 'updateProp', id: 'item', changes: { rotationDeg: current.document.props.item.rotationDeg } }]
    const normal = await prepareCompositionCommands(current, commands, { runtime, validation })
    const counted = await prepareCompositionCommands(current, commands, { runtime, validation, initialOperationCost: 254, onOperationCost: receipt })
    expect(counted.document).toEqual(normal.document); expect(receipt).toHaveBeenCalledWith(256)
    await expect(prepareCompositionCommands(current, commands, { runtime, validation, initialOperationCost: 255 })).rejects.toThrow(/256/)
  })
})
