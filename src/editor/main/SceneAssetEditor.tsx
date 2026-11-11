import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EditableProject } from '../../application/workspace/project'
import type { ImageEnhancementRecipe } from '../../shared/image-enhancement'
import { inspectImageEnhancementTarget, type ImageEnhancementSource } from '../../platform/browser/content/image-enhancement'
import AssetEditorLayout from './AssetEditorLayout'
import ImageEnhancementPanel from './ImageEnhancementPanel'
import ImageRefinementPanel, { type ImageRefinementUnknownRequest } from './ImageRefinementPanel'
import type { ImageRefinementCandidate } from '../../platform/browser/content/image-refinement'

export type SceneAssetTarget = { kind: 'prop' | 'room' | 'terrainArea' | 'wall'; id: string }

/** One pinned scene target; inspecting a different canvas object cannot retarget an existing draft. */
export default function SceneAssetEditor({ project, target, disabled, properties, propertiesDirty = false, onPreview, onRefinementPreview, onClose, onDraftChange, previewActive = false, resumeRequest = 0 }: {
  project: EditableProject
  target: SceneAssetTarget
  disabled: boolean
  properties: ReactNode
  propertiesDirty?: boolean
  onPreview: (source: ImageEnhancementSource, recipe: ImageEnhancementRecipe, scope?: Uint8Array, signal?: AbortSignal) => Promise<void>
  onRefinementPreview: (source: ImageEnhancementSource, candidate: ImageRefinementCandidate, signal?: AbortSignal) => Promise<void>
  onClose: () => void
  onDraftChange: (dirty: boolean) => void
  previewActive?: boolean
  resumeRequest?: number
}) {
  const [tab, setTab] = useState<'overview' | 'properties' | 'image' | 'source'>('overview')
  const [collapsed, setCollapsed] = useState(false), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [closing, setClosing] = useState(false)
  const [refinementDirty, setRefinementDirty] = useState(false), [refinementPending, setRefinementPending] = useState(false)
  const [requests, setRequests] = useState<ImageRefinementUnknownRequest[]>([])
  const retainRequest = (request: ImageRefinementUnknownRequest) => setRequests(current => {
    const index = current.findIndex(value => value.id === request.id && value.service === request.service)
    return index < 0 ? [...current, request] : current.map((value, at) => at === index ? request : value)
  })
  const guarded = dirty || pending || refinementDirty || refinementPending || propertiesDirty || requests.length > 0
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  const info = useMemo(() => inspectImageEnhancementTarget(project, target), [project, target])
  const imageEditorAvailable = useRef(!!info)
  if (info) imageEditorAvailable.current = true
  const prop = target.kind === 'prop' ? project.document.props[target.id] : undefined
  const definition = prop?.definitionRef ? project.document.propDefinitions[prop.definitionRef.id] : undefined
  const label = info?.label ?? definition?.name ?? (target.kind === 'room' ? '房间表面' : undefined) ?? '所选素材'
  const asset = info ? project.document.assets[info.assetId] : undefined
  const callback = useRef(onDraftChange); callback.current = onDraftChange
  useEffect(() => { if (previewActive) setCollapsed(true) }, [previewActive])
  useEffect(() => { if (resumeRequest) setCollapsed(false) }, [resumeRequest])
  useEffect(() => { callback.current(guarded); return () => callback.current(false) }, [guarded])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (guarded) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [guarded])
  useEffect(() => {
    let live = true, created = ''
    setUrl(''); setError('')
    if (asset) void project.resources.read(asset.sha256).then(bytes => {
      if (!live) return
      created = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: asset.mimeType })); setUrl(created)
    }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false; if (created) URL.revokeObjectURL(created) }
  }, [project.resources, asset?.sha256])
  const close = () => { if (guarded) { setClosing(true); setCollapsed(false) } else onClose() }
  const tabs = [['overview', '概览'], ['properties', '属性与占地'], ['image', '图像处理'], ['source', '来源与许可']] as const
  const materialId = target.kind === 'prop' ? undefined : project.appearance.sources[project.appearance.surfaceSources[target.id]]
  const material = materialId?.kind === 'surface' ? project.document.materials[materialId.snapshot.base.materialRef.id] : undefined
  const originalAsset = info ? project.document.assets[info.originalAssetId] : undefined
  const origin = asset?.origin ?? definition?.origin ?? material?.origin
  const licenseBindings = project.licenseBindings.filter(row => row.subjectKind === 'asset' && (row.subjectId === asset?.id || row.subjectId === originalAsset?.id) || row.subjectKind === 'propDefinition' && row.subjectId === definition?.id || row.subjectKind === 'material' && row.subjectId === material?.id)
  const licenses = [...new Map(licenseBindings.flatMap(row => { const hash = row.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, ''); return project.licenses[hash] ? [project.licenses[hash]] : [] }).map(license => [license.sha256, license])).values()]
  return createPortal(<section className={`scene-asset-editor${collapsed ? ' is-collapsed' : ''}`} aria-label="场景素材编辑" data-testid="scene-asset-editor">
    <AssetEditorLayout title={label} subtitle="在同一编辑页查看属性、处理图像并核对来源。" scopeLabel="编辑范围 · 当前场景中的这一项" onClose={close} closeLabel="关闭" closeAriaLabel="关闭素材编辑"
      actions={<button type="button" className="secondary" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '继续编辑素材' : '返回场景（保留编辑）'}</button>}
      overview={<><span>原件保留</span><span>实例修改可撤销</span><span>{asset ? `${asset.pixelWidth} × ${asset.pixelHeight} px` : '当前对象未提供可处理图片'}</span><span>{dirty || refinementDirty ? '有尚未采用的图像编辑' : '图像候选尚未修改场景'}</span></>}
      navigation={<><h3>素材编辑</h3>{tabs.map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}<hr/><p className="asset-muted">目标固定在打开时的对象。切换查看页面保留图像选区和候选。</p><small>修改素材库副本请从“素材与布景”进入素材编辑。</small></>}
      canvas={<>{closing && <div role="alertdialog" aria-label="关闭素材编辑确认" className="asset-editor-note"><p>关闭会丢弃本页候选、处理选区和属性草稿，已保存的场景编辑保持。{requests.length > 0 && '本页还保留补画请求记录；关闭前请复制所需请求 ID，结果未确认的请求可能仍在处理或计费。'}</p>{requests.length > 0 && <ul>{requests.map(request => <li key={`${request.service}:${request.id}`}>{request.state === 'finished' ? '服务已返回' : request.state === 'not_sent' ? '服务拒绝，未发送到模型' : '结果未确认'} · {request.service} · <code>{request.id}</code></li>)}</ul>}<button type="button" onClick={() => setClosing(false)}>继续编辑</button><button type="button" onClick={onClose}>丢弃本页草稿并关闭</button></div>}
        <div hidden={tab === 'image'}><div className="asset-editor-section-heading"><h3>{tab === 'source' ? '当前固定图片与来源' : '当前素材外观'}</h3><span>素材原色预览</span></div><div className="asset-editor-image-preview">{url ? <img src={url} alt={`${label}当前固定图片`}/> : <p>{error || (asset ? '正在读取素材…' : '此项使用矢量或符号外观，可在属性中继续编辑。')}</p>}</div><p className="asset-editor-note">图像范围与物理占地分别保存。场景中的位置、外观覆盖和通行设置由右侧属性编辑。</p></div>
        <div hidden={tab !== 'image'}><div className="asset-editor-section-heading"><h3>图像处理</h3><span>先对照，再预览采用</span></div>{imageEditorAvailable.current ? <><ImageRefinementPanel project={project} target={target} disabled={disabled || pending} previewContext="scene" unknownRequests={requests} onUnknownRequest={retainRequest} onPendingChange={setRefinementPending} onDirtyChange={setRefinementDirty} onPreview={async (...args) => { await onRefinementPreview(...args); setCollapsed(true) }}/><details><summary>基础处理 · 插值放大、降噪与边缘</summary><ImageEnhancementPanel project={project} target={target} disabled={disabled || refinementPending} embedded previewContext="scene" onPendingChange={setPending} onDirtyChange={setDirty} onClose={close} onPreview={async (...args) => { await onPreview(...args); setCollapsed(true) }}/></details></> : <p className="asset-editor-note">此项没有可处理的位图。名称、位置、占地与外观仍从同一编辑页调整。</p>}</div>
      </>}
      inspector={<><div hidden={tab !== 'source'}><h3>来源与许可</h3><dl className="asset-facts"><dt>来源</dt><dd>{origin?.attribution ?? '当前对象没有独立素材来源'}</dd><dt>嵌入许可</dt><dd>{origin?.canEmbed ? '允许随工程保存' : '无独立嵌入许可'}</dd><dt>源像素</dt><dd>{asset ? `${asset.pixelWidth} × ${asset.pixelHeight}` : '—'}</dd><dt>保留原图</dt><dd>{originalAsset ? `${originalAsset.pixelWidth} × ${originalAsset.pixelHeight} px · ${originalAsset.id === asset?.id ? '当前仍为原图' : '独立保全'}` : '无独立位图'}</dd>{asset?.imageEnhancement && <><dt>图像处理</dt><dd>{asset.imageEnhancement.recipe.direction} · 来源图片 {asset.imageEnhancement.sourceAssetId}</dd></>}<dt>修改范围</dt><dd>只作用于当前场景对象，其他引用保持。</dd></dl>{licenses.map(license => <pre key={license.sha256}>{license.text}</pre>)}</div><div hidden={tab === 'source'}><h3>{tab === 'image' ? '当前对象与采用范围' : '属性与占地'}</h3>{properties}</div></>}/>
  </section>, document.body)
}
