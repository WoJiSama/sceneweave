import { sceneSchemaV3, validateSceneV3, type ValidationResultV3 } from './schema'
import type { SceneDocumentV3 } from './types'

type ValidSnapshot = Extract<ValidationResultV3, { ok: true }>
const snapshots = new WeakMap<object, ValidSnapshot>()
const revisionSchema = sceneSchemaV3.pick({ revision: true, updatedAt: true })

export function isCertifiedSceneSnapshotV3(input: unknown): input is SceneDocumentV3 {
  return !!input && typeof input === 'object' && snapshots.has(input)
}
function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeJson(child)
  }
  return value
}
function certify(document: SceneDocumentV3, warnings: ValidSnapshot['warnings']): ValidSnapshot {
  const result: ValidSnapshot = Object.freeze({ ok: true, document: freezeJson(document), warnings: freezeJson(warnings) })
  snapshots.set(document, result)
  return result
}
export function validateSceneSnapshotV3(input: unknown): ValidationResultV3 {
  if (input && typeof input === 'object') {
    const known = snapshots.get(input)
    if (known) return known
  }
  const result = validateSceneV3(input)
  return result.ok ? certify(result.document, result.warnings) : result
}
/** The Workspace controls revision+1, including undo/redo; metadata remains strict. */
export function reviseSceneSnapshotV3(input: SceneDocumentV3, revision: number, updatedAt: string): SceneDocumentV3 {
  const current = validateSceneSnapshotV3(input)
  if (!current.ok) throw new Error(`当前场景无效：${current.errors.map(error => error.message).join('；')}`)
  const checked = revisionSchema.safeParse({ revision, updatedAt })
  if (!checked.success) throw new Error(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'))
  return certify({ ...current.document, ...checked.data }, current.warnings).document
}
