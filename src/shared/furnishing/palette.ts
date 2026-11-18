import { z } from 'zod'
import type { PropDefinition } from '../model/scene.js'
import { FURNITURE_CATEGORIES, FURNITURE_STYLES, furnitureKey, type FurnitureEra } from '../assets/furniture-collection.js'
import { roomFurnishingRequestSchema } from './contracts.js'
import type { SceneDocument } from '../model/scene.js'

/** Discovery and explicit user choices, never a persisted rendering rule. */
export const furnishingPaletteSchema = z.object({
  source: z.enum(['current', 'inn', 'collection']), era: z.enum(['all', 'medieval', 'fantasy', '1920s']),
  styleId: z.string().max(80), allowMixed: z.boolean(),
}).strict().superRefine((value, ctx) => {
  const style = FURNITURE_STYLES.find(row => row.id === value.styleId)
  if (value.styleId !== 'all' && value.styleId !== 'gray-oak' && !style) ctx.addIssue({ code: 'custom', message: '请选择已知风格。' })
  if (value.source === 'collection' && !style) ctx.addIssue({ code: 'custom', message: '请选择一个配套家具风格。' })
  if (value.source === 'inn' && (value.styleId !== 'gray-oak' || value.era !== 'medieval')) ctx.addIssue({ code: 'custom', message: '灰橡来源须明确选择中世纪灰橡风格。' })
  if (style && value.era !== 'all' && style.era !== value.era || value.styleId === 'gray-oak' && !['all', 'medieval'].includes(value.era)) ctx.addIssue({ code: 'custom', message: '年代与风格不一致。' })
})
export type FurnishingPalette = z.infer<typeof furnishingPaletteSchema>
/** Session configuration only. Styles do not become persistent rendering rules. */
export const styledRoomFurnishingSchema = z.object({ request: roomFurnishingRequestSchema, palette: furnishingPaletteSchema }).strict()
export const buildingFurnishingSchema = z.array(styledRoomFurnishingSchema).min(1).max(64)
  .refine(rows => new Set(rows.map(row => row.request.roomId)).size === rows.length, '同一房间只能有一份布置设置。')
export type StyledRoomFurnishing = z.infer<typeof styledRoomFurnishingSchema>
export const currentFurnishingPalette = (): FurnishingPalette => ({ source: 'current', era: 'all', styleId: 'all', allowMixed: false })
type FurnishingStyle = { era: FurnitureEra | null; styleId: string | null; name: string }
// Only the finite built-in catalog is indexed; mutable caller definitions and
// returned discovery objects never become cache keys or shared values.
const fixedFurnitureStyles = new Map<string, Readonly<FurnishingStyle>>(FURNITURE_STYLES.flatMap(style =>
  FURNITURE_CATEGORIES.map(category => [`prop.sceneweave.furniture-collection.${furnitureKey(category.id, style.id)}`,
    { era: style.era, styleId: style.id, name: style.name }] as const)))
export function furnishingStyle(definition: PropDefinition): { era: FurnitureEra | null; styleId: string | null; name: string } {
  if (definition.version === 1) {
    const style = fixedFurnitureStyles.get(definition.catalogId)
    if (style) return { ...style }
    if (definition.catalogId.startsWith('sceneweave.inn-function.prop.')) return { era: 'medieval', styleId: 'gray-oak', name: '灰橡旅舍' }
  }
  const eras = (['medieval', 'fantasy', '1920s'] as const).filter(era => definition.tags.includes(era))
  return { era: eras.length === 1 ? eras[0] : null, styleId: null, name: '风格未标注' }
}
export function furnishingPaletteMatches(definition: PropDefinition, palette: FurnishingPalette): boolean {
  const style = furnishingStyle(definition)
  return (palette.era === 'all' || style.era === palette.era) && (palette.styleId === 'all' || style.styleId === palette.styleId)
}
export function furnishingPaletteLabel(palette: FurnishingPalette): string {
  return palette.styleId === 'gray-oak' ? '灰橡旅舍' : FURNITURE_STYLES.find(row => row.id === palette.styleId)?.name ?? '当前工程自由选材'
}
export function assertFurnishingPalette(document: SceneDocument, row: StyledRoomFurnishing): void {
  for (const fn of row.request.functions) {
    const definition = document.propDefinitions[fn.definitionRef.id]
    if (!definition || definition.version !== fn.definitionRef.version) throw new Error('请选择实际存在的固定素材及版本。')
    if (fn.count && !furnishingPaletteMatches(definition, row.palette) && !row.palette.allowMixed) throw new Error('所选素材跨风格或未标注；请明确确认混搭，或重新选择匹配素材。')
  }
}
