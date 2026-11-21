import { z } from 'zod'

export const staircasePresetIds = ['cut-stone', 'rough-stone', 'carved-rock', 'stepping-stones', 'flagstone', 'brick', 'concrete', 'timber', 'boardwalk', 'metal-grate'] as const
export const staircaseMaterialIds = ['limestone', 'sandstone', 'granite', 'basalt', 'slate', 'terracotta', 'concrete', 'oak', 'weathered-wood', 'iron'] as const
const coverPoint = z.object({ x: z.number().int().min(0).max(1_000_000), y: z.number().int().min(-500_000).max(500_000) }).strict()
/** Local coordinates: x is distance along the complete route, y is lateral
 * fraction of its width. Covers follow edits and never delete the stair. */
export const staircaseCoverSchema = z.object({ id: z.string().min(1).max(256),
  kind: z.enum(['reveal-ground', 'earth', 'grass', 'rock']), pointsPpm: z.array(coverPoint).min(3).max(64),
}).strict()
export const staircaseSchema = z.object({ algorithm: z.literal('staircase1'),
  preset: z.enum(staircasePresetIds), material: z.enum(staircaseMaterialIds),
  layout: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('repeat'), treadDepthMm: z.number().int().min(50).max(2000) }).strict(),
    z.object({ kind: z.literal('stretch'), stepCount: z.number().int().min(1).max(512) }).strict(),
  ]),
  range: z.object({
    startPpm: z.number().int().min(0).max(999_999),
    endPpm: z.number().int().min(1).max(1_000_000),
  }).strict().refine(range => range.startPpm < range.endPpm, '铺阶终点须在起点之后。').optional(),
  textureScaleMm: z.number().int().min(50).max(4000),
  covers: z.array(staircaseCoverSchema).max(32).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, '覆盖标识不能重复'),
}).strict()
export type StaircaseConfig = z.infer<typeof staircaseSchema>
export type StaircaseCover = z.infer<typeof staircaseCoverSchema>
export type StaircasePresetId = typeof staircasePresetIds[number]
export type StaircaseMaterialId = typeof staircaseMaterialIds[number]
export const defaultStaircase = (): StaircaseConfig => ({ algorithm: 'staircase1', preset: 'cut-stone', material: 'limestone',
  layout: { kind: 'repeat', treadDepthMm: 300 }, textureScaleMm: 350, covers: [] })
