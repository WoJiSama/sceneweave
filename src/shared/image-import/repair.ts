import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'

export interface ImageRegionRepairOptions {
  /** Relaxation iterations per scale. Affects the fixed output and must accompany replay settings. */
  iterations?: number
  /** Admission budget for pixel and channel work. Insufficient budgets fail before returning an image. */
  maxWork?: number
  /** Later regions override earlier labels; nearest labels extend to the cleanup halo and boundary. */
  regions?: Array<{ mask: ImagePixelMask; donor: PixelBounds }>
  /** Original object selection, before the separately declared cleanup halo is expanded. */
  baseMask?: ImagePixelMask
  /** Explicit fixed algorithm; omitted keeps the original seamless recipe byte-for-byte. */
  alignment?: 'boundary-phase-v1'
}
interface CorrectionGrid { x: number; y: number; step: number; width: number; height: number; values: Float32Array }
interface DonorPhase { x: number; y: number }
const DEFAULT_ITERATIONS = 24
const DEFAULT_WORK = 80_000_000
const MAX_GRID_PIXELS = 1_000_000
const BOUNDARY_RADIUS = 3
const COLOR_DECAY_PX = 8
const ALIGNMENT_SAMPLES = 256
const ALIGNMENT_GRID = 12
const ALIGNMENT_EXACT_PERIOD = 32
const ALIGNMENT_CANDIDATES = ALIGNMENT_EXACT_PERIOD ** 2 + 1 + 9 * 15

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}

function validate(image: ImagePixels, mask: ImagePixelMask, donor: PixelBounds): void {
  if (![image.width, image.height].every(Number.isSafeInteger) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192
    || image.width * image.height > 32_000_000 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error('无缝补底需要完整RGBA，边长不超过8192像素且总量不超过3200万像素。')
  }
  for (const bounds of [mask.boundsPx, donor]) {
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) || bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1
      || bounds.x + bounds.width > image.width || bounds.y + bounds.height > image.height) throw new Error('补底遮罩与取样矩形必须在原图内。')
  }
  if (mask.width !== mask.boundsPx.width || mask.height !== mask.boundsPx.height || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) {
    throw new Error('补底遮罩尺寸与像素记录不一致。')
  }
}

function maskAt(mask: ImagePixelMask, x: number, y: number): number {
  const localX = x - mask.boundsPx.x, localY = y - mask.boundsPx.y
  return localX >= 0 && localY >= 0 && localX < mask.width && localY < mask.height ? mask.data[localY * mask.width + localX] : 0
}

/** Mirror extension keeps adjacent tile edges continuous without changing donor pixels. */
function mirror(position: number, origin: number, length: number): number {
  const period = length * 2, value = ((position - origin) % period + period) % period
  return origin + (value < length ? value : period - 1 - value)
}

function donorIndex(image: ImagePixels, donor: PixelBounds, x: number, y: number, phase?: DonorPhase): number {
  return (mirror(y + (phase?.y ?? 0), donor.y, donor.height) * image.width + mirror(x + (phase?.x ?? 0), donor.x, donor.width)) * 4
}

/** Match a translation of this exact donor, never rotate it or inspect removed object pixels. */
function alignDonor(image: ImagePixels, donor: PixelBounds, evidence: number[]): DonorPhase {
  if (evidence.length < 8) return { x: 0, y: 0 }
  // Uniformly retain the full perimeter rather than just the first side in scan order.
  const samples = Array.from({ length: Math.min(evidence.length, ALIGNMENT_SAMPLES) }, (_, index) =>
    evidence[Math.floor(index * evidence.length / Math.min(evidence.length, ALIGNMENT_SAMPLES))])
  const periodX = donor.width * 2, periodY = donor.height * 2
  const seen = new Set<number>()
  let best = { x: 0, y: 0 }, bestScore = Infinity
  const score = (phase: DonorPhase): number => {
    const differences = [[], [], [], []] as number[][]
    for (const original of samples) {
      const pixel = original / 4, x = pixel % image.width, y = Math.floor(pixel / image.width)
      const sample = donorIndex(image, donor, x, y, phase)
      for (let channel = 0; channel < 4; channel++) differences[channel].push(
        premultiplied(image.data, original, channel) - premultiplied(image.data, sample, channel))
    }
    // Remove broad colour bias: the existing seamless solve owns lighting correction.
    // Clipping limits the influence of a residual shadow or another narrow boundary mark.
    let total = 0
    for (const values of differences) {
      const center = values.reduce((sum, value) => sum + value, 0) / values.length
      for (const value of values) total += Math.min(96, Math.abs(value - center))
    }
    return total / samples.length
  }
  const consider = (x: number, y: number) => {
    x = ((x % periodX) + periodX) % periodX; y = ((y % periodY) + periodY) % periodY
    const key = y * periodX + x
    if (seen.has(key)) return
    seen.add(key)
    const candidate = { x, y }, value = score(candidate)
    if (value + 1e-9 < bestScore) { best = candidate; bestScore = value }
  }
  consider(0, 0)
  const originalScore = bestScore
  const columns = periodX <= ALIGNMENT_EXACT_PERIOD ? periodX : ALIGNMENT_GRID
  const rows = periodY <= ALIGNMENT_EXACT_PERIOD ? periodY : ALIGNMENT_GRID
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      consider(Math.floor(column * periodX / columns), Math.floor(row * periodY / rows))
    }
  }
  let stepX = Math.max(1, Math.ceil(periodX / ALIGNMENT_GRID / 2)), stepY = Math.max(1, Math.ceil(periodY / ALIGNMENT_GRID / 2))
  for (;;) {
    const center = best
    for (const dy of [-stepY, 0, stepY]) for (const dx of [-stepX, 0, stepX]) consider(center.x + dx, center.y + dy)
    if (stepX === 1 && stepY === 1) break
    stepX = Math.max(1, Math.floor(stepX / 2)); stepY = Math.max(1, Math.floor(stepY / 2))
  }
  // A nearly tied phase has no useful supporting evidence; retain the original mapping.
  return bestScore < originalScore * .98 ? best : { x: 0, y: 0 }
}

/** Labels are inferred from user choices, without reading any selected source color. */
function extendMaterialLabels(image: ImagePixels, main: ImagePixelMask, base: ImagePixelMask,
  regions: NonNullable<ImageRegionRepairOptions['regions']>): { bounds: PixelBounds; data: Uint8Array } {
  const padding = 35, x = Math.max(0, main.boundsPx.x - padding), y = Math.max(0, main.boundsPx.y - padding)
  const width = Math.min(image.width, main.boundsPx.x + main.width + padding) - x
  const height = Math.min(image.height, main.boundsPx.y + main.height + padding) - y
  const data = new Uint8Array(width * height).fill(255), queue = new Uint32Array(width * height)
  let count = 0, head = 0
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const px = x + column, py = y + row, index = row * width + column
      if (!maskAt(base, px, py)) continue
      let label = 0
      for (let region = 0; region < regions.length; region++) if (maskAt(regions[region].mask, px, py)) label = region + 1
      data[index] = label
      queue[count++] = index
    }
  }
  if (count === 0) throw new Error('原物件遮罩没有覆盖像素。')
  while (head < count) {
    const index = queue[head++], column = index % width, row = Math.floor(index / width)
    const neighbors = [column > 0 ? index - 1 : -1, column + 1 < width ? index + 1 : -1,
      row > 0 ? index - width : -1, row + 1 < height ? index + width : -1]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || data[neighbor] !== 255) continue
      data[neighbor] = data[index]
      queue[count++] = neighbor
    }
  }
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    for (let region = 0; region < regions.length; region++) {
      if (maskAt(regions[region].mask, x + column, y + row)) data[row * width + column] = region + 1
    }
  }
  return { bounds: { x, y, width, height }, data }
}

function premultiplied(data: Uint8ClampedArray, index: number, channel: number): number {
  return channel === 3 ? data[index + 3] : data[index + channel] * data[index + 3] / 255
}

function gridShape(image: ImagePixels, bounds: PixelBounds, step: number): Omit<CorrectionGrid, 'values'> {
  const x = Math.max(0, bounds.x - step), y = Math.max(0, bounds.y - step)
  const right = Math.min(image.width - 1, bounds.x + bounds.width - 1 + step)
  const bottom = Math.min(image.height - 1, bounds.y + bounds.height - 1 + step)
  return { x, y, step, width: Math.ceil((right - x) / step) + 1, height: Math.ceil((bottom - y) / step) + 1 }
}

function interpolate(grid: CorrectionGrid, x: number, y: number, channel: number): number {
  const gx = Math.max(0, Math.min(grid.width - 1, (x - grid.x) / grid.step))
  const gy = Math.max(0, Math.min(grid.height - 1, (y - grid.y) / grid.step))
  const left = Math.floor(gx), top = Math.floor(gy), right = Math.min(left + 1, grid.width - 1), bottom = Math.min(top + 1, grid.height - 1)
  const fx = gx - left, fy = gy - top
  const at = (column: number, row: number) => grid.values[(row * grid.width + column) * 4 + channel]
  return (at(left, top) * (1 - fx) + at(right, top) * fx) * (1 - fy) + (at(left, bottom) * (1 - fx) + at(right, bottom) * fx) * fy
}

/** Donor texture plus a screened, multiscale color correction from robust unmasked evidence. */
export function repairImageRegion(image: ImagePixels, mask: ImagePixelMask, donor: PixelBounds,
  options: ImageRegionRepairOptions = {}): ImagePixels {
  validate(image, mask, donor)
  const iterations = options.iterations ?? DEFAULT_ITERATIONS, maxWork = options.maxWork ?? DEFAULT_WORK
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 128 || !Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('无缝补底迭代或工作预算无效。')
  if (options.alignment !== undefined && options.alignment !== 'boundary-phase-v1') throw new Error('不支持的纹理对齐算法。')
  const regions = options.regions ?? []
  if (!Array.isArray(regions) || regions.length > 8) throw new Error('无缝补底最多支持8个取样区域。')
  regions.forEach(region => validate(image, region.mask, region.donor))
  const base = options.baseMask ?? mask
  validate(image, base, donor)
  let baseCount = 0
  for (let row = 0; row < base.height; row++) for (let column = 0; column < base.width; column++) {
    if (!base.data[row * base.width + column]) continue
    baseCount++
    if (!maskAt(mask, base.boundsPx.x + column, base.boundsPx.y + row)) throw new Error('原物件遮罩必须完整包含在修补范围内。')
  }
  if (!baseCount) throw new Error('原物件遮罩没有覆盖像素。')
  const donors = [donor, ...regions.map(region => region.donor)]
  const phases = new Map<PixelBounds, DonorPhase>()
  const guidanceDonor = (x: number, y: number) => {
    const index = (y - labels.bounds.y) * labels.bounds.width + x - labels.bounds.x
    return donors[labels.data[index]]
  }
  const guidanceIndex = (x: number, y: number) => {
    const material = guidanceDonor(x, y)
    return donorIndex(image, material, x, y, phases.get(material))
  }
  const boundaryCache = new Map<number, number[]>()
  const boundaryCorrection = (x: number, y: number): number[] => {
    const key = y * image.width + x, cached = boundaryCache.get(key)
    if (cached) return cached
    const material = guidanceDonor(x, y), channels: number[][] = [[], [], [], []]
    for (let ny = Math.max(0, y - BOUNDARY_RADIUS); ny <= Math.min(image.height - 1, y + BOUNDARY_RADIUS); ny++) {
      for (let nx = Math.max(0, x - BOUNDARY_RADIUS); nx <= Math.min(image.width - 1, x + BOUNDARY_RADIUS); nx++) {
        if (maskAt(mask, nx, ny) || guidanceDonor(nx, ny) !== material) continue
        const original = (ny * image.width + nx) * 4, sample = guidanceIndex(nx, ny)
        for (let channel = 0; channel < 4; channel++) channels[channel].push(premultiplied(image.data, original, channel) - premultiplied(image.data, sample, channel))
      }
    }
    const correction = channels.map(median)
    boundaryCache.set(key, correction)
    return correction
  }
  let firstStep = 1
  while (firstStep < 16 && Math.max(mask.width, mask.height) / firstStep > 64) firstStep *= 2
  const shapes: Array<Omit<CorrectionGrid, 'values'>> = []
  let work = mask.data.length * (4 + donors.length) + Math.min(image.width, mask.width + 70) * Math.min(image.height, mask.height + 70) * (2 * regions.length + 1)
  if (options.alignment) work += Math.min(image.width, mask.width + 6) * Math.min(image.height, mask.height + 6) * 16
    + donors.length * ALIGNMENT_SAMPLES * ALIGNMENT_CANDIDATES * 16
  for (let step = firstStep; step >= 1; step /= 2) {
    const shape = gridShape(image, mask.boundsPx, step), pixels = shape.width * shape.height
    work += pixels * ((iterations + 1) * 4 + (2 * BOUNDARY_RADIUS + 1) ** 2 * (regions.length + 4))
    if (pixels > MAX_GRID_PIXELS || work > maxWork) throw new Error('无缝补底超过计算预算，请缩小选区或减少迭代。')
    shapes.push(shape)
  }
  const labels = extendMaterialLabels(image, mask, base, regions)
  if (options.alignment) {
    const evidence = new Map(donors.map(material => [material, [] as number[]]))
    for (let y = Math.max(0, mask.boundsPx.y - 3); y < Math.min(image.height, mask.boundsPx.y + mask.height + 3); y++) {
      for (let x = Math.max(0, mask.boundsPx.x - 3); x < Math.min(image.width, mask.boundsPx.x + mask.width + 3); x++) {
        if (maskAt(mask, x, y)) {
          if (donors.some(bounds => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height)) {
            throw new Error('补底取样范围与遮罩相交。')
          }
          continue
        }
        let near = false
        for (let distance = 1; distance <= 3 && !near; distance++) near = !!(maskAt(mask, x - distance, y)
          || maskAt(mask, x + distance, y) || maskAt(mask, x, y - distance) || maskAt(mask, x, y + distance))
        if (near) evidence.get(guidanceDonor(x, y))!.push((y * image.width + x) * 4)
      }
    }
    for (const material of donors) phases.set(material, alignDonor(image, material, evidence.get(material)!))
  }
  const boundarySamples = new Map(donors.map(material => [material, [[], [], [], []] as number[][]]))
  let selectedCount = 0
  for (let row = 0; row < mask.height; row++) {
    for (let column = 0; column < mask.width; column++) {
      if (mask.data[row * mask.width + column] === 0) continue
      selectedCount++
      const x = mask.boundsPx.x + column, y = mask.boundsPx.y + row
      if (donors.some(bounds => x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height)) throw new Error('补底取样范围与遮罩相交。')
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height || maskAt(mask, nx, ny)) continue
        const correction = boundaryCorrection(nx, ny)
        const samples = boundarySamples.get(guidanceDonor(nx, ny))!
        for (let channel = 0; channel < 4; channel++) samples[channel].push(correction[channel])
      }
    }
  }
  if (selectedCount === 0) throw new Error('补底遮罩没有覆盖像素。')
  const materialColor = new Map([...boundarySamples].map(([material, channels]) => [material, channels.map(values => values.length ? median(values) : 0)]))
  let previous: CorrectionGrid | undefined
  for (const shape of shapes) {
    const grid: CorrectionGrid = { ...shape, values: new Float32Array(shape.width * shape.height * 4) }
    const targets = new Float32Array(grid.values.length)
    const active = new Uint8Array(grid.width * grid.height)
    const screening = (grid.step / COLOR_DECAY_PX) ** 2
    for (let row = 0; row < grid.height; row++) {
      for (let column = 0; column < grid.width; column++) {
        const x = Math.min(image.width - 1, grid.x + column * grid.step), y = Math.min(image.height - 1, grid.y + row * grid.step)
        const index = row * grid.width + column
        active[index] = maskAt(mask, x, y) ? 1 : 0
        const boundary = active[index] ? undefined : boundaryCorrection(x, y)
        const color = materialColor.get(guidanceDonor(x, y))!
        for (let channel = 0; channel < 4; channel++) {
          targets[index * 4 + channel] = color[channel]
          const estimate = active[index] && previous ? interpolate(previous, x, y, channel) : color[channel]
          grid.values[index * 4 + channel] = active[index] ? estimate : boundary![channel]
        }
      }
    }
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let parity = 0; parity < 2; parity++) {
        for (let row = 0; row < grid.height; row++) {
          for (let column = (parity + row) % 2; column < grid.width; column += 2) {
            const index = row * grid.width + column
            if (!active[index]) continue
            const neighbors: number[] = []
            if (column > 0) neighbors.push(index - 1)
            if (column + 1 < grid.width) neighbors.push(index + 1)
            if (row > 0) neighbors.push(index - grid.width)
            if (row + 1 < grid.height) neighbors.push(index + grid.width)
            for (let channel = 0; channel < 4; channel++) {
              let sum = 0
              for (const neighbor of neighbors) sum += grid.values[neighbor * 4 + channel]
              const offset = index * 4 + channel
              grid.values[offset] += 1.6 * ((sum + screening * targets[offset]) / (neighbors.length + screening) - grid.values[offset])
            }
          }
        }
      }
    }
    previous = grid
  }
  const data = image.data.slice(), correction = previous!
  for (let row = 0; row < mask.height; row++) {
    for (let column = 0; column < mask.width; column++) {
      if (!mask.data[row * mask.width + column]) continue
      const x = mask.boundsPx.x + column, y = mask.boundsPx.y + row, sample = guidanceIndex(x, y)
      const output = (y * image.width + x) * 4, gridIndex = ((y - correction.y) * correction.width + x - correction.x) * 4
      const alpha = Math.max(0, Math.min(255, image.data[sample + 3] + correction.values[gridIndex + 3]))
      data[output + 3] = Math.round(alpha)
      for (let channel = 0; channel < 3; channel++) {
        data[output + channel] = alpha > 0 ? Math.round((premultiplied(image.data, sample, channel) + correction.values[gridIndex + channel]) * 255 / alpha) : 0
      }
    }
  }
  return { width: image.width, height: image.height, data }
}
