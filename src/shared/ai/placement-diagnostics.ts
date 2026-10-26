import { z } from 'zod'
import type { ProjectData } from '../model/project.js'
import type { BoundsMm, PointMm, Prop } from '../model/scene.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { corridor, openingEndpoints, pointInPolygon, polygonDistance, polygonInside, polygonsOverlap, propFootprint, roomPoints, supportedPolygon, supportSurfaceAt, terrainPoints } from '../geometry/geometry.js'
import type { AuthoringStart } from './authoring-protocol.js'
import { authoringPropVisualPolygon } from './plan-diagnostics.js'

const id = z.string().min(1).max(256)
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const bounds = z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict()
export const PlacementProbeSchema = z.object({ definitionId: id, supportRef: z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict(),
  positionMm: z.object({ x: integer, y: integer }).strict(), rotationDeg: z.number().finite().min(0).lt(360).optional(),
  minimumClearanceMm: z.number().int().min(0).max(5000).optional(), avoidVisual: z.boolean().optional(), limit: z.number().int().min(1).max(5).optional(),
  keepClearBoundsMm: z.array(bounds).max(8).optional(),
}).strict()
export type PlacementProbe = z.infer<typeof PlacementProbeSchema>
const rectangle = (b: BoundsMm): PointMm[] => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
const edges = (points: PointMm[]): [PointMm, PointMm][] => points.map((point, index) => [point, points[(index + 1) % points.length]])
const pointSegmentDistance = (p: PointMm, a: PointMm, b: PointMm) => {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}
const boundaryDistance = (subject: PointMm[], boundary: PointMm[]) => Math.min(...subject.flatMap(point => edges(boundary).map(([a, b]) => pointSegmentDistance(point, a, b))),
  ...boundary.flatMap(point => edges(subject).map(([a, b]) => pointSegmentDistance(point, a, b))))

/** Read-only suggestions from the explicitly authorised public subset. Adoption still validates the complete project. */
export function probeAuthoringPlacement(project: ProjectData, start: AuthoringStart, ids: ReadonlySet<string>, input: PlacementProbe) {
  const query = PlacementProbeSchema.parse(input), scene = project.document, view = createPublicVisibility(scene), ref = query.supportRef
  const floorId = ref.kind === 'floor' ? ref.id : ref.kind === 'room' ? scene.rooms[ref.id]?.floorId : scene.terrainAreas[ref.id]?.floorId
  const grants = [start.scope.scene, start.scope.visual, start.scope.placement].filter(value => value && value.floorId === floorId && value.definitionIds.includes(query.definitionId))
  if (!floorId || !grants.length || !scene.propDefinitions[query.definitionId] || ref.kind !== 'floor' && (!ids.has(ref.id) || !view.surface(ref))) throw new Error('Placement probe requires an explicitly granted public definition, floor and support')
  const definition = scene.propDefinitions[query.definitionId], grantPolygons = grants.map(grant => rectangle(grant!.boundsMm))
  if (query.keepClearBoundsMm?.some(bounds => !grantPolygons.some(grant => polygonInside(rectangle(bounds), grant)))) throw new Error('Placement clear areas require explicit granted bounds')
  const terrain = Object.values(scene.terrainAreas).filter(area => ids.has(area.id) && area.floorId === floorId && view.terrainArea(area.id))
  const rooms = Object.values(scene.rooms).filter(room => ids.has(room.id) && room.floorId === floorId && view.room(room.id))
  const visibleScene = { ...scene, terrainAreas: Object.fromEntries(terrain.map(area => [area.id, area])), rooms: Object.fromEntries(rooms.map(room => [room.id, room])) }
  const supportPolygon = ref.kind === 'floor' ? rectangle(scene.floors[floorId].boundsMm) : ref.kind === 'room' ? roomPoints(scene, scene.rooms[ref.id]) : terrainPoints(scene.terrainAreas[ref.id])
  const clearance = query.minimumClearanceMm ?? 100, avoidVisual = query.avoidVisual ?? true
  const blockers: { id: string; polygon: PointMm[] }[] = Object.values(scene.props).filter(prop => ids.has(prop.id) && prop.floorId === floorId && view.prop(prop) && (avoidVisual || prop.blocksMovement))
    .map(prop => ({ id: prop.id, polygon: avoidVisual ? authoringPropVisualPolygon(prop) : propFootprint(prop) }))
  const reservedAreas = (query.keepClearBoundsMm ?? []).map(rectangle)
  for (const wall of Object.values(scene.walls).filter(wall => ids.has(wall.id) && wall.floorId === floorId && wall.blocksMovement)) {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    blockers.push({ id: wall.id, polygon: corridor({ x: a.xMm, y: a.yMm }, { x: b.xMm, y: b.yMm }, wall.thicknessMm) })
    // Door approaches are also kept clear; the full wall band is a conservative read-only suggestion.
    for (const opening of Object.values(scene.openings).filter(opening => ids.has(opening.id) && opening.wallId === wall.id && !opening.secret && opening.kind === 'door')) blockers.push({ id: opening.id, polygon: corridor(...openingEndpoints(scene, opening), 1000) })
  }
  for (const region of Object.values(scene.regions).filter(region => ids.has(region.id) && region.floorId === floorId && region.visibility === 'public' && region.blocksMovement)) blockers.push({ id: region.id, polygon: region.boundaryMm })
  for (const connection of Object.values(scene.terrainConnections).filter(connection => ids.has(connection.id) && connection.floorId === floorId && connection.visibility === 'public' && view.surface(connection.from.surfaceRef) && view.surface(connection.to.surfaceRef))) blockers.push({ id: connection.id, polygon: corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm) })
  if (blockers.length > 256 || terrain.reduce((sum, area) => sum + area.boundaryMm.length, 0) > 2048) throw new Error('Placement probe exceeds its finite public geometry budget; reduce the explicit subset')
  const higherTerrain = terrain.filter(area => ref.kind === 'floor' || ref.kind === 'terrainArea' && area.coveragePriority > scene.terrainAreas[ref.id].coveragePriority
    || ref.kind === 'room' && scene.rooms[ref.id].supportRef.kind === 'terrainArea' && area.coveragePriority > scene.terrainAreas[scene.rooms[ref.id].supportRef.id].coveragePriority)
  const examine = (positionMm: PointMm) => {
    const prop: Prop = { id: 'placement-probe', floorId, positionMm, rotationDeg: query.rotationDeg ?? 0, visualBoundsMm: definition.defaultVisualBoundsMm,
      footprintMm: definition.defaultFootprintMm, footprintOffsetMm: definition.defaultFootprintOffsetMm } as Prop
    const physical = propFootprint(prop), visual = authoringPropVisualPolygon(prop), tested = avoidVisual ? visual : physical
    const insideGrant = grantPolygons.some(polygon => polygonInside(physical, polygon) && polygonInside(visual, polygon))
    // A decorative image is still constrained by the selected support. Checking
    // only its collision footprint lets a canopy hang over a higher terrain or
    // a curved island edge, which is exactly the failure this probe is meant to
    // prevent.
    const physicalFit = supportedPolygon(visibleScene, physical, ref, floorId), visualFit = supportedPolygon(visibleScene, visual, ref, floorId)
    const fit = physicalFit && visualFit
    let available = fit ? boundaryDistance(tested, supportPolygon) : 0
    for (const area of higherTerrain) if (area.id !== ref.id) available = Math.min(available, polygonDistance(tested, terrainPoints(area)))
    const blocked = blockers.filter(blocker => polygonsOverlap(tested, blocker.polygon) || polygonDistance(tested, blocker.polygon) < clearance)
    for (const blocker of blockers) available = Math.min(available, polygonDistance(tested, blocker.polygon))
    const actual = supportSurfaceAt(visibleScene, positionMm, floorId)
    const walkable = ref.kind !== 'terrainArea' || !scene.terrainAreas[ref.id].blocksMovement
    const reserved = reservedAreas.some(area => polygonsOverlap(visual, area) || polygonDistance(visual, area) < clearance)
    return { positionMm, feasible: insideGrant && fit && walkable && !blocked.length && !reserved && available >= clearance,
      actualGroundSupport: actual, selectedSupportFitsWholeFootprint: physicalFit, selectedSupportFitsWholeImage: visualFit, insideFrozenBounds: insideGrant,
      clearanceMm: Math.max(0, Math.floor(available)), authorizedBlockerCount: blocked.length, authorizedBlockerIds: blocked.map(value => value.id).sort().slice(0, 16) }
  }
  const tested = examine(query.positionMm), points: PointMm[] = []
  const xs = supportPolygon.map(p => p.x), ys = supportPolygon.map(p => p.y), minimumX = Math.min(...xs), minimumY = Math.min(...ys), maximumX = Math.max(...xs), maximumY = Math.max(...ys)
  // A fixed 17x17 grid is bounded and deterministic; guided inset points keep
  // a narrow/concave support from disappearing between grid cells. The final
  // pool remains capped at 256 and does not claim that no other placement exists.
  for (let y = 1; y < 17; y++) for (let x = 1; x < 17; x++) points.push({ x: Math.round(minimumX + (maximumX - minimumX) * x / 17), y: Math.round(minimumY + (maximumY - minimumY) * y / 17) })
  const center = { x: Math.round(xs.reduce((sum, x) => sum + x, 0) / xs.length), y: Math.round(ys.reduce((sum, y) => sum + y, 0) / ys.length) }, guided: PointMm[] = []
  const addGuided = (point: PointMm, fraction: number) => guided.push({ x: Math.round(point.x + (center.x - point.x) * fraction), y: Math.round(point.y + (center.y - point.y) * fraction) })
  for (const point of supportPolygon) for (const fraction of [.12, .28, .5, .72, .88]) addGuided(point, fraction)
  for (let index = 0; index < supportPolygon.length; index++) {
    const a = supportPolygon[index], b = supportPolygon[(index + 1) % supportPolygon.length], midpoint = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }
    for (const fraction of [.2, .45, .7]) addGuided(midpoint, fraction)
  }
  const unique = new Map<string, PointMm>()
  for (const point of [...points, ...guided]) if (pointInPolygon(point, supportPolygon)) unique.set(`${point.x},${point.y}`, point)
  const pool = [...unique.values()]
  pool.sort((a, b) => Math.hypot(a.x - query.positionMm.x, a.y - query.positionMm.y) - Math.hypot(b.x - query.positionMm.x, b.y - query.positionMm.y) || a.y - b.y || a.x - b.x)
  // Preserve all deterministic candidates when the support is small; the
  // explicit cap is still the hard upper bound for a large support.
  const boundedPool = pool.length > 256 ? pool.slice(0, 256) : pool
  const candidates: ReturnType<typeof examine>[] = [], candidateVisuals: PointMm[][] = []
  let evaluated = 0
  for (const point of boundedPool) { evaluated++; const candidate = examine(point)
    const prop: Prop = { id: 'placement-candidate', floorId, positionMm: point, rotationDeg: query.rotationDeg ?? 0, visualBoundsMm: definition.defaultVisualBoundsMm,
      footprintMm: definition.defaultFootprintMm, footprintOffsetMm: definition.defaultFootprintOffsetMm } as Prop
    const candidateShape = avoidVisual ? authoringPropVisualPolygon(prop) : propFootprint(prop)
    const separated = candidateVisuals.every(previous => !polygonsOverlap(previous, candidateShape) && boundaryDistance(previous, candidateShape) >= clearance)
    if (candidate.feasible && separated) { candidates.push(candidate); candidateVisuals.push(candidateShape) }
    if (candidates.length >= (query.limit ?? 5)) break
  }
  return { definitionId: query.definitionId, supportRef: ref, rotationDeg: query.rotationDeg ?? 0, minimumClearanceMm: clearance, avoidVisual,
    tested, candidates, search: { method: 'fixed 17x17 grid plus deterministic boundary-inset points; at most 256 samples', samples: evaluated, complete: false },
    basis: 'explicit authorized public subset only; suggestions do not modify the draft or bypass complete adoption geometry/locks/dependencies',
    physicalFootprintMm: definition.defaultFootprintMm, visualBoundsMm: definition.defaultVisualBoundsMm }
}
