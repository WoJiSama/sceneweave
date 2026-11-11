import type { PointMm, SceneDocument, ScatterGroup } from '../../../shared/model/scene.js'
import { buildScatterRegeneration } from '../../../shared/geometry/scatter.js'
import { pathPolygon, polygonInside, polygonsOverlap, propFootprint, roomPoints, terrainPoints } from '../../../shared/geometry/geometry.js'
import { cloneJson } from '../../../shared/validation/json.js'

export type OutpostVegetationDensity = 'sparse' | 'balanced' | 'dense'
export const OUTPOST_VEGETATION_GROUP_IDS = ['outpost-woodland-trees', 'outpost-woodland-shrubs', 'outpost-woodland-grass'] as const
const densityFactors = { sparse: .38, balanced: .7, dense: 1 } as const
const p = (x: number, y: number): PointMm => ({ x, y })
const rectangle = (left: number, top: number, right: number, bottom: number): PointMm[] => [p(left, top), p(right, top), p(right, bottom), p(left, bottom)]
const bounds = (points: PointMm[], marginMm: number): PointMm[] => rectangle(
  Math.floor(Math.min(...points.map(point => point.x)) - marginMm), Math.floor(Math.min(...points.map(point => point.y)) - marginMm),
  Math.ceil(Math.max(...points.map(point => point.x)) + marginMm), Math.ceil(Math.max(...points.map(point => point.y)) + marginMm))

/** New-layout composition only. Saved managed/manual/deleted members are edited
 * through the ordinary scatter tools; loading a project never calls this helper. */
export function applyOutpostVegetation(scene: SceneDocument, density: OutpostVegetationDensity = 'balanced'): void {
  if (!Object.hasOwn(densityFactors, density)) throw new Error('哨站植被仅支持疏、适中、密三种密度。')
  const ground = scene.terrainAreas['sample-ground'], layerId = 'theme-pack-props'
  const layer = scene.userLayers[layerId], floor = ground && scene.floors[ground.floorId]
  const groundLayer = ground && scene.userLayers[scene.entityLayers[ground.id]]
  if (!ground || !floor || ground.visibility !== 'public' || ground.blocksMovement || ground.groundElevationMm !== 0
    || ground.editLocked || !groundLayer || groundLayer.editLocked || !layer || layer.floorId !== ground.floorId || layer.editLocked
    || floor.boundsMm.x !== 0 || floor.boundsMm.y !== 0 || floor.boundsMm.width !== 36000 || floor.boundsMm.height !== 28000) {
    throw new Error('哨站植被预设只用于新建36×28米、公开且未锁定的平地样板。')
  }
  const occupiedIds = new Set(Object.values(scene).flatMap(value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []))
  if (OUTPOST_VEGETATION_GROUP_IDS.some(id => occupiedIds.has(id)
    || [...occupiedIds].some(occupied => occupied.startsWith(`${id}-`)))) {
    throw new Error('哨站植被已存在；请使用散布编辑保留人工移动、删除和锁定记录。')
  }
  const working = cloneJson(scene), additions: string[] = []
  const groups = [
    { id: OUTPOST_VEGETATION_GROUP_IDS[0], cellSizeMm: 1350, minDistanceMm: 300, keys: ['broadleaf-tree', 'pine-tree', 'river-willow'],
      clearing: [p(4700, 6500), p(16000, 6500), p(18200, 10300), p(29900, 10200), p(30300, 21800), p(20600, 23500), p(17500, 22200), p(5600, 23400), p(4700, 20000)] },
    { id: OUTPOST_VEGETATION_GROUP_IDS[1], cellSizeMm: 1800, minDistanceMm: 120, keys: ['low-shrub', 'fern'],
      clearing: [p(5400, 7200), p(15600, 7200), p(17700, 11100), p(29200, 10900), p(29800, 21200), p(20500, 22900), p(17000, 21600), p(6300, 22800), p(5400, 20000)] },
    { id: OUTPOST_VEGETATION_GROUP_IDS[2], cellSizeMm: 1750, minDistanceMm: 80, keys: ['grass-tuft', 'flower-patch'],
      clearing: [p(6200, 8000), p(15000, 8000), p(17300, 11900), p(28500, 11600), p(29100, 20700), p(20100, 22100), p(16700, 21000), p(7000, 22000), p(6200, 19900)] },
  ]
  for (const [index, specification] of groups.entries()) {
    const groupId = specification.id
    const exclusion = (key: string, boundaryMm: PointMm[], reason: 'manual' | 'entrance' = 'manual') => ({ id: `${groupId}-${key}`, boundaryMm, reason, sourceCandidateKey: null })
    const exclusions: ScatterGroup['exclusions'] = [exclusion('activity-clearing', specification.clearing)]
    for (const area of Object.values(working.terrainAreas).filter(area => area.floorId === ground.floorId && area.id !== ground.id)) {
      exclusions.push(exclusion(`terrain-${area.id}`, terrainPoints(area)))
    }
    for (const room of Object.values(working.rooms).filter(room => room.floorId === ground.floorId)) {
      exclusions.push(exclusion(`room-${room.id}`, bounds(roomPoints(working, room), 500), 'entrance'))
    }
    for (const path of Object.values(working.paths).filter(path => path.floorId === ground.floorId)) {
      // Conservative integer rectangles retain the entire square-cap/miter band
      // and a verge; no fractional render polygon is rounded into saved geometry.
      for (let segment = 0; segment < path.centerlineMm.length - 1; segment++) {
        exclusions.push(exclusion(`path-${path.id}-${segment}`, bounds(path.centerlineMm.slice(segment, segment + 2), path.widthMm + 350), 'entrance'))
      }
    }
    const palette = specification.keys.map((key, order) => {
      const definitions = Object.values(working.propDefinitions).filter(definition => definition.catalogId === `prop.sceneweave.theme-pack.wilderness.${key}` && definition.version === 2)
      if (definitions.length !== 1) throw new Error(`哨站植被需要唯一固定v2素材：${key}。`)
      return { key, propDefinitionRef: { id: definitions[0].id, version: definitions[0].version }, weight: index === 0 && order < 2 ? 3 : 1 }
    })
    working.scatterGroups[groupId] = { id: groupId, floorId: ground.floorId, editLocked: false, visibility: 'public',
      domain: { kind: 'area', areaId: ground.id }, palette, seed: `sceneweave-outpost-woodland-layout1-${index}`,
      algorithmVersion: 'scatter-cell-v2', gridOriginMm: p(0, 0), cellSizeMm: specification.cellSizeMm,
      densityFactor: densityFactors[density] * (index === 2 ? .72 : 1), minDistanceMm: specification.minDistanceMm,
      rotationRangeDeg: { min: 0, max: 359 }, members: {}, exclusions }
    working.entityLayers[groupId] = layerId
    const proposal = buildScatterRegeneration(working, groupId, undefined, { allocatePropId: key => `${groupId}-${key}` })
    if (proposal.removePropIds.length) throw new Error('新哨站植被不得移除既有成员。')
    for (const prop of proposal.props) {
      const footprint = propFootprint(prop)
      if (!polygonInside(footprint, terrainPoints(ground))
        || Object.values(working.paths).some(path => path.floorId === ground.floorId && polygonsOverlap(footprint, pathPolygon(path)))
        || Object.values(working.rooms).some(room => room.floorId === ground.floorId && polygonsOverlap(footprint, roomPoints(working, room)))) {
        throw new Error('哨站植被的真实占地侵入活动通路或建筑。')
      }
      working.props[prop.id] = prop; working.entityLayers[prop.id] = layerId; additions.push(prop.id)
    }
    working.scatterGroups[groupId] = proposal.group
  }
  if (additions.length > 180) throw new Error('哨站植被布局超过180个实际成员预算。')
  // Publish only the known additions after every group passes. Caller-owned
  // objects, source definitions and unrelated rules retain their exact values.
  for (const id of additions) { scene.props[id] = working.props[id]; scene.entityLayers[id] = layerId }
  for (const id of OUTPOST_VEGETATION_GROUP_IDS) { scene.scatterGroups[id] = working.scatterGroups[id]; scene.entityLayers[id] = layerId }
}
