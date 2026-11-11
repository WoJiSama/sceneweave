import { z } from 'zod'
import type { Issue, Path, SceneDocument } from '../model/scene.js'
import type { CompositionContent } from '../model/appearance.js'
import type { HistoryIdentity } from '../model/history.js'
import { pathAttachmentSchema, type PathAttachment } from './contracts.js'
import { planPathAttachmentEndpoint } from './endpoint-plan.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../model/scene.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../validation/json.js'
import { pathPolygon } from '../geometry/geometry.js'
import { id, nonnegative, positive } from '../validation/primitives.js'
import { MANUAL_TRANSACTION_BUDGET, assertCommandBudget } from '../budget/command-budget.js'
import { emptyBudgetUsage } from '../budget/task-budget.js'

import { records, readProofs, validatePathAttachmentGeometry, validatePathAttachmentProofs, type AttachmentScene } from './validation.js'
export { validatePathAttachmentGeometry, validatePathAttachmentProofs } from './validation.js'
export type { AttachmentScene } from './validation.js'
const clone = <T>(value: T): T => structuredClone(value)
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const ringIdentity = (ids: string[]) => {
  const first = ids.reduce((best, value, index) => value < ids[best] ? index : best, 0)
  return [...ids.slice(first), ...ids.slice(0, first)]
}
/** Disposable calculation view only, never published or certified. */
function geometryView(scene: AttachmentScene): SceneDocument {
  const owned = captureJson(scene)
  delete owned.pathAttachments
  return owned
}

function dependencyIds(scene: AttachmentScene, row: PathAttachment): string[] {
  const ids = new Set([row.id, row.pathId, row.openingId, row.anchor.wallId, row.anchor.roomId, ...row.anchor.wallVertexIds, ...row.anchor.roomBoundaryVertexIds,
    ...(scene.paths[row.pathId]?.supportRefs.map(ref => ref.id) ?? [])])
  let changed = true
  while (changed) {
    changed = false
    for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && ids.has(note.anchor.entityId) && !ids.has(note.id)) { ids.add(note.id); changed = true }
    for (const group of Object.values(scene.aggregateCoordinates?.groups ?? {})) if (group.members.some(member => ids.has(member.id)) && !ids.has(group.id)) { ids.add(group.id); changed = true }
  }
  for (const entityId of [...ids]) if (scene.entityLayers[entityId]) ids.add(scene.entityLayers[entityId])
  return [...ids].sort()
}
function assertLocks(scene: AttachmentScene, row: PathAttachment, ids: readonly string[]): void {
  if (row.editLocked) throw new Error(`门路附着关系已锁定：${row.id}。`)
  const entities = new Map<string, { editLocked: boolean }>()
  for (const collection of [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS]) for (const value of Object.values(scene[collection] ?? {})) entities.set(value.id, value)
  for (const group of Object.values(scene.aggregateCoordinates?.groups ?? {})) entities.set(group.id, group)
  for (const entityId of ids) if (entities.get(entityId)?.editLocked || scene.userLayers[entityId]?.editLocked || scene.userLayers[scene.entityLayers[entityId]]?.editLocked) throw new Error(`门路附着涉及锁定实体、道路图层或真实依赖：${entityId}。`)
}
function assertErrors(errors: Issue[]): void {
  if (errors.length) throw new Error(errors.map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message}`).join('；'))
}
const createRequest = z.object({ id, pathId: id, openingId: id, end: z.enum(['start', 'end']), leadLengthMm: positive, maxDisplacementMm: nonnegative }).strict()
export type CreatePathAttachmentRequest = z.infer<typeof createRequest>
export function createPathAttachmentPlan(content: Pick<CompositionContent, 'document' | 'historyIdentity'>, input: CreatePathAttachmentRequest): { path: Path; attachment: PathAttachment; dependencyIds: string[] } {
  const request = createRequest.parse(captureJson(input)), scene = content.document as AttachmentScene, identity = captureJson(content.historyIdentity)
  assertErrors(validatePathAttachmentGeometry(scene)); assertErrors(validatePathAttachmentProofs(scene, identity))
  const existing = records(scene), occupied = geometryIdentityIds(scene)
  if (occupied.has(request.id) || Object.hasOwn(scene.userLayers, request.id) || Object.values(identity).some(value => value && typeof value === 'object' && Object.hasOwn(value, request.id))) throw new Error('新附着ID已占用或曾分配，不能复用退休身份。')
  if (Object.values(existing).some(row => row.pathId === request.pathId)) throw new Error('首版每条道路只允许一个附着，请先明确解除现有关系。')
  const { id: _attachmentId, ...endpointRequest } = request
  const view = geometryView(scene), plan = planPathAttachmentEndpoint(view, { ...endpointRequest, mode: 'bind' })
  const path = { ...clone(view.paths[request.pathId]), centerlineMm: clone(plan.centerlineMm), supportRefs: clone(plan.supportRefs) }
  const attachment: PathAttachment = { id: request.id, version: 1, floorId: path.floorId, pathId: path.id, openingId: request.openingId, end: request.end,
    leadLengthMm: request.leadLengthMm, maxDisplacementMm: request.maxDisplacementMm, editLocked: false, anchor: clone(plan.anchor),
    proofs: readProofs(scene, identity, { pathId: path.id, openingId: request.openingId, anchor: plan.anchor }) }
  const deps = [...new Set([...plan.dependencyIds, ...dependencyIds({ ...scene, paths: { ...scene.paths, [path.id]: path } }, attachment)])].sort()
  assertLocks(scene, attachment, deps)
  return { path, attachment: pathAttachmentSchema.parse(attachment), dependencyIds: deps }
}

function geometrySignature(scene: AttachmentScene, row: PathAttachment): string {
  const path = scene.paths[row.pathId], opening = scene.openings[row.openingId], wall = opening && scene.walls[opening.wallId], room = scene.rooms[row.anchor.roomId]
  return canonicalJson({ path: path ? { floorId: path.floorId, centerlineMm: path.centerlineMm, widthMm: path.widthMm, supportRefs: path.supportRefs, visibility: path.visibility } : null,
    opening: opening ? { floorId: opening.floorId, wallId: opening.wallId, offsetReferenceVertexId: opening.offsetReferenceVertexId, offsetMm: opening.offsetMm, widthMm: opening.widthMm, kind: opening.kind, secret: opening.secret, revealed: opening.revealed } : null,
    wall: wall ? { floorId: wall.floorId, startVertexId: wall.startVertexId, endVertexId: wall.endVertexId, thicknessMm: wall.thicknessMm } : null,
    room: room ? { floorId: room.floorId, boundaryVertexIds: ringIdentity(room.boundaryVertexIds), supportRef: room.supportRef, groundElevationMm: room.groundElevationMm, visibility: room.visibility } : null,
    vertices: [...new Set([...(wall ? [wall.startVertexId, wall.endVertexId] : []), ...(room?.boundaryVertexIds ?? [])])].map(id => {
      const vertex = scene.vertices[id]; return vertex ? [id, vertex.xMm, vertex.yMm] : [id, null]
    }), supports: (path?.supportRefs ?? []).map(ref => {
      const area = ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id] : undefined
      return area ? [ref, area.floorId, area.groundElevationMm, area.visibility, area.blocksMovement, area.coveragePriority, area.boundaryMm] : [ref, null]
    }) })
}

/** Internal atomic-command step: primary/input lifecycle -> finite follow ->
 * native derived lifecycle -> identity observer. Only this owned clone is written. */
export function followPathAttachments(beforeInput: AttachmentScene, afterInput: AttachmentScene): { document: AttachmentScene; dependencyIds: string[] } {
  const before = captureJson(beforeInput), after = captureJson(afterInput), prior = records(before), rows = records(after), dependencies = new Set<string>()
  const execution = emptyBudgetUsage()
  assertErrors(validatePathAttachmentGeometry(before))
  for (const [attachmentId, row] of Object.entries(rows)) {
    const previous = prior[attachmentId]
    if (!previous) continue
    if (!same({ ...previous, editLocked: false }, { ...row, editLocked: false })) throw new Error('既有附着记录只能由受控接续更新；修改关系策略/anchor/proof须先明确解除。')
    if (geometrySignature(before, previous) === geometrySignature(after, row)) continue
    const initialDeps = [...new Set([...dependencyIds(before, previous), ...dependencyIds(after, row)])]
    assertLocks(before, previous, initialDeps); assertLocks(after, row, initialDeps)
    const plan = planPathAttachmentEndpoint(geometryView(after), { pathId: row.pathId, openingId: row.openingId, end: row.end, mode: 'follow', leadLengthMm: row.leadLengthMm,
      maxDisplacementMm: row.maxDisplacementMm, before: { scene: geometryView(before), anchor: previous.anchor } })
    after.paths[row.pathId] = { ...after.paths[row.pathId], centerlineMm: clone(plan.centerlineMm), supportRefs: clone(plan.supportRefs) }
    after.pathAttachments![attachmentId] = { ...row, anchor: clone(plan.anchor) }
    const band = pathPolygon(after.paths[row.pathId]), path = after.paths[row.pathId]
    const retainedSegments = Object.values(after.terrainAreas).filter(area => area.floorId === path.floorId).reduce((sum, area) => sum + area.boundaryMm.length, 0)
      + Object.values(after.regions).filter(region => region.floorId === path.floorId).reduce((sum, region) => sum + region.boundaryMm.length, 0)
      + Object.values(after.walls).filter(wall => wall.floorId === path.floorId).length * 4 + Object.values(after.props).filter(prop => prop.floorId === path.floorId && prop.blocksMovement).length * 4
    execution.semanticTargets += 2
    execution.geometryPoints += before.paths[row.pathId].centerlineMm.length + plan.centerlineMm.length + band.length + plan.preservedTail.count + 3
    execution.geometrySegments += before.paths[row.pathId].centerlineMm.length + plan.centerlineMm.length + band.length
    execution.intersectionPairs += (retainedSegments + band.length) ** 2
    assertCommandBudget(MANUAL_TRANSACTION_BUDGET, execution)
    const deps = [...new Set([...initialDeps, ...plan.dependencyIds])]
    assertLocks(before, previous, deps); assertLocks(after, row, deps)
    for (const value of deps) dependencies.add(value)
  }
  // Removed rows are explicit detach intent. They do not follow or resurrect a
  // deleted path; the ordinary detach/delete command owns their lock checks.
  assertErrors(validatePathAttachmentGeometry(after))
  const work = emptyBudgetUsage(), changed = Object.keys(rows).filter(id => !same(prior[id] ?? null, after.pathAttachments?.[id] ?? null))
  work.semanticTargets = changed.length * 2; work.dependencyRefs = dependencies.size; work.metadataRecords = changed.length
  work.metadataBytes = encodeUtf8(canonicalJson(changed.map(id => after.pathAttachments![id]))).length
  work.geometryPoints = execution.geometryPoints; work.geometrySegments = execution.geometrySegments; work.intersectionPairs = execution.intersectionPairs
  assertCommandBudget(MANUAL_TRANSACTION_BUDGET, work)
  return { document: after, dependencyIds: [...dependencies].sort() }
}

/** Internal controlled undo/redo repair only. It is not a public command, import
 * repair mode or caller opt-out. The owner first advances real identities, then
 * signs this complete geometry against that pool and validates full content. */
export function rebindPathAttachmentProofs(input: AttachmentScene, identity: HistoryIdentity): AttachmentScene {
  const scene = captureJson(input)
  assertErrors(validatePathAttachmentGeometry(scene))
  for (const row of Object.values(records(scene))) scene.pathAttachments![row.id].proofs = readProofs(scene, identity, row)
  assertErrors(validatePathAttachmentProofs(scene, identity))
  return scene
}
