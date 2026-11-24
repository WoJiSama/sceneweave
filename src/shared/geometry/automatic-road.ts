import type { Floor, Path, PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import type { StaircaseConfig } from '../stairs/contracts.js'
import { planStaircase } from '../stairs/geometry.js'
import { polylineBand, polygonValid, widthProfileBand } from './geometry.js'
import { rootSurfaceElevation } from './support-sample.js'
import { publicTerrainView } from './visibility.js'
import { assertRoadProfile, createRoadGround, roadPointEquals, roadSupportKey } from './road-domain.js'
import { gradeRoadSurface, roadShoulderMm } from './road-grading.js'
import { AUTOMATIC_ROAD_MAX_FIXED_POINTS, ROAD_RISER_LIMIT_MM, RoadFootprintConflict, type RoadLanding, type RoadSurfaceGeometry } from './road-surface.js'
import { connectionArcFrame } from './connection-route.js'

export { AUTOMATIC_ROAD_MAX_FIXED_POINTS, AUTOMATIC_ROAD_VERSION } from './road-surface.js'
export { roadPointEquals } from './road-domain.js'
const MAX_POINTS = 128
const MAX_SEARCH_NODES = 5200
const MAX_SEGMENT_COST_CACHE = 16000
const MAX_GRADE = .74
const NO_ROUTE = '这两个点之间未找到满足净宽和坡度的路线。试着挪动端点或途经点。'

export type AutomaticRoadShape = Pick<Path, 'centerlineMm' | 'roadSurface'> & { fixedPointsMm: readonly PointMm[]; landings?: readonly RoadLanding[] }
export type AutomaticRoadPlan = AutomaticRoadShape & { band: PointMm[]; supportRefs: SurfaceRef[]; geometry?: RoadSurfaceGeometry; lengthMm: number }
const distance = (a: PointMm, b: PointMm) => Math.hypot(b.x - a.x, b.y - a.y)
const pointKey = ({ x, y }: PointMm) => `${x},${y}`

type SearchNode = { point: PointMm; key: string; cost: number; estimate: number; parent?: SearchNode }

const latticeSteps = [-2, -1, 0, 1, 2].flatMap(y => [-2, -1, 0, 1, 2]
  .filter(x => Math.max(Math.abs(x), Math.abs(y)) === 1 || Math.abs(x) + Math.abs(y) === 3).map(x => ({ x, y })))

/** Bounded A* with a deterministic ordering of equal-priority nodes. */
function nodeQueue() {
  const heap: SearchNode[] = []
  const before = (a: SearchNode, b: SearchNode) => a.estimate < b.estimate || a.estimate === b.estimate && a.cost > b.cost
  return {
    push(node: SearchNode) {
      let i = heap.length
      heap.push(node)
      for (let parent = Math.floor((i - 1) / 2); i > 0 && before(node, heap[parent]); parent = Math.floor((i - 1) / 2)) {
        heap[i] = heap[parent]
        i = parent
      }
      heap[i] = node
    },
    take() {
      const first = heap[0], tail = heap.pop()
      if (!tail || !heap.length) return first
      let i = 0
      while (i * 2 + 1 < heap.length) {
        const left = i * 2 + 1, right = left + 1
        const child = right < heap.length && before(heap[right], heap[left]) ? right : left
        if (!before(heap[child], tail)) break
        heap[i] = heap[child]
        i = child
      }
      heap[i] = tail
      return first
    },
  }
}

function previousLegs(shape: AutomaticRoadShape | undefined) {
  const legs = new Map<string, PointMm[]>()
  if (!shape) return legs
  let start = 0
  for (const [i, point] of shape.fixedPointsMm.slice(1).entries()) {
    const end = shape.centerlineMm.findIndex((candidate, j) => j > start && roadPointEquals(candidate, point))
    if (end < 0) break
    legs.set(`${pointKey(shape.fixedPointsMm[i])}/${pointKey(point)}`, shape.centerlineMm.slice(start, end + 1))
    start = end
  }
  return legs
}

function fitsFloor(floor: Floor, p: PointMm) {
  return p.x >= floor.boundsMm.x && p.y >= floor.boundsMm.y
    && p.x <= floor.boundsMm.x + floor.boundsMm.width && p.y <= floor.boundsMm.y + floor.boundsMm.height
}

function createLegSearch(view: SceneDocument, floor: Floor, ground: ReturnType<typeof createRoadGround>, widthMm: number,
  segmentCosts: Map<string, number>, searchWidth = widthMm) {
  const sampleInterval = Math.min(500, Math.max(180, widthMm / 3))
  const searchBand = (points: PointMm[]) => polylineBand(points, searchWidth, searchWidth === widthMm)

  function stations(a: PointMm, b: PointMm, count: number) {
    const length = distance(a, b), dx = (b.x - a.x) / length, dy = (b.y - a.y) / length
    return Array.from({ length: count + 1 }, (_, i) => {
      const p = { x: a.x + (b.x - a.x) * i / count, y: a.y + (b.y - a.y) * i / count }
      const center = ground.sample(p)
      const left = ground.sample({ x: p.x - dy * widthMm / 2, y: p.y + dx * widthMm / 2 })
      const right = ground.sample({ x: p.x + dy * widthMm / 2, y: p.y - dx * widthMm / 2 })
      if (!center || !left || !right) return null
      const datum = rootSurfaceElevation(view, center.rootSupportRef)
      if (datum !== rootSurfaceElevation(view, left.rootSupportRef) || datum !== rootSurfaceElevation(view, right.rootSupportRef)) return null
      if (searchWidth > widthMm) {
        for (const offset of [-searchWidth / 2, searchWidth / 2]) {
          const bank = ground.sample({ x: p.x - dy * offset, y: p.y + dx * offset })
          if (!bank || datum !== rootSurfaceElevation(view, bank.rootSupportRef)) return null
        }
      }
      const cutFill = [left.zMm - center.zMm, right.zMm - center.zMm].reduce((sum, delta) =>
        sum + Math.abs(delta) * (.25 + roadShoulderMm(widthMm, delta) / (2 * widthMm)), 0)
      return { zMm: center.zMm, datum, cutFill, crossGrade: Math.abs(left.zMm - right.zMm) / widthMm }
    })
  }

  function measureSegment(a: PointMm, b: PointMm) {
    const length = distance(a, b)
    if (length < 1 || !fitsFloor(floor, b)) return Infinity
    if (!ground.clear(searchBand([a, b]))) return Infinity
    const count = Math.min(160, Math.ceil(length / sampleInterval))
    const samples = stations(a, b, count)
    let cost = 0
    for (let i = 1; i < samples.length; i++) {
      const from = samples[i - 1], to = samples[i], span = length / count
      if (!from || !to || from.datum !== to.datum) return Infinity
      const grade = Math.abs(to.zMm - from.zMm) / span, crossGrade = Math.max(from.crossGrade, to.crossGrade)
      // A short stone lip can become a tread. Reject sustained steep sections
      // and cliffs, keeping small changes in rough terrain from forcing zigzags.
      const window = Math.min(i, Math.ceil(1250 / span)), windowStart = samples[i - window]
      if (!windowStart || grade > .94 || Math.abs(to.zMm - windowStart.zMm) > span * window * MAX_GRADE || crossGrade > 1.1) return Infinity
      cost += span * (1 + 9 * grade ** 2 + .44 * crossGrade + .85 * Math.max(from.cutFill, to.cutFill) / widthMm)
    }
    return cost
  }

  // This only caches heuristic samples for the exact, open sketch snapshot.
  // The complete corridor and scene are checked separately before adoption.
  function segmentCost(a: PointMm, b: PointMm) {
    const [start, end] = a.x < b.x || a.x === b.x && a.y <= b.y ? [a, b] : [b, a]
    const key = `${searchWidth}/${pointKey(start)}/${pointKey(end)}`
    const cached = segmentCosts.get(key)
    if (cached !== undefined) return cached
    const cost = measureSegment(start, end)
    if (segmentCosts.size >= MAX_SEGMENT_COST_CACHE) segmentCosts.clear()
    segmentCosts.set(key, cost)
    return cost
  }

  return function solveLeg(from: PointMm, to: PointMm, available: { nodes: number }): PointMm[] {
    const length = distance(from, to), sampled = segmentCost(from, to)
    const direct = Number.isFinite(sampled) && ground.supports(searchBand([from, to])) ? sampled : Infinity
    if (direct <= 1.12 * length) return [from, to]
    const padding = Math.max(widthMm * 3, 3500, length * .7)
    const minX = Math.max(floor.boundsMm.x, Math.min(from.x, to.x) - padding)
    const minY = Math.max(floor.boundsMm.y, Math.min(from.y, to.y) - padding)
    const maxX = Math.min(floor.boundsMm.x + floor.boundsMm.width, Math.max(from.x, to.x) + padding)
    const maxY = Math.min(floor.boundsMm.y + floor.boundsMm.height, Math.max(from.y, to.y) + padding)
    const grid = Math.ceil(Math.max(480, widthMm * .85, (maxX - minX) / 54, (maxY - minY) / 54))
    const origin = floor.boundsMm
    const nearest = (point: PointMm) => ({ x: origin.x + Math.round((point.x - origin.x) / grid) * grid, y: origin.y + Math.round((point.y - origin.y) / grid) * grid })
    const neighbors = (point: PointMm) => {
      const center = nearest(point), result: PointMm[] = []
      if (distance(point, to) <= grid * 3) result.push(to)
      for (const { x, y } of latticeSteps) {
        const next = { x: center.x + x * grid, y: center.y + y * grid }
        if (next.x >= minX && next.x <= maxX && next.y >= minY && next.y <= maxY && !roadPointEquals(point, next)) result.push(next)
      }
      return result
    }
    const elevations = new Map<string, number>(), goalZ = ground.sample(to)!.zMm
    const estimate = (point: PointMm) => {
      const key = pointKey(point)
      const z = elevations.get(key) ?? ground.sample(point)?.zMm ?? goalZ
      elevations.set(key, z)
      const climb = Math.abs(goalZ - z), span = Math.max(distance(point, to), climb * 3)
      return span ? span + 9 * climb ** 2 / span : 0
    }
    const bend = (a: PointMm, b: PointMm, c: PointMm) => {
      const ab = distance(a, b), bc = distance(b, c)
      const cosine = Math.max(-1, Math.min(1, ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (ab * bc)))
      return { cosine, inset: widthMm * .5 * Math.sqrt((1 - cosine) / (1 + cosine)) }
    }
    const extension = (node: SearchNode, point: PointMm) => {
      const cost = segmentCost(node.point, point)
      if (!node.parent || !Number.isFinite(cost)) return node.cost + cost
      const turn = bend(node.parent.point, node.point, point)
      const preceding = node.parent.parent ? bend(node.parent.parent.point, node.parent.point, node.point).inset : 0
      if (turn.cosine < -.46 || turn.inset > distance(node.point, point) * .82
        || turn.inset + preceding > distance(node.parent.point, node.point) * .92) return Infinity
      return node.cost + cost + widthMm * 3.2 * (1 - turn.cosine)
    }
    const queue = nodeQueue(), initial = { point: from, key: pointKey(from), cost: 0, estimate: estimate(from) }
    const best = new Map<string, SearchNode>([[initial.key, initial]])
    queue.push(initial)
    let solved: SearchNode | undefined
    for (let node = queue.take(); node && available.nodes > 0; node = queue.take()) {
      if (best.get(node.key) !== node) continue
      available.nodes--
      if (roadPointEquals(node.point, to)) { solved = node; break }
      if (node.estimate >= direct * .995) break
      for (const point of neighbors(node.point)) {
        // An any-angle shortcut reduces lattice zigzags while preserving the
        // same measured slope and obstruction cost used on adjacent edges.
        let parent = node, cost = extension(node, point)
        if (node.parent && distance(node.parent.point, point) <= 6 * grid) {
          const shortcut = extension(node.parent, point)
          if (shortcut <= cost) { cost = shortcut; parent = node.parent }
        }
        const heading = Math.round(Math.atan2(point.y - parent.point.y, point.x - parent.point.x) * 8 / Math.PI)
        const key = `${pointKey(point)}/${heading}`
        if (!Number.isFinite(cost) || cost >= (best.get(key)?.cost ?? Infinity) || roadPointEquals(parent.point, point)) continue
        const next = { point, parent, key, cost, estimate: cost + estimate(point) }
        best.set(key, next)
        queue.push(next)
      }
    }
    if (Number.isFinite(direct) && (!solved || direct <= solved.cost * 1.035)) return [from, to]
    if (!solved) throw new Error(available.nodes > 0 ? NO_ROUTE : '自动选路已达到本次搜索范围。请缩短距离，或先在中间设途经点。')
    const result: PointMm[] = []
    for (let node: SearchNode | undefined = solved; node; node = node.parent) result.push(node.point)
    result.reverse()
    // Ease only generated bends. The first and last of each leg are author
    // points, so they remain exact even when this leg is rerouted later.
    const rounded = [from]
    for (let i = 1; i < result.length - 1; i++) {
      const [a, pivot, b] = result.slice(i - 1, i + 2), angle = bend(a, pivot, b)
      const trim = Math.min(widthMm * 1.3, distance(a, pivot) * .36, distance(pivot, b) * .36)
      if (angle.cosine > .96 || trim < angle.inset * 1.46 + 120) { rounded.push(pivot); continue }
      const toward = (p: PointMm) => {
        const total = distance(pivot, p)
        return { x: Math.round(pivot.x + (p.x - pivot.x) * trim / total), y: Math.round(pivot.y + (p.y - pivot.y) * trim / total) }
      }
      const left = toward(a), right = toward(b)
      const middle = { x: Math.round((left.x + right.x + pivot.x * 2) / 4), y: Math.round((left.y + right.y + pivot.y * 2) / 4) }
      if ([segmentCost(rounded.at(-1)!, left), segmentCost(left, middle), segmentCost(middle, right), segmentCost(right, b)].every(Number.isFinite)) rounded.push(left, middle, right)
      else rounded.push(pivot)
    }
    rounded.push(to)
    const band = searchBand(rounded)
    return rounded.length <= MAX_POINTS && polygonValid(band, true) && ground.supports(band) ? rounded : result
  }
}

/** The sketch searches using source ground. A prepared candidate owns its physical profile. */
export function createAutomaticRoadPlanner(scene: SceneDocument, request: Pick<Path, 'floorId' | 'widthMm' | 'visibility' | 'widthSections'>, editingId?: string) {
  const { floorId, widthMm, visibility, widthSections } = request
  const floor = scene.floors[floorId]
  const view = visibility === 'public' ? publicTerrainView(scene) : scene
  const ground = createRoadGround(view, floorId, editingId)
  const actualGround = view === scene ? ground : createRoadGround(scene, floorId, editingId)
  const segmentCosts = new Map<string, number>()
  const solveLeg = createLegSearch(view, floor, ground, widthMm, segmentCosts)

  return (fixedPointsMm: readonly PointMm[], previous?: AutomaticRoadShape,
    options: { landings?: readonly RoadLanding[]; legacyStaircase?: StaircaseConfig | null; widthChanged?: boolean } = {}): AutomaticRoadPlan => {
    if (!floor || !Number.isSafeInteger(widthMm) || widthMm <= 0 || fixedPointsMm.length < 2 || fixedPointsMm.length > AUTOMATIC_ROAD_MAX_FIXED_POINTS
      || new Set(fixedPointsMm.map(pointKey)).size !== fixedPointsMm.length
      || fixedPointsMm.some(p => ![p.x, p.y].every(Number.isSafeInteger) || !fitsFloor(floor, p) || !ground.sample(p))) {
      throw new Error('起终点和途经点须各自落在有承托的陆地上，道路净宽须为正整数。')
    }
    const retained = previousLegs(previous), remaining = { nodes: MAX_SEARCH_NODES }
    const legs = fixedPointsMm.slice(1).map((to, i) => {
      const from = fixedPointsMm[i]
      return { from, to, kept: retained.get(`${pointKey(from)}/${pointKey(to)}`) }
    })
    const trace = (search: typeof solveLeg) => {
      const points = [fixedPointsMm[0]]
      for (const { from, to, kept } of legs) {
        points.push(...(kept ?? search(from, to, remaining)).slice(1))
        if (points.length > MAX_POINTS) throw new Error('路线太曲折，请缩短距离或调整途经点。')
      }
      return points
    }
    const agreeWithActual = (band: PointMm[], refs: SurfaceRef[]) => {
      if (actualGround === ground) return
      const actual = actualGround.supports(band)
      if (!actual || actual.map(roadSupportKey).join('\n') !== refs.map(roadSupportKey).join('\n')) throw new Error('现有地面或内容与这条道路冲突，请调整路线。')
    }
    // Old manually authored stair layouts remain editable with their original semantics.
    if (options.legacyStaircase !== undefined) {
      const centerlineMm = trace(solveLeg)
      const band = widthSections?.length ? widthProfileBand(centerlineMm, widthMm, widthSections) : polylineBand(centerlineMm, widthMm, true)
      if (!polygonValid(band, true)) throw new Error('道路在转弯处重叠，请拉开前后两段。')
      const supportRefs = ground.supports(band)
      if (!supportRefs) throw new Error('道路的完整宽度或转角超出可用地面，请调整路线。')
      agreeWithActual(band, supportRefs)
      if (options.legacyStaircase) planStaircase(centerlineMm, widthMm, options.legacyStaircase, widthSections)
      return { centerlineMm, fixedPointsMm, band, supportRefs, lengthMm: connectionArcFrame(centerlineMm).length }
    }
    const landings = options.landings ?? []
    const grade = (centerlineMm: PointMm[]) => {
      const path = { centerlineMm, widthMm, widthSections }
      const unchanged = previous?.roadSurface && !options.widthChanged && centerlineMm.length === previous.centerlineMm.length
        && centerlineMm.every((point, i) => roadPointEquals(point, previous.centerlineMm[i]))
        && fixedPointsMm.length === previous.fixedPointsMm.length && fixedPointsMm.every((point, i) => roadPointEquals(point, previous.fixedPointsMm[i]))
        && JSON.stringify(landings) === JSON.stringify(previous.landings ?? [])
      const roadSurface = unchanged ? previous.roadSurface! : gradeRoadSurface(path, fixedPointsMm, landings, p => ground.sample(p)?.zMm ?? null)
      const { geometry, refs } = assertRoadProfile(path, roadSurface, landings, fixedPointsMm, ground)
      agreeWithActual(geometry.footprintMm, refs)
      return { centerlineMm, fixedPointsMm, band: geometry.footprintMm, supportRefs: refs,
        lengthMm: connectionArcFrame(centerlineMm).length, roadSurface, geometry, landings }
    }
    try {
      return grade(trace(solveLeg))
    } catch (error) {
      // A bend that clears at walking width can still put its graded bank in
      // water. Keep pinned legs exact and spend only the remaining search budget.
      if (!(error instanceof RoadFootprintConflict) || !remaining.nodes || legs.every(leg => leg.kept)) throw error
      const widest = Math.max(widthMm, ...(widthSections ?? []).map(section => section.widthMm))
      // Use the measured banks while keeping the original lattice resolution
      // and walking-slope limits; a wide search grid can miss a narrow isthmus.
      const shoulder = error.shoulderMm || roadShoulderMm(widest, ROAD_RISER_LIMIT_MM)
      const withBanks = createLegSearch(view, floor, ground, widthMm, segmentCosts, widest + 2 * shoulder)
      return grade(trace(withBanks))
    }
  }
}
