import type { SceneCommand } from '../../shared/commands/commands'
import { geometryIdentityIds } from '../../shared/commands/domain'
import type { SceneDocument } from '../../shared/model/scene'
import type { HistoryIdentity } from '../../shared/model/history'
import { structureIdentityDescriptors } from '../../shared/history/structure-identity'
import { resolveFloorOutput } from '../../shared/floors/output'
import { canonicalJson } from '../../shared/validation/json'
import { sha256Text } from '../../shared/validation/hash'
import { visualBase } from '../../shared/visual/base'
import { emptyVisualSystem, type VisualEnvironment, type VisualFilter, type VisualFog } from '../../shared/visual/types'

export const ATMOSPHERE_PRESETS = [
  { id: 'neutral', name: '中性', description: '恢复中性全图环境，移除本预设的调色和薄雾。',
    environment: emptyVisualSystem().environment, filter: null, fog: null },
  { id: 'daylight', name: '白昼', description: '温和日光、清晰颜色与轻接触阴影。',
    environment: { ambientColor: '#FFF1D8', ambientOpacity: .06, exposure: 1.04, lightDirectionDeg: 135, contactShadowMm: 100, contactShadowOpacity: .14 },
    filter: { preset: 'neutral', exposure: 1, saturation: 1.05, contrast: 1.03, vignette: 0, grain: 0 }, fog: null },
  { id: 'overcast', name: '阴天', description: '柔和冷光、低对比度与很淡的灰蓝薄雾。',
    environment: { ambientColor: '#CAD8E4', ambientOpacity: .12, exposure: .98, lightDirectionDeg: 135, contactShadowMm: 70, contactShadowOpacity: .12 },
    filter: { preset: 'cool', exposure: 1, saturation: .86, contrast: .94, vignette: 0, grain: 0 },
    fog: { color: '#DAE2E5', opacity: .035, directionDeg: 25, scaleMm: 6000 } },
  { id: 'dusk', name: '黄昏', description: '暖色斜光、柔和暗角与少量暖雾。',
    environment: { ambientColor: '#ECC499', ambientOpacity: .2, exposure: .95, lightDirectionDeg: 55, contactShadowMm: 180, contactShadowOpacity: .25 },
    filter: { preset: 'warm', exposure: .98, saturation: .9, contrast: 1.03, vignette: .06, grain: 0 },
    fog: { color: '#E6CAB3', opacity: .025, directionDeg: 55, scaleMm: 6000 } },
  { id: 'moonlit', name: '月夜', description: '保留地图可读性的冷月色与薄雾；已有局部灯光继续生效。',
    environment: { ambientColor: '#7892BC', ambientOpacity: .28, exposure: .9, lightDirectionDeg: 315, contactShadowMm: 120, contactShadowOpacity: .19 },
    filter: { preset: 'moonlight', exposure: .96, saturation: .72, contrast: 1.04, vignette: .09, grain: 0 },
    fog: { color: '#AABBD5', opacity: .045, directionDeg: 315, scaleMm: 6000 } },
] as const satisfies readonly { id: string; name: string; description: string; environment: VisualEnvironment
  filter: Pick<VisualFilter, 'preset' | 'exposure' | 'saturation' | 'contrast' | 'vignette' | 'grain'> | null
  fog: Pick<VisualFog, 'color' | 'opacity' | 'directionDeg' | 'scaleMm'> | null }[]

export type AtmospherePresetId = typeof ATMOSPHERE_PRESETS[number]['id']
/** Original global slots stay fixed for legacy single-Floor projects. */
export const ATMOSPHERE_EFFECT_IDS = Object.freeze({ filter: 'sceneweave:atmosphere:filter', fog: 'sceneweave:atmosphere:fog' })
type Preset = typeof ATMOSPHERE_PRESETS[number]
type Effect = VisualFilter | VisualFog
const own = <T>(values: Record<string, T>, id: string): T | undefined => Object.hasOwn(values, id) ? values[id] : undefined
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const recordSeed = (kind: 'filter' | 'fog', preset: AtmospherePresetId, record: Omit<Effect, 'seed'>) =>
  `atmosphere-1:${kind}:${preset}:${sha256Text(canonicalJson(record))}`

/** A content marker detects manual changes; it is not a validation or permission credential. */
function ownedPreset(kind: 'filter' | 'fog', value: Effect, expectedId: string = ATMOSPHERE_EFFECT_IDS[kind]): Preset | undefined {
  const { seed, ...record } = value
  if (value.id !== expectedId || value.editLocked || value.visibility !== 'public' || !value.enabled) return
  return ATMOSPHERE_PRESETS.find(preset => preset[kind] !== null
    && seed === recordSeed(kind, preset.id, record)
    && Object.entries(preset[kind]!).every(([key, expected]) => (record as unknown as Record<string, unknown>)[key] === expected)
    && (kind !== 'filter' || 'target' in value && value.target.kind === 'scene'))
}

const floorEffectIds=(floorId:string,token:string)=>{
  const prefix=`sceneweave:atmosphere:floor:${sha256Text(canonicalJson([floorId,token]))}`
  return {filter:`${prefix}:filter`,fog:`${prefix}:fog`}
}
/** A formerly multi-Floor slot remains scoped after returning to one Floor. */
export function usesFloorAtmosphere(scene:SceneDocument,floorId:string,identity?:HistoryIdentity):boolean {
  if(Object.keys(scene.floors).length!==1||scene.floors[floorId]?.environment!==undefined)return true
  const witness=identity?.structureTokens?.[floorId],visual=visualBase(scene)
  if(witness?.kind!=='floor'||!visual)return false
  const ids=floorEffectIds(floorId,witness.token)
  return !!own(visual.filters,ids.filter)||!!own(visual.fogs,ids.fog)
}
function atmosphereScope(scene:SceneDocument,floorId:string,identity?:HistoryIdentity) {
  const floor=own(scene.floors,floorId),visual=visualBase(scene)
  if(!floor||!visual)throw new Error('请先选择现存楼层及完整视觉系统。')
  if(!usesFloorAtmosphere(scene,floorId,identity))return {floor,scoped:false,ids:ATMOSPHERE_EFFECT_IDS}
  resolveFloorOutput(scene,floorId)
  const witness=identity?.structureTokens?.[floorId],descriptor=structureIdentityDescriptors(scene)[floorId]
  if(!witness||witness.kind!=='floor'||!witness.token||witness.topologyHash!==descriptor?.topologyHash)throw new Error('按层氛围需要该Floor的真实持久出生证明；请先显式建立当前结构身份。')
  const scoped=floorEffectIds(floorId,witness.token),legacy={filter:own(visual.filters,ATMOSPHERE_EFFECT_IDS.filter),fog:own(visual.fogs,ATMOSPHERE_EFFECT_IDS.fog)}
  const ownsLegacy=legacy.filter?.floorId===floorId||legacy.fog?.floorId===floorId
  const ids={filter:scoped.filter,fog:scoped.fog}
  for(const kind of ['filter','fog'] as const) {
    if(ownsLegacy&&(!legacy[kind]||legacy[kind]!.floorId===floorId))ids[kind]=ATMOSPHERE_EFFECT_IDS[kind]
    const values:Record<string,Effect>=kind==='filter'?visual.filters:visual.fogs
    if(ids[kind]!==scoped[kind]&&own(values,scoped[kind]))throw new Error('同Floor存在重复预设槽位或身份占用，请先明确处理，不能覆盖或新增叠层。')
  }
  return {floor,scoped:true,ids}
}

export function atmospherePresetUnavailable(scene: SceneDocument, layerId: string, identity?:HistoryIdentity): string | null {
  if (scene.mapMode !== 'scene') return '氛围预设目前只支持场景地图。'
  const layer = own(scene.userLayers, layerId)
  if (!layer || !own(scene.floors, layer.floorId)) return '请先选择现存楼层的绘制图层。'
  if (layer.editLocked) return '当前绘制图层已锁定，请先单独处理图层锁。'
  try { atmosphereScope(scene,layer.floorId,identity) } catch(cause) { return cause instanceof Error?cause.message:String(cause) }
  return null
}

export function currentAtmospherePreset(scene: SceneDocument, floorId?:string, identity?:HistoryIdentity): AtmospherePresetId | null {
  const visual = visualBase(scene)
  if (!visual) return null
  const floors=Object.keys(scene.floors),target=floorId??(floors.length===1?floors[0]:undefined)
  if(!target)return null
  try {
    const scope=atmosphereScope(scene,target,identity),filter=own(visual.filters,scope.ids.filter),fog=own(visual.fogs,scope.ids.fog)
    return ATMOSPHERE_PRESETS.find(preset=>equal(scope.scoped?scope.floor.environment??visual.environment:visual.environment,preset.environment)
      &&(preset.filter?!!filter&&filter.floorId===target&&ownedPreset('filter',filter,scope.ids.filter)?.id===preset.id:!filter)
      &&(preset.fog?!!fog&&fog.floorId===target&&ownedPreset('fog',fog,scope.ids.fog)?.id===preset.id:!fog))?.id??null
  } catch { return null }
}

export function atmospherePresetCommands(scene: SceneDocument, layerId: string, presetId: AtmospherePresetId, identity?:HistoryIdentity): SceneCommand[] {
  const reason = atmospherePresetUnavailable(scene, layerId,identity)
  if (reason) throw new Error(reason)
  const preset = ATMOSPHERE_PRESETS.find(value => value.id === presetId)
  if (!preset) throw new Error('请选择受支持的氛围预设。')
  const visual = visualBase(scene)
  if (!visual) throw new Error('当前工程缺少完整视觉系统。')
  const layer = scene.userLayers[layerId],scope=atmosphereScope(scene,layer.floorId,identity),floor=scope.floor
  const commands: SceneCommand[] = []
  const filter = own(visual.filters, scope.ids.filter), fog = own(visual.fogs, scope.ids.fog)
  for (const kind of ['filter', 'fog'] as const) {
    const previous = kind === 'filter' ? filter : fog
    if (previous) {
      if (previous.editLocked || scene.userLayers[previous.layerId]?.editLocked) throw new Error('已有氛围预设或所在图层已锁定，请先单独处理。')
      if (!ownedPreset(kind, previous,scope.ids[kind])) throw new Error('预设记录已被手工修改或身份被其他效果占用；请在滤镜或雾工具中明确处理后再切换。')
      if (previous.floorId !== floor.id || !own(scene.userLayers, previous.layerId)) throw new Error('已有氛围预设的楼层或图层不匹配，不能隐式迁移。')
    } else if (geometryIdentityIds(scene).has(scope.ids[kind]) || own(scene.userLayers, scope.ids[kind])) {
      throw new Error('氛围预设身份已被其他对象占用，请先明确处理该对象。')
    }
  }
  if(scope.scoped) {
    if(!equal(floor.environment??null,preset.environment))commands.push({type:'setFloorEnvironment',id:floor.id,environment:{...preset.environment}})
  } else if (!equal(visual.environment, preset.environment)) commands.push({ type: 'setVisualEnvironment', environment: { ...preset.environment } })
  const entity = (kind: 'filter' | 'fog', previous?: Effect) => ({ id: scope.ids[kind], floorId: floor.id,
    layerId: previous?.layerId ?? layerId, visibility: 'public' as const, editLocked: false, enabled: true })
  if (preset.filter) {
    const record: Omit<VisualFilter, 'seed'> = { ...entity('filter', filter), target: { kind: 'scene' }, ...preset.filter }
    const next = { ...record, seed: recordSeed('filter', preset.id, record) }
    if (!filter || !equal(filter, next)) commands.push({ type: 'upsertVisualFilter', filter: next })
  } else if (filter) commands.push({ type: 'removeVisualEffect', kind: 'filter', id: filter.id })
  if (preset.fog) {
    const b = floor.boundsMm
    const record: Omit<VisualFog, 'seed'> = { ...entity('fog', fog), boundaryMm: [
      { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
    ], ...preset.fog }
    const next = { ...record, seed: recordSeed('fog', preset.id, record) }
    if (!fog || !equal(fog, next)) commands.push({ type: 'upsertVisualFog', fog: next })
  } else if (fog) commands.push({ type: 'removeVisualEffect', kind: 'fog', id: fog.id })
  // Existing command handling retains full geometry/dependency locks, budgets,
  // player projection, resource checks, checkpoint freshness and atomic history.
  return commands
}
