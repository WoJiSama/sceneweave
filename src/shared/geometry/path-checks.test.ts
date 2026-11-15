import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { applyCommands, applySnapshotCommands } from '../commands/commands.js'
import { decodeSceneCoordinates, encodeSceneCoordinates } from '../aggregates/scene-coordinates.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { PathCheck, SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateSceneDerivationSnapshot, validateSceneSnapshot } from '../validation/snapshots.js'
import { validateGeometry } from './geometry.js'
import { inspectPathChecks, resolvePathAnchor } from './path-checks.js'
import { pathCheckSchema } from './path-check-contracts.js'

const point = (x: number, y: number) => ({ type: 'point' as const, positionMm: { x, y } })
const declaration = (overrides: Partial<PathCheck> = {}): PathCheck => ({ id: 'keep-route', floorId: 'blank-floor',
  from: point(2000,4000), to: point(12000,4000), clearanceMm: 2000, mode: 'current', assumedOpenDoorIds: [], ...overrides })
function scene(narrow = true): SceneDocument {
  const document = fixture().project.document
  delete document.props.other; delete document.entityLayers.other
  document.floors['blank-floor'].boundsMm = { x:0, y:narrow ? 3000 : 0, width:14000, height:narrow ? 2000 : 12000 }
  const prop = document.props.item
  Object.assign(prop, { positionMm:{x:6000,y:4000}, footprintMm:{width:200,height:200}, footprintOffsetMm:{x:0,y:0},
    visualBoundsMm:{x:-100,y:-100,width:200,height:200}, blocksMovement:false })
  return document
}
function certify(document: SceneDocument) {
  const result = validateSceneSnapshot(document)
  if (!result.ok) throw Error(JSON.stringify(result.errors))
  return result.document
}
function doorScene() {
  const document = fixture({building:true}).project.document
  document.openings.door = { id:'door', floorId:'blank-floor', editLocked:false, wallId:'wall-0',
    offsetReferenceVertexId:'vertex-0', offsetMm:1500, widthMm:1000, kind:'door', state:'closed', locked:true, secret:true, revealed:false }
  document.entityLayers.door = document.entityLayers.room
  document.constraints.pathChecks = [declaration({from:point(5000,1500),to:point(5000,5000),clearanceMm:1000})]
  return document
}

describe('persistent explicit full-width path declarations', () => {
  it('persists optional route names without changing IDs, physical guards or world coordinates', () => {
    const unnamed=declaration(), named={...unnamed,name:'主探索线：前厅到祭坛'}
    expect(pathCheckSchema.parse(unnamed)).toEqual(unnamed)
    expect(pathCheckSchema.parse({...named,name:'名'.repeat(80)}).name).toHaveLength(80)
    for(const name of ['', ' \t\n', '名'.repeat(81), 5, null])expect(pathCheckSchema.safeParse({...named,name}).success).toBe(false)
    expect(pathCheckSchema.safeParse({...named,title:'unsupported'}).success).toBe(false)
    const source=certify(scene()), guarded=applySnapshotCommands(source,[{type:'upsertPathCheck',check:unnamed}],runtime)
    const renamed=applySnapshotCommands(guarded,[{type:'upsertPathCheck',check:named}],runtime)
    expect(guarded.constraints.pathChecks).toEqual([unnamed])
    expect(renamed.constraints.pathChecks).toEqual([named])
    expect(applySnapshotCommands(renamed,[{type:'upsertPathCheck',check:named}],runtime)).toBe(renamed)
    expect(decodeSceneCoordinates(encodeSceneCoordinates(renamed)).constraints.pathChecks).toEqual([named])
    expect(()=>applySnapshotCommands(renamed,[{type:'setPropBlocking',id:'item',blocksMovement:true}],runtime)).toThrow(/主探索线：前厅到祭坛/)
    const blocked=cloneJson(renamed);blocked.props.item.blocksMovement=true
    expect(inspectPathChecks(blocked).errors).toEqual(expect.arrayContaining([expect.objectContaining({entityId:named.id,message:expect.stringContaining(named.name)})]))
    const sameName=applySnapshotCommands(renamed,[{type:'upsertPathCheck',check:{...named,id:'second-route'}}],runtime)
    expect(sameName.constraints.pathChecks.map(check=>check.id)).toEqual([named.id,'second-route'])
    const cleared=applySnapshotCommands(renamed,[{type:'upsertPathCheck',check:unnamed}],runtime)
    expect(cleared.constraints.pathChecks).toEqual([unnamed])
    expect(()=>applySnapshotCommands(cleared,[{type:'setPropBlocking',id:'item',blocksMovement:true}],runtime)).toThrow(/keep-route/)
  })

  it('keeps undeclared blocked drafts legal, but rejects a blocking flag without mutating a declared baseline', () => {
    const source=scene(), before=cloneJson(source)
    expect(applyCommands(source,[{type:'setPropBlocking',id:'item',blocksMovement:true}],runtime).props.item.blocksMovement).toBe(true)
    const guarded=applyCommands(source,[{type:'upsertPathCheck',check:declaration()}],runtime)
    expect(validateSceneDocument(guarded).ok).toBe(true)
    expect(()=>applyCommands(guarded,[{type:'setPropBlocking',id:'item',blocksMovement:true}],runtime)).toThrow(/keep-route.*|未能证明/)
    const blocked=cloneJson(guarded); blocked.props.item.blocksMovement=true
    const result=validateSceneDocument(blocked)
    expect(result.ok).toBe(false)
    if(!result.ok) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({entityId:'item',message:expect.stringContaining('候选路线')})]))
    expect(source).toEqual(before); expect(guarded.props.item.blocksMovement).toBe(false)
  })

  it('rechecks hints and finds an actual alternative instead of treating the hint as a fixed protected strip', () => {
    const document=scene(false);document.props.item.blocksMovement=true
    document.constraints.pathChecks=[declaration({clearanceMm:1000,routeHintMm:[{x:2000,y:4000},{x:12000,y:4000}]})]
    const result=inspectPathChecks(document)
    expect(result.errors).toEqual([]);expect(result.checks[0].status).toBe('found')
    expect(result.checks[0].pointsMm.length).toBeGreaterThan(2)
    expect(validateSceneDocument(document).ok).toBe(true)
  })

  it('enforces exact width, full end caps and floor bounds independently of export crop', () => {
    const document=scene();document.constraints.pathChecks=[declaration()]
    expect(validateSceneDocument(document).ok).toBe(true)
    document.floors['blank-floor'].outputBoundsMm={x:3000,y:3500,width:500,height:500}
    expect(validateGeometry(document).errors).toEqual([])
    document.constraints.pathChecks[0].clearanceMm=2001
    expect(inspectPathChecks(document).errors.length).toBeGreaterThan(0)
    document.constraints.pathChecks=[declaration({from:point(2000,4001),to:point(12000,4001)})]
    expect(inspectPathChecks(document).errors.length).toBeGreaterThan(0)
    document.constraints.pathChecks=[declaration({from:point(0,4000)})]
    expect(inspectPathChecks(document).errors.length).toBeGreaterThan(0)
  })

  it('cannot bypass a guard through the certified prop executor or derivation', () => {
    const document=scene();document.props.item.blocksMovement=true;document.props.item.positionMm={x:100,y:4000}
    document.constraints.pathChecks=[declaration()]
    const source=certify(document), before=cloneJson(source)
    expect(()=>applySnapshotCommands(source,[{type:'updateProp',id:'item',changes:{positionMm:{x:6000,y:4000}}}],runtime)).toThrow(/未能证明/)
    const candidate=cloneJson(source);candidate.props.item.positionMm={x:6000,y:4000}
    expect(validateSceneDerivationSnapshot(candidate,source).ok).toBe(false)
    expect(validateSceneDocument(candidate).ok).toBe(false)
    expect(source).toEqual(before)
  })

  it('uses explicit structural/current door assumptions without changing lock, secret or state', () => {
    const document=doorScene(), before=cloneJson(document.openings)
    expect(inspectPathChecks(document).errors.length).toBeGreaterThan(0)
    document.constraints.pathChecks[0].mode='structural'
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(inspectPathChecks(document).checks[0].dependencyIds).toContain('door')
    document.constraints.pathChecks[0].mode='current';document.constraints.pathChecks[0].assumedOpenDoorIds=['door']
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(document.openings).toEqual(before)
    document.openings.door.kind='window'
    expect(inspectPathChecks(document).errors[0].code).toBe('INVALID_PATH_CHECK')
    document.openings.door.kind='door';document.constraints.pathChecks[0].mode='structural'
    expect(inspectPathChecks(document).errors[0].code).toBe('INVALID_PATH_CHECK')
  })

  it('rejects missing, cross-floor and recursive anchors and never moves a blocked anchor to a nearby landing', () => {
    const document=scene(false), check=declaration({clearanceMm:500,from:{type:'entity',entityKind:'prop',entityId:'item'}})
    document.constraints.pathChecks=[check]
    expect(validateSceneDocument(document).ok).toBe(true)
    document.props.item.blocksMovement=true
    expect(inspectPathChecks(document).errors.length).toBeGreaterThan(0)
    document.props.item.blocksMovement=false
    document.notes.a={id:'a',floorId:'blank-floor',editLocked:false,anchor:{type:'entity',entityKind:'prop',entityId:'item'},kind:'note',text:'gm',visibility:'gm'}
    check.from={type:'entity',entityKind:'note',entityId:'a'}
    expect(resolvePathAnchor(document,'blank-floor',check.from).dependencyIds).toEqual(['a','item'])
    document.notes.a.anchor={type:'entity',entityKind:'note',entityId:'a'}
    expect(()=>resolvePathAnchor(document,'blank-floor',check.from)).toThrow(/循环/)
    check.from={type:'entity',entityKind:'prop',entityId:'missing'}
    expect(inspectPathChecks(document).errors[0].code).toBe('INVALID_PATH_CHECK')
    check.from={type:'entity',entityKind:'prop',entityId:'item'};document.props.item.floorId='other-floor'
    expect(inspectPathChecks(document).errors[0].code).toBe('INVALID_PATH_CHECK')
  })

  it('refuses fractional centres, stale hint-only proofs, regional mode and unresolved floors', () => {
    const document=scene();document.regions.odd={id:'odd',floorId:'blank-floor',editLocked:false,visibility:'public',kind:'hazard',
      boundaryMm:[{x:2000,y:3500},{x:2001,y:3500},{x:2001,y:4500},{x:2000,y:4500}],blocksMovement:false,movementCostMultiplier:1}
    expect(()=>resolvePathAnchor(document,'blank-floor',{type:'entity',entityKind:'region',entityId:'odd'})).toThrow(/整数/)
    document.constraints.pathChecks=[declaration({floorId:'missing'})]
    expect(inspectPathChecks(document).errors[0].code).toBe('INVALID_PATH_CHECK')
    document.constraints.pathChecks=[declaration()];document.mapMode='regional'
    expect(inspectPathChecks(document).errors[0].code).toBe('INVALID_PATH_CHECK')
  })

  it('keeps native parsing strict and refuses to infer a Floor in the internal historical adapter', () => {
    const check=declaration(),{floorId:_floor,...old}=check
    expect(pathCheckSchema.safeParse(old).success).toBe(false)
    expect(pathCheckSchema.safeParse({...check,assumedOpenDoorIds:['door','door']}).success).toBe(false)
    expect(pathCheckSchema.safeParse({...check,routeHintMm:Array.from({length:129},()=>({x:1,y:1}))}).success).toBe(false)
    expect(pathCheckSchema.safeParse({...check,clearanceMm:1.5}).success).toBe(false)
    const document=scene()
    expect(()=>toCurrentSceneDocument({...document,constraints:{...document.constraints,pathChecks:[old]}})).toThrow(/明确Floor/)
    expect(toCurrentSceneDocument({...document,constraints:{...document.constraints,pathChecks:[check]}}).constraints.pathChecks).toEqual([check])
  })

  it('isolates explicit guard edits, preserves no-op identity, and enforces declaration and expanded budgets', () => {
    const source=certify(scene()), check=declaration()
    const guarded=applySnapshotCommands(source,[{type:'upsertPathCheck',check}],runtime)
    expect(applySnapshotCommands(guarded,[{type:'upsertPathCheck',check}],runtime)).toBe(guarded)
    expect(()=>applyCommands(guarded,[{type:'deletePathCheck',id:check.id},{type:'setPropBlocking',id:'item',blocksMovement:true}],runtime)).toThrow(/独立提交/)
    expect(applyCommands(guarded,[{type:'deletePathCheck',id:check.id}],runtime).constraints.pathChecks).toEqual([])
    expect(()=>applyCommands(source,[{type:'upsertPathCheck',check:{...check,id:'item'}}],runtime)).toThrow(/ID/)
    const commands=Array.from({length:17},(_,i)=>({type:'upsertPathCheck' as const,check:{...check,id:'route-'+i}}))
    expect(()=>applyCommands(source,commands,runtime)).toThrow(/16/)
    const routeHintMm=Array.from({length:128},(_,i)=>({x:2000+i*50,y:4000}))
    expect(()=>applyCommands(source,[{type:'upsertPathCheck',check:{...check,routeHintMm}},{type:'upsertPathCheck',check:{...check,id:'second',routeHintMm}}],runtime)).toThrow(/256/)
  })

  it('reports a real finite search budget and keeps its diagnostic distinct from a proof of impossibility', () => {
    const document=scene(false);document.floors['blank-floor'].boundsMm={x:0,y:0,width:50000,height:50000}
    document.regions.barrier={id:'barrier',floorId:'blank-floor',editLocked:false,visibility:'public',kind:'hazard',blocksMovement:true,movementCostMultiplier:1,
      boundaryMm:[{x:24000,y:0},{x:26000,y:0},{x:26000,y:50000},{x:24000,y:50000}]}
    document.constraints.pathChecks=[declaration({to:point(48000,4000)})]
    const result=inspectPathChecks(document)
    expect(result.checks[0].status).toBe('budget')
    expect(result.errors[0].code).toBe('PATH_CHECK_BUDGET')
    expect(result.errors[0].message).toContain('未宣称不存在')
    expect(result.checks[0].expandedNodes).toBeLessThanOrEqual(512)
  })

  it('preserves world point/hint coordinates across aggregate storage and rechecks moved entity anchors', () => {
    const document=scene(false)
    document.aggregateCoordinates={encoding:'world',groups:{group:{id:'group',floorId:'blank-floor',parentId:null,editLocked:false,
      frame:{translationMm:{x:1000,y:1000},quarterTurns:1},members:[{kind:'prop',id:'item'}]}}}
    document.constraints.pathChecks=[declaration({clearanceMm:500,from:{type:'entity',entityKind:'prop',entityId:'item'},routeHintMm:[{x:6000,y:4000},{x:12000,y:4000}]})]
    const local=encodeSceneCoordinates(document),world=decodeSceneCoordinates(local)
    expect(local.constraints).toEqual(document.constraints);expect(world).toEqual(document)
    const source=certify(world),candidate=cloneJson(source);candidate.props.item.positionMm={x:6000,y:0}
    expect(validateSceneDerivationSnapshot(candidate,source).ok).toBe(false)
    expect(validateSceneDocument(candidate).ok).toBe(false)
  })

  it('preserves physical edit locks and prevents deleting an otherwise empty declared Floor', () => {
    const document=scene();document.props.item.editLocked=true
    const guarded=applyCommands(document,[{type:'upsertPathCheck',check:declaration()}],runtime)
    expect(()=>applyCommands(guarded,[{type:'setPropBlocking',id:'item',blocksMovement:true}],runtime)).toThrow(/锁/)
    document.floors.second={id:'second',name:'second',boundsMm:{x:0,y:3000,width:14000,height:2000}}
    for(const floor of Object.values(document.floors))floor.outputBoundsMm={...floor.boundsMm}
    document.userLayers.secondLayer={id:'secondLayer',floorId:'second',name:'second',order:0,editLocked:false}
    document.constraints.pathChecks=[declaration({floorId:'second'})]
    expect(()=>applyCommands(document,[{type:'deleteEmptyFloor',id:'second'}],runtime)).toThrow(/依赖/)
  })

  it('uses exact door approaches when a structural path must turn through an off-grid opening', () => {
    const document=doorScene()
    document.openings.door.offsetMm=1537
    document.constraints.pathChecks=[declaration({from:point(2000,1500),to:point(8000,5000),clearanceMm:1000,mode:'structural'})]
    const result=inspectPathChecks(document)
    expect(result.errors).toEqual([])
    expect(result.checks[0].status).toBe('found')
    expect(result.checks[0].pointsMm.some(p=>p.x===5037)).toBe(true)
  })
})
