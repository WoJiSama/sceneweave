import { transformAttachmentPoint } from '../../../shared/attachments/contact.js'
import { corridor } from '../../../shared/geometry/geometry.js'
import { createRoadSurfaceSampler } from '../../../shared/geometry/road-surface.js'
import { reliefBounds } from '../../../shared/geometry/terrain-relief.js'
import type { WallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'
import { spatialOpeningRange, spatialWallHeight } from '../../../shared/model/building-height.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { Projection } from '../../../shared/projection/types.js'
import { playerMaskContains } from '../../../shared/projection/player-mask.js'
import { directionToLight } from '../../../shared/visual/directional-light.js'
import { rectangle, type MeshMask, type SpatialPoint } from './oblique-mesh.js'
import { projectGround, spatialWallFrame } from './projected-ground.js'

interface ShadowSolid { ring: PointMm[]; bottom: number; top: number }
const SHADOW_EDGE = 512
const RASTER_SAMPLE_BUDGET = 12_000_000
const ellipse = (center: PointMm, width: number, height: number, count: number): PointMm[] => Array.from({ length: count }, (_, i) => {
  const angle = 2 * Math.PI * i / count
  return { x: center.x + Math.cos(angle) * width / 2, y: center.y + Math.sin(angle) * height / 2 }
})

function shadowSolids(projection: Projection, ground: ReturnType<typeof projectGround>, walls: readonly WallGeometry[]) {
  const solids: ShadowSolid[] = []
  const solid = (ring: PointMm[], bottom: number, top: number) => {
    if (top - bottom > 20) solids.push({ ring, bottom, top })
  }
  for (const { wall, polygons } of walls) {
    if (wall.blocksLight === false) continue
    const { floor } = spatialWallFrame(projection, ground, wall), height = spatialWallHeight(wall)
    for (const polygon of polygons) solid(polygon, floor, floor + height)
    for (const opening of wall.openings) {
      const band = corridor(opening.start, opening.end, wall.thicknessMm)
      const legacy = !opening.vertical && wall.heightMm === undefined
      const [sill, head] = spatialOpeningRange(opening, height)
      if (!legacy || opening.kind === 'window') {
        solid(band, floor, floor + (legacy ? height * .60 : sill))
        solid(band, floor + head, floor + height)
      }
      if (opening.state === 'closed') {
        const panel = corridor(opening.start, opening.end, Math.min(wall.thicknessMm, opening.kind === 'window' ? 45 : 65))
        solid(panel, floor + sill, floor + head)
      }
    }
  }
  for (const prop of projection.props) {
    const volume = projection.propVolumes?.[prop.id]
    if (!volume || volume.kind === 'flat' || volume.heightMm < 40 || prop.shadowClass === 'none' || prop.shadowOverride?.opacity === 0
      || prop.appearance.opacity < .22 || prop.waterAppearance && prop.waterAppearance.mode !== 'surface') continue
    const { baseMm, heightMm, kind } = volume
    const pose = (p: PointMm) => transformAttachmentPoint(p, prop.positionMm, prop.rotationDeg)
    const top = baseMm + heightMm
    const { x, y, width, height } = prop.visualBoundsMm
    const center = { x: x + width / 2, y: y + height / 2 }
    if (kind === 'tree') {
      const trunkWidth = Math.max(190, Math.min(width, height) * .16)
      solid(ellipse({ x: 0, y: 0 }, trunkWidth, trunkWidth, 6).map(pose), baseMm, top - heightMm * .24)
      solid(ellipse(center, width * .8, height * .8, 10).map(pose), baseMm + heightMm * .55, baseMm + heightMm * .82)
      solid(ellipse(center, width * .56, height * .56, 8).map(pose), baseMm + heightMm * .82, top)
      continue
    }
    const { footprintMm, footprintOffsetMm } = prop
    const footprint = { x: footprintOffsetMm.x - footprintMm.width / 2, y: footprintOffsetMm.y - footprintMm.height / 2, ...footprintMm }
    const round = kind === 'round' || kind === 'rock' || kind === 'lamp'
    const ring = round ? ellipse(footprintOffsetMm, footprint.width, footprint.height, 8) : rectangle(footprint)
    const raisedTop = kind === 'table' || kind === 'seat' || kind === 'rail'
    solid(ring.map(pose), raisedTop ? top - Math.min(130, heightMm * .28) : baseMm, top)
  }
  return solids
}

// Every point on the same light ray has the same shear-space coordinates.
// Keep the highest blocker on that ray and compare it with the receiving height.
function shadowDepth(solids: readonly ShadowSolid[], projection: Projection, shiftX: number, shiftY: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let work = 0
  for (const { ring, bottom, top } of solids) {
    let left = Infinity, topY = Infinity, right = -Infinity, bottomY = -Infinity
    for (const p of ring) for (const z of [bottom, top]) {
      const x = p.x + z * shiftX, y = p.y + z * shiftY
      left = Math.min(left, x); right = Math.max(right, x)
      topY = Math.min(topY, y); bottomY = Math.max(bottomY, y)
    }
    minX = Math.min(minX, left); maxX = Math.max(maxX, right)
    minY = Math.min(minY, topY); maxY = Math.max(maxY, bottomY)
    work += (right - left) * (bottomY - topY) * (3 * ring.length - 2)
  }
  // Dense stacks can cover the same pixels many times. Limit the estimated
  // triangle-raster work by lowering only the shadow depth resolution.
  const step = Math.max(Math.max(maxX - minX, maxY - minY, projection.bounds.width, projection.bounds.height) / SHADOW_EDGE,
    Math.sqrt(work / RASTER_SAMPLE_BUDGET))
  minX -= step * 2; minY -= step * 2
  const width = Math.ceil((maxX - minX) / step) + 3, height = Math.ceil((maxY - minY) / step) + 3
  const depths = new Float32Array(width * height).fill(-Infinity)
  const gridX = (x: number, z: number) => (x + z * shiftX - minX) / step
  const gridY = (y: number, z: number) => (y + z * shiftY - minY) / step
  const point = (p: PointMm, z: number): SpatialPoint => [gridX(p.x, z), gridY(p.y, z), z]
  const masks = projection.audience === 'player' ? projection.masks : []
  const triangle = (a: SpatialPoint, b: SpatialPoint, c: SpatialPoint) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1]
    const det = ux * vy - uy * vx
    if (Math.abs(det) < 1e-8) return
    const nearX = Math.max(0, Math.ceil(Math.min(a[0], b[0], c[0]) - .5)), farX = Math.min(width - 1, Math.floor(Math.max(a[0], b[0], c[0]) - .5))
    const nearY = Math.max(0, Math.ceil(Math.min(a[1], b[1], c[1]) - .5)), farY = Math.min(height - 1, Math.floor(Math.max(a[1], b[1], c[1]) - .5))
    for (let y = nearY; y <= farY; y++) {
      const py = y + .5 - a[1]
      for (let x = nearX; x <= farX; x++) {
        const px = x + .5 - a[0]
        const u = (px * vy - py * vx) / det, v = (ux * py - uy * px) / det
        if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue
        const z = a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]), i = y * width + x
        if (z <= depths[i]) continue
        if (masks.length && playerMaskContains({ x: minX + (x + .5) * step - z * shiftX, y: minY + (y + .5) * step - z * shiftY }, masks, projection.maskPublicRooms)) continue
        depths[i] = z
      }
    }
  }
  const add = ({ ring, bottom, top }: ShadowSolid) => {
    const low = ring.map(p => point(p, bottom)), high = ring.map(p => point(p, top))
    for (let i = 2; i < ring.length; i++) triangle(high[0], high[i - 1], high[i])
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length
      triangle(low[i], low[j], high[j]); triangle(low[i], high[j], high[i])
    }
  }
  const sample = (p: PointMm, z: number, softness: number) => {
    const x = Math.floor(gridX(p.x, z)), y = Math.floor(gridY(p.y, z))
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return 0
    const i = y * width + x, threshold = z + Math.max(25, step * .24)
    const hit = Number(depths[i] > threshold)
    const nearby = Number(depths[i - 1] > threshold) + Number(depths[i + 1] > threshold)
      + Number(depths[i - width] > threshold) + Number(depths[i + width] > threshold)
    return hit * (1 - softness) + nearby * softness * .25
  }
  return { add, sample }
}

function receivers(canvas: HTMLCanvasElement, projection: Projection, ground: ReturnType<typeof projectGround>) {
  const { width, height } = canvas, bounds = projection.bounds
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const sx = width / bounds.width, sy = height / bounds.height
  ctx.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy)
  // The index raster replaces a polygon search at every shadow pixel. Edge
  // samples with blended IDs fall back to the continuous ground query.
  const checksum = (lo: number, hi: number) => (lo * 131 + hi * 37) & 255
  for (let i = ground.all.length - 1; i >= 0; i--) {
    const area = ground.all[i], id = i + 1, lo = id & 255, hi = id >> 8
    ctx.fillStyle = `rgb(${lo},${hi},${checksum(lo, hi)})`
    for (const region of area.regionsMm ?? [{ outerMm: area.points, holesMm: [] }]) {
      ctx.beginPath()
      for (const ring of [region.outerMm, ...region.holesMm]) {
        ring.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
        ctx.closePath()
      }
      ctx.fill('evenodd')
    }
  }
  const { data } = ctx.getImageData(0, 0, width, height)
  const contains = (box: Projection['bounds'], p: PointMm) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height
  const patchBounds = [...projection.inlays ?? [], ...projection.rocks ?? []].map(row => reliefBounds(row.patches.flatMap(patch => patch.pointsMm)))
  const roads = projection.paths.flatMap(path => path.gradedSurface ? [createRoadSurfaceSampler(path.gradedSurface)] : []).reverse()
  return (p: PointMm, pixel: number) => {
    for (const road of roads) if (contains(road.bounds, p)) {
      const surface = road.sample(p)
      if (surface) return surface.zMm
    }
    if (patchBounds.some(box => contains(box, p))) return ground.groundAt(p)
    const lo = data[pixel], hi = data[pixel + 1], area = ground.all[(hi << 8 | lo) - 1]
    if (data[pixel + 3] === 0) return 0
    if (area && data[pixel + 3] === 255 && data[pixel + 2] === checksum(lo, hi)) return ground.elevation(area, p)
    return ground.groundAt(p)
  }
}

export async function bakeObliqueShadows(projection: Projection, ground: ReturnType<typeof projectGround>, walls: readonly WallGeometry[],
  makeCanvas: (width: number, height: number) => HTMLCanvasElement, privacy?: MeshMask, signal?: AbortSignal, yieldControl?: () => Promise<void>) {
  const environment = projection.visual?.environment, light = environment?.directionalLight
  const opacity = Math.min(.46, (light?.intensity ?? .64) * (light?.kind === 'moon' ? .40 : .48))
  if (opacity <= 0) return
  const solids = shadowSolids(projection, ground, walls)
  if (!solids.length) return
  const [sunX, sunY, sunZ] = directionToLight(environment)
  const depth = shadowDepth(solids, projection, -sunX / Math.max(.17, sunZ), -sunY / Math.max(.17, sunZ))
  let deadline = performance.now() + 16
  const checkpoint = async () => {
    signal?.throwIfAborted()
    if (yieldControl && performance.now() > deadline) {
      await yieldControl()
      signal?.throwIfAborted()
      deadline = performance.now() + 16
    }
  }
  for (const [index, solid] of solids.entries()) {
    if (index % 96 === 0) await checkpoint()
    depth.add(solid)
  }
  const bounds = projection.bounds, scale = SHADOW_EDGE / Math.max(bounds.width, bounds.height)
  const width = Math.max(1, Math.round(bounds.width * scale)), height = Math.max(1, Math.round(bounds.height * scale))
  const shadow = makeCanvas(width, height), ctx = shadow.getContext('2d')!
  const image = ctx.createImageData(width, height), dx = bounds.width / width, dy = bounds.height / height
  const flat = !projection.paths.some(path => path.gradedSurface) && !projection.inlays?.length && !projection.rocks?.length
    && ground.all.every(area => !area.relief && area.elevationMm === 0)
  const indexCanvas = flat ? undefined : makeCanvas(width, height)
  const heightAt = indexCanvas && receivers(indexCanvas, projection, ground)
  if (indexCanvas) indexCanvas.width = indexCanvas.height = 0
  const color = light?.kind === 'moon' ? [20, 31, 57] : [32, 35, 32], soft = .12 + (light?.softness ?? .5) * .38
  const point = { x: 0, y: 0 }
  for (let y = 0; y < height; y++) {
    if (y % 16 === 0) await checkpoint()
    point.y = bounds.y + (y + .5) * dy
    for (let x = 0; x < width; x++) {
      point.x = bounds.x + (x + .5) * dx
      const i = (y * width + x) * 4, z = heightAt?.(point, i) ?? 0
      const alpha = depth.sample(point, z, soft)
      if (!alpha) continue
      image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = Math.round(alpha * opacity * 255)
    }
  }
  ctx.putImageData(image, 0, 0)
  if (privacy) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(privacy.image, 0, 0, width, height)
  }
  return shadow
}

export function applyObliqueShadows(texture: HTMLCanvasElement, shadow?: HTMLCanvasElement) {
  if (!shadow) return
  const ctx = texture.getContext('2d')!
  ctx.save()
  ctx.resetTransform()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.drawImage(shadow, 0, 0, texture.width, texture.height)
  ctx.restore()
}
