import { generationDomains } from '../../shared/generation/domains/registry.js'
import { createDomainExecutionRequest, executeDomainExecutionRequest, parseDomainExecutionResponse, type DomainExecutionRequest, type DomainExecutionResponse, type DomainGenerationKind, type DomainGenerationResults } from '../../shared/generation/execution.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../../shared/visual/terrain-variant-presentations.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { assertTaskBudget, measureTaskBudget, parseTaskBudgetProfile, taskSemanticTargets, type BudgetUsage, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { checkCancelled, type CompleteValidationOptions, type CancellationSignal } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { captureJson, freezeJson } from '../../shared/validation/json.js'
import { hashGenerationValue } from '../../shared/generation/contracts.js'
import { captureEditableDraft, validateEditableProject, type EditableProject } from './project.js'
import { materializeProject } from './prepare.js'

export type DomainGenerationExecutor = (request: DomainExecutionRequest) => Promise<DomainExecutionResponse>
export interface DomainPreparationOptions {
  runtime: PreparationContext
  validation: CompleteValidationOptions
  profile: TaskBudgetProfile
  signal?: CancellationSignal
  nowMilliseconds?: () => number
  execute?: DomainGenerationExecutor
  context?: DomainExecutionRequest['context']
}
export type DomainCandidate<K extends DomainGenerationKind> = DomainGenerationResults[K] & {
  project: EditableProject; profile: TaskBudgetProfile; usage: BudgetUsage
  cost: { items: Record<string, number>; total: number; limit: number }
}
/** All executors supply untrusted scene proposals. Resource bytes, pixels,
 * license closure and birth/appearance identity are prepared only on the host. */
export async function prepareDomainProject<K extends DomainGenerationKind>(domain: K, base: EditableProject, raw: unknown, options: DomainPreparationOptions): Promise<DomainCandidate<K>> {
  const signal = { get aborted() { return !!options.signal?.aborted || !!options.validation.signal?.aborted } }
  const validation = { ...options.validation, signal }, profile = parseTaskBudgetProfile(options.profile)
  const clock = options.nowMilliseconds ?? (() => Math.floor(performance.now())), started = clock()
  checkCancelled(signal)
  const input = captureJson(raw), context = captureJson(options.context ?? { workspaceId: base.document.sceneId, checkpoint: 0, epoch: 0 })
  const owned = await validateEditableProject(captureEditableDraft(base), validation)
  checkCancelled(signal)
  const request = createDomainExecutionRequest({ domain, base: owned.document, input, profile, context,
    requestId: `generation-${hashGenerationValue({ domain, input, context, base: owned.document }).slice(0, 40)}` })
  const response = options.execute ? await options.execute(request) : executeDomainExecutionRequest(request, { nowMilliseconds: clock, signal })
  checkCancelled(signal)
  // Revalidate at the application boundary even when an injected transport says
  // it validated the response. A transport is never a private adoption witness.
  const result = parseDomainExecutionResponse(response, request).result
  const document = captureJson(result.candidate.document) as SceneDocument
  const rawContent = createCompositionContent(document, options.runtime)
  const content = generationDomains[domain].presentation === 'terrain-variants' ? bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(rawContent)) : rawContent
  const project = await materializeProject({ ...owned, ...content, schemaVersion: 1 }, { runtime: options.runtime, validation, budget: profile })
  checkCancelled(signal)
  const usage = assertTaskBudget(profile, measureTaskBudget(owned.document, project.document, { before: owned, after: project },
    { ...result.candidate.usage, activeExecutionMs: Math.max(result.candidate.usage.activeExecutionMs, clock() - started) }))
  const targets = taskSemanticTargets(owned.document, project.document)
  const cost = freezeJson({ items: Object.fromEntries(targets.map(target => [target, 1])), total: targets.length, limit: profile.semanticTargets })
  return { ...result, project, profile, usage, cost }
}
