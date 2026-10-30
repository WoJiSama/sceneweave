import { semanticChangedTargets, semanticTargetEntries, groupMemberIds, assertContinuationAdoptionBudget } from './semantic-budget.js'
export { semanticChangedTargets, assertContinuationAdoptionBudget } from './semantic-budget.js'
import type { ProjectData, LicenseSubjectKind } from '../model/project.js'
import type { CompositionContent } from '../model/appearance.js'
import type { PreparationContext } from '../ports/runtime.js'
import { createCompositionContent, listRequiredVariants, resolveAppearance } from '../appearance/graph.js'
import { validateProjectData } from '../project/validate.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { executeBaseMapRequestV2, parseBaseMapRequestV2, parseBaseMapResponseV2 } from '../terrain-generation/base-map-v2.js'
import { compositionOutputHash } from '../terrain-generation/composition-integrity.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { constraintInputHash, generationInputHash, managedOutputHash } from '../terrain-generation/integrity.js'
import { visualBase } from '../visual/base.js'
import { canonicalJson, captureJson, cloneJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { CONTINUATION_POLICY } from './budget-policy.js'
import { AuthoringStepSchema, type AuthoringOperation, type AuthoringStart as LegacyStart, type AuthoringStep } from './authoring-protocol-v1.js'
import { authoringProjectHash, replayAuthoringExpanded, validateAuthoringStartExpanded } from './authoring-v1.js'
import { AuthoringStartV2Schema, AuthoringStateV2Schema, BaseMapSourceSchema, LedgerEntrySchema,
  type AuthoringStartV2, type AuthoringStateV2, type BaseMapSource, type LedgerEntry } from './continuation-protocol.js'

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
export function continuationOperationBudget(operation: AuthoringOperation, before: ProjectData, after: ProjectData) {
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
export function replayBaseMapSource(input: BaseMapSource) {
  const owned = captureJson(input)
  if (encodeUtf8(canonicalJson(owned)).length > CONTINUATION_POLICY.sourceBytes) deny('完整来源超过16MiB。')
  const source = BaseMapSourceSchema.parse(owned), request = parseBaseMapRequestV2(source.request)
  const response = parseBaseMapResponseV2(request, source.response), blank = validateProjectData(source.blank)
  if (!same(source.request, request) || !same(source.response, response) || source.flowId !== request.flowId
    || !same(blank.document, request.base) || source.preservation.checkpoint !== request.checkpoint
    || (source.preservation.sceneId ?? 'empty-workspace') !== request.workspaceSceneId
    || (source.preservation.sceneId === null) !== (source.preservation.revision === null)
    || (source.preservation.sceneId === null) !== (source.preservation.contentHash === null)) deny('来源、空白或原工程保护基线不同。')
  if (Date.parse(source.execution.completedAt) < Date.parse(source.execution.startedAt)
    || source.execution.activeRuntimeMs > request.policy.activeExecutionMs) deny('来源执行记录不合法或已经超时。')
  if (!same(executeBaseMapRequestV2(request), response)) deny('领域结果未通过同算法完整重放。')
  let cursor = 0
  const runtime: PreparationContext = { ids: { nextId: () => {
    const id = source.identityAllocation[cursor++]
    if (!id) deny('实际身份分配表不完整。')
    return id
  } }, clock: { now: () => source.preparedAt } }
  let content: CompositionContent
  if (response.result.kind === 'terrain' && request.generation.kind === 'terrain') {
    const prepared = composeTerrainDocument(blank.document, response.result.terrain, runtime.ids.nextId())
    const labels = { island: '岩岛', coast: '海岸', river: '河谷', lake: '内湖', forest: '森林', hill: '丘陵', mixed: '混合地貌' }
    prepared.document.title = `${labels[request.generation.input.kind]} · ${response.result.terrain.skeleton.name}`
    content = createCompositionContent(prepared.document, runtime)
  } else if (response.result.kind === 'composition') {
    content = createCompositionContent(response.result.document, runtime)
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
  if (generationTargets.length > request.policy.generationTargets) deny('程序生成超过语义目标额度。')
  if (!same(response.generationBudget, { semanticTargets: generationTargets, semanticCost: generationTargets.length, complexityCost: response.domainCost.total })) deny('完整物化后的生成分类额度与领域回执不同。')
  return { source: freezeJson(source), project, generationTargets, generationIds: targetIds(project, generationTargets), generationComplexity: response.domainCost.total }
}
export const captureBaseMapSource = (input: BaseMapSource): BaseMapSource => replayBaseMapSource(input).source
export function legacyAuthoringStart(start: AuthoringStartV2): LegacyStart {
  const { policy: _policy, source: _source, ...legacy } = start
  return { ...legacy, schemaVersion: 1 }
}
export function validateAuthoringStartV2(input: AuthoringStartV2): AuthoringStartV2 {
  const owned = captureJson(input)
  if (encodeUtf8(canonicalJson(owned)).length > CONTINUATION_POLICY.requestBytes) deny('接续完整输入超过24MiB。')
  const start = AuthoringStartV2Schema.parse(owned), checked = replayBaseMapSource(start.source)
  if (!same(start.policy, start.source.request.policy) || !same(start.project, checked.project)
    || start.baseContentHash !== start.source.projectHash) deny('策略或AI确切基线与底图来源不同。')
  if (start.scope.artwork) deny('接续不支持延后素材制作。')
  if (start.scope.visual) deny('当前底图接续不支持视觉授权；完整v3/v4视觉领域尚未提供，物件透明度等既有场景操作仍按明确授权执行。')
  validateAuthoringStartExpanded(legacyAuthoringStart(start))
  return freezeJson(start)
}
function append(ledger: LedgerEntry[], fields: Omit<LedgerEntry, 'sequence' | 'previousHash' | 'entryHash'>, initialHash: string) {
  const body = { ...fields, sequence: ledger.length + 1, previousHash: ledger.at(-1)?.entryHash ?? initialHash }
  const entry = LedgerEntrySchema.parse({ ...body, entryHash: digest(body) })
  ledger.push(entry)
}
export function replayAuthoringV2(input: AuthoringStartV2, inputSteps: readonly AuthoringStep[]) {
  const start = validateAuthoringStartV2(input), generated = replayBaseMapSource(start.source), policyHash = start.policy.policyHash, sourceHash = digest(start.source)
  const steps = captureJson(inputSteps)
  for (const step of steps) for (const operation of step.operations) {
    if (operation.kind === 'svg' || operation.kind === 'style') deny('接续策略不支持延后素材制作。')
    if (operation.kind === 'visualFilter' && operation.target.kind !== 'entities') deny('接续滤镜只支持明确冻结的实体目标；全图、区域及持续图层滤镜尚未支持有限展开。')
  }
  const ledger: LedgerEntry[] = []
  const root = digest({ flowId: start.source.flowId, policyHash, sourceHash })
  append(ledger, { operationId: `generation-${digest(start.source.request)}`, category: 'generation', operationHash: digest({ request: start.source.request, response: start.source.response }),
    beforeHash: authoringProjectHash(start.source.blank), afterHash: start.source.projectHash, targets: generated.generationTargets,
    semanticCost: generated.generationTargets.length, complexityCost: generated.generationComplexity }, root)
  let aiCost = 0, complexityCost = generated.generationComplexity
  const replayed = replayAuthoringExpanded(legacyAuthoringStart(start), steps, trace => {
    const operation = trace.operation
    if (operation.kind === 'visualFilter' && operation.target.kind === 'entities') {
      const filters = visualBase(trace.before.document)?.filters ?? {}
      if (operation.target.ids.some(id => filters[id] || id === operation.id)) deny('接续滤镜不能把滤镜记录自身作为外观实体目标。')
    }
    const { targets, semanticCost: cost } = continuationOperationBudget(trace.operation, trace.before, trace.after)
    aiCost += cost; complexityCost += trace.complexityCost
    if (cost > start.policy.aiTargets || aiCost > start.policy.aiTargets || complexityCost > start.policy.cumulativeComplexity) deny('AI语义累计或计算复杂度超过冻结策略。')
    append(ledger, { operationId: `ai-${digest([steps[trace.stepIndex - 1].stepId, trace.operationIndex])}`, category: 'ai', operationHash: digest(trace.operation),
      beforeHash: authoringProjectHash(trace.before), afterHash: authoringProjectHash(trace.after), targets,
      semanticCost: cost, complexityCost: trace.complexityCost }, root)
  })
  const finalTargets = assertContinuationAdoptionBudget(start.source.blank, replayed.project)
  const budget = { generationCost: generated.generationTargets.length, aiCost, finalAdoptionCost: finalTargets.length, complexityCost }
  const ledgerHeadHash = ledger.at(-1)!.entryHash, budgetStateHash = digest({ policyHash, sourceHash, ledgerHeadHash, budget })
  const ids = sorted([...generated.generationIds, ...replayed.state.changedIds])
  const state = AuthoringStateV2Schema.parse({ ...replayed.state, schemaVersion: 2, operationCost: budget.generationCost + aiCost,
    changedIds: ids, writeIds: sorted([...generated.generationIds, ...replayed.state.writeIds]), policyHash, sourceHash, ledgerHeadHash, budgetStateHash, budget, ledger })
  return { project: replayed.project, state, visualInvalidatedIds: replayed.visualInvalidatedIds }
}
export function checkAuthoringStateV2(start: AuthoringStartV2, input: AuthoringStateV2) {
  const state = AuthoringStateV2Schema.parse(captureJson(input)), replayed = replayAuthoringV2(start, state.steps)
  if (!same(state, replayed.state)) deny('草稿内容、预算或完整账本不一致。')
  return replayed
}
export function applyAuthoringStepV2(start: AuthoringStartV2, input: AuthoringStateV2, operations: AuthoringOperation[], stepId: string) {
  const checked = checkAuthoringStateV2(start, input)
  const existing = checked.state.steps.find(step => step.stepId === stepId)
  if (existing) {
    if (!same(existing.operations, operations)) deny('相同操作ID被不同内容占用。')
    return checked
  }
  const step = AuthoringStepSchema.parse(captureJson({ index: checked.state.draftRevision + 1, stepId, operations }))
  return replayAuthoringV2(start, [...checked.state.steps, step])
}
