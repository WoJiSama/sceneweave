import { extractImageLayer, type ExtractedImageLayer, type ImagePixelMask, type ImagePixels, type PixelBounds } from './pixels.js'
import type { ImageImportLayer } from './recipe.js'
import { assertSelectionMaskBudget, encodeSelectionMask } from './selection-mask.js'
import { guidedImageSelection } from './guided-selection.js'
import { validateImageRepairSurfaces, type ImageRepairSurface } from './surfaces.js'
import { imageNeighborhoodObjectEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'

/** Replaying a draft does not require a room, scale or complete import recipe. */
export type ImageReplayLayer = Pick<ImageImportLayer, 'id' | 'polygon' | 'donor' | 'repair' | 'fills' | 'cleanupPx' | 'selectionMask' | 'guidedSelection' | 'removalMask' | 'protectionMask' | 'appearanceSource' | 'repairSurfaceIds'> & { renderLayer?: ImageImportLayer['renderLayer'] }

export interface ImageDeclaredDonorSource {
  /** Zero is the default donor; subsequent indexes retain the declared fill order. */
  index: number
  boundsPx: PixelBounds
  /** Rectangle overlap only: this does not measure the pixels actually sampled. */
  priorInferencePixels: number
}

export interface ImageLayerSourceDiagnostics {
  layerId: string
  declaredDonors: ImageDeclaredDonorSource[]
  extractedInferencePixels: number
  repairPixels: number
  /** Prior producers intersecting declared donor rectangles or the extraction mask. */
  priorLayerIds: string[]
  actualSampledInferencePixels: 'notMeasured'
  boundaryInferencePixels: 'notMeasured'
}

export interface ImageLayerSourceReport {
  totalPixels: number
  capturedSourcePixels: number
  inferredPixels: number
  layerCount: number
  /** Per-layer repair counts are cumulative, so repeated repairs count again. */
  repairPixels: number
  extractedInferencePixels: number
  /** Sum of declared rectangles, including overlaps between donor declarations. */
  declaredDonorPriorInferencePixels: number
  actualSampledInferencePixels: 'notMeasured'
  boundaryInferencePixels: 'notMeasured'
  layers: ImageLayerSourceDiagnostics[]
}

export interface ImageLayerReplay<T extends ImageReplayLayer> {
  layer: T
  /** Intermediate full-size backgrounds are deliberately not retained. */
  extracted: Omit<ExtractedImageLayer, 'remaining'>
  diagnostics: ImageLayerSourceDiagnostics
}

function assertSource(source: ImagePixels): void {
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
    || source.width > 8192 || source.height > 8192 || source.width * source.height > 32_000_000
    || !(source.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height * 4) {
    throw new Error('图片必须是完整RGBA，边长不超过8192像素且总量不超过3200万像素。')
  }
}

function visitMask(mask: ImagePixelMask, sourceWidth: number, visit: (sourceIndex: number) => void): void {
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (mask.data[y * mask.width + x] > 0) visit((y + mask.boundsPx.y) * sourceWidth + x + mask.boundsPx.x)
  }
}

const SOURCE_BLOCK_SIZE = 32

/** Exact summaries avoid visiting large, mostly original donor rectangles pixel by pixel. */
class ImageSourceProvenance {
  readonly data: Uint8Array
  inferredPixels = 0
  private readonly columns: number
  private readonly occupancy: Uint16Array
  private readonly producerCounts: Uint16Array
  private readonly producerBits: Uint32Array
  constructor(private readonly width: number, private readonly height: number, private readonly producers: number) {
    this.data = new Uint8Array(width * height)
    this.columns = Math.ceil(width / SOURCE_BLOCK_SIZE)
    const blocks = this.columns * Math.ceil(height / SOURCE_BLOCK_SIZE)
    // A block has at most 1024 pixels. Counts track only producers present in this replay.
    this.occupancy = new Uint16Array(blocks)
    this.producerCounts = new Uint16Array(blocks * producers)
    this.producerBits = new Uint32Array(blocks * 2)
  }
  mark(sourceIndex: number, producer: number): void {
    const previous = this.data[sourceIndex]
    if (previous === producer) return
    const x = sourceIndex % this.width, y = Math.floor(sourceIndex / this.width)
    const block = Math.floor(y / SOURCE_BLOCK_SIZE) * this.columns + Math.floor(x / SOURCE_BLOCK_SIZE)
    const firstCount = block * this.producers
    if (previous) {
      const count = firstCount + previous - 1
      if (--this.producerCounts[count] === 0) {
        this.producerBits[block * 2 + Math.floor((previous - 1) / 32)] &= ~(1 << ((previous - 1) % 32))
      }
    } else {
      this.occupancy[block]++
      this.inferredPixels++
    }
    const count = firstCount + producer - 1
    if (this.producerCounts[count]++ === 0) this.producerBits[block * 2 + Math.floor((producer - 1) / 32)] |= 1 << ((producer - 1) % 32)
    this.data[sourceIndex] = producer
  }
  declaredOverlap(bounds: PixelBounds, priorProducers: Set<number>): number {
    if (!this.inferredPixels) return 0
    const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height
    const firstColumn = Math.floor(bounds.x / SOURCE_BLOCK_SIZE), lastColumn = Math.floor((right - 1) / SOURCE_BLOCK_SIZE)
    const firstRow = Math.floor(bounds.y / SOURCE_BLOCK_SIZE), lastRow = Math.floor((bottom - 1) / SOURCE_BLOCK_SIZE)
    let pixels = 0, lowBits = 0, highBits = 0
    for (let row = firstRow; row <= lastRow; row++) for (let column = firstColumn; column <= lastColumn; column++) {
      const block = row * this.columns + column
      if (!this.occupancy[block]) continue
      const blockX = column * SOURCE_BLOCK_SIZE, blockY = row * SOURCE_BLOCK_SIZE
      const blockRight = Math.min(this.width, blockX + SOURCE_BLOCK_SIZE), blockBottom = Math.min(this.height, blockY + SOURCE_BLOCK_SIZE)
      if (bounds.x <= blockX && bounds.y <= blockY && right >= blockRight && bottom >= blockBottom) {
        pixels += this.occupancy[block]
        lowBits |= this.producerBits[block * 2]
        highBits |= this.producerBits[block * 2 + 1]
      } else {
        for (let y = Math.max(bounds.y, blockY); y < Math.min(bottom, blockBottom); y++) {
          for (let x = Math.max(bounds.x, blockX); x < Math.min(right, blockRight); x++) {
            const producer = this.data[y * this.width + x]
            if (producer) { pixels++; priorProducers.add(producer) }
          }
        }
      }
    }
    for (let bit = 0; bit < 32; bit++) {
      if (lowBits & 1 << bit) priorProducers.add(bit + 1)
      if (highBits & 1 << bit) priorProducers.add(bit + 33)
    }
    return pixels
  }
}

/**
 * Replay exact extraction/repair bytes while tracking where background pixels were inferred.
 * Provenance records repair membership, never byte difference or confidence: even an unchanged
 * repaired pixel is inferred. Only the final map is returned (0=captured source, 1..64=last repair).
 */
export function replayImageLayers<T extends ImageReplayLayer>(source: ImagePixels, input: readonly T[], surfaces: readonly ImageRepairSurface[] = [],
  context: { evidenceLayers?: readonly ImageReplayLayer[]; signal?: ImageNeighborhoodSignal } = {}) {
  assertSource(source)
  validateImageRepairSurfaces(source, surfaces)
  if (!Array.isArray(input) || input.length > 64) throw new Error('一次拆解最多64层。')
  const ids = new Set<string>()
  for (const layer of input) {
    if (typeof layer.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(layer.id) || layer.id === '__proto__') throw new Error('拆解物件身份无效。')
    if (ids.has(layer.id)) throw new Error('拆解物件身份重复。')
    ids.add(layer.id)
  }
  assertSelectionMaskBudget([...input.flatMap(layer => [layer.selectionMask, layer.removalMask, layer.protectionMask]), ...surfaces.flatMap(s => [s.mask, s.excludedEvidenceMask])])
  const sourceProvenance = new ImageSourceProvenance(source.width, source.height, input.length), provenance = sourceProvenance.data
  let remaining = source, repairPixels = 0, extractedInferencePixels = 0, declaredDonorPriorInferencePixels = 0
  const layers = input.map((layer: T, index): ImageLayerReplay<T> => {
    context.signal?.throwIfAborted()
    if (layer.repairSurfaceIds && new Set(layer.repairSurfaceIds).size !== layer.repairSurfaceIds.length) throw new Error('物件不能重复引用补底表面。')
    const appearance = layer.appearanceSource === 'original' ? source : remaining
    const selectionMask = layer.selectionMask ?? (layer.guidedSelection ? encodeSelectionMask(guidedImageSelection(appearance, layer.guidedSelection).mask) : undefined)
    const selectedSurfaces = layer.repairSurfaceIds?.map(id => { const surface = surfaces.find(s => s.id === id); if (!surface) throw new Error('物件引用了不存在的补底表面。'); return surface })
    if (layer.repair === 'surfaces' && (!selectedSurfaces?.length || layer.fills?.length)) throw new Error('按表面补底须指定表面身份，不能同时使用旧分区fills。')
    const evidenceLayers = context.evidenceLayers ?? input, evidenceIndex = evidenceLayers.findIndex(candidate => candidate.id === layer.id)
    const neighborhoodEvidence = layer.repair === 'surfaces' && selectedSurfaces?.some(surface => surface.kind.startsWith('neighbors-') || surface.kind === 'guided')
      ? { priorInference: provenance, objectEvidence: imageNeighborhoodObjectEvidence(source, evidenceLayers.slice(evidenceIndex + 1)), signal: context.signal } : undefined
    const extracted = extractImageLayer(remaining, layer.polygon, layer.donor,
      { repair: layer.repair, repairSurfaces: selectedSurfaces, appearanceImage: appearance, fills: layer.fills, cleanupPx: layer.cleanupPx, selectionMask, removalMask: layer.removalMask, protectionMask: layer.protectionMask, neighborhoodEvidence })
    const priorProducers = new Set<number>()
    const donorBounds = layer.repair === 'surfaces' ? (selectedSurfaces ?? []).map(surface => surface.donor) : [layer.donor, ...(layer.fills ?? []).map(fill => fill.donor)]
    const declaredDonors = donorBounds.map((bounds, donorIndex) => {
      const priorInferencePixels = sourceProvenance.declaredOverlap(bounds, priorProducers)
      declaredDonorPriorInferencePixels += priorInferencePixels
      return { index: donorIndex, boundsPx: { ...bounds }, priorInferencePixels }
    })
    let extractedCount = 0, repairCount = 0
    visitMask(extracted.mask, source.width, sourceIndex => {
      const producer = provenance[sourceIndex]
      if (producer && layer.appearanceSource !== 'original') { extractedCount++; priorProducers.add(producer) }
    })
    visitMask(extracted.repairMask, source.width, sourceIndex => {
      repairCount++
      sourceProvenance.mark(sourceIndex, index + 1)
    })
    const diagnostics: ImageLayerSourceDiagnostics = {
      layerId: layer.id, declaredDonors, extractedInferencePixels: extractedCount, repairPixels: repairCount,
      priorLayerIds: [...priorProducers].sort((a, b) => a - b).map(producer => input[producer - 1].id),
      actualSampledInferencePixels: 'notMeasured', boundaryInferencePixels: 'notMeasured',
    }
    repairPixels += repairCount
    extractedInferencePixels += extractedCount
    remaining = extracted.remaining
    return { layer, extracted: { layer: extracted.layer, mask: extracted.mask, repairMask: extracted.repairMask }, diagnostics }
  })
  const inferredPixels = sourceProvenance.inferredPixels
  const sourceReport: ImageLayerSourceReport = {
    totalPixels: provenance.length, capturedSourcePixels: provenance.length - inferredPixels, inferredPixels,
    layerCount: layers.length, repairPixels, extractedInferencePixels, declaredDonorPriorInferencePixels,
    actualSampledInferencePixels: 'notMeasured', boundaryInferencePixels: 'notMeasured',
    layers: layers.map(layer => layer.diagnostics),
  }
  return { remaining, layers, provenance, sourceReport }
}
