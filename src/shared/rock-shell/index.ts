export { ROCK_SHELL_LIMITS, rockShellSchema } from './contracts.js'
export type { RockShell, RockShellHost, RockShellPoint, RockShellSection, RockShellFace, CreateRockShellIntent,
  RockShellIssue, RockShellSample, RockShellTriangle } from './contracts.js'
export { generateRockShell, estimateRockShellCost, inspectRockShell, createRockShellSampler, sampleRockShell,
  rockShellPhysicalFootprint } from './kernel.js'
export { createRockShellPaintPlan } from './paint.js'
export type { RockShellPaintPlan, RockShellPaintOptions } from './paint.js'
