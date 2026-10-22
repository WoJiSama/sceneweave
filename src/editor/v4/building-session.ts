import type { BoundsMm, PointMm } from '../../core/v3/types'

export type BuildingSketch = { kind: 'rectangle' | 'polygon' | 'ruler'; points: PointMm[]; cursor: PointMm | null }
export type CanvasWorldTool = BuildingSketch & { snapMm: number; onPoint: (point: PointMm) => void; onMove: (point: PointMm) => void; onCancel: () => void; onFinish?: () => void }

export function snapBuildingPoint(point: PointMm, snapMm: number): PointMm {
  const snap = (value: number) => {
    const result = Math.round(Math.abs(value) / snapMm) * snapMm
    return result === 0 ? 0 : value < 0 ? -result : result
  }
  if (!Number.isSafeInteger(snapMm) || snapMm < 1) throw new Error('吸附步长须为正整数毫米。')
  return { x: snap(point.x), y: snap(point.y) }
}
export function rectangleFromPoints(a: PointMm, b: PointMm): BoundsMm {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}
export function rectanglePoints(b: BoundsMm): PointMm[] {
  return [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
}
export function parseBoundary(text: string): PointMm[] {
  const rows = text.trim().split(/\n|;/).filter(row => row.trim())
  if (rows.length < 3 || rows.length > 128) throw new Error('多边形须有 3–128 个顶点。')
  return rows.map((row, index) => {
    const values = row.trim().split(/[,，\s]+/).map(Number)
    if (values.length !== 2 || values.some(value => !Number.isSafeInteger(value))) throw new Error(`第 ${index + 1} 行须为两个整数毫米坐标。`)
    return { x: values[0], y: values[1] }
  })
}
export function rulerDistance(a: PointMm, b: PointMm): { distanceMm: number; dxMm: number; dyMm: number } {
  const dxMm = b.x - a.x, dyMm = b.y - a.y
  return { distanceMm: Math.hypot(dxMm, dyMm), dxMm, dyMm }
}
