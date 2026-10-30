import { inflateSync } from 'node:zlib'
import type { AuthoringStart, AuthoringState } from '../../src/shared/ai/authoring-protocol.js'
import type { TaskContext } from '../../src/shared/ai/protocol.js'
import type { VisionInput } from '../../src/shared/ai/vision.js'
import { verifyVisionInput } from '../../src/shared/ai/vision.js'

/** Decode the bounded zlib payload too; headers/hashes alone are not a pixel-valid PNG. */
export function validateVisionPng(input: unknown): VisionInput {
  const { input: value, bytes } = verifyVisionInput(input)
  const chunks: Uint8Array[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset)
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const compressed = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0))
  let offset = 0; for (const part of chunks) { compressed.set(part, offset); offset += part.length }
  const stride = value.width * (bytes[25] === 6 ? 4 : 3) + 1, expected = stride * value.height
  // Node supports info:true; the installed @types/node lacks its return overload.
  const result = inflateSync(compressed, { maxOutputLength: expected, info: true }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } }
  if (!(result.buffer instanceof Uint8Array) || !Number.isSafeInteger(result.engine?.bytesWritten)) throw new Error('截图PNG解码器未返回完整校验结果。')
  const decoded = result.buffer
  if (decoded.length !== expected || result.engine.bytesWritten !== compressed.length) throw new Error('截图实际解码长度或压缩尾部无效。')
  for (let row = 0; row < value.height; row++) if (decoded[row * stride] > 4) throw new Error('截图PNG行滤镜无效。')
  return value
}

/** The browser owns the public projection. The server enforces its declared binding and grant. */
export function validateTaskVision(input: VisionInput, context: TaskContext, start?: AuthoringStart, state?: AuthoringState): VisionInput {
  const value = validateVisionPng(input)
  if (!start || start.project.document.sceneId !== value.sceneId || start.project.document.revision !== value.revision) throw new Error('截图工程基线不匹配。')
  if (start.schemaVersion === 2) {
    const preservation = start.source.preservation
    if (preservation.sceneId === null ? context !== null : !context || context.sceneId !== preservation.sceneId || context.revision !== preservation.revision) throw new Error('截图原工程保护基线不匹配。')
  } else if (!context || context.sceneId !== value.sceneId || context.revision !== value.revision) throw new Error('截图工程基线不匹配。')
  if (state ? !value.draft || value.draft.draftRevision !== state.draftRevision || value.draft.contentHash !== state.contentHash
    : value.draft !== undefined && (value.draft.draftRevision !== 0 || value.draft.contentHash !== start.baseContentHash)) throw new Error('截图草稿基线不匹配。')
  const b = value.boundsMm, scopes = [start.scope.scene?.boundsMm, start.scope.placement?.boundsMm, start.scope.artwork?.boundsMm, start.scope.visual?.boundsMm].filter(scope => scope !== undefined)
  if (!scopes.some(scope => b.x >= scope.x && b.y >= scope.y && b.x + b.width <= scope.x + scope.width && b.y + b.height <= scope.y + scope.height)) throw new Error('截图越出明确授权范围。')
  // Public rendering can legitimately include opaque player masks. Their source
  // geometry is not a reason to reject already-filtered pixels, and is never sent
  // to the provider. Only the browser's actual player projection proves semantics.
  return value
}
