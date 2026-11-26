import type { PointMm } from '../model/scene.js'
import type { MapReferenceIssue } from './map-reference.js'

function erode(mask: Uint8Array, width: number) {
  return mask.map((value, i) => {
    if (!value) return 0
    const x = i % width
    return (x === 0 || mask[i - 1]) && (x === width - 1 || mask[i + 1])
      && (i < width || mask[i - width]) && (i >= mask.length - width || mask[i + width]) ? 1 : 0
  })
}

/** Locate narrow necks between substantial cores on the analysis grid.
 * Proposals affect a single neck and never apply until the user accepts one. */
export function narrowReferenceJoins(mask: Uint8Array, certainty: Uint8Array, width: number, minimumArea: number,
  sourcePoint: (index: number) => PointMm, sourceScale: number): MapReferenceIssue[] {
  const core = erode(erode(mask, width), width)
  const owner = new Int32Array(mask.length), queue = new Int32Array(mask.length)
  let size = 0
  const adjacent = (i: number, visit: (other: number) => void) => {
    const x = i % width
    if (x) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < mask.length - width) visit(i + width)
  }
  let group = 0
  for (let start = 0; start < core.length; start++) {
    if (!core[start]) continue
    let end = size
    const add = (i: number) => {
      if (!core[i]) return
      core[i] = 0
      queue[end++] = i
    }
    add(start)
    for (let i = size; i < end; i++) adjacent(queue[i], add)
    if (end - size < minimumArea) continue
    group++
    for (; size < end; size++) owner[queue[size]] = group
  }
  if (group < 2) return uncertainEdges(mask, certainty, width, sourcePoint)
  for (let front = 0; front < size; front++) {
    const i = queue[front], id = owner[i]
    adjacent(i, other => {
      if (!mask[other] || owner[other]) return
      owner[other] = id
      queue[size++] = other
    })
  }
  const joins = new Map<string, { left: number; right: number; top: number; bottom: number; waterEvidence: boolean }>()
  for (let i = 0; i < owner.length; i++) {
    if (!owner[i]) continue
    adjacent(i, other => {
      if (other <= i || !owner[other] || owner[other] === owner[i]) return
      const a = owner[i], b = owner[other], key = a < b ? `${a}/${b}` : `${b}/${a}`
      const x = i % width, y = Math.floor(i / width), xx = other % width, yy = Math.floor(other / width)
      const join = joins.get(key) ?? { left: x, right: x, top: y, bottom: y, waterEvidence: false }
      join.left = Math.min(join.left, x, xx); join.right = Math.max(join.right, x, xx)
      join.top = Math.min(join.top, y, yy); join.bottom = Math.max(join.bottom, y, yy)
      join.waterEvidence ||= certainty[i] > 0 || certainty[other] > 0
      joins.set(key, join)
    })
  }
  const gaps: MapReferenceIssue[] = []
  for (const { left, right, top, bottom, waterEvidence } of joins.values()) {
    const span = Math.hypot(right - left, bottom - top)
    if (span > 8 || !waterEvidence) continue
    const at = sourcePoint(Math.round((top + bottom) / 2) * width + Math.round((left + right) / 2))
    const radiusPx = Math.min(128, Math.ceil((span / 2 + 1.8) * sourceScale))
    gaps.push({ at, kind: 'gap', message: '两块较大的陆地在可疑窄处相连。若原图这里是水道，可在此断开。',
      correction: { kind: 'background', points: [at], radiusPx } })
  }
  return [...gaps.slice(0, 4), ...uncertainEdges(mask, certainty, width, sourcePoint).filter(row =>
    gaps.every(gap => Math.hypot(gap.at.x - row.at.x, gap.at.y - row.at.y) > 30))].slice(0, 6)
}

function uncertainEdges(mask: Uint8Array, certainty: Uint8Array, width: number, sourcePoint: (index: number) => PointMm): MapReferenceIssue[] {
  const tiles = new Map<string, { count: number; i: number }>()
  for (let i = width; i < mask.length - width; i++) {
    const x = i % width, y = Math.floor(i / width)
    if (certainty[i] !== 1 || !x || x === width - 1 || [i - 1, i + 1, i - width, i + width].every(n => mask[n] === mask[i])) continue
    const key = `${Math.floor(x / 40)}/${Math.floor(y / 40)}`
    const tile = tiles.get(key) ?? { count: 0, i }
    tile.count++
    tiles.set(key, tile)
  }
  return [...tiles.values()].filter(row => row.count >= 15).sort((a, b) => b.count - a.count).slice(0, 3)
    .map(row => ({ at: sourcePoint(row.i), kind: 'boundary', message: '这里的地面和背景颜色接近。请结合原图检查轮廓，可局部补陆地或擦成背景。' }))
}
