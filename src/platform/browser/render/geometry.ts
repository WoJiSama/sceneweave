import type { BoundsMm, PointMm, Prop } from '../../../shared/model/scene.js'
const point = (x: number, y: number): PointMm => ({ x, y })
export const pointsBounds = (points: PointMm[]): BoundsMm => ({ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) })
export function transformedVisualBounds(prop: Prop): BoundsMm {
  const v = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return pointsBounds([[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].map(([x, y]) => point(prop.positionMm.x + x * c - y * s, prop.positionMm.y + x * s + y * c)))
}
