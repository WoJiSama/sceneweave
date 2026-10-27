import type { AppearanceGraph, CompositionContent, PropAppearanceSnapshot } from '../model/appearance.js'
import type { BoundsMm, PointMm, Prop, SceneDocument, ShadowStyle, VersionRef } from '../model/scene.js'
import type { FixedPresentation } from '../terrain-generation/contracts.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { pointInPolygon } from '../geometry/geometry.js'
import { assertSimpleVisualPolyline } from '../visual/geometry.js'

/** Disposable paint inputs; fixed-source identity and orientation metadata stay in the GM graph. */
export type PaintPresentation = Pick<FixedPresentation, 'mode' | 'rootAnchorMm' | 'groundShadowMm'>
export const topDownPresentation = (): FixedPresentation => ({ mode: 'topDown', rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround', groundShadowMm: null })
export function presentationSourceId(snapshot: PropAppearanceSnapshot, parentSourceId: string | null, presentation: FixedPresentation): string {
  return `presentation-source-${sha256Text(canonicalJson({ domain: 'sceneweave-fixed-presentation', version: 1, kind: 'prop', parentSourceId, snapshot, presentation }))}`
}
export function propPresentation(graph: AppearanceGraph, propId: string): FixedPresentation | undefined {
  return graph.version === 2 ? graph.presentations?.[graph.propSources[propId]] : undefined
}
/** Only the fixed definition's exact default snapshot grants new placement semantics. */
export function definitionPresentation(graph: AppearanceGraph, ref: VersionRef | null): FixedPresentation | undefined {
  if (!ref || graph.version !== 2) return undefined
  const values = Object.values(graph.sources).filter(source => source.kind === 'prop' && source.parentSourceId === null && source.snapshot.definitionRef?.id === ref.id && source.snapshot.definitionRef.version === ref.version)
    .flatMap(source => graph.presentations?.[source.id]?.mode === 'nearSide' ? [graph.presentations[source.id]] : [])
  if (values.some(value => canonicalJson(value) !== canonicalJson(values[0]))) throw new Error('固定物件定义存在冲突的近侧视表现。')
  return values[0]
}
export function presentationBounds(prop: Pick<Prop, 'visualBoundsMm'>, presentation?: PaintPresentation): BoundsMm {
  const bounds = prop.visualBoundsMm
  return presentation?.mode === 'nearSide' ? { ...bounds, x: bounds.x - presentation.rootAnchorMm.x, y: bounds.y - presentation.rootAnchorMm.y } : { ...bounds }
}
export function propPaintPolygon(prop: Prop, presentation?: PaintPresentation): PointMm[] {
  const bounds = presentationBounds(prop, presentation), angle = (presentation?.mode === 'nearSide' ? 0 : prop.rotationDeg) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  return [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height]]
    .map(([x, y]) => ({ x: prop.positionMm.x + x * c - y * s, y: prop.positionMm.y + x * s + y * c }))
}
/** Ground-shadow source coordinates point along +x; lighting rotates this footprint in world space. */
export function presentationShadow(prop: Prop, presentation: PaintPresentation, directionDeg: number, offsetMm = 0): PointMm[] {
  const angle = directionDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  const offsetX = c * offsetMm, offsetY = s * offsetMm
  return (presentation.groundShadowMm ?? []).map(({ x, y }) => ({ x: prop.positionMm.x + x * c - y * s + offsetX, y: prop.positionMm.y + x * s + y * c + offsetY }))
}
/** Root contact shadow uses the physical footprint, without changing it. */
export function presentationContact(prop: Pick<Prop, 'positionMm' | 'footprintMm'>, presentation?: PaintPresentation): PointMm[] {
  if (presentation?.mode !== 'nearSide') return []
  const left = prop.positionMm.x - prop.footprintMm.width / 2, top = prop.positionMm.y - prop.footprintMm.height / 2
  return [{ x: left, y: top }, { x: left + prop.footprintMm.width, y: top }, { x: left + prop.footprintMm.width, y: top + prop.footprintMm.height }, { x: left, y: top + prop.footprintMm.height }]
}
/** Full near-side paint envelope shared by crop planning, local buffers, and player-mask checks. */
export function nearSidePaintEnvelope(
  prop: Prop,
  presentation: PaintPresentation | undefined,
  shadow: Pick<ShadowStyle, 'directionDeg' | 'offsetMm' | 'blurMm' | 'opacity'> | null | undefined,
  lightDirectionDeg?: number,
  contactShadowBlurMm: number | null = null,
): BoundsMm | null {
  if (presentation?.mode !== 'nearSide') return null
  const points = propPaintPolygon(prop, presentation)
  if (shadow?.opacity && presentation.groundShadowMm?.length) {
    points.push(...presentationShadow(prop, presentation, propShadowDirection(prop, shadow, lightDirectionDeg), shadow.offsetMm))
  }
  // The offset is a real paint displacement. Include it in the conservative
  // crop/mask envelope as well as the blurred footprint, since a directional
  // shadow can move outside the source polygon on either axis.
  const shadowPadding = shadow?.opacity && presentation.groundShadowMm?.length ? shadow.blurMm * 4 + Math.abs(shadow.offsetMm) : 0
  const boundsOf = (values: PointMm[], padding = 0): BoundsMm => {
    const x = Math.min(...values.map(value => value.x)) - padding, y = Math.min(...values.map(value => value.y)) - padding
    return { x, y, width: Math.max(...values.map(value => value.x)) - x + padding, height: Math.max(...values.map(value => value.y)) - y + padding }
  }
  const painted = boundsOf(points, shadowPadding)
  if (contactShadowBlurMm === null) return painted
  const contact = presentationContact(prop, presentation)
  if (!contact.length) return painted
  const padding = Math.max(0, contactShadowBlurMm) * 4, root = boundsOf(contact, padding)
  const x = Math.min(painted.x, root.x), y = Math.min(painted.y, root.y), right = Math.max(painted.x + painted.width, root.x + root.width), bottom = Math.max(painted.y + painted.height, root.y + root.height)
  return { x, y, width: right - x, height: bottom - y }
}
/**
 * Near-side artwork has a deliberately restrained default shadow. A null
 * instance override means "use the fixed presentation default" here; it does
 * not inherit the heavier top-down vegetation theme. Explicit overrides still
 * win, and `none` remains shadowless.
 */
export function effectivePropShadow(prop: Pick<Prop, 'shadowClass' | 'shadowOverride'>, presentation?: PaintPresentation, themed?: ShadowStyle | null): ShadowStyle | null {
  if (presentation?.mode === 'nearSide') {
    if (prop.shadowOverride) return prop.shadowOverride
    if (prop.shadowClass === 'none') return null
    return { directionDeg: 50, offsetMm: 150, blurMm: 48, opacity: .12, color: '#32493F' }
  }
  return prop.shadowOverride ?? themed ?? null
}
export function propShadowDirection(prop: Pick<Prop, 'shadowOverride'>, shadow: Pick<ShadowStyle, 'directionDeg'> | null | undefined, lightDirectionDeg?: number): number {
  return prop.shadowOverride?.directionDeg ?? lightDirectionDeg ?? shadow?.directionDeg ?? 50
}
export function validatePresentations(graph: AppearanceGraph, document: SceneDocument): void {
  if (graph.version !== 2) return
  for (const [id, presentation] of Object.entries(graph.presentations ?? {})) {
    const source = graph.sources[id]
    if (source?.kind !== 'prop') throw new Error('表现只能引用固定物件外观源。')
    if (presentation.mode === 'topDown') {
      if (presentation.rootAnchorMm.x || presentation.rootAnchorMm.y || presentation.groundShadowMm !== null) throw new Error('旧俯视表现必须保持零根锚及原alpha阴影语义。')
      continue
    }
    const snapshot = source.snapshot, bounds = snapshot.visualBoundsMm
    if (snapshot.appearance.kind !== 'image' || !snapshot.definitionRef) throw new Error('近侧视表现须绑定真实图片与固定物件定义。')
    if (id !== presentationSourceId(snapshot, source.parentSourceId, presentation)) throw new Error('近侧视固定源身份与表现内容不一致。')
    if (presentation.rootAnchorMm.x < bounds.x || presentation.rootAnchorMm.x > bounds.x + bounds.width || presentation.rootAnchorMm.y < bounds.y || presentation.rootAnchorMm.y > bounds.y + bounds.height) throw new Error('树根锚点必须位于固定图像范围内。')
    const ring = presentation.groundShadowMm
    if (ring) assertSimpleVisualPolyline(ring, true)
    if (ring && (!pointInPolygon({ x: 0, y: 0 }, ring) || ring.some(point => Math.abs(point.x) > 30000 || Math.abs(point.y) > 30000))) throw new Error('近侧视地面影须为包含树根且有界的合法多边形。')
  }
  for (const source of Object.values(graph.sources)) if (source.kind === 'prop' && !graph.presentations?.[source.id]) throw new Error('固定物件外观源缺少明确表现。')
  for (const prop of Object.values(document.props)) if (propPresentation(graph, prop.id)?.mode === 'nearSide') {
    if (prop.rotationDeg !== 0 || prop.footprintOffsetMm.x !== 0 || prop.footprintOffsetMm.y !== 0) throw new Error('近侧视物件须保持零旋转和以树根为中心的世界轴占地。')
  }
}
export function visiblePresentations(content: Pick<CompositionContent, 'appearance'>, ids: readonly string[]): Record<string, FixedPresentation> {
  return Object.fromEntries(ids.flatMap(id => { const value = propPresentation(content.appearance, id); return value?.mode === 'nearSide' ? [[id, cloneJson(value)]] : [] }))
}

// Disposable inspector hints, issued after complete composition validation.
// These never certify a document or skip any source/resource validation.
const sceneViews = new WeakMap<SceneDocument, Record<string, FixedPresentation>>()
export function associateScenePresentations(scene: SceneDocument, graph: AppearanceGraph): void {
  sceneViews.set(scene, visiblePresentations({ appearance: graph }, Object.keys(scene.props)))
}
export function scenePresentation(scene: SceneDocument, id: string): FixedPresentation | undefined { return sceneViews.get(scene)?.[id] }
export function copyScenePresentations(source: SceneDocument, target: SceneDocument): void {
  const entries = sceneViews.get(source); if (entries) sceneViews.set(target, cloneJson(entries))
}
export function comparePresentationDepth(scene: SceneDocument, a: Prop, b: Prop): number {
  return scenePresentation(scene, a.id)?.mode === 'nearSide' && scenePresentation(scene, b.id)?.mode === 'nearSide' ? a.positionMm.y - b.positionMm.y : 0
}
