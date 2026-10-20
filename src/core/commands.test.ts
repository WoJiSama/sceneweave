import { describe, expect, it } from 'vitest'
import { SceneHistory } from './commands'
import { createHouse } from './seed'
import type { CommandBatch, Operation, TransactionResult } from './types'
import { openingEndpoints } from './geometry'

let sequence = 0
const batch = (history: SceneHistory, operations: Operation[], extra: Partial<CommandBatch> = {}): CommandBatch => ({batchId:`batch-${++sequence}`,sceneId:history.document.sceneId,baseRevision:history.document.revision,source:'manual',scope:{entityIds:null},operations,label:'测试编辑',...extra})
const codes = (result: TransactionResult): string[] => result.ok ? [] : result.errors.map(error => error.code)

describe('atomic command history', () => {
  it('commits a drag once and restores content with monotonically increasing undo/redo revisions', () => {
    const history = new SceneHistory(createHouse('test'))
    expect(history.execute(batch(history,[{type:'moveProp',id:'p-b2',positionMm:{x:5200,y:7800}}])).ok).toBe(true)
    expect(history.document.revision).toBe(1)
    expect(history.document.props['p-b2'].positionMm).toEqual({x:5200,y:7800})
    expect(history.undo().ok).toBe(true)
    expect(history.document.revision).toBe(2)
    expect(history.document.props['p-b2'].positionMm).toEqual({x:5000,y:7600})
    expect(history.redo().ok).toBe(true)
    expect(history.document.revision).toBe(3)
    expect(history.document.props['p-b2'].positionMm).toEqual({x:5200,y:7800})
  })
  it('does not apply the first successful operation when any later operation is invalid', () => {
    const history = new SceneHistory(createHouse())
    const before = structuredClone(history.document)
    const result = history.execute(batch(history,[{type:'moveProp',id:'p-b2',positionMm:{x:5200,y:7800}},{type:'moveOpening',id:'o-b2',offsetMm:6999}]))
    expect(codes(result)).toContain('OPENING_CLEARANCE')
    expect(history.document).toEqual(before)
    expect(history.canUndo).toBe(false)
  })
  it('checks the complete final candidate and permits coordinated shared-vertex movement', () => {
    const history = new SceneHistory(createHouse())
    const result = history.execute(batch(history,[{type:'moveVertices',positions:{'v-b2':{x:8200,y:4000},'v-e5':{x:8200,y:11000}}}]))
    expect(result.ok).toBe(true)
    expect(history.document.vertices['v-b2'].xMm).toBe(8200)
    expect(history.document.openings['o-b2'].wallId).toBe('w-6a')
    expect(openingEndpoints(history.document,history.document.openings['o-b2'])[0].x).toBe(8200)
    expect(result.ok && result.affectedIds).toEqual(expect.arrayContaining(['r-a1','r-b2','r-c3','w-6a','o-b2']))
  })
  it('rejects a single diagonal-creating vertex move atomically', () => {
    const history = new SceneHistory(createHouse())
    const result = history.execute(batch(history,[{type:'moveVertices',positions:{'v-b2':{x:8200,y:4100}}}]))
    expect(codes(result)).toContain('NON_ORTHOGONAL_WALL')
    expect(history.document.revision).toBe(0)
  })
  it('preserves door world endpoints when reversing a wall, including undo and redo', () => {
    const history = new SceneHistory(createHouse())
    const before = openingEndpoints(history.document,history.document.openings['o-b2'])
    expect(history.execute(batch(history,[{type:'reverseWall',id:'w-6a'}])).ok).toBe(true)
    expect(history.document.openings['o-b2'].offsetMm).toBe(2400)
    expect(openingEndpoints(history.document,history.document.openings['o-b2'])).toEqual([...before].reverse())
    expect(history.undo().ok).toBe(true)
    expect(openingEndpoints(history.document,history.document.openings['o-b2'])).toEqual(before)
    expect(history.redo().ok).toBe(true)
    expect(openingEndpoints(history.document,history.document.openings['o-b2'])).toEqual([...before].reverse())
  })
  it('splits a shared wall, remaps the attached door and both room rings, and reverses through history', () => {
    const history = new SceneHistory(createHouse())
    const before = openingEndpoints(history.document,history.document.openings['o-b2'])
    expect(history.execute(batch(history,[{type:'splitWall',id:'w-6a',atMm:2000,vertexId:'v-new',newWallId:'w-new'}])).ok).toBe(true)
    expect(history.document.rooms['r-a1'].boundaryVertexIds).toContain('v-new')
    expect(history.document.rooms['r-b2'].boundaryVertexIds).toContain('v-new')
    expect(history.document.openings['o-b2']).toMatchObject({wallId:'w-new',offsetMm:1500})
    expect(openingEndpoints(history.document,history.document.openings['o-b2'])).toEqual(before)
    expect(history.undo().ok).toBe(true)
    expect(history.document.walls['w-new']).toBeUndefined()
    expect(history.redo().ok).toBe(true)
    expect(openingEndpoints(history.document,history.document.openings['o-b2'])).toEqual(before)
  })
  it('rejects splitting through an opening or next to an opening without adequate end clearance', () => {
    const history = new SceneHistory(createHouse())
    expect(codes(history.execute(batch(history,[{type:'splitWall',id:'w-6a',atMm:4000,vertexId:'v-new',newWallId:'w-new'}])))).toContain('OPENING_STRADDLES_SPLIT')
    expect(codes(history.execute(batch(history,[{type:'splitWall',id:'w-6a',atMm:3500,vertexId:'v-new',newWallId:'w-new'}])))).toContain('OPENING_CLEARANCE')
    expect(history.document.revision).toBe(0)
  })
  it('rejects duplicate application, stale revision, another scene and unknown operation semantics', () => {
    const history = new SceneHistory(createHouse())
    const command = batch(history,[{type:'moveProp',id:'p-b2',positionMm:{x:5200,y:7800}}])
    expect(history.execute(command).ok).toBe(true)
    expect(codes(history.execute(command))).toContain('DUPLICATE_BATCH')
    expect(codes(history.execute({...command,batchId:'new-id'}))).toContain('STALE_REVISION')
    expect(codes(history.execute(batch(history,command.operations,{sceneId:'another'})))).toContain('SCENE_MISMATCH')
    expect(codes(history.execute(batch(history,[{type:'eval',source:'script'}] as unknown as Operation[])))).toContain('COMMAND_SCHEMA')
    expect(codes(history.execute(batch(history,command.operations,{source:'unknown' as CommandBatch['source']})))).toContain('COMMAND_SCHEMA')
  })
  it('refuses AI in M0 and forged history sources', () => {
    const history = new SceneHistory(createHouse())
    const operations: Operation[] = [{type:'moveProp',id:'p-b2',positionMm:{x:5200,y:7800}}]
    expect(codes(history.execute(batch(history,operations,{source:'ai',scope:{entityIds:['p-b2']}})))).toContain('AI_DISABLED')
    expect(codes(history.execute(batch(history,operations,{source:'history'})))).toContain('RESERVED_SOURCE')
  })
  it('does not treat inherited object properties as mutation targets', () => {
    const history = new SceneHistory(createHouse())
    expect(codes(history.execute(batch(history,[{type:'moveProp',id:'toString',positionMm:{x:1000,y:1000}}])))).toContain('MISSING_ENTITY')
    expect(history.document.revision).toBe(0)
  })
  it('protects indirectly affected rooms and their props from shared geometry edits', () => {
    const scene = createHouse(); scene.rooms['r-b2'].editLocked = true
    const history = new SceneHistory(scene)
    const result = history.execute(batch(history,[{type:'moveVertices',positions:{'v-b2':{x:8200,y:4000},'v-e5':{x:8200,y:11000}}}]))
    expect(codes(result)).toContain('EDIT_LOCKED')
    expect(history.document.revision).toBe(0)
    const propLocked = createHouse(); propLocked.props['p-b2'].editLocked = true
    expect(codes(new SceneHistory(propLocked).execute(batch(history,[{type:'reverseWall',id:'w-6a'}],{sceneId:propLocked.sceneId})))).toContain('EDIT_LOCKED')
  })
  it('requires independent host lock transactions, and permits their own history replay', () => {
    const history = new SceneHistory(createHouse())
    const lock: Operation = {type:'setEditLock',entityKind:'prop',id:'p-b2',locked:true}
    expect(codes(history.execute(batch(history,[lock,{type:'moveProp',id:'p-b2',positionMm:{x:5200,y:7800}}])))).toContain('LOCK_BATCH_REQUIRED')
    expect(history.execute(batch(history,[lock])).ok).toBe(true)
    expect(codes(history.execute(batch(history,[{type:'moveProp',id:'p-b2',positionMm:{x:5200,y:7800}}])))).toContain('EDIT_LOCKED')
    expect(history.undo().ok).toBe(true)
    expect(history.document.props['p-b2'].editLocked).toBe(false)
    expect(history.redo().ok).toBe(true)
    expect(history.document.props['p-b2'].editLocked).toBe(true)
    expect(history.execute(batch(history,[{...lock,locked:false}])).ok).toBe(true)
  })
  it('keeps wall and attached-door locks effective for reverse/split/move operations', () => {
    const scene = createHouse(); scene.openings['o-b2'].editLocked = true
    const history = new SceneHistory(scene)
    expect(codes(history.execute(batch(history,[{type:'reverseWall',id:'w-6a'}])))).toContain('EDIT_LOCKED')
    expect(codes(history.execute(batch(history,[{type:'splitWall',id:'w-6a',atMm:2000,vertexId:'v-new',newWallId:'w-new'}])))).toContain('EDIT_LOCKED')
    history.execute(batch(history,[{type:'setEditLock',entityKind:'opening',id:'o-b2',locked:false}]))
    history.execute(batch(history,[{type:'setEditLock',entityKind:'wall',id:'w-6a',locked:true}]))
    expect(codes(history.execute(batch(history,[{type:'moveOpening',id:'o-b2',offsetMm:3200}])))).toContain('EDIT_LOCKED')
  })
  it('updates door state/width, room content, note visibility and prop rotation through the same pipeline', () => {
    const history = new SceneHistory(createHouse())
    expect(history.execute(batch(history,[
      {type:'updateOpening',id:'o-b2',changes:{state:'open',locked:true,widthMm:1000}},
      {type:'updateRoom',id:'r-a1',changes:{purpose:'线索现场'}},
      {type:'updateNote',id:'n-d4',changes:{discovered:true,visibility:'gm',text:'调查完成'}},
      {type:'updateProp',id:'p-b2',changes:{rotationDeg:90}},
    ])).ok).toBe(true)
    expect(history.document.openings['o-b2']).toMatchObject({state:'open',locked:true,widthMm:1000})
    expect(history.document.notes['n-d4']).toMatchObject({discovered:true,visibility:'gm'})
    expect(history.document.props['p-b2'].rotationDeg).toBe(90)
  })
  it('clears redo on a new edit and cannot leak mutable snapshots', () => {
    const history = new SceneHistory(createHouse())
    history.execute(batch(history,[{type:'updateNote',id:'n-d4',changes:{text:'First'}}]))
    history.undo()
    expect(history.canRedo).toBe(true)
    history.execute(batch(history,[{type:'updateNote',id:'n-d4',changes:{text:'Second'}}]))
    expect(history.canRedo).toBe(false)
    expect(() => { history.document.notes['n-d4'].text = 'external mutation' }).toThrow()
    expect(history.document.notes['n-d4'].text).toBe('Second')
    expect(codes(history.redo())).toContain('HISTORY_EMPTY')
  })
})
