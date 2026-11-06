import type { Issue, SceneDocument } from '../model/scene.js'
import { polygonBooleanWithHoles } from '../geometry/polygon-boolean.js'
import { terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { SURFACE_RULE_LIMITS } from './contracts.js'
import { resolveSurfaceRules } from './resolve.js'

/** Shape validation runs first. Geometry and ownership are persisted invariants. */
export function validateSurfaceRules(scene: SceneDocument): Issue[] {
  const errors: Issue[] = [], orders = new Set<string>(), owners = new Map<string, string>(), visible = createPublicVisibility(scene)
  let points = 0
  const fail = (code: string, message: string, entityId: string) => errors.push({ code, message, entityId })
  for (const [key, rule] of Object.entries(scene.surfaceRules ?? {})) {
    if (key !== rule.id) fail('SURFACE_RULE_ID', '地表规则key必须等于其稳定ID。', key)
    const support = scene.terrainAreas[rule.supportRef.id], layer = scene.userLayers[scene.entityLayers[rule.id]]
    if (!support || support.floorId !== rule.floorId) fail('SURFACE_RULE_SUPPORT', '地表规则须引用同Floor的现存明确地形面。', rule.id)
    if (!layer || layer.floorId !== rule.floorId) fail('SURFACE_RULE_LAYER', '地表规则必须具有同Floor的现存用户图层。', rule.id)
    if (rule.visibility === 'public' && !visible.surface(rule.supportRef)) fail('SURFACE_RULE_PRIVATE_SUPPORT', '公共地表规则不能依赖私密支撑。', rule.id)
    const orderKey = JSON.stringify([rule.supportRef, rule.field, rule.visibility, rule.paintOrder])
    if (orders.has(orderKey)) fail('SURFACE_RULE_ORDER', '同支撑、字段和受众内的地表规则绘制顺序必须唯一。', rule.id)
    orders.add(orderKey)
    const polygons = rule.regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm }))
    points += polygons.reduce((sum, region) => sum + region.outer.length + region.holes.reduce((count, ring) => count + ring.length, 0), 0)
    try {
      polygonBooleanWithHoles({ operation: 'union', subject: polygons, clip: [] })
      if (support && polygonBooleanWithHoles({ operation: 'difference', subject: polygons, clip: [{ outer: terrainPoints(support), holes: [] }] }).polygons.length) {
        fail('SURFACE_RULE_BOUNDS', '地表规则区域及孔洞必须完整位于明确支撑面内。', rule.id)
      }
    } catch { fail('SURFACE_RULE_GEOMETRY', '地表规则区域必须是有限、不自交且孔洞合法的独立多边形分量。', rule.id) }
    if (rule.field === 'material') {
      const material = scene.materials[rule.paint.materialRef.id]
      if (!material || material.version !== rule.paint.materialRef.version || !material.applicableSurfaces.includes('terrain')) fail('SURFACE_RULE_MATERIAL', '地表材质须引用可用于地形的现存确切固定版本。', rule.id)
      continue
    }
    if (owners.has(rule.clusterId)) fail('SURFACE_RULE_CLUSTER_OWNER', '每个植物簇只能由一条地表规则拥有，不能重复分配成员所有权。', rule.id)
    owners.set(rule.clusterId, rule.id)
    const cluster = scene.decorationClusters?.[rule.clusterId]
    if (!cluster) { fail('SURFACE_RULE_CLUSTER', '植物规则须引用保存实际素材、种子及成员的现存簇。', rule.id); continue }
    if (cluster.floorId !== rule.floorId || cluster.supportRef.kind !== rule.supportRef.kind || cluster.supportRef.id !== rule.supportRef.id
      || cluster.visibility !== rule.visibility || scene.entityLayers[cluster.id] !== scene.entityLayers[rule.id]) fail('SURFACE_RULE_CLUSTER_BINDING', '植物规则和所属簇须具有同Floor、明确支撑、受众及用户图层。', rule.id)
    if (rule.field === 'trees' && (cluster.palette.length !== 1 || cluster.palette[0].kind !== 'prop')) fail('SURFACE_RULE_TREE_SOURCE', '树木规则须使用单一完整物件素材，保留真实占地及支撑。', rule.id)
    const b = cluster.boundsMm
    if (rule.regionsMm.some(region => region.outerMm.some(point => point.x < b.x || point.y < b.y || point.x > b.x + b.width || point.y > b.y + b.height))) fail('SURFACE_RULE_CLUSTER_BOUNDS', '植物规则的完整笔迹须位于所属簇的明确生成范围。', rule.id)
  }
  if (points > SURFACE_RULE_LIMITS.scenePoints) errors.push({ code: 'SURFACE_RULE_BUDGET', message: '地表规则累计顶点超过32768保护值。' })
  // Per-rule storage protection alone cannot guarantee that the combined stack
  // fits the boolean resolver's stricter transient ring/point budgets.
  if (!errors.length) {
    try { resolveSurfaceRules(scene) }
    catch (error) { errors.push({ code: 'SURFACE_RULE_RESOLVE', message: `地表规则叠加结果超出可解析几何范围：${error instanceof Error ? error.message : String(error)}` }) }
  }
  return errors
}
