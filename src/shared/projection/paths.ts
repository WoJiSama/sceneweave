import { cloneJson } from '../validation/json.js'
import { pathPolygon, polygonDistance } from '../geometry/geometry.js'
import type { PathAttachment } from '../path-attachments/contracts.js'
import { bridgeDeckGeometry } from '../path-assembly/layout.js'
import type { EdgeStyle, Path, PointMm } from '../model/scene.js'
import type { ProjectedDoorThreshold, ProjectedOpening, ProjectedPath, ProjectedWall, Projection } from './types.js'
import { projectRoutePaving } from './route-paving.js'
import { buildRoadSurface } from '../geometry/road-surface.js'
import { planStaircase } from '../stairs/geometry.js'

const fallbackPathEdge: EdgeStyle = { strokeWidthMm: 18, color: '#78745F', bandWidthMm: 100 }

export const pathEdgeStyle = (theme: Projection['theme']): EdgeStyle => cloneJson(theme?.edgeStyles.path ?? fallbackPathEdge)
/** Same finite decoration envelope as material-transition edges: half stroke + blur extent. */
export const pathDecorationPadding = (style: EdgeStyle): number => Math.max(style.bandWidthMm * 1.7, style.strokeWidthMm / 2)

/** Call only after audience/support filtering. No source, layer or generation metadata is retained. */
export function projectPath(path: Path, theme: Projection['theme'], masks: PointMm[][] = []): ProjectedPath {
  const result: ProjectedPath = { id: path.id, points: pathPolygon(path), style: cloneJson(path.surfaceStyle), edgeStyle: pathEdgeStyle(theme) }
  if (path.roadSurface) {
    result.gradedSurface = buildRoadSurface(path, path.roadSurface)
    if (path.roadFinish) result.roadFinish = path.roadFinish
    result.points = result.gradedSurface.coreMm
    if (path.staircase) result.gradedFinish = { preset: path.staircase.preset, material: path.staircase.material,
      covers: planStaircase(path.centerlineMm, path.widthMm, { ...path.staircase, layout: { kind: 'stretch', stepCount: 1 } }, path.widthSections).covers }
  } else if (path.automaticRoute && !path.assembly?.bridge) {
    result.groundBlendMm = Math.min(150, Math.round(Math.min(path.widthMm, ...(path.widthSections ?? []).map(row => row.widthMm)) / 9))
    const points = path.centerlineMm
    const first = path.widthSections?.find(row => row.startPpm === 0)?.widthMm ?? path.widthMm
    const last = path.widthSections?.find(row => row.endPpm === 1_000_000)?.widthMm ?? path.widthMm
    result.groundBlendEnds = ([[points[0], points[1], first], [points.at(-1)!, points.at(-2)!, last]] as const).map(([point, next, widthMm]) => {
      const dx = next.x - point.x, dy = next.y - point.y, length = Math.hypot(dx, dy)
      return { point: { ...point }, inward: { x: dx / length, y: dy / length }, widthMm }
    })
  } else if (path.boundaryBlendMm && !path.assembly?.bridge && !path.staircase) {
    const minimumWidth = Math.min(path.widthMm, ...(path.widthSections ?? []).map(row => row.widthMm))
    result.groundBlendMm = Math.min(path.boundaryBlendMm, Math.floor(minimumWidth / 5))
  }
  if (result.style?.base.alignment === 'route') result.paving = projectRoutePaving(path, result.style.base)
  if (path.staircase && !path.roadSurface) result.stairs = { centerlineMm: cloneJson(path.centerlineMm), widthMm: path.widthMm,
    ...(path.widthSections ? { widthSections: cloneJson(path.widthSections) } : {}), config: cloneJson(path.staircase) }
  const assembly = path.assembly
  if (assembly?.bridge) {
    const { structure, shoulderMm } = assembly.recipe
    const { outline, landings } = bridgeDeckGeometry(path, shoulderMm, structure?.bridgehead)
    const relief = structure ? structure.relief : { depthMm: Math.min(460, Math.max(200, path.widthMm * .20)), shadowOpacity: .24 }
    // A source covered by a player mask cannot reveal its silhouette outside that mask.
    const visibleRelief = relief && !masks.some(mask => polygonDistance(outline, mask) < 1e-6) ? relief : undefined
    result.bridge = { outline, centerlineMm: cloneJson(path.centerlineMm), widthMm: path.widthMm, finish: assembly.bridge.finish,
      ...(visibleRelief && { relief: { ...visibleRelief, elevationMm: assembly.bridge.elevationMm, ribSpacingMm: structure?.support.spacingMm ?? 2000 } }),
      ...(structure && { structure: { palette: structure.palette, landings: landings.map(({ side, outline }) => ({ side, outline })) } }) }
  }
  return result
}

/** The checked binding leaves the physical cap just outside the wall.
 * Extend the wearing surface across the hole to the inner wall face. */
export function projectDoorThreshold(path: ProjectedPath, binding: PathAttachment, wall: ProjectedWall,
  opening: ProjectedOpening, playerMasks: PointMm[][]): ProjectedDoorThreshold | undefined {
  const { outwardNormal: n } = binding.anchor
  const center = { x: (opening.start.x + opening.end.x) / 2, y: (opening.start.y + opening.end.y) / 2 }
  const depth = (p: PointMm) => (p.x - center.x) * n.x + (p.y - center.y) * n.y
  const station = (p: PointMm) => (p.y - center.y) * n.x - (p.x - center.x) * n.y
  const outer = Math.ceil(wall.thicknessMm / 2) + 1
  const restsAtOpening = (p: PointMm) => Math.abs(depth(p) - outer) < 1e-6 && Math.abs(station(p)) <= opening.widthMm / 2 + 1e-6
  for (const [i, a] of path.points.entries()) {
    const b = path.points[(i + 1) % path.points.length]
    if (!restsAtOpening(a) || !restsAtOpening(b) || Math.abs(station(a) + station(b)) > 1e-6) continue
    const inset = outer + wall.thicknessMm / 2 + 2
    const inward = (p: PointMm) => ({ x: p.x - n.x * inset, y: p.y - n.y * inset })
    const inside: [PointMm, PointMm] = [inward(a), inward(b)]
    if (playerMasks.some(mask => polygonDistance([a, b, inside[1], inside[0]], mask) < 1e-6)) return
    return { end: binding.end, cap: [a, b], inside }
  }
}

/** Half the centerline arc length stays on the actual path, including concave bends. */
export function pathAnchorPosition(path: Path): PointMm {
  const lengths = path.centerlineMm.slice(1).map((b, i) => Math.hypot(b.x - path.centerlineMm[i].x, b.y - path.centerlineMm[i].y))
  let remaining = lengths.reduce((total, length) => total + length, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const a = path.centerlineMm[i], b = path.centerlineMm[i + 1], t = lengths[i] ? remaining / lengths[i] : 0
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    remaining -= lengths[i]
  }
  return { ...path.centerlineMm.at(-1)! }
}
