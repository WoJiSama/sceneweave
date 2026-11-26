import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { connectionBand, corridor, distanceToSegment, pointInPolygon, polygonDistance, polygonsOverlap, segmentCuts } from '../../../shared/geometry/geometry.js'
import { reliefBounds, reliefGridPoint, reliefSegmentCuts } from '../../../shared/geometry/terrain-relief.js'
import { roadSpanTriangles, type RoadVertex } from '../../../shared/geometry/road-surface.js'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'
import { playerMaskRings } from '../../../shared/projection/player-mask.js'
import { planStaircase, staircasePatch, staircasePointAt } from '../../../shared/stairs/geometry.js'
import { defaultStaircase } from '../../../shared/stairs/contracts.js'
import { staircaseMaterial } from '../../../shared/stairs/catalog.js'
import type { BoundsMm, PointMm, SurfaceStyle } from '../../../shared/model/scene.js'
import { spatialOpeningRange, spatialWallHeight } from '../../../shared/model/building-height.js'
import type { ProjectedConnection, ProjectedPath, ProjectedSurface, ProjectedTerrainEdge, Projection } from '../../../shared/projection/types.js'
import type { StaircaseGeometry } from '../../../shared/stairs/geometry.js'
import { exposedEdgeSegments } from '../../../shared/projection/bridge-entrances.js'
import { atHeight, rectangle, type MeshMask, type MeshMaterial, type ObliqueMesh, type SpatialColor } from './oblique-mesh'
import type { WallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'
import { projectGround, spatialWallFrame } from './projected-ground.js'
import { earthenRoad, planEarthenRoad } from './earthen-road.js'
import { gradedRiserPalette } from './graded-road-paint.js'
import { ERODED_CLIFF_PROFILE, isWeatheredCliffProfile, spatialCliffProfile, STRATIFIED_CLIFF_PROFILE, weatheredCliffWidth } from '../../../shared/visual/terrain-cliff-plan.js'
import type { VisualEdgeLook } from '../../../shared/visual/types.js'
import { cliffStrata, strataColor } from './stratified-cliff.js'
import { ERODED_ROCK_STEPS_PROFILE, planWeatheredRockSteps, usesWeatheredRockSteps } from './weathered-rock-steps.js'
import { paintWeatheredCliffTexture, weatheredCliffPeriod, WEATHERED_CLIFF_TEXTURE_SIZE } from './weathered-cliff.js'
import { terrainValueNoise } from '../../../shared/terrain-generation/field.js'

const rings = (polygon: Polygon) => polygon.map(ring => {
  const closed = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
  return ring.slice(0, closed ? -1 : undefined).map(([x, y]) => ({ x, y }))
})
const ring = (points: PointMm[]) => points.map(({ x, y }): [number, number] => [x, y])
const shape = (area: ProjectedSurface): MultiPolygon => area.regionsMm?.map(row => [ring(row.outerMm), ...row.holesMm.map(ring)]) ?? [[ring(area.points)]]
const polygonEdges = (points: PointMm[]): [PointMm, PointMm][] => points.map((point, i) => [point, points[(i + 1) % points.length]])
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const midpoint = (a: PointMm, b: PointMm) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const colorRgb = (color: string): SpatialColor => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255) as SpatialColor
const textureUv = (bounds: BoundsMm) => (p: PointMm): [number, number] => [(p.x - bounds.x) / bounds.width, (p.y - bounds.y) / bounds.height]

export function fillMask(image: HTMLCanvasElement, bounds: BoundsMm, polygons: PointMm[][][]) {
  const ctx = image.getContext('2d')!
  ctx.scale(image.width / bounds.width, image.height / bounds.height)
  ctx.translate(-bounds.x, -bounds.y)
  for (const polygon of polygons) {
    ctx.beginPath()
    for (const points of polygon) {
      points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
      ctx.closePath()
    }
    ctx.fill('evenodd')
  }
  return { image, bounds }
}

type NewCanvas = (width: number, height: number) => HTMLCanvasElement

export function spatialPrivacyMask(projection: Projection, temporaryCanvas: NewCanvas): MeshMask | undefined {
  if (!projection.masks.length) return
  const { bounds, maskPublicRooms } = projection, polygons = playerMaskRings(projection.masks, maskPublicRooms)
  const texture = temporaryCanvas(2048, 2048)
  if (maskPublicRooms?.some(rooms => rooms.length)) return fillMask(texture, bounds, [polygons])
  return fillMask(texture, bounds, polygons.map(polygon => [polygon]))
}

export interface SurfaceMeshes {
  mesh: ObliqueMesh
  projection: Projection
  texture: HTMLCanvasElement
  images: ReadonlyMap<string, HTMLCanvasElement | ImageBitmap>
  privacy?: MeshMask
  zOffset: number
  blankGround: boolean
  temporaryCanvas: NewCanvas
  ground: ReturnType<typeof projectGround>
  earthenSteps: ReadonlyMap<string, StaircaseGeometry>
}

function paintStyle(input: SurfaceMeshes, style: SurfaceStyle | null | undefined, fallback: string): MeshMaterial {
  const paint = style?.base, textureId = paint && input.projection.materials[paint.materialRef.id]?.textureAssetId
  const image = textureId ? input.images.get(textureId) : undefined
  return { image, color: colorRgb(paint?.tint ?? (image ? '#ffffff' : fallback)), repeat: !!image, privacy: input.privacy }
}

const edgeKey = (a: PointMm, b: PointMm) => a.x < b.x || a.x === b.x && a.y < b.y
  ? `${a.x},${a.y}/${b.x},${b.y}` : `${b.x},${b.y}/${a.x},${a.y}`

const cliffCarrierKey = (edge: ProjectedTerrainEdge) => edgeKey(edge.sourceSpanMm?.[0] ?? edge.start, edge.sourceSpanMm?.[1] ?? edge.end)

function stratifiedEdges(projection: Projection) {
  const looks = new Map<string, VisualEdgeLook>()
  const boundaries = new Map(projection.visual?.boundaries.map(boundary => [boundary.id, boundary]))
  for (const look of projection.visual?.edgeLooks ?? []) {
    if (look.kind !== 'cliff' || spatialCliffProfile(look.renderProfile) !== STRATIFIED_CLIFF_PROFILE || !look.opacity) continue
    const boundary = boundaries.get(look.boundaryId)
    if (!boundary?.terrainAreaIds.length) continue
    const { points, closed } = boundary
    for (let i = 0; i < points.length - Number(!closed); i++) looks.set(edgeKey(points[i], points[(i + 1) % points.length]), look)
  }
  return looks
}

interface WeatheredCourse {
  look: VisualEdgeLook
  material: MeshMaterial
  u: (p: PointMm) => number
}

function weatheredEdges(input: SurfaceMeshes) {
  const { projection, privacy, temporaryCanvas } = input
  const looks = projection.visual?.edgeLooks.flatMap(look => {
    const renderProfile = spatialCliffProfile(look.renderProfile)
    return look.kind === 'cliff' && isWeatheredCliffProfile(renderProfile) && look.opacity ? [{ ...look, renderProfile }] : []
  }) ?? []
  const courses = new Map<string, WeatheredCourse>()
  const boundaries = new Map(projection.visual?.boundaries.map(boundary => [boundary.id, boundary]))
  for (const look of looks) {
    const boundary = boundaries.get(look.boundaryId)
    if (!boundary?.terrainAreaIds.length) continue
    const edges = boundary.points.slice(0, boundary.points.length - Number(!boundary.closed)).map((a, i) => {
      const b = boundary.points[(i + 1) % boundary.points.length]
      return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y) }
    })
    const period = weatheredCliffPeriod(look, edges.reduce((sum, { length }) => sum + length, 0))
    const image = temporaryCanvas(...WEATHERED_CLIFF_TEXTURE_SIZE)
    paintWeatheredCliffTexture(image, look)
    const material = { image, repeat: true, privacy, opacity: look.opacity }
    let distance = 0
    for (const { a, b, length } of edges) {
      if (!length) continue
      const start = distance, dx = b.x - a.x, dy = b.y - a.y
      courses.set(edgeKey(a, b), { material, look, u: p => (start + ((p.x - a.x) * dx + (p.y - a.y) * dy) / length) / period })
      distance += length
    }
  }
  const normals = new Map<string, PointMm>()
  const vertexKey = (edge: ProjectedTerrainEdge, p: PointMm) => `${edge.sourceAreaId}/${p.x},${p.y}`
  for (const edge of [...projection.edges, ...projection.spatialReliefEdges ?? []]) {
    const { start, end } = edge
    if (!courses.has(cliffCarrierKey(edge))) continue
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
    if (length <= .001) continue
    for (const point of [start, end]) {
      const key = vertexKey(edge, point), current = normals.get(key) ?? { x: 0, y: 0 }
      normals.set(key, { x: current.x + dy / length, y: current.y - dx / length })
    }
  }
  return { courses, normals, vertexKey }
}

function addWeatheredCliff(input: SurfaceMeshes, edge: ProjectedTerrainEdge, course: WeatheredCourse,
  outward: (p: PointMm) => PointMm, a: PointMm, b: PointMm, pz: number, qz: number, pl: number, ql: number) {
  const { projection, ground, mesh } = input
  const openings = projection.connections.filter(connection => !connection.inlayFootprintMm && connection.surfaceIds?.includes(edge.sourceAreaId))
    .flatMap(connection => {
      const line = connection.route?.centerlineMm ?? [connection.start, connection.end]
      return line.slice(1).map((b, i) => ({ a: line[i], b, radius: connection.widthMm / 2 }))
    })
  const scale = Math.max(1, course.look.repeatMm / 590)
  const eroded = course.look.renderProfile === ERODED_CLIFF_PROFILE
  const softFoot = eroded && Math.max(pz - pl, qz - ql) < Math.min(560, 380 * Math.sqrt(scale))
  if (softFoot) {
    mesh.quad({ image: input.texture, unlit: true, privacy: input.privacy }, [atHeight(a, pl), atHeight(b, ql), atHeight(b, qz), atHeight(a, pz)],
      [textureUv(projection.bounds)(a), textureUv(projection.bounds)(b), textureUv(projection.bounds)(b), textureUv(projection.bounds)(a)])
    return
  }
  const section = (p: PointMm, high: number, low: number) => {
    const n = outward(p), rise = Math.max(0, high - low), width = weatheredCliffWidth(course.look, p, rise)
    const setback = Math.min(Infinity, ...openings.map(({ a, b, radius }) => distanceToSegment(p, a, b) - radius))
    const reach = Math.min(width.foot * .68, Math.max(0, setback * .82))
    const shoulder = Math.max(0, .32 + .77 * terrainValueNoise(course.look.seed, 'eroded rock ledge', p.x / (1770 * scale), p.y / (1430 * scale)))
    const at = (reach: number) => ({ x: p.x + reach * n.x, y: p.y + reach * n.y })
    const toe = at(reach), neighbor = ground.levels.get(edge.neighborAreaId ?? '')
    const base = Math.min(high, neighbor ? ground.elevation(neighbor, toe) : low)
    const strata = eroded ? .19 + shoulder * .34 : .46
    return [atHeight(p, high), atHeight(at(reach * .19), mix(high, base, strata)),
      atHeight(at(reach * (.24 + .62 * shoulder)), mix(high, base, eroded ? strata + .29 : .51)), atHeight(toe, base)] as const
  }
  const left = section(a, pz, pl), right = section(b, qz, ql)
  const u = course.u(a), v = course.u(b), down = [.006, .44, .53, .991]
  for (let i = 1; i < left.length; i++) {
    mesh.quad(course.material, [left[i], right[i], right[i - 1], left[i - 1]], [[u, down[i]], [v, down[i]], [v, down[i - 1]], [u, down[i - 1]]])
  }
}

function addWeatheredRockStairs(input: SurfaceMeshes, connection: ProjectedConnection, painted: MeshMaterial) {
  const { mesh, ground, projection, zOffset } = input
  const [fromId, toId] = connection.surfaceIds ?? []
  const from = fromId && ground.levels.get(fromId), to = toId && ground.levels.get(toId)
  const plan = planWeatheredRockSteps(connection, from ? ground.elevation(from, connection.start) : zOffset + connection.fromElevationMm,
    to ? ground.elevation(to, connection.end) : zOffset + connection.toElevationMm)
  if (!plan) return false
  const uv = textureUv(projection.bounds), stone = paintStyle(input, connection.style, '#AAA38E')
  const tile = connection.style?.base.tileSizeMm.width ?? 1250
  const rockUv = (p: PointMm): [number, number] => [p.x / tile, p.y / tile]
  const shade = (factor: number): MeshMaterial => ({ ...stone, color: stone.color?.map(color => color * factor) as SpatialColor })
  if (plan.bedding) addRockStairBedding(input, plan.bedding, plan.lowMm, plan.highMm, painted, [from || undefined, to || undefined])
  for (const landing of plan.landings) mesh.cap(painted, [landing.polygonMm], () => landing.elevationMm + 7, uv)
  for (const tread of plan.treads) {
    const z = tread.upperMm + 7, variation = tread.colorVariation
    const cap = shade(1.06 + variation), face = shade(.82 + variation)
    mesh.cap(cap, [tread.polygonMm], () => z, rockUv)
    for (let i = 1; i < tread.front.length; i++) {
      const a = tread.front[i - 1], b = tread.front[i]
      mesh.side(face, a, b, tread.lowerMm + 7, tread.lowerMm + 7, z, z, tile)
    }
    mesh.cap(shade(.90 + variation), [tread.facet], () => z + 2, rockUv)
    const wear = shade(1.17 + variation)
    for (const scuff of tread.scuffs) mesh.cap(wear, [scuff], () => z + 3, rockUv)
    if (tread.split) mesh.cap(shade(.67 + variation), [tread.joint], () => z + 3, rockUv)
    if (plan.bedding) continue
    // The open slot exposes either the stair's flank or the cut into the adjacent bank.
    for (const [index, side] of tread.sides.entries()) for (let i = 1; i < side.length; i++) {
      const [a, b] = index ? [side[i], side[i - 1]] : [side[i - 1], side[i]]
      const aZ = ground.groundAt(a), bZ = ground.groundAt(b)
      mesh.side(face, a, b, Math.min(z, aZ), Math.min(z, bZ), Math.max(z, aZ), Math.max(z, bZ), tile)
    }
  }
  return true
}

function addRockStairBedding(input: SurfaceMeshes, bedding: NonNullable<NonNullable<ReturnType<typeof planWeatheredRockSteps>>['bedding']>,
  low: number, high: number, painted: MeshMaterial, supports: (ProjectedSurface | undefined)[]) {
  const { ground, mesh, projection } = input, { lengthMm, startMm, endMm, pointAt } = bedding
  const uv = textureUv(projection.bounds), material = { ...painted, privacy: input.privacy }
  const count = Math.min(256, Math.max(2, Math.ceil(lengthMm / 150)))
  const segments = [...new Set([0, ...bedding.stations, lengthMm])].sort((a, b) => a - b)
  const rims = supports.flatMap(surface => surface ? polygonEdges(surface.points) : [])
  // A narrow overlap covers the texture mask's edge pixels on each bank.
  const lanes = [-.52, -.5, -.42, -.33, 0, .33, .42, .5, .52]
  const contact = [-.5, .5].flatMap(lane => segments.slice(1).flatMap((end, i) => {
    const start = segments[i], a = pointAt(start, lane), b = pointAt(end, lane)
    const cuts = segmentCuts(a, b, rims).slice(1, -1)
    for (const support of supports) if (support?.relief) {
      cuts.push(...reliefSegmentCuts(support.relief, ground.boxes.get(support.id)!, a, b).slice(1, -1))
    }
    return cuts.map(t => mix(start, end, t))
  }))
  const stations = [startMm, endMm, ...segments, ...contact, ...Array.from({ length: count - 1 }, (_, i) => lengthMm * (i + 1) / count)]
    .sort((a, b) => a - b).filter((station, i, all) => !i || station - all[i - 1] > .001)
  const profile = (distance: number, lane: number, surfaceStation: number) => {
    const point = pointAt(distance, lane), bank = ground.elevation(ground.surfaceAt(pointAt(surfaceStation, lane)), point)
    const progress = Math.max(0, Math.min(1, (distance - startMm) / (endMm - startMm)))
    const center = mix(low, high, progress) - Math.min(345, (high - low) * .24) * Math.sin(Math.PI * progress) - 16
    const taper = Math.min(1, distance / startMm, (lengthMm - distance) / (lengthMm - endMm))
    const weight = Math.min(1, Math.max(0, (.5 - Math.abs(lane)) / .14)) * taper
    return atHeight(point, mix(bank + 1, center, weight))
  }
  const mapUv = ([x, y]: ReturnType<typeof atHeight>) => uv({ x, y })
  const strip = (prior: ReturnType<typeof atHeight>[], current: ReturnType<typeof atHeight>[], seam = false) => {
    for (let i = 1; i < current.length; i++) {
      const a = prior[i - 1], b = current[i - 1], c = current[i], d = prior[i]
      if (seam && Math.max(Math.abs(a[2] - b[2]), Math.abs(d[2] - c[2])) < .01) continue
      mesh.quad(material, [a, b, c, d], [mapUv(a), mapUv(b), mapUv(c), mapUv(d)])
    }
  }
  let last: ReturnType<typeof atHeight>[] | undefined
  for (let station = 1; station < stations.length; station++) {
    const start = stations[station - 1], end = stations[station], mid = (start + end) / 2
    const prior = lanes.map(lane => profile(start, lane, mid)), current = lanes.map(lane => profile(end, lane, mid))
    // Close the change of actual support where the flight cuts through the rim.
    if (last) strip(last, prior, true)
    strip(prior, current)
    last = current
  }
}

function addGroundTreads(input: SurfaceMeshes, stair: StaircaseGeometry, style: SurfaceStyle | null, soilColor?: string) {
  const { mesh, ground } = input
  const material = soilColor ? { color: colorRgb(soilColor), privacy: input.privacy } : paintStyle(input, style, '#9A907B')
  const tile = style?.base.tileSizeMm.width ?? 760
  const top = soilColor ? { image: input.texture, unlit: true, privacy: input.privacy } : material
  const uv = soilColor ? textureUv(input.projection.bounds) : (p: PointMm): [number, number] => [p.x / tile, p.y / tile]
  const paintMasks = stair.covers.map(cover => [ring(cover.polygonMm)])
  for (const tread of stair.treads) {
    const points = tread.polygonMm, foot = midpoint(tread.frontMm[0], tread.frontMm[1]), head = midpoint(tread.rearMm[0], tread.rearMm[1])
    const lo = Math.min(ground.groundAt(foot), ground.groundAt(head)), hi = Math.max(ground.groundAt(foot), ground.groundAt(head)) + 25
    const visible = paintMasks.length ? polygonClipping.difference([ring(points)], ...paintMasks) : [[ring(points)]]
    for (const polygon of visible) {
      const ringsMm = rings(polygon)
      mesh.cap(top, ringsMm, () => hi, uv)
      for (const outline of ringsMm) for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length]
        mesh.side(material, a, b, Math.min(lo, ground.groundAt(a)), Math.min(lo, ground.groundAt(b)), hi, hi, tile)
      }
    }
  }
}

function addEarthenRoad(input: SurfaceMeshes, path: ProjectedPath, stairs: StaircaseGeometry, top: MeshMaterial) {
  const plan = planEarthenRoad(stairs, input.ground.groundAt), uv = textureUv(input.projection.bounds)
  const material = paintStyle(input, path.style, '#9d876d')
  const soil = { ...material, color: material.color!.map(channel => channel * .83) as SpatialColor, unlit: true }
  const position = ({ x, y, z }: PointMm & { z: number }) => atHeight({ x, y }, z)
  for (const { longitudinal, at } of plan.treads) {
    let previous = at(longitudinal[0])
    for (let i = 1; i < longitudinal.length; i++) {
      const start = longitudinal[i - 1], span = longitudinal[i] - start
      const count = Math.min(12, Math.ceil(span / 240))
      for (let j = 1; j <= count; j++) {
        const next = at(start + span * j / count)
        for (let k = 1; k < next.length; k++) {
          const quad = [previous[k - 1], next[k - 1], next[k], previous[k]] as const
          input.mesh.quad(top, quad.map(position) as Parameters<ObliqueMesh['quad']>[1], quad.map(uv) as NonNullable<Parameters<ObliqueMesh['quad']>[2]>)
        }
        previous = next
      }
    }
  }
  for (const { before, after, rise } of plan.risers) {
    if (Math.abs(rise) < .1) continue
    const [low, high] = rise > 0 ? [before, after] : [after, before]
    for (let i = 1; i < low.length; i++) {
      const [a, b] = rise > 0 ? [i - 1, i] : [i, i - 1]
      input.mesh.side(soil, low[a], low[b], low[a].z, low[b].z, high[a].z, high[b].z, 460)
    }
  }
}

/** Leave existing cuts and privacy coverage intact when selecting spatial road patches. */
export function planSpatialEarthenRoads(projection: Pick<Projection, 'bounds' | 'paths' | 'masks' | 'connections' | 'inlays' | 'rocks'>): ReadonlyMap<string, StaircaseGeometry> {
  const { bounds } = projection, roads = new Map<string, StaircaseGeometry>()
  const occupied = [
    ...projection.paths.flatMap(path => path.gradedSurface ? [path.gradedSurface.footprintMm] : []),
    ...projection.connections.filter(row => !row.inlayFootprintMm && !row.carvedFootprintMm)
      .map(row => connectionBand(row.route?.centerlineMm ?? [row.start, row.end], row.widthMm)),
    ...[...projection.inlays ?? [], ...projection.rocks ?? []].flatMap(row => row.patches.map(patch => patch.pointsMm)),
  ]
  for (const path of projection.paths) {
    if (!earthenRoad(path) || !path.stairs) continue
    const { centerlineMm, widthMm, config, widthSections } = path.stairs
    const stairs = planStaircase(centerlineMm, widthMm, config, widthSections), outline = stairs.footprintMm
    if (outline.some(p => p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height)
      || projection.masks.some(mask => polygonDistance(outline, mask) < .001)
      || occupied.some(other => polygonsOverlap(outline, other))) continue
    roads.set(path.id, stairs)
    occupied.push(outline)
  }
  return roads
}

function boxesMeet(a: BoundsMm, b: BoundsMm) {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

function reliefEdgeSections(ground: SurfaceMeshes['ground'], source: ProjectedSurface, neighbor: ProjectedSurface | undefined,
  a: PointMm, b: PointMm, detailCount: number) {
  const cuts = [0, 1, ...Array.from({ length: detailCount - 1 }, (_, i) => (i + 1) / detailCount)]
  for (const area of [source, neighbor]) {
    if (area?.relief) cuts.push(...reliefSegmentCuts(area.relief, ground.boxes.get(area.id)!, a, b))
  }
  const end = cuts.sort((x, y) => x - y).filter((t, i) => !i || t - cuts[i - 1] > 1e-10)
  const sample = (t: number) => {
    const p = { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) }
    return { p, sourceZ: ground.elevation(source, p), neighborZ: ground.elevation(neighbor, p) }
  }
  const values = end.map(sample)
  return values.slice(1).flatMap((q, i) => {
    const p = values[i], start = p.sourceZ - p.neighborZ, finish = q.sourceZ - q.neighborZ
    if (Math.max(Math.abs(start), Math.abs(finish)) < 1e-6) return []
    if (start * finish >= 0) return [{ p, q, reversed: start + finish < 0 }]
    const t = start / (start - finish), s = sample(mix(end[i], end[i + 1], t))
    s.sourceZ = s.neighborZ = (s.sourceZ + s.neighborZ) / 2
    return [{ p, q: s, reversed: start < 0 }, { p: s, q, reversed: finish < 0 }]
  })
}

function visibleGradedRoads(projection: Projection) {
  const extent = rectangle(projection.bounds), masks = projection.audience === 'player' ? projection.masks : []
  return projection.paths.flatMap(path => {
    if (!path.gradedSurface) return []
    const { footprintMm } = path.gradedSurface, box = reliefBounds(footprintMm)
    if (!boxesMeet(box, projection.bounds)) return []
    const outline = [ring(footprintMm)], occluders = masks.filter(mask => boxesMeet(reliefBounds(mask), box))
    const clipped = !!occluders.length || footprintMm.some(p => !pointInPolygon(p, extent))
    const onMap = clipped ? polygonClipping.intersection(outline, [ring(extent)]) : [outline]
    const visible = occluders.length ? polygonClipping.difference(onMap, ...occluders.map(mask => [ring(mask)])) : onMap
    return visible.length ? [{ path, polygons: visible, box, clipped, occluders, extent }] : []
  })
}

function addGradedRoad(input: SurfaceMeshes, road: ReturnType<typeof visibleGradedRoads>[number], top: MeshMaterial) {
  const { path, polygons, clipped, occluders, extent } = road, geometry = path.gradedSurface!
  const { mesh, ground, zOffset } = input, uv = textureUv(input.projection.bounds)
  const privacy = input.projection.audience === 'player' ? input.privacy : undefined
  const paint = { ...top, privacy }
  const world = ({ x, y, z }: RoadVertex) => atHeight({ x, y }, z + zOffset)
  const palette = gradedRiserPalette(path)
  const edgesOf = (p: PointMm[]) => p.map((point, i): [PointMm, PointMm] => [point, p[(i + 1) % p.length]])
  const masks = [...occluders, extent].flatMap(edgesOf)
  const allowed = (p: PointMm) => !clipped || pointInPolygon(p, extent) && !occluders.some(ring => pointInPolygon(p, ring, false))
  for (const span of geometry.spans) for (const lane of [0, 1, 2] as const) for (const face of roadSpanTriangles(span, lane)) {
    if (!clipped) { mesh.triangle(paint, [world(face[0]), world(face[1]), world(face[2])], [uv(face[0]), uv(face[1]), uv(face[2])]); continue }
    const [a, b, c] = face, ux = b.x - a.x, uy = b.y - a.y, vx = c.x - a.x, vy = c.y - a.y, det = ux * vy - uy * vx
    const at = (p: PointMm) => zOffset + a.z + ((p.x - a.x) * vy - (p.y - a.y) * vx) / det * (b.z - a.z)
      + (ux * (p.y - a.y) - uy * (p.x - a.x)) / det * (c.z - a.z)
    for (const visible of polygonClipping.intersection([ring(face)], polygons)) mesh.cap(paint, rings(visible), at, uv)
  }
  const materials = new Map<string, MeshMaterial>()
  const facePaint = (color: string) => {
    if (!materials.has(color)) materials.set(color, { color: colorRgb(color), privacy })
    return materials.get(color)!
  }
  const finishes = path.gradedFinish?.covers ?? []
  // The atlas already contains the slope lighting. A little occlusion at the
  // vertical cut keeps the source texture visible without lighting it twice.
  const deckFace: MeshMaterial = { ...paint, color: [.77, .74, .70] }
  const bankFace: MeshMaterial = { ...paint, color: [.96, .96, .96] }
  for (const { lower, upper, ascending } of geometry.risers) for (const lane of [0, 1, 2] as const) {
    const [a, b] = ascending ? [lane, lane + 1] : [lane + 1, lane]
    const u = lower[a], v = lower[b]
    if (Math.hypot(u.x - v.x, u.y - v.y) < .01) continue
    const cuts = segmentCuts(u, v, [...clipped ? masks : [], ...finishes.flatMap(cover => edgesOf(cover.polygonMm))])
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1], to = cuts[i], p = { x: mix(u.x, v.x, from), y: mix(u.y, v.y, from) }, q = { x: mix(u.x, v.x, to), y: mix(u.y, v.y, to) }
      const mid = midpoint(p, q)
      if (!allowed(mid)) continue
      const cover = finishes.findLast(row => pointInPolygon(mid, row.polygonMm))?.kind
      const material = lane !== 1 || cover ? bankFace : path.gradedFinish ? facePaint(palette.alternate) : deckFace
      // Map the actual soil and snow across the whole riser. On a bank, this
      // carries the same contact material through the tapered end of the step.
      mesh.quad(material, [atHeight(q, zOffset + mix(u.z, v.z, to)), atHeight(p, zOffset + mix(u.z, v.z, from)),
        atHeight(p, zOffset + mix(upper[a].z, upper[b].z, from)), atHeight(q, zOffset + mix(upper[a].z, upper[b].z, to))],
      [uv(q), uv(p), uv(p), uv(q)])
    }
  }
  // Seal the sub-station contact against the source relief triangles.
  const first = geometry.spans[0], last = geometry.spans.at(-1)!
  const joins = [[first.start[1], first.start[2]], ...geometry.spans.flatMap(({ start, end }) => [[start[0], end[0]], [start[3], end[3]]]), [last.end[1], last.end[2]]]
  for (const [a, b] of joins) {
    const count = Math.min(32, Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 86)))
    const cuts = [...new Set([...segmentCuts(a, b, clipped ? masks : []), ...Array.from({ length: count - 1 }, (_, i) => (i + 1) / count)])].sort((a, b) => a - b)
    const sample = (t: number) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: zOffset + mix(a.z, b.z, t) })
    for (let i = 1; i < cuts.length; i++) {
      const p = sample(cuts[i - 1]), q = sample(cuts[i])
      if (!allowed(midpoint(p, q))) continue
      const x = ground.groundAt(p), y = ground.groundAt(q)
      if (Math.max(Math.abs(x - p.z), Math.abs(y - q.z)) < .01) continue
      mesh.quad(paint, [atHeight(p, x), atHeight(q, y), world({ ...q, z: q.z - zOffset }), world({ ...p, z: p.z - zOffset })],
        [uv(p), uv(q), uv(q), uv(p)])
    }
  }
}

export function addMapBase(input: SurfaceMeshes) {
  const { mesh, projection, ground, blankGround } = input
  const lowest = ground.all.reduce((low, area) => {
    const offset = area.relief?.offsetsMm.reduce((min, value) => Math.min(min, value), 0) ?? 0
    return Math.min(low, area.elevationMm + offset - (projection.rooms.includes(area) ? 235 : 0))
  }, blankGround ? 0 : Infinity)
  const top = (Number.isFinite(lowest) ? lowest : 0) - 2
  const { bounds } = projection, outline = rectangle(bounds)
  const thickness = Math.max(320, Math.min(2100, Math.max(bounds.width, bounds.height) * .036))
  const rim = top - thickness * .18, bed = top - thickness * .58
  mesh.solid({ mapBase: true, color: colorRgb('#6c5b45') }, outline, rim, top)
  mesh.solid({ mapBase: true, color: colorRgb('#51463b') }, outline, bed, rim, 800, false)
  mesh.solid({ mapBase: true, color: colorRgb('#403a34') }, outline, top - thickness, bed, 800, false)
}

export function addWorldSurfaces(input: SurfaceMeshes) {
  const { mesh, projection, ground, texture, temporaryCanvas, zOffset, blankGround, earthenSteps } = input
  const { bounds } = projection, uv = textureUv(bounds)
  const painted: MeshMaterial = { image: texture, unlit: true }
  const extent: Polygon = [ring(rectangle(bounds))]
  const risers = projection.connections.filter(row => !row.inlayFootprintMm && !row.carvedFootprintMm)
  const crossings: NonNullable<ProjectedSurface['regionsMm']> = risers.map(c => ({ outerMm: connectionBand(c.route?.centerlineMm ?? [c.start, c.end], c.widthMm), holesMm: [] }))
  const seen: MultiPolygon = crossings.filter(row => row.outerMm.length >= 3).map(row => [ring(row.outerMm)])
  const patchMeshes = [...projection.inlays ?? [], ...projection.rocks ?? []].flatMap(row => row.patches)
  for (const patch of patchMeshes) {
    const vertices = patch.pointsMm.map((p, i) => atHeight(p, zOffset + patch.elevationsMm[i]))
    for (let i = 1; i + 1 < vertices.length; i++) mesh.triangle(painted, [vertices[0], vertices[i], vertices[i + 1]],
      [uv(patch.pointsMm[0]), uv(patch.pointsMm[i]), uv(patch.pointsMm[i + 1])], [0, 0, 1])
  }
  const patchCut: MultiPolygon = patchMeshes.map(patch => [ring(patch.pointsMm)])
  const gradedRoads = visibleGradedRoads(projection)
  const roadCuts = gradedRoads.flatMap(road => road.polygons)
  for (const stairs of earthenSteps.values()) {
    // Keep a thin shared collar under the outer banks. The height on this
    // collar approaches the uncut relief and covers raster coverage seams.
    const margin = Math.min(95, stairs.lengthMm * .06)
    seen.push([ring(staircasePatch(stairs, margin, stairs.lengthMm - margin, -.455, .455))])
  }
  for (const area of ground.all) {
    const original = shape(area)
    const clipped = polygonClipping.intersection(extent, original)
    if (!clipped.length) continue
    const faces = seen.length ? polygonClipping.difference(clipped, ...seen.map(polygon => [polygon])) : clipped
    seen.push(...clipped)
    if (!faces.length) continue
    const tile = area.style?.base.tileSizeMm.width ?? 1050
    const wallPaint = paintStyle(input, area.style, area.waterSurface?.color ?? '#847861')
    // Room slabs show the exposed edge of the built floor. Terrain cliffs have
    // their own exact source/neighbor edges below.
    if (projection.rooms.includes(area)) for (const [outer] of faces.map(rings)) {
      for (let i = 0; i < outer.length; i++) mesh.side(wallPaint, outer[i], outer[(i + 1) % outer.length], zOffset + area.elevationMm - 235,
        zOffset + area.elevationMm - 235, zOffset + area.elevationMm, zOffset + area.elevationMm, tile)
    }
    if (!area.relief) {
      const visible = roadCuts.length ? polygonClipping.difference(faces, roadCuts) : faces
      for (const face of visible) mesh.cap(painted, rings(face), () => zOffset + area.elevationMm, uv)
      continue
    }
    const grid = area.relief, box = ground.boxes.get(area.id)!
    const coverage = fillMask(temporaryCanvas(1024, 1024), box, faces.map(rings))
    const material = { ...painted, coverage }
    const vertices = Array.from({ length: grid.rows }, (_, row) => Array.from({ length: grid.columns }, (_, col) => {
      const p = reliefGridPoint(grid, box, col, row)
      return { p, point: atHeight(p, zOffset + area.elevationMm + grid.offsetsMm[row * grid.columns + col]), uv: uv(p) }
    }))
    type Vertex = typeof vertices[number][number]
    const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
      const near = gradedRoads.length ? gradedRoads.filter(road => boxesMeet(reliefBounds([a.p, b.p, c.p]), road.box)) : []
      if (near.length) {
        for (const face of polygonClipping.difference([ring([a.p, b.p, c.p])], ...near.map(road => road.polygons))) {
          mesh.cap(material, rings(face), p => ground.elevation(area, p), uv)
        }
      } else mesh.triangle(material, [a.point, b.point, c.point], [a.uv, b.uv, c.uv], [0, 0, 1])
    }
    for (let row = 0; row < grid.rows - 1; row++) for (let col = 0; col < grid.columns - 1; col++) {
      const a = vertices[row][col], b = vertices[row][col + 1], c = vertices[row + 1][col + 1], d = vertices[row + 1][col]
      triangle(a, b, c)
      triangle(a, c, d)
    }
  }
  if (blankGround) for (const face of polygonClipping.difference(extent, ...seen.concat(patchCut, roadCuts).map(polygon => [polygon]))) {
    mesh.cap(painted, rings(face), () => zOffset, uv)
  }
  for (const rock of projection.rocks ?? []) {
    if (!rock.spatial) continue
    const style = ground.levels.get(rock.id)?.style
    const material = paintStyle(input, style, '#827561'), tile = style?.base.tileSizeMm.width ?? 1000
    for (const wall of rock.spatial.walls) {
      const { a, b, normal, highMm, lowMm } = wall
      const at = (direction: 0 | 1) => zOffset + lowMm[direction]
      const top = (direction: 0 | 1) => zOffset + highMm[direction]
      const reverse = (b.y - a.y) * normal.x - (b.x - a.x) * normal.y < 0
      if (reverse) mesh.side(material, b, a, at(1), at(0), top(1), top(0), tile)
      else mesh.side(material, a, b, at(0), at(1), top(0), top(1), tile)
    }
    for (const [a, b, c] of rock.spatial.shellFaces) {
      mesh.triangle(material, [atHeight(a, zOffset + a.z), atHeight(b, zOffset + b.z), atHeight(c, zOffset + c.z)],
        [[a.x / tile, (a.y - a.z) / tile], [b.x / tile, (b.y - b.z) / tile], [c.x / tile, (c.y - c.z) / tile]])
    }
  }
  const strata = stratifiedEdges(projection), strataColors = new Map<string, MeshMaterial>()
  const { courses, normals, vertexKey } = weatheredEdges(input)
  for (const edge of [...projection.edges, ...projection.spatialReliefEdges ?? []]) {
    const source = ground.levels.get(edge.sourceAreaId), neighbor = edge.neighborAreaId ? ground.levels.get(edge.neighborAreaId) : undefined
    if (!source || edge.elevationMm === edge.neighborElevationMm && !source.relief && !neighbor?.relief) continue
    const sourcePaint = edge.surfaceStyle ?? source.style, neighborPaint = edge.surfaceStyle ?? neighbor?.style ?? source.style
    const material = paintStyle(input, sourcePaint, '#776b5a'), reverseMaterial = paintStyle(input, neighborPaint, '#776b5a')
    const connected = crossings.concat(projection.bridgeEntrances?.flatMap(entry => entry.platform?.id === source.id ? entry.platform.edgeOpening : []) ?? [])
    const key = cliffCarrierKey(edge), look = strata.get(key), course = courses.get(key)
    const startNormal = normals.get(vertexKey(edge, edge.start)), endNormal = normals.get(vertexKey(edge, edge.end))
    const dx = edge.end.x - edge.start.x, dy = edge.end.y - edge.start.y, length = Math.hypot(dx, dy)
    const outward = (p: PointMm) => {
      const t = ((p.x - edge.start.x) * dx + (p.y - edge.start.y) * dy) / (length * length)
      const n = startNormal && endNormal ? { x: mix(startNormal.x, endNormal.x, t), y: mix(startNormal.y, endNormal.y, t) } : { x: dy, y: -dx }
      const magnitude = Math.hypot(n.x, n.y)
      return magnitude > .001 ? { x: n.x / magnitude, y: n.y / magnitude } : { x: dy / length, y: -dx / length }
    }
    for (const [a, b] of exposedEdgeSegments([[edge.start, edge.end]], connected)) {
      const count = course ? Math.min(32, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 480)) : 1
      for (const { p: first, q: last, reversed } of reliefEdgeSections(ground, source, neighbor, a, b, Math.max(1, count))) {
        const p = reversed ? last.p : first.p, q = reversed ? first.p : last.p
        const pz = reversed ? last.neighborZ : first.sourceZ, qz = reversed ? first.neighborZ : last.sourceZ
        const pl = reversed ? last.sourceZ : first.neighborZ, ql = reversed ? first.sourceZ : last.neighborZ
        const sidePaint = reversed ? reverseMaterial : material
        const tile = (reversed ? neighborPaint : sourcePaint)?.base.tileSizeMm.width ?? 1200
        if (course && !reversed) {
          if (course.look.opacity < 1) mesh.side(sidePaint, p, q, pl, ql, pz, qz, tile)
          addWeatheredCliff(input, edge, course, outward, p, q, pz, qz, pl, ql)
          continue
        }
        if (!look || look.opacity < 1) {
          mesh.side(sidePaint, p, q, pl, ql, pz, qz, tile)
          if (!look) continue
        }
        // Same beds as the map view, here projected onto the exact vertical wall.
        const rise = (Math.abs(pz - pl) + Math.abs(qz - ql)) / 2
        for (const piece of cliffStrata(look, p, q, rise)) {
          const color = strataColor(look, piece.tone + .09, piece.seam ? 1.01 : .94)
          const key = `${color}/${look.opacity}`
          if (!strataColors.has(key)) strataColors.set(key, { color: colorRgb(color), opacity: look.opacity, privacy: input.privacy })
          const [a, b, c, d] = piece.corners.map(({ x, y }) => atHeight({ x: mix(p.x, q.x, x), y: mix(p.y, q.y, x) },
            mix(mix(pz, qz, x), mix(pl, ql, x), y)))
          mesh.quad(strataColors.get(key)!, [d, c, b, a])
        }
      }
    }
  }
  for (const inlay of projection.inlays ?? []) for (const wall of inlay.walls) {
    const material = paintStyle(input, wall.lowSourceAreaId ? ground.levels.get(wall.lowSourceAreaId)?.style : null, '#776a5a')
    const { a, b, normal, highMm, lowMm } = wall
    if ((b.y - a.y) * normal.x - (b.x - a.x) * normal.y < 0) mesh.side(material, b, a, zOffset + lowMm[1], zOffset + lowMm[0], zOffset + highMm[1], zOffset + highMm[0])
    else mesh.side(material, a, b, zOffset + lowMm[0], zOffset + lowMm[1], zOffset + highMm[0], zOffset + highMm[1])
  }
  for (const row of risers) {
    if (row.kind === 'stairs' && !row.staircase && row.route?.stairStyle === 'naturalRock') {
      const route = usesWeatheredRockSteps(row.route.renderProfile) ? row.route : { ...row.route, renderProfile: ERODED_ROCK_STEPS_PROFILE }
      if (addWeatheredRockStairs(input, { ...row, route }, painted)) continue
    }
    const line = row.staircaseCenterlineMm ?? row.route?.centerlineMm ?? [row.start, row.end]
    const difference = row.toElevationMm - row.fromElevationMm
    const material = paintStyle(input, row.style, '#9e9580'), tile = row.style?.base.tileSizeMm.width ?? 720
    const startZ = zOffset + row.fromElevationMm
    if (row.kind === 'ramp') {
      const frame = connectionArcFrame(line)
      for (let i = 1; i < line.length; i++) {
        const band = corridor(line[i - 1], line[i], row.widthMm)
        const a = startZ + difference * frame.distances[i - 1] / frame.length + 4
        const b = startZ + difference * frame.distances[i] / frame.length + 4
        mesh.quad(material, [atHeight(band[0], a), atHeight(band[1], a), atHeight(band[2], b), atHeight(band[3], b)])
      }
    } else {
      const config = row.staircase ?? { ...defaultStaircase(), layout: { kind: 'repeat' as const, treadDepthMm: row.route?.treadDepthMm ?? 300 } }
      const staircase = planStaircase(line, row.widthMm, config)
      const lower = startZ + Math.min(0, difference) - 28
      const supports = row.surfaceIds?.map(id => ground.levels.get(id)) ?? []
      const fitted = config.preset === 'carved-rock' && supports.some(area => area?.relief) && difference !== 0
      const palette = staircaseMaterial(config.material).palette
      const stepColor = (factor: number) => material.color?.map(value => value * factor) as SpatialColor | undefined
      const riser = fitted ? { ...material, color: material.image ? stepColor(.82) : colorRgb(palette.shadow) } : material
      const stone = { ...material, color: fitted && !material.image ? colorRgb(palette.top) : stepColor(1.11) }
      if (fitted) {
        const { lengthMm, sections, treads } = staircase, sign = Math.sign(difference)
        const landingMm = Math.min(row.widthMm * .24, lengthMm * .09)
        const pointAt = (distanceMm: number, lane: number) => staircasePointAt(staircase, sign > 0 ? distanceMm : lengthMm - distanceMm, sign * lane)
        const stations = [...sections.map(row => row.distanceMm), ...treads.map(tread => tread.endMm)].map(distance => sign > 0 ? distance : lengthMm - distance)
        addRockStairBedding(input, { lengthMm, pointAt, stations, startMm: landingMm, endMm: lengthMm - landingMm }, lower + 28, lower + 28 + Math.abs(difference), painted, supports)
      } else mesh.cap(material, [connectionBand(line, row.widthMm)], () => lower, p => [p.x / tile, p.y / tile])
      for (const tread of staircase.treads) {
        const z = startZ + difference * (difference > 0 ? tread.endMm : tread.startMm) / staircase.lengthMm + 7
        const step = Math.abs(difference) * (tread.endMm - tread.startMm) / staircase.lengthMm
        mesh.solid(riser, tread.polygonMm, z - step - (fitted ? 85 : 15), z, tile, false)
        mesh.cap(stone, [tread.polygonMm], () => z, p => [p.x / tile, p.y / tile])
        if (fitted) continue
        for (const [a, b] of [[tread.frontMm[0], tread.rearMm[0]], [tread.rearMm[1], tread.frontMm[1]]]) {
          const edgeA = ground.groundAt(a), edgeB = ground.groundAt(b)
          const aZ = Math.max(z, edgeA), bZ = Math.max(z, edgeB)
          mesh.side(material, a, b, Math.min(lower, edgeA), Math.min(lower, edgeB), aZ, bZ, tile)
        }
      }
      if (config.range) {
        const first = staircasePointAt(staircase, staircase.treads[0].startMm), last = staircasePointAt(staircase, staircase.treads.at(-1)!.endMm)
        for (const [a, b] of [[row.start, first], [last, row.end]]) {
          if (Math.hypot(b.x - a.x, b.y - a.y) > .5) mesh.cap(painted, [corridor(a, b, row.widthMm)], p => ground.groundAt(p) + 5, uv)
        }
      }
    }
  }
  for (const row of projection.paths) if (row.bridge) {
    const bridge = row.bridge
    const z = zOffset + (bridge.relief?.elevationMm ?? ground.groundAt(bridge.centerlineMm[0]) - zOffset) + 12
    const tile = row.style?.base.tileSizeMm.width ?? 850
    const material = paintStyle(input, row.style, bridge.finish === 'steel' ? '#63777d' : '#a3825c')
    const bottom = z - (bridge.relief?.depthMm ?? 220)
    mesh.solid(material, bridge.outline, bottom, z, tile)
    for (const landing of bridge.structure?.landings ?? []) mesh.solid(material, landing.outline, z - (bridge.relief?.depthMm ?? 180), z, tile)
    if (bridge.finish === 'timber') {
      const frame = connectionArcFrame(bridge.centerlineMm), count = Math.max(2, Math.min(12, Math.ceil(frame.length / 2600)))
      const post = Math.min(220, bridge.widthMm * .14)
      for (let i = 0; i < count; i++) for (const side of [-1, 1]) {
        const station = frame.length * (.12 + .76 * i / (count - 1)), p = frame.at(station, side * bridge.widthMm * .32)
        if (!pointInPolygon(p, bridge.outline)) continue
        const support = ground.groundAt(p)
        if (bottom - support < 125) continue
        mesh.solid(material, rectangle({ x: p.x - post / 2, y: p.y - post / 2, width: post, height: post }), support - 20, bottom + 4, tile)
      }
    }
  } else if (row.stairs) {
    const earth = earthenSteps.get(row.id)
    if (earth) addEarthenRoad(input, row, earth, painted)
    else if (!earthenRoad(row)) addGroundTreads(input, planStaircase(row.stairs.centerlineMm, row.stairs.widthMm, row.stairs.config, row.stairs.widthSections), row.style,
      row.groundBlendMm ? staircaseMaterial(row.stairs.config.material).palette.shadow : undefined)
  }
  for (const row of projection.connections) if (row.inlayCenterlineMm && row.staircase) {
    addGroundTreads(input, planStaircase(row.inlayCenterlineMm, row.widthMm, row.staircase), row.style)
  }
  for (const road of gradedRoads) addGradedRoad(input, road, painted)
}

export function addWorldWalls(input: SurfaceMeshes, walls: readonly WallGeometry[]) {
  const { mesh, projection, ground, privacy } = input
  for (const { wall, polygons } of walls) {
    const { floor, fade } = spatialWallFrame(projection, ground, wall)
    const style = { ...paintStyle(input, wall.style, '#a99a7d'), wall: fade }
    const tile = wall.style?.base.tileSizeMm.width ?? 650
    const height = spatialWallHeight(wall)
    for (const polygon of polygons) mesh.solid(style, polygon, floor, floor + height, tile)
    for (const opening of wall.openings) {
      const width = wall.thicknessMm
      const frame: MeshMaterial = { color: colorRgb('#776049'), privacy, wall: fade }
      if (opening.vertical || wall.heightMm !== undefined) {
        const [bottom, top] = spatialOpeningRange(opening, height)
        const band = corridor(opening.start, opening.end, width)
        mesh.solid(style, band, floor, floor + bottom, tile)
        mesh.solid(style, band, floor + top, floor + height, tile)
        if (opening.kind === 'window' && opening.state === 'closed') {
          mesh.solid({ color: colorRgb('#567779'), privacy, wall: fade }, corridor(opening.start, opening.end, Math.min(45, width)),
            floor + bottom, floor + top)
        } else if (opening.kind === 'door' && opening.state === 'closed') {
          mesh.solid(frame, corridor(opening.start, opening.end, Math.min(65, width)), floor + bottom, floor + top)
        }
      } else if (opening.kind === 'window') {
        mesh.solid(style, corridor(opening.start, opening.end, width).reverse(), floor, floor + height * .54, tile)
        mesh.solid(frame, corridor(opening.start, opening.end, width * .8).reverse(), floor + height * .54, floor + height * .60)
        if (opening.state === 'closed') mesh.solid({ color: colorRgb('#567779'), privacy, wall: fade }, corridor(opening.start, opening.end, 45).reverse(),
          floor + height * .60, floor + height * .93)
        mesh.solid(frame, corridor(opening.start, opening.end, width * .65).reverse(), floor + height * .93, floor + height)
      } else {
        mesh.solid(frame, corridor(opening.start, opening.end, width * .94).reverse(), floor, floor + 24)
        if (opening.state === 'closed') mesh.solid(frame, corridor(opening.start, opening.end, 65).reverse(), floor + 24, floor + height * .95)
      }
    }
  }
}
