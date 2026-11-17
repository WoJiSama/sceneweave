import {describe,expect,it,vi} from 'vitest'
import {createSceneCollectionLivingDocument,SCENE_COLLECTION_LIVING_SCENES} from './scene-collection-living.js'
import {inspectPathChecks} from '../../../shared/geometry/path-checks.js'
import {assertDoorwayClearances} from '../../../shared/geometry/doorway-clearance.js'
import {validateSceneDocument} from '../../../shared/validation/scene.js'
vi.mock('../runtime.js',()=>({runtime:{ids:{nextId:()=> 'living-test'},clock:{now:()=> '2026-11-17T00:00:00.000Z'}},validation:{}}))
describe('living equipment composition',()=>{
 it.each(SCENE_COLLECTION_LIVING_SCENES.map(row=>[row.id]))('%s has real shared walls, independent equipment and an explicit clear working route',id=>{
  const scene=createSceneCollectionLivingDocument(id)
  expect(validateSceneDocument(scene).ok).toBe(true)
  expect(Object.keys(scene.rooms)).toHaveLength(2)
  expect(Object.keys(scene.walls)).toHaveLength(7)
  expect(Object.keys(scene.props).length).toBeGreaterThan(30)
  expect(inspectPathChecks(scene).checks.every(row=>row.ok)).toBe(true)
  expect(()=>assertDoorwayClearances(scene,[{openingId:'living-front-door',minWidthMm:1200,approachDepthMm:1000},{openingId:'living-wash-door',minWidthMm:1200,approachDepthMm:1000}])).not.toThrow()
  for(const prop of Object.values(scene.props))expect(prop.supportRef).toEqual({kind:'room',id:prop.roomId})
 })
})
