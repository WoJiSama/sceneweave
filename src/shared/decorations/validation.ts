import type { DecorationCluster, Issue, SceneDocument, SurfaceRef } from '../model/scene.js'
import { polygonInside, supportedPolygon, terrainPoints } from '../geometry/geometry.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { decorationAsProp, decorationClusterRecords, decorationFootprint, decorationRecords } from './geometry.js'

const sameRef = (a: SurfaceRef, b: SurfaceRef) => a.kind === b.kind && a.id === b.id
/** Strict shapes are checked by the scene parser before these semantic checks. */
export function validateDecorations(scene: SceneDocument): Issue[] {
  if (scene.schemaVersion < 6) return []
  const errors: Issue[] = [], occupied = new Map<string, string>(), visibility = createPublicVisibility(scene)
  const canopyOrders = new Set<string>()
  const fail = (code: string, message: string, entityId?: string) => errors.push({ code, message, ...(entityId ? { entityId } : {}) })
  const layer = (row: { id: string; floorId: string }) => {
    const layer = scene.userLayers[scene.entityLayers[row.id]]
    if (!layer || layer.floorId !== row.floorId) fail('DECORATION_LAYER', '轻量装饰及簇必须具有同Floor的现存用户图层。', row.id)
  }
  const surface = (ref: SurfaceRef, row: { id: string; floorId: string; visibility: 'public' | 'gm' }) => {
    const target = ref.kind === 'floor' ? scene.floors[ref.id] : ref.kind === 'room' ? scene.rooms[ref.id] : scene.terrainAreas[ref.id]
    if (!target || (ref.kind === 'floor' ? ref.id !== row.floorId : 'floorId' in target && target.floorId !== row.floorId)) fail('DECORATION_SUPPORT', '装饰支撑必须存在且与实例同Floor。', row.id)
    if (row.visibility === 'public' && !visibility.surface(ref)) fail('DECORATION_PRIVATE_SUPPORT', '公共装饰不能依赖私密支撑。', row.id)
  }
  const definition = (ref: { id: string; version: number }, owner: string, compact: boolean) => {
    const def = scene.propDefinitions[ref.id]
    if (!def || def.version !== ref.version) { fail('DECORATION_DEFINITION', '装饰只可引用已采用的确切固定版本定义。', owner); return }
    if (def.defaultAppearance.kind !== 'image' || !scene.assets[def.defaultAppearance.assetId]) fail('DECORATION_ASSET', '布景来源必须具有真实固定图片引用。', owner)
    if (compact && (def.defaultBlocksMovement || def.defaultBlocksSight)) fail('DECORATION_RESPONSIBILITY', '带移动或视线阻挡职责的来源须使用完整Prop，不能降为轻量装饰。', owner)
    if (compact && def.defaultAppearance.tint !== null) fail('DECORATION_TINT', '轻量来源须具有已固定的无运行时着色色值图片。', owner)
  }
  for (const row of Object.values(decorationRecords(scene))) {
    layer(row); surface(row.supportRef, row); definition(row.definitionRef, row.id, true)
    try {
      const prop = decorationAsProp(scene, row)
      if (prop.blocksMovement || prop.blocksSight || !supportedPolygon(scene, decorationFootprint(scene, row), row.supportRef, row.floorId)) fail('DECORATION_SUPPORT', '轻量装饰完整缩放占地必须位于显式有效支撑内；它不授予阻挡或通行。', row.id)
    } catch { /* Missing definitions have the more precise diagnostic above. */ }
  }
  for (const cluster of Object.values(decorationClusterRecords(scene))) {
    layer(cluster); surface(cluster.supportRef, cluster)
    const floor = scene.floors[cluster.floorId], b = cluster.boundsMm
    if (!floor || b.x < floor.boundsMm.x || b.y < floor.boundsMm.y || b.x + b.width > floor.boundsMm.x + floor.boundsMm.width || b.y + b.height > floor.boundsMm.y + floor.boundsMm.height) fail('DECORATION_CLUSTER_BOUNDS', '簇状布景范围须完整位于同Floor边界。', cluster.id)
    if (cluster.canopyRule) {
      const rule = cluster.canopyRule, area = cluster.supportRef.kind === 'terrainArea' ? scene.terrainAreas[cluster.supportRef.id] : undefined
      const orderKey = `${cluster.supportRef.kind}/${cluster.supportRef.id}/${rule.channel}/${rule.paintOrder}`
      if (scene.schemaVersion !== 7 || !area || area.floorId !== cluster.floorId) fail('CANOPY_RULE_SUPPORT', '树木区域规则只支持严格v7及同Floor地形面。', cluster.id)
      if (canopyOrders.has(orderKey)) fail('CANOPY_RULE_ORDER', '同一地形面的树木规则绘制顺序必须唯一。', cluster.id)
      canopyOrders.add(orderKey)
      try {
        polygonBoolean({ operation: 'union', subject: rule.regionsMm, clip: [] })
        if (area && rule.regionsMm.some(region => !polygonInside(region, terrainPoints(area)))) fail('CANOPY_RULE_BOUNDS', '树木规则区域必须完整位于其明确支撑地形面。', cluster.id)
      } catch { fail('CANOPY_RULE_GEOMETRY', '树木规则区域必须是有效、有限且不自交的多边形。', cluster.id) }
      if (rule.mode === 'erase' && rule.canopyCoveragePpm !== 0) fail('CANOPY_RULE_ERASE', '擦除规则的树冠覆盖目标必须为0。', cluster.id)
      if (rule.mode === 'plant' && cluster.palette.length !== 1) fail('CANOPY_RULE_PALETTE', '每条树木区域规则须绑定一个固定树木素材。', cluster.id)
    }
    for (const item of cluster.palette) definition(item.definitionRef, cluster.id, item.kind === 'decoration')
    let live = 0
    for (const [key, member] of Object.entries(cluster.members)) {
      if (member.state === 'deleted') { if (member.entityId !== null) fail('DECORATION_MEMBER', '人工删除槽只保存删除记录，不得继续引用活实例。', cluster.id); continue }
      if (member.state === 'detached' && member.entityId === null) continue
      if (member.entityId === null) { fail('DECORATION_MEMBER', '存活候选槽必须引用真实实例。', cluster.id); continue }
      const row = member.kind === 'prop' ? scene.props[member.entityId] : decorationRecords(scene)[member.entityId]
      if (!row) { fail('DECORATION_MEMBER', '布景成员必须引用相符职责的现存实例。', cluster.id); continue }
      if (row.floorId !== cluster.floorId) fail('DECORATION_MEMBER_FLOOR', '簇及成员须保留同Floor，不能隐式跨层级支撑。', cluster.id)
      if (member.state === 'detached') continue
      live++
      if (occupied.has(member.entityId)) fail('DECORATION_MEMBER_OWNER', '同一实例不能同时归属多个簇。', member.entityId)
      occupied.set(member.entityId, `${cluster.id}/${key}`)
      if (scene.entityLayers[member.entityId] !== scene.entityLayers[cluster.id]) fail('DECORATION_MEMBER_LAYER', '簇及其未退出活成员必须同用户图层。', cluster.id)
      if (member.state === 'managed') {
        if (!sameRef(row.supportRef, cluster.supportRef)) fail('DECORATION_MANAGED_SUPPORT', '自动成员须保留该簇明确支撑，手工重新支撑须转人工记录。', row.id)
        if (row.visibility !== cluster.visibility) fail('DECORATION_MANAGED_VISIBILITY', '自动成员受众必须与所属簇相同。', row.id)
        if (!cluster.palette.some(item => item.kind === member.kind && row.definitionRef?.id === item.definitionRef.id && row.definitionRef.version === item.definitionRef.version)) fail('DECORATION_MANAGED_SOURCE', '自动成员来源须属于该簇冻结palette。', row.id)
      }
    }
    if (live > cluster.maxInstances) fail('DECORATION_CLUSTER_BUDGET', '簇存活实例超过明确最大数量。', cluster.id)
  }
  return errors
}

export function decorationMemberOwner(scene: Readonly<SceneDocument>, entityId: string): { cluster: DecorationCluster; key: string } | null {
  for (const cluster of Object.values(decorationClusterRecords(scene))) for (const [key, member] of Object.entries(cluster.members)) {
    if (member.entityId === entityId && member.state !== 'detached' && member.state !== 'deleted') return { cluster, key }
  }
  return null
}
