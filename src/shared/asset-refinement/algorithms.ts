import { refineImageToVector, type VectorRefinementOptions, type VectorRefinementResult } from './vector.js'
import { refineImageRegionsToVector } from './regional-tones.js'
import type { ImagePixels } from '../image-import/pixels.js'
import type { CancellationSignal } from '../ports/resources.js'

export const CURRENT_VECTOR_ALGORITHM = 'regional-tones-v1' as const
export type VectorRefinementAlgorithm = 'shared-boundary-curves-v1' | typeof CURRENT_VECTOR_ALGORITHM

/** Fixed provenance is replayed with its original paint algorithm, never the current default. */
export function replayVectorRefinement(algorithm: VectorRefinementAlgorithm, pixels: ImagePixels, options: VectorRefinementOptions,
  signal?: CancellationSignal): VectorRefinementResult {
  switch (algorithm) {
    case 'shared-boundary-curves-v1': return refineImageToVector(pixels, options, signal)
    case 'regional-tones-v1': return refineImageRegionsToVector(pixels, options, signal)
    default: throw new Error('不支持此矢量重建算法。')
  }
}
