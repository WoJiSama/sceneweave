import type { PointMm } from '../model/scene.js'

export interface NaturalCliffMass {
  planes: { points: PointMm[]; frontCount: number; depth: number; shade: number }[]
  shelves: { points: PointMm[]; frontCount: number; depth: number }[]
  creases: PointMm[][]
  lips: PointMm[][]
  joints: PointMm[][]
}

/** World-size rock blocks share their actual shelf vertices. Stations and
 * layers vary together, instead of overlaying evenly spaced concentric lines.
 * The caller clips this paint to height/coverage/connection-owned footprints. */
export function naturalCliffMass(lengthMm: number, at: (distance: number, depth: number) => PointMm,
  seed: string, repeatMm: number): NaturalCliffMass {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0 || !Number.isFinite(repeatMm) || repeatMm < 20 || !seed) throw new Error('自然断岩需要有限弧长、间距与种子。')
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  const anchor = at(0, 0)
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) throw new Error('自然断岩弧长查询返回无效坐标。')
  hash ^= Math.imul(Math.round(anchor.x), 73856093) ^ Math.imul(Math.round(anchor.y), 19349663)
  const random = (i: number, channel: number) => {
    let h = hash ^ Math.imul(i + 1, 73856093) ^ Math.imul(channel + 1, 19349663)
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15
    return (h >>> 0) / 4294967296
  }
  const spacing = Math.max(850, repeatMm * 2.8), stations = [0]
  while (stations.at(-1)! < lengthMm) {
    if (stations.length > 2048) throw new Error('自然断岩超过2048块岩体预算。')
    stations.push(Math.min(lengthMm, stations.at(-1)! + spacing * (.65 + random(stations.length, 0) * .85)))
  }
  const result: NaturalCliffMass = { planes: [], shelves: [], creases: [], lips: [], joints: [] }
  let plannedPoints = 0
  const rows = [-1, -.51, -.06, .43, 1]
  // A shared front can lean and break without each adjacent polygon inventing
  // a separate crack or leaving a transparent seam.
  const frontValue = (station: number, row: number) => {
    const end = station === 0 || station === stations.length - 1
    const depth = row === 0 || row === rows.length - 1 ? rows[row] : rows[row] + (random(station, row + 1) - .5) * .24
    const shift = end ? 0 : (random(station, row + 10) - .5) * spacing * .22
    return { distance: stations[station] + shift, depth }
  }
  const sample = (distance: number, depth: number) => {
    const point = at(distance, depth)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('自然断岩弧长查询返回无效坐标。')
    return point
  }
  for (let i = 0; i < stations.length - 1; i++) {
    // Follow the actual curved face between stations. A single chord across a
    // concave coast creates large triangular patches unrelated to the rock.
    // Each full front is shared by the rows above and below it.
    const segments = Math.max(4, Math.ceil((stations[i + 1] - stations[i]) / 170))
    plannedPoints += (segments + 1) * 8 + 160
    if (plannedPoints > 131072) throw new Error('自然断岩超过有限绘制点预算。')
    const fronts = rows.map((_, row) => {
      const left = frontValue(i, row), right = frontValue(i + 1, row)
      return Array.from({ length: segments + 1 }, (_, k) => {
        if (k === 0) return sample(left.distance, left.depth)
        if (k === segments) return sample(right.distance, right.depth)
        const t = k / segments
        const bend = row === 0 || row === rows.length - 1 ? 0 : Math.sin(t * Math.PI) * (random(i, row + 40) - .5) * .16
        return sample(left.distance + (right.distance - left.distance) * t, left.depth + (right.depth - left.depth) * t + bend)
      })
    })
    for (let row = 0; row < rows.length - 1; row++) {
      const depth = (rows[row] + rows[row + 1]) / 2
      result.planes.push({ points: [...fronts[row], ...[...fronts[row + 1]].reverse()], frontCount: fronts[row].length, depth,
        shade: .96 + random(i, row + 60) * .085 })
      if (row && random(i, row + 70) > .28) {
        const start = .06 + random(i, row + 80) * .13, finish = 1.10 + random(i, row + 90) * .64
        const depth = rows[row] + (random(i, row + 100) - .5) * .15
        const points = Array.from({ length: 7 }, (_, j) => sample(stations[i] + (stations[i + 1] - stations[i]) * (start + (finish - start) * j / 6),
          depth + Math.sin(j * 1.3 + random(i, row + 110) * 6) * .035))
        const lower = Array.from({ length: 7 }, (_, j) => sample(stations[i] + (stations[i + 1] - stations[i]) * (start + (finish - start) * j / 6),
          depth + Math.sin(j * 1.3 + random(i, row + 110) * 6) * .035 + .035 + random(i, row + 112) * .045))
        result.shelves.push({ points: [...points, ...lower.reverse()], frontCount: points.length, depth })
        result.creases.push(points)
        if (random(i, row + 120) > .45) result.lips.push(points.map(p => ({ x: p.x - 9, y: p.y - 22 })))
      }
    }
    for (let joint = 0; joint < 1; joint++) {
      if (random(i * 2 + joint, 130) < .21) continue
      const station = stations[i] + (stations[i + 1] - stations[i]) * (.12 + joint * .46 + random(i, 131 + joint) * .16)
      const from = -.94 + random(i, 134 + joint) * .48, to = .22 + random(i, 136 + joint) * .65
      const lean = (random(i, 138 + joint) - .5) * spacing * .22
      // A fissure crosses several strata, but its staggered kinks do not
      // coincide with every polygon front in a repeated grid.
      const points = Array.from({ length: 6 }, (_, k) => sample(station + lean * k / 5 + (random(i * 12 + joint * 6 + k, 140) - .5) * spacing * .07,
        from + (to - from) * k / 5))
      result.joints.push(points)
      if (random(i, 142 + joint) > .48) {
        const root = points[2]
        result.joints.push([root, sample(station + spacing * (.15 + random(i, 144) * .18), from + (to - from) * .47)])
      }
    }
  }
  return result
}
