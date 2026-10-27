import { z } from 'zod'
import { generateTerrainDocument, terrainGenerationInputSchema, terrainGenerationResultSchema } from '../../../shared/terrain-generation/generate.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { validateSceneSnapshot } from '../../../shared/validation/snapshots.js'
import type { TerrainGenerationContext, TerrainWorkerResponse } from './client.js'

const identifier = z.string().min(1).max(256).refine(value => value !== '__proto__')
const counter = z.number().finite().refine(value => Number.isSafeInteger(value) && value >= 0)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const contextShape = { requestId: identifier, sceneId: identifier, checkpoint: counter, operationEpoch: counter, inputHash: digest, baseHash: digest }
const contextSchema = z.object(contextShape)
const requestSchema = z.object({ version: z.literal(1), type: z.literal('generate'), ...contextShape, base: z.unknown(), input: z.unknown() }).strict()

function boundedCanonical(value: unknown, maximum: number): string {
  const text = canonicalJson(value)
  if (encodeUtf8(text).byteLength > maximum) throw new Error('地形生成内容超过允许大小，请缩小范围。')
  return text
}

/** One request, one result. No IO, model calls or mutation of the workspace occurs here. */
export function executeTerrainGenerationRequest(raw: unknown): TerrainWorkerResponse {
  const captured = captureJson(raw)
  // An envelope without a valid correlation context is a protocol failure, not an adoptable response.
  const context: TerrainGenerationContext = contextSchema.parse(captured)
  let accepted = false
  try {
    boundedCanonical(captured, 24 * 1024 * 1024)
    const request = requestSchema.parse(captured)
    const input = terrainGenerationInputSchema.parse(request.input)
    if (sha256Text(canonicalJson(input)) !== request.inputHash || sha256Text(canonicalJson(request.base)) !== request.baseHash) {
      throw new Error('地形生成设置或基础场景校验不一致。')
    }
    const checked = validateSceneSnapshot(request.base)
    if (!checked.ok || checked.document.schemaVersion !== 2) throw new Error('地形生成需要有效的视觉场景基础。')
    if (canonicalJson(input) !== canonicalJson(request.input) || canonicalJson(checked.document) !== canonicalJson(request.base)) {
      throw new Error('地形生成输入必须为完整的规范内容。')
    }
    accepted = true
    const generated = generateTerrainDocument(checked.document, input)
    const result = terrainGenerationResultSchema.parse(captureJson(generated))
    if (canonicalJson(result.input) !== canonicalJson(input) || result.document.sceneId !== input.sceneId
      || result.document.schemaVersion !== 2 || !Number.isSafeInteger(result.cost.total) || result.cost.total < 0 || result.cost.total > 256) {
      throw new Error('地形预览没有满足设置、身份或编辑量要求。')
    }
    const resultText = boundedCanonical(result, 8 * 1024 * 1024)
    return { version: 1, type: 'result', ...context, resultHash: sha256Text(resultText), result }
  } catch (failure) {
    const message = failure instanceof Error ? failure.message.slice(0, 512) : '地形生成未完成，请调整设置后重试。'
    return { version: 1, type: 'error', ...context, error: { code: accepted ? 'generation_failed' : 'invalid_request', message: message || '地形生成未完成。' } }
  }
}

interface TerrainWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: TerrainWorkerResponse) => void
  close: () => void
}
const scope = globalThis as unknown as TerrainWorkerScope
if (typeof document === 'undefined' && typeof scope.postMessage === 'function' && typeof scope.close === 'function') {
  let consumed = false
  scope.onmessage = event => {
    if (consumed) return
    consumed = true
    try { scope.postMessage(executeTerrainGenerationRequest(event.data)) }
    finally { scope.close() }
  }
}
