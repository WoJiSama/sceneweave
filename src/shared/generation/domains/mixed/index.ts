import type { SceneDocument, PointMm } from '../../../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../../../model/scene.js'
import { applyCommands } from '../../../commands/commands.js'
import { assertTaskBudget, emptyBudgetUsage, measureTaskBudget, parseTaskBudgetProfile, captureExecutionBudget, BUDGET_DIMENSIONS, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { captureJson, cloneJson, freezeJson, canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../../../terrain-generation/integrity.js'
import type { GenerationRecipe, GenerationReference, GenerationRule } from '../../../terrain-generation/contracts.js'
import { createSpaceContext } from '../../space.js'
import { GenerationRegistry, runGeneration, GenerationError } from '../../orchestrator.js'
import { hashGenerationValue, type GenerationCandidate, type GenerationRequest, type GenerationArtifact, type JsonValue } from '../../contracts.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { normalizeInteriorInput, runSupportedInteriorGeneration } from '../interior/index.js'
import { normalizeForestInput, runForestGeneration, forestEntityId, forestRectangle, type ForestGenerationInput } from '../forest/index.js'
import { normalizeVolcanoInput, runVolcanoGeneration, checkVolcanoResult, volcanoEntityId } from '../volcano/index.js'
import { mixedGenerationInputSchema, mixedFixedBindings, type MixedGenerationInput, type MixedReport } from './contracts.js'

export * from './contracts.js'
export { defaultMixedInput } from './defaults.js'
export const mixedEntityId = (sceneId: string, seed: string, key: string) => `mixed-${hashGenerationValue([sceneId, seed, key]).slice(0, 32)}`
const moduleSeed = (seed: string, module: string) => hashGenerationValue(['mixed-layout', 1, seed, module])
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

export function normalizeMixedInput(raw: unknown): MixedGenerationInput {
  const input = mixedGenerationInputSchema.parse(captureJson(raw)), p = input.parameters, outdoor = p.outdoor
  p.building = cloneJson(normalizeInteriorInput({ version: 1, algorithmVersion: 2, seed: moduleSeed(input.seed, 'building'), parameters: p.building }).parameters)
  outdoor.parameters = cloneJson(outdoor.kind === 'forest'
    ? normalizeForestInput({ version: 1, algorithmVersion: 1, seed: moduleSeed(input.seed, 'outdoor'), parameters: outdoor.parameters }).parameters
    : normalizeVolcanoInput({ version: 1, algorithmVersion: 1, seed: moduleSeed(input.seed, 'outdoor'), parameters: outdoor.parameters }).parameters)
  if (p.building.floorId !== outdoor.parameters.floorId) throw new GenerationError('invalid-request', '混合建筑与室外模块须明确选择同一Floor。')
  if (!p.building.arrangement.entrance || p.building.arrangement.doorWidthMm < p.approach.widthMm) throw new GenerationError('invalid-request', '初次混合生成须建议真实外门，且门净宽须容纳接入路线。')
  if (outdoor.kind === 'forest') {
    if (outdoor.parameters.ground.kind !== 'new' || [...outdoor.parameters.zones, ...outdoor.parameters.clearings, ...outdoor.parameters.entrances].some(row => row.supportRef.kind !== 'generated-ground')) throw new GenerationError('invalid-request', '首版森林混合候选须显式新建同一地面；已有场景使用受限局部修改。')
    if (!outdoor.parameters.entrances.some(row => equal(row.positionMm, p.approach.fromMm) && row.widthMm >= p.approach.widthMm)) throw new GenerationError('invalid-request', '建筑接入须绑定一个足宽的实际森林入口坐标。')
  } else if (!equal(p.approach.fromMm, outdoor.parameters.platform.anchorMm)) throw new GenerationError('invalid-request', '火山建筑接入须绑定平台已有路线锚点。')
  return freezeJson(input)
}

/** Composition owns only its foundation and approach. Building and outdoor
 * modules retain their own strict recipes and finite output ownership. */
function persist(document: SceneDocument, input: MixedGenerationInput, supportAreaId: string, entranceOpeningId?: string): void {
  const p = input.parameters, gen = getLegacyGeneration(document)!, id = (key: string) => mixedEntityId(document.sceneId, input.seed, key), recipeId = id('recipe')
  const recipe: GenerationRecipe = { id: recipeId, domain: 'mixed', recipeVersion: 1, algorithmId: 'mixed-layout', algorithmVersion: 1, mapMode: 'scene', seed: input.seed,
    parameters: cloneJson(p), ...mixedFixedBindings(p), precision: { sampleSpacingMm: 1, toleranceMm: 1, noiseCellMm: 1 } }
  gen.recipes[recipeId] = recipe
  const addRule = (key: string, kind: 'terrainArea' | 'path', entityId: string, inputs: GenerationReference[]) => {
    const ruleId = id(`rule:${key}`), fields = ['geometry', 'properties', 'surface', 'source'] as const
    const target: GenerationReference = { kind, entityId, parentId: null, fieldGroup: 'geometry' }
    const ownerId = id(`owner:${key}`)
    gen.ownership[ownerId] = { id: ownerId, outputKey: `${recipeId}:${key}`, ruleId, target, managedFields: [...fields], manualFields: [], state: 'managed', birthToken: id(`birth:${key}`) }
    const rule: GenerationRule = { id: ruleId, floorId: p.outdoor.parameters.floorId, layerId: p.outdoor.parameters.layerId, visibility: 'public', editLocked: false, kind: 'composition', recipeRef: { id: recipeId, version: 1 },
      inputs, outputs: fields.map(fieldGroup => ({ ...target, fieldGroup })), parameters: { widthMm: p.approach.widthMm, minWidthMm: 0, maxWidthMm: p.approach.widthMm, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
    gen.rules[ruleId] = rule
    rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule)
  }
  if (p.outdoor.kind === 'forest') addRule('ground', 'terrainArea', supportAreaId, [])
  if (entranceOpeningId) {
    const port = resolveBuildingEntrancePort(document, entranceOpeningId, p.approach.widthMm), wallId = document.openings[entranceOpeningId].wallId
    addRule('approach', 'path', id('approach'), ([
      ['terrainArea', supportAreaId], ['opening', entranceOpeningId], ['wall', wallId], ['room', port.roomId],
    ] as const).flatMap(([kind, entityId]) => (['geometry', 'properties'] as const).map(fieldGroup => ({ kind, entityId, parentId: null, fieldGroup }))))
  }
}

type Options = { profile: TaskBudgetProfile; nowMilliseconds: () => number; signal?: { readonly aborted: boolean } }
/** Single-purpose adapters keep the orchestrator's phase write limits. There is
 * deliberately no broad mixed materialization bypass or natural replay bridge. */
function runAdapter(source: SceneDocument, input: MixedGenerationInput, supportAreaId: string, options: Options, openingId?: string): GenerationCandidate {
  const p = input.parameters, registry = new GenerationRegistry(), ground = !openingId, name = ground ? 'mixed-ground' : 'mixed-approach'
  const phase = ground ? 'structure' : 'connectivity', produces = ground ? ['support-surface' as const] : ['access-zone' as const]
  registry.register({ id: name, version: 1, phase, owner: phase, consumes: ground ? ['support-surface'] : ['support-surface', 'opening'], produces, publishFacts: produces, requires: [],
    determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' }, parseParameters: raw => captureJson(raw), run: () => ({ outputs: [] }),
    materialize({ document: before, context }) {
      const runtime = { ids: { nextId: () => mixedEntityId(source.sceneId, input.seed, `${name}:native`) }, clock: { now: () => source.updatedAt } }
      let document = cloneJson(before) as SceneDocument
      if (ground) {
        const outdoor = p.outdoor
        if (outdoor.kind !== 'forest' || outdoor.parameters.ground.kind !== 'new') throw new GenerationError('invalid-request', '地面适配要求明确森林新支撑。')
        const f = outdoor.parameters, g = outdoor.parameters.ground
        document = applyCommands(document, [{ type: 'createTerrainArea', id: supportAreaId, floorId: f.floorId, layerId: f.layerId, boundaryMm: forestRectangle(f.boundsMm), groundElevationMm: g.elevationMm,
          ...(g.materialRef ? { materialRef: g.materialRef } : {}) }], runtime, { budget: options.profile })
        persist(document, input, supportAreaId)
      } else {
        const port = resolveBuildingEntrancePort(document, openingId!, p.approach.widthMm), meter = captureExecutionBudget(options.profile)
        if (port.supportRef.id !== supportAreaId) throw new GenerationError('candidate-invalid', '真实外门与混合建筑声明的支撑不一致。')
        const { fromMm: from, viaMm, widthMm } = p.approach, to = port.outsideMm
        const b = p.building.boundsMm, margin = Math.ceil(p.building.wallThicknessMm / 2) + Math.ceil(widthMm / 2) + 2
        const variants: PointMm[][] = viaMm.length ? [[from, ...viaMm, to]] : [
          [from, to], [from, { x: from.x, y: to.y }, to], [from, { x: to.x, y: from.y }, to],
          ...[b.x - margin, b.x + b.width + margin].map(x => [from, { x, y: from.y }, { x, y: to.y }, to]),
          ...[b.y - margin, b.y + b.height + margin].map(y => [from, { x: from.x, y }, { x: to.x, y }, to]),
        ]
        let selected: { pointsMm: PointMm[]; supportRefs: ReturnType<typeof checkTerrainRoute>['supportRefs'] } | undefined
        const notes: string[] = []
        for (const variant of variants) {
          context.checkCancelled(); meter.charge({ gridNodes: 1, fieldEvaluations: Object.keys(document.walls).length + Object.keys(document.props).length + variant.length })
          const pointsMm = variant.filter((point, index) => index === 0 || !equal(point, variant[index - 1]))
          if (pointsMm.length < 2) continue
          const route = checkTerrainRoute(document, { floorId: port.floorId, pointsMm, widthMm }), joined = checkTerrainRoute(document, { floorId: port.floorId, pointsMm: [...pointsMm, port.insideMm], widthMm })
          if (route.ok && joined.ok) { selected = { pointsMm, supportRefs: route.supportRefs }; break }
          notes.push(...route.issues.map(row => row.message), ...joined.issues.map(row => row.message))
        }
        if (!selected) throw new GenerationError('candidate-invalid', `建筑接入路线完整净宽不可用：${[...new Set(notes)].join('；')}`)
        document = applyCommands(document, [{ type: 'createPath', id: mixedEntityId(source.sceneId, input.seed, 'approach'), floorId: port.floorId, layerId: p.outdoor.parameters.layerId,
          centerlineMm: selected.pointsMm, widthMm, supportRefs: selected.supportRefs, ...(p.approach.materialRef ? { materialRef: p.approach.materialRef } : {}) }], runtime, { budget: options.profile })
        persist(document, input, supportAreaId, openingId)
      }
      return document
    },
  })
  const facts = createSpaceContext(source).artifacts
  const support = facts.find(fact => fact.kind === 'support-surface' && fact.payload.sourceRef.id === (ground ? p.outdoor.parameters.floorId : supportAreaId))!
  const parameters = captureJson(input) as unknown as Record<string, JsonValue>
  const inputs = [{ id: 'support', kind: 'support-surface' as const, from: { kind: 'source' as const }, artifactIds: [support.id], cardinality: { min: 1, max: 1 }, floorId: p.outdoor.parameters.floorId, coordinateFrame: 'scene-mm' as const },
    ...(!ground ? [{ id: 'door', kind: 'opening' as const, from: { kind: 'source' as const }, artifactIds: [facts.find(fact => fact.kind === 'opening' && fact.payload.entityId === openingId)!.id], cardinality: { min: 1, max: 1 }, floorId: p.outdoor.parameters.floorId, coordinateFrame: 'scene-mm' as const }] : [])]
  const recipe = registry.registerRecipe({ id: name, version: 1, steps: [{ id: name, operator: { id: name, version: 1 }, required: true, parameters, dependsOn: [], inputs }] })
  const request: GenerationRequest = { requestVersion: 1, normalizationVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { environment: p.outdoor.kind, structures: ['building'], purposes: ['mixed'], tags: [] }, intentSource: { kind: 'manual', contentHash: hashGenerationValue(input) }, hardConstraints: [{ id: 'mixed-bounds', kind: 'bounds', boundsMm: p.outdoor.parameters.boundsMm }], softGoals: [], seed: input.seed, budgetProfile: options.profile, recipe }
  return runGeneration(request, registry, { source, ...options })
}

/** Coordinate bounded existing domain runners, preserving every inner stage
 * receipt and charging their cumulative work before any result is published. */
export function runMixedGeneration(base: SceneDocument, raw: unknown, options: Options): { input: MixedGenerationInput; candidate: GenerationCandidate; report: MixedReport; resultHash: string } {
  const input = normalizeMixedInput(raw), profile = parseTaskBudgetProfile(options.profile), source = captureJson(base), p = input.parameters
  if (!validateSceneDocument(source).ok || source.mapMode !== 'scene' || Object.keys(source.floors).length !== 1
    || [...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS].some(key => Object.keys(source[key]).length)
    || Object.keys(source.vertices).length || Object.keys(getLegacyGeneration(source)!.recipes).length) throw new GenerationError('invalid-request', '混合全图生成须使用合法独立单Floor空白工程。')
  const usage = emptyBudgetUsage(), stages: GenerationCandidate['stages'][number][] = [], outputs: GenerationArtifact[] = [], diagnostics: GenerationCandidate['diagnostics'][number][] = []
  usage.candidateAttempts = 1
  const start = options.nowMilliseconds(); let lastTime = start, current = source
  const nowMilliseconds = () => {
    if (options.signal?.aborted) throw new GenerationError('cancelled', '混合生成已取消，未发布部分候选。')
    const now = options.nowMilliseconds()
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(now) || now < lastTime) throw new GenerationError('invalid-request', '混合执行时钟须返回非负单调整数毫秒。')
    lastTime = now
    if (now - start > profile.limits.activeExecutionMs) throw new GenerationError('budget-exceeded', '混合生成累计执行时间超限。')
    return now
  }
  nowMilliseconds()
  const opts = { ...options, profile, nowMilliseconds }
  const append = (module: string, candidate: GenerationCandidate) => {
    if (candidate.sourceHash !== hashGenerationValue(current)) throw new GenerationError('candidate-invalid', '混合前序候选摘要断链。')
    for (const key of BUDGET_DIMENSIONS) usage[key] += key === 'candidateAttempts' ? Math.max(0, candidate.usage[key] - 1) : candidate.usage[key]
    usage.activeExecutionMs = Math.max(usage.activeExecutionMs, nowMilliseconds() - start)
    assertTaskBudget(profile, usage)
    stages.push(...candidate.stages.map(stage => ({ ...stage, stepId: `${module}:${stage.stepId}` })))
    outputs.push(...candidate.outputs); diagnostics.push(...candidate.diagnostics)
    current = cloneJson(candidate.document) as SceneDocument
  }
  const outdoorSeed = moduleSeed(input.seed, 'outdoor'), buildingSeed = moduleSeed(input.seed, 'building')
  let outdoorRecipeId: string, volcano: ReturnType<typeof runVolcanoGeneration> | undefined
  const supportAreaId = p.outdoor.kind === 'forest' ? mixedEntityId(source.sceneId, input.seed, 'ground') : volcanoEntityId(source.sceneId, outdoorSeed, 'platform')
  if (p.outdoor.kind === 'forest') append('foundation', runAdapter(current, input, supportAreaId, opts))
  else {
    volcano = runVolcanoGeneration(current, { version: 1, algorithmVersion: 1, seed: outdoorSeed, parameters: p.outdoor.parameters }, opts)
    append('outdoor', volcano.candidate)
  }
  const building = runSupportedInteriorGeneration(current, { version: 1, algorithmVersion: 1, seed: buildingSeed, parameters: { ...cloneJson(p.building), supportRef: { kind: 'terrainArea', id: supportAreaId } } }, opts)
  append('building', building.candidate)
  const entranceOpeningId = building.report.connectivity.entranceOpeningId
  if (!entranceOpeningId) throw new GenerationError('candidate-invalid', '初次混合候选未找到可接入的真实外门；请调整建筑尺寸或门建议参数。')
  append('approach', runAdapter(current, input, supportAreaId, opts, entranceOpeningId))
  const notes = [...building.report.notes]
  if (p.outdoor.kind === 'forest') {
    const parameters = cloneJson(p.outdoor.parameters)
    parameters.ground = { kind: 'existing' }
    for (const row of [...parameters.zones, ...parameters.clearings, ...parameters.entrances]) row.supportRef = { kind: 'terrainArea', id: supportAreaId }
    const forestInput: ForestGenerationInput = { version: 1, algorithmVersion: 1, seed: outdoorSeed, parameters }
    const forest = runForestGeneration(current, forestInput, opts)
    append('outdoor', forest.candidate); notes.push(...forest.report.notes)
    outdoorRecipeId = forestEntityId(source.sceneId, outdoorSeed, 'recipe')
  } else {
    checkVolcanoResult(current, volcano!.input, volcano!.report); notes.push(...volcano!.report.notes)
    outdoorRecipeId = volcanoEntityId(source.sceneId, outdoorSeed, 'recipe')
  }
  const finalRoute = current.paths[mixedEntityId(source.sceneId, input.seed, 'approach')]
  const port = resolveBuildingEntrancePort(current, entranceOpeningId, p.approach.widthMm)
  for (const pointsMm of [finalRoute.centerlineMm, [...finalRoute.centerlineMm, port.insideMm]]) {
    const checked = checkTerrainRoute(current, { floorId: port.floorId, pointsMm, widthMm: p.approach.widthMm })
    if (!checked.ok) throw new GenerationError('candidate-invalid', `后续内容破坏建筑接入净空：${checked.issues.map(row => row.message).join('；')}`)
  }
  const buildingRecipe = Object.values(getLegacyGeneration(current)!.recipes).find(row => 'domain' in row && row.domain === 'interior' && row.algorithmId === 'supported-interior')!
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  const sorted = outputs.sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id))
  if (new Set(sorted.map(row => row.id)).size !== sorted.length) throw new GenerationError('ownership-conflict', '混合模块输出事实身份冲突。')
  const full = measureTaskBudget(source, current)
  for (const key of BUDGET_DIMENSIONS) usage[key] = Math.max(usage[key], full[key])
  usage.activeExecutionMs = Math.max(usage.activeExecutionMs, nowMilliseconds() - start)
  assertTaskBudget(profile, usage)
  const report: MixedReport = { environment: p.outdoor.kind, supportAreaId, buildingRecipeId: buildingRecipe.id, outdoorRecipeId,
    roomIds: Object.keys(current.rooms).sort(), openingIds: Object.keys(current.openings).sort(), propIds: Object.keys(current.props).sort(), entranceOpeningId, approachPathId: finalRoute.id, notes }
  const candidate: GenerationCandidate = { status: 'prepared', materializationRequired: true, requestHash: hashGenerationValue({ algorithm: 'mixed-layout', version: 1, input, profile }), sourceHash: hashGenerationValue(source),
    document: freezeJson(current), documentHash: hashGenerationValue(current), outputs: sorted, outputHash: hashGenerationValue(sorted.map(row => [row.kind, row.id, row.contentHash])), diagnostics, usage, stages }
  const resultHash = hashGenerationValue({ input, report, documentHash: candidate.documentHash, outputHash: candidate.outputHash, stages: candidate.stages })
  return freezeJson({ input, candidate, report, resultHash })
}
