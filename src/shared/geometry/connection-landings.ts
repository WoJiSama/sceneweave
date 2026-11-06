import type { PointMm } from '../model/scene.js'
import type { ProjectedConnection } from '../projection/types.js'
import { connectionBand } from './geometry.js'
import { connectionArcFrame } from './connection-route.js'

export type ConnectionLandingEnd = 'start' | 'end'

export interface ConnectionLandingBlend {
  surfaceId: string
  fromMm: PointMm
  toMm: PointMm
  depthMm: number
  polygonMm: PointMm[]
}

export function connectionLandingDepthMm(widthMm: number, routeLengthMm: number, maxDepthMm?: number): number {
  if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(routeLengthMm) || routeLengthMm <= 0) return 0
  const limit = maxDepthMm ?? Math.min(1200, Math.max(360, Math.round(widthMm * .72)))
  if (!Number.isSafeInteger(limit) || limit <= 0) return 0
  return Math.min(limit, routeLengthMm * .32)
}

/** A short world-space material fade follows the actual first/last route tangent. */
export function connectionLandingBlend(
  connection: Pick<ProjectedConnection, 'start' | 'end' | 'widthMm' | 'route' | 'surfaceIds'>,
  end: ConnectionLandingEnd,
  maxDepthMm?: number,
): ConnectionLandingBlend | null {
  const surfaceId = connection.surfaceIds?.[end === 'start' ? 0 : 1]
  if (!surfaceId || maxDepthMm !== undefined && (!Number.isSafeInteger(maxDepthMm) || maxDepthMm <= 0)) return null
  const savedPoints = connection.route?.centerlineMm ?? [connection.start, connection.end]
  const points = end === 'start' ? savedPoints : [...savedPoints].reverse()
  if (points.length < 2) return null
  const frame = connectionArcFrame(points)
  const depthMm = connectionLandingDepthMm(connection.widthMm, frame.length, maxDepthMm)
  if (!(depthMm > 0)) return null
  const stations = [0, ...frame.distances.filter(distance => distance > 0 && distance < depthMm), depthMm]
  const centerline = stations.map(distance => frame.at(distance))
  return { surfaceId, fromMm: frame.at(0), toMm: frame.at(depthMm), depthMm, polygonMm: connectionBand(centerline, connection.widthMm) }
}
