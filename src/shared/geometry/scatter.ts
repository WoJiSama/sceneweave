import { cloneJson } from '../validation/json.js'
import { corridor, pathPolygon, polygonDistance, polygonInside, propFootprint, supportedPolygon, terrainPoints } from './geometry.js'
import { createPublicVisibility, publicTerrainView } from './visibility.js'
import type { GroundSurfaceRef, PointMm, Prop, ScatterGroup, SceneDocument, SurfaceRef } from '../model/scene.js'

import { sha256Text } from '../validation/hash.js'
export { sha256Text } from '../validation/hash.js'

export const roundScatterMm = (value: number): number => { const result = Math.sign(value) * Math.round(Math.abs(value)); return result === 0 ? 0 : result }
const sampleChannel = (seed: string, column: number, row: number, channel: 'density' | 'x' | 'y' | 'palette' | 'rotation'): number => Number.parseInt(sha256Text(JSON.stringify([seed, column, row, channel])).slice(0, 13), 16) / 0x10000000000000

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

function scatterDomain(scene: SceneDocument, group: ScatterGroup): { polygon: PointMm[]; refs: SurfaceRef[] } {
  const domain = group.domain
  if (domain.kind === 'area') {
    const area = scene.terrainAreas[domain.areaId]
    if (!area) throw new Error(`散布地形不存在：${domain.areaId}。`)
    return { polygon: terrainPoints(area), refs: [{ kind: 'terrainArea', id: area.id }] }
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
function visualInsideFloor(scene: SceneDocument, prop: Prop): boolean {
  const floor = scene.floors[prop.floorId]
  if (!floor) return false
  const b = prop.visualBoundsMm, visual = propFootprint({ ...prop, footprintMm: { width: b.width, height: b.height }, footprintOffsetMm: { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
  return visual.every(p => p.x >= floor.boundsMm.x && p.y >= floor.boundsMm.y && p.x <= floor.boundsMm.x + floor.boundsMm.width && p.y <= floor.boundsMm.y + floor.boundsMm.height)
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
  if (source.algorithmVersion !== 'scatter-cell-v1') throw new Error(`散布算法 ${source.algorithmVersion} 不可重新生成；仍可手工编辑已保存实例。`)
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
  if (![minimumColumn, maximumColumn, minimumRow, maximumRow, columns * rows].every(Number.isSafeInteger) || columns * rows > 250000) throw new Error('单次散布候选网格不得超过 250000 格；请缩小域或增大格距。')
  const removed = new Set<string>(), previous = source.members
  for (const [key, member] of Object.entries(group.members)) if (member.state === 'managed' && member.propId !== null && !scene.props[member.propId]?.editLocked && (!publicGroup || visibility.prop(scene.props[member.propId]))) {
    removed.add(member.propId); delete group.members[key]
  }
  const obstacles = Object.values(scene.props).filter(prop => prop.floorId === group.floorId && !removed.has(prop.id) && (!publicGroup || visibility.prop(prop))).map(propFootprint)
  const ids = allIds(scene), props: Prop[] = []
  let liveCount = Object.values(group.members).filter(member => member.propId !== null).length
  for (let row = minimumRow; row <= maximumRow; row++) for (let column = minimumColumn; column <= maximumColumn; column++) {
    const cell = sampleScatterCellV1(group, column, row)
    if (group.members[cell.candidateKey] || cell.density >= group.densityFactor) continue
    const definition = scene.propDefinitions[cell.definitionRef.id]
    if (!definition || definition.version !== cell.definitionRef.version) throw new Error('散布需要已采用的固定版本物件定义。')
    const previousId = previous[cell.candidateKey]?.propId
    const propId = previousId && removed.has(previousId) ? previousId : options.allocatePropId?.(cell.candidateKey) ?? `scatter-${sha256Text(JSON.stringify([group.id, cell.candidateKey]))}`
    if (ids.has(propId) && !removed.has(propId)) throw new Error(`散布生成 ID 已被其他实体占用：${propId}。`)
    let prop: Prop = { id: propId, floorId: group.floorId, editLocked: false, visibility: group.visibility,
      definitionRef: cell.definitionRef, appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
      positionMm: cell.positionMm, rotationDeg: cell.rotationDeg, footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm),
      blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: refs[0], renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
    if (options.preserveManagedAppearance && previousId && removed.has(previousId) && scene.props[previousId]) {
      prop = { ...cloneJson(scene.props[previousId]), positionMm: cell.positionMm, rotationDeg: cell.rotationDeg }
    }
    const footprint = propFootprint(prop)
    if (!polygonInside(footprint, polygon) || !visualInsideFloor(scene, prop) || group.exclusions.some(exclusion => polygonDistance(footprint, exclusion.boundaryMm) <= 1e-7)) continue
    const support = refs.find(ref => supportedPolygon(supportScene, footprint, ref, group.floorId))
    if (!support || obstacles.some(other => polygonDistance(footprint, other) + 1e-7 < group.minDistanceMm)) continue
    prop.supportRef = cloneJson(support)
    group.members[cell.candidateKey] = { propId, state: 'managed', overrideFields: [] }
    props.push(prop); obstacles.push(footprint); ids.add(propId)
    if (++liveCount > 5000) throw new Error('散布组不得超过 5000 个活成员。')
  }
  // Preserve existing record order for no-op regeneration, including manual records.
  // JSON object order is not the algorithm's candidate order, which stays row/column.
  const ordered = Object.keys(source.members).filter(key => Object.hasOwn(group.members, key))
  group.members = Object.fromEntries([...ordered, ...Object.keys(group.members).filter(key => !Object.hasOwn(source.members, key))].map(key => [key, group.members[key]]))
  return { group, props, removePropIds: [...removed] }
}
