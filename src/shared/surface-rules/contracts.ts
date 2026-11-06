import { z } from 'zod'
import { editable, id, int, paint, point, positive, visibility } from '../validation/primitives.js'

export type { SurfaceRule, SurfaceRuleBase, SurfaceRuleField, SurfaceRuleRegion } from '../model/scene.js'

export const SURFACE_RULE_LIMITS = Object.freeze({ rules: 128, regionsPerRule: 128, ringsPerRule: 128, pointsPerRing: 512, pointsPerRule: 8192, scenePoints: 32768 })
export const surfaceRuleRegionSchema = z.object({ outerMm: z.array(point).min(3).max(SURFACE_RULE_LIMITS.pointsPerRing),
  holesMm: z.array(z.array(point).min(3).max(SURFACE_RULE_LIMITS.pointsPerRing)).max(SURFACE_RULE_LIMITS.ringsPerRule - 1),
}).strict()
const base = { ...editable, visibility, supportRef: z.object({ kind: z.literal('terrainArea'), id }).strict(),
  paintOrder: positive,
  regionsMm: z.array(surfaceRuleRegionSchema).min(1).max(SURFACE_RULE_LIMITS.regionsPerRule).superRefine((regions, ctx) => {
    if (regions.reduce((sum, region) => sum + 1 + region.holesMm.length, 0) > SURFACE_RULE_LIMITS.ringsPerRule) ctx.addIssue({ code: 'custom', message: '地表规则的外环与孔洞总环数超过128。' })
    if (regions.reduce((sum, region) => sum + region.outerMm.length + region.holesMm.reduce((count, ring) => count + ring.length, 0), 0) > SURFACE_RULE_LIMITS.pointsPerRule) ctx.addIssue({ code: 'custom', message: '地表规则总顶点数超过8192。' })
  }),
}
const vegetation = { ...base, clusterId: id, coveragePpm: int.min(0).max(1_000_000) }
export const surfaceRuleSchema = z.discriminatedUnion('field', [
  z.object({ ...base, field: z.literal('material'), paint, blendWidthMm: int.min(0) }).strict(),
  z.object({ ...vegetation, field: z.literal('trees') }).strict(),
  z.object({ ...vegetation, field: z.literal('shrubs') }).strict(),
  z.object({ ...vegetation, field: z.literal('grass') }).strict(),
])
