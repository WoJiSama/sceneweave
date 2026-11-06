import { selectTaskBudget, taskBudgetProfile, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'

export type BudgetDeviceClass = 'constrained' | 'standard' | 'expanded'
export interface BudgetDeviceObservation {
  version: 1
  device: BudgetDeviceClass
  logicalProcessors: number
  reportedMemoryGiB: number | null
  calibrationMs: number
  checksum: number
}
let observed: BudgetDeviceObservation | undefined
/** A bounded local scheduling probe. It selects a registered policy, never
 * claims available memory or changes the chosen policy during a task. */
export function observeBudgetDevice(): BudgetDeviceObservation {
  if (observed) return observed
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number }
  const logicalProcessors = Math.max(1, Math.min(128, nav?.hardwareConcurrency ?? 4))
  const reportedMemoryGiB = Number.isFinite(nav?.deviceMemory) ? nav!.deviceMemory! : null
  const times: number[] = [], values = new Uint32Array(8192)
  let checksum = 0x9e3779b9
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now()
    for (let pass = 0; pass < 16; pass++) for (let index = 0; index < values.length; index++) {
      checksum = Math.imul(checksum ^ values[index] ^ index, 1664525) + 1013904223 | 0
      values[index] = checksum >>> 0
    }
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const calibrationMs = Math.round(times[1] * 1000) / 1000
  const device: BudgetDeviceClass = logicalProcessors <= 2 || reportedMemoryGiB !== null && reportedMemoryGiB <= 2 || calibrationMs > 16
    ? 'constrained' : logicalProcessors >= 8 && (reportedMemoryGiB === null || reportedMemoryGiB >= 8) && calibrationMs <= 8 ? 'expanded' : 'standard'
  return observed = Object.freeze({ version: 1, device, logicalProcessors, reportedMemoryGiB, calibrationMs, checksum })
}
export function selectBrowserGenerationBudget(input: { widthMm: number; heightMm: number; quality: 'standard' | 'detailed'; surfaceRecipe?: 1; mode?: 'auto' | 'small' | 'standard' | 'expanded' }): TaskBudgetProfile {
  if (input.mode && input.mode !== 'auto') return taskBudgetProfile(input.mode)
  const device = observeBudgetDevice().device
  const selected = selectTaskBudget({ task: 'generation', widthMm: input.widthMm, heightMm: input.heightMm, quality: input.quality,
    device })
  if (input.surfaceRecipe === 1 && selected.profileId === 'small') {
    if (device === 'constrained') throw new Error('本机自动检测暂不能为岸岩层次选择标准容量；可选择经典外观，或手动选择标准/扩展容量后预览。')
    return taskBudgetProfile('standard')
  }
  return selected
}
