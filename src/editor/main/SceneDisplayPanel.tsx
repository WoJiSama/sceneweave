import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneDisplayCommand } from '../../shared/commands/scene-display'
import { BLANK_PRESETS } from './blank-settings'

export default function SceneDisplayPanel({ scene, disabled, onPreview }: {
  scene: SceneDocument; disabled: boolean; onPreview: (commands: SceneDisplayCommand[], description: string) => void
}) {
  const [display, setDisplay] = useState(scene.units.display), [mode, setMode] = useState(scene.presetSnapshot.distanceMode)
  const [grid, setGrid] = useState(String(scene.units.gridSizeMm)), [snap, setSnap] = useState(String(scene.units.snapMm)), [visible, setVisible] = useState(scene.units.gridVisible)
  const [preset, setPreset] = useState(''), [error, setError] = useState<string | null>(null)
  return <details className="scene-display-panel">
    <summary>单位与格线</summary>
    <p className="asset-muted">应用调查、战术或叙事的显示习惯，保留场景的毫米尺寸与原预设来源。编辑坐标仍以 mm 输入。</p>
    <fieldset disabled={disabled}>
      <label>显示预设<select aria-label="场景显示预设" value={preset} onChange={event => {
        setPreset(event.target.value)
        const value = BLANK_PRESETS.find(item => item.id === event.target.value)
        if (!value) return
        setDisplay(value.display); setMode(value.distanceMode); setGrid(String(value.gridSizeMm)); setSnap(String(value.snapMm)); setVisible(value.gridVisible); setError(null)
      }}><option value="">自定义显示</option>{BLANK_PRESETS.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label>显示单位<select aria-label="场景显示单位" value={display} onChange={event => { setDisplay(event.target.value as typeof display); setPreset('') }}><option value="m">米</option><option value="ft">英尺</option></select></label>
      <label>距离习惯<select aria-label="场景距离习惯" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setPreset('') }}><option value="metric">按实际距离</option><option value="grid">按格线距离</option><option value="abstract">抽象距离</option></select></label>
      <label>格距 · mm<input aria-label="场景格距" type="number" min="1" step="1" value={grid} onChange={event => { setGrid(event.target.value); setPreset('') }}/></label>
      <label>吸附 · mm<input aria-label="场景吸附" type="number" min="1" step="1" value={snap} onChange={event => { setSnap(event.target.value); setPreset('') }}/></label>
      <label className="composition-check"><input aria-label="场景显示格线" type="checkbox" checked={visible} onChange={event => { setVisible(event.target.checked); setPreset('') }}/>显示格线</label>
      {error && <p role="alert" className="asset-form-error">{error}</p>}
      <button className="secondary asset-wide" onClick={() => {
        const gridSizeMm = Number(grid), snapMm = Number(snap)
        if (![gridSizeMm, snapMm].every(value => Number.isSafeInteger(value) && value > 0)) { setError('格距和吸附必须为大于零的整数毫米。'); return }
        setError(null)
        onPreview([{ type: 'setSceneDisplay', display, distanceMode: mode, gridSizeMm, snapMm, gridVisible: visible }], '修改显示单位、距离习惯与格线；保留毫米几何')
      }}>预览显示设置</button>
    </fieldset>
  </details>
}
