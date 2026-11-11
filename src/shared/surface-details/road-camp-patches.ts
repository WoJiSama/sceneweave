import polygonClipping, { type Polygon } from 'polygon-clipping'
import { z } from 'zod'
import type { Path, PointMm, SurfaceOverlay } from '../model/scene.js'
import type { AppearanceSource, CompositionContent } from '../model/appearance.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { pathPolygon, terrainPoints } from '../geometry/geometry.js'
import { polygonBooleanExact } from '../geometry/polygon-boolean.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { MANUAL_TRANSACTION_BUDGET, assertCommandBudget, measureCommandBudget } from '../budget/command-budget.js'
import { captureExecutionBudget, TASK_BUDGET_PROFILES, type ExecutionBudget } from '../budget/task-budget.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../validation/json.js'
import { id, nonnegative, paint as paintSchema, point, positive } from '../validation/primitives.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateAppearanceGraph } from '../validation/content.js'
import { addSurfaceAppearanceSource } from '../appearance/graph.js'
import { sha256Text } from '../validation/hash.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../terrain-generation/integrity.js'

const shoulderSchema = z.object({ leftWidthMm: positive, rightWidthMm: positive, variationMm: nonnegative,
  sampleSpacingMm: positive, blendWidthMm: nonnegative, seed: id }).strict().superRefine((value, ctx) => {
  if (value.variationMm >= Math.min(value.leftWidthMm, value.rightWidthMm)) ctx.addIssue({ code: 'custom', message: '宽度变化须小于两侧路肩宽度，保留真实道路带。' })
})
const requestSchema = z.object({ operationId: id, paint: paintSchema,
  roads: z.array(z.object({ pathId: id, supportAreaIds: z.array(id).min(1).max(256), shoulder: shoulderSchema }).strict()).max(128),
  patches: z.array(z.object({ targetAreaId: id, selectionMm: z.array(point).min(3).max(512), blendWidthMm: nonnegative }).strict()).max(255),
}).strict()
export type RoadCampPatchRequest = z.infer<typeof requestSchema>
export interface RoadCampPatchFragment { targetAreaId: string; sourcePathId: string | null; overlay: SurfaceOverlay }
export interface RoadCampPatchPlan {
  commands: SceneCommand[]
  targetIds: string[]
  dependencyIds: string[]
  createdOverlayIds: string[]
  previewFragments: RoadCampPatchFragment[]
  notes: string[]
}

const clone = <T>(value: T): T => structuredClone(value)
const samePoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const generatedPoint = (x: number, y: number): PointMm => {
  const result = { x: Math.round(x), y: Math.round(y) }
  if (![result.x, result.y].every(Number.isSafeInteger)) throw new Error('路肩造型超出安全整数毫米范围。')
  return result
}
const ringPolygon = (points: readonly PointMm[]): Polygon => [points.map(p => [p.x, p.y])]
const noHoles = (polygons: ReturnType<typeof polygonBooleanExact>['polygons']) => {
  if (polygons.some(polygon => polygon.holes.length)) throw new Error('接片结果含孔洞；当前覆盖不支持洞，请调整道路或选区，不能填洞或丢片。')
  return polygons.map(polygon => polygon.outer)
}

/** Only newly generated shape samples are rounded. Boolean intersections below
 * must already be exact integer millimetres and never use this function. */
function shoulderRing(path: Path, settings: RoadCampPatchRequest['roads'][number]['shoulder'], meter: ExecutionBudget): PointMm[] {
  const points = path.centerlineMm, half = path.widthMm / 2
  const lengths = points.slice(1).map((b, i) => Math.hypot(b.x - points[i].x, b.y - points[i].y))
  const directions = points.slice(1).map((b, i) => ({ x: (b.x - points[i].x) / lengths[i], y: (b.y - points[i].y) / lengths[i] }))
  const count = lengths.reduce((sum, length) => sum + Math.ceil(length / settings.sampleSpacingMm), 1)
  if (!Number.isSafeInteger(count) || count * 2 + 18 > 512) throw new Error('路肩实际采样超过单片512点，请增大采样间距或简化路线。')
  meter.charge({ fieldEvaluations: count * 2, geometryPoints: count * 2 + 18, geometrySegments: count * 2 + 18 })
  const phase = Number.parseInt(sha256Text(settings.seed).slice(0, 8), 16) / 0xffffffff * Math.PI * 2
  const widths = (station: number) => ({ left: half + settings.leftWidthMm + settings.variationMm * Math.sin(station / 1900 + phase),
    right: half + settings.rightWidthMm + settings.variationMm * Math.cos(station / 2300 + phase * 1.7) })
  const side = (sign: number): PointMm[] => {
    const result: PointMm[] = []
    let station = 0
    const offset = (p: PointMm, direction: PointMm, width: number) => generatedPoint(p.x - direction.y * width * sign, p.y + direction.x * width * sign)
    for (let i = 0; i < points.length; i++) {
      const width = sign > 0 ? widths(station).left : widths(station).right
      if (i === 0 || i === points.length - 1) result.push(offset(points[i], directions[i === 0 ? 0 : i - 1], width))
      else {
        const before = directions[i - 1], after = directions[i], a = { x: points[i].x - before.y * width * sign, y: points[i].y + before.x * width * sign },
          b = { x: points[i].x - after.y * width * sign, y: points[i].y + after.x * width * sign }
        const determinant = before.x * after.y - before.y * after.x
        if (Math.abs(determinant) < 1e-12) result.push(generatedPoint(a.x, a.y))
        else {
          const t = ((b.x - a.x) * after.y - (b.y - a.y) * after.x) / determinant
          const join = { x: a.x + before.x * t, y: a.y + before.y * t }
          if (Math.hypot(join.x - points[i].x, join.y - points[i].y) <= 2 * width) result.push(generatedPoint(join.x, join.y))
          else result.push(generatedPoint(a.x, a.y), generatedPoint(b.x, b.y))
        }
      }
      if (i === points.length - 1) continue
      const steps = Math.ceil(lengths[i] / settings.sampleSpacingMm)
      const turns = (index: number) => index > 0 && index < points.length - 1
        && Math.abs(directions[index - 1].x * directions[index].y - directions[index - 1].y * directions[index].x) > 1e-12
      const joinReach = 2 * (half + Math.max(settings.leftWidthMm, settings.rightWidthMm) + settings.variationMm)
      for (let step = 1; step < steps; step++) {
        const along = lengths[i] * step / steps
        // An inside miter consumes part of both adjacent offset legs. Dense
        // samples inside that join would backtrack toward the corner, rather
        // than describe the continuous shoulder boundary.
        if (turns(i) && along <= joinReach || turns(i + 1) && lengths[i] - along <= joinReach) continue
        const widthAt = sign > 0 ? widths(station + along).left : widths(station + along).right
        result.push(offset({ x: points[i].x + directions[i].x * along, y: points[i].y + directions[i].y * along }, directions[i], widthAt))
      }
      station += lengths[i]
    }
    return result
  }
  const left = side(1), right = side(-1), total = lengths.reduce((sum, value) => sum + value, 0)
  const cap = (end: boolean): PointMm[] => {
    const index = end ? points.length - 1 : 0, direction = directions[end ? directions.length - 1 : 0], width = widths(end ? total : 0)
    // The arc is centred on the physical square cap, not on the endpoint.
    // Its short tangent radius adds shoulder paint while retaining every real cap corner.
    const center = { x: points[index].x + direction.x * half * (end ? 1 : -1), y: points[index].y + direction.y * half * (end ? 1 : -1) }
    const tangentRadius = Math.max(settings.leftWidthMm, settings.rightWidthMm) + settings.variationMm
    return Array.from({ length: 9 }, (_, i) => {
      const fraction = i / 8, theta = (end ? Math.PI / 2 : -Math.PI / 2) - fraction * Math.PI
      const lateralRadius = end ? width.left * (1 - fraction) + width.right * fraction : width.right * (1 - fraction) + width.left * fraction
      return generatedPoint(center.x + direction.x * Math.cos(theta) * tangentRadius - direction.y * Math.sin(theta) * lateralRadius,
        center.y + direction.y * Math.cos(theta) * tangentRadius + direction.x * Math.sin(theta) * lateralRadius)
    })
  }
  const ring = [...left, ...cap(true), ...right.reverse(), ...cap(false)]
    .filter((p, index, values) => !index || !samePoint(p, values[index - 1]))
  if (samePoint(ring[0], ring.at(-1)!)) ring.pop()
  if (ring.length > 512) throw new Error('路肩转角与端部实际展开超过512点。')
  return noHoles(polygonBooleanExact({ operation: 'union', subject: [ring], clip: [] }, meter).polygons)[0]
}

/** Floating physical bands are checked as floating bands, never rounded into
 * another hit shape. This boolean is a proof only; none of its output persists. */
function assertBandCovered(band: PointMm[], covers: PointMm[][], meter: ExecutionBudget): void {
  const points = band.length + covers.reduce((sum, ring) => sum + ring.length, 0)
  meter.charge({ intersectionPairs: points * points })
  if (!covers.length || polygonClipping.difference(ringPolygon(band), ...covers.map(ringPolygon)).length) {
    throw new Error('路肩接片未完整覆盖真实道路的方端帽或miter/bevel转角带；请调整路肩、支撑选择或路线。')
  }
}

/** Build append-only static paint commands. No preset, material name, opening,
 * current travel state or renderer is an authority to regenerate these patches.
 * The caller binds this synchronous plan to its exact workspace checkpoint and
 * submits the commands through normal composition/resource/source validation. */
export function buildRoadCampPatchPlan(project: Pick<CompositionContent, 'document' | 'appearance'>, input: RoadCampPatchRequest): RoadCampPatchPlan {
  const parsed = requestSchema.safeParse(captureJson(input))
  if (!parsed.success) throw new Error(`路肩/营地接片请求无效：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  const request = parsed.data
  if (request.paint.alignment !== 'world') throw new Error('接片须明确提供完整world paint，不能隐式改写纹理相位。')
  if (!request.roads.length && !request.patches.length) throw new Error('请明确选择道路或营地选区。')
  if (!project || typeof project !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(project))) throw new Error('接片须提供完整工程的document与appearance。')
  const fields = Object.getOwnPropertyDescriptors(project)
  if (!['document', 'appearance'].every(key => fields[key]?.enumerable && 'value' in fields[key])) throw new Error('接片工程字段不能为访问器或隐藏字段。')
  const validation = validateSceneDocument(fields.document.value)
  if (!validation.ok) throw new Error(`接片当前场景无效：${validation.errors.map(issue => issue.message).join('；')}`)
  const scene = validation.document, appearance = validateAppearanceGraph(captureJson(fields.appearance.value), scene), candidate = clone(scene), visible = createPublicVisibility(scene)
  const candidateAppearance = clone(appearance)
  const material = scene.materials[request.paint.materialRef.id]
  if (!material || material.version !== request.paint.materialRef.version || !material.applicableSurfaces.includes('terrain')) throw new Error('接片paint须引用当前固定版本、适用于地形的完整材质。')
  const occupied = geometryIdentityIds(scene)
  for (const value of Object.keys(scene.userLayers)) occupied.add(value)
  for (const source of Object.values(appearance.sources)) {
    occupied.add(source.id)
    if (source.kind === 'surface') for (const overlay of source.snapshot.overlays) occupied.add(overlay.id)
  }
  if (occupied.has(request.operationId)) throw new Error('接片operationId已被占用，请使用新操作身份。')
  const meter = captureExecutionBudget(TASK_BUDGET_PROFILES.small), dependencies = new Set<string>(), writes = new Set<string>(), fragments: RoadCampPatchFragment[] = []
  dependencies.add(material.id); dependencies.add(material.textureAssetId)
  const notes = ['静态接片保存完整世界几何；后续移路或改选区不会自动随动，也不授予高差通行。',
    '追加会保留原材质及既有覆盖；目标有启用的图层/实例外观调整或原样式不一致时，须先明确处理。',
    '本次仅生成预览命令；采用前仍须检查当前内容、固定素材和操作范围，保存状态以工作区为准。']
  let floorId: string | undefined, elevation: number | undefined
  const relatedLocks = (roots: string[]): void => {
    const ids = new Set(roots)
    let changed = true
    while (changed) {
      changed = false
      for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && ids.has(note.anchor.entityId) && !ids.has(note.id)) { ids.add(note.id); changed = true }
    }
    for (const value of ids) {
      const entity = scene.terrainAreas[value] ?? scene.paths[value] ?? scene.notes[value]
      dependencies.add(value)
      if (entity?.editLocked || entity && scene.userLayers[scene.entityLayers[value]]?.editLocked) throw new Error(`接片涉及已锁定实体、图层或递归注记：${value}。`)
      if (entity) dependencies.add(scene.entityLayers[value])
    }
  }
  const target = (areaId: string) => {
    const area = scene.terrainAreas[areaId]
    if (!area || !visible.terrainArea(areaId) || !area.surfaceStyle || area.blocksMovement) throw new Error('接片目标须为明确公开、已有完整材质且可步行的真实地形面。')
    if (floorId !== undefined && area.floorId !== floorId || elevation !== undefined && area.groundElevationMm !== elevation) throw new Error('本次接片目标须保持同Floor、同高程，不能用外观跨高差。')
    floorId = area.floorId; elevation = area.groundElevationMm
    relatedLocks([areaId]); dependencies.add(area.floorId)
    const sourceId = appearance.surfaceSources[areaId], source = appearance.sources[sourceId]
    if (!source || source.kind !== 'surface') throw new Error('接片目标缺少确切固定表面源，不能从显示结果伪造原源。')
    const adjustments = [...(appearance.layerAdjustments[scene.entityLayers[areaId]] ?? []), ...(appearance.instanceAdjustments[areaId] ?? [])]
    if (adjustments.some(adjustment => adjustment.enabled)) throw new Error('接片目标有启用的图层或实例外观调整，请先明确处理；不能把显示效果烘焙回固定源。')
    if (canonicalJson(source.snapshot) !== canonicalJson(area.surfaceStyle)) throw new Error('接片固定原源与当前表面不一致，不能用有效外观替代源样式。')
    let ancestor: AppearanceSource | undefined = source
    while (ancestor) {
      dependencies.add(ancestor.id)
      if (ancestor.kind === 'surface') for (const paint of [ancestor.snapshot.base, ...ancestor.snapshot.overlays.map(overlay => overlay.paint)]) {
        const fixed = scene.materials[paint.materialRef.id]
        dependencies.add(fixed.id); dependencies.add(fixed.textureAssetId)
      }
      ancestor = ancestor.parentSourceId === null ? undefined : appearance.sources[ancestor.parentSourceId]
    }
    // The source is the authority even where equal current pixels happen to
    // look identical. Repeated targets retain this operation's earlier appends.
    if (!writes.has(areaId)) candidate.terrainAreas[areaId].surfaceStyle = clone(source.snapshot)
    return area
  }
  const clipToTarget = (shape: PointMm[], areaId: string): PointMm[][] => {
    const area = target(areaId)
    let rings = noHoles(polygonBooleanExact({ operation: 'intersection', subject: [shape], clip: [terrainPoints(area)] }, meter).polygons)
    // Public exposed support is the only clipping authority. Secret covers do
    // not create public holes or influence the output geometry/metadata.
    for (const cover of Object.values(scene.terrainAreas).filter(value => value.floorId === area.floorId && value.visibility === 'public' && value.coveragePriority > area.coveragePriority).sort((a, b) => a.coveragePriority - b.coveragePriority || a.id.localeCompare(b.id))) {
      if (!rings.length) break
      const next = noHoles(polygonBooleanExact({ operation: 'difference', subject: rings, clip: [terrainPoints(cover)] }, meter).polygons)
      if (canonicalJson(next) !== canonicalJson(rings)) dependencies.add(cover.id)
      rings = next
    }
    return rings
  }
  const append = (areaId: string, pathId: string | null, suffix: string, rings: PointMm[][], blendWidthMm: number) => {
    for (const [index, boundaryMm] of rings.entries()) {
      const overlayId = `${request.operationId}-rcp-${suffix}-p${index}`
      if (overlayId.length > 256 || occupied.has(overlayId)) throw new Error('接片新覆盖身份无效或已占用，未采用任何覆盖。')
      occupied.add(overlayId)
      const style = candidate.terrainAreas[areaId].surfaceStyle!, renderOrder = Math.max(-1, ...style.overlays.map(overlay => overlay.renderOrder)) + 1
      if (renderOrder > 10000 || boundaryMm.length > 512) throw new Error('接片实际片段或覆盖顺序超过当前严格模型范围。')
      const overlay: SurfaceOverlay = { id: overlayId, boundaryMm: clone(boundaryMm), paint: clone(request.paint), blendWidthMm, renderOrder }
      style.overlays.push(overlay); fragments.push({ targetAreaId: areaId, sourcePathId: pathId, overlay: clone(overlay) }); writes.add(areaId)
      meter.charge({ geometryPoints: boundaryMm.length, geometrySegments: boundaryMm.length, semanticTargets: 1 })
      if (writes.size + fragments.length > 256) throw new Error('接片目标及实际分片超过固定compact256预算，不能拆批或换档绕过。')
    }
  }
  const roadIds = new Set<string>()
  for (const [roadIndex, row] of request.roads.entries()) {
    if (roadIds.has(row.pathId)) throw new Error('同一道路不能在本次请求中重复生成接片。')
    roadIds.add(row.pathId)
    const path = scene.paths[row.pathId]
    if (!path || !visible.path(path.id) || path.supportRefs.some(ref => ref.kind !== 'terrainArea')) throw new Error('路肩须选择明确公开、仅由真实地形面支撑的现存道路。')
    relatedLocks([path.id])
    const supportIds = path.supportRefs.map(ref => ref.id).sort(), requestedIds = [...row.supportAreaIds].sort()
    if (new Set(requestedIds).size !== requestedIds.length || canonicalJson(supportIds) !== canonicalJson(requestedIds)) throw new Error('路肩须明确列出道路全部实际地形支撑，不能省略、重复或替换支撑。')
    for (const areaId of requestedIds) if (target(areaId).floorId !== path.floorId) throw new Error('道路与接片支撑必须同Floor。')
    const band = pathPolygon(path), shape = shoulderRing(path, row.shoulder, meter)
    assertBandCovered(band, [shape], meter)
    const covers: PointMm[][] = []
    for (const [areaIndex, areaId] of requestedIds.entries()) {
      const rings = clipToTarget(shape, areaId); covers.push(...rings)
      append(areaId, path.id, `r${roadIndex}-a${areaIndex}`, rings, row.shoulder.blendWidthMm)
    }
    assertBandCovered(band, covers, meter)
  }
  for (const [index, patch] of request.patches.entries()) {
    const shape = noHoles(polygonBooleanExact({ operation: 'union', subject: [patch.selectionMm], clip: [] }, meter).polygons)[0]
    const rings = clipToTarget(shape, patch.targetAreaId)
    append(patch.targetAreaId, null, `c${index}`, rings, patch.blendWidthMm)
    if (!rings.length) notes.push(`选区${index + 1}与目标公开露出面无交集，未创建覆盖。`)
  }
  const generation = getLegacyGeneration(scene)
  for (const rule of Object.values(generation?.rules ?? {})) if (generationInputHash(scene, rule) !== generationInputHash(candidate, rule) || managedOutputHash(scene, rule) !== managedOutputHash(candidate, rule)) {
    dependencies.add(rule.id); dependencies.add(rule.layerId); dependencies.add(rule.recipeRef.id)
    if (rule.editLocked || scene.userLayers[rule.layerId]?.editLocked) throw new Error(`接片需更新的生成来源规则或其图层已锁定：${rule.id}。`)
    for (const owner of Object.values(generation!.ownership)) if (owner.ruleId === rule.id) dependencies.add(owner.id)
  }
  const targetIds = [...writes].sort(), commands: SceneCommand[] = targetIds.map(id => ({ type: 'setVisualSurface', kind: 'terrainArea', id, style: clone(candidate.terrainAreas[id].surfaceStyle) }))
  // Exercise the real finite command/lifecycle owner rather than validating a
  // raw style patch with stale generation hashes. These commands never need
  // fresh physical identities: an unexpected allocation is an explicit refusal.
  const preparedScene = commands.length ? applyCommands(scene, commands, {
    ids: { nextId: () => { throw new Error('静态接片不能隐式创建其他物理身份。') } }, clock: { now: () => scene.updatedAt },
  }, { budget: MANUAL_TRANSACTION_BUDGET }) : scene
  for (const areaId of targetIds) candidateAppearance.surfaceSources[areaId] = addSurfaceAppearanceSource(candidateAppearance,
    candidate.terrainAreas[areaId].surfaceStyle!, appearance.surfaceSources[areaId])
  validateAppearanceGraph(candidateAppearance, preparedScene)
  // Fixed surface snapshots are full records: meter their actual style bytes
  // here; complete source ancestry and resolved resources are remeasured by the
  // composition owner, whose graph is deliberately absent from this API.
  const metadataBytes = commands.reduce((sum, command) => sum + encodeUtf8(canonicalJson(command)).length, 0)
  meter.charge({ dependencyRefs: dependencies.size, metadataRecords: fragments.length + targetIds.length, metadataBytes })
  assertCommandBudget(MANUAL_TRANSACTION_BUDGET, measureCommandBudget(scene, preparedScene, { before: { appearance }, after: { appearance: candidateAppearance } },
    { ...meter.snapshot(), semanticTargets: fragments.length + targetIds.length }, MANUAL_TRANSACTION_BUDGET))
  return { commands, targetIds, dependencyIds: [...dependencies].sort(), createdOverlayIds: fragments.map(fragment => fragment.overlay.id), previewFragments: fragments, notes }
}
