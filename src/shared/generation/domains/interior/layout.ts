import type { InteriorGenerationInput, InteriorLayout, InteriorRectangle, InteriorRoomRequirement } from './contracts.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { GenerationError } from '../../orchestrator.js'
import { hashGenerationValue } from '../../contracts.js'

export type InteriorFailure = 'invalid-input' | 'unsupported' | 'contradiction' | 'search-exhausted' | 'budget-exceeded' | 'cancelled'
export class InteriorGenerationError extends GenerationError {
  constructor(readonly reason: InteriorFailure, message: string) {
    super(reason === 'cancelled' ? 'cancelled' : reason === 'budget-exceeded' ? 'budget-exceeded' : reason === 'invalid-input' || reason === 'unsupported' ? 'invalid-request' : 'candidate-invalid', message)
  }
}
export const interiorEntityId = (sceneId: string, seed: string, key: string) => `interior-${hashGenerationValue([sceneId, seed, key]).slice(0, 40)}`
export const rectanglePoints = (b: InteriorRectangle) => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
export const clearArea = (b: InteriorRectangle, thickness: number) => Math.max(0, b.width - thickness) * Math.max(0, b.height - thickness)
export function sharedWallLength(a: InteriorRectangle, b: InteriorRectangle): number {
  if (a.x + a.width === b.x || b.x + b.width === a.x) return Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  if (a.y + a.height === b.y || b.y + b.height === a.y) return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  return 0
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const fits = (room: InteriorRoomRequirement, b: InteriorRectangle, t: number) => b.width - t >= room.minClearSideMm && b.height - t >= room.minClearSideMm && clearArea(b, t) >= room.minAreaMm2 && clearArea(b, t) <= room.maxAreaMm2
const overlap = (a: InteriorRectangle, b: InteriorRectangle) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)

/** Independent finite layout checks. Area means the rectangular net interior,
 * after half the wall thickness on each side, never the centreline polygon. */
export function checkInteriorLayout(input: InteriorGenerationInput, layout: InteriorLayout): string[] {
  const p = input.parameters, issues: string[] = [], rows = new Map(layout.rooms.map(room => [room.requirementId, room]))
  if (rows.size !== p.rooms.length || layout.rooms.length !== p.rooms.length) issues.push('房间需求与实际输出不一一对应')
  for (const room of p.rooms) {
    const row = rows.get(room.id)
    if (!row || !fits(room, row.boundsMm, p.wallThicknessMm) || row.clearAreaMm2 !== clearArea(row.boundsMm, p.wallThicknessMm)) issues.push(`房间${room.id}的净面积或最小净边长不符`)
  }
  const all = [...layout.rooms, ...layout.corridors], inset = Math.ceil(p.wallThicknessMm / 2), bounds = p.boundsMm
  for (const row of all) {
    const b = row.boundsMm
    if (![b.x, b.y, b.width, b.height].every(Number.isSafeInteger) || b.width <= p.wallThicknessMm || b.height <= p.wallThicknessMm || b.x < bounds.x + inset || b.y < bounds.y + inset || b.x + b.width > bounds.x + bounds.width - inset || b.y + b.height > bounds.y + bounds.height - inset) issues.push('房间或通道越过完整墙厚边界')
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i].boundsMm, all[j].boundsMm)) issues.push('房间或通道轮廓重叠')
  for (const relation of p.relations) {
    const a = rows.get(relation.a), b = rows.get(relation.b)
    if (!a || !b) { issues.push('关系需求缺少真实房间'); continue }
    const shared = sharedWallLength(a.boundsMm, b.boundsMm)
    if (relation.kind === 'adjacent' && shared < Math.max(1, relation.minimumSharedWallMm) || relation.kind === 'separate' && shared > 0) issues.push(`房间${relation.a}/${relation.b}的邻接关系未满足`)
  }
  if (p.corridor.axis === 'none' ? layout.corridors.length !== 0 : layout.corridors.length !== 1) issues.push('通道数量不符')
  if (layout.corridors.some(row => (p.corridor.axis === 'horizontal' ? row.boundsMm.height : row.boundsMm.width) - p.wallThicknessMm !== p.corridor.clearWidthMm)) issues.push('通道实际净宽不符')
  return issues
}

/** Slicing rectangles + bounded backtracking. It supports a finite family of
 * guillotine partitions, not arbitrary adjacency-graph feasibility. */
export function solveInteriorLayout(sceneId: string, input: InteriorGenerationInput, profile: TaskBudgetProfile, stableSeed: string, checkCancelled: () => void): InteriorLayout {
  const p = input.parameters, meter = captureExecutionBudget(profile), t = p.wallThicknessMm, inset = Math.ceil(t / 2)
  const root = { x: p.boundsMm.x + inset, y: p.boundsMm.y + inset, width: p.boundsMm.width - 2 * inset, height: p.boundsMm.height - 2 * inset }
  const limit = Math.min(8192, profile.limits.gridNodes), maxProposals = profile.limits.candidateAttempts
  let nodes = 0, proposals = 0
  const tick = () => { checkCancelled(); if (++nodes > limit) throw new InteriorGenerationError('search-exhausted', `有限布局搜索已检查${limit}个分支，尚未找到符合要求的切分；可调整范围或关系。`); meter.charge({ gridNodes: 1, fieldEvaluations: 1 }) }
  if (root.width <= t || root.height <= t || p.rooms.some(room => room.minClearSideMm > root.width - t || room.minClearSideMm > root.height - t)
    || p.rooms.reduce((sum, room) => sum + BigInt(room.minAreaMm2), 0n) > BigInt(Math.max(0, root.width)) * BigInt(Math.max(0, root.height))) throw new InteriorGenerationError('contradiction', '输入矛盾：建筑范围无法容纳最小净边长或最小面积总和。')
  const rank = (key: string) => hashGenerationValue([stableSeed, key])
  // Required adjacency influences placement order before finite geometry search.
  const remaining = [...p.rooms].sort((a, b) => compare(rank(a.id), rank(b.id))), ordered: InteriorRoomRequirement[] = []
  while (remaining.length) {
    const last = ordered.at(-1)
    let next = last ? remaining.findIndex(room => p.relations.some(r => r.kind === 'adjacent' && (r.a === last.id && r.b === room.id || r.b === last.id && r.a === room.id))) : 0
    if (next < 0) next = 0
    ordered.push(remaining.splice(next, 1)[0])
  }
  type Placed = { requirementId: string; roomId: string; boundsMm: InteriorRectangle; clearAreaMm2: number }
  function* partition(rooms: readonly InteriorRoomRequirement[], b: InteriorRectangle, depth: number): Generator<Placed[]> {
    tick()
    if (rooms.length === 1) {
      if (fits(rooms[0], b, t)) yield [{ requirementId: rooms[0].id, roomId: interiorEntityId(sceneId, input.seed, `room:${rooms[0].id}`), boundsMm: b, clearAreaMm2: clearArea(b, t) }]
      return
    }
    if (rooms.reduce((sum, r) => sum + r.minAreaMm2, 0) > b.width * b.height) return
    const axes = b.width >= b.height ? ['x', 'y'] as const : ['y', 'x'] as const
    const counts = Array.from({ length: rooms.length - 1 }, (_, i) => i + 1).sort((a, c) => Math.abs(a - rooms.length / 2) - Math.abs(c - rooms.length / 2) || a - c)
    for (const axis of axes) for (const count of counts) {
      const left = rooms.slice(0, count), right = rooms.slice(count), size = axis === 'x' ? b.width : b.height, cross = axis === 'x' ? b.height : b.width
      const weight = (rs: readonly InteriorRoomRequirement[]) => rs.reduce((sum, r) => sum + (r.minAreaMm2 + r.maxAreaMm2) / 2, 0)
      const ratio = weight(left) / (weight(left) + weight(right))
      const splits = [Math.round(size * ratio), Math.floor(size / 2)]
      // Exact one-room area edges substantially reduce unnecessary backtracking.
      for (const [rs, inverse] of [[left, false], [right, true]] as const) if (rs.length === 1 && cross > t) {
        for (const area of [rs[0].minAreaMm2, rs[0].maxAreaMm2]) {
          const length = Math.ceil(area / (cross - t)) + t
          splits.push(inverse ? size - length : length)
        }
        splits.push(inverse ? size - rs[0].minClearSideMm - t : rs[0].minClearSideMm + t)
      }
      for (const split of [...new Set(splits)]) {
        tick(); if (split <= t || split >= size - t) continue
        const a = { ...b, ...(axis === 'x' ? { width: split } : { height: split }) }, c = { ...b, ...(axis === 'x' ? { x: b.x + split, width: size - split } : { y: b.y + split, height: size - split }) }
        for (const first of partition(left, a, depth + 1)) for (const second of partition(right, c, depth + 1)) yield [...first, ...second]
      }
    }
  }
  function* layouts(rooms: readonly InteriorRoomRequirement[]): Generator<InteriorLayout> {
    if (p.corridor.axis === 'none') {
      for (const placed of partition(rooms, root, 0)) yield { rooms: placed, corridors: [] }
      return
    }
    const vertical = p.corridor.axis === 'vertical', size = vertical ? root.width : root.height, band = p.corridor.clearWidthMm + t
    if (band >= size - t) throw new InteriorGenerationError('contradiction', '输入矛盾：走廊净宽及墙厚占满建筑范围。')
    for (let count = 0; count < rooms.length; count++) {
      const left = rooms.slice(0, count), right = rooms.slice(count), aSize = count === 0 ? 0 : Math.floor((size - band) / 2)
      const a = { ...root, ...(vertical ? { width: aSize } : { height: aSize }) }
      const corridor = { ...root, ...(vertical ? { x: root.x + aSize, width: band } : { y: root.y + aSize, height: band }) }
      const b = { ...root, ...(vertical ? { x: corridor.x + band, width: size - aSize - band } : { y: corridor.y + band, height: size - aSize - band }) }
      const first = left.length ? partition(left, a, 0) : [[]]
      for (const l of first) for (const r of partition(right, b, 0)) yield { rooms: [...l, ...r], corridors: [{ roomId: interiorEntityId(sceneId, input.seed, 'corridor'), boundsMm: corridor }] }
    }
  }
  try {
    for (const order of [ordered, [...ordered].reverse()]) for (const layout of layouts(order)) {
      checkCancelled()
      if (proposals >= maxProposals) throw new InteriorGenerationError('search-exhausted', `已核对${maxProposals}个完整布局候选，有限切分未找到满足全部关系的结果；这不证明需求不可行。`)
      proposals++; meter.charge({ candidateAttempts: 1, fieldEvaluations: p.relations.length + layout.rooms.length })
      if (!checkInteriorLayout(input, layout).length) return { rooms: [...layout.rooms].sort((a, b) => compare(a.requirementId, b.requirementId)), corridors: layout.corridors }
    }
  } catch (error) {
    if (error instanceof GenerationError) throw error
    if (String(error).includes('任务预算超限')) throw new InteriorGenerationError('budget-exceeded', String(error))
    throw error
  }
  throw new InteriorGenerationError('search-exhausted', '有限矩形切分未找到符合全部净面积和邻接要求的布局；可扩大范围、放宽面积区间或调整关系。')
}
