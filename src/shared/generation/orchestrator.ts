import { z } from 'zod'
import type { SceneDocument, PointMm } from '../model/scene.js'
import { propFootprint, polygonDistance, polygonsOverlap, connectionBand } from '../geometry/geometry.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { assertTaskBudget, emptyBudgetUsage, measureTaskBudget, withExecutionWorkObserver, type BudgetUsage } from '../budget/task-budget.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { createSpaceContext } from './space.js'
import { declaredMaterializationViolation, materializationViolation } from './materialization.js'
import { isNaturalReplayBridgeIdentity } from './natural-replay-contract.js'
import { generationArtifactSchema, generationDiagnosticSchema, generationRecipeSchema, generationRequestSchema, generationWriteGrantSchema, hashGenerationValue, freezeArtifact, type ArtifactKind, type ArtifactReader, type GenerationArtifact, type GenerationCandidate, type GenerationConstraint, type GenerationDiagnostic, type GenerationFailureCode, type GenerationOperatorDescriptor, type GenerationRecipe, type GenerationRequest, type GenerationWriteGrant, type OperatorRef, type RecipeStep, type SpaceQueries, type OperatorContext, type GenerationStageReceipt } from './contracts.js'

export class GenerationError extends Error {
  constructor(readonly code: GenerationFailureCode, message: string) { super(message); this.name = 'GenerationError' }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const identity = (ref: OperatorRef) => `${ref.id}@${ref.version}`
const phases = ['structure', 'connectivity', 'content', 'presentation'] as const
const allowedKinds = {
  structure: ['plan-region', 'support-surface', 'wall', 'reserved-zone', 'diagnostic'],
  connectivity: ['opening', 'port', 'connection', 'access-zone', 'diagnostic'],
  content: ['footprint', 'clearance-volume', 'prop-placement', 'diagnostic'],
  presentation: ['material-binding', 'diagnostic'],
} as const
const metadataSchema = z.object({ id: z.string().min(1).max(256), version: z.number().int().positive().safe(), phase: z.enum(phases), owner: z.enum(phases),
  consumes: z.array(z.string()).max(32), produces: z.array(z.string()).max(32), requires: z.array(z.object({ id: z.string().min(1).max(256), version: z.number().int().positive().safe() }).strict()).max(64),
  publishFacts: z.array(z.string()).max(32).default([]),
  determinism: z.object({ replayVersion: z.number().int().positive().safe(), seedDerivation: z.literal('request/recipe/step/operator/key') }).strict() }).strict()
const kinds = new Set(generationArtifactSchema.options.map(option => option.shape.kind.value))
const outputSchema = z.object({ outputs: z.array(generationArtifactSchema).max(8192), diagnostics: z.array(generationDiagnosticSchema).max(1024).optional() }).strict()

/** Static trusted registration. Exact versions coexist; registered metadata and
 * recipes are independently captured and cannot be modified by their owners. */
export class GenerationRegistry {
  #operators = new Map<string, GenerationOperatorDescriptor>()
  #recipes = new Map<string, GenerationRecipe>()
  #naturalReplayBridges = new Set<string>()
  register(input: GenerationOperatorDescriptor): void {
    this.#register(input, false)
  }
  #register(input: Omit<GenerationOperatorDescriptor, 'writes'> & { readonly writes?: GenerationOperatorDescriptor['writes'] }, naturalReplay: boolean): void {
    for (const key of Reflect.ownKeys(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (typeof key !== 'string' || !descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new GenerationError('invalid-request', '算子注册不接受访问器、隐藏或symbol字段。')
    }
    const { run, parseParameters, materialize, writes: declaration, ...raw } = input
    if (typeof run !== 'function' || typeof parseParameters !== 'function' || materialize !== undefined && typeof materialize !== 'function') throw new GenerationError('invalid-request', '算子必须提供同步执行和参数校验。')
    if (naturalReplay && (input.phase !== 'structure' || !materialize)) throw new GenerationError('ownership-conflict', '自然重放桥只允许结构阶段完整物化。')
    if (!naturalReplay && (!Object.hasOwn(input, 'writes') || declaration === undefined)) throw new GenerationError('ownership-conflict', '普通算子必须显式声明物化目标/字段写域；纯事实算子使用空声明。')
    const writes = typeof declaration === 'function' ? declaration : freezeJson(z.array(generationWriteGrantSchema).max(256).parse(captureJson(declaration ?? [])))
    const metadata = metadataSchema.parse(captureJson(raw)), key = identity(metadata)
    if (naturalReplay && !isNaturalReplayBridgeIdentity(metadata)) throw new GenerationError('ownership-conflict', '完整自然重放桥须使用现有base-map3合同的精确算法身份和重放版本。')
    if (this.#operators.has(key) || metadata.owner !== metadata.phase || metadata.requires.some(ref => identity(ref) === key)
      || new Set(metadata.requires.map(identity)).size !== metadata.requires.length
      || new Set(metadata.consumes).size !== metadata.consumes.length || new Set(metadata.produces).size !== metadata.produces.length
      || new Set(metadata.publishFacts).size !== metadata.publishFacts.length || metadata.publishFacts.some(kind => !metadata.produces.includes(kind) || !materialize)
      || [...metadata.consumes, ...metadata.produces].some(kind => !kinds.has(kind as ArtifactKind))
      || metadata.produces.some(kind => !(allowedKinds[metadata.phase] as readonly string[]).includes(kind))) throw new GenerationError('ownership-conflict', `算子身份、依赖或阶段所有权无效：${key}`)
    this.#operators.set(key, Object.freeze({ ...freezeJson(metadata), writes, run, parseParameters, ...(materialize ? { materialize } : {}) }) as GenerationOperatorDescriptor)
    if (naturalReplay) this.#naturalReplayBridges.add(key)
  }
  /** Internal compatibility bridge only: the old natural protocol materializes
   * all domains atomically. Ordinary registration always retains phase scopes. */
  registerNaturalReplayBridge(input: Omit<GenerationOperatorDescriptor, 'writes'> & { readonly writes?: GenerationOperatorDescriptor['writes'] }): void {
    this.#register(input, true)
  }
  assertMaterialization(operator: GenerationOperatorDescriptor, before: Parameters<typeof materializationViolation>[0], after: SceneDocument, writes: readonly GenerationWriteGrant[]): void {
    if (this.#naturalReplayBridges.has(identity(operator))) return
    const field = materializationViolation(before, after, operator.phase)
    if (field) throw new GenerationError('ownership-conflict', `算子 ${identity(operator)} 超出阶段物化写入范围：${field}`)
    const target = declaredMaterializationViolation(before, after, writes)
    if (target) throw new GenerationError('ownership-conflict', `算子 ${identity(operator)} 超出声明的目标/字段写域：${target}`)
  }
  registerRecipe(input: Omit<GenerationRecipe, 'recipeHash'>): GenerationRecipe {
    const body = generationRecipeSchema.omit({ recipeHash: true }).parse(captureJson(input)), key = identity(body)
    if (this.#recipes.has(key) || new Set(body.steps.map(step => step.id)).size !== body.steps.length) throw new GenerationError('invalid-request', `配方身份或步骤重复：${key}`)
    const recipe = freezeJson({ ...body, recipeHash: hashGenerationValue(body) })
    this.#recipes.set(key, recipe); return recipe
  }
  get(ref: OperatorRef): GenerationOperatorDescriptor {
    const operator = this.#operators.get(identity(ref))
    if (!operator) throw new GenerationError('unknown-operator', `未注册精确算子版本：${identity(ref)}`)
    return operator
  }
  resolve(recipe: GenerationRecipe): { step: RecipeStep; operator: GenerationOperatorDescriptor }[] {
    if (canonicalJson(this.#recipes.get(identity(recipe)) ?? null) !== canonicalJson(recipe)) throw new GenerationError('invalid-request', '配方必须与精确注册版本及摘要一致。')
    const rows = recipe.steps.map(step => ({ step, operator: this.get(step.operator) }))
    const order: typeof rows = [], visiting = new Set<string>(), visited = new Set<string>()
    const sort = (a: typeof rows[number], b: typeof rows[number]) => phases.indexOf(a.operator.phase) - phases.indexOf(b.operator.phase) || compare(a.step.id, b.step.id) || compare(identity(a.operator), identity(b.operator))
    const visit = (row: typeof rows[number]): void => {
      if (visiting.has(row.step.id)) throw new GenerationError('dependency-cycle', `算子依赖形成循环：${row.step.id}`)
      if (visited.has(row.step.id)) return
      visiting.add(row.step.id)
      if (new Set(row.step.inputs.map(input => input.id)).size !== row.step.inputs.length) throw new GenerationError('invalid-request', '步骤输入绑定ID不能重复。')
      const dependencies = row.step.dependsOn.map(stepId => {
        const dependency = rows.find(item => item.step.id === stepId)
        if (!dependency) throw new GenerationError('missing-input', `缺少步骤实例：${stepId}`)
        if (phases.indexOf(dependency.operator.phase) > phases.indexOf(row.operator.phase)) throw new GenerationError('ownership-conflict', '算子不能反向依赖后续阶段。')
        return dependency
      })
      for (const ref of row.operator.requires) if (dependencies.filter(item => identity(item.operator) === identity(ref)).length !== 1) throw new GenerationError('missing-input', `配方须绑定唯一精确依赖步骤：${identity(ref)}`)
      for (const input of row.step.inputs) {
        if (!row.operator.consumes.includes(input.kind)) throw new GenerationError('ownership-conflict', `步骤读取未声明输入：${input.id}`)
        if (input.from.kind === 'step') {
          const from = input.from, dependency = dependencies.find(item => item.step.id === from.stepId)
          if (!dependency || identity(dependency.operator) !== identity(from.operator) || !dependency.operator.produces.includes(input.kind)) throw new GenerationError('missing-input', `输入缺少精确前序步骤/产物：${input.id}`)
        }
      }
      for (const kind of row.operator.consumes) if (!row.step.inputs.some(input => input.kind === kind)) throw new GenerationError('missing-input', `${row.step.id} 缺少强类型输入绑定：${kind}`)
      for (const dependency of dependencies.sort(sort)) visit(dependency)
      visiting.delete(row.step.id); visited.add(row.step.id); order.push(row)
    }
    for (const row of [...rows].sort(sort)) visit(row)
    return order
  }
}
function reader(values: readonly GenerationArtifact[]): ArtifactReader {
  const snapshot = Object.freeze([...values]), byId = new Map(snapshot.map(item => [item.id, item]))
  return Object.freeze({ get: (id: string) => byId.get(id), values: () => snapshot, ofKind: (kind: ArtifactKind) => Object.freeze(snapshot.filter(item => item.kind === kind)) })
}
function boundary(artifact: GenerationArtifact): readonly PointMm[] | undefined {
  if ('boundaryMm' in artifact.payload) return artifact.payload.boundaryMm
  if (artifact.kind === 'prop-placement') return propFootprint(artifact.payload as unknown as Parameters<typeof propFootprint>[0])
  if (artifact.kind === 'connection') return connectionBand([...artifact.payload.pathMm], artifact.payload.widthMm)
  if (artifact.kind === 'port') {
    const angle = artifact.payload.directionDeg * Math.PI / 180, half = artifact.payload.widthMm / 2
    const nx = -Math.sin(angle) * half, ny = Math.cos(angle) * half, p = artifact.payload.positionMm
    return [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }]
  }
  return undefined
}
function entityIds(artifact: GenerationArtifact): string[] {
  const payload = artifact.payload
  return 'entityId' in payload ? [payload.entityId] : 'targetId' in payload ? [payload.targetId] : 'sourceId' in payload ? [payload.sourceId] : 'sourceRef' in payload ? [payload.sourceRef.id] : []
}
/** IDs belong to the proposal; factual payloads must match the independently
 * captured current scene. A prior stage is rejected when its facts go stale. */
function assertFactCurrent(artifact: GenerationArtifact, space: SpaceQueries): void {
  const factual = ['support-surface', 'wall', 'opening', 'footprint', 'port', 'connection', 'prop-placement', 'material-binding']
  if (!factual.includes(artifact.kind)) return
  const value = (item: GenerationArtifact) => {
    if (item.kind !== 'connection') return item.payload
    const { fromPortId: _from, toPortId: _to, ...payload } = item.payload
    return payload
  }
  if (!space.artifacts.some(fact => fact.kind === artifact.kind && canonicalJson(value(fact)) === canonicalJson(value(artifact)))) throw new GenerationError('candidate-invalid', `产物缺少当前完整候选事实或已失效：${artifact.id}`)
}
function entityRecords(document: SceneDocument, id: string): unknown[] {
  const result: unknown[] = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (!Array.isArray(value) && 'id' in value && value.id === id) result.push(value)
    for (const child of Object.values(value)) visit(child)
  }
  visit(document); return result
}
/** Independent finite hard/soft checks, using a fully validated complete scene.
 * Full resource, authority, persistence and adoption validation remain mandatory. */
export function checkGenerationConstraints(constraints: readonly GenerationConstraint[], outputs: readonly GenerationArtifact[], space: SpaceQueries): GenerationDiagnostic[] {
  const diagnostics: GenerationDiagnostic[] = []
  for (const constraint of constraints) {
    let valid = false
    if (constraint.kind === 'bounds') {
      const b = constraint.boundsMm
      valid = outputs.every(artifact => {
        const points = artifact.kind === 'wall' || artifact.kind === 'opening' ? space.entityGeometryPoints(artifact.payload.entityId) : boundary(artifact) ?? []
        return points.every(p => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height)
      })
    } else if (constraint.kind === 'preserve') valid = outputs.every(artifact => entityIds(artifact).every(id => !constraint.entityIds.includes(id)))
    else if (constraint.kind === 'connection') valid = space.connectionUsable(constraint.connectionId, constraint.minimumWidthMm)
    else {
      const artifact = outputs.find(item => item.id === constraint.artifactId), points = artifact && boundary(artifact)
      if (points && artifact && 'floorId' in artifact.payload && artifact.payload.floorId === constraint.floorId) {
        if (constraint.kind === 'support') valid = space.supportsPolygon(points, constraint.supportRef, constraint.floorId)
        else {
          const ownIds = artifact ? entityIds(artifact) : []
          const candidateConflict = outputs.some(other => {
            if (other.id === artifact?.id || entityIds(other).some(id => ownIds.includes(id) || constraint.ignoreEntityIds.includes(id))) return false
            const physical = other.kind === 'footprint' || other.kind === 'prop-placement' ? other.payload.blocksMovement : other.kind === 'reserved-zone'
            const otherBoundary = physical && 'floorId' in other.payload && other.payload.floorId === constraint.floorId ? boundary(other) : undefined
            return !!otherBoundary && (polygonsOverlap([...points], [...otherBoundary]) || polygonDistance([...points], [...otherBoundary]) < constraint.minimumMm)
          })
          valid = !candidateConflict && !space.conflicts(points, constraint.floorId, constraint.minimumMm, [...constraint.ignoreEntityIds, ...ownIds]).length
        }
      }
    }
    if (!valid) diagnostics.push({ code: `constraint-${constraint.kind}`, message: `生成候选不满足约束：${constraint.id}`, artifactIds: 'artifactId' in constraint ? [constraint.artifactId] : [], hard: true })
  }
  return diagnostics
}
export interface GenerationExecutionOptions {
  readonly source: SceneDocument
  readonly signal?: { readonly aborted: boolean }
  /** Injected monotonic runtime clock; shared code has no platform clock. */
  readonly nowMilliseconds: () => number

}
export function runGeneration(raw: GenerationRequest, registry: GenerationRegistry, options: GenerationExecutionOptions): GenerationCandidate {
  const checkCancelled = () => { if (options.signal?.aborted) throw new GenerationError('cancelled', '生成已取消，未发布部分候选。') }
  checkCancelled()
  let request: GenerationRequest
  try { request = freezeJson(generationRequestSchema.parse(captureJson(raw))) } catch (error) { throw new GenerationError('invalid-request', error instanceof Error ? error.message : String(error)) }
  const rows = registry.resolve(request.recipe)
  let document = freezeJson(captureJson(options.source)), space = createSpaceContext(document, 'source')
  const source = space, sourceDocument = document
  if (request.coordinateFrame !== source.coordinateFrame) throw new GenerationError('invalid-request', '请求与真实工程坐标框架不同。')
  const usage = emptyBudgetUsage(), outputs: GenerationArtifact[] = [], diagnostics: GenerationDiagnostic[] = [], stages: GenerationStageReceipt[] = []
  const completed = new Map<string, readonly GenerationArtifact[]>()
  const start = options.nowMilliseconds()
  if (!Number.isSafeInteger(start) || start < 0) throw new GenerationError('invalid-request', '执行时钟必须返回非负单调整数毫秒。')
  let lastTime = start, observedAttempts = 0
  const charge = (delta: Partial<BudgetUsage>) => {
    for (const [key, amount] of Object.entries(delta) as [keyof BudgetUsage, number][]) {
      if (!(key in usage) || !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(usage[key] + amount)) throw new GenerationError('budget-exceeded', '实际工作计量无效。')
      usage[key] += amount
    }
    try { assertTaskBudget(request.budgetProfile, usage) } catch (error) { throw new GenerationError('budget-exceeded', String(error)) }
  }
  const tick = () => { const now = options.nowMilliseconds(); if (!Number.isSafeInteger(now) || now < lastTime) throw new GenerationError('invalid-request', '执行时钟必须单调。'); charge({ activeExecutionMs: now - lastTime }); lastTime = now }
  // One published candidate, plus any actual alternatives metered by a domain.
  charge({ candidateAttempts: 1, metadataBytes: encodeUtf8(canonicalJson(request)).length, metadataRecords: request.recipe.steps.length + request.hardConstraints.length + request.softGoals.length,
    dependencyRefs: request.recipe.steps.reduce((count, step) => count + step.dependsOn.length + step.inputs.length + step.inputs.reduce((n, input) => n + (input.artifactIds?.length ?? 0), 0), 0) })
  for (const { step, operator } of rows) {
    checkCancelled(); tick()
    const selected = new Map<string, readonly GenerationArtifact[]>()
    for (const binding of step.inputs) {
      const candidates = binding.from.kind === 'source' ? source.artifacts : completed.get(binding.from.stepId)
      if (!candidates) throw new GenerationError('missing-input', `前序步骤没有可用产物：${binding.id}`)
      const values = candidates.filter(item => item.kind === binding.kind && (!binding.artifactIds || binding.artifactIds.includes(item.id)))
      if (binding.artifactIds && values.length !== binding.artifactIds.length || values.length < binding.cardinality.min || values.length > binding.cardinality.max) throw new GenerationError('missing-input', `输入产物基数不符：${binding.id}`)
      for (const artifact of values) {
        if (binding.floorId && (!('floorId' in artifact.payload) || artifact.payload.floorId !== binding.floorId)
          || binding.coordinateFrame && (!('coordinateFrame' in artifact.payload) || artifact.payload.coordinateFrame !== binding.coordinateFrame)) throw new GenerationError('candidate-invalid', `输入Floor或坐标框架不符：${binding.id}`)
        assertFactCurrent(artifact, space)
      }
      selected.set(binding.id, Object.freeze([...values].sort((a, b) => compare(a.id, b.id))))
    }
    const available = [...new Map([...selected.values()].flat().map(item => [item.id, item])).values()]
    const parameters = captureJson(operator.parseParameters(step.parameters))
    checkCancelled()
    if (canonicalJson(parameters) !== canonicalJson(step.parameters)) throw new GenerationError('invalid-request', `步骤参数未规范化：${step.id}`)
    const context: OperatorContext = Object.freeze({ request, step, artifacts: reader(available), space,
      inputs: Object.freeze({ get: (id: string) => { const values = selected.get(id); if (!values) throw new GenerationError('missing-input', `未绑定的输入：${id}`); return values } }), checkCancelled,
      deriveSeed: (stableKey: string) => { if (!stableKey || stableKey.length > 512) throw new GenerationError('invalid-request', '种子派生需要稳定空间键。'); return hashGenerationValue([request.seed, request.recipe.id, request.recipe.version, step.id, operator.id, operator.version, operator.determinism.replayVersion, stableKey]) } })
    let writes: readonly GenerationWriteGrant[]
    try {
      writes = freezeJson(z.array(generationWriteGrantSchema).max(256).parse(captureJson(typeof operator.writes === 'function' ? operator.writes({ document, context }) : operator.writes)))
    } catch (error) {
      if (error instanceof GenerationError) throw error
      checkCancelled()
      throw new GenerationError('ownership-conflict', `算子 ${identity(operator)} 写域声明无效：${String(error)}`)
    }
    checkCancelled()
    const beforeHash = space.contentHash
    let materializedUsage = emptyBudgetUsage()
    let result: z.infer<typeof outputSchema>
    try {
      result = withExecutionWorkObserver(delta => {
        const own = { ...delta }
        if (own.candidateAttempts) { const previous = observedAttempts; observedAttempts += own.candidateAttempts; own.candidateAttempts = Math.max(1, observedAttempts) - Math.max(1, previous) }
        charge(own); checkCancelled(); tick()
      }, () => outputSchema.parse(captureJson(operator.run(context))))
    } catch (error) {
      if (error instanceof GenerationError) throw error
      if (String(error).includes('任务预算超限')) throw new GenerationError('budget-exceeded', String(error))
      // Optional means an explicitly registered soft step. Contract failures,
      // cancellation and budget errors are never treated as graceful decline.
      if (!step.required && error instanceof OptionalGenerationDeclined) {
        const diagnostic = { code: 'optional-declined', message: `${step.id}：${error.message}`.slice(0, 2000), artifactIds: [], hard: false }
        charge({ metadataRecords: 1, metadataBytes: encodeUtf8(canonicalJson(diagnostic)).length }); diagnostics.push(diagnostic); continue
      }
      throw new GenerationError('operator-failed', `${step.id}：${error instanceof Error ? error.message : String(error)}`)
    }
    checkCancelled(); tick()
    let batch = result.outputs.map(freezeArtifact)
    const existing = new Set([...source.artifacts, ...outputs].map(item => item.id))
    for (const artifact of batch) {
      if (artifact.owner !== operator.owner || !operator.produces.includes(artifact.kind) || existing.has(artifact.id)) throw new GenerationError('ownership-conflict', `算子 ${identity(operator)} 产出越权或重复身份：${artifact.id}`)
      existing.add(artifact.id)
      if ('coordinateFrame' in artifact.payload && artifact.payload.coordinateFrame !== request.coordinateFrame) throw new GenerationError('candidate-invalid', '算子产物坐标框架不同。')
    }
    if (operator.materialize) {
      try {
        const next = withExecutionWorkObserver(delta => { charge(delta); checkCancelled(); tick() }, () => captureJson(operator.materialize!({ document, context, outputs: Object.freeze(batch) })))
        checkCancelled(); tick()
        if (next.sceneId !== source.sceneId || next.revision !== source.revision || next.mapMode !== sourceDocument.mapMode || canonicalJson(next.floors) !== canonicalJson(sourceDocument.floors)) throw new GenerationError('candidate-invalid', '阶段候选不能改变基线身份、revision、Floor或坐标框架。')
        registry.assertMaterialization(operator, document, next, writes)
        const nextSpace = createSpaceContext(next, 'candidate')
        // The full scene's independent complexity is checked as well as the
        // cumulative actual operator work; hidden entities cannot evade budgets.
        assertTaskBudget(request.budgetProfile, measureTaskBudget(sourceDocument, next))
        materializedUsage = measureTaskBudget(document, next)
        charge({ metadataBytes: encodeUtf8(canonicalJson(next)).length, metadataRecords: 1 })
        const extracted = nextSpace.artifacts.filter(fact => operator.publishFacts?.includes(fact.kind)
          && !space.artifacts.some(previous => previous.kind === fact.kind && canonicalJson(previous.payload) === canonicalJson(fact.payload)))
        for (const fact of extracted) {
          if (fact.owner !== operator.owner || existing.has(fact.id)) throw new GenerationError('ownership-conflict', `阶段事实重复或越权：${fact.id}`)
          existing.add(fact.id)
        }
        batch = [...batch, ...extracted]
        document = freezeJson(next); space = nextSpace
      } catch (error) {
        if (error instanceof GenerationError) throw error
        if (String(error).includes('任务预算超限')) throw new GenerationError('budget-exceeded', String(error))
        throw new GenerationError('candidate-invalid', `阶段物化无效：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const artifact of [...outputs, ...batch]) {
      if ('floorId' in artifact.payload && !document.floors[artifact.payload.floorId]) throw new GenerationError('candidate-invalid', `产物Floor不存在：${artifact.id}`)
      assertFactCurrent(artifact, space)
    }
    // Count actual strict products and bytes, never a claimed operator estimate.
    const actual = emptyBudgetUsage(); actual.semanticTargets = batch.length; actual.metadataRecords = batch.length + (result.diagnostics?.length ?? 0); actual.metadataBytes = encodeUtf8(canonicalJson(result)).length
    for (const artifact of batch) {
      const points = boundary(artifact)
      if (points) { actual.geometryPoints += points.length; actual.geometrySegments += points.length }
      if (artifact.kind === 'connection') { actual.geometryPoints += artifact.payload.pathMm.length; actual.geometrySegments += artifact.payload.pathMm.length - 1; actual.dependencyRefs += 2 }
      else if (artifact.kind === 'port' || artifact.kind === 'prop-placement') { actual.geometryPoints++; actual.dependencyRefs++ }
      else if (artifact.kind === 'support-surface' || artifact.kind === 'material-binding') actual.dependencyRefs++
      else if (artifact.kind === 'wall' || artifact.kind === 'opening') { actual.geometryPoints += 2; actual.geometrySegments++; actual.dependencyRefs += artifact.kind === 'opening' ? 1 : 0 }
    }
    // Changes not represented by a published fact still consume the stage's
    // real cumulative budget. A later reversal never refunds earlier work.
    for (const key of ['semanticTargets', 'geometryPoints', 'geometrySegments', 'curveSegments', 'dependencyRefs', 'metadataRecords', 'metadataBytes'] as const) actual[key] = Math.max(actual[key], materializedUsage[key])
    charge(actual)
    // Reuse the existing exact ring validator. Rotated derived geometry must
    // match a real placement or an independently checked complete domain scene.
    const all = [...source.artifacts, ...outputs, ...batch]
    for (const artifact of batch) {
      const points = boundary(artifact)
      if (artifact.kind === 'footprint') {
        const placement = all.find(item => item.kind === 'prop-placement' && item.payload.entityId === artifact.payload.entityId)
        if (!placement || canonicalJson(boundary(placement)) !== canonicalJson(points)) throw new GenerationError('candidate-invalid', `占地缺少真实物件或几何不一致：${artifact.id}`)
      } else if (points && artifact.kind !== 'port') {
        if (points.every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))) {
          try { polygonBoolean({ operation: 'union', subject: [points], clip: [] }, { charge, snapshot: () => freezeJson({ ...usage }) }) }
          catch (error) { if (error instanceof GenerationError) throw error; throw new GenerationError('candidate-invalid', `${artifact.id}：${String(error)}`) }
        } else if (!space.artifacts.some(fact => fact.kind === artifact.kind && canonicalJson(entityIds(fact)) === canonicalJson(entityIds(artifact)) && canonicalJson(boundary(fact)) === canonicalJson(points))) throw new GenerationError('candidate-invalid', `派生几何没有完整领域证明：${artifact.id}`)
      }
      if (artifact.kind === 'prop-placement' && !space.supportsPolygon(boundary(artifact)!, artifact.payload.supportRef, artifact.payload.floorId)) throw new GenerationError('candidate-invalid', `物件缺少真实完整支撑：${artifact.id}`)
      if (artifact.kind === 'connection') for (const portId of [artifact.payload.fromPortId, artifact.payload.toPortId]) {
        const port = all.find(item => item.id === portId)
        const endpoint = portId === artifact.payload.fromPortId ? artifact.payload.pathMm[0] : artifact.payload.pathMm.at(-1)!
        if (!port || port.kind !== 'port' || port.payload.floorId !== artifact.payload.floorId || port.payload.widthMm < artifact.payload.widthMm || canonicalJson(port.payload.positionMm) !== canonicalJson(endpoint)) throw new GenerationError('candidate-invalid', `连接缺少同Floor、同端点或足够净宽的端口：${artifact.id}`)
      }
    }
    completed.set(step.id, Object.freeze(batch))
    const receipt = freezeJson({ stepId: step.id, operator: step.operator, beforeHash, afterHash: space.contentHash,
      inputHash: hashGenerationValue([...selected].map(([id, values]) => [id, values.map(value => [value.id, value.contentHash])])), outputHash: hashGenerationValue(batch.map(value => [value.id, value.contentHash])) })
    charge({ metadataRecords: 1, metadataBytes: encodeUtf8(canonicalJson(receipt)).length })
    stages.push(receipt)
    outputs.push(...batch); diagnostics.push(...batch.filter(artifact => artifact.kind === 'diagnostic').map(artifact => ({ ...artifact.payload, artifactIds: [...artifact.payload.artifactIds] })), ...(result.diagnostics ?? []))
  }
  const candidateSpace = space
  const changedFacts = candidateSpace.artifacts.filter(fact => !source.artifacts.some(previous => previous.kind === fact.kind && canonicalJson(previous.payload) === canonicalJson(fact.payload)))
  for (const constraint of request.hardConstraints) if (constraint.kind === 'preserve' && constraint.entityIds.some(id => canonicalJson(entityRecords(sourceDocument, id)) !== canonicalJson(entityRecords(document, id)))) throw new GenerationError('candidate-invalid', `完整候选改变受保护实体：${constraint.id}`)
  const check = (constraint: GenerationConstraint) => checkGenerationConstraints([constraint], constraint.kind === 'bounds' ? [...outputs, ...changedFacts] : outputs, candidateSpace)
  diagnostics.push(...request.hardConstraints.flatMap(check), ...request.softGoals.flatMap(check).map(row => ({ ...row, hard: false })))
  const hard = diagnostics.find(row => row.hard)
  if (hard) throw new GenerationError('candidate-invalid', hard.message)
  checkCancelled(); tick()
  const sorted = outputs.sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id))
  return freezeJson({ status: 'prepared', materializationRequired: true, requestHash: hashGenerationValue(request), sourceHash: source.contentHash, outputHash: hashGenerationValue(sorted.map(item => [item.kind, item.id, item.contentHash])), outputs: sorted, diagnostics, usage, document, documentHash: space.contentHash, stages })
}
/** Only a recipe-marked optional step may intentionally decline a soft goal. */
export class OptionalGenerationDeclined extends Error {}
