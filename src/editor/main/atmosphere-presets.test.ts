import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyCommands } from '../../shared/commands/commands'
import { applyFloorCommand } from '../../shared/floors/commands'
import { createAppearanceGraph } from '../../shared/appearance/graph'
import { createHistoryIdentity, advanceHistoryIdentity } from '../../shared/history/identity'
import type { HistoryIdentity } from '../../shared/model/history'
import { canonicalJson } from '../../shared/validation/json'
import { sha256Text } from '../../shared/validation/hash'
import { toCurrentSceneDocument } from '../../shared/model/current-scene'
import type { SceneDocument } from '../../shared/model/scene'
import { projectScene } from '../../shared/projection/projection'
import { validateSceneDocument } from '../../shared/validation/scene'
import { visualBase } from '../../shared/visual/base'
import { emptyVisualSystem, type VisualFilter, type VisualFog, type VisualLight } from '../../shared/visual/types'
import AtmospherePresets from './AtmospherePresets'
import { ATMOSPHERE_EFFECT_IDS, ATMOSPHERE_PRESETS, atmospherePresetCommands, atmospherePresetUnavailable, currentAtmospherePreset, type AtmospherePresetId } from './atmosphere-presets'

function fixture(): SceneDocument {
  return toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'atmosphere-fixture', revision: 0,
    title: '氛围预设', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: { x: 0, y: 0, width: 24000, height: 18000 },
    floors: { floor: { id: 'floor', name: '地面', boundsMm: { x: -1000, y: -2000, width: 26000, height: 22000 } } },
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {},
    terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: '氛围', order: 0, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
}
const context = { ids: { nextId: () => { throw new Error('Atmosphere presets must not allocate unrelated identities.') } }, clock: { now: () => '2026-11-10T01:00:00.000Z' } }
const common = { floorId: 'floor', layerId: 'layer', visibility: 'gm' as const, editLocked: false, enabled: true }
const manualLight = (): VisualLight => ({ ...common, id: 'manual-light', positionMm: { x: 4000, y: 4000 }, color: '#FFAA88', intensity: .5, radiusMm: 2000, wallOcclusion: true })
const manualFog = (): VisualFog => ({ ...common, id: 'manual-fog', boundaryMm: [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 5000 }, { x: 1000, y: 5000 }], color: '#CCDDEE', opacity: .1, directionDeg: 20, scaleMm: 3000, seed: 'manual-fog-seed' })
const manualFilter = (): VisualFilter => ({ ...common, id: 'manual-filter', target: { kind: 'region', boundaryMm: manualFog().boundaryMm }, preset: 'aged', exposure: 1.1, saturation: .8, contrast: .9, vignette: .05, grain: .02, seed: 'manual-filter-seed' })
const apply = (scene: SceneDocument, preset: AtmospherePresetId, layerId = 'layer') => applyCommands(scene, atmospherePresetCommands(scene, layerId, preset), context)
let identitySequence=0
const identityContext=()=>({ids:{nextId:()=>`atmosphere-birth-${++identitySequence}`},clock:context.clock})
function multiple(source=fixture()):SceneDocument {
  const scene=structuredClone(source)
  applyFloorCommand(scene,{type:'createFloor',id:'upper',name:'上层',boundsMm:{x:0,y:0,width:24000,height:18000},outputBoundsMm:{x:0,y:0,width:24000,height:18000},newLayerId:'upper-layer',layerName:'上层氛围'})
  return scene
}
const scopedApply=(scene:SceneDocument,identity:HistoryIdentity,preset:AtmospherePresetId,layerId='layer')=>applyCommands(scene,atmospherePresetCommands(scene,layerId,preset,identity),context)

describe('finite atmosphere recipes through existing visual transactions', () => {
  it('switches fixed slots without stacking, stays deterministic and removes only its own effects for neutral', () => {
    const original = fixture(), before = structuredClone(original)
    expect(atmospherePresetCommands(original, 'layer', 'neutral')).toEqual([])
    let scene = original
    for (const preset of [...ATMOSPHERE_PRESETS.slice(1), ...ATMOSPHERE_PRESETS.slice(1).reverse()]) {
      const commands = atmospherePresetCommands(scene, 'layer', preset.id)
      expect(commands).toEqual(atmospherePresetCommands(scene, 'layer', preset.id))
      scene = applyCommands(scene, commands, context)
      expect(validateSceneDocument(scene).ok).toBe(true)
      expect(currentAtmospherePreset(scene)).toBe(preset.id)
      expect(Object.keys(visualBase(scene)!.filters)).toEqual([ATMOSPHERE_EFFECT_IDS.filter])
      expect(Object.keys(visualBase(scene)!.fogs)).toEqual(preset.fog ? [ATMOSPHERE_EFFECT_IDS.fog] : [])
      expect(atmospherePresetCommands(scene, 'layer', preset.id)).toEqual([])
      expect(scene.floors).toEqual(before.floors)
      expect(scene.generation).toEqual(before.generation)
      expect(scene.entityLayers).toEqual(before.entityLayers)
    }
    const neutral = apply(scene, 'neutral')
    expect(visualBase(neutral)).toEqual(emptyVisualSystem())
    expect(original).toEqual(before)
  })

  it('preserves separate hand-authored lights, fog and filters including private visibility', () => {
    const original = applyCommands(fixture(), [{ type: 'upsertVisualLight', light: manualLight() }, { type: 'upsertVisualFog', fog: manualFog() }, { type: 'upsertVisualFilter', filter: manualFilter() }], context)
    let scene = apply(original, 'moonlit')
    for (const preset of ['dusk', 'overcast', 'neutral'] as const) scene = apply(scene, preset)
    for (const key of ['lights', 'fogs', 'filters'] as const) expect(visualBase(scene)![key]).toEqual(visualBase(original)![key])
    const night = apply(scene, 'moonlit')
    const player = projectScene(night, 'player').visual!, gm = projectScene(night, 'gm').visual!
    expect(player.lights).toEqual([])
    expect(player.fogs.map(value => value.id)).toEqual([ATMOSPHERE_EFFECT_IDS.fog])
    expect(player.filters.map(value => value.id)).toEqual([ATMOSPHERE_EFFECT_IDS.filter])
    expect(gm.lights.map(value => value.id)).toEqual(['manual-light'])
    expect(gm.filters.map(value => value.id)).toContain('manual-filter')
  })

  it('refuses manually edited, private, disabled or foreign records instead of overwriting or adding another slot', () => {
    const original = apply(fixture(), 'moonlit')
    for (const mutate of [
      (scene: SceneDocument) => { visualBase(scene)!.filters[ATMOSPHERE_EFFECT_IDS.filter].exposure = 1.5 },
      (scene: SceneDocument) => { visualBase(scene)!.fogs[ATMOSPHERE_EFFECT_IDS.fog].boundaryMm[0].x += 10 },
      (scene: SceneDocument) => { visualBase(scene)!.filters[ATMOSPHERE_EFFECT_IDS.filter].visibility = 'gm' },
      (scene: SceneDocument) => { visualBase(scene)!.filters[ATMOSPHERE_EFFECT_IDS.filter].enabled = false },
      (scene: SceneDocument) => { visualBase(scene)!.fogs[ATMOSPHERE_EFFECT_IDS.fog].seed = 'not-an-owned-record' },
    ]) {
      const scene = structuredClone(original); mutate(scene)
      const before = structuredClone(scene)
      expect(currentAtmospherePreset(scene)).toBeNull()
      expect(() => atmospherePresetCommands(scene, 'layer', 'daylight')).toThrow(/手工修改|占用/)
      expect(scene).toEqual(before)
    }
    const foreign = applyCommands(fixture(), [{ type: 'upsertVisualFilter', filter: { ...manualFilter(), id: ATMOSPHERE_EFFECT_IDS.filter } }], context)
    expect(() => atmospherePresetCommands(foreign, 'layer', 'neutral')).toThrow(/手工修改|占用/)
    const collision = fixture()
    visualBase(collision)!.lights[ATMOSPHERE_EFFECT_IDS.filter] = { ...manualLight(), id: ATMOSPHERE_EFFECT_IDS.filter }
    expect(() => atmospherePresetCommands(collision, 'layer', 'dusk')).toThrow(/身份.*占用/)
  })

  it('keeps existing effect layers and honors own, layer and full-environment dependency locks', () => {
    const original = apply(fixture(), 'moonlit')
    original.userLayers.other = { id: 'other', floorId: 'floor', name: '其他', order: 1, editLocked: false }
    const changed = apply(original, 'dusk', 'other')
    expect(visualBase(changed)!.filters[ATMOSPHERE_EFFECT_IDS.filter].layerId).toBe('layer')
    expect(visualBase(changed)!.fogs[ATMOSPHERE_EFFECT_IDS.fog].layerId).toBe('layer')
    for (const kind of ['filter', 'fog'] as const) {
      const locked = structuredClone(original)
      visualBase(locked)![kind === 'filter' ? 'filters' : 'fogs'][ATMOSPHERE_EFFECT_IDS[kind]].editLocked = true
      expect(() => atmospherePresetCommands(locked, 'other', 'daylight')).toThrow(/锁定/)
    }
    const lockedLayer = structuredClone(original); lockedLayer.userLayers.layer.editLocked = true
    expect(() => atmospherePresetCommands(lockedLayer, 'other', 'daylight')).toThrow(/锁定/)
    const dependency = applyCommands(fixture(), [{ type: 'upsertVisualLight', light: manualLight() }], context)
    visualBase(dependency)!.lights['manual-light'].editLocked = true
    const before = structuredClone(dependency)
    expect(() => apply(dependency, 'dusk')).toThrow(/锁定/)
    expect(dependency).toEqual(before)
  })

  it('retains legacy exact full-Floor fog bounds and requires explicit birth proof before enabling scoped controls', () => {
    const scene = fixture(), next = apply(scene, 'overcast')
    expect(visualBase(next)!.fogs[ATMOSPHERE_EFFECT_IDS.fog].boundaryMm).toEqual([
      { x: -1000, y: -2000 }, { x: 25000, y: -2000 }, { x: 25000, y: 20000 }, { x: -1000, y: 20000 },
    ])
    expect(atmospherePresetUnavailable(scene, 'missing')).toMatch(/绘制图层/)
    expect(atmospherePresetUnavailable({ ...scene, mapMode: 'regional' }, 'layer')).toMatch(/场景地图/)
    const multi=multiple(scene)
    expect(() => atmospherePresetCommands(multi, 'layer', 'moonlit')).toThrow(/持久出生/)
    const html = renderToStaticMarkup(createElement(AtmospherePresets, { scene:multi, layerId: 'layer', disabled: false, onPreview: () => {} }))
    expect(html).toContain('当前楼层');expect(html).not.toContain('尚未按楼层隔离')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>预览氛围预设/)
  })

  it('keeps existing strict effect-count limits and fails atomically when no slot remains', () => {
    const scene = fixture()
    for (let i = 0; i < 16; i++) visualBase(scene)!.filters[`manual-${i}`] = { ...manualFilter(), id: `manual-${i}` }
    const before = structuredClone(scene)
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(() => apply(scene, 'dusk')).toThrow(/16|预算|记录数/)
    expect(scene).toEqual(before)
  })

  it('preserves all five legacy command goldens from the previous frozen source',()=>{
    // work/detail-queue-20261110/verified-input/.../atmosphere-presets.ts
    // original source SHA256 ce3c4b961f8ad730803be50996771aa51e2ffa32f85896ac33bf97ef081141df.
    expect(ATMOSPHERE_PRESETS.map(preset=>sha256Text(canonicalJson(atmospherePresetCommands(fixture(),'layer',preset.id))))).toEqual([
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
      'f9c6ac7b0aaed6c750c672acb1a3faf7cb770352fb88eae0e37c56f713defc51',
      'b529475b6454e50d973699b5aa4c7dd54d3cd612c52f72644fbdbf2edb3087e5',
      'cd988bfb844a4938722624372ae26abfed6b9e8ec6cd9585272009b8883e9832',
      '9e359d5e43632774feb7d7ba2ab00bb82a6329db4514cc6c52152edc86e3d18a',
    ])
  })

  it('persists independent whole environments and single effect pairs for two same-XY Floors without changing global values',()=>{
    const original=multiple(),identity=createHistoryIdentity(original,identityContext()),global=structuredClone(visualBase(original)!.environment)
    let scene=scopedApply(original,identity,'moonlit')
    const lower=structuredClone(scene.floors.floor),lowerEffects=structuredClone(visualBase(scene))
    scene=scopedApply(scene,identity,'overcast','upper-layer')
    expect(scene.floors.floor).toEqual(lower);expect(visualBase(scene)!.environment).toEqual(global)
    expect(Object.keys(visualBase(scene)!.filters)).toHaveLength(2);expect(Object.keys(visualBase(scene)!.fogs)).toHaveLength(2)
    for(const [id,value] of Object.entries(lowerEffects!.filters))expect(visualBase(scene)!.filters[id]).toEqual(value)
    expect(currentAtmospherePreset(scene,'floor',identity)).toBe('moonlit');expect(currentAtmospherePreset(scene,'upper',identity)).toBe('overcast');expect(currentAtmospherePreset(scene)).toBeNull()
    const lowerProjection=projectScene(scene,'player',undefined,{floorId:'floor'}).visual!,upperProjection=projectScene(scene,'player',undefined,{floorId:'upper'}).visual!
    expect(lowerProjection.filters).toHaveLength(1);expect(upperProjection.filters).toHaveLength(1)
    expect(lowerProjection.environment).toEqual(scene.floors.floor.environment);expect(upperProjection.environment).toEqual(scene.floors.upper.environment)
    const lowerBefore=structuredClone(scene.floors.floor),neutral=scopedApply(scene,identity,'neutral','upper-layer')
    expect(neutral.floors.floor).toEqual(lowerBefore);expect(visualBase(neutral)!.environment).toEqual(global)
    expect(visualBase(neutral)!.filters).toEqual(Object.fromEntries(Object.entries(visualBase(scene)!.filters).filter(([,value])=>value.floorId==='floor')))
    const html=renderToStaticMarkup(createElement(AtmospherePresets,{scene,layerId:'upper-layer',historyIdentity:identity,disabled:false,onPreview:()=>{}}))
    expect(html).toContain('当前楼层「上层」');expect(html).toContain('本层环境色');expect(html).not.toContain('尚未按楼层隔离')
  })

  it('continues the original Floor legacy slots after adding a Floor and never claims them for the other Floor',()=>{
    const old=apply(fixture(),'moonlit'),multi=multiple(old),identity=createHistoryIdentity(multi,identityContext()),legacy=structuredClone(visualBase(multi)),global=structuredClone(legacy!.environment)
    const upper=scopedApply(multi,identity,'daylight','upper-layer')
    expect(visualBase(upper)!.filters[ATMOSPHERE_EFFECT_IDS.filter]).toEqual(legacy!.filters[ATMOSPHERE_EFFECT_IDS.filter]);expect(visualBase(upper)!.fogs[ATMOSPHERE_EFFECT_IDS.fog]).toEqual(legacy!.fogs[ATMOSPHERE_EFFECT_IDS.fog])
    expect(Object.keys(visualBase(upper)!.filters)).toHaveLength(2);expect(visualBase(upper)!.environment).toEqual(global)
    const lower=scopedApply(upper,identity,'overcast')
    expect(visualBase(lower)!.filters[ATMOSPHERE_EFFECT_IDS.filter].floorId).toBe('floor');expect(visualBase(lower)!.fogs[ATMOSPHERE_EFFECT_IDS.fog].floorId).toBe('floor')
    expect(currentAtmospherePreset(lower,'floor',identity)).toBe('overcast');expect(currentAtmospherePreset(lower,'upper',identity)).toBe('daylight')
    expect(Object.keys(visualBase(lower)!.filters)).toHaveLength(2)
  })

  it('refuses edited/scoped/colliding slots and leaves other-Floor manual legacy records intact',()=>{
    const source=multiple(),identity=createHistoryIdentity(source,identityContext()),original=scopedApply(source,identity,'moonlit')
    const wrongIdentity=structuredClone(identity);wrongIdentity.structureTokens!.floor.topologyHash='0'.repeat(64)
    expect(()=>atmospherePresetCommands(source,'layer','dusk',wrongIdentity)).toThrow(/真实持久出生/)
    const filterId=Object.values(visualBase(original)!.filters).find(row=>row.floorId==='floor')!.id
    for(const mutate of [
      (scene:SceneDocument)=>{visualBase(scene)!.filters[filterId].exposure=1.3},
      (scene:SceneDocument)=>{visualBase(scene)!.filters[filterId].visibility='gm'},
      (scene:SceneDocument)=>{visualBase(scene)!.filters[filterId].enabled=false},
      (scene:SceneDocument)=>{visualBase(scene)!.filters[filterId].seed='manually-replaced'},
    ]){const scene=structuredClone(original);mutate(scene);const before=structuredClone(scene);expect(currentAtmospherePreset(scene,'floor',identity)).toBeNull();expect(()=>atmospherePresetCommands(scene,'layer','dusk',identity)).toThrow(/手工修改|占用/);expect(scene).toEqual(before)}
    const occupied=multiple(),occupiedIdentity=createHistoryIdentity(occupied,identityContext()),commands=atmospherePresetCommands(occupied,'layer','daylight',occupiedIdentity),command=commands.find(row=>row.type==='upsertVisualFilter')!
    if(command.type!=='upsertVisualFilter')throw new Error('missing filter')
    visualBase(occupied)!.lights[command.filter.id]={...manualLight(),id:command.filter.id}
    expect(()=>atmospherePresetCommands(occupied,'layer','daylight',occupiedIdentity)).toThrow(/身份.*占用/)
    const duplicate=structuredClone(original),old=apply(fixture(),'moonlit')
    visualBase(duplicate)!.filters[ATMOSPHERE_EFFECT_IDS.filter]=structuredClone(visualBase(old)!.filters[ATMOSPHERE_EFFECT_IDS.filter])
    visualBase(duplicate)!.fogs[ATMOSPHERE_EFFECT_IDS.fog]=structuredClone(visualBase(old)!.fogs[ATMOSPHERE_EFFECT_IDS.fog])
    const duplicateBefore=structuredClone(duplicate)
    expect(()=>atmospherePresetCommands(duplicate,'layer','dusk',identity)).toThrow(/重复预设槽位/);expect(duplicate).toEqual(duplicateBefore)
    const legacy=multiple(apply(fixture(),'moonlit')),legacyIdentity=createHistoryIdentity(legacy,identityContext());visualBase(legacy)!.filters[ATMOSPHERE_EFFECT_IDS.filter].seed='manual-record'
    const upper=scopedApply(legacy,legacyIdentity,'dusk','upper-layer')
    expect(visualBase(upper)!.filters[ATMOSPHERE_EFFECT_IDS.filter]).toEqual(visualBase(legacy)!.filters[ATMOSPHERE_EFFECT_IDS.filter])
    expect(()=>atmospherePresetCommands(legacy,'layer','dusk',legacyIdentity)).toThrow(/手工修改/)
  })

  it('checks target Floor layer/entity/visual locks while retaining unrelated locked other-Floor content',()=>{
    const original=multiple(),identity=createHistoryIdentity(original,identityContext()),prepared=scopedApply(original,identity,'moonlit')
    const otherLocked=structuredClone(prepared);otherLocked.userLayers['upper-layer'].editLocked=true
    expect(()=>scopedApply(otherLocked,identity,'dusk')).not.toThrow();expect(otherLocked.userLayers['upper-layer'].editLocked).toBe(true)
    for(const mutate of [
      (scene:SceneDocument)=>{Object.values(visualBase(scene)!.filters).find(row=>row.floorId==='floor')!.editLocked=true},
      (scene:SceneDocument)=>{scene.userLayers.extra={id:'extra',floorId:'floor',name:'locked unrelated layer in same Floor',order:1,editLocked:true}},
      (scene:SceneDocument)=>{scene.notes.locked={id:'locked',floorId:'floor',editLocked:true,visibility:'gm',anchor:{type:'point',positionMm:{x:1000,y:1000}},kind:'note',text:'protected'};scene.entityLayers.locked='layer'},
    ]){const scene=structuredClone(prepared);mutate(scene);const before=structuredClone(scene);expect(()=>scopedApply(scene,identity,'dusk')).toThrow(/锁定/);expect(scene).toEqual(before)}
  })

  it('names new slots from a fresh Floor birth and retains scoped slots when returning to a single Floor',()=>{
    const original=multiple(),identity=createHistoryIdentity(original,identityContext()),night=scopedApply(original,identity,'moonlit'),oldIds=Object.keys(visualBase(night)!.filters)
    const neutral=scopedApply(night,identity,'neutral'),beforeDelete=structuredClone(neutral),deleted=structuredClone(neutral)
    applyFloorCommand(deleted,{type:'deleteEmptyFloor',id:'floor'},{appearance:createAppearanceGraph(deleted)})
    const retired=advanceHistoryIdentity(identity,beforeDelete,deleted,identityContext()),replacement=structuredClone(deleted)
    applyFloorCommand(replacement,{type:'createFloor',id:'replacement',name:'Replacement',boundsMm:{x:0,y:0,width:24000,height:18000},outputBoundsMm:{x:0,y:0,width:24000,height:18000},newLayerId:'replacement-layer',layerName:'Replacement'})
    const fresh=advanceHistoryIdentity(retired,deleted,replacement,identityContext()),newNight=scopedApply(replacement,fresh,'moonlit','replacement-layer')
    expect(Object.keys(visualBase(newNight)!.filters).every(id=>!oldIds.includes(id))).toBe(true);expect(fresh.structureTokens!.floor).toEqual(retired.structureTokens!.floor)
    const single=structuredClone(night);applyFloorCommand(single,{type:'deleteEmptyFloor',id:'upper'},{appearance:createAppearanceGraph(single)})
    const singleIdentity=advanceHistoryIdentity(identity,night,single,identityContext())
    applyFloorCommand(single,{type:'setFloorEnvironment',id:'floor',environment:null})
    const dusk=scopedApply(single,singleIdentity,'dusk')
    expect(Object.keys(visualBase(dusk)!.filters)).toEqual(oldIds);expect(visualBase(dusk)!.filters[ATMOSPHERE_EFFECT_IDS.filter]).toBeUndefined()
  })
})
