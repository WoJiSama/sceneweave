import type { Issue } from '../model/scene.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { attachmentRecordSchema, attachmentSurfaceRecordSchema, type AttachmentSurface } from './contracts.js'
import { attachmentHash, type AttachmentScene } from './topology.js'
import { assertAttachmentPolygon, attachmentContactIssues, attachmentOwner, propContactGeometryHash, surfaceGeometry, wallAttachmentFrame } from './contact.js'
import { inspectCarvedStrip } from '../carved-rock/index.js'
import { polygonInside, propFootprint } from '../geometry/geometry.js'
import { captureJson } from '../validation/json.js'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
export function inspectAttachmentSurface(scene: AttachmentScene, surface: AttachmentSurface): void {
  attachmentOwner(scene, surface.owner)
  const f = surface.feature, c = surface.capabilities
  if (f.kind === 'propTop') {
    if (surface.owner.kind !== 'prop' || c.some(v => v !== 'support')) throw new Error('物件顶面只能提供明确水平承托。')
    assertAttachmentPolygon(f.polygonLocalMm)
    const host = scene.props[surface.owner.id]
    if (!polygonInside(f.polygonLocalMm, propFootprint({ ...host, positionMm: { x: 0, y: 0 }, rotationDeg: 0 }))) throw new Error('承托面超出宿主实际完整占地。')
    surfaceGeometry(scene, surface)
  } else if (f.kind === 'wallSide') {
    if (surface.owner.kind !== 'wall' || c.some(v => v !== 'hang')) throw new Error('墙侧面只提供明确挂接。')
    wallAttachmentFrame(scene, surface)
  } else if (f.kind === 'rockSourceFace') {
    if (surface.owner.kind !== 'terrainArea' || c.some(v => v !== 'embed')) throw new Error('源岩面只提供明确嵌入。')
    const area = scene.terrainAreas[surface.owner.id]
    if (!area.rockBody || area.rockBody.baseElevationMm >= area.groundElevationMm) throw new Error('源宿主必须是有明确底高的真实岩体。')
    const ids = area.boundaryMm.map(v => v.segmentId), first = ids.indexOf(f.sourceSegmentIds[0])
    if (first < 0 || f.sourceSegmentIds.some((id, i) => ids[(first + i) % ids.length] !== id)) throw new Error('岩体表面须为稳定、同向、连续源边链。')
  } else {
    if (surface.owner.kind !== 'terrainConnection' || c.some(v => v !== 'support' && v !== 'walk')) throw new Error('实际步行面不能充当自身切削宿主。')
    const connection = scene.terrainConnections[surface.owner.id], strip = connection?.carvedStrip
    if (!strip || strip.walkSurfaceId !== surface.id || attachmentHash([...strip.walkFaceIds].sort()) !== attachmentHash([...f.faceIds].sort())) throw new Error('步行面须对应connection完整实际面片。')
    const issues = inspectCarvedStrip(scene, connection)
    if (issues.length) throw new Error(issues.map(v => v.message).join('；'))
  }
}
export function embedMaterialized(scene: AttachmentScene, row: Extract<import('./contracts.js').Attachment, { mode: 'embed' }>) {
  const connection = scene.terrainConnections[row.child.id], strip = connection?.carvedStrip
  if (!connection || !strip || strip.attachmentId !== row.id || connection.kind !== 'ramp' || row.anchor.kind !== 'rockEdgeChain') throw new Error('嵌入关系须对应真实ramp.carvedStrip。')
  const surfaces = row.surfaceIds.map(id => {
    const surface = scene.attachmentSurfaces?.[id]
    if (!surface || surface.feature.kind !== 'rockSourceFace' || surface.owner.kind !== 'terrainArea' || !surface.capabilities.includes('embed')) throw new Error('嵌入宿主须为真实源岩面，不能用生成路面循环自证。')
    inspectAttachmentSurface(scene, surface)
    if (surface.owner.id !== strip.hostAreaId || scene.terrainAreas[surface.owner.id].floorId !== connection.floorId) throw new Error('嵌入跨岩体或跨Floor。')
    if (connection.visibility === 'public' && scene.terrainAreas[surface.owner.id].visibility !== 'public') throw new Error('公开山路不能依赖私密岩体。')
    return surface
  })
  const allSegments = surfaces.flatMap(surface => surface.feature.kind === 'rockSourceFace' ? surface.feature.sourceSegmentIds : [])
  if (attachmentHash(allSegments) !== attachmentHash(row.anchor.sourceSegmentIds) || attachmentHash(strip.sourceSegmentIds) !== attachmentHash(row.anchor.sourceSegmentIds) || strip.cutSide !== row.anchor.cutSide) throw new Error('嵌入关系与真实切削源边链/切入侧不一致。')
  const issues = inspectCarvedStrip(scene, connection)
  if (issues.length) throw new Error(issues.map(v => v.message).join('；'))
  return { stripGeometryHash: attachmentHash(strip), sourceGeometryHash: attachmentHash(surfaces.map(surface => surfaceGeometry(scene, surface))) }
}
/** Public/cold validation is read-only and never regenerates or repairs geometry. */
export function inspectAttachments(scene: AttachmentScene): Issue[] {
  let surfaces: NonNullable<AttachmentScene['attachmentSurfaces']>, rows: NonNullable<AttachmentScene['attachments']>
  try {
    surfaces = attachmentSurfaceRecordSchema.parse(captureJson(scene.attachmentSurfaces ?? {}))
    rows = attachmentRecordSchema.parse(captureJson(scene.attachments ?? {}))
  } catch (error) { return [{ code: 'ATTACHMENT_SHAPE', message: message(error) }] }
  const errors: Issue[] = []
  const domain = { ...scene }; delete domain.attachmentSurfaces; delete domain.attachments
  const occupied = geometryIdentityIds(domain)
  for (const id of Object.keys(scene.userLayers)) occupied.add(id)
  for (const [key, surface] of Object.entries(surfaces)) try {
    if (key !== surface.id || occupied.has(key) || Object.hasOwn(rows, key)) throw new Error('附着面ID须唯一，且与记录key相同。')
    if (scene.entityLayers[key] !== undefined) throw new Error('附着面继承宿主图层，不能独立分层。')
    inspectAttachmentSurface(scene, surface)
  } catch (error) { errors.push({ code: 'ATTACHMENT_SURFACE', entityId: key, message: message(error) }) }
  const children = new Set<string>()
  for (const [key, row] of Object.entries(rows)) try {
    if (key !== row.id || occupied.has(key) || children.has(row.child.id)) throw new Error('关系ID须唯一，每个child最多一条附着。')
    children.add(row.child.id)
    if (scene.entityLayers[key] !== undefined) throw new Error('附着关系继承实际宿主/child，不能独立分层。')
    if (row.mode === 'embed' && attachmentHash(embedMaterialized(scene, row)) !== attachmentHash(row.materialized)) throw new Error('嵌入实际切削/源岩体摘要已陈旧。')
  } catch (error) { errors.push({ code: 'ATTACHMENT_RELATION', entityId: key, message: message(error) }) }
  errors.push(...attachmentContactIssues(scene))
  for (const connection of Object.values(scene.terrainConnections)) if (connection.carvedStrip && !rows[connection.carvedStrip.attachmentId]) errors.push({ code: 'ATTACHMENT_EMBED_MISSING', entityId: connection.id, message: '实际岩体山路缺少明确嵌入关系。' })
  return errors
}
