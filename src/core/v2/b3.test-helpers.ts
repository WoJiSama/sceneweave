import { createHouse } from '../seed'
import { migrateSceneV1 } from './migration'
import type { PointMm, PropDefinition, PropV2, SceneDocumentV2, TerrainArea } from './types'

export const rectangleV2 = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
export function emptyB3V2(): SceneDocumentV2 {
  const source = createHouse('source')
  source.vertices = {}; source.rooms = {}; source.walls = {}; source.openings = {}; source.props = {}; source.regions = {}; source.notes = {}; source.constraints.entranceOpeningIds = []
  source.floors['f-a1'].boundsMm = { x: 0, y: 0, width: 20000, height: 20000 }; source.exportBoundsMm = structuredClone(source.floors['f-a1'].boundsMm)
  return migrateSceneV1(source, { sceneId: 'b3-tests', now: '2026-10-20T00:00:00.000Z' })
}
export function testTerrainV2(id: string, points: PointMm[], elevation = 0, priority = 1): TerrainArea {
  return { id, floorId: 'f-a1', editLocked: false, visibility: 'public', boundaryMm: points.map((positionMm, i) => ({ id: `${id}-v${i}`, segmentId: `${id}-s${i}`, positionMm })), groundElevationMm: elevation, coveragePriority: priority, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
}
export function terrainFixtureV2(): SceneDocumentV2 {
  const scene = emptyB3V2()
  scene.terrainAreas['island-water'] = { ...testTerrainV2('island-water', rectangleV2(0, 0, 20000, 20000), 0, 0), blocksMovement: true }
  scene.terrainAreas['island-low'] = testTerrainV2('island-low', rectangleV2(1000, 1000, 9000, 18000), 1000)
  scene.terrainAreas['island-high'] = testTerrainV2('island-high', rectangleV2(10000, 1000, 9000, 18000), 3000)
  scene.terrainEdges.cliff = { id: 'cliff', floorId: 'f-a1', editLocked: false, visibility: 'public', source: { areaId: 'island-high', segmentId: 'island-high-s3' }, neighborAreaId: 'island-low', kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: null, styleOverride: null }
  scene.terrainConnections['island-stairs'] = { id: 'island-stairs', floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'island-low' }, positionMm: { x: 8500, y: 10000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'island-high' }, positionMm: { x: 11500, y: 10000 } }, widthMm: 2000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
  return scene
}
export function testDefinitionV2(id = 'tree', blocksMovement = true): PropDefinition {
  return { id, catalogId: `sceneweave.test.${id}`, version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave B3 test original', canEmbed: true }, name: id, tags: [], defaultAppearance: { kind: 'symbol', symbol: 'crate', opacity: 1, tint: null }, defaultVisualBoundsMm: { x: -400, y: -400, width: 800, height: 800 }, defaultFootprintMm: { width: 300, height: 200 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: blocksMovement, defaultBlocksSight: false, defaultRenderLayer: 'canopy', defaultShadowClass: 'vegetation' }
}
export function testPropV2(id: string, x = 4000, y = 4000): PropV2 {
  return { id, floorId: 'f-a1', editLocked: false, visibility: 'public', definitionRef: null, appearance: { kind: 'symbol', symbol: 'crate', opacity: 1, tint: null }, visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, positionMm: { x, y }, rotationDeg: 0, footprintMm: { width: 500, height: 500 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false, supportRef: { kind: 'terrainArea', id: 'island-low' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}
export function scatterFixtureV2(): SceneDocumentV2 {
  const scene = terrainFixtureV2()
  scene.propDefinitions.tree = testDefinitionV2(); scene.propDefinitions.shrub = testDefinitionV2('shrub', false)
  scene.scatterGroups.trees = { id: 'trees', floorId: 'f-a1', editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: 'island-low' }, palette: [{ key: 'z-tree', propDefinitionRef: { id: 'tree', version: 1 }, weight: 3 }, { key: 'a-shrub', propDefinitionRef: { id: 'shrub', version: 1 }, weight: 1 }], seed: '礁岸-织境', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 123, y: -456 }, cellSizeMm: 1600, densityFactor: 0.7, minDistanceMm: 300, rotationRangeDeg: { min: 10, max: 350 }, members: {}, exclusions: [{ id: 'stairs-reserved', boundaryMm: rectangleV2(6500, 9000, 7000, 2000), reason: 'entrance', sourceCandidateKey: null }] }
  return scene
}
