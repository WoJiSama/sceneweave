import { cloneJson } from '../validation/json.js'
import { pathPolygon } from '../geometry/geometry.js'
import type { EdgeStyle, Path, PointMm } from '../model/scene.js'
import type { ProjectedPath, Projection } from './types.js'

const fallbackPathEdge: EdgeStyle = { strokeWidthMm: 18, color: '#78745F', bandWidthMm: 100 }

export const pathEdgeStyle = (theme: Projection['theme']): EdgeStyle => cloneJson(theme?.edgeStyles.path ?? fallbackPathEdge)
/** Same finite decoration envelope as material-transition edges: half stroke + blur extent. */
export const pathDecorationPadding = (style: EdgeStyle): number => Math.max(style.bandWidthMm * 1.7, style.strokeWidthMm / 2)

/** Call only after audience/support filtering. No source, layer or generation metadata is retained. */
export function projectPath(path: Path, theme: Projection['theme']): ProjectedPath {
  return { id: path.id, points: pathPolygon(path), style: cloneJson(path.surfaceStyle), edgeStyle: pathEdgeStyle(theme) }
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
