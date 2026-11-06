import type { PointMm } from '../../shared/model/scene'
import { formatLengthInput } from '../native-canvas/length-input'
import { integerCoordinateRow } from './integer-coordinate-input'

export const pointText = (points: readonly PointMm[]) => points.map(point => `${point.x}, ${point.y}`).join('\n')

export function outdoorPoints(text: string, minimum = 3): PointMm[] {
  const rows = text.trim().split(/[;\n]/).filter(row => row.trim())
  if (rows.length < minimum || rows.length > 2048) throw new Error(`请输入 ${minimum}–2048 行整数毫米坐标，每行 x, y。`)
  return rows.map((row, index) => {
    const parts = integerCoordinateRow(row, 2)
    if (!parts) throw new Error(`第 ${index + 1} 行须为两个整数毫米坐标。`)
    return { x: parts[0], y: parts[1] }
  })
}

/** Describe the draft without changing its exact millimetre coordinates. */
export function outdoorCoordinateSummary(text: string, minimum: number, unit: 'm' | 'ft'): string {
  if (!text.trim()) return '尚未取点；可在画布绘制或展开输入坐标。'
  let points: PointMm[]
  try { points = outdoorPoints(text, 1) } catch { return '坐标待完善；展开精确坐标检查输入。' }
  if (points.length < minimum) return `已取 ${points.length} 个点，还需至少 ${minimum - points.length} 个点。`
  const x = points.map(point => point.x), y = points.map(point => point.y)
  const width = Math.max(...x) - Math.min(...x), height = Math.max(...y) - Math.min(...y)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return `${points.length} 个点；坐标范围将在预览时校验。`
  return `${points.length} 个点 · 范围 ${formatLengthInput(width, unit)} × ${formatLengthInput(height, unit)} ${unit}`
}
