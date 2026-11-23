import { z } from 'zod'

export const propVolumeKinds = ['flat', 'box', 'table', 'seat', 'round', 'rock', 'tree', 'tent', 'rail', 'lamp'] as const
export const propVolumeSchema = z.object({
  kind: z.enum(propVolumeKinds),
  heightMm: z.number().int().min(0).max(20_000),
}).strict().refine(volume => volume.kind === 'flat' ? volume.heightMm === 0 : volume.heightMm > 0, '立体形状需要明确的正高度。')
export type PropVolume = z.infer<typeof propVolumeSchema>
