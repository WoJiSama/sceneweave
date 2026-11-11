import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { applyCommands } from '../../shared/commands/commands.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { resolveBuildingStructurePort } from '../../shared/generation/building-port.js'
import { projectScene } from '../../shared/projection/projection.js'
import { validateCompositionContent } from '../../shared/validation/content.js'
import { cloneJson } from '../../shared/validation/json.js'
import { fromBundle, toBundle } from './project.js'
import { Workspace } from './workspace.js'
import { fixture, runtime, validation } from './test-fixtures.js'

const sessions: Workspace[] = [], repos: ProjectRepository[] = [], names: string[] = []
const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
async function setup(building = false) {
  const bundle = fixture({ image: true })
  if (building) {
    bundle.project.document.props.item.positionMm = p(2000, 2000)
    bundle.project.document.props.other.positionMm = p(3000, 3000)
    let document = applyCommands(bundle.project.document, [
      { type: 'createTerrainArea', id: 'yard', floorId: 'blank-floor', boundaryMm: rect(6000, 3000, 12000, 14000), groundElevationMm: 0, coveragePriority: 0 },
      { type: 'createRoom', id: 'hut', floorId: 'blank-floor', boundaryMm: rect(8000, 8000, 4000, 4000), thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'yard' } },
    ], runtime)
    const wall = Object.values(document.walls).find(w => document.vertices[w.startVertexId].yMm === 8000 && document.vertices[w.endVertexId].yMm === 8000)!
    document = applyCommands(document, [{ type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1400, widthMm: 1200, kind: 'door', state: 'closed', locked: true }], runtime)
    const port = resolveBuildingStructurePort(document, 'door', 1000)
    document = applyCommands(document, [{ type: 'createPath', id: 'road', floorId: 'blank-floor', centerlineMm: [port.outsideMm, p(port.outsideMm.x, 5000), p(15000, 5000)], widthMm: 1000, supportRefs: [port.supportRef] }], runtime)
    Object.assign(bundle.project, createCompositionContent(document, runtime))
  }
  const name = `general-tools-${crypto.randomUUID()}`, repo = new ProjectRepository({ name, runtime, validation })
  repos.push(repo); names.push(name)
  const workspace = new Workspace(repo, { runtime, validation }), project = await fromBundle(bundle, validation)
  sessions.push(workspace); await workspace.adoptNew(project)
  return { workspace, repo, project }
}
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('ordinary multi-Floor and persisted door/path workspace lifecycle', () => {
  it('creates an independent layer, saves all Floors, isolates output and undoes/redoes without reusing Floor continuity', async () => {
    const { workspace, repo, project } = await setup()
    const before = cloneJson(project.document), boundsMm = { x: 0, y: 0, width: 12000, height: 15000 }
    await workspace.execute([{ type: 'createFloor', id: 'upstairs', name: '阁楼', boundsMm, outputBoundsMm: boundsMm, newLayerId: 'upstairs-layer', layerName: '阁楼地面' }])
    const created = workspace.getState().project!, birth = created.historyIdentity.structureTokens!.upstairs.token
    expect(created.document.floors['blank-floor'].outputBoundsMm).toEqual(before.exportBoundsMm)
    expect(created.document.props).toEqual(before.props)
    expect(projectScene(created.document, 'gm', created.appearance, { floorId: 'upstairs' }).props).toEqual([])
    expect(() => projectScene(created.document, 'gm')).toThrow(/明确/)
    await workspace.execute([{ type: 'setFloorEnvironment', id: 'upstairs', environment: { ambientColor: '#AABBCC', ambientOpacity: .2, exposure: .9, lightDirectionDeg: 90, contactShadowMm: 120, contactShadowOpacity: .2 } }])
    expect(projectScene(workspace.getDocument()!, 'player', undefined, { floorId: 'upstairs' }).visual!.environment.ambientColor).toBe('#AABBCC')
    await workspace.flush()
    const cold = (await repo.load(created.document.sceneId))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    workspace.undo(); workspace.undo()
    expect(workspace.getDocument()!.floors.upstairs).toBeUndefined()
    workspace.redo()
    const reborn = workspace.getState().project!.historyIdentity.structureTokens!.upstairs
    expect(reborn.token).toBe(birth)
    expect(reborn.topologyToken).not.toBe(created.historyIdentity.structureTokens!.upstairs.topologyToken)
    await workspace.flush()
    await expect(workspace.execute([{ type: 'createFloor', id: 'upstairs', name: '复用', boundsMm, outputBoundsMm: boundsMm, newLayerId: 'new-layer', layerName: '层' }])).rejects.toThrow(/身份|ID|占用/)
  })

  it('binds a closed locked real door, follows opening movement atomically, preserves tail and survives undo/redo/cold reads', async () => {
    const { workspace, repo, project } = await setup(true)
    const before = cloneJson(project.document.paths.road.centerlineMm)
    await workspace.execute([{ type: 'bindPathAttachment', id: 'door-road-link', pathId: 'road', openingId: 'door', end: 'start', leadLengthMm: 1000, maxDisplacementMm: 1000 }])
    const bound = workspace.getState().project!, row = bound.document.pathAttachments!['door-road-link']
    expect(bound.document.paths.road.centerlineMm.slice(2)).toEqual(before.slice(1))
    expect(bound.document.openings.door).toMatchObject({ state: 'closed', locked: true })
    await workspace.execute([{ type: 'updateOpening', id: 'door', changes: { offsetMm: 1600 } }])
    const moved = workspace.getState().project!
    expect(moved.document.paths.road.centerlineMm.slice(2)).toEqual(bound.document.paths.road.centerlineMm.slice(2))
    expect(moved.document.paths.road.centerlineMm[0].x).toBe(bound.document.paths.road.centerlineMm[0].x + 200)
    expect(moved.document.pathAttachments!['door-road-link'].proofs).toEqual(row.proofs)
    await workspace.flush()
    expect((await repo.load(project.document.sceneId))!.project.document).toEqual(moved.document)
    workspace.undo(); expect(workspace.getDocument()!.paths.road).toEqual(bound.document.paths.road)
    workspace.redo(); expect(workspace.getDocument()!.paths.road).toEqual(moved.document.paths.road)
    const snapshot = workspace.getState().project!, checkpoint = workspace.checkpoint()
    await expect(workspace.execute([{ type: 'reverseWall', id: snapshot.document.openings.door.wallId }])).rejects.toThrow(/拓扑|接续|门口/)
    expect(workspace.checkpoint()).toBe(checkpoint)
    const fake = cloneJson({ document: snapshot.document, historyIdentity: snapshot.historyIdentity, appearance: snapshot.appearance })
    fake.document.pathAttachments!['door-road-link'].proofs.opening.birthToken = 'forged-birth'
    expect(() => validateCompositionContent(fake)).toThrow(/出生|token|lineage/)
    await workspace.execute([{ type: 'detachPathAttachment', id: 'door-road-link' }])
    expect(workspace.getDocument()!.pathAttachments!['door-road-link']).toBeUndefined()
    workspace.undo()
    expect(workspace.getDocument()!.pathAttachments!['door-road-link']).toBeDefined()
    await workspace.flush()
    await expect(fromBundle(toBundle(workspace.getState().project!), validation)).resolves.toBeDefined()
  })
})
