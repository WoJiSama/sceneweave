import { assertTaskBudget, measureTaskBudget, parseTaskBudgetProfile, taskBudgetProfile, type BudgetUsage, type TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { syncAppearanceGraph } from '../../shared/appearance/graph.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { sha256Text } from '../../shared/geometry/scatter.js'
import { localGenerationRequestSchema, runLocalGeneration, type LocalGenerationRequest } from '../../shared/generation/local.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { ProjectData } from '../../shared/model/project.js'
import type { HistoryIdentity } from '../../shared/model/history.js'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../../shared/terrain-generation/integrity.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { assertTerrainBudget, type terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import type { AtomicChange } from './atomic.js'
import { materializeProject } from './prepare.js'
import { getVerifiedEditableProject, toBundle, validateEditableProject, type EditableProject } from './project.js'

export interface LocalGenerationCandidate {
  project: EditableProject
  document: SceneDocument
  input: LocalGenerationRequest
  result: ReturnType<typeof runLocalGeneration>
  cost: ReturnType<typeof terrainCommandCost>
  changes: AtomicChange[]
  readIds: string[]
  writeIds: string[]
  budgetProfile: TaskBudgetProfile
  profileHash: string
  usage: BudgetUsage
}
export interface LocalGenerationPreview extends LocalGenerationCandidate {
  checkpoint: number
  currentSceneId: string
  currentRevision: number
  baseContentHash: string
}

/** Keys include retained tombstone IDs; values include birth/topology tokens.
 * None of these already allocated identities may be reused by a local output. */
function allocatedStrings(value: unknown, used = new Set<string>()): Set<string> {
  if (typeof value === 'string') used.add(value)
  else if (Array.isArray(value)) value.forEach(item => allocatedStrings(item, used))
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    used.add(key); allocatedStrings(item, used)
  }
  return used
}
function replayRuntime(base: EditableProject, request: LocalGenerationRequest): PreparationContext {
  const used = allocatedStrings(toBundle(base).project)
  const prefix = `generation-local-${sha256Text(canonicalJson({ sceneId: base.document.sceneId, revision: base.document.revision, request })).slice(0, 24)}`
  let sequence = 0
  // Candidate timestamps describe their fixed baseline. Adoption receives its
  // actual transaction timestamp only after replay and protection succeed.
  return { clock: { now: () => base.document.updatedAt }, ids: { nextId: () => {
    let id: string
    do { id = `${prefix}-${sequence++}` } while (used.has(id))
    used.add(id); return id
  } } }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const same = (before: unknown, after: unknown) => canonicalJson(before ?? null) === canonicalJson(after ?? null)
/** Every persisted branch participates, including appearance mappings, fixed
 * sources, generated receipts and history tombstones. Entity rows stay whole. */
function exactChanges(before: ProjectData, after: ProjectData): AtomicChange[] {
  const changes: AtomicChange[] = []
  const visit = (previous: unknown, next: unknown, path: string[]) => {
    if (same(previous, next)) return
    const a = isRecord(previous) ? previous : {}, b = isRecord(next) ? next : {}
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    const whole = path.length > 0 && (!isRecord(previous) || !isRecord(next)
      || typeof a.id === 'string' || typeof b.id === 'string'
      || path[0] === 'document' && path.length === 3 && !['generation', 'visual', 'regional'].includes(path[1]))
    if (whole || !keys.length) {
      changes.push({ id: path.at(-1) ?? 'project', collection: path.slice(0, -1).join('.'), before: previous ?? null, after: next ?? null,
        fields: keys.length ? keys.filter(key => !same(a[key], b[key])) : [path.at(-1) ?? 'value'] })
      return
    }
    for (const key of keys) visit(a[key], b[key], [...path, key])
  }
  visit(before, after, [])
  return changes
}

export async function prepareLocalGenerationProject(base: EditableProject, raw: unknown, options: {
  runtime: PreparationContext
  validation: CompleteValidationOptions
  signal?: ResourceOptions['signal']
  budget?: TaskBudgetProfile
}): Promise<LocalGenerationCandidate> {
  const input = localGenerationRequestSchema.parse(captureJson(raw))
  const budgetProfile = options.budget ? parseTaskBudgetProfile(options.budget) : taskBudgetProfile('standard')
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  const owned = getVerifiedEditableProject(base) ?? await validateEditableProject(base, validation)
  checkCancelled(validation.signal)
  const runtime = replayRuntime(owned, input)
  const result = runLocalGeneration(owned, input, runtime, { profile: budgetProfile, checkCancelled: () => checkCancelled(validation.signal) })
  const historyIdentity = advanceHistoryIdentity(owned.historyIdentity, owned.document, result.document, runtime)
  const content = syncAppearanceGraph({ document: result.document, historyIdentity, appearance: owned.appearance }, owned.document, result.commands ?? [])
  // This is an authorized generation transaction, already reconciled by the
  // domain implementation. A manual-edit baseline would detach those outputs
  // again. The isolated candidate still takes full byte/license/pixel validation.
  const project = await materializeProject({ ...owned, ...content }, { runtime, validation, signal: validation.signal })
  checkCancelled(validation.signal)
  // Profiles bound generation search/resources; they never increase the normal
  // transaction's full entity/geometry/source/identity cost beyond 256.
  const cost = assertTerrainBudget(owned.document, project.document, { before: owned, after: project })
  const usage = assertTaskBudget(budgetProfile, measureTaskBudget(owned.document, project.document, { before: owned, after: project }))
  const changes = exactChanges(toBundle(owned).project, toBundle(project).project)
  const writeIds = [...new Set([...changes.map(change => change.id), ...result.writes.map(write => write.entityId)])].sort()
  const reads = new Set(result.readIds)
  // Source ancestry is a real input even when no document field changes. Keep
  // these existing fixed records visible beside spatial/ownership dependencies.
  for (const id of [...reads, ...writeIds]) {
    let sourceId: string | null = owned.appearance.propSources[id] ?? owned.appearance.surfaceSources[id] ?? null
    while (sourceId && !reads.has(sourceId)) {
      reads.add(sourceId)
      sourceId = owned.appearance.sources[sourceId]?.parentSourceId ?? null
    }
  }
  const writes = new Set(writeIds)
  return { project, document: project.document, input: result.request, result, cost, changes,
    readIds: [...reads].filter(id => !writes.has(id)).sort(), writeIds, budgetProfile, profileHash: budgetProfile.profileHash, usage }
}

/** An explicit undo may restore geometry, but cannot restore a previous outdoor
 * topology witness. Preserve that invalidation in the existing ownership row. */
export function protectLocalGenerationContinuity(document: SceneDocument, saved: HistoryIdentity, current: HistoryIdentity): void {
  const generation = getLegacyGeneration(document)!
  let changed = false
  for (const owner of Object.values(generation.ownership)) {
    const rule = generation.rules[owner.ruleId], recipe = rule && generation.recipes[rule.recipeRef.id]
    if (!recipe || !('domain' in recipe) || recipe.domain !== 'volcano' || owner.target.kind !== 'terrainArea' || !owner.managedFields.includes('geometry')) continue
    const id = owner.target.entityId, before = saved.outdoorTokens[id], now = current.outdoorTokens[id]
    if (!document.terrainAreas[id] || !before || !now || before.token === now.token && before.topologyToken === now.topologyToken) continue
    owner.managedFields = owner.managedFields.filter(field => field !== 'geometry')
    owner.manualFields = [...new Set([...owner.manualFields, 'geometry' as const])]
    owner.state = 'manual'; rule.state = 'paused'; changed = true
  }
  if (changed) for (const rule of Object.values(generation.rules)) {
    rule.inputHash = generationInputHash(document, rule)
    rule.managedOutputHash = managedOutputHash(document, rule)
  }
}
