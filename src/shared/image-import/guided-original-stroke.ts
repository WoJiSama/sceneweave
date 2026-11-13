import type { ImagePixels, PixelBounds } from './pixels.js'

export interface OriginalStrokeReference { length: number; cross: number; centre: number; ink: Float32Array; axis: 'horizontal' | 'vertical' }
type Point = { x: number; y: number }
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]

/** The caller verifies every reference pixel before this bounded read. Keep
 * complete source columns, including real gaps; never drop a whole column
 * because its soft fringe looks wider than an arbitrary line-width gate. */
export function prepareOriginalSurfaceStroke(image: ImagePixels, bounds: PixelBounds, axis: 'horizontal' | 'vertical', cancel: () => void,
  paper?: 'two-sided'): OriginalStrokeReference {
  const horizontal = axis === 'horizontal', length = horizontal ? bounds.width : bounds.height, cross = horizontal ? bounds.height : bounds.width
  if (cross < 5 || cross > 31 || length < 5) throw new Error('原尺寸接缝参考沿线至少5px、横跨5至31px。')
  if (paper !== undefined && (paper !== 'two-sided' || cross < 9)) throw new Error('两侧底色只支持显式two-sided，参考横跨至少9px以保留两侧底色与窄主线。')
  const ink = new Float32Array(length * cross * 3), profile = new Float64Array(cross)
  for (let u = 0; u < length; u++) {
    cancel()
    const colors: number[][] = []
    for (let v = 0; v < cross; v++) {
      const at = ((bounds.y + (horizontal ? v : u)) * image.width + bounds.x + (horizontal ? u : v)) * 4
      colors.push([image.data[at], image.data[at + 1], image.data[at + 2]])
    }
    const ordered = [...colors].sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2]), paper = ordered[Math.floor((cross - 1) * .8)]
    for (let v = 0; v < cross; v++) for (let c = 0; c < 3; c++) {
      const value = Math.max(0, Math.min(180, paper[c] - colors[v][c]))
      ink[(u * cross + v) * 3 + c] = value; profile[v] += value / (length * 3)
    }
  }
  const peak = Math.max(...profile), positions = [...profile].map((v, i) => ({ v, i })).filter(p => p.v >= peak * .5)
  if (peak < 8 || !positions.length || positions[0].i === 0 || positions.at(-1)!.i === cross - 1 || positions.at(-1)!.i - positions[0].i > 5) throw new Error('原尺寸接缝参考需要可区分的窄主线及两侧底色，不能把宽阴影或装饰当接缝。')
  const centre = median(positions.map(p => p.i))
  // A brighter board beside a darker board is not all ink. In this explicit
  // model, two captured outer rows on each side estimate a linear paper field
  // independently for each native column. The narrow original stroke, gaps
  // and column order remain; target tone and texture are composed elsewhere.
  // Omission preserves the old bright-quantile residual exactly.
  if (paper === 'two-sided') for (let u = 0; u < length; u++) {
    cancel()
    const color = (v: number, c: number) => image.data[((bounds.y + (horizontal ? v : u)) * image.width + bounds.x + (horizontal ? u : v)) * 4 + c]
    const first = [0, 1, 2].map(c => (color(0, c) + color(1, c)) / 2)
    const last = [0, 1, 2].map(c => (color(cross - 2, c) + color(cross - 1, c)) / 2)
    for (let v = 0; v < cross; v++) for (let c = 0; c < 3; c++) {
      const t = Math.max(0, Math.min(1, (v - .5) / (cross - 2)))
      ink[(u * cross + v) * 3 + c] = Math.max(0, Math.min(180, first[c] * (1 - t) + last[c] * t - color(v, c)))
    }
  }
  for (let u = 0; u < length; u++) for (let v = 0; v < cross; v++) if (Math.abs(v - centre) > 6) ink.fill(0, (u * cross + v) * 3, (u * cross + v + 1) * 3)
  return { length, cross, centre, ink, axis }
}

/** Draw contiguous original columns into each finite writable run. Target
 * path and source phase are inferred; only trusted original side pixels may
 * influence the joint comparison. A source too short rejects the solve. */
export function rasterOriginalSurfaceStroke(reference: OriginalStrokeReference, points: readonly Point[], bounds: PixelBounds,
  writable: (x: number, y: number) => boolean, observedInk: (x: number, y: number, c: number) => number | undefined,
  targetInk: Float32Array, budget: (n: number) => void, cancel: () => void): void {
  const horizontal = reference.axis === 'horizontal', along = (p: Point) => horizontal ? p.x : p.y, across = (p: Point) => horizontal ? p.y : p.x
  const forward = along(points.at(-1)!) >= along(points[0]) ? points : [...points].reverse()
  if (forward.some((p, i) => i > 0 && along(p) <= along(forward[i - 1]))) throw new Error('原尺寸接缝路径须沿参考方向单调，不能折返或有同轴重合段。')
  const start = Math.max(horizontal ? bounds.x : bounds.y, Math.ceil(along(forward[0]))), end = Math.min(horizontal ? bounds.x + bounds.width : bounds.y + bounds.height, Math.floor(along(forward.at(-1)!)) + 1)
  const pointAt = (u: number) => {
    let i = 1; while (i < forward.length - 1 && along(forward[i]) < u) i++
    const a = forward[i - 1], b = forward[i], t = (u - along(a)) / (along(b) - along(a))
    return across(a) + (across(b) - across(a)) * t
  }
  const coords = (u: number, v: number): [number, number] => horizontal ? [u, v] : [v, u]
  const active: boolean[] = []
  for (let u = start; u < end; u++) {
    const mid = pointAt(u); let yes = false
    for (let v = Math.floor(mid - 7); v <= Math.ceil(mid + 7); v++) { const [x, y] = coords(u, v); if (writable(x, y)) yes = true }
    active.push(yes)
  }
  budget(active.length * 16)
  for (let first = 0; first < active.length; first++) {
    if (!active[first]) continue
    let last = first + 1; while (last < active.length && active[last]) last++
    const length = last - first, u0 = start + first
    if (length > reference.length) throw new Error(`原尺寸接缝可写段长${length}px，超过可信原参考${reference.length}px；请补更长参考或减少本次路径，不重复短线填满。`)
    // Sample at most three original columns just outside each writable run.
    const observations: Array<{ side: number; v: number; c: number; value: number }> = []
    for (const side of [0, 1]) for (let k = 1; k <= 3; k++) {
      const u = side ? u0 + length - 1 + k : u0 - k, mid = pointAt(u)
      for (let d = -5; d <= 5; d++) { const v = Math.round(mid) + d, [x, y] = coords(u, v)
        for (let c = 0; c < 3; c++) { const value = observedInk(x, y, c); if (value !== undefined) observations.push({ side, v: reference.centre + v - mid, c, value }) }
      }
    }
    const at = (u: number, v: number, c: number) => {
      const lo = Math.floor(v), t = v - lo
      return (lo >= 0 && lo < reference.cross ? reference.ink[(u * reference.cross + lo) * 3 + c] * (1 - t) : 0)
        + (lo + 1 >= 0 && lo + 1 < reference.cross ? reference.ink[(u * reference.cross + lo + 1) * 3 + c] * t : 0)
    }
    const candidates = reference.length - length + 1
    budget(candidates * (observations.length + reference.cross * 6) + length * 16 * 3)
    const originalCentres = [0, 1].map(side => {
      const samples = observations.filter(o => o.side === side && o.c === 0 && o.value >= 8)
      const weight = samples.reduce((sum, o) => sum + o.value, 0)
      return weight ? samples.reduce((sum, o) => sum + o.v * o.value, 0) / weight : reference.centre
    })
    const shiftsAt = (offset: number) => [0, 1].map(side => {
      let weight = 0, position = 0
      for (let v = 0; v < reference.cross; v++) {
        const value = at(offset + (side ? length - 1 : 0), v, 0)
        if (value >= 8) { weight += value; position += v * value }
      }
      // Manual path remains the target centre where there is no visible
      // original joint. Both that centre and the source phase are inference.
      return weight ? Math.max(-3, Math.min(3, position / weight - originalCentres[side])) : 0
    })
    let best = -1, bestScore = Infinity, bestShifts = [0, 0]
    for (let offset = 0; offset < candidates; offset++) {
      let firstDepth = 0, lastDepth = 0
      for (let v = 0; v < reference.cross; v++) { firstDepth = Math.max(firstDepth, at(offset, v, 0)); lastDepth = Math.max(lastDepth, at(offset + length - 1, v, 0)) }
      // Original side evidence decides whether a source gap at an end fits.
      // Without such evidence prefer ink at the join, but don't erase gaps
      // inside the preserved original segment.
      const shifts = shiftsAt(offset)
      let score = observations.length ? observations.reduce((sum, o) => sum + Math.abs(o.value - at(offset + (o.side ? length - 1 : 0), o.v + shifts[o.side], o.c)), 0) / observations.length
        : Math.max(0, 8 - firstDepth) + Math.max(0, 8 - lastDepth)
      score += ((Math.imul(u0 + offset * 17, 1103515245) >>> 0) % 997) * .00001
      if (score < bestScore) { best = offset; bestScore = score; bestShifts = shifts }
    }
    cancel()
    for (let du = 0; du < length; du++) {
      const u = u0 + du, mid = pointAt(u)
      for (let v = Math.floor(mid - 7); v <= Math.ceil(mid + 7); v++) {
        const [x, y] = coords(u, v); if (!writable(x, y)) continue
        const i = ((y - bounds.y) * bounds.width + x - bounds.x) * 3
        const shift = bestShifts[0] * (1 - du / Math.max(1, length - 1)) + bestShifts[1] * du / Math.max(1, length - 1)
        for (let c = 0; c < 3; c++) targetInk[i + c] = Math.max(targetInk[i + c], at(best + du, reference.centre + v - mid + shift, c))
      }
    }
    first = last - 1
  }
  cancel()
}
