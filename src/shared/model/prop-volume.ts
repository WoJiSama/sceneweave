import { z } from 'zod'

export const propVolumeKinds = ['flat', 'box', 'table', 'seat', 'round', 'rock', 'tree', 'tent', 'rail', 'lamp'] as const
export const propSideKinds: ReadonlySet<string> = new Set(['box', 'table', 'seat', 'round', 'tent', 'rail', 'lamp'])
export const propVolumeSchema = z.object({
  kind: z.enum(propVolumeKinds),
  heightMm: z.number().int().min(0).max(20_000),
  sideAssetId: z.string().min(1).max(256).refine(value => value !== '__proto__').optional(),
}).strict().refine(volume => volume.kind === 'flat' ? volume.heightMm === 0 : volume.heightMm > 0, '立体形状需要明确的正高度。')
  .refine(volume => !volume.sideAssetId || propSideKinds.has(volume.kind), '此立体形状没有可贴侧面图的部位。')
export type PropVolume = z.infer<typeof propVolumeSchema>
