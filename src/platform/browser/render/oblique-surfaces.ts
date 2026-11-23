import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { connectionBand, corridor, pointInPolygon } from '../../../shared/geometry/geometry.js'
import { reliefBounds, reliefGridPoint, sampleTerrainRelief } from '../../../shared/geometry/terrain-relief.js'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'
import { playerMaskRings } from '../../../shared/projection/player-mask.js'
import { planStaircase, staircasePointAt } from '../../../shared/stairs/geometry.js'
import { defaultStaircase } from '../../../shared/stairs/contracts.js'
import type { BoundsMm, PointMm, SurfaceStyle } from '../../../shared/model/scene.js'
import type { ProjectedSurface, Projection } from '../../../shared/projection/types.js'
import type { StaircaseGeometry } from '../../../shared/stairs/geometry.js'
import { exposedEdgeSegments } from '../../../shared/projection/bridge-entrances.js'
import { atHeight, rectangle, type MeshMask, type MeshMaterial, type ObliqueMesh, type SpatialColor } from './oblique-mesh'
import { wallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'

const rings = (polygon: Polygon) => polygon.map(ring => {
  const closed = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
  return ring.slice(0, closed ? -1 : undefined).map(([x, y]) => ({ x, y }))
})
const ring = (points: PointMm[]) => points.map(({ x, y }): [number, number] => [x, y])
const shape = (area: ProjectedSurface): MultiPolygon => area.regionsMm?.map(row => [ring(row.outerMm), ...row.holesMm.map(ring)]) ?? [[ring(area.points)]]
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const midpoint = (a: PointMm, b: PointMm) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const inside = (p: PointMm, area: ProjectedSurface) => area.regionsMm
  ? area.regionsMm.some(row => pointInPolygon(p, row.outerMm) && !row.holesMm.some(hole => pointInPolygon(p, hole)))
  : pointInPolygon(p, area.points)
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

export function projectGround(projection: Projection, zOffset: number) {
  const all = [...projection.terrain.filter(area => !area.bridgeSupport), ...projection.rooms].reverse()
  const levels = new Map(all.map(area => [area.id, area]))
  const boxes = new Map(all.filter(area => area.relief).map(area => [area.id, reliefBounds(area.points)]))
  const elevation = (area: ProjectedSurface | undefined, p: PointMm) =>
    zOffset + (area?.elevationMm ?? 0) + (area?.relief ? sampleTerrainRelief(area.relief, boxes.get(area.id)!, p).offsetMm : 0)
  const patches = [...projection.inlays ?? [], ...projection.rocks ?? []].flatMap(row => row.patches).map(patch => ({
    ...patch, bounds: reliefBounds(patch.pointsMm),
  }))
  const groundAt = (p: PointMm) => {
    const patch = patches.find(({ pointsMm, bounds }) => p.x >= bounds.x && p.x <= bounds.x + bounds.width
      && p.y >= bounds.y && p.y <= bounds.y + bounds.height && pointsMm.length === 3 && pointInPolygon(p, pointsMm))
    if (patch) {
      const [a, b, c] = patch.pointsMm, [za, zb, zc] = patch.elevationsMm
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - a.x, vy = c.y - a.y
      const px = p.x - a.x, py = p.y - a.y, area = ux * vy - uy * vx
      if (area) return zOffset + za + (zb - za) * (px * vy - py * vx) / area + (zc - za) * (ux * py - uy * px) / area
    }
    return elevation(all.find(area => inside(p, area)), p)
  }
  return { all, levels, boxes, elevation, groundAt }
}

export interface SurfaceMeshes {
  mesh: ObliqueMesh
  projection: Projection
  texture: HTMLCanvasElement
  images: ReadonlyMap<string, ImageBitmap>
  privacy?: MeshMask
  zOffset: number
  blankGround: boolean
  temporaryCanvas: NewCanvas
  ground: ReturnType<typeof projectGround>
}

function paintStyle(input: SurfaceMeshes, style: SurfaceStyle | null | undefined, fallback: string): MeshMaterial {
  const paint = style?.base, textureId = paint && input.projection.materials[paint.materialRef.id]?.textureAssetId
  const image = textureId ? input.images.get(textureId) : undefined
  return { image, color: colorRgb(paint?.tint ?? (image ? '#ffffff' : fallback)), repeat: !!image, privacy: input.privacy }
}

function addGroundTreads(input: SurfaceMeshes, stair: StaircaseGeometry, style: SurfaceStyle | null) {
  const { mesh, ground } = input
  const material = paintStyle(input, style, '#9A907B'), tile = style?.base.tileSizeMm.width ?? 760
  const paintMasks = stair.covers.map(cover => [ring(cover.polygonMm)])
  for (const tread of stair.treads) {
    const points = tread.polygonMm, foot = midpoint(tread.frontMm[0], tread.frontMm[1]), head = midpoint(tread.rearMm[0], tread.rearMm[1])
    const lo = Math.min(ground.groundAt(foot), ground.groundAt(head)), hi = Math.max(ground.groundAt(foot), ground.groundAt(head)) + 25
    const visible = paintMasks.length ? polygonClipping.difference([ring(points)], ...paintMasks) : [[ring(points)]]
    for (const polygon of visible) {
      const ringsMm = rings(polygon)
      mesh.cap(material, ringsMm, () => hi, p => [p.x / tile, p.y / tile])
      for (const outline of ringsMm) for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length]
        mesh.side(material, a, b, Math.min(lo, ground.groundAt(a)), Math.min(lo, ground.groundAt(b)), hi, hi, tile)
      }
    }
  }
}

export function addWorldSurfaces(input: SurfaceMeshes) {
  const { mesh, projection, ground, texture, temporaryCanvas, zOffset, blankGround } = input
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
      for (const face of faces) mesh.cap(painted, rings(face), () => zOffset + area.elevationMm, uv)
      continue
    }
    const grid = area.relief, box = ground.boxes.get(area.id)!
    const coverage = fillMask(temporaryCanvas(1024, 1024), box, faces.map(rings))
    const material = { ...painted, coverage }
    const vertices = Array.from({ length: grid.rows }, (_, row) => Array.from({ length: grid.columns }, (_, col) => {
      const p = reliefGridPoint(grid, box, col, row)
      return { point: atHeight(p, zOffset + area.elevationMm + grid.offsetsMm[row * grid.columns + col]), uv: uv(p) }
    }))
    for (let row = 0; row < grid.rows - 1; row++) for (let col = 0; col < grid.columns - 1; col++) {
      const a = vertices[row][col], b = vertices[row][col + 1], c = vertices[row + 1][col + 1], d = vertices[row + 1][col]
      mesh.triangle(material, [a.point, b.point, c.point], [a.uv, b.uv, c.uv], [0, 0, 1])
      mesh.triangle(material, [a.point, c.point, d.point], [a.uv, c.uv, d.uv], [0, 0, 1])
    }
  }
  if (blankGround) for (const face of polygonClipping.difference(extent, ...seen.concat(patchCut).map(polygon => [polygon]))) {
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
  } else if (row.stairs) addGroundTreads(input, planStaircase(row.stairs.centerlineMm, row.stairs.widthMm, row.stairs.config, row.stairs.widthSections), row.style)
  for (const row of projection.connections) if (row.inlayCenterlineMm && row.staircase) {
    addGroundTreads(input, planStaircase(row.inlayCenterlineMm, row.widthMm, row.staircase), row.style)
  }
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
