import { inspectSceneDocumentDomains, parseSceneDocument, sceneDocumentSchema, validateSceneDocument, type ValidationResult } from './scene.js'
import { freezeJson } from './json.js'
import { validateGeometry, validatePropMoveGeometry } from '../geometry/geometry.js'
import type { SceneDocument } from '../model/scene.js'
import { z } from 'zod'

type ValidSnapshot = Extract<ValidationResult, { ok: true }>
const snapshots = new WeakMap<object, ValidSnapshot>()
const revisionSchema = z.object({ revision: sceneDocumentSchema.shape.revision, updatedAt: sceneDocumentSchema.shape.updatedAt }).strict()

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
  const checked = revisionSchema.safeParse({ revision, updatedAt })
  if (!checked.success) throw new Error(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'))
  return certify({ ...current.document, ...checked.data }, current.warnings).document
}

export const withSceneRevision = reviseSceneSnapshot
