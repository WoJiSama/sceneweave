import type { AuthoringDraft, AuthoringScope, AuthoringStart, DraftLease } from '../../shared/ai/authoring-protocol.js'
import { AuthoringDraftSchema, DraftLeaseSchema, AUTHORING_LIMITS } from '../../shared/ai/authoring-protocol.js'
import { authoringProjectHash, replayAuthoring, validateAuthoringStart } from '../../shared/ai/authoring.js'
import type { ProjectData } from '../../shared/model/project.js'
import { LAYER_ENTITY_COLLECTIONS } from '../../shared/model/scene.js'
import { VISUAL_ENTITY_COLLECTIONS } from '../../shared/visual/diagnostics.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import type { EditableProject } from './project.js'
import type { EditableSnapshot } from './workspace.js'

export interface AtomicAuthorization {
  start: AuthoringStart
  scope: AuthoringScope
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  baseContentHash: string
}
export interface AtomicChange { id: string; collection?: string; before: unknown; after: unknown; fields: string[] }
export interface AtomicCandidate {
  project: EditableProject
  document: EditableProject['document']
  changes: readonly AtomicChange[]
  operationCost: number
  readIds: readonly string[]
  writeIds: readonly string[]
  taskId: string
  generation: number
  draftRevision: number
  contentHash: string
  checkpoint: number
  currentSceneId: string
  currentRevision: number
}
export interface AtomicAdoptionResult { protection: EditableSnapshot; revision: number; save: Promise<void> }
export type AtomicCandidateStatus = 'active' | 'applying' | 'cancelled' | 'applied'
export interface AtomicCandidateRecord { authorization: AtomicAuthorization; draft: AuthoringDraft; status: AtomicCandidateStatus }

export function freezeAtomic<T>(input: T): T {
  if (input && typeof input === 'object' && !Object.isFrozen(input)) {
    Object.freeze(input)
    for (const child of Object.values(input)) freezeAtomic(child)
  }
  return input
}
export function pureProject(project: EditableProject): ProjectData {
  const { resources: _resources, ...data } = project
  return data
}
export function captureAtomicStart(input: AuthoringStart): AuthoringStart {
  const captured = captureJson(input) as unknown as AuthoringStart
  return freezeAtomic(validateAuthoringStart(captured))
}
export function captureAtomicDraft(input: AuthoringDraft, authorization: AtomicAuthorization) {
  const draft = freezeAtomic(AuthoringDraftSchema.parse(captureJson(input)))
  if (authoringProjectHash(draft.start.project) !== authorization.baseContentHash
    || canonicalJson(draft.start) !== canonicalJson(authorization.start)) throw new Error('任务草稿不属于本机授权的确切基线和范围。')
  const replayed = replayAuthoring(authorization.start, draft.state.steps)
  // Canonical hashes compare every state field; task JSON has no trusted valid flag.
  if (canonicalJson(replayed.state) !== canonicalJson(draft.state)) throw new Error('任务步骤、实际范围、成本或内容校验值与本机重放不一致。')
  if (!draft.state.draftRevision || !draft.state.operationCost || draft.state.operationCost > AUTHORING_LIMITS.operations) throw new Error('任务草稿为空或超过256条实际操作预算。')
  return { draft, project: replayed.project, state: replayed.state, visualInvalidatedIds: replayed.visualInvalidatedIds }
}
export function atomicChanges(before: ProjectData, after: ProjectData, touched: readonly string[], invalidatedVisualIds: readonly string[] = []): AtomicChange[] {
  const row = (project: ProjectData, id: string): { collection: string; value: unknown } | null => {
    for (const collection of LAYER_ENTITY_COLLECTIONS) {
      const records = project.document[collection] as Record<string, unknown>
      if (!Object.hasOwn(records, id)) continue
      if (collection === 'props') return { collection, value: { prop: records[id], layerId: project.document.entityLayers[id] ?? null,
        sourceId: project.appearance.propSources[id] ?? null, adjustments: project.appearance.instanceAdjustments[id] ?? [] } }
      return { collection, value: { entity: records[id], layerId: project.document.entityLayers[id] ?? null } }
    }
    for (const collection of VISUAL_ENTITY_COLLECTIONS) {
      const entity = project.document.visual?.[collection][id]
      if (entity) return { collection: `visual.${collection}`, value: entity }
    }
    // SVG authoring and licensing records are persisted alongside, but outside,
    // the scene entity collections. They still need to be visible in review.
    if (Object.hasOwn(project.authoringSources, id)) return { collection: 'authoringSources', value: project.authoringSources[id] }
    if (Object.hasOwn(project.document.propDefinitions, id)) return { collection: 'propDefinitions', value: project.document.propDefinitions[id] }
    if (Object.hasOwn(project.document.assets, id)) return { collection: 'assets', value: project.document.assets[id] }
    if (Object.hasOwn(project.assets, id)) return { collection: 'assetBytes', value: project.assets[id] }
    return null
  }
  const artworkIds = [...new Set([...Object.keys(before.authoringSources), ...Object.keys(after.authoringSources), ...Object.keys(before.document.assets), ...Object.keys(after.document.assets), ...Object.keys(before.assets), ...Object.keys(after.assets), ...Object.keys(before.document.propDefinitions), ...Object.keys(after.document.propDefinitions)])]
  const visualIds = [before, after].flatMap(project => VISUAL_ENTITY_COLLECTIONS.flatMap(collection => Object.keys(project.document.visual?.[collection] ?? {})))
  const changes = [...new Set([...touched, ...artworkIds, ...visualIds])].flatMap(id => {
    const previous = row(before, id), next = row(after, id)
    if (!previous && !next) return []
    const collection = next?.collection ?? previous!.collection
    const beforeValue = previous?.value ?? null, afterValue = next?.value ?? null
    if (previous?.collection !== next?.collection || JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      const a = beforeValue && typeof beforeValue === 'object' ? beforeValue as Record<string, unknown> : {}
      const b = afterValue && typeof afterValue === 'object' ? afterValue as Record<string, unknown> : {}
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
      return [{ id, collection, before: beforeValue, after: afterValue, fields: fields.length ? fields : ['identity'] }]
    }
    return []
  })
  // Relationship-only scene commands (for example, entrance membership) can
  // change a persisted top-level value without changing an entity row.
  if (JSON.stringify(before.document.constraints) !== JSON.stringify(after.document.constraints)) changes.push({
    id: 'scene-constraints', collection: 'constraints', before: before.document.constraints, after: after.document.constraints, fields: ['constraints'],
  })
  if (JSON.stringify(before.document.visual?.environment) !== JSON.stringify(after.document.visual?.environment)) changes.push({
    id: 'visual-environment', collection: 'visual.environment', before: before.document.visual?.environment ?? null,
    after: after.document.visual?.environment ?? null, fields: ['environment'],
  })
  for (const id of invalidatedVisualIds) {
    if (changes.some(change => change.id === id)) continue
    const previous = row(before, id), next = row(after, id)
    if (previous || next) changes.push({ id, collection: next?.collection ?? previous!.collection,
      before: previous?.value ?? null, after: next?.value ?? null, fields: ['identity'] })
  }
  return changes
}
/** A lease's remaining time is bounded using local monotonic elapsed time from before the request. */
export function assertAtomicLease(input: DraftLease, candidate: AtomicCandidate, requestedAt: number, now = performance.now()): DraftLease {
  const lease = DraftLeaseSchema.parse(captureJson(input))
  const duration = lease.expiresAt - lease.serverNow, elapsed = now - requestedAt
  if (lease.taskId !== candidate.taskId || lease.generation !== candidate.generation || lease.draftRevision !== candidate.draftRevision
    || lease.contentHash !== candidate.contentHash) throw new Error('任务授权租约与待采用草稿不一致。')
  if (duration <= 0 || duration > AUTHORING_LIMITS.claimMs || elapsed < 0 || elapsed >= duration) throw new Error('任务采用租约已过期，请重新确认。')
  return lease
}
