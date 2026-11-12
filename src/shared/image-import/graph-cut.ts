/**
 * Exact finite s/t cut of a four-neighbour image grid. Source side is foreground.
 * Reverse arcs are explicit and all traversals are iterative (no image-sized stack).
 */
export function cutImageGrid(width: number, height: number, foregroundCost: Float64Array, backgroundCost: Float64Array,
  horizontal: Float64Array, vertical: Float64Array, seeds: Int8Array): Uint8Array {
  const size = width * height
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || size > 250_000
    || foregroundCost.length !== size || backgroundCost.length !== size || horizontal.length !== size || vertical.length !== size || seeds.length !== size) {
    throw new Error('辅助图割需要尺寸一致且不超过25万像素的局部代价。')
  }
  const source = size, sink = size + 1, nodes = size + 2, capacity = size * 8
  const head = new Int32Array(nodes).fill(-1), next = new Int32Array(capacity), to = new Int32Array(capacity), residual = new Float64Array(capacity)
  let used = 0, work = 0
  const epsilon = 1e-8, hard = 1e12, workLimit = 100_000_000
  const add = (first: number, second: number, forward: number, reverse = 0) => {
    to[used] = second; residual[used] = forward; next[used] = head[first]; head[first] = used++
    to[used] = first; residual[used] = reverse; next[used] = head[second]; head[second] = used++
  }
  for (let pixel = 0; pixel < size; pixel++) {
    if (![foregroundCost[pixel], backgroundCost[pixel], horizontal[pixel], vertical[pixel]].every(value => Number.isFinite(value) && value >= 0 && value <= 1000)
      || seeds[pixel] !== -1 && seeds[pixel] !== 0 && seeds[pixel] !== 1) throw new Error('辅助图割代价或种子无效。')
    add(source, pixel, seeds[pixel] === 1 ? hard : backgroundCost[pixel])
    add(pixel, sink, seeds[pixel] === -1 ? hard : foregroundCost[pixel])
    if (pixel % width + 1 < width) add(pixel, pixel + 1, horizontal[pixel], horizontal[pixel])
    if (pixel + width < size) add(pixel, pixel + width, vertical[pixel], vertical[pixel])
  }
  const level = new Int32Array(nodes), queue = new Int32Array(nodes), current = new Int32Array(nodes)
  const pathNodes = new Int32Array(nodes), pathEdges = new Int32Array(nodes), pathCapacity = new Float64Array(nodes)
  const breadthFirst = () => {
    level.fill(-1); level[source] = 0; queue[0] = source
    let first = 0, last = 1
    while (first < last) {
      const node = queue[first++]
      for (let edge = head[node]; edge >= 0; edge = next[edge]) {
        if (++work > workLimit) throw new Error('辅助图割计算超过本次预算，请缩小物件范围。')
        const target = to[edge]
        if (residual[edge] > epsilon && level[target] < 0) { level[target] = level[node] + 1; queue[last++] = target }
      }
    }
    return level[sink] >= 0
  }
  while (breadthFirst()) {
    current.set(head)
    pathNodes[0] = source; pathCapacity[0] = Infinity
    let depth = 0
    while (depth >= 0) {
      const node = pathNodes[depth]
      if (node === sink) {
        const flow = pathCapacity[depth]
        let bottleneck = depth
        for (let step = 0; step < depth; step++) {
          const edge = pathEdges[step]
          residual[edge] -= flow; residual[edge ^ 1] += flow
          if (residual[edge] <= epsilon) bottleneck = Math.min(bottleneck, step)
        }
        // Keep the still-usable path prefix; its capacities also lost this flow.
        for (let step = 1; step <= bottleneck; step++) pathCapacity[step] -= flow
        depth = bottleneck
        continue
      }
      let edge = current[node]
      while (edge >= 0 && (residual[edge] <= epsilon || level[to[edge]] !== level[node] + 1)) {
        if (++work > workLimit) throw new Error('辅助图割计算超过本次预算，请缩小物件范围。')
        edge = next[edge]
      }
      current[node] = edge
      if (edge < 0) { level[node] = -1; depth--; continue }
      if (++work > workLimit) throw new Error('辅助图割计算超过本次预算，请缩小物件范围。')
      pathEdges[depth] = edge; pathNodes[depth + 1] = to[edge]
      pathCapacity[depth + 1] = Math.min(pathCapacity[depth], residual[edge]); depth++
    }
  }
  // The last residual BFS is precisely the minimum source partition.
  return Uint8Array.from(level.subarray(0, size), value => value >= 0 ? 255 : 0)
}
