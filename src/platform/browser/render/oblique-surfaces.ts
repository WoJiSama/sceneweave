import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { connectionBand, corridor, pointInPolygon, polygonDistance, polygonsOverlap, segmentCuts } from '../../../shared/geometry/geometry.js'
import { reliefBounds, reliefGridPoint } from '../../../shared/geometry/terrain-relief.js'
import { roadSpanTriangles, type RoadVertex } from '../../../shared/geometry/road-surface.js'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'
import { playerMaskRings } from '../../../shared/projection/player-mask.js'
import { planStaircase, staircasePatch, staircasePointAt } from '../../../shared/stairs/geometry.js'
import { defaultStaircase } from '../../../shared/stairs/contracts.js'
import { staircaseMaterial } from '../../../shared/stairs/catalog.js'
import type { BoundsMm, PointMm, SurfaceStyle } from '../../../shared/model/scene.js'
import type { ProjectedPath, ProjectedSurface, Projection } from '../../../shared/projection/types.js'
import type { StaircaseGeometry } from '../../../shared/stairs/geometry.js'
import { exposedEdgeSegments } from '../../../shared/projection/bridge-entrances.js'
import { atHeight, rectangle, type MeshMask, type MeshMaterial, type ObliqueMesh, type SpatialColor } from './oblique-mesh'
import { wallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'
import { projectGround } from './projected-ground.js'
import { earthenRoad, planEarthenRoad } from './earthen-road.js'
import { gradedRiserPalette } from './graded-road-paint.js'

const rings = (polygon: Polygon) => polygon.map(ring => {
  const closed = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
  return ring.slice(0, closed ? -1 : undefined).map(([x, y]) => ({ x, y }))
})
const ring = (points: PointMm[]) => points.map(({ x, y }): [number, number] => [x, y])
const shape = (area: ProjectedSurface): MultiPolygon => area.regionsMm?.map(row => [ring(row.outerMm), ...row.holesMm.map(ring)]) ?? [[ring(area.points)]]
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
  for (const edge of projection.edges) {
    const source = ground.levels.get(edge.sourceAreaId), neighbor = edge.neighborAreaId ? ground.levels.get(edge.neighborAreaId) : undefined
    if (!source || edge.elevationMm === edge.neighborElevationMm && !source.relief && !neighbor?.relief) continue
    const material = paintStyle(input, edge.surfaceStyle ?? source.style, '#776b5a')
    const connected = crossings.concat(projection.bridgeEntrances?.flatMap(entry => entry.platform?.id === source.id ? entry.platform.edgeOpening : []) ?? [])
    for (const [a, b] of exposedEdgeSegments([[edge.start, edge.end]], connected)) {
      const count = source.relief || neighbor?.relief ? Math.min(32, Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 480))) : 1
      const at = (i: number): PointMm => ({ x: mix(a.x, b.x, i / count), y: mix(a.y, b.y, i / count) })
      const da = ground.elevation(source, a) - ground.elevation(neighbor, a)
      const db = ground.elevation(source, b) - ground.elevation(neighbor, b)
      if (!da && !db && count === 1) continue
      for (let i = 0; i < count; i++) {
        const p = at(i), q = at(i + 1), pz = ground.elevation(source, p), qz = ground.elevation(source, q),
          pl = ground.elevation(neighbor, p), ql = ground.elevation(neighbor, q)
        if (Math.max(Math.abs(pz - pl), Math.abs(qz - ql)) < 32) continue
        mesh.side(material, p, q, pl, ql, pz, qz, source.style?.base.tileSizeMm.width ?? 1200)
      }
    }
  }
  for (const inlay of projection.inlays ?? []) for (const wall of inlay.walls) {
    const material = paintStyle(input, wall.lowSourceAreaId ? ground.levels.get(wall.lowSourceAreaId)?.style : null, '#776a5a')
    mesh.side(material, wall.a, wall.b, zOffset + wall.lowMm[0], zOffset + wall.lowMm[1], zOffset + wall.highMm[0], zOffset + wall.highMm[1])
  }
  for (const row of risers) {
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
      const stone = { ...material, color: material.color?.map(value => value * 1.11) as SpatialColor | undefined }
      mesh.cap(material, [connectionBand(line, row.widthMm)], () => lower, p => [p.x / tile, p.y / tile])
      for (const tread of staircase.treads) {
        const z = startZ + difference * (difference > 0 ? tread.endMm : tread.startMm) / staircase.lengthMm + 7
        const step = Math.abs(difference) * (tread.endMm - tread.startMm) / staircase.lengthMm
        mesh.solid(material, tread.polygonMm, z - step - 15, z, tile, false)
        mesh.cap(stone, [tread.polygonMm], () => z, p => [p.x / tile, p.y / tile])
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
    mesh.solid(material, bridge.outline, z - (bridge.relief?.depthMm ?? 220), z, tile)
    for (const landing of bridge.structure?.landings ?? []) mesh.solid(material, landing.outline, z - (bridge.relief?.depthMm ?? 180), z, tile)
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

export function addWorldWalls(input: SurfaceMeshes) {
  const { mesh, projection, ground, privacy } = input
  for (const { wall, polygons } of wallGeometry(projection.walls)) {
    const center = midpoint(wall.start, wall.end)
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, span = Math.hypot(dx, dy)
    const nx = -dy / span, ny = dx / span, distance = wall.thicknessMm / 2 + 8
    const neighbours = [-1, 1].map(side => projection.rooms.find(room => pointInPolygon({ x: center.x + nx * distance * side, y: center.y + ny * distance * side }, room.points)))
    const singleRoom = Number(!!neighbours[0]) + Number(!!neighbours[1]) === 1
    const sign = neighbours[0] ? 1 : -1, nearSide = { x: nx * sign, y: ny * sign }
    const fade = singleRoom ? { center, nearSide } : undefined
    const style = { ...paintStyle(input, wall.style, '#a99a7d'), wall: fade }
    const tile = wall.style?.base.tileSizeMm.width ?? 650
    const room = neighbours[0] ?? neighbours[1]
    const floor = room ? ground.elevation(room, center) : ground.groundAt(center)
    const height = Math.max(1050, Math.min(2000, wall.thicknessMm * 5.5))
    for (const polygon of polygons) mesh.solid(style, polygon, floor, floor + height, tile)
    for (const opening of wall.openings) {
      const width = wall.thicknessMm
      const frame: MeshMaterial = { color: colorRgb('#776049'), privacy, wall: fade }
      if (opening.kind === 'window') {
        mesh.solid(style, corridor(opening.start, opening.end, width).reverse(), floor, floor + height * .54, tile)
        mesh.solid(frame, corridor(opening.start, opening.end, width * .8).reverse(), floor + height * .54, floor + height * .60)
        mesh.solid({ color: colorRgb('#567779'), privacy, wall: fade }, corridor(opening.start, opening.end, 45).reverse(),
          floor + height * .60, floor + height * .93)
        mesh.solid(frame, corridor(opening.start, opening.end, width * .65).reverse(), floor + height * .93, floor + height)
      } else {
        mesh.solid(frame, corridor(opening.start, opening.end, width * .94).reverse(), floor, floor + 24)
        if (opening.state === 'closed') mesh.solid(frame, corridor(opening.start, opening.end, 65).reverse(), floor + 24, floor + height * .95)
      }
    }
  }
}
