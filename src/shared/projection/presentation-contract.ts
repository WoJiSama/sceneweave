import type { BoundsMm, PointMm, Prop, ShadowStyle } from '../model/scene.js'
import type { PaintPresentation } from '../appearance/presentation.js'
import { effectivePropShadow, nearSidePaintEnvelope, propPaintPolygon, presentationContact } from '../appearance/presentation.js'
import { decorationPaintBounds } from '../decorations/presentation.js'
import { edgeLookPaintPadding } from '../visual/paint-envelopes.js'
import { terrainTransitionStrokePolygon } from '../visual/transition.js'
import type { Audience, ProjectedDecoration, ProjectedVisualSystem, Projection } from './types.js'

export type PresentationKind = 'prop' | 'decoration' | 'edgeLook' | 'materializedEdge' | 'transition'
export interface PresentationEnvelope {
  readonly kind: PresentationKind
  readonly id: string
  readonly audience: Audience
  readonly stage: 'surface-detail' | 'ground-sprite' | 'object-sprite'
  readonly boundsMm: BoundsMm
  /** Projected IDs only. These are paint dependencies, never source authority. */
  readonly dependencies: readonly string[]
  readonly assetIds: readonly string[]
  readonly occlusion: 'audience-scene'
  readonly contact: 'physical-footprint' | 'source-alpha' | 'none'
  readonly output: { readonly png: 'paint'; readonly uvtt: 'baked' }
}
export const presentationCapabilities = {
  prop: { geometry: 'fixed-image-and-shadow', dependencies: 'audience-scene', png: 'paint', uvtt: 'baked' },
  decoration: { geometry: 'fixed-image', dependencies: 'audience-scene', png: 'paint', uvtt: 'baked' },
  edgeLook: { geometry: 'sampled-boundary', dependencies: 'audience-scene', png: 'paint', uvtt: 'baked' },
  materializedEdge: { geometry: 'saved-polygons-and-strokes', dependencies: 'audience-scene', png: 'paint', uvtt: 'baked' },
  transition: { geometry: 'saved-polygons-and-strokes', dependencies: 'audience-scene', png: 'paint', uvtt: 'baked' },
} as const satisfies Record<PresentationKind, { geometry: string; dependencies: 'audience-scene'; png: 'paint'; uvtt: 'baked' }>

export function presentationBounds(points: readonly PointMm[], padding = 0): BoundsMm | null {
  if (!points.length) return null
  let left = Infinity, top = Infinity, maximumX = -Infinity, maximumY = -Infinity
  for (const point of points) { left = Math.min(left, point.x); top = Math.min(top, point.y); maximumX = Math.max(maximumX, point.x); maximumY = Math.max(maximumY, point.y) }
  const x = left - padding, y = top - padding, right = maximumX + padding, bottom = maximumY + padding
  if (![x, y, right, bottom].every(Number.isFinite) || padding < 0) throw new Error('表现绘制范围无效。')
  return { x, y, width: right - x, height: bottom - y }
}
export const presentationOverlaps = (a: BoundsMm, b: BoundsMm): boolean => a.x + a.width >= b.x && a.x <= b.x + b.width && a.y + a.height >= b.y && a.y <= b.y + b.height
const inflate = (bounds: BoundsMm, padding: number): BoundsMm => ({ x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 })
function envelope(projection: Projection, kind: PresentationKind, id: string, boundsMm: BoundsMm, dependencies: readonly string[], assetIds: readonly string[], layer?: Prop['renderLayer'], contact: PresentationEnvelope['contact'] = 'none'): PresentationEnvelope {
  return { kind, id, audience: projection.audience, stage: layer ? layer === 'ground' ? 'ground-sprite' : 'object-sprite' : 'surface-detail',
    boundsMm, dependencies: [...dependencies], assetIds: [...assetIds], occlusion: 'audience-scene', contact,
    output: { png: presentationCapabilities[kind].png, uvtt: presentationCapabilities[kind].uvtt } }
}
/** Same conservative shadow/contact envelope for player masking and rendering.
 * Source visibility is filtered before this function; it grants no privacy proof. */
export function propPaintEnvelope(prop: Prop, presentation: PaintPresentation | undefined, shadow: ShadowStyle | null,
  environment: { lightDirectionDeg?: number; contactShadowOpacity: number; contactShadowMm: number } | undefined,
  options: { full?: boolean; outlinePaddingMm?: number } = {}): BoundsMm {
  const full = options.full !== false
  const contactBlur = full && presentation?.mode === 'nearSide' && shadow && environment?.contactShadowOpacity ? environment.contactShadowMm : null
  const near = nearSidePaintEnvelope(prop, presentation, full ? shadow : null, environment?.lightDirectionDeg, contactBlur)
  const padding = Math.max(full && shadow?.opacity ? Math.abs(shadow.offsetMm) + shadow.blurMm * 4 : 0,
    environment?.contactShadowOpacity && prop.renderLayer !== 'ground' ? environment.contactShadowMm * 4 : 0,
    options.outlinePaddingMm ?? 0)
  return near ? inflate(near, options.outlinePaddingMm ?? 0) : presentationBounds([...propPaintPolygon(prop, presentation), ...presentationContact(prop, presentation)], padding)!
}
export function propPresentationEnvelope(projection: Projection, prop: Prop, options: { full?: boolean; outlinePaddingMm?: number } = {}): PresentationEnvelope {
  const presentation = projection.propPresentations?.[prop.id], shadow = effectivePropShadow(prop, presentation, projection.theme?.shadowPresets[prop.shadowClass])
  const bounds = propPaintEnvelope(prop, presentation, shadow, projection.visual?.environment, options)
  const contact = !projection.visual?.environment.contactShadowOpacity ? 'none'
    : presentation?.mode === 'nearSide' ? options.full !== false && shadow ? 'physical-footprint' : 'none'
      : prop.renderLayer !== 'ground' && prop.shadowClass !== 'none' ? 'source-alpha' : 'none'
  return envelope(projection, 'prop', prop.id, bounds, [], prop.appearance.kind === 'image' ? [prop.appearance.assetId] : [], prop.renderLayer, contact)
}
export function decorationPresentationEnvelope(projection: Projection, decoration: ProjectedDecoration): PresentationEnvelope {
  return envelope(projection, 'decoration', decoration.id, decorationPaintBounds(decoration), [], [decoration.assetId], decoration.renderLayer)
}
/** Continuous paint forms share one finite envelope/resource/audience contract.
 * Keep full visible occluders, contacts and boundary support facts when culling. */
export function surfacePresentationEnvelopes(projection: Projection): PresentationEnvelope[] {
  const visual = projection.visual
  if (!visual) return []
  const boundaries = new Map(visual.boundaries.map(boundary => [boundary.id, boundary]))
  const result: PresentationEnvelope[] = []
  for (const look of visual.edgeLooks) {
    const boundary = boundaries.get(look.boundaryId)
    if (!boundary) throw new Error('边带表现缺少已过滤的边界。')
    const bounds = presentationBounds(boundary.points, edgeLookPaintPadding(look))
    if (bounds) result.push(envelope(projection, 'edgeLook', look.id, bounds, [look.boundaryId, ...boundary.terrainAreaIds], []))
  }
  const append = (kind: 'materializedEdge' | 'transition', id: string, bounds: BoundsMm | null, boundaryId?: string) => {
    if (boundaryId && !boundaries.has(boundaryId)) throw new Error('物化表现缺少已过滤的边界。')
    if (bounds) result.push(envelope(projection, kind, id, bounds, boundaryId ? [boundaryId] : [], []))
  }
  for (const edge of visual.materializedEdges ?? []) {
    // Native Canvas strokes use round joins and butt caps; these saved
    // polygons are rings, unlike transition polygon records.
    const points = edge.polygons.flat().concat(edge.strokes.flatMap(stroke => stroke.pointsMm))
    append('materializedEdge', edge.id, presentationBounds(points, Math.max(0, ...edge.strokes.map(stroke => stroke.widthMm / 2))), edge.boundaryId)
  }
  for (const transition of visual.transitions ?? []) {
    // Use the exact integer-mm square-cap/miter/bevel geometry consumed by the
    // painter. A centerline expanded by half-width misses diagonal cap corners.
    const points = transition.polygons.flatMap(polygon => polygon.pointsMm).concat(transition.strokes.flatMap(stroke => terrainTransitionStrokePolygon(stroke.pointsMm, stroke.widthMm)))
    append('transition', transition.id, presentationBounds(points), transition.boundaryId)
  }
  return result
}

export type ProjectionAssetConsumer =
  | { readonly kind: 'presentation'; readonly presentationKind: 'prop' | 'decoration'; readonly id: string; readonly assetIds: readonly string[] }
  | { readonly kind: 'always'; readonly id: string; readonly assetIds: readonly string[] }
export interface ProjectionAssetClosure { readonly complete: boolean; readonly consumers: readonly ProjectionAssetConsumer[] }

// These exhaustively registered modules are the resource-consumer boundary.
// A new projection module cannot silently inherit sprite-only decode behavior.
const projectionModules = {
  audience: true, floorId: true, sourceRevision: true, bounds: true, gridSizeMm: true, outputBackground: true, rooms: true, terrain: true, walls: true, props: true,
  decorations: true, spritePaintOrder: true, propPresentations: true, groundView: true, edges: true, paths: true, connections: true,
  pathJoinGroups: true, pathTerrainJoins: true, pathPaintOrder: true, openingPaintOrder: true, notes: true, regions: true, masks: true, regional: true,
  theme: true, materials: true, visual: true, assetIds: true, limitations: true, diagnostics: true,
} satisfies Record<keyof Projection, true>
const visualModules = {
  materializedEdges: true, edgePaintOrder: true, environment: true, boundsMm: true, boundaries: true, transitions: true, edgeLooks: true,
  lights: true, fogs: true, filters: true, occluderRings: true, contactRings: true, suppressedTerrainEdgeIds: true,
} satisfies Record<keyof ProjectedVisualSystem, true>
const regionalModules = { areas: true, lines: true, landmarks: true, symbols: true } satisfies Record<keyof NonNullable<Projection['regional']>, true>
const knownModules = (value: object, modules: object) => Object.keys(value).every(key => Object.hasOwn(modules, key))

/** Enumerate every current bitmap consumer, before viewport culling. Unknown
 * modules, unassigned resources or unregistered references make the closure
 * incomplete and require full decode. Being used by a sprite is not evidence
 * that an image is used exclusively by that sprite. */
export function projectionAssetConsumers(projection: Projection): ProjectionAssetClosure {
  if (!knownModules(projection, projectionModules) || projection.visual && !knownModules(projection.visual, visualModules)
    || projection.regional && !knownModules(projection.regional, regionalModules)) return { complete: false, consumers: [] }
  const consumers: ProjectionAssetConsumer[] = [], knownReferences = new Set<string>(), assigned = new Set<string>(), assets = new Set(projection.assetIds)
  const add = (consumer: ProjectionAssetConsumer, referencePaths: readonly (readonly string[])[]) => {
    consumers.push(consumer)
    for (const id of consumer.assetIds) assigned.add(id)
    for (const path of referencePaths) knownReferences.add(JSON.stringify(path))
  }
  for (const [index, prop] of projection.props.entries()) if (prop.appearance.kind === 'image') add({ kind: 'presentation', presentationKind: 'prop', id: prop.id, assetIds: [prop.appearance.assetId] }, [['props', String(index), 'appearance', 'assetId']])
  for (const [index, value] of (projection.decorations ?? []).entries()) add({ kind: 'presentation', presentationKind: 'decoration', id: value.id, assetIds: [value.assetId] }, [['decorations', String(index), 'assetId']])
  // Materials remain resident because surfaces are not culled. Their actual
  // paints still independently check exact material identity and version.
  for (const [id, material] of Object.entries(projection.materials)) add({ kind: 'always', id: `material:${id}`, assetIds: [material.textureAssetId] }, [['materials', id, 'textureAssetId']])
  const styles = [...projection.rooms.map(value => value.style), ...projection.terrain.map(value => value.style), ...projection.walls.map(value => value.style),
    ...projection.edges.map(value => value.surfaceStyle), ...projection.paths.map(value => value.style), ...projection.connections.map(value => value.style)]
  const paints = styles.flatMap(style => style ? [style.base, ...style.overlays.map(overlay => overlay.paint)] : [])
    .concat(projection.terrain.flatMap(value => (value.materialPatches ?? []).map(patch => patch.paint)))
  for (const paint of paints) {
    const material = projection.materials[paint.materialRef.id]
    if (!material || material.version !== paint.materialRef.version) throw new Error('区块绘制所需材质缺失或版本不符。')
  }
  for (const collection of ['landmarks', 'symbols'] as const) for (const [index, value] of (projection.regional?.[collection] ?? []).entries()) add({ kind: 'always', id: `regional:${collection}:${value.id}`, assetIds: [value.assetId] }, [['regional', collection, String(index), 'assetId']])
  if ([...assets].some(id => !assigned.has(id)) || [...assigned].some(id => !assets.has(id))) return { complete: false, consumers }
  // Detect an additional consumer reusing an already registered image under a
  // new nested field. Unknown reference names also fall back; they cannot hide
  // behind an image's simultaneous membership in the sprite collection.
  const visit = (value: unknown, path: string[]): boolean => {
    if (typeof value === 'string') return !assets.has(value) || path[0] === 'assetIds' || knownReferences.has(JSON.stringify(path))
    if (!value || typeof value !== 'object') return true
    return Object.entries(value).every(([key, child]) => visit(child, [...path, key]))
  }
  return { complete: visit(projection, []), consumers }
}
