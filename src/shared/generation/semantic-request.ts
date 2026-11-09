import { z } from 'zod'
import { hashGenerationValue } from './contracts.js'
import { captureJson, freezeJson } from '../validation/json.js'

export const SEMANTIC_GENERATION_CAPABILITY = 'sceneweave-forest-building@1'
export const SEMANTIC_GENERATION_CONTENT = 'builtin-mixed-forest@1'
const text = (maximum: number) => z.string().trim().min(1).max(maximum)
const side = z.number().int().safe().min(20000).max(100000)
export const semanticGenerationRequestSchema = z.object({
  capabilityId: z.literal(SEMANTIC_GENERATION_CAPABILITY),
  target: z.literal('new-project'),
  parameters: z.object({
    title: text(120), environment: z.literal('forest'), widthMm: side, heightMm: side,
    seed: text(128), roomCount: z.number().int().min(1).max(4), purpose: text(120),
    furniture: z.boolean(), vegetationMultiplier: z.number().min(0).max(2),
  }).strict(),
}).strict()
export type SemanticGenerationRequest = z.infer<typeof semanticGenerationRequestSchema>
const limitations = Object.freeze([
  '仅新建一个同楼层的林中建筑，不读取或修改已打开工程。',
  '房间共用一个用途；不支持逐房间用途、指定邻接或任意建筑位置。',
  '预留活动空地并连接道路；不生成帐篷、篝火等营地物件。',
  '家具按现有用途规则建议，缺项以实际生成报告为准。',
  '使用固定内置素材；不接收个人图片、历史、GM内容或原AI任务续作。',
])

/** This adapter is a separate, explicitly granted new-project capability. It
 * does not enable the existing page authoring tools or accept arbitrary code. */
export function semanticGenerationCapabilities() {
  return freezeJson({ capabilityId: SEMANTIC_GENERATION_CAPABILITY, target: 'new-project' as const,
    domain: 'mixed' as const, environment: 'forest' as const, contentId: SEMANTIC_GENERATION_CONTENT,
    inputSchema: z.toJSONSchema(semanticGenerationRequestSchema), limitations: [...limitations],
    delivery: { project: 'complete-v1', preview: 'player-png', validation: 'actual-bytes-and-pixels',
      adoption: 'new-project-import-only', modelRequests: 0 },
  })
}

export function semanticGenerationExample(): SemanticGenerationRequest {
  return parseSemanticGenerationRequest({ capabilityId: SEMANTIC_GENERATION_CAPABILITY, target: 'new-project', parameters: {
    title: '林中哨站 · 建筑与树林', environment: 'forest', widthMm: 40000, heightMm: 32000,
    seed: 'forest-outpost-1', roomCount: 2, purpose: '哨站休息室', furniture: true, vegetationMultiplier: 1,
  } })
}

/** No IDs, resources or asynchronous work before strict owned input parsing. */
export function parseSemanticGenerationRequest(raw: unknown): SemanticGenerationRequest {
  return freezeJson(semanticGenerationRequestSchema.parse(captureJson(raw)))
}
export function semanticGenerationRequestHash(raw: unknown): string {
  return hashGenerationValue(parseSemanticGenerationRequest(raw))
}
