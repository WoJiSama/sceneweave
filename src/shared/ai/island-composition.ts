import type { ProjectData } from '../model/project.js'
import type { PointMm } from '../model/scene.js'
import { pointInPolygon } from '../geometry/geometry.js'
import { sampleVisualBoundary, signedVisualArea } from '../visual/geometry.js'
import { assertPublicSceneEntity } from './scene-authoring.js'
import type { VisualAuthoringOperation, VisualAuthoringScope } from './visual-protocol.js'

type BoundaryOperation = Extract<VisualAuthoringOperation, { kind: 'visualBoundary' }>
type ShapeWarning = 'few_source_anchors' | 'source_axis_symmetry' | 'source_has_no_concave_corner' | 'source_concavity_not_sampled' | 'large_sampled_outline_change'
const same = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const round = (value: number) => Math.round(value * 10_000) / 10_000
function distanceToSegment(point: PointMm, a: PointMm, b: PointMm): number {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy
  const fraction = squared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared)) : 0
  return Math.hypot(point.x - a.x - fraction * dx, point.y - a.y - fraction * dy)
}
function distanceToRing(point: PointMm, ring: readonly PointMm[]): number {
  return Math.min(...ring.map((a, index) => distanceToSegment(point, a, ring[(index + 1) % ring.length])))
}
function corners(points: readonly PointMm[]) {
  const orientation = Math.sign(signedVisualArea(points))
  let concave = 0, convex = 0
  for (const [index, point] of points.entries()) {
    const previous = points[(index + points.length - 1) % points.length], next = points[(index + 1) % points.length]
    const turn = orientation * ((point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x))
    if (turn > 1e-7) convex++
    else if (turn < -1e-7) concave++
  }
  return { concave, convex }
}

/**
 * Bounded measurements of one already-authorised real ring and its ordinary
 * curve candidate. No other terrain, support or private dependency is read.
 * This does not generate a layout, validate adoption or judge visual quality.
 */
export function inspectIslandBoundaryProposal(project: ProjectData, scope: VisualAuthoringScope, allowed: ReadonlySet<string>, operation: BoundaryOperation) {
  const refuse = (): never => { throw new Error('形状诊断只接受明确授权公开地形的完整真实锚点候选。') }
  if (!scope.operations.includes('visualBoundary') || !operation.closed || operation.binding.kind !== 'terrain' || operation.binding.sides.length !== 1) refuse()
  const side = operation.binding.kind === 'terrain' ? operation.binding.sides[0] : refuse()
  if (!allowed.has(side.areaId) || side.startPointId !== side.endPointId || side.reverse) refuse()
  assertPublicSceneEntity(project, scope, side.areaId)
  const area = project.document.terrainAreas[side.areaId]
  if (!area || area.boundaryMm.length < 3 || area.boundaryMm.length > 16) refuse()
  const first = area.boundaryMm.findIndex(point => point.id === side.startPointId)
  if (first < 0) refuse()
  const points = [...area.boundaryMm.slice(first), ...area.boundaryMm.slice(0, first)].map(point => point.positionMm)
  if (operation.segments.length !== points.length || operation.segments.some((segment, index) => !same(segment.start, points[index]) || !same(segment.end, points[(index + 1) % points.length]))) refuse()
  const sampled = sampleVisualBoundary(operation).points
  if (sampled.some(point => point.x < scope.boundsMm.x || point.y < scope.boundsMm.y || point.x > scope.boundsMm.x + scope.boundsMm.width || point.y > scope.boundsMm.y + scope.boundsMm.height)) refuse()
  const xs = points.map(point => point.x), ys = points.map(point => point.y)
  const sumX = Math.min(...xs) + Math.max(...xs), sumY = Math.min(...ys) + Math.max(...ys)
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const mismatch = (reflect: (point: PointMm) => PointMm) => round(Math.max(...points.map(point => distanceToRing(reflect(point), points))) / diagonal)
  // These are explicitly axis-aligned geometric measurements, not a general
  // symmetry classifier or a measure of whether a coastline looks natural.
  const sourceAxisMismatchRatio = { leftRight: mismatch(point => ({ x: sumX - point.x, y: point.y })),
    topBottom: mismatch(point => ({ x: point.x, y: sumY - point.y })), halfTurn: mismatch(point => ({ x: sumX - point.x, y: sumY - point.y })) }
  const sourceCorners = corners(points), candidateCorners = corners(sampled)
  const sourceEdges = points.map((point, index) => Math.hypot(point.x - points[(index + 1) % points.length].x, point.y - points[(index + 1) % points.length].y))
  let maxOutwardMm = 0, maxInwardMm = 0
  for (const point of sampled) {
    const distance = distanceToRing(point, points)
    if (pointInPolygon(point, points)) maxInwardMm = Math.max(maxInwardMm, distance)
    else maxOutwardMm = Math.max(maxOutwardMm, distance)
  }
  const warnings: ShapeWarning[] = []
  if (points.length < 6) warnings.push('few_source_anchors')
  if (Object.values(sourceAxisMismatchRatio).every(value => value <= .01)) warnings.push('source_axis_symmetry')
  if (!sourceCorners.concave) warnings.push('source_has_no_concave_corner')
  else if (!candidateCorners.concave) warnings.push('source_concavity_not_sampled')
  if (Math.max(maxOutwardMm, maxInwardMm) > Math.min(...sourceEdges) / 4) warnings.push('large_sampled_outline_change')
  return { sourceAnchorCount: points.length, sourceCorners, candidateSampleCount: sampled.length, candidateCorners,
    sourceAxisMismatchRatio, sourceEdgeLengthMm: { minimum: Math.round(Math.min(...sourceEdges)), maximum: Math.round(Math.max(...sourceEdges)) },
    sampledOutlineChangeMm: { maxOutward: Math.ceil(maxOutwardMm), maxInward: Math.ceil(maxInwardMm) },
    candidateToSourceAreaRatio: round(Math.abs(signedVisualArea(sampled)) / Math.abs(signedVisualArea(points))), anchorsPreserved: true,
    warnings, appearance: 'unconfirmed',
    basis: 'Measurements of this authorised real source ring and the fixed integer-mm candidate samples only. Symmetry ratios use the source bounding-box axes. No aesthetic, cliff exposure, support or passage verdict.',
    guidance: 'Smoothing retains the real anchors; it cannot invent an asymmetric bay or headland. If requested, explicitly revise only authorised source anchors before requesting a new proposal. Keep supports and connection approaches intact; review the ordinary full-ledger preview before adoption.' }
}
