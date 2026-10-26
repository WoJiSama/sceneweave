import { useState } from 'react'
import { BLANK_PRESETS, BLANK_SCENE_LIMITS, validateBlankOptions, type BlankPreset } from './blank-settings'

export type NewSceneOptions = { title: string; widthMm: number; heightMm: number; preset: BlankPreset; visualPalette?: 'original' | 'island' | 'coast' | 'interior' }

export default function NewSceneForm({ busy, onCreate, onCancel, failure, cancellable = false, visualPack = false }: { busy: boolean; onCreate: (options: NewSceneOptions) => void; onCancel: () => void; failure?: string | null; cancellable?: boolean; visualPack?: boolean }) {
  const [title, setTitle] = useState('未命名场景'), [width, setWidth] = useState(visualPack ? '24000' : '14000'), [height, setHeight] = useState(visualPack ? '18000' : '10000')
  const [preset, setPreset] = useState<BlankPreset>('investigation'), [error, setError] = useState<string | null>(null)
  const [visualPalette, setVisualPalette] = useState<NonNullable<NewSceneOptions['visualPalette']>>('original')
  return <form onSubmit={event => {
    event.preventDefault()
    const options = { title: title.trim(), widthMm: Number(width), heightMm: Number(height), preset }
    try { validateBlankOptions(options); setError(null); onCreate({ ...options, ...(visualPack ? { visualPalette } : {}) }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }}>
    <p>{visualPack ? '选择原创素材，从空白画布制作海岸、岩岛或室内。材质与道具可手工使用，也可明确授权给AI；不预放房间、地形或物件。' : '从空白画布开始。内置素材可逐件放入，场景中不预放房间、地形或物件。'}</p>
    <fieldset className="asset-new-fields" disabled={busy}>
      {visualPack && <label>原创素材组<select aria-label="原创素材组" value={visualPalette} onChange={event => setVisualPalette(event.target.value as NonNullable<NewSceneOptions['visualPalette']>)}><option value="original">通用视觉 · 24项</option><option value="island">岬湾苔岛 · 13项精修</option><option value="coast">潮痕浅湾 · 15项精修</option><option value="interior">灯下旅舍 · 23项精修</option></select></label>}
      <label>场景名称<input aria-label="场景名称" value={title} maxLength={BLANK_SCENE_LIMITS.maxTitleLength} required onChange={event => setTitle(event.target.value)}/></label>
      <div className="asset-new-dimensions">
        <label>画布宽度 · mm<input aria-label="画布宽度" type="number" step="1" required value={width} onChange={event => setWidth(event.target.value)}/></label>
        <label>画布高度 · mm<input aria-label="画布高度" type="number" step="1" required value={height} onChange={event => setHeight(event.target.value)}/></label>
      </div>
      <label>使用预设<select aria-label="使用预设" value={preset} onChange={event => setPreset(event.target.value as BlankPreset)}>{BLANK_PRESETS.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <small>边长 1–200 m，长宽比不超过 20。预设只设置距离显示与网格，世界坐标均为毫米。</small>
    </fieldset>
    {(error || failure) && <p className="asset-form-error" role="alert">{error ?? failure}</p>}
    <div className="modal-actions"><button className="secondary" type="button" disabled={busy && !cancellable} onClick={onCancel}>取消</button><button className="primary" disabled={busy} type="submit">{busy ? cancellable ? '正在准备素材…' : '正在保存新场景…' : '创建空白场景'}</button></div>
  </form>
}
