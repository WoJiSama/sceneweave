/**
 * Exact finite s/t cut of a four-neighbour image grid. Source side is foreground.
 * Hard labels are fixed before solving; their edges become costs for their neighbours.
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
  const foreground = foregroundCost.slice(), background = backgroundCost.slice()
  const epsilon = 1e-8, workLimit = 100_000_000
  let used = 0, work = 0
  const countArc = () => {
    if (++work > workLimit) throw new Error('辅助图割计算超过本次预算，请缩小物件范围。')
  }
  const add = (first: number, second: number, forward: number, reverse = 0) => {
    to[used] = second; residual[used] = forward; next[used] = head[first]; head[first] = used++
    to[used] = first; residual[used] = reverse; next[used] = head[second]; head[second] = used++
  }
  const connect = (first: number, second: number, weight: number) => {
    const a = seeds[first], b = seeds[second]
    if (!a && !b) add(first, second, weight, weight)
    else if (!a) (b === 1 ? background : foreground)[first] += weight
    else if (!b) (a === 1 ? background : foreground)[second] += weight
  }
  for (let pixel = 0; pixel < size; pixel++) {
    if (![foregroundCost[pixel], backgroundCost[pixel], horizontal[pixel], vertical[pixel]].every(value => Number.isFinite(value) && value >= 0 && value <= 1000)
      || seeds[pixel] !== -1 && seeds[pixel] !== 0 && seeds[pixel] !== 1) throw new Error('辅助图割代价或种子无效。')
    if (pixel % width + 1 < width) connect(pixel, pixel + 1, horizontal[pixel])
    if (pixel + width < size) connect(pixel, pixel + width, vertical[pixel])
  }
  for (let pixel = 0; pixel < size; pixel++) {
    if (seeds[pixel]) continue
    // Each cut pays exactly one unary term. Their common part is constant.
    const difference = background[pixel] - foreground[pixel]
    if (difference > epsilon) add(source, pixel, difference)
    if (difference < -epsilon) add(pixel, sink, -difference)
  }

  // Push-relabel avoids rebuilding a source-to-sink level graph for each flow phase.
  const excess = new Float64Array(nodes), heightLabel = new Int32Array(nodes), current = new Int32Array(nodes)
  const queue = new Int32Array(nodes), active = new Int32Array(nodes)
  let read = 0, write = 0
  const push = (edge: number, flow: number) => {
    const target = to[edge]
    if (target < size && excess[target] <= epsilon && excess[target] + flow > epsilon) active[write++ % nodes] = target
    excess[target] += flow
    residual[edge] -= flow; residual[edge ^ 1] += flow
  }
  const reverseDistances = (terminal: number, label: number) => {
    heightLabel[terminal] = label; queue[0] = terminal
    let first = 0, last = 1
    while (first < last) {
      const node = queue[first++]
      for (let edge = head[node]; edge >= 0; edge = next[edge]) {
        countArc()
        const target = to[edge]
        if (heightLabel[target] >= 0 || target === source || residual[edge ^ 1] <= epsilon) continue
        heightLabel[target] = heightLabel[node] + 1; queue[last++] = target
      }
    }
  }
  const globalRelabel = () => {
    heightLabel.fill(-1)
    reverseDistances(sink, 0)
    // Excess separated from the sink can return to the source along reverse arcs.
    reverseDistances(source, nodes)
    for (let node = 0; node < size; node++) if (heightLabel[node] < 0) heightLabel[node] = nodes * 2
    current.set(head)
    return work + 4 * used
  }
  for (let edge = head[source]; edge >= 0; edge = next[edge]) push(edge, residual[edge])
  let nextRelabel = globalRelabel()
  while (read < write) {
    const node = active[read++ % nodes]
    while (excess[node] > epsilon) {
      const edge = current[node]
      if (edge < 0) {
        let minimum = nodes * 2
        for (let candidate = head[node]; candidate >= 0; candidate = next[candidate]) {
          countArc()
          if (residual[candidate] > epsilon) minimum = Math.min(minimum, heightLabel[to[candidate]])
        }
        heightLabel[node] = minimum + 1; current[node] = head[node]
        continue
      }
      countArc()
      if (residual[edge] > epsilon && heightLabel[node] === heightLabel[to[edge]] + 1) {
        const flow = Math.min(excess[node], residual[edge])
        push(edge, flow); excess[node] -= flow
      } else current[node] = next[edge]
    }
    if (work >= nextRelabel && read < write) nextRelabel = globalRelabel()
  }

  // Residual reachability gives the smallest source side among optimal cuts.
  const selected = Uint8Array.from(seeds, seed => seed === 1 ? 255 : 0)
  queue[0] = source
  let first = 0, last = 1
  while (first < last) {
    const node = queue[first++]
    for (let edge = head[node]; edge >= 0; edge = next[edge]) {
      countArc()
      const target = to[edge]
      if (target >= size || selected[target] || residual[edge] <= epsilon) continue
      selected[target] = 255; queue[last++] = target
    }
  }
  return selected
}
