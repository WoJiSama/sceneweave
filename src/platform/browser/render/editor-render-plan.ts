import { effectivePropShadow, propPaintPolygon } from '../../../shared/appearance/presentation.js'
import type { BoundsMm, Prop } from '../../../shared/model/scene.js'
import { transformedVisualBounds } from './geometry'
import { decorationPresentationEnvelope, propPresentationEnvelope, presentationOverlaps, surfacePresentationEnvelopes, type PresentationEnvelope } from '../../../shared/projection/presentation-contract.js'
import type { Projection, ProjectedDecoration } from '../../../shared/projection/types.js'
import { pathDecorationPadding } from '../../../shared/projection/paths.js'
import { edgeLookPaintPadding, transitionStrokePaintPadding } from '../../../shared/visual/paint-envelopes.js'

export type EditorPropDetail = 'outline' | 'image' | 'full'
export interface EditorPropPlan {
  prop: Prop
  detail: EditorPropDetail
  screenSizePx: number
  visualBoundsMm: BoundsMm
  paintBoundsMm: BoundsMm
}
export interface EditorRenderPlan {
  boundsMm: BoundsMm
  props: EditorPropPlan[]
  decorations: ProjectedDecoration[]
  surfacePresentations: PresentationEnvelope[]
  /** Actual retained paint entries; resource residency consumes their asset IDs. */
  presentations: PresentationEnvelope[]
  omittedDecorationCount: number
  omittedPropCount: number
  detailCounts: Record<EditorPropDetail, number>
}
export interface EditorRenderPlanOptions {
  viewBoundsMm?: BoundsMm
  screenScalePxPerMm: number
}
export const EDITOR_OUTLINE_THRESHOLD_PX = 12
export const EDITOR_FULL_THRESHOLD_PX = 40

const finiteBounds = (b: BoundsMm) => [b.x, b.y, b.width, b.height, b.x + b.width, b.y + b.height].every(Number.isFinite) && b.width > 0 && b.height > 0

/** Bounded caller-side raster allocation still applies after this world padding. */
export function editorPaintBounds(projection: Projection, plan: Pick<EditorRenderPlan, 'boundsMm' | 'props'>): BoundsMm {
  let padding = 0
  const shadowPadding = (shadow: { opacity: number; offsetMm: number; blurMm: number } | undefined | null) => shadow?.opacity ? shadow.offsetMm + shadow.blurMm * 4 : 0
  const theme = projection.theme
  padding = Math.max(padding, shadowPadding(theme?.shadowPresets.wall), theme?.outline.widthMm ?? 24)
  if (theme?.terrainCliff.opacity) padding = Math.max(padding, theme.terrainCliff.maxOffsetMm + theme.terrainCliff.blurMm * 4)
  for (const entry of plan.props) if (entry.detail === 'full') padding = Math.max(padding, shadowPadding(effectivePropShadow(entry.prop, projection.propPresentations?.[entry.prop.id], theme?.shadowPresets[entry.prop.shadowClass])))
  const styles = [...projection.terrain.map(area => area.style), ...projection.rooms.map(room => room.style), ...projection.walls.map(wall => wall.style), ...projection.edges.map(edge => edge.surfaceStyle), ...projection.connections.map(connection => connection.style), ...projection.paths.map(path => path.style)]
  for (const style of styles) for (const overlay of style?.overlays ?? []) padding = Math.max(padding, overlay.blendWidthMm * 2)
  for (const area of projection.terrain) for (const patch of area.materialPatches ?? []) padding = Math.max(padding, patch.blendWidthMm * 2)
  for (const path of projection.paths) padding = Math.max(padding, pathDecorationPadding(path.edgeStyle))
  for (const edge of projection.edges) padding = Math.max(padding, edge.style.bandWidthMm * 2, edge.style.strokeWidthMm * 2)
  if (projection.edges.some(edge => edge.shoreline || edge.kind === 'shore')) {
    const shore = theme?.edgeStyles.shore ?? { bandWidthMm: 180, strokeWidthMm: 12 }
    padding = Math.max(padding, Math.min(shore.bandWidthMm, 180) * .65 + shore.strokeWidthMm / 2)
  }
  if (projection.visual) {
    const environment = projection.visual.environment
    padding = Math.max(padding, environment.contactShadowMm * 4)
    for (const look of projection.visual.edgeLooks) padding = Math.max(padding, edgeLookPaintPadding(look))
    for (const edge of projection.visual.materializedEdges ?? []) for (const stroke of edge.strokes) padding = Math.max(padding, stroke.widthMm / 2)
    for (const transition of projection.visual.transitions ?? []) for (const stroke of transition.strokes) padding = Math.max(padding, transitionStrokePaintPadding(stroke.widthMm))
    // Light polygons use the full audience-owned occluder closure. Radial
    // gradients/fog noise use fixed world coordinates and need no light buffer.
  }
  const full = projection.bounds, crop = plan.boundsMm
  const x = Math.max(full.x, crop.x - padding), y = Math.max(full.y, crop.y - padding)
  const right = Math.min(full.x + full.width, crop.x + crop.width + padding), bottom = Math.min(full.y + full.height, crop.y + crop.height + padding)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Disposable audience-isolated editor plan. The full document's validation, privacy
 * projection and resource closure must finish before this plan is used.
 * It does not change persisted props, picking geometry, PNG output or assetIds.
 */
export function createEditorRenderPlan(projection: Projection, options: EditorRenderPlanOptions): EditorRenderPlan {
  if (!Number.isFinite(options.screenScalePxPerMm) || options.screenScalePxPerMm <= 0) throw new Error('编辑视口比例必须为有限正数。')
  const requested = options.viewBoundsMm ?? projection.bounds
  if (!finiteBounds(requested)) throw new Error('编辑视口必须为有限正矩形。')
  const full = projection.bounds, x = Math.max(full.x, requested.x), y = Math.max(full.y, requested.y)
  const right = Math.min(full.x + full.width, requested.x + requested.width), bottom = Math.min(full.y + full.height, requested.y + requested.height)
  if (right <= x || bottom <= y) throw new Error('编辑视口必须与固定地图范围相交。')
  const boundsMm = { x, y, width: right - x, height: bottom - y }
  const detailCounts: Record<EditorPropDetail, number> = { outline: 0, image: 0, full: 0 }, props: EditorPropPlan[] = [], presentations: PresentationEnvelope[] = []
  for (const prop of projection.props) {
    const presentation = projection.propPresentations?.[prop.id]
    const corners = propPaintPolygon(prop, presentation)
    const minX = Math.min(...corners.map(p => p.x)), minY = Math.min(...corners.map(p => p.y))
    const visualBoundsMm = presentation ? { x: minX, y: minY, width: Math.max(...corners.map(p => p.x)) - minX, height: Math.max(...corners.map(p => p.y)) - minY } : transformedVisualBounds(prop)
    const screenSizePx = Math.max(visualBoundsMm.width, visualBoundsMm.height) * options.screenScalePxPerMm
    const detail: EditorPropDetail = screenSizePx < EDITOR_OUTLINE_THRESHOLD_PX ? 'outline' : screenSizePx < EDITOR_FULL_THRESHOLD_PX ? 'image' : 'full'
    const envelope = propPresentationEnvelope(projection, prop, { full: detail === 'full', outlinePaddingMm: detail === 'outline' ? .5 / options.screenScalePxPerMm : 0 }), paintBoundsMm = envelope.boundsMm
    if (!presentationOverlaps(paintBoundsMm, boundsMm)) continue
    detailCounts[detail]++; props.push({ prop, detail, screenSizePx, visualBoundsMm, paintBoundsMm }); presentations.push(envelope)
  }
  const decorations = (projection.decorations ?? []).filter(value => {
    const envelope = decorationPresentationEnvelope(projection, value)
    if (!presentationOverlaps(envelope.boundsMm, boundsMm)) return false
    presentations.push(envelope); return true
  })
  const surfacePresentations = surfacePresentationEnvelopes(projection).filter(value => presentationOverlaps(value.boundsMm, boundsMm))
  presentations.push(...surfacePresentations)
  return { boundsMm, props, decorations, surfacePresentations, presentations, omittedDecorationCount: (projection.decorations?.length ?? 0) - decorations.length, omittedPropCount: projection.props.length - props.length, detailCounts }
}
