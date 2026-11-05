import { geometryIdentityIds } from '../commands/domain.js'
import { connectionFootprint, pointOnSurface, polygonDistance, polygonInside, propFootprint, supportedPolygon, terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility, publicTerrainView } from '../geometry/visibility.js'
import type { AppearanceGraph } from '../model/appearance.js'
import type { SceneCommand } from '../commands/commands.js'
import type { DecorationCluster, PointMm, Prop, SceneDocument, TerrainArea } from '../model/scene.js'
import { createBasePlacedProp } from '../commands/base.js'
import { propPaintPolygon, definitionPresentation, topDownPresentation } from '../appearance/presentation.js'
import { sampleConnectionRoute } from '../geometry/connection-route.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { signedVisualArea } from '../visual/geometry.js'
import { visualBase } from '../visual/base.js'
import { TERRAIN_VARIANT_SPECS } from '../visual/terrain-variant-specs.js'
import { decorationProtectedGeometry } from './generate.js'
import { decorationFootprint, decorationRecords } from './geometry.js'
import type { DecorationCommand } from './commands.js'

export const ISLAND_DRESSING_PRESET = 'island-dressing@1' as const
export const ISLAND_DRESSING_PRESET_V2 = 'island-dressing@2' as const
type CreateCluster = Extract<DecorationCommand, { type: 'createDecorationCluster' }>
interface IslandSupports { seed: string; crown: TerrainArea; lower: TerrainArea }
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Select real public outputs of one ordinary island5 recipe, never area names or unrelated terrain. */
function islandSupports(scene: SceneDocument): IslandSupports {
  if (scene.mapMode !== 'scene') throw new Error('请使用普通算法5生成的岩岛工程。')
  const generation = getLegacyGeneration(scene), visible = createPublicVisibility(scene)
  const rules = Object.values(generation?.rules ?? {}).filter(rule => {
    const recipe = generation!.recipes[rule.recipeRef.id]
    return rule.kind === 'terrain' && rule.state === 'active' && rule.visibility === 'public'
      && recipe?.algorithmId === 'terrain-scene' && recipe.algorithmVersion === 5 && recipe.recipeVersion === 5
      && rule.recipeRef.version === 5 && recipe.mapMode === 'scene' && !('domain' in recipe) && recipe.parameters.terrainKind === 'island'
  })
  if (rules.length !== 1) throw new Error('布景配方需要唯一、活动且公开的普通算法5岩岛来源。')
  const rule = rules[0], recipe = generation!.recipes[rule.recipeRef.id]
  const ids = new Set(rule.outputs.filter(ref => ref.kind === 'terrainArea' && ref.parentId === null).map(ref => ref.entityId))
  const areas = [...ids].flatMap(id => {
    const area = scene.terrainAreas[id]
    return area && area.floorId === rule.floorId && visible.terrainArea(id) && !area.blocksMovement && area.groundElevationMm > 0
      && scene.floors[area.floorId] && area.boundaryMm.length >= 3 && Math.abs(signedVisualArea(terrainPoints(area))) > 0 ? [area] : []
  }).sort((a, b) => b.groundElevationMm - a.groundElevationMm
    || Math.abs(signedVisualArea(terrainPoints(b))) - Math.abs(signedVisualArea(terrainPoints(a))) || compareText(a.id, b.id))
  const crown = areas[0], lower = crown && areas.find(area => area.groundElevationMm < crown.groundElevationMm)
  if (!crown || !lower || !polygonInside(terrainPoints(crown), terrainPoints(lower))) throw new Error('岩岛缺少公开、可支撑且完整嵌套的高台与下层主岩面。')
  return { seed: recipe.seed, crown, lower }
}

/** Eligibility for preparing independent complete3–8 copies; no scene mutation or resource proof. */
export function hasGeneratedIslandBase(scene: SceneDocument): boolean {
  try { islandSupports(scene); return true } catch { return false }
}
export const hasIslandDressingV2 = (scene: SceneDocument): boolean => Object.values(scene.terrainConnections).some(connection => connection.route?.segments.some(segment => segment.id.startsWith('island-dressing-v2-')))

const palette = (light: boolean): DecorationCluster['palette'] => TERRAIN_VARIANT_SPECS
  .filter(spec => !light || !spec.blocksMovement && !spec.blocksSight)
  .map(spec => ({ key: spec.key, definitionRef: { id: spec.definitionId, version: 1 },
    kind: spec.blocksMovement || spec.blocksSight ? 'prop' : 'decoration', weight: spec.blocksMovement || spec.blocksSight ? 1 : 3 }))
const paletteKey = (rows: DecorationCluster['palette']) => canonicalJson([...rows].sort((a, b) => compareText(a.key, b.key)))
const unit = (seed: string, channel: string) => Number.parseInt(sha256Text(JSON.stringify(['sceneweave-island-dressing-v2', seed, channel])).slice(0, 13), 16) / 0x10000000000000
const contains = (polygon: PointMm[], bounds: { x: number; y: number; width: number; height: number }) => polygon.every(p => p.x >= bounds.x && p.y >= bounds.y && p.x <= bounds.x + bounds.width && p.y <= bounds.y + bounds.height)
function distanceToSegment(p: PointMm, a: PointMm, b: PointMm): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}
function distanceToBoundary(point: PointMm, polygon: PointMm[]): number {
  return Math.min(...polygon.map((a, i) => distanceToSegment(point, a, polygon[(i + 1) % polygon.length])))
}

/** New visual recipe: fixed-presentation plants around the crown, legacy cluster below, and a natural-rock stair route. */
export function buildIslandDressingCommandsV2(scene: SceneDocument, options: { nextId: () => string; appearance: AppearanceGraph }): {
  version: typeof ISLAND_DRESSING_PRESET_V2; commands: SceneCommand[]; report: string
} {
  if (hasIslandDressingV2(scene)) throw new Error('此岩岛已应用成图细化配方；请继续编辑现有物件与楼梯，不能重复追加。')
  const supports = islandSupports(scene), crown = supports.crown, lower = supports.lower
  for (const support of [crown, lower]) {
    const layer = scene.userLayers[scene.entityLayers[support.id]]
    if (support.editLocked || layer?.editLocked) throw new Error('岩岛布景支撑或其图层已锁定，请先单独解锁。')
  }
  const floor = scene.floors[crown.floorId], layerId = scene.entityLayers[crown.id]
  if (!floor || !layerId || !scene.userLayers[layerId] || scene.userLayers[layerId].editLocked) throw new Error('高台布景需要同Floor的未锁定用户图层。')

  const stair = Object.values(scene.terrainConnections).find(connection => connection.kind === 'stairs'
    && connection.from.surfaceRef.id === lower.id && connection.to.surfaceRef.id === crown.id
    || connection.kind === 'stairs' && connection.to.surfaceRef.id === lower.id && connection.from.surfaceRef.id === crown.id)
  if (!stair) throw new Error('岩岛缺少连接高台与下层主岩面的真实楼梯。')
  const ids = geometryIdentityIds(scene), segmentId = `island-dressing-v2-${sha256Text(canonicalJson([supports.seed, crown.id, stair.id])).slice(0, 24)}`
  if (ids.has(segmentId) || scene.userLayers[segmentId]) throw new Error('岩岛自然岩阶需要未分配的独立路线ID。')
  if (stair.editLocked || scene.userLayers[scene.entityLayers[stair.id]]?.editLocked) throw new Error('岩岛楼梯或图层已锁定。')
  if (stair.route) throw new Error('现有楼梯已有人工路线，请保留并单独编辑，不能由自动布景覆盖。')
  const start = stair.from.positionMm, end = stair.to.positionMm, dx = end.x - start.x, dy = end.y - start.y
  const routeSeed = { version: 1 as const, kind: 'cubic' as const, segments: [{ id: segmentId, start: { ...start },
    control1: { x: Math.round(start.x + dx * .32 - dy * .11), y: Math.round(start.y + dy * .32 + dx * .11) },
    control2: { x: Math.round(start.x + dx * .68 + dy * .08), y: Math.round(start.y + dy * .68 - dx * .08) }, end: { ...end } }],
    sampleSpacingMm: 250, toleranceMm: 80, stairStyle: 'naturalRock' as const, treadDepthMm: 270 }
  const route = { ...routeSeed, centerlineMm: sampleConnectionRoute(routeSeed) }
  const routedScene = cloneJson(scene)
  routedScene.terrainConnections[stair.id].route = route
  if (!lower.surfaceStyle || !stair.surfaceStyle) throw new Error('岩岛楼梯或下层缺少固定表面材质，不能自动改写。')
  const stairSurfaceStyle = { base: cloneJson(lower.surfaceStyle.base), overlays: cloneJson(stair.surfaceStyle.overlays) }
  const stairCommand: SceneCommand = { type: 'updateTerrainConnection', id: stair.id, changes: { route, surfaceStyle: stairSurfaceStyle } }
  const stairFootprint = connectionFootprint(routedScene.terrainConnections[stair.id])
  // Existing legacy clusters, including manual/deleted slots, remain untouched.
  const existingLower = Object.values(scene.decorationClusters ?? {}).some(cluster => cluster.supportRef.kind === 'terrainArea' && cluster.supportRef.id === lower.id)
  const lowerCluster: CreateCluster | undefined = existingLower ? undefined : { type: 'createDecorationCluster', id: options.nextId(), floorId: lower.floorId, layerId: scene.entityLayers[lower.id],
    visibility: 'public', supportRef: { kind: 'terrainArea', id: lower.id }, boundsMm: (() => { const p = terrainPoints(lower), x = Math.min(...p.map(p => p.x)), y = Math.min(...p.map(p => p.y)); return { x, y, width: Math.max(...p.map(p => p.x)) - x, height: Math.max(...p.map(p => p.y)) - y } })(),
    seed: `${ISLAND_DRESSING_PRESET_V2}/lower/${sha256Text(canonicalJson([supports.seed, lower.id]))}`, palette: palette(true), maxInstances: 20, spacingMm: 350, clusterRadiusMm: 3600, clearanceMm: 400 }

  // Establish a broad crown and shrub belt before the smaller grass accents.
  // Existing fixed artwork and cluster-v1 keep their original identities.
  const plantKeys = ['tree-wind-oak', 'shrub-heath-mound', 'shrub-wind-spread', 'shrub-heath-mound', 'shrub-wind-spread', 'shrub-heath-mound',
    'grass-sedge-fan', 'grass-stone-fringe', 'grass-sedge-fan', 'grass-stone-fringe', 'grass-sedge-fan', 'grass-stone-fringe'] as const
  const specs = plantKeys.map(key => TERRAIN_VARIANT_SPECS.find(spec => spec.key === key)!)
  const supportPolygon = terrainPoints(crown), minX = Math.min(...supportPolygon.map(p => p.x)), maxX = Math.max(...supportPolygon.map(p => p.x)), minY = Math.min(...supportPolygon.map(p => p.y)), maxY = Math.max(...supportPolygon.map(p => p.y))
  const visible = createPublicVisibility(routedScene), publicScene = publicTerrainView(routedScene, visible)
  const protectedGeometry = decorationProtectedGeometry(publicScene, { floorId: crown.floorId, visibility: 'public', clearanceMm: 400 })
  const obstacles = Object.values(publicScene.props).filter(prop => prop.floorId === crown.floorId).map(propFootprint)
  for (const decoration of Object.values(decorationRecords(publicScene))) if (decoration.floorId === crown.floorId) obstacles.push(decorationFootprint(publicScene, decoration))
  const reservedIds = geometryIdentityIds(scene)
  if (lowerCluster) reservedIds.add(lowerCluster.id)
  const plantCommands: SceneCommand[] = [], plants: Prop[] = [], plantLimit = plantKeys.length
  for (let index = 0; index < plantLimit; index++) {
    const spec = specs[index]!
    const definition = scene.propDefinitions[spec.definitionId], ref = { id: spec.definitionId, version: 1 }
    if (!definition || canonicalJson(definitionPresentation(options.appearance, ref) ?? topDownPresentation()) !== canonicalJson(spec.presentation)) throw new Error(`高台固定表现来源不完整：${spec.definitionId}。`)
    const source = createBasePlacedProp(publicScene, spec.definitionId, { x: minX, y: minY }, { ids: { nextId: options.nextId }, clock: { now: () => scene.updatedAt } }, { id: options.nextId(), supportRef: { kind: 'terrainArea', id: crown.id } })
    let accepted: PointMm | null = null, bestScore = -Infinity
    for (let attempt = 0; attempt < 512; attempt++) {
      const candidate = { x: Math.round(minX + (maxX - minX) * (.06 + .88 * unit(supports.seed, `plant/${index}/${attempt}/x`))),
        y: Math.round(minY + (maxY - minY) * (.06 + .88 * unit(supports.seed, `plant/${index}/${attempt}/y`))) }
      const edge = distanceToBoundary(candidate, supportPolygon)
      if (edge < 280 || edge > 1850 || !pointOnSurface(publicScene, candidate, { kind: 'terrainArea', id: crown.id }, crown.floorId)) continue
      source.positionMm = candidate
      const footprint = propFootprint(source), paint = propPaintPolygon(source, spec.presentation)
      if (!supportedPolygon(publicScene, footprint, { kind: 'terrainArea', id: crown.id }, crown.floorId)
        || !contains(paint, floor.boundsMm)
        || polygonDistance(paint, stairFootprint) < 520
        || protectedGeometry.some(record => polygonDistance(paint, record.polygon) < record.marginMm)
        || obstacles.some(other => polygonDistance(footprint, other) < 180)) continue
      // The broad tree anchors the right edge; subsequent plants spread along
      // the remaining legal rim rather than occupying the first random gap.
      const score = index === 0 ? candidate.x : Math.min(...plants.map(plant => Math.hypot(candidate.x - plant.positionMm.x, candidate.y - plant.positionMm.y)))
      if (accepted === null || score > bestScore) { accepted = candidate; bestScore = score }
    }
    if (accepted) {
      const id = options.nextId()
      if (!id || reservedIds.has(id) || scene.userLayers[id]) throw new Error('高台植被需要未分配的独立实体ID。')
      reservedIds.add(id)
      plantCommands.push({ type: 'addProp', id, floorId: crown.floorId, layerId, definitionRef: ref, positionMm: accepted, supportRef: { kind: 'terrainArea', id: crown.id } })
      source.id = id; source.positionMm = accepted
      plants.push(cloneJson(source)); obstacles.push(propFootprint(source))
    }
  }
  if (!plantCommands.length) throw new Error('高台完整支撑及活动区/楼梯净空没有可放置植被的位置；请调整画面构图后再布景。')
  // Privacy never steers public sampling. After every position is fixed, the
  // complete scene may reject the entire proposal; it must not try new slots.
  const fullProtections = decorationProtectedGeometry(routedScene, { floorId: crown.floorId, visibility: 'gm', clearanceMm: 400 })
  const hiddenObstacles = Object.values(routedScene.props).filter(prop => prop.floorId === crown.floorId && !visible.prop(prop)).map(propFootprint)
  for (const decoration of Object.values(decorationRecords(routedScene))) if (decoration.floorId === crown.floorId && !visible.decoration(decoration)) hiddenObstacles.push(decorationFootprint(routedScene, decoration))
  for (const plant of plants) {
    const spec = TERRAIN_VARIANT_SPECS.find(spec => spec.definitionId === plant.definitionRef!.id)!, footprint = propFootprint(plant), paint = propPaintPolygon(plant, spec.presentation)
    if (!supportedPolygon(routedScene, footprint, plant.supportRef, plant.floorId)
      || fullProtections.some(record => polygonDistance(paint, record.polygon) < record.marginMm)
      || hiddenObstacles.some(other => polygonDistance(footprint, other) < 180)) throw new Error('公开布景候选与完整场景支撑或保留区域冲突；整笔未生成，请明确调整现有场景后重试。')
  }
  const visual = visualBase(scene), cliffCommands: SceneCommand[] = []
  for (const look of Object.values(visual?.edgeLooks ?? {})) {
    const boundary = visual!.boundaries[look.boundaryId]
    if (look.kind !== 'cliff' || boundary?.binding.kind !== 'terrain' || look.visibility !== 'public') continue
      const high = boundary.binding.sides.some(side => side.areaId === crown.id), main = boundary.binding.sides.some(side => side.areaId === lower.id)
    if (!high && !main) continue
    if (look.editLocked || boundary.editLocked || scene.userLayers[look.layerId]?.editLocked) throw new Error('岩岛连续崖面或其图层已锁定。')
      cliffCommands.push({ type: 'upsertVisualEdgeLook', edgeLook: { ...cloneJson(look), widthMm: high ? 720 : 650, color: '#737D76', accentColor: '#D9C8A0', repeatMm: 500, intensity: .78 } })
  }
  const commands: SceneCommand[] = [stairCommand, ...plantCommands, ...(lowerCluster ? [lowerCluster] : []), ...cliffCommands]
  return { version: ISLAND_DRESSING_PRESET_V2, commands,
    report: `高台增加${plantCommands.length}株固定表现植被（宽冠树${plants.filter(plant => plant.definitionRef!.id.includes('tree-')).length}、灌丛${plants.filter(plant => plant.definitionRef!.id.includes('shrub-')).length}、草缘${plants.filter(plant => plant.definitionRef!.id.includes('grass-')).length}），原活动区、楼梯净空和树岩占地均检查；下层复用簇状布景，上限20件。楼梯采用${route.centerlineMm.length}点自然岩阶路线，全部操作在同一候选中采用或撤销。` }
}

/** Post-generation commands only. The application owns real catalogue adoption, complete validation and one atomic preview. */
export function buildIslandDressingCommands(scene: SceneDocument, options: { nextId: () => string; layerId?: string }): {
  version: typeof ISLAND_DRESSING_PRESET; commands: CreateCluster[]; report: string
} {
  const supports = islandSupports(scene)
  const recipes = [
    { role: 'crown', support: supports.crown, palette: palette(false), maxInstances: 14 },
    { role: 'lower', support: supports.lower, palette: palette(true), maxInstances: 20 },
  ].map(row => ({ ...row, seed: `${ISLAND_DRESSING_PRESET}/${row.role}/${sha256Text(canonicalJson([supports.seed, row.support.id]))}` }))
  for (const recipe of recipes) {
    const area = recipe.support, supportLayer = scene.userLayers[scene.entityLayers[area.id]], layer = scene.userLayers[options.layerId ?? scene.entityLayers[area.id]]
    if (area.editLocked || supportLayer?.editLocked) throw new Error('岩岛布景支撑或其图层已锁定，请先单独解锁。')
    if (!supportLayer || supportLayer.floorId !== area.floorId || !layer || layer.floorId !== area.floorId || layer.editLocked) throw new Error('岩岛布景需要同Floor的未锁定图层。')
    if (Object.values(scene.decorationClusters ?? {}).some(cluster => cluster.algorithmVersion === 'cluster-v1'
      && cluster.seed === recipe.seed && cluster.supportRef.kind === 'terrainArea' && cluster.supportRef.id === area.id
      && paletteKey(cluster.palette) === paletteKey(recipe.palette))) throw new Error('此岩岛支撑已应用相同布景配方；请编辑或重新生成现有簇，不能重复追加。')
  }
  const reserved = geometryIdentityIds(scene)
  for (const id of Object.keys(scene.userLayers)) reserved.add(id)
  const commands: CreateCluster[] = recipes.map(recipe => {
    const id = options.nextId()
    if (!id || reserved.has(id)) throw new Error('岩岛布景簇需要未分配的独立ID。')
    reserved.add(id)
    const area = recipe.support, points = terrainPoints(area), x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
    return { type: 'createDecorationCluster', id, floorId: area.floorId, layerId: options.layerId ?? scene.entityLayers[area.id], visibility: 'public',
      supportRef: { kind: 'terrainArea', id: area.id }, boundsMm: { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y },
      seed: recipe.seed, palette: cloneJson(recipe.palette), maxInstances: recipe.maxInstances, spacingMm: 350, clusterRadiusMm: 3600, clearanceMm: 400 }
  })
  return { version: ISLAND_DRESSING_PRESET, commands,
    report: '保留原有树岩、地形和楼梯；高台从十二种固定素材中选取，追加上限14个；下层主岩面使用无阻挡小型素材，追加上限20个。实际数量以完整支撑、通路净空和预算预览为准；本配方不重复追加已有簇。' }
}
