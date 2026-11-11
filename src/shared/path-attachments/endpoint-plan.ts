import { z } from 'zod'
import type { Path, PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { resolveBuildingStructurePort, type BuildingStructurePort } from '../generation/building-port.js'
import { checkTerrainRoute, TERRAIN_ROUTE_LIMITS } from '../geometry/terrain-travel.js'
import { pathPolygon, polygonDistance, propFootprint, terrainPoints } from '../geometry/geometry.js'
import { wallMovementPolygons } from '../geometry/doorway-clearance.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { canonicalJson, captureJson, cloneJson as clone, encodeUtf8 } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateSceneDocument } from '../validation/scene.js'
import { id, nonnegative, positive } from '../validation/primitives.js'
import { MANUAL_TRANSACTION_BUDGET, assertCommandBudget } from '../budget/command-budget.js'
import { emptyBudgetUsage } from '../budget/task-budget.js'
import { pathAttachmentAnchorSchema as anchorSchema, type PathAttachmentAnchorWitness } from './contracts.js'
export type { PathAttachmentAnchorWitness } from './contracts.js'

const hash = (value: unknown) => sha256Text(canonicalJson(value))
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
interface RequestBase {
  pathId: string; openingId: string; end: 'start' | 'end'
  leadLengthMm: number; maxDisplacementMm: number
}
export type PathAttachmentEndpointRequest = RequestBase & (
  | { mode: 'bind'; before?: never }
  | { mode: 'follow'; before: { scene: SceneDocument; anchor: PathAttachmentAnchorWitness } }
)
export interface PathAttachmentEndpointPlan {
  centerlineMm: PointMm[]
  supportRefs: SurfaceRef[]
  port: BuildingStructurePort
  preservedTail: { pointsMm: PointMm[]; hash: string; count: number }
  anchor: PathAttachmentAnchorWitness
  dependencyIds: string[]
}
const base = { pathId: id, openingId: id, end: z.enum(['start', 'end']), leadLengthMm: positive, maxDisplacementMm: nonnegative }
const requestSchema = z.discriminatedUnion('mode', [
  z.object({ ...base, mode: z.literal('bind') }).strict(),
  z.object({ ...base, mode: z.literal('follow'), before: z.object({ scene: z.unknown(), anchor: anchorSchema }).strict() }).strict(),
])
const oriented = (path: Path, end: 'start' | 'end') => end === 'start' ? clone(path.centerlineMm) : clone(path.centerlineMm).reverse()
function cardinal(port: BuildingStructurePort): PointMm {
  return { x: Math.sign(port.outsideMm.x - port.positionMm.x), y: Math.sign(port.outsideMm.y - port.positionMm.y) }
}
function leadPoint(port: BuildingStructurePort, length: number): PointMm {
  const direction = cardinal(port), result = { x: port.outsideMm.x + direction.x * length, y: port.outsideMm.y + direction.y * length }
  if (![result.x, result.y].every(Number.isSafeInteger)) throw new Error('门前法向引导点超出安全整数毫米范围。')
  return result
}
function ringIdentity(ids: string[]): string[] {
  const first = ids.reduce((best, value, index) => value < ids[best] ? index : best, 0)
  return [...ids.slice(first), ...ids.slice(0, first)]
}
function witness(scene: SceneDocument, path: Path, openingId: string, end: 'start' | 'end', port: BuildingStructurePort, leadLengthMm: number): PathAttachmentAnchorWitness {
  const opening = scene.openings[openingId], wall = scene.walls[opening.wallId], tail = oriented(path, end).slice(2)
  return anchorSchema.parse({ version: 1, pathId: path.id, openingId, end, wallId: wall.id, wallVertexIds: [wall.startVertexId, wall.endVertexId], referenceVertexId: opening.offsetReferenceVertexId,
    roomId: port.roomId, roomBoundaryVertexIds: ringIdentity(scene.rooms[port.roomId].boundaryVertexIds), outwardNormal: cardinal(port), port: clone(port), leadLengthMm,
    centerlineHash: hash(path.centerlineMm), pointCount: path.centerlineMm.length, supportRefsHash: hash(path.supportRefs), preservedTailHash: hash(tail), preservedTailCount: tail.length })
}
function displacement(before: PointMm, after: PointMm, maximumMm: number): void {
  const x = BigInt(after.x) - BigInt(before.x), y = BigInt(after.y) - BigInt(before.y)
  if (x * x + y * y > BigInt(maximumMm) ** 2n) throw new Error('门前接续超过明确的有限位移范围，未采用道路候选。')
}
function checkedScene(input: unknown): SceneDocument {
  const result = validateSceneDocument(input)
  if (!result.ok) throw new Error(`端点接续须来自合法完整场景：${result.errors.map(issue => issue.message).join('；')}`)
  return result.document
}
function checkedPath(scene: SceneDocument, pathId: string, port: BuildingStructurePort): Path {
  const path = scene.paths[pathId], visible = createPublicVisibility(scene)
  if (!path || !visible.path(pathId) || path.floorId !== port.floorId) throw new Error('端点接续只支持与公开真实门口同Floor的公开道路。')
  if (!path.supportRefs.some(ref => ref.kind === 'terrainArea' && ref.id === port.supportRef.id)
    || path.supportRefs.some(ref => ref.kind !== 'terrainArea' || !visible.terrainArea(ref.id) || scene.terrainAreas[ref.id].floorId !== path.floorId
      || scene.terrainAreas[ref.id].groundElevationMm !== port.elevationMm || scene.terrainAreas[ref.id].blocksMovement)) throw new Error('端点接续须保留与门口相容的同高程公开真实地形支撑，不能暗改支撑。')
  return path
}

/** Finite exterior endpoint proposal only. A bind replaces one selected end
 * with outside+lead; a follow replaces its two managed points. Every remaining
 * point is preserved in order. No search, door-state mutation or Scene write
 * occurs; the owner still checks identity/locks and adopts one full transaction. */
export function planPathAttachmentEndpoint(inputScene: SceneDocument, input: PathAttachmentEndpointRequest): PathAttachmentEndpointPlan {
  const parsed = requestSchema.safeParse(captureJson(input))
  if (!parsed.success) throw new Error(`端点接续参数无效：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  const request = parsed.data, scene = checkedScene(inputScene), rawPath = scene.paths[request.pathId]
  if (!rawPath) throw new Error('端点接续所选道路不存在。')
  const port = resolveBuildingStructurePort(scene, request.openingId, rawPath.widthMm), path = checkedPath(scene, request.pathId, port), points = oriented(path, request.end)
  if (points.length + (request.mode === 'bind' ? 1 : 0) > TERRAIN_ROUTE_LIMITS.points || request.mode === 'follow' && points.length < 3) throw new Error('有限端点接续须保留至少一个经由点，完整路线不得超过128点。')
  const lead = leadPoint(port, request.leadLengthMm), dependencies = new Set<string>([path.id]), dependencyScenes = [scene]
  const includePort = (document: SceneDocument, value: BuildingStructurePort) => {
    const opening = document.openings[value.openingId], wall = document.walls[opening.wallId], room = document.rooms[value.roomId]
    for (const id of [opening.id, wall.id, wall.startVertexId, wall.endVertexId, room.id, ...room.boundaryVertexIds, value.supportRef.id, value.floorId]) dependencies.add(id)
  }
  includePort(scene, port)
  if (request.mode === 'follow') {
    const before = checkedScene(request.before.scene), oldPath = before.paths[request.pathId], anchor = request.before.anchor
    dependencyScenes.push(before)
    if (!oldPath || before.sceneId !== scene.sceneId || anchor.pathId !== request.pathId || anchor.openingId !== request.openingId || anchor.end !== request.end) throw new Error('接续几何基线或附着端不一致，不能按同ID重连。')
    const oldPort = resolveBuildingStructurePort(before, request.openingId, oldPath.widthMm)
    checkedPath(before, request.pathId, oldPort); includePort(before, oldPort)
    const oldPoints = oriented(oldPath, request.end)
    if (!same(anchor, witness(before, oldPath, request.openingId, request.end, oldPort, anchor.leadLengthMm))
      || !same(oldPoints[0], oldPort.outsideMm) || !same(oldPoints[1], leadPoint(oldPort, anchor.leadLengthMm))) throw new Error('门前接续见证与真实旧路线/端口不一致；不能用JSON见证充当身份或覆盖人工修改。')
    if (!same(path.centerlineMm, oldPath.centerlineMm) || !same(path.supportRefs, oldPath.supportRefs)) throw new Error('道路顺序、人工经由点或支撑已改变，请明确重新绑定；不能倒序猜测附着端。')
    const opening = scene.openings[request.openingId], wall = scene.walls[opening.wallId]
    if (opening.wallId !== anchor.wallId || opening.offsetReferenceVertexId !== anchor.referenceVertexId || port.roomId !== anchor.roomId
      || !same([wall.startVertexId, wall.endVertexId], anchor.wallVertexIds) || !same(ringIdentity(scene.rooms[port.roomId].boundaryVertexIds), anchor.roomBoundaryVertexIds)
      || !same(cardinal(port), anchor.outwardNormal) || !same(port.supportRef, anchor.port.supportRef) || port.elevationMm !== anchor.port.elevationMm) throw new Error('门口墙/房间拓扑、支撑、高程或外法向已改变；本期只支持连续的正交单端接续。')
    displacement(oldPoints[0], port.outsideMm, request.maxDisplacementMm)
    displacement(oldPoints[1], lead, request.maxDisplacementMm)
  } else displacement(points[0], port.outsideMm, request.maxDisplacementMm)
  const tail = points.slice(request.mode === 'bind' ? 1 : 2), nextOriented = [clone(port.outsideMm), lead, ...tail]
  const centerlineMm = request.end === 'start' ? nextOriented : [...nextOriented].reverse()
  const band = pathPolygon({ ...path, centerlineMm }), retainedSegments = Object.values(scene.terrainAreas).filter(area => area.floorId === path.floorId).reduce((sum, area) => sum + area.boundaryMm.length, 0)
    + Object.values(scene.regions).filter(region => region.floorId === path.floorId).reduce((sum, region) => sum + region.boundaryMm.length, 0)
    + Object.values(scene.walls).filter(wall => wall.floorId === path.floorId).length * 4 + Object.values(scene.props).filter(prop => prop.floorId === path.floorId && prop.blocksMovement).length * 4
  const work = emptyBudgetUsage()
  work.semanticTargets = 1; work.geometryPoints = points.length + centerlineMm.length + band.length + tail.length + 3
  work.geometrySegments = points.length + centerlineMm.length + band.length; work.intersectionPairs = (retainedSegments + band.length) ** 2
  assertCommandBudget(MANUAL_TRANSACTION_BUDGET, work)
  const route = checkTerrainRoute(scene, { floorId: path.floorId, pointsMm: centerlineMm, widthMm: path.widthMm })
  if (!route.ok) throw new Error(`门前完整室外道路带区不合法：${route.issues.map(issue => issue.message).join('；')}`)
  const declared = new Set(path.supportRefs.map(ref => `${ref.kind}:${ref.id}`))
  if (route.supportRefs.some(ref => !declared.has(`${ref.kind}:${ref.id}`))) throw new Error('有限接续需要新的支撑面，未改写道路原支撑。')
  for (const ref of path.supportRefs) dependencies.add(ref.id)
  for (const area of Object.values(scene.terrainAreas)) if (area.floorId === path.floorId && polygonDistance(band, terrainPoints(area)) < 1e-7) dependencies.add(area.id)
  for (const prop of Object.values(scene.props)) if (prop.floorId === path.floorId && prop.blocksMovement && polygonDistance(band, propFootprint(prop)) < 1e-7) dependencies.add(prop.id)
  for (const region of Object.values(scene.regions)) if (region.floorId === path.floorId && region.blocksMovement && polygonDistance(band, region.boundaryMm) < 1e-7) dependencies.add(region.id)
  for (const wall of wallMovementPolygons(scene, true)) if (wall.floorId === path.floorId && polygonDistance(band, wall.polygon) < 1e-7) dependencies.add(wall.entityId)
  let changed = true
  while (changed) {
    changed = false
    const add = (id: string) => { if (!dependencies.has(id)) { dependencies.add(id); changed = true } }
    for (const document of dependencyScenes) {
      for (const group of Object.values(document.scatterGroups)) if (group.domain.kind === 'path' && group.domain.pathId === path.id || Object.values(group.members).some(member => member.propId !== null && dependencies.has(member.propId))) {
        add(group.id); for (const member of Object.values(group.members)) if (member.propId !== null) add(member.propId)
      }
      for (const group of Object.values(document.prefabInstances)) if (Object.values(group.members).some(member => member.propId !== null && dependencies.has(member.propId))) add(group.id)
      for (const note of Object.values(document.notes)) if (note.anchor.type === 'entity' && dependencies.has(note.anchor.entityId)) add(note.id)
    }
  }
  for (const document of dependencyScenes) for (const entityId of [...dependencies]) if (document.entityLayers[entityId]) dependencies.add(document.entityLayers[entityId])
  const nextPath = { ...path, centerlineMm }, anchor = witness(scene, nextPath, request.openingId, request.end, port, request.leadLengthMm)
  work.dependencyRefs = dependencies.size; work.metadataRecords = 2; work.metadataBytes = encodeUtf8(canonicalJson(anchor)).length + encodeUtf8(canonicalJson(tail)).length
  assertCommandBudget(MANUAL_TRANSACTION_BUDGET, work)
  return { centerlineMm: clone(centerlineMm), supportRefs: clone(path.supportRefs), port: clone(port), preservedTail: { pointsMm: clone(tail), hash: hash(tail), count: tail.length }, anchor, dependencyIds: [...dependencies].sort() }
}
