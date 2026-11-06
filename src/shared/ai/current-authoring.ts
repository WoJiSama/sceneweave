import { propAppearanceSnapshot } from '../appearance/graph.js'
import type { PropAppearanceSnapshot } from '../model/appearance.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { definitionPresentation, presentationBounds } from '../appearance/presentation.js'
import { currentPublicPaintRow } from './current-authoring-paint.js'
import { assertCurrentAuthoringResourceEvolution } from './current-authoring-resources.js'
import type { ProjectData } from '../model/project.js'
import { BUDGET_DIMENSIONS, TASK_BUDGET_PROFILES, measureTaskBudget, semanticChangedDocumentTargets, semanticTargetEntries, type BudgetUsage } from '../budget/task-budget.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { validateProjectData } from '../project/validate.js'
import type { AuthoringStart as LegacyStart, AuthoringStep as LegacyStep, AuthoringOperation as LegacyOperation } from './authoring-protocol-v1.js'
import type { AuthoringStartV3 } from './continuation-protocol-v3.js'
import { CONTINUATION_POLICY, CONTINUATION_RETAINED_DIMENSIONS, createContinuationPolicyV2, accumulateContinuationUsage } from './budget-policy.js'
import { replayBaseMapSourceV3, continuationOperationBudgetV3 } from './continuation-v3.js'
import { authoringProjectHash, validateCurrentAuthoringEngine, replayCurrentAuthoringEngine, currentAuthoringAssetPage, publicAuthoringContextForReplay } from './authoring-v1.js'
import { CURRENT_AUTHORING_CAPABILITY, assertCurrentAuthoringCapability, currentAuthoringResourceClosureHash } from './current-authoring-capability.js'
import { AuthoringStartV4Schema, AuthoringStateV4Schema, AuthoringStepV4Schema, LedgerEntryV4Schema, type LedgerEntryV4, isGeneratedAuthoringV4,
  type AuthoringStartV4, type AuthoringStateV4, type AuthoringStepV4, type AuthoringOperationV4, type CurrentAuthoringScope, type CurrentBaselineSourceV4 } from './authoring-protocol-v4.js'

export { isGeneratedAuthoringV4, currentAuthoringResourceClosureHash }
const digest = (value: unknown) => sha256Text(canonicalJson(value))
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const deny = (message: string): never => { throw new Error(`当前工程AI创作无效：${message}`) }
const retained = new Set<string>(CONTINUATION_RETAINED_DIMENSIONS)
/** New capability's ordinary mode keeps 256 actual expanded commands. It is not a registered generated-map profile. */
export function authoringOperationWorkLimits(start: AuthoringStartV4): BudgetUsage {
  return start.policy.policyVersion === 2 ? start.policy.operationLimits : { ...TASK_BUDGET_PROFILES.small.limits, semanticTargets: 256 }
}
export function authoringExecutionWorkLimits(start: AuthoringStartV4): BudgetUsage {
  if (start.policy.policyVersion === 2) return start.policy.cumulativeLimits
  const limits = authoringOperationWorkLimits(start)
  return Object.fromEntries(BUDGET_DIMENSIONS.map(key => [key,
    key === 'semanticTargets' || key === 'activeExecutionMs' || retained.has(key) ? limits[key] : limits[key] * 64])) as BudgetUsage
}
function assertUsage(limits: BudgetUsage, usage: BudgetUsage) {
  for (const key of BUDGET_DIMENSIONS) if (usage[key] > limits[key]) deny(`工作预算超限[${key}]：${usage[key]}/${limits[key]}，保留当前草稿。`)
}
export function legacyAuthoringStartV4(start: AuthoringStartV4): LegacyStart {
  const { policy: _policy, source: _source, capability: _capability, ...value } = start
  // Parsed by the separate capability parser in the internal engine, never the legacy public entrance.
  return { ...value, schemaVersion: 1 } as LegacyStart
}
function checkedStart(input: AuthoringStartV4) {
  const owned = captureJson(input)
  if (encodeUtf8(canonicalJson(owned)).length > 48 * 1024 * 1024) deny('完整输入超过48MiB。')
  const start = AuthoringStartV4Schema.parse(owned)
  start.project = validateProjectData(start.project)
  assertCurrentAuthoringCapability(start.project, start.capability)
  if (start.scope.artwork) deny('此能力仅使用起始固定资源，未开放素材创建。')
  if (authoringProjectHash(start.project) !== start.baseContentHash) deny('确切当前基线不同。')
  let generationTargets: string[] = [], generationIds: string[] = [], usage: BudgetUsage
  if (isGeneratedAuthoringV4(start)) {
    const replayed = replayBaseMapSourceV3(start.source)
    if (start.policy.policyVersion !== 2 || !same(start.policy, createContinuationPolicyV2(start.source.request.profile))
      || !same(start.project, replayed.project) || start.baseContentHash !== start.source.projectHash) deny('程序来源、注册档位或确切基线不同。')
    generationTargets = replayed.generationTargets; generationIds = replayed.generationIds; usage = replayed.usage
  } else {
    const source = start.source
    if (start.policy.policyVersion !== 1 || !same(start.policy, CONTINUATION_POLICY) || !same(source.project, start.project)
      || source.projectHash !== start.baseContentHash || source.resourceClosureHash !== currentAuthoringResourceClosureHash(start.project)
      || source.preservation.sceneId !== start.project.document.sceneId || source.preservation.revision !== start.project.document.revision
      || source.preservation.contentHash !== start.baseContentHash) deny('当前工程来源、固定资源或保护基线不同。')
    usage = { ...measureTaskBudget(start.project.document, start.project.document, { before: start.project, after: start.project }) }
    usage.semanticTargets = 0
  }
  validateCurrentAuthoringEngine(legacyAuthoringStartV4(start), start.policy.policyVersion === 2 ? start.policy.profile : undefined)
  assertUsage(authoringOperationWorkLimits(start), usage)
  return { start: freezeJson(start), generationTargets, generationIds, usage }
}
export const validateAuthoringStartV4 = (input: AuthoringStartV4): AuthoringStartV4 => checkedStart(input).start
export function createCurrentAuthoringStartV4(input: { project: ProjectData; scope: CurrentAuthoringScope | LegacyStart['scope']; seed: string; preparedAt: string;
  flowId: string; preservation: CurrentBaselineSourceV4['preservation']; brief?: AuthoringStartV4['brief']; skill?: AuthoringStartV4['skill'] }): AuthoringStartV4 {
  const project = validateProjectData(captureJson(input.project)), projectHash = authoringProjectHash(project)
  return validateAuthoringStartV4({ schemaVersion: 4, capability: CURRENT_AUTHORING_CAPABILITY, project, baseContentHash: projectHash,
    scope: input.scope as CurrentAuthoringScope, seed: input.seed, preparedAt: input.preparedAt, disclosure: 'complete-metadata/public-model',
    skill: input.skill ?? { id: 'sceneweave-scene-authoring', version: 1 }, ...(input.brief ? { brief: input.brief } : {}), policy: CONTINUATION_POLICY,
    source: { version: 4, kind: 'current-baseline', flowId: input.flowId, preservation: input.preservation, project, projectHash,
      resourceClosureHash: currentAuthoringResourceClosureHash(project) } })
}
export function createGeneratedAuthoringStartV4(input: Omit<AuthoringStartV3, 'scope'> & { scope: CurrentAuthoringScope | LegacyStart['scope'] }, scopeOverride?: CurrentAuthoringScope): AuthoringStartV4 {
  return validateAuthoringStartV4({ ...captureJson(input), schemaVersion: 4, capability: CURRENT_AUTHORING_CAPABILITY, scope: (scopeOverride ?? input.scope) as CurrentAuthoringScope })
}
function append(ledger: LedgerEntryV4[], fields: Omit<LedgerEntryV4, 'sequence' | 'previousHash' | 'entryHash'>, root: string) {
  const body = { ...fields, sequence: ledger.length + 1, previousHash: ledger.at(-1)?.entryHash ?? root }
  ledger.push(LedgerEntryV4Schema.parse({ ...body, entryHash: digest(body) }))
}
export function replayAuthoringV4(input: AuthoringStartV4, inputSteps: readonly AuthoringStepV4[]) {
  const checked = checkedStart(input), { start } = checked, steps = captureJson(inputSteps).map(step => AuthoringStepV4Schema.parse(step))
  const sourceHash = digest(start.source), policyHash = start.policy.policyHash, root = digest({ capability: start.capability, sourceHash, policyHash })
  const ledger: LedgerEntryV4[] = [], generatedSnapshots: PropAppearanceSnapshot[] = []; let aiCost = 0, actualCost = 0, usage = checked.usage
  append(ledger, { operationId: `${start.source.version === 3 ? 'generation' : 'baseline'}-${sourceHash}`, category: start.source.version === 3 ? 'generation' : 'baseline',
    operationHash: sourceHash, beforeHash: start.source.version === 3 ? authoringProjectHash(start.source.blank) : start.baseContentHash,
    afterHash: start.baseContentHash, targets: checked.generationTargets, semanticCost: checked.generationTargets.length, usage }, root)
  const replayed = replayCurrentAuthoringEngine(legacyAuthoringStartV4(start), steps as LegacyStep[],
    start.policy.policyVersion === 2 ? start.policy.profile : undefined, trace => {
      const operation = trace.operation as AuthoringOperationV4
      // Only the completed, same-core deterministic generator may establish
      // scaled instance snapshots. Arbitrary prop edits never enter this list.
      if (operation.kind === 'terrainGenerate') for (const prop of Object.values(trace.after.document.props)) {
        if (!trace.before.document.props[prop.id]) generatedSnapshots.push(propAppearanceSnapshot(prop))
      }
      const measured = continuationOperationBudgetV3(operation as LegacyOperation, trace.before, trace.after)
      actualCost += Math.max(1, trace.complexityCost)
      const cost = start.policy.policyVersion === 1 ? Math.max(1, trace.complexityCost) : measured.semanticCost
      const delta = { ...measureTaskBudget(trace.before.document, trace.after.document, { before: trace.before, after: trace.after }, { semanticTargets: cost }) }
      for (const key of ['gridNodes','fieldEvaluations','intersectionPairs','dependencyRefs','candidateAttempts','activeExecutionMs'] as const) delta[key] += trace.usage?.[key] ?? 0
      const retainedUsage = measureTaskBudget(start.project.document, trace.after.document, { before: start.project, after: trace.after })
      for (const key of CONTINUATION_RETAINED_DIMENSIONS) delta[key] = Math.max(delta[key], retainedUsage[key])
      assertUsage(authoringOperationWorkLimits(start), delta)
      aiCost += cost; usage = accumulateContinuationUsage(usage, delta)
      assertUsage(authoringExecutionWorkLimits(start), usage)
      if (aiCost > start.policy.aiTargets || start.policy.policyVersion === 1 && actualCost > 256) deny('任务累计真实展开或语义目标超过冻结预算。')
      append(ledger, { operationId: `ai-${digest([steps[trace.stepIndex - 1].stepId, trace.operationIndex])}`, category: 'ai',
        operationHash: digest(operation), beforeHash: authoringProjectHash(trace.before), afterHash: authoringProjectHash(trace.after),
        targets: measured.targets, semanticCost: cost, usage: delta }, root)
    })
  const finalTargets = semanticChangedDocumentTargets(start.source.version === 3 ? start.source.blank.document : start.project.document, replayed.project.document)
  const finalLimit = start.policy.policyVersion === 1 ? 256 : start.policy.finalAdoptionTargets
  if (finalTargets.length > finalLimit) deny(`最终采用超过${finalLimit}目标。`)
  // Commands may add new fixed appearance snapshots from permitted scene fields, but cannot add resource bytes or definitions.
  assertCurrentAuthoringResourceEvolution(start, replayed.project, generatedSnapshots)
  const budget = { generationCost: checked.generationTargets.length, aiCost, finalAdoptionCost: finalTargets.length, usage }
  const ledgerHeadHash = ledger.at(-1)!.entryHash, budgetStateHash = digest({ capability: start.capability, policyHash, sourceHash, ledgerHeadHash, budget })
  const state = AuthoringStateV4Schema.parse({ ...replayed.state, schemaVersion: 4, operationCost: budget.generationCost + aiCost,
    changedIds: sorted([...checked.generationIds, ...replayed.state.changedIds]), writeIds: sorted([...checked.generationIds, ...replayed.state.writeIds]),
    policyHash, sourceHash, ledgerHeadHash, budgetStateHash, budget, ledger })
  return { project: replayed.project, state, visualInvalidatedIds: replayed.visualInvalidatedIds }
}
export function checkAuthoringStateV4(start: AuthoringStartV4, input: AuthoringStateV4) {
  const state = AuthoringStateV4Schema.parse(captureJson(input)), replayed = replayAuthoringV4(start, state.steps)
  if (!same(state, replayed.state)) deny('草稿、来源或完整预算账本不一致。')
  return replayed
}
export function applyAuthoringStepV4(start: AuthoringStartV4, input: AuthoringStateV4, operations: AuthoringOperationV4[], stepId: string) {
  const checked = checkAuthoringStateV4(start, input), existing = checked.state.steps.find(step => step.stepId === stepId)
  if (existing) { if (!same(existing.operations, operations)) deny('相同操作ID被不同内容占用。'); return checked }
  const step = AuthoringStepV4Schema.parse({ index: checked.state.draftRevision + 1, stepId, operations: captureJson(operations) })
  return replayAuthoringV4(start, [...checked.state.steps, step])
}
/** A phase is one atomic candidate, even though its recipes occupy bounded internal ledger steps. */
export function applyAuthoringStageV4(start: AuthoringStartV4, input: AuthoringStateV4, operations: AuthoringOperationV4[], stageId: string) {
  if (!operations.length || operations.length > 64 || !stageId || stageId.length > 200) deny('阶段最多64条配方且须有稳定ID。')
  const checked = checkAuthoringStateV4(start, input), prefix = `stage:${digest(stageId)}:`
  const existing = checked.state.steps.filter(step => step.stepId.startsWith(prefix))
  if (existing.length) { if (!same(existing.flatMap(step => step.operations), operations)) deny('相同阶段ID被不同内容占用。'); return checked }
  const steps = [...checked.state.steps]
  for (let offset = 0; offset < operations.length; offset += 16) steps.push(AuthoringStepV4Schema.parse({ index: steps.length + 1, stepId: `${prefix}${offset / 16}`, operations: operations.slice(offset, offset + 16) }))
  return replayAuthoringV4(start, steps)
}
export function authoringAssetPageV4(start: AuthoringStartV4, query: string, limit: number, offset = 0) {
  start = validateAuthoringStartV4(start)
  const page = currentAuthoringAssetPage(legacyAuthoringStartV4(start), start.policy.policyVersion === 2 ? start.policy.profile : undefined, query, limit, offset)
  return { ...page, assets: page.assets.map(row => {
    if (row.kind !== 'prop') return row
    const definition = start.project.document.propDefinitions[row.id], presentation = definitionPresentation(start.project.appearance, { id: row.id, version: definition.version })
    return { ...row, sourceVisualBoundsMm: definition.defaultVisualBoundsMm, visualBoundsMm: presentationBounds({ visualBoundsMm: definition.defaultVisualBoundsMm }, presentation), fixedPresentation: presentation ?? null }
  }) }
}
/** Generation accounting is not an authorization grant. Only IDs born after
 * the exact AI starting project can enter the model's created-entity scope. */
export function currentAuthoringCreatedIds(start: AuthoringStartV4, state: AuthoringStateV4): string[] {
  const initial = geometryIdentityIds(start.project.document)
  for (const id of Object.keys(start.project.document.userLayers)) initial.add(id)
  for (const row of semanticTargetEntries(start.project.document).values()) initial.add(row.id)
  return state.changedIds.filter(id => !initial.has(id))
}
/** Public-model receipts omit retained closure/work totals that can reveal ungranted records. */
export const publicAuthoringBudgetV4 = (state: AuthoringStateV4) => ({ generationCost: state.budget.generationCost, aiCost: state.budget.aiCost, finalAdoptionCost: state.budget.finalAdoptionCost })
export function publicAuthoringContextV4(start: AuthoringStartV4, state: AuthoringStateV4): unknown {
  const replayed = checkAuthoringStateV4(start, state)
  const context = publicAuthoringContextForReplay(legacyAuthoringStartV4(start), { ...replayed, state: { ...replayed.state, schemaVersion: 1, changedIds: currentAuthoringCreatedIds(start, replayed.state) } as never }, CURRENT_AUTHORING_CAPABILITY) as Record<string, unknown>
  const projected: Record<string, unknown> = { ...context }
  if (Array.isArray(context.targets)) projected.targets = context.targets.map(row => currentPublicPaintRow(replayed.project, row))
  if (context.scene && typeof context.scene === 'object') {
    const scene = context.scene as Record<string, unknown>
    projected.scene = { ...scene, ...(Array.isArray(scene.entities) ? { entities: scene.entities.map(row => currentPublicPaintRow(replayed.project, row)) } : {}) }
  }
  if (context.placement && typeof context.placement === 'object') {
    const placement = context.placement as Record<string, unknown>
    projected.placement = { ...placement, ...(Array.isArray(placement.assets) ? { assets: placement.assets.map(row => {
      const definition = replayed.project.document.propDefinitions[row.id], presentation = definitionPresentation(replayed.project.appearance, { id: row.id, version: definition.version })
      return { ...row, sourceVisualBoundsMm: definition.defaultVisualBoundsMm, visualBoundsMm: presentationBounds({ visualBoundsMm: definition.defaultVisualBoundsMm }, presentation), fixedPresentation: presentation ?? null }
    }) } : {}) }
  }
  return { ...projected, schemaVersion: 4, capability: start.capability, operationCost: state.operationCost,
    remainingOperations: start.policy.aiTargets - state.budget.aiCost, policyHash: state.policyHash, sourceHash: state.sourceHash,
    ledgerHeadHash: state.ledgerHeadHash, budgetStateHash: state.budgetStateHash, budget: publicAuthoringBudgetV4(state),
    operationWorkLimits: authoringOperationWorkLimits(start), executionWorkLimits: authoringExecutionWorkLimits(start),
    fixedResourcePolicy: 'only explicitly granted fixed definitions/materials and their starting byte/license/source closure; no SVG or resource creation' }
}
