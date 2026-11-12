import type { InteriorGenerationInput, InteriorLayout, InteriorRectangle, InteriorRoomRequirement } from './contracts.js'
import { captureExecutionBudget, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { hashGenerationValue } from '../../contracts.js'
import { checkInteriorLayout, clearArea, interiorEntityId, InteriorGenerationError, sharedWallLength } from './layout.js'

type Group = { rooms: readonly InteriorRoomRequirement[]; bounds: InteriorRectangle }
type Placed = InteriorLayout['rooms'][number]
type Plan = { groups: Group[]; corridor?: InteriorRectangle; family: 'plain' | 'edge' | 'center' | 'cap'; key: string; estimate: number }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const targetArea = (r: InteriorRoomRequirement) => (r.minAreaMm2 + r.maxAreaMm2) / 2
// Soft proportions only. A store or gallery can be longer than a bedroom;
// explicit dimensions/area/relations always win over these initial preferences.
const preferredAspect = (r: InteriorRoomRequirement) => /走廊|长廊|展廊|corridor|gallery/i.test(r.purpose) ? 3 : /储藏|仓库|库房|storage|store|pantry/i.test(r.purpose) ? 2 : /厨房|kitchen/i.test(r.purpose) ? 1.8 : 1.6

/** Version 10's bounded rectangular family. Scores rank partial partitions;
 * every completed layout still consumes an actual candidate attempt. No
 * furniture is placed or scaled to manufacture a favourable layout score. */
export function solveBalancedInteriorLayout(sceneId: string, input: InteriorGenerationInput, profile: TaskBudgetProfile, seed: string, checkCancelled: () => void): InteriorLayout {
  const p = input.parameters, t = p.wallThicknessMm, inset = Math.ceil(t / 2), meter = captureExecutionBudget(profile)
  const root = { x: p.boundsMm.x + inset, y: p.boundsMm.y + inset, width: p.boundsMm.width - 2 * inset, height: p.boundsMm.height - 2 * inset }
  const limit = Math.min(8192, profile.limits.gridNodes), maxAttempts = profile.limits.candidateAttempts
  let nodes = 0, attempts = 0
  const tick = (fields = 1) => {
    checkCancelled()
    if (nodes >= limit) throw new InteriorGenerationError('search-exhausted', `有限布局搜索已检查${limit}个分支；尚未找到满足全部要求的布局，这不证明需求不可行。`)
    nodes++; meter.charge({ gridNodes: 1, fieldEvaluations: fields })
  }
  const fits = (r: InteriorRoomRequirement, b: InteriorRectangle) => b.width - t >= r.minClearSideMm && b.height - t >= r.minClearSideMm && clearArea(b, t) >= r.minAreaMm2 && clearArea(b, t) <= r.maxAreaMm2
  const possible = ({ rooms, bounds: b }: Group) => b.width > t && b.height > t && rooms.every(r => Math.min(b.width, b.height) - t >= r.minClearSideMm)
    && rooms.reduce((n, r) => n + r.minAreaMm2, 0) <= b.width * b.height && (rooms.length !== 1 || fits(rooms[0], b))
  if (root.width <= t || root.height <= t || p.rooms.some(r => Math.min(root.width, root.height) - t < r.minClearSideMm)
    || p.rooms.reduce((n, r) => n + r.minAreaMm2, 0) > root.width * root.height) throw new InteriorGenerationError('contradiction', '输入矛盾：建筑范围无法容纳最小净边长或最小面积总和。')
  const rank = (key: string) => hashGenerationValue([seed, key])
  const remaining = [...p.rooms].sort((a, b) => compare(rank(a.id), rank(b.id))), ordered: InteriorRoomRequirement[] = []
  while (remaining.length) {
    const last = ordered.at(-1)
    const neighbor = last ? remaining.findIndex(r => p.relations.some(q => q.kind === 'adjacent' && (q.a === last.id && q.b === r.id || q.b === last.id && q.a === r.id))) : 0
    ordered.push(remaining.splice(Math.max(0, neighbor), 1)[0])
  }
  const leafScore = (r: InteriorRoomRequirement, b: InteriorRectangle) => {
    const w = b.width - t, h = b.height - t
    if (w <= 0 || h <= 0) return Infinity
    return Math.max(0, Math.max(w / h, h / w) - preferredAspect(r)) ** 2 + .08 * Math.log(clearArea(b, t) / targetArea(r)) ** 2
  }
  // A lower bound from group elongation and room count, not an unmetered full
  // trial layout. Exact one-room scores guide split choices at the leaves.
  const groupScore = ({ rooms, bounds: b }: Group) => {
    if (!possible({ rooms, bounds: b })) return Infinity
    if (rooms.length === 1) return leafScore(rooms[0], b)
    const aspect = Math.max(b.width / b.height, b.height / b.width) / rooms.length
    return rooms.length * Math.max(0, aspect - Math.max(...rooms.map(preferredAspect))) ** 2
  }
  const plans: Plan[] = []
  const addPlan = (groups: Group[], corridor: InteriorRectangle | undefined, family: Plan['family'], key: string) => {
    tick(groups.length + p.relations.length)
    if (groups.some(g => !possible(g))) return
    // Different rectangular groups cannot become adjacent through a corridor.
    // Reject this partial plan before spending a complete-layout attempt.
    for (const relation of p.relations.filter(r => r.kind === 'adjacent')) {
      const a = groups.find(g => g.rooms.some(r => r.id === relation.a)), b = groups.find(g => g.rooms.some(r => r.id === relation.b))
      if (a && b && a !== b && sharedWallLength(a.bounds, b.bounds) < Math.max(1, relation.minimumSharedWallMm)) return
    }
    const corridorLoss = corridor ? 2 * clearArea(corridor, t) / clearArea(root, t) : 0
    plans.push({ groups, corridor, family, key, estimate: groups.reduce((n, g) => n + groupScore(g), 0) + corridorLoss })
  }
  const vertical = p.corridor.axis === 'vertical'
  function corridorPlans(rooms: readonly InteriorRoomRequirement[], b: InteriorRectangle, cap?: Group, key = '') {
    const size = vertical ? b.width : b.height, band = p.corridor.clearWidthMm + t
    if (band >= size - t) return
    for (let count = 0; count <= rooms.length; count++) {
      const first = rooms.slice(0, count), second = rooms.slice(count), weight = (rs: readonly InteriorRoomRequirement[]) => rs.reduce((n, r) => n + targetArea(r), 0)
      const fractions = count === 0 ? [0] : count === rooms.length ? [1] : [weight(first) / weight(rooms), .5]
      for (const aSize of new Set(fractions.map(f => Math.round((size - band) * f)))) {
        const a = { ...b, ...(vertical ? { width: aSize } : { height: aSize }) }
        const corridor = { ...b, ...(vertical ? { x: b.x + aSize, width: band } : { y: b.y + aSize, height: band }) }
        const c = { ...b, ...(vertical ? { x: corridor.x + band, width: size - aSize - band } : { y: corridor.y + band, height: size - aSize - band }) }
        addPlan([...(cap ? [cap] : []), ...(first.length ? [{ rooms: first, bounds: a }] : []), ...(second.length ? [{ rooms: second, bounds: c }] : [])], corridor,
          cap ? 'cap' : first.length && second.length ? 'center' : 'edge', `${key}/${count}/${aSize}`)
      }
    }
  }
  if (p.corridor.axis === 'none') addPlan([{ rooms: ordered, bounds: root }], undefined, 'plain', 'plain')
  else {
    if (p.corridor.clearWidthMm + 2 * t >= (vertical ? root.width : root.height)) throw new InteriorGenerationError('contradiction', '输入矛盾：走廊净宽及墙厚占满建筑范围。')
    corridorPlans(ordered, root)
    // A room spanning one end can stop the corridor at a real room wall. Try
    // only four promising cap shapes, then use the same bounded side partitions.
    if (ordered.length > 1) {
      const along = vertical ? root.height : root.width, across = vertical ? root.width : root.height
      const caps: { room: InteriorRoomRequirement; length: number; score: number }[] = []
      for (const room of ordered) for (const area of [room.minAreaMm2, targetArea(room), room.maxAreaMm2]) {
        tick()
        const length = Math.min(along - t - 1, Math.floor(area / (across - t)) + t)
        const b = { ...root, ...(vertical ? { height: length } : { width: length }) }
        if (fits(room, b)) caps.push({ room, length, score: leafScore(room, b) + 2 * (along - length) * p.corridor.clearWidthMm / clearArea(root, t) })
      }
      const unique = [...new Map(caps.map(c => [`${c.room.id}/${c.length}`, c])).values()]
        .sort((a, b) => a.score - b.score || compare(rank(`${a.room.id}/${a.length}`), rank(`${b.room.id}/${b.length}`))).slice(0, 4)
      for (const { room, length } of unique) for (const end of [false, true]) {
        const b = { ...root, ...(vertical ? { y: end ? root.y + root.height - length : root.y, height: length } : { x: end ? root.x + root.width - length : root.x, width: length }) }
        const rest = { ...root, ...(vertical ? { y: end ? root.y : root.y + length, height: root.height - length } : { x: end ? root.x : root.x + length, width: root.width - length }) }
        corridorPlans(ordered.filter(r => r.id !== room.id), rest, { rooms: [room], bounds: b }, `${room.id}/${length}/${end}`)
      }
    }
  }
  function* partition(rooms: readonly InteriorRoomRequirement[], b: InteriorRectangle, stopAt: number): Generator<Placed[]> {
    if (nodes >= stopAt) return
    tick(rooms.length)
    if (!possible({ rooms, bounds: b })) return
    if (rooms.length === 1) { yield [{ requirementId: rooms[0].id, roomId: interiorEntityId(sceneId, input.seed, `room:${rooms[0].id}`), boundsMm: b, clearAreaMm2: clearArea(b, t) }]; return }
    const splits: { a: Group; b: Group; score: number; key: string }[] = []
    for (const axis of ['x', 'y'] as const) for (let count = 1; count < rooms.length; count++) {
      if (nodes >= stopAt) return
      tick(rooms.length)
      const left = rooms.slice(0, count), right = rooms.slice(count), size = axis === 'x' ? b.width : b.height, cross = axis === 'x' ? b.height : b.width
      const weight = (rs: readonly InteriorRoomRequirement[]) => rs.reduce((n, r) => n + targetArea(r), 0)
      const positions = [Math.round(size * weight(left) / weight(rooms)), Math.floor(size / 2)]
      for (const [rs, reverse] of [[left, false], [right, true]] as const) if (rs.length === 1) {
        for (const area of [rs[0].minAreaMm2, targetArea(rs[0]), rs[0].maxAreaMm2]) {
          for (const length of new Set([Math.floor(area / (cross - t)) + t, Math.ceil(area / (cross - t)) + t])) positions.push(reverse ? size - length : length)
        }
        const length = Math.round((cross - t) / preferredAspect(rs[0])) + t
        positions.push(reverse ? size - length : length)
        positions.push(reverse ? size - rs[0].minClearSideMm - t : rs[0].minClearSideMm + t)
      }
      for (const position of new Set(positions)) {
        if (nodes >= stopAt) return
        tick(rooms.length)
        if (position <= t || position >= size - t) continue
        const a = { rooms: left, bounds: { ...b, ...(axis === 'x' ? { width: position } : { height: position }) } }
        const c = { rooms: right, bounds: { ...b, ...(axis === 'x' ? { x: b.x + position, width: size - position } : { y: b.y + position, height: size - position }) } }
        const score = groupScore(a) + groupScore(c)
        if (Number.isFinite(score)) splits.push({ a, b: c, score, key: `${axis}/${count}/${position}` })
      }
    }
    splits.sort((a, b) => a.score - b.score || compare(rank(a.key), rank(b.key)))
    for (const split of splits) {
      if (nodes >= stopAt) return
      for (const a of partition(split.a.rooms, split.a.bounds, stopAt)) for (const b of partition(split.b.rooms, split.b.bounds, stopAt)) yield [...a, ...b]
    }
  }
  function* complete(plan: Plan, stopAt: number, at = 0, placed: Placed[] = []): Generator<InteriorLayout> {
    if (at === plan.groups.length) {
      yield { rooms: placed, corridors: plan.corridor ? [{ roomId: interiorEntityId(sceneId, input.seed, 'corridor'), boundsMm: plan.corridor }] : [] }
      return
    }
    const group = plan.groups[at]
    for (const rows of partition(group.rooms, group.bounds, stopAt)) yield* complete(plan, stopAt, at + 1, [...placed, ...rows])
  }
  plans.sort((a, b) => a.estimate - b.estimate || compare(rank(a.key), rank(b.key)))
  // Compare the best member of each family before spending the remaining
  // attempts on variants of one family. A long edge corridor cannot monopolize
  // all four attempts simply because its cuts happen to enumerate first.
  const families = new Set<Plan['family']>(), first: Plan[] = [], rest: Plan[] = []
  for (const plan of plans) { if (families.has(plan.family)) rest.push(plan); else { families.add(plan.family); first.push(plan) } }
  let best: InteriorLayout | undefined, bestScore = Infinity
  for (const plan of [...first, ...rest]) {
    const stopAt = plan.family === 'plain' ? limit : Math.min(limit, nodes + Math.max(1024, p.rooms.length * 128))
    for (const layout of complete(plan, stopAt)) {
      checkCancelled()
      attempts++
      const rowCount = layout.rooms.length + layout.corridors.length
      meter.charge({ candidateAttempts: 1, fieldEvaluations: p.relations.length + layout.rooms.length, intersectionPairs: rowCount * (rowCount - 1) / 2 })
      if (!checkInteriorLayout(input, layout).length) {
        const score = layout.rooms.reduce((n, r) => n + leafScore(p.rooms.find(q => q.id === r.requirementId)!, r.boundsMm), 0)
          + layout.corridors.reduce((n, c) => n + 2 * clearArea(c.boundsMm, t) / clearArea(root, t), 0)
        if (score < bestScore) { best = layout; bestScore = score }
      }
      // Reserve a comparison for another family; no full candidates are hidden
      // inside a partial score or silently omitted from candidateAttempts.
      if (attempts >= maxAttempts) break
      if (plan.family !== 'plain') break
    }
    if (attempts >= maxAttempts || nodes >= limit) break
  }
  if (best) return { rooms: [...best.rooms].sort((a, b) => compare(a.requirementId, b.requirementId)), corridors: best.corridors }
  throw new InteriorGenerationError('search-exhausted', '有限比例与走廊布局搜索未找到符合全部净面积和关系要求的结果；可调整范围或需求，这不证明需求不可行。')
}
