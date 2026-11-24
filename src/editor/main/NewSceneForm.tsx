import { useState } from 'react'
import SceneweaveLoading from '../main-shell/SceneweaveLoading'
import { BLANK_PRESETS, BLANK_SCENE_LIMITS, validateBlankForm, type BlankPreset } from './blank-settings'
import { formatLengthInput, parseLengthInput } from '../native-canvas/length-input'
import './new-scene-form.css'

export type NewSceneOptions = { title: string; widthMm: number; heightMm: number; preset: BlankPreset; visualPalette?: 'original' | 'island' | 'coast' | 'interior' }

export default function NewSceneForm({ busy, onCreate, onCancel, failure, cancellable = false, visualPack = false }: { busy: boolean; onCreate: (options: NewSceneOptions) => void; onCancel: () => void; failure?: string | null; cancellable?: boolean; visualPack?: boolean }) {
  const [title, setTitle] = useState('未命名场景'), [width, setWidth] = useState(visualPack ? '24' : '14'), [height, setHeight] = useState(visualPack ? '18' : '10')
  const [preset, setPreset] = useState<BlankPreset>('investigation'), [error, setError] = useState<string | null>(null)
  const [visualPalette, setVisualPalette] = useState<NonNullable<NewSceneOptions['visualPalette']>>('original')
  const [unit, setUnit] = useState<'m' | 'ft'>('m'), [sizePreset, setSizePreset] = useState(visualPack ? '24000,18000' : '14000,10000')
  const changeUnit = (next: 'm' | 'ft') => {
    try {
      const widthMm = parseLengthInput(width, unit), heightMm = parseLengthInput(height, unit)
      setWidth(formatLengthInput(widthMm, next)); setHeight(formatLengthInput(heightMm, next)); setUnit(next); setError(null)
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false }
  }
  const presetHelp = { investigation: '调查：适合探索房间与查找线索，使用米制，默认隐藏格线。', tactical: '战术：适合按格移动和战斗，使用英尺，显示 5 英尺方格。', narrative: '叙事：适合自由描述距离，使用米制，默认隐藏格线。' }[preset]
  return <form onSubmit={event => {
    event.preventDefault()
    if (busy) return
    try {
      const options = { title: title.trim(), widthMm: parseLengthInput(width, unit), heightMm: parseLengthInput(height, unit), preset }
      validateBlankForm(options.title, options.widthMm, options.heightMm)
      setError(null); onCreate({ ...options, ...(visualPack ? { visualPalette } : {}) })
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }}>
    {busy && <div className="asset-new-loading"><SceneweaveLoading label={cancellable ? '正在准备素材…' : '正在保存新场景…'}/></div>}
    <div hidden={busy}>
      <p>{visualPack ? '选择原创素材组，从一片可编辑的平地开始。' : '创建后即可在平地上画房、修路和布置植被。'}</p>
      <p className="workspace-start-help">工程会自动保存在此浏览器。</p>
      <fieldset className="asset-new-fields" disabled={busy}>
        {visualPack && <label>原创素材组<select aria-label="原创素材组" value={visualPalette} onChange={event => setVisualPalette(event.target.value as NonNullable<NewSceneOptions['visualPalette']>)}><option value="original">通用视觉 · 24项</option><option value="island">岬湾苔岛 · 13项精修</option><option value="coast">潮痕浅湾 · 15项精修</option><option value="interior">灯下旅舍 · 23项精修</option></select></label>}
        <label>场景名称<input aria-label="场景名称" value={title} maxLength={BLANK_SCENE_LIMITS.maxTitleLength} required onChange={event => setTitle(event.target.value)}/></label>
        <label>使用方式<select aria-label="使用预设" value={preset} onChange={event => { const next = event.target.value as BlankPreset; if (changeUnit(next === 'tactical' ? 'ft' : 'm')) setPreset(next) }}>{BLANK_PRESETS.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <small>{presetHelp} 只改变显示与网格，可继续调整画布尺寸。</small>
        <label>常用画布尺寸<select aria-label="常用画布尺寸" value={sizePreset} onChange={event => {
          const next = event.target.value; setSizePreset(next)
          if (next) { const [widthMm, heightMm] = next.split(',').map(Number); setWidth(formatLengthInput(widthMm, unit)); setHeight(formatLengthInput(heightMm, unit)); setError(null) }
        }}><option value="14000,10000">小场景 · 14 × 10 米</option><option value="24000,18000">中场景 · 24 × 18 米</option><option value="36000,24000">大场景 · 36 × 24 米</option><option value="48000,36000">广阔场景 · 48 × 36 米</option><option value="">自定尺寸</option></select></label>
        <label>尺寸单位<select aria-label="画布尺寸单位" value={unit} onChange={event => changeUnit(event.target.value as 'm' | 'ft')}><option value="m">米 · m</option><option value="ft">英尺 · ft</option></select></label>
        <div className="asset-new-dimensions">
          <label>画布宽度 · {unit}<input aria-label="画布宽度" type="number" step="any" required value={width} onChange={event => { setWidth(event.target.value); setSizePreset('') }}/></label>
          <label>画布高度 · {unit}<input aria-label="画布高度" type="number" step="any" required value={height} onChange={event => { setHeight(event.target.value); setSizePreset('') }}/></label>
        </div>
        <small>边长 1–200 米，长宽比不超过 20。尺寸按最近 1 mm 保存，切换单位不改变地图大小。</small>
      </fieldset>
      {(error || failure) && <p className="asset-form-error" role="alert">{error ?? failure}</p>}
    </div>
    <div className="modal-actions">
      <button className="secondary" type="button" disabled={busy && !cancellable} onClick={onCancel}>取消</button>
      {!busy && <button className="primary" type="submit">创建空白场景</button>}
    </div>
  </form>
}
