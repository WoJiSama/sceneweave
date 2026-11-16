import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { PointMm } from '../model/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'
import { ROCK_SHELL_LIMITS, rockShellSchema, type CreateRockShellIntent, type RockShell, type RockShellHost,
  type RockShellIssue, type RockShellPoint, type RockShellSample, type RockShellTriangle } from './contracts.js'
import { EPS, area, cornerJoin, cross, expectedFaces, faceNormal, field, integerRay, interpolate, isOrthogonalBoundary,
  length, polygon, radialSectorLimit, sectionVertices, segmentNormal, signedArea, smooth, sourceLattice, union, validateBoundary, xyzKey } from './geometry.js'

const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && id !== '__proto__'
const coordinate = (n: number) => Number.isSafeInteger(n) && Math.abs(n) <= ROCK_SHELL_LIMITS.coordinateAbsMm
const samePoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y

function captureHost(input: RockShellHost): RockShellHost {
  const raw = captureJson(input)
  if (!validId(raw.id) || !validId(raw.floorId) || raw.id === raw.floorId || !raw.rockBody
    || !coordinate(raw.groundElevationMm) || !coordinate(raw.rockBody.baseElevationMm)) throw Error('侧壳须绑定完整有限岩体和Floor。')
  if (raw.rockBody.baseElevationMm > 0 || raw.groundElevationMm <= 0 || raw.rockBody.baseElevationMm >= raw.groundElevationMm) throw Error('侧壳首片须从明确的零高地面升至岩顶，base不可高于地面。')
  if (!Array.isArray(raw.boundaryMm) || raw.boundaryMm.length < 4 || raw.boundaryMm.length > ROCK_SHELL_LIMITS.sections) throw Error('侧壳首片仅支持4至20个稳定simple顶缘点。')
  for (const point of raw.boundaryMm) if (!validId(point.id) || !validId(point.segmentId) || !point.positionMm || !coordinate(point.positionMm.x) || !coordinate(point.positionMm.y)) throw Error('侧壳顶缘须保存有限整数毫米与稳定ID。')
  const points = raw.boundaryMm.map(v => v.positionMm)
  if (Math.max(...points.map(v => v.x)) - Math.min(...points.map(v => v.x)) > ROCK_SHELL_LIMITS.hostSpanMm
    || Math.max(...points.map(v => v.y)) - Math.min(...points.map(v => v.y)) > ROCK_SHELL_LIMITS.hostSpanMm) throw Error('侧壳宿主跨度超过有限范围。')
  validateBoundary(raw.boundaryMm)
  if (!isOrthogonalBoundary(raw.boundaryMm)) raw.boundaryMm.forEach((_, edge) => cornerJoin(raw.boundaryMm, edge))
  const start = raw.boundaryMm.reduce((best, v, i) => v.segmentId < raw.boundaryMm[best].segmentId ? i : best, 0)
  return { id: raw.id, floorId: raw.floorId, groundElevationMm: raw.groundElevationMm, rockBody: { baseElevationMm: raw.rockBody.baseElevationMm },
    boundaryMm: [...raw.boundaryMm.slice(start), ...raw.boundaryMm.slice(0, start)].map(v => ({ id: v.id, segmentId: v.segmentId, positionMm: { ...v.positionMm } })) }
}

function prepare(hostInput: RockShellHost, intentInput: CreateRockShellIntent) {
  const host = captureHost(hostInput), intent = captureJson(intentInput)
  if (!intent.footSurfaceRef || intent.footSurfaceRef.kind !== 'floor' || intent.footSurfaceRef.id !== host.floorId || intent.footElevationMm !== 0) throw Error('侧壳首片必须明确选择同Floor的零高地面脚面。')
  if (!Number.isSafeInteger(intent.widthMm) || intent.widthMm <= 0 || intent.widthMm > ROCK_SHELL_LIMITS.hostSpanMm) throw Error('侧壳宽度须为有限正整数毫米。')
  if (typeof intent.seed !== 'string' || intent.seed.length > 1024 || !intent.direction || !Number.isFinite(intent.direction.x) || !Number.isFinite(intent.direction.y)) throw Error('侧壳配方须具有有限种子与实际造型方向。')
  const magnitude = Math.hypot(intent.direction.x, intent.direction.y)
  if (!Number.isFinite(magnitude) || magnitude <= EPS) throw Error('侧壳实际造型方向不能为零。')
  const known = new Set(host.boundaryMm.map(v => v.segmentId))
  if (!Array.isArray(intent.excludedSegmentIds) || new Set(intent.excludedSegmentIds).size !== intent.excludedSegmentIds.length || intent.excludedSegmentIds.some(v => !known.has(v))) throw Error('侧壳排除边须唯一且确实属于宿主。')
  if (intent.requiredExcludedSegmentIds && (!Array.isArray(intent.requiredExcludedSegmentIds) || intent.requiredExcludedSegmentIds.some(v => !known.has(v) || !intent.excludedSegmentIds.includes(v)))) throw Error('已有山路的源崖或入口依赖边必须整段排除侧壳。')
  const excluded = new Set(intent.excludedSegmentIds), divisions = host.boundaryMm.map(() => 1)
  const lengths = host.boundaryMm.map((v, i) => length(v.positionMm, host.boundaryMm[(i + 1) % host.boundaryMm.length].positionMm))
  const orthogonal = isOrthogonalBoundary(host.boundaryMm), lattices = host.boundaryMm.map((_, edge) => sourceLattice(host.boundaryMm, edge))
  // Side width is a lateral physical budget, not the spacing of rock masses.
  // Resolve the height-driven macro field even when the requested foot is wide.
  const sectionSpanMm = Math.max(800, host.groundElevationMm * .8)
  const target = Math.min(ROCK_SHELL_LIMITS.sections, divisions.reduce((n, _, i) => n + (excluded.has(host.boundaryMm[i].segmentId) ? 1
    : Math.min(lattices[i].steps, Math.max(1, Math.ceil(lengths[i] / sectionSpanMm)))), 0))
  while (divisions.reduce((a, b) => a + b, 0) < target) {
    let best = -1, span = -1
    for (let i = 0; i < divisions.length; i++) if (!excluded.has(host.boundaryMm[i].segmentId) && (orthogonal || divisions[i] < lattices[i].steps)
      && lengths[i] / divisions[i] > span) { best = i; span = lengths[i] / divisions[i] }
    if (best < 0) break
    divisions[best]++
  }
  return { host, intent, excluded, divisions, lengths, orthogonal, lattices, direction: { x: intent.direction.x / magnitude || 0, y: intent.direction.y / magnitude || 0 } }
}

/** Conservative complete generation cost, checked before allocating any ID. */
export function estimateRockShellCost(host: RockShellHost, intent: CreateRockShellIntent): number {
  return 1 + prepare(host, intent).divisions.reduce((n, v) => n + v, 0) * 11
}

export function generateRockShell(hostInput: RockShellHost, intentInput: CreateRockShellIntent,
  options: { ids: { nextId(): string }; transactionBudget?: number }): RockShell {
  const { host, intent, excluded, divisions, lengths, direction, orthogonal, lattices } = prepare(hostInput, intentInput)
  const cost = 1 + divisions.reduce((n, v) => n + v, 0) * 11, budget = options.transactionBudget ?? ROCK_SHELL_LIMITS.transactionCost
  if (!Number.isSafeInteger(budget) || budget < 1 || cost > Math.min(budget, ROCK_SHELL_LIMITS.transactionCost)) throw Error('完整侧壳超过本次256事务预算；未分配任何几何ID。')
  const reserved = new Set([host.id, host.floorId, ...host.boundaryMm.flatMap(v => [v.id, v.segmentId])])
  const next = () => { const id = options.ids.nextId(); if (!validId(id) || reserved.has(id)) throw Error('侧壳ID分配器返回重复或保留ID。'); reserved.add(id); return id }
  const shell: RockShell = { algorithmId: 'rock-shell1', algorithmVersion: 1, hostAreaId: host.id,
    sourceBoundaryMm: host.boundaryMm, topElevationMm: host.groundElevationMm, baseElevationMm: host.rockBody.baseElevationMm,
    footSurfaceRef: { kind: 'floor', id: host.floorId }, footElevationMm: 0,
    recipe: { widthMm: intent.widthMm, direction, seed: intent.seed, excludedSegmentIds: [...excluded].sort() },
    verticesMm: {}, faces: {}, sections: [] }
  const nodes = new Map<string, string>(), height = shell.topElevationMm, scale = Math.max(1600, height * 1.8)
  const winding = signedArea(host.boundaryMm.map(v => v.positionMm)) > 0 ? 1 : -1
  const concave = host.boundaryMm.map((v, i) => cross(host.boundaryMm[(i + host.boundaryMm.length - 1) % host.boundaryMm.length].positionMm,
    v.positionMm, host.boundaryMm[(i + 1) % host.boundaryMm.length].positionMm) * winding < 0)
  const joins = orthogonal ? [] : host.boundaryMm.map((_, edge) => cornerJoin(host.boundaryMm, edge))
  const cornerRays = joins.map(join => join.kind === 'vertical' ? join.radial : integerRay(join.radial))
  const vertex = (point: RockShellPoint) => {
    if (![point.x, point.y, point.z].every(coordinate)) throw Error('侧壳外扩节点超过坐标范围。')
    const key = xyzKey(point), existing = nodes.get(key)
    if (existing) return existing
    const id = next(); shell.verticesMm[id] = point; nodes.set(key, id); return id
  }
  for (let edge = 0; edge < host.boundaryMm.length; edge++) {
    const source = host.boundaryMm[edge], end = host.boundaryMm[(edge + 1) % host.boundaryMm.length], normal = segmentNormal(host.boundaryMm, edge)
    const prev = (edge + host.boundaryMm.length - 1) % host.boundaryMm.length, previousNormal = segmentNormal(host.boundaryMm, prev)
    for (let part = 0; part < divisions[edge]; part++) {
      const lattice = lattices[edge], latticeIndex = Math.round(lattice.steps * part / divisions[edge])
      const offsetMm = orthogonal ? Math.round(lengths[edge] * part / divisions[edge]) : lattice.offset(latticeIndex)
      const value = orthogonal ? interpolate(source.positionMm, end.positionMm, offsetMm / lengths[edge]) : lattice.at(latticeIndex)
      const p = { x: Math.round(value.x), y: Math.round(value.y) }
      const atCorner = part === 0, verticalCorner = !orthogonal && atCorner && joins[edge].kind === 'vertical'
      const isExcluded = excluded.has(source.segmentId) || (atCorner && excluded.has(host.boundaryMm[prev].segmentId)) || verticalCorner
      const radial = atCorner ? orthogonal ? (normal.x !== previousNormal.x || normal.y !== previousNormal.y)
        ? { x: normal.x + previousNormal.x, y: normal.y + previousNormal.y } : normal : joins[edge].radial : normal
      // Both adjoining faces own the corner profile. Evaluate its aspect along
      // the unit bisector; retain the unnormalised radial for the actual miter.
      // Using only the outgoing edge gave an east wall a south-facing width.
      const radialSize = Math.hypot(radial.x, radial.y), aspectDot = (radial.x * direction.x + radial.y * direction.y) / radialSize
      const aspectFor = (dot: number) => .24 + .76 * Math.pow(Math.max(0, (dot + 1) / 2), 1.65)
      // A radial miter has one shared width. It must fit both incident side
      // envelopes; a bisector average alone can enlarge the narrow side and
      // close a concave gap. No resampling or clipping can legitimise that.
      const aspect = atCorner ? Math.min(aspectFor(aspectDot), aspectFor(normal.x * direction.x + normal.y * direction.y),
        aspectFor(previousNormal.x * direction.x + previousNormal.y * direction.y)) : aspectFor(aspectDot)
      // At a concave corner the common diagonal partitions the two incident
      // bands. A nearby normal ray must stay in its own half-plane. Higher
      // section density otherwise makes a wide foot cross that diagonal.
      const jointLimit = atCorner || !orthogonal ? Infinity : Math.max(0, Math.min(concave[edge] ? offsetMm - 1 : Infinity,
        concave[(edge + 1) % concave.length] ? lengths[edge] - offsetMm - 1 : Infinity))
      const width = isExcluded ? 0 : Math.max(0, Math.round(Math.min(intent.widthMm, jointLimit,
        intent.widthMm * aspect * (.42 + .8 * field(p, intent.seed, 1, scale)))))
      const shoulder = smooth(.38, .73, field(p, intent.seed, 2, scale * 1.19)) * smooth(.05, .55, aspectDot)
      const talus = smooth(.42, .78, field(p, intent.seed, 3, scale * 1.37)) * smooth(-.2, .45, aspectDot)
      const sw = Math.round(width * .23 * shoulder), kw = Math.round(width * (1 - .34 * talus))
      const sz = Math.round(height * (1 - .16 * shoulder)), kz = Math.round(height * (.19 + .14 * field(p, intent.seed, 4, scale)))
      let point: (w: number, z: number) => RockShellPoint
      if (verticalCorner) point = (_w, z) => ({ x: p.x, y: p.y, z })
      else if (orthogonal) point = (w, z) => ({ x: Math.round(p.x + radial.x * w), y: Math.round(p.y + radial.y * w), z })
      else {
        const ray = atCorner ? cornerRays[edge] : integerRay(normal), normalStep = ray.x * normal.x + ray.y * normal.y
        const previousStep = ray.x * previousNormal.x + ray.y * previousNormal.y
        if (normalStep <= EPS || (atCorner && previousStep <= EPS)) throw Error('一般角整毫米径向无法保持共同外侧。')
        const step = atCorner ? Math.max(normalStep, previousStep) : normalStep
        const sector = atCorner ? Infinity : Math.min(
          concave[edge] ? radialSectorLimit(p, ray, source.positionMm, cornerRays[edge]) : Infinity,
          concave[(edge + 1) % concave.length] ? radialSectorLimit(p, ray, end.positionMm, cornerRays[(edge + 1) % concave.length]) : Infinity)
        const maxSteps = Math.max(0, Math.floor(Math.min(width / step, sector) + EPS))
        point = (w, z) => {
          const steps = Math.min(maxSteps, Math.max(0, Math.floor(w / step + EPS)))
          return { x: p.x + ray.x * steps, y: p.y + ray.y * steps, z }
        }
      }
      shell.sections.push({ id: next(), sourceSegmentId: source.segmentId, offsetMm,
        topVertexId: vertex(point(0, height)), shoulderVertexId: vertex(point(sw, sz)), kneeVertexId: vertex(point(kw, kz)), footVertexId: vertex(point(width, 0)), state: 'managed' })
    }
  }
  for (const face of expectedFaces(shell)) { const id = next(); shell.faces[id] = { id, ...face, state: 'managed' } }
  const issues = inspectRockShell(host, shell)
  if (issues.length) throw Error(issues[0].message)
  return freezeJson(shell)
}

function validateCaptured(host: RockShellHost, shell: RockShell): MultiPolygon {
  if (shell.hostAreaId !== host.id || shell.topElevationMm !== host.groundElevationMm || shell.baseElevationMm !== host.rockBody.baseElevationMm
    || shell.footSurfaceRef.id !== host.floorId || JSON.stringify(shell.sourceBoundaryMm) !== JSON.stringify(host.boundaryMm)) throw Error('侧壳源顶缘、Floor或top/base已改变，不能按同ID假定连续。')
  const directionSize = Math.hypot(shell.recipe.direction.x, shell.recipe.direction.y)
  if (Math.abs(directionSize - 1) > EPS) throw Error('侧壳实际造型方向须保存为有限单位向量。')
  const excluded = new Set(shell.recipe.excludedSegmentIds), known = new Set(host.boundaryMm.map(v => v.segmentId))
  if (excluded.size !== shell.recipe.excludedSegmentIds.length || [...excluded].some(v => !known.has(v))) throw Error('侧壳排除源边无效。')
  const used = new Set<string>(), positions = new Set<string>()
  for (const p of Object.values(shell.verticesMm)) { const key = xyzKey(p); if (positions.has(key)) throw Error('侧壳共享XYZ节点不能重复分配身份。'); positions.add(key) }
  const vertices = Object.values(shell.verticesMm)
  const orthogonal = isOrthogonalBoundary(host.boundaryMm)
  if (Math.max(...vertices.map(v => v.x)) - Math.min(...vertices.map(v => v.x)) > ROCK_SHELL_LIMITS.hostSpanMm
    || Math.max(...vertices.map(v => v.y)) - Math.min(...vertices.map(v => v.y)) > ROCK_SHELL_LIMITS.hostSpanMm) throw Error('侧壳完整外占地跨度超过有限范围。')
  let cursor = 0
  for (let edge = 0; edge < host.boundaryMm.length; edge++) {
    const source = host.boundaryMm[edge], end = host.boundaryMm[(edge + 1) % host.boundaryMm.length], size = length(source.positionMm, end.positionMm)
    const normal = segmentNormal(host.boundaryMm, edge), previous = (edge + host.boundaryMm.length - 1) % host.boundaryMm.length
    const previousNormal = segmentNormal(host.boundaryMm, previous)
    let previousOffset = -1, count = 0
    while (cursor < shell.sections.length && shell.sections[cursor].sourceSegmentId === source.segmentId) {
      const section = shell.sections[cursor++], offset = section.offsetMm
      if ((orthogonal && offset >= size) || offset <= previousOffset || (!count && offset !== 0)) throw Error('侧壳剖面须完整有序覆盖每个原源边，不能缺边、重排或重复。')
      const lattice = sourceLattice(host.boundaryMm, edge), latticeIndex = Math.round(offset / size * lattice.steps)
      if (!orthogonal && (latticeIndex < 0 || latticeIndex >= lattice.steps || lattice.offset(latticeIndex) !== offset)) throw Error('斜边剖面须保存原顶缘的确切整数格点及真实沿边距离。')
      const value = orthogonal ? interpolate(source.positionMm, end.positionMm, offset / size) : lattice.at(latticeIndex)
      const expectedTop = { x: Math.round(value.x), y: Math.round(value.y) }
      const ids = sectionVertices(section), [top, shoulder, knee, foot] = ids.map(v => shell.verticesMm[v])
      ids.forEach(v => used.add(v))
      if (!samePoint(top, expectedTop) || top.z !== shell.topElevationMm || foot.z !== 0 || shoulder.z > top.z || knee.z > shoulder.z || knee.z < 0) throw Error('侧壳不得移动真实顶面，且剖面高度须从顶缘单调落到零高脚面。')
      const dx = foot.x - top.x, dy = foot.y - top.y, square = dx * dx + dy * dy, isExcluded = excluded.has(source.segmentId) || (!count && excluded.has(host.boundaryMm[previous].segmentId))
      const verticalCorner = !orthogonal && !count && cornerJoin(host.boundaryMm, edge).kind === 'vertical'
      if ((isExcluded || verticalCorner) && ids.some(v => !samePoint(shell.verticesMm[v], top))) throw Error('山路源崖/入口排除边及超miter共享转角必须保持真实竖直。')
      const normalDistance = dx * normal.x + dy * normal.y, previousDistance = dx * previousNormal.x + dy * previousNormal.y
      if ((orthogonal ? Math.abs(dx) > shell.recipe.widthMm || Math.abs(dy) > shell.recipe.widthMm
        : normalDistance > shell.recipe.widthMm + EPS || (!count && previousDistance > shell.recipe.widthMm + EPS) || Math.hypot(dx, dy) > shell.recipe.widthMm * 2 + EPS)
        || normalDistance < -EPS
        || (!count && dx * previousNormal.x + dy * previousNormal.y < -EPS)) throw Error('侧壳脚线必须在有限实际外侧，不能向真实顶面内折。')
      let previousDot = 0
      for (const p of [shoulder, knee, foot]) {
        const dot = (p.x - top.x) * dx + (p.y - top.y) * dy
        if (Math.abs(cross(top, foot, p)) > EPS || dot < previousDot - EPS || dot > square + EPS || (!square && !samePoint(p, top))) throw Error('侧壳必须是共享径向单值剖面，不能形成悬挑或折返。')
        previousDot = dot
      }
      previousOffset = offset; count++
    }
    if (!count) throw Error('侧壳缺少原顶缘边的完整剖面。')
  }
  if (cursor !== shell.sections.length || used.size !== Object.keys(shell.verticesMm).length) throw Error('侧壳包含孤立剖面或未引用节点。')
  const expected = expectedFaces(shell), byKey = new Map(expected.map(v => [v.vertexIds.slice().sort().join('|'), v]))
  if (expected.length !== Object.keys(shell.faces).length || byKey.size !== expected.length) throw Error('侧壳三角面缺失或退化重复。')
  const topDomain = polygon(host.boundaryMm.map(v => v.positionMm)), projected: MultiPolygon[] = []
  for (const face of Object.values(shell.faces)) {
    const key = face.vertexIds.slice().sort().join('|'), row = byKey.get(key)
    if (!row || row.sourceSegmentId !== face.sourceSegmentId || row.zone !== face.zone || row.sectionIds.some((v, i) => v !== face.sectionIds[i])) throw Error('侧壳实际三角面必须精确覆盖所属剖面、源边和区域。')
    const turn = row.vertexIds.indexOf(face.vertexIds[0])
    if (face.vertexIds.some((v, i) => v !== row.vertexIds[(turn + i) % 3])) throw Error('侧壳实际三角面朝向被反转。')
    byKey.delete(key)
    const points = face.vertexIds.map(v => shell.verticesMm[v]), normal = faceNormal(points)
    if (normal.magnitude <= EPS || normal.z < -EPS) throw Error('侧壳面不能退化或向下翻折。')
    if (Math.abs(cross(points[0], points[1], points[2])) <= EPS) continue
    const domain = polygon(points)
    if (area(polygonClipping.intersection(topDomain, domain)) > EPS) throw Error('侧壳真实大面侵入原可走顶面。')
    for (const previous of projected) if (area(polygonClipping.intersection(previous, domain)) > EPS) throw Error('侧壳凹处自交/面重叠，首片明确拒绝。')
    projected.push(domain)
  }
  const footprint = union([topDomain, ...projected])
  if (footprint.length !== 1 || footprint[0].length !== 1) throw Error('侧壳首片不能形成孤岛或有洞外占地。')
  return footprint
}

export function inspectRockShell(hostInput: RockShellHost, shellInput: RockShell): RockShellIssue[] {
  try { validateCaptured(captureHost(hostInput), rockShellSchema.parse(shellInput)); return [] }
  catch (error) { return [{ code: 'INVALID_ROCK_SHELL', message: error instanceof Error ? error.message : '实际侧壳校验失败。' }] }
}

function captureShell(shellInput: RockShell) {
  const shell = rockShellSchema.parse(shellInput)
  const host = captureHost({ id: shell.hostAreaId, floorId: shell.footSurfaceRef.id, boundaryMm: shell.sourceBoundaryMm,
    groundElevationMm: shell.topElevationMm, rockBody: { baseElevationMm: shell.baseElevationMm } })
  const physicalFootprintMm = validateCaptured(host, shell)
  return { shell: freezeJson(shell), physicalFootprintMm: freezeJson(physicalFootprintMm) }
}

/** Captures once. No mutable global cache or caller-owned authority. */
export function createRockShellSampler(shellInput: RockShell) {
  const { shell, physicalFootprintMm } = captureShell(shellInput)
  const triangles: RockShellTriangle[] = Object.values(shell.faces).sort((a, b) => a.id.localeCompare(b.id)).map(face => ({ faceId: face.id, sourceSegmentId: face.sourceSegmentId,
    verticesMm: face.vertexIds.map(v => shell.verticesMm[v]) as [RockShellPoint, RockShellPoint, RockShellPoint] }))
  const sample = (point: PointMm): RockShellSample | null => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
    for (const triangle of triangles) {
      const [a, b, c] = triangle.verticesMm, determinant = cross(a, b, c)
      if (determinant <= EPS) continue
      const wa = cross(point, b, c) / determinant, wb = cross(a, point, c) / determinant, wc = 1 - wa - wb
      if (wa < -1e-8 || wb < -1e-8 || wc < -1e-8) continue
      const { x, y, z } = faceNormal(triangle.verticesMm)
      return { inside: true, hostAreaId: shell.hostAreaId, faceId: triangle.faceId, sourceSegmentId: triangle.sourceSegmentId,
        zMm: wa * a.z + wb * b.z + wc * c.z, normal: { x, y, z }, walkable: false }
    }
    return null
  }
  return Object.freeze({ shell, physicalFootprintMm, triangles: freezeJson(triangles), sample })
}

export function sampleRockShell(shell: RockShell, point: PointMm): RockShellSample | null { return createRockShellSampler(shell).sample(point) }
export function rockShellPhysicalFootprint(host: RockShellHost, shell: RockShell): MultiPolygon {
  return freezeJson(validateCaptured(captureHost(host), rockShellSchema.parse(shell)))
}
