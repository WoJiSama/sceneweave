import { checkCancelled, type CancellationSignal } from '../ports/resources.js'

interface WaitingTask { weight: number; signal?: CancellationSignal; start(): void; reject(error: unknown): void }

/** FIFO admission for independent asynchronous work. Oversized work runs alone. */
export class WeightedTaskQueue {
  private readonly waiting = new Set<WaitingTask>()
  private active = 0
  private weight = 0
  constructor(private readonly maximumTasks: number, private readonly maximumWeight: number) {
    if (!Number.isSafeInteger(maximumTasks) || maximumTasks < 1 || !Number.isSafeInteger(maximumWeight) || maximumWeight < 1) throw new Error('异步任务队列上限无效。')
  }
  run<T>(weight: number, signal: CancellationSignal | undefined, action: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!Number.isSafeInteger(weight) || weight < 1) throw new Error('异步任务权重无效。')
      checkCancelled(signal)
      const cost = Math.min(weight, this.maximumWeight)
      this.waiting.add({ weight: cost, signal, reject, start: () => {
        void Promise.resolve().then(() => { checkCancelled(signal); return action() }).then(resolve, reject).finally(() => {
          this.active--; this.weight -= cost; this.pump()
        })
      } })
      this.pump()
    })
  }
  private pump(): void {
    while (this.waiting.size) {
      const task = this.waiting.values().next().value!
      try { checkCancelled(task.signal) }
      catch (error) { this.waiting.delete(task); task.reject(error); continue }
      if (this.active >= this.maximumTasks || this.weight + task.weight > this.maximumWeight) return
      this.waiting.delete(task); this.active++; this.weight += task.weight; task.start()
    }
  }
}
