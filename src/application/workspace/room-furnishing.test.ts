import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { planRoomFurnishing } from '../../shared/furnishing/plan.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace } from './workspace.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { canonicalJson } from '../../shared/validation/json.js'
import { projectScene } from '../../shared/projection/projection.js'
import { prepareCompositionCommands } from './prepare.js'
import { loadSceneTemplate, prepareSceneTemplate } from '../../shared/scene-templates/content.js'

const options = { runtime, validation }
function source() {
  const input = fixture({ building: true, image: true }), doc = input.project.document
  Object.assign(doc.props.item, { roomId: 'room', supportRef: { kind: 'room', id: 'room' }, editLocked: true })
  doc.props.other.positionMm = { x: 16000, y: 16000 }
  Object.assign(input.project, createCompositionContent(doc, runtime))
  return input
}
function request(layerId: string, count = 2) {
  return { roomId: 'room', layerId, purpose: '储藏间', variation: 'real-existing-room', functions: [{ role: 'storage', count, definitionRef: { id: 'definition', version: 1 } }], movableIds: [], restoreDeletedKeys: [] }
}
describe('ordinary furnishing of actual existing rooms', () => {
  it('preserves locked/manual content, previews atomically, remembers deletions after cold read, restores only explicitly and does not leak advisory memory', async () => {
    const repository = new ProjectRepository({ name: `furnishing-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    try {
      await workspace.adoptNew(await fromBundle(source(), validation))
      const before = workspace.getState().project!, raw = request(before.document.entityLayers.item)
      const result = planRoomFurnishing(before.document, raw, runtime)
      expect(result.addedIds).toHaveLength(1)
      const cancelled = await workspace.preview(result.commands)
      workspace.cancelPreview(cancelled)
      expect(workspace.getState().project).toBe(before)
      await workspace.adoptPreview(await workspace.preview(result.commands))
      const adopted = workspace.getState().project!
      expect(adopted.document.props.item).toEqual(before.document.props.item)
      expect(adopted.document.rooms.room.purpose).toBe(before.document.rooms.room.purpose)
      expect(adopted.document.rooms.room.furnishingPlan!.purpose).toBe('储藏间')
      expect(canonicalJson(projectScene(adopted.document, 'player'))).not.toContain('room-furnishing')
      workspace.undo(); expect(workspace.getState().project!.document.rooms.room.furnishingPlan).toBeUndefined()
      workspace.redo(); await workspace.flush()
      const cold = await repository.load(adopted.document.sceneId)
      expect(cold!.project.document.rooms.room.furnishingPlan).toEqual(adopted.document.rooms.room.furnishingPlan)
      await workspace.execute([{ type: 'deleteProp', id: result.addedIds[0] }]); await workspace.flush()
      const deleted = await fromBundle((await repository.load(adopted.document.sceneId))!, validation)
      const next = planRoomFurnishing(deleted.document, raw, runtime)
      expect(next.addedIds).toEqual([]); expect(next.notes.join(' ')).toContain('人工删除')
      const key = deleted.document.rooms.room.furnishingPlan!.slots.find(slot => slot.propId === result.addedIds[0])!.key
      const restored = planRoomFurnishing(deleted.document, { ...raw, restoreDeletedKeys: [key] }, runtime)
      expect(restored.addedIds).toHaveLength(1); expect(restored.addedIds[0]).not.toBe(result.addedIds[0])
      const stale = await workspace.preview(restored.commands)
      await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 14 } }])
      await expect(workspace.adoptPreview(stale)).rejects.toThrow()
    } finally { await workspace.close(); const name = repository.database.name; repository.close(); await Dexie.delete(name) }
  })
  it('requires explicit movement permission and strips advisory memory from reusable actual-content templates', async () => {
    let project = await fromBundle(source(), validation)
    const raw = request(project.document.entityLayers.item)
    expect(() => planRoomFurnishing(project.document, { ...raw, movableIds: ['item'] }, runtime)).toThrow(/锁/)
    const plan = planRoomFurnishing(project.document, raw, runtime)
    project = await prepareCompositionCommands(project, plan.commands, options)
    project = await prepareCompositionCommands(project, [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: false }], options)
    const entry = await prepareSceneTemplate(toBundle(project), { name: '实际布置', roomIds: ['room'] }, options)
    const loaded = await loadSceneTemplate(entry.bytes, validation)
    expect(Object.values(loaded.project.document.rooms)[0].furnishingPlan).toBeUndefined()
    expect(Object.keys(loaded.project.document.props)).toHaveLength(2)
    expect(() => planRoomFurnishing(project.document, { ...raw, restoreDeletedKeys: ['storage:0'] }, runtime)).toThrow(/删除记录/)
    expect(() => planRoomFurnishing(project.document, raw, runtime, () => { throw new Error('cancelled') })).toThrow('cancelled')
  })
  it('moves only explicitly named independent furniture, preserving its full appearance and pose fields, and keeps locked doors unchanged', async () => {
    let project = await fromBundle(source(), validation)
    project = await prepareCompositionCommands(project, [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: false }], options)
    project = await prepareCompositionCommands(project, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 90 } },
      { type: 'addOpening', id: 'actual-door', wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 2300, widthMm: 1200, kind: 'door', state: 'closed', locked: true }], options)
    const original = project.document, raw = { ...request(original.entityLayers.item, 1), movableIds: ['item'] }
    const result = planRoomFurnishing(original, raw, runtime)
    expect(result.commands.filter(command => command.type === 'updateProp').every(command => Object.keys(command.changes).join() === 'positionMm')).toBe(true)
    const next = await prepareCompositionCommands(project, result.commands, options)
    expect({ ...next.document.props.item, positionMm: original.props.item.positionMm }).toEqual(original.props.item)
    expect(next.document.props.other).toEqual(original.props.other)
    expect(next.document.openings).toEqual(original.openings)
    expect(() => planRoomFurnishing(original, { ...raw, movableIds: ['other'] }, runtime)).toThrow(/本房间/)
  })
})
