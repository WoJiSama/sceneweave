import type { SceneDocument, PointMm } from '../../../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../../../model/scene.js'
import { applyCommands } from '../../../commands/commands.js'
import { parseTaskBudgetProfile, captureExecutionBudget, measureBudgetGeometry, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { captureJson, cloneJson, freezeJson, canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../../../terrain-generation/integrity.js'
import type { GenerationRecipe, GenerationReference, GenerationRule } from '../../../terrain-generation/contracts.js'
import { createSpaceContext } from '../../space.js'
import { generationCreationWrites } from '../../materialization.js'
import { GenerationCompositionExecution } from '../../composition-execution.js'
import { GenerationRegistry, runGeneration, GenerationError } from '../../orchestrator.js'
import { hashGenerationValue, type GenerationCandidate, type GenerationRequest, type JsonValue } from '../../contracts.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { normalizeInteriorInput, runSupportedInteriorGeneration } from '../interior/index.js'
import { normalizeForestInput, runForestGeneration, forestEntityId, forestRectangle, type ForestGenerationInput } from '../forest/index.js'
import { normalizeVolcanoInput, runVolcanoGeneration, checkVolcanoResult, volcanoEntityId } from '../volcano/index.js'
import { mixedGenerationInputSchema, mixedFixedBindings, type MixedGenerationInput, type MixedReport } from './contracts.js'
import { planBuildingEntranceApproaches } from './entrance-approach.js'

export * from './contracts.js'
export { defaultMixedInput, defaultMixedInputV3, defaultMixedInputV4, defaultMixedInputV5, defaultMixedInputV6, defaultMixedInputV7, defaultMixedInputV8, defaultMixedInputV9 } from './defaults.js'
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
  const recipe: GenerationRecipe = { id: recipeId, domain: 'mixed', ...(input.algorithmVersion === 1 ? { recipeVersion: 1 as const, algorithmVersion: 1 as const } : input.algorithmVersion === 2 ? { recipeVersion: 2 as const, algorithmVersion: 2 as const } : input.algorithmVersion === 3 ? { recipeVersion: 3 as const, algorithmVersion: 3 as const } : input.algorithmVersion === 4 ? { recipeVersion: 4 as const, algorithmVersion: 4 as const } : input.algorithmVersion === 5 ? { recipeVersion: 5 as const, algorithmVersion: 5 as const } : input.algorithmVersion === 6 ? { recipeVersion: 6 as const, algorithmVersion: 6 as const } : input.algorithmVersion === 7 ? { recipeVersion: 7 as const, algorithmVersion: 7 as const } : input.algorithmVersion === 8 ? { recipeVersion: 8 as const, algorithmVersion: 8 as const } : { recipeVersion: 9 as const, algorithmVersion: 9 as const }), algorithmId: 'mixed-layout', mapMode: 'scene', seed: input.seed,
    parameters: cloneJson(p), ...mixedFixedBindings(p), precision: { sampleSpacingMm: 1, toleranceMm: 1, noiseCellMm: 1 } }
  gen.recipes[recipeId] = recipe
  const addRule = (key: string, kind: 'terrainArea' | 'path', entityId: string, inputs: GenerationReference[]) => {
    const ruleId = id(`rule:${key}`), fields = ['geometry', 'properties', 'surface', 'source'] as const
    const target: GenerationReference = { kind, entityId, parentId: null, fieldGroup: 'geometry' }
    const ownerId = id(`owner:${key}`)
    gen.ownership[ownerId] = { id: ownerId, outputKey: `${recipeId}:${key}`, ruleId, target, managedFields: [...fields], manualFields: [], state: 'managed', birthToken: id(`birth:${key}`) }
    const rule: GenerationRule = { id: ruleId, floorId: p.outdoor.parameters.floorId, layerId: p.outdoor.parameters.layerId, visibility: 'public', editLocked: false, kind: 'composition', recipeRef: { id: recipeId, version: recipe.recipeVersion },
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
    writes: ({ document }) => generationCreationWrites(document, ground ? ['terrainAreas'] : ['paths']),
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
        const variants: PointMm[][] = input.algorithmVersion >= 3 ? planBuildingEntranceApproaches({ port, fromMm: from, viaMm,
          buildingBoundsMm: b, wallThicknessMm: p.building.wallThicknessMm }).variantsMm : viaMm.length ? [[from, ...viaMm, to]] : [
          [from, to], [from, { x: from.x, y: to.y }, to], [from, { x: to.x, y: from.y }, to],
          ...[b.x - margin, b.x + b.width + margin].map(x => [from, { x, y: from.y }, { x, y: to.y }, to]),
          ...[b.y - margin, b.y + b.height + margin].map(y => [from, { x: from.x, y }, { x: to.x, y }, to]),
        ]
        let selected: { pointsMm: PointMm[]; supportRefs: ReturnType<typeof checkTerrainRoute>['supportRefs'] } | undefined
        const notes: string[] = []
        // Each new full-band check also validates the retained physical scene.
        // Charge a conservative pair bound for both road/door continuations,
        // including rejected alternatives; the executor's work observer folds
        // these charges into the same cumulative composition budget.
        const retainedSegments = input.algorithmVersion >= 3 ? LAYER_ENTITY_COLLECTIONS.reduce((sum, key) => sum + Object.values(document[key]).reduce((n, row) => n + measureBudgetGeometry(row).geometrySegments, 0), 0) : 0
        if (input.algorithmVersion >= 3) meter.charge({ fieldEvaluations: variants.reduce((sum, points) => sum + points.length, 0) })
        for (const variant of variants) {
          context.checkCancelled(); meter.charge({ gridNodes: 1, fieldEvaluations: Object.keys(document.walls).length + Object.keys(document.props).length + variant.length })
          const pointsMm = variant.filter((point, index) => index === 0 || !equal(point, variant[index - 1]))
          if (pointsMm.length < 2) continue
          if (input.algorithmVersion >= 3) meter.charge({ intersectionPairs: 2 * (retainedSegments + 6 * (pointsMm.length + 1)) ** 2 })
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
  const execution = new GenerationCompositionExecution(source, { ...options, profile })
  const outdoorSeed = moduleSeed(input.seed, 'outdoor'), buildingSeed = moduleSeed(input.seed, 'building')
  let outdoorRecipeId: string, volcano: ReturnType<typeof runVolcanoGeneration> | undefined
  const supportAreaId = p.outdoor.kind === 'forest' ? mixedEntityId(source.sceneId, input.seed, 'ground') : volcanoEntityId(source.sceneId, outdoorSeed, 'platform')
  if (p.outdoor.kind === 'forest') execution.run('foundation', (current, opts) => ({ candidate: runAdapter(current, input, supportAreaId, opts) }))
  else {
    const parameters = p.outdoor.parameters
    volcano = execution.run('outdoor', (current, opts) => runVolcanoGeneration(current, { version: 1, algorithmVersion: 1, seed: outdoorSeed, parameters }, opts))
  }
  const buildingVersion = input.algorithmVersion >= 4 ? input.algorithmVersion : input.algorithmVersion === 3 ? 2 : input.algorithmVersion
  const building = execution.run('building', (current, opts) => runSupportedInteriorGeneration(current, { version: 1, algorithmVersion: buildingVersion, seed: buildingSeed, parameters: { ...cloneJson(p.building), supportRef: { kind: 'terrainArea', id: supportAreaId } } }, opts))
  const entranceOpeningId = building.report.connectivity.entranceOpeningId
  if (!entranceOpeningId) throw new GenerationError('candidate-invalid', '初次混合候选未找到可接入的真实外门；请调整建筑尺寸或门建议参数。')
  execution.run('approach', (current, opts) => ({ candidate: runAdapter(current, input, supportAreaId, opts, entranceOpeningId) }))
  const notes = [...building.report.notes]
  if (p.outdoor.kind === 'forest') {
    const parameters = cloneJson(p.outdoor.parameters)
    parameters.ground = { kind: 'existing' }
    for (const row of [...parameters.zones, ...parameters.clearings, ...parameters.entrances]) row.supportRef = { kind: 'terrainArea', id: supportAreaId }
    const forestInput: ForestGenerationInput = { version: 1, algorithmVersion: input.algorithmVersion >= 4 ? 2 : 1, seed: outdoorSeed, parameters }
    const forest = execution.run('outdoor', (current, opts) => runForestGeneration(current, forestInput, opts))
    notes.push(...forest.report.notes)
    outdoorRecipeId = forestEntityId(source.sceneId, outdoorSeed, 'recipe')
  } else {
    checkVolcanoResult(execution.document, volcano!.input, volcano!.report); notes.push(...volcano!.report.notes)
    outdoorRecipeId = volcanoEntityId(source.sceneId, outdoorSeed, 'recipe')
  }
  const current = execution.document, finalRoute = current.paths[mixedEntityId(source.sceneId, input.seed, 'approach')]
  const port = resolveBuildingEntrancePort(current, entranceOpeningId, p.approach.widthMm)
  for (const pointsMm of [finalRoute.centerlineMm, [...finalRoute.centerlineMm, port.insideMm]]) {
    const checked = checkTerrainRoute(current, { floorId: port.floorId, pointsMm, widthMm: p.approach.widthMm })
    if (!checked.ok) throw new GenerationError('candidate-invalid', `后续内容破坏建筑接入净空：${checked.issues.map(row => row.message).join('；')}`)
  }
  const buildingRecipe = Object.values(getLegacyGeneration(current)!.recipes).find(row => 'domain' in row && row.domain === 'interior' && row.algorithmId === 'supported-interior')!
  const report: MixedReport = { environment: p.outdoor.kind, supportAreaId, buildingRecipeId: buildingRecipe.id, outdoorRecipeId,
    roomIds: Object.keys(current.rooms).sort(), openingIds: Object.keys(current.openings).sort(), propIds: Object.keys(current.props).sort(), entranceOpeningId, approachPathId: finalRoute.id, notes }
  const candidate = execution.publish(hashGenerationValue({ algorithm: 'mixed-layout', version: input.algorithmVersion, input, profile }))
  const resultHash = hashGenerationValue({ input, report, documentHash: candidate.documentHash, outputHash: candidate.outputHash, stages: candidate.stages })
  return freezeJson({ input, candidate, report, resultHash })
}
