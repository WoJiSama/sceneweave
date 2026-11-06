import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import { Workspace } from './workspace.js'
import { fromBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const sessions: Workspace[] = [], repositories: ProjectRepository[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
})
async function setup() {
  const repository = new ProjectRepository({ name: `manual-budget-${crypto.randomUUID()}`, runtime, validation })
  repositories.push(repository)
  const workspace = new Workspace(repository, { runtime, validation }), project = await fromBundle(fixture({ image: true }), validation)
  sessions.push(workspace); await workspace.adoptNew(project)
  return { workspace, repository, project, floorId: 'blank-floor', layerId: project.document.entityLayers.item }
}
const points = (dy = 0) => Array.from({ length: 200 }, (_, index) => ({ x: 1000 + index * 40, y: 1000 + index % 2 * 20 + dy }))

describe('ordinary workspace budget integration', () => {
  it('previews a detailed path without writes, then adopts, undoes and cold-loads its complete geometry', async () => {
    const { workspace, repository, project, floorId, layerId } = await setup()
    const preview = await workspace.preview([{ type: 'createPath', id: 'detailed-path', floorId, layerId, centerlineMm: points(), widthMm: 400, supportRefs: [{ kind: 'floor', id: floorId }] }])
    expect(preview.budgetUsage).toMatchObject({ semanticTargets: 1, geometryPoints: 200 })
    expect(workspace.getState().project).toBe(project)
    expect((await repository.load(project.document.sceneId))!.project.document.paths).toEqual({})
    await workspace.adoptPreview(preview); await workspace.flush()
    expect(workspace.getDocument()!.revision).toBe(1)
    expect((await repository.load(project.document.sceneId))!.project.document.paths['detailed-path'].centerlineMm).toEqual(points())
    workspace.undo(); await workspace.flush(); expect(workspace.getDocument()!.paths).toEqual({})
    workspace.redo(); await workspace.flush(); expect(workspace.getDocument()!.paths['detailed-path'].centerlineMm).toEqual(points())
  })

  it('rejects cumulative geometry work even when all commands edit the same object', async () => {
    const { workspace, repository, project, floorId, layerId } = await setup()
    await workspace.execute([{ type: 'createPath', id: 'path', floorId, layerId, centerlineMm: points(), widthMm: 400, supportRefs: [{ kind: 'floor', id: floorId }] }]); await workspace.flush()
    const before = workspace.getState().project!
    const commands: CompositionCommand[] = Array.from({ length: 21 }, (_, index) => ({ type: 'updatePath', id: 'path', changes: { centerlineMm: points(index + 1) } }))
    await expect(workspace.preview(commands)).rejects.toThrow(/geometryPoints/)
    expect(workspace.getState().project).toBe(before)
    expect((await repository.load(project.document.sceneId))!.project.document.paths.path.centerlineMm).toEqual(points())
  })

  it('keeps cancelled and stale manual candidates from installing', async () => {
    const { workspace, project } = await setup()
    const cancelled = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 25 } }])
    workspace.cancelPreview(cancelled)
    await expect(workspace.adoptPreview(cancelled)).rejects.toThrow(/不可重复采用/)
    const stale = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 25 } }])
    await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 15 } }])
    await expect(workspace.adoptPreview(stale)).rejects.toThrow(/重新预览/)
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(project.document.props.item.rotationDeg)
    expect(workspace.getDocument()!.props.other.rotationDeg).toBe(15)
  })
})
