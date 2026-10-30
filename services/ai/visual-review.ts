import { z } from 'zod'
import { remainingAuthoringOperations } from '../../src/shared/ai/authoring.js'
import type { AuthoringOperation, AuthoringStart } from '../../src/shared/ai/authoring-protocol.js'
import { AUTHORING_LIMITS, AuthoringOperationSchema } from '../../src/shared/ai/authoring-protocol.js'
import { applyAuthoringStep, authoringProjectHash, replayAuthoring, validateAuthoringStart } from '../../src/shared/ai/authoring.js'
import { createPublicVisibility } from '../../src/shared/geometry/visibility.js'
import { effectiveEditLocked } from '../../src/shared/commands/layers.js'
import { visualBase } from '../../src/shared/visual/base.js'
import { VISUAL_ENTITY_COLLECTIONS } from '../../src/shared/visual/diagnostics.js'
import { VisualAuthoringScopeSchema } from '../../src/shared/ai/visual-protocol.js'
import { VisionInputSchema } from '../../src/shared/ai/vision.js'
import { validateTaskVision } from './vision-input.js'
import type { StoredTask } from './store.js'
import type { ProviderToolDefinition } from './provider-types.js'
import { utf8Size } from '../../src/shared/ai/protocol.js'
import { captureJson, cloneJson } from '../../src/shared/validation/json.js'
import type { BoundsMm, PointMm, SceneDocument } from '../../src/shared/model/scene.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const bounds = z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict()
const reviewDraft = z.object({ draftRevision: z.number().int().min(0).max(AUTHORING_LIMITS.steps), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()

/** Later reviews carry a draft stamp; an unstamped first screenshot binds to revision 0. */
export const VisualReviewScreenshotSchema = VisionInputSchema.safeExtend({ draft: reviewDraft.optional() })
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entities'), ids: z.array(id).min(1).max(256).refine(values => new Set(values).size === values.length) }).strict(),
  z.object({ kind: z.literal('region'), boundsMm: bounds }).strict(),
])
type VisualReviewTarget = z.infer<typeof target>
const isRegionTarget = (value: VisualReviewTarget): value is Extract<VisualReviewTarget, { kind: 'region' }> => value.kind === 'region'
export const VisualReviewIssueSchema = z.object({ observation: z.string().trim().min(1).max(1000), uncertainty: z.string().trim().min(1).max(500), target }).strict()
export const VisualReviewArgumentsSchema = z.object({ screenshot: VisualReviewScreenshotSchema, issues: z.array(VisualReviewIssueSchema).min(1).max(16), candidateOperations: z.array(AuthoringOperationSchema).min(1).max(AUTHORING_LIMITS.operationsPerStep) }).strict()

export const visualReviewTool: ProviderToolDefinition = {
  name: 'sceneweave_visual_review',
  description: 'Review the latest explicitly supplied public PNG and prepare a read-only, bounded visual correction candidate. An unstamped first screenshot binds only to draft revision 0 and the base hash; later screenshots must carry the current draft stamp. Targets are only explicit public entities or a bounded region; appearance remains unverified and unconfirmed until a human reviews and adopts a normal edit.',
  parameters: z.toJSONSchema(VisualReviewArgumentsSchema, { io: 'input' }) as Record<string, unknown>,
}

export class VisualReviewError extends Error {
  constructor(readonly code: 'invalid_arguments' | 'stale_screenshot' | 'outside_scope' | 'private_target' | 'unsupported_operation' | 'review_output_limit' | 'preview_invalid', message: string) {
    super(message)
    this.name = 'VisualReviewError'
  }
}

const messages: Record<VisualReviewError['code'], string> = {
  invalid_arguments: '视觉审查参数不符合有限合同。',
  stale_screenshot: '截图不是任务当前公开图像，或草稿基线已经变化。',
  outside_scope: '视觉目标或区域不在明确授权范围。',
  private_target: '视觉目标必须是授权范围内的公开对象。',
  unsupported_operation: '视觉修正只接受已授权的有限外观操作。',
  review_output_limit: '视觉审查回执超过允许大小；请减少目标或候选操作。',
  preview_invalid: '视觉修正候选未通过完整本机账本预演。',
}
function reject(code: VisualReviewError['code']): never { throw new VisualReviewError(code, messages[code]) }

function points(boundsValue: BoundsMm): PointMm[] {
  return [{ x: boundsValue.x, y: boundsValue.y }, { x: boundsValue.x + boundsValue.width, y: boundsValue.y },
    { x: boundsValue.x + boundsValue.width, y: boundsValue.y + boundsValue.height }, { x: boundsValue.x, y: boundsValue.y + boundsValue.height }]
}
function contains(outer: BoundsMm, inner: BoundsMm): boolean {
  const outerMaxX = outer.x + outer.width, outerMaxY = outer.y + outer.height
  const innerMaxX = inner.x + inner.width, innerMaxY = inner.y + inner.height
  return [outerMaxX, outerMaxY, innerMaxX, innerMaxY].every(Number.isSafeInteger)
    && points(inner).every(point => point.x >= outer.x && point.y >= outer.y && point.x <= outerMaxX && point.y <= outerMaxY)
}
function entityInCollection(scene: SceneDocument, idValue: string): boolean {
  const visual = visualBase(scene)
  return VISUAL_ENTITY_COLLECTIONS.some(collection => !!visual?.[collection] && Object.hasOwn(visual[collection], idValue))
}
function visualEntityPublic(scene: SceneDocument, idValue: string, floorId: string): boolean {
  const visual = visualBase(scene)
  for (const collection of VISUAL_ENTITY_COLLECTIONS) {
    const value = visual?.[collection]?.[idValue]
    if (value) return value.visibility === 'public' && value.floorId === floorId && !value.editLocked && !scene.userLayers[value.layerId]?.editLocked
  }
  return false
}
function sceneEntityPublic(scene: SceneDocument, idValue: string): boolean {
  const view = createPublicVisibility(scene)
  if (scene.props[idValue]) return view.prop(scene.props[idValue]) && !effectiveEditLocked(scene, idValue)
  if (scene.rooms[idValue]) return view.room(idValue) && !effectiveEditLocked(scene, idValue)
  if (scene.terrainAreas[idValue]) return view.terrainArea(idValue) && !effectiveEditLocked(scene, idValue)
  if (scene.paths[idValue]) return view.path(idValue) && !effectiveEditLocked(scene, idValue)
  if (scene.terrainEdges[idValue]) return view.terrainEdge(idValue) && !effectiveEditLocked(scene, idValue)
  if (scene.terrainConnections[idValue]) return scene.terrainConnections[idValue].visibility === 'public' && !effectiveEditLocked(scene, idValue)
  if (scene.regions[idValue]) return scene.regions[idValue].visibility === 'public' && scene.regions[idValue].kind !== 'manualMask' && !effectiveEditLocked(scene, idValue)
  return false
}
function authoringGrant(start: AuthoringStart, stateChangedIds: readonly string[]): Set<string> {
  const artworkTargetIds = start.scope.artwork?.targetIds ?? []
  return new Set([...start.scope.targetIds, ...(start.scope.scene?.entityIds ?? []), ...(start.scope.visual?.entityIds ?? []), ...artworkTargetIds, ...stateChangedIds])
}
function visualBounds(start: AuthoringStart): BoundsMm[] {
  return [start.scope.visual?.boundsMm, start.scope.scene?.boundsMm, start.scope.artwork?.boundsMm, start.scope.placement?.boundsMm].filter((value): value is BoundsMm => value !== undefined)
}
function publicGranted(start: AuthoringStart, project: ReturnType<typeof replayAuthoring>['project'], idValue: string, grant: Set<string>): boolean {
  if (!grant.has(idValue)) reject('outside_scope')
  const scene = project.document
  const floorId = start.scope.visual?.floorId ?? start.scope.scene?.floorId ?? start.scope.placement?.floorId
  if (!floorId || !(sceneEntityPublic(scene, idValue) || visualEntityPublic(scene, idValue, floorId))) reject('private_target')
  return true
}
function candidateVisualScope(start: AuthoringStart) {
  if (!start.scope.visual) return null
  try { return VisualAuthoringScopeSchema.parse(captureJson(start.scope.visual)) } catch { reject('outside_scope') }
}
function latestTaskImage(task: StoredTask, screenshot: z.infer<typeof VisualReviewScreenshotSchema>, start: AuthoringStart, draftRevision: number, contentHash: string): void {
  const images = task.messages.flatMap(message => message.images ?? [])
  const latest = images.at(-1)
  if (!latest || latest.sha256 !== screenshot.sha256 || latest.pngBase64 !== screenshot.pngBase64 || latest.sceneId !== screenshot.sceneId
    || latest.revision !== screenshot.revision || latest.boundsMm.x !== screenshot.boundsMm.x || latest.boundsMm.y !== screenshot.boundsMm.y
    || latest.boundsMm.width !== screenshot.boundsMm.width || latest.boundsMm.height !== screenshot.boundsMm.height
    || latest.draft?.draftRevision !== screenshot.draft?.draftRevision || latest.draft?.contentHash !== screenshot.draft?.contentHash
    || (latest.draft ? latest.draft.draftRevision !== draftRevision || latest.draft.contentHash !== contentHash
      : draftRevision !== 0 || contentHash !== start.baseContentHash)) reject('stale_screenshot')
}
function validateIssueTargets(parsed: z.infer<typeof VisualReviewArgumentsSchema>, grant: Set<string>, start: AuthoringStart, project: ReturnType<typeof replayAuthoring>['project']): Set<string> {
  const targetIds = new Set<string>(), screenshotBounds = parsed.screenshot.boundsMm, grants = visualBounds(start)
  for (const issue of parsed.issues) {
    if (isRegionTarget(issue.target)) {
      const region = issue.target as Extract<VisualReviewTarget, { kind: 'region' }>
      if (!contains(screenshotBounds, region.boundsMm) || !grants.some(value => contains(value, region.boundsMm))) reject('outside_scope')
    } else {
      for (const idValue of issue.target.ids) { publicGranted(start, project, idValue, grant); targetIds.add(idValue) }
    }
  }
  return targetIds
}
function validateCandidateOperations(start: AuthoringStart, project: ReturnType<typeof replayAuthoring>['project'], parsed: z.infer<typeof VisualReviewArgumentsSchema>, targetIds: Set<string>, grant: Set<string>): void {
  const visualScope = candidateVisualScope(start), issueRegions = parsed.issues.flatMap(issue => isRegionTarget(issue.target) ? [issue.target.boundsMm] : [])
  const scene = project.document
  for (const operation of parsed.candidateOperations) {
    if (operation.kind === 'transform' || operation.kind === 'opacity') {
      if (!start.scope.operations.includes(operation.kind)) reject('unsupported_operation')
      if (!targetIds.has(operation.id)) reject('outside_scope')
      publicGranted(start, project, operation.id, grant)
      continue
    }
    if (operation.kind === 'style') {
      if (!start.scope.artwork?.operations.includes('style')) reject('unsupported_operation')
      if (!operation.ids.every(idValue => targetIds.has(idValue))) reject('outside_scope')
      operation.ids.forEach(idValue => publicGranted(start, project, idValue, grant))
      continue
    }
    if (operation.kind !== 'visualFilter') reject('unsupported_operation')
    if (!visualScope?.operations.includes('visualFilter')) reject('unsupported_operation')
    if (operation.target.kind === 'scene' || operation.target.kind === 'layer') reject('outside_scope')
    if (operation.target.kind === 'entities') {
      if (!operation.target.ids.every(idValue => targetIds.has(idValue))) reject('outside_scope')
      operation.target.ids.forEach(idValue => publicGranted(start, project, idValue, grant))
    } else {
      const candidateBounds = { x: Math.min(...operation.target.boundaryMm.map(point => point.x)), y: Math.min(...operation.target.boundaryMm.map(point => point.y)), width: Math.max(...operation.target.boundaryMm.map(point => point.x)) - Math.min(...operation.target.boundaryMm.map(point => point.x)), height: Math.max(...operation.target.boundaryMm.map(point => point.y)) - Math.min(...operation.target.boundaryMm.map(point => point.y)) }
      if (!issueRegions.some(region => contains(region, candidateBounds))) reject('outside_scope')
      if (!contains(parsed.screenshot.boundsMm, candidateBounds) || !visualBounds(start).some(value => contains(value, candidateBounds))) reject('outside_scope')
    }
    // Existing filter IDs are still required to be explicit public visual entities;
    // a fresh filter ID is checked by the normal authoring replay below.
    if (entityInCollection(scene, operation.id)) publicGranted(start, project, operation.id, grant)
  }
}

export function proposeVisualReview(task: StoredTask, args: unknown, callId: string): object {
  let parsed: z.infer<typeof VisualReviewArgumentsSchema>
  try { parsed = VisualReviewArgumentsSchema.parse(captureJson(args)) } catch { reject('invalid_arguments') }
  const authoring = task.authoring
  if (!authoring || !task.snapshot.context) reject('stale_screenshot')
  let start: AuthoringStart
  try { start = validateAuthoringStart(authoring.start) } catch { reject('stale_screenshot') }
  const screenshot = parsed.screenshot
  latestTaskImage(task, screenshot, start, authoring.state.draftRevision, authoring.state.contentHash)
  try {
    validateTaskVision(screenshot, task.snapshot.context, start, screenshot.draft ? authoring.state : undefined)
  } catch { reject('stale_screenshot') }
  const screenshotDraft = screenshot.draft ?? { draftRevision: 0, contentHash: start.baseContentHash }
  if (screenshotDraft.draftRevision !== authoring.state.draftRevision || screenshotDraft.contentHash !== authoring.state.contentHash) reject('stale_screenshot')
  let replayed: ReturnType<typeof replayAuthoring>
  try { replayed = replayAuthoring(start, authoring.state.steps) } catch { reject('stale_screenshot') }
  const grant = authoringGrant(start, authoring.state.changedIds), targetIds = validateIssueTargets(parsed, grant, start, replayed.project)
  validateCandidateOperations(start, replayed.project, parsed, targetIds, grant)
  let preview: ReturnType<typeof applyAuthoringStep>
  try {
    const stepId = `visual-review-${authoringProjectHash(start.project).slice(0, 16)}-${callId.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 32) || 'candidate'}`
    preview = applyAuthoringStep(start, authoring.state, cloneJson(parsed.candidateOperations) as AuthoringOperation[], stepId)
  } catch { reject('preview_invalid') }
  const output = {
    issuesReviewed: parsed.issues.length,
    targetsReviewed: [...targetIds].sort(),
    candidateOperations: cloneJson(parsed.candidateOperations),
    previewValid: true,
    actualOperationCost: preview.state.operationCost - authoring.state.operationCost,
    atDraftRevision: authoring.state.draftRevision,
    atContentHash: authoring.state.contentHash,
    candidateDraftRevision: preview.state.draftRevision,
    candidateContentHash: preview.state.contentHash,
    remainingOperationsAfterPreview: remainingAuthoringOperations(authoring.start, preview.state),
    observation: 'unverified',
    appearance: 'unconfirmed',
    disposition: 'read-only; no draft, task, artifact, source or project was changed; adopt only through a later ordinary edit after human review',
    screenshotBinding: { sha256: screenshot.sha256, draftRevision: screenshotDraft.draftRevision, contentHash: screenshotDraft.contentHash, boundsMm: screenshot.boundsMm },
  }
  if (utf8Size(JSON.stringify(output)) > 7800) reject('review_output_limit')
  return output
}
