import type { BoundsMm, PointMm } from '../model/scene.js'
import { captureJson, freezeJson } from '../validation/json.js'
import type { RockShell, RockShellFace, RockShellPoint } from './contracts.js'
import { createRockShellSampler } from './kernel.js'
import { EPS, cross, faceNormal, field } from './geometry.js'

export interface RockShellPaintOptions { rockColor?: string; lightDirection?: { x: number; y: number; z: number } }
export interface RockShellPaintPlan {
  facets: { id: string; faceId: string; pointsMm: PointMm[]; fill: string; opacity: number; kind: RockShellFace['zone'] }[]
  strokes: { id: string; pointsMm: PointMm[]; color: string; widthMm: number; opacity: number }[]
  boundsMm: BoundsMm | null
}
const color = (base: string, factor: number) => '#' + [1, 3, 5].map(i => Math.round(Math.min(255, Math.max(0, parseInt(base.slice(i, i + 2), 16) * factor))).toString(16).padStart(2, '0')).join('')
const contour = (points: readonly RockShellPoint[], z: number): PointMm[] => {
  const result: PointMm[] = []
  for (let i = 0; i < 3; i++) {
    const a = points[i], b = points[(i + 1) % 3]
    if ((a.z < z && b.z > z) || (a.z > z && b.z < z)) {
      const t = (z - a.z) / (b.z - a.z); result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    } else if (a.z === z) result.push({ x: a.x, y: a.y })
  }
  return result.filter((p, i) => result.findIndex(q => q.x === p.x && q.y === p.y) === i)
}

/** Every filled point is an actual persisted face point. No decorative envelope. */
export function createRockShellPaintPlan(shellInput: RockShell, optionsInput: RockShellPaintOptions = {}): RockShellPaintPlan {
  const { shell, triangles } = createRockShellSampler(shellInput), options = captureJson(optionsInput)
  const base = options.rockColor ?? '#827561', light = options.lightDirection ?? { x: -.45, y: -.65, z: 1 }
  if (!/^#[a-fA-F0-9]{6}$/.test(base) || ![light.x, light.y, light.z].every(Number.isFinite)) throw Error('侧壳光照与颜色须为有限值。')
  const magnitude = Math.hypot(light.x, light.y, light.z)
  if (!Number.isFinite(magnitude) || magnitude <= EPS) throw Error('侧壳统一光向不能为零。')
  const facets: RockShellPaintPlan['facets'] = [], strokes: RockShellPaintPlan['strokes'] = []
  for (const triangle of triangles) {
    const face = shell.faces[triangle.faceId], points = triangle.verticesMm
    if (Math.abs(cross(points[0], points[1], points[2])) <= EPS) continue
    const normal = faceNormal(points), diffuse = Math.max(0, (normal.x * light.x + normal.y * light.y + normal.z * light.z) / magnitude)
    const factor = .43 + diffuse * .51 + (face.zone === 'shoulder' ? .045 : face.zone === 'foot' ? .02 : 0)
    facets.push({ id: `rock-shell:${face.id}`, faceId: face.id, pointsMm: points.map(p => ({ x: p.x, y: p.y })), fill: color(base, factor), opacity: 1, kind: face.zone })
    // One absolute geologic height, broken into open arcs by a world field.
    // These thin marks never alter silhouette, support or walkable width.
    if (face.zone === 'wall' && strokes.length < 12) {
      const line = contour(points, Math.round(shell.topElevationMm * .43))
      if (line.length === 2 && Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y) >= 100) {
        const p = { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 }
        const inset = [0.1, .9].map(t => ({ x: line[0].x + (line[1].x - line[0].x) * t, y: line[0].y + (line[1].y - line[0].y) * t }))
        // The complete stroke width, including its ends, stays in this actual
        // triangle. Merely clipping its centreline would leak at narrow tips.
        const contained = inset.every(q => points.every((a, i) => {
          const b = points[(i + 1) % 3], size = Math.hypot(b.x - a.x, b.y - a.y)
          return size > EPS && cross(a, b, q) / size >= 10
        }))
        if (contained && field(p, shell.recipe.seed, 7, Math.max(1600, shell.topElevationMm * 2.3)) > .63) strokes.push({ id: `rock-shell-stratum:${face.id}`, pointsMm: inset, color: color(base, .45), widthMm: 18, opacity: .4 })
      }
    }
  }
  const points = facets.flatMap(f => f.pointsMm)
  const boundsMm = points.length ? { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
    width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) } : null
  return freezeJson({ facets, strokes, boundsMm })
}
