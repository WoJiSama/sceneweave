import { definitionPresentation, propPresentation, propPaintPolygon, presentationBounds } from '../appearance/presentation.js'
import { decorationPaintPolygon } from '../decorations/presentation.js'
import type { ProjectData } from '../model/project.js'
import type { PointMm, BoundsMm } from '../model/scene.js'

/** Exact disposable paint geometry, independent of Scene WeakMap hints. */
export function currentAuthoringPaint(project: ProjectData, id: string) {
  const prop = project.document.props[id]
  if (prop) {
    const presentation = propPresentation(project.appearance, id)
    return { visualBoundsMm: presentationBounds(prop, presentation), polygonMm: propPaintPolygon(prop, presentation), presentation: presentation ?? null }
  }
  const decoration = project.document.decorations?.[id]
  if (!decoration) return null
  const definition = project.document.propDefinitions[decoration.definitionRef.id], presentation = definitionPresentation(project.appearance, decoration.definitionRef)
  if (!definition || definition.version !== decoration.definitionRef.version) throw new Error('固定装饰定义与实际画面不一致。')
  const scale = decoration.scalePpm / 1_000_000, bounds = definition.defaultVisualBoundsMm, root = presentation?.mode === 'nearSide' ? presentation.rootAnchorMm : { x: 0, y: 0 }
  const visualBoundsMm = { x: (bounds.x - root.x) * scale, y: (bounds.y - root.y) * scale, width: bounds.width * scale, height: bounds.height * scale }
  return { visualBoundsMm, polygonMm: decorationPaintPolygon({ positionMm: decoration.positionMm, rotationDeg: presentation?.mode === 'nearSide' ? 0 : decoration.rotationDeg, visualBoundsMm }), presentation: presentation ?? null }
}
export function currentPaintWorldBounds(points: readonly PointMm[]): BoundsMm {
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y))
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }
}
export function currentPublicPaintRow(project: ProjectData, row: Record<string, unknown> & { id: string }): Record<string, unknown> {
  const paint = currentAuthoringPaint(project, row.id)
  return !paint ? row : { ...row, ...(row.visualBoundsMm ? { sourceVisualBoundsMm: row.visualBoundsMm } : {}),
    visualBoundsMm: paint.visualBoundsMm, paintPolygonMm: paint.polygonMm, paintBoundsMm: currentPaintWorldBounds(paint.polygonMm), fixedPresentation: paint.presentation }
}
