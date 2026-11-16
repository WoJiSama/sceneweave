import { z } from 'zod'
import { id, int, positive, point, unique } from '../validation/primitives.js'
import { rockBodySchema, carvedPointSchema, createCarvedStrip, captureCarvedRockHost } from '../carved-rock/index.js'
import { createEmbeddedAttachmentPlan, type AttachmentSurface } from '../attachments/index.js'
import { attachmentDependencyIds, attachmentOwnerDependencyIds, assertAttachmentLocks } from '../attachments/dependencies.js'
import { inspectAttachmentSurface } from '../attachments/validation.js'
import { geometryIdentityIds } from './domain.js'
import { captureJson } from '../validation/json.js'
import { generateRockShell, estimateRockShellCost } from '../rock-shell/index.js'
import { assertRockShellCutClearance } from '../rock-shell/dependencies.js'
import type { HistoryIdentity } from '../model/history.js'
import type { SceneDocument, TerrainConnection } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'

const root = z.object({ kind: z.enum(['floor', 'terrainArea']), id }).strict()
export const carvedRockCommandSchemas = [
  z.object({ type: z.literal('setRockBody'), id, rockBody: rockBodySchema.omit({ shell: true }).nullable() }).strict(),
  z.object({ type: z.literal('createRockShell'), id, widthMm: positive, direction: point, seed: z.string().min(1).max(1024),
    excludedSegmentIds: z.array(id).max(20).refine(unique, '保留竖直边不能重复') }).strict(),
  z.object({ type: z.literal('removeRockShell'), id, disposition: z.literal('restore-vertical-body') }).strict(),
  z.object({ type: z.literal('createCarvedMountainPath'), id, attachmentId: id, walkSurfaceId: id, sourceSurfaceId: id,
    fromSurfaceRef: root, toSurfaceRef: root, pointsMm: z.array(carvedPointSchema).min(2).max(64), widthMm: positive,
    cutSide: z.enum(['left', 'right']), layerId: id, visibility: z.enum(['public', 'gm']),
    follow: z.enum(['fixed', 'follow']) }).strict(),
  z.object({ type: z.literal('removeCarvedMountainPath'), id, disposition: z.literal('restore-source-rock') }).strict(),
] as const
export type CarvedRockCommand = z.infer<typeof carvedRockCommandSchemas[number]>
export const isCarvedRockCommand = (command: { type: string }): command is CarvedRockCommand => carvedRockCommandSchemas.some(row => row.shape.type.value === command.type)

/** Public commands contain intent only. Birth proofs come from the complete
 * owner after this actual draft, including all generated vertices, exists. */
export function applyCarvedRockCommand(scene: SceneDocument, raw: CarvedRockCommand, context: PreparationContext, identity?: HistoryIdentity, remainingBudget = 256): { commandCost: number } {
  const command = carvedRockCommandSchemas.find(row => row.shape.type.value === raw.type)!.parse(captureJson(raw)) as CarvedRockCommand
  if (!identity) throw new Error('岩体与山路须从完整工程事务准备。')
  if (command.type === 'setRockBody') {
    const area = scene.terrainAreas[command.id]
    if (!area) throw new Error('岩体宿主不存在。')
    assertAttachmentLocks(scene, attachmentOwnerDependencyIds(scene, area.id))
    if (area.rockBody?.shell) throw new Error('已有真实侧壳，修改底高或移除岩体前须明确移除侧壳。')
    if (command.rockBody && command.rockBody.baseElevationMm >= area.groundElevationMm) throw new Error('岩体底高须低于顶高。')
    if (command.rockBody) { captureCarvedRockHost({ ...area, rockBody: command.rockBody }); area.rockBody = command.rockBody }
    else delete area.rockBody
    return { commandCost: 1 }
  }
  if (command.type === 'createRockShell' || command.type === 'removeRockShell') {
    const area = scene.terrainAreas[command.id]
    if (!area?.rockBody) throw new Error('真实侧壳须先选择有限岩体。')
    assertAttachmentLocks(scene, attachmentOwnerDependencyIds(scene, area.id))
    if (Object.values(scene.attachmentSurfaces ?? {}).some(surface => surface.owner.id === area.id)
      || Object.values(scene.terrainConnections).some(row => row.carvedStrip?.hostAreaId === area.id)) throw new Error('侧壳拓扑变化前须明确解绑宿主表面并回填已有山路；不能刷新旧附着证明。')
    if (command.type === 'removeRockShell') {
      const shell = area.rockBody.shell
      if (!shell) throw new Error('当前岩体没有真实侧壳。')
      delete area.rockBody.shell
      return { commandCost: 1 + shell.sections.length + Object.keys(shell.verticesMm).length + Object.keys(shell.faces).length }
    }
    if (area.rockBody.shell) throw new Error('已有真实侧壳，不能重生覆盖完整人工结果。')
    const allocated = geometryIdentityIds(scene)
    for (const pool of Object.values(identity)) if (pool && typeof pool === 'object') for (const key of Object.keys(pool)) allocated.add(key)
    for (const key of Object.keys(scene.userLayers)) allocated.add(key)
    const intent = { footSurfaceRef: { kind: 'floor' as const, id: area.floorId }, footElevationMm: 0,
      widthMm: command.widthMm, direction: command.direction, seed: command.seed, excludedSegmentIds: command.excludedSegmentIds }
    const host = captureCarvedRockHost({ ...area, rockBody: area.rockBody }), cost = estimateRockShellCost(host, intent)
    if (cost + 2 > Math.min(remainingBudget, 256)) throw new Error('真实侧壳完整事务超过剩余256展开预算；未分配几何身份。')
    area.rockBody.shell = generateRockShell(host, intent, { transactionBudget: Math.min(remainingBudget, 256) - 2, ids: { nextId: () => {
      const value = context.ids.nextId()
      if (allocated.has(value)) throw new Error('真实侧壳新身份已占用或退休。')
      allocated.add(value); return value
    } } })
    return { commandCost: cost + 1 }
  }
  if (command.type === 'removeCarvedMountainPath') {
    const connection = scene.terrainConnections[command.id], strip = connection?.carvedStrip
    if (!strip) throw new Error('连续山路不存在。')
    const row = scene.attachments?.[strip.attachmentId], surface = scene.attachmentSurfaces?.[strip.walkSurfaceId]
    if (!row || !surface) throw new Error('山路附着闭包不完整。')
    if (Object.values(scene.attachments ?? {}).some(other => other.id !== row.id && (other.mode === 'embed' ? other.surfaceIds : [other.surfaceId]).includes(surface.id))) throw new Error('山路承托其它物件，须先明确解绑。')
    assertAttachmentLocks(scene, attachmentDependencyIds(scene, row))
    delete scene.attachments![row.id]; delete scene.attachmentSurfaces![surface.id]
    delete scene.terrainConnections[connection.id]; delete scene.entityLayers[connection.id]
    return { commandCost: 3 + strip.stations.length + Object.keys(strip.verticesMm).length + Object.keys(strip.faces).length + strip.cutCells.length }
  }
  const source = scene.attachmentSurfaces?.[command.sourceSurfaceId]
  if (!source || source.owner.kind !== 'terrainArea' || source.feature.kind !== 'rockSourceFace') throw new Error('山路须显式选择实例源岩面。')
  inspectAttachmentSurface(scene, source)
  assertAttachmentLocks(scene, attachmentDependencyIds(scene, source))
  const host = scene.terrainAreas[source.owner.id], layer = scene.userLayers[command.layerId]
  if (!host?.rockBody) throw new Error('山路需要现存真实岩体。')
  if (!layer || layer.floorId !== host.floorId || layer.editLocked) throw new Error('山路须选择未锁定的同Floor图层。')
  if (command.visibility === 'public' && host.visibility !== 'public') throw new Error('公开山路不能依赖私密岩体。')
  const allocated = geometryIdentityIds(scene)
  for (const key of Object.keys(scene.userLayers)) allocated.add(key)
  for (const pool of Object.values(identity)) if (pool && typeof pool === 'object') for (const key of Object.keys(pool)) allocated.add(key)
  const fresh = (value: string) => { if (allocated.has(value)) throw new Error(`山路身份已占用或退休：${value}。`); allocated.add(value); return value }
  fresh(command.id); fresh(command.attachmentId); fresh(command.walkSurfaceId)
  const strip = createCarvedStrip(captureCarvedRockHost({ ...host, rockBody: host.rockBody }), {
    attachmentId: command.attachmentId, walkSurfaceId: command.walkSurfaceId, sourceSegmentIds: source.feature.sourceSegmentIds,
    cutSide: command.cutSide, widthMm: command.widthMm, pointsMm: command.pointsMm,
  }, { ids: { nextId: () => fresh(context.ids.nextId()) } })
  assertRockShellCutClearance(host, [strip])
  const first = command.pointsMm[0], last = command.pointsMm.at(-1)!
  const connection: TerrainConnection = { id: command.id, floorId: host.floorId, editLocked: false, visibility: command.visibility,
    kind: 'ramp', from: { surfaceRef: command.fromSurfaceRef, positionMm: { x: first.x, y: first.y } },
    to: { surfaceRef: command.toSurfaceRef, positionMm: { x: last.x, y: last.y } }, widthMm: command.widthMm,
    openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null, carvedStrip: strip }
  scene.terrainConnections[connection.id] = connection; scene.entityLayers[connection.id] = layer.id
  ;(scene.attachmentSurfaces ??= {})[strip.walkSurfaceId] = { id: strip.walkSurfaceId, owner: { kind: 'terrainConnection', id: connection.id },
    feature: { kind: 'carvedWalk', faceIds: [...strip.walkFaceIds] }, capabilities: ['support', 'walk'] } as AttachmentSurface
  const plan = createEmbeddedAttachmentPlan(scene, { id: strip.attachmentId, connectionId: connection.id, surfaceIds: [source.id],
    follow: command.follow, managedScope: 'wholeStrip', anchorState: 'managed' }, identity)
  ;(scene.attachments ??= {})[plan.attachment.id] = plan.attachment
  return { commandCost: 3 + strip.stations.length + Object.keys(strip.verticesMm).length + Object.keys(strip.faces).length + strip.cutCells.length }
}
