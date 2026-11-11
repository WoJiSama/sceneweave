import { useEffect, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import type { HistoryIdentity } from '../../shared/model/history'
import { ATMOSPHERE_PRESETS, atmospherePresetCommands, atmospherePresetUnavailable, currentAtmospherePreset, usesFloorAtmosphere, type AtmospherePresetId } from './atmosphere-presets'

export default function AtmospherePresets({ scene, layerId, historyIdentity, disabled, onPreview }: {
  scene: SceneDocument; layerId: string; historyIdentity?:HistoryIdentity;disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const floor = scene.floors[scene.userLayers[layerId]?.floorId]
  const current = currentAtmospherePreset(scene,floor?.id,historyIdentity)
  const [selected, setSelected] = useState<AtmospherePresetId>(current ?? 'daylight')
  const [error, setError] = useState<string | null>(null)
  const recipe = ATMOSPHERE_PRESETS.find(value => value.id === selected)!
  const unavailable = atmospherePresetUnavailable(scene, layerId,historyIdentity),floorScoped=usesFloorAtmosphere(scene,floor?.id??'',historyIdentity),scopeName=floorScoped?'本层':'全图'
  useEffect(()=>{setSelected(current??'daylight');setError(null)},[floor?.id])
  return <section className="workspace-control-section" aria-label="氛围预设">
    <h3>氛围预设</h3>
    {floorScoped?<p>当前楼层「{floor?.name??'未选择'}」：环境光、调色和预设薄雾只作用于这一层。新增效果为公开内容，该层的主持人与玩家输出都会应用。</p>:<p>环境光与调色作用于全图；预设薄雾覆盖当前楼层「{floor?.name ?? '未选择'}」的完整边界。新增效果为公开内容，主持人与玩家输出都会应用。</p>}
    <p>预设会替换{scopeName}环境设置，保留独立灯光、区域雾和滤镜。中性只移除预设自身的调色与薄雾；其他效果仍会叠加。</p>
    <p role="status">{current ? `当前预设：${ATMOSPHERE_PRESETS.find(value => value.id === current)!.name}。` : '当前为自定环境或已调整的预设。'} 切换后先审阅，再确认采用。</p>
    {unavailable && <p role="status">{unavailable}</p>}
    <label>选择氛围<select aria-label="氛围预设" disabled={disabled || !!unavailable} value={selected} onChange={event => { setSelected(event.target.value as AtmospherePresetId); setError(null) }}>
      {ATMOSPHERE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select></label>
    <p>{floorScoped&&recipe.id==='neutral'?'恢复当前楼层的中性环境，移除本层预设的调色和薄雾。':recipe.description}</p>
    <details className="workspace-advanced"><summary>预设配方与作用范围</summary>
      <dl className="asset-facts"><dt>{scopeName}环境色</dt><dd>{recipe.environment.ambientColor} · 强度 {recipe.environment.ambientOpacity}</dd>
        <dt>{scopeName}曝光与光向</dt><dd>{recipe.environment.exposure} · {recipe.environment.lightDirectionDeg}°</dd>
        <dt>接触阴影</dt><dd>{recipe.environment.contactShadowMm} mm · 强度 {recipe.environment.contactShadowOpacity}</dd>
        <dt>{scopeName}调色</dt><dd>{recipe.filter ? `曝光 ${recipe.filter.exposure} · 饱和度 ${recipe.filter.saturation} · 对比度 ${recipe.filter.contrast} · 暗角 ${recipe.filter.vignette}` : '移除预设调色'}</dd>
        <dt>楼层薄雾</dt><dd>{recipe.fog ? `${recipe.fog.color} · 透明度 ${recipe.fog.opacity} · 纹理尺度 ${recipe.fog.scaleMm} mm` : '移除预设薄雾'}</dd>
      </dl><p>{floorScoped?'每个楼层的预设':'预设'}最多使用一条调色和一条薄雾，重复切换不会新增叠层。已被手工改过或锁定的预设记录须先明确处理；影响范围中的锁定对象也会阻止采用。</p>
    </details>
    <button type="button" className="primary asset-wide" disabled={disabled || !!unavailable} onClick={() => {
      try {
        setError(null)
        const commands = atmospherePresetCommands(scene, layerId, selected,historyIdentity)
        if (!commands.length) { setError('当前已采用这套预设，没有需要修改的内容。'); return }
        onPreview(commands, floorScoped?`氛围预设 · ${recipe.name} · 楼层「${floor?.name??'未选择'}」环境、调色与薄雾`:`氛围预设 · ${recipe.name} · 全图环境与调色、当前楼层薄雾`)
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    }}>预览氛围预设</button>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </section>
}
