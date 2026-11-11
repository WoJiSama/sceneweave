import { useEffect, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import type { PreparedLibraryEntry } from '../../shared/library/types'
import { prepareImageImportItemVariant, prepareImageImportMaterialVariant, readImageImportItemSvg, type ImageImportItemChanges } from '../../platform/browser/content/image-import-item'
import { materializeImageImportSvg } from '../../platform/browser/content/image-import-vector'
import './image-import-tool.css'

export default function ImageImportItemEditor({ project, definitionId, kind = 'prop', disabled, onSave, onCancel, onPendingChange }: {
  project: EditableProject
  definitionId: string
  kind?: 'prop' | 'material'
  disabled: boolean
  onSave: (entry: PreparedLibraryEntry, signal: AbortSignal) => Promise<void>
  onCancel: () => void
  onPendingChange: (controller: AbortController | null) => void
}) {
  const definition = kind === 'prop' ? project.document.propDefinitions[definitionId] : null
  const material = kind === 'material' ? project.document.materials[definitionId] : null
  const [fields, setFields] = useState<ImageImportItemChanges>(() => ({ name: definition?.name ?? material!.name,
    widthMm: definition?.defaultVisualBoundsMm.width ?? material!.defaultTileSizeMm.width,
    heightMm: definition?.defaultVisualBoundsMm.height ?? material!.defaultTileSizeMm.height,
    footprintWidthMm: definition?.defaultFootprintMm.width ?? 1, footprintHeightMm: definition?.defaultFootprintMm.height ?? 1,
    blocksMovement: definition?.defaultBlocksMovement ?? false }))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [sourceSvg, setSourceSvg] = useState<string | null>(null), [sourceLoaded, setSourceLoaded] = useState(false)
  const [longEdge, setLongEdge] = useState(2048), [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewDescription, setPreviewDescription] = useState(''), [sourceDirty, setSourceDirty] = useState(false)
  const abort = useRef<AbortController | null>(null), mounted = useRef(false)
  const previewObjectUrl = useRef<string | null>(null), sourceGeneration = useRef(0)
  const pending = useRef(onPendingChange); pending.current = onPendingChange
  const clearPreview = () => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
    previewObjectUrl.current = null; setPreviewUrl(null); setPreviewDescription('')
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sourceGeneration.current++; abort.current?.abort(); if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current); pending.current(null) } }, [])
  useEffect(() => {
    const controller = new AbortController(), generation = ++sourceGeneration.current
    setSourceLoaded(false); setSourceSvg(null); setSourceDirty(false); clearPreview()
    void readImageImportItemSvg(project, definitionId, controller.signal).then(source => {
      if (!controller.signal.aborted && mounted.current && generation === sourceGeneration.current) setSourceSvg(source)
    }).catch(reason => {
      if (!controller.signal.aborted && mounted.current && generation === sourceGeneration.current) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!controller.signal.aborted && mounted.current && generation === sourceGeneration.current) setSourceLoaded(true)
    })
    return () => controller.abort()
  }, [project, definitionId, kind])
  const changeSource = (source: string) => { sourceGeneration.current++; setSourceSvg(source); setSourceLoaded(true); setSourceDirty(true); clearPreview(); setError('') }
  async function importSvg(file: File) {
    const generation = ++sourceGeneration.current
    try {
      if (file.size > 1024 * 1024) throw new Error('SVG源最多1 MiB。')
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (mounted.current && generation === sourceGeneration.current) changeSource(source)
    } catch (reason) { if (mounted.current && generation === sourceGeneration.current) setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  async function previewSvg() {
    if (abort.current || sourceSvg === null) return
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); pending.current(controller)
    const generation = sourceGeneration.current
    try {
      const result = await materializeImageImportSvg(sourceSvg, longEdge, controller.signal)
      controller.signal.throwIfAborted()
      if (!mounted.current || generation !== sourceGeneration.current) return
      clearPreview()
      const url = URL.createObjectURL(new Blob([result.pngBytes.slice().buffer], { type: 'image/png' }))
      previewObjectUrl.current = url; setPreviewUrl(url)
      setPreviewDescription(`已严格校验并栅格化为 ${result.pixelWidth} × ${result.pixelHeight} PNG。`)
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (abort.current === controller) abort.current = null; if (mounted.current) { setBusy(false); pending.current(null) } }
  }
  async function save() {
    if (abort.current) return
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); pending.current(controller)
    try {
      const svg = sourceSvg === null ? {} : { sourceSvg, targetLongEdgePx: longEdge }
      const entry = kind === 'material'
        ? await prepareImageImportMaterialVariant(project, definitionId, { name: fields.name, widthMm: fields.widthMm, heightMm: fields.heightMm, ...svg }, controller.signal)
        : await prepareImageImportItemVariant(project, definitionId, { ...fields, ...svg }, controller.signal)
      await onSave(entry, controller.signal)
    }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (abort.current === controller) abort.current = null; if (mounted.current) { setBusy(false); pending.current(null) } }
  }
  return <form className="catalog-organization" aria-label="编辑图片素材副本" onSubmit={event => { event.preventDefault(); void save() }}>
    <fieldset disabled={disabled || busy}><legend>编辑图片素材副本</legend>
      {kind === 'material' && <p className="asset-muted">宽高是材质在世界中一轮平铺的大小。</p>}
      <label>名称<input aria-label="图片素材副本名称" maxLength={120} required value={fields.name} onChange={event => setFields({ ...fields, name: event.target.value })}/></label>
      {([['widthMm', '图片宽度'], ['heightMm', '图片高度'], ...(kind === 'prop' ? [['footprintWidthMm', '占地宽度'], ['footprintHeightMm', '占地高度']] as const : [])] as const).map(([key, label]) =>
        <label key={key}>{label}（毫米）<input aria-label={`${label}毫米`} type="number" min={1} step={1} required value={fields[key]} onChange={event => setFields({ ...fields, [key]: Number(event.target.value) })}/></label>)}
      {kind === 'prop' && <label className="catalog-inline"><input aria-label="图片素材阻挡移动" type="checkbox" checked={fields.blocksMovement} onChange={event => setFields({ ...fields, blocksMovement: event.target.checked })}/>阻挡移动</label>}
      <section className="image-item-svg-editor" aria-label="素材SVG源编辑">
        <label>载入SVG源<input type="file" aria-label="载入素材SVG源" accept=".svg,image/svg+xml" onChange={event => { const file = event.target.files?.[0]; if (file) void importSvg(file); event.target.value = '' }}/></label>
        {!sourceLoaded && <p role="status">正在读取固定素材源…</p>}
        {sourceLoaded && sourceSvg === null && <p>当前素材使用像素外观，可载入受限SVG建立新的素材副本。</p>}
        {sourceSvg !== null && <><label>SVG源代码<textarea aria-label="素材SVG源代码" className="image-item-svg-source" rows={10} spellCheck={false} value={sourceSvg} onChange={event => changeSource(event.target.value)}/></label>
          <label>PNG预览与保存长边<input aria-label="SVG输出长边像素" type="number" min={64} max={4096} step={64} value={longEdge} onChange={event => { setLongEdge(Number(event.target.value)); clearPreview() }}/></label>
          <button type="button" onClick={() => void previewSvg()}>预览SVG源</button>
          {previewUrl && <img className="image-item-svg-preview" src={previewUrl} alt="当前SVG源的实际栅格化预览"/>}
          {previewDescription && <p role="status">{previewDescription}</p>}
          {sourceDirty && !previewUrl && <p>源代码已修改，点击预览查看当前形状和颜色。</p>}
        </>}
      </section>
      <p className="asset-muted">保存为“我的素材”中的独立条目，携带固定源、实际PNG和来源许可。</p>
      <div className="catalog-actions"><button type="submit">保存编辑副本到我的素材</button><button type="button" onClick={onCancel}>取消编辑副本</button></div>
    </fieldset>
    {busy && <p role="status">正在验证素材…<button type="button" onClick={() => abort.current?.abort()}>取消素材处理</button></p>}{error && <p className="asset-form-error" role="alert">{error}</p>}
  </form>
}
