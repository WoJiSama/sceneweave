import type { BoundsMm } from '../../shared/model/scene.js'

/** Integer, disjoint union of the required gaps. Separated ranges never grow
 * into one enclosing mask that hides the public space between them. */
export function privacyMaskRectangles(input: readonly BoundsMm[]): BoundsMm[] {
  const boxes = input.map(box => {
    const x = Math.floor(box.x), y = Math.floor(box.y)
    return { x, y, width: Math.ceil(box.x + box.width) - x, height: Math.ceil(box.y + box.height) - y }
  })
  const cuts = [...new Set(boxes.flatMap(box => [box.x, box.x + box.width]))].sort((a, b) => a - b), result: BoundsMm[] = []
  let previous = new Map<string, BoundsMm>()
  for (let index = 1; index < cuts.length; index++) {
    const x = cuts[index - 1], right = cuts[index], intervals = boxes.filter(box => box.x < right && box.x + box.width > x)
      .map(box => [box.y, box.y + box.height]).sort((a, b) => a[0] - b[0])
    const merged: number[][] = []
    for (const interval of intervals) {
      const last = merged.at(-1)
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
      else merged.push([...interval])
    }
    const current = new Map<string, BoundsMm>()
    for (const [y, bottom] of merged) {
      const key = `${y}:${bottom}`, prior = previous.get(key)
      const box = prior && prior.x + prior.width === x ? prior : { x, y, width: 0, height: bottom - y }
      if (box !== prior) result.push(box)
      box.width += right - x; current.set(key, box)
    }
    previous = current
  }
  return result
}
