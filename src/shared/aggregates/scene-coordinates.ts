import type { AggregateCoordinates, AggregateFrame } from '../model/aggregate.js'
import { AGGREGATE_ENTITY_COLLECTIONS } from '../model/aggregate.js'
import type { ProjectData } from '../model/project.js'
import type { MaterialPaint, PointMm, SceneDocument, SurfaceStyle } from '../model/scene.js'
import { captureJson, canonicalJson, cloneJson, equalOwnedJson } from '../validation/json.js'
import { aggregateCoordinatesSchema } from './schema.js'
import { aggregateWorldFrames, validateAggregateCoordinates } from './state.js'
import { localToWorldBounds, localToWorldPoint, worldToLocalBounds, worldToLocalPoint } from './coordinates.js'

/** Reversible storage representation, not an edit operation or a validation certificate.
 * Owned coordinates and headings become frame-relative. World-aligned paint,
 * physical extents, immutable sources and generation provenance keep their
 * world/definition semantics. Existing consumers receive a full world view.
 */
function convert(scene: SceneDocument, to: 'world' | 'local'): SceneDocument {
  const state = scene.aggregateCoordinates
  if (!state) return scene
  const checked = aggregateCoordinatesSchema.safeParse(state)
  if (!checked.success) throw new Error(`聚合坐标字段无效：${checked.error.issues.map(issue => issue.message).join('；')}`)
  if (checked.data.encoding === to) throw new Error(`聚合坐标表示须从${to === 'world' ? 'local' : 'world'}转换；拒绝重复或歧义编码。`)
  const inputState: AggregateCoordinates = checked.data
  // Ownership is geometry-independent; validate it before dereferencing fields.
  const errors = validateAggregateCoordinates({ ...scene, aggregateCoordinates: { ...inputState, encoding: 'world' } })
  if (errors.length) throw new Error(errors.map(issue => issue.message).join('；'))
  const frames = aggregateWorldFrames(inputState)
  const transform = to === 'world' ? localToWorldPoint : worldToLocalPoint
  const transformBounds = to === 'world' ? localToWorldBounds : worldToLocalBounds
  const rotation = (value: number, frame: AggregateFrame) => {
    const degrees = frame.quarterTurns * 90
    const transformed = to === 'world' ? value + degrees : value - degrees
    return ((transformed % 360) + 360) % 360
  }
  const points = (frame: AggregateFrame, values: PointMm[]) => values.map(point => transform(frame, point))
  const paint = (frame: AggregateFrame, value: MaterialPaint) => {
    if (value.alignment === 'surface') {
      value.originMm = transform(frame, value.originMm)
      value.rotationDeg = rotation(value.rotationDeg, frame)
    }
  }
  const style = (frame: AggregateFrame, value: SurfaceStyle | null) => {
    if (!value) return
    paint(frame, value.base)
    for (const overlay of value.overlays) { overlay.boundaryMm = points(frame, overlay.boundaryMm); paint(frame, overlay.paint) }
  }
  for (const group of Object.values(inputState.groups)) {
    const frame = frames.get(group.id)!
    for (const ref of group.members) {
      switch (ref.kind) {
        case 'vertex': {
          const row = scene.vertices[ref.id], point = transform(frame, { x: row.xMm, y: row.yMm })
          row.xMm = point.x; row.yMm = point.y; break
        }
        case 'prop': { const row = scene.props[ref.id]; row.positionMm = transform(frame, row.positionMm); row.rotationDeg = rotation(row.rotationDeg, frame); break }
        case 'region': { const row = scene.regions[ref.id]; row.boundaryMm = points(frame, row.boundaryMm); break }
        case 'note': { const row = scene.notes[ref.id]; if (row.anchor.type === 'point') row.anchor.positionMm = transform(frame, row.anchor.positionMm); break }
        case 'room': style(frame, scene.rooms[ref.id].floorStyle); break
        case 'wall': style(frame, scene.walls[ref.id].topStyle); break
        case 'opening': break // Stable wall endpoint and along-wall distance, never a point.
        case 'terrainArea': {
          const row = scene.terrainAreas[ref.id]
          for (const point of row.boundaryMm) point.positionMm = transform(frame, point.positionMm)
          style(frame, row.surfaceStyle); break
        }
        case 'terrainEdge': style(frame, scene.terrainEdges[ref.id].surfaceStyle); break
        case 'terrainConnection': {
          const row = scene.terrainConnections[ref.id]
          row.from.positionMm = transform(frame, row.from.positionMm); row.to.positionMm = transform(frame, row.to.positionMm)
          if (row.route) {
            for (const segment of row.route.segments) for (const key of ['start', 'control1', 'control2', 'end'] as const) segment[key] = transform(frame, segment[key])
            row.route.centerlineMm = points(frame, row.route.centerlineMm)
          }
          style(frame, row.surfaceStyle); break
        }
        case 'path': { const row = scene.paths[ref.id]; row.centerlineMm = points(frame, row.centerlineMm); style(frame, row.surfaceStyle); break }
        case 'prefabInstance': { const row = scene.prefabInstances[ref.id]; row.anchorMm = transform(frame, row.anchorMm); row.rotationDeg = rotation(row.rotationDeg, frame); break }
        case 'scatterGroup': {
          const row = scene.scatterGroups[ref.id]; row.gridOriginMm = transform(frame, row.gridOriginMm)
          for (const exclusion of row.exclusions) exclusion.boundaryMm = points(frame, exclusion.boundaryMm)
          break
        }
        case 'decoration': { const row = scene.decorations[ref.id]; row.positionMm = transform(frame, row.positionMm); row.rotationDeg = rotation(row.rotationDeg, frame); break }
        case 'decorationCluster': {
          const row = scene.decorationClusters[ref.id]; row.boundsMm = transformBounds(frame, row.boundsMm)
          if (row.canopyRule) row.canopyRule.regionsMm = row.canopyRule.regionsMm.map(ring => points(frame, ring))
          break
        }
        case 'surfaceRule': {
          const row = scene.surfaceRules[ref.id]
          for (const region of row.regionsMm) { region.outerMm = points(frame, region.outerMm); region.holesMm = region.holesMm.map(ring => points(frame, ring)) }
          if (row.field === 'material') paint(frame, row.paint)
          break
        }
      }
    }
  }
  // The visual layer is a separate world-space source, not a second copy of
  // member geometry. Its controls, source ancestry, Floor/global path checks,
  // fixed definitions and AI provenance remain explicitly world referenced.
  scene.aggregateCoordinates = { encoding: to, groups: inputState.groups }
  return scene
}

/** Input must be a fully validated world view at an owning I/O/hash boundary. */
export function encodeSceneCoordinates(scene: SceneDocument): SceneDocument {
  return convert(captureJson(scene), 'local')
}
/** Strict JSON capture precedes traversal; callers then perform full domain validation. */
export function decodeSceneCoordinates(input: unknown): SceneDocument {
  const scene = captureJson(input) as SceneDocument
  return convert(scene, 'world')
}
export function encodeProjectCoordinates(project: ProjectData): ProjectData {
  const result = captureJson(project)
  result.document = convert(result.document, 'local')
  return result
}
export function decodeProjectCoordinates(project: ProjectData): ProjectData {
  const result = captureJson(project)
  result.document = convert(result.document, 'world')
  return result
}
/** Canonical project bytes use the sole at-rest coordinate representation. */
export function canonicalProjectCoordinates(project: ProjectData): string {
  // canonicalJson owns the strict input inspection. Keeping a second walk here
  // doubled the safety traversal for every content/hash/accounting call while
  // adding no protection: coordinate conversion itself captures and validates
  // its input, and canonicalJson rechecks the final representation.
  // Peek only through data descriptors before the owning JSON boundary. A
  // caller accessor at any of these levels must never execute to select a path.
  const data = (value: unknown, key: string): unknown => value !== null && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
  const coordinates = data(data(project, 'document'), 'aggregateCoordinates')
  return canonicalJson(!coordinates || data(coordinates, 'encoding') === 'local' ? project : encodeProjectCoordinates(project))
}
/** Domain validators use this after strict parsing, before issuing a certificate. */
export function assertCoordinateRoundTrip(scene: SceneDocument): void {
  if (!scene.aggregateCoordinates) return
  // Own the complete source before transforming it. Both conversions still
  // execute, and equality covers every field, array order and integer value.
  // The intermediate local object is private, so decoding can consume it
  // directly rather than capturing another complete copy or sorting two trees.
  const source = captureJson(scene), restored = convert(convert(cloneJson(source), 'local'), 'world')
  if (!equalOwnedJson(restored, source)) throw new Error('聚合坐标往返改变了完整场景；事务未采用。')
}
/** A coordinate owner table for diagnostics; does not authorize transforms. */
export function aggregateMemberOwners(scene: SceneDocument): Map<string, string> {
  const owners = new Map<string, string>()
  for (const group of Object.values(scene.aggregateCoordinates?.groups ?? {})) for (const ref of group.members) owners.set(`${AGGREGATE_ENTITY_COLLECTIONS[ref.kind]}:${ref.id}`, group.id)
  return owners
}
