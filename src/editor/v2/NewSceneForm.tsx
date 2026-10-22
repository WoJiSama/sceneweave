import { useState } from 'react'
import { BLANK_PRESETS_V2, BLANK_SCENE_LIMITS_V2, validateBlankOptionsV2, type BlankPresetV2 } from './blank-settings'

export type NewSceneOptionsV2 = { title: string; widthMm: number; heightMm: number; preset: BlankPresetV2 }

export default function NewSceneForm({ busy, onCreate, onCancel, failure, cancellable = false }: { busy: boolean; onCreate: (options: NewSceneOptionsV2) => void; onCancel: () => void; failure?: string | null; cancellable?: boolean }) {
  const [title, setTitle] = useState('未命名场景'), [width, setWidth] = useState('14000'), [height, setHeight] = useState('10000')
  const [preset, setPreset] = useState<BlankPresetV2>('investigation'), [error, setError] = useState<string | null>(null)
  return <form onSubmit={event => {
    event.preventDefault()
    const options = { title: title.trim(), widthMm: Number(width), heightMm: Number(height), preset }
    try { validateBlankOptionsV2(options); setError(null); onCreate(options) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }}>
    <p>从空白画布开始。内置素材可逐件放入，场景中不预放房间、地形或物件。</p>
    <fieldset className="asset-new-fields" disabled={busy}>
      <label>场景名称<input aria-label="场景名称" value={title} maxLength={BLANK_SCENE_LIMITS_V2.maxTitleLength} required onChange={event => setTitle(event.target.value)}/></label>
      <div className="asset-new-dimensions">
        <label>画布宽度 · mm<input aria-label="画布宽度" type="number" step="1" required value={width} onChange={event => setWidth(event.target.value)}/></label>
        <label>画布高度 · mm<input aria-label="画布高度" type="number" step="1" required value={height} onChange={event => setHeight(event.target.value)}/></label>
      </div>
      <label>使用预设<select aria-label="使用预设" value={preset} onChange={event => setPreset(event.target.value as BlankPresetV2)}>{BLANK_PRESETS_V2.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <small>边长 1–200 m，长宽比不超过 20。预设只设置距离显示与网格，世界坐标均为毫米。</small>
    </fieldset>
    {(error || failure) && <p className="asset-form-error" role="alert">{error ?? failure}</p>}
    <div className="modal-actions"><button className="secondary" type="button" disabled={busy && !cancellable} onClick={onCancel}>取消</button><button className="primary" disabled={busy} type="submit">{busy ? cancellable ? '正在准备素材…' : '正在保存新场景…' : '创建空白场景'}</button></div>
  </form>
}
