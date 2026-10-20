import { corridor, pathPolygonV2, polygonDistance, polygonInside, propFootprintV2, supportedPolygon, terrainPointsV2 } from './geometry'
import { createPublicVisibilityV2, publicTerrainViewV2 } from './visibility'
import type { GroundSurfaceRef, PointMm, PropV2, ScatterGroup, SceneDocumentV2, SurfaceRef } from './types'

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits))
/** Synchronous UTF-8 SHA-256 keeps command preview/adoption on the same finite API. */
export function sha256TextV2(value: string): string {
  const bytes = new TextEncoder().encode(value), size = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(size); padded.set(bytes); padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer), bitLength = bytes.length * 8
  view.setUint32(size - 8, Math.floor(bitLength / 0x100000000)); view.setUint32(size - 4, bitLength >>> 0)
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), words = new Uint32Array(64)
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2]
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3), s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = state
    for (let i = 0; i < 64; i++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25), choose = (e & f) ^ (~e & g)
      const t1 = (h + sum1 + choose + SHA256_K[i] + words[i]) >>> 0
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22), majority = (a & b) ^ (a & c) ^ (b & c), t2 = (sum0 + majority) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const values = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i++) state[i] = (state[i] + values[i]) >>> 0
  }
  return [...state].map(n => n.toString(16).padStart(8, '0')).join('')
}
export const roundScatterMmV2 = (value: number): number => { const result = Math.sign(value) * Math.round(Math.abs(value)); return result === 0 ? 0 : result }
const sampleChannel = (seed: string, column: number, row: number, channel: 'density' | 'x' | 'y' | 'palette' | 'rotation'): number => Number.parseInt(sha256TextV2(JSON.stringify([seed, column, row, channel])).slice(0, 13), 16) / 0x10000000000000

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
    candidateKey: sha256TextV2(JSON.stringify([group.seed, column, row])),
    density: sampleChannel(group.seed, column, row, 'density'),
    positionMm: { x: roundScatterMmV2(group.gridOriginMm.x + (column + sampleChannel(group.seed, column, row, 'x')) * group.cellSizeMm), y: roundScatterMmV2(group.gridOriginMm.y + (row + sampleChannel(group.seed, column, row, 'y')) * group.cellSizeMm) },
    rotationDeg: (Math.round(rotation * 1000) / 1000) % 360,
    paletteKey: selected.key, definitionRef: structuredClone(selected.propDefinitionRef),
  }
}

function scatterDomain(scene: SceneDocumentV2, group: ScatterGroup): { polygon: PointMm[]; refs: SurfaceRef[] } {
  const domain = group.domain
  if (domain.kind === 'area') {
    const area = scene.terrainAreas[domain.areaId]
    if (!area) throw new Error(`散布地形不存在：${domain.areaId}。`)
    return { polygon: terrainPointsV2(area), refs: [{ kind: 'terrainArea', id: area.id }] }
  }
  if (domain.kind === 'path') {
    const path = scene.paths[domain.pathId]
    if (!path) throw new Error(`散布路径不存在：${domain.pathId}。`)
    return { polygon: pathPolygonV2(path), refs: path.supportRefs }
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
function visualInsideFloor(scene: SceneDocumentV2, prop: PropV2): boolean {
  const floor = scene.floors[prop.floorId]
  if (!floor) return false
  const b = prop.visualBoundsMm, visual = propFootprintV2({ ...prop, footprintMm: { width: b.width, height: b.height }, footprintOffsetMm: { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
  return visual.every(p => p.x >= floor.boundsMm.x && p.y >= floor.boundsMm.y && p.x <= floor.boundsMm.x + floor.boundsMm.width && p.y <= floor.boundsMm.y + floor.boundsMm.height)
}
export interface ScatterRegenerationV2 { group: ScatterGroup; props: PropV2[]; removePropIds: string[] }
/** Pure proposal preparation: persisted manual/deleted/detached/locked results are never overwritten. */
export function buildScatterRegenerationV2(scene: SceneDocumentV2, groupId: string, densityFactor?: number): ScatterRegenerationV2 {
  const source = scene.scatterGroups[groupId]
  if (!source) throw new Error(`散布组不存在：${groupId}。`)
  if (source.algorithmVersion !== 'scatter-cell-v1') throw new Error(`散布算法 ${source.algorithmVersion} 不可重新生成；仍可手工编辑已保存实例。`)
  if (densityFactor !== undefined && (!Number.isFinite(densityFactor) || densityFactor < 0 || densityFactor > 1)) throw new Error('散布密度必须位于 [0,1]。')
  const visibility = createPublicVisibilityV2(scene), publicGroup = visibility.scatterGroup(source.id)
  const supportScene = publicGroup ? publicTerrainViewV2(scene, visibility) : scene
  const group = structuredClone(source)
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
  const obstacles = Object.values(scene.props).filter(prop => prop.floorId === group.floorId && !removed.has(prop.id) && (!publicGroup || visibility.prop(prop))).map(propFootprintV2)
  const ids = allIds(scene), props: PropV2[] = []
  let liveCount = Object.values(group.members).filter(member => member.propId !== null).length
  for (let row = minimumRow; row <= maximumRow; row++) for (let column = minimumColumn; column <= maximumColumn; column++) {
    const cell = sampleScatterCellV1(group, column, row)
    if (group.members[cell.candidateKey] || cell.density >= group.densityFactor) continue
    const definition = scene.propDefinitions[cell.definitionRef.id]
    if (!definition || definition.version !== cell.definitionRef.version) throw new Error('散布需要已采用的固定版本物件定义。')
    const previousId = previous[cell.candidateKey]?.propId
    const propId = previousId && removed.has(previousId) ? previousId : `scatter-${sha256TextV2(JSON.stringify([group.id, cell.candidateKey]))}`
    if (ids.has(propId) && !removed.has(propId)) throw new Error(`散布生成 ID 已被其他实体占用：${propId}。`)
    const prop: PropV2 = { id: propId, floorId: group.floorId, editLocked: false, visibility: group.visibility,
      definitionRef: cell.definitionRef, appearance: structuredClone(definition.defaultAppearance), visualBoundsMm: structuredClone(definition.defaultVisualBoundsMm),
      positionMm: cell.positionMm, rotationDeg: cell.rotationDeg, footprintMm: structuredClone(definition.defaultFootprintMm), footprintOffsetMm: structuredClone(definition.defaultFootprintOffsetMm),
      blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: refs[0], renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
    const footprint = propFootprintV2(prop)
    if (!polygonInside(footprint, polygon) || !visualInsideFloor(scene, prop) || group.exclusions.some(exclusion => polygonDistance(footprint, exclusion.boundaryMm) <= 1e-7)) continue
    const support = refs.find(ref => supportedPolygon(supportScene, footprint, ref, group.floorId))
    if (!support || obstacles.some(other => polygonDistance(footprint, other) + 1e-7 < group.minDistanceMm)) continue
    prop.supportRef = structuredClone(support)
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
