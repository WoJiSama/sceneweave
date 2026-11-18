import { z } from 'zod'
import { id } from '../validation/primitives.js'
import { captureJson, cloneJson } from '../validation/json.js'
import type { HistoryIdentity } from '../model/history.js'
import type { SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { terrainInlayRequestSchema } from '../terrain-inlay/contracts.js'
import { terrainInlayOriginalSchema, terrainInlayFinishSchema } from '../terrain-inlay/persistence.js'
import { inspectTerrainInlay, terrainInlayHash } from '../terrain-inlay/scene.js'
import { attachmentOwnerDependencyIds, assertAttachmentLocks } from '../attachments/dependencies.js'
import { geometryIdentityIds } from './domain.js'
import { assertTerrainInlayVisualLocks, inspectTerrainInlayVisualScope } from '../terrain-inlay/visual-scope.js'

export const terrainInlayCommandSchemas = [
  z.object({ type: z.literal('adoptTerrainInlay'), id, geometry: terrainInlayRequestSchema,
    appearance: z.literal('source-ground').optional(), finish: terrainInlayFinishSchema.optional(),
    centerlineVertexIds: z.array(id).min(2).max(256), expectedConnectionHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('restoreTerrainInlaySource'), id, disposition: z.literal('restore-original-connection-and-ground') }).strict(),
  z.object({ type: z.literal('setTerrainInlayAppearance'), id, appearance: z.literal('source-ground').nullable(),
    expectedConnectionHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('setTerrainInlayFinish'), id, finish: terrainInlayFinishSchema.nullable(),
    expectedConnectionHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
] as const
export type TerrainInlayCommand = z.infer<typeof terrainInlayCommandSchemas[number]>
export const isTerrainInlayCommand = (row: { type: string }): row is TerrainInlayCommand => terrainInlayCommandSchemas.some(schema => schema.shape.type.value === row.type)

/** One existing connection changes representation in one private draft. Mesh
 * work is separately metered; 148 triangles are not 148 user edit commands. */
export function applyTerrainInlayCommand(scene: SceneDocument, raw: TerrainInlayCommand, context: PreparationContext, identity?: HistoryIdentity): { commandCost: number } {
  const command = terrainInlayCommandSchemas.find(schema => schema.shape.type.value === raw.type)!.parse(captureJson(raw)) as TerrainInlayCommand
  if (!identity) throw Error('跨台山路须使用完整工程的真实身份事务。')
  const connection = scene.terrainConnections[command.id]
  if (!connection) throw Error('要转换的原连接已不存在。')
  const dependencies = new Set(attachmentOwnerDependencyIds(scene, connection.id))
  const areaIds = command.type === 'adoptTerrainInlay' ? command.geometry.sources.map(source => source.id) : connection.terrainInlay?.geometry.sources.map(source => source.id) ?? []
  for (const areaId of areaIds) for (const id of attachmentOwnerDependencyIds(scene, areaId)) dependencies.add(id)
  for (const edge of Object.values(scene.terrainEdges)) if (areaIds.includes(edge.source.areaId) || areaIds.includes(edge.neighborAreaId ?? '')) { dependencies.add(edge.id); dependencies.add(scene.entityLayers[edge.id]) }
  assertAttachmentLocks(scene, [...dependencies])
  const visualGeometry = command.type === 'adoptTerrainInlay' ? command.geometry : connection.terrainInlay?.geometry
  if (visualGeometry) {
    const appearance = command.type === 'adoptTerrainInlay' || command.type === 'setTerrainInlayAppearance' ? command.appearance : connection.terrainInlay?.appearance
    const finish = command.type === 'adoptTerrainInlay' || command.type === 'setTerrainInlayFinish' ? command.finish : connection.terrainInlay?.finish
    assertTerrainInlayVisualLocks(scene, inspectTerrainInlayVisualScope(scene, connection.id, visualGeometry, undefined, !!finish && appearance === 'source-ground'))
  }
  if (command.type === 'setTerrainInlayAppearance') {
    if (!connection.terrainInlay) throw Error('只有已采用的连续填切山路可以切换地表表现。')
    if (terrainInlayHash(connection) !== command.expectedConnectionHash) throw Error('山路已在外观候选之后改变，请重新准备。')
    if (command.appearance === null) delete connection.terrainInlay.appearance
    else connection.terrainInlay.appearance = command.appearance
    return { commandCost: 1 }
  }
  if (command.type === 'setTerrainInlayFinish') {
    if (!connection.terrainInlay) throw Error('只有已采用的坡体可以设置山径或踏步表面。')
    if (terrainInlayHash(connection) !== command.expectedConnectionHash) throw Error('坡体已在表面候选之后改变，请重新准备。')
    if (command.finish === null) delete connection.terrainInlay.finish
    else connection.terrainInlay.finish = cloneJson(command.finish)
    return { commandCost: 1 }
  }
  if (Object.values(scene.attachmentSurfaces ?? {}).some(surface => surface.owner.kind === 'terrainConnection' && surface.owner.id === connection.id)
    || Object.values(scene.attachments ?? {}).some(row => row.child.id === connection.id)) throw Error('原连接已有附着依赖，须先显式解除后再转换或回填。')
  if (command.type === 'restoreTerrainInlaySource') {
    if (!connection.terrainInlay) throw Error('该连接没有跨台填切结果。')
    const original = cloneJson(connection.terrainInlay.originalConnection)
    // Permission belongs to the current instance. Restoring source geometry
    // never restores a historical unlocked/public business state.
    scene.terrainConnections[command.id] = { ...original, editLocked: connection.editLocked,
      visibility: connection.visibility, blocksMovement: connection.blocksMovement,
      movementCostMultiplier: connection.movementCostMultiplier, surfaceStyle: connection.surfaceStyle }
    delete scene.terrainConnections[command.id].staircase
    if (connection.staircase) scene.terrainConnections[command.id].staircase = cloneJson(connection.staircase)
    return { commandCost: 1 }
  }
  if (connection.terrainInlay || connection.carvedStrip) throw Error('只能把现存原连接转换一次，不能覆盖人工填切结果。')
  if (terrainInlayHash(connection) !== command.expectedConnectionHash) throw Error('原连接已在候选之后改变，请重新准备。')
  const original = terrainInlayOriginalSchema.parse(cloneJson(connection)), record = identity.outdoorTokens[connection.id]
  if (!record || record.kind !== 'terrainConnection') throw Error('原连接缺少真实出生证明。')
  const geometry = cloneJson(command.geometry), allocated = geometryIdentityIds(scene)
  for (const layerId of Object.keys(scene.userLayers)) allocated.add(layerId)
  for (const pool of Object.values(identity)) if (pool && typeof pool === 'object') for (const id of Object.keys(pool)) allocated.add(id)
  const fresh = () => { const value = context.ids.nextId(); if (allocated.has(value)) throw Error('跨台山路新身份已占用或退休。'); allocated.add(value); return value }
  const map = new Map(Object.keys(geometry.verticesMm).map(id => [id, fresh()]))
  geometry.verticesMm = Object.fromEntries(Object.entries(geometry.verticesMm).map(([id, point]) => [map.get(id)!, point]))
  geometry.faces = Object.fromEntries(Object.values(geometry.faces).map(face => { const id = fresh(); return [id, { id, kind: face.kind, vertexIds: face.vertexIds.map(id => map.get(id)!) as [string, string, string] }] }))
  geometry.footprintVertexIds = geometry.footprintVertexIds.map(id => map.get(id)!)
  geometry.walkBoundaryVertexIds = geometry.walkBoundaryVertexIds.map(id => map.get(id)!)
  const centerlineVertexIds = command.centerlineVertexIds.map(id => { const actual = map.get(id); if (!actual) throw Error('中心线引用缺少实际顶点。'); return actual })
  connection.terrainInlay = { algorithmId: 'terrain-inlay1', algorithmVersion: 1, geometry, centerlineVertexIds,
    ...(command.appearance ? { appearance: command.appearance } : {}), ...(command.finish ? { finish: cloneJson(command.finish) } : {}),
    originalConnection: original, originalConnectionHash: terrainInlayHash(original), connectionBirthToken: record.token, lineageId: identity.lineageId,
    sourceProofs: geometry.sources.map(source => {
      const proof = identity.outdoorTokens[source.id]
      if (!proof || proof.kind !== 'terrainArea') throw Error('跨台源面缺少真实出生和拓扑证明。')
      return { areaId: source.id, birthToken: proof.token, topologyToken: proof.topologyToken, topologyHash: proof.topologyHash, geometryHash: terrainInlayHash(source) }
    }) }
  connection.kind = 'ramp'; delete connection.route
  const issues = inspectTerrainInlay(scene, connection)
  if (issues.length) throw Error(issues.map(issue => issue.message).join('；'))
  return { commandCost: 1 }
}
