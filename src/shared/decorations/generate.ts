import type { Decoration, DecorationCluster, PointMm, Prop, SceneDocument, SurfaceRef } from '../model/scene.js'
import type { ExecutionBudget } from '../budget/task-budget.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { AppearanceGraph } from '../model/appearance.js'
import { definitionPresentation, propPaintPolygon, propPresentation } from '../appearance/presentation.js'
import { connectionFootprint, corridor, openingEndpoints, pathPolygon, pointInPolygon, pointOnSurface, polygonDistance, polygonInside, polygonsOverlap, propFootprint, roomPoints, supportedPolygon, terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility, publicTerrainView } from '../geometry/visibility.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { sha256Text } from '../validation/hash.js'
import { cloneJson } from '../validation/json.js'
import { conservativePropPaintEnvelope, decorationAsProp, decorationClusterRecords, decorationFootprint, decorationRecords } from './geometry.js'
import { polygonBoolean, type PolygonWithHoles } from '../geometry/polygon-boolean.js'

const unit = (seed: string, channel: string) => Number.parseInt(sha256Text(JSON.stringify(['sceneweave-cluster-v1', seed, channel])).slice(0, 13), 16) / 0x10000000000000
const contains = (points: PointMm[], b: { x: number; y: number; width: number; height: number }) => points.every(p => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height)
export interface DecorationProtection { id: string; polygon: PointMm[]; marginMm: number }
const ringArea2 = (ring: PointMm[]): bigint => ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length]
  return sum + BigInt(point.x) * BigInt(next.y) - BigInt(next.x) * BigInt(point.y)
}, 0n)
const absoluteArea2 = (ring: PointMm[]): bigint => { const area = ringArea2(ring); return area < 0n ? -area : area }
function canopyAreaMm2(polygons: PolygonWithHoles[]): bigint {
  return polygons.reduce((sum, polygon) => sum + absoluteArea2(polygon.outer)
    - polygon.holes.reduce((holes, ring) => holes + absoluteArea2(ring), 0n), 0n) / 2n
}
function canopyEffectiveRegion(scene: SceneDocument, source: DecorationCluster, executionMeter?: ExecutionBudget): PolygonWithHoles[] {
  const rule = source.canopyRule
  if (!rule) return []
  const later = Object.values(decorationClusterRecords(scene)).filter(cluster => cluster.id !== source.id && cluster.canopyRule?.channel === rule.channel
    && cluster.visibility === source.visibility && cluster.supportRef.kind === source.supportRef.kind && cluster.supportRef.id === source.supportRef.id
    && cluster.canopyRule.paintOrder > rule.paintOrder)
    .flatMap(cluster => cluster.canopyRule!.regionsMm)
  executionMeter?.charge({ dependencyRefs: later.length })
  return polygonBoolean({ operation: 'difference', subject: rule.regionsMm, clip: later }, executionMeter).polygons
}
function meteredPointInPolygon(point: PointMm, polygon: PointMm[], includeBoundary: boolean, executionMeter?: ExecutionBudget): boolean {
  executionMeter?.charge({ intersectionPairs: polygon.length })
  return pointInPolygon(point, polygon, includeBoundary)
}
function meteredPolygonInside(subject: PointMm[], container: PointMm[], executionMeter?: ExecutionBudget): boolean {
  executionMeter?.charge({ intersectionPairs: subject.length * container.length })
  return polygonInside(subject, container)
}
function meteredPolygonDistance(subject: PointMm[], other: PointMm[], executionMeter?: ExecutionBudget): number {
  // Distance first checks overlap, then compares edge pairs for separation.
  executionMeter?.charge({ intersectionPairs: 2 * subject.length * other.length })
  return polygonDistance(subject, other)
}
function pointInCanopyRegion(point: PointMm, polygons: PolygonWithHoles[], executionMeter?: ExecutionBudget): boolean {
  return polygons.some(polygon => meteredPointInPolygon(point, polygon.outer, true, executionMeter)
    && !polygon.holes.some(hole => meteredPointInPolygon(point, hole, false, executionMeter)))
}
function footprintInCanopyRegion(footprint: PointMm[], polygons: PolygonWithHoles[], executionMeter?: ExecutionBudget): boolean {
  return polygons.some(polygon => meteredPolygonInside(footprint, polygon.outer, executionMeter) && polygon.holes.every(hole => {
    executionMeter?.charge({ intersectionPairs: footprint.length * hole.length })
    return !polygonsOverlap(footprint, hole)
  }))
}
/** Upper edge count of the explicit support and its possible occluders. The
 * predicates below keep their existing short circuits and geometry semantics. */
function supportGeometryEdges(scene: SceneDocument, ref: SurfaceRef, floorId: string, executionMeter: ExecutionBudget): number {
  executionMeter.charge({ dependencyRefs: 1 })
  if (ref.kind === 'room') {
    const room = scene.rooms[ref.id]
    if (!room) return 0
    executionMeter.charge({ dependencyRefs: room.boundaryVertexIds.length })
    return room.boundaryVertexIds.length + supportGeometryEdges(scene, room.supportRef, floorId, executionMeter)
  }
  const candidate = ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id] : undefined
  let edges = 4 + (candidate?.boundaryMm.length ?? 0)
  executionMeter.charge({ dependencyRefs: 1 })
  for (const area of Object.values(scene.terrainAreas)) {
    executionMeter.charge({ dependencyRefs: 1 })
    if (area.floorId === floorId && (!candidate || area.coveragePriority > candidate.coveragePriority)) edges += area.boundaryMm.length
  }
  return edges
}
function boundsOfRegion(polygons: PolygonWithHoles[]): { x: number; y: number; width: number; height: number } | null {
  const points = polygons.flatMap(polygon => polygon.outer)
  if (!points.length) return null
  const xs = points.map(point => point.x), ys = points.map(point => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
export function estimateCanopyRegionInstances(scene: SceneDocument, definitionRef: { id: string; version: number }, regionsMm: PointMm[][], canopyCoveragePpm: number): number {
  if (!Number.isSafeInteger(canopyCoveragePpm) || canopyCoveragePpm < 0 || canopyCoveragePpm > 1_000_000) throw new Error('树冠覆盖目标必须是0–100%的整数比例。')
  const definition = scene.propDefinitions[definitionRef.id]
  if (!definition || definition.version !== definitionRef.version) throw new Error('树木区域规则须引用工程内确切素材版本。')
  const area = canopyAreaMm2(polygonBoolean({ operation: 'union', subject: regionsMm, clip: [] }).polygons)
  const canopy = BigInt(Math.max(1, Math.round(definition.defaultVisualBoundsMm.width * definition.defaultVisualBoundsMm.height)))
  const count = Number(area * BigInt(canopyCoveragePpm) / (canopy * 1_000_000n))
  if (!Number.isSafeInteger(count) || count > 64) throw new Error('树冠目标预计超过单区64棵保护上限；请缩小区域或降低覆盖率。')
  return count
}
/** Public recipes read only the public physical/constraint subset. */
export function decorationProtectedGeometry(scene: SceneDocument, cluster: Pick<DecorationCluster, 'floorId' | 'visibility' | 'clearanceMm'>): DecorationProtection[] {
  const result: DecorationProtection[] = [], visible = createPublicVisibility(scene), floorId = cluster.floorId, publicOnly = cluster.visibility === 'public'
  const add = (id: string, polygon: PointMm[], marginMm = cluster.clearanceMm) => { if (polygon.length >= 3) result.push({ id, polygon, marginMm }) }
  for (const room of Object.values(scene.rooms)) if (room.floorId === floorId && (!publicOnly || visible.room(room.id))) add(room.id, roomPoints(scene, room))
  for (const wall of Object.values(scene.walls)) if (wall.floorId === floorId) {
    if (publicOnly && !visible.wall(wall.id)) continue
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    add(wall.id, corridor({ x: a.xMm, y: a.yMm }, { x: b.xMm, y: b.yMm }, wall.thicknessMm, true))
  }
  for (const path of Object.values(scene.paths)) if (path.floorId === floorId && (!publicOnly || visible.path(path.id))) add(path.id, pathPolygon(path))
  for (const connection of Object.values(scene.terrainConnections)) if (connection.floorId === floorId && (!publicOnly || visible.terrainConnection(connection.id))) add(connection.id, connectionFootprint(connection))
  for (const opening of Object.values(scene.openings)) if (opening.floorId === floorId && opening.kind === 'door' && (!publicOnly || visible.opening(opening.id))) {
    const [a, b] = openingEndpoints(scene, opening); add(opening.id, corridor(a, b, 1800, true))
  }
  for (const region of Object.values(scene.regions)) if (region.floorId === floorId && region.blocksMovement && (!publicOnly || region.visibility === 'public')) add(region.id, region.boundaryMm)
  for (const constraint of Object.values(getLegacyGeneration(scene)?.constraints ?? {})) if (constraint.floorId === floorId && (!publicOnly || constraint.visibility === 'public')) {
    if (constraint.kind === 'activityArea') add(constraint.id, constraint.boundaryMm, cluster.clearanceMm + constraint.clearanceMm)
    if (constraint.kind === 'route') for (let i = 1; i < constraint.pointsMm.length; i++) add(constraint.id, corridor(constraint.pointsMm[i - 1], constraint.pointsMm[i], constraint.minWidthMm, true))
    if (constraint.kind === 'port') {
      const r = constraint.widthMm / 2, p = constraint.positionMm
      add(constraint.id, [{ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y - r }, { x: p.x + r, y: p.y + r }, { x: p.x - r, y: p.y + r }])
    }
  }
  return result
}

export interface DecorationGeneration { cluster: DecorationCluster; props: Prop[]; decorations: Decoration[]; removePropIds: string[]; removeDecorationIds: string[] }
/** current resolved rule geometry is disposable; only its rule owns painted regions. */
export interface SurfaceGenerationRegion { polygons: PolygonWithHoles[]; coveragePpm: number }
export function estimateSurfaceRegionInstances(scene: SceneDocument, palette: DecorationCluster['palette'], region: SurfaceGenerationRegion): number {
  let weightedArea = 0n, weight = 0n
  for (const item of palette) {
    const definition = scene.propDefinitions[item.definitionRef.id]
    if (!definition || definition.version !== item.definitionRef.version) throw new Error('植被区域须引用工程内确切固定素材版本。')
    weightedArea += BigInt(definition.defaultVisualBoundsMm.width) * BigInt(definition.defaultVisualBoundsMm.height) * BigInt(item.weight)
    weight += BigInt(item.weight)
  }
  if (!weight || !Number.isSafeInteger(region.coveragePpm) || region.coveragePpm < 0 || region.coveragePpm > 1_000_000) throw new Error('植被区域素材及覆盖目标无效。')
  const count = Number(canopyAreaMm2(region.polygons) * BigInt(region.coveragePpm) * weight / (weightedArea * 1_000_000n))
  if (!Number.isSafeInteger(count) || count > 64) throw new Error('植被目标预计超过单区64件保护上限；请缩小区域或降低覆盖率。')
  return count
}
/** Deterministic bounded proposal; all output coordinates and manual slots persist. */
export function buildDecorationRegeneration(scene: SceneDocument, source: DecorationCluster, context: PreparationContext, appearance?: AppearanceGraph, surfaceRegion?: SurfaceGenerationRegion, executionMeter?: ExecutionBudget): DecorationGeneration {
  const group = cloneJson(source), visibility = createPublicVisibility(scene), publicOnly = group.visibility === 'public'
  if (publicOnly && !visibility.surface(group.supportRef)) throw new Error('公共簇状布景不能使用私密支撑。')
  const supportScene = publicOnly ? publicTerrainView(scene, visibility) : scene
  const supportArea = group.supportRef.kind === 'terrainArea' ? scene.terrainAreas[group.supportRef.id] : undefined
  if (supportArea?.blocksMovement) throw new Error('不能在水面或阻挡地形上生成陆上簇状布景。')
  const canopyRule = group.canopyRule, regional = !!canopyRule || !!surfaceRegion
  const canopyRegion = surfaceRegion?.polygons ?? (canopyRule ? canopyEffectiveRegion(scene, group, executionMeter) : [])
  const selectedBounds = surfaceRegion ? boundsOfRegion(canopyRegion) : null
  if (canopyRule && (!supportArea || canopyRule.regionsMm.some(region => !meteredPolygonInside(region, terrainPoints(supportArea), executionMeter)))) throw new Error('树木区域必须在当前完整工程中完整位于明确地形面内。')
  const definitionForRule = canopyRule ? group.palette[0] && scene.propDefinitions[group.palette[0].definitionRef.id] : undefined
  const targetCount = surfaceRegion ? estimateSurfaceRegionInstances(scene, group.palette, surfaceRegion) : canopyRule?.mode === 'erase' ? 0 : canopyRule && definitionForRule
    ? Number(canopyAreaMm2(canopyRegion) * BigInt(canopyRule.canopyCoveragePpm)
      / (BigInt(Math.max(1, Math.round(definitionForRule.defaultVisualBoundsMm.width * definitionForRule.defaultVisualBoundsMm.height))) * 1_000_000n))
    : group.maxInstances
  if (targetCount > 64) throw new Error('树冠目标预计超过单区64棵保护上限；请缩小区域或降低覆盖率。')
  const protectedGeometry = decorationProtectedGeometry(scene, group)
  executionMeter?.charge({ dependencyRefs: protectedGeometry.length + (surfaceRegion ? group.palette.length : definitionForRule ? 1 : 0) })
  const supportEdges = executionMeter ? supportGeometryEdges(supportScene, group.supportRef, group.floorId, executionMeter) : 0
  const onSupport = (point: PointMm) => {
    executionMeter?.charge({ intersectionPairs: supportEdges })
    return pointOnSurface(supportScene, point, group.supportRef, group.floorId)
  }
  const supported = (polygon: PointMm[]) => {
    executionMeter?.charge({ intersectionPairs: polygon.length * supportEdges })
    return supportedPolygon(supportScene, polygon, group.supportRef, group.floorId)
  }
  const removedProps = new Set<string>(), removedDecorations = new Set<string>()
  for (const member of Object.values(group.members)) if (member.state === 'managed' && member.entityId) {
    executionMeter?.charge({ dependencyRefs: 1 })
    const row = member.kind === 'prop' ? scene.props[member.entityId] : decorationRecords(scene)[member.entityId]
    if (!row) throw new Error('簇状布景存活成员缺失。')
    if (row.editLocked || (executionMeter?.charge({ dependencyRefs: 1 }), scene.userLayers[scene.entityLayers[row.id]]?.editLocked)) continue
    if (Object.values(scene.notes).some(note => {
      executionMeter?.charge({ dependencyRefs: 1 })
      return note.anchor.type === 'entity' && note.anchor.entityId === row.id
    })) continue
    ;(member.kind === 'prop' ? removedProps : removedDecorations).add(row.id)
  }
  const obstacles: PointMm[][] = []
  for (const prop of Object.values(scene.props)) {
    executionMeter?.charge({ dependencyRefs: 1 })
    if (prop.floorId === group.floorId && !removedProps.has(prop.id) && (!publicOnly || visibility.prop(prop))) obstacles.push(propFootprint(prop))
  }
  for (const row of Object.values(decorationRecords(scene))) {
    executionMeter?.charge({ dependencyRefs: 2 })
    if (row.floorId === group.floorId && !removedDecorations.has(row.id) && (!publicOnly || visibility.decoration(row))) obstacles.push(decorationFootprint(scene, row))
  }
  const centers: PointMm[] = [], centerCount = regional ? 6 : Math.max(1, Math.min(6, Math.ceil(targetCount / 8)))
  for (let center = 0; center < centerCount; center++) {
    for (let attempt = 0; attempt < 128; attempt++) {
      const p = { x: Math.round(group.boundsMm.x + group.boundsMm.width * (.08 + .84 * unit(group.seed, `center/${center}/${attempt}/x`))), y: Math.round(group.boundsMm.y + group.boundsMm.height * (.08 + .84 * unit(group.seed, `center/${center}/${attempt}/y`))) }
      if (onSupport(p) && (!regional || pointInCanopyRegion(p, canopyRegion, executionMeter))) { centers.push(p); break }
    }
  }
  if (!centers.length && targetCount > 0) throw new Error('选定范围没有该显式支撑上的可用簇中心。')
  const props: Prop[] = [], decorations: Decoration[] = [], palette = [...group.palette].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0), totalWeight = palette.reduce((sum, row) => sum + row.weight, 0)
  const pruneRemovedCanopyMembers = () => {
    if (!regional) return
    const producedProps = new Set(props.map(row => row.id)), producedDecorations = new Set(decorations.map(row => row.id))
    for (const [key, member] of Object.entries(group.members)) if (member.state === 'managed' && member.entityId
      && (removedProps.has(member.entityId) || removedDecorations.has(member.entityId))
      && !producedProps.has(member.entityId) && !producedDecorations.has(member.entityId)) delete group.members[key]
  }
  if (canopyRule?.mode === 'erase' || regional && (!canopyRegion.length || targetCount === 0)) {
    pruneRemovedCanopyMembers()
    return { cluster: group, props, decorations, removePropIds: [...removedProps], removeDecorationIds: [...removedDecorations] }
  }
  if (!palette.length || !Number.isSafeInteger(totalWeight) || totalWeight <= 0) throw new Error('簇状布景固定palette权重无效。')
  for (let index = 0; index < targetCount; index++) {
    const candidateKey = sha256Text(JSON.stringify(['sceneweave-decoration-cluster', 1, group.seed, index])), previous = source.members[candidateKey]
    if (previous && (previous.state !== 'managed' || !previous.entityId || !(previous.kind === 'prop' ? removedProps : removedDecorations).has(previous.entityId))) continue
    const value = unit(group.seed, `slot/${index}/palette`) * totalWeight
    let accumulated = 0
    const item = palette.find(item => { accumulated += item.weight; return value < accumulated }) ?? palette.at(-1)!
    const definition = scene.propDefinitions[item.definitionRef.id]
    executionMeter?.charge({ dependencyRefs: 1 })
    if (!definition || definition.version !== item.definitionRef.version || definition.defaultAppearance.kind !== 'image') throw new Error('簇状布景需要已采用的固定图片定义。')
    if (item.kind === 'decoration' && (definition.defaultBlocksMovement || definition.defaultBlocksSight || definition.defaultAppearance.tint !== null)) throw new Error('阻挡来源或运行时着色来源不能降级为轻量装饰。')
    const id = previous?.entityId ?? context.ids.nextId(), center = centers[index % centers.length]
    const existing = previous?.entityId ? (previous.kind === 'prop' ? scene.props[previous.entityId] : decorationRecords(scene)[previous.entityId]) : undefined
    const prior = surfaceRegion ? existing : undefined
    if (surfaceRegion && previous?.entityId) executionMeter?.charge({ dependencyRefs: 1 })
    let accepted: Prop | Decoration | null = null
    for (let attempt = 0; attempt < 96; attempt++) {
      const candidateAttempt = prior ? Math.max(0, attempt - 1) : attempt
      const theta = unit(group.seed, `slot/${index}/${candidateAttempt}/theta`) * Math.PI * 2, radius = Math.sqrt(unit(group.seed, `slot/${index}/${candidateAttempt}/radius`)) * group.clusterRadiusMm
      const clusteredPosition = { x: Math.round(center.x + Math.cos(theta) * radius), y: Math.round(center.y + Math.sin(theta) * radius) }
      const positionMm = prior && attempt === 0 ? cloneJson(prior.positionMm) : selectedBounds && attempt >= 32 ? {
        x: Math.round(selectedBounds.x + selectedBounds.width * unit(group.seed, `slot/${index}/${candidateAttempt}/region-x`)),
        y: Math.round(selectedBounds.y + selectedBounds.height * unit(group.seed, `slot/${index}/${candidateAttempt}/region-y`)),
      } : clusteredPosition
      const common = { id, floorId: group.floorId, editLocked: false, visibility: group.visibility, definitionRef: cloneJson(item.definitionRef), supportRef: cloneJson(group.supportRef), positionMm, rotationDeg: 0, renderOrder: index }
      const row: Prop | Decoration = existing ? { ...cloneJson(existing), positionMm } : item.kind === 'prop' ? {
        ...common, appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm), footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm),
        blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, renderLayer: definition.defaultRenderLayer, shadowClass: definition.defaultShadowClass, shadowOverride: null,
      } : { ...common, scalePpm: Math.round(650_000 + unit(group.seed, `slot/${index}/scale`) * 600_000) }
      const prop = item.kind === 'prop' ? row as Prop : decorationAsProp(scene, row as Decoration), footprint = propFootprint(prop)
      if (item.kind === 'decoration') executionMeter?.charge({ dependencyRefs: 1 })
      // Legacy cluster-v1 keeps its frozen conservative sampling. Canopy rules
      // use the exact fixed image/root supplied by the complete composition.
      // A bare scene cannot prove that root, so it keeps the safe fallback.
      const presentation = regional && appearance ? propPresentation(appearance, prop.id) ?? definitionPresentation(appearance, prop.definitionRef) : undefined
      const paint = regional && appearance ? propPaintPolygon(prop, presentation) : conservativePropPaintEnvelope(prop)
      const insideSelectedRegion = surfaceRegion
        ? pointInCanopyRegion(row.positionMm, canopyRegion, executionMeter)
        : canopyRule ? footprintInCanopyRegion(paint, canopyRegion, executionMeter) : contains(footprint, group.boundsMm)
      if (!insideSelectedRegion || !contains(paint, scene.floors[group.floorId].boundsMm) || !supported(footprint)) continue
      if (protectedGeometry.some(record => {
        return meteredPolygonDistance(paint, record.polygon, executionMeter) < record.marginMm
      })) continue
      if (obstacles.some(other => {
        return meteredPolygonDistance(footprint, other, executionMeter) < group.spacingMm
      })) continue
      accepted = row; obstacles.push(footprint); break
    }
    if (accepted) {
      if (item.kind === 'prop') props.push(accepted as Prop); else decorations.push(accepted as Decoration)
      group.members[candidateKey] = { kind: item.kind, entityId: id, state: 'managed' }
    } else if (previous && !surfaceRegion) {
      // An explicitly adopted regeneration may remove an unavailable slot.
      // Persist that suppression rather than reviving it on a later rerun.
      group.members[candidateKey] = { kind: previous.kind, entityId: null, state: 'deleted' }
    }
  }
  pruneRemovedCanopyMembers()
  return { cluster: group, props, decorations, removePropIds: [...removedProps].filter(id => !props.some(row => row.id === id)),
    removeDecorationIds: [...removedDecorations].filter(id => !decorations.some(row => row.id === id)) }
}
