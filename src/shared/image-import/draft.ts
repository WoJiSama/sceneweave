import { z } from 'zod'
import { captureJson, freezeJson } from '../validation/json.js'
import { assertImagePoint, createImageCalibration, imageDimensionsSchema, imagePointSchema,
  type ImageCalibration, type ImageCalibrationInput, type ImageDimensions, type ImagePoint } from './calibration.js'

export interface ImageImportSource extends ImageDimensions { readonly sha256: string }
export type ImageCandidateKind = 'wall' | 'region' | 'object'
export type ImageCandidateStatus = 'pending' | 'confirmed' | 'excluded'
export interface ImageCandidate {
  readonly id: string
  readonly kind: ImageCandidateKind
  readonly shape: 'point' | 'polyline' | 'polygon'
  readonly points: readonly ImagePoint[]
  readonly source: 'automatic' | 'manual' | 'inferred'
  readonly status: ImageCandidateStatus
  readonly dependencies: readonly string[]
}
export interface ImageAnnotation {
  readonly id: string
  readonly kind: ImageCandidateKind
  readonly polarity: 'positive' | 'negative'
  readonly shape: 'stroke' | 'polygon'
  readonly points: readonly ImagePoint[]
  readonly targetCandidateIds: readonly string[]
}
export interface ImageHeightRelation { readonly id: string; readonly lowerId: string; readonly higherId: string }
export interface ImageImportDraft {
  readonly image: ImageImportSource
  readonly calibration: ImageCalibration | null
  readonly generation: number
  readonly candidates: readonly ImageCandidate[]
  readonly annotations: readonly ImageAnnotation[]
  readonly heightRelations: readonly ImageHeightRelation[]
}
export interface ImageImportSession { readonly current: ImageImportDraft; readonly undo: readonly ImageImportDraft[] }
export type ImageDraftEdit =
  | { type: 'setCalibration'; calibration: ImageCalibrationInput }
  | { type: 'putCandidate'; candidate: ImageCandidate }
  | { type: 'setCandidateStatus'; id: string; status: ImageCandidateStatus }
  | { type: 'addAnnotation'; annotation: ImageAnnotation }
  | { type: 'removeAnnotation'; id: string }
  | { type: 'addHeightRelation'; relation: ImageHeightRelation }
  | { type: 'removeHeightRelation'; id: string }

const idSchema = z.string().min(1)
const kindSchema = z.enum(['wall', 'region', 'object'])
const statusSchema = z.enum(['pending', 'confirmed', 'excluded'])
const pointsSchema = z.array(imagePointSchema).min(1)
const sourceSchema = imageDimensionsSchema.extend({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const candidateSchema = z.strictObject({ id: idSchema, kind: kindSchema, shape: z.enum(['point', 'polyline', 'polygon']),
  points: pointsSchema, source: z.enum(['automatic', 'manual', 'inferred']), status: statusSchema, dependencies: z.array(idSchema) })
const annotationSchema = z.strictObject({ id: idSchema, kind: kindSchema, polarity: z.enum(['positive', 'negative']),
  shape: z.enum(['stroke', 'polygon']), points: pointsSchema, targetCandidateIds: z.array(idSchema) })
const relationSchema = z.strictObject({ id: idSchema, lowerId: idSchema, higherId: idSchema })

/** The import session is transient. World entities are created only after normal project validation. */
export function createImageImportDraft(image: ImageImportSource, calibration?: ImageCalibrationInput): ImageImportSession {
  const source = sourceSchema.parse(captureJson(image))
  const initial: ImageImportSession = { current: { image: source, calibration: null, generation: 0,
    candidates: [], annotations: [], heightRelations: [] }, undo: [] }
  return calibration ? applyImageDraftEdit(initial, { type: 'setCalibration', calibration }) : freezeJson(initial)
}

function candidateById(draft: ImageImportDraft, id: string): ImageCandidate {
  const candidate = draft.candidates.find(value => value.id === id)
  if (!candidate) throw new Error(`找不到候选 ${id}。`)
  return candidate
}

function validatePoints(image: ImageDimensions, shape: string, points: readonly ImagePoint[]): void {
  points.forEach(point => assertImagePoint(image, point))
  if (shape === 'point' && points.length !== 1 || shape === 'polyline' && points.length < 2 || shape === 'polygon' && points.length < 3) {
    throw new Error('点、线或轮廓的标注点数无效。')
  }
}

/** Returns the seed candidates and every transitive dependent in stable draft order. */
export function affectedImageCandidates(draft: ImageImportDraft, candidateIds: readonly string[]): readonly string[] {
  candidateIds.forEach(id => candidateById(draft, id))
  const affected = new Set(candidateIds)
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of draft.candidates) {
      if (!affected.has(candidate.id) && candidate.dependencies.some(id => affected.has(id))) {
        affected.add(candidate.id)
        changed = true
      }
    }
  }
  return draft.candidates.filter(candidate => affected.has(candidate.id)).map(candidate => candidate.id)
}

function checkCandidate(draft: ImageImportDraft, input: ImageCandidate): ImageCandidate {
  const candidate = candidateSchema.parse(input)
  validatePoints(draft.image, candidate.shape, candidate.points)
  if (new Set(candidate.dependencies).size !== candidate.dependencies.length) throw new Error('候选依赖不能重复。')
  const previous = draft.candidates.find(item => item.id === candidate.id)
  const dependents = previous ? affectedImageCandidates(draft, [candidate.id]) : []
  for (const dependency of candidate.dependencies) {
    if (dependency === candidate.id || dependents.includes(dependency)) throw new Error('候选依赖形成循环。')
    candidateById(draft, dependency)
  }
  if (candidate.source !== 'manual' && (candidate.status !== 'pending' || previous && previous.status !== 'pending')) {
    throw new Error('自动结果不能改写已确认或已排除的候选。')
  }
  if (candidate.kind !== 'region' && draft.heightRelations.some(item => item.lowerId === candidate.id || item.higherId === candidate.id)) {
    throw new Error('先移除该区域的高低关系，再改变候选类型。')
  }
  return candidate
}

function checkHeightRelation(draft: ImageImportDraft, input: ImageHeightRelation): ImageHeightRelation {
  const relation = relationSchema.parse(input)
  for (const id of [relation.lowerId, relation.higherId]) {
    if (candidateById(draft, id).kind !== 'region') throw new Error('高低关系必须绑定区域候选。')
  }
  const reached = new Set([relation.higherId])
  const pending = [relation.higherId]
  while (pending.length) {
    const lower = pending.pop()!
    for (const existing of draft.heightRelations.filter(item => item.lowerId === lower)) {
      if (!reached.has(existing.higherId)) { reached.add(existing.higherId); pending.push(existing.higherId) }
    }
  }
  if (reached.has(relation.lowerId)) throw new Error(`高低关系矛盾：${relation.lowerId} 与 ${relation.higherId} 形成循环。`)
  return relation
}

export function applyImageDraftEdit(session: ImageImportSession, input: ImageDraftEdit): ImageImportSession {
  const edit = captureJson(input), draft = session.current
  let next: ImageImportDraft = { ...draft, generation: draft.generation + 1 }
  switch (edit.type) {
    case 'setCalibration': {
      const calibration = createImageCalibration(edit.calibration)
      if (calibration.pixelWidth !== draft.image.pixelWidth || calibration.pixelHeight !== draft.image.pixelHeight) throw new Error('比例标定与原图尺寸不符。')
      next = { ...next, calibration }
      break
    }
    case 'putCandidate': {
      const candidate = checkCandidate(draft, edit.candidate)
      const exists = draft.candidates.some(item => item.id === candidate.id)
      next = { ...next, candidates: exists ? draft.candidates.map(item => item.id === candidate.id ? candidate : item) : [...draft.candidates, candidate] }
      break
    }
    case 'setCandidateStatus':
      candidateById(draft, edit.id)
      statusSchema.parse(edit.status)
      next = { ...next, candidates: draft.candidates.map(item => item.id === edit.id ? { ...item, status: edit.status } : item) }
      break
    case 'addAnnotation': {
      const annotation = annotationSchema.parse(edit.annotation)
      validatePoints(draft.image, annotation.shape, annotation.points)
      annotation.targetCandidateIds.forEach(id => candidateById(draft, id))
      if (draft.annotations.some(item => item.id === annotation.id)) throw new Error('标注身份已存在。')
      next = { ...next, annotations: [...draft.annotations, annotation] }
      break
    }
    case 'removeAnnotation':
      if (!draft.annotations.some(item => item.id === edit.id)) throw new Error('找不到要移除的标注。')
      next = { ...next, annotations: draft.annotations.filter(item => item.id !== edit.id) }
      break
    case 'addHeightRelation': {
      if (draft.heightRelations.some(item => item.id === edit.relation.id)) throw new Error('高低关系身份已存在。')
      next = { ...next, heightRelations: [...draft.heightRelations, checkHeightRelation(draft, edit.relation)] }
      break
    }
    case 'removeHeightRelation':
      if (!draft.heightRelations.some(item => item.id === edit.id)) throw new Error('找不到要移除的高低关系。')
      next = { ...next, heightRelations: draft.heightRelations.filter(item => item.id !== edit.id) }
      break
    default:
      throw new Error('不支持的图片草稿操作。')
  }
  if (!Number.isSafeInteger(next.generation)) throw new Error('草稿代次超出范围。')
  return freezeJson({ current: next, undo: [...session.undo, draft] })
}

/** Restoring older content still advances the generation so old in-flight work remains stale. */
export function undoImageDraftEdit(session: ImageImportSession): ImageImportSession {
  const previous = session.undo.at(-1)
  if (!previous) return session
  if (!Number.isSafeInteger(session.current.generation + 1)) throw new Error('草稿代次超出范围。')
  return freezeJson({ current: { ...previous, generation: session.current.generation + 1 }, undo: session.undo.slice(0, -1) })
}

export const captureImageDraftStamp = (session: ImageImportSession): ImageImportDraft => session.current
export const isCurrentImageDraftStamp = (session: ImageImportSession, stamp: ImageImportDraft): boolean => session.current === stamp
