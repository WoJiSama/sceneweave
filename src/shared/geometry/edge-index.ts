import type { PointMm } from '../model/scene.js'

export type SegmentMm = readonly [PointMm, PointMm]
type Box = { minX: number; minY: number; maxX: number; maxY: number }
type Entry = Box & { index: number }
type Node = Box & ({ entries: Entry[] } | { left: Node; right: Node })
const bounds = (a: PointMm, b: PointMm): Box => ({ minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) })
const meets = (a: Box, b: Box, pad: number) => a.minX <= b.maxX + pad && a.maxX >= b.minX - pad
  && a.minY <= b.maxY + pad && a.maxY >= b.minY - pad

/** Synchronous index over an exact ordered edge list. A query only narrows
 * candidates: callers still run their original geometric predicates. */
export function indexEdges(edges: readonly SegmentMm[]) {
  function build(entries: Entry[]): Node {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const entry of entries) {
      box.minX = Math.min(box.minX, entry.minX); box.minY = Math.min(box.minY, entry.minY)
      box.maxX = Math.max(box.maxX, entry.maxX); box.maxY = Math.max(box.maxY, entry.maxY)
    }
    if (entries.length <= 8) return { ...box, entries }
    const x = box.maxX - box.minX >= box.maxY - box.minY
    entries.sort((a, b) => x ? a.minX + a.maxX - b.minX - b.maxX : a.minY + a.maxY - b.minY - b.maxY)
    const mid = Math.floor(entries.length / 2)
    return { ...box, left: build(entries.slice(0, mid)), right: build(entries.slice(mid)) }
  }
  const root = build(edges.map(([a, b], index) => ({ ...bounds(a, b), index })))
  return (a: PointMm, b: PointMm, padding = 0): number[] => {
    const query = bounds(a, b), found: number[] = []
    const visit = (node: Node) => {
      if (!meets(node, query, padding)) return
      if ('entries' in node) {
        for (const entry of node.entries) if (meets(entry, query, padding)) found.push(entry.index)
      } else {
        visit(node.left); visit(node.right)
      }
    }
    visit(root)
    return found.sort((x, y) => x - y)
  }
}

/** Count candidates that actually reach a narrow-phase geometry predicate.
 * The observer is scoped synchronously and cannot persist into another call. */
let observe: ((count: number) => void) | undefined
export function withGeometryPairCounter<T>(observer: (count: number) => void, action: () => T): T {
  const previous = observe
  observe = observer
  try { return action() } finally { observe = previous }
}
export function observeGeometryPairs(count: number) { observe?.(count) }
