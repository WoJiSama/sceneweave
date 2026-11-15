import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank'
import { applyCommands } from '../../shared/commands/commands'
import { notePrivacySummary } from './note-privacy'
import { resolveFloorOutput } from '../../shared/floors/output'

function fixture() {
  const initial = createRefinedBlankDocument('interior', { sceneId: 'note-privacy', title: '注记可见性', widthMm: 18000, heightMm: 14000, preset: 'narrative', now: '2026-11-13T00:00:00.000Z' })
  const floorId = Object.keys(initial.floors)[0], layerId = Object.keys(initial.userLayers)[0]
  const runtime = { ids: { nextId: (() => { let id = 0; return () => `fixture-id-${++id}` })() }, clock: { now: () => initial.updatedAt } }
  const scene = applyCommands(initial, [
    { type: 'createRoom', id: 'secret-room', floorId, layerId, purpose: '私密客房', thicknessMm: 100, boundaryMm: [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 6000 }, { x: 2000, y: 6000 }] },
  ], runtime)
  // A validated draft needs no required-access declaration or external entrance.
  const withNotes = applyCommands(scene, [
    { type: 'updateRoom', id: 'secret-room', changes: { visibility: 'gm' } },
    { type: 'upsertManualMask', id: 'mask', floorId, layerId, boundsMm: { x: 0, y: 0, width: 10000, height: 8000 } },
    { type: 'createNote', id: 'room-label', floorId, layerId, anchor: { type: 'entity', entityKind: 'room', entityId: 'secret-room' }, kind: 'label', text: '房间文字', visibility: 'public' },
    { type: 'createNote', id: 'mask-label', floorId, layerId, anchor: { type: 'point', positionMm: { x: 3000, y: 4000 } }, kind: 'label', text: '遮罩文字', visibility: 'public' },
    { type: 'createNote', id: 'public-label', floorId, layerId, anchor: { type: 'point', positionMm: { x: 14000, y: 11000 } }, kind: 'label', text: '公开文字', visibility: 'public' },
    { type: 'createNote', id: 'gm-parent', floorId, layerId, anchor: { type: 'point', positionMm: { x: 14000, y: 11000 } }, kind: 'note', text: 'GM正文', visibility: 'gm' },
    { type: 'createNote', id: 'recursive-label', floorId, layerId, anchor: { type: 'entity', entityKind: 'note', entityId: 'gm-parent' }, kind: 'label', text: '递归文字', visibility: 'public' },
  ], runtime)
  return { scene: withNotes, floorId, layerId, runtime }
}

describe('GM note feedback from the actual player projection', () => {
  it('reports hidden room, masked coordinate and recursive private parent without claiming public or GM-only notes conflict', () => {
    const { scene, floorId } = fixture(), before = JSON.stringify(scene)
    expect(notePrivacySummary(scene, floorId)).toEqual({ hidden: [
      { id: 'mask-label', label: '遮罩文字' }, { id: 'recursive-label', label: '递归文字' }, { id: 'room-label', label: '房间文字' },
    ] })
    expect(JSON.stringify(scene)).toBe(before)
  })
  it('rechecks the actual changed anchor instead of keeping a stale conflict', () => {
    const { scene, floorId, runtime } = fixture()
    const changed = applyCommands(scene, [{ type: 'updateNote', id: 'mask-label', changes: { anchor: { type: 'point', positionMm: { x: 14000, y: 10000 } } } }], runtime)
    expect(notePrivacySummary(changed, floorId).hidden.map(note => note.id)).toEqual(['recursive-label', 'room-label'])
    expect(notePrivacySummary(scene, floorId).hidden).toHaveLength(3)
  })
  it('uses only the explicit Floor, including overlapping note coordinates', () => {
    const { scene, floorId, layerId } = fixture(), other = structuredClone(scene), upper = 'upper-floor', upperLayer = 'upper-layer'
    const output = resolveFloorOutput(scene, floorId)
    other.floors[floorId].outputBoundsMm = structuredClone(output.boundsMm)
    other.floors[floorId].environment = structuredClone(output.environment)
    other.floors[upper] = { ...structuredClone(other.floors[floorId]), id: upper, name: '上层' }
    other.userLayers[upperLayer] = { ...other.userLayers[layerId], id: upperLayer, floorId: upper }
    other.notes['upper-label'] = { ...other.notes['mask-label'], id: 'upper-label', floorId: upper }
    other.entityLayers['upper-label'] = upperLayer
    expect(notePrivacySummary(other, upper)).toEqual({ hidden: [] })
    expect(notePrivacySummary(other, floorId).hidden).toHaveLength(3)
  })
  it('reports inability to check when privacy validation fails, without guessing which notes were removed', () => {
    const { scene, floorId } = fixture(), unsafe = structuredClone(scene)
    delete unsafe.regions.mask; delete unsafe.entityLayers.mask
    const result = notePrivacySummary(unsafe, floorId)
    expect(result.hidden).toEqual([]); expect(result.outputError).toContain('固定遮罩未覆盖')
  })
  it('does not manufacture a public-note warning when the Floor has only GM notes', () => {
    const { scene, floorId } = fixture(), privateOnly = structuredClone(scene)
    for (const note of Object.values(privateOnly.notes)) note.visibility = 'gm'
    expect(notePrivacySummary(privateOnly, floorId)).toEqual({ hidden: [] })
  })
})
