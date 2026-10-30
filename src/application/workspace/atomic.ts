import { visualBase } from '../../shared/visual/base.js'
import { terrainRecordChanges } from '../../shared/terrain-generation/review.js'
import type { AuthoringDraft, AuthoringScope, AuthoringStart, DraftLease } from '../../shared/ai/authoring-protocol.js'
import { AuthoringDraftSchema, DraftLeaseSchema, AUTHORING_LIMITS } from '../../shared/ai/authoring-protocol.js'
import { authoringProjectHash, replayAuthoring, validateAuthoringStart } from '../../shared/ai/authoring.js'
import type { ProjectData } from '../../shared/model/project.js'
import { LAYER_ENTITY_COLLECTIONS } from '../../shared/model/scene.js'
import { VISUAL_ENTITY_COLLECTIONS } from '../../shared/visual/diagnostics.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import type { EditableProject } from './project.js'
import type { EditableSnapshot } from './workspace.js'
import type { BudgetIdentity, BudgetState } from '../../shared/ai/continuation-protocol.js'

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
  schemaVersion?: 1 | 2
  budgetIdentity?: BudgetIdentity
  budget?: BudgetState
  project: EditableProject
  document: EditableProject['document']
  changes: readonly AtomicChange[]
  /** Empty candidates are read-only review credentials for regional drill-down. */
  reviewOnly: boolean
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
export interface AtomicAdoptionResult { protection?: EditableSnapshot; revision: number; save: Promise<void> }
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
export function captureAtomicStart<T extends AuthoringStart>(input: T): T {
  const captured = captureJson(input) as unknown as AuthoringStart
  return freezeAtomic(validateAuthoringStart(captured)) as T
}
export function captureAtomicDraft(input: AuthoringDraft, authorization: AtomicAuthorization, options: { allowEmpty?: boolean } = {}) {
  const draft = freezeAtomic(AuthoringDraftSchema.parse(captureJson(input)))
  if (authoringProjectHash(draft.start.project) !== authorization.baseContentHash
    || canonicalJson(draft.start) !== canonicalJson(authorization.start)) throw new Error('任务草稿不属于本机授权的确切基线和范围。')
  const replayed = replayAuthoring(authorization.start, draft.state.steps)
  // Canonical hashes compare every state field; task JSON has no trusted valid flag.
  if (canonicalJson(replayed.state) !== canonicalJson(draft.state)) throw new Error('任务步骤、实际范围、成本或内容校验值与本机重放不一致。')
  const limit = draft.start.schemaVersion === 2 ? draft.start.policy.generationTargets + draft.start.policy.aiTargets : AUTHORING_LIMITS.operations
  const empty = draft.start.schemaVersion === 2 ? draft.state.operationCost === 0 : !draft.state.draftRevision || !draft.state.operationCost
  if (empty && !options.allowEmpty || draft.state.operationCost > limit) throw new Error('任务草稿为空或超过固定实际操作预算。')
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
      const entity = visualBase(project.document)?.[collection][id]
      if (entity) return { collection: `${project.document.visual?.version === 2 ? 'visual.base' : 'visual'}.${collection}`, value: entity }
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
  const visualIds = [before, after].flatMap(project => VISUAL_ENTITY_COLLECTIONS.flatMap(collection => Object.keys(visualBase(project.document)?.[collection] ?? {})))
  const changes: AtomicChange[] = [...new Set([...touched, ...artworkIds, ...visualIds])].flatMap(id => {
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
  if (JSON.stringify(visualBase(before.document)?.environment) !== JSON.stringify(visualBase(after.document)?.environment)) changes.push({
    id: 'visual-environment', collection: after.document.visual?.version === 2 ? 'visual.base.environment' : 'visual.environment', before: visualBase(before.document)?.environment ?? null,
    after: visualBase(after.document)?.environment ?? null, fields: ['environment'],
  })
  changes.push(...terrainRecordChanges(before.document, after.document))
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
  if (candidate.schemaVersion === 2) {
    if (lease.schemaVersion !== 2 || !candidate.budgetIdentity || Object.entries(candidate.budgetIdentity).some(([key, value]) =>
      Reflect.get(lease, key) !== value)) throw new Error('任务采用租约的策略、来源或累计预算身份不同。')
  } else if (lease.schemaVersion !== 1) throw new Error('任务采用租约版本不同。')
  if (duration <= 0 || duration > AUTHORING_LIMITS.claimMs || elapsed < 0 || elapsed >= duration) throw new Error('任务采用租约已过期，请重新确认。')
  return lease
}
