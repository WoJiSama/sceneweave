import { describe, expect, it, vi } from 'vitest'
import { FANTASY_SCENARIO_SPECS, createSceneCollectionFantasyScenarioDocument } from './scene-collection-fantasy-scenarios.js'
import { SCENE_COLLECTION_SCENARIOS } from '../../../shared/assets/scene-collection-plan.js'
import { SCENE_COLLECTION_ITEMS } from '../../../shared/assets/scene-collection.js'
import { inspectPathChecks } from '../../../shared/geometry/path-checks.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { polygonInside, polygonsOverlap, propFootprint } from '../../../shared/geometry/geometry.js'
import { projectScene } from '../../../shared/projection/projection.js'
vi.mock('../runtime.js',()=>({runtime:{ids:{nextId:()=> 'scenario-test'},clock:{now:()=> '2026-11-17T00:00:00.000Z'}},validation:{}}))

describe('eight authored fantasy representative scenarios',()=>{
 it.each(FANTASY_SCENARIO_SPECS.map(spec=>[spec.id]))('%s retains source identity, planned uses, practical circulation and real editable objects',id=>{
  const scene=createSceneCollectionFantasyScenarioDocument(id),spec=FANTASY_SCENARIO_SPECS.find(row=>row.id===id)!
  expect(validateSceneDocument(scene).ok).toBe(true)
  expect(Object.keys(scene.props).length).toBeGreaterThanOrEqual(24)
  expect(Object.keys(scene.prefabInstances).length).toBeGreaterThanOrEqual(2)
  expect(Object.keys(visualBase(scene)!.lights).length).toBeGreaterThanOrEqual(2)
  const categories=new Set(Object.values(scene.props).map(prop=>SCENE_COLLECTION_ITEMS.find(item=>item.definitionId===prop.definitionRef?.id)!.category))
  for(const opening of Object.values(scene.openings))categories.add(opening.kind)
  expect(SCENE_COLLECTION_SCENARIOS.find(row=>row.id===id)!.categories.filter(category=>!categories.has(category))).toEqual([])
  for(const prop of Object.values(scene.props)){
   const definition=scene.propDefinitions[prop.definitionRef!.id],item=SCENE_COLLECTION_ITEMS.find(row=>row.definitionId===definition.id)!
   expect(prop.footprintMm).toEqual(definition.defaultFootprintMm)
   expect(prop.visualBoundsMm).toEqual(definition.defaultVisualBoundsMm)
   if(!spec.props.find(row=>row.id===prop.id)!.naturalFallback)expect(item.era).toBe('fantasy')
  }
  expect(inspectPathChecks(scene).checks.filter(row=>!row.ok)).toEqual([])
  expect(()=>assertDoorwayClearances(scene,scene.constraints.entranceOpeningIds.map(openingId=>({openingId,minWidthMm:1200,approachDepthMm:1000})))).not.toThrow()
  const host=new Map((spec.attachments??[]).flatMap(row=>row.children.map(child=>[child.id,row.hostId] as const)))
  const overlayCategories=new Set(['magic-circle','grass-clump','fern-clump','flower-clump','fungus-clump','leaf-litter','footprint','drag-mark','blood-trace','soot','cobweb','rubble','scattered-paper'])
  const objects=Object.values(scene.props).filter(prop=>prop.renderLayer!=='canopy'&&!overlayCategories.has(SCENE_COLLECTION_ITEMS.find(item=>item.definitionId===prop.definitionRef?.id)!.category)),overlaps=[]
  for(let a=0;a<objects.length;a++)for(let b=a+1;b<objects.length;b++)if(host.get(objects[a].id)!==objects[b].id&&host.get(objects[b].id)!==objects[a].id&&polygonsOverlap(propFootprint(objects[a]),propFootprint(objects[b])))overlaps.push([objects[a].id,objects[b].id])
  expect(overlaps).toEqual([])
  for(const attachment of spec.attachments??[]){
   const hostProp=scene.props[attachment.hostId],w=Math.floor(hostProp.footprintMm.width*.43),h=Math.floor(hostProp.footprintMm.height*.43)
   const top=[{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h}]
   for(const child of attachment.children)expect(polygonInside(propFootprint({...scene.props[child.id],positionMm:{x:child.x,y:child.y},rotationDeg:0}),top),`${id}/${child.id} fits the complete host top`).toBe(true)
  }
  const player=projectScene(scene,'player')
  expect(player.props.filter(prop=>scene.props[prop.id].visibility==='gm')).toEqual([])
  expect(player.notes.filter(note=>note.visibility==='gm')).toEqual([])
 },15000)
 it('keeps actual caves and cells distinct from static artwork',()=>{
  const cave=createSceneCollectionFantasyScenarioDocument('cavern-lair'),prison=createSceneCollectionFantasyScenarioDocument('dungeon-prison')
  expect(Object.keys(cave.rooms)).toHaveLength(2)
  expect(cave.openings['cave-mouth'].widthMm).toBe(1950)
  expect(prison.openings['prison-cell-a-door'].kind).toBe('door')
  expect(prison.openings['prison-cell-b-door'].kind).toBe('door')
  expect(Object.keys(prison.terrainConnections)).toHaveLength(0)
  expect(Object.keys(createSceneCollectionFantasyScenarioDocument('mountain-outpost').terrainConnections)).toHaveLength(0)
 })
})
