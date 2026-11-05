import type { CompositionContent } from '../model/appearance.js'
import type { DecorationCluster, SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { TaskBudgetProfile } from '../budget/task-budget.js'
import { applyCommands } from '../commands/commands.js'
import { decorationAsProp } from '../decorations/geometry.js'
import { decorationProtectedGeometry, estimateSurfaceRegionInstances } from '../decorations/generate.js'
import { definitionPresentation, propPaintPolygon } from '../appearance/presentation.js'
import { polygonDistance, polygonInside, propFootprint, supportedPolygon } from '../geometry/geometry.js'
import { inspectSurfaceRuleChanges } from '../surface-rules/commands.js'
import { resolveSurfaceRules } from '../surface-rules/resolve.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { canonicalJson } from '../validation/json.js'
import { forestEntityId, forestRectangle } from './domains/forest/index.js'
import { assertLocalManaged, finishLocalOwnership, localOwner, type LocalDomainResult, type LocalWrite } from './local-common.js'

export interface ForestZoneRegenerationRequest {
  recipeId: string; zoneId: string; role: 'tree' | 'shrub' | 'grass'; coveragePpm: number
}
const same = (left: unknown, right: unknown) => canonicalJson(left ?? null) === canonicalJson(right ?? null)
const fields = {
  prop: ['geometry', 'properties', 'appearance', 'source'],
  decoration: ['geometry', 'properties', 'appearance', 'source'],
} satisfies Record<string, LocalWrite['fields']>
function memberEntity(document: SceneDocument, member: DecorationCluster['members'][string]) {
  return member.entityId ? member.kind === 'prop' ? document.props[member.entityId] : document.decorations[member.entityId] : null
}

/** Reflow only the selected saved forest channel. The existing cluster owns its
 * slot-level manual/deleted/detached decisions; initial soft reservations never
 * authorize moving a manually placed member back into the original zone. */
export function regenerateForestZone(content: CompositionContent, request: ForestZoneRegenerationRequest, runtime: PreparationContext,
  options: { profile: TaskBudgetProfile; checkCancelled: () => void }): LocalDomainResult {
  options.checkCancelled()
  if (!Number.isSafeInteger(request.coveragePpm) || request.coveragePpm < 0 || request.coveragePpm > 1_000_000) throw new Error('森林覆盖率须为0–1000000整数。')
  const before = content.document, legacy = getLegacyGeneration(before)!, recipe = legacy.recipes[request.recipeId]
  if (!recipe || !('domain' in recipe) || recipe.domain !== 'forest') throw new Error('森林局部更新须选择已保存的严格森林配方。')
  const zone = recipe.parameters.zones.find(row => row.id === request.zoneId), vegetation = zone?.vegetation.find(row => row.role === request.role)
  if (!zone || !vegetation) throw new Error('选定林区或通道不属于该森林配方。')
  const channel = request.role === 'tree' ? 'trees' : request.role === 'shrub' ? 'shrubs' : 'grass'
  const ruleId = forestEntityId(before.sceneId, recipe.seed, `surface:${zone.id}:${channel}`), rule = before.surfaceRules[ruleId]
  if (!rule || rule.field !== channel) throw new Error('选定森林通道规则已删除或退出，不能重建。')
  const ruleOwner = assertLocalManaged(content, 'surfaceRule', ruleId, ['properties'])
  if (legacy.rules[ruleOwner.ruleId]?.recipeRef.id !== recipe.id) throw new Error('森林通道归属与选择的配方不同。')
  const cluster = before.decorationClusters[rule.clusterId]
  if (!cluster) throw new Error('森林通道实际成员簇缺失。')
  const clusterOwner = assertLocalManaged(content, 'decorationCluster', cluster.id, ['geometry', 'properties', 'source'])
  if (legacy.rules[clusterOwner.ruleId]?.recipeRef.id !== recipe.id) throw new Error('森林成员簇归属与选择的配方不同。')
  // A moved/deleted child marks aggregate membership manual. Slot states remain
  // the authority over the managed subset, never permission to reclaim it all.
  const held = new Map<string, { slot: DecorationCluster['members'][string]; entity: ReturnType<typeof memberEntity>; layer: string | null }>()
  const eligible = new Set<string>()
  for (const [key, member] of Object.entries(cluster.members)) {
    const row = memberEntity(before, member), locked = row && (row.editLocked || before.userLayers[before.entityLayers[row.id]]?.editLocked)
    const noted = member.entityId && Object.values(before.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === member.entityId)
    if (member.state !== 'managed' || !row || locked || noted) {
      held.set(key, { slot: member, entity: row, layer: row ? before.entityLayers[row.id] ?? null : null })
      continue
    }
    const owner = localOwner(before, member.kind, row.id)
    if (legacy.rules[owner.ruleId]?.recipeRef.id !== recipe.id || owner.state !== 'managed' || owner.manualFields.length) throw new Error('森林成员的槽位与人工生成归属不一致，拒绝覆盖。')
    assertLocalManaged(content, member.kind, row.id, fields[member.kind], true)
    eligible.add(row.id)
  }
  const effective = resolveSurfaceRules(before).find(row => row.rule.id === ruleId)?.regionsMm ?? []
  const target = estimateSurfaceRegionInstances(before, cluster.palette, { polygons: effective.map(region => ({ outer: region.outerMm, holes: region.holesMm })), coveragePpm: request.coveragePpm })
  options.checkCancelled()
  // Omitting a task-budget override deliberately keeps the native ordinary
  // transaction ceiling, including actual member and metadata expansion.
  const document = applyCommands(before, [{ type: 'updateSurfaceVegetation', id: ruleId, coveragePpm: request.coveragePpm }], runtime, { appearance: content.appearance })
  options.checkCancelled()
  const nextCluster = document.decorationClusters[cluster.id]
  if (!nextCluster) throw new Error('森林局部更新不能删除成员簇。')
  for (const [key, record] of held) {
    const member = nextCluster.members[key], row = member ? memberEntity(document, member) : null
    if (!same(record.slot, member) || !same(record.entity, row) || (row ? document.entityLayers[row.id] ?? null : null) !== record.layer) throw new Error('森林局部更新不能改变人工、删除、退出、锁定或附注成员。')
  }
  const writes: LocalWrite[] = []
  if (!same(before.surfaceRules[ruleId], document.surfaceRules[ruleId])) writes.push({ kind: 'surfaceRule', entityId: ruleId, fields: ['properties'] })
  if (!same(cluster, nextCluster)) writes.push({ kind: 'decorationCluster', entityId: cluster.id, fields: ['membership'] })
  const selectedIds = new Set([...Object.values(cluster.members), ...Object.values(nextCluster.members)].flatMap(member => member.entityId ?? []))
  for (const kind of ['prop', 'decoration'] as const) {
    const collection = kind === 'prop' ? 'props' : 'decorations'
    for (const entityId of selectedIds) {
      const old = before[collection][entityId], row = document[collection][entityId]
      if (same(old, row) && before.entityLayers[entityId] === document.entityLayers[entityId]) continue
      if (old && !eligible.has(entityId)) throw new Error('森林局部更新触及未授权成员。')
      if (row) {
        const prop = kind === 'prop' ? document.props[entityId] : decorationAsProp(document, document.decorations[entityId])
        const footprint = propFootprint(prop), paint = propPaintPolygon(prop, definitionPresentation(content.appearance, prop.definitionRef))
        if (!polygonInside(propPaintPolygon(prop), forestRectangle(document.floors[prop.floorId].boundsMm))
          || !polygonInside(footprint, zone.boundaryMm) || !supportedPolygon(document, footprint, cluster.supportRef, prop.floorId)
          || decorationProtectedGeometry(document, nextCluster).some(record => polygonDistance(footprint, record.polygon) < record.marginMm || polygonDistance(paint, record.polygon) < record.marginMm)) throw new Error('森林新增或改变成员的完整占地、绘制范围、支撑或净空未通过。')
      }
      writes.push({ kind, entityId, fields: [...fields[kind]] })
    }
    for (const [entityId, row] of Object.entries(before[collection])) if (!selectedIds.has(entityId) && (!same(row, document[collection][entityId]) || before.entityLayers[entityId] !== document.entityLayers[entityId])) throw new Error('森林局部更新改变范围外物件。')
  }
  for (const [id, old] of Object.entries(before.surfaceRules)) if (id !== ruleId && !same(old, document.surfaceRules[id])) throw new Error('森林局部更新改变了其他通道规则。')
  for (const [id, old] of Object.entries(before.decorationClusters)) if (id !== cluster.id && !same(old, document.decorationClusters[id])) throw new Error('森林局部更新改变了其他成员簇。')
  finishLocalOwnership(before, document, writes, recipe.id)
  const impact = inspectSurfaceRuleChanges(before, document), live = Object.values(nextCluster.members).filter(member => member.entityId && member.state !== 'detached').length
  options.checkCancelled()
  return { document, writes, readIds: [...new Set([recipe.id, ruleId, cluster.id, cluster.supportRef.id, ...impact.affectedIds, ...impact.layerIds, ...cluster.palette.map(item => item.definitionRef.id)])].sort(),
    notes: [`选定林区${zone.id}的${request.role}目标${target}件，当前实际${live}件；人工、删除、退出及锁定槽保持。`, ...(live < target ? ['有限位置与固定尺寸/支撑/净空使目标尚未落满；未降低输入覆盖率。'] : [])] }
}
