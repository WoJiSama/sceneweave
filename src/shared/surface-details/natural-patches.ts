import { z } from 'zod'
import type { MaterialPaint, PointMm, SceneDocument, SurfaceOverlay } from '../model/scene.js'
import { COMPOSITION_LIMITS, type CompositionContent } from '../model/appearance.js'
import { addSurfaceAppearanceSource } from '../appearance/graph.js'
import type { SceneCommand } from '../commands/commands.js'
import { applyCommands } from '../commands/commands.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { assertCommandBudget, manualTransactionBudget, measureCommandBudget, type CommandBudgetUsage } from '../budget/command-budget.js'
import { captureExecutionBudget, taskBudgetProfile, type BudgetUsage, type ExecutionBudget } from '../budget/task-budget.js'
import { connectionFootprint, corridor, polygonInside, polygonsOverlap, terrainPoints } from '../geometry/geometry.js'
import { polygonBooleanExact, type PolygonBooleanOperation } from '../geometry/polygon-boolean.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { checkCancelled, type CancellationSignal } from '../ports/resources.js'
import { id, paint, point } from '../validation/primitives.js'
import { canonicalJson, captureJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateSceneDocument } from '../validation/scene.js'
import { nativeAppearanceGraphSchema } from '../validation/content.js'
import { edgeLookPaintPadding } from '../visual/paint-envelopes.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import type { VisualBoundary, VisualEdgeLook } from '../visual/types.js'

export const NATURAL_SURFACE_PATCH_LIMITS = Object.freeze({ inputRegions: 16, inputPoints: 2048, pointsPerRing: 128,
  outputOverlays: 32, outputPoints: 2048, fragments: 4, grassEdges: 8, fragmentAttempts: 128 })
const requestSchema = z.object({
  operationId: id, areaId: id, paint,
  regionsMm: z.array(z.array(point).min(3).max(NATURAL_SURFACE_PATCH_LIMITS.pointsPerRing)).min(1).max(NATURAL_SURFACE_PATCH_LIMITS.inputRegions),
  profile: z.enum(['grassOnRock', 'rockOnGrass']), seed: z.string().min(1).max(128),
  variationMm: z.number().int().min(0).max(2000).default(120),
  blendWidthMm: z.number().int().min(0).max(2000).default(120),
  fragments: z.number().int().min(0).max(NATURAL_SURFACE_PATCH_LIMITS.fragments).default(0),
  grassEdges: z.boolean().default(false),
}).strict()
export type NaturalSurfacePatchRequest = Omit<z.input<typeof requestSchema>, 'paint'> & { paint: MaterialPaint }
export interface NaturalSurfacePatchContext { signal?: CancellationSignal; executionMeter?: ExecutionBudget }
export interface NaturalSurfacePatchPlan {
  commands: SceneCommand[]
  targetIds: string[]
  dependencyIds: string[]
  createdOverlayIds: string[]
  counts: { overlays: number; fragments: number; grassEdges: number; inputPoints: number; outputPoints: number;
    curveSamples: number; commandCost: number; usage: CommandBudgetUsage }
  notes: string[]
}
type Mask = { id: string; ring: PointMm[] }
const budget = manualTransactionBudget('compact')
const at = (a: PointMm, b: PointMm, t: number): PointMm => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) })
const boundsOverlap = (a: readonly PointMm[], b: readonly PointMm[]) => {
  const range = (points: readonly PointMm[], axis: 'x' | 'y') => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]
  return (['x', 'y'] as const).every(axis => { const x = range(a, axis), y = range(b, axis); return x[0] < y[1] && y[0] < x[1] })
}

/** Build ordinary, static world-paint commands. This is neither a saved recipe
 * owner nor a regeneration hook. Full composition preview/adoption owns source
 * ancestry, actual resource validation, checkpoint/CAS and one undo record. */
export function buildNaturalSurfacePatchPlan(input: Pick<CompositionContent, 'document' | 'appearance'>, raw: NaturalSurfacePatchRequest, context: NaturalSurfacePatchContext = {}): NaturalSurfacePatchPlan {
  checkCancelled(context.signal)
  const request = requestSchema.parse(captureJson(raw))
  if (request.paint.alignment !== 'world') throw new Error('自然草岩覆盖须明确使用完整世界坐标材质参数。')
  const inputPoints = request.regionsMm.reduce((sum, ring) => sum + ring.length, 0)
  if (inputPoints > NATURAL_SURFACE_PATCH_LIMITS.inputPoints) throw new Error('自然草岩覆盖输入顶点超过2048预算。')
  const documentProperty = Object.getOwnPropertyDescriptor(input, 'document'), appearanceProperty = Object.getOwnPropertyDescriptor(input, 'appearance')
  if (!documentProperty || !('value' in documentProperty) || !appearanceProperty || !('value' in appearanceProperty)) throw new Error('自然草岩覆盖需要明确的数据型工程与固定外观来源。')
  const checked = validateSceneDocument(documentProperty.value)
  if (!checked.ok) throw new Error(`自然草岩覆盖基线无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const appearance = nativeAppearanceGraphSchema.parse(captureJson(appearanceProperty.value))
  const scene = checked.document, area = scene.terrainAreas[request.areaId], publicVisibility = createPublicVisibility(scene)
  if (scene.mapMode !== 'scene' || !area || !publicVisibility.terrainArea(area.id)) throw new Error('自然草岩覆盖须明确选择一个公开的场景地形面。')
  if (!area.surfaceStyle) throw new Error('请先为选定地形设置底材，再追加自然草岩覆盖。')
  const layerId = scene.entityLayers[area.id], layer = scene.userLayers[layerId]
  if (!layer || layer.floorId !== area.floorId || area.editLocked || layer.editLocked) throw new Error('自然草岩覆盖目标、支撑或所在图层已锁定或无效。')
  if ((appearance.layerAdjustments[layerId] ?? []).some(row => row.enabled) || (appearance.instanceAdjustments[area.id] ?? []).some(row => row.enabled)) throw new Error('选定地形或图层有启用的外观调整，请先明确处理；自然覆盖不重复烘焙这些调整。')
  const sourceId = appearance.surfaceSources[area.id], source = sourceId && appearance.sources[sourceId]
  if (!source || source.kind !== 'surface' || source.id !== sourceId || canonicalJson(source.snapshot) !== canonicalJson(area.surfaceStyle)) throw new Error('选定地形缺少一致的固定表面源，无法保全原材质。')
  const ancestryIds: string[] = [], ancestry = new Set<string>()
  let ancestor = source
  while (true) {
    if (ancestry.has(ancestor.id)) throw new Error('固定表面来源链出现循环，不能追加自然覆盖。')
    ancestry.add(ancestor.id); ancestryIds.push(ancestor.id)
    if (ancestry.size >= COMPOSITION_LIMITS.sourceDepth) throw new Error('追加自然覆盖会超过16层固定表面来源链上限。')
    if (ancestor.parentSourceId === null) break
    const parent = appearance.sources[ancestor.parentSourceId]
    if (!parent || parent.kind !== 'surface' || parent.id !== ancestor.parentSourceId) throw new Error('固定表面来源链缺失或类型不符，不能追加自然覆盖。')
    ancestor = parent
  }
  const material = scene.materials[request.paint.materialRef.id]
  if (!material || material.version !== request.paint.materialRef.version || !material.applicableSurfaces.includes('terrain')) throw new Error('自然草岩覆盖须使用现存、确切版本且适用于地形的材质。')

  const used = geometryIdentityIds(scene)
  Object.keys(scene.userLayers).forEach(value => used.add(value))
  const reserveAppearanceIds = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (!Array.isArray(value) && 'id' in value && typeof value.id === 'string') used.add(value.id)
    for (const child of Object.values(value)) reserveAppearanceIds(child)
  }
  reserveAppearanceIds(appearance)
  if (used.has(request.operationId)) throw new Error('自然草岩覆盖操作身份已占用，请使用新的操作ID。')
  const namespace = `surface-detail-${sha256Text(request.operationId).slice(0, 32)}`
  const fresh = (suffix: string) => {
    const value = `${namespace}-${suffix}`
    if (used.has(value)) throw new Error(`自然草岩覆盖需要未占用的新身份：${value}。`)
    used.add(value); return value
  }
  const ownMeter = captureExecutionBudget(taskBudgetProfile('small'))
  const meter: ExecutionBudget = { charge(delta: Partial<BudgetUsage>) {
    checkCancelled(context.signal); ownMeter.charge(delta); context.executionMeter?.charge(delta)
  }, snapshot: ownMeter.snapshot }
  const boolean = (operation: PolygonBooleanOperation, subject: PointMm[][], clip: PointMm[][]): PointMm[][] => {
    const points = [...subject, ...clip].reduce((sum, ring) => sum + ring.length, 0)
    // Admit the clipping library's complete pair closure before entering it;
    // the shared exact operation additionally charges its actual comparisons.
    meter.charge({ intersectionPairs: points * points, fieldEvaluations: points })
    const result = polygonBooleanExact({ operation, subject, clip }, meter)
    if (result.polygons.some(polygon => polygon.holes.length)) throw new Error('自然草岩覆盖裁切产生孔洞，当前静态覆盖不支持；请缩小或分开明确范围。')
    if (result.polygons.length > NATURAL_SURFACE_PATCH_LIMITS.outputOverlays || result.vertexCount > NATURAL_SURFACE_PATCH_LIMITS.outputPoints) throw new Error('自然草岩覆盖实际片段或顶点超过预算。')
    return result.polygons.map(polygon => polygon.outer)
  }
  const supportRing = terrainPoints(area), dependencies = new Set([area.id, layerId, ...ancestryIds, material.id, material.textureAssetId])
  const random = (index: number, channel: number) => Number.parseInt(sha256Text(canonicalJson([request.seed, request.profile, index, channel])).slice(0, 8), 16) / 0xffffffff
  const masks: Mask[] = []
  // Audience filtering precedes geometry reads. Private geometry must not cut
  // a public patch or move a public fringe, including through a hidden door.
  for (const other of Object.values(scene.terrainAreas)) if (other.id !== area.id && other.floorId === area.floorId
    && other.coveragePriority > area.coveragePriority && publicVisibility.terrainArea(other.id)) masks.push({ id: other.id, ring: terrainPoints(other) })
  for (const connection of Object.values(scene.terrainConnections)) if (connection.floorId === area.floorId && publicVisibility.terrainConnection(connection.id)) masks.push({ id: connection.id, ring: connectionFootprint(connection) })
  for (const mask of masks) dependencies.add(mask.id)
  let rings = boolean('intersection', boolean('union', request.regionsMm, []), [supportRing])
  if (!rings.length) throw new Error('自然草岩覆盖范围与选定地形没有有效交集。')
  if (request.variationMm) rings = rings.map((ring, ringIndex) => ring.flatMap((a, index) => {
    const b = ring[(index + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < Math.max(24, request.variationMm * 2) || (index + ringIndex) % 3 === 1) return [{ ...a }]
    const strength = Math.min(request.variationMm, length * .12) * (.55 + random(index + ringIndex * 131, 0) * .45)
    const sign = (index + ringIndex + (request.profile === 'rockOnGrass' ? 1 : 0)) % 2 ? -1 : 1
    const shift = (t: number, factor: number) => { const p = at(a, b, t); return { x: Math.round(p.x + (b.y - a.y) / length * strength * sign * factor), y: Math.round(p.y - (b.x - a.x) / length * strength * sign * factor) } }
    return [{ ...a }, shift(.34, 1), shift(.59, .62)]
  }))
  rings = boolean('intersection', boolean('union', rings, []), [supportRing])
  const relevantMasks = masks.filter(mask => rings.some(ring => boundsOverlap(ring, mask.ring)))
  for (const mask of relevantMasks) {
    dependencies.add(mask.id)
    rings = boolean('difference', rings, [mask.ring])
  }
  if (!rings.length) throw new Error('自然草岩覆盖被可见高优先级支撑或真实连接全部遮挡。')
  const originalRings = rings.map(ring => cloneJson(ring)), notes: string[] = []
  let fragments = 0
  const edges = originalRings.flatMap((ring, ringIndex) => ring.map((a, edge) => ({ a, b: ring[(edge + 1) % ring.length], ringIndex, edge, ringLength: ring.length })))
  for (let fragment = 0; fragment < request.fragments; fragment++) {
    let found = false
    for (let attempt = 0; attempt < Math.min(edges.length, NATURAL_SURFACE_PATCH_LIMITS.fragmentAttempts); attempt++) {
      const index = (attempt + Math.floor(random(fragment, 1) * edges.length)) % edges.length, { a, b } = edges[index]
      const length = Math.hypot(b.x - a.x, b.y - a.y), radius = Math.min(160, Math.floor(length / 8))
      meter.charge({ gridNodes: 1, fieldEvaluations: 1 })
      if (radius < 30) continue
      const middle = at(a, b, .35 + random(fragment, 2) * .3), offset = radius * 2.3
      const center = { x: middle.x + (b.y - a.y) / length * offset, y: middle.y - (b.x - a.x) / length * offset }
      const ring = Array.from({ length: 7 }, (_, vertex) => {
        const angle = vertex * Math.PI * 2 / 7, factor = .72 + random(fragment * 7 + vertex, 3) * .28
        return { x: Math.round(center.x + Math.cos(angle) * radius * factor), y: Math.round(center.y + Math.sin(angle) * radius * factor * .72) }
      })
      meter.charge({ intersectionPairs: ring.length * (supportRing.length + rings.reduce((sum, value) => sum + value.length, 0) + masks.reduce((sum, value) => sum + value.ring.length, 0)) })
      if (!polygonInside(ring, supportRing) || rings.some(other => polygonsOverlap(ring, other)) || masks.some(mask => polygonsOverlap(ring, mask.ring))) continue
      rings.push(...boolean('union', [ring], [])); fragments++; found = true; break
    }
    if (!found) throw new Error('当前范围没有足够空间放置所需草岩碎片，请减少碎片数量或扩大范围。')
  }
  if (rings.length > NATURAL_SURFACE_PATCH_LIMITS.outputOverlays || rings.reduce((sum, ring) => sum + ring.length, 0) > NATURAL_SURFACE_PATCH_LIMITS.outputPoints) throw new Error('自然草岩覆盖实际片段或顶点超过预算。')
  const style = cloneJson(source.snapshot), createdOverlayIds: string[] = []
  let renderOrder = Math.max(-1, ...style.overlays.map(overlay => overlay.renderOrder))
  const overlays: SurfaceOverlay[] = rings.map((boundaryMm, index) => {
    const overlayId = fresh(`overlay-${index + 1}`); createdOverlayIds.push(overlayId)
    if (++renderOrder > 10000) throw new Error('自然草岩覆盖绘制顺序超过当前上限，不能改排已有人工覆盖。')
    return { id: overlayId, boundaryMm, paint: cloneJson(request.paint), blendWidthMm: request.blendWidthMm, renderOrder }
  })
  style.overlays.push(...overlays)
  const commands: SceneCommand[] = [{ type: 'setVisualSurface', kind: 'terrainArea', id: area.id, style }]
  let grassEdges = 0, curveSamples = 0
  if (request.grassEdges) {
    const usedEdges = new Map<number, number[]>()
    for (const candidate of edges.slice().sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))) {
      if (grassEdges === NATURAL_SURFACE_PATCH_LIMITS.grassEdges) break
      const occupied = usedEdges.get(candidate.ringIndex) ?? []
      if (occupied.some(edge => Math.min((edge - candidate.edge + candidate.ringLength) % candidate.ringLength, (candidate.edge - edge + candidate.ringLength) % candidate.ringLength) < 2)) continue
      const start = at(candidate.a, candidate.b, .18), end = at(candidate.a, candidate.b, .74), span = Math.hypot(end.x - start.x, end.y - start.y)
      if (span < 200) continue
      const widthMm = Math.min(Math.floor(span * .2), 80 + Math.floor(random(candidate.edge + candidate.ringIndex * 131, 4) * 90)), repeatMm = 220
      const seed = sha256Text(canonicalJson([request.seed, request.profile, candidate.ringIndex, candidate.edge]))
      const temporaryLook = { kind: 'grass' as const, widthMm, repeatMm, intensity: .58 }
      const envelope = corridor(start, end, Math.ceil(edgeLookPaintPadding(temporaryLook)) * 2, true)
      meter.charge({ gridNodes: 1, intersectionPairs: envelope.length * (supportRing.length + masks.reduce((sum, mask) => sum + mask.ring.length, 0)) })
      if (!polygonInside(envelope, supportRing) || masks.some(mask => polygonsOverlap(envelope, mask.ring))) continue
      const boundaryId = fresh(`grass-${grassEdges + 1}`), lookId = fresh(`grass-${grassEdges + 1}-look`), segmentId = fresh(`grass-${grassEdges + 1}-segment`)
      const boundary: VisualBoundary = { id: boundaryId, floorId: area.floorId, layerId, visibility: 'public', editLocked: false, closed: false,
        binding: { kind: 'decoration' }, segments: [{ id: segmentId, start, control1: { ...start }, control2: { ...end }, end }], sampleSpacingMm: 350, toleranceMm: 15 }
      const look: VisualEdgeLook = { ...temporaryLook, id: lookId, floorId: area.floorId, layerId, visibility: 'public', editLocked: false, boundaryId,
        side: request.profile === 'grassOnRock' ? 'left' : 'right', color: '#738350', accentColor: '#BBC28A', opacity: .56, seed, enabled: true }
      const sampled = sampleVisualBoundary(boundary)
      curveSamples += sampled.points.length; meter.charge({ fieldEvaluations: sampled.points.length })
      commands.push({ type: 'upsertVisualBoundary', boundary }, { type: 'upsertVisualEdgeLook', edgeLook: look })
      grassEdges++; occupied.push(candidate.edge); usedEdges.set(candidate.ringIndex, occupied)
    }
    if (!grassEdges) notes.push('完整绘制包络内没有可用开放草沿；本次只追加材质覆盖。')
  }
  const generation = getLegacyGeneration(scene)
  for (const owner of Object.values(generation?.ownership ?? {})) if (owner.target.entityId === area.id) {
    dependencies.add(owner.id); dependencies.add(owner.ruleId)
  }
  checkCancelled(context.signal)
  let commandCost = 0
  const preview = applyCommands(scene, commands, { ids: { nextId: () => { throw new Error('自然覆盖候选不能隐式分配额外身份。') } }, clock: { now: () => scene.updatedAt } },
    { budget, appearance, onSceneDraft: (_draft, _command, cost) => { commandCost += cost; checkCancelled(context.signal) } })
  // Account for the exact additional immutable surface node that the ordinary
  // composition command will create. This copy is accounting only; no source
  // record or scene is returned as an adoptable project.
  const afterAppearance = cloneJson(appearance)
  afterAppearance.surfaceSources[area.id] = addSurfaceAppearanceSource(afterAppearance, style, sourceId)
  const usage = assertCommandBudget(budget, measureCommandBudget(scene, preview, { before: { appearance }, after: { appearance: afterAppearance } }, meter.snapshot(), budget))
  return { commands, targetIds: [area.id], dependencyIds: [...dependencies].sort(), createdOverlayIds,
    counts: { overlays: overlays.length, fragments, grassEdges, inputPoints, outputPoints: rings.reduce((sum, ring) => sum + ring.length, 0), curveSamples, commandCost, usage }, notes }
}
