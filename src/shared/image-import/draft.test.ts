import { describe, expect, it } from 'vitest'
import { affectedImageCandidates, applyImageDraftEdit, captureImageDraftStamp, createImageImportDraft, isCurrentImageDraftStamp,
  undoImageDraftEdit, type ImageCandidate, type ImageImportSession } from './draft.js'

const image = { sha256: 'a'.repeat(64), pixelWidth: 1280, pixelHeight: 840 }
function candidate(id: string, dependencies: string[] = [], kind: ImageCandidate['kind'] = 'region'): ImageCandidate {
  return { id, kind, shape: 'polygon', points: [{ x: 740, y: 180 }, { x: 1160, y: 180 }, { x: 1160, y: 490 }],
    status: 'pending', source: 'automatic', dependencies }
}
function add(session: ImageImportSession, ...candidates: ImageCandidate[]): ImageImportSession {
  return candidates.reduce((state, item) => applyImageDraftEdit(state, { type: 'putCandidate', candidate: item }), session)
}

describe('transient image recognition draft', () => {
  it('owns immutable candidates and positive/negative annotations and expands only the dependency closure', () => {
    const wall = candidate('wall', [], 'wall')
    let session = add(createImageImportDraft(image), wall, candidate('room', ['wall']), candidate('rug', ['room'], 'object'),
      candidate('piano', ['rug'], 'object'), candidate('unrelated'))
    session = applyImageDraftEdit(session, { type: 'addAnnotation', annotation: { id: 'wood-seam', kind: 'wall', polarity: 'negative',
      shape: 'stroke', points: [{ x: 800, y: 300 }, { x: 900, y: 300 }], targetCandidateIds: ['wall'] } })
    expect(affectedImageCandidates(session.current, ['wall'])).toEqual(['wall', 'room', 'rug', 'piano'])
    expect(affectedImageCandidates(session.current, ['piano'])).toEqual(['piano'])
    expect(Object.isFrozen(session.current.candidates[0].points[0])).toBe(true)
    expect(session.current.candidates[0].points).not.toBe(wall.points)
    expect(session.current.annotations[0].polarity).toBe('negative')
  })

  it('preserves confirmed and excluded decisions against automatic replacement while allowing explicit manual correction', () => {
    let session = add(createImageImportDraft(image), candidate('room'))
    for (const status of ['confirmed', 'excluded'] as const) {
      session = applyImageDraftEdit(session, { type: 'setCandidateStatus', id: 'room', status })
      expect(() => applyImageDraftEdit(session, { type: 'putCandidate', candidate: candidate('room') })).toThrow('自动结果')
    }
    session = applyImageDraftEdit(session, { type: 'putCandidate', candidate: { ...candidate('room'), source: 'manual', status: 'confirmed' } })
    expect(session.current.candidates[0].status).toBe('confirmed')
    expect(session.current.candidates[0].source).toBe('manual')
  })

  it('detects indirect height contradictions and prevents dangling or cyclic dependencies atomically', () => {
    let session = add(createImageImportDraft(image), candidate('a'), candidate('b', ['a']), candidate('c', ['b']))
    for (const relation of [{ id: 'ab', lowerId: 'a', higherId: 'b' }, { id: 'bc', lowerId: 'b', higherId: 'c' }]) {
      session = applyImageDraftEdit(session, { type: 'addHeightRelation', relation })
    }
    const before = session
    expect(() => applyImageDraftEdit(session, { type: 'addHeightRelation', relation: { id: 'ca', lowerId: 'c', higherId: 'a' } })).toThrow('高低关系矛盾')
    expect(() => applyImageDraftEdit(session, { type: 'putCandidate', candidate: candidate('a', ['c']) })).toThrow('依赖形成循环')
    expect(() => applyImageDraftEdit(session, { type: 'putCandidate', candidate: candidate('d', ['missing']) })).toThrow('找不到候选')
    expect(() => applyImageDraftEdit(session, { type: 'putCandidate', candidate: candidate('a', [], 'object') })).toThrow('高低关系')
    expect(session).toBe(before)
    expect(session.current.heightRelations).toHaveLength(2)
  })

  it('invalidates old results after edits and undo, even when earlier visible content is restored', () => {
    const original = add(createImageImportDraft(image), candidate('room'))
    const stamp = captureImageDraftStamp(original)
    const changed = applyImageDraftEdit(original, { type: 'setCandidateStatus', id: 'room', status: 'confirmed' })
    const restored = undoImageDraftEdit(changed)
    expect(restored.current.candidates).toEqual(original.current.candidates)
    expect(restored.current.generation).toBe(changed.current.generation + 1)
    expect(isCurrentImageDraftStamp(original, stamp)).toBe(true)
    expect(isCurrentImageDraftStamp(changed, stamp)).toBe(false)
    expect(isCurrentImageDraftStamp(restored, stamp)).toBe(false)
    expect(isCurrentImageDraftStamp(restored, captureImageDraftStamp(restored))).toBe(true)
  })

  it('recalibrates without losing original pixel annotations and rejects mismatched or invalid source data', () => {
    const original = add(createImageImportDraft(image), candidate('room'))
    const calibration = { pixelWidth: 1280, pixelHeight: 840, first: { x: 0, y: 0 }, second: { x: 100, y: 0 }, distanceMm: 2000 }
    const scaled = applyImageDraftEdit(original, { type: 'setCalibration', calibration })
    expect(scaled.current.calibration?.mmPerPixel).toBe(20)
    expect(scaled.current.candidates).toEqual(original.current.candidates)
    expect(() => applyImageDraftEdit(scaled, { type: 'setCalibration', calibration: { ...calibration, pixelWidth: 1024 } })).toThrow('原图尺寸不符')
    expect(() => createImageImportDraft({ ...image, sha256: 'wrong' })).toThrow()
    expect(() => add(original, { ...candidate('outside'), points: [{ x: 1300, y: 0 }] })).toThrow()
  })
})
