import type { PixelBounds } from './pixels.js'
import type { OriginalStrokeReference, OriginalStrokeRegistrations } from './guided-original-stroke.js'

type Point = { x: number; y: number }
type Rgb = readonly [number, number, number]
interface Profile { ink: number[][]; centre: number }

/** A complete column is necessary, but a paper step, broad shadow or two
 * competing strokes must not become a measured seam centre. These fixed gates
 * identify one bounded dark residual, not the semantic role of that stroke. */
function narrowProfile(ink: number[][]): Profile | undefined {
  const depth = ink.map(v => (v[0] + v[1] + v[2]) / 3), peak = Math.max(...depth)
  if (peak < 8) return
  const core = depth.map((v, i) => v >= Math.max(8, peak * .5) ? i : -1).filter(i => i >= 0)
  if (!core.length || core.at(-1)! - core[0] + 1 !== core.length || core.length > 5) return
  const support = depth.map((v, i) => v >= Math.max(4, peak * .22) ? i : -1).filter(i => i >= 0)
  if (!support.length || support[0] < 2 || support.at(-1)! > depth.length - 3
    || support.at(-1)! - support[0] + 1 !== support.length || support.length > 7) return
  // Require a dark feature in all channels; one colored paper residual is not
  // enough. Endpoint paper has already been estimated independently per RGB.
  if (core.some(i => Math.min(...ink[i]) < 4)) return
  const weight = support.reduce((s, i) => s + depth[i], 0)
  return { ink, centre: support.reduce((s, i) => s + i * depth[i], 0) / weight }
}

function originalProfile(colors: readonly Rgb[]): Profile | undefined {
  const n = colors.length, first = [0, 1, 2].map(c => (colors[0][c] + colors[1][c]) / 2)
  const last = [0, 1, 2].map(c => (colors[n - 2][c] + colors[n - 1][c]) / 2)
  const signed = colors.map((v, i) => v.map((value, c) => {
    const t = Math.max(0, Math.min(1, (i - .5) / (n - 2)))
    return first[c] * (1 - t) + last[c] * t - value
  }))
  const depths = signed.map(v => (v[0] + v[1] + v[2]) / 3), peak = Math.max(...depths)
  // A paper step creates opposite bright/dark lobes when a linear paper field
  // is subtracted. Clipping the bright lobe first would misclassify the dark
  // half of that step as a narrow independent stroke.
  if (-Math.min(...depths) > Math.max(6, peak * .35)) return
  return narrowProfile(signed.map(v => v.map(value => Math.max(0, Math.min(180, value)))))
}

/** Explicit complete-profile mode. Reads only the caller's trusted original
 * RGB callback, never fitted tone residuals or partial columns. Without valid
 * evidence use a centred, contiguous native source segment and the declared
 * manual centre. That is an inference, not a measured hidden seam. */
export function rasterCompleteOriginalStroke(reference: OriginalStrokeReference, points: readonly Point[], bounds: PixelBounds,
  writable: (x: number, y: number) => boolean, observedRgb: (x: number, y: number) => Rgb | undefined,
  targetInk: Float32Array, budget: (n: number) => void, cancel: () => void, collect = false): OriginalStrokeRegistrations {
  const horizontal = reference.axis === 'horizontal', along = (p: Point) => horizontal ? p.x : p.y, across = (p: Point) => horizontal ? p.y : p.x
  const forward = along(points.at(-1)!) >= along(points[0]) ? points : [...points].reverse()
  if (forward.some((p, i) => i > 0 && along(p) <= along(forward[i - 1]))) throw new Error('原尺寸接缝路径须沿参考方向单调，不能折返或有同轴重合段。')
  const start = Math.max(horizontal ? bounds.x : bounds.y, Math.ceil(along(forward[0])))
  const end = Math.min(horizontal ? bounds.x + bounds.width : bounds.y + bounds.height, Math.floor(along(forward.at(-1)!)) + 1)
  const pointAt = (u: number) => {
    let i = 1; while (i < forward.length - 1 && along(forward[i]) < u) i++
    const a = forward[i - 1], b = forward[i], t = (u - along(a)) / (along(b) - along(a))
    return across(a) + (across(b) - across(a)) * t
  }
  const coords = (u: number, v: number): [number, number] => horizontal ? [u, v] : [v, u]
  const active: boolean[] = []
  budget(Math.max(0, end - start) * 16)
  for (let u = start; u < end; u++) {
    cancel(); const mid = pointAt(u); let yes = false
    for (let v = Math.floor(mid - 7); v <= Math.ceil(mid + 7); v++) if (writable(...coords(u, v))) yes = true
    active.push(yes)
  }
  const result: OriginalStrokeRegistrations = { runs: [], totalRuns: 0, unlistedRuns: 0 }
  const sample = (u: number, v: number, c: number) => {
    const lo = Math.floor(v), t = v - lo
    return (lo >= 0 && lo < reference.cross ? reference.ink[(u * reference.cross + lo) * 3 + c] * (1 - t) : 0)
      + (lo + 1 >= 0 && lo + 1 < reference.cross ? reference.ink[(u * reference.cross + lo + 1) * 3 + c] * t : 0)
  }
  const sourceProfile = (u: number) => narrowProfile(Array.from({ length: reference.cross }, (_, v) => [0, 1, 2].map(c => sample(u, v, c))))
  for (let first = 0; first < active.length; first++) {
    if (!active[first]) continue
    cancel(); let last = first + 1; while (last < active.length && active[last]) last++
    const length = last - first, u0 = start + first
    if (length > reference.length) throw new Error(`原尺寸接缝可写段长${length}px，超过可信原参考${reference.length}px；请补更长参考或减少本次路径，不重复短线填满。`)
    budget(reference.cross * 6 * 3 + (reference.length - length + 1) * reference.cross * 12 + length * 48)
    const sides = [0, 1].map(side => {
      const profiles: Profile[] = []; let observedPixels = 0, corePixels = 0, complete = 0
      for (let k = 1; k <= 3; k++) {
        const u = side ? u0 + length - 1 + k : u0 - k, mid = pointAt(u), base = Math.round(mid - reference.centre)
        const colors: Rgb[] = []
        for (let v = 0; v < reference.cross; v++) {
          const color = observedRgb(...coords(u, base + v))
          if (color) { observedPixels++; if (Math.abs(base + v - mid) <= 1) corePixels++; colors.push(color) }
        }
        // Never assemble a profile from rows of different original columns.
        if (colors.length !== reference.cross) continue
        complete++
        const profile = originalProfile(colors)
        if (profile) profiles.push({ ink: profile.ink, centre: profile.centre + base - mid + reference.centre })
      }
      const centres = profiles.map(p => p.centre)
      if (centres.length && Math.max(...centres) - Math.min(...centres) > 1.25) throw new Error('完整接头列的窄线位置互相冲突，请核对原图与路径。')
      const centre = centres.length ? centres.reduce((s, v) => s + v, 0) / centres.length : reference.centre
      if (centres.length && Math.abs(centre - reference.centre) > 3) throw new Error('完整接头窄线偏离路径超过3px，请核对路径；不夹限位移。')
      return { profiles, centre, observedPixels, corePixels, complete }
    })
    let best = -1, bestScore = Infinity, shifts = [0, 0], sourceCentres: Array<number | null> = [null, null]
    const defaultOffset = Math.floor((reference.length - length) / 2)
    for (let offset = 0; offset <= reference.length - length; offset++) {
      cancel()
      const profiles = [sourceProfile(offset), sourceProfile(offset + length - 1)]
      if (sides.some((s, i) => s.profiles.length && !profiles[i])) continue
      const candidateShifts = profiles.map((p, i) => (p?.centre ?? reference.centre) - sides[i].centre)
      if (candidateShifts.some(v => Math.abs(v) > 3)) continue
      let score = 0
      for (const [i, side] of sides.entries()) for (const p of side.profiles) for (let v = 0; v < reference.cross; v++) for (let c = 0; c < 3; c++) {
        const d = p.centre - side.centre
        score += Math.abs(p.ink[v][c] - sample(offset + (i ? length - 1 : 0), v - d + candidateShifts[i], c)) / (side.profiles.length * reference.cross * 3)
      }
      // Deterministic phase prior, only as a tie break when real evidence fits.
      // With no accepted target profile this explicitly selects the centre.
      score += Math.abs(offset - defaultOffset) * .000001
      if (score < bestScore) { best = offset; bestScore = score; shifts = candidateShifts; sourceCentres = profiles.map(p => p?.centre ?? null) }
    }
    if (best < 0) throw new Error('没有与完整接头及3px位移范围相容的连续原尺寸片段，请核对原图与路径。')
    if (collect) {
      result.totalRuns++
      if (result.runs.length < 6) result.runs.push({ boundsPx: horizontal ? { x: u0, y: bounds.y, width: length, height: bounds.height }
        : { x: bounds.x, y: u0, width: bounds.width, height: length }, sourceOffsetPx: best,
      referenceCrossPx: reference.cross, sampledCrossPx: reference.cross, registrationMode: 'complete-profile', sides: sides.map((s, i) => ({
        side: i ? 'end' : 'start', observedPixels: s.observedPixels, corePixels: s.corePixels,
        completeSampledColumns: s.complete, weightedPixels: s.profiles.reduce((sum, p) => sum + p.ink.filter(v => (v[0] + v[1] + v[2]) / 3 >= 8).length, 0),
        targetCentre: s.centre, sourceCentre: sourceCentres[i], rawShiftPx: shifts[i], appliedShiftPx: shifts[i],
        basis: s.profiles.length ? 'observed-profile' : 'manual-fallback', qualifiedColumns: s.profiles.length,
        warnings: s.profiles.length ? [] : [s.complete ? 'no-unambiguous-narrow-profile' : 'no-complete-original-column', 'manual-path-inference'],
      })) })
    }
    for (let du = 0; du < length; du++) {
      cancel(); const u = u0 + du, mid = pointAt(u)
      const shift = shifts[0] * (1 - du / Math.max(1, length - 1)) + shifts[1] * du / Math.max(1, length - 1)
      for (let v = Math.floor(mid - 7); v <= Math.ceil(mid + 7); v++) {
        const [x, y] = coords(u, v); if (!writable(x, y)) continue
        const at = ((y - bounds.y) * bounds.width + x - bounds.x) * 3
        for (let c = 0; c < 3; c++) targetInk[at + c] = Math.max(targetInk[at + c], sample(best + du, reference.centre + v - mid + shift, c))
      }
    }
    first = last - 1
  }
  result.unlistedRuns = result.totalRuns - result.runs.length
  cancel(); return result
}
