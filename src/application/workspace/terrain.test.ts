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
  await workspace.adoptNew(source);await workspace.enableVisualCopy()
  if(sourceVersion===3)await workspace.enableTerrainCopy()
  return {repo,workspace}
}
const upgradeCopy=(workspace:Workspace,sourceVersion:2|3)=>sourceVersion===3?workspace.enableCompositionCopy():workspace.enableTerrainCopy()
afterEach(async()=>{
  for(const workspace of sessions.splice(0))await workspace.close().catch(()=>{})
  vi.restoreAllMocks()
  for(const repo of repos.splice(0)){const name=repo.database.name;repo.close();await Dexie.delete(name)}
})
describe('terrain complete3 boundaries and independent upgrade',()=>{
  it('keeps empty v3 strict through complete package, identity2 and appearance2',async()=>{
    const {workspace}=await setup(),source=workspace.getState().project!,document=emptyTerrainDocument(source.document)
    document.sceneId=runtime.ids.nextId()
    const project={...toBundle(source).project,schemaVersion:3 as const,...createCompositionContent(document,runtime)}
    const bundle={project,resources:source.resources},encoded=await exportProject(bundle,validation),cold=await importProject(encoded,validation)
    expect(cold.project.schemaVersion).toBe(3);expect(cold.project.document.visual).toMatchObject({version:2,base:{version:1},materializedEdges:{}})
    expect(cold.project.historyIdentity.version).toBe(2);expect(cold.project.appearance.version).toBe(2)
    expect(projectContentHash(cold.project)).toBe(projectContentHash(project))
    expect(()=>validateProjectData({...project,schemaVersion:2})).toThrow()
    expect(()=>validateProjectData({...project,historyIdentity:source.historyIdentity})).toThrow()
    expect(()=>validateProjectData({...project,appearance:source.appearance})).toThrow()
    const legacy=cloneJson(toBundle(source).project)
    Object.assign(legacy.document,{generation:document.generation})
    expect(()=>validateProjectData(legacy)).toThrow()
  })
  it.each([2,3] as const)('upgrades an independent strict v%s copy after full source preservation and real cold read',async(sourceVersion)=>{
    const {repo,workspace}=await setup(sourceVersion),source=workspace.getState().project!,sourceId=source.document.sceneId
    await workspace.execute([{type:'updateProp',id:'item',changes:{rotationDeg:17}}]);await workspace.flush()
    const snapshot=await workspace.createNamedSnapshot('before terrain')
    const originalHash=projectContentHash(toBundle(workspace.getState().project!).project)
    const saving=vi.spyOn(repo,'save'),loading=vi.spyOn(repo,'load')
    await upgradeCopy(workspace,sourceVersion)
    expect(saving).toHaveBeenCalledTimes(1);expect(loading).toHaveBeenCalledTimes(1)
    const target=workspace.getState().project!
    expect(target.schemaVersion).toBe(sourceVersion+1);expect(target.document.sceneId).not.toBe(sourceId)
    expect(target.historyIdentity.lineageId).not.toBe(source.historyIdentity.lineageId)
    expect(target.document.props.item.rotationDeg).toBe(17)
    expect(projectContentHash((await repo.load(sourceId))!.project)).toBe(originalHash)
    expect(await repo.loadSnapshot(sourceId,snapshot.id)).not.toBeNull()
    expect((await repo.load(target.document.sceneId))!.project).toEqual(toBundle(target).project)
    const active=workspace.getState().project;await workspace.enableTerrainCopy();expect(workspace.getState().project).toBe(active)
  })
  it.each([2,3] as const)('does not switch strict v%s current project if target save fails after preservation',async(sourceVersion)=>{
    const {repo,workspace}=await setup(sourceVersion),before=workspace.getState().project!,checkpoint=workspace.checkpoint()
    const saving=vi.spyOn(repo,'save').mockRejectedValueOnce(new Error('target quota')),loading=vi.spyOn(repo,'load')
    await expect(upgradeCopy(workspace,sourceVersion)).rejects.toThrow(/quota/)
    expect(saving).toHaveBeenCalledTimes(1);expect(loading).not.toHaveBeenCalled()
    expect(workspace.getState().project).toBe(before);expect(workspace.checkpoint()).toBe(checkpoint)
    expect((await repo.load(before.document.sceneId))!.project.schemaVersion).toBe(sourceVersion)
  })
  it.each([[2,'preserve'],[2,'save'],[3,'preserve'],[3,'save']] as const)('rejects manual edits and close while strict v%s upgrade %s awaits',async(sourceVersion,stage)=>{
    const {repo,workspace}=await setup(sourceVersion),before=workspace.getState().project!,checkpoint=workspace.checkpoint()
    const entered=deferred(),release=deferred()
    if(stage==='preserve') {
      const preserving=repo.preserveNativeUpgrade.bind(repo)
      vi.spyOn(repo,'preserveNativeUpgrade').mockImplementationOnce(async(source,target,options)=>{
        await preserving(source,target,options);entered.resolve();await release.promise
      })
    } else {
      const saving=repo.save.bind(repo)
      vi.spyOn(repo,'save').mockImplementationOnce(async(bundle,expected,options)=>{
        await saving(bundle,expected,options);entered.resolve();await release.promise
      })
    }
    const upgrading=upgradeCopy(workspace,sourceVersion)
    await entered.promise
    try {
      await expect(workspace.updateProp('item',{rotationDeg:31})).rejects.toThrow(/请稍后重试/)
      await expect(workspace.close()).rejects.toThrow(/请稍后重试/)
      expect(()=>workspace.undo()).toThrow(/请稍后重试/)
      expect(workspace.getState().project).toBe(before)
      expect(workspace.checkpoint()).toBe(checkpoint)
      expect(workspace.getDocument()!.props.item.rotationDeg).toBe(0)
    } finally {release.resolve();await upgrading}
    expect(workspace.getState().project!.schemaVersion).toBe(sourceVersion+1)
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(0)
    await workspace.updateProp('item',{rotationDeg:37});await workspace.flush()
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(37)
  })
  it.each([2,3] as const)('rejects a valid strict v%s upgraded cold-read target whose complete content changed before installation',async(sourceVersion)=>{
    const {repo,workspace}=await setup(sourceVersion),before=workspace.getState().project!,checkpoint=workspace.checkpoint(),loading=repo.load.bind(repo)
    let targetId=''
    vi.spyOn(repo,'load').mockImplementationOnce(async(sceneId,options)=>{
      targetId=sceneId
      const cold=await loading(sceneId,options)
      if(!cold)throw new Error('Expected the real target save before this cold read')
      const changed=cloneJson(cold.project);changed.document.title+=' · external complete edit'
      expect(()=>validateProjectData(changed)).not.toThrow()
      expect(projectContentHash(changed)).not.toBe(projectContentHash(cold.project))
      return {project:changed,resources:cold.resources}
    })
    await expect(upgradeCopy(workspace,sourceVersion)).rejects.toThrow(/冷读前已改变/)
    expect(workspace.getState().project).toBe(before);expect(workspace.checkpoint()).toBe(checkpoint)
    expect((await loading(before.document.sceneId))!.project.schemaVersion).toBe(sourceVersion)
    // The target was actually saved; rejecting installation does not claim to roll back that independent result.
    expect((await loading(targetId))!.project.schemaVersion).toBe(sourceVersion+1)
    await workspace.updateProp('item',{rotationDeg:43});await workspace.flush()
    expect(workspace.getState().project!.document.sceneId).toBe(before.document.sceneId)
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(43)
  })
  it.each([2,3] as const)('keeps strict v%s source open on a null cold read while retaining an already-saved independent target',async(sourceVersion)=>{
    const {repo,workspace}=await setup(sourceVersion),before=workspace.getState().project!,checkpoint=workspace.checkpoint(),loading=repo.load.bind(repo)
    let targetId=''
    vi.spyOn(repo,'load').mockImplementationOnce(async sceneId=>{targetId=sceneId;return null})
    await expect(upgradeCopy(workspace,sourceVersion)).rejects.toThrow(/冷读失败/)
    expect(workspace.getState().project).toBe(before);expect(workspace.checkpoint()).toBe(checkpoint)
    expect((await loading(before.document.sceneId))!.project.schemaVersion).toBe(sourceVersion)
    expect((await loading(targetId))!.project.schemaVersion).toBe(sourceVersion+1)
    expect((await repo.exportNativeUpgradeCapsule(targetId)).capsule.sourceSceneId).toBe(before.document.sceneId)
    await workspace.updateProp('item',{rotationDeg:47});await workspace.flush()
    expect(workspace.getDocument()!.props.item.rotationDeg).toBe(47)
  })
  it('keeps visual v2 wrapper and generation through manual move, undo, redo and cold save',async()=>{
    const {repo,workspace}=await setup();await workspace.enableTerrainCopy()
    await workspace.updateProp('item',{rotationDeg:33})
    expect(workspace.getDocument()!.visual).toMatchObject({version:2,base:emptyVisualSystem()})
    workspace.undo();expect(workspace.getDocument()!.props.item.rotationDeg).toBe(0)
    workspace.redo();await workspace.flush()
    const current=workspace.getState().project!,cold=await repo.load(current.document.sceneId)
    expect(cold!.project.document.props.item.rotationDeg).toBe(33)
    expect(cold!.project.document.generation).toEqual(current.document.generation)
    expect(cold!.project.historyIdentity.version).toBe(2)
  })
})
