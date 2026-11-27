import { cloneJson } from '../validation/json.js'
import { corridor, pathPolygon, pointInPolygon, polygonDistance, polygonInside, propFootprint, supportedPolygon, terrainPoints } from './geometry.js'
import { createPublicVisibility, publicTerrainView } from './visibility.js'
import type { GroundSurfaceRef, PointMm, Prop, ScatterGroup, SceneDocument, SurfaceRef } from '../model/scene.js'
import { isSupportedScatterAlgorithm, LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION, LANDSCAPE_GROUND_SCATTER_VERSION, LANDSCAPE_SCATTER_VERSION,
  LANDSCAPE_WOODLAND_SCATTER_VERSION } from './scatter-algorithm.js'
import { reliefBounds, sampleTerrainRelief } from './terrain-relief.js'
import { roadEffectsPolygon } from './road-domain.js'
import { observeGeometryPairs } from './edge-index.js'

import { sha256Text } from '../validation/hash.js'
export { sha256Text } from '../validation/hash.js'

export const roundScatterMm = (value: number): number => { const result = Math.sign(value) * Math.round(Math.abs(value)); return result === 0 ? 0 : result }
const sampleChannel = (seed: string, column: number, row: number, channel: 'density' | 'x' | 'y' | 'palette' | 'rotation' | 'size'): number => Number.parseInt(sha256Text(JSON.stringify([seed, column, row, channel])).slice(0, 13), 16) / 0x10000000000000

/** Exact scatter-cell-v1 streams. Published for fixed contract test vectors and diagnostics. */
export function sampleScatterCellV1(group: ScatterGroup, column: number, row: number) {
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) throw new Error('散布列号和行号必须为安全整数。')
  const palette = [...group.palette].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const sum = palette.reduce((total, item) => total + item.weight, 0)
  if (!palette.length || !Number.isSafeInteger(sum) || sum <= 0) throw new Error('散布 palette 权重总和必须为正安全整数。')
  const choice = sampleChannel(group.seed, column, row, 'palette') * sum
  let cumulative = 0
  const selected = palette.find(item => { cumulative += item.weight; return choice < cumulative }) ?? palette.at(-1)!
  const rotation = group.rotationRangeDeg.min + sampleChannel(group.seed, column, row, 'rotation') * (group.rotationRangeDeg.max - group.rotationRangeDeg.min)
  return {
    candidateKey: sha256Text(JSON.stringify([group.seed, column, row])),
    density: sampleChannel(group.seed, column, row, 'density'),
    positionMm: { x: roundScatterMm(group.gridOriginMm.x + (column + sampleChannel(group.seed, column, row, 'x')) * group.cellSizeMm), y: roundScatterMm(group.gridOriginMm.y + (row + sampleChannel(group.seed, column, row, 'y')) * group.cellSizeMm) },
    rotationDeg: (Math.round(rotation * 1000) / 1000) % 360,
    paletteKey: selected.key, definitionRef: cloneJson(selected.propDefinitionRef),
  }
}

/**
 * Recipe-independent scatter-cell-v2 density: a smooth value field on a fixed
 * four-cell lattice. Its namespaced stream never consumes/reorders v1 cell
 * streams. A 0.2–1 multiplier only thins the requested density, including at
 * negative grid coordinates; no cell becomes denser than the v1 threshold.
 */
export function sampleScatterCellV2(group: ScatterGroup, column: number, row: number) {
  const { noise: _noise, ...cell } = sampleClusteredScatterCell(group, column, row)
  return cell
}

function sampleClusteredScatterCell(group: ScatterGroup, column: number, row: number) {
  const cell = sampleScatterCellV1(group, column, row)
  if (!Number.isFinite(group.densityFactor) || group.densityFactor < 0 || group.densityFactor > 1) throw new Error('散布密度必须位于 [0,1]。')
  const x = (column + .5) / 4, y = (row + .5) / 4, left = Math.floor(x), top = Math.floor(y)
  const smooth = (value: number) => value * value * (3 - 2 * value)
  const u = smooth(x - left), v = smooth(y - top)
  const corner = (x: number, y: number) => Number.parseInt(sha256Text(JSON.stringify(['scatter-cell-v2-clusters', group.seed, x, y])).slice(0, 13), 16) / 0x10000000000000
  const a = corner(left, top), b = corner(left + 1, top), c = corner(left, top + 1), d = corner(left + 1, top + 1)
  const noise = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
  return { ...cell, noise, densityThreshold: group.densityFactor * (.2 + .8 * noise) }
}

function scatterDomain(scene: SceneDocument, group: ScatterGroup): { polygon: PointMm[]; refs: SurfaceRef[] } {
  const domain = group.domain
  if (domain.kind === 'area') {
    const area = scene.terrainAreas[domain.areaId]
    if (!area) throw new Error(`散布地形不存在：${domain.areaId}。`)
    return { polygon: domain.boundaryMm ?? terrainPoints(area), refs: [{ kind: 'terrainArea', id: area.id }] }
  }
  if (domain.kind === 'path') {
    const path = scene.paths[domain.pathId]
    if (!path) throw new Error(`散布路径不存在：${domain.pathId}。`)
    return { polygon: pathPolygon(path), refs: path.supportRefs }
  }
  const edge = scene.terrainEdges[domain.edgeId], area = edge && scene.terrainAreas[edge.source.areaId]
  const index = area?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
  if (!edge || !area || index < 0) throw new Error(`散布边缘来源不存在：${domain.edgeId}。`)
  const refs: GroundSurfaceRef[] = [{ kind: 'terrainArea', id: area.id }]
  if (edge.neighborAreaId !== null) refs.push({ kind: 'terrainArea', id: edge.neighborAreaId })
  else refs.push({ kind: 'floor', id: group.floorId })
  return { polygon: corridor(area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, domain.widthMm), refs }
}
function allIds(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return result
  if ('id' in value && typeof value.id === 'string') result.add(value.id)
  for (const item of Object.values(value)) allIds(item, result)
  return result
}
function visualFootprint(prop: Prop) {
  const { x, y, width, height } = prop.visualBoundsMm
  return propFootprint({ positionMm: prop.positionMm, rotationDeg: prop.rotationDeg, footprintMm: { width, height },
    footprintOffsetMm: { x: x + width / 2, y: y + height / 2 } })
}

function visualInsideFloor(scene: SceneDocument, floorId: string, visual: PointMm[]): boolean {
  const bounds = scene.floors[floorId]?.boundsMm
  return !!bounds && visual.every(p => p.x >= bounds.x && p.y >= bounds.y && p.x <= bounds.x + bounds.width && p.y <= bounds.y + bounds.height)
}

export const WOODLAND_SITE_ATTEMPTS = 5
function woodlandSites(group: ScatterGroup, positionMm: PointMm, column: number, row: number, canopy: boolean) {
  const { cellSizeMm: cell, gridOriginMm: origin } = group
  const x = origin.x + column * cell, y = origin.y + row * cell
  const u = (positionMm.x - x) / cell, v = (positionMm.y - y) / cell
  const scale = .76 + sampleChannel(group.seed, column, row, 'size') * .29
  const smaller = scale * (canopy ? .70 : .79)
  const at = (dx: number, dy: number) => ({ x: roundScatterMm(x + cell * dx), y: roundScatterMm(y + cell * dy) })
  return [{ positionMm, scale }, { positionMm: at(.5, .5), scale },
    { positionMm, scale: smaller }, { positionMm: at(1 - u, v), scale: smaller },
    { positionMm: at(u, 1 - v), scale: smaller }]
}

function resizePlant(prop: Prop, scale: number): Prop {
  const { x, y, width, height } = prop.visualBoundsMm
  const size = (value: number) => Math.max(1, Math.round(value * scale))
  return { ...prop, visualBoundsMm: { x: Math.round(x * scale), y: Math.round(y * scale), width: size(width), height: size(height) },
    footprintMm: { width: size(prop.footprintMm.width), height: size(prop.footprintMm.height) },
    footprintOffsetMm: { x: Math.round(prop.footprintOffsetMm.x * scale), y: Math.round(prop.footprintOffsetMm.y * scale) } }
}
const boundedFootprint = (points: PointMm[]) => ({ points, bounds: reliefBounds(points) })
type BoundedFootprint = ReturnType<typeof boundedFootprint>

function scatterDistance(a: BoundedFootprint, b: BoundedFootprint, reach: number, meter: boolean) {
  const x = Math.max(0, a.bounds.x - b.bounds.x - b.bounds.width, b.bounds.x - a.bounds.x - a.bounds.width)
  const y = Math.max(0, a.bounds.y - b.bounds.y - b.bounds.height, b.bounds.y - a.bounds.y - a.bounds.height)
  if (Math.hypot(x, y) > reach + 1e-7) return Infinity
  if (meter) observeGeometryPairs(a.points.length * b.points.length)
  return polygonDistance(a.points, b.points)
}

export interface ScatterRegeneration { group: ScatterGroup; props: Prop[]; removePropIds: string[] }
export interface ScatterRegenerationOptions {
  /** Native history-aware callers allocate a new birth ID for a vacant slot. */
  allocatePropId?: (candidateKey: string) => string
  /** Keep the adopted source/physical/appearance fields of surviving managed members. */
  preserveManagedAppearance?: boolean
}
/** Pure proposal preparation: persisted manual/deleted/detached/locked results are never overwritten. */
export function buildScatterRegeneration(scene: SceneDocument, groupId: string, densityFactor?: number, options: ScatterRegenerationOptions = {}): ScatterRegeneration {
  const source = scene.scatterGroups[groupId]
  if (!source) throw new Error(`散布组不存在：${groupId}。`)
  if (!isSupportedScatterAlgorithm(source.algorithmVersion)) throw new Error(`散布算法 ${source.algorithmVersion} 不可重新生成；仍可手工编辑已保存实例。`)
  if (densityFactor !== undefined && (!Number.isFinite(densityFactor) || densityFactor < 0 || densityFactor > 1)) throw new Error('散布密度必须位于 [0,1]。')
  const visibility = createPublicVisibility(scene), publicGroup = visibility.scatterGroup(source.id)
  const supportScene = publicGroup ? publicTerrainView(scene, visibility) : scene
  const group = cloneJson(source)
  if (densityFactor !== undefined) group.densityFactor = densityFactor
  const { polygon, refs } = scatterDomain(supportScene, group)
  if (polygon.length < 3) throw new Error('散布域缺少合法带区。')
  const minimumColumn = Math.floor((Math.min(...polygon.map(p => p.x)) - group.gridOriginMm.x) / group.cellSizeMm), maximumColumn = Math.floor((Math.max(...polygon.map(p => p.x)) - group.gridOriginMm.x) / group.cellSizeMm)
  const minimumRow = Math.floor((Math.min(...polygon.map(p => p.y)) - group.gridOriginMm.y) / group.cellSizeMm), maximumRow = Math.floor((Math.max(...polygon.map(p => p.y)) - group.gridOriginMm.y) / group.cellSizeMm)
  const columns = maximumColumn - minimumColumn + 1, rows = maximumRow - minimumRow + 1
  const fittedWoodland = group.algorithmVersion === LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION
  const woodland = fittedWoodland || group.algorithmVersion === LANDSCAPE_WOODLAND_SCATTER_VERSION
  const canopy = woodland ? group.palette.filter(entry => entry.key === 'pine' || entry.key === 'tree') : []
  const understory = woodland ? group.palette.filter(entry => !canopy.includes(entry)) : []
  const passes = woodland ? [{ palette: canopy, role: 'canopy' }, { palette: understory, role: 'understory' }]
    .filter(pass => pass.palette.length > 0).map(pass => ({ ...pass, stream: { ...group, palette: pass.palette, seed: `${group.seed}/${pass.role}` } }))
    : [{ role: 'default', stream: group }]
  const cells = columns * rows * (fittedWoodland ? passes.length * WOODLAND_SITE_ATTEMPTS : 1)
  if (![minimumColumn, maximumColumn, minimumRow, maximumRow, cells].every(Number.isSafeInteger)
    || cells > 250000) throw new Error('单次散布候选检查不得超过 250000 个位置；请缩小范围或增大格距。')
  const removed = new Set<string>(), previous = source.members
  for (const [key, member] of Object.entries(group.members)) if (member.state === 'managed' && member.propId !== null && !scene.props[member.propId]?.editLocked && !scene.userLayers[scene.entityLayers[member.propId]]?.editLocked && (!publicGroup || visibility.prop(scene.props[member.propId]))) {
    removed.add(member.propId); delete group.members[key]
  }
  const existing = Object.values(scene.props).filter(prop => prop.floorId === group.floorId && !removed.has(prop.id) && (!publicGroup || visibility.prop(prop)))
  const obstacles = existing.map(prop => boundedFootprint(propFootprint(prop)))
  const treeIds = new Set(canopy.map(entry => entry.propDefinitionRef.id))
  const trees = woodland ? existing.filter(prop => treeIds.has(prop.definitionRef?.id ?? '')).map(prop => prop.positionMm) : []
  const treeSpacing = fittedWoodland ? Math.max(1220, group.cellSizeMm * 1.28) : Math.max(1450, group.cellSizeMm * 1.45)
  const ids = allIds(scene), props: Prop[] = []
  const groupedGround = group.algorithmVersion === LANDSCAPE_GROUND_SCATTER_VERSION
  const natural = woodland || groupedGround || group.algorithmVersion === LANDSCAPE_SCATTER_VERSION
  const carrier = natural && group.domain.kind === 'area' ? supportScene.terrainAreas[group.domain.areaId] : undefined
  const terrainBounds = carrier?.relief && reliefBounds(terrainPoints(carrier))
  const water = fittedWoodland && carrier ? Object.values(supportScene.terrainAreas).filter(row => row.floorId === group.floorId
    && row.waterSurface && row.coveragePriority < carrier.coveragePriority)
    .map(row => ({ elevation: row.groundElevationMm, points: terrainPoints(row) })) : []
  const roads = natural ? Object.values(supportScene.paths).filter(path => path.floorId === group.floorId
    && path.supportRefs.some(ref => ref.kind === 'terrainArea' && ref.id === carrier?.id)).map(path => boundedFootprint(roadEffectsPolygon(path))) : []
  const exclusions = group.exclusions.map(exclusion => boundedFootprint(exclusion.boundaryMm))
  let liveCount = Object.values(group.members).filter(member => member.propId !== null).length
  for (const { stream, role } of passes) for (let row = minimumRow; row <= maximumRow; row++) for (let column = minimumColumn; column <= maximumColumn; column++) {
    const cell = group.algorithmVersion === 'scatter-cell-v1' ? { ...sampleScatterCellV1(stream, column, row), noise: 0, densityThreshold: group.densityFactor }
      : sampleClusteredScatterCell(stream, column, row)
    const growsCanopy = role === 'canopy'
    const threshold = woodland ? group.densityFactor * (growsCanopy ? .78 + .22 * cell.noise : .36 + .44 * cell.noise)
      : groupedGround ? group.densityFactor : cell.densityThreshold
    if (group.members[cell.candidateKey] || cell.density >= threshold) continue
    const separated = (at: PointMm) => !growsCanopy || trees.every(p => Math.hypot(p.x - at.x, p.y - at.y) >= treeSpacing)
    if (!fittedWoodland && !separated(cell.positionMm)) continue
    const definition = scene.propDefinitions[cell.definitionRef.id]
    if (!definition || definition.version !== cell.definitionRef.version) throw new Error('散布需要已采用的固定版本物件定义。')
    const previousId = previous[cell.candidateKey]?.propId
    const propId = previousId && removed.has(previousId) ? previousId : options.allocatePropId?.(cell.candidateKey) ?? `scatter-${sha256Text(JSON.stringify([group.id, cell.candidateKey]))}`
    if (ids.has(propId) && !removed.has(propId)) throw new Error(`散布生成 ID 已被其他实体占用：${propId}。`)
    const fresh: Prop = { id: propId, floorId: group.floorId, editLocked: false, visibility: group.visibility,
      definitionRef: cell.definitionRef, appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      positionMm: cell.positionMm, rotationDeg: cell.rotationDeg, footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm),
      blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: refs[0], renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
    const prior = options.preserveManagedAppearance && previousId && removed.has(previousId) ? scene.props[previousId] : undefined
    const sites = fittedWoodland ? woodlandSites(stream, cell.positionMm, column, row, growsCanopy) : [{ positionMm: cell.positionMm, scale: 1 }]
    if (fittedWoodland && prior) {
      const saved = sites.findIndex(site => site.positionMm.x === prior.positionMm.x && site.positionMm.y === prior.positionMm.y)
      if (saved > 0) sites.unshift(sites.splice(saved, 1)[0])
    }
    for (const { positionMm, scale } of sites) {
      if (fittedWoodland && (!pointInPolygon(positionMm, polygon, false) || !separated(positionMm))) continue
      const prop = prior ? { ...cloneJson(prior), positionMm, rotationDeg: cell.rotationDeg }
        : fittedWoodland ? resizePlant({ ...fresh, positionMm }, scale) : fresh
      const footprint = propFootprint(prop), checked = boundedFootprint(footprint), visual = visualFootprint(prop)
      if (natural) {
        const rocky = definition.tags.includes('rock') || definition.id.startsWith('natural-stone-')
        const sample = carrier?.relief && sampleTerrainRelief(carrier.relief, terrainBounds!, prop.positionMm)
        const tree = cell.paletteKey === 'pine' || cell.paletteKey === 'tree'
        const smallRoots = fittedWoodland && prop.footprintMm.width < definition.defaultFootprintMm.width * .74
          && prop.footprintMm.height < definition.defaultFootprintMm.height * .74
        const footing = fittedWoodland ? (tree ? (smallRoots ? .77 : .81) : .72)
          : woodland ? (tree ? .81 : .73) : rocky ? .78 : .91
        const elevation = (carrier?.groundElevationMm ?? 0) + (sample?.offsetMm ?? 0)
        const wet = fittedWoodland ? water.some(body => elevation < body.elevation + (tree ? 180 : 120) && pointInPolygon(positionMm, body.points))
          : !!sample && !rocky && carrier!.groundElevationMm >= 0 && elevation < 430
        if (wet || sample && sample.normal.z < footing) continue
        if (groupedGround) {
          const slope = sample ? 1 - sample.normal.z : 0
          const nearBank = Math.min(1, slope * 7 + (sample && sample.offsetMm < 2100 ? .24 : 0))
          const amount = rocky ? .16 + .64 * nearBank * (1 - cell.noise * .56)
            : tree ? .13 + .83 * cell.noise ** 2 : .35 + .62 * cell.noise
          if (cell.density >= group.densityFactor * amount) continue
        }
        const view = boundedFootprint(visual)
        if (roads.some(road => scatterDistance(view, road, 230, true) < 230)) continue
      }
      if (!polygonInside(footprint, polygon) || !visualInsideFloor(scene, prop.floorId, visual) || exclusions.some(exclusion => scatterDistance(checked, exclusion, 1e-7, natural) <= 1e-7)) continue
      const support = refs.find(ref => supportedPolygon(supportScene, footprint, ref, group.floorId))
      if (!support || group.minDistanceMm > 0 && obstacles.some(other => scatterDistance(checked, other, group.minDistanceMm, natural) + 1e-7 < group.minDistanceMm)) continue
      prop.supportRef = cloneJson(support)
      group.members[cell.candidateKey] = { propId, state: 'managed', overrideFields: [] }
      props.push(prop); obstacles.push(checked); ids.add(propId)
      if (growsCanopy) trees.push(prop.positionMm)
      if (++liveCount > 5000) throw new Error('散布组不得超过 5000 个活成员。')
      break
    }
  }
  // Preserve existing record order for no-op regeneration, including manual records.
  // JSON object order is not the algorithm's candidate order, which stays row/column.
  const ordered = Object.keys(source.members).filter(key => Object.hasOwn(group.members, key))
  group.members = Object.fromEntries([...ordered, ...Object.keys(group.members).filter(key => !Object.hasOwn(source.members, key))].map(key => [key, group.members[key]]))
  return { group, props, removePropIds: [...removed] }
}
