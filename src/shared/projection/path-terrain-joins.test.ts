import { describe, expect, it } from 'vitest'
import type { MaterialRef, PointMm, SurfaceStyle, TerrainArea } from '../model/scene.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { pathJunctionOutlines } from '../../platform/browser/render/path-junctions.js'
import { pathPolygon } from '../geometry/geometry.js'
import { applyCommands } from '../commands/commands.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { visualBase } from '../visual/base.js'
import type { VisualFilter } from '../visual/types.js'
import { projectionAssetConsumers } from './presentation-contract.js'
import { projectEditorScene, projectScene } from './projection.js'

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const paint = (material: MaterialRef): SurfaceStyle => ({ base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm },
  rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] })
function fixture() {
  const scene = createRefinedBlankDocument('island', { sceneId: 'path-terrain-joins', title: '道路营地接头', widthMm: 24000, heightMm: 18000,
    now: '2026-11-10T00:00:00.000Z', preset: 'narrative' })
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  const materials = Object.values(scene.materials).filter(material => material.applicableSurfaces.includes('terrain'))
  const area = (id: string, points: PointMm[], priority: number, material: MaterialRef): TerrainArea => ({ id, floorId, editLocked: false, visibility: 'public',
    boundaryMm: points.map((positionMm, index) => ({ id: `${id}-point-${index}`, segmentId: `${id}-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: priority, surfaceStyle: paint(material), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 })
  scene.terrainAreas.ground = area('ground', rect(0, 0, 24000, 18000), 0, materials[0])
  scene.terrainAreas.camp = area('camp', rect(10000, 6000, 6000, 5000), 1, materials[1])
  scene.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public', centerlineMm: [{ x: 6000, y: 8000 }, { x: 13000, y: 8000 }], widthMm: 1000,
    supportRefs: [{ kind: 'terrainArea', id: 'ground' }, { kind: 'terrainArea', id: 'camp' }], surfaceStyle: paint(materials[1]), movementCostMultiplier: 1, renderOrder: 0 }
  for (const id of ['ground', 'camp', 'road']) scene.entityLayers[id] = layerId
  return { scene, floorId, layerId, area, materials }
}
function filterFor(scene: ReturnType<typeof fixture>['scene'], target: VisualFilter['target']) {
  const floorId = Object.keys(scene.floors)[0], layerId = scene.entityLayers.road
  visualBase(scene)!.filters.grade = { id: 'grade', floorId, layerId, visibility: 'public', editLocked: false, target,
    preset: 'warm', exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'grade', enabled: true }
}

describe('audience-owned road to terrain join relationships', () => {
  it('binds exact visible same-layer single-height surfaces without changing physical or saved data', () => {
    const { scene } = fixture(), before = canonicalJson(scene)
    for (const audience of ['gm', 'player'] as const) {
      const projection = projectScene(scene, audience)
      expect(projection.pathTerrainJoins).toEqual({ terrainPaintOrder: ['ground', 'camp'], roomIds: [], paths: [{ pathId: 'road', terrainIds: ['ground', 'camp'] }] })
      expect(pathJunctionOutlines(projection).has('road')).toBe(true)
      expect(projection.paths[0].points).toEqual(pathPolygon(scene.paths.road))
      expect(projectionAssetConsumers(projection).complete).toBe(true)
    }
    expect(canonicalJson(scene)).toBe(before)
  })
  it('does not join a different user layer or hidden editor surface', () => {
    const { scene, floorId, layerId } = fixture()
    scene.userLayers.campLayer = { id: 'campLayer', floorId, name: '营地', order: Object.keys(scene.userLayers).length, editLocked: false }
    scene.entityLayers.camp = 'campLayer'
    const normal = projectScene(scene, 'gm')
    expect(normal.pathTerrainJoins!.paths[0].terrainIds).toEqual(['ground'])
    expect(pathJunctionOutlines(normal).size).toBe(0)
    const editor = projectEditorScene(scene, { hiddenLayerIds: new Set(['campLayer']) })
    // The existing editor policy also hides a path when its explicit support
    // layer is hidden; no dangling join metadata may outlive that path.
    expect(editor.pathTerrainJoins).toBeUndefined()
    expect(editor.paths).toEqual([])
    expect(pathJunctionOutlines(editor).size).toBe(0)
    expect(projectEditorScene(scene, { hiddenLayerIds: new Set([layerId]) }).pathTerrainJoins).toBeUndefined()
  })
  it.each(['campLayer', 'roomLayer', 'roadLayer'])('omits a room-supported road when its %s is hidden without changing formal output or the stored scene', hiddenLayerId => {
    const { scene: source, floorId, layerId } = fixture()
    delete source.paths.road; delete source.entityLayers.road
    for (const id of ['campLayer', 'roomLayer', 'roadLayer']) {
      source.userLayers[id] = { id, floorId, name: id, order: Object.keys(source.userLayers).length, editLocked: false }
    }
    source.entityLayers.camp = 'campLayer'
    const scene = applyCommands(source, [{ type: 'createRoom', id: 'camp-room', floorId, layerId: 'roomLayer',
      boundaryMm: rect(11000, 7000, 4000, 3000), thicknessMm: 200, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'camp' } }],
    { ids: { nextId: () => 'room-road-generated-id' }, clock: { now: () => '2026-11-12T00:00:00.000Z' } })
    const road = (id: string, centerlineMm: PointMm[], supportRef: { kind: 'room' | 'terrainArea'; id: string }, roadLayer: string) => {
      scene.paths[id] = { id, floorId, editLocked: false, visibility: 'public', centerlineMm, widthMm: 400,
        supportRefs: [supportRef], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
      scene.entityLayers[id] = roadLayer
    }
    road('room-road-a', [{ x: 12000, y: 8000 }, { x: 14000, y: 8000 }], { kind: 'room', id: 'camp-room' }, 'roadLayer')
    road('room-road-b', [{ x: 13000, y: 7500 }, { x: 13000, y: 9500 }], { kind: 'room', id: 'camp-room' }, 'roadLayer')
    road('outside-road', [{ x: 2000, y: 2000 }, { x: 4000, y: 2000 }], { kind: 'terrainArea', id: 'ground' }, layerId)
    expect(validateSceneDocument(scene).ok).toBe(true)
    const before = canonicalJson(scene), gm = projectScene(scene, 'gm'), player = projectScene(scene, 'player')
    expect(gm.paths.map(path => path.id)).toEqual(['outside-road', 'room-road-a', 'room-road-b'])
    expect(gm.pathJoinGroups).toEqual([['outside-road', 'room-road-a', 'room-road-b']])
    const hidden = projectEditorScene(scene, { hiddenLayerIds: new Set([hiddenLayerId]) })
    expect(hidden.paths.map(path => path.id)).toEqual(['outside-road'])
    expect(hidden.pathJoinGroups).toBeUndefined()
    expect(hidden.pathJoinPaintOrder).not.toContain('room-road-a')
    expect(hidden.pathJoinPaintOrder).not.toContain('room-road-b')
    expect(projectEditorScene(scene)).toEqual(gm)
    expect(projectScene(scene, 'gm')).toEqual(gm)
    expect(projectScene(scene, 'player')).toEqual(player)
    expect(canonicalJson(scene)).toBe(before)
  })
  it('does not join multi-height roads and requires complete Floor ranges plus an explicit multi-Floor target', () => {
    const { scene, floorId, layerId } = fixture()
    scene.terrainAreas.camp.groundElevationMm = 1200
    scene.terrainConnections.ramp = { id: 'ramp', floorId, editLocked: false, visibility: 'public', kind: 'ramp',
      from: { surfaceRef: { kind: 'terrainArea', id: 'ground' }, positionMm: { x: 8500, y: 8000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'camp' }, positionMm: { x: 11500, y: 8000 } }, widthMm: 2000, openingId: null,
      blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    scene.entityLayers.ramp = layerId
    const projection = projectScene(scene, 'gm')
    expect(projection.pathTerrainJoins).toBeUndefined()
    expect(pathJunctionOutlines(projection).size).toBe(0)
    scene.floors.other = { ...scene.floors[floorId], id: 'other', name: '另层' }
    scene.userLayers.otherLayer = { id: 'otherLayer', floorId: 'other', name: '另层地面', order: 0, editLocked: false }
    // The whole scene is checked before selecting a target: every Floor must
    // first retain a real output range, including a non-target empty Floor.
    expect(() => projectScene(scene, 'gm')).toThrow(/输出范围/)
    scene.floors[floorId].outputBoundsMm = { ...scene.floors[floorId].boundsMm }
    scene.floors.other.outputBoundsMm = { ...scene.floors.other.boundsMm }
    expect(() => projectScene(scene, 'gm')).toThrow(/目标Floor/)
    expect(projectScene(scene, 'gm', undefined, { floorId }).pathTerrainJoins).toBeUndefined()
  })
  it('filters private ground from public relationships in both audiences and preserves player invariance', () => {
    const { scene, area, materials, floorId, layerId } = fixture(), before = pathJunctionOutlines(projectScene(scene, 'gm'))
    // Keep the private support outside the public road's physical band. A
    // private surface under the road would require an explicit private support
    // and would correctly make the road itself private to player projection.
    scene.terrainAreas.secret = { ...area('secret', rect(11000, 9500, 4000, 1000), 2, materials[0]), visibility: 'gm' }
    scene.entityLayers.secret = layerId
    scene.regions.mask = { id: 'mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', boundaryMm: rect(0, 0, 24000, 18000), blocksMovement: false, movementCostMultiplier: 1 }
    scene.entityLayers.mask = layerId
    const gm = projectScene(scene, 'gm'), player = projectScene(scene, 'player')
    expect(gm.pathTerrainJoins!.terrainPaintOrder).toEqual(['ground', 'camp'])
    expect(pathJunctionOutlines(gm)).toEqual(before)
    expect(JSON.stringify(player)).not.toContain('secret')
    const playerBefore = canonicalJson(player)
    scene.terrainAreas.secret.boundaryMm[0].positionMm.x += 100
    expect(canonicalJson(projectScene(scene, 'player'))).toBe(playerBefore)
    expect(pathJunctionOutlines(projectScene(scene, 'gm'))).toEqual(before)
  })
  it('keeps original edges under actual entity/layer filters and material-rule patches', () => {
    for (const target of [{ kind: 'entities', ids: ['camp'] }, { kind: 'entities', ids: ['road'] }] as const) {
      const { scene } = fixture(); filterFor(scene, { kind: target.kind, ids: [...target.ids] })
      expect(pathJunctionOutlines(projectScene(scene, 'gm')).size).toBe(0)
    }
    const { scene, layerId, floorId } = fixture(); filterFor(scene, { kind: 'layer', layerId })
    expect(pathJunctionOutlines(projectScene(scene, 'gm')).size).toBe(0)
    delete visualBase(scene)!.filters.grade
    scene.surfaceRules.paint = { id: 'paint', floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: 'camp' }, field: 'material', paintOrder: 1,
      regionsMm: [{ outerMm: rect(11000, 7000, 1000, 1000), holesMm: [] }], paint: structuredClone(scene.paths.road.surfaceStyle!.base), blendWidthMm: 200 }
    scene.entityLayers.paint = layerId
    const projection = projectScene(scene, 'gm')
    expect(projection.terrain.find(area => area.id === 'camp')!.materialPatches).toHaveLength(1)
    expect(pathJunctionOutlines(projection).size).toBe(0)
  })
  it('keeps outlines when the public join budget is exceeded', () => {
    const { scene, layerId } = fixture()
    for (let index = 0; index < 128; index++) {
      const id = `road-${index}`; scene.paths[id] = { ...structuredClone(scene.paths.road), id }; scene.entityLayers[id] = layerId
    }
    expect(projectScene(scene, 'gm').pathTerrainJoins).toBeUndefined()
  })
  it('omits distant same-layer terrain from each road candidate list', () => {
    const { scene, area, materials, layerId } = fixture(), before = pathJunctionOutlines(projectScene(scene, 'gm'))
    scene.terrainAreas.far = area('far', rect(18000, 12000, 3000, 3000), 1, materials[1]); scene.entityLayers.far = layerId
    const projection = projectScene(scene, 'gm')
    expect(projection.pathTerrainJoins!.paths).toEqual([{ pathId: 'road', terrainIds: ['ground', 'camp'] }])
    expect(pathJunctionOutlines(projection)).toEqual(before)
  })
})
