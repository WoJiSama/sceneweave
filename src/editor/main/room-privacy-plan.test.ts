import { beforeAll, describe, expect, it } from 'vitest'
import { createWaysideInnDocument } from '../../platform/browser/content/wayside-inn.js'
import { applyCommands } from '../../shared/commands/commands.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { canonicalJson, cloneJson } from '../../shared/validation/json.js'
import { getPlayerCoverageDiagnostics, projectScene } from '../../shared/projection/projection.js'
import { planRoomPrivacy, roomPrivacyChoices } from './room-privacy-plan.js'
import { inspectRoomPrivacyPublicImpacts } from './building-privacy-review.js'

const roomId = 'inn-linen', floorId = 'visual-floor', layerId = 'visual-layer-ground'
let sequence = 0, source: SceneDocument
const context = { clock: { now: () => '2026-11-18T00:00:00.000Z' }, ids: { nextId: () => `privacy-test-${++sequence}` } }
const plan = (scene: SceneDocument, extras: Partial<Parameters<typeof planRoomPrivacy>[0]> = {}) => planRoomPrivacy({ scene, roomId, secretOpeningIds: [], privateNoteIds: [], nextMaskId: () => `new-mask-${++sequence}`, layerId, ...extras })
beforeAll(() => {
  source = applyCommands(createWaysideInnDocument({ sceneId: 'privacy-plan', now: context.clock.now() }).document, [
    { type: 'createNote', id: 'related', floorId, layerId, kind: 'clue', text: '房间内的公开线索', visibility: 'public', anchor: { type: 'entity', entityKind: 'room', entityId: roomId } },
    { type: 'createNote', id: 'unrelated', floorId, layerId, kind: 'clue', text: '不相关的公开线索', visibility: 'public', anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } } },
  ], context)
})
describe('room privacy atomic plan', () => {
  it('covers real wall/shadow and supported prop envelopes while preserving original input and physics', () => {
    const before = canonicalJson(source), choices = roomPrivacyChoices(source, roomId)
    const openingId = choices.openings.find(row => source.openings[row.id].kind === 'door')!.id
    const result = plan(source, { secretOpeningIds: [openingId], privateNoteIds: ['related'] })
    const candidate = applyCommands(source, result.commands, context)
    expect(canonicalJson(source)).toBe(before)
    expect(result.coverageIssues.some(issue => issue.entityKind === 'room')).toBe(true)
    expect(result.coverageIssues.some(issue => issue.entityKind === 'prop')).toBe(true)
    expect(getPlayerCoverageDiagnostics(candidate)).toEqual([])
    expect(candidate.props).toEqual(source.props)
    expect(candidate.rooms[roomId]).toEqual({ ...source.rooms[roomId], visibility: 'gm' })
    expect(candidate.openings[openingId]).toEqual({ ...source.openings[openingId], secret: true, revealed: false })
    expect(candidate.notes.related.visibility).toBe('gm')
    expect(candidate.notes.unrelated).toEqual(source.notes.unrelated)
    expect(projectScene(candidate, 'player').notes.some(note => note.id === 'related')).toBe(false)
    const masks = result.commands.flatMap(command => command.type === 'upsertManualMask' ? [command.boundsMm] : [])
    const impacts = inspectRoomPrivacyPublicImpacts(candidate, undefined, floorId, masks)
    expect(masks.length).toBeGreaterThan(1)
    expect(impacts.some(impact => impact.id === roomId)).toBe(false)
    const priorImpacts = inspectRoomPrivacyPublicImpacts(candidate, undefined, floorId, [{ x: 14140, y: 1140, width: 6720, height: 9220 }])
    expect(priorImpacts.some(impact => impact.id === 'inn-hall')).toBe(true)
    expect(impacts.some(impact => impact.id === 'inn-hall')).toBe(false)
    const restoredProps = priorImpacts.filter(impact => impact.fullyHidden && !impacts.some(next => next.id === impact.id && next.fullyHidden))
    expect(restoredProps.length).toBeGreaterThan(0)
    for (const prop of restoredProps) expect(projectScene(candidate, 'player').props.some(value => value.id === prop.id)).toBe(true)
  })
  it('changes only explicitly selected entrance/note settings, with no automatic stored prop visibility changes', () => {
    const candidate = applyCommands(source, plan(source).commands, context)
    expect(candidate.openings).toEqual(source.openings)
    expect(candidate.notes).toEqual(source.notes)
    expect(candidate.props).toEqual(source.props)
    expect(projectScene(candidate, 'player').notes.some(note => note.id === 'related')).toBe(false)
    expect(projectScene(candidate, 'player').notes.some(note => note.id === 'unrelated')).toBe(true)
  })
  it('rejects unrelated choices, duplicates and occupied mask identities', () => {
    expect(() => plan(source, { secretOpeningIds: ['inn-entry'] })).toThrow(/关联/)
    expect(() => plan(source, { privateNoteIds: ['unrelated'] })).toThrow(/关联/)
    expect(() => plan(source, { privateNoteIds: ['related', 'related'] })).toThrow(/关联/)
    expect(() => plan(source, { nextMaskId: () => 'related' })).toThrow(/未占用/)
  })
  it('keeps normal candidate locks authoritative for room, selected door and mask layer', () => {
    for (const lock of ['room', 'opening', 'layer']) {
      const scene = cloneJson(source), openingId = roomPrivacyChoices(scene, roomId).openings.find(row => scene.openings[row.id].kind === 'door')!.id
      if (lock === 'room') scene.rooms[roomId].editLocked = true
      if (lock === 'opening') scene.openings[openingId].editLocked = true
      if (lock === 'layer') scene.userLayers[layerId].editLocked = true
      expect(() => applyCommands(scene, plan(scene, { secretOpeningIds: [openingId] }).commands, context)).toThrow(/锁/)
    }
  })
  it('refuses to hide unrelated pre-existing unsafe content inside a larger new mask', () => {
    const scene = cloneJson(source); scene.rooms['inn-kitchen'].visibility = 'gm'
    expect(() => plan(scene)).toThrow(/已有未覆盖/)
  })
  it('reuses sufficient existing masks without allocating a replacement identity', () => {
    const result = plan(source)
    const masks = result.commands.filter(command => command.type === 'upsertManualMask')
    const withMask = applyCommands(source, masks, context)
    const reused = plan(withMask)
    expect(reused.commands.some(command => command.type === 'upsertManualMask')).toBe(false)
    expect(getPlayerCoverageDiagnostics(applyCommands(withMask, reused.commands, context))).toEqual([])
  })
  it('reports public intersections without mutating geometry, including anonymous props', () => {
    const scene = cloneJson(source), publicProp = Object.values(scene.props).find(prop => prop.supportRef.id === 'inn-hall') ?? Object.values(scene.props)[0]
    publicProp.definitionRef = null
    const before = canonicalJson(scene)
    const impacts = inspectRoomPrivacyPublicImpacts(scene, undefined, floorId, [scene.exportBoundsMm])
    expect(impacts.some(impact => impact.id === publicProp.id && impact.label === publicProp.id)).toBe(true)
    expect(canonicalJson(scene)).toBe(before)
    expect(() => inspectRoomPrivacyPublicImpacts(scene, undefined, 'missing-floor', [scene.exportBoundsMm])).toThrow()
  })
})
