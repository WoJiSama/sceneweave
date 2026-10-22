import { sceneSchemaV2, validateSceneV2, type ValidationResultV2 } from './schema'
import type { SceneDocumentV2 } from './types'

type ValidSnapshot = Extract<ValidationResultV2, { ok: true }>
// Only this module can certify identities. Freezing an arbitrary input is not a
// validation credential, and caller-owned mutable objects are never cached.
const snapshots = new WeakMap<object, ValidSnapshot>()
const revisionSchema = sceneSchemaV2.pick({ revision: true, updatedAt: true })

/** Read-only identity check for disposable derived indexes, never a caller credential. */
export function isCertifiedSceneSnapshotV2(input: unknown): input is SceneDocumentV2 {
  return !!input && typeof input === 'object' && snapshots.has(input)
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeJson(child)
  }
  return value
}

function certify(document: SceneDocumentV2, warnings: ValidSnapshot['warnings']): ValidSnapshot {
  const result: ValidSnapshot = Object.freeze({ ok: true, document: freezeJson(document), warnings: freezeJson(warnings) })
  snapshots.set(document, result)
  return result
}

/**
 * Validate external input in full and return an owned, deeply immutable scene.
 * Only that returned identity can reuse validation; no caller flag skips checks.
 */
export function validateSceneSnapshotV2(input: unknown): ValidationResultV2 {
  if (input && typeof input === 'object') {
    const known = snapshots.get(input)
    if (known) return known
  }
  const result = validateSceneV2(input)
  return result.ok ? certify(result.document, result.warnings) : result
}

/** Metadata cannot change geometry/dependencies; its strict schema still applies. */
export function reviseSceneSnapshotV2(input: SceneDocumentV2, revision: number, updatedAt: string): SceneDocumentV2 {
  const current = validateSceneSnapshotV2(input)
  if (!current.ok) throw new Error(`当前场景无效：${current.errors.map(error => error.message).join('；')}`)
  const checked = revisionSchema.safeParse({ revision, updatedAt })
  if (!checked.success) throw new Error(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'))
  return certify({ ...current.document, ...checked.data }, current.warnings).document
}
