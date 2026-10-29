import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropDefinition, SceneDocument } from '../../shared/model/scene.js'
import { Workspace } from './workspace.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { emptyVisualSystem, type VisualBoundary } from '../../shared/visual/types.js'
import { materializeTerrainTransition } from '../../shared/visual/transition.js'
import { createEmptyGeneration5, type VisualSystem3 } from '../../shared/terrain-generation/composition-contracts.js'
import { pixelPng, runtime, validation } from './test-fixtures.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { captureJson, canonicalJson, encodeUtf8 } from '../../shared/validation/json.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'
import type { TerrainLocalRefreshRequest } from '../../shared/terrain-generation/local.js'

const bounds = { x: 0, y: 0, width: 8000, height: 8000 }
const repos: ProjectRepository[] = [], sessions: Workspace[] = []

const definition = (id: string): PropDefinition => ({
  id, catalogId: `catalog-${id}`, version: 1, licenseRef: 'fixture', origin: { kind: 'original', attribution: 'fixture', canEmbed: true },
  name: id, tags: ['tree'], defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
  defaultVisualBoundsMm: { x: -1200, y: -2400, width: 2400, height: 2400 }, defaultFootprintMm: { width: 600, height: 600 },
  defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false,
  defaultRenderLayer: 'canopy', defaultShadowClass: 'vegetation',
})

function localScene(): SceneDocument {
  const bytes = pixelPng([74, 108, 61, 255]), assetHash = sha256Bytes(bytes), licenseHash = sha256Bytes(encodeUtf8('T12 local fixture license'))
  const boundary: VisualBoundary = {
    id: 'coast', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false, closed: false,
    segments: [
      { id: 'segment-0', start: { x: 2000, y: 4000 }, control1: { x: 2000, y: 4000 }, control2: { x: 4000, y: 4000 }, end: { x: 4000, y: 4000 } },
      { id: 'segment-1', start: { x: 4000, y: 4000 }, control1: { x: 4000, y: 4000 }, control2: { x: 6000, y: 4000 }, end: { x: 6000, y: 4000 } },
    ], sampleSpacingMm: 2000, toleranceMm: 100,
    binding: { kind: 'terrain', sides: [
      { areaId: 'sand', startPointId: 'sand-p0', endPointId: 'sand-p2', reverse: false },
      { areaId: 'water', startPointId: 'water-p2', endPointId: 'water-p4', reverse: true },
    ] },
  }
  const material = (id: string, tags: string[]) => ({ id, catalogId: id, version: 1, name: id, tags, licenseRef: licenseHash, origin: { kind: 'original' as const, attribution: 'fixture', canEmbed: true }, textureAssetId: assetHash, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain' as const] })
  const paint = (materialId: string) => ({ base: { materialRef: { id: materialId, version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] })
  const area = (id: string, points: { x: number; y: number }[], elevationMm: number, materialId: string) => ({
    id, floorId: 'floor', editLocked: false, visibility: 'public' as const,
    boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm })),
    groundElevationMm: elevationMm, coveragePriority: 1, surfaceStyle: paint(materialId), blocksMovement: id === 'water', blocksSight: false, movementCostMultiplier: 1,
  })
  const tree = { ...definition('tree-a'), licenseRef: licenseHash }
  const prop = { id: 'manual-tree', floorId: 'floor', editLocked: false, definitionRef: { id: tree.id, version: 1 }, appearance: tree.defaultAppearance,
    visualBoundsMm: tree.defaultVisualBoundsMm, positionMm: { x: 5000, y: 5000 }, rotationDeg: 0, footprintMm: tree.defaultFootprintMm,
    footprintOffsetMm: tree.defaultFootprintOffsetMm, blocksMovement: false, blocksSight: false, visibility: 'public' as const,
    supportRef: { kind: 'terrainArea' as const, id: 'sand' }, renderLayer: 'canopy' as const, renderOrder: 3, shadowClass: 'vegetation' as const, shadowOverride: null }
  const scene: SceneDocument = {
    format: 'sceneweave-scene', schemaVersion: 4, sceneId: `local-${crypto.randomUUID()}`, revision: 2, title: 'T12 local', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: { [prop.id]: prop }, regions: {}, notes: {}, assets: {
      [assetHash]: { id: assetHash, sha256: assetHash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: licenseHash, origin: { kind: 'original', attribution: 'fixture', canEmbed: true } },
    }, propDefinitions: { [tree.id]: tree }, materials: { 'mat-sand': material('mat-sand', ['sand']), 'mat-water': material('mat-water', ['water']) }, terrainAreas: {
      sand: area('sand', [{ x: 2000, y: 4000 }, { x: 4000, y: 4000 }, { x: 6000, y: 4000 }, { x: 6000, y: 8000 }, { x: 2000, y: 8000 }], 100, 'mat-sand'),
      water: area('water', [{ x: 2000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }], 0, 'mat-water'),
    }, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {
      trees: { id: 'trees', floorId: 'floor', editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: 'sand' },
        palette: [{ key: 'a', propDefinitionRef: { id: tree.id, version: 1 }, weight: 1 }], seed: 'trees-1', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 2000, y: 4000 }, cellSizeMm: 1000,
        densityFactor: 1, minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 10 }, members: { ['a'.repeat(64)]: { propId: prop.id, state: 'manual', overrideFields: [] } }, exclusions: [] },
    }, styleThemes: {}, activeStyleThemeRef: null, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: { [prop.id]: 'layer', trees: 'layer' },
    presetSnapshot: { presetId: 'fixture', presetVersion: 1, distanceMode: 'metric', source: 'fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] },
    mapMode: 'scene', regional: null, generation: createEmptyGeneration5(), visual: { version: 3, base: { version: 2, base: { ...emptyVisualSystem(), boundaries: { coast: boundary } }, materializedEdges: {} }, transitions: {} },
  }
  scene.entityLayers.sand = 'layer'; scene.entityLayers.water = 'layer'
  const row = materializeTerrainTransition(scene, { id: 'shore', boundaryId: boundary.id, kind: 'shore', side: 'both', widthMm: 400, clipMm: { x: 1000, y: 1000, width: 6000, height: 6000 } })
  ;(scene.visual as VisualSystem3).transitions[row.id] = row
  return scene
}

async function fixture(): Promise<EditableProject> {
  const document = localScene(), checked = validateSceneDocument(document)
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
  const content = createCompositionContent(document, runtime), assetHash = Object.keys(document.assets)[0], bytes = pixelPng([74, 108, 61, 255]), licenseHash = document.assets[assetHash].licenseRef
  const licenseBindings = inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const }))
  return fromBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: 4, ...content, assets: { [assetHash]: { sha256: assetHash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 } }, licenses: { [licenseHash]: { sha256: licenseHash, text: 'T12 local fixture license' } }, licenseBindings, authoringSources: {} }, resources: createMemoryResources(new Map([[assetHash, bytes]])) }, validation)
}

function request(project: EditableProject): TerrainLocalRefreshRequest {
  return { sceneId: project.document.sceneId, scopeMm: { x: 1800, y: 3600, width: 5000, height: 1200 }, transitionIds: ['shore'], sceneryGroupIds: ['trees'] }
}

async function setup() {
  const repo = new ProjectRepository({ name: `terrain-local-${crypto.randomUUID()}`, runtime, validation }); repos.push(repo)
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  const base = await fixture(); await workspace.adoptNew(base)
  return { repo, workspace }
}

afterEach(async () => { vi.restoreAllMocks(); for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {}); for (const repo of repos.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) } })

describe('T12 workspace local transition/scenery transaction', () => {
  it('previews without writing, replays the exact result, and combines transition with scenery', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, before = canonicalJson(toBundle(current).project), checkpoint = workspace.checkpoint(), save = vi.spyOn(repo, 'save')
    const preview = await workspace.previewTerrainLocalRefresh(request(current))
    expect(save).not.toHaveBeenCalled(); expect(workspace.checkpoint()).toBe(checkpoint); expect(canonicalJson(toBundle(workspace.getState().project!).project)).toBe(before)
    expect(preview.result.dependencies.transitionIds).toEqual(['shore']); expect(preview.result.dependencies.sceneryGroupIds).toEqual(['trees']); expect(preview.result.changedIds).toEqual(expect.arrayContaining(['shore', 'trees']))
    const replay = await workspace.previewTerrainLocalRefresh(request(current), { result: preview.result })
    expect(canonicalJson(replay.project.document)).toBe(canonicalJson(preview.project.document)); expect(replay.result.outputHash).toBe(preview.result.outputHash)
    workspace.cancelTerrainLocalRefresh(preview); await expect(workspace.adoptTerrainLocalRefresh(preview)).rejects.toThrow(/取消|不可重复采用/)
  }, 30000)

  it('adopts once with protection/CAS, cold reads and one undo/redo unit', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, before = toBundle(current).project, revision = current.document.revision, preview = await workspace.previewTerrainLocalRefresh(request(current))
    const check = vi.spyOn(repo, 'checkProtection'), snapshot = vi.spyOn(repo, 'createSnapshot'), adopted = await workspace.adoptTerrainLocalRefresh(preview)
    await adopted.save
    expect(check).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(1); expect(workspace.getDocument()!.revision).toBe(revision + 1); expect(workspace.getState().canUndo).toBe(true)
    const cold = (await repo.load(current.document.sceneId))!; expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(workspace.getState().project!).project)); expect(Object.values(cold.project.document.scatterGroups).flatMap(group => Object.values(group.members)).some(member => member.propId === 'manual-tree' && member.state === 'manual')).toBe(true)
    workspace.undo(); expect(workspace.getDocument()!.visual).toEqual(before.document.visual); workspace.redo(); expect(workspace.getDocument()!.visual).toEqual(preview.document.visual)
    await workspace.flush(); await expect(workspace.adoptTerrainLocalRefresh(preview)).rejects.toThrow(/采用/)
  }, 30000)

  it('rejects stale, cancelled and replay-tampered candidates before protection', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, preview = await workspace.previewTerrainLocalRefresh(request(current)), snapshots = vi.spyOn(repo, 'createSnapshot')
    const tampered = captureJson(preview.result); tampered.document.title = 'forged'
    await expect(workspace.previewTerrainLocalRefresh(request(current), { result: tampered })).rejects.toThrow(/重放不符/); expect(snapshots).not.toHaveBeenCalled()
    await workspace.updateProp('manual-tree', { rotationDeg: 13 }); await workspace.flush(); await expect(workspace.adoptTerrainLocalRefresh(preview)).rejects.toThrow(/已有修改|重新预览/); expect(snapshots).not.toHaveBeenCalled()
  }, 30000)

  it('keeps current branch on protection/CAS failure and keeps adopted memory on save failure', async () => {
    const { workspace, repo } = await setup(), current = workspace.getState().project!, first = await workspace.previewTerrainLocalRefresh(request(current))
    vi.spyOn(repo, 'checkProtection').mockRejectedValueOnce(new Error('local metadata moved')); await expect(workspace.adoptTerrainLocalRefresh(first)).rejects.toThrow(/metadata moved/); expect(workspace.getState().project).toBe(current)
    const second = await workspace.previewTerrainLocalRefresh(request(current)); vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('local quota'))
    const adopted = await workspace.adoptTerrainLocalRefresh(second); await expect(adopted.save).rejects.toThrow(/quota/); expect(workspace.getState().status).toBe('error'); expect(workspace.getState().canUndo).toBe(true); expect((await repo.load(current.document.sceneId))!.project.document.revision).toBe(current.document.revision)
    workspace.undo(); expect(workspace.getDocument()!.revision).toBe(current.document.revision + 2); await workspace.retry()
  }, 30000)
})
