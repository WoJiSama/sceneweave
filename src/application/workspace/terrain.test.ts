import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from './workspace.js'
import { fromBundle, toBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { projectContentHash, validateProjectData } from '../../shared/project/validate.js'
import { cloneJson } from '../../shared/validation/json.js'

const repos:ProjectRepository[]=[], sessions:Workspace[]=[]
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function setup(sourceVersion: 2 | 3 = 2) {
  const repo=new ProjectRepository({name:`terrain-workspace-${crypto.randomUUID()}`,runtime,validation});repos.push(repo)
  const workspace=new Workspace(repo,{runtime,validation});sessions.push(workspace)
  const source=await fromBundle(fixture({image:true}),validation)
  await workspace.adoptNew(source);
  return {repo,workspace}
}
afterEach(async()=>{
  for(const workspace of sessions.splice(0))await workspace.close().catch(()=>{})
  vi.restoreAllMocks()
  for(const repo of repos.splice(0)){const name=repo.database.name;repo.close();await Dexie.delete(name)}
})
describe('terrain complete3 boundaries and independent upgrade',()=>{
  it('keeps empty v3 strict through complete package, identity2 and appearance2',async()=>{
    const {workspace}=await setup(),source=workspace.getState().project!,document=emptyTerrainDocument(source.document)
    document.sceneId=runtime.ids.nextId()
    const project={...toBundle(source).project,schemaVersion:1 as const,...createCompositionContent(document,runtime)}
    const bundle={project,resources:source.resources},encoded=await exportProject(bundle,validation),cold=await importProject(encoded,validation)
    expect(cold.project.schemaVersion).toBe(1);expect(cold.project.document.visual).toMatchObject({version:3,base:{version:2,base:{version:1},materializedEdges:{}},transitions:{}})
    expect(cold.project.historyIdentity.version).toBe(5);expect(cold.project.appearance.version).toBe(2)
    expect(projectContentHash(cold.project)).toBe(projectContentHash(project))
    expect(()=>validateProjectData({...project,schemaVersion:2})).toThrow()
    expect(()=>validateProjectData({...project,historyIdentity:{...source.historyIdentity,version:1}})).toThrow()
    expect(()=>validateProjectData({...project,appearance:{...source.appearance,version:1}})).toThrow()
    const legacy=cloneJson(toBundle(source).project)
    Object.assign(legacy.document,{generation:document.generation.legacy})
    expect(()=>validateProjectData(legacy)).toThrow()
  })





  it('keeps visual v2 wrapper and generation through manual move, undo, redo and cold save',async()=>{
    const {repo,workspace}=await setup();
    await workspace.updateProp('item',{rotationDeg:33})
    expect(workspace.getDocument()!.visual).toEqual({version:3,base:{version:2,base:emptyVisualSystem(),materializedEdges:{}},transitions:{}})
    workspace.undo();expect(workspace.getDocument()!.props.item.rotationDeg).toBe(0)
    workspace.redo();await workspace.flush()
    const current=workspace.getState().project!,cold=await repo.load(current.document.sceneId)
    expect(cold!.project.document.props.item.rotationDeg).toBe(33)
    expect(cold!.project.document.generation).toEqual(current.document.generation)
    expect(cold!.project.historyIdentity.version).toBe(5)
  })
})
