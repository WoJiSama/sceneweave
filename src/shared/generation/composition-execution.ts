import type { SceneDocument } from '../model/scene.js'
import { assertTaskBudget, BUDGET_DIMENSIONS, emptyBudgetUsage, measureTaskBudget, parseTaskBudgetProfile, type TaskBudgetProfile } from '../budget/task-budget.js'
import { captureJson, cloneJson, freezeJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { generationCandidateSchema, hashGenerationValue, parseGenerationArtifactReceipt, type GenerationArtifact, type GenerationCandidate, type GenerationStageReceipt } from './contracts.js'
import { GenerationError } from './orchestrator.js'

export interface CompositionExecutionOptions {
  readonly profile: TaskBudgetProfile
  readonly nowMilliseconds: () => number
  readonly signal?: { readonly aborted: boolean }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const outputHash = (outputs: readonly GenerationArtifact[]) => hashGenerationValue(outputs.map(row => [row.kind, row.id, row.contentHash]))
function captureCandidate(input: GenerationCandidate) {
  try { return generationCandidateSchema.parse(captureJson(input)) }
  catch (error) { throw new GenerationError('candidate-invalid', `组合模块候选信封无效：${String(error)}`) }
}

/** A private serial composition transaction. Domain runners retain their own
 * seeds and recipes; this owner captures stages, checks the source/hash chain,
 * accumulates actual work and publishes exactly one complete candidate. */
export class GenerationCompositionExecution {
  readonly options: CompositionExecutionOptions
  readonly #source: SceneDocument
  readonly #usage = emptyBudgetUsage()
  readonly #stages: GenerationStageReceipt[] = []
  readonly #outputs: GenerationArtifact[] = []
  readonly #diagnostics: GenerationCandidate['diagnostics'][number][] = []
  readonly #modules = new Set<string>()
  readonly #stageIds = new Set<string>()
  readonly #outputIds = new Set<string>()
  readonly #start: number
  #lastTime: number
  #current: SceneDocument
  #closed = false
  #running = false

  constructor(source: SceneDocument, options: CompositionExecutionOptions) {
    this.#source = freezeJson(captureJson(source))
    this.#current = this.#source
    this.#usage.candidateAttempts = 1
    this.#start = options.nowMilliseconds(); this.#lastTime = this.#start
    const profile = parseTaskBudgetProfile(options.profile)
    this.options = Object.freeze({ ...options, profile, nowMilliseconds: () => {
      if (options.signal?.aborted) throw new GenerationError('cancelled', '组合生成已取消，未发布部分候选。')
      const now = options.nowMilliseconds()
      if (!Number.isSafeInteger(this.#start) || this.#start < 0 || !Number.isSafeInteger(now) || now < this.#lastTime) throw new GenerationError('invalid-request', '组合执行时钟须返回非负单调整数毫秒。')
      this.#lastTime = now
      if (now - this.#start > profile.limits.activeExecutionMs) throw new GenerationError('budget-exceeded', '组合生成累计执行时间超限。')
      return now
    } })
    this.options.nowMilliseconds()
  }

  /** Immutable view for final domain-specific checks; never a publication. */
  get document(): SceneDocument { return this.#current }

  run<Result extends { readonly candidate: GenerationCandidate }>(module: string, execute: (source: SceneDocument, options: CompositionExecutionOptions) => Result): Result {
    if (this.#closed || this.#running || !module || this.#modules.has(module)) throw new GenerationError('invalid-request', '组合模块必须串行执行且具有唯一身份，关闭后不能继续。')
    this.#running = true
    try {
      // A cancelled transaction must not start a later runner at all. Do not
      // add a clock sample here: exact replay keeps the existing time meter.
      if (this.options.signal?.aborted) throw new GenerationError('cancelled', '组合生成已取消，未发布部分候选。')
      // Neither a retained runner source nor its returned result owns the
      // composition's private captured document.
      const result = execute(cloneJson(this.#current), this.options)
      this.#append(module, result.candidate)
      this.#modules.add(module)
      return result
    } catch (error) { this.#closed = true; throw error }
    finally { this.#running = false }
  }

  #append(module: string, input: GenerationCandidate): void {
    if (this.options.signal?.aborted) throw new GenerationError('cancelled', '组合生成已取消，未发布部分候选。')
    const candidate = captureCandidate(input), beforeHash = hashGenerationValue(this.#current)
    let artifacts: GenerationArtifact[]
    try { artifacts = candidate.outputs.map(parseGenerationArtifactReceipt) }
    catch (error) { throw new GenerationError('candidate-invalid', `组合模块产物合同或摘要无效：${String(error)}`) }
    if (candidate.status !== 'prepared' || candidate.materializationRequired !== true || candidate.sourceHash !== beforeHash
      || candidate.documentHash !== hashGenerationValue(candidate.document) || candidate.outputHash !== outputHash(artifacts)) throw new GenerationError('candidate-invalid', '组合前序候选摘要断链。')
    if (!validateSceneDocument(candidate.document).ok) throw new GenerationError('candidate-invalid', '组合模块须提供严格有效的完整候选，不能向后续模块发布待修复草稿。')
    const next = candidate.document as SceneDocument
    if (next.sceneId !== this.#source.sceneId || next.revision !== this.#source.revision
      || next.mapMode !== this.#source.mapMode || canonicalJson(next.floors) !== canonicalJson(this.#source.floors)) throw new GenerationError('candidate-invalid', '组合模块不能改变基线身份、revision、Floor或坐标框架。')
    if (candidate.diagnostics.some(row => row.hard) || artifacts.some(row => row.kind === 'diagnostic' && row.payload.hard)) throw new GenerationError('candidate-invalid', '组合模块仍有未满足的硬约束，不能发布成功候选。')
    let expected = beforeHash
    const steps = new Set<string>()
    for (const stage of candidate.stages) {
      if (stage.beforeHash !== expected || steps.has(stage.stepId) || this.#stageIds.has(`${module}:${stage.stepId}`)) throw new GenerationError('candidate-invalid', '组合模块阶段摘要断链或身份重复。')
      steps.add(stage.stepId); expected = stage.afterHash
    }
    if (expected !== candidate.documentHash) throw new GenerationError('candidate-invalid', '组合模块阶段链未抵达完整候选。')
    for (const artifact of artifacts) {
      if (this.#outputIds.has(artifact.id)) throw new GenerationError('ownership-conflict', '组合模块输出事实身份冲突。')
      this.#outputIds.add(artifact.id)
    }
    const actual = candidate.usage
    if (actual.candidateAttempts < 1) throw new GenerationError('candidate-invalid', '组合模块必须计入其实际候选尝试。')
    for (const key of BUDGET_DIMENSIONS) {
      const delta = key === 'candidateAttempts' ? Math.max(0, actual[key] - 1) : actual[key]
      if (!Number.isSafeInteger(this.#usage[key] + delta)) throw new GenerationError('budget-exceeded', '组合累计工作计量无效。')
      this.#usage[key] += delta
    }
    this.#usage.activeExecutionMs = Math.max(this.#usage.activeExecutionMs, this.options.nowMilliseconds() - this.#start)
    assertTaskBudget(this.options.profile, this.#usage)
    for (const stage of candidate.stages) this.#stageIds.add(`${module}:${stage.stepId}`)
    this.#stages.push(...candidate.stages.map(stage => ({ ...stage, stepId: `${module}:${stage.stepId}` })))
    this.#outputs.push(...artifacts); this.#diagnostics.push(...candidate.diagnostics)
    this.#current = freezeJson(next)
  }

  publish(requestHash: string): GenerationCandidate {
    if (this.#closed || this.#running || !this.#modules.size) throw new GenerationError('invalid-request', '组合候选不可重复发布或发布部分执行。')
    this.#closed = true
    if (!/^[a-f0-9]{64}$/.test(requestHash) || !validateSceneDocument(this.#current).ok) throw new GenerationError('candidate-invalid', '组合最终候选或请求摘要无效。')
    const sorted = [...this.#outputs].sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id))
    const full = measureTaskBudget(this.#source, this.#current)
    for (const key of BUDGET_DIMENSIONS) this.#usage[key] = Math.max(this.#usage[key], full[key])
    this.#usage.activeExecutionMs = Math.max(this.#usage.activeExecutionMs, this.options.nowMilliseconds() - this.#start)
    assertTaskBudget(this.options.profile, this.#usage)
    return freezeJson({ status: 'prepared', materializationRequired: true, requestHash, sourceHash: hashGenerationValue(this.#source),
      document: this.#current, documentHash: hashGenerationValue(this.#current), outputs: sorted, outputHash: outputHash(sorted),
      diagnostics: this.#diagnostics, usage: this.#usage, stages: this.#stages })
  }
}
