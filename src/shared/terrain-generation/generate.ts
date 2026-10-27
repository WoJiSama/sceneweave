import { visualBase } from '../visual/base.js'
import { z } from 'zod'
import type { PointMm, Prop, SceneDocument, SurfaceRef, SurfaceStyle, TerrainArea } from '../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS } from '../model/scene.js'
import { cloneJson, canonicalJson, inspectJsonInput } from '../validation/json.js'
import { id, point, surfaceRef } from '../validation/primitives.js'
import { sceneDocumentSchema, validateSceneDocument } from '../validation/scene.js'
import { corridor, pointOnSurface, polygonDistance, polygonInside, polygonsOverlap, propFootprint, pathPolygon, supportedPolygon, terrainPoints, validateGeometry } from '../geometry/geometry.js'
import { visualCommandCost } from '../visual/commands.js'
import { checkTerrainRoute, searchTerrainRoute } from '../geometry/terrain-travel.js'
import { sampleVisualBoundary, signedVisualArea } from '../visual/geometry.js'
import type { CubicSegment, VisualBoundary, VisualEdgeLook } from '../visual/types.js'
import { emptyVisualSystem } from '../visual/types.js'
import { distanceToTerrainSegment, extractTerrainContours, simplifyTerrainContour, terrainHash32, terrainRandomUnit, terrainValueNoise } from './field.js'

export const TERRAIN_GENERATOR_VERSION = 'terrain-scene-v1' as const
export const TERRAIN_FIXED_SEEDS = Object.freeze(['terrain-v1-0', 'terrain-v1-1', 'terrain-v1-2', 'terrain-v1-3', 'terrain-v1-4'])
const routeInputSchema = z.object({ from: point, to: point, widthMm: z.number().int().min(400).max(3000), crossing: z.enum(['ground', 'ford', 'bridge']) }).strict()
const routeResultSchema = z.object({ pointsMm: z.array(point).min(2).max(32), widthMm: z.number().int().min(400).max(3000), expandedNodes: z.number().int().nonnegative().max(4096) }).strict()
export const terrainGenerationInputSchema = z.object({ sceneId: id, seed: z.string().min(1).max(128), kind: z.enum(['island', 'coast', 'river', 'lake', 'forest', 'hill', 'mixed']),
  widthMm: z.number().int().min(24000).max(120000).default(24000), heightMm: z.number().int().min(18000).max(90000).default(18000), route: routeInputSchema.optional(),
}).strict().refine(value => value.widthMm / value.heightMm >= 1 && value.widthMm / value.heightMm <= 1.8, '首批地形范围宽高比须为1–1.8。')
export type TerrainGenerationInput = z.infer<typeof terrainGenerationInputSchema>
export interface TerrainManagedTarget { kind: 'terrainArea' | 'terrainConnection' | 'path' | 'prop' | 'visualBoundary' | 'visualEdgeLook'; id: string }
export interface TerrainGenerationResult {
  document: SceneDocument
  input: TerrainGenerationInput
  skeleton: { variant: number; name: string; bayDirection: PointMm; plateauCenterMm: PointMm; gridColumns: number; gridRows: number; simplificationErrorMm: number; fitErrorMm: number }
  activity: { id: string; boundaryMm: PointMm[]; supportRef: SurfaceRef }
  route?: z.infer<typeof routeResultSchema>
  managedTargets: TerrainManagedTarget[]
  cost: { physicalEntities: number; terrainPoints: number; terrainSegments: number; pathPoints: number; visualEntities: number; curveSegments: number; overlays: number; legacyTotal: number; recommendedGenerationRecords: number; total: number }
}
const safeCount = z.number().int().nonnegative().refine(Number.isSafeInteger)
export const terrainGenerationResultSchema = z.object({
  document: sceneDocumentSchema.refine(value => value.schemaVersion === 2 && value.visual?.version === 1, '生成结果须为显式SceneDocument2/visual1。'),
  input: terrainGenerationInputSchema,
  skeleton: z.object({ variant: z.number().int().min(0).max(4), name: z.string().min(1).max(80), bayDirection: z.object({ x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1) }).strict(),
    plateauCenterMm: point, gridColumns: z.literal(48), gridRows: z.literal(36), simplificationErrorMm: z.number().finite().positive().max(5000), fitErrorMm: safeCount }).strict(),
  activity: z.object({ id, boundaryMm: z.array(point).length(4), supportRef: surfaceRef }).strict(),
  route: routeResultSchema.optional(),
  managedTargets: z.array(z.object({ kind: z.enum(['terrainArea', 'terrainConnection', 'path', 'prop', 'visualBoundary', 'visualEdgeLook']), id }).strict()).max(256),
  cost: z.object({ physicalEntities: safeCount, terrainPoints: safeCount, terrainSegments: safeCount, pathPoints: safeCount, visualEntities: safeCount, curveSegments: safeCount, overlays: safeCount,
    legacyTotal: safeCount, recommendedGenerationRecords: safeCount, total: safeCount.refine(value => value <= 256) }).strict(),
}).strict().superRefine((result, context) => {
  if (result.document.schemaVersion !== 2 || result.document.visual?.version !== 1) return
  const cost = result.cost
  if (cost.legacyTotal !== cost.physicalEntities + cost.terrainPoints + cost.terrainSegments + cost.pathPoints + cost.visualEntities + cost.curveSegments + cost.overlays
    || cost.total !== cost.legacyTotal + cost.recommendedGenerationRecords || cost.recommendedGenerationRecords !== generationRecordCost(result.managedTargets.length, result.activity.boundaryMm.length, result.route?.pointsMm.length ?? 0)) {
    context.addIssue({ code: 'custom', path: ['cost'], message: '生成实际展开成本向量不一致。' })
  }
  if (result.document.sceneId !== result.input.sceneId || !validateSceneDocument(result.document).ok || !supportedPolygon(result.document, result.activity.boundaryMm, result.activity.supportRef, 'visual-floor')) {
    context.addIssue({ code: 'custom', path: ['document'], message: '生成结果sceneId、完整几何或活动区不一致。' })
  }
  if (new Set(result.managedTargets.map(target => target.id)).size !== result.managedTargets.length) context.addIssue({ code: 'custom', path: ['managedTargets'], message: '生成管理目标不能重复。' })
  if (!!result.input.route !== !!result.route) context.addIssue({ code: 'custom', path: ['route'], message: '明确路线输入和完整结果须同时存在。' })
  if (result.route && result.input.route) {
    const route = result.route, path = result.document.paths['terrain-route']
    const checked = checkTerrainRoute(result.document, { floorId: 'visual-floor', pointsMm: route.pointsMm, widthMm: route.widthMm })
    if (!checked.ok || !path || canonicalJson(path.centerlineMm) !== canonicalJson(route.pointsMm) || path.widthMm !== route.widthMm
      || canonicalJson(path.supportRefs) !== canonicalJson(checked.supportRefs)
      || route.widthMm !== result.input.route.widthMm || canonicalJson(route.pointsMm[0]) !== canonicalJson(result.input.route.from)
      || canonicalJson(route.pointsMm.at(-1)) !== canonicalJson(result.input.route.to) || result.input.route.crossing === 'bridge'
      || result.input.route.crossing === 'ground' && checked.supportRefs.some(ref => ref.id === 'terrain-shallow')) {
      context.addIssue({ code: 'custom', path: ['route'], message: '路线端点、完整净宽或真实支撑与明确要求不一致。' })
    }
  }
  const document = result.document, expectedTargets: TerrainManagedTarget[] = [
    ...Object.keys(document.terrainAreas).map(id => ({ kind: 'terrainArea' as const, id })), ...Object.keys(document.terrainConnections).map(id => ({ kind: 'terrainConnection' as const, id })),
    ...Object.keys(document.paths).map(id => ({ kind: 'path' as const, id })), ...Object.keys(document.props).map(id => ({ kind: 'prop' as const, id })), ...Object.keys(visualBase(document)!.boundaries).map(id => ({ kind: 'visualBoundary' as const, id })),
    ...Object.keys(visualBase(document)!.edgeLooks).map(id => ({ kind: 'visualEdgeLook' as const, id })),
  ]
  const blank = cloneJson(document)
  for (const key of LAYER_ENTITY_COLLECTIONS) Object.assign(blank, { [key]: {} })
  blank.entityLayers = {}; blank.visual = emptyVisualSystem()
  const points = Object.values(document.terrainAreas).reduce((sum, area) => sum + area.boundaryMm.length, 0), curveSegments = Object.values(visualBase(document)!.boundaries).reduce((sum, boundary) => sum + boundary.segments.length, 0)
  if (JSON.stringify(expectedTargets) !== JSON.stringify(result.managedTargets) || cost.legacyTotal !== visualCommandCost(blank, document)
    || cost.terrainPoints !== points || cost.terrainSegments !== points || cost.pathPoints !== Object.values(document.paths).reduce((sum, path) => sum + path.centerlineMm.length, 0) || cost.curveSegments !== curveSegments
    || cost.physicalEntities !== LAYER_ENTITY_COLLECTIONS.reduce((sum, key) => sum + Object.keys(document[key]).length, 0)
    || cost.visualEntities !== (['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const).reduce((sum, key) => sum + Object.keys(visualBase(document)![key]).length, 0)
    || cost.overlays !== Object.values(document.terrainAreas).reduce((sum, area) => sum + (area.surfaceStyle?.overlays.length ?? 0), 0)) {
    context.addIssue({ code: 'custom', path: ['cost'], message: '生成管理闭包或成本与实际完整文档不同。' })
  }
})
const FLOOR = 'visual-floor', GROUND = 'visual-layer-ground', PROPS = 'visual-layer-props', DETAILS = 'visual-layer-details'
// Exact record shape installed by composeTerrainDocument: fixed recipe, one
// intent with two skeleton nodes, rule plus output refs, ownership rows, one
// activity constraint including closed point/segment geometry, and its check.
const generationRecordCost = (targets: number, activityPoints: number, routePoints = 0) => 1 + (1 + 2) + (1 + targets) + targets + (1 + activityPoints * 2) + 1 + (routePoints ? 2 * routePoints + 1 : 0)
const p = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })
const entity = (value: string, layerId = GROUND) => ({ id: value, floorId: FLOOR, layerId, visibility: 'public' as const, editLocked: false })
const variants = [
  { name: '西湾长岬', bay: { x: -1, y: -.25 }, rx: .37, ry: .34, lobe: .12 },
  { name: '北湾双肩', bay: { x: -.2, y: -1 }, rx: .38, ry: .33, lobe: -.1 },
  { name: '东南凹湾', bay: { x: .85, y: .65 }, rx: .36, ry: .35, lobe: .16 },
  { name: '南湾横脊', bay: { x: .15, y: 1 }, rx: .39, ry: .31, lobe: -.16 },
  { name: '东北双岬', bay: { x: .8, y: -.6 }, rx: .35, ry: .36, lobe: .08 },
] as const
// A broad activity shoulder with two or more narrow ridge ends. Different
// bends/axes keep the plateau from becoming the same central ellipse five times.
const highlandSkeletons = [
  { island: [.62, .48], knots: [[-.025, -.12, 1600], [0, 0, 2200], [-.025, .115, 1550]] },
  { island: [.47, .61], knots: [[-.15, -.015, 1500], [0, 0, 2200], [.13, -.07, 1500]] },
  { island: [.44, .41], knots: [[-.12, .07, 1600], [0, 0, 2200], [.11, .02, 1500]] },
  { island: [.49, .40], knots: [[-.13, .06, 1550], [0, 0, 2200], [.11, .065, 1550]] },
  { island: [.42, .60], knots: [[-.08, -.11, 1550], [-.075, -.015, 1850], [0, 0, 2200], [.11, -.015, 1500]] },
] as const

function parseInput(input: unknown): TerrainGenerationInput {
  const issue = inspectJsonInput(input)
  if (issue) throw new Error(issue.message)
  return terrainGenerationInputSchema.parse(input)
}
function paint(scene: SceneDocument, key: string): SurfaceStyle {
  const definition = scene.materials[key]
  if (!definition) throw new Error(`生成缺少固定素材：${key}。`)
  return { base: { materialRef: { id: definition.id, version: definition.version }, tileSizeMm: { ...definition.defaultTileSizeMm }, rotationDeg: 0,
    alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
}
function materialKey(kind: TerrainGenerationInput['kind'], purpose: 'water' | 'low' | 'high'): string {
  const palette = kind === 'coast' ? 'coast' : 'island'
  const suffix = palette === 'island' ? { water: 'shallows', low: 'strata', high: 'moss' } : { water: 'deep-water', low: 'wet-sand', high: 'dry-sand' }
  return `refined-material-${palette}-material-${suffix[purpose]}`
}
function addTerrain(scene: SceneDocument, value: string, points: PointMm[], input: TerrainGenerationInput, purpose: 'water' | 'low' | 'high', overrides: Partial<Pick<TerrainArea, 'groundElevationMm' | 'coveragePriority' | 'blocksMovement' | 'movementCostMultiplier'>> = {}): TerrainArea {
  if (signedVisualArea(points) < 0) points = [...points].reverse()
  const area: TerrainArea = { id: value, floorId: FLOOR, editLocked: false, visibility: 'public', boundaryMm: points.map((positionMm, index) => ({ id: `${value}-p${index}`, segmentId: `${value}-s${index}`, positionMm: { ...positionMm } })),
    groundElevationMm: overrides.groundElevationMm ?? (purpose === 'water' ? 0 : purpose === 'low' ? 800 : 2600),
    coveragePriority: overrides.coveragePriority ?? (purpose === 'water' ? 0 : purpose === 'low' ? 1 : 2),
    surfaceStyle: paint(scene, materialKey(input.kind, purpose)), blocksMovement: overrides.blocksMovement ?? purpose === 'water', blocksSight: false,
    movementCostMultiplier: overrides.movementCostMultiplier ?? 1 }
  scene.terrainAreas[value] = area; scene.entityLayers[value] = GROUND
  return area
}
function cubicBoundary(value: string, points: PointMm[], closed: boolean, input: TerrainGenerationInput): VisualBoundary {
  const scale = Math.max(input.widthMm / 24000, input.heightMm / 18000)
  const segmentCount = closed ? points.length : points.length - 1
  const segments: CubicSegment[] = Array.from({ length: segmentCount }, (_, index) => {
    const start = points[index], end = points[(index + 1) % points.length], before = points[index ? index - 1 : closed ? points.length - 1 : 0], after = points[index + 2 < points.length ? index + 2 : closed ? (index + 2) % points.length : points.length - 1]
    const boundedControl = (anchor: PointMm, dx: number, dy: number) => {
      const length = Math.hypot(dx, dy), factor = Math.min(1, 1000 * scale / Math.max(1, length))
      return p(anchor.x + dx * factor, anchor.y + dy * factor)
    }
    return { id: `${value}-c${index}`, start: { ...start }, control1: boundedControl(start, (end.x - before.x) / 6, (end.y - before.y) / 6),
      control2: boundedControl(end, -(after.x - start.x) / 6, -(after.y - start.y) / 6), end: { ...end } }
  })
  return { ...entity(value), closed, segments, sampleSpacingMm: Math.min(20000, Math.round((value === 'terrain-high-curve' ? 1600 : 1800) * scale)), toleranceMm: Math.min(1000, Math.round(90 * scale)), binding: { kind: 'decoration' } }
}
function addBoundArea(scene: SceneDocument, curve: VisualBoundary, input: TerrainGenerationInput, purpose: 'low' | 'high'): TerrainArea {
  const area = addTerrain(scene, `terrain-${purpose}`, sampleVisualBoundary(curve).points, input, purpose)
  curve.binding = { kind: 'terrain', sides: [{ areaId: area.id, startPointId: area.boundaryMm[0].id, endPointId: area.boundaryMm[0].id, reverse: false }] }
  visualBase(scene)!.boundaries[curve.id] = curve
  return area
}
function addLook(scene: SceneDocument, boundaryId: string, kind: VisualEdgeLook['kind'], input: TerrainGenerationInput, side: VisualEdgeLook['side'] = 'right'): void {
  const value = `${boundaryId}-${kind}`
  visualBase(scene)!.edgeLooks[value] = { ...entity(value, DETAILS), boundaryId, kind, side, widthMm: kind === 'cliff' ? 700 : 380, color: kind === 'cliff' ? '#91816A' : '#8AAC94',
    accentColor: kind === 'cliff' ? '#D8C7A5' : '#D8DDC0', opacity: .82, intensity: .85, seed: `${TERRAIN_GENERATOR_VERSION}/${terrainHash32(input.seed).toString(16)}/${kind}`, repeatMm: 320, enabled: true }
}
function assertBlank(base: SceneDocument, input: TerrainGenerationInput): SceneDocument {
  const checked = validateSceneDocument(base)
  if (!checked.ok) throw new Error('地形生成基线不是有效完整场景。')
  const scene = checked.document
  if (scene.sceneId !== input.sceneId || scene.schemaVersion !== 2 || scene.visual?.version !== 1) throw new Error('地形生成须绑定确切sceneId及显式SceneDocument2/visual1空白视图。')
  if (LAYER_ENTITY_COLLECTIONS.some(key => Object.keys(scene[key]).length) || Object.keys(scene.entityLayers).length
    || Object.keys(scene.floors).length !== 1 || scene.floors[FLOOR]?.boundsMm.x !== 0 || scene.floors[FLOOR]?.boundsMm.y !== 0
    || scene.floors[FLOOR]?.boundsMm.width !== input.widthMm || scene.floors[FLOOR]?.boundsMm.height !== input.heightMm) throw new Error('首批地形生成仅接受相同世界范围的独立空白工程。')
  for (const layerId of [GROUND, PROPS, DETAILS]) if (!scene.userLayers[layerId] || scene.userLayers[layerId].floorId !== FLOOR || scene.userLayers[layerId].editLocked) throw new Error('地形生成所需图层缺失或已锁定。')
  if (JSON.stringify(scene.visual) !== JSON.stringify(emptyVisualSystem())) throw new Error('首批地形生成不能覆盖已有视觉效果。')
  return cloneJson(scene)
}

function findStairs(scene: SceneDocument, low: TerrainArea, high: TerrainArea, input: TerrainGenerationInput, activity: TerrainGenerationResult['activity']): void {
  const ring = terrainPoints(high), scale = Math.min(input.widthMm / 24000, input.heightMm / 18000)
  let lastErrors = ''
  const candidates: { index: number; length: number; a: PointMm; b: PointMm }[] = ring.map((a, index) => ({ index, a, b: ring[(index + 1) % ring.length], length: Math.hypot(ring[(index + 1) % ring.length].x - a.x, ring[(index + 1) % ring.length].y - a.y) }))
    .sort((a, b) => b.length - a.length || a.index - b.index)
  for (const candidate of candidates) {
    if (candidate.length < 1000) continue
    const dx = candidate.b.x - candidate.a.x, dy = candidate.b.y - candidate.a.y, nx = -dy / candidate.length, ny = dx / candidate.length
    for (const fraction of [.5, .35, .65]) for (const offset of [1250, 1650, 2100]) {
      const center = { x: candidate.a.x + dx * fraction, y: candidate.a.y + dy * fraction }, distance = offset * Math.min(scale, 1.5)
      const from = p(center.x - nx * distance, center.y - ny * distance), to = p(center.x + nx * distance, center.y + ny * distance)
      if (!pointOnSurface(scene, from, { kind: 'terrainArea', id: low.id }, FLOOR) || !pointOnSurface(scene, to, { kind: 'terrainArea', id: high.id }, FLOOR)) continue
      if (polygonDistance(corridor(from, to, 1500), activity.boundaryMm) < 100) continue
      const value = 'terrain-stairs'
      scene.terrainConnections[value] = { id: value, floorId: FLOOR, editLocked: false, visibility: 'public', kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: low.id }, positionMm: from },
        to: { surfaceRef: { kind: 'terrainArea', id: high.id }, positionMm: to }, widthMm: 1500, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: paint(scene, materialKey(input.kind, 'low')) }
      scene.entityLayers[value] = GROUND
      const geometry = validateGeometry(scene)
      if (!geometry.errors.length) return
      lastErrors = geometry.errors.map(issue => issue.code).join(',')
      delete scene.terrainConnections[value]; delete scene.entityLayers[value]
    }
  }
  throw new Error(`生成高台未找到满足1500mm完整净宽与单一有效地面转换的真实台阶（${lastErrors || '候选端点不在有效支撑'}）。`)
}

function activityArea(scene: SceneDocument, center: PointMm, input: TerrainGenerationInput): TerrainGenerationResult['activity'] {
  const scale = Math.min(input.widthMm / 24000, input.heightMm / 18000), width = 2400 * scale, height = 2000 * scale
  const boundaryMm = [p(center.x - width / 2, center.y - height / 2), p(center.x + width / 2, center.y - height / 2), p(center.x + width / 2, center.y + height / 2), p(center.x - width / 2, center.y + height / 2)]
  const supportRef: SurfaceRef = { kind: 'terrainArea', id: 'terrain-high' }
  if (!supportedPolygon(scene, boundaryMm, supportRef, FLOOR)) throw new Error('明确活动区不在高台有效支撑内。')
  return { id: 'terrain-activity', boundaryMm, supportRef }
}
function placeProps(scene: SceneDocument, input: TerrainGenerationInput, activity: TerrainGenerationResult['activity']): void {
  const island = ['tree-north-asym', 'tree-windbent', 'tree-split-crown', 'rock-north-ridge', 'rock-layered-shelf', 'rock-tidepool']
  const coast = ['grass-wind', 'grass-fan', 'reef-split', 'reef-shelf', 'reef-pool']
  const palette = input.kind === 'coast' ? 'coast' : 'island'
  const keys = input.kind === 'forest' ? island.filter(key => key.startsWith('tree-'))
    : input.kind === 'hill' ? island.filter(key => key.startsWith('rock-'))
      : input.kind === 'mixed' ? [...island.slice(0, 3), ...island.slice(3)] : palette === 'island' ? island : coast
  const protectedConnections = Object.values(scene.terrainConnections).map(connection => corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm + 800, true))
  const protectedRoutes = Object.values(scene.paths).map(pathPolygon)
  // World-cell keys are independent streams; changing one definition does not reorder coast geometry.
  const candidates: { key: string; x: number; y: number; order: number }[] = []
  for (let y = 1; y < 9; y++) for (let x = 1; x < 12; x++) {
    const key = `${x}/${y}`, jitterX = terrainRandomUnit(input.seed, `props/${key}/x`) - .5, jitterY = terrainRandomUnit(input.seed, `props/${key}/y`) - .5
    candidates.push({ key, x: input.widthMm * (x + jitterX * .6) / 12, y: input.heightMm * (y + jitterY * .6) / 9, order: terrainHash32(`${input.seed}/props/${key}/order`) })
  }
  candidates.sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : 1))
  for (const candidate of candidates) {
    const count = Object.keys(scene.props).length
    if (count >= 8) break
    const key = keys[count % keys.length], definition = scene.propDefinitions[`refined-prop-${palette}-${key}`]
    if (!definition) throw new Error(`生成缺少固定物件：${input.kind}/${key}。`)
    const supports = ['terrain-high', 'terrain-forest', 'terrain-low'].filter(id => !!scene.terrainAreas[id])
    const supportId = supports.find(id => pointOnSurface(scene, p(candidate.x, candidate.y), { kind: 'terrainArea', id }, FLOOR))
    if (!supportId) continue
    const positionMm = p(candidate.x, candidate.y)
    const tree = key.startsWith('tree')
    if (tree && scene.terrainAreas['terrain-forest'] && supportId !== 'terrain-forest') continue
    const scale = tree ? .7 : .65, value = `terrain-prop-${count}`
    const prop: Prop = { id: value, floorId: FLOOR, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: definition.version }, appearance: cloneJson(definition.defaultAppearance),
      visualBoundsMm: { x: Math.round(definition.defaultVisualBoundsMm.x * scale), y: Math.round(definition.defaultVisualBoundsMm.y * scale), width: Math.round(definition.defaultVisualBoundsMm.width * scale), height: Math.round(definition.defaultVisualBoundsMm.height * scale) },
      footprintMm: { width: Math.round(definition.defaultFootprintMm.width * scale), height: Math.round(definition.defaultFootprintMm.height * scale) }, footprintOffsetMm: p(0, 0), positionMm,
      rotationDeg: tree ? 0 : Math.floor(terrainRandomUnit(input.seed, `props/${candidate.key}/rotation`) * 360), blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
      supportRef: { kind: 'terrainArea', id: supportId }, renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
    const footprint = propFootprint(prop), visualBounds = [p(positionMm.x + prop.visualBoundsMm.x, positionMm.y + prop.visualBoundsMm.y), p(positionMm.x + prop.visualBoundsMm.x + prop.visualBoundsMm.width, positionMm.y + prop.visualBoundsMm.y),
      p(positionMm.x + prop.visualBoundsMm.x + prop.visualBoundsMm.width, positionMm.y + prop.visualBoundsMm.y + prop.visualBoundsMm.height), p(positionMm.x + prop.visualBoundsMm.x, positionMm.y + prop.visualBoundsMm.y + prop.visualBoundsMm.height)]
    if (!supportedPolygon(scene, footprint, prop.supportRef, FLOOR) || polygonDistance(footprint, activity.boundaryMm) < 300 || (protectedConnections.some(band => polygonDistance(footprint, band) < 200) || protectedRoutes.some(band => polygonDistance(footprint, band) < 300))
      || tree && polygonsOverlap(visualBounds, activity.boundaryMm) || Object.values(scene.props).some(other => polygonDistance(footprint, propFootprint(other)) < 650)) continue
    scene.props[value] = prop; scene.entityLayers[value] = prop.renderLayer === 'ground' ? DETAILS : PROPS
    if (validateGeometry(scene).errors.length) { delete scene.props[value]; delete scene.entityLayers[value] }
  }
  if (Object.keys(scene.props).length < 4) throw new Error('在保护活动区与台阶后没有足够合法树石位置。')
}

function ellipseRing(center: PointMm, radiusX: number, radiusY: number, steps = 16, phase = 0): PointMm[] {
  return Array.from({ length: steps }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / steps
    return p(center.x + Math.cos(angle) * radiusX, center.y + Math.sin(angle) * radiusY)
  })
}

function addT3Boundary(scene: SceneDocument, id: string, area: TerrainArea, input: TerrainGenerationInput, look: VisualEdgeLook['kind'] = 'grass'): void {
  const ring = terrainPoints(area)
  const curve: VisualBoundary = { ...entity(id), closed: true, sampleSpacingMm: 20000, toleranceMm: 90,
    segments: ring.map((start, index) => { const end = ring[(index + 1) % ring.length]; return { id: `${id}-c${index}`, start: { ...start }, control1: { ...start }, control2: { ...end }, end: { ...end } } }), binding: { kind: 'decoration' } }
  area.boundaryMm = sampleVisualBoundary(curve).points.map((positionMm, index) => ({ id: `${area.id}-p${index}`, segmentId: `${area.id}-s${index}`, positionMm }))
  curve.binding = { kind: 'terrain', sides: [{ areaId: area.id, startPointId: area.boundaryMm[0].id, endPointId: area.boundaryMm[0].id, reverse: false }] }
  visualBase(scene)!.boundaries[id] = curve
  addLook(scene, id, look, input)
}

function t3Rectangle(x: number, y: number, width: number, height: number): PointMm[] {
  return [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
}

function addT3River(scene: SceneDocument, input: TerrainGenerationInput, width: number, height: number, variant: number): { water: TerrainArea; shallow: TerrainArea | null } {
  const centreX = width * (.42 + variant * .035), halfWidth = Math.max(1200, Math.round(width * .055)), midY = height * (.52 + (variant % 2 ? .04 : -.03)), gap = 1800
  const margin = 1000
  const northMid = Math.round((margin + midY - gap) / 2), bend = Math.round(width * .009)
  const north = [p(centreX - halfWidth, margin), p(centreX + halfWidth, margin), p(centreX + halfWidth - bend, northMid),
    p(centreX + halfWidth, midY - gap), p(centreX - halfWidth, midY - gap), p(centreX - halfWidth - bend, northMid)]
  const southMid = Math.round((midY + gap + height - margin) / 2)
  const south = [p(centreX - halfWidth, midY + gap), p(centreX + halfWidth, midY + gap), p(centreX + halfWidth + bend, southMid),
    p(centreX + halfWidth, height - margin), p(centreX - halfWidth, height - margin), p(centreX - halfWidth + bend, southMid)]
  const waterNorth = addTerrain(scene, 'terrain-water-north', north, input, 'water', { coveragePriority: 2 })
  const waterSouth = addTerrain(scene, 'terrain-water-south', south, input, 'water', { coveragePriority: 2 })
  addT3Boundary(scene, 'terrain-river-north-curve', waterNorth, input, 'shore')
  addT3Boundary(scene, 'terrain-river-south-curve', waterSouth, input, 'shore')
  const shallow = addTerrain(scene, 'terrain-shallow', t3Rectangle(centreX - halfWidth, midY - gap, halfWidth * 2, gap * 2), input, 'water',
    { groundElevationMm: 200, coveragePriority: 3, blocksMovement: false, movementCostMultiplier: 1.35 })
  shallow.surfaceStyle = paint(scene, materialKey(input.kind, 'low'))
  shallow.surfaceStyle.base.tint = '#B7C5A3'
  addT3Boundary(scene, 'terrain-shallow-curve', shallow, input, 'grass')
  // Keep both endpoints strictly inside their declared support. A boundary
  // point is valid for pointOnSurface but contributes no interior transition
  // interval to the full corridor checker.
  const shallowLeft = p(centreX - halfWidth + 700, midY), shallowRight = p(centreX + halfWidth - 700, midY)
  const low = scene.terrainAreas['terrain-low']
  if (low) {
    scene.terrainConnections['terrain-shallow-left'] = { id: 'terrain-shallow-left', floorId: FLOOR, editLocked: false, visibility: 'public', kind: 'ramp',
      from: { surfaceRef: { kind: 'terrainArea', id: low.id }, positionMm: p(shallowLeft.x - 1200, shallowLeft.y) }, to: { surfaceRef: { kind: 'terrainArea', id: shallow.id }, positionMm: shallowLeft },
      widthMm: 1400, openingId: null, blocksMovement: false, movementCostMultiplier: 1.2, surfaceStyle: paint(scene, materialKey(input.kind, 'water')) }
    scene.terrainConnections['terrain-shallow-right'] = { id: 'terrain-shallow-right', floorId: FLOOR, editLocked: false, visibility: 'public', kind: 'ramp',
      from: { surfaceRef: { kind: 'terrainArea', id: shallow.id }, positionMm: shallowRight }, to: { surfaceRef: { kind: 'terrainArea', id: low.id }, positionMm: p(shallowRight.x + 1200, shallowRight.y) },
      widthMm: 1400, openingId: null, blocksMovement: false, movementCostMultiplier: 1.2, surfaceStyle: paint(scene, materialKey(input.kind, 'low')) }
    scene.entityLayers['terrain-shallow-left'] = GROUND; scene.entityLayers['terrain-shallow-right'] = GROUND
  }
  return { water: waterNorth, shallow }
}

function finalizeT3Result(scene: SceneDocument, blank: SceneDocument, input: TerrainGenerationInput, variant: number, bay: PointMm,
  plateauCenterMm: PointMm, activity: TerrainGenerationResult['activity'], route?: TerrainGenerationResult['route']): TerrainGenerationResult {
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}`).join('；'))
  const document = checked.document, managedTargets: TerrainManagedTarget[] = [
    ...Object.keys(document.terrainAreas).map(id => ({ kind: 'terrainArea' as const, id })), ...Object.keys(document.terrainConnections).map(id => ({ kind: 'terrainConnection' as const, id })),
    ...Object.keys(document.paths).map(id => ({ kind: 'path' as const, id })), ...Object.keys(document.props).map(id => ({ kind: 'prop' as const, id })), ...Object.keys(visualBase(document)!.boundaries).map(id => ({ kind: 'visualBoundary' as const, id })),
    ...Object.keys(visualBase(document)!.edgeLooks).map(id => ({ kind: 'visualEdgeLook' as const, id })),
  ]
  const terrainPointsCount = Object.values(document.terrainAreas).reduce((sum, area) => sum + area.boundaryMm.length, 0), legacyTotal = visualCommandCost(blank, document)
  const physicalEntities = LAYER_ENTITY_COLLECTIONS.reduce((sum, key) => sum + Object.keys(document[key]).length, 0)
  const visualEntities = (['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const).reduce((sum, key) => sum + Object.keys(visualBase(document)![key]).length, 0)
  const curveSegments = Object.values(visualBase(document)!.boundaries).reduce((sum, boundary) => sum + boundary.segments.length, 0)
  const overlays = Object.values(document.terrainAreas).reduce((sum, area) => sum + (area.surfaceStyle?.overlays.length ?? 0), 0)
  const recommendedGenerationRecords = generationRecordCost(managedTargets.length, activity.boundaryMm.length, route?.pointsMm.length ?? 0), total = legacyTotal + recommendedGenerationRecords
  if (total > 256) throw new Error(`完整生成实际成本${total}超过256（旧实体/采样/控制${legacyTotal}，规则/管理/活动${recommendedGenerationRecords}）。`)
  const boundaries = Object.values(visualBase(document)!.boundaries)
  const names = { island: '岩岛', coast: '海岸', river: '林间渡河', lake: '静水内湖', forest: '林缘空地', hill: '缓坡丘陵', mixed: '河谷混合地貌' } as const
  return { document, input, skeleton: { variant, name: names[input.kind], bayDirection: bay,
    plateauCenterMm, gridColumns: 48, gridRows: 36, simplificationErrorMm: 200, fitErrorMm: maximumFitDisplacement(...boundaries) }, activity, ...(route ? { route } : {}), managedTargets,
    cost: { physicalEntities, terrainPoints: terrainPointsCount, terrainSegments: terrainPointsCount, pathPoints: Object.values(document.paths).reduce((sum, path) => sum + path.centerlineMm.length, 0), visualEntities, curveSegments, overlays, legacyTotal, recommendedGenerationRecords, total } }
}

function addT3Ramp(scene: SceneDocument, low: TerrainArea, high: TerrainArea, input: TerrainGenerationInput): void {
  const ring = terrainPoints(high), left = Math.min(...ring.map(point => point.x)), right = Math.max(...ring.map(point => point.x)),
    top = Math.min(...ring.map(point => point.y)), bottom = Math.max(...ring.map(point => point.y)), y = Math.round((top + bottom) / 2)
  const from = p(left - 1200, y), to = p(left + 1200, y), id = 'terrain-stairs'
  scene.terrainConnections[id] = { id, floorId: FLOOR, editLocked: false, visibility: 'public', kind: 'ramp',
    from: { surfaceRef: { kind: 'terrainArea', id: low.id }, positionMm: from }, to: { surfaceRef: { kind: 'terrainArea', id: high.id }, positionMm: to },
    widthMm: 1500, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: paint(scene, materialKey(input.kind, 'low')) }
  scene.entityLayers[id] = GROUND
  const errors = validateGeometry(scene).errors
  if (errors.length) { delete scene.terrainConnections[id]; delete scene.entityLayers[id]; throw new Error(`T3高差连接未通过完整几何检查：${errors.map(issue => `${issue.entityId ?? ''}:${issue.code}`).join(',')}`) }
  if (right <= left) throw new Error('T3高地区域必须有正宽度。')
}

function addT3Route(scene: SceneDocument, input: TerrainGenerationInput): TerrainGenerationResult['route'] {
  if (!input.route) return undefined
  const request = input.route, searchScene = cloneJson(scene)
  if (request.crossing === 'ground' && searchScene.terrainAreas['terrain-shallow']) searchScene.terrainAreas['terrain-shallow'].blocksMovement = true
  const found = searchTerrainRoute(searchScene, { floorId: FLOOR, ...request, gridMm: 1500, maxNodes: 2048, maxSegments: 31 })
  if (!found.ok) throw new Error(`指定路线未通过有限搜索：${found.issues.map(issue => issue.message).join('；')}`)
  const checked = checkTerrainRoute(scene, { floorId: FLOOR, pointsMm: found.points, widthMm: request.widthMm })
  if (!checked.ok) throw new Error(`指定路线完整转角净宽未通过：${checked.issues.map(issue => issue.message).join('；')}`)
  const id = 'terrain-route'
  scene.paths[id] = { id, floorId: FLOOR, visibility: 'public', editLocked: false, centerlineMm: found.points.map(point => ({ ...point })), widthMm: request.widthMm,
    supportRefs: checked.supportRefs, surfaceStyle: paint(scene, materialKey(input.kind, 'low')), movementCostMultiplier: 1, renderOrder: 0 }
  scene.paths[id].surfaceStyle!.base.tint = '#CCAE85'
  scene.entityLayers[id] = DETAILS
  return { pointsMm: found.points.map(point => ({ ...point })), widthMm: request.widthMm, expandedNodes: found.expandedNodes }
}

function generateT3TerrainDocument(blank: SceneDocument, input: TerrainGenerationInput, variant: number, bay: PointMm): TerrainGenerationResult {
  const { widthMm: width, heightMm: height, seed } = input, scene = cloneJson(blank), bounds = t3Rectangle(0, 0, width, height)
  const low = addTerrain(scene, 'terrain-low', bounds, input, 'low')
  const highCenter = input.kind === 'lake' ? p(width * .76, height * .72) : input.kind === 'river' || input.kind === 'mixed' ? p(width * .8, height * (.28 + (variant % 2) * .025))
    : input.kind === 'forest' ? p(width * .72, height * .45) : p(width * (.5 + (variant - 2) * .035), height * .45)
  const highHalfWidth = width * (input.kind === 'river' || input.kind === 'mixed' ? .13 : .18)
  const high = addTerrain(scene, 'terrain-high', [p(highCenter.x - highHalfWidth, highCenter.y - height * .1),
    p(highCenter.x - width * .025, highCenter.y - height * .16), p(highCenter.x + highHalfWidth, highCenter.y - height * .07),
    p(highCenter.x + highHalfWidth - width * .015, highCenter.y + height * .1), p(highCenter.x - width * .035, highCenter.y + height * .16),
    p(highCenter.x - highHalfWidth, highCenter.y + height * .1)], input, 'high', { coveragePriority: 4 })
  addT3Boundary(scene, 'terrain-high-curve', high, input, 'cliff')
  if (input.kind === 'river' || input.kind === 'mixed') addT3River(scene, input, width, height, variant)
  if (input.kind === 'lake') {
    const lake = addTerrain(scene, 'terrain-lake', ellipseRing(p(width * .34, height * .43), width * .2, height * .25, 12, variant * .13), input, 'water', { coveragePriority: 3 })
    addT3Boundary(scene, 'terrain-lake-curve', lake, input, 'shore')
  }
  if (input.kind === 'forest' || input.kind === 'mixed' || input.kind === 'lake') {
    const forestPoints = input.kind === 'lake' ? [p(width * .62, height * .12), p(width * .83, height * .1), p(width * .92, height * .23), p(width * .88, height * .42), p(width * .63, height * .4), p(width * .59, height * .25)] : [p(width * .08, height * .16), p(width * .28, height * .1), p(width * .34, height * .28), p(width * .3, height * .55),
      p(width * .13, height * .62), p(width * .05, height * .4)]
    const forest = addTerrain(scene, 'terrain-forest', forestPoints, input, 'low', { coveragePriority: 2, blocksMovement: false, movementCostMultiplier: 1.35 })
    forest.surfaceStyle = paint(scene, materialKey(input.kind, 'high'))
    addT3Boundary(scene, 'terrain-forest-curve', forest, input, 'grass')
  }
  const activity = activityArea(scene, highCenter, input)
  addT3Ramp(scene, low, high, input)
  const route = addT3Route(scene, input)
  placeProps(scene, input, activity)
  const fixedIndex = TERRAIN_FIXED_SEEDS.indexOf(seed), direction = variants[fixedIndex >= 0 ? fixedIndex : variant].bay
  return finalizeT3Result(scene, blank, input, variant, direction, highCenter, activity, route)
}

/** Pure complete-result generator. No clock, DOM, bitmap, network or shared mutable PRNG is read. */
export function generateTerrainDocument(base: SceneDocument, rawInput: unknown): TerrainGenerationResult {
  const input = parseInput(rawInput), blank = assertBlank(base, input)
  if (input.route?.crossing === 'bridge') throw new Error('当前不支持生成桥梁或跨层桥洞；请选择已有地面或真实浅滩，不会以道路图片替代桥梁支撑。')
  if (input.route && ['island', 'coast'].includes(input.kind)) throw new Error('指定路线当前仅适用于河谷、内湖、森林、丘陵或混合配方。')
  const fixedIndex = TERRAIN_FIXED_SEEDS.indexOf(input.seed), variant = fixedIndex >= 0 ? fixedIndex : terrainHash32(`${input.seed}/skeleton`) % variants.length
  const recipe = variants[variant], bayLength = Math.hypot(recipe.bay.x, recipe.bay.y), bay = { x: recipe.bay.x / bayLength, y: recipe.bay.y / bayLength }
  if (['river', 'lake', 'forest', 'hill', 'mixed'].includes(input.kind)) return generateT3TerrainDocument(blank, input, variant, bay)
  const { widthMm: width, heightMm: height, seed } = input, scale = Math.min(width / 24000, height / 18000), centre = p(width * .5, height * .5)
  const highland = highlandSkeletons[variant]
  const plateauCenter = input.kind === 'island' ? p(width * highland.island[0], height * highland.island[1])
    : p(width * (.28 + variant * .105), height * .76)
  const ridge = highland.knots.map(([x, y, radius]) => ({ x: plateauCenter.x + width * x, y: plateauCenter.y + height * y, radius: radius * scale }))
  const columns = 48, rows = 36, grid = { widthMm: width, heightMm: height, columns, rows }
  const islandField = (x: number, y: number) => {
    const dx = (x - centre.x) / (width * recipe.rx), dy = (y - centre.y) / (height * recipe.ry), along = dx * bay.x + dy * bay.y, across = dx * bay.y - dy * bay.x
    const bayDistance = ((along - .74) / .34) ** 2 + (across / .28) ** 2, bayCut = .92 / (1 + bayDistance * bayDistance)
    const noise = terrainValueNoise(seed, 'land/low', x / (width * .3), y / (height * .3)) * .14 + terrainValueNoise(seed, 'land/middle', x / (width * .12), y / (height * .12)) * .035
    return Math.round((1 - dx * dx - dy * dy - bayCut + recipe.lobe * across * along + noise) * 1000000) / 1000000
  }
  const coastField = (x: number, y: number) => {
    const u = x / width, bayX = .2 + variant * .13, cove = Math.max(0, 1 - ((u - bayX) / .19) ** 2), cape = Math.max(0, 1 - ((u - ((bayX + .43) % .8 + .1)) / .23) ** 2)
    const shore = height * (.38 + .16 * cove * cove - .12 * cape * cape + terrainValueNoise(seed, 'coast/low', u * 3.5, .37) * .045 + terrainValueNoise(seed, 'coast/middle', u * 8, .73) * .018)
    return Math.round(y - shore)
  }
  const plateauField = (x: number, y: number) => {
    let field = -Infinity
    for (let index = 1; index < ridge.length; index++) {
      const a = ridge[index - 1], b = ridge[index], dx = b.x - a.x, dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
      const radius = a.radius + (b.radius - a.radius) * t, nx = (x - a.x - dx * t) / radius, ny = (y - a.y - dy * t) / radius
      field = Math.max(field, 1 - nx * nx - ny * ny)
    }
    return Math.round((field + terrainValueNoise(seed, 'plateau/low', x / (width * .18), y / (height * .18)) * .08) * 1000000) / 1000000
  }
  const lowContours = extractTerrainContours(grid, input.kind === 'island' ? islandField : coastField), highContours = extractTerrainContours(grid, plateauField)
  if (lowContours.length !== 1 || lowContours[0].closed !== (input.kind === 'island') || highContours.length !== 1 || !highContours[0].closed) throw new Error('首批生成出现额外分量/孔洞或意外开放边界；未静默删除。')
  const failures: string[] = []
  for (const error of [140, 220, 340, 500]) {
    try {
      const scene = cloneJson(blank), lowPoints = simplifyTerrainContour(lowContours[0], error * scale), highPoints = simplifyTerrainContour(highContours[0], error * scale)
      if (lowPoints.length > 24 || highPoints.length > 20) throw new Error('轮廓复杂度超过首批有限控制段预算。')
      const lowCurve = cubicBoundary('terrain-coast-curve', lowPoints, input.kind === 'island', input), highCurve = cubicBoundary('terrain-high-curve', highPoints, true, input)
      const samples = sampleVisualBoundary(lowCurve).points
      let low: TerrainArea
      if (input.kind === 'island') {
        addTerrain(scene, 'terrain-water', [p(0, 0), p(width, 0), p(width, height), p(0, height)], input, 'water')
        low = addBoundArea(scene, lowCurve, input, 'low')
      } else {
        low = addTerrain(scene, 'terrain-low', [...samples, p(width, height), p(0, height)], input, 'low')
        const water = addTerrain(scene, 'terrain-water', [p(0, 0), p(width, 0), ...[...samples].reverse()], input, 'water')
        lowCurve.binding = { kind: 'terrain', sides: [{ areaId: low.id, startPointId: low.boundaryMm[0].id, endPointId: low.boundaryMm[samples.length - 1].id, reverse: false },
          { areaId: water.id, startPointId: water.boundaryMm[2].id, endPointId: water.boundaryMm.at(-1)!.id, reverse: true }] }
        visualBase(scene)!.boundaries[lowCurve.id] = lowCurve
      }
      const high = addBoundArea(scene, highCurve, input, 'high')
      if (!polygonInside(terrainPoints(high), terrainPoints(low))) throw new Error('高台完整轮廓不完全位于陆地内。')
      const activity = activityArea(scene, plateauCenter, input)
      findStairs(scene, low, high, input, activity)
      addLook(scene, lowCurve.id, 'shore', input); if (input.kind === 'island') addLook(scene, lowCurve.id, 'cliff', input)
      addLook(scene, highCurve.id, 'cliff', input)
      if (input.kind === 'island') addLook(scene, highCurve.id, 'grass', input, 'left')
      placeProps(scene, input, activity)
      const checked = validateSceneDocument(scene)
      if (!checked.ok) throw new Error(checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}`).join('；'))
      const document = checked.document, managedTargets: TerrainManagedTarget[] = [
        ...Object.keys(document.terrainAreas).map(id => ({ kind: 'terrainArea' as const, id })), ...Object.keys(document.terrainConnections).map(id => ({ kind: 'terrainConnection' as const, id })),
        ...Object.keys(document.paths).map(id => ({ kind: 'path' as const, id })), ...Object.keys(document.props).map(id => ({ kind: 'prop' as const, id })), ...Object.keys(visualBase(document)!.boundaries).map(id => ({ kind: 'visualBoundary' as const, id })),
        ...Object.keys(visualBase(document)!.edgeLooks).map(id => ({ kind: 'visualEdgeLook' as const, id })),
      ]
      const terrainPointsCount = Object.values(document.terrainAreas).reduce((sum, area) => sum + area.boundaryMm.length, 0), legacyTotal = visualCommandCost(blank, document)
      const physicalEntities = LAYER_ENTITY_COLLECTIONS.reduce((sum, key) => sum + Object.keys(document[key]).length, 0), visualEntities = (['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const).reduce((sum, key) => sum + Object.keys(visualBase(document)![key]).length, 0)
      const curveSegments = Object.values(visualBase(document)!.boundaries).reduce((sum, boundary) => sum + boundary.segments.length, 0), overlays = Object.values(document.terrainAreas).reduce((sum, area) => sum + (area.surfaceStyle?.overlays.length ?? 0), 0)
      const recommendedGenerationRecords = generationRecordCost(managedTargets.length, activity.boundaryMm.length), total = legacyTotal + recommendedGenerationRecords
      if (total > 256) throw new Error(`完整生成实际成本${total}超过256（旧实体/采样/控制${legacyTotal}，规则/管理/活动${recommendedGenerationRecords}）。`)
      return { document, input, skeleton: { variant, name: recipe.name, bayDirection: bay, plateauCenterMm: plateauCenter, gridColumns: columns, gridRows: rows, simplificationErrorMm: error * scale, fitErrorMm: maximumFitDisplacement(lowCurve, highCurve) }, activity, managedTargets,
        cost: { physicalEntities, terrainPoints: terrainPointsCount, terrainSegments: terrainPointsCount, pathPoints: Object.values(document.paths).reduce((sum, path) => sum + path.centerlineMm.length, 0), visualEntities, curveSegments, overlays, legacyTotal, recommendedGenerationRecords, total } }
    } catch (error) { failures.push(error instanceof Error ? error.message : '未知几何失败。') }
  }
  throw new Error(`四轮有界地形准备均未满足硬要求：${failures.join(' | ')}`)
}

/** Convex-hull bound on cubic distance from its source chord, including mm quantization. */
function maximumFitDisplacement(...boundaries: VisualBoundary[]): number {
  let maximum = 0
  for (const boundary of boundaries) for (const segment of boundary.segments) maximum = Math.max(maximum,
    distanceToTerrainSegment(segment.control1, segment.start, segment.end), distanceToTerrainSegment(segment.control2, segment.start, segment.end))
  return Math.ceil(maximum) + 1
}
