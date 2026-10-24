import { describe, expect, it } from 'vitest'
import native from '../../platform/browser/content/scenes-data.json'
import { applyCommands } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { cloneJson } from '../../shared/validation/json'
import { selectedWallSurfaceIds } from './ai-wall-scope'

function fixture() {
  const scene = cloneJson(native.scenes.blank.document) as unknown as SceneDocument
  const context = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-10-25T12:00:00.000Z' } }
  return applyCommands(scene, [
    { type: 'createRoom', id: 'left', floorId: 'blank-floor', boundaryMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }], thicknessMm: 200 },
    { type: 'createRoom', id: 'right', floorId: 'blank-floor', boundaryMm: [{ x: 6000, y: 2000 }, { x: 10000, y: 2000 }, { x: 10000, y: 6000 }, { x: 6000, y: 6000 }], thicknessMm: 200 },
    { type: 'createNote', id: 'private-clue', floorId: 'blank-floor', anchor: { type: 'entity', entityKind: 'room', entityId: 'left' }, kind: 'clue', text: 'PRIVATE_GM_CLUE', visibility: 'gm' },
  ], context)
}

describe('AI material-only wall selection', () => {
  it('collects only real adjacent room boundary walls and endpoints, deduplicates a shared wall and leaves GM prose ungranted', () => {
    const scene = fixture(), before = JSON.stringify(scene)
    const ids = selectedWallSurfaceIds(scene, ['left', 'right', 'private-clue'])
    const walls = Object.keys(scene.walls), vertices = Object.keys(scene.vertices)
    expect(walls).toHaveLength(7); expect(vertices).toHaveLength(6)
    expect(ids).toEqual([...walls, ...vertices].sort()); expect(new Set(ids).size).toBe(13)
    expect(ids).not.toContain('left'); expect(ids).not.toContain('right'); expect(ids).not.toContain('private-clue')
    expect(JSON.stringify(scene)).toBe(before)
    const room = scene.rooms.left, source = Object.values(scene.walls).find(wall => wall.startVertexId === room.boundaryVertexIds[0])!
    const chord = { ...cloneJson(source), id: 'not-a-boundary-chord', startVertexId: room.boundaryVertexIds[0], endVertexId: room.boundaryVertexIds[2] }
    scene.walls[chord.id] = chord; scene.entityLayers[chord.id] = scene.entityLayers[source.id]
    expect(selectedWallSurfaceIds(scene, ['left'])).not.toContain(chord.id)
  })

  it('accepts a selected wall directly and returns no grant for an empty or non-structural selection', () => {
    const scene = fixture(), wall = scene.walls['left:wall:0']
    expect(selectedWallSurfaceIds(scene, [wall.id])).toEqual([wall.id, wall.startVertexId, wall.endVertexId].sort())
    expect(selectedWallSurfaceIds(scene, [])).toEqual([])
    expect(selectedWallSurfaceIds(scene, ['private-clue', 'missing'])).toEqual([])
  })

  it('does not collect private room boundaries or locked walls and requires public endpoints', () => {
    const scene = fixture(), wall = scene.walls['left:wall:0']
    scene.rooms.left.visibility = 'gm'
    expect(selectedWallSurfaceIds(scene, ['left'])).toEqual([])
    expect(selectedWallSurfaceIds(scene, [wall.id])).toEqual([])
    scene.rooms.left.visibility = 'public'; wall.editLocked = true
    expect(selectedWallSurfaceIds(scene, [wall.id])).toEqual([])
    wall.editLocked = false; scene.userLayers[scene.entityLayers[wall.id]].editLocked = true
    expect(selectedWallSurfaceIds(scene, [wall.id])).toEqual([])
    scene.userLayers[scene.entityLayers[wall.id]].editLocked = false
    const shared = Object.values(scene.walls).find(value => [value.startVertexId, value.endVertexId].every(id => scene.rooms.left.boundaryVertexIds.includes(id) && scene.rooms.right.boundaryVertexIds.includes(id)))!
    scene.rooms.right.visibility = 'gm'
    expect(selectedWallSurfaceIds(scene, [shared.id])).toEqual([])
  })
})
