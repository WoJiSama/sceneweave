import type { BoundsMm } from '../../../shared/model/scene'
import type { EditableProject } from '../../../application/workspace/project'
import { toBundle } from '../../../application/workspace/project'
import { createPublicVisionInput, VISION_LIMITS, type VisionInput } from '../../../shared/ai/vision'
import { exportPublicViewportPng } from '../render/renderer'
import { captureJson } from '../../../shared/validation/json'

/** Fresh player-only pixels. Callers own explicit consent and a checkpoint check after this await. */
export async function renderPublicVision(project: EditableProject, boundsMm: BoundsMm, signal?: AbortSignal,
  draft?: VisionInput['draft']): Promise<VisionInput> {
  // Capture the complete byte handle and every binding before the first await.
  // A mutable application wrapper must not relabel pixels rendered from an
  // earlier document, or change the crop during a lower-resolution retry.
  signal?.throwIfAborted()
  const bundle = toBundle(project), capturedBounds = captureJson(boundsMm) as BoundsMm
  const capturedDraft = draft ? captureJson(draft) as NonNullable<VisionInput['draft']> : undefined
  const document = bundle.project.document, full = document.exportBoundsMm
  boundsMm = capturedBounds
  if (![boundsMm.x, boundsMm.y, boundsMm.width, boundsMm.height].every(Number.isSafeInteger)
    || boundsMm.width <= 0 || boundsMm.height <= 0 || boundsMm.x < full.x || boundsMm.y < full.y
    || boundsMm.x + boundsMm.width > full.x + full.width || boundsMm.y + boundsMm.height > full.y + full.height) throw new Error('截图范围必须完整位于当前导出范围内。')
  for (const longEdgePx of [768, 512, 384]) {
    signal?.throwIfAborted()
    const blob = await exportPublicViewportPng(bundle, capturedBounds, longEdgePx, signal)
    signal?.throwIfAborted()
    if (blob.size <= VISION_LIMITS.imageBytes) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      signal?.throwIfAborted()
      return createPublicVisionInput(bytes, { sceneId: document.sceneId, revision: document.revision,
        boundsMm: capturedBounds, ...(capturedDraft ? { draft: capturedDraft } : {}) })
    }
  }
  throw new Error('公开截图超过512KiB，请缩小明确范围。')
}
