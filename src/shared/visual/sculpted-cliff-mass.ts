import type { PointMm } from '../model/scene.js'
import type { NaturalCliffMass } from './natural-cliff-mass.js'

export interface SculptedCliffMass extends NaturalCliffMass {
  planes: (NaturalCliffMass['planes'][number] & { surface: 'slope' | 'ledge' | 'wall' })[]
}

/** Shared irregular rock ledges and their steep fronts, in world millimetres.
 * Every adjoining patch reuses the same front. The caller owns visibility,
 * real heights, surface protection, openings and audience filtering. */
export function sculptedCliffMass(lengthMm: number, at: (stationMm: number, depth: number) => PointMm,
  seed: string, repeatMm: number): SculptedCliffMass {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0 || !Number.isFinite(repeatMm) || repeatMm < 20 || !seed) throw new Error('凿岩地貌需要有限弧长、间距与种子。')
  const anchor = at(0, 0)
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) throw new Error('凿岩地貌坐标无效。')
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  hash ^= Math.imul(Math.round(anchor.x), 73856093) ^ Math.imul(Math.round(anchor.y), 19349663)
  const random = (i: number, c: number) => {
    let v = hash ^ Math.imul(i + 1, 73856093) ^ Math.imul(c + 1, 19349663)
    v ^= v >>> 16; v = Math.imul(v, 0x7feb352d); v ^= v >>> 15
    return (v >>> 0) / 4294967296
  }
  const spacing = Math.max(1200, repeatMm * 3.6), stations = [0]
  while (stations.at(-1)! < lengthMm) {
    if (stations.length > 2048) throw new Error('凿岩地貌超过岩体预算。')
    stations.push(Math.min(lengthMm, stations.at(-1)! + spacing * (.65 + random(stations.length, 0) * .9)))
  }
  const depths = stations.map((_, i) => {
    const shoulder = -.68 + random(i, 1) * .27, crest = -.13 + random(i, 2) * .35
    const upperFoot = crest + .09 + random(i, 3) * .11, lowerCrest = .57 + random(i, 4) * .20
    return [-1, shoulder, crest, upperFoot, lowerCrest, 1]
  })
  const end = at(lengthMm, 0)
  if (Math.hypot(end.x - anchor.x, end.y - anchor.y) < .001) depths[depths.length - 1] = [...depths[0]]
  const sample = (s: number, d: number) => {
    const p = at(s, d)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('凿岩地貌坐标无效。')
    return { x: p.x, y: p.y }
  }
  const result: SculptedCliffMass = { planes: [], shelves: [], creases: [], lips: [], joints: [] }
  let pointsUsed = 0
  for (let i = 0; i < stations.length - 1; i++) {
    const start = stations[i], span = stations[i + 1] - start, segments = Math.max(4, Math.ceil(span / 140))
    pointsUsed += (segments + 1) * 10 + 80
    if (pointsUsed > 131072) throw new Error('凿岩地貌超过有限绘制点预算。')
    const fronts = depths[i].map((d, row) => Array.from({ length: segments + 1 }, (_, k) => {
      const t = k / segments
      const bend = row === 0 || row === 5 ? 0 : Math.sin(t * Math.PI) * (random(i, 10 + row) - .5) * .16
      return sample(start + span * t, d * (1 - t) + depths[i + 1][row] * t + bend)
    }))
    for (let row = 0; row < 5; row++) {
      const surface = row === 4 || row === 2 && random(i, 21) > .38 ? 'wall' : row === 0 ? 'slope' : 'ledge'
      result.planes.push({ points: [...fronts[row], ...[...fronts[row + 1]].reverse()], frontCount: fronts[row].length,
        depth: (depths[i][row] + depths[i][row + 1] + depths[i + 1][row] + depths[i + 1][row + 1]) / 4,
        shade: .97 + random(i, 25 + row) * .065, surface })
      if (surface === 'wall' && random(i, 31 + row) > .22) {
        const from = Math.floor(segments * (.04 + random(i, 36 + row) * .12)), to = Math.ceil(segments * (.57 + random(i, 41 + row) * .34))
        result.creases.push(fronts[row].slice(from, to + 1))
      }
    }
    for (let mark = 0; mark < 2; mark++) {
      const id = i * 2 + mark
      if (random(id, 50) < .14) continue
      const s = start + span * (.12 + mark * .47 + random(id, 51) * .22), lean = span * (.03 + random(id, 52) * .10)
      const from = -.92 + random(id, 53) * .22, to = mark ? .35 + random(id, 54) * .63 : -.04 + random(id, 54) * .35
      const joint = Array.from({ length: 6 }, (_, k) => sample(s + lean * k / 5 + (random(id * 6 + k, 55) - .5) * 70, from + (to - from) * k / 5))
      result.joints.push(joint)
      if (random(id, 56) > .40) result.joints.push([joint[2], sample(s + span * .17, from + (to - from) * .48)])
    }
  }
  return result
}
