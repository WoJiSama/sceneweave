import { z } from 'zod'
import { assertTaskBudget, emptyBudgetUsage, parseTaskBudgetProfile, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { hashGenerationValue } from '../../shared/generation/contracts.js'
import { normalizeMixedInput } from '../../shared/generation/domains/mixed/index.js'
import { checkCancelled, type CancellationSignal, type CompleteValidationOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { captureJson } from '../../shared/validation/json.js'
import { prepareGenerationIntent, type GenerationContentPort, type MixedGenerationUiRequest } from './generation-intent.js'
import { prepareDomainProject } from './generation.js'

import { SEMANTIC_GENERATION_CAPABILITY, SEMANTIC_GENERATION_CONTENT, parseSemanticGenerationRequest, semanticGenerationCapabilities } from '../../shared/generation/semantic-request.js'
export { SEMANTIC_GENERATION_CAPABILITY, SEMANTIC_GENERATION_CONTENT, parseSemanticGenerationRequest, semanticGenerationCapabilities, semanticGenerationExample, semanticGenerationRequestHash } from '../../shared/generation/semantic-request.js'
export type { SemanticGenerationRequest } from '../../shared/generation/semantic-request.js'
const authorizationSchema = z.object({
  capabilityId: z.literal(SEMANTIC_GENERATION_CAPABILITY), contentId: z.literal(SEMANTIC_GENERATION_CONTENT),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type SemanticGenerationAuthorization = z.infer<typeof authorizationSchema>
export interface SemanticGenerationPreparationOptions {
  /** Supplied by the host after user approval, never taken from model JSON. */
  authorization: SemanticGenerationAuthorization
  profile: TaskBudgetProfile
  runtime: PreparationContext
  content: GenerationContentPort
  signal?: CancellationSignal
}

/** Normalize through the same application intent consumed by the page. The
 * returned domain input is preparation data, not a validated project or lease. */
export async function prepareSemanticGenerationIntent(raw: unknown, options: SemanticGenerationPreparationOptions) {
  checkCancelled(options.signal)
  const request = parseSemanticGenerationRequest(raw), requestHash = hashGenerationValue(request)
  const authorization = authorizationSchema.parse(captureJson(options.authorization)), profile = parseTaskBudgetProfile(options.profile)
  if (authorization.requestHash !== requestHash) throw new Error('语义生成请求与用户授权不符。')
  const parameters: MixedGenerationUiRequest = request.parameters
  const prepared = await prepareGenerationIntent({ domain: 'mixed', request: parameters }, {
    runtime: options.runtime, content: options.content, signal: options.signal, selectBudget: () => profile,
  })
  checkCancelled(options.signal)
  const floors = Object.values(prepared.base.document.floors), input = normalizeMixedInput(prepared.input)
  if (input.parameters.outdoor.kind !== 'forest' || floors.length !== 1
    || floors[0].boundsMm.width !== request.parameters.widthMm || floors[0].boundsMm.height !== request.parameters.heightMm) {
    throw new Error('固定素材适配器返回的环境或尺寸与语义授权不符。')
  }
  return { ...prepared, input, request, requestHash, limitations: [...semanticGenerationCapabilities().limitations] }
}

export interface SemanticGenerationOptions extends SemanticGenerationPreparationOptions {
  validation: CompleteValidationOptions
  nowMilliseconds?: () => number
}

/** Exactly one new-project generation. There is no retry, old-task continuation
 * or implicit commit. The host still exports/cold-reads and the page imports. */
export async function generateSemanticProject(raw: unknown, options: SemanticGenerationOptions) {
  const signals = [...new Set([options.signal, options.validation.signal].filter((value): value is CancellationSignal => !!value))]
  const signal: CancellationSignal = {
    get aborted() { return signals.some(value => value.aborted) },
    addEventListener: (type, listener, settings) => { for (const source of signals) source.addEventListener?.(type, listener, settings) },
    removeEventListener: (type, listener) => { for (const source of signals) source.removeEventListener?.(type, listener) },
  }
  checkCancelled(signal)
  const clock = options.nowMilliseconds ?? (() => Math.floor(performance.now())), started = clock()
  const prepared = await prepareSemanticGenerationIntent(raw, { ...options, signal })
  const elapsed = () => Math.max(0, Math.ceil(clock() - started))
  const budgetClock = () => {
    checkCancelled(signal)
    assertTaskBudget(prepared.profile, { ...emptyBudgetUsage(), activeExecutionMs: elapsed() })
    return clock()
  }
  budgetClock()
  const candidate = await prepareDomainProject(prepared.domain, prepared.base, prepared.input, {
    runtime: options.runtime, validation: options.validation, signal, profile: prepared.profile, nowMilliseconds: budgetClock,
  })
  checkCancelled(signal)
  const usage = assertTaskBudget(prepared.profile, { ...candidate.usage, activeExecutionMs: Math.max(candidate.usage.activeExecutionMs, elapsed()) })
  return { kind: 'new-project' as const, request: prepared.request, requestHash: prepared.requestHash,
    limitations: prepared.limitations, candidate: { ...candidate, usage } }
}
