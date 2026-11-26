import type { PointMm } from '../model/scene.js'

interface Junction {
  point: PointMm | null
  edges: { neighbor: Junction; edge: { visited: boolean } }[]
}

/** UBI adds connectors between runs with coincident end/start points, even at
 * zero offset. Route the existing segments so every open endpoint appears once. */
export function uvttWallRuns(segments: readonly [PointMm, PointMm][]): PointMm[][] {
  const junctions = new Map<string, Junction>()
  const junction = (point: PointMm): Junction => {
    const key = `${point.x},${point.y}`
    const existing = junctions.get(key)
    if (existing) return existing
    const item: Junction = { point, edges: [] }
    junctions.set(key, item)
    return item
  }
  const link = (a: Junction, b: Junction) => {
    const edge = { visited: false }
    a.edges.push({ neighbor: b, edge })
    b.edges.push({ neighbor: a, edge })
  }
  for (const [a, b] of segments) link(junction(a), junction(b))

  // A temporary hub balances the degree of every junction. Traversing cycles
  // and splitting at the hub leaves the original segments in open or closed runs.
  const hub: Junction = { point: null, edges: [] }
  for (const item of junctions.values()) if (item.edges.length % 2) link(hub, item)
  const runs: PointMm[][] = []
  for (const start of [hub, ...junctions.values()]) {
    if (!start.edges.length) continue
    const stack = [start], cycle: Junction[] = []
    while (stack.length) {
      const current = stack[stack.length - 1]
      const next = current.edges.pop()
      if (!next) cycle.push(stack.pop()!)
      else if (!next.edge.visited) {
        next.edge.visited = true
        stack.push(next.neighbor)
      }
    }
    let run: PointMm[] = []
    for (let i = cycle.length - 1; i >= 0; i--) {
      const point = cycle[i].point
      if (point) run.push(point)
      else {
        if (run.length > 1) runs.push(run)
        run = []
      }
    }
    if (run.length > 1) runs.push(run)
  }
  return runs
}
