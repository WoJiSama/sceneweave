import type { SceneDocument, PointMm, Path } from '../../../model/scene.js'
import { applyCommands, type SceneCommand } from '../../../commands/commands.js'
import { parseTaskBudgetProfile, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { captureJson, cloneJson, freezeJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { polygonInside, polygonDistance, polygonsOverlap, pointInPolygon, supportedPolygon, pathPolygon } from '../../../geometry/geometry.js'
import { polygonBooleanWithHoles } from '../../../geometry/polygon-boolean.js'
import { checkTerrainRoute, assertTerrainConnectionClearances } from '../../../geometry/terrain-travel.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash, detachChangedOutputs } from '../../../terrain-generation/integrity.js'
import type { GenerationFieldGroup, GenerationRecipe, GenerationRule } from '../../../terrain-generation/contracts.js'
import { GenerationRegistry, runGeneration } from '../../orchestrator.js'
import { hashGenerationValue, type GenerationCandidate, type GenerationRequest, type JsonValue } from '../../contracts.js'
import { volcanoGenerationInputSchema, VolcanoGenerationError, type VolcanoGenerationInput } from './contracts.js'

export * from './contracts.js'
export interface VolcanoReport {
  groundAreaId: string; mountainAreaId: string; craterAreaId: string; platformAreaId: string; flowAreaId: string | null
  connectionIds: string[]; pathIds: string[]; regionIds: string[]; notes: string[]
}
export const volcanoEntityId = (sceneId: string, seed: string, key: string) => `volcano-${hashGenerationValue([sceneId, seed, key]).slice(0, 32)}`
export const volcanoRectangle = (b: { x: number; y: number; width: number; height: number }): PointMm[] => [
  { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
]
/** A parameter template, not sampled geometry or a copy of the volcano scene. */
export function defaultVolcanoInput(document: SceneDocument, seed = 'volcano-1'): VolcanoGenerationInput {
  const floor = Object.values(document.floors)[0], layer = Object.values(document.userLayers).find(row => row.floorId === floor.id && !row.editLocked)!
  const b = floor.boundsMm, at = (x: number, y: number) => ({ x: b.x + Math.round(b.width * x), y: b.y + Math.round(b.height * y) })
  const box = (x: number, y: number, w: number, h: number) => { const a = at(x, y), z = at(x + w, y + h); return volcanoRectangle({ ...a, width: z.x - a.x, height: z.y - a.y }) }
  const mat = (id: string) => ({ id: `content-m-${id}`, version: 1 })
  return { version: 1, algorithmVersion: 1, seed, parameters: {
    floorId: floor.id, layerId: layer.id, boundsMm: { ...b }, groundElevationMm: 0,
    mountain: { boundaryMm: box(.2, .125, .7, .75), elevationMm: 2000 },
    crater: { boundaryMm: box(.55, .3, .25, .4), elevationMm: -500, hazard: true, blocksMovement: false, movementCostMultiplier: 2 },
    platform: { boundaryMm: box(.33, .4, .15, .2), anchorMm: at(.405, .5) },
    entrance: { positionMm: at(.075, .5), directionDeg: 0 },
    ascent: { kind: 'stairs', fromMm: at(.15, .5), toMm: at(.25, .5) },
    descent: { kind: 'ramp', fromMm: at(.51, .5), toMm: at(.59, .5) },
    route: { widthMm: 1500, toPlatformViaMm: [], toCraterViaMm: [] },
    flow: { centerlineMm: [at(.72, .4), at(.73, .6)], widthMm: 1200, hazard: true, blocksMovement: true, movementCostMultiplier: 3 },
    regions: [], materials: { ground: mat('volcanic-ash'), mountain: mat('basalt'), crater: mat('lava'), platform: mat('volcanic-ash'), flow: mat('lava-hot'), route: mat('volcanic-ash') },
  } }
}
function compact(points: PointMm[]): PointMm[] {
  const result: PointMm[] = []
  for (const p of points) {
    if (result.length && result.at(-1)!.x === p.x && result.at(-1)!.y === p.y) continue
    while (result.length >= 2) {
      const a = result.at(-2)!, b = result.at(-1)!, abx = BigInt(b.x - a.x), aby = BigInt(b.y - a.y), bcx = BigInt(p.x - b.x), bcy = BigInt(p.y - b.y)
      if (abx * bcy !== aby * bcx || abx * bcx + aby * bcy <= 0n) break
      result.pop()
    }
    result.push({ ...p })
  }
  return result
}
const flowBoundary = (input: VolcanoGenerationInput) => {
  const f = input.parameters.flow
  return f ? pathPolygon({ centerlineMm: f.centerlineMm, widthMm: f.widthMm } as Path).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) : null
}
export function normalizeVolcanoInput(raw: unknown): VolcanoGenerationInput {
  let input: VolcanoGenerationInput
  try { input = volcanoGenerationInputSchema.parse(captureJson(raw)) } catch (error) { throw new VolcanoGenerationError('invalid-input', `火山参数无效：${String(error)}`) }
  const p = input.parameters, ground = volcanoRectangle(p.boundsMm)
  if (![p.boundsMm.x + p.boundsMm.width, p.boundsMm.y + p.boundsMm.height].every(Number.isSafeInteger)) throw new VolcanoGenerationError('invalid-input', '火山范围超过安全整数。')
  if (new Set(p.regions.map(row => row.id)).size !== p.regions.length) throw new VolcanoGenerationError('invalid-input', '火山区域需求ID重复。')
  if (p.mountain.elevationMm <= p.groundElevationMm || p.crater.elevationMm >= p.mountain.elevationMm) throw new VolcanoGenerationError('contradiction', '山体须高于基底，火口须真实低于山体。')
  const flow = flowBoundary(input)
  for (const boundary of [ground, p.mountain.boundaryMm, p.crater.boundaryMm, p.platform.boundaryMm, ...p.regions.map(row => row.boundaryMm), ...(flow ? [flow] : [])]) {
    try { polygonBooleanWithHoles({ operation: 'union', subject: [{ outer: boundary, holes: [] }], clip: [] }) } catch { throw new VolcanoGenerationError('invalid-input', '火山轮廓或流道完整带区须为合法简单闭环。') }
    if (!polygonInside(boundary, ground)) throw new VolcanoGenerationError('contradiction', '火山全部轮廓须留在生成范围。')
  }
  const strictInside = (inner: PointMm[], outer: PointMm[]) => polygonInside(inner, outer) && polygonDistance(inner, outer) === 0 && inner.every(point => pointInPolygon(point, outer, false))
  // polygonDistance is zero for nested polygons; point inclusion plus the native
  // complete scene validator rejects any boundary contact or edge crossing.
  if (!strictInside(p.mountain.boundaryMm, ground) || !strictInside(p.crater.boundaryMm, p.mountain.boundaryMm) || !strictInside(p.platform.boundaryMm, p.mountain.boundaryMm)
    || polygonsOverlap(p.crater.boundaryMm, p.platform.boundaryMm)) throw new VolcanoGenerationError('contradiction', '山体、低火口与活动平台须严格内嵌，火口和平台不能相交。')
  if (!pointInPolygon(p.platform.anchorMm, p.platform.boundaryMm, false)) throw new VolcanoGenerationError('contradiction', '平台路线锚点须位于平台内部。')
  if (flow && !strictInside(flow, p.crater.boundaryMm)) throw new VolcanoGenerationError('unsupported', '首版流道完整宽带须在单火口内部；跨高差流道尚不支持。')
  p.regions.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return freezeJson(input)
}
export function volcanoFixedBindings(input: VolcanoGenerationInput) {
  return { materials: (['ground', 'mountain', 'crater', 'platform', 'flow', 'route'] as const).map(role => ({ role, ref: cloneJson(input.parameters.materials[role]) })), props: [] }
}
function persist(document: SceneDocument, base: SceneDocument, input: VolcanoGenerationInput): void {
  const p = input.parameters, gen = getLegacyGeneration(document)!, id = (key: string) => volcanoEntityId(document.sceneId, input.seed, key), recipeId = id('recipe')
  const recipe: GenerationRecipe = { id: recipeId, domain: 'volcano', recipeVersion: 1, algorithmId: 'volcano-layout', algorithmVersion: 1, mapMode: 'scene', seed: input.seed, parameters: cloneJson(p), ...volcanoFixedBindings(input), precision: { sampleSpacingMm: 1, toleranceMm: 1, noiseCellMm: 1 } }
  gen.recipes[recipeId] = recipe
  const managed: Record<string, GenerationFieldGroup[]> = { terrainArea: ['geometry', 'properties', 'surface', 'source'], terrainEdge: ['geometry', 'properties', 'surface', 'source'], terrainConnection: ['geometry', 'properties', 'surface', 'source'], path: ['geometry', 'properties', 'surface', 'source'], region: ['geometry', 'properties'] }
  for (const [collection, kind] of [['terrainAreas', 'terrainArea'], ['terrainEdges', 'terrainEdge'], ['terrainConnections', 'terrainConnection'], ['paths', 'path'], ['regions', 'region']] as const) for (const entity of Object.values(document[collection])) {
    if (base[collection][entity.id]) continue
    const ownerId = id(`owner:${kind}:${entity.id}`), ruleId = id(`rule:${kind}:${entity.id}`), fields = managed[kind]
    if (!gen.ownership[ownerId]) gen.ownership[ownerId] = { id: ownerId, outputKey: `${recipeId}:${kind}:${entity.id}`, ruleId, target: { kind, entityId: entity.id, parentId: null, fieldGroup: 'geometry' }, managedFields: [...fields], manualFields: [], state: 'managed', birthToken: id(`birth:${kind}:${entity.id}`) }
    if (!gen.rules[ruleId]) gen.rules[ruleId] = { id: ruleId, floorId: p.floorId, layerId: p.layerId, visibility: 'public', editLocked: false, kind: 'volcano', recipeRef: { id: recipeId, version: 1 }, inputs: [], outputs: fields.map(fieldGroup => ({ ...gen.ownership[ownerId].target, fieldGroup })), parameters: { widthMm: p.boundsMm.width, minWidthMm: 0, maxWidthMm: p.boundsMm.width, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
    const rule: GenerationRule = gen.rules[ruleId]
    rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule)
  }
}
export function checkVolcanoResult(document: SceneDocument, input: VolcanoGenerationInput, report: VolcanoReport): void {
  const p = input.parameters
  if (!supportedPolygon(document, p.platform.boundaryMm, { kind: 'terrainArea', id: report.platformAreaId }, p.floorId)) throw new VolcanoGenerationError('contradiction', '活动平台未完整落在自身真实高地支撑。')
  for (const pathId of report.pathIds) {
    const path = document.paths[pathId], result = checkTerrainRoute(document, { floorId: p.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm })
    if (!result.ok || !polygonInside(pathPolygon(path), volcanoRectangle(p.boundsMm))) throw new VolcanoGenerationError('contradiction', `火山指定路线完整净宽不可用：${result.issues.map(row => row.message).join('；')}`)
  }
  for (const region of Object.values(document.regions)) if (region.floorId === p.floorId && region.blocksMovement && polygonsOverlap(region.boundaryMm, p.platform.boundaryMm)) throw new VolcanoGenerationError('contradiction', '显式阻挡区占用活动平台。')
  try { assertTerrainConnectionClearances(document, report.connectionIds.map(connectionId => ({ connectionId, minWidthMm: p.route.widthMm, approachDepthMm: Math.max(1, Math.floor(p.route.widthMm / 3)) }))) } catch (error) { throw new VolcanoGenerationError('contradiction', String(error)) }
  const checked = validateSceneDocument(document)
  if (!checked.ok) throw new VolcanoGenerationError('contradiction', `火山完整候选校验失败：${checked.errors.map(row => row.message).join('；')}`)
}
export function runVolcanoGeneration(base: SceneDocument, raw: unknown, options: { profile: TaskBudgetProfile; nowMilliseconds: () => number; signal?: { readonly aborted: boolean } }): { input: VolcanoGenerationInput; report: VolcanoReport; candidate: GenerationCandidate; resultHash: string } {
  const input = normalizeVolcanoInput(raw), profile = parseTaskBudgetProfile(options.profile), source = captureJson(base), p = input.parameters
  if (!validateSceneDocument(source).ok) throw new VolcanoGenerationError('invalid-input', '火山基底须为合法完整场景。')
  if (source.mapMode !== 'scene' || Object.keys(source.floors).length !== 1 || !source.floors[p.floorId] || source.userLayers[p.layerId]?.floorId !== p.floorId || source.userLayers[p.layerId].editLocked) throw new VolcanoGenerationError('unsupported', '首版火山支持单Floor、明确未锁定图层。')
  if (['rooms', 'walls', 'props', 'prefabInstances', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'regions', 'scatterGroups', 'decorations', 'decorationClusters', 'surfaceRules'].some(key => Object.keys(source[key as 'props']).length)) throw new VolcanoGenerationError('unsupported', '首版火山只在独立空白基底生成；局部修改由D6接入。')
  if (!polygonInside(volcanoRectangle(p.boundsMm), volcanoRectangle(source.floors[p.floorId].boundsMm))) throw new VolcanoGenerationError('contradiction', '火山范围越过Floor。')
  for (const row of volcanoFixedBindings(input).materials) {
    const mat = source.materials[row.ref.id]
    if (!mat || mat.version !== row.ref.version || !mat.applicableSurfaces.includes(row.role === 'route' ? 'path' : 'terrain')) throw new VolcanoGenerationError('invalid-input', '火山材质缺失、固定版本不符或表面不适用。')
  }
  const id = (key: string) => volcanoEntityId(source.sceneId, input.seed, key), ref = (key: string) => ({ kind: 'terrainArea' as const, id: id(key) })
  const report: VolcanoReport = { groundAreaId: id('ground'), mountainAreaId: id('mountain'), craterAreaId: id('crater'), platformAreaId: id('platform'), flowAreaId: p.flow ? id('flow') : null, connectionIds: [], pathIds: [], regionIds: [], notes: ['危险、阻挡和移动代价来自明确参数；材质不决定通行。初次路线和活动平台保留为建议，后续手工删改不自动恢复。'] }
  const registry = new GenerationRegistry(), determinism = { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' as const }
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => id(`native:${sequence++}`) } }
  const parseParameters = (parameters: Readonly<Record<string, JsonValue>>) => captureJson(normalizeVolcanoInput(parameters)) as unknown as Record<string, JsonValue>
  registry.register({ id: 'volcano-structure', version: 1, phase: 'structure', owner: 'structure', consumes: ['support-surface'], produces: ['support-surface'], publishFacts: ['support-surface'], requires: [], determinism, parseParameters,
    run() { return { outputs: [] } },
    materialize({ document: before, context }) {
      context.checkCancelled()
      const common = { floorId: p.floorId, layerId: p.layerId }, flow = flowBoundary(input)
      const commands: SceneCommand[] = [
        { type: 'createTerrainArea', ...common, id: id('ground'), boundaryMm: volcanoRectangle(p.boundsMm), groundElevationMm: p.groundElevationMm, coveragePriority: 0, materialRef: p.materials.ground },
        { type: 'createTerrainArea', ...common, id: id('mountain'), boundaryMm: cloneJson(p.mountain.boundaryMm), groundElevationMm: p.mountain.elevationMm, coveragePriority: 1, materialRef: p.materials.mountain },
        { type: 'createTerrainArea', ...common, id: id('crater'), boundaryMm: cloneJson(p.crater.boundaryMm), groundElevationMm: p.crater.elevationMm, coveragePriority: 2, materialRef: p.materials.crater },
        { type: 'createTerrainArea', ...common, id: id('platform'), boundaryMm: cloneJson(p.platform.boundaryMm), groundElevationMm: p.mountain.elevationMm, coveragePriority: 2, materialRef: p.materials.platform },
      ]
      if (flow) commands.push({ type: 'createTerrainArea', ...common, id: id('flow'), boundaryMm: flow, groundElevationMm: p.crater.elevationMm, coveragePriority: 3, materialRef: p.materials.flow })
      for (const [key, shape] of [['mountain', p.mountain.boundaryMm], ['crater', p.crater.boundaryMm]] as const) for (let i = 0; i < shape.length; i++) commands.push({ type: 'createTerrainEdge', id: id(`edge:${key}:${i}`), layerId: p.layerId, source: { areaId: id(key), segmentId: `${id(key)}:segment:${i}` } })
      for (const row of [{ key: 'crater', ...p.crater }, ...(flow && p.flow ? [{ key: 'flow', ...p.flow, boundaryMm: flow }] : []), ...p.regions.map(row => ({ ...row, key: `explicit:${row.id}` }))]) {
        const regionId = id(`region:${row.key}`)
        commands.push({ type: 'createRegion', ...common, id: regionId, boundaryMm: cloneJson(row.boundaryMm), kind: row.hazard ? 'hazard' : 'terrain', blocksMovement: row.blocksMovement, movementCostMultiplier: row.movementCostMultiplier })
        report.regionIds.push(regionId)
      }
      const document = applyCommands(cloneJson(before) as SceneDocument, commands, runtime, { budget: profile })
      const gen = getLegacyGeneration(document)!
      gen.constraints[id('activity')] = { id: id('activity'), floorId: p.floorId, visibility: 'public', strength: 'soft', kind: 'activityArea', boundaryMm: cloneJson(p.platform.boundaryMm), clearanceMm: 0 }
      persist(document, source, input); return document
    },
  })
  registry.register({ id: 'volcano-connectivity', version: 1, phase: 'connectivity', owner: 'connectivity', consumes: ['support-surface'], produces: ['port', 'connection', 'access-zone'], publishFacts: ['port', 'connection', 'access-zone'], requires: [{ id: 'volcano-structure', version: 1 }], determinism, parseParameters,
    run() { return { outputs: [] } },
    materialize({ document: before, context }) {
      context.checkCancelled()
      const common = { floorId: p.floorId, layerId: p.layerId }
      let document = applyCommands(cloneJson(before) as SceneDocument, [
        { type: 'createTerrainConnection', ...common, id: id('ascent'), kind: p.ascent.kind, from: { surfaceRef: ref('ground'), positionMm: p.ascent.fromMm }, to: { surfaceRef: ref('mountain'), positionMm: p.ascent.toMm }, widthMm: p.route.widthMm },
        { type: 'createTerrainConnection', ...common, id: id('descent'), kind: p.descent.kind, from: { surfaceRef: ref('mountain'), positionMm: p.descent.fromMm }, to: { surfaceRef: ref('crater'), positionMm: p.descent.toMm }, widthMm: p.route.widthMm },
      ], runtime, { budget: profile })
      report.connectionIds.push(id('ascent'), id('descent'))
      const gen = getLegacyGeneration(document)!, paths: SceneCommand[] = []
      for (const [key, points] of [['approach', [p.entrance.positionMm, p.ascent.fromMm, p.ascent.toMm, ...p.route.toPlatformViaMm, p.platform.anchorMm]], ['crater-route', [p.platform.anchorMm, ...p.route.toCraterViaMm, p.descent.fromMm, p.descent.toMm]]] as const) {
        const pointsMm = compact(cloneJson([...points])), result = checkTerrainRoute(document, { floorId: p.floorId, pointsMm, widthMm: p.route.widthMm })
        if (!result.ok) throw new VolcanoGenerationError('contradiction', `指定火山路线${key}的支撑/完整净宽失败：${result.issues.map(row => row.message).join('；')}`)
        paths.push({ type: 'createPath', ...common, id: id(key), centerlineMm: pointsMm, widthMm: p.route.widthMm, supportRefs: result.supportRefs, materialRef: p.materials.route })
        report.pathIds.push(id(key))
        gen.constraints[id(`route:${key}`)] = { id: id(`route:${key}`), floorId: p.floorId, visibility: 'public', strength: 'soft', kind: 'route', pointsMm, minWidthMm: p.route.widthMm }
      }
      const r = Math.ceil(p.route.widthMm / 2), e = p.entrance.positionMm
      if (!supportedPolygon(document, volcanoRectangle({ x: e.x - r, y: e.y - r, width: 2 * r, height: 2 * r }), ref('ground'), p.floorId)) throw new VolcanoGenerationError('contradiction', '外部入口完整净宽必须由基底支撑。')
      gen.constraints[id('entrance')] = { id: id('entrance'), floorId: p.floorId, visibility: 'public', strength: 'soft', kind: 'port', positionMm: cloneJson(e), directionDeg: p.entrance.directionDeg, widthMm: p.route.widthMm }
      document = applyCommands(document, paths, runtime, { budget: profile })
      detachChangedOutputs(before as SceneDocument, document); persist(document, source, input)
      checkVolcanoResult(document, input, report)
      return document
    },
  })
  const parameters = captureJson(input) as unknown as Record<string, JsonValue>
  const recipe = registry.registerRecipe({ id: 'volcano-layout', version: 1, steps: [
    { id: 'structure', operator: { id: 'volcano-structure', version: 1 }, required: true, parameters, dependsOn: [], inputs: [{ id: 'base', kind: 'support-surface', from: { kind: 'source' }, cardinality: { min: 1, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' }] },
    { id: 'connectivity', operator: { id: 'volcano-connectivity', version: 1 }, required: true, parameters, dependsOn: ['structure'], inputs: [{ id: 'surfaces', kind: 'support-surface', from: { kind: 'step', stepId: 'structure', operator: { id: 'volcano-structure', version: 1 } }, cardinality: { min: 4, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' }] },
  ] })
  const request: GenerationRequest = { requestVersion: 1, normalizationVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { environment: 'volcano', structures: [], purposes: ['crater', 'platform', 'route', 'hazard'], tags: [] }, intentSource: { kind: 'manual', contentHash: hashGenerationValue(input) }, hardConstraints: [{ id: 'volcano-bounds', kind: 'bounds', boundsMm: p.boundsMm }], softGoals: [], seed: input.seed, budgetProfile: profile, recipe }
  const candidate = runGeneration(request, registry, { source, nowMilliseconds: options.nowMilliseconds, signal: options.signal })
  const resultHash = hashGenerationValue({ input, report, documentHash: candidate.documentHash, outputHash: candidate.outputHash, stages: candidate.stages })
  return freezeJson({ input, report, candidate, resultHash })
}
