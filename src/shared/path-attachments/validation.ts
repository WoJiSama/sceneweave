import type { Issue, Path, SceneDocument } from '../model/scene.js'
import type { HistoryIdentity } from '../model/history.js'
import { pathAttachmentAnchorSchema, pathAttachmentRecordSchema, type PathAttachment, type PathAttachmentAnchorWitness } from './contracts.js'
import { resolveBuildingStructurePortGeometry } from '../generation/building-port.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { structureIdentityDescriptors } from '../history/structure-identity.js'
import { canonicalJson, captureJson, cloneJson as clone } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'

export type AttachmentScene = SceneDocument & { pathAttachments?: Record<string, PathAttachment> }
type Token = { kind: string; token: string; topologyToken: string; topologyHash: string }
const hash = (value: unknown) => sha256Text(canonicalJson(value))
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const orient = (path: Path, end: 'start' | 'end') => end === 'start' ? clone(path.centerlineMm) : clone(path.centerlineMm).reverse()
const ringIdentity = (ids: string[]) => {
  const first = ids.reduce((best, value, index) => value < ids[best] ? index : best, 0)
  return [...ids.slice(first), ...ids.slice(0, first)]
}

/** Private disposable calculation view. It is never returned as a project,
 * saved, exported, certified or used to bypass validation of any other field.
 * Original relation records are independently checked in full below. */
function geometryView(scene: AttachmentScene): SceneDocument {
  const owned = captureJson(scene)
  delete owned.pathAttachments
  return owned
}
export function records(scene: AttachmentScene): Record<string, PathAttachment> {
  return pathAttachmentRecordSchema.parse(captureJson(scene.pathAttachments ?? {}))
}
function actualAnchor(view: SceneDocument, row: PathAttachment): PathAttachmentAnchorWitness {
  const path = view.paths[row.pathId]
  if (!path) throw new Error('附着道路已不存在；请先明确解除关系。')
  const port = resolveBuildingStructurePortGeometry(view, row.openingId, path.widthMm), visible = createPublicVisibility(view)
  if (!visible.path(path.id) || path.floorId !== row.floorId || port.floorId !== row.floorId) throw new Error('门路附着只支持同Floor公开道路与真实公开外门。')
  if (!path.supportRefs.some(ref => ref.kind === 'terrainArea' && ref.id === port.supportRef.id)
    || path.supportRefs.some(ref => ref.kind !== 'terrainArea' || !visible.terrainArea(ref.id) || view.terrainAreas[ref.id].floorId !== path.floorId
      || view.terrainAreas[ref.id].groundElevationMm !== port.elevationMm || view.terrainAreas[ref.id].blocksMovement)) throw new Error('门路附着支撑不再是相容的同高程公开地形，不能隐式换支撑。')
  const points = orient(path, row.end), outwardNormal = { x: Math.sign(port.outsideMm.x - port.positionMm.x), y: Math.sign(port.outsideMm.y - port.positionMm.y) }
  const lead = { x: port.outsideMm.x + outwardNormal.x * row.leadLengthMm, y: port.outsideMm.y + outwardNormal.y * row.leadLengthMm }
  if (points.length < 3 || points.length > 128 || !same(points[0], port.outsideMm) || !same(points[1], lead)) throw new Error('门路附着的两个受管端点与真实结构门口/法向引导点不一致。')
  const opening = view.openings[row.openingId], wall = view.walls[opening.wallId], tail = points.slice(2)
  return pathAttachmentAnchorSchema.parse({ version: 1, pathId: path.id, openingId: opening.id, end: row.end, wallId: wall.id, wallVertexIds: [wall.startVertexId, wall.endVertexId],
    referenceVertexId: opening.offsetReferenceVertexId, roomId: port.roomId, roomBoundaryVertexIds: ringIdentity(view.rooms[port.roomId].boundaryVertexIds), outwardNormal,
    port: clone(port), leadLengthMm: row.leadLengthMm, centerlineHash: hash(path.centerlineMm), pointCount: path.centerlineMm.length,
    supportRefsHash: hash(path.supportRefs), preservedTailHash: hash(tail), preservedTailCount: tail.length })
}

/** Cold geometry invariants only: props/regions can later obstruct current
 * travel without deleting a structurally valid persisted relationship. */
export function validatePathAttachmentGeometry(scene: AttachmentScene): Issue[] {
  const errors: Issue[] = []
  let rows: Record<string, PathAttachment>
  try { rows = records(scene) } catch (error) { return [{ code: 'PATH_ATTACHMENT_SHAPE', message: message(error) }] }
  if (!Object.keys(rows).length) return errors
  let view: SceneDocument
  try { view = geometryView(scene) } catch (error) { return [{ code: 'PATH_ATTACHMENT_GEOMETRY', message: message(error) }] }
  const occupied = geometryIdentityIds(view), paths = new Set<string>()
  for (const value of Object.keys(view.userLayers)) occupied.add(value)
  for (const [key, row] of Object.entries(rows)) try {
    if (key !== row.id || occupied.has(row.id)) throw new Error('附着关系ID须与记录key相同且不得占用其他实体/内嵌/图层身份。')
    if (paths.has(row.pathId)) throw new Error('首版每条道路只允许一个明确端点附着。')
    paths.add(row.pathId)
    if (scene.entityLayers[row.id] !== undefined) throw new Error('附着关系不是独立图层实体，编辑范围继承道路实际图层。')
    if (!same(actualAnchor(view, row), row.anchor)) throw new Error('附着anchor的完整路线、保留tail、支撑或真实端口几何不一致。')
  } catch (error) { errors.push({ code: 'PATH_ATTACHMENT_GEOMETRY', message: message(error), entityId: row.id }) }
  return errors
}

function tokens(identity: HistoryIdentity): Record<string, Token> | undefined {
  return identity.structureTokens
}
export function readProofs(scene: AttachmentScene, identity: HistoryIdentity, row: Pick<PathAttachment, 'pathId' | 'openingId' | 'anchor'>): PathAttachment['proofs'] {
  if (!identity.structureTokens) throw new Error('建筑尚无持久出生/拓扑证明，请先明确建立当前结构身份，再绑定门路。')
  const path = scene.paths[row.pathId], opening = scene.openings[row.openingId]
  if (!path || !opening) throw new Error('门路附着来源对象已不存在。')
  const descriptors = structureIdentityDescriptors(scene), pool = tokens(identity)!
  const structural = (entityId: string, kind: string) => {
    const record = pool[entityId], descriptor = descriptors[entityId]
    if (!record || !descriptor || record.kind !== kind || record.topologyHash !== descriptor.topologyHash || !record.token || !record.topologyToken) throw new Error(`附着来源缺少真实当前出生/拓扑证明：${entityId}。`)
    return { birthToken: record.token, topologyToken: record.topologyToken }
  }
  const pathToken = identity.outdoorTokens[path.id], pathTopologyHash = hash([path.floorId, path.supportRefs])
  if (!pathToken || pathToken.kind !== 'path' || pathToken.topologyHash !== pathTopologyHash || !pathToken.token || !pathToken.topologyToken) throw new Error('附着道路缺少真实当前出生/拓扑证明。')
  return { lineageId: identity.lineageId, path: { birthToken: pathToken.token, topologyToken: pathToken.topologyToken },
    opening: structural(opening.id, 'opening'), wall: structural(opening.wallId, 'wall'), room: structural(row.anchor.roomId, 'room') }
}

/** Compare persisted claims with the real current identity pool. Geometry JSON,
 * a generation owner or a matching object ID cannot manufacture these tokens. */
export function validatePathAttachmentProofs(scene: AttachmentScene, identity: HistoryIdentity): Issue[] {
  const errors = validatePathAttachmentGeometry(scene)
  if (errors.length) return errors
  const rows = records(scene), pool = tokens(identity), descriptors = structureIdentityDescriptors(scene)
  for (const row of Object.values(rows)) try {
    if (!same(readProofs(scene, identity, row), row.proofs)) throw new Error('附着来源lineage或真实出生/拓扑token已变化，不能按同ID重连。')
    const record = pool?.[row.id], descriptor = descriptors[row.id]
    if (!record || record.kind !== 'pathAttachment' || !descriptor || record.topologyHash !== descriptor.topologyHash || !record.token || !record.topologyToken) throw new Error('附着关系自身缺少真实出生/拓扑证明。')
  } catch (error) { errors.push({ code: 'PATH_ATTACHMENT_PROOF', message: message(error), entityId: row.id }) }
  return errors
}

