import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { captureExecutionBudget, taskBudgetProfile } from '../budget/task-budget.js'
import { createSpaceContext } from './space.js'
import { cloneJson } from '../validation/json.js'
import { GenerationError, GenerationRegistry, OptionalGenerationDeclined, runGeneration, checkGenerationConstraints } from './orchestrator.js'
import { hashGenerationValue, freezeArtifact, type ArtifactInput, type GenerationOperatorDescriptor, type GenerationRequest, type RecipeStep } from './contracts.js'
const source = () => createShoreBlankDocument('island', { sceneId: 'orchestration', title: '通用编排', now: '2026-11-04T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
const region = (id = 'plan'): ArtifactInput => ({ id, kind: 'plan-region', owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId: 'visual-floor', visibility: 'public', domain: 'mixed', purpose: '', boundaryMm: [{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3000, y: 3000 }, { x: 1000, y: 3000 }] } })
const descriptor = (id: string, overrides: Partial<GenerationOperatorDescriptor> = {}): GenerationOperatorDescriptor => ({ id, version: 1, phase: 'structure', owner: 'structure', consumes: [], produces: ['plan-region'], requires: [], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' }, parseParameters: input => cloneJson(input), run: () => ({ outputs: [region(id)] }), ...overrides })
const step = (id: string, version = 1): RecipeStep => ({ id: `step-${id}`, operator: { id, version }, required: true, parameters: {}, dependsOn: [], inputs: [] })
function request(registry: GenerationRegistry, steps: RecipeStep[]): GenerationRequest {
  steps = steps.map(step => { const operator = registry.get(step.operator); return { ...step,
    dependsOn: operator.requires.map(ref => steps.find(item => item.operator.id === ref.id && item.operator.version === ref.version)?.id ?? `missing-${ref.id}`),
    inputs: operator.consumes.map(kind => ({ id: kind, kind, from: operator.requires.length ? { kind: 'step' as const, stepId: steps.find(item => item.operator.id === operator.requires[0].id)?.id ?? 'missing', operator: operator.requires[0] } : { kind: 'source' as const }, cardinality: { min: 1, max: 8192 } })),
  } })
  return { requestVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { structures: [], purposes: [], tags: [] }, intentSource: { kind: 'manual', contentHash: 'a'.repeat(64) }, normalizationVersion: 1, hardConstraints: [], softGoals: [], seed: 'fixed', budgetProfile: taskBudgetProfile('small'), recipe: registry.registerRecipe({ id: 'recipe', version: 1, steps }) } }
const options = () => ({ source: source(), nowMilliseconds: () => 0 })
function one(operator = descriptor('a')) { const registry = new GenerationRegistry(); registry.register(operator); return { registry, input: request(registry, [step(operator.id, operator.version)]) } }
describe('typed exact generation orchestration', () => {
  it('resolves exact versions and stable dependencies with independent seed streams', () => {
    const registry = new GenerationRegistry(), seen: string[] = [], seeds: string[] = []
    registry.register(descriptor('a', { version: 2, run: () => { throw new Error('wrong exact version') } }))
    registry.register(descriptor('b', { requires: [{ id: 'a', version: 1 }], consumes: ['plan-region'], run: context => { seen.push('b'); seeds.push(context.deriveSeed('north')); return { outputs: [region('b')] } } }))
    registry.register(descriptor('a', { run: () => { seen.push('a'); return { outputs: [region('a')] } } }))
    const input = request(registry, [step('b'), step('a')]), result = runGeneration(input, registry, options())
    expect(seen).toEqual(['a', 'b'])
    expect(seeds).toEqual([hashGenerationValue(['fixed', 'recipe', 1, 'step-b', 'b', 1, 1, 'north'])])
    expect(result.status).toBe('prepared'); expect(result.materializationRequired).toBe(true)
    expect(result.usage.geometryPoints).toBe(8); expect(result.usage.semanticTargets).toBe(2)
    expect(Object.isFrozen(result.outputs[0].payload)).toBe(true)
    const reordered = cloneJson(input); reordered.recipe.steps.reverse()
    expect(() => runGeneration(reordered, registry, options())).toThrow(/配方/)
  })
  it('rejects unknown exact versions before running an implementation', () => { const { registry, input } = one(); const unknown = { ...step('a', 2), id: 'different' }; const second = registry.registerRecipe({ id: 'unknown', version: 1, steps: [unknown] }); expect(() => runGeneration({ ...input, recipe: second }, registry, options())).toThrow(/精确算子版本/) })
  it('captures registered arrays and recipes independently from later mutation', () => {
    const operator = descriptor('a'), registry = new GenerationRegistry(); registry.register(operator)
    ;(operator.produces as string[]).length = 0
    const steps = [step('a')], input = request(registry, steps); steps[0].operator.version = 9
    expect(runGeneration(input, registry, options()).outputs).toHaveLength(1)
  })
  it('rejects unregistered profiles, even if an attacker recomputes its hash', () => { const { registry, input } = one(), edited = cloneJson(input); edited.budgetProfile.limits.geometryPoints++; const { profileHash: _hash, ...body } = edited.budgetProfile; edited.budgetProfile.profileHash = hashGenerationValue(body); expect(() => runGeneration(edited, registry, options())).toThrow(/注册档位/) })
  it('rejects cyclic and missing exact dependencies before execution', () => {
    const registry = new GenerationRegistry(); registry.register(descriptor('a', { requires: [{ id: 'b', version: 1 }] })); registry.register(descriptor('b', { requires: [{ id: 'a', version: 1 }] }))
    expect(() => runGeneration(request(registry, [step('a'), step('b')]), registry, options())).toThrow(/循环/)
    const missing = new GenerationRegistry(); missing.register(descriptor('a', { requires: [{ id: 'absent', version: 2 }] })); expect(() => runGeneration(request(missing, [step('a')]), missing, options())).toThrow(/步骤实例|精确依赖/)
  })
  it('rejects absent typed inputs and presentation ownership violations', () => {
    const { registry, input } = one(descriptor('a', { consumes: ['port'] })); expect(() => runGeneration(input, registry, options())).toThrow(/强类型输入|基数/)
    expect(() => new GenerationRegistry().register(descriptor('presentation', { phase: 'presentation', owner: 'presentation' }))).toThrow(/所有权/)
  })
  it('does not expose writable request, facts, or Map mutation to operators', () => {
    const { registry, input } = one(descriptor('a', { consumes: ['support-surface'], run: context => {
      expect(() => (context.request.intent.tags as string[]).push('changed')).toThrow()
      expect(() => (context.artifacts.values()[0].payload as { elevationMm: number }).elevationMm++).toThrow()
      expect('set' in context.artifacts).toBe(false)
      return { outputs: [region()] }
    } })); expect(runGeneration(input, registry, options()).outputs).toHaveLength(1)
  })
  it('rejects unsafe request accessors without evaluating them', () => { const { registry, input } = one(); let evaluations = 0; Object.defineProperty(input, 'seed', { enumerable: true, get() { evaluations++; return 'bad' } }); expect(() => runGeneration(input, registry, options())).toThrow(/访问器/); expect(evaluations).toBe(0) })
  it('rejects unknown payload fields and claimed usage without publishing partial output', () => {
    for (const output of [{ outputs: [region()], usage: { geometryPoints: 0 } }, { outputs: [{ ...region(), payload: { ...region().payload, arbitraryPhysicalTruth: true } }] }]) {
      const { registry, input } = one(descriptor('a', { run: () => output as never })); expect(() => runGeneration(input, registry, options())).toThrow(GenerationError)
    }
  })
  it('recomputes actual output geometry and observes domain work meters', () => {
    const many = Array.from({ length: 2 }, (_, index) => ({ ...region(`large-${index}`), payload: { ...(region().payload as Extract<ArtifactInput, { kind: 'plan-region' }>['payload']), boundaryMm: Array.from({ length: 4096 }, (_, i) => ({ x: i + index * 10000, y: i * i % 4096 })) } })) as ArtifactInput[]
    const { registry, input } = one(descriptor('a', { run: () => ({ outputs: many }) })); expect(() => runGeneration(input, registry, options())).toThrow(/geometryPoints/)
    const second = one(descriptor('a', { run: () => { captureExecutionBudget(taskBudgetProfile('small')).charge({ fieldEvaluations: 50 }); return { outputs: [region()] } } }))
    expect(runGeneration(second.input, second.registry, options()).usage.fieldEvaluations).toBe(50)
  })
  it('checks cancellation before execution and after a completed synchronous step', () => {
    const signal = { aborted: true }, first = one(); expect(() => runGeneration(first.input, first.registry, { ...options(), signal })).toThrow(/取消/)
    signal.aborted = false
    const second = one(descriptor('a', { run: () => { signal.aborted = true; return { outputs: [region()] } } })); expect(() => runGeneration(second.input, second.registry, { ...options(), signal })).toThrow(/取消/)
  })
  it('only permits explicit optional soft decline; required and contract failures remain failures', () => {
    const registry = new GenerationRegistry(); registry.register(descriptor('a', { run: () => { throw new OptionalGenerationDeclined('无可用软目标') } }))
    const optional = step('a'); optional.required = false; const input = request(registry, [optional])
    expect(runGeneration(input, registry, options()).diagnostics[0].code).toBe('optional-declined')
    const required = registry.registerRecipe({ id: 'required', version: 1, steps: [step('a')] }); expect(() => runGeneration({ ...input, recipe: required }, registry, options())).toThrow(/无可用软目标/)
  })
  it('enforces hard bounds and preserve constraints while reporting soft failures', () => {
    const { registry, input } = one()
    input.softGoals = [{ id: 'outside', kind: 'bounds', boundsMm: { x: 0, y: 0, width: 100, height: 100 } }]
    expect(runGeneration(input, registry, options()).diagnostics[0].hard).toBe(false)
    input.hardConstraints = input.softGoals; expect(() => runGeneration(input, registry, options())).toThrow(/outside/)
  })
  it('checks real source support rather than a matching artifact label', () => {
    const { registry, input } = one(); input.hardConstraints = [{ id: 'ground', kind: 'support', artifactId: 'a', floorId: 'visual-floor', supportRef: { kind: 'floor', id: 'visual-floor' } }]
    expect(runGeneration(input, registry, options()).status).toBe('prepared')
    input.hardConstraints[0] = { id: 'fake-ground', kind: 'support', artifactId: 'a', floorId: 'visual-floor', supportRef: { kind: 'terrainArea', id: 'not-real' } }
    expect(() => runGeneration(input, registry, options())).toThrow(/fake-ground/)
  })
  it('rejects self-intersecting rings through the existing geometry engine', () => {
    const invalid = region('bowtie') as Extract<ArtifactInput, { kind: 'plan-region' }>
    invalid.payload.boundaryMm = [{ x: 1000, y: 1000 }, { x: 3000, y: 3000 }, { x: 1000, y: 3000 }, { x: 3000, y: 1000 }]
    const { registry, input } = one(descriptor('a', { run: () => ({ outputs: [invalid] }) }))
    expect(() => runGeneration(input, registry, options())).toThrow(/多边形|面积/)
  })
  it('checks hard clearance against actual blocking source geometry', () => {
    const sourceScene = source(); sourceScene.regions.blocker = { id: 'blocker', floorId: 'visual-floor', editLocked: false, visibility: 'public', kind: 'hazard', blocksMovement: true, movementCostMultiplier: 1, boundaryMm: [{ x: 1500, y: 1500 }, { x: 2000, y: 1500 }, { x: 2000, y: 2000 }, { x: 1500, y: 2000 }] }; sourceScene.entityLayers.blocker = 'visual-layer-ground'
    const { registry, input } = one(); input.hardConstraints = [{ id: 'clear', kind: 'clearance', artifactId: 'a', floorId: 'visual-floor', minimumMm: 100, ignoreEntityIds: [] }]
    expect(() => runGeneration(input, registry, { source: sourceScene, nowMilliseconds: () => 0 })).toThrow(/clear/)
  })

  it('checks new blocking proposals against each other before any materialization', () => {
    const reserved: ArtifactInput = { id: 'reserved', kind: 'reserved-zone', owner: 'structure', payload: { coordinateFrame: 'scene-mm', floorId: 'visual-floor', visibility: 'public', boundaryMm: (region() as Extract<ArtifactInput, { kind: 'plan-region' }>).payload.boundaryMm, sourceId: 'new-hazard', reason: 'hazard' } }
    const { registry, input } = one(descriptor('a', { produces: ['plan-region', 'reserved-zone'], run: () => ({ outputs: [region('a'), reserved] }) }))
    input.hardConstraints = [{ id: 'new-clearance', kind: 'clearance', artifactId: 'a', floorId: 'visual-floor', minimumMm: 0, ignoreEntityIds: [] }]
    expect(() => runGeneration(input, registry, options())).toThrow(/new-clearance/)
  })

  it('checks the complete connection width and port aperture against bounds', () => {
    const common = { coordinateFrame: 'scene-mm' as const, floorId: 'visual-floor', visibility: 'public' as const }
    const connection = freezeArtifact({ id: 'wide', kind: 'connection', owner: 'connectivity', payload: { ...common, entityId: 'wide', fromPortId: 'p1', toPortId: 'p2', widthMm: 400, pathMm: [{ x: 1000, y: 100 }, { x: 3000, y: 100 }], blocksMovement: false } })
    const port = freezeArtifact({ id: 'p1', kind: 'port', owner: 'connectivity', payload: { ...common, positionMm: { x: 100, y: 1000 }, directionDeg: 90, widthMm: 400, elevationMm: 0, supportRef: { kind: 'floor', id: 'visual-floor' }, role: 'entrance' } })
    const constraint = { id: 'bounds', kind: 'bounds' as const, boundsMm: { x: 0, y: 0, width: 24000, height: 18000 } }
    expect(checkGenerationConstraints([constraint], [connection], createSpaceContext(source()))).toHaveLength(1)
    expect(checkGenerationConstraints([constraint], [port], createSpaceContext(source()))).toHaveLength(1)
  })

})
