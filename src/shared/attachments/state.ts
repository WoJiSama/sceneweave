import type { HistoryIdentity } from '../model/history.js'
import { captureJson, cloneJson, encodeUtf8 } from '../validation/json.js'
import { z } from 'zod'
import { id, unique } from '../validation/primitives.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { captureCarvedRockHost, followCarvedStrip } from '../carved-rock/index.js'
import { assertCommandBudget, MANUAL_TRANSACTION_BUDGET } from '../budget/command-budget.js'
import { emptyBudgetUsage } from '../budget/task-budget.js'
import type { AttachmentSurface, EmbedAttachment, PropAttachment } from './contracts.js'
import { attachmentHash, type AttachmentScene } from './topology.js'
import { attachmentLocalPoint, normalizeAttachmentAngle, propAttachmentMaterialized, propContactGeometryHash, surfaceGeometry, wallAttachmentFrame } from './contact.js'
import { attachmentDependencyIds, assertAttachmentLocks, followingAttachmentProps } from './dependencies.js'
import { readAttachmentProofs, validateAttachmentProofs } from './identity.js'
import { attachmentAnchorPose, placePropAtAttachmentAnchor } from './commands.js'
import { embedMaterialized } from './validation.js'
import { createPublicVisibility } from '../geometry/visibility.js'

const same = (a: unknown, b: unknown) => attachmentHash(a ?? null) === attachmentHash(b ?? null)
const failIssues = (issues: { message: string }[]) => { if (issues.length) throw new Error(issues.map(issue => issue.message).join('；')) }
export interface AttachmentMutationResult { dependencyIds: string[]; affectedIds: string[]; commandCost: number }
/** Internal native follow. Identity is checked against the pre-native state;
 * after-native topology is observed by its real owner before new-proof sync. */
export function followAttachments(before: AttachmentScene, after: AttachmentScene, identity?: HistoryIdentity, movingFurniture = false): AttachmentMutationResult {
  if (identity) failIssues(validateAttachmentProofs(before, identity))
  const explicitlyChangedProps = new Set(Object.values(after.attachments ?? {}).flatMap(row => {
    if (row.mode === 'embed') return []
    const previous = before.props[row.child.id], current = after.props[row.child.id]
    return !previous || !current || propContactGeometryHash(previous) !== propContactGeometryHash(current) ? [row.child.id] : []
  }))
  const carriedPropIds = new Set<string>()
  const previousVisibility = movingFurniture ? createPublicVisibility(before) : undefined
  const roomChanged = (owner: AttachmentSurface['owner']) => movingFurniture && owner.kind === 'prop'
    && before.props[owner.id]?.roomId !== after.props[owner.id]?.roomId
  const movedOwners = new Set<string>()
  for (const row of Object.values(after.attachments ?? {})) {
    if (row.mode === 'embed' || row.follow !== 'follow') continue
    const surface = after.attachmentSurfaces?.[row.surfaceId]
    const previous = before.attachmentSurfaces?.[row.surfaceId]
    if (!previous || !surface || movedOwners.has(surface.owner.id) || !same(previous, surface) || explicitlyChangedProps.has(row.child.id)) continue
    if (roomChanged(surface.owner) || !same(surfaceGeometry(before, previous), surfaceGeometry(after, surface))) {
      movedOwners.add(surface.owner.id)
      for (const child of followingAttachmentProps(before, surface.owner.id)) {
        if (!explicitlyChangedProps.has(child)) carriedPropIds.add(child)
      }
    }
  }
  const dependencies = new Set<string>(), affected = new Set<string>(), pending = new Set(Object.keys(after.attachments ?? {}))
  // A child host must settle before its own descendants. The graph is finite;
  // lack of progress is a cycle, never permission to drop a relationship.
  while (pending.size) {
    let progress = false
    for (const id of [...pending]) {
      const row = after.attachments![id], prior = before.attachments?.[id]
      if (!prior) { pending.delete(id); progress = true; continue }
      const surfaces = row.mode === 'embed' ? row.surfaceIds : [row.surfaceId]
      const hostIds = surfaces.map(id => after.attachmentSurfaces?.[id]?.owner.id).filter((id): id is string => !!id)
      const upstream = Object.values(after.attachments ?? {}).filter(other => hostIds.includes(other.child.id)).map(other => other.id)
      if (upstream.some(otherId => pending.has(otherId))) continue
      if (!same(prior, row)) throw new Error('既有附着记录只能由受控跟随/解绑更新，公共命令不能替换witness或anchor。')
      for (const surfaceId of surfaces) if (!same(before.attachmentSurfaces?.[surfaceId], after.attachmentSurfaces?.[surfaceId])) throw new Error('既有逻辑附着面不能被隐式换面、删除重建或改写证明。')
      const deps = [...new Set([...attachmentDependencyIds(before, prior), ...attachmentDependencyIds(after, row)])]
      if (row.mode === 'embed') {
        // Persistent cut cells are authoritative. A new source cannot be
        // silently accepted merely because its stored area ID is unchanged.
        if (prior.mode !== 'embed') throw new Error('不能隐式改变附着模式。')
        const connection = after.terrainConnections[row.child.id], previousConnection = before.terrainConnections[prior.child.id]
        const previousStrip = previousConnection?.carvedStrip, strip = connection?.carvedStrip
        if (!strip || !previousStrip) throw new Error('实际切削被删除，不能静默回填岩体。')
        const previousHost = before.terrainAreas[previousStrip.hostAreaId], host = after.terrainAreas[strip.hostAreaId]
        if (!previousHost?.rockBody || !host?.rockBody) throw new Error('实际岩体宿主已删除或取消有限岩体。')
        const sourceChanged = !same({ boundaryMm: previousHost.boundaryMm, groundElevationMm: previousHost.groundElevationMm, rockBody: previousHost.rockBody },
          { boundaryMm: host.boundaryMm, groundElevationMm: host.groundElevationMm, rockBody: host.rockBody })
        if (sourceChanged) {
          assertAttachmentLocks(before, deps); assertAttachmentLocks(after, deps)
          if (row.follow === 'fixed') throw new Error('fixed嵌入的岩体宿主已变化。')
          if (row.managedScope === 'stripManagedStations' && strip.stations.some(station => station.state === 'manual')) throw new Error('保持人工station世界位置会撕开切削，首片不自动跟随此混合范围。')
          const followed = followCarvedStrip(captureCarvedRockHost({ ...previousHost, rockBody: previousHost.rockBody }), captureCarvedRockHost({ ...host, rockBody: host.rockBody }), previousStrip)
          if (!same(strip, previousStrip) && !same(strip, followed)) throw new Error('岩体与人工切削同时改动，不能重生或覆盖人工结果。')
          connection.carvedStrip = cloneJson(followed)
          const first = followed.verticesMm[followed.stations[0].centerVertexId], last = followed.verticesMm[followed.stations.at(-1)!.centerVertexId]
          connection.from.positionMm = { x: first.x, y: first.y }; connection.to.positionMm = { x: last.x, y: last.y }
          row.materialized = embedMaterialized(after, row)
          affected.add(row.id); affected.add(connection.id)
          for (const dependency of deps) dependencies.add(dependency)
        } else {
          const actual = embedMaterialized(after, row)
          if (!same(actual, prior.materialized)) throw new Error('既有实际切削改变后须使用明确重建候选，不能自动签发陈旧接触摘要。')
        }
      } else {
        const previousSurface = before.attachmentSurfaces?.[prior.mode === 'embed' ? '' : prior.surfaceId], surface = after.attachmentSurfaces?.[row.surfaceId]
        if (!previousSurface || !surface || prior.mode === 'embed') throw new Error('附着面已删除，不能暗脱落。')
        const previousChild = before.props[prior.child.id], child = after.props[row.child.id]
        if (!previousChild || !child) throw new Error('删除附着child前须明确解除关系。')
        const hostChanged = roomChanged(surface.owner) || !same(surfaceGeometry(before, previousSurface), surfaceGeometry(after, surface))
        const childChanged = propContactGeometryHash(previousChild) !== propContactGeometryHash(child)
        if (hostChanged || childChanged) {
          // A locked attached item's placement is local. Only a passive
          // transform may carry it. Layer, container and note locks still apply.
          const carried = hostChanged && !childChanged ? carriedPropIds : undefined
          assertAttachmentLocks(before, deps, carried); assertAttachmentLocks(after, deps, carried)
          if (row.follow === 'fixed' && hostChanged) throw new Error('fixed附着依赖的宿主实际面已改变，须明确解绑或重绑。')
          if (previousVisibility && hostChanged && surface.owner.kind === 'prop') {
            const host = after.props[surface.owner.id]
            child.supportRef = cloneJson(host.supportRef)
            if (host.roomId === undefined) delete child.roomId
            else child.roomId = host.roomId
            if (!previousVisibility.prop(previousChild) || host.visibility === 'gm') child.visibility = 'gm'
          }
          if (childChanged && !hostChanged) {
            // An explicit in-face child edit becomes a local manual anchor;
            // it never detaches implicitly and never changes root ownership.
            if (row.anchor.kind === 'horizontal' && surface.owner.kind === 'prop') {
              const host = after.props[surface.owner.id]
              row.anchor = { ...row.anchor, localMm: attachmentLocalPoint(child.positionMm, host), rotationOffsetDeg: normalizeAttachmentAngle(child.rotationDeg - host.rotationDeg) }
            } else if (row.anchor.kind === 'vertical') {
              const frame = wallAttachmentFrame(after, surface), dx = child.positionMm.x - frame.a.x, dy = child.positionMm.y - frame.a.y
              const along = Math.round(dx * frame.u.x + dy * frame.u.y), offset = Math.round(dx * frame.n.x + dy * frame.n.y - frame.wall.thicknessMm / 2)
              if (offset < 0) throw new Error('悬挂child移到错误墙侧，须明确换面。')
              row.anchor = { ...row.anchor, alongMm: along, normalOffsetMm: offset, rotationOffsetDeg: normalizeAttachmentAngle(child.rotationDeg - frame.angleDeg) }
            } else throw new Error('附着不支持该局部编辑。')
            row.anchorState = 'manual'
          } else if (hostChanged && childChanged) {
            const expected = attachmentAnchorPose(after, row)
            if (!same(expected.positionMm, child.positionMm) || expected.rotationDeg !== child.rotationDeg) throw new Error('宿主与child同时变化且不符合原局部锚点，不能猜测人工意图。')
          } else placePropAtAttachmentAnchor(after, row)
          row.materialized = propAttachmentMaterialized(after, row)
          affected.add(row.id)
          if (propContactGeometryHash(previousChild) !== propContactGeometryHash(child)) affected.add(child.id)
          for (const dependency of deps) dependencies.add(dependency)
        }
      }
      pending.delete(id); progress = true
    }
    if (!progress) throw new Error('附着关系存在递归依赖环。')
  }
  // An ordinary entity deletion must not masquerade as deleting its relation.
  for (const prior of Object.values(before.attachments ?? {})) if (after.attachments?.[prior.id] && !after.props[prior.child.id] && prior.mode !== 'embed') throw new Error('附着child已删除但关系仍存。')
  const work = emptyBudgetUsage()
  work.semanticTargets = affected.size; work.dependencyRefs = dependencies.size; work.metadataRecords = affected.size
  for (const id of affected) if (after.attachments?.[id]) work.metadataBytes += encodeUtf8(JSON.stringify(after.attachments[id])).length
  assertCommandBudget(MANUAL_TRANSACTION_BUDGET, work)
  return { dependencyIds: [...dependencies].sort(), affectedIds: [...affected].sort(), commandCost: affected.size }
}
export const createEmbeddedAttachmentRequestSchema = z.object({ id, connectionId: id, surfaceIds: z.array(id).min(1).max(128).refine(unique, '宿主面不能重复'),
  follow: z.enum(['fixed', 'follow']), managedScope: z.enum(['wholeStrip', 'stripManagedStations']), anchorState: z.enum(['managed', 'manual']) }).strict()
export type CreateEmbeddedAttachmentRequest = z.infer<typeof createEmbeddedAttachmentRequestSchema>
/** Reads complete actual strip geometry from the carved-rock owner. A new child
 * may be awaiting its real birth; no token is invented. The owned result must
 * pass syncNewAttachmentProofs after identityTrace.capture and before validate. */
export function createEmbeddedAttachmentPlan(scene: AttachmentScene, input: CreateEmbeddedAttachmentRequest, identity?: HistoryIdentity): { attachment: EmbedAttachment; dependencyIds: string[] } {
  const request = createEmbeddedAttachmentRequestSchema.parse(captureJson(input))
  if (geometryIdentityIds(scene).has(request.id) || Object.hasOwn(scene.userLayers, request.id) || identity && Object.values(identity).some(v => v && typeof v === 'object' && Object.hasOwn(v, request.id))) throw new Error('嵌入关系ID已占用或退休。')
  const strip = scene.terrainConnections[request.connectionId]?.carvedStrip
  if (!strip || strip.attachmentId !== request.id || scene.attachments?.[request.id]) throw new Error('嵌入意图没有对应新建的完整实际strip。')
  const row = { id: request.id, mode: 'embed' as const, child: { kind: 'terrainConnection' as const, id: request.connectionId }, surfaceIds: [...request.surfaceIds],
    follow: request.follow, managedScope: request.managedScope, anchorState: request.anchorState,
    anchor: { kind: 'rockEdgeChain' as const, sourceSegmentIds: [...strip.sourceSegmentIds], cutSide: strip.cutSide } } as EmbedAttachment
  row.materialized = embedMaterialized(scene, row)
  if (identity?.outdoorTokens[request.connectionId] && request.surfaceIds.every(id => identity.structureTokens?.[id])) row.proofs = readAttachmentProofs(scene, identity, row)
  const dependencies = attachmentDependencyIds(scene, row); assertAttachmentLocks(scene, dependencies)
  return { attachment: row, dependencyIds: dependencies }
}
