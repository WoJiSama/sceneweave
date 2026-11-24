/** Creation form limits. The project factory validates its own input. */
export const BLANK_SCENE_LIMITS = { minSideMm: 1000, maxSideMm: 200000, maxAspectRatio: 20, maxTitleLength: 120 } as const
export const BLANK_PRESETS = [
  { id: 'investigation', name: '调查', description: '米制显示，默认隐藏格线', gridSizeMm: 1000, snapMm: 100, gridVisible: false, display: 'm', distanceMode: 'metric' },
  { id: 'tactical', name: '战术', description: '英尺显示，默认显示 1524 mm 方格', gridSizeMm: 1524, snapMm: 254, gridVisible: true, display: 'ft', distanceMode: 'grid' },
  { id: 'narrative', name: '叙事', description: '抽象距离偏好，保留毫米坐标和可选量尺', gridSizeMm: 1000, snapMm: 100, gridVisible: false, display: 'm', distanceMode: 'abstract' },
] as const
export type BlankPreset = typeof BLANK_PRESETS[number]['id']
export function validateBlankForm(title: string, widthMm: number, heightMm: number) {
  const { maxTitleLength, minSideMm, maxSideMm, maxAspectRatio } = BLANK_SCENE_LIMITS
  if (!title.trim()) throw new Error('请填写场景名称。')
  if (title.length > maxTitleLength) throw new Error('场景名称最多 120 个字符。')
  if (!Number.isSafeInteger(widthMm) || !Number.isSafeInteger(heightMm)) throw new Error('画布尺寸必须是整数毫米。')
  const shortest = Math.min(widthMm, heightMm), longest = Math.max(widthMm, heightMm)
  if (shortest < minSideMm || longest > maxSideMm) throw new Error('画布每边须为 1–200 米。')
  if (longest / shortest > maxAspectRatio) throw new Error('画布长宽比最多为 20:1。')
}
