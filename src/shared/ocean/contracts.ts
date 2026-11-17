import { z } from 'zod'

const unit = z.number().finite().min(0).max(1)
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
/** Static appearance only. Water never grants swimming, buoyancy or a second support plane. */
export const waterSurfaceSchema = z.object({
  version: z.literal(1), color, highlightColor: color, clarity: unit,
  waveSpacingMm: z.number().int().min(600).max(20000),
  waveDirectionDeg: z.number().finite().min(0).lt(360), waveStrength: unit,
  seed: z.string().min(1).max(128),
}).strict()
export type WaterSurface = z.infer<typeof waterSurfaceSchema>
const surfaceEffects = z.object({ ripples: unit, wakeLengthMm: z.number().int().min(0).max(10000) }).strict().optional()
export const waterAppearanceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('surface'), surfaceEffects }).strict(),
  z.object({ mode: z.literal('submerged'), depth: unit }).strict(),
  z.object({ mode: z.literal('partial'), depth: unit, submergedFraction: z.number().finite().min(.05).max(.95), surfaceEffects }).strict(),
])
export type WaterAppearance = z.infer<typeof waterAppearanceSchema>
export const OCEAN_LIMITS = Object.freeze({ cellsPerSurface: 4096, cellsPerScene: 16384 })
export const WATER_PRESETS = Object.freeze({
  calm: { version: 1, color: '#437F8B', highlightColor: '#DAEBDE', clarity: .72, waveSpacingMm: 2400, waveDirectionDeg: 12, waveStrength: .35, seed: 'ocean-calm-v1' },
  shallow: { version: 1, color: '#78B3AC', highlightColor: '#EFF2D6', clarity: .9, waveSpacingMm: 2800, waveDirectionDeg: 12, waveStrength: .22, seed: 'ocean-shallow-v1' },
  rough: { version: 1, color: '#315F74', highlightColor: '#D7E3DA', clarity: .4, waveSpacingMm: 1700, waveDirectionDeg: 22, waveStrength: .7, seed: 'ocean-rough-v1' },
} satisfies Record<string, WaterSurface>)
