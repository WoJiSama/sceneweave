import { describe, expect, it } from 'vitest'
import type { Prop, SceneDocument } from '../../../shared/model/scene.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { pathPolygon, polygonDistance, polygonInside, propFootprint, roomPoints, supportedPolygon, terrainPoints } from '../../../shared/geometry/geometry.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { VEGETATION_DETAIL_SPECS } from '../../../shared/visual/vegetation-detail-art.js'
import { appendVegetationDetailDefinitions } from './vegetation-detail-catalog.js'
import { createThemePackSampleDocument } from './theme-pack-catalog.js'
import { OUTPOST_VEGETATION_GROUP_IDS } from './outpost-vegetation.js'
import { applyOutpostVegetationV2, OUTPOST_VEGETATION_V2_GROUP_IDS } from './outpost-vegetation-v2.js'
import { applyOutpostSurfaceTransitionsV2 } from './outpost-surfaces-v2.js'

const baseline = appendVegetationDetailDefinitions(createThemePackSampleDocument('wilderness',0))
const fixture = () => cloneJson(baseline)
const population = (scene: SceneDocument) => OUTPOST_VEGETATION_V2_GROUP_IDS.map(id => Object.values(scene.scatterGroups[id].members).filter(member => member.propId).length)
const members = (scene: SceneDocument) => OUTPOST_VEGETATION_V2_GROUP_IDS.flatMap(id => Object.values(scene.scatterGroups[id].members).map(member => scene.props[member.propId!]))
const visual = (prop: Prop) => { const b = prop.visualBoundsMm; return propFootprint({ ...prop, footprintMm: { width: b.width, height: b.height }, footprintOffsetMm: { x: b.x + b.width/2, y: b.y + b.height/2 } }) }
const firstOld = (scene: SceneDocument) => {
  const group = scene.scatterGroups[OUTPOST_VEGETATION_GROUP_IDS[0]], [key,member] = Object.entries(group.members)[0]
  return { group,key,member,prop:scene.props[member.propId!] }
}

describe('outpost woodland layout2 construction', () => {
  it('persists four real growth groups, uses all fixed variants and increases actual population across densities', () => {
    const source = fixture(), before = canonicalJson(source), counts: number[][] = []
    for (const density of ['sparse','balanced','dense'] as const) {
      const scene = applyOutpostVegetationV2(source,density), actual = population(scene); counts.push(actual)
      expect(actual.every(count => count > 0), `${density}: ${actual}`).toBe(true)
      expect(members(scene).length).toBeLessThanOrEqual(180)
      for (const spec of VEGETATION_DETAIL_SPECS) expect(members(scene).some(prop => prop.definitionRef?.id === spec.definitionId),`${density}/${spec.key}`).toBe(true)
      for (const id of OUTPOST_VEGETATION_V2_GROUP_IDS) {
        expect(scene.scatterGroups[id].algorithmVersion).toBe('scatter-cell-v2')
        expect(Object.values(scene.scatterGroups[id].members).every(member => member.state === 'managed' && member.overrideFields.length === 0)).toBe(true)
      }
      expect(validateSceneDocument(scene).ok).toBe(true)
      expect(canonicalJson(JSON.parse(canonicalJson(scene)))).toBe(canonicalJson(scene))
    }
    expect(counts[0].reduce((sum,n)=>sum+n,0),JSON.stringify(counts)).toBeLessThan(counts[1].reduce((sum,n)=>sum+n,0))
    expect(counts[1].reduce((sum,n)=>sum+n,0),JSON.stringify(counts)).toBeLessThan(counts[2].reduce((sum,n)=>sum+n,0))
    expect(canonicalJson(source)).toBe(before)
  }, 15_000)

  it('keeps real footprints and full rotated canopies off roads, rooms, camps and the central activity clearing', () => {
    const scene = applyOutpostVegetationV2(fixture(),'dense'), ground = scene.terrainAreas['sample-ground']
    for (const id of OUTPOST_VEGETATION_V2_GROUP_IDS) for (const member of Object.values(scene.scatterGroups[id].members)) {
      const prop = scene.props[member.propId!], footprint = propFootprint(prop), image = visual(prop)
      expect(supportedPolygon(scene,footprint,prop.supportRef,prop.floorId)).toBe(true)
      expect(polygonInside(image,terrainPoints(ground))).toBe(true)
      expect(polygonDistance(image,scene.scatterGroups[id].exclusions[0].boundaryMm)).toBeGreaterThanOrEqual(180)
      for (const path of Object.values(scene.paths)) expect(polygonDistance(image,pathPolygon(path))).toBeGreaterThanOrEqual(180)
      for (const room of Object.values(scene.rooms)) expect(polygonDistance(image,roomPoints(scene,room))).toBeGreaterThanOrEqual(250)
      for (const area of Object.values(scene.terrainAreas).filter(value=>value.id!==ground.id)) expect(polygonDistance(image,terrainPoints(area))).toBeGreaterThanOrEqual(180)
    }
  })

  it('accepts the parent construction order after surface v2 and retains its complete overlay result', () => {
    const source=applyOutpostSurfaceTransitionsV2(fixture()), before=canonicalJson(source)
    const scene=applyOutpostVegetationV2(source)
    expect(scene.terrainAreas).toEqual(source.terrainAreas)
    expect(scene.paths).toEqual(source.paths)
    expect(population(scene).every(count=>count>0)).toBe(true)
    expect(canonicalJson(source)).toBe(before)
  })

  it('proves the whole original recipe and refuses manual labels, unmarked edits, deletion, exclusion or lock changes atomically', () => {
    const original=fixture()
    const mutators: ((scene: SceneDocument)=>void)[] = [
      scene=>{firstOld(scene).member.state='manual'},
      scene=>{firstOld(scene).prop.positionMm.x++},
      scene=>{const {member}=firstOld(scene);const id=member.propId!;delete scene.props[id];delete scene.entityLayers[id];member.propId=null;member.state='deleted'},
      scene=>{firstOld(scene).member.state='detached'},
      scene=>{firstOld(scene).group.exclusions[0].boundaryMm[0].x++},
      scene=>{firstOld(scene).prop.editLocked=true},
      scene=>{firstOld(scene).group.editLocked=true},
      scene=>{scene.userLayers['theme-pack-props'].editLocked=true},
      scene=>{firstOld(scene).group.visibility='gm'},
    ]
    for (const mutate of mutators) {
      const source=cloneJson(original);mutate(source);const before=canonicalJson(source)
      expect(()=>applyOutpostVegetationV2(source)).toThrow()
      expect(canonicalJson(source)).toBe(before)
    }
  })

  it('refuses extra original-group members and reserved v2 identity occupation even when records claim managed', () => {
    const source=fixture(), {group}=firstOld(source), denser=createThemePackSampleDocument('wilderness',0,{outpostVegetation:'dense'})
    const [extraKey,extraMember]=Object.entries(denser.scatterGroups[group.id].members).find(([key])=>!group.members[key])!
    const extra=cloneJson(denser.props[extraMember.propId!])
    extra.id='extra-unreviewed-tree';source.props[extra.id]=extra;source.entityLayers[extra.id]='theme-pack-props'
    group.members[extraKey]={propId:extra.id,state:'managed',overrideFields:[]}
    const before=canonicalJson(source)
    const checkedExtra=validateSceneDocument(source)
    expect(checkedExtra.ok,JSON.stringify(checkedExtra.ok ? [] : checkedExtra.errors)).toBe(true)
    expect(()=>applyOutpostVegetationV2(source)).toThrow(/重放不一致/);expect(canonicalJson(source)).toBe(before)
    const alteredSeed=fixture();firstOld(alteredSeed).group.seed='user-mutated-but-still-managed'
    expect(validateSceneDocument(alteredSeed).ok).toBe(true)
    expect(()=>applyOutpostVegetationV2(alteredSeed)).toThrow(/重放不一致/)
    const occupied=fixture(), id=OUTPOST_VEGETATION_V2_GROUP_IDS[3], floorId=Object.keys(occupied.floors)[0]
    occupied.notes[id]={id,floorId,editLocked:false,visibility:'gm',anchor:{type:'point',positionMm:{x:1000,y:1000}},kind:'note',text:'independent user record'}
    occupied.entityLayers[id]='theme-pack-props';const occupiedBefore=canonicalJson(occupied)
    expect(()=>applyOutpostVegetationV2(occupied)).toThrow(/身份已存在/);expect(canonicalJson(occupied)).toBe(occupiedBefore)
  }, 15_000)

  it('preserves unrelated locked props and independent groups while replacing only the proven v1 managed members', () => {
    const source=fixture(), old=firstOld(source).prop, external=cloneJson(old)
    external.id='independent-locked-tree';external.positionMm={x:15500,y:22000};external.editLocked=true
    source.props[external.id]=external;source.entityLayers[external.id]='theme-pack-props'
    const independent=cloneJson(source.scatterGroups[OUTPOST_VEGETATION_GROUP_IDS[2]])
    independent.id='independent-grass-group';independent.members={};independent.seed='independent-untouched'
    independent.exclusions.forEach((exclusion,index)=>{exclusion.id=`${independent.id}-exclusion-${index}`})
    source.scatterGroups[independent.id]=independent;source.entityLayers[independent.id]='theme-pack-props'
    const originalIds=OUTPOST_VEGETATION_GROUP_IDS.flatMap(id=>Object.values(source.scatterGroups[id].members).map(member=>member.propId!))
    const changed=applyOutpostVegetationV2(source)
    expect(changed.props[external.id]).toEqual(external);expect(changed.scatterGroups[independent.id]).toEqual(independent)
    for (const id of OUTPOST_VEGETATION_GROUP_IDS) expect(changed.scatterGroups[id]).toBeUndefined()
    for (const id of originalIds) expect(changed.props[id]).toBeUndefined()
    expect(changed.assets).toEqual(source.assets);expect(changed.propDefinitions).toEqual(source.propDefinitions)
    expect(changed.paths).toEqual(source.paths);expect(changed.rooms).toEqual(source.rooms);expect(changed.terrainAreas).toEqual(source.terrainAreas)
  })

  it('keeps the source intact when a later full dependency validation rejects removal, and refuses broken new calibration', () => {
    const source=fixture(), old=firstOld(source).prop, id='dependent-old-tree-note'
    source.notes[id]={id,floorId:old.floorId,editLocked:false,visibility:'public',anchor:{type:'entity',entityKind:'prop',entityId:old.id},kind:'note',text:'This is an explicit dependency'}
    source.entityLayers[id]='theme-pack-props';expect(validateSceneDocument(source).ok).toBe(true)
    const before=canonicalJson(source)
    expect(()=>applyOutpostVegetationV2(source)).toThrow();expect(canonicalJson(source)).toBe(before)
    const broken=fixture();broken.propDefinitions[VEGETATION_DETAIL_SPECS[5].definitionId].defaultVisualBoundsMm.y++
    expect(()=>applyOutpostVegetationV2(broken)).toThrow(/标定完整/)
  })
})
