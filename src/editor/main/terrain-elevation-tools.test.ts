import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import builtin from '../../platform/browser/content/builtin-data.json'
import { applyCommands } from '../../shared/commands/commands'
import { applyCompositionCommands } from '../../shared/appearance/commands'
import { createCompositionContent } from '../../shared/appearance/graph'
import { toCurrentSceneDocument } from '../../shared/model/current-scene'
import type { PointMm, SceneDocument, SurfaceStyle, TerrainArea } from '../../shared/model/scene'
import { validateSceneDocument } from '../../shared/validation/scene'
import { createEmptyGeneration5 } from '../../shared/terrain-generation/composition-contracts'
import { emptyVisualSystem } from '../../shared/visual/types'
import TerrainElevationTools from './TerrainElevationTools'
import { assertTerrainElevationStep, createTerrainElevationToolState, inspectTerrainElevationSelection,
  sampleTerrainElevation, stepTerrainElevation, terrainElevationCommands } from './terrain-elevation-tools'

function fixture() {
  const scene = toCurrentSceneDocument(structuredClone(builtin.project.document) as unknown as SceneDocument)
  const floorId = Object.keys(scene.floors)[0], layerId = 'elevation-layer'
  scene.floors[floorId].boundsMm = { x: -10000, y: -10000, width: 30000, height: 30000 }
  scene.exportBoundsMm = { ...scene.floors[floorId].boundsMm }
  scene.userLayers = { [layerId]: { id: layerId, floorId, name: '地形层', order: 0, editLocked: false } }
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.paths = {}; scene.terrainConnections = {}
  scene.terrainAreas = {}; scene.terrainEdges = {}; scene.props = {}; scene.notes = {}; scene.regions = {}
  scene.prefabInstances = {}; scene.scatterGroups = {}; scene.decorations = {}; scene.decorationClusters = {}; scene.surfaceRules = {}
  scene.entityLayers = {}; scene.constraints = { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }
  scene.generation = createEmptyGeneration5(); scene.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
  delete scene.aggregateCoordinates
  function area(id: string, x = 0, height = 0, priority = 0): TerrainArea {
    const points: PointMm[] = [{ x, y: 0 }, { x: x + 4000, y: 0 }, { x: x + 4000, y: 4000 }, { x, y: 4000 }]
    const value: TerrainArea = { id, floorId, editLocked: false, visibility: 'public', groundElevationMm: height, coveragePriority: priority,
      boundaryMm: points.map((positionMm, index) => ({ id: `${id}-p-${index}`, segmentId: `${id}-s-${index}`, positionMm })),
      surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.terrainAreas[id] = value; scene.entityLayers[id] = layerId
    return value
  }
  area('low'); area('high', 6000, 2000)
  return { scene, floorId, layerId, area }
}
const context = { ids: { nextId: () => { throw new Error('Unexpected identity allocation') } }, clock: { now: () => '2026-11-10T00:00:00.000Z' } }
function materialOverlays(scene: SceneDocument, id: string): SurfaceStyle {
  const material = Object.values(scene.materials).find(material => material.applicableSurfaces.includes('terrain'))!
  const points = scene.terrainAreas[id].boundaryMm.map(point => point.positionMm)
  const origin = points[0]
  const paint: SurfaceStyle['base'] = { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 1900, height: 2300 },
    rotationDeg: 35, alignment: 'world', originMm: { x: -300, y: 700 }, tint: null, opacity: 1 }
  const style: SurfaceStyle = { base: paint, overlays: [
    { id: `${id}-material-overlay-later`, boundaryMm: [{ x: origin.x + 1800, y: 500 }, { x: origin.x + 3500, y: 700 }, { x: origin.x + 2800, y: 3200 }],
      paint: { ...structuredClone(paint), opacity: .4, rotationDeg: 95, originMm: { x: 200, y: -100 } }, blendWidthMm: 350, renderOrder: 5 },
    { id: `${id}-material-overlay-earlier`, boundaryMm: [{ x: origin.x + 400, y: 400 }, { x: origin.x + 2500, y: 600 }, { x: origin.x + 2000, y: 2800 }],
      paint: { ...structuredClone(paint), opacity: .75, tileSizeMm: { width: 1000, height: 1500 } }, blendWidthMm: 200, renderOrder: -2 },
  ] }
  scene.terrainAreas[id].surfaceStyle = style
  return style
}

describe('whole-surface elevation proposals', () => {
  it.each([850, -650])('preserves complete world-XY material overlays when setting a whole surface to %i mm', height => {
    const { scene } = fixture(), style = structuredClone(materialOverlays(scene, 'low')), before = structuredClone(scene)
    const selection = inspectTerrainElevationSelection(scene, ['low'])
    expect(selection.reason).toBeNull()
    const commands = terrainElevationCommands(scene, ['low'], height)
    const changed = applyCommands(scene, commands, context)
    expect(changed.terrainAreas.low).toEqual({ ...scene.terrainAreas.low, groundElevationMm: height })
    expect(changed.terrainAreas.low.surfaceStyle).toEqual(style)
    expect(changed.materials).toEqual(before.materials); expect(changed.assets).toEqual(before.assets)
    expect(validateSceneDocument(changed).ok).toBe(true)
    expect(scene).toEqual(before)
  })

  it('levels multiple painted surfaces while preserving their distinct styles and fixed source identities', () => {
    const { scene } = fixture()
    materialOverlays(scene, 'low'); materialOverlays(scene, 'high')
    let sequence = 0
    const runtime = { ids: { nextId: () => `painted-elevation-${++sequence}` }, clock: context.clock }
    const content = createCompositionContent(scene, runtime), before = structuredClone(content)
    const changed = applyCompositionCommands(content, terrainElevationCommands(content.document, ['low', 'high'], 600), runtime)
    for (const id of ['low', 'high']) {
      expect(changed.document.terrainAreas[id]).toEqual({ ...before.document.terrainAreas[id], groundElevationMm: 600 })
      expect(changed.historyIdentity.outdoorTokens[id]).toEqual(before.historyIdentity.outdoorTokens[id])
    }
    expect(changed.appearance).toEqual(before.appearance)
    expect(changed.document.materials).toEqual(before.document.materials); expect(changed.document.assets).toEqual(before.document.assets)
    expect(validateSceneDocument(changed.document).ok).toBe(true)
    expect(content).toEqual(before)
  })

  it('changes only selected heights through ordinary commands, preserving source and unrelated content', () => {
    const { scene } = fixture(), before = structuredClone(scene)
    const commands = terrainElevationCommands(scene, ['low'], -500)
    expect(commands).toEqual([{ type: 'updateTerrainArea', id: 'low', changes: { groundElevationMm: -500 } }])
    const changed = applyCommands(scene, commands, context)
    expect(changed.terrainAreas.low).toEqual({ ...scene.terrainAreas.low, groundElevationMm: -500 })
    expect(changed.terrainAreas.high).toEqual(scene.terrainAreas.high)
    expect(changed.paths).toEqual(scene.paths)
    expect(changed.terrainConnections).toEqual(scene.terrainConnections)
    expect(scene).toEqual(before)
  })

  it('levels explicitly selected surfaces in one proposal and omits already-level surfaces', () => {
    const { scene } = fixture()
    expect(inspectTerrainElevationSelection(scene, ['low', 'high']).currentElevationMm).toBeNull()
    const commands = terrainElevationCommands(scene, ['low', 'high', 'low'], 2000)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toEqual({ type: 'updateTerrainArea', id: 'low', changes: { groundElevationMm: 2000 } })
    const next = applyCommands(scene, commands, context)
    expect(terrainElevationCommands(next, ['low', 'high'], 2000)).toEqual([])
  })

  it('rejects missing, mixed, regional and cross-floor selections without silently filtering them', () => {
    const { scene, area } = fixture()
    expect(() => terrainElevationCommands(scene, [], 100)).toThrow('明确选择')
    expect(() => terrainElevationCommands(scene, ['low', 'missing'], 100)).toThrow('不是完整地形面')
    expect(() => terrainElevationCommands(scene, ['__proto__'], 100)).toThrow('不是完整地形面')
    const other = area('other', 12000)
    other.floorId = 'other-floor'; scene.floors['other-floor'] = { ...Object.values(scene.floors)[0], id: 'other-floor' }
    expect(inspectTerrainElevationSelection(scene, ['low', 'other']).reason).toContain('同一楼层')
    expect(() => terrainElevationCommands({ ...scene, mapMode: 'regional' }, ['low'], 100)).toThrow('场景地图')
  })

  it.each([false, true])('checks own and adjacent dependency locks, missing layers and unsafe elevations (painted=%s)', painted => {
    const { scene, layerId, area } = fixture()
    if (painted) materialOverlays(scene, 'low')
    scene.terrainAreas.low.editLocked = true
    expect(() => terrainElevationCommands(scene, ['low'], 100)).toThrow('已锁定')
    scene.terrainAreas.low.editLocked = false; scene.userLayers[layerId].editLocked = true
    expect(() => terrainElevationCommands(scene, ['low'], 100)).toThrow('地形层')
    scene.userLayers[layerId].editLocked = false
    const adjacent = area('adjacent', 4000); adjacent.editLocked = true
    expect(() => terrainElevationCommands(scene, ['low'], 100)).toThrow('必要依赖 adjacent')
    delete scene.terrainAreas.adjacent; delete scene.entityLayers.adjacent
    delete scene.entityLayers.low
    expect(() => terrainElevationCommands(scene, ['low'], 100)).toThrow('有效图层')
    scene.entityLayers.low = layerId
    for (const value of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) expect(() => terrainElevationCommands(scene, ['low'], value)).toThrow('安全整数')
    scene.terrainAreas.high.groundElevationMm = -1000
    expect(() => terrainElevationCommands(scene, ['low'], Number.MAX_SAFE_INTEGER)).toThrow('高差超出安全整数')
  })

  it.each([false, true])('explains room support conflicts and does not silently raise buildings (painted=%s)', painted => {
    const { scene, floorId, layerId } = fixture()
    if (painted) materialOverlays(scene, 'low')
    for (const [index, point] of scene.terrainAreas.low.boundaryMm.entries()) scene.vertices[`v${index}`] = { id: `v${index}`, floorId, editLocked: false, xMm: point.positionMm.x, yMm: point.positionMm.y }
    scene.rooms.room = { id: 'room', floorId, editLocked: false, visibility: 'public', purpose: '房间', boundaryVertexIds: ['v0', 'v1', 'v2', 'v3'],
      accessExpectation: 'unspecified', supportRef: { kind: 'terrainArea', id: 'low' }, groundElevationMm: 0, floorStyle: null }
    scene.entityLayers.room = layerId
    const before = structuredClone(scene)
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('房间 room')
    expect(scene).toEqual(before)
  })

  it.each([false, true])('detects path width touching the area even when its centerline and declared support are outside (painted=%s)', painted => {
    const { scene, floorId, layerId } = fixture()
    if (painted) materialOverlays(scene, 'low')
    scene.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public', centerlineMm: [{ x: -2000, y: -100 }, { x: 5000, y: -100 }],
      widthMm: 500, supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    scene.entityLayers.road = layerId
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('道路 road 的完整宽度')
  })

  it.each([false, true])('detects independent walls and existing height connections (painted=%s)', painted => {
    const { scene, floorId } = fixture()
    if (painted) materialOverlays(scene, 'low')
    scene.vertices.a = { id: 'a', floorId, editLocked: false, xMm: -1000, yMm: 2000 }
    scene.vertices.b = { id: 'b', floorId, editLocked: false, xMm: 5000, yMm: 2000 }
    scene.walls.wall = { id: 'wall', floorId, editLocked: false, startVertexId: 'a', endVertexId: 'b', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('接触墙体 wall')
    scene.walls = {}; scene.vertices = {}
    scene.terrainConnections.stairs = { id: 'stairs', floorId, editLocked: false, visibility: 'public', kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 2000, y: 2000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 8000, y: 2000 } },
      widthMm: 1000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    expect(() => terrainElevationCommands(scene, ['low'], 2000)).toThrow('楼梯或坡道 stairs')
  })

  it.each([false, true])('uses real object footprints instead of just anchors when preserving supported scenery (painted=%s)', painted => {
    const { scene, floorId } = fixture()
    if (painted) materialOverlays(scene, 'low')
    scene.props.tree = { id: 'tree', floorId, editLocked: false, visibility: 'public', definitionRef: null,
      appearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 }, visualBoundsMm: { x: -200, y: -200, width: 400, height: 400 },
      positionMm: { x: -100, y: 2000 }, rotationDeg: 0, footprintMm: { width: 400, height: 400 }, footprintOffsetMm: { x: 0, y: 0 },
      blocksMovement: false, blocksSight: false, supportRef: { kind: 'floor', id: floorId }, renderLayer: 'object', renderOrder: 0,
      shadowClass: 'none', shadowOverride: null }
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('物件 tree')
  })

  it.each([false, true])('checks scaled and rotated decoration footprints without treating visual overhang as support (painted=%s)', painted => {
    const { scene, floorId, layerId } = fixture()
    if (painted) materialOverlays(scene, 'low')
    const definition = Object.values(scene.propDefinitions)[0]
    definition.defaultBlocksMovement = false; definition.defaultBlocksSight = false
    definition.defaultFootprintMm = { width: 400, height: 800 }
    definition.defaultFootprintOffsetMm = { x: 0, y: -100 }
    definition.defaultVisualBoundsMm = { x: -2000, y: -2000, width: 4000, height: 4000 }
    scene.decorations.grass = { id: 'grass', floorId, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: definition.version },
      supportRef: { kind: 'floor', id: floorId }, positionMm: { x: -250, y: 2000 }, rotationDeg: 90, scalePpm: 500000, renderOrder: 0 }
    scene.entityLayers.grass = layerId
    expect(inspectTerrainElevationSelection(scene, ['low']).reason).toContain('装饰 grass 的真实占地')
    scene.decorations.grass.positionMm.x = -251
    expect(inspectTerrainElevationSelection(scene, ['low']).reason).toBeNull()
    expect(terrainElevationCommands(scene, ['low'], 500)).toHaveLength(1)
  })

  it.each([false, true])('keeps planted rules, explicit edges and bound visual curves outside the first scope (painted=%s)', painted => {
    const { scene, floorId, layerId } = fixture()
    if (painted) materialOverlays(scene, 'low')
    scene.surfaceRules.planting = { id: 'planting', floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'low' }, field: 'trees',
      paintOrder: 0, regionsMm: [], clusterId: 'trees', coveragePpm: 300000 }
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('地表规则 planting')
    scene.surfaceRules = {}
    scene.terrainEdges.edge = { id: 'edge', floorId, editLocked: false, visibility: 'public', source: { areaId: 'low', segmentId: 'low-s-0' }, neighborAreaId: null,
      kind: 'materialTransition', shoreline: false, blocksMovement: false, blocksSight: false, surfaceStyle: null, styleOverride: null }
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('地形边缘 edge')
    scene.terrainEdges = {}
    scene.visual.base.base.boundaries.curve = { id: 'curve', floorId, layerId, editLocked: false, visibility: 'public', closed: false,
      binding: { kind: 'terrain', sides: [{ areaId: 'low', startPointId: 'low-p-0', endPointId: 'low-p-1', reverse: false }] },
      segments: [], sampleSpacingMm: 100, toleranceMm: 5 }
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('视觉曲线 curve')
  })

  it('still runs the existing complete domain validation before yielding a command', () => {
    const { scene } = fixture()
    scene.terrainAreas.low.boundaryMm[2].positionMm = { x: -1, y: -1 }
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('当前场景无效')
  })

  it('validates actual overlay geometry and fixed material references instead of treating overlays as an exemption', () => {
    for (const invalid of ['missing-material', 'self-intersection', 'fractional-coordinate'] as const) {
      const { scene } = fixture(), style = materialOverlays(scene, 'low')
      if (invalid === 'missing-material') style.overlays[0].paint.materialRef.id = 'missing-terrain-material'
      if (invalid === 'self-intersection') style.overlays[0].boundaryMm = [{ x: 500, y: 500 }, { x: 3000, y: 3000 }, { x: 500, y: 3000 }, { x: 3000, y: 500 }]
      if (invalid === 'fractional-coordinate') style.overlays[0].boundaryMm[0].x += .5
      const before = structuredClone(scene)
      expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('当前场景无效')
      expect(scene).toEqual(before)
    }
  })

  it('distinguishes retained local material overlays from managed material rules', () => {
    const { scene, floorId, layerId } = fixture(), style = materialOverlays(scene, 'low')
    scene.surfaceRules.material = { id: 'material', floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'low' },
      field: 'material', paintOrder: 0, regionsMm: [{ outerMm: structuredClone(style.overlays[0].boundaryMm), holesMm: [] }], paint: structuredClone(style.base), blendWidthMm: 250 }
    scene.entityLayers.material = layerId
    expect(() => terrainElevationCommands(scene, ['low'], 500)).toThrow('地表规则 material')
  })

  it('retains painted source closures through real candidate cancellation, stale rejection, single undo and cold persistence', async () => {
    const [{ default: Dexie }, { Workspace }, { ProjectRepository }, { fromBundle }, ports, { inspectDependencies }] = await Promise.all([
      import('dexie'), import('../../application/workspace/workspace'), import('../../platform/browser/storage/repository'),
      import('../../application/workspace/project'), import('../../application/workspace/test-fixtures'), import('../../shared/geometry/dependencies'),
    ])
    const bundle = ports.fixture({ image: true }), document = structuredClone(bundle.project.document)
    const floorId = Object.keys(document.floors)[0], layerId = Object.keys(document.userLayers)[0]
    for (const id of Object.keys(document.props)) delete document.entityLayers[id]
    document.props = {}
    const source = fixture().scene.terrainAreas.low
    document.terrainAreas.low = { ...source, floorId }; document.entityLayers.low = layerId
    const image = document.assets.image
    document.materials['elevation-material'] = { id: 'elevation-material', catalogId: 'test.elevation.material', version: 1, name: '真实像素地面', tags: [],
      licenseRef: image.licenseRef, origin: structuredClone(image.origin), textureAssetId: image.id, defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain'] }
    materialOverlays(document, 'low')
    const content = createCompositionContent(document, ports.runtime), licenseHash = Object.keys(bundle.project.licenses)[0]
    const project = await fromBundle({ ...bundle, project: { ...bundle.project, ...content,
      licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })) } }, ports.validation)
    const name = `painted-elevation-${crypto.randomUUID()}`, repo = new ProjectRepository({ name, runtime: ports.runtime, validation: ports.validation })
    const workspace = new Workspace(repo, { runtime: ports.runtime, validation: ports.validation })
    try {
      await workspace.adoptNew(project)
      const original = workspace.getState().project!, checkpoint = workspace.checkpoint()
      const cancelled = await workspace.preview(terrainElevationCommands(original.document, ['low'], 500))
      workspace.cancelPreview(cancelled)
      await expect(workspace.adoptPreview(cancelled)).rejects.toThrow('不可重复采用')
      expect(workspace.getState().project).toBe(original); expect(workspace.checkpoint()).toBe(checkpoint)
      const stale = await workspace.preview(terrainElevationCommands(original.document, ['low'], 500))
      await workspace.execute([{ type: 'renameScene', title: '范围外新编辑保留' }])
      await expect(workspace.adoptPreview(stale)).rejects.toThrow('准备期间场景已有修改')
      expect(workspace.getDocument()!.terrainAreas.low.groundElevationMm).toBe(0)
      const before = workspace.getState().project!
      const preview = await workspace.preview(terrainElevationCommands(before.document, ['low'], 500))
      await workspace.adoptPreview(preview)
      const changed = workspace.getState().project!
      expect(changed.document.terrainAreas.low).toEqual({ ...before.document.terrainAreas.low, groundElevationMm: 500 })
      expect(changed.appearance).toEqual(before.appearance)
      expect(changed.assets).toEqual(before.assets); expect(changed.licenses).toEqual(before.licenses)
      expect(changed.historyIdentity).toEqual(before.historyIdentity)
      workspace.undo()
      expect(workspace.getDocument()!.terrainAreas.low).toEqual(before.document.terrainAreas.low)
      expect(workspace.getDocument()!.title).toBe('范围外新编辑保留')
      expect(workspace.getDocument()!.revision).toBeGreaterThan(changed.document.revision)
      workspace.redo(); await workspace.flush()
      const cold = (await repo.load(document.sceneId))!.project
      expect(cold.document.terrainAreas.low).toEqual(changed.document.terrainAreas.low)
      expect(cold.appearance).toEqual(before.appearance)
      expect(cold.assets).toEqual(before.assets); expect(cold.licenses).toEqual(before.licenses)
    } finally {
      await workspace.close(); repo.close(); await Dexie.delete(name)
    }
  }, 20000)
})

describe('elevation gesture and read-only sampling', () => {
  it('accumulates signed integer-mm steps only in active mode, preserving the prior state', () => {
    const { scene } = fixture(), idle = createTerrainElevationToolState(scene, ['high'])
    expect(idle).toEqual({ mode: 'idle', targetElevationMm: 2000, stepMm: 100 })
    expect(() => stepTerrainElevation(idle, 1)).toThrow('启用')
    const active = { ...idle, mode: 'elevate' as const }, next = stepTerrainElevation(stepTerrainElevation(active, 1), -1)
    expect(next).toEqual(active); expect(idle.mode).toBe('idle')
    expect(() => stepTerrainElevation({ ...active, targetElevationMm: Number.MAX_SAFE_INTEGER }, 1)).toThrow('安全整数')
    for (const step of [0, -1, .1, NaN, Infinity]) expect(() => assertTerrainElevationStep(step)).toThrow('正的安全整数')
  })

  it('samples the effective surface by priority and Floor zero without editing or unlocking', () => {
    const { scene, floorId, area } = fixture()
    area('upper', 0, -300, 5).editLocked = true
    const before = structuredClone(scene)
    expect(sampleTerrainElevation(scene, floorId, { x: 2000, y: 2000 })).toEqual({ surfaceRef: { kind: 'terrainArea', id: 'upper' }, elevationMm: -300 })
    expect(sampleTerrainElevation(scene, floorId, { x: -2000, y: -2000 })).toEqual({ surfaceRef: { kind: 'floor', id: floorId }, elevationMm: 0 })
    expect(scene).toEqual(before)
    expect(() => sampleTerrainElevation(scene, floorId, { x: 20001, y: 0 })).toThrow('超出')
    expect(() => sampleTerrainElevation(scene, floorId, { x: .1, y: 0 })).toThrow('整数毫米')
    expect(() => sampleTerrainElevation(scene, 'missing', { x: 0, y: 0 })).toThrow('楼层不存在')
  })

  it('shows a concrete refusal while leaving read-only sampling available', () => {
    const { scene } = fixture(); scene.terrainAreas.low.editLocked = true
    const html = renderToStaticMarkup(createElement(TerrainElevationTools, { scene, selectedIds: ['low'], state: createTerrainElevationToolState(scene, ['low']),
      onChange: () => {}, onPreview: () => {}, onCancel: () => {} }))
    expect(html).toContain('地形 low 已锁定')
    expect(html).toMatch(/disabled=""[^>]*>启用整面滚轮升降/)
    expect(html).toMatch(/aria-pressed="false">从地面取高/)
    expect(html).toContain('取高只设置工具参数')
  })
})
