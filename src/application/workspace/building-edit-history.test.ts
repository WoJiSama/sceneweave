import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { fromBundle } from './project.js'
import { prepareCompositionCommands } from './prepare.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'

const repositories: ProjectRepository[] = [], sessions: Workspace[] = [], names: string[] = []
async function setup() {
  const name = `building-history-${crypto.randomUUID()}`, repository = new ProjectRepository({ name, runtime, validation })
  repositories.push(repository); names.push(name)
  const workspace = new Workspace(repository, { runtime, validation })
  sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(fixture({ building: true }), validation))
  return workspace
}
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  for (const repository of repositories.splice(0)) repository.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('building edit structure history', () => {
  it('traces each repaired intermediate topology even when the final document is equal', async () => {
    const workspace = await setup(), source = workspace.getState().project!, invalidated = new Set<string>()
    const commands: CompositionCommand[] = [
      { type: 'splitWall', id: 'wall-0', newVertexId: 'temporary-junction', newWallId: 'zz-temporary-wall', positionMm: { x: 6500, y: 3000 } },
      { type: 'repairBuildingTopology', id: 'wall-0', operation: 'mergeCollinear' },
    ]
    const candidate = await prepareCompositionCommands(source, commands, { runtime, validation,
      onStructureInvalidations: ids => { for (const id of ids) invalidated.add(id) } })
    expect(candidate.document).toEqual(source.document)
    expect([...invalidated]).toEqual(expect.arrayContaining(['room', 'wall-0', 'temporary-junction', 'zz-temporary-wall']))
    expect(workspace.getState().project).toBe(source)
  })

  it.each(['execute', 'preview'] as const)('keeps repair invalidations through %s and undo after split then merge returns equal geometry', async method => {
    const workspace = await setup(), source = workspace.getDocument()!, snapshot = await workspace.createNamedSnapshot('before repaired edit')
    const commands: CompositionCommand[] = [
      { type: 'splitWall', id: 'wall-0', newVertexId: 'temporary-junction', newWallId: 'zz-temporary-wall', positionMm: { x: 6500, y: 3000 } },
      { type: 'repairBuildingTopology', id: 'wall-0', operation: 'mergeCollinear' },
    ]
    if (method === 'execute') await workspace.execute(commands)
    else await workspace.adoptPreview(await workspace.preview(commands))
    expect(workspace.getDocument()).toMatchObject({ revision: 1, rooms: source.rooms, walls: source.walls, vertices: source.vertices })
    await expect(workspace.inspectStructureRestore(snapshot.id, { ids: ['room'], mode: 'geometry' })).rejects.toThrow(/改变拓扑/)
    workspace.undo()
    expect(workspace.getDocument()!.revision).toBe(2)
    await expect(workspace.inspectStructureRestore(snapshot.id, { ids: ['room'], mode: 'geometry' })).rejects.toThrow(/改变拓扑/)
  })

  it('does not restore a pre-delete structural witness after undo restores the room', async () => {
    const workspace = await setup(), snapshot = await workspace.createNamedSnapshot('before room deletion')
    await workspace.execute([{ type: 'deleteRoom', id: 'room', removeOrphanWalls: true }])
    expect(workspace.getDocument()).toMatchObject({ revision: 1, rooms: {} })

    workspace.undo()
    expect(workspace.getDocument()).toMatchObject({ revision: 2, rooms: { room: { id: 'room' } } })
    await expect(workspace.inspectStructureRestore(snapshot.id, { ids: ['room'], mode: 'geometry' })).rejects.toThrow(/改变拓扑/)
  })

  it('rejects deleting and recreating the same room identity within one transaction', async () => {
    const workspace = await setup(), before = workspace.getState().project!
    await expect(workspace.execute([
      { type: 'deleteRoom', id: 'room', removeOrphanWalls: true },
      { type: 'createRoom', id: 'room', floorId: 'blank-floor', thicknessMm: 200,
        boundaryMm: [{ x: 3000, y: 3000 }, { x: 10000, y: 3000 }, { x: 10000, y: 10000 }, { x: 3000, y: 10000 }] },
    ])).rejects.toThrow(/同一事务不能删除后重建同一结构 ID/)
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getDocument()).toMatchObject({ revision: 0, rooms: { room: { id: 'room' } } })
  })

  it('keeps revision and undo state unchanged when topology repair has no applicable change', async () => {
    const workspace = await setup(), before = workspace.getState().project!
    await expect(workspace.execute([{ type: 'repairBuildingTopology', id: 'wall-0', operation: 'mergeCollinear' }])).rejects.toThrow(/没有可无损合并/)
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getDocument()).toMatchObject({ revision: 0 })
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: false })
  })
})
