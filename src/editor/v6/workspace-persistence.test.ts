import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { SceneRepositoryV6 } from '../../io/v6/storage'
import { outdoorProject } from '../../io/v6/test-fixtures'
import { WorkspaceV6 } from './workspace'

const repositories: SceneRepositoryV6[] = [], names: string[] = []
afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('V6 outdoor workspace persistence', () => {
  it('persists, restores and reopens terrain with exact named and protection history', async () => {
    const name = `outdoor-workspace-${crypto.randomUUID()}`, repository = new SceneRepositoryV6(name)
    repositories.push(repository); names.push(name)
    const input = await outdoorProject(1), workspace = new WorkspaceV6(repository)
    await workspace.adoptNew(input)
    const source = await workspace.createNamedSnapshot('原始地形')
    await workspace.execute([{ type: 'setTerrainElevation', id: 'domain', groundElevationMm: 300 }])
    await workspace.flush()

    const preview = await workspace.prepareRestore(source.id, { ids: ['domain'], mode: 'outdoorGeometry' })
    const protection = await workspace.applyRestore(preview)
    expect(protection.sourceRevision).toBe(1)
    expect(protection.project.document.terrainAreas.domain.groundElevationMm).toBe(300)
    expect(workspace.getState().project).toMatchObject({ document: { revision: 2, terrainAreas: { domain: { groundElevationMm: 0 } } } })
    await workspace.flush()

    const reopened = new SceneRepositoryV6(name); repositories.push(reopened)
    const loaded = (await reopened.load(input.document.sceneId))!
    expect(loaded.document.revision).toBe(2)
    expect(loaded.document.terrainAreas.domain.groundElevationMm).toBe(0)
    expect(loaded.historyIdentity).toEqual(workspace.getState().project!.historyIdentity)
    expect((await reopened.loadNamedSnapshot(source.id))!.project.document.terrainAreas.domain.groundElevationMm).toBe(0)
    expect((await reopened.loadNamedSnapshot(protection.id))!.project.document.terrainAreas.domain.groundElevationMm).toBe(300)
    expect(await reopened.usage(input.document.sceneId)).toMatchObject({ metadataVersion: 2, namedCount: 1, protectionCount: 1 })

    workspace.undo(); await workspace.flush()
    const afterUndo = (await reopened.load(input.document.sceneId))!
    expect(afterUndo.document.revision).toBe(3)
    expect(afterUndo.document.terrainAreas.domain.groundElevationMm).toBe(300)
    expect(afterUndo.historyIdentity.outdoorTokens.domain.topologyToken).toBe(loaded.historyIdentity.outdoorTokens.domain.topologyToken)
  }, 40_000)
})
