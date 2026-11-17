import { useEffect, useMemo, useRef, useState } from 'react'
import { FURNITURE_CATEGORIES, FURNITURE_ERAS, FURNITURE_STYLES, type FurnitureCategory, type FurnitureEra } from '../../shared/assets/furniture-collection'
import type { EditableProject } from '../../application/workspace/project'
import { describeCatalogItems, prepareCatalogEntry, type PreparedCatalogEntryV1 } from './catalog'
import './theme-packs.css'

interface Props {
  disabled: boolean
  onAdopt: (input: (signal: AbortSignal) => Promise<PreparedCatalogEntryV1[]>, signal?: AbortSignal) => Promise<void>
  onPendingChange: (pending: boolean) => void
}
/** One category is loaded on demand. Filter changes during work are disabled;
 * stale/cancelled operations cannot publish thumbnails or mutate the project. */
export default function FurnitureCollectionPanel({ disabled, onAdopt, onPendingChange }: Props) {
  const [category, setCategory] = useState<FurnitureCategory>('bed'), [era, setEra] = useState<FurnitureEra | 'all'>('all')
  const [styleId, setStyleId] = useState('all'), [query, setQuery] = useState(''), [source, setSource] = useState<EditableProject | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const mounted = useRef(true), epoch = useRef(0), controller = useRef<AbortController | null>(null), urls = useRef<string[]>([])
  const pendingCallback = useRef(onPendingChange); pendingCallback.current = onPendingChange
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); pendingCallback.current(false) } }, [])
  const clear = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; setThumbnails({}); setSource(null); setSelected([]); setMessage(''); setError('') }
  const perform = async (work: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    if (pending || disabled) return
    const abort = new AbortController(), operation = ++epoch.current
    controller.current = abort; setPending(true); pendingCallback.current(true); setError(''); setMessage('')
    const current = () => mounted.current && epoch.current === operation && !abort.signal.aborted
    try { await work(abort.signal, current) }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (current()) { setPending(false); pendingCallback.current(false); controller.current = null } }
  }
  const cancel = () => { epoch.current++; controller.current?.abort(); controller.current = null; setPending(false); pendingCallback.current(false); setMessage('已取消家具准备。') }
  const items = useMemo(() => source ? describeCatalogItems(source) : [], [source])
  const styles = FURNITURE_STYLES.filter(row => era === 'all' || row.era === era)
  const matching = items.filter(item => {
    const style = FURNITURE_STYLES.find(row => item.selector.definitionId.endsWith(`-${row.id}`))!
    return (era === 'all' || style.era === era) && (styleId === 'all' || style.id === styleId)
      && `${item.name} ${item.publisherTags.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  })
  const load = () => void perform(async (signal, current) => {
    const { createFurnitureCollectionProject } = await import('../../platform/browser/content/furniture-collection-catalog')
    const project = await createFurnitureCollectionProject({ category }, signal)
    const next: Record<string, string> = {}, created: string[] = []
    try {
      for (const item of describeCatalogItems(project)) {
        signal.throwIfAborted()
        const asset = project.document.assets[item.thumbnailAssetIds[0]], bytes = await project.resources.read(asset.sha256)
        signal.throwIfAborted()
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/png' })); created.push(url); next[item.identity.key] = url
      }
      if (!current()) { created.forEach(url => URL.revokeObjectURL(url)); return }
      urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = created; setThumbnails(next); setSource(project); setSelected([])
      setMessage(`${FURNITURE_CATEGORIES.find(row => row.id === category)!.name}的24款已准备，可筛选并勾选添加。`)
    } catch (error) { created.forEach(url => URL.revokeObjectURL(url)); throw error }
  })
  const adopt = () => void perform(async (signal, current) => {
    if (!source || !selected.length) return
    const project = source, choices = items.filter(item => selected.includes(item.identity.key))
    await onAdopt(async adoptionSignal => {
      const entries: PreparedCatalogEntryV1[] = []
      for (const item of choices) { adoptionSignal.throwIfAborted(); entries.push(await prepareCatalogEntry(project, item.selector, adoptionSignal)) }
      return entries
    }, signal)
    if (current()) { setSelected([]); setMessage('家具候选已准备，请在画布审阅后采用。') }
  })
  const sample = () => void perform(async (signal, current) => {
    if (styleId === 'all') throw new Error('请先选择一个配套风格。')
    const [{ createFurnitureStyleRoomProject }, { exportProject }, { toBundle }, { validation }] = await Promise.all([
      import('../../platform/browser/content/furniture-collection-catalog'), import('../../shared/project/file'),
      import('../../application/workspace/project'), import('../../platform/browser/runtime'),
    ])
    const project = await createFurnitureStyleRoomProject(styleId, signal), bytes = await exportProject(toBundle(project), { ...validation, signal })
    signal.throwIfAborted()
    if (!current()) return
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })), link = document.createElement('a')
    link.href = url; link.download = `furniture-${styleId}-room.sceneweave`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('配套房间已下载，可导入后编辑床、桌、椅、柜和真实门窗。')
  })
  const locked = disabled || pending
  return <section aria-label="风格家具系列" className="theme-packs-panel furniture-collection-panel"><details>
    <summary>风格家具 · 床桌椅柜各24款</summary>
    <p>中世纪生活、西幻、1920年代各8种配套设计，共96件。固定尺寸、占地和来源随工程保存。当前为原创俯视候选，等待美术审阅。</p>
    <fieldset disabled={locked}>
      <label>家具类别<select aria-label="家具类别" value={category} onChange={event => { clear(); setCategory(event.target.value as FurnitureCategory) }}>{FURNITURE_CATEGORIES.map(row => <option key={row.id} value={row.id}>{row.name} · 24款</option>)}</select></label>
      <label>家具年代<select aria-label="家具年代" value={era} onChange={event => { setEra(event.target.value as FurnitureEra | 'all'); setStyleId('all'); setSelected([]) }}><option value="all">全部年代</option>{FURNITURE_ERAS.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>配套风格<select aria-label="家具配套风格" value={styleId} onChange={event => { setStyleId(event.target.value); setSelected([]) }}><option value="all">全部风格</option>{styles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>查找家具<input aria-label="查找风格家具" value={query} onChange={event => setQuery(event.target.value)} placeholder="帷帐、枝蔓、黄铜…"/></label>
      <button type="button" className="secondary asset-wide" onClick={load}>加载所选类别24款</button>
    </fieldset>
    {source && <>
      <p role="status">显示{matching.length}款，已选{selected.length}款。</p>
      <div className="theme-pack-select"><button type="button" disabled={locked || !matching.length} onClick={() => setSelected(matching.map(item => item.identity.key))}>选择当前筛选结果</button><button type="button" disabled={locked} onClick={() => setSelected([])}>清除家具选择</button></div>
      <div className="theme-pack-items furniture-collection-items">{matching.map(item => <label key={item.identity.key} className="theme-pack-item"><input type="checkbox" aria-label={`选择家具 ${item.name}`} disabled={locked} checked={selected.includes(item.identity.key)} onChange={event => setSelected(current => event.target.checked ? [...current, item.identity.key] : current.filter(key => key !== item.identity.key))}/><img src={thumbnails[item.identity.key]} alt={`${item.name}俯视图`}/><span>{item.name}<small>{item.widthMm / 1000} × {item.heightMm / 1000} m</small></span></label>)}</div>
      {!matching.length && <p>没有匹配家具，请调整年代、风格或名称。</p>}
      <button type="button" className="primary asset-wide" disabled={locked || !selected.length} onClick={adopt}>预览添加所选{selected.length}件家具</button>
    </>}
    <button type="button" className="secondary asset-wide" disabled={locked || styleId === 'all'} onClick={sample}>下载所选风格配套房间</button>
    {pending && <p role="status">正在准备家具资源…<button type="button" onClick={cancel}>取消家具准备</button></p>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}{message && <p role="status">{message}</p>}
  </details></section>
}
