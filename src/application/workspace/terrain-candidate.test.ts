import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from './workspace.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { fixture, NOW, pixelPng, runtime, validation } from './test-fixtures.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import type { ProjectBundle } from '../../shared/model/project.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { projectContentHash, validateProjectData } from '../../shared/project/validate.js'
import { cloneJson, encodeUtf8 } from '../../shared/validation/json.js'
import { emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import { assertTerrainBudget, terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { TERRAIN_FIXED_SEEDS } from '../../shared/terrain-generation/generate.js'
import { TASK_BUDGET_PROFILES, taskSemanticTargets } from '../../shared/budget/task-budget.js'
import { prepareBaseMapRequestV3, executeBaseMapRequestV3 } from '../../shared/terrain-generation/base-map-v3.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

/** Real PNG/pixel/license closure; these tests isolate transactions, not art quality. */
async function refinedBase(): Promise<EditableProject> {
  const document = cloneJson(createRefinedBlankDocument('island', {
    title: 'Terrain candidate fixture', sceneId: runtime.ids.nextId(), now: NOW,
    widthMm: 24000, heightMm: 18000, preset: 'narrative',
  }))
  const bytes = pixelPng([74, 108, 61, 255]), hash = sha256Bytes(bytes)
  for (const asset of Object.values(document.assets)) {
    asset.sha256 = hash; asset.mimeType = 'image/png'; asset.pixelWidth = 1; asset.pixelHeight = 1
  }
  const content = createCompositionContent(document, runtime)
  const text = 'Sceneweave original deterministic terrain transaction fixture', licenseHash = sha256Bytes(encodeUtf8(text))
  const bundle: ProjectBundle = {
    project: {
      format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
      assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 } },
      licenses: { [licenseHash]: { sha256: licenseHash, text } },
      licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({
        ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed',
      })),
      authoringSources: {},
    },
    resources: createMemoryResources(new Map([[hash, bytes]])),
  }
  return fromBundle(bundle, validation)
}

async function setup() {
  const repo = new ProjectRepository({ name: `terrain-candidate-${crypto.randomUUID()}`, runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  return { repo, workspace }
}

async function candidate(workspace: Workspace) {
  const base = await refinedBase()
  const profile = TASK_BUDGET_PROFILES.small
  const request = prepareBaseMapRequestV3({ requestId: crypto.randomUUID(), flowId: crypto.randomUUID(),
    workspaceSceneId: workspace.getDocument()?.sceneId ?? 'empty-workspace', checkpoint: workspace.checkpoint(),
    operationEpoch: 1, base: base.document, profile, generation: { kind: 'terrain', input: {
      sceneId: base.document.sceneId, kind: 'island', seed: TERRAIN_FIXED_SEEDS[0], algorithmVersion: 4,
      budgetProfileId: profile.profileId, quality: 'standard',
    } } })
  const preview = await workspace.previewBaseMapGeneration(base, request, executeBaseMapRequestV3(request), {
    source: 'worker', generationExecution: { startedAt: NOW, activeRuntimeMs: 1, generationCalls: 1 },
  })
  return { base, preview }
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

describe('T1 terrain candidate ownership and atomic independent adoption', () => {
  it('previews a fully validated current v1 without installing, saving or changing the current checkpoint', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const currentHash = projectContentHash(toBundle(current).project), list = await repo.list(), saving = vi.spyOn(repo, 'save')
    const { base, preview } = await candidate(workspace)
    expect(Object.keys(base.assets)).toHaveLength(1)
    expect(Object.values(base.assets)[0]).toMatchObject({ pixelWidth: 1, pixelHeight: 1 })
    expect(Object.keys(base.authoringSources)).toHaveLength(0)
    expect(preview.project.schemaVersion).toBe(1)
    expect(preview.project.document).toMatchObject({ schemaVersion: 1, mapMode: 'scene', regional: null })
    expect(preview.project.document.visual).toMatchObject({ version: 3, base: { version: 2, base: { version: 1 }, materializedEdges: {} }, transitions: {} })
    expect(preview.project.historyIdentity.version).toBe(5); expect(preview.project.appearance.version).toBe(2)
    expect(preview.currentSceneId).toBe(current.document.sceneId); expect(preview.currentRevision).toBe(current.document.revision)
    expect(preview.checkpoint).toBe(checkpoint)
    expect(preview.project.document.sceneId).toBe(base.document.sceneId)
    expect(preview.project.document.sceneId).not.toBe(current.document.sceneId)
    const empty = emptyTerrainDocument(base.document)
    const targets = taskSemanticTargets(empty, preview.project.document)
    expect(preview.cost).toEqual({ items: Object.fromEntries(targets.map(target => [target, 1])), total: targets.length, limit: TASK_BUDGET_PROFILES.small.semanticTargets })
    expect(preview.baseMap?.budgetProfile).toEqual(TASK_BUDGET_PROFILES.small)
    expect(preview.baseMap?.budgetUsage?.assetBytes).toBeGreaterThan(0)
    expect(preview.cost.total).toBeLessThanOrEqual(TASK_BUDGET_PROFILES.small.semanticTargets)
    expect(preview.cost.total).toBe(preview.baseMap?.initialOperationCost)
    expect(preview.baseMap?.budgetUsage?.semanticTargets).toBe(preview.cost.total)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(saving).not.toHaveBeenCalled(); expect(await repo.list()).toEqual(list)
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(currentHash)
    expect(await repo.load(preview.project.document.sceneId)).toBeNull()
    workspace.cancelTerrainGeneration(preview)
  })

  it('cancels a private candidate without persisting or replacing the current project', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const { preview } = await candidate(workspace), saving = vi.spyOn(repo, 'save')
    workspace.cancelTerrainGeneration(preview)
    await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow(/取消|采用|本会话/)
    expect(saving).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current)
    expect(workspace.checkpoint()).toBe(checkpoint); expect(await repo.load(preview.project.document.sceneId)).toBeNull()
  })

  it('rejects a copied wrapper and adopts the authentic candidate exactly once after real current-v1 cold read', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const sourceHash = projectContentHash(toBundle(current).project), { preview } = await candidate(workspace)
    const saving = vi.spyOn(repo, 'save'), loading = repo.load.bind(repo), coldRead = vi.spyOn(repo, 'load')
    const forged = Object.freeze({ ...preview })
    workspace.cancelTerrainGeneration(forged)
    await expect(workspace.adoptTerrainGeneration(forged)).rejects.toThrow(/本会话/)
    expect(saving).not.toHaveBeenCalled(); expect(coldRead).not.toHaveBeenCalled()
    await workspace.adoptTerrainGeneration(preview)
    expect(saving).toHaveBeenCalledTimes(1)
    expect(saving.mock.calls[0][0].project.document.sceneId).toBe(preview.project.document.sceneId)
    expect(saving.mock.calls[0][1]).toBeNull()
    expect(coldRead).toHaveBeenCalledTimes(1); expect(coldRead).toHaveBeenCalledWith(preview.project.document.sceneId)
    const installed = workspace.getState().project!, cold = await loading(installed.document.sceneId)
    expect(installed).not.toBe(preview.project)
    expect(workspace.checkpoint()).toBe(checkpoint + 1)
    expect(installed.schemaVersion).toBe(1); expect(cold!.project.schemaVersion).toBe(1)
    expect(projectContentHash(toBundle(installed).project)).toBe(projectContentHash(toBundle(preview.project).project))
    const validatedCold = await fromBundle(cold!, validation)
    expect(validatedCold.document.generation).toEqual(preview.project.document.generation)
    expect(validatedCold.document.visual).toEqual(preview.project.document.visual)
    expect(validatedCold.historyIdentity).toEqual(preview.project.historyIdentity)
    expect(validatedCold.appearance).toEqual(preview.project.appearance)
    expect(projectContentHash((await loading(current.document.sceneId))!.project)).toBe(sourceHash)
    const adoptedCheckpoint = workspace.checkpoint()
    await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow(/采用|取消/)
    expect(saving).toHaveBeenCalledTimes(1); expect(workspace.getState().project).toBe(installed)
    expect(workspace.checkpoint()).toBe(adoptedCheckpoint)
  })

  it.each(['manual edit', 'project switch'] as const)('invalidates the owned candidate after %s and preserves current data', async action => {
    const { repo, workspace } = await setup(), { preview } = await candidate(workspace)
    const cancelling = vi.spyOn(workspace, 'cancelTerrainGeneration')
    if (action === 'manual edit') {
      await workspace.updateProp('item', { rotationDeg: 29 }); await workspace.flush()
    } else await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
    const current = workspace.getState().project!, checkpoint = workspace.checkpoint(), saving = vi.spyOn(repo, 'save')
    const currentHash = projectContentHash(toBundle(current).project)
    expect(checkpoint).not.toBe(preview.checkpoint)
    // Checkpoint-changing actions release the source and cancel its owned preview first.
    expect(cancelling).toHaveBeenCalledWith(preview)
    await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow('地形候选已取消、已采用或不属于本会话。')
    expect(saving).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(currentHash)
    expect(await repo.load(preview.project.document.sceneId)).toBeNull()
    if (action === 'manual edit') expect(workspace.getDocument()!.props.item.rotationDeg).toBe(29)
    workspace.cancelTerrainGeneration(preview)
  })

  it('preserves the current saved project and checkpoint when the new target save fails', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const currentHash = projectContentHash(toBundle(current).project), { preview } = await candidate(workspace)
    const saving = vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('terrain target quota'))
    await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow(/target quota/)
    expect(saving).toHaveBeenCalledTimes(1); expect(workspace.getState().project).toBe(current)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(currentHash)
    expect(await repo.load(preview.project.document.sceneId)).toBeNull()
    await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow(/取消/)
    await workspace.updateProp('item', { rotationDeg: 41 }); await workspace.flush()
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(41)
  })

  it.each(['missing', 'rejected', 'changed'] as const)('preserves current after a %s target cold read without claiming target rollback', async mode => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const currentHash = projectContentHash(toBundle(current).project), { preview } = await candidate(workspace)
    const loading = repo.load.bind(repo), saving = vi.spyOn(repo, 'save')
    vi.spyOn(repo, 'load').mockImplementationOnce(async (sceneId, options) => {
      expect(sceneId).toBe(preview.project.document.sceneId)
      if (mode === 'missing') return null
      if (mode === 'rejected') throw new Error('terrain cold read unavailable')
      const cold = await loading(sceneId, options)
      if (!cold) throw new Error('The real target save must precede its cold read')
      const changed = cloneJson(cold.project); changed.document.title += ' · external edit'
      expect(() => validateProjectData(changed)).not.toThrow()
      expect(projectContentHash(changed)).not.toBe(projectContentHash(cold.project))
      return { project: changed, resources: cold.resources }
    })
    await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow(mode === 'missing' ? /冷读失败/ : mode === 'changed' ? /冷读前已改变/ : /cold read unavailable/)
    expect(saving).toHaveBeenCalledTimes(1); expect(workspace.getState().project).toBe(current)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(projectContentHash((await loading(current.document.sceneId))!.project)).toBe(currentHash)
    const independentlySaved = await loading(preview.project.document.sceneId)
    expect(independentlySaved!.project.schemaVersion).toBe(1)
    expect(projectContentHash(independentlySaved!.project)).toBe(projectContentHash(toBundle(preview.project).project))
    await expect(workspace.adoptTerrainGeneration(preview)).rejects.toThrow(/取消/)
    await workspace.updateProp('item', { rotationDeg: 47 }); await workspace.flush()
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(47)
  })

  // Complete generation/preview, real save, cold read and the following edit/save all run within this test's budget.
  it('honors cancellation during an awaited real save and releases the write lock without switching', async () => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const { preview } = await candidate(workspace), entered = deferred(), release = deferred(), saving = repo.save.bind(repo)
    vi.spyOn(repo, 'save').mockImplementationOnce(async (bundle, expected, options) => {
      await saving(bundle, expected, options); entered.resolve(); await release.promise
    })
    const adopting = workspace.adoptTerrainGeneration(preview), rejected = expect(adopting).rejects.toThrow(/取消/)
    await entered.promise
    try {
      await expect(workspace.updateProp('item', { rotationDeg: 57 })).rejects.toThrow(/请稍后重试/)
      await expect(workspace.close()).rejects.toThrow(/请稍后重试/)
      expect(() => workspace.undo()).toThrow(/请稍后重试/)
      workspace.cancelTerrainGeneration(preview)
    } finally { release.resolve(); await rejected }
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect((await repo.load(preview.project.document.sceneId))!.project.schemaVersion).toBe(1)
    await workspace.updateProp('item', { rotationDeg: 59 }); await workspace.flush()
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(59)
  }, 20000)
})

function addSymbol(document: SceneDocument, index: number) {
  const id = `budget-symbol-${index}`, floorId = Object.keys(document.floors)[0]
  document.props[id] = {
    id, floorId, editLocked: false, definitionRef: null,
    appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
    visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 },
    positionMm: { x: 800 + index % 20 * 500, y: 800 + Math.floor(index / 20) * 500 }, rotationDeg: 0,
    footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: 0, y: 0 },
    blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: floorId },
    renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null,
  }
  document.entityLayers[id] = 'visual-layer-props'
}

describe('current-v1 legacy budget boundary includes real identity and fixed sources', () => {
  it('fully validates exactly 256 expanded records and rejects a valid 257th before installation', async () => {
    const base = await refinedBase(), empty = emptyTerrainDocument(base.document), atLimit = cloneJson(empty)
    const complete = (document: SceneDocument): ProjectBundle => ({
      project: { ...toBundle(base).project, schemaVersion: 1, ...createCompositionContent(document, runtime) }, resources: base.resources,
    })
    const baseline = await fromBundle(complete(empty), validation)
    // 83 physical Props, their actual births and source bindings, a shared
    // immutable source/presentation, new lineage and fresh Floor birth total 256.
    for (let index = 0; index < 83; index++) addSymbol(atLimit, index)
    const addNote = (document: SceneDocument, id: string) => {
      document.notes[id] = { id, floorId: Object.keys(document.floors)[0], editLocked: false,
        kind: 'note', anchor: { type: 'point', positionMm: { x: 500, y: 500 } }, text: id, visibility: 'public' }
      document.entityLayers[id] = 'visual-layer-props'
    }
    const accepted = await fromBundle(complete(atLimit), validation), metadata = { before: baseline, after: accepted }
    const cost = assertTerrainBudget(empty, accepted.document, metadata)
    expect(Object.keys(accepted.document.props)).toHaveLength(83)
    expect(cost).toMatchObject({ total: 256, limit: 256, items: { physicalAndVisual: 83,
      'composition.identity.actual.propTokens': 83, 'composition.appearance.propSources': 83,
      'composition.appearance.sources': 3, 'composition.appearance.presentations': 2, 'composition.identity.lineage': 1,
      'composition.identity.actual.structureTokens': 1 } })
    expect(() => assertTerrainBudget(empty, accepted.document)).toThrow(/缺少真实历史身份/)
    const overLimit = cloneJson(accepted.document); addNote(overLimit, 'budget-note-1')
    // Strict complete validation proves refusal is the atomic budget, not malformed scene data.
    const rejected = await fromBundle(complete(overLimit), validation), rejectedMetadata = { before: baseline, after: rejected }
    expect(terrainCommandCost(empty, rejected.document, rejectedMetadata).total).toBe(257)
    expect(() => assertTerrainBudget(empty, rejected.document, rejectedMetadata)).toThrow(/257.*256/)
    expect(Object.keys(empty.props)).toHaveLength(0)
    expect(Object.keys(accepted.document.notes)).toHaveLength(0)
  })

  it.each([1, 2, 3] as const)('refuses algorithm%s installation above 256 without changing current or persistent data', async algorithmVersion => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const base = await refinedBase(), list = await repo.list(), saving = vi.spyOn(repo, 'save')
    await expect(workspace.previewTerrainGeneration(base, { sceneId: base.document.sceneId, kind: 'island', seed: TERRAIN_FIXED_SEEDS[0], algorithmVersion })).rejects.toThrow(/超过256/)
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(saving).not.toHaveBeenCalled(); expect(await repo.list()).toEqual(list)
    expect(await repo.load(base.document.sceneId)).toBeNull()
  })
})
