import { sceneDocumentSchema, validateSceneDocument, type ValidationResult } from './scene.js'
import { freezeJson } from './json.js'
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

/** The application controls monotonic revision+1, including undo and redo. */
export function reviseSceneSnapshot(input: SceneDocument, revision: number, updatedAt: string): SceneDocument {
  const current = validateSceneSnapshot(input)
  if (!current.ok) throw new Error(`当前场景无效：${current.errors.map(error => error.message).join('；')}`)
  const checked = revisionSchema.safeParse({ revision, updatedAt })
  if (!checked.success) throw new Error(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'))
  return certify({ ...current.document, ...checked.data }, current.warnings).document
}

export const withSceneRevision = reviseSceneSnapshot
