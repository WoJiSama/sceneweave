import { transformAttachmentPoint } from '../../../shared/attachments/contact.js'
import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import { atHeight, rectangle, type MeshMaterial, type SpatialColor } from './oblique-mesh'
import { colorRgb, type SurfaceMeshes } from './oblique-surfaces'

const scaleColor = (color: SpatialColor, ratio: number): SpatialColor => [color[0] * ratio, color[1] * ratio, color[2] * ratio]
const ellipse = (x: number, y: number, rx: number, ry: number, count = 18) =>
  Array.from({ length: count }, (_, i) => {
    const angle = 2 * Math.PI * i / count
    return { x: x + Math.cos(angle) * rx, y: y + Math.sin(angle) * ry }
  })

function textureProfile(image: HTMLCanvasElement | ImageBitmap, miniature: CanvasRenderingContext2D) {
  const { width, height } = miniature.canvas
  miniature.clearRect(0, 0, width, height)
  miniature.drawImage(image, 0, 0, width, height)
  const { data } = miniature.getImageData(0, 0, width, height)
  let left = width, right = 0, top = height, bottom = 0, count = 0
  const color: SpatialColor = [0, 0, 0]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (data[i + 3] < 180) continue
    left = Math.min(left, x); right = Math.max(right, x + 1)
    top = Math.min(top, y); bottom = Math.max(bottom, y + 1)
    for (let k = 0; k < 3; k++) color[k] += data[i + k] / 255
    count++
  }
  const filled = (u: number, v: number) => data[4 * (Math.floor(top + v * (bottom - top)) * width + Math.floor(left + u * (right - left))) + 3] >= 180
  const round = count > 0 && count / ((right - left) * (bottom - top)) > .70
    && [.1, .9].every(u => [.1, .9].every(v => !filled(u, v)) && filled(u, .5) && filled(.5, u))
  return { crop: count ? { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height } : { x: 0, y: 0, width: 1, height: 1 },
    color: count ? scaleColor(color, 1 / count) : colorRgb('#88735a'), round, pixels: data, width, height }
}

/** Heights follow the inked silhouette, including the gaps in a pile of rocks.
 * The same source UVs run from the upper facets down to the actual ground. */
function silhouetteHeights(profile: ReturnType<typeof textureProfile>, divisions: number) {
  const count = divisions + 1, values = new Float32Array(count * count)
  const gaps: [number, number][] = []
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
    const ix = Math.min(profile.width - 1, Math.round(x / divisions * (profile.width - 1)))
    const iy = Math.min(profile.height - 1, Math.round(y / divisions * (profile.height - 1)))
    if (!x || !y || x === divisions || y === divisions || profile.pixels[(iy * profile.width + ix) * 4 + 3] < 110) gaps.push([x, y])
  }
  let summit = .01
  for (let y = 1; y < divisions; y++) for (let x = 1; x < divisions; x++) {
    let squared = divisions * divisions
    for (const [a, b] of gaps) squared = Math.min(squared, (x - a) ** 2 + (y - b) ** 2)
    const distance = Math.sqrt(squared)
    const height = Math.min(2.5, distance) + distance * .32 + Math.min(1, distance) * ((divisions - x) * .09 + y * .043)
    values[y * count + x] = height
    summit = Math.max(summit, height)
  }
  return values.map(value => value / summit)
}

export async function addSpatialProps(input: SurfaceMeshes, decalIds: ReadonlySet<string>, signal?: AbortSignal, yieldControl?: () => Promise<void>) {
  const { projection, mesh, privacy, zOffset, images, ground, temporaryCanvas } = input
  const miniature = temporaryCanvas(32, 32).getContext('2d', { willReadFrequently: true })!
  const profiles = new Map<HTMLCanvasElement | ImageBitmap, ReturnType<typeof textureProfile>>()
  const silhouetteProfiles = new Map<HTMLCanvasElement | ImageBitmap, Float32Array>()
  const shadow = temporaryCanvas(48, 48), shadowCtx = shadow.getContext('2d')!
  const gradient = shadowCtx.createRadialGradient(24, 24, 1, 24, 24, 24)
  gradient.addColorStop(0, '#1e190fe0'); gradient.addColorStop(.57, '#211c1598'); gradient.addColorStop(1, '#201a1100')
  shadowCtx.fillStyle = gradient; shadowCtx.fillRect(0, 0, 48, 48)
  const contact: MeshMaterial = { image: shadow, unlit: true, opacity: .59, privacy }
  const brushContact: MeshMaterial = { ...contact, opacity: .45, alphaCutoff: .008 }
  const bridgeColors = new Map<string, SpatialColor>()
  const divisions = projection.props.length > 1200 ? 4 : projection.props.length > 300 ? 6 : 10
  let nextYield = performance.now() + 16
  for (const [index, prop] of projection.props.entries()) {
    if (index % 32 === 0) {
      signal?.throwIfAborted()
      if (yieldControl && performance.now() > nextYield) {
        await yieldControl()
        signal?.throwIfAborted()
        nextYield = performance.now() + 16
      }
    }
    if (decalIds.has(prop.id)) continue
    const volume = projection.propVolumes?.[prop.id]
    if (!volume) continue
    const { appearance, visualBoundsMm: bounds, positionMm, rotationDeg } = prop
    const brush = appearance.kind === 'image' ? projection.materialBrushes?.[appearance.assetId] : undefined
    const image = appearance.kind === 'image' ? images.get(appearance.assetId) : undefined
    let profile = image && profiles.get(image)
    if (image && !profile) { profile = textureProfile(image, miniature); profiles.set(image, profile) }
    const pose = (point: PointMm) => transformAttachmentPoint(point, positionMm, rotationDeg)
    const crop = profile?.crop ?? { x: 0, y: 0, width: 1, height: 1 }
    const body = {
      x: bounds.x + crop.x * bounds.width, y: bounds.y + crop.y * bounds.height,
      width: bounds.width * crop.width, height: bounds.height * crop.height,
    }
    const footprint = { x: prop.footprintOffsetMm.x - prop.footprintMm.width / 2, y: prop.footprintOffsetMm.y - prop.footprintMm.height / 2,
      ...prop.footprintMm }
    const fitBody = appearance.kind === 'symbol' ? footprint : body
    const center = { x: fitBody.x + fitBody.width / 2, y: fitBody.y + fitBody.height / 2 }
    const groundZ = volume.baseMm + zOffset
    const base = groundZ + 13 + Math.min(index, 4000) * .04, top = base + volume.heightMm
    const { kind, heightMm } = volume
    const tint = appearance.tint ? colorRgb(appearance.tint) : undefined
    const wood = tint ?? profile?.color ?? bridgeColors.get(prop.supportRef.id) ?? colorRgb('#977750')
    if (kind === 'rail') bridgeColors.set(prop.supportRef.id, wood)
    const face: MeshMaterial = { image, color: tint ?? (image ? undefined : wood), opacity: appearance.opacity, privacy, unlit: !!appearance.glow }
    const side: MeshMaterial = { color: scaleColor(wood, .94), opacity: appearance.opacity, privacy }
    const sideImage = volume.sideAssetId ? images.get(volume.sideAssetId) : undefined
    const sideTexture: MeshMaterial | undefined = sideImage ? { image: sideImage, color: tint, opacity: appearance.opacity, privacy } : undefined
    const trim: MeshMaterial = { ...side, color: scaleColor(wood, .64) }
    const layer = (material: MeshMaterial, rect: BoundsMm, a: number, b: number, cap = true) =>
      mesh.solid(material, rectangle(rect).map(pose), a, b, 800, cap, material === side ? sideTexture : undefined)
    const box = (x: number, y: number, width: number, height: number): BoundsMm => ({ x, y, width, height })
    const capQuad = (material: MeshMaterial, rect: BoundsMm, elevation: number, flip = false) => {
      const [a, b, c, d] = rectangle(rect).map(pose).map(p => atHeight(p, elevation))
      mesh.quad(material, [a, b, c, d], flip ? [[0, 1], [1, 1], [1, 0], [0, 0]] : undefined)
    }
    if (heightMm > 40 && !prop.waterAppearance && !projection.terrain.some(area => area.waterSurface && area.id === prop.supportRef.id)) {
      const shade = box((kind === 'tree' ? body.x : fitBody.x) - 100, fitBody.y - 70, fitBody.width + 280, fitBody.height + 240)
      // Attached items shade the same surface on which they sit.
      capQuad(brush ? brushContact : contact, shade, groundZ + 18)
    }
    if (kind === 'flat') {
      const rect = image ? bounds : footprint
      const points = rectangle(rect).map(pose)
      const z = (p: PointMm) => projection.terrain.some(area => area.id === prop.supportRef.id && area.relief)
        ? ground.groundAt(p) + 9 : top
      mesh.cap(face, [points], z, p => {
        const local = transformAttachmentPoint({ x: p.x - positionMm.x, y: p.y - positionMm.y }, { x: 0, y: 0 }, -rotationDeg)
        const v = (local.y - rect.y) / rect.height
        return [(local.x - rect.x) / rect.width, appearance.mirrorY ? 1 - v : v]
      })
      continue
    }
    if (kind === 'rock' && image && profile && (brush === 'stone' || brush === 'foliage')) {
      const count = divisions + 1
      let heights = silhouetteProfiles.get(image)
      if (!heights) { heights = silhouetteHeights(profile, divisions); silhouetteProfiles.set(image, heights) }
      const vertices = Array.from(heights, (_, i) => {
        const x = i % count, y = Math.floor(i / count), u = x / divisions, v = y / divisions
        const sourceY = appearance.mirrorY ? divisions - y : y
        return { point: atHeight(pose({ x: bounds.x + bounds.width * u, y: bounds.y + bounds.height * v }),
          base + heightMm * heights[sourceY * count + x]), uv: [u, sourceY / divisions] as [number, number] }
      })
      for (let y = 0; y < divisions; y++) for (let x = 0; x < divisions; x++) {
        const i = y * count + x, a = vertices[i], b = vertices[i + 1], c = vertices[i + count + 1], d = vertices[i + count]
        mesh.quad(face, [a.point, b.point, c.point, d.point], [a.uv, b.uv, c.uv, d.uv])
      }
      continue
    }
    if (kind === 'tree') {
      const radius = Math.min(body.width, body.height)
      const trunkSize = Math.max(110, radius * .088)
      const trunk: MeshMaterial = { color: colorRgb('#66513d'), privacy }
      mesh.solid(trunk, ellipse(0, 0, trunkSize, trunkSize, 8).map(pose), base, base + heightMm * .83)
      const crown: MeshMaterial = { ...face, canopy: positionMm, unlit: false }
      if (!image) crown.color = colorRgb('#4a6239')
      // Two connected profiles use the same source UVs. The intact crown
      // silhouette can wrap over the canopy and still expose the trunk.
      const vertex = (i: number, j: number, underside: boolean) => {
        const u = i / divisions, v = j / divisions
        const p = { x: bounds.x + bounds.width * u, y: bounds.y + bounds.height * v }
        const radial = Math.min(1, Math.hypot((p.x - center.x) / (body.width * .62), (p.y - center.y) / (body.height * .62)))
        const dome = Math.sqrt(1 - radial * radial)
        const elevation = .71 + (underside ? -.22 : .29) * dome
        return { point: atHeight(pose(p), base + heightMm * elevation), uv: [u, appearance.mirrorY ? 1 - v : v] as [number, number] }
      }
      for (const underside of [false, true]) {
        const vertices = Array.from({ length: divisions + 1 }, (_, j) => Array.from({ length: divisions + 1 }, (_, i) => vertex(i, j, underside)))
        for (let j = 0; j < divisions; j++) for (let i = 0; i < divisions; i++) {
          const entries = [vertices[j][i], vertices[j][i + 1], vertices[j + 1][i + 1], vertices[j + 1][i]] as const
          const [a, b, c, d] = underside ? [entries[1], entries[0], entries[3], entries[2]] : entries
          mesh.quad(crown, [a.point, b.point, c.point, d.point], [a.uv, b.uv, c.uv, d.uv])
        }
      }
      continue
    }
    if (kind === 'tent') {
      const [a, b, c, d] = rectangle(body)
      const ridgeA = { x: a.x, y: center.y }, ridgeB = { x: b.x, y: center.y }
      const pa = atHeight(pose(a), base), pb = atHeight(pose(b), base), pc = atHeight(pose(c), base), pd = atHeight(pose(d), base)
      const ra = atHeight(pose(ridgeA), top), rb = atHeight(pose(ridgeB), top)
      mesh.quad(face, [pa, pb, rb, ra], [[0, 0], [1, 0], [1, .5], [0, .5]])
      mesh.quad(face, [ra, rb, pc, pd], [[0, .5], [1, .5], [1, 1], [0, 1]])
      mesh.triangle(sideTexture ?? side, [pd, pa, ra], [[0, 1], [1, 1], [.5, 0]])
      mesh.triangle(sideTexture ?? side, [pb, pc, rb], [[0, 1], [1, 1], [.5, 0]])
      continue
    }
    if (kind === 'table' || kind === 'seat') {
      const board = Math.min(110, heightMm * .25), leg = Math.min(fitBody.height, fitBody.width) * .14
      const round = !!brush && profile?.round
      if (round) mesh.solid(side, ellipse(center.x, center.y, fitBody.width / 2, fitBody.height / 2, 24).map(pose), top - board, top, 800, false, sideTexture)
      else layer(side, fitBody, top - board, top, !image)
      const inset = leg * (round ? 1.25 : .45)
      for (const x of [fitBody.x + inset, fitBody.x + fitBody.width - leg - inset]) {
        for (const y of [fitBody.y + inset, fitBody.y + fitBody.height - leg - inset]) layer(trim, box(x, y, leg, leg), base, top - board)
      }
    } else if (kind === 'rail') {
      const { x, y, width, height } = fitBody
      const alongX = width >= height, post = Math.min(115, Math.min(width, height))
      const rail = alongX ? box(x, center.y - post / 2, width, post) : box(center.x - post / 2, y, post, height)
      for (const t of [.06, .94]) layer(trim, box(alongX ? x + (width - post) * t : rail.x, alongX ? rail.y : y + (height - post) * t, post, post), base, top)
      layer(side, rail, top - 100, top)
      layer(side, rail, base + heightMm * .46, base + heightMm * .53)
    } else if (kind === 'round' || kind === 'rock' || kind === 'lamp') {
      const rx = fitBody.width * .45, ry = fitBody.height * .45
      const rim = ellipse(center.x, center.y, rx, ry, kind === 'rock' ? 7 : 16).map(pose)
      mesh.solid(side, rim, base, kind === 'rock' ? base + heightMm * .49 : top, 800, !image, sideTexture)
      if (kind === 'rock') {
        const peak = atHeight(pose({ x: center.x - rx * .22, y: center.y - ry * .15 }), top)
        for (let i = 0; i < rim.length; i++) mesh.triangle(side, [atHeight(rim[i], base + heightMm * .49), atHeight(rim[(i + 1) % rim.length], base + heightMm * .49), peak], [[0, 1], [1, 1], [.5, 0]])
      }
      if (kind === 'round' && heightMm > 420) for (const t of [.22, .79]) mesh.solid(trim, ellipse(center.x, center.y, rx * 1.012, ry * 1.012, 16).map(pose), base + heightMm * t, base + heightMm * t + 45, 800, false)
      if (kind === 'lamp' && appearance.glow) mesh.solid({ ...side, color: colorRgb(appearance.glow.color), unlit: true },
        ellipse(center.x, center.y, rx * 1.01, ry * 1.01, 16).map(pose), base + heightMm * .26, top - heightMm * .16, 800, false)
    } else {
      layer(side, fitBody, base, top - 1, !image)
      if (heightMm >= 550 && !sideTexture) {
        const edge = { x: fitBody.x - 5, y: fitBody.y - 5, width: fitBody.width + 10, height: fitBody.height + 10 }
        layer(trim, edge, base + heightMm * .075, base + heightMm * .13, false)
        layer(trim, edge, base + heightMm * .85, base + heightMm * .92, false)
      }
    }
    if (image) capQuad(face, bounds, top, !!appearance.mirrorY)
  }
  for (const value of projection.decorations ?? []) {
    const image = images.get(value.assetId)
    if (!image) continue
    const vertices = rectangle(value.visualBoundsMm).map(p => transformAttachmentPoint(p, value.positionMm, value.rotationDeg))
    mesh.cap({ image, opacity: value.opacity, privacy }, [vertices], p => ground.groundAt(p) + 8, p => {
      const local = transformAttachmentPoint({ x: p.x - value.positionMm.x, y: p.y - value.positionMm.y }, { x: 0, y: 0 }, -value.rotationDeg)
      return [(local.x - value.visualBoundsMm.x) / value.visualBoundsMm.width, (local.y - value.visualBoundsMm.y) / value.visualBoundsMm.height]
    })
  }
}
