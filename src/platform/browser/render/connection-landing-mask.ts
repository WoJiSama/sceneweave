import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { connectionArcFrame } from '../../../shared/geometry/connection-route.js'

interface Station { distance: number; left: PointMm; right: PointMm }
const cross = (a: PointMm, b: PointMm) => a.x * b.y - a.y * b.x
const subtract = (a: PointMm, b: PointMm) => ({ x: a.x - b.x, y: a.y - b.y })

/** Cross-sections follow the physical band. Short segments can make them
 * intersect, so the caller must check them before treating them as cells. */
function stations(points: PointMm[], widthMm: number, depthMm: number): Station[] {
  const frame = connectionArcFrame(points), distances = [0, ...frame.distances.filter(d => d > 0 && d < depthMm), depthMm]
  const centers = distances.map(distance => ({ point: frame.at(distance), distance }))
  const reduced: typeof centers = []
  for (const row of centers) {
    while (reduced.length >= 2) {
      const a = reduced.at(-2)!.point, b = reduced.at(-1)!.point, c = row.point
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      if (Math.abs(cross) > 1e-7 || (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) <= 0) break
      reduced.pop()
    }
    reduced.push(row)
  }
  const directions = reduced.slice(1).map((row, i) => {
    const a = reduced[i].point, length = Math.hypot(row.point.x - a.x, row.point.y - a.y)
    return { x: (row.point.x - a.x) / length, y: (row.point.y - a.y) / length }
  })
  const half = widthMm / 2, rows: Station[] = []
  reduced.forEach(({ point, distance }, i) => {
    const before = directions[Math.max(0, i - 1)], after = directions[Math.min(directions.length - 1, i)]
    const add = (offset: PointMm, center = point, station = distance) => rows.push({ distance: station,
      left: { x: center.x + offset.x, y: center.y + offset.y }, right: { x: center.x - offset.x, y: center.y - offset.y } })
    const denominator = 1 + before.x * after.x + before.y * after.y
    const offset = { x: -(before.y + after.y) * half / denominator, y: (before.x + after.x) * half / denominator }
    const miterLength = denominator > 1e-12 ? Math.hypot(offset.x, offset.y) : Number.POSITIVE_INFINITY
    const miter = miterLength <= 2 * half + 1e-7
    // A perpendicular section must lie beyond the miter's tangential reach.
    // Placing it at exactly half-width folds the inside of a right-angle join.
    const reach = miter ? Math.abs(offset.x * before.x + offset.y * before.y) : half
    if (i > 0 && i < reduced.length - 1) {
      const lead = Math.min(reach + half, (distance - reduced[i - 1].distance) / 2)
      if (lead > reach + 1e-7) add({ x: -before.y * half, y: before.x * half },
        { x: point.x - before.x * lead, y: point.y - before.y * lead }, distance - lead)
    }
    if (miter) add(offset)
    else { add({ x: -before.y * half, y: before.x * half }); add({ x: -after.y * half, y: after.x * half }) }
    if (i > 0 && i < reduced.length - 1) {
      const trail = Math.min(reach + half, (reduced[i + 1].distance - distance) / 2)
      if (trail > reach + 1e-7) add({ x: -after.y * half, y: after.x * half },
        { x: point.x + after.x * trail, y: point.y + after.y * trail }, distance + trail)
    }
  })
  return rows
}

function convexCells(rows: Station[]): boolean {
  const cells = rows.slice(1).map((row, i) => [rows[i].left, row.left, row.right, rows[i].right])
  for (let i = 1; i < rows.length; i++) {
    const ring = cells[i - 1]
    // These four turns are also the corner Jacobians of the bilinear cell.
    const turns = ring.map((p, j) => cross(subtract(ring[(j + 1) % 4], p), subtract(ring[(j + 2) % 4], ring[(j + 1) % 4])))
    if (!turns.every(value => value > 1e-7) && !turns.every(value => value < -1e-7)) return false
  }
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j], r = subtract(a.right, a.left), s = subtract(b.right, b.left), d = subtract(b.left, a.left)
    const denominator = cross(r, s)
    if (Math.abs(denominator) < 1e-9) continue
    const u = cross(d, s) / denominator, v = cross(d, r) / denominator
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return false
  }
  // Disjoint cross-sections alone do not exclude overlapping nonadjacent
  // cells. A strict separating axis check also catches side-edge crossings.
  const overlap = (a: PointMm[], b: PointMm[]) => [...a, ...b].every((p, i) => {
    const ring = i < 4 ? a : b, next = ring[(i + 1) % 4], axis = { x: p.y - next.y, y: next.x - p.x }
    const first = a.map(p => p.x * axis.x + p.y * axis.y), second = b.map(p => p.x * axis.x + p.y * axis.y)
    return Math.min(Math.max(...first), Math.max(...second)) - Math.max(Math.min(...first), Math.min(...second)) > 1e-7
  })
  for (let i = 0; i < cells.length; i++) for (let j = i + 2; j < cells.length; j++) if (overlap(cells[i], cells[j])) return false
  return true
}

function pixels(image: ImageData, ring: PointMm[], paint: (x: number, y: number) => number | undefined): void {
  const minX = Math.max(0, Math.floor(Math.min(...ring.map(p => p.x)) - 1)), maxX = Math.min(image.width - 1, Math.ceil(Math.max(...ring.map(p => p.x)) + 1))
  const minY = Math.max(0, Math.floor(Math.min(...ring.map(p => p.y)) - 1)), maxY = Math.min(image.height - 1, Math.ceil(Math.max(...ring.map(p => p.y)) + 1))
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const opacity = paint(x + .5, y + .5)
    if (opacity !== undefined) image.data[(y * image.width + x) * 4 + 3] = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
  }
}

/** Invert the ruled cell instead of interpolating two triangles: triangulation
 * shifts the station even on the centerline next to an oblique miter section. */
function cell(image: ImageData, a: Station, b: Station, opacity: (distance: number, across: number) => number): void {
  const along = subtract(b.left, a.left), lateral = subtract(a.right, a.left)
  const warp = subtract(subtract(b.right, b.left), lateral)
  const A = -cross(along, warp), determinant = cross(along, lateral)
  const centerSpan = Math.hypot((b.left.x + b.right.x - a.left.x - a.right.x) / 2, (b.left.y + b.right.y - a.left.y - a.right.y) / 2)
  const sideTolerance = .75 / Math.min(Math.hypot(lateral.x, lateral.y), Math.hypot(b.right.x - b.left.x, b.right.y - b.left.y))
  pixels(image, [a.left, b.left, b.right, a.right], (x, y) => {
    const p = { x: x - a.left.x, y: y - a.left.y }, B = cross(p, warp) - determinant, C = cross(p, lateral)
    const discriminant = B * B - 4 * A * C
    if (discriminant < 0) return
    // The stable quadratic root avoids cancellation on nearly straight cells.
    const q = -.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(discriminant))
    const candidates = Math.abs(A) < 1e-9 ? [-C / B] : [q / A, C / q]
    for (const rawU of candidates) {
      const capTolerance = a.distance === 0 ? .75 / Math.max(1, centerSpan) : 1e-7
      if (!Number.isFinite(rawU) || rawU < -capTolerance || rawU > 1 + 1e-7) continue
      const u = Math.max(0, Math.min(1, rawU)), side = { x: lateral.x + warp.x * u, y: lateral.y + warp.y * u }
      const v = ((p.x - along.x * u) * side.x + (p.y - along.y * u) * side.y) / (side.x * side.x + side.y * side.y)
      if (v < -sideTolerance || v > 1 + sideTolerance) continue
      if (Math.hypot(p.x - along.x * u - side.x * v, p.y - along.y * u - side.y * v) > .75 + 1e-7) continue
      return opacity(a.distance + (b.distance - a.distance) * u, Math.max(0, Math.min(1, v)))
    }
  })
}

function sectionDistanceSquared(p: PointMm, row: Station): number {
  const side = subtract(row.right, row.left), offset = subtract(p, row.left)
  const t = Math.max(0, Math.min(1, (offset.x * side.x + offset.y * side.y) / (side.x * side.x + side.y * side.y)))
  return (offset.x - side.x * t) ** 2 + (offset.y - side.y * t) ** 2
}

/** A legal short route can have intersecting cap/join sections. There is no
 * field that gives their intersection both station 0 and the bend's station.
 * Use a continuous distance-weighted field, giving the physical cap priority.
 * The caller has already clipped the support and mask to the partial landing
 * and complete corridor, so this bounded raster pass needs no second polygon
 * fill rule for a potentially self-crossing section envelope. */
function conflictingSections(image: ImageData, rows: Station[], worldRows: Station[], bounds: BoundsMm,
  opacity: (distance: number, across: number) => number): void {
  const ring = [...rows.map(row => row.left), ...rows.map(row => row.right).reverse()]
  const worldPoint = (x: number, y: number): PointMm => ({ x: bounds.x + x * bounds.width / image.width, y: bounds.y + y * bounds.height / image.height })
  pixels(image, ring, (x, y) => {
    const p = worldPoint(x, y), cap = worldRows[0]
    const capDistance = sectionDistanceSquared(p, cap)
    const singularitySquared = 1e-8
    if (capDistance <= singularitySquared) {
      const side = subtract(cap.right, cap.left), offset = subtract(p, cap.left)
      const across = (offset.x * side.x + offset.y * side.y) / (side.x * side.x + side.y * side.y)
      return opacity(0, Math.max(0, Math.min(1, across)))
    }
    const capSide = subtract(cap.right, cap.left), capOffset = subtract(p, cap.left)
    const capAcross = Math.max(0, Math.min(1, (capOffset.x * capSide.x + capOffset.y * capSide.y) / (capSide.x * capSide.x + capSide.y * capSide.y)))
    let distanceSum = 0, acrossSum = capAcross / capDistance, weights = 1 / capDistance
    for (let i = worldRows.length - 1; i > 0; i--) {
      const row = worldRows[i], distance = sectionDistanceSquared(p, row)
      const side = subtract(row.right, row.left), offset = subtract(p, row.left)
      const across = Math.max(0, Math.min(1, (offset.x * side.x + offset.y * side.y) / (side.x * side.x + side.y * side.y)))
      // Preserve exact section stations even where several finite sections
      // cross; in particular the terminal section remains exactly depthMm.
      if (distance <= singularitySquared) return opacity(row.distance, across)
      const weight = 1 / distance
      distanceSum += row.distance * weight
      acrossSum += across * weight
      weights += weight
    }
    return opacity(distanceSum / weights, acrossSum / weights)
  })
}

/** A disposable, bounded pixel mask; no geometry, viewport or pixels persist. */
export function paintConnectionLandingMask(ctx: CanvasRenderingContext2D, bounds: BoundsMm, connection: ProjectedConnection,
  end: 'start' | 'end', depthMm: number, naturalRock = false): void {
  const width = ctx.canvas.width, height = ctx.canvas.height
  if (width * height > 16_777_216) throw new Error('连接局部绘制超过16M像素预算。')
  const points = end === 'start' ? connection.route!.centerlineMm : [...connection.route!.centerlineMm].reverse()
  const worldRows = stations(points, connection.widthMm, depthMm), image = ctx.createImageData(width, height)
  const toPixel = (p: PointMm) => ({ x: (p.x - bounds.x) * width / bounds.width, y: (p.y - bounds.y) * height / bounds.height })
  const rows = worldRows.map(row => ({ distance: row.distance, left: toPixel(row.left), right: toPixel(row.right) }))
  const lowerEnd = end === 'start' ? connection.fromElevationMm < connection.toElevationMm : connection.toElevationMm < connection.fromElevationMm
  const opacity = (distance: number, fraction: number): number => {
    const across = fraction * 2 - 1
    // Keep a short fully supported cap and the irregular edge fade. A final
    // taper makes even the widest edge reach zero at the terminal station,
    // avoiding a clipped slab while leaving the useful side break intact.
    const irregularity = Math.sin(fraction * 12 * 2.1 + (lowerEnd ? .4 : 1.8)) * .075
    const reach = depthMm * Math.min(1, .7 + Math.abs(across) * .3 + irregularity)
    if (!naturalRock) return 1 - distance / depthMm
    const capOffset = depthMm * .08
    const base = Math.sqrt(Math.max(0, Math.min(1, 1 - Math.max(0, distance - capOffset) / reach)))
    const terminalTaper = 1 - Math.min(1, Math.max(0, (distance - depthMm * .92) / (depthMm * .08)))
    return base * terminalTaper
  }
  if (convexCells(rows)) for (let i = 1; i < rows.length; i++) cell(image, rows[i - 1], rows[i], opacity)
  else conflictingSections(image, rows, worldRows, bounds, opacity)
  ctx.putImageData(image, 0, 0)
}
