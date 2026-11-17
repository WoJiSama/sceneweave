import { useEffect, useState } from 'react'
import type { SceneTemplateEntry } from '../../shared/scene-templates/content'
import { loadSceneTemplate } from '../../shared/scene-templates/content'
import { describeSceneTemplate, type SceneTemplateSketch } from '../../shared/scene-templates/preview'
import { renderProject } from '../../platform/browser/render/renderer'
import { validation } from '../../platform/browser/runtime'

export default function SceneTemplateGallery({ entries, selected, disabled, onSelect }: {
  entries: readonly SceneTemplateEntry[]; selected: string; disabled: boolean; onSelect: (key: string) => void
}) {
  const [rows, setRows] = useState<Record<string, { sketch: SceneTemplateSketch; thumbnail: string }>>({}), [errors, setErrors] = useState<Record<string, string>>({})
  const [query, setQuery] = useState(''), [maxWidth, setMaxWidth] = useState(''), [maxHeight, setMaxHeight] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setRows({}); setErrors({})
    void (async () => {
      for (const entry of entries) {
        try {
          const bundle = await loadSceneTemplate(entry.bytes, { ...validation, signal: controller.signal }), sketch = describeSceneTemplate(bundle.project.document)
          const canvas = await renderProject(bundle, { audience: 'gm', longEdgePx: 256, signal: controller.signal })
          controller.signal.throwIfAborted()
          const thumbnail = canvas.toDataURL('image/png'); canvas.width = canvas.height = 1
          setRows(current => ({ ...current, [entry.key]: { sketch, thumbnail } }))
        } catch (error) { if (controller.signal.aborted) return; setErrors(current => ({ ...current, [entry.key]: String(error) })) }
      }
    })()
    return () => controller.abort()
  }, [entries])
  const validSize = (text: string) => !text || Number.isFinite(Number(text)) && Number(text) > 0
  const visible = entries.filter(entry => {
    const row = rows[entry.key]
    return row && `${entry.name} ${row.sketch.rooms.map(room => room.purpose).join(' ')}`.toLowerCase().includes(query.toLowerCase())
      && validSize(maxWidth) && validSize(maxHeight) && (!maxWidth || row.sketch.widthMm <= Number(maxWidth) * 1000) && (!maxHeight || row.sketch.heightMm <= Number(maxHeight) * 1000)
  })
  return <div aria-label="场景模板图库">
    <label>名称或用途<input aria-label="筛选模板名称或用途" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <label>最大宽度（米）<input aria-label="筛选模板最大宽度米" type="number" min="0.001" step="0.1" value={maxWidth} onChange={event => setMaxWidth(event.target.value)}/></label>
    <label>最大高度（米）<input aria-label="筛选模板最大高度米" type="number" min="0.001" step="0.1" value={maxHeight} onChange={event => setMaxHeight(event.target.value)}/></label>
    {(!validSize(maxWidth) || !validSize(maxHeight)) && <p role="alert">筛选尺寸须为正数。</p>}
    <div className="scene-template-gallery">{visible.map(entry => { const row = rows[entry.key]; return <button type="button" key={entry.key} className="secondary scene-template-card" aria-pressed={entry.key === selected} disabled={disabled} onClick={() => onSelect(entry.key)}>
      <img src={row.thumbnail} alt={`${entry.name}实际内容缩略图`}/><strong>{entry.name}</strong><span>{row.sketch.widthMm / 1000}×{row.sketch.heightMm / 1000}米 · {row.sketch.rooms.length}间</span><span>{[...new Set(row.sketch.rooms.map(room => room.purpose))].join('、')}</span>
    </button> })}</div>
    {!!entries.length && <p className="asset-muted">已校验并显示{visible.length}/{entries.length}项。缩略图含主持人内容；画布轮廓用于定位，点击后检查完整资源、支撑和冲突。</p>}
    {Object.entries(errors).map(([key, error]) => <p role="alert" key={key}>模板缩略图未完成：{entries.find(entry => entry.key === key)?.name} · {error}</p>)}
  </div>
}
