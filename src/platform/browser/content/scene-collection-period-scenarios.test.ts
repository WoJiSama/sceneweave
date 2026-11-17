import { describe, expect, it, vi } from 'vitest'
import { PERIOD_SCENARIO_SPECS, createSceneCollectionPeriodScenarioDocument } from './scene-collection-period-scenarios.js'
import { SCENE_COLLECTION_SCENARIOS } from '../../../shared/assets/scene-collection-plan.js'
import { SCENE_COLLECTION_ITEMS } from '../../../shared/assets/scene-collection.js'
import { inspectPathChecks } from '../../../shared/geometry/path-checks.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { polygonsOverlap, propFootprint } from '../../../shared/geometry/geometry.js'
vi.mock('../runtime.js',()=>({runtime:{ids:{nextId:()=> 'scenario-test'},clock:{now:()=> '2026-11-17T00:00:00.000Z'}},validation:{}}))

describe('eight authored 1920s representative scenarios',()=>{
 it.each(PERIOD_SCENARIO_SPECS.map(spec=>[spec.id]))('%s preserves exact source sizes, purpose, clear circulation and editable structure',id=>{
  const scene=createSceneCollectionPeriodScenarioDocument(id)
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
   expect(SCENE_COLLECTION_ITEMS.find(item=>item.definitionId===definition.id)!.era).toBe('1920s')
  }
  expect(inspectPathChecks(scene).checks.filter(row=>!row.ok)).toEqual([])
  expect(()=>assertDoorwayClearances(scene,scene.constraints.entranceOpeningIds.map(openingId=>({openingId,minWidthMm:1200,approachDepthMm:1000})))).not.toThrow()
  const spec=PERIOD_SCENARIO_SPECS.find(row=>row.id===id)!,host=new Map((spec.attachments??[]).flatMap(row=>row.children.map(child=>[child.id,row.hostId] as const)))
  const badSupports=[]
  for(const attachment of spec.attachments??[]){
   const top=scene.props[attachment.hostId].footprintMm
   for(const binding of attachment.children){const child=scene.props[binding.id].footprintMm;if(Math.abs(binding.x)+child.width/2>Math.floor(top.width*.43)||Math.abs(binding.y)+child.height/2>Math.floor(top.height*.43))badSupports.push({host:attachment.hostId,child:binding.id,top,childSize:child,x:binding.x,y:binding.y})}
  }
  expect(badSupports).toEqual([])
  const solids=Object.values(scene.props).filter(prop=>prop.blocksMovement&&prop.renderLayer==='object'),overlaps=[]
  for(let a=0;a<solids.length;a++)for(let b=a+1;b<solids.length;b++)if(host.get(solids[a].id)!==solids[b].id&&host.get(solids[b].id)!==solids[a].id&&polygonsOverlap(propFootprint(solids[a]),propFootprint(solids[b])))overlaps.push([solids[a].id,solids[b].id])
  expect(overlaps).toEqual([])
 })
 it('keeps private partitions and a genuinely blocked harbor without implying vehicle travel',()=>{
  const apartment=createSceneCollectionPeriodScenarioDocument('period-apartment')
  expect(apartment.rooms['apt-wc']).toBeDefined()
  expect(apartment.rooms['apt-bath']).toBeDefined()
  expect(apartment.openings['apt-wc-door'].kind).toBe('door')
  const harbor=createSceneCollectionPeriodScenarioDocument('station-harbor')
  expect(harbor.exportBoundsMm.width).toBe(72000)
  expect(harbor.terrainAreas['harbor-water'].blocksMovement).toBe(true)
  expect(harbor.props['harbor-coach'].visualBoundsMm.height).toBe(19000)
  expect(harbor.props['harbor-tug'].visualBoundsMm.height).toBe(13000)
  expect(Object.keys(harbor.terrainConnections)).toHaveLength(0)
  const rails=['harbor-west-rail','harbor-east-rail'].map(id=>harbor.paths[id])
  expect(rails[1].centerlineMm[0].x-rails[0].centerlineMm[0].x).toBe(1435)
  expect(rails.every(rail=>rail.widthMm===70&&rail.supportRefs.some(ref=>ref.kind==='terrainArea'&&ref.id==='harbor-ballast'))).toBe(true)
  expect(Object.values(harbor.paths).filter(path=>path.id.startsWith('harbor-sleeper-'))).toHaveLength(62)
 })
})
