import { useEffect, useRef, useState } from 'react'
import { THEME_PACK_PLANS, selectThemePacks } from '../../shared/assets/theme-packs'
import { THEME_PACK_CATALOGS, type ThemePackArtId } from '../../shared/assets/theme-pack-catalogs'
import type { LoadedThemePack } from '../../platform/browser/content/theme-pack-catalog'
import type { OutpostVegetationDensity } from '../../platform/browser/content/outpost-vegetation'
import type { PreparedCatalogEntryV1 } from './catalog'
import { prepareCatalogEntry } from './catalog'
import AssetReviewPanel from './AssetReviewPanel'
import './theme-packs.css'

interface Props {
  disabled: boolean
  onAdopt: (input: (signal: AbortSignal) => Promise<PreparedCatalogEntryV1[]>, signal?: AbortSignal) => Promise<void>
  onPendingChange: (pending: boolean) => void
}
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error)
const kindNames = { material: '材质', prop: '物件', prefab: '组合' }
const download = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One demand-loaded pack in memory. Nothing is installed until the ordinary atomic adoption preview. */
export default function ThemePacksPanel({ disabled, onAdopt, onPendingChange }: Props) {
  const [query, setQuery] = useState(''), [packId, setPackId] = useState<ThemePackArtId>('investigation')
  const [loaded, setLoaded] = useState<LoadedThemePack | null>(null), [selected, setSelected] = useState<string[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({}), [pending, setPending] = useState(false)
  const [reviewPending, setReviewPending] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [outpostVegetation, setOutpostVegetation] = useState<OutpostVegetationDensity>('balanced')
  const mounted = useRef(true), epoch = useRef(0), controller = useRef<AbortController | null>(null), urls = useRef<string[]>([])
  const pendingCallback = useRef(onPendingChange); pendingCallback.current = onPendingChange
  const clearImages = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; setThumbnails({}) }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); pendingCallback.current(false) } }, [])
  const cancel = () => { epoch.current++; controller.current?.abort(); controller.current = null; setPending(false); pendingCallback.current(false); setMessage('已取消，当前工程未修改。') }
  const perform = async (work: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    if (pending || reviewPending || disabled) return
    const abort = new AbortController(), operation = ++epoch.current
    controller.current = abort; setPending(true); pendingCallback.current(true); setError(''); setMessage('')
    const current = () => mounted.current && operation === epoch.current && !abort.signal.aborted
    try { await work(abort.signal, current) }
    catch (error) { if (current()) setError(failureText(error)) }
    finally { if (current()) { setPending(false); pendingCallback.current(false); controller.current = null } }
  }
  const load = () => void perform(async (signal, current) => {
    clearImages(); setLoaded(null); setSelected([])
    const { loadThemePack } = await import('../../platform/browser/content/theme-pack-catalog')
    const pack = await loadThemePack(packId, signal)
    if (!current()) return
    const next: Record<string, string> = {}, created: string[] = []
    try {
      for (const item of pack.items) {
        signal.throwIfAborted()
        const assetId = item.thumbnailAssetIds[0]
        if (!assetId) continue
        const asset = pack.project.document.assets[assetId], bytes = await pack.project.resources.read(asset.sha256)
        signal.throwIfAborted()
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/png' })); created.push(url); next[item.identity.key] = url
      }
      if (!current()) { created.forEach(url => URL.revokeObjectURL(url)); return }
      urls.current = created; setThumbnails(next); setLoaded(pack)
      setMessage('主题候选已校验，可勾选素材预览添加。尚未通过美术、场景和用户签收。')
    } catch (error) { created.forEach(url => URL.revokeObjectURL(url)); throw error }
  })
  const adopt = () => void perform(async (signal, current) => {
    if (!loaded || !selected.length) return
    const pack = loaded, choices = pack.items.filter(item => selected.includes(item.identity.key))
    await onAdopt(async adoptionSignal => {
      const result: PreparedCatalogEntryV1[] = []
      for (const item of choices) { adoptionSignal.throwIfAborted(); result.push(await prepareCatalogEntry(pack.project, item.selector, adoptionSignal)) }
      return result
    }, signal)
    if (current()) { setSelected([]); setMessage('候选已准备，请在画布审阅后一次采用。') }
  })
  const sample = (variant: 0 | 1, daylight = false) => void perform(async (signal, current) => {
    const [{ createThemePackSampleProject }, { exportProject }, { toBundle }, { validation }] = await Promise.all([
      import('../../platform/browser/content/theme-pack-catalog'), import('../../shared/project/file'),
      import('../../application/workspace/project'), import('../../platform/browser/runtime'),
    ])
    const outpost = packId === 'wilderness' && variant === 0
    const project = await createThemePackSampleProject(packId, variant, signal, outpost ? { outpostVegetation, ...(daylight ? { outpostAtmosphere: 'daylight' as const } : {}) } : {})
    const bytes = await exportProject(toBundle(project), { ...validation, signal })
    signal.throwIfAborted()
    if (current()) { download(`${packId}-sample-${variant + 1}${outpost ? `-${outpostVegetation}${daylight ? '-daylight' : ''}` : ''}.sceneweave`, new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })); setMessage('可编辑场景已下载，可从工程导入入口打开。当前工程保持。') }
  })
  const naturalOutpost = () => void perform(async (signal, current) => {
    const [{ createNaturalDetailOutpostProject }, { exportProject }, { toBundle }, { validation }] = await Promise.all([
      import('../../platform/browser/content/natural-detail-samples'), import('../../shared/project/file'),
      import('../../application/workspace/project'), import('../../platform/browser/runtime'),
    ])
    const project = await createNaturalDetailOutpostProject(outpostVegetation, signal)
    const bytes = await exportProject(toBundle(project), { ...validation, signal })
    signal.throwIfAborted()
    if (current()) { download(`outpost-natural-detail-${outpostVegetation}.sceneweave`, new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })); setMessage('自然编排哨站已下载，固定素材、实际植被与地表均保存在完整工程中。') }
  })
  const naturalVolcano = () => void perform(async (signal, current) => {
    const [{ createNaturalVolcanoProject }, { exportProject }, { toBundle }, { validation }] = await Promise.all([
      import('../../platform/browser/content/natural-volcano'), import('../../shared/project/file'),
      import('../../application/workspace/project'), import('../../platform/browser/runtime'),
    ])
    const project = await createNaturalVolcanoProject(signal)
    const bytes = await exportProject(toBundle(project), { ...validation, signal })
    signal.throwIfAborted()
    if (current()) { download('natural-volcano.sceneweave', new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })); setMessage('自然火山完整工程已下载，可从工程导入入口打开并编辑。') }
  })
  const vegetationDetails = () => void perform(async (signal, current) => {
    const { createVegetationDetailCatalogProject } = await import('../../platform/browser/content/vegetation-detail-catalog')
    const source = await createVegetationDetailCatalogProject(signal)
    await onAdopt(async adoptionSignal => {
      const prepared: PreparedCatalogEntryV1[] = []
      for (const definition of Object.values(source.document.propDefinitions)) {
        adoptionSignal.throwIfAborted()
        prepared.push(await prepareCatalogEntry(source, { kind: 'prop', definitionId: definition.id }, adoptionSignal))
      }
      return prepared
    }, signal)
    if (current()) setMessage('六件独立植被变体已准备，请审阅图像、标定与许可后一次采用。尚未取得美术或用户P3签收。')
  })
  const leafyFern = () => void perform(async (signal, current) => {
    const { createLeafyFernCatalogProject } = await import('../../platform/browser/content/leafy-fern-catalog')
    const source = await createLeafyFernCatalogProject(signal)
    await onAdopt(async adoptionSignal => Promise.all(Object.values(source.document.propDefinitions).map(definition =>
      prepareCatalogEntry(source, { kind: 'prop', definitionId: definition.id }, adoptionSignal))), signal)
    if (current()) setMessage('新羽叶蕨已准备；旧蕨叶与已有实例保留，请审阅新固定素材后采用。')
  })
  const handdrawnSurfaces = () => void perform(async (signal, current) => {
    const { createHanddrawnSurfacesCatalogProject } = await import('../../platform/browser/content/handdrawn-surfaces-catalog')
    const source = await createHanddrawnSurfacesCatalogProject(signal)
    await onAdopt(async adoptionSignal => {
      const prepared: PreparedCatalogEntryV1[] = []
      for (const definition of Object.values(source.document.materials)) {
        adoptionSignal.throwIfAborted()
        prepared.push(await prepareCatalogEntry(source, { kind: 'material', definitionId: definition.id }, adoptionSignal))
      }
      return prepared
    }, signal)
    if (current()) setMessage('四种手绘材质已准备，请审阅图像、平铺尺寸与许可后采用。')
  })
  const architecturalWalls = () => void perform(async (signal, current) => {
    const { createArchitecturalWallSurfacesCatalogProject } = await import('../../platform/browser/content/architectural-wall-surfaces-catalog')
    const source = await createArchitecturalWallSurfacesCatalogProject(signal)
    await onAdopt(async adoptionSignal => {
      const prepared: PreparedCatalogEntryV1[] = []
      for (const definition of Object.values(source.document.materials)) {
        adoptionSignal.throwIfAborted()
        prepared.push(await prepareCatalogEntry(source, { kind: 'material', definitionId: definition.id }, adoptionSignal))
      }
      return prepared
    }, signal)
    if (current()) setMessage('四种墙顶材质已准备，采用后可在墙的表面设置中选择。')
  })
  const volcanicSurfaces = () => void perform(async (signal, current) => {
    const { createVolcanicSurfacesCatalogProject } = await import('../../platform/browser/content/volcanic-surfaces-catalog')
    const source = await createVolcanicSurfacesCatalogProject(signal)
    await onAdopt(async adoptionSignal => {
      const prepared: PreparedCatalogEntryV1[] = []
      for (const definition of Object.values(source.document.materials)) {
        adoptionSignal.throwIfAborted()
        prepared.push(await prepareCatalogEntry(source, { kind: 'material', definitionId: definition.id }, adoptionSignal))
      }
      return prepared
    }, signal)
    if (current()) setMessage('五种火山材质已准备，请审阅图像、平铺尺寸与许可后采用。')
  })
  const choices = selectThemePacks(THEME_PACK_CATALOGS, { query }), metadata = THEME_PACK_CATALOGS.find(pack => pack.id === packId)!
  const plan = THEME_PACK_PLANS.find(plan => plan.id === metadata.planId)!
  return <section aria-label="主题素材包" className="theme-packs-panel"><details>
    <summary>主题素材包 · 场景与画风</summary>
    <p>六套独立候选。当前所选包含{metadata.counts.materials}种材质、{metadata.counts.props}件物件和{metadata.counts.prefabs}个可拆组合，另有两份可编辑场景。按需加载，再选择需要的内容添加。</p>
    <label>查找主题<input aria-label="查找主题包" value={query} onChange={event => setQuery(event.target.value)} placeholder="主题、场景或画风"/></label>
    <fieldset disabled={disabled || pending || reviewPending}><label>主题包<select aria-label="选择主题包" value={packId} onChange={event => { setPackId(event.target.value as ThemePackArtId); setLoaded(null); setSelected([]); clearImages(); setError(''); setMessage('') }}>
      {!choices.some(pack => pack.id === packId) && <option value={packId}>{metadata.name}</option>}
      {choices.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
    </select></label><button className="secondary asset-wide" type="button" onClick={load}>加载所选主题包</button></fieldset>
    {!choices.length && <p>没有匹配主题；可继续使用当前所选包。</p>}
    <details><summary>完整主题要求与待审范围</summary><p>目标场景：{plan.scenarios.map(scene => scene.name).join('；')}。以下为完整目标，当前候选尚待逐项核对。</p><ul>{plan.requirements.map(item => <li key={item.id}>{item.name} · 待场景／美术复核</li>)}</ul></details>
    {loaded && <>
      <p role="status">已加载 {loaded.coverage.materials} 材质、{loaded.coverage.props} 物件、{loaded.coverage.prefabs} 组合；所有完整主题要求仍待复核。</p>
      <div className="theme-pack-select"><button type="button" disabled={disabled || pending || reviewPending} onClick={() => setSelected(loaded.items.map(item => item.identity.key))}>全选包内素材</button><button type="button" disabled={disabled || pending || reviewPending} onClick={() => setSelected([])}>清除包内选择</button></div>
      <div className="theme-pack-items">{loaded.items.map(item => <label key={item.identity.key} className="theme-pack-item">
        <input type="checkbox" aria-label={`选择主题素材 ${item.name}`} disabled={disabled || pending || reviewPending} checked={selected.includes(item.identity.key)} onChange={event => setSelected(current => event.target.checked ? [...current, item.identity.key] : current.filter(key => key !== item.identity.key))}/>
        {thumbnails[item.identity.key] && <img loading="lazy" src={thumbnails[item.identity.key]} alt={`${item.name}规范PNG`}/>}
        <span>{item.name}<small>{kindNames[item.selector.kind]} · {item.widthMm} × {item.heightMm} mm</small></span>
      </label>)}</div>
      <button type="button" className="primary asset-wide" disabled={disabled || pending || reviewPending || !selected.length} onClick={adopt}>预览添加所选 {selected.length} 项主题素材</button>
      <AssetReviewPanel key={loaded.registration.id} registration={loaded.registration} content={loaded.reviewContent} items={loaded.items} selectedKeys={selected} disabled={disabled || pending} onPendingChange={value => { setReviewPending(value); pendingCallback.current(value) }}/>
    </>}
    <details><summary>两份可编辑代表场景</summary><p>用于检查尺度、组合及用途。它们是候选样板，不能替代完整场景覆盖、美术审核或用户签收。</p>
      {packId === 'wilderness' && <fieldset disabled={disabled || pending || reviewPending}>
        <label>林中哨站植被<select aria-label="林中哨站植被密度" value={outpostVegetation} onChange={event => setOutpostVegetation(event.target.value as OutpostVegetationDensity)}>
          <option value="sparse">疏 · 开阔林缘</option><option value="balanced">适中 · 树群与留白</option><option value="dense">密 · 林缘环抱</option>
        </select></label><p className="asset-muted">仅用于新建林中哨站。大树、灌木和草簇分别编排，避让道路、房屋与营地；打开后可逐件编辑，改变此处不会重排已打开工程。</p>
      </fieldset>}
      {metadata.scenarios.map((scene, index) => <button className="secondary asset-wide" key={scene.id} type="button" disabled={disabled || pending || reviewPending} onClick={() => sample(index as 0 | 1)}>下载场景 · {scene.name}</button>)}
      {packId === 'wilderness' && <button className="secondary asset-wide" type="button" disabled={disabled || pending || reviewPending} onClick={() => sample(0, true)}>下载场景 · 林中哨站 · 清朗白昼</button>}{packId === 'wilderness' && <button className="secondary asset-wide" type="button" disabled={disabled || pending || reviewPending} onClick={naturalOutpost}>下载场景 · 林中哨站 · 自然编排</button>}
    </details>
    <details><summary>植被细节 · 六件独立变体</summary><p>三种树冠、缺口灌丛、疏展蕨与弯叶草簇，保留独立根锚、占地及许可。先预览添加，再从素材库逐件放置。</p><button type="button" className="secondary asset-wide" disabled={disabled || pending || reviewPending} onClick={vegetationDetails}>预览添加六件植被细节变体</button></details>
    <details><summary>羽叶蕨 · 清晰叶面变体</summary><p>独立的新固定蕨叶，保留有面积的叶面与根锚。采用后可放置，也可加入群落编排；旧素材与实例保持。</p><button type="button" className="secondary asset-wide" disabled={disabled || pending || reviewPending} onClick={leafyFern}>预览添加清晰羽叶蕨</button></details>
    <details><summary>手绘基础材质 · 木板、石板与灰泥</summary><p>四种可独立采用的手绘材质，带有固定平铺尺寸与完整来源。采用后可在房间、墙顶、地形和道路的表面设置中使用。</p><button type="button" className="secondary asset-wide" disabled={disabled || pending || reviewPending} onClick={handdrawnSurfaces}>预览添加四种手绘基础材质</button></details>
    <details><summary>墙顶材质 · 砖墙、混凝土与砌石</summary><p>旧宅抹面砖、现代混凝土、旅舍暖色砌石和遗迹破损石灰岩，按窄墙顶的真实尺度制作接缝与细节。</p><button type="button" className="secondary asset-wide" disabled={disabled || pending || reviewPending} onClick={architecturalWalls}>预览添加四种墙顶材质</button></details>
    <details><summary>火山 · 灰岩、冷壳与熔岩</summary><p>五种可独立采用的火山材质，以及包含自然火口、熔岩池和通路的可编辑场景。</p><button type="button" className="secondary asset-wide" disabled={disabled || pending || reviewPending} onClick={volcanicSurfaces}>预览添加五种火山材质</button><button type="button" className="secondary asset-wide" disabled={disabled || pending || reviewPending} onClick={naturalVolcano}>下载场景 · 自然火口与熔岩池</button></details>
    {pending && <div role="status">正在准备真实资源…<button type="button" onClick={cancel}>取消主题包准备</button></div>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}{message && <p role="status">{message}</p>}
  </details></section>
}
