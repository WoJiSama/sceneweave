import type { SceneDocument, PointMm, SurfaceRef, DecorationCluster } from '../../../model/scene.js'
import type { AppearanceGraph } from '../../../model/appearance.js'
import { applyCommands, type SceneCommand } from '../../../commands/commands.js'
import { captureExecutionBudget, parseTaskBudgetProfile, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { captureJson, cloneJson, freezeJson, canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../../../geometry/polygon-boolean.js'
import { polygonInside, polygonDistance, pointInPolygon, propFootprint, supportedPolygon, pathPolygon, polygonsOverlap } from '../../../geometry/geometry.js'
import { wallMovementPolygons } from '../../../geometry/doorway-clearance.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { buildDecorationRegeneration, estimateSurfaceRegionInstances, decorationProtectedGeometry } from '../../../decorations/generate.js'
import { decorationAsProp } from '../../../decorations/geometry.js'
import { createCompositionContent } from '../../../appearance/graph.js'
import { definitionPresentation, propPaintPolygon } from '../../../appearance/presentation.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../../../visual/terrain-variant-presentations.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash, detachChangedOutputs } from '../../../terrain-generation/integrity.js'
import type { GenerationFieldGroup, GenerationRecipe, GenerationReference, GenerationRule } from '../../../terrain-generation/contracts.js'
import { GenerationRegistry, runGeneration } from '../../orchestrator.js'
import { generationCreationWrites } from '../../materialization.js'
import { hashGenerationValue, type ArtifactInput, type GenerationCandidate, type GenerationRequest, type JsonValue } from '../../contracts.js'
import { forestGenerationInputSchema, ForestGenerationError, type ForestGenerationInput, type ForestSupport } from './contracts.js'

export * from './contracts.js'
export interface ForestReport {
  groundAreaId: string | null; pathIds: string[]; surfaceRuleIds: string[]; propIds: string[]; decorationIds: string[]
  vegetation: { zoneId: string; role: 'tree' | 'shrub' | 'grass'; requested: number; placed: number; ruleId: string; clusterId: string }[]
  notes: string[]
}
export const forestEntityId = (sceneId: string, seed: string, key: string) => `forest-${hashGenerationValue([sceneId, seed, key]).slice(0, 32)}`
export const forestRectangle = (b: { x: number; y: number; width: number; height: number }): PointMm[] => [
  { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
]
const ordered = <T>(rows: T[]) => rows.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0)
export function normalizeForestInput(raw: unknown): ForestGenerationInput {
  let input: ForestGenerationInput
  try { input = forestGenerationInputSchema.parse(captureJson(raw)) } catch (error) { throw new ForestGenerationError('invalid-input', `森林输入无效：${String(error)}`) }
  const p = input.parameters
  for (const rows of [p.zones, p.clearings, p.entrances, p.routes]) if (new Set(rows.map(row => row.id)).size !== rows.length) throw new ForestGenerationError('invalid-input', '同类森林需求ID不能重复。')
  if (![p.boundsMm.x + p.boundsMm.width, p.boundsMm.y + p.boundsMm.height].every(Number.isSafeInteger)) throw new ForestGenerationError('invalid-input', '森林范围超出安全整数。')
  for (const row of [...p.zones, ...p.clearings]) {
    polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: row.boundaryMm, holes: [] }], clip: [] })
    if (!polygonInside(row.boundaryMm, forestRectangle(p.boundsMm))) throw new ForestGenerationError('contradiction', '林区与空地须完整留在明确生成范围内。')
  }
  for (const zone of p.zones) {
    if (new Set(zone.vegetation.map(row => row.role)).size !== zone.vegetation.length) throw new ForestGenerationError('invalid-input', '同一林区的植被角色不能重复。')
    for (const row of zone.vegetation) {
      if (row.role === 'tree' && (row.palette.length !== 1 || row.palette[0].kind !== 'prop') || row.role !== 'tree' && row.palette.some(item => item.kind !== 'decoration')) throw new ForestGenerationError('unsupported', '树木使用单一完整物件；草与灌丛使用轻量装饰。')
      if (new Set(row.palette.map(item => item.key)).size !== row.palette.length) throw new ForestGenerationError('invalid-input', '植被素材键不能重复。')
      ordered(row.palette)
    }
    ordered(zone.vegetation)
  }
  for (let index = 0; index < p.zones.length; index++) for (const other of p.zones.slice(index + 1)) {
    const zone = p.zones[index]
    if (canonicalJson(zone.supportRef) === canonicalJson(other.supportRef) && zone.vegetation.some(row => other.vegetation.some(value => value.role === row.role)) && polygonsOverlap(zone.boundaryMm, other.boundaryMm)) throw new ForestGenerationError('unsupported', '同一支撑与角色的林区须互不重叠，不能隐式覆盖另一林区成员。')
  }
  for (const clearing of p.clearings) if (!pointInPolygon(clearing.anchorMm, clearing.boundaryMm, false)) throw new ForestGenerationError('contradiction', '空地路线锚点须位于实际空地内部。')
  for (const route of p.routes) {
    if (!p.entrances.some(row => row.id === route.fromEntranceId && row.widthMm >= route.widthMm) || !p.clearings.some(row => row.id === route.toClearingId)) throw new ForestGenerationError('contradiction', '路线须引用足宽入口和现存空地。')
  }
  ordered(p.zones); ordered(p.clearings); ordered(p.entrances); ordered(p.routes)
  return freezeJson(input)
}
export function forestFixedBindings(input: ForestGenerationInput) {
  const p = input.parameters
  const materials = ordered([...new Map([
    ...(p.ground.kind === 'new' && p.ground.materialRef ? [{ role: 'ground' as const, ref: p.ground.materialRef }] : []),
    ...p.routes.flatMap(row => row.materialRef ? [{ role: 'path' as const, ref: row.materialRef }] : []),
  ].map(row => [canonicalJson(row), row])).values()])
  const props = ordered([...new Map(p.zones.flatMap(zone => zone.vegetation.flatMap(row => row.palette.map(item => ({ role: row.role, ref: item.definitionRef })))).map(row => [canonicalJson(row), row])).values()])
  return { materials, props }
}
function support(input: ForestGenerationInput, sceneId: string, ref: ForestSupport): SurfaceRef & { kind: 'terrainArea' } {
  return { kind: 'terrainArea', id: ref.kind === 'generated-ground' ? forestEntityId(sceneId, input.seed, 'ground') : ref.id }
}
function assertBase(document: SceneDocument, input: ForestGenerationInput): void {
  if (!validateSceneDocument(document).ok) throw new ForestGenerationError('invalid-input', '森林基底须为合法完整场景。')
  const p = input.parameters, floor = document.floors[p.floorId], layer = document.userLayers[p.layerId]
  if (document.mapMode !== 'scene' || Object.keys(document.floors).length !== 1 || !floor || !layer || layer.floorId !== floor.id || layer.editLocked) throw new ForestGenerationError('unsupported', '森林当前支持单Floor与明确未锁定图层。')
  if (!polygonInside(forestRectangle(p.boundsMm), forestRectangle(floor.boundsMm))) throw new ForestGenerationError('contradiction', '森林范围越过Floor。')
  if (p.ground.kind === 'new' && ['rooms', 'walls', 'props', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'regions', 'decorations', 'decorationClusters', 'surfaceRules'].some(key => Object.keys(document[key as 'props']).length)) throw new ForestGenerationError('unsupported', '新地面只用于独立空白候选；已有地形须显式选择existing支撑。')
  for (const row of [...p.zones, ...p.clearings, ...p.entrances]) {
    if (row.supportRef.kind === 'generated-ground') {
      if (p.ground.kind !== 'new') throw new ForestGenerationError('invalid-input', '未请求新地面却引用generated-ground。')
    } else {
      const area = document.terrainAreas[row.supportRef.id]
      if (!area || area.floorId !== floor.id || area.visibility !== 'public' || area.blocksMovement || area.editLocked || document.userLayers[document.entityLayers[area.id]]?.editLocked) throw new ForestGenerationError('invalid-input', '适植表面须为同Floor公开、未锁定且可步行的明确地形面。')
    }
  }
  for (const zone of p.zones) for (const rule of Object.values(document.surfaceRules)) {
    if (zone.supportRef.kind !== 'terrainArea' || rule.supportRef.id !== zone.supportRef.id || rule.field === 'material') continue
    const role = rule.field === 'trees' ? 'tree' : rule.field === 'shrubs' ? 'shrub' : 'grass'
    if (zone.vegetation.some(row => row.role === role) && rule.regionsMm.some(region => polygonsOverlap(zone.boundaryMm, region.outerMm))) throw new ForestGenerationError('unsupported', '新林区不能覆盖已有同通道规则；请在D6中明确局部更新范围。')
  }
  const fixed = forestFixedBindings(input)
  for (const row of fixed.materials) {
    const material = document.materials[row.ref.id]
    if (!material || material.version !== row.ref.version || !material.applicableSurfaces.includes(row.role === 'ground' ? 'terrain' : 'path')) throw new ForestGenerationError('invalid-input', '森林材质缺失、固定版本不符或表面不适用。')
  }
  for (const row of fixed.props) {
    const definition = document.propDefinitions[row.ref.id]
    if (!definition || definition.version !== row.ref.version || definition.defaultAppearance.kind !== 'image') throw new ForestGenerationError('invalid-input', '森林植被须引用确切固定图片定义。')
    if (row.role === 'tree' && !definition.tags.some(tag => /tree|树/i.test(tag))) throw new ForestGenerationError('invalid-input', '树角色须明确绑定树木定义。')
    if (row.role !== 'tree' && (definition.defaultBlocksMovement || definition.defaultBlocksSight || definition.defaultAppearance.tint !== null)) throw new ForestGenerationError('invalid-input', '草灌轻量装饰不能包含隐含阻挡或运行时着色。')
  }
}
const boundsOf = (regions: PolygonWithHoles[]) => {
  const points = regions.flatMap(row => row.outer), xs = points.map(p => p.x), ys = points.map(p => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
function persist(document: SceneDocument, base: SceneDocument, input: ForestGenerationInput): void {
  const gen = getLegacyGeneration(document)!, p = input.parameters, id = (key: string) => forestEntityId(document.sceneId, input.seed, key)
  const recipeId = id('recipe')
  const recipe: GenerationRecipe = { id: recipeId, domain: 'forest',
    ...(input.algorithmVersion === 1 ? { recipeVersion: 1 as const, algorithmId: 'forest-layout' as const, algorithmVersion: 1 as const }
      : { recipeVersion: 2 as const, algorithmId: 'forest-layout' as const, algorithmVersion: 2 as const }),
    mapMode: 'scene', seed: input.seed, parameters: cloneJson(p), ...cloneJson(forestFixedBindings(input)), precision: { sampleSpacingMm: 1, toleranceMm: 1, noiseCellMm: 1 } }
  gen.recipes[recipeId] = recipe
  const inputs: GenerationReference[] = [...new Set([...p.zones, ...p.clearings, ...p.entrances].flatMap(row => row.supportRef.kind === 'terrainArea' ? [row.supportRef.id] : []))].map(entityId => ({ kind: 'terrainArea', entityId, parentId: null, fieldGroup: 'geometry' }))
  // Each actual output has a stable rule. Updating one member must charge its
  // own references, rather than expanding every member of the entire forest.
  const managed: Record<string, GenerationFieldGroup[]> = {
    terrainArea: ['geometry', 'properties', 'surface', 'source'], path: ['geometry', 'properties', 'surface', 'source'],
    prop: ['geometry', 'properties', 'appearance', 'source'], decoration: ['geometry', 'properties', 'appearance', 'source'],
    decorationCluster: ['geometry', 'properties', 'membership', 'source'], surfaceRule: ['geometry', 'properties', 'source'],
  }
  for (const [collection, kind] of [['terrainAreas', 'terrainArea'], ['paths', 'path'], ['props', 'prop'], ['decorations', 'decoration'], ['decorationClusters', 'decorationCluster'], ['surfaceRules', 'surfaceRule']] as const) for (const entity of Object.values(document[collection])) {
    if (base[collection][entity.id]) continue
    const ownerId = id(`owner:${kind}:${entity.id}`), ruleId = id(`rule:${kind}:${entity.id}`), fields = managed[kind]
    if (!gen.ownership[ownerId]) gen.ownership[ownerId] = { id: ownerId, outputKey: `${recipeId}:${kind}:${entity.id}`, ruleId, target: { kind, entityId: entity.id, parentId: null, fieldGroup: 'geometry' }, managedFields: [...fields], manualFields: [], state: 'managed', birthToken: id(`birth:${kind}:${entity.id}`) }
    const rule: GenerationRule = { id: ruleId, floorId: p.floorId, layerId: p.layerId, visibility: 'public', editLocked: false, kind: 'forest', recipeRef: { id: recipeId, version: recipe.recipeVersion }, inputs: cloneJson(inputs),
      outputs: fields.map(fieldGroup => ({ ...gen.ownership[ownerId].target, fieldGroup })), parameters: { widthMm: p.boundsMm.width, minWidthMm: 0, maxWidthMm: p.boundsMm.width, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
    gen.rules[ruleId] = rule; rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule)
  }
}
function fixedAppearance(document: SceneDocument): AppearanceGraph {
  let index = 0
  return bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(createCompositionContent(document, { clock: { now: () => document.updatedAt }, ids: { nextId: () => `forest-private-appearance-${++index}` } }))).appearance
}
/** Checks the actual produced footprint and paint against the explicit planting
 * zone and every reserved road/activity/entrance after content materialization. */
export function checkForestResult(document: SceneDocument, input: ForestGenerationInput, report: ForestReport, appearance = fixedAppearance(document)): void {
  const p = input.parameters
  for (const pathId of report.pathIds) {
    const path = document.paths[pathId]
    if (!path) throw new ForestGenerationError('invalid-input', '实际森林路线缺失。')
    if (!polygonInside(pathPolygon(path), forestRectangle(p.boundsMm))) throw new ForestGenerationError('contradiction', '实际森林路线的完整带区越过生成范围。')
    const checked = checkTerrainRoute(document, { floorId: p.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm })
    if (!checked.ok) throw new ForestGenerationError('contradiction', `实际森林路线的完整净宽或支撑未通过：${checked.issues.map(row => row.message).join('；')}`)
  }
  for (const clearing of p.clearings) {
    const ref = support(input, document.sceneId, clearing.supportRef)
    if (!supportedPolygon(document, clearing.boundaryMm, ref, p.floorId)) throw new ForestGenerationError('contradiction', '实际空地未完整落在选定有效支撑面上。')
    if (Object.values(document.props).some(prop => prop.floorId === p.floorId && polygonDistance(propFootprint(prop), clearing.boundaryMm) < Math.max(1, clearing.clearanceMm))) throw new ForestGenerationError('contradiction', '空地被现存物件真实占地侵入。')
    if (Object.values(document.regions).some(region => region.floorId === p.floorId && (region.blocksMovement || region.kind === 'manualMask') && polygonDistance(region.boundaryMm, clearing.boundaryMm) < Math.max(1, clearing.clearanceMm))
      || wallMovementPolygons(document, true).some(wall => wall.floorId === p.floorId && polygonDistance(wall.polygon, clearing.boundaryMm) < Math.max(1, clearing.clearanceMm))) throw new ForestGenerationError('contradiction', '空地与真实阻挡区域或墙体冲突。')
  }
  for (const row of report.vegetation) {
    const zone = p.zones.find(zone => zone.id === row.zoneId)!, cluster = document.decorationClusters[row.clusterId]
    if (!cluster) throw new ForestGenerationError('invalid-input', '森林成员簇缺失。')
    const protectedGeometry = decorationProtectedGeometry(document, cluster)
    for (const member of Object.values(cluster.members)) if (member.entityId) {
      const prop = member.kind === 'prop' ? document.props[member.entityId] : decorationAsProp(document, document.decorations[member.entityId])
      const footprint = propFootprint(prop), paint = propPaintPolygon(prop, definitionPresentation(appearance, prop.definitionRef))
      if (!polygonInside(propPaintPolygon(prop), forestRectangle(document.floors[p.floorId].boundsMm)) || !polygonInside(footprint, zone.boundaryMm) || !supportedPolygon(document, footprint, cluster.supportRef, p.floorId)
        || protectedGeometry.some(record => polygonDistance(footprint, record.polygon) < record.marginMm || polygonDistance(paint, record.polygon) < record.marginMm)) throw new ForestGenerationError('contradiction', '森林成员真实足迹、支撑或完整通路/空地保留区未通过。')
    }
  }
}

export function runForestGeneration(base: SceneDocument, raw: unknown, options: { profile: TaskBudgetProfile; nowMilliseconds: () => number; signal?: { readonly aborted: boolean } }): { input: ForestGenerationInput; report: ForestReport; candidate: GenerationCandidate; resultHash: string } {
  const input = normalizeForestInput(raw), profile = parseTaskBudgetProfile(options.profile), source = captureJson(base), p = input.parameters, version = input.algorithmVersion
  assertBase(source, input)
  if (getLegacyGeneration(source)?.recipes[forestEntityId(source.sceneId, input.seed, 'recipe')]) throw new ForestGenerationError('unsupported', '同一森林配方已存在；局部重生成须由D6明确选择范围，不能覆盖现存成员。')
  const id = (key: string) => forestEntityId(source.sceneId, input.seed, key), registry = new GenerationRegistry()
  const report: ForestReport = { groundAreaId: p.ground.kind === 'new' ? id('ground') : null, pathIds: [], surfaceRuleIds: [], propIds: [], decorationIds: [], vegetation: [], notes: [] }
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => id(`native:${sequence++}`) } }
  const parseParameters = (parameters: Readonly<Record<string, JsonValue>>) => captureJson(normalizeForestInput(parameters)) as unknown as Record<string, JsonValue>
  const determinism = { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' as const }
  registry.register({ id: 'forest-ground', version, phase: 'structure', owner: 'structure', consumes: ['support-surface'], produces: ['support-surface', 'plan-region', 'reserved-zone'], publishFacts: ['support-surface'], requires: [], determinism, parseParameters,
    writes: ({ document }) => generationCreationWrites(document, ['terrainAreas', 'generation.legacy.constraints']),
    run() { return { outputs: [
      ...p.zones.map(zone => ({ id: id(`plan:${zone.id}`), owner: 'structure', kind: 'plan-region', payload: { coordinateFrame: 'scene-mm', floorId: p.floorId, visibility: 'public', domain: 'natural', purpose: 'forest', boundaryMm: cloneJson(zone.boundaryMm) } } as ArtifactInput)),
      ...p.clearings.map(row => ({ id: id(`reserved:${row.id}`), owner: 'structure', kind: 'reserved-zone', payload: { coordinateFrame: 'scene-mm', floorId: p.floorId, visibility: 'public', sourceId: id(`clearing:${row.id}`), reason: 'preserve', boundaryMm: cloneJson(row.boundaryMm) } } as ArtifactInput)),
    ] } },
    materialize({ document: before, context }) {
      context.checkCancelled()
      let document = cloneJson(before) as SceneDocument
      if (p.ground.kind === 'new') document = applyCommands(document, [{ type: 'createTerrainArea', id: id('ground'), floorId: p.floorId, layerId: p.layerId, boundaryMm: forestRectangle(p.boundsMm), groundElevationMm: p.ground.elevationMm, ...(p.ground.materialRef ? { materialRef: p.ground.materialRef } : {}) }], runtime, { budget: profile })
      const gen = getLegacyGeneration(document)!
      for (const row of p.clearings) {
        if (!supportedPolygon(document, row.boundaryMm, support(input, source.sceneId, row.supportRef), p.floorId)) throw new ForestGenerationError('contradiction', '空地完整范围没有所选真实支撑。')
        gen.constraints[id(`clearing:${row.id}`)] = { id: id(`clearing:${row.id}`), kind: 'activityArea', floorId: p.floorId, visibility: 'public', strength: 'soft', boundaryMm: cloneJson(row.boundaryMm), clearanceMm: row.clearanceMm }
      }
      for (const zone of p.zones) if (!supportedPolygon(document, zone.boundaryMm, support(input, source.sceneId, zone.supportRef), p.floorId)) throw new ForestGenerationError('contradiction', '林区必须完整位于明确适植支撑；不能靠材质名称推断。')
      persist(document, source, input); return document
    },
  })
  registry.register({ id: 'forest-routes', version, phase: 'connectivity', owner: 'connectivity', consumes: ['plan-region', 'support-surface'], produces: ['access-zone', 'port'], publishFacts: ['access-zone'], requires: [{ id: 'forest-ground', version }], determinism, parseParameters,
    writes: ({ document }) => generationCreationWrites(document, ['paths', 'generation.legacy.constraints']),
    run() { return { outputs: p.entrances.map(row => ({ id: id(`port:${row.id}`), owner: 'connectivity', kind: 'port', payload: { coordinateFrame: 'scene-mm', floorId: p.floorId, visibility: 'public', positionMm: cloneJson(row.positionMm), widthMm: row.widthMm, directionDeg: row.directionDeg, elevationMm: p.ground.kind === 'new' ? p.ground.elevationMm : source.terrainAreas[support(input, source.sceneId, row.supportRef).id].groundElevationMm, supportRef: support(input, source.sceneId, row.supportRef), role: 'entrance' } } as ArtifactInput)) } },
    materialize({ document: before, context }) {
      let document = cloneJson(before) as SceneDocument
      const gen = getLegacyGeneration(document)!
      for (const row of p.entrances) {
        const r = row.widthMm / 2, point = row.positionMm
        const box = [{ x: point.x - r, y: point.y - r }, { x: point.x + r, y: point.y - r }, { x: point.x + r, y: point.y + r }, { x: point.x - r, y: point.y + r }]
        if (!polygonInside(box, forestRectangle(p.boundsMm)) || !supportedPolygon(document, box, support(input, source.sceneId, row.supportRef), p.floorId)) throw new ForestGenerationError('contradiction', '入口完整宽度须留在范围及真实支撑内。')
        gen.constraints[id(`entrance:${row.id}`)] = { id: id(`entrance:${row.id}`), kind: 'port', floorId: p.floorId, visibility: 'public', strength: 'soft', positionMm: cloneJson(point), directionDeg: row.directionDeg, widthMm: row.widthMm }
      }
      const commands: SceneCommand[] = []
      for (const route of p.routes) {
        context.checkCancelled()
        const entrance = p.entrances.find(row => row.id === route.fromEntranceId)!, clearing = p.clearings.find(row => row.id === route.toClearingId)!
        const pointsMm = [entrance.positionMm, ...route.viaMm, clearing.anchorMm]
        const checked = checkTerrainRoute(document, { floorId: p.floorId, pointsMm, widthMm: route.widthMm })
        if (!checked.ok) throw new ForestGenerationError('contradiction', `指定路线${route.id}完整净宽不可用：${checked.issues.map(row => row.message).join('；')}；不会用贴图替代桥梁或高差连接。`)
        const pathId = id(`path:${route.id}`)
        commands.push({ type: 'createPath', id: pathId, floorId: p.floorId, layerId: p.layerId, centerlineMm: cloneJson(pointsMm), widthMm: route.widthMm, supportRefs: checked.supportRefs, ...(route.materialRef ? { materialRef: route.materialRef } : {}) })
        report.pathIds.push(pathId)
      }
      if (commands.length) document = applyCommands(document, commands, runtime, { budget: profile })
      persist(document, source, input); return document
    },
  })
  registry.register({ id: 'forest-vegetation', version, phase: 'content', owner: 'content', consumes: ['plan-region', 'port', 'access-zone'], produces: ['prop-placement', 'footprint'], publishFacts: ['prop-placement', 'footprint'], requires: [{ id: 'forest-routes', version }], determinism, parseParameters,
    writes: ({ document }) => generationCreationWrites(document, ['props', 'decorations', 'decorationClusters', 'surfaceRules']),
    run() { return { outputs: [] } },
    materialize({ document: before, context }) {
      const document = cloneJson(before) as SceneDocument, meter = captureExecutionBudget(profile), appearance = fixedAppearance(document)
      let paintOrder = Math.max(0, ...Object.values(document.surfaceRules).map(rule => rule.paintOrder))
      for (const zone of p.zones) {
        context.checkCancelled()
        const region = polygonBooleanWithHoles({ operation: 'difference', subject: [{ outer: cloneJson(zone.boundaryMm), holes: [] }], clip: p.clearings.map(row => ({ outer: cloneJson(row.boundaryMm), holes: [] })) }, meter).polygons
        if (!region.length) { report.notes.push(`林区${zone.id}被空地完整占用，未生成植被。`); continue }
        // The old canonical order is part of forest@1 replay. A separate v2
        // reserves tree roots first; all sampling and acceptance checks stay.
        const vegetationRows = version === 1 ? zone.vegetation : [...zone.vegetation].sort((a, b) => ['tree', 'shrub', 'grass'].indexOf(a.role) - ['tree', 'shrub', 'grass'].indexOf(b.role))
        for (const vegetation of vegetationRows) {
          context.checkCancelled()
          const field = vegetation.role === 'tree' ? 'trees' : vegetation.role === 'shrub' ? 'shrubs' : 'grass'
          const ruleId = id(`surface:${zone.id}:${field}`), clusterId = id(`cluster:${zone.id}:${field}`)
          const cluster: DecorationCluster = { id: clusterId, floorId: p.floorId, editLocked: false, visibility: 'public', supportRef: support(input, source.sceneId, zone.supportRef), boundsMm: boundsOf(region), algorithmVersion: 'cluster-v1', seed: context.deriveSeed(`${zone.id}:${field}`), palette: cloneJson(vegetation.palette), spacingMm: vegetation.spacingMm, clusterRadiusMm: vegetation.clusterRadiusMm, clearanceMm: vegetation.clearanceMm, maxInstances: 64, members: {} }
          const effective = { polygons: region, coveragePpm: vegetation.coveragePpm }, requested = estimateSurfaceRegionInstances(document, cluster.palette, effective)
          const generated = buildDecorationRegeneration(document, cluster, runtime, appearance, effective, meter)
          // The shared region generator selects roots. A forest zone additionally
          // promises that each complete physical footprint remains in that zone.
          const protectedGeometry = decorationProtectedGeometry(document, cluster)
          const accepted = new Set([...generated.props, ...generated.decorations.map(row => decorationAsProp(document, row))].map(prop => ({ id: prop.id, footprint: propFootprint(prop), nativeImage: propPaintPolygon(prop) })).filter(row => {
            meter.charge({ dependencyRefs: protectedGeometry.length, intersectionPairs: row.nativeImage.length * 4 + row.footprint.length * (zone.boundaryMm.length + 2 * protectedGeometry.reduce((sum, record) => sum + record.polygon.length, 0)) })
            return polygonInside(row.nativeImage, forestRectangle(document.floors[p.floorId].boundsMm)) && polygonInside(row.footprint, zone.boundaryMm) && supportedPolygon(document, row.footprint, cluster.supportRef, p.floorId)
              && protectedGeometry.every(record => polygonDistance(row.footprint, record.polygon) >= record.marginMm)
          }).map(row => row.id))
          for (const [key, member] of Object.entries(generated.cluster.members)) if (member.entityId && !accepted.has(member.entityId)) delete generated.cluster.members[key]
          document.surfaceRules[ruleId] = { id: ruleId, floorId: p.floorId, editLocked: false, visibility: 'public', supportRef: support(input, source.sceneId, zone.supportRef), field, paintOrder: ++paintOrder, regionsMm: region.map(row => ({ outerMm: cloneJson(row.outer), holesMm: cloneJson(row.holes) })), clusterId, coveragePpm: vegetation.coveragePpm }
          document.decorationClusters[clusterId] = generated.cluster
          document.entityLayers[ruleId] = p.layerId; document.entityLayers[clusterId] = p.layerId
          for (const prop of generated.props) if (accepted.has(prop.id)) { document.props[prop.id] = prop; document.entityLayers[prop.id] = p.layerId; report.propIds.push(prop.id) }
          for (const row of generated.decorations) if (accepted.has(row.id)) { document.decorations[row.id] = row; document.entityLayers[row.id] = p.layerId; report.decorationIds.push(row.id) }
          const placed = accepted.size
          report.surfaceRuleIds.push(ruleId); report.vegetation.push({ zoneId: zone.id, role: vegetation.role, requested, placed, ruleId, clusterId })
          if (placed < requested) report.notes.push(`林区${zone.id}的${vegetation.role}目标${requested}件，实际${placed}件；其余受固定尺寸、支撑、通路/空地保留和有限位置搜索限制。`)
        }
      }
      checkForestResult(document, input, report, appearance)
      detachChangedOutputs(before as SceneDocument, document)
      persist(document, source, input); return document
    },
  })
  const parameters = captureJson(input) as unknown as Record<string, JsonValue>
  const stepInput = (stepId: string, operator: string, kind: 'plan-region' | 'port' | 'access-zone') => ({ id: kind, kind, from: { kind: 'step' as const, stepId, operator: { id: operator, version } }, cardinality: { min: kind === 'plan-region' ? 1 : 0, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' as const })
  const recipe = registry.registerRecipe({ id: 'forest-layout', version, steps: [
    { id: 'ground', operator: { id: 'forest-ground', version }, required: true, parameters, dependsOn: [], inputs: [{ id: 'source', kind: 'support-surface', from: { kind: 'source' }, cardinality: { min: 1, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' }] },
    { id: 'routes', operator: { id: 'forest-routes', version }, required: true, parameters, dependsOn: ['ground'], inputs: [stepInput('ground', 'forest-ground', 'plan-region'), { id: 'surfaces', kind: 'support-surface', from: p.ground.kind === 'new' ? { kind: 'step', stepId: 'ground', operator: { id: 'forest-ground', version } } : { kind: 'source' }, cardinality: { min: 1, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' }] },
    { id: 'vegetation', operator: { id: 'forest-vegetation', version }, required: true, parameters, dependsOn: ['ground', 'routes'], inputs: [stepInput('ground', 'forest-ground', 'plan-region'), stepInput('routes', 'forest-routes', 'port'), stepInput('routes', 'forest-routes', 'access-zone')] },
  ] })
  const request: GenerationRequest = { requestVersion: 1, normalizationVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { environment: 'forest', structures: [], purposes: ['clearing', 'route', 'vegetation'], tags: [] }, intentSource: { kind: 'manual', contentHash: hashGenerationValue(input) }, hardConstraints: [{ id: 'forest-bounds', kind: 'bounds', boundsMm: p.boundsMm }], softGoals: [], seed: input.seed, budgetProfile: profile, recipe }
  const candidate = runGeneration(request, registry, { source, nowMilliseconds: options.nowMilliseconds, signal: options.signal })
  const resultHash = hashGenerationValue({ input, report, documentHash: candidate.documentHash, outputHash: candidate.outputHash, stages: candidate.stages })
  return freezeJson({ input, report, candidate, resultHash })
}
