import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathPolygonV2, pointInPolygonV2 } from '../../core/v2/geometry'
import type { PathV2, PointMm, SurfaceStyle } from '../../core/v2/types'
import { migrateSceneV2 } from '../../core/v3/migration'
import { toGeometryDocumentV2 } from '../../core/v3/geometry-view'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { hitTestAllV2, selectInBoundsV2, selectionGeometryV2 } from '../../editor/v2/selection'
import { hiddenDependentsV3, hitTestLayersV3, selectInBoundsLayersV3, selectionGeometryLayersV3 } from '../../editor/v3/selection'
import { imageProject } from '../../io/v2/test-fixtures'
import type { CompleteProjectV2 } from '../../io/v2/types'
import type { CompleteProjectV3 } from '../../io/v3/types'
import { createEditorRenderPlan, editorPaintBounds } from '../shared/editor-render-plan'
import { pathAnchorPosition } from '../shared/paths'
import { projectSceneV2 } from '../v2/projection'
import { projectEditorSceneV3, projectSceneV3 } from './projection'
import { renderEditorProjectV3, renderProjectV3 } from './renderer'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const stamp = '2026-10-22T00:00:00.000Z'
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const paint = (): SurfaceStyle => ({ base: { materialRef: { id: 'test-material', version: 1 }, tileSizeMm: { width: 700, height: 1100 }, rotationDeg: 35, alignment: 'world', originMm: { x: -200, y: 125 }, opacity: 1, tint: null }, overlays: [] })

async function fixture(): Promise<CompleteProjectV2> {
  const project = await imageProject(), scene = project.document
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.props = {}; scene.notes = {}; scene.regions = {}
  scene.constraints.entranceOpeningIds = []; scene.units.gridVisible = false
  scene.exportBoundsMm = { x: 0, y: 0, width: 10000, height: 8000 }; scene.floors['f-a1'].boundsMm = { ...scene.exportBoundsMm }
  scene.materials['test-material'].applicableSurfaces = ['path']
  scene.paths.road = { id: 'road', floorId: 'f-a1', editLocked: false, visibility: 'public', centerlineMm: [{ x: 2000, y: 2000 }, { x: 7000, y: 2000 }, { x: 7000, y: 5000 }], widthMm: 1000,
    supportRefs: [{ kind: 'floor', id: 'f-a1' }], surfaceStyle: paint(), movementCostMultiplier: 1, renderOrder: 0 }
  return project
}
const layers = (project: CompleteProjectV2): CompleteProjectV3 => ({ document: migrateSceneV2(project.document, { sceneId: 'outdoor-path-copy', now: stamp }), assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings })
function label(scene: SceneDocumentV3, id: string, entityKind: 'path' | 'note', entityId: string): void {
  scene.notes[id] = { id, floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'label', text: id, anchor: { type: 'entity', entityKind, entityId } }
  scene.entityLayers[id] = Object.keys(scene.userLayers)[0]
}

describe('C4 path projection, resource and exact picking boundary', () => {
  it('projects the validated square-cap/miter band, fixed paints, resource closure and on-path labels in both native versions', async () => {
    const project = await fixture(), native = layers(project), scene = native.document
    label(scene, 'road-label', 'path', 'road'); label(scene, 'nested-label', 'note', 'road-label')
    const before = structuredClone(scene), projected = projectSceneV3(scene, 'gm')
    expect(projected.paths).toEqual([{ id: 'road', points: pathPolygonV2(scene.paths.road), style: paint(), edgeStyle: { strokeWidthMm: 18, color: '#78745F', bandWidthMm: 100 } }])
    expect(projected.limitations).toEqual([]); expect(projected.assetIds).toEqual(['test-image'])
    expect(projected.materials['test-material']).toEqual({ id: 'test-material', version: 1, textureAssetId: 'test-image' })
    expect(projected.notes.map(note => note.positionMm)).toEqual([{ x: 6000, y: 2000 }, { x: 6000, y: 2000 }])
    expect(projectSceneV2(project.document, 'gm').paths).toEqual(projected.paths)
    projected.paths[0].points[0].x = -1; projected.paths[0].style!.base.originMm.x = -1
    expect(scene).toEqual(before)
  })

  it('keeps a concave-route label on its actual half-length segment rather than outside the road at its polygon centroid', () => {
    const path = { centerlineMm: [{ x: 1500, y: 1000 }, { x: 7000, y: 1000 }, { x: 7000, y: 6000 }, { x: 1500, y: 6000 }], widthMm: 400 } as PathV2
    expect(pathAnchorPosition(path)).toEqual({ x: 7000, y: 3500 })
    const band = pathPolygonV2(path)
    expect(band).toHaveLength(8)
    expect(pointInPolygonV2(pathAnchorPosition(path), band)).toBe(true)
  })

  it('orders roads by user layer before local render order and picks the same exact band including caps', async () => {
    const native = layers(await fixture()), scene = native.document, base = Object.keys(scene.userLayers)[0]
    scene.paths.road.renderOrder = 100
    scene.userLayers.upper = { id: 'upper', floorId: 'f-a1', order: 1, editLocked: false, name: '上层道路' }
    scene.paths.upperRoad = { ...structuredClone(scene.paths.road), id: 'upperRoad', renderOrder: 0 }; scene.entityLayers.upperRoad = 'upper'
    const projected = projectSceneV3(scene, 'gm'), domain = toGeometryDocumentV2(scene)
    expect(projected.paths.map(path => path.id)).toEqual(['road', 'upperRoad'])
    expect(selectionGeometryLayersV3(scene)(domain, 'road')).toEqual([pathPolygonV2(scene.paths.road)])
    const cap = { x: 1510, y: 1800 }
    expect(hitTestLayersV3(scene)(domain, cap, 0).slice(0, 2)).toEqual(['upperRoad', 'road'])
    expect(selectInBoundsLayersV3(scene)(domain, { x: 1500, y: 1500, width: 40, height: 500 }, 'intersect').ids).toContain('road')
    expect(hitTestLayersV3(scene)(domain, { x: 1490, y: 1800 }, 0)).not.toContain('road')
    expect(hitTestAllV2(domain, cap, 0)).toContain('road'); expect(selectionGeometryV2(domain, 'road')).toEqual([pathPolygonV2(scene.paths.road)])
    expect(selectInBoundsV2(domain, scene.exportBoundsMm, 'contain').ids).toContain('road')
    scene.entityLayers.upperRoad = base; scene.paths.upperRoad.renderOrder = 101
    expect(hitTestLayersV3(scene)(toGeometryDocumentV2(scene), cap, 0).slice(0, 2)).toEqual(['upperRoad', 'road'])
  })

  it('omits editor-hidden roads and recursively attached labels without changing formal resources or output', async () => {
    const native = layers(await fixture()), scene = native.document, layer = Object.keys(scene.userLayers)[0]
    label(scene, 'road-label', 'path', 'road'); label(scene, 'nested-label', 'note', 'road-label')
    const hidden = projectEditorSceneV3(scene, { hiddenLayerIds: new Set([layer]) })
    expect(hidden.paths).toEqual([]); expect(hidden.notes).toEqual([])
    expect(hidden.pathPaintOrder).toBe('over-room-before-connection')
    expect(projectSceneV3(scene, 'gm').paths).toHaveLength(1); expect(projectSceneV3(scene, 'player').paths).toHaveLength(1)
    expect(projectSceneV3(scene, 'gm').assetIds).toEqual(['test-image'])
  })

  it('hides a road and its labels when its separate support layer is hidden, keeping the intact scene valid', async () => {
    const native = layers(await fixture()), scene = native.document
    scene.userLayers.support = { id: 'support', floorId: 'f-a1', name: '支撑', order: 1, editLocked: false }
    scene.terrainAreas.ground = { id: 'ground', floorId: 'f-a1', editLocked: false, visibility: 'public', groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null,
      boundaryMm: rect(1000, 1000, 7500, 6000).map((positionMm, i) => ({ id: `ground-v${i}`, segmentId: `ground-s${i}`, positionMm })), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.entityLayers.ground = 'support'; scene.paths.road.supportRefs = [{ kind: 'terrainArea', id: 'ground' }]
    label(scene, 'road-label', 'path', 'road'); label(scene, 'nested-label', 'note', 'road-label')
    expect(hiddenDependentsV3(scene, new Set(['ground']))).toEqual(new Set(['ground', ...scene.terrainAreas.ground.boundaryMm.map(point => point.id), 'road', 'road-label', 'nested-label']))
    expect(projectEditorSceneV3(scene, { hiddenLayerIds: new Set(['support']) }).paths).toEqual([])
    expect(projectEditorSceneV3(scene, { hiddenLayerIds: new Set(['support']) }).notes).toEqual([])
    const domain = toGeometryDocumentV2(scene)
    expect(hitTestLayersV3(scene, new Set(['ground']))(domain, { x: 4000, y: 2000 }, 0)).not.toContain('road')
    expect(projectSceneV3(scene, 'gm').paths).toHaveLength(1)
  })

  it('requires fixed masks to cover the true private cap/join and decoration, filtering path resources and nested notes first', async () => {
    const project = await fixture(), native = layers(project), scene = native.document
    scene.paths.road.visibility = 'gm'; label(scene, 'road-label', 'path', 'road'); label(scene, 'nested-label', 'note', 'road-label')
    const mask = (x: number, y: number, width: number, height: number) => {
      scene.regions.mask = { id: 'mask', floorId: 'f-a1', editLocked: false, kind: 'manualMask', visibility: 'gm', boundaryMm: rect(x, y, width, height), blocksMovement: false, movementCostMultiplier: 1 }
      scene.entityLayers.mask = Object.keys(scene.userLayers)[0]
    }
    mask(2000, 2000, 5000, 3000); expect(() => projectSceneV3(scene, 'player')).toThrow('固定遮罩')
    mask(1500, 1500, 6000, 4000); expect(() => projectSceneV3(scene, 'player')).toThrow('固定遮罩')
    mask(1200, 1200, 6600, 4600)
    const player = projectSceneV3(scene, 'player')
    expect(player.paths).toEqual([]); expect(player.notes).toEqual([]); expect(player.materials).toEqual({}); expect(player.assetIds).toEqual([])
    expect(player.pathPaintOrder).toBeUndefined()
    expect(projectSceneV3(scene, 'gm').paths).toHaveLength(1)
    project.document.paths.road.visibility = 'gm'
    project.document.regions.mask = { ...scene.regions.mask }
    expect(projectSceneV2(project.document, 'player').paths).toEqual([])
    project.document.regions.mask.boundaryMm = rect(1500, 1500, 6000, 4000)
    expect(() => projectSceneV2(project.document, 'player')).toThrow('固定遮罩')
  })

  it('pads editor crops for road feather and fixed overlay blends while retaining the full resource plan', async () => {
    const project = await fixture(), projected = projectSceneV2(project.document, 'gm')
    projected.paths[0].edgeStyle.bandWidthMm = 200
    projected.paths[0].style!.overlays.push({ id: 'blend', boundaryMm: rect(3000, 1600, 1000, 800), paint: paint().base, blendWidthMm: 200, renderOrder: 1 })
    const plan = createEditorRenderPlan(projected, { viewBoundsMm: { x: 2500, y: 1700, width: 1000, height: 1000 }, screenScalePxPerMm: 1 })
    expect(editorPaintBounds(projected, plan)).toEqual({ x: 2100, y: 1300, width: 1800, height: 1800 })
    expect(projected.assetIds).toEqual(['test-image'])
  })
})

/** Only Canvas call/resource ownership evidence. Pixel/4K equivalence requires native browser tests. */
function primitives() {
  const calls: { action: string; surface: number; value?: unknown }[] = [], surfaces: HTMLCanvasElement[] = []
  const close = vi.fn(), decode = vi.fn(async () => ({ width: 1, height: 1, close }))
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} closePath() {} })
  vi.stubGlobal('DOMMatrix', class { translate() { return this } rotate() { return this } scale() { return this } })
  vi.stubGlobal('document', { createElement: vi.fn(() => {
    const index = surfaces.length, canvas = { width: 0, height: 0, getContext: vi.fn() }
    const ctx = { canvas, filter: 'none', fillStyle: '' as unknown, strokeStyle: '', lineWidth: 1,
      save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), resetTransform: vi.fn(), clip: vi.fn(),
      fillRect: vi.fn(() => calls.push({ action: 'fill', surface: index, value: ctx.fillStyle })),
      drawImage: vi.fn(() => calls.push({ action: 'image', surface: index })),
      createPattern: vi.fn(() => ({ setTransform: vi.fn() })),
      stroke: vi.fn(() => calls.push({ action: 'stroke', surface: index, value: { filter: ctx.filter, width: ctx.lineWidth } })),
    }
    canvas.getContext.mockReturnValue(ctx); surfaces.push(canvas as unknown as HTMLCanvasElement); return canvas
  }) })
  return { close, decode, calls, surfaces }
}

describe('C4 path Canvas resource submission', () => {
  it('decodes the real path texture, paints the projected band and disposes temporary image surfaces', async () => {
    const project = layers(await fixture()), before = structuredClone(project.document), browser = primitives()
    const output = await renderProjectV3(project, { audience: 'gm', longEdgePx: 4096 })
    expect([output.width, output.height]).toEqual([4096, 3277])
    expect(browser.calls.some(call => call.surface === 0 && call.action === 'fill' && call.value === '#B49D77')).toBe(true)
    expect(browser.calls.some(call => call.surface === 0 && call.action === 'image')).toBe(true)
    expect(browser.calls.filter(call => call.surface === 0 && call.action === 'stroke')).toHaveLength(2)
    expect(browser.decode).toHaveBeenCalledOnce(); expect(browser.close).toHaveBeenCalledOnce()
    expect(browser.surfaces.slice(1).every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
    expect(project.document).toEqual(before)
  })

  it.each(['hidden', 'offscreen'] as const)('still rejects a missing %s road bitmap before allocating any canvas', async mode => {
    const project = layers(await fixture()), browser = primitives()
    delete project.assets[project.document.assets['test-image'].sha256]
    await expect(renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 512,
      ...(mode === 'hidden' ? { hiddenLayerIds: new Set(Object.keys(project.document.userLayers)) } : { viewBoundsMm: { x: 8500, y: 6500, width: 1000, height: 1000 } }),
    })).rejects.toThrow('缺失')
    expect(browser.decode).not.toHaveBeenCalled(); expect(browser.surfaces).toEqual([])
  })
})
