import type { LayeredCliffMass } from '../../../shared/visual/layered-cliff-mass.js'
import type { SculptedCliffMass } from '../../../shared/visual/sculpted-cliff-mass.js'
import type { PointMm } from '../../../shared/model/scene.js'
import type { TerrainCliffFace } from '../../../shared/visual/terrain-cliff-plan.js'

const path = (rings: PointMm[][]) => {
  const result = new Path2D()
  for (const ring of rings) { ring.forEach((a, i) => i ? result.lineTo(a.x, a.y) : result.moveTo(a.x, a.y)); result.closePath() }
  return result
}
const line = (points: PointMm[]) => {
  const result = new Path2D(); points.forEach((a, i) => i ? result.lineTo(a.x, a.y) : result.moveTo(a.x, a.y)); return result
}
const mix = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const middle = (points: [PointMm, PointMm]) => mix(...points, .5)

/** The caller clips real physical openings. Faces already have mutually
 * exclusive coverage and surface ownership, so no alpha piles up at a join. */
export function drawTerrainCliffFace(ctx: CanvasRenderingContext2D, face: TerrainCliffFace, lightDirectionDeg: number): void {
  if (face.look.renderProfile === 'rockRelief9') return drawSculptedCliff(ctx, face, lightDirectionDeg)
  if (face.look.renderProfile === 'rockRelief8') return drawLayeredCliff(ctx, face, lightDirectionDeg)
  if (face.natural) return drawNaturalCliff(ctx, face, lightDirectionDeg)
  const { look } = face
  const rgb = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  const rock = rgb(look.accentColor), dark = rgb(look.color)
  const color = (t: number, shade = 1) => `rgb(${rock.map((a, i) => Math.round(Math.max(0, Math.min(255, (a * (1 - t) + dark[i] * t) * shade)))).join(',')})`
  const angle = lightDirectionDeg * Math.PI / 180, light = { x: Math.cos(angle), y: Math.sin(angle) }
  const footprint = path(face.rings)
  ctx.save()
  try {
    ctx.clip(footprint, 'evenodd'); ctx.globalAlpha = look.opacity
    for (const cell of face.cells) {
      const facing = cell.normal.x * light.x + cell.normal.y * light.y
      const inner = middle(cell.inner), crest = middle(cell.crest), foot = middle(cell.foot)
      const variation = Math.sin(cell.stationMm / 880) * .025 + Math.cos(cell.stationMm / 410) * .025
      const shoulder = ctx.createLinearGradient(inner.x, inner.y, crest.x, crest.y)
      shoulder.addColorStop(0, 'rgba(0,0,0,0)'); shoulder.addColorStop(.22, color(.02, 1.08 + variation).replace('rgb(', 'rgba(').replace(')', ',.14)'))
      shoulder.addColorStop(.66, color(.12, 1 + facing * .055).replace('rgb(', 'rgba(').replace(')', ',.55)'))
      shoulder.addColorStop(1, color(.23, .99))
      const top = path([[...cell.inner, cell.crest[1], cell.crest[0]]])
      ctx.fillStyle = shoulder; ctx.strokeStyle = shoulder; ctx.lineWidth = 3; ctx.fill(top); ctx.stroke(top)
      const gradient = ctx.createLinearGradient(crest.x, crest.y, foot.x, foot.y)
      gradient.addColorStop(0, color(.3, 1.02)); gradient.addColorStop(.19, color(.48, 1.01 + facing * .08))
      gradient.addColorStop(.50, color(.73, .95 + facing * .1)); gradient.addColorStop(.84, color(.96, .88 + facing * .09))
      gradient.addColorStop(1, color(1, .76))
      const wall = path([[...cell.crest, cell.foot[1], cell.foot[0]]])
      ctx.fillStyle = gradient; ctx.strokeStyle = gradient; ctx.fill(wall); ctx.stroke(wall)
    }
    for (const facet of face.facets) {
      ctx.globalAlpha = look.opacity * (facet.depth < 0 ? .14 : .24)
      ctx.fillStyle = color(facet.depth < 0 ? .06 : .73, facet.shade)
      ctx.fill(path([facet.points]))
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .58
    ctx.strokeStyle = color(.48, .76); ctx.lineWidth = Math.max(13, look.widthMm * .014)
    for (const points of face.cracks) ctx.stroke(line(points))
    // A paired dark crease and short light shelf follows each rocky stratum.
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .42
    ctx.strokeStyle = color(.35, .8); ctx.lineWidth = Math.max(15, look.widthMm * .017)
    for (const points of face.layers) ctx.stroke(line(points))
    ctx.strokeStyle = color(.08, 1.12); ctx.lineWidth = Math.max(10, look.widthMm * .011)
    for (const points of face.layers) ctx.stroke(line(points.map(a => ({ x: a.x - 10, y: a.y - 20 }))))
  } finally { ctx.restore() }
}

function drawSculptedCliff(ctx: CanvasRenderingContext2D, face: TerrainCliffFace, lightDirectionDeg: number): void {
  const mass = face.natural as SculptedCliffMass, { look } = face
  const channels = (v: string) => [1, 3, 5].map(i => Number.parseInt(v.slice(i, i + 2), 16))
  const rock = channels(look.accentColor), dark = channels(look.color)
  const color = (mix: number, shade: number, alpha = 1) => `rgba(${rock.map((v, i) => Math.round(Math.max(0, Math.min(255, (v * (1 - mix) + dark[i] * mix) * shade)))).join(',')},${alpha})`
  const angle = lightDirectionDeg * Math.PI / 180, light = { x: Math.cos(angle), y: Math.sin(angle) }
  const average = (points: PointMm[]) => points.reduce((a, p) => ({ x: a.x + p.x / points.length, y: a.y + p.y / points.length }), { x: 0, y: 0 })
  ctx.save()
  try {
    ctx.clip(path(face.rings), 'evenodd')
    for (const cell of face.cells) {
      const crest = middle(cell.crest), foot = middle(cell.foot)
      const facing = cell.normal.x * light.x + cell.normal.y * light.y
      const base = ctx.createLinearGradient(crest.x, crest.y, foot.x, foot.y)
      base.addColorStop(0, color(.06, 1)); base.addColorStop(1, color(.86 - Math.max(0, facing) * .57, .91))
      ctx.globalAlpha = look.opacity; ctx.fillStyle = base
      ctx.fill(path([[...cell.crest, cell.foot[1], cell.foot[0]]]))
    }
    for (const plane of mass.planes) {
      const top = average(plane.points.slice(0, plane.frontCount)), bottom = average(plane.points.slice(plane.frontCount))
      const length = Math.hypot(bottom.x - top.x, bottom.y - top.y) || 1
      const facing = ((bottom.x - top.x) * light.x + (bottom.y - top.y) * light.y) / length
      const sun = Math.max(0, facing), depth = Math.max(0, plane.depth)
      const tint = plane.surface === 'wall' ? (.32 + depth * .52) * (1 - .68 * sun)
        : plane.surface === 'ledge' ? (.025 + depth * .27) * (1 - .5 * sun) : .015
      const shade = plane.shade * (plane.surface === 'wall' ? .94 + facing * .08 : 1.01 + facing * .045)
      const gradient = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y)
      gradient.addColorStop(0, color(plane.surface === 'wall' ? tint * .40 : tint, shade * 1.025, plane.surface === 'slope' ? 0 : 1))
      gradient.addColorStop(.55, color(plane.surface === 'wall' ? tint * .77 : tint, shade, plane.surface === 'slope' ? .6 : 1))
      gradient.addColorStop(1, color(tint + (plane.surface === 'wall' ? .055 : .005), shade * .96))
      ctx.globalAlpha = look.opacity; ctx.fillStyle = gradient; ctx.fill(path([plane.points]))
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .45
    ctx.strokeStyle = color(.45, .80); ctx.lineWidth = Math.max(9, look.widthMm * .005)
    for (const crease of mass.creases) ctx.stroke(line(crease))
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .62
    ctx.lineWidth = Math.max(18, look.widthMm * .007)
    for (const joint of mass.joints) {
      const from = joint[0], to = joint.at(-1)!, ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
      ink.addColorStop(0, color(.09, .73)); ink.addColorStop(1, color(.54, .73))
      ctx.strokeStyle = ink; ctx.stroke(line(joint))
    }
  } finally { ctx.restore() }
}

function drawNaturalCliff(ctx: CanvasRenderingContext2D, face: TerrainCliffFace, lightDirectionDeg: number): void {
  const natural = face.natural!, { look } = face
  const rgb = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  const warm = rgb(look.accentColor), dark = rgb(look.color)
  const color = (depth: number, shade: number, alpha = 1, facing = 0) => {
    // Sunlit rock retains its warm stone color. Making every orientation fade
    // to the same cool foot produces an inflated dark rim around the island.
    const t = Math.max(0, Math.min(1, depth)) * (1 - .78 * Math.max(0, facing))
    return `rgba(${warm.map((a, i) => Math.round(Math.max(0, Math.min(255, (a * (1 - t) + dark[i] * t) * shade)))).join(',')},${alpha})`
  }
  const angle = lightDirectionDeg * Math.PI / 180, light = { x: Math.cos(angle), y: Math.sin(angle) }
  ctx.save()
  try {
    ctx.clip(path(face.rings), 'evenodd'); ctx.globalAlpha = look.opacity
    // An understated base fills antialias seams. The broad planes supply the
    // visible mass; no continuous bright crest stripe is drawn.
    for (const cell of face.cells) {
      const inner = middle(cell.inner), crest = middle(cell.crest), foot = middle(cell.foot)
      const shoulder = ctx.createLinearGradient(inner.x, inner.y, crest.x, crest.y)
      shoulder.addColorStop(0, color(0, 1, 0)); shoulder.addColorStop(.5, color(.02, 1.03, .32)); shoulder.addColorStop(1, color(.12, .98))
      ctx.fillStyle = shoulder; ctx.fill(path([[...cell.inner, cell.crest[1], cell.crest[0]]]))
      const facing = cell.normal.x * light.x + cell.normal.y * light.y
      const gradient = ctx.createLinearGradient(crest.x, crest.y, foot.x, foot.y)
      gradient.addColorStop(0, color(.24, 1, 1, facing)); gradient.addColorStop(.32, color(.48, 1 + facing * .12, 1, facing))
      gradient.addColorStop(.76, color(.78, .97 + facing * .14, 1, facing)); gradient.addColorStop(1, color(.92, .88, 1, facing))
      ctx.fillStyle = gradient; ctx.fill(path([[...cell.crest, cell.foot[1], cell.foot[0]]]))
    }
    for (const plane of natural.planes) {
      const depth = Math.max(0, Math.min(1, plane.depth))
      const average = (points: PointMm[]) => points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 })
      const top = average(plane.points.slice(0, plane.frontCount)), bottom = average(plane.points.slice(plane.frontCount))
      const span = Math.hypot(bottom.x - top.x, bottom.y - top.y) || 1
      const facing = ((bottom.x - top.x) * light.x + (bottom.y - top.y) * light.y) / span
      const fill = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y)
      fill.addColorStop(0, color(depth * .8, plane.shade * (1.02 + facing * .06), 1, facing))
      fill.addColorStop(1, color(Math.min(1, depth + .15), plane.shade * (.98 + facing * .06), 1, facing))
      ctx.globalAlpha = look.opacity * (plane.depth < -.6 ? .12 : plane.depth < 0 ? .28 : .64)
      ctx.fillStyle = fill
      ctx.fill(path([plane.points]))
    }
    // Short shelf risers supply a real light/shadow break in the broad mass.
    // They follow the curved face and stop independently, rather than forming
    // complete concentric outlines around every island.
    for (const shelf of natural.shelves) {
      const top = shelf.points[Math.floor(shelf.frontCount / 2)], bottom = shelf.points[shelf.frontCount + Math.floor(shelf.frontCount / 2)]
      const span = Math.hypot(bottom.x - top.x, bottom.y - top.y) || 1
      const facing = ((bottom.x - top.x) * light.x + (bottom.y - top.y) * light.y) / span
      const fill = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y)
      fill.addColorStop(0, color(Math.max(.04, shelf.depth + .35), .82, 1, facing))
      fill.addColorStop(1, color(Math.max(.04, shelf.depth + .35), 1.02, 0, facing))
      ctx.globalAlpha = look.opacity * .58; ctx.fillStyle = fill; ctx.fill(path([shelf.points]))
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(12, look.widthMm * .012)
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .65
    for (const points of natural.joints) {
      const from = points[0], to = points.at(-1)!, ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
      const span = Math.hypot(to.x - from.x, to.y - from.y) || 1
      const facing = ((to.x - from.x) * light.x + (to.y - from.y) * light.y) / span
      ink.addColorStop(0, color(.16, .66, 1, facing)); ink.addColorStop(1, color(.88, .71, 1, facing))
      ctx.strokeStyle = ink; ctx.stroke(line(points))
    }
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .62
    ctx.strokeStyle = color(.46, .73); ctx.lineWidth = Math.max(14, look.widthMm * .014)
    for (const points of natural.creases) ctx.stroke(line(points))
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .22
    ctx.strokeStyle = color(.04, 1.09); ctx.lineWidth = Math.max(12, look.widthMm * .012)
    for (const points of natural.lips) ctx.stroke(line(points))
  } finally { ctx.restore() }
}

function drawLayeredCliff(ctx: CanvasRenderingContext2D, face: TerrainCliffFace, lightDirectionDeg: number): void {
  const natural = face.natural as LayeredCliffMass, { look } = face
  const rgb = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  const warm = rgb(look.accentColor), dark = rgb(look.color)
  const color = (depth: number, shade: number, alpha = 1, facing = 0) => {
    // Sunlit rock retains its warm stone color. Making every orientation fade
    // to the same cool foot produces an inflated dark rim around the island.
    const t = Math.max(0, Math.min(1, depth)) * (1 - .78 * Math.max(0, facing))
    return `rgba(${warm.map((a, i) => Math.round(Math.max(0, Math.min(255, (a * (1 - t) + dark[i] * t) * shade)))).join(',')},${alpha})`
  }
  const angle = lightDirectionDeg * Math.PI / 180, light = { x: Math.cos(angle), y: Math.sin(angle) }
  ctx.save()
  try {
    ctx.clip(path(face.rings), 'evenodd'); ctx.globalAlpha = look.opacity
    // An understated base fills antialias seams. The broad planes supply the
    // visible mass; no continuous bright crest stripe is drawn.
    for (const cell of face.cells) {
      const inner = middle(cell.inner), crest = middle(cell.crest), foot = middle(cell.foot)
      const shoulder = ctx.createLinearGradient(inner.x, inner.y, crest.x, crest.y)
      shoulder.addColorStop(0, color(0, 1, 0)); shoulder.addColorStop(.5, color(.02, 1.03, .32)); shoulder.addColorStop(1, color(.12, .98))
      ctx.fillStyle = shoulder; ctx.fill(path([[...cell.inner, cell.crest[1], cell.crest[0]]]))
      const facing = cell.normal.x * light.x + cell.normal.y * light.y
      const gradient = ctx.createLinearGradient(crest.x, crest.y, foot.x, foot.y)
      gradient.addColorStop(0, color(.24, 1, 1, facing)); gradient.addColorStop(.32, color(.48, 1 + facing * .12, 1, facing))
      gradient.addColorStop(.76, color(.78, .97 + facing * .14, 1, facing)); gradient.addColorStop(1, color(.92, .88, 1, facing))
      ctx.fillStyle = gradient; ctx.fill(path([[...cell.crest, cell.foot[1], cell.foot[0]]]))
    }
    for (const plane of natural.planes) {
      const depth = Math.max(0, Math.min(1, plane.depth))
      const average = (points: PointMm[]) => points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 })
      const top = average(plane.points.slice(0, plane.frontCount)), bottom = average(plane.points.slice(plane.frontCount))
      const span = Math.hypot(bottom.x - top.x, bottom.y - top.y) || 1
      const facing = ((bottom.x - top.x) * light.x + (bottom.y - top.y) * light.y) / span
      const fill = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y)
      fill.addColorStop(0, color(depth * .92, plane.shade * (1.01 + facing * .06), 1, facing))
      fill.addColorStop(1, color(Math.min(1, depth + .06), plane.shade * (.99 + facing * .06), 1, facing))
      ctx.globalAlpha = look.opacity * (plane.depth < -.6 ? .15 : plane.depth < 0 ? .38 : .87)
      ctx.fillStyle = fill
      ctx.fill(path([plane.points]))
    }
    for (const bench of natural.benches) {
      const center = bench.edge[Math.floor(bench.edge.length / 2)]
      const back = bench.top[Math.floor(bench.edge.length / 2)]
      const span = Math.hypot(center.x - back.x, center.y - back.y) || 1
      const facing = ((center.x - back.x) * light.x + (center.y - back.y) * light.y) / span
      const depth = Math.max(0, bench.depth)
      const top = ctx.createLinearGradient(back.x, back.y, center.x, center.y)
      top.addColorStop(0, color(depth * .71, bench.shade, .08, facing))
      top.addColorStop(.32, color(depth * .86, bench.shade * 1.015, .56, facing))
      top.addColorStop(1, color(depth * .86, bench.shade * 1.035, .76, facing))
      ctx.globalAlpha = look.opacity; ctx.fillStyle = top; ctx.fill(path([bench.top]))
      const foot = bench.front[bench.edge.length + Math.floor(bench.edge.length / 2)]
      const riser = ctx.createLinearGradient(center.x, center.y, foot.x, foot.y)
      riser.addColorStop(0, color(Math.min(1, depth + .28), .83, .8, facing))
      riser.addColorStop(1, color(Math.min(1, depth + .28), .96, .15, facing))
      ctx.fillStyle = riser; ctx.fill(path([bench.front]))
      ctx.strokeStyle = color(Math.min(1, depth + .21), .74, .68, facing)
      ctx.lineWidth = Math.max(10, look.widthMm * .006); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.stroke(line(bench.edge))
    }
    // Short shelf risers supply a real light/shadow break in the broad mass.
    // They follow the curved face and stop independently, rather than forming
    // complete concentric outlines around every island.
    for (const shelf of natural.shelves) {
      const top = shelf.points[Math.floor(shelf.frontCount / 2)], bottom = shelf.points[shelf.frontCount + Math.floor(shelf.frontCount / 2)]
      const span = Math.hypot(bottom.x - top.x, bottom.y - top.y) || 1
      const facing = ((bottom.x - top.x) * light.x + (bottom.y - top.y) * light.y) / span
      const fill = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y)
      fill.addColorStop(0, color(Math.max(.04, shelf.depth + .35), .82, 1, facing))
      fill.addColorStop(1, color(Math.max(.04, shelf.depth + .35), 1.02, 0, facing))
      ctx.globalAlpha = look.opacity * .58; ctx.fillStyle = fill; ctx.fill(path([shelf.points]))
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(12, look.widthMm * .012)
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .44
    for (const points of natural.joints) {
      const from = points[0], to = points.at(-1)!, ink = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
      const span = Math.hypot(to.x - from.x, to.y - from.y) || 1
      const facing = ((to.x - from.x) * light.x + (to.y - from.y) * light.y) / span
      ink.addColorStop(0, color(.16, .66, 1, facing)); ink.addColorStop(1, color(.88, .71, 1, facing))
      ctx.strokeStyle = ink; ctx.stroke(line(points))
    }
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .24
    ctx.strokeStyle = color(.46, .73); ctx.lineWidth = Math.max(14, look.widthMm * .014)
    for (const points of natural.creases) ctx.stroke(line(points))
    ctx.globalAlpha = look.opacity * Math.min(1, look.intensity) * .22
    ctx.strokeStyle = color(.04, 1.09); ctx.lineWidth = Math.max(12, look.widthMm * .012)
    for (const points of natural.lips) ctx.stroke(line(points))
  } finally { ctx.restore() }
}
