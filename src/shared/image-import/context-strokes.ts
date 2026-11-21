import type { ImagePixelMask, ImagePixels } from './pixels.js'
import type { GuidedToneReport, ImageSurfaceStructureGuide } from './guided-surface-repair.js'
import { prepareOriginalSurfaceStroke, rasterOriginalSurfaceStroke } from './guided-original-stroke.js'
import { maskCoverage } from './repair-scope.js'

/** Add only the missing depth of narrow native strokes to an already blended patch. */
export function composeContextStrokes(source: ImagePixels, patch: ImagePixels, mask: ImagePixelMask, guides: readonly ImageSurfaceStructureGuide[],
  trusted: (x: number, y: number) => boolean, budget: (amount: number) => void, cancel: () => void, collect: boolean) {
  const { x, y, width, height } = mask.boundsPx
  const data = patch.data.slice(), ink = new Float32Array(width * height * 3)
  const strokeRegistration: GuidedToneReport['strokeRegistration'] = { runs: [], totalRuns: 0, unlistedRuns: 0 }
  const writable = (px: number, py: number) => !!maskCoverage(mask, px, py)
  const rgb = (image: ImagePixels, px: number, py: number): [number, number, number] => {
    const at = (py * source.width + px) * 4
    return [image.data[at], image.data[at + 1], image.data[at + 2]]
  }
  const observedRgb = (px: number, py: number) => trusted(px, py) ? rgb(source, px, py) : undefined
  for (const [guideIndex, guide] of guides.entries()) {
    cancel()
    budget(ink.length + guide.reference.width * guide.reference.height * 9)
    ink.fill(0)
    const reference = prepareOriginalSurfaceStroke(source, guide.reference, guide.axis, cancel, 'two-sided')
    const registrations = rasterOriginalSurfaceStroke(reference, guide.points, mask.boundsPx, writable, () => undefined,
      ink, budget, cancel, collect, { mode: 'complete-profile', observedRgb })
    strokeRegistration.totalRuns += registrations.totalRuns
    for (const run of registrations.runs) if (strokeRegistration.runs.length < 6) strokeRegistration.runs.push({ ...run, guideIndex })

    const horizontal = guide.axis === 'horizontal'
    const along = (point: { x: number; y: number }) => horizontal ? point.x : point.y
    const across = (point: { x: number; y: number }) => horizontal ? point.y : point.x
    const coords = (u: number, v: number): [number, number] => horizontal ? [u, v] : [v, u]
    const points = along(guide.points[0]) < along(guide.points.at(-1)!) ? guide.points : [...guide.points].reverse()
    const start = Math.max(horizontal ? x : y, Math.ceil(along(points[0])))
    const end = Math.min(horizontal ? x + width : y + height, Math.floor(along(points.at(-1)!)) + 1)
    // Flanks may come from the blended patch or from trusted original pixels.
    // Keep all registration inputs original, even where the patch is writable.
    const paperAt = (u: number, v: number) => {
      const [px, py] = coords(u, v)
      return writable(px, py) ? rgb(patch, px, py) : observedRgb(px, py)
    }
    let segment = 1
    for (let u = start; u < end; u++) {
      cancel()
      budget(250)
      while (segment < points.length - 1 && along(points[segment]) < u) segment++
      const first = points[segment - 1], last = points[segment]
      const position = (u - along(first)) / (along(last) - along(first))
      const middle = across(first) + (across(last) - across(first)) * position
      const center = Math.round(middle)
      const flanks = [u - 4, u, u + 4].flatMap(column => {
        const left = paperAt(column, center - 9), nearLeft = paperAt(column, center - 8)
        const right = paperAt(column, center + 9), nearRight = paperAt(column, center + 8)
        return left && nearLeft && right && nearRight ? [{ left, nearLeft, right, nearRight }] : []
      })
      if (!flanks.length) continue
      for (let v = Math.floor(middle - 7); v <= Math.ceil(middle + 7); v++) {
        const [px, py] = coords(u, v)
        if (!writable(px, py)) continue
        const at = (py * source.width + px) * 4, sampled = ((py - y) * width + px - x) * 3
        const acrossPaper = (v - center + 8.5) / 17
        for (let channel = 0; channel < 3; channel++) {
          const depth = ink[sampled + channel]
          if (!depth) continue
          // Use the nearby brighter paper so a transverse seam already in the
          // patch does not get the full depth of a second stroke at a junction.
          const paper = Math.max(...flanks.map(({ left, nearLeft, right, nearRight }) =>
            (left[channel] + nearLeft[channel]) / 2 * (1 - acrossPaper) + (right[channel] + nearRight[channel]) / 2 * acrossPaper))
          data[at + channel] = Math.min(data[at + channel], paper - depth * .85)
        }
      }
    }
  }
  strokeRegistration.unlistedRuns = strokeRegistration.totalRuns - strokeRegistration.runs.length
  return { pixels: { ...patch, data }, strokeRegistration }
}
