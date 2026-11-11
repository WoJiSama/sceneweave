import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditableProject } from '../../application/workspace/project'
import type { CatalogSelector, PreparedLibraryEntry } from '../../shared/library/types'
import { prepareAssetPrefabVariant, prepareImageImportItemVariant, prepareImageImportMaterialVariant, readImageImportItemSvg, type ImageImportItemChanges } from '../../platform/browser/content/image-import-item'
import { prepareImageEnhancementCandidate, inspectImageEnhancementTarget, type ImageEnhancementSource } from '../../platform/browser/content/image-enhancement'
import type { ImageEnhancementRecipe } from '../../shared/image-enhancement'
import { materializeImageImportSvg } from '../../platform/browser/content/image-import-vector'
import AssetEditorLayout from './AssetEditorLayout'
import ImageEnhancementPanel from './ImageEnhancementPanel'
import ImageRefinementPanel, { type ImageRefinementUnknownRequest } from './ImageRefinementPanel'
import { prepareImageRefinementCandidate, type ImageRefinementCandidate } from '../../platform/browser/content/image-refinement'
import './asset-item-editor.css'

type Section = 'appearance' | 'image' | 'source' | 'members'
type ImageAdoptionWait = { accept: () => void; cancel: () => void }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** One session draft; only the final save writes a new immutable personal entry. */
export default function ImageImportItemEditor({ project, definitionId, kind = 'prop', disabled, onSave, onCancel, onPendingChange, onEditMember }: {
  project: EditableProject
  definitionId: string
  kind?: CatalogSelector['kind']
  disabled: boolean
  onSave: (entry: PreparedLibraryEntry, signal: AbortSignal) => Promise<void>
  onCancel: () => void
  onPendingChange: (controller: AbortController | null) => void
  onEditMember?: (selector: CatalogSelector) => void
}) {
  const definition = kind === 'prop' ? project.document.propDefinitions[definitionId] : null
  const material = kind === 'material' ? project.document.materials[definitionId] : null
  const prefab = kind === 'prefab' ? project.document.prefabDefinitions[definitionId] : null
  const original = definition ?? material ?? prefab!
  const initial = useRef<ImageImportItemChanges>({ name: original.name,
    widthMm: definition?.defaultVisualBoundsMm.width ?? material?.defaultTileSizeMm.width ?? 1,
    heightMm: definition?.defaultVisualBoundsMm.height ?? material?.defaultTileSizeMm.height ?? 1,
    footprintWidthMm: definition?.defaultFootprintMm.width ?? 1, footprintHeightMm: definition?.defaultFootprintMm.height ?? 1,
    footprintOffsetXmm: definition?.defaultFootprintOffsetMm.x ?? 0, footprintOffsetYmm: definition?.defaultFootprintOffsetMm.y ?? 0,
    blocksMovement: definition?.defaultBlocksMovement ?? false, blocksSight: definition?.defaultBlocksSight ?? false })
  const [fields, setFields] = useState(initial.current), [draftProject, setDraftProject] = useState(project)
  const [selector, setSelector] = useState<CatalogSelector>({ kind, definitionId })
  const [section, setSection] = useState<Section>('appearance'), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [discard, setDiscard] = useState<{ member?: CatalogSelector } | null>(null)
  const [sourceSvg, setSourceSvg] = useState<string | null>(null), [sourceLoaded, setSourceLoaded] = useState(false), [sourceDirty, setSourceDirty] = useState(false)
  const [longEdge, setLongEdge] = useState(2048), [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imageDirty, setImageDirty] = useState(false), [imagePending, setImagePending] = useState(false), [panelKey, setPanelKey] = useState(0)
  const [refinementDirty, setRefinementDirty] = useState(false)
  const [unknownRequests, setUnknownRequests] = useState<ImageRefinementUnknownRequest[]>([])
  const [imageAdoption, setImageAdoption] = useState<string | null>(null)
  const imageAdoptionWait = useRef<ImageAdoptionWait | null>(null), imageAdoptionCancel = useRef<HTMLButtonElement>(null)
  const pendingModes = useRef({ basic: false, refinement: false })
  const [imageStarted, setImageStarted] = useState(false)
  const abort = useRef<AbortController | null>(null), imageAbort = useRef<AbortController | null>(null), mounted = useRef(false)
  const previewObjectUrl = useRef<string | null>(null), sourceGeneration = useRef(0), dialog = useRef<HTMLDialogElement>(null)
  const heading = useId(), pending = useRef(onPendingChange); pending.current = onPendingChange
  const occupied = disabled || busy || imagePending
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial.current) || draftProject !== project || sourceDirty || imageDirty || refinementDirty || unknownRequests.length > 0
  const target = selector.kind === 'prop' ? { kind: 'propDefinition' as const, id: selector.definitionId }
    : selector.kind === 'material' ? { kind: 'material' as const, id: selector.definitionId } : null
  const imageInfo = target ? inspectImageEnhancementTarget(draftProject, target) : null
  const clearPreview = () => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
    previewObjectUrl.current = null; setPreviewUrl(null)
  }
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal()
    return () => { mounted.current = false; imageAdoptionWait.current?.cancel(); sourceGeneration.current++; abort.current?.abort(); imageAbort.current?.abort(); if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current); pending.current(null) }
  }, [])
  useEffect(() => { if (imageAdoption) imageAdoptionCancel.current?.focus() }, [imageAdoption])
  useEffect(() => {
    const controller = new AbortController(), generation = ++sourceGeneration.current
    setSourceLoaded(false); setSourceSvg(null); setSourceDirty(false); clearPreview()
    if (kind === 'prefab') { setSourceLoaded(true); return () => controller.abort() }
    void readImageImportItemSvg(draftProject, selector.definitionId, controller.signal).then(source => {
      if (!controller.signal.aborted && mounted.current && generation === sourceGeneration.current) setSourceSvg(source)
    }).catch(reason => { if (!controller.signal.aborted && mounted.current && generation === sourceGeneration.current) setError(message(reason)) })
      .finally(() => { if (!controller.signal.aborted && mounted.current && generation === sourceGeneration.current) setSourceLoaded(true) })
    return () => controller.abort()
  }, [draftProject, selector.definitionId, kind])
  const requestClose = (member?: CatalogSelector) => {
    if (imageAdoptionWait.current) { imageAdoptionWait.current.cancel(); return }
    if (occupied) { setError('请先完成或取消当前素材处理。'); return }
    if (dirty) setDiscard(member ? { member } : {})
    else if (member) onEditMember?.(member)
    else onCancel()
  }
  /** A new fixed target invalidates both image panels, including their unsaved inputs. */
  function confirmImageAdoption(label: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (!mounted.current) return Promise.reject(new DOMException('素材编辑器已关闭。', 'AbortError'))
    if (imageAdoptionWait.current) return Promise.reject(new Error('请先处理当前加入图像候选的确认。'))
    return new Promise((resolve, reject) => {
      const finish = (accepted: boolean) => {
        if (imageAdoptionWait.current !== wait) return
        imageAdoptionWait.current = null; signal?.removeEventListener('abort', cancelled)
        if (mounted.current) setImageAdoption(null)
        if (accepted) resolve()
        else reject(new DOMException('已取消加入候选，当前图像草稿和输入全部保留。', 'AbortError'))
      }
      const cancelled = () => finish(false)
      const wait: ImageAdoptionWait = { accept: () => finish(true), cancel: cancelled }
      imageAdoptionWait.current = wait
      signal?.addEventListener('abort', cancelled, { once: true })
      if (signal?.aborted) cancelled()
      else setImageAdoption(label)
    })
  }
  const changeSource = (value: string) => { sourceGeneration.current++; setSourceSvg(value); setSourceDirty(true); clearPreview(); setError('') }
  async function importSvg(file: File) {
    const generation = ++sourceGeneration.current
    try {
      if (file.size > 1024 * 1024) throw new Error('SVG源最多1 MiB。')
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (mounted.current && generation === sourceGeneration.current) changeSource(value)
    } catch (reason) { if (mounted.current && generation === sourceGeneration.current) setError(message(reason)) }
  }
  async function previewSvg() {
    if (abort.current || sourceSvg === null) return
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); pending.current(controller)
    try {
      const result = await materializeImageImportSvg(sourceSvg, longEdge, controller.signal)
      controller.signal.throwIfAborted()
      if (!mounted.current) return
      clearPreview(); const url = URL.createObjectURL(new Blob([result.pngBytes.slice().buffer], { type: 'image/png' }))
      previewObjectUrl.current = url; setPreviewUrl(url)
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(message(reason)) }
    finally { if (abort.current === controller) abort.current = null; if (mounted.current) { setBusy(false); pending.current(null) } }
  }
  async function imagePreview(source: ImageEnhancementSource, recipe: ImageEnhancementRecipe, mask?: Uint8Array, signal?: AbortSignal) {
    if (sourceDirty) throw new Error('SVG源草稿尚未保存，请先保存此副本后再处理图像，或还原SVG源。')
    await confirmImageAdoption('基础处理候选', signal)
    signal?.throwIfAborted()
    const prepared = await prepareImageEnhancementCandidate(draftProject, source, recipe, mask, signal)
    signal?.throwIfAborted()
    if (!prepared.selector) throw new Error('素材图像候选缺少固定素材身份。')
    if (mounted.current) { setDraftProject(prepared.catalog); setSelector(prepared.selector); setPanelKey(value => value + 1); setImageDirty(false); setRefinementDirty(false); setError('') }
  }
  async function refinementPreview(source: ImageEnhancementSource, candidate: ImageRefinementCandidate, signal?: AbortSignal) {
    if (sourceDirty) throw new Error('SVG源草稿尚未保存，请先保存或还原SVG源。')
    await confirmImageAdoption(candidate.kind === 'vector' ? '矢量重建候选' : '模型补画候选', signal)
    signal?.throwIfAborted()
    const prepared = await prepareImageRefinementCandidate(draftProject, source, candidate, signal)
    signal?.throwIfAborted()
    if (!prepared.selector) throw new Error('素材精修候选缺少固定素材身份。')
    if (mounted.current) { setDraftProject(prepared.catalog); setSelector(prepared.selector); setPanelKey(value => value + 1); setImageDirty(false); setRefinementDirty(false); setError('') }
  }
  function imagePendingChange(value: boolean, mode: 'basic' | 'refinement' = 'basic') {
    pendingModes.current[mode] = value
    const anyPending = pendingModes.current.basic || pendingModes.current.refinement
    setImagePending(anyPending)
    if (anyPending) {
      if (imageAbort.current) return
      const controller = new AbortController(); imageAbort.current = controller
      controller.signal.addEventListener('abort', () => { if (mounted.current) { setImageStarted(false); setSection('appearance'); setImagePending(false); setImageDirty(false); setRefinementDirty(false) } }, { once: true })
      pending.current(controller)
    } else { imageAbort.current = null; if (!abort.current) pending.current(null) }
  }
  function retainUnknownRequest(request: ImageRefinementUnknownRequest) {
    if (mounted.current) setUnknownRequests(current => {
      const index = current.findIndex(value => value.id === request.id && value.service === request.service)
      return index < 0 ? [...current, request] : current.map((value, at) => at === index ? request : value)
    })
  }
  async function save() {
    if (occupied) return
    if (imageDirty || refinementDirty) { setError('请先将图像候选加入草稿，或明确丢弃图像处理草稿。'); return }
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); pending.current(controller)
    try {
      const svg = sourceDirty && sourceSvg !== null ? { sourceSvg, targetLongEdgePx: longEdge } : {}
      const entry = kind === 'material'
        ? await prepareImageImportMaterialVariant(draftProject, selector.definitionId, { name: fields.name, widthMm: fields.widthMm, heightMm: fields.heightMm, ...svg }, controller.signal)
        : kind === 'prefab' ? await prepareAssetPrefabVariant(draftProject, selector.definitionId, { name: fields.name }, controller.signal)
          : await prepareImageImportItemVariant(draftProject, selector.definitionId, { ...fields, ...svg }, controller.signal)
      await onSave(entry, controller.signal)
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(message(reason)) }
    finally { if (abort.current === controller) abort.current = null; if (mounted.current) { setBusy(false); pending.current(null) } }
  }
  const bindings = project.licenseBindings.filter(binding => binding.subjectId === definitionId && binding.subjectKind === (kind === 'prop' ? 'propDefinition' : kind === 'prefab' ? 'prefabDefinition' : 'material'))
  const licenses = [...new Set(bindings.map(binding => binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, '')))].map(hash => project.licenses[hash]).filter(Boolean)
  const navigation = <><h3>素材内容</h3>{([['appearance', '名称与尺寸'], ...(kind === 'prefab' ? [['members', '组合成员']] : [['image', '图像处理']]), ['source', '来源与许可']] as Array<[Section, string]>).map(([key, label]) => <button type="button" key={key} aria-pressed={section === key} onClick={() => { setSection(key); if (key === 'image') setImageStarted(true) }}>{label}</button>)}<hr/><p>保存为个人素材新副本。当前场景和原素材引用保持。</p></>
  const numericFields: Array<readonly ['widthMm' | 'heightMm' | 'footprintWidthMm' | 'footprintHeightMm', string]> = [['widthMm', kind === 'material' ? '平铺宽度' : '图片宽度'], ['heightMm', kind === 'material' ? '平铺高度' : '图片高度'], ...(kind === 'prop' ? [['footprintWidthMm', '占地宽度'], ['footprintHeightMm', '占地高度']] as const : [])]
  const inspector = <form id={`${heading}-form`} aria-label="编辑素材副本" onSubmit={event => { event.preventDefault(); void save() }}>
    <fieldset disabled={occupied}><legend>固定素材副本</legend><label>名称<input aria-label="素材副本名称" maxLength={120} required value={fields.name} onChange={event => setFields({ ...fields, name: event.target.value })}/></label>
      {kind !== 'prefab' && <>{kind === 'material' && <p>尺寸表示一轮材质平铺的世界大小。</p>}{numericFields.map(([key, label]) => <label key={key}>{label}（毫米）<input aria-label={`${label}毫米`} type="number" min={1} step={1} required value={fields[key]} onChange={event => setFields({ ...fields, [key]: Number(event.target.value) })}/></label>)}</>}
      {kind === 'prop' && <><label><input aria-label="素材阻挡移动" type="checkbox" checked={fields.blocksMovement} onChange={event => setFields({ ...fields, blocksMovement: event.target.checked })}/>阻挡移动</label><label><input aria-label="素材阻挡视线" type="checkbox" checked={fields.blocksSight} onChange={event => setFields({ ...fields, blocksSight: event.target.checked })}/>阻挡视线</label><details><summary>占地偏移</summary>{([['footprintOffsetXmm', 'X'], ['footprintOffsetYmm', 'Y']] as const).map(([key, label]) => <label key={key}>偏移 {label}（毫米）<input aria-label={`占地偏移${label}毫米`} type="number" step={1} value={fields[key]} onChange={event => setFields({ ...fields, [key]: Number(event.target.value) })}/></label>)}</details></>}
    </fieldset><h3>来源与许可</h3><dl className="asset-facts"><dt>原素材</dt><dd>{original.name}</dd><dt>署名</dt><dd>{original.origin.attribution}</dd><dt>固定版本</dt><dd>{original.catalogId} · v{original.version}</dd><dt>嵌入许可</dt><dd>{original.origin.canEmbed ? '源许可允许嵌入' : '不允许嵌入'}</dd></dl>{licenses.map(license => <details key={license.sha256}><summary>完整许可文本</summary><pre>{license.text}</pre></details>)}<p>来源和原许可随副本完整保留。</p>
  </form>
  const unknownRequestSummary = !!unknownRequests.length && <section className="asset-editor-note" aria-label="素材编辑中的补画请求记录" style={{ flexBasis: '100%', overflowWrap: 'anywhere' }}><p>补画请求记录。加入候选或清理图像草稿会保留这些记录；结果未确认时请先核对服务处理与费用。</p><ul>{unknownRequests.map(request => <li key={`${request.service}:${request.id}`}>{request.state === 'finished' ? '服务已返回' : request.state === 'not_sent' ? '服务拒绝，未发送到模型' : '结果未确认'} · {request.service} · <code>{request.id}</code></li>)}</ul></section>
  const canvas = <>
    {imageAdoption && <div role="alertdialog" aria-label="加入图像候选确认" className="asset-editor-note"><h3>加入{imageAdoption}</h3><p>加入成功后将切换到新的图像基线，并清理基础处理的候选和局部选区、矢量重建与模型补画的候选、参数、补画要求及连接。其他尚未采用的图像编辑不会自动合并，服务端请求的处理或计费不会因此撤销。</p><p>名称、图片尺寸、物理占地、阻挡设置和未确认请求记录保留。取消可继续当前的全部图像草稿。</p><button type="button" ref={imageAdoptionCancel} onClick={() => imageAdoptionWait.current?.cancel()}>继续当前图像草稿</button><button type="button" onClick={() => imageAdoptionWait.current?.accept()}>清理图像草稿并加入候选</button></div>}
    <div hidden={section !== 'appearance'}><div className="asset-editor-section-heading"><h3>{kind === 'material' ? '材质平铺' : kind === 'prefab' ? '组合概览' : '外观与占地'}</h3></div><AssetVisual project={draftProject} selector={selector} fields={fields} overrideUrl={previewUrl}/>{draftProject !== project && <p className="asset-editor-note">图像候选已加入当前草稿。名称、尺寸与占地输入仍保留；保存后才进入我的素材。</p>}</div>
    {kind !== 'prefab' && <div hidden={section !== 'image'}>{target && imageInfo ? <>{imageStarted && <div key={panelKey}><ImageRefinementPanel previewContext="asset" project={draftProject} target={target} disabled={disabled || busy || sourceDirty || imagePending && pendingModes.current.basic} onPreview={refinementPreview} onPendingChange={value => imagePendingChange(value, 'refinement')} onDirtyChange={setRefinementDirty} unknownRequests={unknownRequests} onUnknownRequest={retainUnknownRequest}/><details><summary>基础处理 · 插值放大、降噪与边缘</summary><ImageEnhancementPanel embedded previewContext="asset" project={draftProject} target={target} disabled={disabled || busy || sourceDirty || imagePending && pendingModes.current.refinement} onPreview={imagePreview} onClose={() => setSection('appearance')} onPendingChange={value => imagePendingChange(value)} onDirtyChange={setImageDirty}/></details></div>}{(imageDirty || refinementDirty) && <button type="button" disabled={imagePending} onClick={() => { setImageStarted(false); setImageDirty(false); setRefinementDirty(false); setSection('appearance') }}>丢弃图像处理草稿</button>}</> : <p className="asset-editor-note">此素材使用几何符号，没有可处理的固定图片。名称、尺寸与占地仍可编辑。</p>}</div>}
    <div hidden={section !== 'source'}><h3>固定来源</h3><p className="asset-editor-note">原始署名和许可在右侧完整保留。编辑生成新副本，已有工程中的素材不会被替换。</p>{imageInfo && <fieldset disabled={occupied}><legend>SVG源编辑</legend><label>载入SVG源<input type="file" aria-label="载入素材SVG源" accept=".svg,image/svg+xml" onChange={event => { const file = event.target.files?.[0]; if (file) void importSvg(file); event.target.value = '' }}/></label>{!sourceLoaded && <p role="status">正在读取固定素材源…</p>}{sourceLoaded && sourceSvg === null && <p>此素材以实际像素保存，可载入受限SVG生成新的图片副本。</p>}{sourceSvg !== null && <><label>SVG源代码<textarea aria-label="素材SVG源代码" className="image-item-svg-source" rows={12} spellCheck={false} value={sourceSvg} onChange={event => changeSource(event.target.value)}/></label><label>PNG输出长边<input aria-label="SVG输出长边像素" type="number" min={1} max={4096} value={longEdge} onChange={event => { setLongEdge(Number(event.target.value)); setSourceDirty(true); clearPreview() }}/></label><button type="button" onClick={() => void previewSvg()}>预览SVG源</button>{sourceDirty && <p>SVG源尚未保存；保存副本时会采用此源，图像处理需先完成此次保存。</p>}{previewUrl && <img className="asset-item-svg-preview" src={previewUrl} alt="当前SVG源实际栅格化预览"/>}</>}</fieldset>}</div>
    {prefab && <div hidden={section !== 'members'}><h3>组合成员 · {prefab.members.length}</h3><p>本页可编辑组合名称。成员保留原有外观、位置和阻挡规则；可前往成员素材编辑独立副本。</p><ul className="asset-item-members">{prefab.members.map(member => { const ref = member.propTemplate.definitionRef, value = ref ? project.document.propDefinitions[ref.id] : null; return <li key={member.key}><strong>{value?.name ?? member.key}</strong><span>{member.propTemplate.visualBoundsMm.width} × {member.propTemplate.visualBoundsMm.height} mm · {member.propTemplate.blocksMovement ? '阻挡移动' : '不阻挡移动'}</span>{value && onEditMember ? <button type="button" disabled={occupied} onClick={() => requestClose({ kind: 'prop', definitionId: value.id })}>编辑成员素材 {value.name}</button> : <p>此成员没有独立固定定义，可保留现有组合内容。</p>}</li> })}</ul><p className="asset-editor-note">编辑成员副本不会自动替换当前组合中的成员。</p></div>}
  </>
  return createPortal(<dialog ref={dialog} className="asset-editor-dialog asset-item-editor-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); requestClose() }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}>
    <AssetEditorLayout title={fields.name || original.name} headingId={heading} subtitle="编辑固定素材，保存为我的素材中的新副本" scopeLabel="素材编辑" navigation={navigation} canvas={canvas} inspector={inspector} onClose={() => requestClose()} closeLabel="取消编辑副本" actions={<button type="submit" form={`${heading}-form`} disabled={occupied || imageDirty || refinementDirty}>保存编辑副本到我的素材</button>} overview={<><p><strong>{kind === 'prop' ? '物件' : kind === 'material' ? '材质' : '组合'}</strong> · {dirty ? '有未保存的草稿' : '查看固定原件'}</p>{unknownRequestSummary}{(busy || imagePending) && <p role="status">正在处理素材…<button type="button" onClick={() => { if (imageAdoptionWait.current) imageAdoptionWait.current.cancel(); else { abort.current?.abort(); imageAbort.current?.abort() } }}>取消当前处理</button></p>}{error && <p role="alert" className="asset-form-error">{error}</p>}{discard && <div className="asset-item-discard" role="group" aria-label="确认丢弃素材编辑草稿"><p>此页有未保存的更改。{discard.member ? '前往成员编辑会丢弃当前草稿。' : '关闭会丢弃当前草稿。'}</p><button type="button" onClick={() => { if (discard.member) onEditMember?.(discard.member); else onCancel() }}>丢弃草稿并{discard.member ? '前往成员' : '关闭'}</button><button type="button" onClick={() => setDiscard(null)}>继续编辑</button></div>}</>}/>
  </dialog>, document.body)
}

function AssetVisual({ project, selector, fields, overrideUrl }: { project: EditableProject; selector: CatalogSelector; fields: ImageImportItemChanges; overrideUrl: string | null }) {
  const definition = selector.kind === 'prop' ? project.document.propDefinitions[selector.definitionId] : null
  const material = selector.kind === 'material' ? project.document.materials[selector.definitionId] : null
  const assetId = definition?.defaultAppearance.kind === 'image' ? definition.defaultAppearance.assetId : material?.textureAssetId
  const asset = assetId ? project.document.assets[assetId] : null
  const [url, setUrl] = useState<string | null>(null), [error, setError] = useState('')
  const [background, setBackground] = useState('checker'), [zoom, setZoom] = useState(1), [footprint, setFootprint] = useState(true)
  const shelfPattern = useId()
  useEffect(() => {
    let active = true, created: string | null = null; setUrl(null); setError('')
    if (asset) void project.resources.read(asset.sha256).then(bytes => { if (active) { created = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: asset.mimeType })); setUrl(created) } }).catch(reason => { if (active) setError(message(reason)) })
    return () => { active = false; if (created) URL.revokeObjectURL(created) }
  }, [project, asset])
  if (selector.kind === 'prefab') return <div className="asset-editor-image-preview"><p>组合包含 {project.document.prefabDefinitions[selector.definitionId].members.length} 个固定成员。选择“组合成员”查看并编辑成员素材。</p></div>
  const shown = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1
  const width = shown(fields.widthMm), height = shown(fields.heightMm), bounds = definition?.defaultVisualBoundsMm
  const x = bounds ? bounds.x * width / bounds.width : -width / 2, y = bounds ? bounds.y * height / bounds.height : -height / 2
  const fw = shown(fields.footprintWidthMm), fh = shown(fields.footprintHeightMm), fx = (fields.footprintOffsetXmm ?? 0) - fw / 2, fy = (fields.footprintOffsetYmm ?? 0) - fh / 2
  const left = Math.min(x, definition && footprint ? fx : x), top = Math.min(y, definition && footprint ? fy : y)
  const size = { width: Math.max(x + width, definition && footprint ? fx + fw : x + width) - left, height: Math.max(y + height, definition && footprint ? fy + fh : y + height) - top }
  const pad = Math.max(size.width, size.height) * .1, symbol = definition?.defaultAppearance.kind === 'symbol' ? definition.defaultAppearance.symbol : null
  return <><div className="asset-item-view-controls"><label>背景<select aria-label="素材预览背景" value={background} onChange={event => setBackground(event.target.value)}><option value="checker">透明棋盘</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>缩放<select aria-label="素材预览缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))}><option value={.5}>50%</option><option value={1}>适应视图</option><option value={2}>200%</option></select></label>{definition && <label><input type="checkbox" checked={footprint} onChange={event => setFootprint(event.target.checked)}/>显示占地</label>}</div><div className={`asset-item-visual is-${background}`}><svg role="img" aria-label="素材外观与物理占地预览" viewBox={`${left - pad} ${top - pad} ${size.width + pad * 2} ${size.height + pad * 2}`} style={{ width: `${zoom * 100}%` }}>{overrideUrl || url ? <image href={overrideUrl ?? url!} x={x} y={y} width={width} height={height} preserveAspectRatio="none" opacity={definition?.defaultAppearance.opacity ?? 1}/> : symbol ? <g opacity={definition?.defaultAppearance.opacity ?? 1} stroke="#39443e" strokeWidth={24}><rect x={x} y={y} width={width} height={height} fill={symbol === 'rug' ? '#946755' : symbol === 'chair' ? '#71865a' : '#8b7355'}/>{symbol === 'shelf' && <><defs><pattern id={shelfPattern} width={140} height={height} patternUnits="userSpaceOnUse" x={x} y={y}><path d={`M0,60V${height - 60}`} fill="none"/></pattern></defs><rect x={x + 140} y={y} width={Math.max(0, width - 220)} height={height} fill={`url(#${shelfPattern})`} stroke="none"/></>}{symbol === 'crate' && <path d={`M${x},${y}L${x + width},${y + height}M${x + width},${y}L${x},${y + height}`}/>}</g> : <text x={x + width / 2} y={y + height / 2} textAnchor="middle" fontSize={Math.min(width, height) / 9}>正在读取图像</text>}{definition && footprint && <rect x={fx} y={fy} width={fw} height={fh} fill="#4180b326" stroke="#256d9c" strokeWidth={Math.max(size.width, size.height) / 220} strokeDasharray={`${Math.max(size.width, size.height) / 70}`}/>}</svg></div><p className="asset-item-caption">{width} × {height} mm{asset && ` · ${asset.pixelWidth} × ${asset.pixelHeight} px`}{definition && footprint && ' · 蓝框为物理占地'}</p>{error && <p role="alert">{error}</p>}</>
}
