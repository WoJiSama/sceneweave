import { useState, type ReactNode } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { inspectImageEnhancementTarget } from '../../platform/browser/content/image-enhancement'
import { ART_STYLE_DEFAULTS, ART_STYLE_PRESETS, CURRENT_BITMAP_LINE_VERSION, CURRENT_LINE_ART_PAINT_VERSION, defaultSceneArtStyle, enabledArtStylePresets, setArtStyleEnabled, upgradeSceneArtStyle,
  type ArtStyleParameters, type ArtStylePreset, type ArtStyleRecipe, type SceneArtStyle, type SceneTheme, type ThemeEffects } from '../../shared/visual/art-style'
import type { ColorFilter } from '../../shared/visual/color-filter'
import { ArtStyleSlider, ColorFilterControls } from './ColorFilterControls'
import { artStylePresetLabels as labelFor, artStyleSideLabel, type ArtStyleAlternatives, type ArtStyleSide } from './art-style-labels'
const sliders: { key: keyof ArtStyleParameters; label: string; signed?: boolean; detail?: boolean; structural?: boolean }[] = [
  { key: 'depth', label: '厚重感', structural: true },
  { key: 'warmth', label: '冷暖', signed: true },
  { key: 'grain', label: '颗粒感' },
  { key: 'strength', label: '总强度' },
  { key: 'saturation', label: '色彩浓度', signed: true, detail: true },
  { key: 'contrast', label: '对比度', signed: true, detail: true },
  { key: 'ink', label: '墨线强度', structural: true, detail: true },
  { key: 'grainSize', label: '颗粒粗细', detail: true },
]

interface Props {
  value: SceneArtStyle
  disabled: boolean
  dirty: boolean
  ready: boolean
  comparing: boolean
  alternatives?: ArtStyleAlternatives
  selectedSide: ArtStyleSide
  hasStructuredArtwork: (version: ArtStyleRecipe['paintVersion']) => boolean
  selectedBitmap: (version: ArtStyleRecipe['paintVersion']) => boolean
  localPaint?: { project: EditableProject; id: string; open: () => void }
  onChange: (value: SceneArtStyle) => void
  onCopyFilter: (target: ArtStyleSide, style: SceneTheme) => void
  onToggleComparison: (mode: 'alternatives' | 'baseline') => void
  onSelectSide: (side: ArtStyleSide) => void
  onAdopt: () => void
  onCancel: () => void
}

function withFilter(style: SceneTheme, preset: ArtStylePreset | undefined, filter: ColorFilter): SceneTheme {
  return preset ? { ...style, presets: { ...style.presets, [preset]: { ...style.presets[preset], filter } } } : { ...style, original: filter }
}

function ThemeEffectsControls({ value, style, structured, onChange }: {
  value: ThemeEffects; style: ArtStylePreset; structured: boolean; onChange: (value: ThemeEffects) => void
}) {
  const line = 'edgeDetail' in value ? value : undefined
  const brushLabel = line ? '提线与纸底' : style === 'tea' ? '罩染与笔触' : '手绘笔触'
  return <section className="art-style-module" aria-label="主题画法">
    <label className="art-style-toggle">
      <input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.currentTarget.checked })}/>
      <span>启用主题画法</span>
    </label>
    <fieldset disabled={!value.enabled}>
      <ArtStyleSlider label="厚重感" value={value.depth} disabled={!value.brushwork || !line && !structured}
        onChange={depth => onChange({ ...value, depth })}/>
      <ArtStyleSlider label="颗粒感" value={value.grain} onChange={grain => onChange({ ...value, grain })}/>
      {line && <ArtStyleSlider label="墨线强度" value={value.ink} disabled={!value.brushwork} onChange={ink => onChange({ ...value, ink })}/>}
      <details className="workspace-advanced">
        <summary>更多画法参数</summary>
        <div className="art-style-advanced">
          <ArtStyleSlider label="画法强度" value={value.strength} onChange={strength => onChange({ ...value, strength })}/>
          <ArtStyleSlider label="颗粒粗细" value={value.grainSize} onChange={grainSize => onChange({ ...value, grainSize })}/>
          <label className="art-style-toggle">
            <input type="checkbox" checked={value.brushwork} onChange={event => onChange({ ...value, brushwork: event.currentTarget.checked })}/>
            <span>{brushLabel}</span>
          </label>
          {line ? <>
            <ArtStyleSlider label="提线细节" value={line.edgeDetail} disabled={!value.brushwork} onChange={edgeDetail => onChange({ ...line, edgeDetail })}/>
            <ArtStyleSlider label="灯雾淡化" value={line.lightFade} disabled={!value.brushwork} onChange={lightFade => onChange({ ...line, lightFade })}/>
          </> : <ArtStyleSlider label="墨线强度" value={value.ink} disabled={!value.brushwork || !structured} onChange={ink => onChange({ ...value, ink })}/>}
        </div>
      </details>
      {line && <p className="asset-muted">原生地图按组件结构绘制。导入图片在本机提线，能保留的轮廓取决于原图。</p>}
      {!line && !structured && <p className="asset-muted">普通图片支持调色和纸纹。厚重感与笔触可用于有分层结构的素材。</p>}
    </fieldset>
  </section>
}

export default function ArtStylePanel({ value, disabled, dirty, ready, comparing, alternatives, selectedSide, hasStructuredArtwork, selectedBitmap, localPaint, onChange, onCopyFilter, onToggleComparison, onSelectSide, onAdopt, onCancel }: Props) {
  const target = alternatives ? selectedSide : 'map'
  const [editing, setEditing] = useState<Partial<Record<'map' | ArtStyleSide, ArtStylePreset>>>({})
  const enabled = enabledArtStylePresets(value.active)
  const selectedPreset = (style: SceneArtStyle, target: 'map' | ArtStyleSide) => {
    const active = enabledArtStylePresets(style.active), preferred = editing[target]
    return preferred && active.includes(preferred) ? preferred : active[0]
  }
  const current = selectedPreset(value, target)
  const parameters = value.version === 1 && current ? value.presets[current] ?? ART_STYLE_DEFAULTS[current] : null
  const lineArt = current === 'lineArt'
  const structural = !!parameters && !lineArt && hasStructuredArtwork(parameters.paintVersion)
  const bitmapSelected = !!parameters && !lineArt && selectedBitmap(parameters.paintVersion)
  const editPreset = (preset: ArtStylePreset) => setEditing(current => ({ ...current, [target]: preset }))
  const toggle = (preset: ArtStylePreset, checked: boolean) => {
    if (checked) editPreset(preset)
    const active = setArtStyleEnabled(value.active, preset, checked)
    if (value.version === 2) { onChange({ ...value, active }); return }
    const presets = checked && preset === 'lineArt' && !value.presets.lineArt
      ? { ...value.presets, lineArt: { ...ART_STYLE_DEFAULTS.lineArt } } : value.presets
    onChange({ ...value, presets, active })
  }
  const update = (next: ArtStyleRecipe) => {
    if (value.version === 1 && current) onChange({ ...value, presets: { ...value.presets, [current]: next } })
  }
  const effects = value.version === 2 && current ? value.presets[current].effects : undefined
  const filter = value.version === 2 ? current ? value.presets[current].filter : value.original : undefined
  const other = selectedSide === 'a' ? 'b' : 'a'
  const destination = alternatives?.[other]
  const copyTarget = destination && selectedPreset(destination, other)
  const canPaintStructure = current === 'lineArt' || hasStructuredArtwork(ART_STYLE_DEFAULTS.handDrawn.paintVersion) && !selectedBitmap(ART_STYLE_DEFAULTS.handDrawn.paintVersion)
  const restore = () => {
    if (!current) return
    if (value.version === 1) { update({ ...ART_STYLE_DEFAULTS[current] }); return }
    onChange({ ...value, presets: { ...value.presets, [current]: defaultSceneArtStyle().presets[current] } })
  }
  const canUpdateLineArt = lineArt && parameters?.paintVersion !== CURRENT_LINE_ART_PAINT_VERSION
  const paintSliders = (detail: boolean): ReactNode => parameters && sliders.filter(row => (!!row.detail && !(lineArt && row.key === 'ink')) === detail).map(({ key, label, signed, structural: requiresVector }) => {
    const percent = parameters[key]
    return <label key={key} className="art-style-slider">
      <span>{label}</span><output>{signed && percent > 0 ? '+' : ''}{percent}%</output>
      <input type="range" aria-label={label} min={signed ? -100 : 0} max={100} step={1} value={percent}
        disabled={requiresVector && !lineArt && (!structural || bitmapSelected)}
        onChange={event => update({ ...parameters, [key]: event.currentTarget.valueAsNumber })}/>
    </label>
  })
  return <fieldset disabled={disabled} aria-label="全图画风">
    <div className="art-style-actions" role="group" aria-label="画风对比方式">
      <button type="button" className="secondary" aria-pressed={!!alternatives} onClick={() => onToggleComparison('alternatives')}>
        {alternatives ? '退出两侧对比' : '两侧画风对比'}
      </button>
      {!alternatives && <button type="button" className="secondary" aria-pressed={comparing} onClick={() => onToggleComparison('baseline')}>
        {comparing ? '关闭前后对比' : '前后对比'}
      </button>}
    </div>
    {alternatives && <div className="art-style-parameters" role="group" aria-label="选择调整哪一侧">
      {(['a', 'b'] as const).map(side => <button type="button" key={side} aria-pressed={selectedSide === side} onClick={() => onSelectSide(side)}>
        <span>{artStyleSideLabel(side, alternatives[side])}</span>
      </button>)}
    </div>}
    <div className="art-style-presets" role="group" aria-label="启用画风">
      {ART_STYLE_PRESETS.map(preset => <label className="art-style-toggle" key={preset}>
        <input type="checkbox" checked={enabled.includes(preset)} onChange={event => toggle(preset, event.currentTarget.checked)}/>
        <span>{labelFor[preset]}</span>
      </label>)}
    </div>
    {!enabled.length && value.version === 1 && <p className="asset-muted">当前显示原画。</p>}
    {enabled.length > 1 && <>
      <p className="asset-muted">叠加顺序为 {enabled.map(preset => labelFor[preset]).join(' → ')}。</p>
      <div className="art-style-parameters" role="group" aria-label="调整画风参数">
        {enabled.map(preset => <button type="button" key={preset} aria-pressed={current === preset}
          onClick={() => editPreset(preset)}>{labelFor[preset]}参数</button>)}
      </div>
    </>}
    {parameters && <>
      {paintSliders(false)}
      <details className="workspace-advanced">
        <summary>更多画风参数</summary>
        <div className="art-style-advanced">{paintSliders(true)}</div>
      </details>
      <p className="asset-muted">{lineArt ? '线稿会淡化灯光。导入图片可在本机降噪提线，线条取决于原图的清晰度。'
        : bitmapSelected ? '选中的图片可调色和加纸纹。需要新增局部细节时，可以框选补画。'
        : structural ? '厚重感和墨线作用于有分层笔触的矢量素材。普通图片随全图调色和加纸纹。'
          : '当前画风可调色和加纸纹。可用的分层笔触取决于素材和画风版本。'}</p>
    </>}
    {value.version === 2 && filter && <>
      <label className="asset-check"><input type="checkbox" checked={!!value.materialDrawing} onChange={event => {
        const { materialDrawing: _drawing, ...rest } = value
        onChange(event.target.checked ? { ...rest, materialDrawing: 1 } : rest)
      }}/>按材质绘制笔触</label>
      <ColorFilterControls key={`${target}:${current ?? 'original'}`} value={filter} original={!current}
        onChange={next => onChange(withFilter(value, current, next))}/>
      {current && effects && <ThemeEffectsControls value={effects} style={current} structured={canPaintStructure}
        onChange={next => onChange({ ...value, presets: { ...value.presets, [current]: { ...value.presets[current], effects: next } } })}/>}
      {destination?.version === 2 && <button type="button" className="secondary"
        onClick={() => onCopyFilter(other, withFilter(destination, copyTarget, structuredClone(filter)))}>
        复制调色到 {other.toUpperCase()} 侧{copyTarget ? ` · ${labelFor[copyTarget]}` : ' · 原画'}
      </button>}
    </>}
    <div className="art-style-actions">
      {value.version === 1 && <button type="button" className="secondary" onClick={() => onChange(upgradeSceneArtStyle(value))}>预览新版调色与画法</button>}
      {value.version === 2 && lineArt && !value.presets.lineArt.effects.bitmapLineVersion && <button type="button" className="secondary" onClick={() => {
        const line = value.presets.lineArt
        onChange({ ...value, presets: { ...value.presets, lineArt: { ...line, effects: { ...line.effects, bitmapLineVersion: CURRENT_BITMAP_LINE_VERSION } } } })
      }}>预览保留浅轮廓</button>}
      {canUpdateLineArt && parameters && <button type="button" className="secondary"
        onClick={() => update({ ...parameters, paintVersion: CURRENT_LINE_ART_PAINT_VERSION })}>使用新版位图提线</button>}
      {current && <button type="button" className="secondary" onClick={restore}>恢复此画风默认</button>}
      {localPaint && inspectImageEnhancementTarget(localPaint.project, { kind: 'prop', id: localPaint.id }) &&
        <button type="button" className="secondary" disabled={dirty} title={dirty ? '请先采用或取消全图画风草稿' : undefined}
          onClick={localPaint.open}>局部补画所选图片</button>}
    </div>
    {comparing && <p className="asset-muted">拖线移动，拖两端旋转。键盘方向键也可调整。</p>}
    {alternatives ? <div className="art-style-actions">
      <button type="button" className="primary" disabled={!ready} onClick={onAdopt}>采用 {selectedSide.toUpperCase()} 侧为全图画风</button>
    </div> : dirty && <div className="art-style-actions">
      <button type="button" className="primary" disabled={!ready} onClick={onAdopt}>采用画风</button>
      <button type="button" className="secondary" onClick={onCancel}>取消画风调整</button>
    </div>}
  </fieldset>
}
