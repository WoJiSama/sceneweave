import { BUDGET_DIMENSIONS, semanticChangedDocumentTargets, semanticTargetEntries, groupMemberIds, measureTaskBudget, assertTaskBudget } from '../budget/task-budget.js'
import type { ProjectData, LicenseSubjectKind } from '../model/project.js'
import type { CompositionContent } from '../model/appearance.js'
import type { PreparationContext } from '../ports/runtime.js'
import { createCompositionContent, listRequiredVariants, resolveAppearance } from '../appearance/graph.js'
import { validateProjectData } from '../project/validate.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { parseBaseMapRequestV3, parseBaseMapResponseV3 } from '../terrain-generation/base-map-v3.js'
import { bindTerrainVariantPresentations } from '../visual/terrain-variant-presentations.js'
import { compositionOutputHash } from '../terrain-generation/composition-integrity.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { constraintInputHash, generationInputHash, managedOutputHash } from '../terrain-generation/integrity.js'
import { visualBase } from '../visual/base.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { CONTINUATION_RETAINED_DIMENSIONS, createContinuationPolicyV2, accumulateContinuationUsage, assertContinuationUsage } from './budget-policy.js'
import { AuthoringStepSchema, type AuthoringOperation, type AuthoringStart as LegacyStart, type AuthoringStep } from './authoring-protocol-v1.js'
import { authoringProjectHash, replayAuthoringProfiled, validateAuthoringStartProfiled } from './authoring-v1.js'
import { AuthoringStartV3Schema, AuthoringStateV3Schema, BaseMapSourceV3Schema, LedgerEntryV3Schema,
  type AuthoringStartV3, type AuthoringStateV3, type BaseMapSourceV3, type LedgerEntryV3 } from './continuation-protocol-v3.js'

const semanticChangedTargets = (before: ProjectData, after: ProjectData) => semanticChangedDocumentTargets(before.document, after.document)
const digest = (value: unknown) => sha256Text(canonicalJson(value))
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const deny = (message: string): never => { throw new Error(`AI接续无效：${message}`) }
function targetIds(project: ProjectData, keys: string[]): string[] {
  const rows = semanticTargetEntries(project.document)
  return sorted(keys.flatMap(key => rows.get(key)?.id ?? []))
}
function explicitTargets(operation: AuthoringOperation, before: ProjectData, after: ProjectData): string[] {
  const ids = new Set<string>(), row = operation as unknown as Record<string, unknown>
  if (typeof row.id === 'string') ids.add(row.id)
  for (const key of ['ids', 'targetIds', 'openingIds']) if (Array.isArray(row[key])) for (const id of row[key]) if (typeof id === 'string') ids.add(id)
  if (operation.kind === 'terrainEdit' && 'targetAreaId' in operation.request && operation.request.targetAreaId) ids.add(operation.request.targetAreaId)
  if (operation.kind === 'visualFilter' && operation.target.kind === 'entities') {
    ids.delete(operation.id); operation.target.ids.forEach(id => ids.add(id))
  }
  if (operation.kind === 'visualRemove' && operation.effectKind === 'filter') {
    const filter = visualBase(before.document)?.filters[operation.id]
    if (filter?.target.kind === 'entities') { ids.delete(operation.id); filter.target.ids.forEach(id => ids.add(id)) }
  }
  const rows = new Map([...semanticTargetEntries(before.document), ...semanticTargetEntries(after.document)])
  const changed = new Set(semanticChangedTargets(before, after))
  return [...rows].filter(([key, target]) => ids.has(target.id)
    && !groupMemberIds(before.document, after.document, key).some(id => changed.has(`prop:${id}`))).map(([key]) => key)
}
/** Pure target accounting, also covering explicit no-op requests. Admitting a
 * capability still requires the version-specific scope/domain validators. */
export function continuationOperationBudgetV3(operation: AuthoringOperation, before: ProjectData, after: ProjectData) {
  const targets = sorted([...semanticChangedTargets(before, after), ...explicitTargets(operation, before, after)])
  return { targets, semanticCost: Math.max(1, targets.length) }
}
export const baseMapResourceClosureHash = (project: ProjectData): string => digest({ assets: project.assets, licenses: project.licenses,
  licenseBindings: project.licenseBindings, authoringSources: project.authoringSources })
function inheritBindings(project: ProjectData) {
  const collections = { asset: 'assets', material: 'materials', propDefinition: 'propDefinitions', prefabDefinition: 'prefabDefinitions', styleTheme: 'styleThemes' } as const
  for (const [kind, key] of Object.entries(collections) as [LicenseSubjectKind, typeof collections[keyof typeof collections]][]) for (const subject of Object.values(project.document[key])) {
    if (project.licenseBindings.some(binding => binding.subjectKind === kind && binding.subjectId === subject.id)) continue
    const matches = project.licenseBindings.filter(binding => binding.licenseRef === subject.licenseRef && binding.embedding === 'allowed')
    if (!matches.length || new Set(matches.map(binding => binding.licensePath)).size !== 1) deny('固定来源缺少唯一完整许可。')
    project.licenseBindings.push({ ...matches[0], subjectKind: kind, subjectId: subject.id })
  }
}

/** Pure metadata replay. The application must additionally validate the actual
 * resource closure/bytes/pixels before creating a local adoption credential. */
export function replayBaseMapSourceV3(input: BaseMapSourceV3) {
  const owned = captureJson(input)
  if (encodeUtf8(canonicalJson(owned)).length > 32 * 1024 * 1024) deny('完整来源超过32MiB。')
  const source = BaseMapSourceV3Schema.parse(owned), request = parseBaseMapRequestV3(source.request)
  const response = parseBaseMapResponseV3(request, source.response), blank = validateProjectData(source.blank)
  if (!same(source.request, request) || !same(source.response, response) || source.flowId !== request.flowId
    || !same(blank.document, request.base) || source.preservation.checkpoint !== request.checkpoint
    || (source.preservation.sceneId ?? 'empty-workspace') !== request.workspaceSceneId
    || (source.preservation.sceneId === null) !== (source.preservation.revision === null)
    || (source.preservation.sceneId === null) !== (source.preservation.contentHash === null)) deny('来源、空白或原工程保护基线不同。')
  if (Date.parse(source.execution.completedAt) < Date.parse(source.execution.startedAt)
    || source.execution.activeRuntimeMs > request.profile.limits.activeExecutionMs) deny('来源执行记录不合法或已经超时。')
  let cursor = 0
  const runtime: PreparationContext = { ids: { nextId: () => {
    const id = source.identityAllocation[cursor++]
    if (!id) deny('实际身份分配表不完整。')
    return id
  } }, clock: { now: () => source.preparedAt } }
  let content: CompositionContent
  if (response.result.kind === 'terrain' && request.generation.kind === 'terrain') {
    if (response.result.terrain.input.algorithmVersion === 6) {
      const labels = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合地貌' }
      const document = cloneJson(response.result.terrain.document)
      document.title = `${labels[request.generation.input.kind]} · ${response.result.terrain.skeleton.name}`
      content = bindTerrainVariantPresentations(createCompositionContent(document, runtime))
    } else {
      const prepared = composeTerrainDocument(blank.document, response.result.terrain as Parameters<typeof composeTerrainDocument>[1], runtime.ids.nextId(), request.profile)
      const labels = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合地貌' }
      prepared.document.title = `${labels[request.generation.input.kind]} · ${response.result.terrain.skeleton.name}`
      content = createCompositionContent(prepared.document, runtime)
    }
  } else if (response.result.kind === 'composition') {
    content = request.generation.kind==='composition'&&request.generation.input.recipeVersion===6
      ? bindTerrainVariantPresentations(createCompositionContent(response.result.document, runtime))
      : createCompositionContent(response.result.document, runtime)
    const generation = content.document.generation
    if (generation?.version !== 5) return deny('组合来源版本不同。')
    for (const row of Object.values(generation.compositions)) row.outputHash = compositionOutputHash(content.document, row, content.historyIdentity)
  } else return deny('来源生成类型不同。')
  if (cursor !== source.identityAllocation.length) deny('实际身份分配表含未使用记录。')
  if (listRequiredVariants(content).some(variant => !content.appearance.variants[variant.id])) deny('此接续策略尚不支持需要新位图派生的底图；可独立审阅采用。')
  content = resolveAppearance(content)
  if (content.document.generation?.version !== 5) {
    for (const rule of Object.values(getLegacyGeneration(content.document)?.rules ?? {})) {
      rule.inputHash = generationInputHash(content.document, rule); rule.managedOutputHash = managedOutputHash(content.document, rule)
    }
    for (const check of Object.values(content.document.generation?.checks ?? {})) check.inputHash = constraintInputHash(content.document, check.constraintId)
  }
  const metadata = { ...cloneJson(blank), ...content, schemaVersion: content.document.schemaVersion }
  inheritBindings(metadata)
  const project = validateProjectData(metadata)
  if (!same(project, source.project) || authoringProjectHash(project) !== source.projectHash
    || baseMapResourceClosureHash(project) !== source.resourceClosureHash) deny('实际物化工程、身份、资源或来源指纹不同。')
  const generationTargets = semanticChangedTargets(blank, project)
  if (generationTargets.length > request.profile.semanticTargets) deny('程序生成超过语义目标额度。')
  if (!same(response.generationBudget.semanticTargets, generationTargets) || response.generationBudget.semanticCost !== generationTargets.length) deny('完整物化后的生成语义额度与领域回执不同。')
  // The domain reply has no actual asset bytes. Re-measure the complete project
  // closure, while preserving the generator's deterministic execution meter.
  const retained = measureTaskBudget(blank.document, project.document, { before: blank, after: project })
  const usage = { ...retained }
  // These are two observations of the same generation, not two executions.
  // The domain meter proves generation work; the complete project proves its
  // materialized geometry, metadata and declared resource admission closure.
  for (const key of BUDGET_DIMENSIONS) usage[key] = Math.max(response.generationBudget.usage[key], retained[key])
  usage.semanticTargets = generationTargets.length
  usage.activeExecutionMs = source.execution.activeRuntimeMs
  assertTaskBudget(request.profile, usage)
  return { source: freezeJson(source), project, generationTargets, generationIds: targetIds(project, generationTargets), usage }

}
export const captureBaseMapSourceV3 = (input: BaseMapSourceV3): BaseMapSourceV3 => replayBaseMapSourceV3(input).source
export function legacyAuthoringStartV3(start: AuthoringStartV3): LegacyStart {
  const { policy: _policy, source: _source, ...legacy } = start
  return { ...legacy, schemaVersion: 1 }
}
function checkedAuthoringStartV3(input: AuthoringStartV3) {
  const owned = captureJson(input)
  if (encodeUtf8(canonicalJson(owned)).length > 48 * 1024 * 1024) deny('接续完整输入超过48MiB。')
  const start = AuthoringStartV3Schema.parse(owned), checked = replayBaseMapSourceV3(start.source)
  if (!same(start.policy, createContinuationPolicyV2(start.source.request.profile)) || !same(start.project, checked.project)
    || start.baseContentHash !== start.source.projectHash) deny('策略或AI确切基线与底图来源不同。')
  if (start.scope.artwork) deny('接续不支持延后素材制作。')
  if (start.scope.visual) deny('当前底图接续不支持视觉授权；完整v3/v4视觉领域尚未提供，物件透明度等既有场景操作仍按明确授权执行。')
  validateAuthoringStartProfiled(legacyAuthoringStartV3(start), start.policy.profile)
  return { start: freezeJson(start), generated: checked }
}
export function validateAuthoringStartV3(input: AuthoringStartV3): AuthoringStartV3 { return checkedAuthoringStartV3(input).start }
function append(ledger: LedgerEntryV3[], fields: Omit<LedgerEntryV3, 'sequence' | 'previousHash' | 'entryHash'>, initialHash: string) {
  const body = { ...fields, sequence: ledger.length + 1, previousHash: ledger.at(-1)?.entryHash ?? initialHash }
  const entry = LedgerEntryV3Schema.parse({ ...body, entryHash: digest(body) })
  ledger.push(entry)
}
export function replayAuthoringV3(input: AuthoringStartV3, inputSteps: readonly AuthoringStep[]) {
  const { start, generated } = checkedAuthoringStartV3(input), policyHash = start.policy.policyHash, sourceHash = digest(start.source)
  const steps = captureJson(inputSteps)
  for (const step of steps) for (const operation of step.operations) {
    if (operation.kind === 'svg' || operation.kind === 'style') deny('接续策略不支持延后素材制作。')
    if (operation.kind === 'visualFilter' && operation.target.kind !== 'entities') deny('接续滤镜只支持明确冻结的实体目标；全图、区域及持续图层滤镜尚未支持有限展开。')
  }
  const ledger: LedgerEntryV3[] = []
  const root = digest({ flowId: start.source.flowId, policyHash, sourceHash })
  append(ledger, { operationId: `generation-${digest(start.source.request)}`, category: 'generation', operationHash: digest({ request: start.source.request, response: start.source.response }),
    beforeHash: authoringProjectHash(start.source.blank), afterHash: start.source.projectHash, targets: generated.generationTargets,
    semanticCost: generated.generationTargets.length, usage: generated.usage }, root)
  let aiCost = 0, usage = generated.usage
  const replayed = replayAuthoringProfiled(legacyAuthoringStartV3(start), steps, start.policy.profile, trace => {
    const operation = trace.operation
    if (operation.kind === 'visualFilter' && operation.target.kind === 'entities') {
      const filters = visualBase(trace.before.document)?.filters ?? {}
      if (operation.target.ids.some(id => filters[id] || id === operation.id)) deny('接续滤镜不能把滤镜记录自身作为外观实体目标。')
    }
    const { targets, semanticCost: cost } = continuationOperationBudgetV3(trace.operation, trace.before, trace.after)
    const operationUsage = { ...measureTaskBudget(trace.before.document, trace.after.document, { before: trace.before, after: trace.after }, { semanticTargets: cost }) }
    for (const key of ['gridNodes','fieldEvaluations','intersectionPairs','dependencyRefs','candidateAttempts','activeExecutionMs'] as const) operationUsage[key] += trace.usage?.[key] ?? 0
    const currentCandidate = measureTaskBudget(start.source.blank.document, trace.after.document, { before: start.source.blank, after: trace.after })
    for (const key of CONTINUATION_RETAINED_DIMENSIONS) operationUsage[key] = Math.max(operationUsage[key], currentCandidate[key])
    assertTaskBudget(start.policy.profile, operationUsage)
    aiCost += cost; usage = accumulateContinuationUsage(usage, operationUsage)
    assertContinuationUsage(start.policy, usage)
    if (cost > start.policy.aiTargets || aiCost > start.policy.aiTargets) deny('AI语义累计或计算复杂度超过冻结策略。')
    append(ledger, { operationId: `ai-${digest([steps[trace.stepIndex - 1].stepId, trace.operationIndex])}`, category: 'ai', operationHash: digest(trace.operation),
      beforeHash: authoringProjectHash(trace.before), afterHash: authoringProjectHash(trace.after), targets,
      semanticCost: cost, usage: operationUsage }, root)
  })
  const finalTargets = assertContinuationAdoptionBudgetV3(start.source.blank, replayed.project, start.policy.finalAdoptionTargets)
  const budget = { generationCost: generated.generationTargets.length, aiCost, finalAdoptionCost: finalTargets.length, usage }
  const ledgerHeadHash = ledger.at(-1)!.entryHash, budgetStateHash = digest({ policyHash, sourceHash, ledgerHeadHash, budget })
  const ids = sorted([...generated.generationIds, ...replayed.state.changedIds])
  const state = AuthoringStateV3Schema.parse({ ...replayed.state, schemaVersion: 3, operationCost: budget.generationCost + aiCost,
    changedIds: ids, writeIds: sorted([...generated.generationIds, ...replayed.state.writeIds]), policyHash, sourceHash, ledgerHeadHash, budgetStateHash, budget, ledger })
  return { project: replayed.project, state, visualInvalidatedIds: replayed.visualInvalidatedIds }
}
export function checkAuthoringStateV3(start: AuthoringStartV3, input: AuthoringStateV3) {
  const state = AuthoringStateV3Schema.parse(captureJson(input)), replayed = replayAuthoringV3(start, state.steps)
  if (!same(state, replayed.state)) deny('草稿内容、预算或完整账本不一致。')
  return replayed
}
export function applyAuthoringStepV3(start: AuthoringStartV3, input: AuthoringStateV3, operations: AuthoringOperation[], stepId: string) {
  const checked = checkAuthoringStateV3(start, input)
  const existing = checked.state.steps.find(step => step.stepId === stepId)
  if (existing) {
    if (!same(existing.operations, operations)) deny('相同操作ID被不同内容占用。')
    return checked
  }
  const step = AuthoringStepSchema.parse(captureJson({ index: checked.state.draftRevision + 1, stepId, operations }))
  return replayAuthoringV3(start, [...checked.state.steps, step])
}

export function assertContinuationAdoptionBudgetV3(before: ProjectData, after: ProjectData, limit: number): string[] {
  const targets = semanticChangedTargets(before, after)
  if (targets.length > limit) deny(`完整采用超过冻结的${limit}语义目标。`)
  return targets
}
