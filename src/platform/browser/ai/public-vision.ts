import type { BoundsMm } from '../../../shared/model/scene'
import type { EditableProject } from '../../../application/workspace/project'
import { toBundle } from '../../../application/workspace/project'
import { createPublicVisionInput, VISION_LIMITS, type VisionInput } from '../../../shared/ai/vision'
import { exportPublicViewportPng } from '../render/renderer'

/** Fresh player-only pixels. Callers own explicit consent and a checkpoint check after this await. */
export async function renderPublicVision(project: EditableProject, boundsMm: BoundsMm, signal?: AbortSignal,
  draft?: VisionInput['draft']): Promise<VisionInput> {
  const full = project.document.exportBoundsMm
  if (![boundsMm.x, boundsMm.y, boundsMm.width, boundsMm.height].every(Number.isSafeInteger)
    || boundsMm.width <= 0 || boundsMm.height <= 0 || boundsMm.x < full.x || boundsMm.y < full.y
    || boundsMm.x + boundsMm.width > full.x + full.width || boundsMm.y + boundsMm.height > full.y + full.height) throw new Error('截图范围必须完整位于当前导出范围内。')
  for (const longEdgePx of [768, 512, 384]) {
    signal?.throwIfAborted()
    const blob = await exportPublicViewportPng(toBundle(project), boundsMm, longEdgePx, signal)
    signal?.throwIfAborted()
    if (blob.size <= VISION_LIMITS.imageBytes) return createPublicVisionInput(new Uint8Array(await blob.arrayBuffer()), {
      sceneId: project.document.sceneId, revision: project.document.revision, boundsMm, ...(draft ? { draft } : {}),
    })
  }
  throw new Error('公开截图超过512KiB，请缩小明确范围。')
}
