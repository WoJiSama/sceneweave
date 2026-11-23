import { useState } from 'react'
import { TERRAIN_FACADES, terrainFacadeSchema, type TerrainFacade } from '../../shared/appearance/terrain-facade'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument, TerrainArea } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'

interface Props {
  area: TerrainArea
  units: SceneDocument['units']['display']
  disabled: boolean
  onPreview: (commands: SceneCommand[], description: string) => void
}

export default function TerrainFacadePanel({ area, units, disabled, onPreview }: Props) {
  const [draft, setDraft] = useState<TerrainFacade | null>(area.facade ?? null)
  const update = (changes: Partial<TerrainFacade>) => setDraft(current => current && { ...current, ...changes })
  const checked = draft && terrainFacadeSchema.safeParse(draft)
  const preview = () => {
    if (checked && !checked.success) return
    onPreview([{ type: 'updateTerrainArea', id: area.id, changes: { facade: checked ? checked.data : null } }], '设置建筑立面')
  }
  return <details className="asset-details"><summary>建筑立面</summary>
    <fieldset disabled={disabled}>
      <label>立面样式<select aria-label="立面样式" value={draft?.profile ?? ''} onChange={event => {
        const profile = event.target.value as TerrainFacade['profile'] | ''
        if (!profile) { setDraft(null); return }
        const buildingStyles = draft && profile !== 'girder-v1' && draft.profile !== 'girder-v1'
        setDraft({ ...(buildingStyles ? draft : TERRAIN_FACADES[profile]), profile })
      }}>
        <option value="">自动收边</option><option value="glazed-v1">金属框分格玻璃</option><option value="ribbed-v1">钢构百叶与竖肋</option><option value="girder-v1">平台钢梁包边</option>
      </select></label>
      {draft && <>
        <label>立面方向<select aria-label="立面方向" value={draft.facing} onChange={event => update({ facing: event.target.value as TerrainFacade['facing'] })}>
          <option value="left">左斜向</option><option value="front">正向</option><option value="right">右斜向</option>
        </select></label>
        <NumberInput label="立面可见深度" value={draft.depthMm} displayUnit={units} onCommit={depthMm => update({ depthMm })}/>
        <NumberInput label={draft.profile === 'girder-v1' ? '加劲肋间距' : '窗列节距'} value={draft.pitchMm} displayUnit={units} onCommit={pitchMm => update({ pitchMm })}/>
        <NumberInput label={draft.profile === 'girder-v1' ? '加劲肋宽度' : '立面框架厚度'} value={draft.frameMm} displayUnit={units} onCommit={frameMm => update({ frameMm })}/>
        <label>构件灯色<input aria-label="构件灯色" type="color" value={draft.lightColor} onChange={event => update({ lightColor: event.target.value })}/></label>
        <label>构件灯强度<input aria-label="构件灯强度" type="range" min="0" max="1" step=".05" value={draft.lightIntensity} onChange={event => update({ lightIntensity: event.target.valueAsNumber })}/></label>
      </>}
      <small>立面沿平台的高差边界绘制。玻璃和百叶立面延续到桥下，楼梯和坡道按实际开口裁切立面。钢梁包边在桥头附近过渡到桥梁截面。</small>
      {checked && !checked.success && <p role="alert" className="asset-form-error">可见深度为 0.25–16 米，窗列节距为 0.5–8 米，框架厚度为 0.04–1.4 米。</p>}
      <button type="button" className="secondary asset-wide" disabled={(!draft && !area.facade) || !!checked && !checked.success} onClick={preview}>预览建筑立面</button>
    </fieldset>
  </details>
}
