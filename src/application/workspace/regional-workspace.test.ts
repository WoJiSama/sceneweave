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
import { pathPolygon, pointInPolygon } from '../../shared/geometry/geometry.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { projectScene } from '../../shared/projection/projection.js'
import { cloneJson, encodeUtf8, canonicalJson } from '../../shared/validation/json.js'
import { emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import { createEmptyRegional } from '../../shared/terrain-generation/contracts.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { compareRegionalSource, prepareRegionalDrillDown } from './regional.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import type { RegionalEditRequest } from '../../shared/terrain-generation/regional-authoring.js'

const repos: ProjectRepository[] = [], sessions: Workspace[] = []
/** Transaction fixture uses actual PNG bytes; the browser checks original SVG art. */
async function palette(regional: boolean): Promise<EditableProject> {
  let document = cloneJson(createRefinedBlankDocument('coast', { title: 'T5 palette fixture', sceneId: runtime.ids.nextId(), now: NOW, widthMm: 24000, heightMm: 18000, preset: 'narrative' }))
  const bytes = pixelPng([74, 108, 61, 255]), hash = sha256Bytes(bytes)
  for (const asset of Object.values(document.assets)) Object.assign(asset, { sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1 })
  if (regional) {
    document = emptyTerrainDocument(document); document.mapMode = 'regional'; document.regional = createEmptyRegional()
    const asset = Object.values(document.assets)[0]
    for (const key of ['woodland', 'ridge', 'landmark']) {
      const id = 'regional-symbol-' + key
      document.regional.symbolDefinitions[id] = { id, catalogId: 'fixture.regional.' + key, version: 1, name: key, assetId: asset.id, licenseRef: asset.licenseRef, origin: cloneJson(asset.origin), visualBoundsMm: { x: -60000, y: -112000, width: 120000, height: 120000 }, rootAnchorMm: { x: 0, y: 0 }, orientation: 'upright' }
    }
  }
  const content = createCompositionContent(document, runtime), text = 'T5 actual PNG transaction fixture', licenseHash = sha256Bytes(encodeUtf8(text))
  return fromBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: regional ? 3 : 2, ...content,
    assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 } },
    licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: 'licenses/' + licenseHash + '.txt', embedding: 'allowed' as const })), authoringSources: {} }, resources: createMemoryResources(new Map([[hash, bytes]])) }, validation)
}
async function setup() {
  const repo = new ProjectRepository({ name: 'regional-workspace-' + crypto.randomUUID(), runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))
  return { repo, workspace }
}
async function installed() {
  const context = await setup(), preview = await context.workspace.previewRegionalCreate(await palette(true), { preset: 'riverlands', seed: 'fixed-t5', widthMm: 1_000_000, heightMm: 800_000 })
  await context.workspace.adoptRegional(preview)
  return context
}
function edit(workspace: Workspace, operationId = 'regional-edit'): RegionalEditRequest {
  const scene = workspace.getDocument()!, area = Object.values(scene.regional!.areas).find(row => row.kind === 'forest')!
  return { kind: 'regionalEdit', sceneId: scene.sceneId, operationId, operation: 'upsertArea', area: { ...cloneJson(area), relativeElevationMm: 2500 } }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

describe('T5 protected regional workspace and independent child', () => {
  it.each(['riverlands', 'lakewood', 'highlands'] as const)('previews %s without writes, adopts a complete independent package once', async preset => {
    const { repo, workspace } = await setup(), current = workspace.getState().project!, checkpoint = workspace.checkpoint(), hash = projectContentHash(toBundle(current).project)
    const save = vi.spyOn(repo, 'save'), preview = await workspace.previewRegionalCreate(await palette(true), { preset, seed: 't5-three-inputs', widthMm: 1_000_000, heightMm: 800_000 })
    expect(save).not.toHaveBeenCalled(); expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(preview.project.document.mapMode).toBe('regional'); expect(preview.cost.total).toBeLessThanOrEqual(256)
    expect(Object.keys(preview.project.document.regional!.symbols)).toHaveLength(2); expect(Object.keys(preview.project.document.regional!.landmarks)).toHaveLength(1)
    await expect(workspace.adoptRegional({ ...preview })).rejects.toThrow(/本会话/)
    await workspace.adoptRegional(preview)
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][1]).toBeNull()
    const active = workspace.getState().project!, cold = (await repo.load(active.document.sceneId))!
    expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(active).project)); expect(active.document.sceneId).not.toBe(current.document.sceneId)
    expect(projectContentHash((await repo.load(current.document.sceneId))!.project)).toBe(hash)
    const imported = await importProject(await exportProject(cold, validation), validation)
    expect(projectContentHash(imported.project)).toBe(projectContentHash(cold.project))
    await expect(workspace.adoptRegional(preview)).rejects.toThrow(/采用/)
  }, 30000)

  it('rejects cancelled and stale independent candidates, and preserves current state on save failure', async () => {
    const { repo, workspace } = await setup(), base = await palette(true)
    const cancelled = await workspace.previewRegionalCreate(base, { preset: 'riverlands', seed: 'cancelled' })
    workspace.cancelRegional(cancelled); await expect(workspace.adoptRegional(cancelled)).rejects.toThrow(/取消/)
    const stale = await workspace.previewRegionalCreate(base, { preset: 'lakewood', seed: 'stale' })
    await workspace.updateProp('item', { rotationDeg: 17 }); await workspace.flush()
    await expect(workspace.adoptRegional(stale)).rejects.toThrow(/已有修改|重新预览/)
    const current = workspace.getState().project!, checkpoint = workspace.checkpoint(), preview = await workspace.previewRegionalCreate(base, { preset: 'highlands', seed: 'quota' })
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('quota'))
    await expect(workspace.adoptRegional(preview)).rejects.toThrow('quota')
    expect(workspace.getState().project).toBe(current); expect(workspace.checkpoint()).toBe(checkpoint)
    expect(await repo.load(preview.document.sceneId)).toBeNull()
  }, 30000)

  it('protects a same-scene edit with CAS and one monotonic undo/redo, retaining manual provenance', async () => {
    const { repo, workspace } = await installed(), current = workspace.getState().project!, before = cloneJson(current.document), revision = before.revision
    const preview = await workspace.previewRegionalEdit(edit(workspace)), snapshot = vi.spyOn(repo, 'createSnapshot'), guard = vi.spyOn(repo, 'checkProtection')
    expect(workspace.getState().project).toBe(current)
    const adopted = await workspace.adoptRegional(preview); await adopted.save
    expect(snapshot).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalledTimes(1)
    expect(workspace.getDocument()!.revision).toBe(revision + 1); expect(workspace.getDocument()!.sceneId).toBe(before.sceneId)
    expect(Object.values(workspace.getDocument()!.generation!.ownership).some(row => row.state === 'manual' && row.manualFields.includes('properties'))).toBe(true)
    const protection = await repo.loadSnapshot(before.sceneId, adopted.protection!.id)
    expect(protection!.bundle.project.document).toEqual(before)
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(revision + 2); expect(workspace.getDocument()!.regional).toEqual(before.regional)
    expect(workspace.getState().canUndo).toBe(false)
    workspace.redo(); expect(workspace.getDocument()!.revision).toBe(revision + 3); expect(workspace.getDocument()!.regional).toEqual(preview.document.regional)
    await workspace.flush()
  }, 30000)

  it('enforces locks, no-op rejection and abort before protection', async () => {
    const { repo, workspace } = await installed(), scene = workspace.getDocument()!, area = Object.values(scene.regional!.areas)[0]
    const noOp = await workspace.previewRegionalEdit({ kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'no-op', operation: 'upsertArea', area: cloneJson(area) })
    await expect(workspace.adoptRegional(noOp)).rejects.toThrow(/没有实际变化/)
    const controller = new AbortController(); controller.abort()
    const snapshot = vi.spyOn(repo, 'createSnapshot')
    await expect(workspace.previewRegionalEdit(edit(workspace), { signal: controller.signal })).rejects.toThrow()
    expect(snapshot).not.toHaveBeenCalled()
  }, 30000)

  it('creates a 1:1 public child with full resources and source evidence, independent of later parent deletion', async () => {
    const { repo, workspace } = await installed(), parent = workspace.getState().project!, before = canonicalJson(parent.document)
    const preview = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 100000, y: 100000, width: 500000, height: 500000 }, includePrivate: false })
    expect(canonicalJson(parent.document)).toBe(before)
    expect(preview.document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 500000, height: 500000 })
    expect(preview.document.mapMode).toBe('scene'); expect(preview.document.regional).toBeNull()
    expect(Object.keys(preview.document.terrainAreas).length).toBeGreaterThan(1)
    expect(Object.keys(preview.document.paths).length).toBeGreaterThan(0)
    const source = Object.values(preview.document.generation!.sourceLinks)[0]
    expect('version' in source && source.version).toBe(2)
    expect(source.translationMm).toEqual({ x: -100000, y: -100000 }); expect(source.inherited.every(row => row.visibility === 'public')).toBe(true)
    expect(source.inherited.some(row => row.kind === 'symbol' && 'symbol' in row && row.symbol.definition.id === row.symbol.definitionRef.id)).toBe(true)
    expect(source.inherited.some(row => row.kind === 'landmark' && 'landmark' in row && row.landmark.definition.id === row.landmark.definitionRef.id)).toBe(true)
    expect(Object.keys(preview.document.props).length).toBeGreaterThan(0)
    expect(Object.values(preview.document.props).some(prop => prop.definitionRef?.id.startsWith('regional-child-prop-'))).toBe(true)
    expect(Object.values(preview.document.props).some(prop => prop.id.includes('landmark-source'))).toBe(true)
    expect(Object.keys(preview.document.notes).length).toBeGreaterThan(0)
    expect(Object.values(preview.document.paths).some(path => path.id.includes('-road-source-') && path.supportRefs.some(ref => ref.kind === 'floor'))).toBe(true)
    expect(Object.values(preview.document.terrainAreas).some(area => area.blocksMovement)).toBe(true)
    expect(Object.keys(preview.document.assets).filter(id => id.startsWith('regional-child-asset-'))).toHaveLength(1)
    expect(await compareRegionalSource(preview.project, parent, { runtime, validation })).toMatch(/一致/)
    await workspace.adoptRegional(preview)
    const child = workspace.getState().project!, packed = await exportProject((await repo.load(child.document.sceneId))!, validation), cold = await fromBundle(await importProject(packed, validation), validation)
    expect(projectContentHash(toBundle(cold).project)).toBe(projectContentHash(toBundle(child).project))
    expect(await compareRegionalSource(cold, null, { runtime, validation })).toMatch(/未找到.*独立/)
    expect(projectContentHash((await repo.load(parent.document.sceneId))!.project)).toBe(projectContentHash(toBundle(parent).project))
  }, 30000)

  it('honors cancellation after regional materialization yields to the event loop', async () => {
    const { workspace } = await installed(), parent = workspace.getState().project!, controller = new AbortController(), yielded = vi.fn(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      controller.abort()
    })
    await expect(prepareRegionalDrillDown(parent, { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 } }, {
      runtime, validation, signal: controller.signal, sceneBase: await palette(false), yieldToEventLoop: yielded,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(yielded).toHaveBeenCalledTimes(1)
    expect(workspace.getState().project).toBe(parent)
  }, 30000)

  it('materializes a clipped river band as blocking terrain and keeps the road on Floor support', async () => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const line: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-river-band', operation: 'upsertLine', line: {
      id: 'regional-manual-river', floorId, layerId, visibility: 'public', editLocked: false,
      pointsMm: [{ id: 'regional-manual-river-p0', positionMm: { x: 100000, y: 240000 } }, { id: 'regional-manual-river-p1', positionMm: { x: 900000, y: 240000 } }],
      kind: 'river', displayWidthMm: 20000, actualWidthMm: 20000, portIds: [], connectedLineIds: [], flow: 'forward',
    } }
    const editPreview = await workspace.previewRegionalEdit(line), adopted = await workspace.adoptRegional(editPreview); await adopted.save
    const child = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: false })
    expect(Object.values(child.document.terrainAreas).some(area => area.blocksMovement && area.visibility === 'public')).toBe(true)
    expect(Object.values(child.document.paths).some(path => path.supportRefs.some(ref => ref.kind === 'floor' && ref.id === Object.keys(child.document.floors)[0]))).toBe(true)
    expect(Object.values(child.document.terrainAreas).every(area => area.boundaryMm.length >= 3)).toBe(true)
  }, 30000)

  it('keeps public terrain geometry stable when a private overlay is included', async () => {
    const { workspace } = await installed(), initial = workspace.getDocument()!, floorId = Object.keys(initial.floors)[0], layerId = Object.keys(initial.userLayers).find(id => initial.userLayers[id].floorId === floorId)!
    const publicRoad: RegionalEditRequest = { kind: 'regionalEdit', sceneId: initial.sceneId, operationId: 'regional-public-road-away-from-gm', operation: 'upsertLine', line: {
      id: 'regional-public-road-away-from-gm', floorId, layerId, visibility: 'public', editLocked: false, kind: 'road', displayWidthMm: 20000, actualWidthMm: 20000, portIds: [], connectedLineIds: [], flow: 'forward',
      pointsMm: [{ id: 'regional-public-road-p0', positionMm: { x: 100000, y: 100000 } }, { id: 'regional-public-road-p1', positionMm: { x: 350000, y: 100000 } }],
    } }
    const publicRoadAdopted = await workspace.adoptRegional(await workspace.previewRegionalEdit(publicRoad)); await publicRoadAdopted.save
    const scene = workspace.getDocument()!
    const privateArea: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-private-overlay', operation: 'upsertArea', area: {
      id: 'regional-private-overlay', floorId, layerId, visibility: 'gm', editLocked: false, kind: 'hill',
      boundaryMm: [{ x: 420000, y: 300000 }, { x: 470000, y: 300000 }, { x: 470000, y: 350000 }, { x: 420000, y: 350000 }], relativeElevationMm: 1500,
    } }
    const editPreview = await workspace.previewRegionalEdit(privateArea), adopted = await workspace.adoptRegional(editPreview); await adopted.save
    const publicChild = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: false })
    const gmChild = await workspace.previewRegionalDrillDown(await palette(false), { kind: 'regionalDrillDown', sourceSceneId: scene.sceneId,
      sceneId: 'regional-gm-child', operationId: 'regional-gm-child-drill', selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: true })
    const publicAreas = (candidate: typeof publicChild) => Object.values(candidate.document.terrainAreas).filter(area => area.visibility === 'public').map(area => ({ boundaryMm: area.boundaryMm, kind: area.blocksMovement, elevation: area.groundElevationMm })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    expect(publicAreas(gmChild)).toEqual(publicAreas(publicChild))
    expect(Object.values(gmChild.document.terrainAreas).some(area => area.visibility === 'gm')).toBe(true)
    const publicPaths = (candidate: typeof publicChild) => Object.values(candidate.document.paths).filter(path => path.visibility === 'public').map(path => path.id).sort()
    expect(publicPaths(publicChild)).toEqual(publicPaths(gmChild))
    expect(publicPaths(gmChild).some(id => id.includes('regional-public-road-away-from-gm'))).toBe(true)
    expect(projectScene(gmChild.document, 'player').paths.some(path => path.id.includes('regional-public-road-away-from-gm'))).toBe(true)
  }, 30000)

  it.each([false, true])('masks independent GM roads, landmarks and symbols using the actual theme (large decorations: %s)', async largeDecorations => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, regional = scene.regional!
    const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const symbol = Object.values(regional.symbols)[0], landmark = Object.values(regional.landmarks)[0]
    const requests: RegionalEditRequest[] = [
      { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-private-road-edit', operation: 'upsertLine', line: {
        id: 'regional-private-road', floorId, layerId, visibility: 'gm', editLocked: false, kind: 'road', displayWidthMm: 5000, actualWidthMm: 5000,
        pointsMm: [{ id: 'regional-private-road-p0', positionMm: { x: 80000, y: 220000 } }, { id: 'regional-private-road-p1', positionMm: { x: 350000, y: 220000 } }],
        portIds: [], connectedLineIds: [], flow: 'none',
      } },
      { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-private-landmark-edit', operation: 'upsertLandmark', landmark: {
        ...cloneJson(landmark), id: 'regional-private-landmark', visibility: 'gm', areaId: null,
        positionMm: { x: 150000, y: 150000 }, name: '隐藏营地', description: '只有主持人知道的线索',
      } },
      { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-private-symbol-edit', operation: 'upsertSymbol', symbol: {
        id: 'regional-private-symbol', floorId, layerId, editLocked: false, visibility: 'gm', sourceRef: null, managementKey: null,
        definitionRef: cloneJson(symbol.definitionRef), visualBoundsMm: cloneJson(symbol.visualBoundsMm), renderOrder: symbol.renderOrder, positionMm: { x: 300000, y: 150000 },
      } },
    ]
    for (const request of requests) { const adopted = await workspace.adoptRegional(await workspace.previewRegionalEdit(request)); await adopted.save }
    const parent = workspace.getState().project!, before = projectContentHash(toBundle(parent).project)
    const sceneBase = await palette(false), document = cloneJson(sceneBase.document)
    if (largeDecorations) {
      const theme = document.styleThemes[document.activeStyleThemeRef!.id]
      theme.edgeStyles.path.bandWidthMm = 12001
      Object.assign(theme.shadowPresets.none, { opacity: .3, offsetMm: 9001, blurMm: 2001 })
    }
    const child = await workspace.previewRegionalDrillDown({ ...sceneBase, ...createCompositionContent(document, runtime) }, {
      kind: 'regionalDrillDown', sourceSceneId: scene.sceneId, sceneId: 'regional-private-child', operationId: 'regional-private-child-drill',
      selectionMm: { x: 0, y: 0, width: 500000, height: 250000 }, includePrivate: true,
    })
    expect(Object.values(child.document.terrainAreas).some(area => area.visibility === 'gm')).toBe(false)
    expect(Object.values(child.document.paths).filter(path => path.visibility === 'gm'), JSON.stringify(child.materialization)).toHaveLength(1)
    expect(Object.values(child.document.props).filter(prop => prop.visibility === 'gm')).toHaveLength(2)
    expect(Object.values(child.document.regions).filter(region => region.kind === 'manualMask')).toHaveLength(3)
    for (const id of ['regional-private-road', 'regional-private-landmark', 'regional-private-symbol']) {
      expect(child.materialization!.entries.find(entry => entry.sourceFeatureId === `${id}-source`)?.status).toBe('materialized')
      expect(Object.values(child.document.generation!.sourceLinks).some(link => link.inherited.some(feature => feature.sourceEntityId === id))).toBe(true)
    }
    const player = projectScene(child.document, 'player'), gm = projectScene(child.document, 'gm')
    expect(gm.paths.some(path => path.id.includes('regional-private-road'))).toBe(true)
    expect(gm.props.filter(prop => prop.visibility === 'gm')).toHaveLength(2)
    expect(JSON.stringify(player)).not.toContain('regional-private-')
    expect(JSON.stringify(player)).not.toContain('只有主持人知道的线索')
    const unmasked = cloneJson(child.document)
    unmasked.regions = {}; for (const id of Object.keys(child.document.regions)) delete unmasked.entityLayers[id]
    expect(() => projectScene(unmasked, 'player')).toThrow(/固定遮罩/)
    expect(workspace.getState().project).toBe(parent)
    expect(projectContentHash(toBundle(parent).project)).toBe(before)
  }, 30000)

  it('covers GM terrain decorations beyond a fixed five-metre margin', async () => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, floorId = Object.keys(scene.floors)[0]
    const layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const adopted = await workspace.adoptRegional(await workspace.previewRegionalEdit({
      kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-private-wide-cliff-edit', operation: 'upsertArea', area: {
        id: 'regional-private-wide-cliff', floorId, layerId, visibility: 'gm', editLocked: false, kind: 'hill', relativeElevationMm: 1500,
        boundaryMm: [{ x: 30000, y: 30000 }, { x: 60000, y: 30000 }, { x: 60000, y: 60000 }, { x: 30000, y: 60000 }],
      },
    })); await adopted.save
    const sceneBase = await palette(false), document = cloneJson(sceneBase.document), theme = document.styleThemes[document.activeStyleThemeRef!.id]
    Object.assign(theme.terrainCliff, { maxOffsetMm: 12001, blurMm: 2001, opacity: .3 })
    theme.edgeStyles.shore.bandWidthMm = 18001
    const child = await workspace.previewRegionalDrillDown({ ...sceneBase, ...createCompositionContent(document, runtime) }, {
      kind: 'regionalDrillDown', sourceSceneId: scene.sceneId, sceneId: 'regional-private-wide-cliff-child', operationId: 'regional-private-wide-cliff-drill',
      selectionMm: { x: 0, y: 0, width: 500000, height: 250000 }, includePrivate: true,
    })
    expect(Object.values(child.document.terrainAreas).filter(area => area.visibility === 'gm')).toHaveLength(1)
    expect(() => projectScene(child.document, 'player')).not.toThrow()
    const mask = Object.values(child.document.regions).find(region => region.kind === 'manualMask')!
    expect(Math.min(...mask.boundaryMm.map(point => point.x))).toBeLessThan(25000)
    expect(Math.max(...mask.boundaryMm.map(point => point.x))).toBeGreaterThan(65000)
  }, 30000)

  it('keeps an enclosed high-priority lake as a complete surface overlay', async () => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const enclosed: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-enclosed-overlay', operation: 'upsertArea', area: {
      id: 'regional-enclosed-overlay', floorId, layerId, visibility: 'public', editLocked: false, kind: 'water',
      boundaryMm: [{ x: 430000, y: 330000 }, { x: 450000, y: 330000 }, { x: 450000, y: 350000 }, { x: 430000, y: 350000 }], relativeElevationMm: 0,
    } }
    const editPreview = await workspace.previewRegionalEdit(enclosed), adopted = await workspace.adoptRegional(editPreview); await adopted.save
    const nested: RegionalEditRequest = { kind: 'regionalEdit', sceneId: workspace.getDocument()!.sceneId, operationId: 'regional-enclosed-low', operation: 'upsertArea', area: {
      id: 'regional-enclosed-low', floorId, layerId, visibility: 'public', editLocked: false, kind: 'forest',
      boundaryMm: [{ x: 435000, y: 335000 }, { x: 445000, y: 335000 }, { x: 445000, y: 345000 }, { x: 435000, y: 345000 }], relativeElevationMm: 0,
    } }
    const nestedPreview = await workspace.previewRegionalEdit(nested), nestedAdopted = await workspace.adoptRegional(nestedPreview); await nestedAdopted.save
    const child = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: false })
    const center = { x: 440000, y: 340000 }, childAreas = Object.values(child.document.terrainAreas)
    const containing = childAreas.filter(area => pointInPolygon(center, area.boundaryMm.map(point => point.positionMm)))
    const lake = containing.find(area => area.blocksMovement), land = containing.find(area => !area.blocksMovement)
    expect(containing.length).toBeGreaterThanOrEqual(3); expect(lake).toBeDefined(); expect(land).toBeDefined()
    expect(lake!.coveragePriority).toBeGreaterThan(land!.coveragePriority)
    expect(child.materialization?.entries.some(entry => entry.sourceFeatureId.startsWith('regional-enclosed-overlay') && entry.status === 'materialized')).toBe(true)
    for (const area of childAreas) {
      const points = area.boundaryMm.map(point => point.positionMm)
      expect(points.length).toBeGreaterThanOrEqual(3)
      expect(points.every((point, index) => point.x !== points[(index + 1) % points.length].x || point.y !== points[(index + 1) % points.length].y)).toBe(true)
    }
  }, 30000)

  it('keeps a proper boundary crossing in the source snapshot without inventing integer topology', async () => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const first: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-crossing-a', operation: 'upsertArea', area: {
      id: 'regional-crossing-a', floorId, layerId, visibility: 'public', editLocked: false, kind: 'forest', boundaryMm: [{ x: 100000, y: 100000 }, { x: 300000, y: 100000 }, { x: 300000, y: 300000 }, { x: 100000, y: 300000 }], relativeElevationMm: 0,
    } }
    const second: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-crossing-b', operation: 'upsertArea', area: {
      id: 'regional-crossing-b', floorId, layerId, visibility: 'public', editLocked: false, kind: 'forest', boundaryMm: [{ x: 220000, y: 50000 }, { x: 350000, y: 180000 }, { x: 220000, y: 350000 }, { x: 90000, y: 180000 }], relativeElevationMm: 0,
    } }
    await workspace.adoptRegional(await workspace.previewRegionalEdit(first)); await workspace.flush()
    await workspace.adoptRegional(await workspace.previewRegionalEdit(second)); await workspace.flush()
    const child = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: false })
    expect(child.materialization?.entries.some(entry => entry.sourceFeatureId.startsWith('regional-crossing-b') && entry.status === 'sourceOnly')).toBe(true)
    expect(Object.values(child.document.terrainAreas).every(area => area.boundaryMm.length >= 3)).toBe(true)
  }, 30000)

  it('reports a road with only boundary ports as partial materialization', async () => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const road: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-wide-road', operation: 'upsertLine', line: {
      id: 'regional-wide-road', floorId, layerId, visibility: 'public', editLocked: false, kind: 'road', displayWidthMm: 50000, actualWidthMm: 50000, portIds: [], connectedLineIds: [], flow: 'forward',
      pointsMm: [{ id: 'regional-wide-road-p0', positionMm: { x: 100000, y: 450000 } }, { id: 'regional-wide-road-p1', positionMm: { x: 300000, y: 450000 } }],
    } }
    await workspace.adoptRegional(await workspace.previewRegionalEdit(road)); await workspace.flush()
    const child = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 100000, y: 430000, width: 20000, height: 40000 }, includePrivate: false })
    const roadEntry = child.materialization?.entries.find(entry => entry.sourceFeatureId.startsWith('regional-wide-road-source-'))
    expect(roadEntry?.status).toBe('partial')
    expect(Object.values(child.document.generation?.constraints ?? {}).some(constraint => constraint.kind === 'port')).toBe(true)
    expect(Object.keys(child.document.paths).some(id => id.includes('regional-wide-road'))).toBe(false)
  }, 30000)

  it('reports a standalone inherited port as fully materialized', async () => {
    const { workspace } = await installed(), current = workspace.getState().project!, bundle = toBundle(current), project = cloneJson(bundle.project), floorId = Object.keys(project.document.floors)[0]
    const beforeDocument = cloneJson(project.document)
    project.document.generation!.constraints['regional-standalone-port'] = {
      id: 'regional-standalone-port', floorId, visibility: 'public', strength: 'soft', kind: 'port',
      positionMm: { x: 250000, y: 250000 }, directionDeg: 90, widthMm: 20000,
    }
    project.historyIdentity = advanceHistoryIdentity(project.historyIdentity, beforeDocument, project.document, runtime)
    await workspace.openPersisted(await fromBundle({ project, resources: bundle.resources }, validation))
    const child = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: false })
    const entry = child.materialization?.entries.find(row => row.sourceFeatureId === 'regional-standalone-port-source')
    expect(entry?.status).toBe('materialized')
    expect(Object.values(child.document.generation?.constraints ?? {}).some(row => row.kind === 'port' && row.positionMm.x === 250000)).toBe(true)
  }, 30000)

  it('keeps a materialized road centerline inside the endpoint safety inset', async () => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const road: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-inset-road', operation: 'upsertLine', line: {
      id: 'regional-inset-road', floorId, layerId, visibility: 'public', editLocked: false, kind: 'road', displayWidthMm: 20000, actualWidthMm: 20000, portIds: [], connectedLineIds: [], flow: 'forward',
      pointsMm: [{ id: 'regional-inset-road-p0', positionMm: { x: 0, y: 100000 } }, { id: 'regional-inset-road-p1', positionMm: { x: 900000, y: 100000 } }],
    } }
    await workspace.adoptRegional(await workspace.previewRegionalEdit(road)); await workspace.flush()
    const child = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: false })
    const path = Object.values(child.document.paths).find(row => row.id.includes('regional-inset-road-source-'))
    expect(path).toBeDefined()
    const inset = Math.ceil(20000 / Math.SQRT2) + 2
    expect(Math.min(...path!.centerlineMm.map(point => point.x))).toBeGreaterThanOrEqual(inset)
    expect(Math.max(...path!.centerlineMm.map(point => point.x))).toBeLessThanOrEqual(500000 - inset)
    expect(Math.min(...pathPolygon(path!).map(point => point.x))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...pathPolygon(path!).map(point => point.x))).toBeLessThanOrEqual(500000)
  }, 30000)

  it('materializes a safe multi-segment road without clipping its turn', async () => {
    const { workspace } = await installed(), scene = workspace.getDocument()!, floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers).find(id => scene.userLayers[id].floorId === floorId)!
    const pointsMm = [{ id: 'regional-bent-road-p0', positionMm: { x: 100000, y: 120000 } }, { id: 'regional-bent-road-p1', positionMm: { x: 240000, y: 180000 } }, { id: 'regional-bent-road-p2', positionMm: { x: 360000, y: 120000 } }]
    const road: RegionalEditRequest = { kind: 'regionalEdit', sceneId: scene.sceneId, operationId: 'regional-bent-road', operation: 'upsertLine', line: {
      id: 'regional-bent-road', floorId, layerId, visibility: 'public', editLocked: false, kind: 'road', displayWidthMm: 20000, actualWidthMm: 20000, portIds: [], connectedLineIds: [], flow: 'forward',
      pointsMm,
    } }
    await workspace.adoptRegional(await workspace.previewRegionalEdit(road)); await workspace.flush()
    const child = await workspace.previewRegionalDrillDown(await palette(false), { selectionMm: { x: 0, y: 0, width: 500000, height: 500000 }, includePrivate: false })
    const path = Object.values(child.document.paths).find(row => row.id.includes('regional-bent-road-source'))
    expect(path).toBeDefined()
    expect(path!.centerlineMm).toEqual(pointsMm.map(point => point.positionMm))
    expect(pathPolygon(path!).every(point => point.x >= 0 && point.x <= 500000 && point.y >= 0 && point.y <= 500000)).toBe(true)
  }, 30000)
})
