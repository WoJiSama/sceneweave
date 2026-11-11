import type { VectorRefinementOptions } from '../../../shared/asset-refinement/vector.js'
import { CURRENT_VECTOR_ALGORITHM, replayVectorRefinement } from '../../../shared/asset-refinement/algorithms.js'
import type { ImagePixels } from '../../../shared/image-import/pixels.js'

self.onmessage = (event: MessageEvent<{ pixels: ImagePixels; options: VectorRefinementOptions }>) => {
  try { self.postMessage({ result: replayVectorRefinement(CURRENT_VECTOR_ALGORITHM, event.data.pixels, event.data.options) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '矢量重建失败。' }) }
}
