import type { ResourceOptions } from '../../shared/ports/resources.js'

/** Local execution only. User review/paused time is excluded; work that fails
 * or is cancelled is still charged. A missing checkpoint cannot start at zero. */
export class BaseMapExecutionClock {
  private readonly flows = new Map<string, { elapsedMs: number; startedAt: number | null }>()
  constructor(private readonly limitMs: number, private readonly now = () => performance.now()) {}
  initialize(flowId: string, elapsedMs: number) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || this.flows.has(flowId)) throw new Error('底图执行检查点重复或无效。')
    this.flows.set(flowId, { elapsedMs, startedAt: null })
  }
  begin(flowId: string, external?: ResourceOptions['signal']) {
    const flow = this.flows.get(flowId)
    if (!flow || flow.startedAt !== null) throw new Error('缺少底图执行检查点或同流程仍在执行。')
    if (flow.elapsedMs >= this.limitMs) throw new Error('底图流程的本机累计执行时间已用尽；合法底图仍可独立采用。')
    flow.startedAt = this.now()
    let finished = false
    const expired = () => flow.elapsedMs + (flow.startedAt === null ? 0 : Math.max(0, this.now() - flow.startedAt)) >= this.limitMs
    return {
      signal: { get aborted() { return external?.aborted === true || expired() } },
      finish: () => {
        if (finished) return
        finished = true
        flow.elapsedMs += Math.max(0, this.now() - flow.startedAt!)
        flow.startedAt = null
      },
    }
  }
}
