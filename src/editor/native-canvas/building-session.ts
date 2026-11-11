import type { BoundsMm, PointMm, SurfaceRef } from '../../shared/model/scene.js'

export type BuildingSketch = { kind: 'rectangle' | 'polygon' | 'orthogonal' | 'ruler'; points: PointMm[]; cursor: PointMm | null }
export type CanvasWorldTool = Omit<BuildingSketch, 'kind'> & {
  kind: BuildingSketch['kind'] | 'polyline'
  label?: string
  snapMm: number
  road?: { floorId: string; widthMm: number; supportRefs: readonly SurfaceRef[]; visibility: 'public' | 'gm' }
  elevation?: { mode: 'elevate' | 'sample'; scopeMm?: PointMm[]; onStep: (direction: -1 | 1) => void }
  onPoint: (point: PointMm) => void
  onMove: (point: PointMm) => void
  onClearCursor?: () => void
  onCancel: () => void
  onFinish?: () => void
}

export function snapBuildingPoint(point: PointMm, snapMm: number): PointMm {
  const snap = (value: number) => {
    const result = Math.round(Math.abs(value) / snapMm) * snapMm
    return result === 0 ? 0 : value < 0 ? -result : result
  }
  if (!Number.isSafeInteger(snapMm) || snapMm < 1) throw new Error('吸附步长须为正整数毫米。')
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('吸附坐标须为有限毫米数值。')
  const result = { x: snap(point.x), y: snap(point.y) }
  if (!Number.isSafeInteger(result.x) || !Number.isSafeInteger(result.y)) throw new Error('吸附坐标超出安全整数毫米范围。')
  return result
}

/** Orthogonal drawing locks the next snapped point to the dominant world axis. */
export function normalizeSketchPoint(tool: Pick<CanvasWorldTool, 'kind' | 'points' | 'snapMm'>, point: PointMm): PointMm {
  const snapped = snapBuildingPoint(point, tool.snapMm), previous = tool.points.at(-1)
  if (tool.kind !== 'orthogonal' || !previous) return snapped
  if (!Number.isSafeInteger(previous.x) || !Number.isSafeInteger(previous.y)) throw new Error('正交基点须为安全整数毫米。')
  const absolute = (value: bigint) => value < 0n ? -value : value
  return absolute(BigInt(snapped.x) - BigInt(previous.x)) >= absolute(BigInt(snapped.y) - BigInt(previous.y))
    ? { x: snapped.x, y: previous.y } : { x: previous.x, y: snapped.y }
}

/** Close by turning perpendicular to the last drawn segment, then reaching the first point. */
export function finishOrthogonalBoundary(input: readonly PointMm[]): PointMm[] {
  const points = input.map(point => ({ ...point }))
  const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
  if (points.length > 1 && same(points[0], points.at(-1)!)) points.pop()
  if (points.length < 3 || points.length > 128) throw new Error('正交房间须有 3–128 个已绘顶点。')
  if (points.some(point => !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y))) throw new Error('正交顶点须为安全整数毫米。')
  const first = points[0], last = points.at(-1)!, previous = points.at(-2)!
  if (last.x !== first.x && last.y !== first.y) points.push(last.x === previous.x ? { x: first.x, y: last.y } : { x: last.x, y: first.y })
  if (new Set(points.map(point => `${point.x},${point.y}`)).size !== points.length) throw new Error('正交闭合产生重复顶点，请调整末段。')
  const on = (p: PointMm, a: PointMm, b: PointMm) => a.x === b.x
    ? p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
    : p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
  const meet = (a: PointMm, b: PointMm, c: PointMm, d: PointMm) => {
    if (on(a, c, d) || on(b, c, d) || on(c, a, b) || on(d, a, b)) return true
    if ((a.x === b.x) === (c.x === d.x)) return false
    const p = a.x === b.x ? { x: a.x, y: c.y } : { x: c.x, y: a.y }
    return on(p, a, b) && on(p, c, d)
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length]
    if (same(a, b) || a.x !== b.x && a.y !== b.y) throw new Error('正交房间每条边必须水平或垂直，且长度大于零。')
    const incomingX = BigInt(b.x) - BigInt(a.x), incomingY = BigInt(b.y) - BigInt(a.y)
    const outgoingX = BigInt(c.x) - BigInt(b.x), outgoingY = BigInt(c.y) - BigInt(b.y)
    if (incomingX * outgoingX + incomingY * outgoingY < 0n) throw new Error('正交边界不能折返。')
  }
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || i === 0 && j === points.length - 1) continue
    if (meet(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) throw new Error('正交闭合产生自交或自接触，请调整末段。')
  }
  const area = points.reduce((sum, point, i) => sum + BigInt(point.x) * BigInt(points[(i + 1) % points.length].y) - BigInt(points[(i + 1) % points.length].x) * BigInt(point.y), 0n)
  if (area === 0n) throw new Error('正交房间面积必须大于零。')
  return points
}

/** A gesture translates both original endpoints by one quantized integer delta. */
export function wallDragOffset(start: PointMm, current: PointMm, snapMm: number): PointMm {
  if (![start.x, start.y, current.x, current.y].every(Number.isSafeInteger)) throw new Error('拖边坐标须为安全整数毫米。')
  const delta = { x: current.x - start.x, y: current.y - start.y }
  if (!Number.isSafeInteger(delta.x) || !Number.isSafeInteger(delta.y)) throw new Error('拖边位移超出安全整数毫米范围。')
  return snapBuildingPoint(delta, snapMm)
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

export function formatDistanceMm(distanceMm: number, display: 'm' | 'ft'): string {
  return `${(distanceMm / (display === 'ft' ? 304.8 : 1000)).toFixed(3)} ${display}`
}
