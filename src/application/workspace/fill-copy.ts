import { z } from 'zod'
import { polygonsOverlap, propFootprint, supportedPolygon } from '../../shared/geometry/geometry.js'
import { effectiveEditLocked } from '../../shared/commands/layers.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import type { PointMm, Prop, SceneDocument, SurfaceRef } from '../../shared/model/scene.js'
import { prepareCompositionCommands, type PrepareOptions } from './prepare.js'
import type { EditableProject } from './project.js'
import { inspectJsonInput } from '../../shared/validation/json.js'
import { commandSelectionLimit, parseCommandBudgetProfile, type CommandBudgetProfile } from '../../shared/budget/command-budget.js'

export type FillCopyRequest = { sourceId: string; count: number; stepMm: PointMm; allowOverlap: boolean }
export interface FillCopyReport {
  sourceId: string
  sourceKind: 'prop' | 'prefab'
  count: number
  stepMm: PointMm
  anchorMm: PointMm
  positions: PointMm[]
  sourcePropIds: string[]
  dependencyIds: string[]
  layerIds: string[]
  overlaps: { copyIndex: number; sourcePropId: string; otherId: string }[]
  issues: string[]
  minimumCost: number
}

const safeInteger = z.number().finite().refine(Number.isSafeInteger, '必须是安全整数')
const requestSchema = z.object({ sourceId: z.string().min(1).max(256), count: safeInteger.refine(value => value > 0, '数量必须大于零'),
  stepMm: z.object({ x: safeInteger, y: safeInteger }).strict(), allowOverlap: z.boolean() }).strict()
const MAX_REPORTED_OVERLAPS = 4096

function checkedRequest(input: FillCopyRequest): FillCopyRequest {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(`填充参数无效：${issue.message}`)
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) throw new Error(`填充参数无效：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  return parsed.data
}
function safePoint(anchor: PointMm, step: PointMm, index: number): PointMm | undefined {
  const x = BigInt(anchor.x) + BigInt(step.x) * BigInt(index), y = BigInt(anchor.y) + BigInt(step.y) * BigInt(index)
  if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < BigInt(Number.MIN_SAFE_INTEGER)
    || y > BigInt(Number.MAX_SAFE_INTEGER) || y < BigInt(Number.MIN_SAFE_INTEGER)) return undefined
  return { x: Number(x), y: Number(y) }
}
function supportElevation(scene: SceneDocument, ref: SurfaceRef): number | undefined {
  if (ref.kind === 'floor') return scene.floors[ref.id] ? 0 : undefined
  if (ref.kind === 'terrainArea') return scene.terrainAreas[ref.id]?.groundElevationMm
  return scene.rooms[ref.id]?.groundElevationMm
}
function managedByCluster(scene: SceneDocument, propId: string): boolean {
  return Object.values(scene.decorationClusters ?? {}).some(group => Object.values(group.members).some(member =>
    member.kind === 'prop' && member.entityId === propId && member.state !== 'detached' && member.state !== 'deleted'))
}
function managedByOtherGroup(scene: SceneDocument, propId: string): boolean {
  return [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].some(group =>
    Object.values(group.members).some(member => member.propId === propId))
}
function addSupportClosure(scene: SceneDocument, ref: SurfaceRef, dependencies: Set<string>): void {
  if (dependencies.has(ref.id)) return
  dependencies.add(ref.id)
  if (ref.kind === 'room') {
    const room = scene.rooms[ref.id]
    if (room) addSupportClosure(scene, room.supportRef, dependencies)
  }
}
function addPropDependencies(scene: SceneDocument, prop: Prop, dependencies: Set<string>): void {
  dependencies.add(prop.id)
  addSupportClosure(scene, prop.supportRef, dependencies)
  if (prop.roomId) addSupportClosure(scene, { kind: 'room', id: prop.roomId }, dependencies)
  if (prop.definitionRef) dependencies.add(prop.definitionRef.id)
}
function bounds(polygon: PointMm[]) {
  return { minX: Math.min(...polygon.map(point => point.x)), minY: Math.min(...polygon.map(point => point.y)),
    maxX: Math.max(...polygon.map(point => point.x)), maxY: Math.max(...polygon.map(point => point.y)) }
}
function positiveBoundsOverlap(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}
function visualFootprint(prop: Prop): PointMm[] {
  const { x, y, width, height } = prop.visualBoundsMm, radians = prop.rotationDeg * Math.PI / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
    .map(point => ({ x: prop.positionMm.x + point.x * cos - point.y * sin, y: prop.positionMm.y + point.x * sin + point.y * cos }))
}
function insideFloor(scene: SceneDocument, prop: Prop): boolean {
  const floor = scene.floors[prop.floorId]
  if (!floor) return false
  const { x, y, width, height } = floor.boundsMm
  return visualFootprint(prop).every(point => point.x >= x && point.y >= y && point.x <= x + width && point.y <= y + height)
}
function saturatedCost(count: number, perCopy: number): number {
  const value = BigInt(count) * BigInt(perCopy)
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value)
}

/** Read-only fill planning. Positions are the new anchors in copy order, starting at 1. */
export function inspectFillCopy(scene: SceneDocument, input: FillCopyRequest, budgetInput?: CommandBudgetProfile): FillCopyReport {
  const budget = budgetInput ? parseCommandBudgetProfile(budgetInput) : undefined
  const request = checkedRequest(input), issues: string[] = [], dependencies = new Set<string>(), layerIds = new Set<string>()
  let sourceKind: FillCopyReport['sourceKind'], anchorMm: PointMm, sourceProps: Prop[], groupId: string | undefined
  const source = Object.hasOwn(scene.props, request.sourceId) ? scene.props[request.sourceId] : undefined
  const prefab = Object.hasOwn(scene.prefabInstances, request.sourceId) ? scene.prefabInstances[request.sourceId] : undefined
  if (source) {
    if (managedByOtherGroup(scene, source.id)) throw new Error('填充只支持独立物件；组合或散布成员须先明确拆开或脱离。')
    if (managedByCluster(scene, source.id)) throw new Error('布景簇成员须先退出布景簇，不能作为独立物件填充。')
    sourceKind = 'prop'; anchorMm = { ...source.positionMm }; sourceProps = [source]
  } else if (prefab) {
    sourceKind = 'prefab'; groupId = prefab.id; anchorMm = { ...prefab.anchorMm }
    sourceProps = []
    for (const member of Object.values(prefab.members)) if (member.propId !== null) {
      const prop = scene.props[member.propId]
      if (!prop) throw new Error('组合含缺失活成员，不能填充。')
      sourceProps.push(prop)
    }
    if (!sourceProps.length) throw new Error('组合没有可复制的完整活成员。')
    dependencies.add(prefab.id); dependencies.add(prefab.definitionRef.id)
  } else throw new Error(`填充源不存在或不支持：${request.sourceId}。`)

  const sourcePropIds = sourceProps.map(prop => prop.id)
  for (const prop of sourceProps) addPropDependencies(scene, prop, dependencies)
  for (const id of dependencies) {
    const layerId = scene.entityLayers?.[id]
    if (layerId) layerIds.add(layerId)
    if (Object.hasOwn(scene.props, id) || Object.hasOwn(scene.prefabInstances, id) || Object.hasOwn(scene.rooms, id) || Object.hasOwn(scene.terrainAreas, id)) {
      if (effectiveEditLocked(scene, id)) issues.push(`源依赖 ${id} 已锁定，不能填充。`)
    }
  }
  if (groupId && effectiveEditLocked(scene, groupId) && !issues.some(issue => issue.includes(groupId!))) issues.push(`源组合 ${groupId} 或其成员/图层已锁定，不能填充。`)

  const perCopyCost = sourceKind === 'prop' ? 1 : sourceProps.length + 1
  const minimumCost = saturatedCost(request.count, perCopyCost)
  const report: FillCopyReport = { sourceId: request.sourceId, sourceKind, count: request.count, stepMm: { ...request.stepMm }, anchorMm,
    positions: [], sourcePropIds, dependencyIds: [...dependencies], layerIds: [...layerIds], overlaps: [], issues, minimumCost }

  const limit = commandSelectionLimit(budget)
  if (request.count > limit) {
    issues.push(`一次填充最多检查${limit}份；本次请求${request.count}份已拒绝，不会截断数量。`)
    return report
  }
  if (minimumCost > limit) {
    issues.push(`填充最低展开成本${minimumCost}超过${limit}条事务预算，整笔拒绝。`)
    return report
  }
  if (!request.allowOverlap && request.stepMm.x === 0 && request.stepMm.y === 0) issues.push('填充副本与源的位置完全相同；要明确采用重叠，请启用“允许重叠”。')
  for (let index = 1; index <= request.count; index++) {
    const point = safePoint(anchorMm, request.stepMm, index)
    const offset = safePoint({ x: 0, y: 0 }, request.stepMm, index)
    if (!point || !offset || sourceProps.some(prop => !safePoint(prop.positionMm, request.stepMm, index))) {
      issues.push(`第${index}份副本的锚点、偏移或成员坐标超过安全整数范围，整笔拒绝。`)
      report.positions = []
      return report
    }
    report.positions.push(point)
  }

  const existing = Object.values(scene.props).map(prop => ({ prop, elevation: supportElevation(scene, prop.supportRef), footprint: propFootprint(prop) }))
  const previousCopies: { prop: Prop; sourcePropId: string; copyIndex: number; elevation: number | undefined; footprint: PointMm[]; bounds: ReturnType<typeof bounds> }[] = []
  outer: for (let copyIndex = 1; copyIndex <= request.count; copyIndex++) {
    const current = sourceProps.map(prop => {
      const moved = { ...prop, positionMm: safePoint(prop.positionMm, request.stepMm, copyIndex)! }
      const footprint = propFootprint(moved)
      if (!supportedPolygon(scene, footprint, moved.supportRef, moved.floorId)) issues.push(`第${copyIndex}份副本 ${prop.id} 的完整旋转占地不在原声明支撑面内。`)
      if (!insideFloor(scene, moved)) issues.push(`第${copyIndex}份副本 ${prop.id} 的视觉范围超出Floor。`)
      return { prop: moved, sourcePropId: prop.id, copyIndex, elevation: supportElevation(scene, prop.supportRef), footprint, bounds: bounds(footprint) }
    })
    for (const candidate of current) {
      const candidateBounds = candidate.bounds
      for (const other of existing) {
        if (other.prop.floorId !== candidate.prop.floorId || other.elevation !== candidate.elevation || other.elevation === undefined) continue
        if (!positiveBoundsOverlap(candidateBounds, bounds(other.footprint)) || !polygonsOverlap(candidate.footprint, other.footprint)) continue
        report.overlaps.push({ copyIndex, sourcePropId: candidate.sourcePropId, otherId: other.prop.id })
        if (report.overlaps.length >= MAX_REPORTED_OVERLAPS) { issues.push(`重叠影响超过${MAX_REPORTED_OVERLAPS}条报告上限，无法安全显示完整范围。`); break outer }
      }
      for (const other of previousCopies) {
        if (other.copyIndex === copyIndex || other.prop.floorId !== candidate.prop.floorId || other.elevation !== candidate.elevation || other.elevation === undefined) continue
        if (!positiveBoundsOverlap(candidateBounds, other.bounds) || !polygonsOverlap(candidate.footprint, other.footprint)) continue
        report.overlaps.push({ copyIndex, sourcePropId: candidate.sourcePropId, otherId: `副本${other.copyIndex}:${other.sourcePropId}` })
        if (report.overlaps.length >= MAX_REPORTED_OVERLAPS) { issues.push(`重叠影响超过${MAX_REPORTED_OVERLAPS}条报告上限，无法安全显示完整范围。`); break outer }
      }
    }
    previousCopies.push(...current)
  }
  if (!request.allowOverlap && report.overlaps.length) issues.push(`填充包含${report.overlaps.length}处正面积物件占地重叠；关闭“允许重叠”后整笔拒绝。`)
  return report
}

/** Prepare all requested copies as one fully materialized, exactly budgeted candidate. */
export async function prepareFillCopy(input: EditableProject, request: FillCopyRequest, options: PrepareOptions): Promise<{
  project: EditableProject; commands: CompositionCommand[]; report: FillCopyReport; cost: { total: number; limit: number }
}> {
  const report = inspectFillCopy(input.document, request, options.budget)
  if (report.issues.length) throw new Error(report.issues.join('；'))
  const commands: CompositionCommand[] = []
  for (let index = 1; index <= report.count; index++) {
    if (report.sourceKind === 'prop') {
      commands.push({ type: 'copyProp', id: report.sourceId, newId: options.runtime.ids.nextId(),
        offsetMm: { x: report.stepMm.x * index, y: report.stepMm.y * index } })
    } else {
      const source = input.document.prefabInstances[report.sourceId]
      const memberIds = Object.fromEntries(Object.entries(source.members).flatMap(([key, member]) => member.propId === null ? [] : [[key, options.runtime.ids.nextId()]]))
      commands.push({ type: 'duplicatePrefab', id: report.sourceId, newId: options.runtime.ids.nextId(), memberIds,
        offsetMm: { x: report.stepMm.x * index, y: report.stepMm.y * index } })
    }
  }
  let total = 0
  const project = await prepareCompositionCommands(input, commands, { ...options, baseline: input, onOperationCost: cost => { total = cost; options.onOperationCost?.(cost) } })
  return { project, commands, report, cost: { total, limit: commandSelectionLimit(options.budget) } }
}
