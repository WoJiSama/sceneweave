import { inspectSceneDocumentDomains, parseSceneDocument, sceneDocumentSchema, validateSceneDocument, type ValidationResult } from './scene.js'
import { freezeJson, inspectJsonInput } from './json.js'
import { validateGeometry, validatePropMoveGeometry } from '../geometry/geometry.js'
import type { Prop, SceneDocument } from '../model/scene.js'
import { assertIndependentPropUpdateUnlocked } from '../commands/base.js'
import { independentPropUpdateSupported } from './prop-update-boundary.js'
import { aggregateWorldFrames } from '../aggregates/state.js'
import { localToWorldPoint, worldToLocalPoint } from '../aggregates/coordinates.js'
import { z } from 'zod'

type ValidSnapshot = Extract<ValidationResult, { ok: true }>
const snapshots = new WeakMap<object, ValidSnapshot>()
let revisionSchema: z.ZodType<{ revision: number; updatedAt: string }> | undefined

/** Certification belongs only to the independently parsed, owned result. */
export function isCertifiedSceneSnapshot(input: unknown): input is SceneDocument {
  return !!input && typeof input === 'object' && snapshots.has(input)
}

export const freezeSceneData = freezeJson

function certify(document: SceneDocument, warnings: ValidSnapshot['warnings']): ValidSnapshot {
  const result: ValidSnapshot = Object.freeze({ ok: true, document: freezeJson(document), warnings: freezeJson(warnings) })
  snapshots.set(document, result)
  return result
}

export function validateSceneSnapshot(input: unknown): ValidationResult {
  if (input && typeof input === 'object') {
    const known = snapshots.get(input)
    if (known) return known
  }
  const result = validateSceneDocument(input)
  return result.ok ? certify(result.document, result.warnings) : result
}

export interface SceneDerivationEvidence {
  algorithmContract: 'aggregate-prop-move-geometry@1'
  baseline: { sceneId: string; revision: number }
  changedPropIds: readonly string[]
  groupIds: readonly string[]
  reused: readonly ['non-prop-geometry', 'unchanged-prop-geometry']
}
const derivations = new WeakMap<object, SceneDerivationEvidence>()

export type PropUpdateField = 'positionMm' | 'rotationDeg'
export interface PropUpdateCommand { readonly type: 'updateProp'; readonly id: string; readonly changes: { readonly positionMm?: { readonly x: number; readonly y: number }; readonly rotationDeg?: number } }
export interface PropUpdateChange { readonly id: string; readonly fields: readonly PropUpdateField[]; readonly before: Prop; readonly after: Prop }
export interface PropUpdateStep { readonly before: SceneDocument; readonly after: SceneDocument; readonly command: PropUpdateCommand; readonly changes: readonly PropUpdateChange[]; readonly dependencyIds: readonly string[] }
export interface PropUpdateTransaction {
  readonly baseline: SceneDocument
  readonly result: SceneDocument
  readonly commands: readonly PropUpdateCommand[]
  readonly steps: readonly PropUpdateStep[]
  readonly changes: readonly PropUpdateChange[]
}
const issuedPropTransactions = new WeakSet<object>()
const propTransactions = new WeakMap<SceneDocument, { latest: PropUpdateTransaction; baselines: WeakMap<SceneDocument, PropUpdateTransaction> }>()
function registerPropTransaction(witness: PropUpdateTransaction): void {
  issuedPropTransactions.add(witness)
  if (witness.result === witness.baseline) return
  let entry = propTransactions.get(witness.result)
  if (!entry) { entry = { latest: witness, baselines: new WeakMap() }; propTransactions.set(witness.result, entry) }
  entry.latest = witness; entry.baselines.set(witness.baseline, witness)
}
/** Only actual executor results carry this witness; cloned objects and caller
 * changed-id lists cannot register or transfer it. */
export function getPropUpdateTransaction(result: SceneDocument, baseline?: SceneDocument): PropUpdateTransaction | undefined {
  const entry = propTransactions.get(result)
  return baseline === undefined ? entry?.latest : entry?.baselines.get(baseline)
}

/** Receipt consumption only revokes optimization evidence; the immutable
 * snapshots remain certified. Caller-created lookalikes cannot name a release. */
export function releasePropUpdateTransaction(witness: PropUpdateTransaction): void {
  if (!issuedPropTransactions.has(witness)) return
  issuedPropTransactions.delete(witness)
  if (witness.result !== witness.baseline) propTransactions.delete(witness.result)
  for (const step of witness.steps) if (step.after !== witness.baseline) propTransactions.delete(step.after)
}

const propUpdateSchema = z.array(z.object({ type: z.literal('updateProp'), id: z.string().min(1).max(256).refine(value => value !== '__proto__'),
  changes: z.object({ positionMm: z.object({ x: z.number().refine(Number.isSafeInteger), y: z.number().refine(Number.isSafeInteger) }).strict().optional(),
    rotationDeg: z.number().finite().min(0).lt(360).optional() }).strict() }).strict()).min(1).max(256)
const changedPropFields = (before: Prop, after: Prop): PropUpdateField[] => [
  ...(before.positionMm.x !== after.positionMm.x || before.positionMm.y !== after.positionMm.y ? ['positionMm' as const] : []),
  ...(before.rotationDeg !== after.rotationDeg ? ['rotationDeg' as const] : []),
]

/** Execute a closed position/angle operation set, instead of accepting an
 * arbitrary changed document and rediscovering its write set. Unsupported
 * dependency closures return undefined before exposing any intermediate state. */
export function tryApplyPropUpdatesSnapshot(baseline: SceneDocument, inputCommands: unknown): PropUpdateTransaction | undefined {
  const original = snapshots.get(baseline)
  if (!original || baseline.mapMode !== 'scene') return
  if (inspectJsonInput(inputCommands)) return
  const parsed = propUpdateSchema.safeParse(inputCommands)
  if (!parsed.success) return
  const commands = freezeJson(parsed.data), steps: PropUpdateStep[] = []
  const groups = baseline.aggregateCoordinates?.groups ?? {}
  const frames = baseline.aggregateCoordinates ? aggregateWorldFrames(baseline.aggregateCoordinates) : undefined
  const owners = new Map<string, string>()
  for (const group of Object.values(groups)) for (const member of group.members) if (member.kind === 'prop') owners.set(member.id, group.id)
  let current = baseline
  const touched = new Set<string>()
  for (const command of commands) {
    const previous = Object.hasOwn(current.props, command.id) ? current.props[command.id] : undefined
    if (!previous) return
    const next: Prop = { ...previous, ...command.changes }, fields = changedPropFields(previous, next)
    if (!fields.length) { steps.push({ before: current, after: current, command, changes: [], dependencyIds: [command.id] }); continue }
    if (!independentPropUpdateSupported(baseline, previous, next)) return
    const dependencyIds = assertIndependentPropUpdateUnlocked(current, previous)
    const owner = owners.get(command.id)
    if (owner && frames) {
      const frame = frames.get(owner)!, position = localToWorldPoint(frame, worldToLocalPoint(frame, next.positionMm))
      const localAngle = ((next.rotationDeg - frame.quarterTurns * 90) % 360 + 360) % 360
      const restoredAngle = ((localAngle + frame.quarterTurns * 90) % 360 + 360) % 360
      if (position.x !== next.positionMm.x || position.y !== next.positionMm.y || restoredAngle !== next.rotationDeg) return
    }
    // The strict baseline owns all retained fields. Commands may create only
    // independently parsed position/angle values; every other branch is shared.
    freezeJson(next)
    const candidate: SceneDocument = { ...current, props: { ...current.props, [command.id]: next } }
    const geometry = validatePropMoveGeometry(candidate, [command.id], original.warnings)
    // Legacy batches validate their final geometry. An invalid intermediate
    // uses that path rather than changing acceptance of a later repair.
    if (geometry.errors.length) return
    const after = certify(candidate, geometry.warnings).document
    const change = { id: command.id, fields, before: previous, after: next }
    steps.push({ before: current, after, command, changes: [change], dependencyIds }); touched.add(command.id); current = after
  }
  const changes = [...touched].flatMap(id => {
    const before = baseline.props[id], after = current.props[id], fields = changedPropFields(before, after)
    return fields.length ? [{ id, fields, before, after }] : []
  })
  const result = changes.length ? current : baseline
  const transaction = freezeJson({ baseline, result, commands, steps, changes })
  // Each receipt is created from the executor's owned steps, never a caller
  // supplied changed-id set. Keep both local and original-baseline pairs.
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (step.after === step.before) continue
    registerPropTransaction(freezeJson({ baseline: step.before, result: step.after, commands: [step.command], steps: [step], changes: step.changes }))
    const prefix = steps.slice(0, index + 1), ids = [...new Set(prefix.flatMap(row => row.changes.map(change => change.id)))]
    const delta = ids.flatMap(id => {
      const before = baseline.props[id], after = step.after.props[id], fields = changedPropFields(before, after)
      return fields.length ? [{ id, fields, before, after }] : []
    })
    registerPropTransaction(freezeJson({ baseline, result: step.after, commands: commands.slice(0, index + 1), steps: prefix, changes: delta }))
  }
  registerPropTransaction(transaction)
  return transaction
}
/** Diagnostic evidence only, bound to the exact certified result; never an
 * input proof, persistent field, resource credential or edit permission. */
export function getSceneDerivationEvidence(input: SceneDocument): SceneDerivationEvidence | undefined {
  return derivations.get(input)
}

// Both operands are strict-parser-owned plain JSON. Preserve record order as
// well as values so retained warnings match complete validation exactly.
const sameOwnedValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/** Complete comparison after strict parsing proves the closed operation set.
 * Any future scene/prop field is compared automatically and fails closed. */
function propMoveDelta(before: SceneDocument, after: SceneDocument): { changedPropIds: string[]; groupIds: string[] } | undefined {
  if (before.mapMode !== 'scene' || before.aggregateCoordinates?.encoding !== 'world') return
  for (const field of Object.keys(after) as (keyof SceneDocument)[]) {
    if (field !== 'props' && !sameOwnedValue(before[field], after[field])) return
  }
  // Optional fields may also disappear, so compare both complete key sets.
  if (!sameOwnedValue(Object.keys(before), Object.keys(after))) return
  if (!sameOwnedValue(Object.keys(before.props), Object.keys(after.props))) return
  const owners = new Map<string, string>()
  for (const group of Object.values(before.aggregateCoordinates.groups)) for (const member of group.members) {
    if (member.kind === 'prop') owners.set(member.id, group.id)
  }
  const changedPropIds: string[] = []
  for (const [id, next] of Object.entries(after.props)) {
    const previous = before.props[id]
    if (sameOwnedValue(previous, next)) continue
    if (!owners.has(id) || !sameOwnedValue(Object.keys(previous), Object.keys(next))) return
    for (const field of Object.keys(next) as (keyof typeof next)[]) {
      if (field !== 'positionMm' && field !== 'rotationDeg' && !sameOwnedValue(previous[field], next[field])) return
    }
    changedPropIds.push(id)
  }
  if (!changedPropIds.length) return
  const changed = new Set(changedPropIds)
  // Container geometry and manual member state have additional invariants.
  // Even detached/deleted records conservatively leave this finite fast path.
  for (const group of [...Object.values(before.prefabInstances), ...Object.values(before.scatterGroups)]) {
    if (Object.values(group.members).some(member => member.propId !== null && changed.has(member.propId))) return
  }
  for (const group of Object.values(before.decorationClusters)) {
    if (Object.values(group.members).some(member => member.entityId !== null && changed.has(member.entityId))) return
  }
  return { changedPropIds, groupIds: [...new Set(changedPropIds.map(id => owners.get(id)!))].sort() }
}

/** Internal editor derivation. Only this module's exact independently parsed,
 * frozen baseline can establish the retained invariants. Misses run full
 * validation; every candidate still passes strict parsing and all other domain
 * validators, including dependency/resource metadata and player secrecy. */
export function validateSceneDerivationSnapshot(input: unknown, baseline: SceneDocument): ValidationResult {
  const original = snapshots.get(baseline)
  if (!original) return validateSceneSnapshot(input)
  const parsed = parseSceneDocument(input)
  if (!parsed.ok) return parsed
  const delta = propMoveDelta(original.document, parsed.document)
  const geometry = delta ? validatePropMoveGeometry(parsed.document, delta.changedPropIds, original.warnings) : validateGeometry(parsed.document)
  const result = inspectSceneDocumentDomains(parsed.document, geometry)
  if (!result.ok) return result
  const certified = certify(result.document, result.warnings)
  if (delta) derivations.set(certified.document, freezeJson({ algorithmContract: 'aggregate-prop-move-geometry@1',
    baseline: { sceneId: original.document.sceneId, revision: original.document.revision }, ...delta,
    reused: ['non-prop-geometry', 'unchanged-prop-geometry'] }))
  return certified
}

/** The application controls monotonic revision+1, including undo and redo. */
export function reviseSceneSnapshot(input: SceneDocument, revision: number, updatedAt: string): SceneDocument {
  const current = validateSceneSnapshot(input)
  if (!current.ok) throw new Error(`当前场景无效：${current.errors.map(error => error.message).join('；')}`)
  revisionSchema ??= z.object({ revision: sceneDocumentSchema.shape.revision, updatedAt: sceneDocumentSchema.shape.updatedAt }).strict()
  const checked = revisionSchema.safeParse({ revision, updatedAt })
  if (!checked.success) throw new Error(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'))
  return certify({ ...current.document, ...checked.data }, current.warnings).document
}

export const withSceneRevision = reviseSceneSnapshot
