import { z } from 'zod'
import type { Wall } from './scene.js'

export const wallHeightSchema = z.number().int().min(1).max(20_000)
export const openingHeightSchema = z.strictObject({
  sillMm: z.number().int().min(0).max(20_000),
  heightMm: wallHeightSchema,
})
export type OpeningHeight = z.infer<typeof openingHeightSchema>

export function spatialWallHeight(wall: Pick<Wall, 'thicknessMm' | 'heightMm'>): number {
  return wall.heightMm ?? Math.max(1050, Math.min(2000, wall.thicknessMm * 5.5))
}
