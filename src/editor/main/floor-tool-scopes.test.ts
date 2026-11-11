import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EditableProject } from '../../application/workspace/project'
import { fixture as workspaceFixture } from '../../application/workspace/test-fixtures'
import { toCurrentSceneDocument } from '../../shared/model/current-scene'
import type { BoundsMm, PointMm, SceneDocument } from '../../shared/model/scene'
import { canonicalJson } from '../../shared/validation/json'
import { visualBase } from '../../shared/visual/base'
import OutdoorToolsPanel, { SurfaceMultiSelect, SurfaceSelect } from './OutdoorToolsPanel'
import OutdoorInspector from './OutdoorInspector'
import PrefabPanel from './PrefabPanel'
import PlacementInspector from './PlacementInspector'
import TerrainEditingPanel from './TerrainEditingPanel'

const noop = () => {}, asyncNoop = async () => {}
function fixture(): SceneDocument {
  const now = '2026-11-10T00:00:00.000Z', bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const scene = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'floor-tool-scopes', revision: 0,
    title: 'Independent tool targets', createdAt: now, updatedAt: now, units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false },
    exportBoundsMm: bounds, floors: { A: { id: 'A', name: 'First', boundsMm: bounds, outputBoundsMm: bounds },
      B: { id: 'B', name: 'Second', boundsMm: { x: -30000, y: -20000, width: 24000, height: 18000 }, outputBoundsMm: { x: -28000, y: -19000, width: 12000, height: 10000 } } },
    userLayers: { 'layer-A': { id: 'layer-A', floorId: 'A', name: 'First ground', order: 0, editLocked: false }, 'layer-B': { id: 'layer-B', floorId: 'B', name: 'Second ground', order: 0, editLocked: false } },
    entityLayers: {}, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'scope', presetVersion: 1, distanceMode: 'metric', source: 'Original tool fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
  for (const floorId of ['A', 'B']) {
    const x = floorId === 'A' ? 2000 : -26000, y = floorId === 'A' ? 2000 : -17000, id = `area-${floorId}`
    const points: PointMm[] = [{ x, y }, { x: x + 4000, y }, { x: x + 4000, y: y + 4000 }, { x, y: y + 4000 }]
    scene.terrainAreas[id] = { id, floorId, editLocked: false, visibility: 'public', boundaryMm: points.map((positionMm, i) => ({ id: `${id}-p-${i}`, segmentId: `${id}-s-${i}`, positionMm })), groundElevationMm: 0, coveragePriority: 0, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, surfaceStyle: null }
    scene.entityLayers[id] = `layer-${floorId}`
    const roomId = `room-${floorId}`, wallId = `wall-${floorId}`
    points.forEach((point, i) => { const vertexId = `${roomId}-v-${i}`; scene.vertices[vertexId] = { id: vertexId, floorId, editLocked: false, xMm: point.x, yMm: point.y }; scene.entityLayers[vertexId] = `layer-${floorId}` })
    scene.rooms[roomId] = { id: roomId, floorId, editLocked: false, boundaryVertexIds: points.map((_, i) => `${roomId}-v-${i}`), purpose: `Room ${floorId}`, visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: floorId }, groundElevationMm: 0, floorStyle: null }
    scene.walls[wallId] = { id: wallId, floorId, editLocked: false, startVertexId: `${roomId}-v-0`, endVertexId: `${roomId}-v-1`, thicknessMm: 100, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.openings[`door-${floorId}`] = { id: `door-${floorId}`, floorId, editLocked: false, wallId, offsetReferenceVertexId: `${roomId}-v-0`, offsetMm: 1000, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    scene.paths[`path-${floorId}`] = { id: `path-${floorId}`, floorId, editLocked: false, visibility: 'public', centerlineMm: points.slice(0, 2), widthMm: 1000, supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    scene.terrainEdges[`edge-${floorId}`] = { id: `edge-${floorId}`, floorId, editLocked: false, visibility: 'public', source: { areaId: id, segmentId: `${id}-s-0` }, neighborAreaId: null, kind: 'materialTransition', shoreline: false, blocksMovement: false, blocksSight: false, surfaceStyle: null, styleOverride: null }
    for (const entityId of [roomId, wallId, `door-${floorId}`, `path-${floorId}`, `edge-${floorId}`]) scene.entityLayers[entityId] = `layer-${floorId}`
    visualBase(scene)!.boundaries[`curve-${floorId}`] = { id: `curve-${floorId}`, floorId, layerId: `layer-${floorId}`, visibility: 'public', editLocked: false, closed: false,
      sampleSpacingMm: 200, toleranceMm: 5, segments: [{ id: `segment-${floorId}`, start: points[0], control1: points[0], control2: points[1], end: points[1] }],
      binding: { kind: 'terrain', sides: [{ areaId: id, startPointId: `${id}-p-0`, endPointId: `${id}-p-1`, reverse: false }] } }
  }
  return scene
}
function select(html: string, label: string): string {
  const result = html.match(new RegExp(`<select[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</select>`))
  expect(result, `Missing select ${label}`).not.toBeNull()
  return result![1]
}
const values = (html: string) => [...html.matchAll(/<option[^>]*value="([^"]*)"/g)].map(match => match[1])
const supports = ['floor:B', 'terrainArea:area-B', 'room:room-B']
function terrain(scene: SceneDocument, floorId?: string): string {
  return renderToStaticMarkup(createElement(TerrainEditingPanel, { scene, floorId, busy: false, disabled: false, error: null, candidate: null,
    onPreview: asyncNoop, onAdopt: asyncNoop, onCancel: noop, onCanvasSession: noop, onDraftChange: noop }))
}
function outdoor(scene: SceneDocument, activeTask: 'path' | 'connection' | 'scatter'): string {
  return renderToStaticMarkup(createElement(OutdoorToolsPanel, { scene, layerId: 'layer-B', disabled: false, sketch: null, activeTask, onSketch: noop, onPreview: noop, onSelect: noop }))
}

describe('ordinary tool UI targets a complete independent Floor', () => {
  it('limits explicit support controls to the selected Floor without changing legacy unscoped controls', () => {
    const scene = fixture(), before = canonicalJson(scene)
    const one = renderToStaticMarkup(createElement(SurfaceSelect, { scene, floorId: 'B', value: 'floor:B', label: 'single', onChange: noop }))
    const many = renderToStaticMarkup(createElement(SurfaceMultiSelect, { scene, floorId: 'B', values: ['floor:B'], label: 'multi', onChange: noop }))
    expect(values(select(one, 'single'))).toEqual(['', ...supports])
    expect(values(select(many, 'multi'))).toEqual(supports)
    const unknown = renderToStaticMarkup(createElement(SurfaceMultiSelect, { scene, floorId: 'missing', values: [], label: 'missing', onChange: noop }))
    expect(values(select(unknown, 'missing'))).toEqual([])
    const legacy = renderToStaticMarkup(createElement(SurfaceSelect, { scene, value: '', label: 'legacy', onChange: noop }))
    expect(values(select(legacy, 'legacy'))).toContain('floor:A')
    expect(canonicalJson(scene)).toBe(before)
  })

  it('uses the target layer Floor for new roads, connections, openings, scatter domains and object lists', () => {
    const scene = fixture(), before = canonicalJson(scene)
    expect(values(select(outdoor(scene, 'path'), '道路支撑表面'))).toEqual(supports)
    const connection = outdoor(scene, 'connection')
    expect(values(select(connection, '连接起点表面'))).toEqual(['', ...supports])
    expect(values(select(connection, '连接终点表面'))).toEqual(['', ...supports])
    expect(values(select(connection, '连接附着开口'))).toEqual(['', 'door-B'])
    const scatter = outdoor(scene, 'scatter')
    expect(values(select(scatter, '散布域'))).toEqual(['', 'area:area-B', 'path:path-B', 'edgeBand:edge-B'])
    expect(scatter).toContain('title="area-B"'); expect(scatter).not.toContain('title="area-A"')
    const inspected = renderToStaticMarkup(createElement(OutdoorInspector, { scene, id: 'path-B', disabled: false, onPreview: noop, onSelect: noop }))
    expect(values(select(inspected, '对象道路支撑'))).toEqual(supports)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('limits both pending prop and prefab support to their actual target Floor', () => {
    const scene = fixture(), before = canonicalJson(scene)
    const prop = { ...workspaceFixture().project.document.props.item, id: 'pending', floorId: 'B', supportRef: { kind: 'floor' as const, id: 'B' } }
    const placement = renderToStaticMarkup(createElement(PlacementInspector, { scene, prop, busy: false, ready: true, onChange: noop, onPlace: noop, onCancel: noop }))
    expect(values(select(placement, '放置表面'))).toEqual(['floor:B', 'room:room-B', 'terrainArea:area-B'])
    const prefab = renderToStaticMarkup(createElement(PrefabPanel, { project: { document: scene } as EditableProject, ids: [], layerId: 'layer-B', disabled: false, placementDefinitionId: null, onPreview: noop, onSelect: noop }))
    expect(values(select(prefab, '组合支撑表面')).map(value => value.replaceAll('&quot;', '"'))).toEqual(['', '{"kind":"floor","id":"B"}', '{"kind":"room","id":"room-B"}', '{"kind":"terrainArea","id":"area-B"}'])
    expect(canonicalJson(scene)).toBe(before)
  })

  it('binds terrain brush and contour defaults to the explicit negative-coordinate Floor output', () => {
    const scene = fixture(), before = canonicalJson(scene), html = terrain(scene, 'B')
    expect(values(select(html, '地形编辑作用地形'))).toEqual(['area-B'])
    expect(values(select(html, '地形编辑轮廓'))).toEqual(['', 'curve-B'])
    expect(html).toContain('aria-label="地形编辑落笔 X mm" type="number" step="1" value="-22000"')
    expect(html).toContain('aria-label="地形编辑落笔 Y mm" type="number" step="1" value="-14000"')
    expect(html).toContain('可写范围 12.000 m × 10.000 m；原点 X -28.000 m / Y -19.000 m。')
    expect(() => terrain(scene)).toThrow(/必须明确/)
    expect(() => terrain(scene, 'missing')).toThrow(/现存目标/)
    delete scene.terrainAreas['area-B']
    expect(values(select(terrain(scene, 'B'), '地形编辑作用地形'))).toEqual([])
    scene.terrainAreas['area-B'] = JSON.parse(before).terrainAreas['area-B']
    expect(canonicalJson(scene)).toBe(before)
  })

  it('preserves the exact old single-Floor global scope even outside its world bounds', () => {
    const scene = fixture()
    delete scene.floors.B; delete scene.floors.A.outputBoundsMm; delete scene.userLayers['layer-B']
    const global: BoundsMm = { x: -1000, y: -2000, width: 30000, height: 25000 }; scene.exportBoundsMm = global
    const html = terrain(scene)
    expect(html).toContain('可写范围 30.000 m × 25.000 m；原点 X -1.000 m / Y -2.000 m。')
    expect(html).toContain('aria-label="地形编辑落笔 X mm" type="number" step="1" value="14000"')
    expect(html).toContain('aria-label="地形编辑落笔 Y mm" type="number" step="1" value="10500"')
    expect(values(select(html, '地形编辑作用地形'))).toEqual(['area-A'])
    expect(values(select(html, '地形编辑轮廓'))).toEqual(['', 'curve-A'])
  })
})
