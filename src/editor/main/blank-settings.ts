import { z } from 'zod'
import { inspectJsonInput } from '../../shared/validation/json'

/** Creation UI limits, independent of the existing v2 import/schema limits. */
export const BLANK_SCENE_LIMITS = { minSideMm: 1000, maxSideMm: 200000, maxAspectRatio: 20, maxTitleLength: 120 } as const
export const BLANK_PRESETS = [
  { id: 'investigation', name: '调查', description: '米制显示，默认隐藏格线', gridSizeMm: 1000, snapMm: 100, gridVisible: false, display: 'm', distanceMode: 'metric' },
  { id: 'tactical', name: '战术', description: '英尺显示，默认显示 1524 mm 方格', gridSizeMm: 1524, snapMm: 254, gridVisible: true, display: 'ft', distanceMode: 'grid' },
  { id: 'narrative', name: '叙事', description: '抽象距离偏好，保留毫米坐标和可选量尺', gridSizeMm: 1000, snapMm: 100, gridVisible: false, display: 'm', distanceMode: 'abstract' },
] as const
export type BlankPreset = typeof BLANK_PRESETS[number]['id']
export type BlankDocumentOptions = {
  title: string; widthMm: number; heightMm: number; preset: BlankPreset; gridVisible?: boolean; sceneId?: string; now?: string
}

const side = z.number().finite().refine(Number.isSafeInteger, '画布尺寸必须是整数毫米')
  .min(BLANK_SCENE_LIMITS.minSideMm, '画布每边至少为 1000 mm').max(BLANK_SCENE_LIMITS.maxSideMm, '画布每边最多为 200000 mm')
const creationOptions = z.object({
  title: z.string().trim().min(1, '请填写场景名称').max(BLANK_SCENE_LIMITS.maxTitleLength, '场景名称最多 120 个字符'),
  widthMm: side, heightMm: side, preset: z.enum(['investigation', 'tactical', 'narrative']), gridVisible: z.boolean().optional(),
  sceneId: z.string().min(1).max(256).refine(value => value !== '__proto__').optional(), now: z.string().datetime().optional(),
}).strict().refine(value => Math.max(value.widthMm, value.heightMm) / Math.min(value.widthMm, value.heightMm) <= BLANK_SCENE_LIMITS.maxAspectRatio,
  '画布长宽比最多为 20:1')

export function validateBlankOptions(options: BlankDocumentOptions) {
  const jsonIssue = inspectJsonInput(options)
  if (jsonIssue) throw new Error(`新建参数无效：${jsonIssue.message}`)
  const checked = creationOptions.safeParse(options)
  if (!checked.success) throw new Error(`新建参数无效：${checked.error.issues.map(issue => issue.message).join('；')}`)
  return checked.data
}
