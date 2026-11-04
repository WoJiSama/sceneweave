import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })
it('pins a local observation for the page and selects exact manual tiers without recalibrating an active task', async () => {
  vi.stubGlobal('navigator', { hardwareConcurrency: 2, deviceMemory: 2 })
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time++)
  const { observeBudgetDevice, selectBrowserGenerationBudget } = await import('./budget.js')
  const first = observeBudgetDevice()
  expect(first.device).toBe('constrained')
  expect(Object.isFrozen(first)).toBe(true)
  vi.stubGlobal('navigator', { hardwareConcurrency: 32, deviceMemory: 64 })
  expect(observeBudgetDevice()).toBe(first)
  const auto = selectBrowserGenerationBudget({ widthMm: 120000, heightMm: 90000, quality: 'detailed' })
  expect(auto.profileId).toBe('small')
  const explicit = selectBrowserGenerationBudget({ widthMm: 24000, heightMm: 18000, quality: 'standard', mode: 'expanded' })
  expect(explicit.semanticTargets).toBe(2048)
  expect(explicit.profileHash).not.toBe(auto.profileHash)
  expect(selectBrowserGenerationBudget({ widthMm: 120000, heightMm: 90000, quality: 'detailed', mode: 'small' }).semanticTargets).toBe(512)
})

it('chooses the surface recipe minimum before a task without changing old selection or explicit registered tiers', async () => {
  vi.stubGlobal('navigator', { hardwareConcurrency: 4, deviceMemory: 4 })
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time++)
  const { selectBrowserGenerationBudget } = await import('./budget.js')
  const input = { widthMm: 24000, heightMm: 18000, quality: 'standard' as const }
  expect(selectBrowserGenerationBudget(input).semanticTargets).toBe(512)
  expect(selectBrowserGenerationBudget({ ...input, surfaceRecipe: 1 }).semanticTargets).toBe(1024)
  expect(selectBrowserGenerationBudget({ ...input, surfaceRecipe: 1, mode: 'small' }).semanticTargets).toBe(512)
})
it('reports insufficient automatic device envelope before starting the surface task', async () => {
  vi.stubGlobal('navigator', { hardwareConcurrency: 2, deviceMemory: 2 })
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time++)
  const { selectBrowserGenerationBudget } = await import('./budget.js')
  expect(() => selectBrowserGenerationBudget({ widthMm: 24000, heightMm: 18000, quality: 'standard', surfaceRecipe: 1 })).toThrow('标准容量')
})
