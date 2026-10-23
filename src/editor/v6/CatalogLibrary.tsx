import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Heart, Layers3, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { describeCatalogItems, prepareCatalogEntry, readCatalogEntry } from '../../catalog/content'
import { CatalogRepositoryV1 } from '../../catalog/repository'
import { exportCatalogBackup, readCatalogBackup } from '../../catalog/backup'
import { normalizeCatalogText, validateCatalogOrganization } from '../../catalog/organization'
import { EMPTY_CATALOG_FILTER_V1, filterCatalogItems, type CatalogFilterV1 } from '../../catalog/query'
import {
  CATALOG_COLORS_V1, CATALOG_LIMITS_V1, EMPTY_CATALOG_ORGANIZATION_V1,
  type CatalogBackupRecordV1, type CatalogColorV1, type CatalogItemV1, type CatalogKindV1,
  type CatalogOrganizationV1, type CatalogSnapshotV1, type PreparedCatalogEntryV1,
} from '../../catalog/types'
import AssetImportForm, { type AssetImportFieldsV6 } from './AssetImportForm'
import './catalog-library.css'

type Scope = 'builtin' | 'mine' | 'project'
type Draft = { keys: string[]; revision: number; tags: string; colors: CatalogColorV1[]; favorite: boolean }
type Review = { records: CatalogBackupRecordV1[]; keys: string[]; revision: number; strategy: 'keep-local' | 'replace-selected' }
const KIND_LABELS: Record<CatalogKindV1, string> = { prop: '物件', material: '材质', prefab: '组合' }
const COLORS: Record<CatalogColorV1, string> = { 红: '#be4541', 橙: '#db8c35', 黄: '#e5c350', 绿: '#578453', 青: '#509a9b', 蓝: '#5076ab', 紫: '#8665a2', 粉: '#d296ad', 棕: '#916e49', 黑: '#303638', 白: '#fffdf6', 灰: '#939993' }
const EMPTY_SNAPSHOT: CatalogSnapshotV1 = { revision: 0, entries: [], organizations: {} }
const sameOrganization = (left: CatalogOrganizationV1, right: CatalogOrganizationV1) => JSON.stringify(left) === JSON.stringify(right)
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const toggleValue = <T,>(values: T[], value: T) => values.includes(value) ? values.filter(item => item !== value) : [...values, value]
const organizationOf = (snapshot: CatalogSnapshotV1, key: string) => snapshot.organizations[key] ?? EMPTY_CATALOG_ORGANIZATION_V1

export interface CatalogLibraryProps {
  project: CompleteProjectV6
  disabled: boolean
  importDisabled?: boolean
  importResetKey?: number
  organizationResetKey?: number
  builtinProject?: CompleteProjectV6
  builtinLoading?: boolean
  builtinError?: string
  onPlace: (id: string) => void
  onMaterial: (id: string) => void
  onPrefab: (id: string) => void
  onImport: (input: AssetImportFieldsV6) => void
  onAdopt: (entries: PreparedCatalogEntryV1[], signal?: AbortSignal) => Promise<void>
  onPendingChange?: (pending: boolean) => void
  onDraftChange?: (dirty: boolean) => void
}

/** Library browsing never selects or changes a scene entity. Fixed content is adopted through the workspace preview. */
export default function CatalogLibrary({
  project, disabled, importDisabled = disabled, importResetKey = 0, organizationResetKey = 0,
  builtinProject, builtinLoading = false, builtinError,
  onPlace, onMaterial, onPrefab, onImport, onAdopt, onPendingChange, onDraftChange,
}: CatalogLibraryProps) {
  const repository = useRef<CatalogRepositoryV1 | null>(null), mounted = useRef(false), controller = useRef<AbortController | null>(null)
  const pendingCallback = useRef(onPendingChange), draftCallback = useRef(onDraftChange)
  pendingCallback.current = onPendingChange; draftCallback.current = onDraftChange
  const [snapshot, setSnapshot] = useState<CatalogSnapshotV1>(EMPTY_SNAPSHOT), [ready, setReady] = useState(false)
  const [scope, setScope] = useState<Scope>('project'), [filter, setFilter] = useState<CatalogFilterV1>(EMPTY_CATALOG_FILTER_V1)
  const [selected, setSelected] = useState<string[]>([]), [detailKey, setDetailKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null), [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('')
  const [limit, setLimit] = useState(24), [removeConfirmation, setRemoveConfirmation] = useState(false)
  const [detailProject, setDetailProject] = useState<CompleteProjectV6 | null>(null)
  const [missingThumbnails, setMissingThumbnails] = useState<Set<string>>(() => new Set())
  const capsuleCache = useRef(new Map<string, Promise<CompleteProjectV6>>())
  const currentItems = useMemo(() => describeCatalogItems(project), [project])
  const builtinItems = useMemo(() => builtinProject ? describeCatalogItems(builtinProject) : [], [builtinProject])
  const mineItems = useMemo(() => snapshot.entries.map(entry => entry.item), [snapshot.entries])
  const allItems = useMemo(() => new Map([...mineItems, ...builtinItems, ...currentItems].map(item => [item.identity.key, item])), [mineItems, builtinItems, currentItems])
  const currentKeys = useMemo(() => new Set(currentItems.map(item => item.identity.key)), [currentItems])
  const installed = useMemo(() => new Map(snapshot.entries.map(entry => [entry.item.identity.key, entry])), [snapshot.entries])
  const sourceItems = scope === 'project' ? currentItems : scope === 'builtin' ? builtinItems : mineItems
  const found = useMemo(() => filterCatalogItems(sourceItems, snapshot.organizations, filter), [sourceItems, snapshot.organizations, filter])
  const detail = detailKey ? allItems.get(detailKey) : undefined
  const selectedItems = selected.flatMap(key => allItems.has(key) ? [allItems.get(key)!] : [])
  const selectedInstalled = selected.filter(key => installed.has(key))
  const selectedMissing = selectedItems.filter(item => !installed.has(item.identity.key))
  const publisherTags = useMemo(() => [...new Set(sourceItems.flatMap(item => item.publisherTags))].sort((a, b) => a.localeCompare(b, 'zh')), [sourceItems])
  const personalTags = useMemo(() => [...new Map(Object.values(snapshot.organizations).flatMap(item => item.tags).map(tag => [normalizeCatalogText(tag), tag])).values()].sort((a, b) => a.localeCompare(b, 'zh')), [snapshot.organizations])

  useEffect(() => {
    mounted.current = true
    const repo = new CatalogRepositoryV1(); repository.current = repo
    repo.read().then(value => { if (mounted.current && repository.current === repo) { setSnapshot(value); setReady(true) } }).catch(reason => { if (mounted.current && repository.current === repo) setError(messageOf(reason)) })
    return () => { mounted.current = false; controller.current?.abort(); pendingCallback.current?.(false); draftCallback.current?.(false); repo.close(); if (repository.current === repo) repository.current = null }
  }, [])
  useEffect(() => { draftCallback.current?.(draft !== null || review !== null) }, [draft, review])
  const resetKey = useRef(organizationResetKey)
  useEffect(() => {
    if (resetKey.current !== organizationResetKey) { resetKey.current = organizationResetKey; setDraft(null); setReview(null); setRemoveConfirmation(false); setError('') }
  }, [organizationResetKey])
  useEffect(() => { setLimit(24) }, [scope, filter])
  useEffect(() => { setRemoveConfirmation(false) }, [selected])

  const run = useCallback(async (label: string, operation: (repo: CatalogRepositoryV1, signal: AbortSignal) => Promise<void>) => {
    if (controller.current || !repository.current) return
    const abort = new AbortController(); controller.current = abort; setBusy(true); pendingCallback.current?.(true); setError(''); setStatus(label)
    try { await operation(repository.current, abort.signal) }
    catch (reason) { if (mounted.current) { if (abort.signal.aborted || reason instanceof DOMException && reason.name === 'AbortError') { setStatus('已取消；未完成的准备未标为已安装。') } else { setError(messageOf(reason)); setStatus('操作失败；已有库与编辑草稿保留。') } } }
    finally { if (controller.current === abort) controller.current = null; if (mounted.current) setBusy(false); pendingCallback.current?.(false) }
  }, [])

  const sourceProject = useCallback((item: CatalogItemV1) => currentKeys.has(item.identity.key) ? project : builtinItems.some(value => value.identity.key === item.identity.key) ? builtinProject : undefined, [currentKeys, project, builtinItems, builtinProject])
  const loadProject = useCallback(async (item: CatalogItemV1): Promise<CompleteProjectV6> => {
    const source = sourceProject(item); if (source) return source
    const key = item.identity.key
    let pending = capsuleCache.current.get(key)
    if (!pending) {
      const repo = repository.current; if (!repo) throw new Error('素材库尚未打开。')
      pending = repo.load(key).then(entry => readCatalogEntry(entry))
      capsuleCache.current.set(key, pending)
      if (capsuleCache.current.size > 32) capsuleCache.current.delete(capsuleCache.current.keys().next().value!)
      pending.catch(() => { if (capsuleCache.current.get(key) === pending) capsuleCache.current.delete(key) })
    }
    return pending
  }, [sourceProject])
  useEffect(() => {
    let active = true; setDetailProject(null)
    if (detail) loadProject(detail).then(value => { if (active) setDetailProject(value) }).catch(() => {})
    return () => { active = false }
  }, [detail, loadProject])

  const prepareSelected = async (repo: CatalogRepositoryV1, items: CatalogItemV1[], signal: AbortSignal) => {
    if (!items.length || items.length > CATALOG_LIMITS_V1.batch) throw new Error(`请选择1–${CATALOG_LIMITS_V1.batch}项素材。`)
    const entries: PreparedCatalogEntryV1[] = []
    for (const item of items) {
      if (signal.aborted) throw new DOMException('取消', 'AbortError')
      if (installed.has(item.identity.key)) entries.push(await repo.load(item.identity.key, signal))
      else { const source = sourceProject(item); if (!source) throw new Error(`素材“${item.name}”缺少可用的完整内容。`); entries.push(await prepareCatalogEntry(source, item.selector, signal)) }
    }
    return entries
  }
  const saveToMine = () => run('准备完整素材与许可…', async (repo, signal) => {
    const expected = snapshot.revision, entries = await prepareSelected(repo, selectedMissing, signal)
    const next = await repo.commit(expected, { put: entries }, signal)
    if (!mounted.current) return
    setSnapshot(next); setStatus(`已完整安装${entries.length}项，可从“我的素材”离线采用。`)
  })
  const adoptSelected = () => run('检查完整闭包并准备工程候选…', async (repo, signal) => {
    const entries = await prepareSelected(repo, selectedItems, signal)
    await onAdopt(entries, signal)
    if (mounted.current) setStatus('工程采用候选已准备，请在候选面板确认。确认后可从“本工程”放置。')
  })
  const refresh = () => run('读取素材库最新版本…', async repo => {
    const next = await repo.read(); if (!mounted.current) return
    setSnapshot(next); setReady(true)
    setDraft(value => value ? { ...value, revision: next.revision } : null)
    setReview(value => value ? { ...value, revision: next.revision } : null)
    setStatus('已刷新库基线，保留输入草稿；请检查后明确再次保存或导入。')
  })
  const beginOrganization = () => {
    if (!selected.length || selected.length > CATALOG_LIMITS_V1.batch || draft) return
    const existing = selected.length === 1 ? organizationOf(snapshot, selected[0]) : EMPTY_CATALOG_ORGANIZATION_V1
    setDraft({ keys: [...selected], revision: snapshot.revision, tags: existing.tags.join('\n'), colors: [...existing.colors], favorite: existing.favorite }); setError('')
  }
  const saveOrganization = () => run('保存个人整理…', async (repo, signal) => {
    if (!draft) return
    const value = validateCatalogOrganization({ tags: draft.tags.split(/\r?\n/).filter(tag => tag.trim().length > 0), colors: draft.colors, favorite: draft.favorite })
    const next = await repo.commit(draft.revision, { organization: draft.keys.map(key => ({ key, value })) }, signal)
    if (!mounted.current) return
    setSnapshot(next); setDraft(null); setStatus(`已更新${draft.keys.length}项个人整理；固定内容和工程未改变。`)
  })
  const backupSelected = () => run('核验完整素材备份…', async (repo, signal) => {
    if (!selectedInstalled.length || selectedInstalled.length > CATALOG_LIMITS_V1.batch) throw new Error('请选中1–64项已安装素材。')
    const records: CatalogBackupRecordV1[] = []
    for (const key of selectedInstalled) records.push({ entry: await repo.load(key, signal), organization: organizationOf(snapshot, key) })
    const blob = await exportCatalogBackup(records, signal)
    if (signal.aborted || !mounted.current) return
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `sceneweave-library-${new Date().toISOString().slice(0, 10)}.sceneweave-library`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    setStatus(`已导出${records.length}项完整内容与个人整理。`)
  })
  const readBackup = (file: File) => run('完整校验库备份、资源与许可…', async (repo, signal) => {
    const records = await readCatalogBackup(file, signal), next = await repo.read()
    if (signal.aborted || !mounted.current) return
    setSnapshot(next); setReview({ records, keys: records.map(record => record.entry.item.identity.key), revision: next.revision, strategy: 'keep-local' }); setStatus('备份已校验。请检查导入范围和整理冲突，再确认导入。')
  })
  const applyBackup = () => run('按导入预览一次提交…', async (repo, signal) => {
    if (!review || !review.keys.length) throw new Error('请明确选中导入条目。')
    const records = review.records.filter(record => review.keys.includes(record.entry.item.identity.key))
    const organization = records.flatMap(record => {
      const key = record.entry.item.identity.key
      return review.strategy === 'keep-local' && snapshot.organizations[key] ? [] : [{ key, value: record.organization }]
    })
    const next = await repo.commit(review.revision, { put: records.map(record => record.entry), organization }, signal)
    if (!mounted.current) return
    setSnapshot(next); setReview(null); setStatus(`已原子导入${records.length}项，未选内容保持。`)
  })
  const removeSelected = () => run('移除明确选中的个人安装条目…', async (repo, signal) => {
    const keys = [...selectedInstalled], next = await repo.commit(snapshot.revision, { remove: keys }, signal)
    if (!mounted.current) return
    keys.forEach(key => capsuleCache.current.delete(key)); setSnapshot(next); setSelected(value => value.filter(key => !keys.includes(key))); setRemoveConfirmation(false); setStatus(`已移除${keys.length}项个人安装条目及整理；工程、历史与其他素材保持。`)
  })
  const updateFilter = <K extends keyof CatalogFilterV1,>(key: K, value: CatalogFilterV1[K]) => setFilter(current => ({ ...current, [key]: value }))
  const toggleSelection = (key: string) => {
    if (!selected.includes(key) && selected.length >= CATALOG_LIMITS_V1.batch) { setError('单次最多明确选择64项，请先取消部分选择。'); return }
    setError(''); setSelected(current => toggleValue(current, key))
  }
  const selectedReview = review?.records.filter(record => review.keys.includes(record.entry.item.identity.key)) ?? []
  const fixedConflicts = selectedReview.filter(record => snapshot.entries.some(entry => entry.item.identity.logicalKey === record.entry.item.identity.logicalKey && entry.item.identity.key !== record.entry.item.identity.key) || Object.keys(snapshot.organizations).some(key => key !== record.entry.item.identity.key && JSON.stringify(JSON.parse(key).slice(0, 5)) === record.entry.item.identity.logicalKey))
  const organizationConflicts = selectedReview.filter(record => snapshot.organizations[record.entry.item.identity.key] && !sameOrganization(snapshot.organizations[record.entry.item.identity.key], record.organization))
  const hasFilters = !!filter.query || !!filter.kinds.length || !!filter.publisherTags.length || !!filter.tags.length || !!filter.colors.length || filter.favoriteOnly

  return <section className="composition-library catalog-library" aria-label="组件素材库" aria-busy={busy}>
    <div className="asset-section-heading"><Layers3 size={16}/><h2>素材库</h2><span>{sourceItems.length}</span></div>
    <div className="catalog-scopes" role="group" aria-label="素材范围">{(['builtin', 'mine', 'project'] as const).map(value => <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{{ builtin: '内置素材', mine: '我的素材', project: '本工程' }[value]}</button>)}</div>
    <p className="asset-muted catalog-explanation">{scope === 'builtin' ? '内置目录可供查看；完整安装成功后才会进入“我的素材”。' : scope === 'mine' ? '本机完整安装的素材，可离线采用。移除不会删除工程内的内容。' : '工程已保存的固定素材。浏览不会自动保存到“我的素材”。'}</p><p className="asset-muted catalog-explanation">保存固定素材不截取当前实例或图层覆盖；组合保留固定模板成员和私密性。</p>
    {scope === 'builtin' && builtinLoading && <p role="status">正在读取内置素材的实际资源…</p>}
    {scope === 'builtin' && builtinError && <p role="alert" className="asset-form-error">内置素材缺失或读取失败：{builtinError}</p>}
    <label className="composition-search"><Search size={14}/><input type="search" aria-label="搜索组件素材" placeholder="名称、标签、来源或 ID" value={filter.query} onChange={event => updateFilter('query', event.target.value)}/></label>
    <div className="asset-library-tabs" role="group" aria-label="素材类型"><button aria-pressed={!filter.kinds.length} onClick={() => updateFilter('kinds', [])}>全部</button>{(['prop', 'material', 'prefab'] as const).map(kind => <button key={kind} aria-pressed={filter.kinds.includes(kind)} onClick={() => updateFilter('kinds', toggleValue(filter.kinds, kind))}>{KIND_LABELS[kind]}</button>)}</div>
    <details className="catalog-filters"><summary>标签、颜色与收藏筛选</summary>
      <fieldset><legend>发布者标签（任一）</legend><div className="catalog-filter-options">{publisherTags.length ? publisherTags.map(tag => <label key={tag}><input type="checkbox" checked={filter.publisherTags.includes(tag)} onChange={() => updateFilter('publisherTags', toggleValue(filter.publisherTags, tag))}/>{tag}</label>) : <span className="asset-muted">此范围没有发布者标签</span>}</div></fieldset>
      <fieldset><legend>个人标签</legend><label className="catalog-inline">匹配<select aria-label="个人标签匹配方式" value={filter.tagMatch} onChange={event => updateFilter('tagMatch', event.target.value as 'all' | 'any')}><option value="all">全部所选标签</option><option value="any">任一所选标签</option></select></label><div className="catalog-filter-options">{personalTags.length ? personalTags.map(tag => <label key={normalizeCatalogText(tag)}><input type="checkbox" checked={filter.tags.includes(tag)} onChange={() => updateFilter('tags', toggleValue(filter.tags, tag))}/>{tag}</label>) : <span className="asset-muted">尚未保存个人标签</span>}</div></fieldset>
      <fieldset><legend>个人颜色（任一）</legend><div className="catalog-colors">{CATALOG_COLORS_V1.map(color => <ColorButton key={color} color={color} selected={filter.colors.includes(color)} onClick={() => updateFilter('colors', toggleValue(filter.colors, color))}/>)}</div></fieldset>
      <label className="catalog-inline"><input type="checkbox" checked={filter.favoriteOnly} onChange={event => updateFilter('favoriteOnly', event.target.checked)}/><Heart size={13}/>仅收藏</label>
    </details>
    {hasFilters && <div className="catalog-filter-chips" aria-label="当前素材筛选条件">
      {filter.query && <FilterChip label={`关键词：${filter.query}`} onRemove={() => updateFilter('query', '')}/>}
      {filter.kinds.map(kind => <FilterChip key={kind} label={KIND_LABELS[kind]} onRemove={() => updateFilter('kinds', toggleValue(filter.kinds, kind))}/>)}
      {filter.publisherTags.map(tag => <FilterChip key={`publisher:${tag}`} label={`发布：${tag}`} onRemove={() => updateFilter('publisherTags', toggleValue(filter.publisherTags, tag))}/>)}
      {filter.tags.map(tag => <FilterChip key={`personal:${tag}`} label={`个人${filter.tagMatch === 'all' ? '全部' : '任一'}：${tag}`} onRemove={() => updateFilter('tags', toggleValue(filter.tags, tag))}/>)}
      {filter.colors.map(color => <FilterChip key={color} label={`颜色：${color}`} onRemove={() => updateFilter('colors', toggleValue(filter.colors, color))}/>)}
      {filter.favoriteOnly && <FilterChip label="仅收藏" onRemove={() => updateFilter('favoriteOnly', false)}/>}
      <button onClick={() => setFilter({ ...EMPTY_CATALOG_FILTER_V1 })}>清空筛选</button>
    </div>}
    <div className="catalog-count"><span>{found.length} 项匹配 · 已选{selected.length}项</span><button onClick={() => setSelected([])} disabled={!selected.length || busy}>清空选择</button></div>
    <div className="catalog-entries">{found.slice(0, limit).map(item => {
      const key = item.identity.key, organization = organizationOf(snapshot, key), inProject = currentKeys.has(key)
      return <article key={key} data-definition-id={item.selector.definitionId} className={detailKey === key ? 'selected' : ''}>
        <label className="catalog-select"><input type="checkbox" aria-label={`选择素材 ${item.name}`} checked={selected.includes(key)} disabled={busy} onChange={() => toggleSelection(key)}/></label>
        <button className="catalog-item-main" aria-label={`查看素材 ${item.name}`} onClick={() => setDetailKey(value => value === key ? null : key)}>
          <CatalogThumbnail item={item} loadProject={loadProject} onThumbnailState={(key, missing) => setMissingThumbnails(value => { if (value.has(key) === missing) return value; const next = new Set(value); if (missing) next.add(key); else next.delete(key); return next })}/><span className="catalog-item-copy"><strong>{item.name}{organization.favorite && <Heart size={11} aria-label="已收藏" fill="currentColor"/>}</strong><small>{KIND_LABELS[item.identity.kind]} · v{item.identity.fixedVersion} · {item.widthMm} × {item.heightMm} mm</small><small>{missingThumbnails.has(key) ? '缺失 / 校验失败' : installed.has(key) ? '已安装' : '可安装'}{item.visibility === 'gm' ? ' · 私密组合' : ''}</small><small className="catalog-tag-line">{item.publisherTags.join(' · ')}</small>{(organization.tags.length > 0 || organization.colors.length > 0) && <small className="catalog-personal-line">个人：{[...organization.tags, ...organization.colors.map(color => `${color}色`)].join(' · ')}</small>}</span>
        </button>
        {inProject && <button className="catalog-place" disabled={disabled || busy} aria-label={`${item.identity.kind === 'material' ? '应用材质' : '放置组件'} ${item.name}`} onClick={() => item.identity.kind === 'prop' ? onPlace(item.selector.definitionId) : item.identity.kind === 'material' ? onMaterial(item.selector.definitionId) : onPrefab(item.selector.definitionId)}><Plus size={14}/>{item.identity.kind === 'material' ? '应用' : '放置'}</button>}
      </article>
    })}</div>
    {!found.length && !(scope === 'builtin' && builtinLoading) && <p className="catalog-empty">{scope === 'mine' && !mineItems.length ? '我的素材还没有完整安装条目。请从内置素材或本工程明确保存，或导入完整库备份。' : '没有匹配素材。可移除筛选条件后再试。'}</p>}
    {found.length > limit && <button className="asset-wide" onClick={() => setLimit(value => value + 24)}>再显示24项（余{found.length - limit}项）</button>}
    {detail && <div className="composition-source catalog-source" aria-label="素材来源详情"><h3>{detail.name}</h3><dl className="asset-facts"><dt>固定来源</dt><dd>{detail.originLabel}</dd><dt>目录身份</dt><dd>{detail.identity.catalogId} · v{detail.identity.fixedVersion}</dd><dt>固定 ID</dt><dd>{detail.selector.definitionId}</dd><dt>完整摘要</dt><dd className="catalog-hash">{detail.identity.contentHash}</dd><dt>物理范围</dt><dd>{detail.widthMm} × {detail.heightMm} mm</dd><dt>发布者标签</dt><dd>{detail.publisherTags.join(' · ') || '无'}（只读）</dd><dt>许可引用</dt><dd>{detail.licenseRefs.join(' · ')}</dd><dt>私密性</dt><dd>{detail.visibility === 'gm' ? '私密组合；采用保留固定私密规则' : '公开固定素材'}</dd></dl><p className="asset-muted">缩略图显示固定源图片；个人颜色是整理标记，场景中的层与实例覆盖可能产生不同外观。</p>{detailProject && <details><summary>完整许可与署名</summary>{[...new Set(detailProject.licenseBindings.filter(binding => detail.licenseRefs.includes(binding.licenseRef)).map(binding => binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, '')))].map(hash => detailProject.licenses[hash]).filter(Boolean).map(license => <pre key={license.sha256}>{license.text}</pre>)}</details>}<button disabled={!ready || busy || !!draft} onClick={() => { setSelected([detail.identity.key]); const existing = organizationOf(snapshot, detail.identity.key); setDraft({ keys: [detail.identity.key], revision: snapshot.revision, tags: existing.tags.join('\n'), colors: [...existing.colors], favorite: existing.favorite }) }}>编辑此项个人整理</button></div>}
    <div className="catalog-batch" aria-label="素材批量操作"><p className="asset-muted">操作仅作用于明确勾选的{selected.length}项，最多64项；切换范围保留所选。</p><div className="catalog-actions">
      <button disabled={!ready || busy || !selectedMissing.length} onClick={saveToMine}><Download size={13}/>{scope === 'project' ? '保存到我的素材' : '安装到我的素材'}{selectedMissing.length > 0 ? `（${selectedMissing.length}）` : ''}</button>
      <button disabled={disabled || busy || !selected.length} onClick={adoptSelected}>预览采用到本工程</button>
      <button disabled={!ready || busy || !selected.length || !!draft} onClick={beginOrganization}>整理所选</button>
      <button disabled={!ready || busy || !selectedInstalled.length} onClick={backupSelected}><Download size={13}/>备份已选安装条目（{selectedInstalled.length}）</button>
      <button disabled={!ready || busy || !selectedInstalled.length || !!draft || !!review} onClick={() => setRemoveConfirmation(true)}>移除个人安装条目</button>
    </div></div>
    {removeConfirmation && <div className="catalog-confirm" role="group" aria-label="确认移除个人素材"><p>将移除明确所选的{selectedInstalled.length}项个人安装条目及其个人标签、颜色和收藏。工程、历史、内置目录和其他素材保持。</p><button disabled={busy} onClick={removeSelected}>确认移除这{selectedInstalled.length}项</button><button disabled={busy} onClick={() => setRemoveConfirmation(false)}>取消移除</button></div>}
    {draft && <form className="catalog-organization" aria-label="个人素材整理草稿" onSubmit={event => { event.preventDefault(); void saveOrganization() }}><fieldset disabled={busy}><legend>整理明确选中的{draft.keys.length}项</legend><p className="asset-muted">{draft.keys.length > 1 ? '保存会以此处完整标签、颜色和收藏替换这批所选条目的个人整理。' : '只更改个人整理；不安装素材，不改发布者信息或工程。'}该草稿的范围保持固定。</p><label>个人标签（每行一个，最多32个）<textarea aria-label="个人素材标签" rows={3} value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })}/></label><fieldset><legend>个人颜色（最多8色）</legend><div className="catalog-colors">{CATALOG_COLORS_V1.map(color => <ColorButton key={color} color={color} selected={draft.colors.includes(color)} disabled={!draft.colors.includes(color) && draft.colors.length >= CATALOG_LIMITS_V1.colors} onClick={() => setDraft({ ...draft, colors: toggleValue(draft.colors, color) })}/>)}</div></fieldset><label className="catalog-inline"><input type="checkbox" aria-label="收藏所选素材" checked={draft.favorite} onChange={event => setDraft({ ...draft, favorite: event.target.checked })}/>收藏</label><div className="catalog-actions"><button type="submit">保存这{draft.keys.length}项整理</button><button type="button" onClick={() => setDraft(null)}>取消整理草稿</button></div></fieldset></form>}
    <details className="catalog-backup"><summary><Upload size={13}/>完整库备份与导入</summary><p className="asset-muted">备份包含已选条目的实际资源、许可与个人整理。首批每次最多64项、文件64MiB；不含工程场景和历史。</p><label>选择完整库备份<input type="file" aria-label="导入素材库备份" accept=".sceneweave-library,application/json" disabled={!ready || busy || !!review || !!draft} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readBackup(file) }}/></label></details>
    {review && <div className="catalog-review" aria-label="素材库导入预览"><h3>导入预览</h3><p>完整验证{review.records.length}项，明确选中{review.keys.length}项。固定内容冲突{fixedConflicts.length}项，个人整理差异{organizationConflicts.length}项。</p><div className="catalog-review-list">{review.records.map(record => { const item = record.entry.item; return <label key={item.identity.key}><input type="checkbox" checked={review.keys.includes(item.identity.key)} disabled={busy} onChange={() => setReview({ ...review, keys: toggleValue(review.keys, item.identity.key) })}/>{item.name} · v{item.identity.fixedVersion}</label> })}</div><label>个人整理冲突处理<select aria-label="导入个人整理策略" disabled={busy} value={review.strategy} onChange={event => setReview({ ...review, strategy: event.target.value as Review['strategy'] })}><option value="keep-local">保留本机整理</option><option value="replace-selected">替换本次选中整理</option></select></label>{fixedConflicts.length > 0 && <p className="asset-form-error">相同固定身份具有不同内容，不能覆盖或改名导入。请取消这些条目。</p>}<div className="catalog-actions"><button disabled={busy || !review.keys.length || fixedConflicts.length > 0} onClick={applyBackup}>确认导入所选{review.keys.length}项</button><button disabled={busy} onClick={() => setReview(null)}>取消导入预览</button></div></div>}
    <div className="catalog-status-actions"><button disabled={busy} onClick={refresh}><RefreshCw size={12}/>{draft || review ? '刷新基线（保留草稿）' : '刷新素材库'}</button>{busy && <button onClick={() => controller.current?.abort()}>取消当前操作</button>}</div>
    {status && <p className="catalog-operation-status" role="status">{status}</p>}{error && <p className="asset-form-error" role="alert">{error}</p>}
    <AssetImportForm key={importResetKey} disabled={importDisabled || busy} onImport={onImport}/>
  </section>
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button aria-label={`移除筛选 ${label}`} onClick={onRemove}>{label}<X size={11}/></button>
}
function ColorButton({ color, selected, onClick, disabled }: { color: CatalogColorV1; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="catalog-color" aria-pressed={selected} aria-label={`${color}色`} disabled={disabled} onClick={onClick}><i style={{ background: COLORS[color] }}/>{color}{selected && <Check size={10}/>}</button>
}
function CatalogThumbnail({ item, loadProject, onThumbnailState }: { item: CatalogItemV1; loadProject: (item: CatalogItemV1) => Promise<CompleteProjectV6>; onThumbnailState: (key: string, missing: boolean) => void }) {
  const thumbnailCallback = useRef(onThumbnailState); thumbnailCallback.current = onThumbnailState
  const host = useRef<HTMLSpanElement>(null), [urls, setUrls] = useState<string[]>([]), [state, setState] = useState<'waiting' | 'loading' | 'ready' | 'missing'>('waiting')
  useEffect(() => {
    let active = true, started = false; const created: string[] = []
    const load = () => {
      if (started) return; started = true; setState('loading')
      loadProject(item).then(project => {
        if (!active) return
        for (const id of item.thumbnailAssetIds.slice(0, 4)) { const asset = project.document.assets[id], record = asset ? project.assets[asset.sha256] : undefined; if (record) created.push(URL.createObjectURL(record.blob)) }
        setUrls([...created]); setState(created.length || !item.thumbnailAssetIds.length ? 'ready' : 'missing'); thumbnailCallback.current(item.identity.key, created.length < Math.min(4, item.thumbnailAssetIds.length))
      }).catch(() => { if (active) { setState('missing'); thumbnailCallback.current(item.identity.key, true) } })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect() } }, { rootMargin: '80px' })
    if (observer && host.current) observer.observe(host.current); else load()
    return () => { active = false; observer?.disconnect(); created.forEach(url => URL.revokeObjectURL(url)) }
  }, [item, loadProject])
  return <span ref={host} className={`catalog-thumbnail ${urls.length > 1 ? 'multiple' : ''}`} aria-label={`${item.name}固定源缩略图`}>
    {urls.map(url => <img key={url} src={url} alt="" onError={() => { setState('missing'); thumbnailCallback.current(item.identity.key, true) }}/>)}
    {state === 'missing' && <span>图片缺失</span>}{state === 'ready' && !item.thumbnailAssetIds.length && <span>几何素材</span>}{(state === 'waiting' || state === 'loading') && <span>载入图片</span>}
    {item.thumbnailAssetIds.length > 4 && <small>+{item.thumbnailAssetIds.length - 4}</small>}
  </span>
}
