import { describe, expect, it, vi } from 'vitest'
import { MEDIEVAL_SCENARIO_SPECS, createSceneCollectionMedievalScenarioDocument } from './scene-collection-medieval-scenarios.js'
import { SCENE_COLLECTION_SCENARIOS } from '../../../shared/assets/scene-collection-plan.js'
import { SCENE_COLLECTION_ITEMS } from '../../../shared/assets/scene-collection.js'
import { inspectPathChecks } from '../../../shared/geometry/path-checks.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { polygonInside, polygonsOverlap, propFootprint } from '../../../shared/geometry/geometry.js'
import { projectScene } from '../../../shared/projection/projection.js'
vi.mock('../runtime.js',()=>({runtime:{ids:{nextId:()=> 'scenario-test'},clock:{now:()=> '2026-11-17T00:00:00.000Z'}},validation:{}}))
describe('eight authored medieval representative scenarios',()=>{
 it.each(MEDIEVAL_SCENARIO_SPECS.map(spec=>[spec.id]))('%s has exact sources, distinct real architecture, planned purposes and usable entrance',id=>{
  const scene=createSceneCollectionMedievalScenarioDocument(id)
  expect(validateSceneDocument(scene).ok).toBe(true)
  expect(Object.keys(scene.rooms).length).toBeGreaterThanOrEqual(2)
  expect(Object.keys(scene.props).length).toBeGreaterThanOrEqual(24)
  expect(Object.keys(scene.prefabInstances).length).toBeGreaterThanOrEqual(2)
  expect(Object.keys(visualBase(scene)!.lights).length).toBeGreaterThanOrEqual(2)
  const categories=new Set(Object.values(scene.props).map(prop=>SCENE_COLLECTION_ITEMS.find(item=>item.definitionId===prop.definitionRef?.id)!.category))
  for(const opening of Object.values(scene.openings))categories.add(opening.kind)
  expect(SCENE_COLLECTION_SCENARIOS.find(spec=>spec.id===id)!.categories.filter(category=>!categories.has(category))).toEqual([])
  for(const prop of Object.values(scene.props)){
   const definition=scene.propDefinitions[prop.definitionRef!.id]
   expect(prop.footprintMm).toEqual(definition.defaultFootprintMm)
   expect(prop.visualBoundsMm).toEqual(definition.defaultVisualBoundsMm)
  }
  expect(inspectPathChecks(scene).checks.filter(row=>!row.ok)).toEqual([])
  expect(()=>assertDoorwayClearances(scene,scene.constraints.entranceOpeningIds.map(openingId=>({openingId,minWidthMm:1200,approachDepthMm:1000})))).not.toThrow()
  const spec=MEDIEVAL_SCENARIO_SPECS.find(row=>row.id===id)!,host=new Map((spec.attachments??[]).flatMap(row=>row.children.map(child=>[child.id,row.hostId] as const)))
  const solids=Object.values(scene.props).filter(prop=>prop.blocksMovement&&prop.renderLayer==='object'),overlaps=[]
  for(let a=0;a<solids.length;a++)for(let b=a+1;b<solids.length;b++)if(host.get(solids[a].id)!==solids[b].id&&host.get(solids[b].id)!==solids[a].id&&polygonsOverlap(propFootprint(solids[a]),propFootprint(solids[b])))overlaps.push([solids[a].id,solids[b].id])
  expect(overlaps).toEqual([])
  for(const row of spec.attachments??[]){
   const hostProp=scene.props[row.hostId],w=Math.floor(hostProp.footprintMm.width*.43),h=Math.floor(hostProp.footprintMm.height*.43)
   const surface=[{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}]
   for(const child of row.children)expect(polygonInside(propFootprint({...scene.props[child.id],positionMm:{x:child.x,y:child.y},rotationDeg:0}),surface),`${id}/${child.id} must fit the complete host top`).toBe(true)
  }
  const player=projectScene(scene,'player')
  expect(player.props.filter(prop=>scene.props[prop.id].visibility==='gm')).toEqual([])
  expect(player.notes.filter(note=>note.visibility==='gm')).toEqual([])
 },15000)
})
