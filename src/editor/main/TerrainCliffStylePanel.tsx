import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { TERRAIN_CLIFF_STYLES, terrainCliffBindings, terrainCliffStyleCommands, type TerrainCliffProfile } from '../../shared/visual/terrain-cliff-style'
import { newId } from './runtime'

export default function TerrainCliffStylePanel({ scene, areaId, disabled, onPreview }: {
  scene: SceneDocument; areaId: string; disabled: boolean
  onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const bindings = terrainCliffBindings(scene, areaId), profiles = new Set(bindings.flatMap(item => item.looks.map(look => look.renderProfile ?? 'classic')))
  const [profile, setProfile] = useState<TerrainCliffProfile>(() => profiles.size === 1 && !profiles.has('classic') ? [...profiles][0] as TerrainCliffProfile : 'rockRelief11')
  const [boundaryId, setBoundaryId] = useState(''), [error, setError] = useState('')
  const selected = boundaryId ? bindings.filter(item => item.boundary.id === boundaryId) : bindings
  const sharedIds = [...new Set(selected.flatMap(item => item.boundary.binding.kind === 'terrain' ? item.boundary.binding.sides.map(side => side.areaId) : []))].filter(id => id !== areaId)
  const preview = () => {
    try {
      const commands = terrainCliffStyleCommands(scene, { areaId, profile, ...(boundaryId ? { boundaryId } : {}) }, newId)
      if (!commands.length) { setError('当前范围已采用此画法。'); return }
      setError(''); onPreview(commands, '调整所选地形的崖壁样式')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <section aria-label="地形崖壁样式">
    <h3>崖壁样式</h3>
    <p className="asset-muted">崖面沿地形轮廓和实际高差绘制。层状断岩、风化断岩和断续露岩在斜俯视中保留各自的形态。</p>
    <fieldset disabled={disabled || scene.userLayers[scene.entityLayers[areaId]]?.editLocked}>
      <label className="asset-select">作用范围<select aria-label="地形崖壁作用范围" value={boundaryId} onChange={event => { setBoundaryId(event.target.value); setError('') }}><option value="">整块地形的绑定边缘</option>{bindings.map((item, index) => <option key={item.boundary.id} value={item.boundary.id}>边段 {index + 1}{item.boundary.binding.kind === 'terrain' && item.boundary.binding.sides.length > 1 ? ' · 与邻地共享' : ''}</option>)}</select></label>
      <label className="asset-select">崖面画法<select aria-label="地形崖面画法" value={profile} onChange={event => { setProfile(event.target.value as TerrainCliffProfile); setError('') }}>{TERRAIN_CLIFF_STYLES.map(style => <option key={style.value} value={style.value}>{style.label}</option>)}</select></label>
      <p className="asset-muted">{profiles.size > 1 ? '现有边缘使用多种画法；采用后统一所选范围。' : profiles.size ? '保留现有边缘的颜色、宽度、种子和启用状态。' : '采用时自动建立与原轮廓一致的崖壁绑定。'}地面材质在上方单独选择。</p>
      {sharedIds.length > 0 && <p role="status">所选范围包含共享边段，也会影响相邻地形：{sharedIds.join('、')}。</p>}
      <button type="button" className="secondary asset-wide" onClick={preview}>预览崖壁样式</button>
    </fieldset>
    {error && <p className="asset-form-error" role="alert">{error}</p>}
  </section>
}
