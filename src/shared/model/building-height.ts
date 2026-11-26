import { z } from 'zod'
import type { Opening, Wall } from './scene.js'

export const wallHeightSchema = z.number().int().min(1).max(20_000)
export const openingHeightSchema = z.strictObject({
  sillMm: z.number().int().min(0).max(20_000),
  heightMm: wallHeightSchema,
})
export type OpeningHeight = z.infer<typeof openingHeightSchema>

export function spatialWallHeight(wall: Pick<Wall, 'thicknessMm' | 'heightMm'>): number {
  return wall.heightMm ?? Math.max(1050, Math.min(2000, wall.thicknessMm * 5.5))
}

export function defaultBuildingWallHeight(purposes: readonly string[]): number {
  const use = purposes.join(' ')
  if (/大厅|礼堂|神殿|仓库|\b(hall|temple|warehouse)\b/iu.test(use)) return 3600
  if (/酒馆|旅店|客栈|店铺|工坊|\b(tavern|inn|shop|workshop)\b/iu.test(use)) return 3100
  if (/小屋|营地|哨站|观测|\b(cabin|camp|outpost|observatory)\b/iu.test(use)) return 2500
  return 2800
}

export function defaultOpeningHeight(wall: Pick<Wall, 'thicknessMm' | 'heightMm'>, kind: Opening['kind']): OpeningHeight {
  const height = Math.floor(spatialWallHeight(wall))
  const sillMm = kind === 'window' ? Math.min(900, Math.floor(height * .54)) : 0
  const headMm = height >= 2300 ? 2100 : Math.max(sillMm + 1, Math.floor(height * (kind === 'window' ? .93 : .95)))
  return { sillMm, heightMm: headMm - sillMm }
}

export function spatialOpeningRange(opening: Pick<Opening, 'kind' | 'vertical'>, wallHeight: number): readonly [number, number] {
  if (opening.vertical) return [opening.vertical.sillMm, opening.vertical.sillMm + opening.vertical.heightMm]
  return opening.kind === 'window' ? [wallHeight * .54, wallHeight * .93] : [0, wallHeight * .95]
}
