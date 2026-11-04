import { z } from 'zod'
import type { AppearanceGraph } from '../model/appearance.js'
import type { DecorationCluster, Editable, SceneDocument, SurfaceRule, SurfaceRuleField, SurfaceRuleRegion } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { editable, id, int, paint, positive, versionRef, visibility } from '../validation/primitives.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../geometry/polygon-boolean.js'
import { terrainPoints } from '../geometry/geometry.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { decorationClusterSchema } from '../decorations/contracts.js'
import { buildDecorationRegeneration } from '../decorations/generate.js'
import { inspectDecorationChanges } from '../decorations/commands.js'
import { surfaceRuleRegionSchema } from './contracts.js'
import { resolveSurfaceRules } from './resolve.js'

const field = z.enum(['material', 'trees', 'shrubs', 'grass'])
const region = z.array(surfaceRuleRegionSchema).min(1).max(128)
const supportRef = z.object({ kind: z.literal('terrainArea'), id }).strict()
const base = { id, floorId: editable.floorId, layerId: id, visibility, supportRef, regionsMm: region }
export const surfaceRuleCommandSchemas = [
  z.object({ type: z.literal('paintSurfaceMaterial'), ...base, paint, blendWidthMm: int.min(0).max(10_000) }).strict(),
  z.object({ type: z.literal('paintSurfaceVegetation'), ...base, field: z.enum(['trees', 'shrubs', 'grass']), clusterId: id,
    coveragePpm: int.min(0).max(1_000_000), seed: z.string().min(1).max(128),
    palette: decorationClusterSchema.shape.palette, spacingMm: positive, clusterRadiusMm: positive, clearanceMm: positive,
  }).strict(),
  z.object({ type: z.literal('eraseSurfaceRules'), supportRef, field, visibility, regionsMm: region }).strict(),
  z.object({ type: z.literal('updateSurfaceVegetation'), id, coveragePpm: int.min(0).max(1_000_000) }).strict(),
  z.object({ type: z.literal('deleteSurfaceRule'), id }).strict(),
] as const
export type SurfaceRuleCommand = z.infer<typeof surfaceRuleCommandSchemas[number]>
const types = new Set(surfaceRuleCommandSchemas.map(schema => schema.shape.type.value))
export const isSurfaceRuleCommand = (command: { type: string }): command is SurfaceRuleCommand => types.has(command.type as SurfaceRuleCommand['type'])
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const polygons = (regions: SurfaceRuleRegion[]): PolygonWithHoles[] => regions.map(row => ({ outer: row.outerMm, holes: row.holesMm }))
const regions = (value: PolygonWithHoles[]): SurfaceRuleRegion[] => value.map(row => ({ outerMm: row.outer, holesMm: row.holes }))
const emptyRegion: { polygons: PolygonWithHoles[]; coveragePpm: number } = { polygons: [], coveragePpm: 0 }
const unlocked = (scene: SceneDocument, row: Editable) => {
  if (row.editLocked || scene.userLayers[scene.entityLayers[row.id]]?.editLocked) throw new Error(`地表规则涉及已锁定实体或图层：${row.id}。`)
}
const bounds = (input: SurfaceRuleRegion[]) => {
  const points = input.flatMap(row => row.outerMm), xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
export function surfaceRuleForCluster(scene: SceneDocument, clusterId: string): SurfaceRule | undefined {
  return Object.values(scene.surfaceRules ?? {}).find(rule => rule.field !== 'material' && rule.clusterId === clusterId)
}
export function assertSurfaceRuleOwnerUnlocked(scene: SceneDocument, clusterId: string): void {
  const rule = surfaceRuleForCluster(scene, clusterId)
  if (rule) unlocked(scene, rule)
}

export function inspectSurfaceRuleChanges(before: SceneDocument, after: SceneDocument) {
  const decoration = inspectDecorationChanges(before, after), left = new Map(resolveSurfaceRules(before).map(row => [row.rule.id, row.regionsMm]))
  const right = new Map(resolveSurfaceRules(after).map(row => [row.rule.id, row.regionsMm]))
  const ids = new Set([...Object.keys(before.surfaceRules ?? {}), ...Object.keys(after.surfaceRules ?? {})])
  const changed = new Set<string>()
  for (const id of ids) if (!same(before.surfaceRules?.[id], after.surfaceRules?.[id]) || !same(left.get(id), right.get(id))) changed.add(id)
  const affected = new Set(decoration.affectedIds), layers = new Set(decoration.layerIds)
  for (const id of changed) {
    const old = before.surfaceRules?.[id], rule = after.surfaceRules?.[id]
    affected.add(id)
    for (const row of [old, rule]) if (row) {
      affected.add(row.supportRef.id)
      if (row.field !== 'material') affected.add(row.clusterId)
      const layer = (row === old ? before : after).entityLayers[row.id]
      if (layer) layers.add(layer)
    }
  }
  for (const id of affected) for (const scene of [before, after]) if (scene.entityLayers[id]) layers.add(scene.entityLayers[id])
  return { changedIds: [...new Set([...decoration.changedIds, ...changed])].sort(), affectedIds: [...affected].sort(), layerIds: [...layers].sort(), commandCost: decoration.commandCost + changed.size }
}

/** Clip every explicit support independently; no support or physical shape is inferred. */
export function clipSurfaceRuleRegions(scene: SceneDocument, areaId: string, input: SurfaceRuleRegion[]): SurfaceRuleRegion[] {
  const area = scene.terrainAreas[areaId]
  if (!area) throw new Error('地表规则的明确支撑不存在。')
  return regions(polygonBooleanWithHoles({ operation: 'intersection', subject: polygons(input), clip: [{ outer: terrainPoints(area), holes: [] }] }).polygons)
}

/** One candidate edits rule geometry, exact generated members and protection records together. */
export function applySurfaceRuleCommand(scene: SceneDocument, command: SurfaceRuleCommand, context: PreparationContext, appearance?: AppearanceGraph) {
  if (scene.schemaVersion !== 8) throw new Error('连续地表区域规则需要显式完整v8副本。')
  const before = cloneJson(scene), rules = scene.surfaceRules!, clusters = scene.decorationClusters!
  const beforeResolved = new Map(resolveSurfaceRules(before).map(row => [row.rule.id, row.regionsMm]))
  const requireRule = (id: string) => { const rule = rules[id]; if (!rule) throw new Error(`地表规则不存在：${id}。`); unlocked(before, rule); return rule }
  const checkSupport = (areaId: string) => {
    const area = scene.terrainAreas[areaId]
    if (!area) throw new Error('地表规则支撑不存在。')
    unlocked(before, area)
    return area
  }
  if (command.type === 'paintSurfaceMaterial' || command.type === 'paintSurfaceVegetation') {
    const used = geometryIdentityIds(scene), area = checkSupport(command.supportRef.id), layer = scene.userLayers[command.layerId]
    if (used.has(command.id) || scene.userLayers[command.id]) throw new Error('新地表规则必须使用未分配的独立ID。')
    if (!layer || layer.floorId !== command.floorId || layer.editLocked || area.floorId !== command.floorId) throw new Error('地表规则须使用同Floor未锁定的支撑与图层。')
    if (command.visibility === 'public' && area.visibility !== 'public') throw new Error('公开规则不能依赖私密地形面。')
    const regionsMm = clipSurfaceRuleRegions(scene, area.id, command.regionsMm)
    if (!regionsMm.length) throw new Error('绘制区域与选定支撑没有有效交集。')
    const paintOrder = Math.max(0, ...Object.values(rules).map(rule => rule.paintOrder)) + 1
    const common = { id: command.id, floorId: command.floorId, editLocked: false, supportRef: cloneJson(command.supportRef), visibility: command.visibility, regionsMm, paintOrder }
    if (command.type === 'paintSurfaceMaterial') rules[command.id] = { ...common, field: 'material', paint: cloneJson(command.paint), blendWidthMm: command.blendWidthMm }
    else {
      if (used.has(command.clusterId) || scene.userLayers[command.clusterId] || command.clusterId === command.id) throw new Error('植被簇与规则必须各自使用未分配的独立ID。')
      const cluster: DecorationCluster = { id: command.clusterId, floorId: command.floorId, editLocked: false, visibility: command.visibility, supportRef: cloneJson(command.supportRef),
        boundsMm: bounds(regionsMm), algorithmVersion: 'cluster-v1', seed: command.seed, palette: cloneJson(command.palette), spacingMm: command.spacingMm,
        clusterRadiusMm: command.clusterRadiusMm, clearanceMm: command.clearanceMm, maxInstances: 64, members: {} }
      if (command.field === 'trees' && cluster.palette.some(item => item.kind !== 'prop' || !scene.propDefinitions[item.definitionRef.id]?.tags.some(tag => /tree|树/i.test(tag)))) throw new Error('树通道须使用固定树木完整物件。')
      if (command.field !== 'trees' && cluster.palette.some(item => item.kind !== 'decoration')) throw new Error('灌木与草簇通道须使用无阻挡的轻量装饰。')
      clusters[cluster.id] = cluster; scene.entityLayers[cluster.id] = command.layerId
      rules[command.id] = { ...common, field: command.field, clusterId: cluster.id, coveragePpm: command.coveragePpm }
    }
    scene.entityLayers[command.id] = command.layerId
  } else if (command.type === 'updateSurfaceVegetation') {
    const rule = requireRule(command.id)
    if (rule.field === 'material') throw new Error('覆盖程度只用于树、灌木或草簇。')
    checkSupport(rule.supportRef.id); rule.coveragePpm = command.coveragePpm
  } else if (command.type === 'deleteSurfaceRule') {
    const rule = requireRule(command.id); checkSupport(rule.supportRef.id)
    delete rules[rule.id]; delete scene.entityLayers[rule.id]
  } else {
    checkSupport(command.supportRef.id)
    let remainder = polygons(clipSurfaceRuleRegions(scene, command.supportRef.id, command.regionsMm))
    const ordered = Object.values(rules).filter(rule => rule.supportRef.id === command.supportRef.id && rule.field === command.field && rule.visibility === command.visibility)
      .sort((a, b) => b.paintOrder - a.paintOrder || b.id.localeCompare(a.id))
    for (const rule of ordered) {
      if (!remainder.length) break
      const visible = polygons(beforeResolved.get(rule.id) ?? [])
      const owned = polygonBooleanWithHoles({ operation: 'intersection', subject: visible, clip: remainder }).polygons
      if (!owned.length) continue
      unlocked(before, rule)
      const next = polygonBooleanWithHoles({ operation: 'difference', subject: polygons(rule.regionsMm), clip: owned }).polygons
      if (next.length) rule.regionsMm = regions(next)
      else { delete rules[rule.id]; delete scene.entityLayers[rule.id] }
      remainder = polygonBooleanWithHoles({ operation: 'difference', subject: remainder, clip: owned }).polygons
    }
  }
  const afterResolved = new Map(resolveSurfaceRules(scene).map(row => [row.rule.id, row.regionsMm]))
  const affectedRules = new Set([...Object.keys(before.surfaceRules!), ...Object.keys(rules)].filter(id => !same(before.surfaceRules![id], rules[id]) || !same(beforeResolved.get(id), afterResolved.get(id))))
  const install = (cluster: DecorationCluster, effective: { polygons: PolygonWithHoles[]; coveragePpm: number }) => {
    const owner = Object.values(rules).find(rule => rule.field !== 'material' && rule.clusterId === cluster.id)
    if (owner?.regionsMm.length) cluster.boundsMm = bounds(owner.regionsMm)
    const result = buildDecorationRegeneration(scene, cluster, context, appearance, effective)
    for (const id of [...result.removePropIds, ...result.removeDecorationIds]) {
      if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === id)
        || scene.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityId === id))) throw new Error(`植被移除仍涉及注记或路径依赖：${id}。`)
      delete scene.props[id]; delete scene.decorations![id]; delete scene.entityLayers[id]
    }
    for (const row of result.props) { scene.props[row.id] = row; scene.entityLayers[row.id] = scene.entityLayers[cluster.id] }
    for (const row of result.decorations) { scene.decorations![row.id] = row; scene.entityLayers[row.id] = scene.entityLayers[cluster.id] }
    clusters[cluster.id] = result.cluster
  }
  // Clear removed owners first so restored older rules can use their space.
  for (const id of affectedRules) {
    const old = before.surfaceRules![id]
    if (!old || rules[id] || old.field === 'material') continue
    const cluster = clusters[old.clusterId]; unlocked(before, cluster); install(cluster, emptyRegion)
    if (!Object.keys(clusters[cluster.id].members).length) { delete clusters[cluster.id]; delete scene.entityLayers[cluster.id] }
  }
  for (const rule of Object.values(rules).filter(rule => affectedRules.has(rule.id)).sort((a, b) => b.paintOrder - a.paintOrder)) {
    unlocked(before, rule); checkSupport(rule.supportRef.id)
    if (rule.field === 'material') continue
    const cluster = clusters[rule.clusterId]; unlocked(before, cluster)
    install(cluster, { polygons: polygons(afterResolved.get(rule.id) ?? []), coveragePpm: rule.coveragePpm })
  }
  const impact = inspectSurfaceRuleChanges(before, scene), changed = new Set(impact.changedIds)
  for (const id of affectedRules) if (before.surfaceRules![id]) unlocked(before, before.surfaceRules![id])
  for (const id of impact.changedIds) {
    const old = before.props[id] ?? before.decorations?.[id] ?? before.decorationClusters?.[id]
    if (old) unlocked(before, old)
  }
  if (impact.commandCost > 256) throw new Error('地表规则及植被成员展开超过256条操作预算，不能拆批绕过。')
  return impact
}

/** Field/audience-local operations can be composed atomically for explicit connected surfaces. */
export type SurfaceRuleChannel = { field: SurfaceRuleField; visibility: SurfaceRule['visibility'] }
