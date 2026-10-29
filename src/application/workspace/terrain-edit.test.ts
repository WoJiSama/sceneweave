import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import { Workspace } from './workspace.js'
import { fromBundle, toBundle } from './project.js'
import { NOW, pixelPng, runtime, validation } from './test-fixtures.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { cloneJson, encodeUtf8 } from '../../shared/validation/json.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { prepareTerrainEdit } from '../../shared/terrain-generation/edit.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
async function setup() {
  const document = cloneJson(createRefinedBlankDocument('island', { title: 'T2 transaction', sceneId: runtime.ids.nextId(), now: NOW, widthMm: 24000, heightMm: 18000, preset: 'narrative' }))
  const bytes = pixelPng([74, 108, 61, 255]), hash = sha256Bytes(bytes)
  for (const asset of Object.values(document.assets)) Object.assign(asset, { sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1 })
  const text = 'T2 real PNG closure', licenseHash = sha256Bytes(encodeUtf8(text)), content = createCompositionContent(document, runtime)
  const base = await fromBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: 2, ...content,
    assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 } },
    licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })), authoringSources: {} }, resources: createMemoryResources(new Map([[hash, bytes]])) }, validation)
  const repo = new ProjectRepository({ name: `terrain-edit-${crypto.randomUUID()}`, runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  const candidate = await workspace.previewTerrainGeneration(base, { sceneId: document.sceneId, kind: 'island', seed: 'terrain-v1-0' })
  await workspace.adoptTerrainGeneration(candidate)
  return { workspace, repo }
}
function request(workspace: Workspace, id = 't2-clear') {
  const scene = workspace.getDocument()!
  return { sceneId: scene.sceneId, operationId: id, floorId: Object.keys(scene.floors)[0], scopeMm: cloneJson(scene.exportBoundsMm), linkMode: 'scenery' as const,
    kind: 'brush' as const, mode: 'clearArea' as const, targetAreaId: 'terrain-low', materialRef: null, elevationMm: null, strokes: [{ pointsMm: [{ x: 2000, y: 2000 }], radiusMm: 300 }] }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
afterEach(async () => { vi.restoreAllMocks(); for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {}); for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) } })

describe('T2 protected local terrain transaction', () => {
  it('previews and cancels without writing, rejects forged wrappers and stale baselines', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint(), save = vi.spyOn(repo, 'save')
    const preview = await workspace.previewTerrainEdit(request(workspace))
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint); expect(save).not.toHaveBeenCalled()
    expect(preview.project.document.sceneId).toBe(current.document.sceneId)
    await expect(workspace.adoptTerrainEdit({ ...preview })).rejects.toThrow(/本会话/)
    workspace.cancelTerrainEdit(preview)
    await expect(workspace.adoptTerrainEdit(preview)).rejects.toThrow(/取消/)
    const stale = await workspace.previewTerrainEdit(request(workspace, 'stale'))
    const prop = Object.keys(current.document.props)[0]
    await workspace.updateProp(prop, { rotationDeg: 13 }); await workspace.flush()
    await expect(workspace.adoptTerrainEdit(stale)).rejects.toThrow(/已有修改|重新预览/)
    expect(workspace.getDocument()!.props[prop].rotationDeg).toBe(13)
  }, 30000)
  it('uses protection and CAS once, preserves unaffected fields, cold package and monotonic single undo/redo', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, before = toBundle(current).project, revision = current.document.revision
    const preview = await workspace.previewTerrainEdit(request(workspace)), check = vi.spyOn(repo, 'checkProtection'), snapshot = vi.spyOn(repo, 'createSnapshot')
    const adopted = await workspace.adoptTerrainEdit(preview); await adopted.save
    expect(check).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(1)
    expect(workspace.getDocument()!.revision).toBe(revision + 1)
    expect(workspace.getDocument()!.props).toEqual(before.document.props)
    expect(workspace.getDocument()!.terrainAreas).toEqual(before.document.terrainAreas)
    expect(workspace.getDocument()!.generation!.version).toBe(2)
    expect(workspace.getState().canUndo).toBe(true)
    const cold = (await repo.load(current.document.sceneId))!, archive = await exportProject(cold, validation), imported = await importProject(archive, validation)
    expect(projectContentHash(imported.project)).toBe(projectContentHash(toBundle(workspace.getState().project!).project))
    const protection = await repo.loadSnapshot(current.document.sceneId, adopted.protection.id)
    expect(projectContentHash(protection!.bundle.project)).toBe(projectContentHash(before))
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(revision + 2); expect(workspace.getDocument()!.generation).toEqual(before.document.generation); expect(workspace.getState().canUndo).toBe(false)
    workspace.redo(); expect(workspace.getDocument()!.revision).toBe(revision + 3); expect(workspace.getDocument()!.generation).toEqual(preview.document.generation)
    await workspace.flush()
    await expect(workspace.adoptTerrainEdit(preview)).rejects.toThrow(/采用/)
  }, 30000)
  it('rejects a tampered worker result and honors abort before any protection or current mutation', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, input = request(workspace), result = prepareTerrainEdit(current.document, input)
    const changed = cloneJson(result); changed.document.title += ' forged'
    await expect(workspace.previewTerrainEdit(input, { result: changed })).rejects.toThrow(/重放不符/)
    const abort = new AbortController(); abort.abort()
    await expect(workspace.previewTerrainEdit(input, { signal: abort.signal })).rejects.toThrow()
    const preview = await workspace.previewTerrainEdit(input), snapshots = vi.spyOn(repo, 'createSnapshot')
    await expect(workspace.adoptTerrainEdit(preview, { signal: abort.signal })).rejects.toThrow()
    expect(snapshots).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current)
  }, 30000)
  it('keeps fixed surface ancestry and removable adjustments when painting a new local overlay', async () => {
    const { workspace, repo } = await setup()
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['terrain-high'] },
      adjustment: { id: 'surface-brightness', kind: 'brightness', value: .8, enabled: true } }])
    await workspace.flush()
    const current = workspace.getState().project!, oldSourceId = current.appearance.surfaceSources['terrain-high']
    const constraint = Object.values(getLegacyGeneration(current.document)!.constraints).find(row => row.kind === 'activityArea')!
    if (constraint.kind !== 'activityArea') throw new Error('Expected activity area')
    const center = { x: Math.round(constraint.boundaryMm.reduce((sum, p) => sum + p.x, 0) / constraint.boundaryMm.length),
      y: Math.round(constraint.boundaryMm.reduce((sum, p) => sum + p.y, 0) / constraint.boundaryMm.length) }
    const input = { ...request(workspace, 'paint-fixed-source'), mode: 'paintGrass' as const, targetAreaId: 'terrain-high',
      materialRef: current.document.terrainAreas['terrain-high'].surfaceStyle!.base.materialRef,
      strokes: [{ pointsMm: [center], radiusMm: 300 }] }
    const preview = await workspace.previewTerrainEdit(input)
    const newSourceId = preview.project.appearance.surfaceSources['terrain-high']
    expect(newSourceId).not.toBe(oldSourceId)
    expect(preview.project.appearance.sources[oldSourceId]).toEqual(current.appearance.sources[oldSourceId])
    expect(preview.project.appearance.sources[newSourceId].parentSourceId).toBe(oldSourceId)
    expect(preview.project.appearance.instanceAdjustments).toEqual(current.appearance.instanceAdjustments)
    expect(preview.document.terrainAreas['terrain-high'].boundaryMm).toEqual(current.document.terrainAreas['terrain-high'].boundaryMm)
    const applied = await workspace.adoptTerrainEdit(preview); await applied.save
    const cold = (await repo.load(current.document.sceneId))!
    expect(cold.project.appearance.sources).toEqual(preview.project.appearance.sources)
    expect(cold.project.document.terrainAreas['terrain-high'].surfaceStyle!.overlays).toHaveLength(1)
    workspace.undo(); await workspace.flush()
    expect(workspace.getState().project!.appearance.surfaceSources['terrain-high']).toBe(oldSourceId)
    expect(workspace.getState().project!.appearance.instanceAdjustments).toEqual(current.appearance.instanceAdjustments)
  }, 30000)
  it('cancels while protection awaits and blocks concurrent edits without installing', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint(), preview = await workspace.previewTerrainEdit(request(workspace))
    const entered = deferred(), release = deferred(), create = repo.createSnapshot.bind(repo)
    vi.spyOn(repo, 'createSnapshot').mockImplementationOnce(async (...args) => { const saved = await create(...args); entered.resolve(); await release.promise; return saved })
    const adopting = workspace.adoptTerrainEdit(preview), rejected = expect(adopting).rejects.toThrow(/取消/)
    await entered.promise
    try { expect(() => workspace.undo()).toThrow(/请稍后/); await expect(workspace.close()).rejects.toThrow(/请稍后/); workspace.cancelTerrainEdit(preview) } finally { release.resolve(); await rejected }
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect((await repo.listSnapshots(current.document.sceneId)).filter(row => row.kind === 'protection')).toHaveLength(1)
  }, 30000)
  it('keeps current content on protection/CAS failure and keeps adopted memory and undo on save failure', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, input = request(workspace)
    const first = await workspace.previewTerrainEdit(input)
    vi.spyOn(repo, 'checkProtection').mockRejectedValueOnce(new Error('external metadata moved'))
    await expect(workspace.adoptTerrainEdit(first)).rejects.toThrow(/metadata moved/)
    expect(workspace.getState().project).toBe(current)
    const second = await workspace.previewTerrainEdit(input)
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('T2 quota'))
    const applied = await workspace.adoptTerrainEdit(second)
    await expect(applied.save).rejects.toThrow(/quota/)
    expect(workspace.getState().project!.document.generation!.version).toBe(2); expect(workspace.getState().status).toBe('error'); expect(workspace.getState().canUndo).toBe(true)
    expect((await repo.load(current.document.sceneId))!.project.document.generation).toEqual(current.document.generation)
    workspace.undo(); expect(workspace.getDocument()!.generation).toEqual(current.document.generation)
    await workspace.retry()
  }, 30000)
})
