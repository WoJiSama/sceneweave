import { useEffect, useMemo, useRef, useState } from 'react'
import { SCENE_COLLECTION_GROUPS } from '../../shared/assets/scene-collection-plan'
import { SCENE_COLLECTION_AVAILABLE_CATEGORIES, SCENE_COLLECTION_ITEMS } from '../../shared/assets/scene-collection'
import { SCENE_COLLECTION_AUTHORED_SCENARIOS } from '../../platform/browser/content/scene-collection-scenarios'
import type { FurnitureCategory } from '../../shared/assets/furniture-collection'
import type { EditableProject } from '../../application/workspace/project'
import { describeCatalogItems, prepareCatalogEntry, type PreparedCatalogEntryV1 } from './catalog'
import './theme-packs.css'

interface Props {
  disabled: boolean
  onAdopt: (input: (signal: AbortSignal) => Promise<PreparedCatalogEntryV1[]>, signal?: AbortSignal) => Promise<void>
  onPendingChange: (pending: boolean) => void
}
const eras = [{ id: 'medieval', name: '中世纪' }, { id: 'fantasy', name: '西方奇幻' }, { id: '1920s', name: '1920年代' }]
const rooms = [{ id: 'medieval-store', name: '中世纪商队仓房' }, { id: 'fantasy-store', name: '西幻遗物保管室' }, { id: 'period-store', name: '1920年代旅行货栈' },
  { id: 'medieval-market', name: '中世纪集市与仓房' }, { id: 'fantasy-market', name: '西幻药材与矿货集市' }, { id: 'period-wholesale', name: '1920年代货行与路摊' }]
const livingRooms = [{id:'medieval-kitchen-wash',name:'中世纪旅舍后厨与洗衣间'},{id:'fantasy-kitchen-wash',name:'精灵炊事与泉浴工房'},{id:'period-kitchen-wash',name:'1920年代公寓厨房与洗浴'}]

export default function SceneCollectionPanel({ disabled, onAdopt, onPendingChange }: Props) {
  const [group, setGroup] = useState('storage'), [category, setCategory] = useState('chest'), [era, setEra] = useState('all'), [query, setQuery] = useState('')
  const [source, setSource] = useState<EditableProject | null>(null), [selected, setSelected] = useState<string[]>([]), [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [room, setRoom] = useState(rooms[0].id), [livingRoom,setLivingRoom] = useState(livingRooms[0].id)
  const mounted = useRef(true), epoch = useRef(0), controller = useRef<AbortController | null>(null), urls = useRef<string[]>([])
  const [scenarioEra,setScenarioEra]=useState('medieval'), [scenarioId,setScenarioId]=useState(SCENE_COLLECTION_AUTHORED_SCENARIOS[0].id)
  const [furnitureEdition,setFurnitureEdition]=useState('original')
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
  const cancel = () => { epoch.current++; controller.current?.abort(); controller.current = null; setPending(false); pendingCallback.current(false); setMessage('已取消素材准备。') }
  const items = useMemo(() => source ? describeCatalogItems(source) : [], [source])
  const available = SCENE_COLLECTION_AVAILABLE_CATEGORIES.filter(row => row.group === group)
  const plan = SCENE_COLLECTION_GROUPS.find(row => row.id === group)!
  const matching = items.filter(item => {
    const metadata = SCENE_COLLECTION_ITEMS.find(row => item.selector.definitionId.replace(/-material-study-1$/, '') === row.definitionId)
    return (!metadata || era === 'all' || metadata.era === era) && `${item.name} ${item.publisherTags.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  })
  const load = () => void perform(async (signal, current) => {
    const { createSceneCollectionProject } = await import('../../platform/browser/content/scene-collection-catalog')
    const project = furnitureEdition === 'material' && ['bed','table','chair','cabinet'].includes(category)
      ? await (await import('../../platform/browser/content/furniture-refinement-catalog')).createFurnitureRefinementProject(category as FurnitureCategory,signal)
      : await createSceneCollectionProject(category, signal)
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
      setMessage('素材已准备，可筛选并勾选添加。')
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
    if (current()) { setSelected([]); setMessage('素材候选已准备，请在画布审阅后采用。') }
  })
  const sample = () => void perform(async (signal, current) => {
    const [{ createSceneCollectionStorageRoomProject, createSceneCollectionTradeSceneProject }, { exportProject }, { toBundle }, { validation }] = await Promise.all([
      import('../../platform/browser/content/scene-collection-catalog'), import('../../shared/project/file'), import('../../application/workspace/project'), import('../../platform/browser/runtime'),
    ])
    const project = await (room.endsWith('-store') ? createSceneCollectionStorageRoomProject(room, signal) : createSceneCollectionTradeSceneProject(room, signal)), bytes = await exportProject(toBundle(project), { ...validation, signal })
    signal.throwIfAborted()
    if (!current()) return
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })), link = document.createElement('a')
    link.href = url; link.download = `collection-${room}.sceneweave`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('仓储场景已下载，可导入后独立编辑每件物品及房间。')
  })
  const locked = disabled || pending
  const representativeSample = () => void perform(async(signal,current)=>{
    const [{createSceneCollectionRepresentativeProject},{exportProject},{toBundle},{validation}]=await Promise.all([
      import('../../platform/browser/content/scene-collection-scenarios'),import('../../shared/project/file'),import('../../application/workspace/project'),import('../../platform/browser/runtime'),
    ])
    const project=await createSceneCollectionRepresentativeProject(scenarioId,signal),bytes=await exportProject(toBundle(project),{...validation,signal})
    signal.throwIfAborted();if(!current())return
    const url=URL.createObjectURL(new Blob([bytes.slice().buffer],{type:'application/octet-stream'})),link=document.createElement('a')
    link.href=url;link.download=`collection-${scenarioId}.sceneweave`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    setMessage('用途场景已下载，可从首页打开并独立编辑房间、物件与可拆组合。')
  })
  const livingSample = () => void perform(async(signal,current)=>{
    const [{createSceneCollectionLivingProject},{exportProject},{toBundle},{validation}]=await Promise.all([import('../../platform/browser/content/scene-collection-living'),import('../../shared/project/file'),import('../../application/workspace/project'),import('../../platform/browser/runtime')])
    const project=await createSceneCollectionLivingProject(livingRoom,signal),bytes=await exportProject(toBundle(project),{...validation,signal})
    signal.throwIfAborted();if(!current())return
    const url=URL.createObjectURL(new Blob([bytes.slice().buffer],{type:'application/octet-stream'})),link=document.createElement('a')
    link.href=url;link.download=`collection-${livingRoom}.sceneweave`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    setMessage('厨房与卫浴场景已下载，可从首页打开后继续编辑。')
  })
  return <section aria-label="全场景素材系列" className="theme-packs-panel"><details>
    <summary>全场景素材 · 按生活与场所查找</summary>
    <p>按用途查找中世纪、西幻与1920年代素材，加载类别后可按年代和名称筛选。自然素材可跨年代使用。</p>
    <fieldset disabled={locked}>
      <label>用途大类<select aria-label="全场景用途大类" value={group} onChange={event => { clear(); setGroup(event.target.value); setCategory(SCENE_COLLECTION_AVAILABLE_CATEGORIES.find(row => row.group === event.target.value)?.id ?? '') }}>{SCENE_COLLECTION_GROUPS.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {available.length ? <>
        <label>具体物件<select aria-label="全场景物件类别" value={category} onChange={event => { clear(); setCategory(event.target.value) }}>{available.map(row => <option key={row.id} value={row.id}>{row.name} · {row.count}款</option>)}</select></label>
        {['bed','table','chair','cabinet'].includes(category) && <label>家具绘制版本<select aria-label="家具绘制版本" value={furnitureEdition} onChange={event=>{clear();setFurnitureEdition(event.target.value)}}><option value="original">原图</option><option value="material">材质绘制版</option></select></label>}
        <label>年代<select aria-label="全场景素材年代" value={era} onChange={event => { setEra(event.target.value); setSelected([]) }}><option value="all">全部年代</option>{eras.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>查找素材<input aria-label="查找全场景素材" value={query} onChange={event => setQuery(event.target.value)} placeholder="编藤、药材、旅行…"/></label>
        <button type="button" className="secondary asset-wide" onClick={load}>加载所选物件类别</button>
      </> : <p>该类正在扩充。计划包含：{plan.categories.map(row => row.name).join('、')}。</p>}
    </fieldset>
    {source && <>
      <p role="status">显示{matching.length}款，已选{selected.length}款。</p>
      <div className="theme-pack-select"><button type="button" disabled={locked || !matching.length} onClick={() => setSelected(matching.map(item => item.identity.key))}>选择当前素材结果</button><button type="button" disabled={locked} onClick={() => setSelected([])}>清除素材选择</button></div>
      <div className="theme-pack-items furniture-collection-items">{matching.map(item => <label key={item.identity.key} className="theme-pack-item"><input type="checkbox" aria-label={`选择素材 ${item.name}`} disabled={locked} checked={selected.includes(item.identity.key)} onChange={event => setSelected(current => event.target.checked ? [...current, item.identity.key] : current.filter(key => key !== item.identity.key))}/><img src={thumbnails[item.identity.key]} alt={`${item.name}俯视图`}/><span>{item.name}<small>{item.widthMm / 1000} × {item.heightMm / 1000} m</small></span></label>)}</div>
      {!matching.length && <p>没有匹配素材，请调整年代或名称。</p>}
      <button type="button" className="primary asset-wide" disabled={locked || !selected.length} onClick={adopt}>预览添加所选{selected.length}件素材</button>
    </>}
    {group === 'storage' && <fieldset disabled={locked}><label>配套场景<select aria-label="全场景配套仓房" value={room} onChange={event => setRoom(event.target.value)}>{rooms.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button type="button" className="secondary asset-wide" onClick={sample}>下载可编辑仓储场景</button></fieldset>}
    {['kitchen','wash','lighting'].includes(group) && <fieldset disabled={locked}><label>生活配套场景<select aria-label="厨房与卫浴配套场景" value={livingRoom} onChange={event=>setLivingRoom(event.target.value)}>{livingRooms.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button type="button" className="secondary asset-wide" onClick={livingSample}>下载厨房与卫浴场景</button></fieldset>}
    <fieldset disabled={locked}><legend>可编辑用途场景</legend>
      <label>场景年代<select aria-label="用途场景年代" value={scenarioEra} onChange={event=>{setScenarioEra(event.target.value);setScenarioId(SCENE_COLLECTION_AUTHORED_SCENARIOS.find(row=>row.era===event.target.value)!.id)}}>{eras.filter(era=>SCENE_COLLECTION_AUTHORED_SCENARIOS.some(row=>row.era===era.id)).map(era=><option key={era.id} value={era.id}>{era.name}</option>)}</select></label>
      <label>用途场景<select aria-label="可编辑用途场景" value={scenarioId} onChange={event=>setScenarioId(event.target.value)}>{SCENE_COLLECTION_AUTHORED_SCENARIOS.filter(row=>row.era===scenarioEra).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <button type="button" className="secondary asset-wide" onClick={representativeSample}>下载可编辑用途场景</button>
    </fieldset>
    {pending && <p role="status">正在准备素材资源…<button type="button" onClick={cancel}>取消全场景素材准备</button></p>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}{message && <p role="status">{message}</p>}
  </details></section>
}
