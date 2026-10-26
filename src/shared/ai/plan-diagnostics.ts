import type { ProjectData } from '../model/project.js'
import type { BoundsMm, PointMm, Prop } from '../model/scene.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { corridor, coveredEverywhere, openingEndpoints, pointInPolygon, polygonInside, polygonsOverlap, propFootprint, roomPoints, supportSurfaceAt, terrainPoints } from '../geometry/geometry.js'
import type { AuthoringBrief, AuthoringEvidenceCheck } from './plan.js'

const rectangle = (bounds: BoundsMm): PointMm[] => [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }]
const cross = (a: PointMm, b: PointMm, p: PointMm) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
const polygonArea = (points: PointMm[]) => Math.abs(points.reduce((sum, p, index) => {
  const next = points[(index + 1) % points.length]; return sum + p.x * next.y - next.x * p.y
}, 0)) / 2
/** The persisted rotated visual rectangle, not the smaller collision footprint. */
export function authoringPropVisualPolygon(prop: Prop): PointMm[] {
  const angle = prop.rotationDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  return rectangle(prop.visualBoundsMm).map(p => ({ x: prop.positionMm.x + p.x * c - p.y * s, y: prop.positionMm.y + p.x * s + p.y * c }))
}
/** Exact convex clipping of the two rotated image rectangles, independent of raster size. */
function intersectionArea(subject: PointMm[], clip: PointMm[]): number {
  let output = subject
  for (let index = 0; index < clip.length && output.length; index++) {
    const a = clip[index], b = clip[(index + 1) % clip.length], input = output; output = []
    for (let vertex = 0; vertex < input.length; vertex++) {
      const p = input[vertex], q = input[(vertex + 1) % input.length], cp = cross(a, b, p), cq = cross(a, b, q)
      if (cp >= -1e-7) output.push(p)
      if (cp > 1e-7 && cq < -1e-7 || cp < -1e-7 && cq > 1e-7) {
        const t = cp / (cp - cq); output.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
      }
    }
  }
  return polygonArea(output)
}
const rounded = (value: number) => Math.round(value * 1000) / 1000
export function inspectVisualComposition(project: ProjectData, props: Prop[], allowedIds?: ReadonlySet<string>) {
  const scene = project.document
  const major = props.filter(prop => prop.blocksMovement || prop.renderLayer === 'canopy')
  const metrics = major.map(prop => {
    const support = prop.supportRef, inspectSupport = support.kind === 'floor' || !allowedIds || allowedIds.has(support.id)
    const room = inspectSupport && support.kind === 'room' ? scene.rooms[support.id] : null, terrain = inspectSupport && support.kind === 'terrainArea' ? scene.terrainAreas[support.id] : null
    const areaMm2 = prop.visualBoundsMm.width * prop.visualBoundsMm.height
    const floor = scene.floors[prop.floorId], supportAreaMm2 = room ? polygonArea(roomPoints(scene, room)) : terrain ? polygonArea(terrainPoints(terrain)) : floor.boundsMm.width * floor.boundsMm.height
    return { id: prop.id, widthMm: prop.visualBoundsMm.width, heightMm: prop.visualBoundsMm.height,
      areaM2: rounded(areaMm2 / 1_000_000), supportAreaRatio: inspectSupport ? rounded(areaMm2 / Math.max(1, supportAreaMm2)) : null }
  })
  const excessivePairs: { ids: string[]; overlapOfSmallerImage: number }[] = []
  for (let index = 0; index < major.length; index++) for (const other of major.slice(index + 1)) {
    const prop = major[index]
    if (prop.floorId !== other.floorId) continue
    const area = intersectionArea(authoringPropVisualPolygon(prop), authoringPropVisualPolygon(other))
    const ratio = area / Math.min(prop.visualBoundsMm.width * prop.visualBoundsMm.height, other.visualBoundsMm.width * other.visualBoundsMm.height)
    if (ratio > .35) excessivePairs.push({ ids: [prop.id, other.id], overlapOfSmallerImage: rounded(ratio) })
  }
  return { basis: 'authorized public image rectangles; decorative rugs and nonblocking tabletop details may intentionally overlap', majorCount: major.length,
    largestImages: metrics.sort((a, b) => b.areaM2 - a.areaM2).slice(0, 8),
    excessivePairs: excessivePairs.sort((a, b) => b.overlapOfSmallerImage - a.overlapOfSmallerImage).slice(0, 16),
    oversizedIds: metrics.filter(value => value.supportAreaRatio !== null && value.supportAreaRatio > .32).map(value => value.id).sort(),
    visualQuality: 'bounds diagnostics only; transparency and aesthetics still need a rendered image review' }
}

/** Finite review hints from only the explicitly granted public subset. No image or art approval is inferred. */
export function inspectCompositionRepairs(project: ProjectData, ids: ReadonlySet<string>, brief?: AuthoringBrief) {
  const scene = project.document, view = createPublicVisibility(scene)
  const props = Object.values(scene.props).filter(prop => ids.has(prop.id) && view.prop(prop)), major = props.filter(prop => prop.blocksMovement || prop.renderLayer === 'canopy')
  const rooms = Object.values(scene.rooms).filter(room => ids.has(room.id) && view.room(room.id))
  const terrain = Object.values(scene.terrainAreas).filter(area => ids.has(area.id) && view.terrainArea(area.id))
  const repeated = new Map<string, Prop[]>()
  for (const prop of major) {
    // A rotation is not a new source silhouette. Source changes remain explicit
    // fixed versions; image identity is preferable to a merely renamed definition.
    const key = `${prop.floorId}:${prop.appearance.kind === 'image' ? `image:${prop.appearance.assetId}` : `symbol:${prop.appearance.symbol}`}`
    const values = repeated.get(key) ?? []; values.push(prop); repeated.set(key, values)
  }
  const concentratedRepeatedShapes = [...repeated.values()].filter(values => values.length >= 4).map(values => {
    const xs = values.map(value => value.positionMm.x), ys = values.map(value => value.positionMm.y)
    const spanMm = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    const averageDiagonalMm = values.reduce((sum, value) => sum + Math.hypot(value.visualBoundsMm.width, value.visualBoundsMm.height), 0) / values.length
    return { ids: values.map(value => value.id).sort().slice(0, 8), count: values.length, concentrated: spanMm <= averageDiagonalMm * 4 }
  }).filter(value => value.concentrated).slice(0, 3)
  const publicScene = { ...scene, rooms: Object.fromEntries(rooms.map(value => [value.id, value])), terrainAreas: Object.fromEntries(terrain.map(value => [value.id, value])) }
  const groundExposure = [...rooms.map(value => ({ id: value.id, floorId: value.floorId, kind: 'room' as const, polygon: roomPoints(scene, value) })),
    ...terrain.filter(value => !value.blocksMovement).map(value => ({ id: value.id, floorId: value.floorId, kind: 'terrainArea' as const, polygon: terrainPoints(value) }))]
    .slice(0, 4).map(surface => {
      const xs = surface.polygon.map(point => point.x), ys = surface.polygon.map(point => point.y), left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top
      let supportedSamples = 0, coveredSamples = 0
      if (width > 0 && height > 0) for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
        const point = { x: left + width * (x + .5) / 13, y: top + height * (y + .5) / 13 }
        if (!pointInPolygon(point, surface.polygon)) continue
        if (surface.kind === 'terrainArea' && supportSurfaceAt(publicScene, point, surface.floorId)?.id !== surface.id) continue
        supportedSamples++
        if (major.some(prop => prop.floorId === surface.floorId && pointInPolygon(point, authoringPropVisualPolygon(prop)))) coveredSamples++
      }
      return { surfaceId: surface.id, supportedSamples, exposedSampleFraction: supportedSamples ? rounded(1 - coveredSamples / supportedSamples) : null }
    })
  const passageClearance: { kind: 'door' | 'stairs' | 'ramp'; id: string; widthMm: number; blockerIds: string[] }[] = []
  for (const opening of Object.values(scene.openings).filter(opening => ids.has(opening.id) && ids.has(opening.wallId) && !opening.secret && opening.kind === 'door')) {
    const wall = scene.walls[opening.wallId]
    const publicOwners = Object.values(scene.rooms).filter(room => room.boundaryVertexIds.includes(wall.startVertexId) && room.boundaryVertexIds.includes(wall.endVertexId)).every(room => view.room(room.id))
    if (!publicOwners) continue
    const band = corridor(...openingEndpoints(scene, opening), Math.max(1000, wall.thicknessMm))
    const blockerIds = props.filter(prop => prop.blocksMovement && prop.floorId === opening.floorId && polygonsOverlap(propFootprint(prop), band)).map(prop => prop.id).sort().slice(0, 8)
    if (blockerIds.length) passageClearance.push({ kind: 'door', id: opening.id, widthMm: opening.widthMm, blockerIds })
  }
  for (const connection of Object.values(scene.terrainConnections).filter(value => ids.has(value.id) && value.visibility === 'public'
    && (value.from.surfaceRef.kind === 'floor' || ids.has(value.from.surfaceRef.id)) && (value.to.surfaceRef.kind === 'floor' || ids.has(value.to.surfaceRef.id))
    && view.surface(value.from.surfaceRef) && view.surface(value.to.surfaceRef))) {
    const band = corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm)
    const blockerIds = props.filter(prop => prop.blocksMovement && prop.floorId === connection.floorId && polygonsOverlap(propFootprint(prop), band)).map(prop => prop.id).sort().slice(0, 8)
    if (blockerIds.length) passageClearance.push({ kind: connection.kind, id: connection.id, widthMm: connection.widthMm, blockerIds })
  }
  const suggestions: { code: string; ids: string[]; action: string }[] = []
  const composition = inspectVisualComposition(project, props, ids)
  if (composition.oversizedIds.length) suggestions.push({ code: 'major_image_dominates_support', ids: composition.oversizedIds.slice(0, 8),
    action: 'Read this fixed image size and support area before furnishing. Choose an actually smaller granted definition for a new object, or keep fewer majors; do not resize existing fixed art or widen an ungranted support.' })
  for (const pair of composition.excessivePairs.slice(0, 2)) suggestions.push({ code: 'major_image_overlap', ids: pair.ids,
    action: 'Probe one explicitly transform-granted independent object away from this image pair using whole-image clearance. Preserve fixed footprints, supports and ungranted members; only a new authorised furnishing candidate may add a replacement.' })
  for (const repeated of concentratedRepeatedShapes) suggestions.push({ code: 'concentrated_same_source_shape', ids: repeated.ids,
    action: 'Browse only the granted palette for actual distinct silhouettes; then use a furnishing candidate in the same explicit support, or probe an explicitly transform-granted independent prop. Rotation alone is not a new variant.' })
  for (const surface of groundExposure.filter(value => value.exposedSampleFraction !== null && value.exposedSampleFraction < .4)) suggestions.push({ code: 'low_sampled_ground_exposure', ids: [surface.surfaceId],
    action: 'Leave more of this public ground visible: probe fewer major objects outside explicit clear regions; do not resize fixed art or delete ungranted members. This image-rectangle estimate ignores transparent pixels.' })
  for (const passage of passageClearance.slice(0, 3)) suggestions.push({ code: 'blocked_passage_clearance', ids: [passage.id, ...passage.blockerIds],
    action: 'Keep the complete passage width and door approach clear. Move only an explicitly transform-granted independent blocker using the placement probe, or request a new grant; do not move the passage or alter physical footprints implicitly.' })
  for (const evidence of inspectBriefEvidence(project, ids, brief?.checks ?? []).filter(value => value.status === 'missing' && value.kind === 'roomRole').slice(0, 2)) suggestions.push({ code: 'room_role_furniture_missing', ids: evidence.evidenceIds.slice(0, 8),
    action: 'Read this roomRole evidence details for missing granted definitions/material; furnish the actual matching-purpose room using a checked candidate. Renaming a room or claiming completion cannot satisfy this requirement.' })
  return { concentratedRepeatedShapes, groundExposure, passageClearance: passageClearance.slice(0, 4), suggestions: suggestions.slice(0, 8),
    basis: 'bounded public authorized geometry and image rectangles only; exposure uses at most 13x13 deterministic samples per reported surface', appearance: 'unconfirmed' }
}

/** Evidence is computed from the explicit public subset, never from model claims or ungranted IDs. */
export function inspectBriefEvidence(project: ProjectData, ids: ReadonlySet<string>, checks: readonly AuthoringEvidenceCheck[]) {
  const scene = project.document, view = createPublicVisibility(scene)
  const props = Object.values(scene.props).filter(prop => ids.has(prop.id) && view.prop(prop))
  const rooms = Object.values(scene.rooms).filter(room => ids.has(room.id) && view.room(room.id))
  const terrain = Object.values(scene.terrainAreas).filter(area => ids.has(area.id) && view.terrainArea(area.id))
  return checks.map(check => {
    let supported = false, evidenceIds: string[] = [], details: unknown
    if (check.kind === 'clearArea') {
      const polygon = rectangle(check.boundsMm)
      const visibleScene = { ...scene, terrainAreas: Object.fromEntries(terrain.map(value => [value.id, value])) }
      const blockers = props.filter(prop => prop.floorId === check.floorId && (check.avoidVisual || prop.blocksMovement)
        && polygonsOverlap(polygon, check.avoidVisual ? authoringPropVisualPolygon(prop) : propFootprint(prop))).map(value => value.id)
      for (const wall of Object.values(scene.walls).filter(wall => ids.has(wall.id) && wall.floorId === check.floorId && wall.blocksMovement)) {
        const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
        if (polygonsOverlap(polygon, corridor({ x: a.xMm, y: a.yMm }, { x: b.xMm, y: b.yMm }, wall.thicknessMm))) blockers.push(wall.id)
      }
      for (const region of Object.values(scene.regions).filter(value => ids.has(value.id) && value.floorId === check.floorId && value.visibility === 'public' && value.blocksMovement)) {
        if (polygonsOverlap(polygon, region.boundaryMm)) blockers.push(region.id)
      }
      for (const edge of Object.values(scene.terrainEdges).filter(value => ids.has(value.id) && value.floorId === check.floorId && view.terrainEdge(value.id) && value.blocksMovement)) {
        const area = scene.terrainAreas[edge.source.areaId], index = area.boundaryMm.findIndex(point => point.segmentId === edge.source.segmentId)
        if (polygonsOverlap(polygon, corridor(area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm, 1))) blockers.push(edge.id)
      }
      for (const connection of Object.values(scene.terrainConnections).filter(value => ids.has(value.id) && value.floorId === check.floorId && value.visibility === 'public' && value.blocksMovement
        && view.surface(value.from.surfaceRef) && view.surface(value.to.surfaceRef))) {
        if (polygonsOverlap(polygon, corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm))) blockers.push(connection.id)
      }
      const walkable = coveredEverywhere(polygon, terrain.map(terrainPoints), p => {
        const support = supportSurfaceAt(visibleScene, p, check.floorId)
        return !!support && (support.kind !== 'terrainArea' || !visibleScene.terrainAreas[support.id].blocksMovement)
      })
      supported = walkable && !blockers.length && Math.min(check.boundsMm.width, check.boundsMm.height) >= check.minimumWidthMm
      evidenceIds = blockers; details = { boundsMm: check.boundsMm, minimumWidthMm: check.minimumWidthMm, authorizedBlockers: blockers, walkableInAuthorizedTerrain: walkable, avoidVisual: check.avoidVisual }
    } else if (check.kind === 'propCount') {
      const matching = props.filter(prop => prop.definitionRef && check.definitionIds.includes(prop.definitionRef.id))
      const groups = (check.groups ?? []).map(group => ({ minimum: group.minimum, ids: matching.filter(prop => polygonInside(authoringPropVisualPolygon(prop), rectangle(group.boundsMm))).map(prop => prop.id) }))
      supported = matching.length >= check.minimum && groups.every(group => group.ids.length >= group.minimum)
      evidenceIds = matching.map(value => value.id); details = { minimum: check.minimum, count: matching.length, groups }
    } else if (check.kind === 'elevationConnection') {
      const levels = [...new Set(terrain.map(area => area.groundElevationMm))].sort((a, b) => a - b)
      const connections = Object.values(scene.terrainConnections).filter(connection => ids.has(connection.id) && connection.visibility === 'public' && view.surface(connection.from.surfaceRef) && view.surface(connection.to.surfaceRef)
        && check.connectionKinds.includes(connection.kind) && !connection.blocksMovement && connection.widthMm >= check.minimumWidthMm
        && connection.from.surfaceRef.kind === 'terrainArea' && connection.to.surfaceRef.kind === 'terrainArea'
        && terrain.some(area => area.id === connection.from.surfaceRef.id) && terrain.some(area => area.id === connection.to.surfaceRef.id)
        && Math.abs(scene.terrainAreas[connection.from.surfaceRef.id].groundElevationMm - scene.terrainAreas[connection.to.surfaceRef.id].groundElevationMm) >= check.minimumDeltaMm
        && (!connection.openingId || ids.has(connection.openingId) && scene.openings[connection.openingId]?.state === 'open' && !scene.openings[connection.openingId].locked))
      supported = levels.length >= check.minimumLevels && connections.length > 0
      evidenceIds = connections.map(value => value.id); details = { authorizedElevationsMm: levels, minimumLevels: check.minimumLevels, minimumDeltaMm: check.minimumDeltaMm, minimumWidthMm: check.minimumWidthMm }
    } else if (check.kind === 'roomRole') {
      const matches = rooms.filter(room => check.purposeTerms.some(term => room.purpose.toLocaleLowerCase().includes(term.toLocaleLowerCase())))
        .map(room => { const furniture = props.filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === room.id && prop.definitionRef && check.definitionIds.includes(prop.definitionRef.id))
          return { roomId: room.id, propIds: furniture.map(value => value.id), missingDefinitions: check.definitionIds.filter(id => !furniture.some(prop => prop.definitionRef?.id === id)),
            materialMatches: !check.materialId || room.floorStyle?.base.materialRef.id === check.materialId } })
      supported = matches.some(value => value.propIds.length >= check.minimumProps && !value.missingDefinitions.length && value.materialMatches)
      evidenceIds = matches.flatMap(value => [value.roomId, ...value.propIds]); details = { requiredDefinitions: check.definitionIds, minimumProps: check.minimumProps, rooms: matches }
    } else {
      const looks = Object.values(scene.visual?.edgeLooks ?? {}).filter(look => ids.has(look.id) && look.visibility === 'public' && look.enabled
        && ids.has(look.boundaryId) && scene.visual!.boundaries[look.boundaryId]?.visibility === 'public')
      const kinds = [...new Set(looks.map(look => look.kind))]
      supported = check.kinds.every(kind => kinds.includes(kind)); evidenceIds = looks.filter(look => check.kinds.includes(look.kind)).map(value => value.id)
      details = { requiredKinds: check.kinds, presentKinds: kinds }
    }
    return { id: check.id, kind: check.kind, status: supported ? 'supported' as const : 'missing' as const,
      basis: 'explicit authorized public subset; not a whole-scene proof', evidenceIds: [...new Set(evidenceIds)].sort(), details }
  })
}
