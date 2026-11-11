import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Download, Heart, Layers3, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import type { EditableProject } from '../../application/workspace/project'
import { describeCatalogItems, prepareCatalogEntry, readCatalogEntry } from './catalog'
import { CatalogRepositoryV1 } from './catalog'
import { exportCatalogBackup, readCatalogBackup } from './catalog'
import { normalizeCatalogText, validateCatalogOrganization } from './catalog'
import { catalogCurationFor, catalogReadonlyTags } from './catalog'
import { EMPTY_CATALOG_FILTER_V1, filterCatalogItems, type CatalogFilterV1 } from './catalog'
import {
  CATALOG_COLORS_V1, CATALOG_LIMITS_V1, EMPTY_CATALOG_ORGANIZATION_V1,
  type CatalogBackupRecordV1, type CatalogColorV1, type CatalogItemV1, type CatalogKindV1,
  type CatalogOrganizationV1, type CatalogSnapshotV1, type PreparedCatalogEntryV1,
} from './catalog'
import AssetImportForm, { type AssetImportFields } from './AssetImportForm'
import AssetBatchImportForm, { type AssetBatchReview } from './AssetBatchImportForm'
import ImageImportItemEditor from './ImageImportItemEditor'
import type { AssetImportRequest } from '../../application/workspace/asset-batch'
import { definitionPresentation } from '../../shared/appearance/presentation'
import { CATALOG_CATEGORIES, catalogCategory, catalogSizeLabel, type CatalogCategory } from './catalog-categories'
import './catalog-library.css'

type Scope = 'builtin' | 'variants' | 'mine' | 'project'
type Draft = { keys: string[]; revision: number; tags: string; colors: CatalogColorV1[]; favorite: boolean }
type Review = { records: CatalogBackupRecordV1[]; keys: string[]; organizationKeys: string[]; organizations: Record<string, CatalogOrganizationV1>; revision: number; strategy: 'keep-local' | 'replace-selected' }
const KIND_LABELS: Record<CatalogKindV1, string> = { prop: '物件', material: '材质', prefab: '组合' }
const COLORS: Record<CatalogColorV1, string> = { 红: '#be4541', 橙: '#db8c35', 黄: '#e5c350', 绿: '#578453', 青: '#509a9b', 蓝: '#5076ab', 紫: '#8665a2', 粉: '#d296ad', 棕: '#916e49', 黑: '#303638', 白: '#fffdf6', 灰: '#939993' }
const EMPTY_SNAPSHOT: CatalogSnapshotV1 = { revision: 0, entries: [], organizations: {} }
const sameOrganization = (left: CatalogOrganizationV1, right: CatalogOrganizationV1) => JSON.stringify(left) === JSON.stringify(right)
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const toggleValue = <T,>(values: T[], value: T) => values.includes(value) ? values.filter(item => item !== value) : [...values, value]
const organizationOf = (snapshot: CatalogSnapshotV1, key: string) => snapshot.organizations[key] ?? EMPTY_CATALOG_ORGANIZATION_V1
export type CatalogSelectorV1 = CatalogItemV1['selector']

export interface CatalogLibraryProps {
  project: EditableProject
  disabled: boolean
  importDisabled?: boolean
  organizationDisabled?: boolean
  importResetKey?: number
  organizationResetKey?: number
  externalRefreshKey?: number
  builtinProject?: EditableProject
  builtinLoading?: boolean
  builtinError?: string
  onBuiltinDemand?: () => void
  variantsProject?: EditableProject
  variantsLoading?: boolean
  variantsError?: string
  onVariantsDemand?: () => void
  onPlace: (id: string) => void
  onMaterial: (id: string) => void
  onPrefab: (id: string) => void
  onUse?: (source: EditableProject, selector: CatalogSelectorV1, signal?: AbortSignal) => Promise<void>
  onImport: (input: AssetImportFields) => void
  onImportBatch?: (requests: AssetImportRequest[], signal: AbortSignal) => Promise<AssetBatchReview>
  onAssetBatchDraftChange?: (dirty: boolean) => void
  onInvalidateAssetBatch?: () => void
  assetBatchPreviewActive?: boolean
  onAdopt: (entries: PreparedCatalogEntryV1[], signal?: AbortSignal) => Promise<void>
  onPendingChange?: (pending: boolean) => void
  onDraftChange?: (dirty: boolean) => void
  detailTarget?: HTMLElement | null
  detailVisible?: boolean
  onDetailChange?: (open: boolean) => void
  onManage?: () => void
  onBrowse?: () => void
  detailReturnLabel?: string
}

/** Library browsing never selects or changes a scene entity. Fixed content is adopted through the workspace preview. */
export default function CatalogLibrary({
  project, disabled, importDisabled = disabled, organizationDisabled = disabled, importResetKey = 0, organizationResetKey = 0, externalRefreshKey = 0,
  builtinProject, builtinLoading = false, builtinError, onBuiltinDemand,
  variantsProject, variantsLoading = false, variantsError, onVariantsDemand,
  detailTarget, detailVisible = true, onDetailChange, onManage, onBrowse, detailReturnLabel = '返回对象',
  onPlace, onMaterial, onPrefab, onUse, onImport, onImportBatch, onAssetBatchDraftChange, onInvalidateAssetBatch, assetBatchPreviewActive = false, onAdopt, onPendingChange, onDraftChange,
}: CatalogLibraryProps) {
  const repository = useRef<CatalogRepositoryV1 | null>(null), mounted = useRef(false), controller = useRef<AbortController | null>(null)
  const readGeneration = useRef(0), externalKey = useRef(externalRefreshKey)
  const pendingCallback = useRef(onPendingChange), draftCallback = useRef(onDraftChange)
  pendingCallback.current = onPendingChange; draftCallback.current = onDraftChange
  const [snapshot, setSnapshot] = useState<CatalogSnapshotV1>(EMPTY_SNAPSHOT), [ready, setReady] = useState(false)
  const [reading, setReading] = useState(true), [readError, setReadError] = useState('')
  const [scope, setScope] = useState<Scope>('project'), [filter, setFilter] = useState<CatalogFilterV1>(EMPTY_CATALOG_FILTER_V1)
  const [category, setCategory] = useState<CatalogCategory | 'all'>('all')
  const [selected, setSelected] = useState<string[]>([]), [detailKey, setDetailKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null), [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('')
  const [limit, setLimit] = useState(24), [removeConfirmation, setRemoveConfirmation] = useState(false)
  const [detailProject, setDetailProject] = useState<EditableProject | null>(null)
  const [imageItemEdit, setImageItemEdit] = useState<{ key: string; project: EditableProject; definitionId: string } | null>(null)
  const managementId = useId()
  const [managementOpen, setManagementOpen] = useState(false)
  const [missingThumbnails, setMissingThumbnails] = useState<Set<string>>(() => new Set())
  const capsuleCache = useRef(new Map<string, Promise<EditableProject>>())
  const updateThumbnailState = useCallback((key: string, missing: boolean) => setMissingThumbnails(value => {
    if (value.has(key) === missing) return value
    const next = new Set(value); if (missing) next.add(key); else next.delete(key); return next
  }), [])
  const currentItems = useMemo(() => describeCatalogItems(project), [project])
  const builtinItems = useMemo(() => builtinProject ? describeCatalogItems(builtinProject) : [], [builtinProject])
  const variantItems = useMemo(() => variantsProject ? describeCatalogItems(variantsProject) : [], [variantsProject])
  const mineItems = useMemo(() => snapshot.entries.map(entry => entry.item), [snapshot.entries])
  const allItems = useMemo(() => new Map([...mineItems, ...builtinItems, ...variantItems, ...currentItems].map(item => [item.identity.key, item])), [mineItems, builtinItems, variantItems, currentItems])
  const currentKeys = useMemo(() => new Set(currentItems.map(item => item.identity.key)), [currentItems])
  const installed = useMemo(() => new Map(snapshot.entries.map(entry => [entry.item.identity.key, entry])), [snapshot.entries])
  const sourceItems = scope === 'project' ? currentItems : scope === 'builtin' ? builtinItems : scope === 'variants' ? variantItems : mineItems
  const categories = useMemo(() => new Map(sourceItems.map(item => [item.identity.key, catalogCategory(item, catalogReadonlyTags(item))])), [sourceItems])
  const matchingItems = useMemo(() => filterCatalogItems(sourceItems, snapshot.organizations, filter), [sourceItems, snapshot.organizations, filter])
  const found = useMemo(() => category === 'all' ? matchingItems : matchingItems.filter(item => categories.get(item.identity.key) === category), [matchingItems, categories, category])
  const detail = detailKey ? allItems.get(detailKey) : undefined
  const detailCuration = detail ? catalogCurationFor(detail) : undefined
  const detailOrganization = detail ? organizationOf(snapshot, detail.identity.key) : undefined
  const refinedSource = detailCuration?.refines ? allItems.get(detailCuration.refines) : undefined
  const refinedIdentity = detailCuration?.refines ? JSON.parse(detailCuration.refines) as [number, string, string, string, number, string] : undefined
  const selectedItems = selected.flatMap(key => allItems.has(key) ? [allItems.get(key)!] : [])
  const selectedInstalled = selected.filter(key => installed.has(key))
  const selectedBackupKeys = selected.filter(key => installed.has(key) || snapshot.organizations[key])
  const organizationOnlyKeys = Object.keys(snapshot.organizations).filter(key => !installed.has(key))
  const selectedMissing = selectedItems.filter(item => !installed.has(item.identity.key))
  const publisherTags = useMemo(() => [...new Set(sourceItems.flatMap(item => catalogReadonlyTags(item)))].sort((a, b) => a.localeCompare(b, 'zh')), [sourceItems])
  const personalTags = useMemo(() => [...new Map(Object.values(snapshot.organizations).flatMap(item => item.tags).map(tag => [normalizeCatalogText(tag), tag])).values()].sort((a, b) => a.localeCompare(b, 'zh')), [snapshot.organizations])

  useEffect(() => {
    mounted.current = true
    const repo = new CatalogRepositoryV1(); repository.current = repo
    const generation = ++readGeneration.current
    repo.read().then(value => { if (mounted.current && repository.current === repo && generation === readGeneration.current) { setSnapshot(current => value.revision >= current.revision ? value : current); setReady(true); setReadError('') } })
      .catch(reason => { if (mounted.current && repository.current === repo && generation === readGeneration.current) setReadError(messageOf(reason)) })
      .finally(() => { if (mounted.current && repository.current === repo && generation === readGeneration.current) setReading(false) })
    return () => { mounted.current = false; controller.current?.abort(); pendingCallback.current?.(false); draftCallback.current?.(false); repo.close(); if (repository.current === repo) repository.current = null }
  }, [])
  useEffect(() => {
    if (externalKey.current === externalRefreshKey || busy || !repository.current) return
    externalKey.current = externalRefreshKey
    const repo = repository.current, generation = ++readGeneration.current
    setReading(true); setReadError('')
    repo.read().then(value => {
      if (mounted.current && repository.current === repo && generation === readGeneration.current) {
        setSnapshot(current => value.revision >= current.revision ? value : current); setReady(true)
      }
    }).catch(reason => {
      if (mounted.current && repository.current === repo && generation === readGeneration.current) setReadError(messageOf(reason))
    }).finally(() => {
      if (mounted.current && repository.current === repo && generation === readGeneration.current) setReading(false)
    })
  }, [externalRefreshKey, busy])
  useEffect(() => { draftCallback.current?.(draft !== null || review !== null || imageItemEdit !== null) }, [draft, review, imageItemEdit])
  const resetKey = useRef(organizationResetKey)
  useEffect(() => {
    if (resetKey.current !== organizationResetKey) { resetKey.current = organizationResetKey; setDraft(null); setReview(null); setImageItemEdit(null); setRemoveConfirmation(false); setError('') }
  }, [organizationResetKey])
  useEffect(() => { setLimit(24) }, [scope, filter, category])
  useEffect(() => { setRemoveConfirmation(false) }, [selected])

  const run = useCallback(async (label: string, operation: (repo: CatalogRepositoryV1, signal: AbortSignal) => Promise<void>) => {
    if (controller.current || !repository.current) return
    const abort = new AbortController(); controller.current = abort; setBusy(true); pendingCallback.current?.(true); setError(''); setStatus(label)
    try { await operation(repository.current, abort.signal) }
    catch (reason) { if (mounted.current) { if (abort.signal.aborted || reason instanceof DOMException && reason.name === 'AbortError') { setStatus('已取消；未完成的准备未标为已安装。') } else { setError(messageOf(reason)); setStatus('操作失败；已有库与编辑草稿保留。') } } }
    finally { if (controller.current === abort) controller.current = null; if (mounted.current) setBusy(false); pendingCallback.current?.(false) }
  }, [])

  const sourceProject = useCallback((item: CatalogItemV1) => currentKeys.has(item.identity.key) ? project : builtinItems.some(value => value.identity.key === item.identity.key) ? builtinProject : variantItems.some(value => value.identity.key === item.identity.key) ? variantsProject : undefined, [currentKeys, project, builtinItems, builtinProject, variantItems, variantsProject])
  const loadProject = useCallback(async (item: CatalogItemV1): Promise<EditableProject> => {
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
  const useItem = (item: CatalogItemV1) => {
    if (!onUse || disabled || busy) return
    void run('正在准备素材…', async (_repo, signal) => {
      const source = await loadProject(item)
      signal.throwIfAborted()
      if (!mounted.current) return
      await onUse(source, item.selector, signal)
      if (mounted.current && !signal.aborted) setStatus(`请确认添加“${item.name}”；确认后继续${item.identity.kind === 'material' ? '应用材质' : '放置'}。`)
    })
  }
  const refresh = () => run('读取素材库最新版本…', async repo => {
    setReading(true); setReadError('')
    try {
      const next = await repo.read(); if (!mounted.current) return
      setSnapshot(next); setReady(true)
      setDraft(value => value ? { ...value, revision: next.revision } : null)
      setReview(value => value ? { ...value, revision: next.revision } : null)
      setStatus('已刷新库基线，保留输入草稿；请检查后明确再次保存或导入。')
    } catch (reason) {
      if (mounted.current) setReadError(messageOf(reason))
      throw reason
    } finally { if (mounted.current) setReading(false) }
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
    if (!selectedBackupKeys.length || selectedBackupKeys.length > CATALOG_LIMITS_V1.batch) throw new Error('请选中1–64项已安装素材或个人整理。')
    const records: CatalogBackupRecordV1[] = []
    for (const key of selectedInstalled) records.push({ entry: await repo.load(key, signal), organization: organizationOf(snapshot, key) })
    const blob = await exportCatalogBackup(records, signal, Object.fromEntries(selectedBackupKeys.filter(key => snapshot.organizations[key]).map(key => [key, snapshot.organizations[key]])))
    if (signal.aborted || !mounted.current) return
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `sceneweave-library-${new Date().toISOString().slice(0, 10)}.sceneweave-library`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    setStatus(`已导出${records.length}项完整内容及所选个人整理。`)
  })
  const readBackup = (file: File) => run('完整校验库备份、资源与许可…', async (repo, signal) => {
    const backup = await readCatalogBackup(file, signal), records = backup.records, next = await repo.read()
    if (signal.aborted || !mounted.current) return
    setSnapshot(next); setReview({ records, keys: records.map(record => record.entry.item.identity.key), organizations: backup.organizations, organizationKeys: Object.keys(backup.organizations).filter(key => !records.some(record => record.entry.item.identity.key === key)), revision: next.revision, strategy: 'keep-local' }); setStatus('备份已校验。请检查导入范围和整理冲突，再确认导入。')
  })
  const applyBackup = () => run('按导入预览一次提交…', async (repo, signal) => {
    if (!review || !review.keys.length && !review.organizationKeys.length) throw new Error('请明确选中导入条目或个人整理。')
    if (new Set([...review.keys, ...review.organizationKeys]).size > 64) throw new Error('普通导入一次最多64个不同目标，请调整所选范围。')
    const records = review.records.filter(record => review.keys.includes(record.entry.item.identity.key))
    const selectedOrganizations = Object.fromEntries([...new Set([...review.keys, ...review.organizationKeys])].filter(key => Object.hasOwn(review.organizations, key)).map(key => [key, review.organizations[key]]))
    const organization = Object.entries(selectedOrganizations).flatMap(([key, value]) => review.strategy === 'keep-local' && snapshot.organizations[key] ? [] : [{ key, value }])
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
  const organizationConflicts = review ? [...new Set([...review.keys, ...review.organizationKeys])].filter(key => snapshot.organizations[key] && review.organizations[key] && !sameOrganization(snapshot.organizations[key], review.organizations[key])) : []
  const hasFilters = category !== 'all' || !!filter.query || !!filter.kinds.length || !!filter.publisherTags.length || !!filter.tags.length || !!filter.colors.length || filter.favoriteOnly

  const saveImageItem = async (entry: PreparedCatalogEntryV1, signal: AbortSignal) => {
    const repo = repository.current
    if (!repo) throw new Error('个人素材库尚未打开。')
    const before = await repo.read(), key = entry.item.identity.key
    const next = before.entries.some(row => row.item.identity.key === key) ? before : await repo.commit(before.revision, { put: [entry] }, signal)
    await repo.load(key, signal)
    if (mounted.current && !signal.aborted) {
      setSnapshot(next); setImageItemEdit(null); setScope('mine'); setDetailKey(key); setSelected([key]); setStatus('已保存图片素材编辑副本，可从我的素材重复放置。')
    }
  }
  const detailContent = <section className="catalog-library" aria-label="素材详情面板" hidden={!detailVisible} inert={!detailVisible} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !detailVisible || !onDetailChange) return
    event.preventDefault(); event.stopPropagation(); onDetailChange(false)
  }}>
    {detail && detailTarget !== undefined && <button type="button" className="secondary asset-wide" onClick={() => onDetailChange?.(false)}>{detailReturnLabel}</button>}
    {detail && onBrowse && <button type="button" className="secondary asset-wide" onClick={() => { setManagementOpen(false); onDetailChange?.(false); onBrowse() }}>返回素材列表</button>}
    {detail && <div className="composition-source catalog-source" aria-label="素材来源详情"><h3>{detail.name}</h3><p className="asset-muted">当前查看素材来源；画布所选对象保持。</p><div className="catalog-detail-preview"><CatalogThumbnail item={detail} loadProject={loadProject} onThumbnailState={updateThumbnailState} eager/></div><dl className="asset-facts"><dt>用途分类</dt><dd>{CATALOG_CATEGORIES.find(value => value.id === catalogCategory(detail, catalogReadonlyTags(detail)))!.label}</dd><dt>我的素材</dt><dd>{!ready ? '尚未完成个人素材库读取' : installed.has(detail.identity.key) ? '已保存，可离线使用' : '尚未保存到个人库'}</dd><dt>个人标签／颜色</dt><dd>{!ready ? '个人素材库读取完成后显示' : detailOrganization && [...detailOrganization.tags, ...detailOrganization.colors.map(color => `${color}色`)].join(' · ') || '无'}</dd><dt>固定来源</dt><dd>{detail.originLabel}</dd><dt>目录身份</dt><dd>{detail.identity.catalogId} · v{detail.identity.fixedVersion}</dd><dt>固定 ID</dt><dd>{detail.selector.definitionId}</dd><dt>完整摘要</dt><dd className="catalog-hash">{detail.identity.contentHash}</dd><dt>物理范围</dt><dd>{detail.widthMm} × {detail.heightMm} mm</dd><dt>发布者标签</dt><dd>{detail.publisherTags.join(' · ') || '无'}（只读）</dd><dt>目录补充标签／颜色</dt><dd>{detailCuration ? [...detailCuration.tags, ...detailCuration.colors.map(color => `${color}色`)].join(' · ') : '无'}（只读、人工描述）</dd>{refinedIdentity && <><dt>精修来源</dt><dd>{refinedSource?.name ?? refinedIdentity[3]} · v{refinedIdentity[4]}；保留旧版，可分别选择</dd></>}<dt>许可引用</dt><dd>{detail.licenseRefs.join(' · ')}</dd><dt>私密性</dt><dd>{detail.visibility === 'gm' ? '私密组合；采用保留固定私密规则' : '公开固定素材'}</dd></dl>{refinedIdentity && <div className="catalog-refinement-comparison" role="group" aria-label="精修素材与旧版对照"><figure><CatalogThumbnail item={detail} loadProject={loadProject} onThumbnailState={updateThumbnailState} eager/><figcaption>精修版：{detail.name} · v{detail.identity.fixedVersion}</figcaption></figure><figure>{refinedSource ? <><CatalogThumbnail item={refinedSource} loadProject={loadProject} onThumbnailState={updateThumbnailState} eager/><figcaption>保留旧版：{refinedSource.name} · v{refinedSource.identity.fixedVersion}</figcaption></> : <><span className="catalog-comparison-missing">旧版完整来源未在当前可用目录中找到；请读取内置目录或明确安装对应旧版。</span><figcaption>{refinedIdentity[3]} · v{refinedIdentity[4]}</figcaption></>}</figure></div>}<p className="asset-muted">缩略图显示固定源图片；目录补充标签／颜色来自应用只读索引，不改发布者信息，也不写入库备份。颜色为人工描述或个人整理，场景中的层与实例覆盖可能产生不同外观。</p>{detailProject && <details><summary>完整许可与署名</summary>{[...new Set(detailProject.licenseBindings.filter(binding => detail.licenseRefs.includes(binding.licenseRef)).map(binding => binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, '')))].map(hash => detailProject.licenses[hash]).filter(Boolean).map(license => <pre key={license.sha256}>{license.text}</pre>)}</details>}<button disabled={!ready || busy || !!draft} onClick={() => { setManagementOpen(true); onManage?.(); setSelected([detail.identity.key]); const existing = organizationOf(snapshot, detail.identity.key); setDraft({ keys: [detail.identity.key], revision: snapshot.revision, tags: existing.tags.join('\n'), colors: [...existing.colors], favorite: existing.favorite }) }}>编辑此项个人整理</button>
      {(detail.identity.kind === 'prop' || detail.identity.kind === 'material') && detail.publisherTags.includes('图片拆解') && detailProject && <button disabled={!ready || busy || !!draft || !!review || !!imageItemEdit} onClick={() => setImageItemEdit({ key: detail.identity.key, project: detailProject, definitionId: detail.selector.definitionId })}>编辑图片素材副本</button>}
    </div>}
    {imageItemEdit && <ImageImportItemEditor key={imageItemEdit.key} project={imageItemEdit.project} definitionId={imageItemEdit.definitionId} kind={imageItemEdit.project.document.materials[imageItemEdit.definitionId] ? 'material' : 'prop'} disabled={busy || organizationDisabled} onSave={saveImageItem} onCancel={() => setImageItemEdit(null)} onPendingChange={active => { controller.current = active; setBusy(active !== null); pendingCallback.current?.(active !== null) }}/>}

  </section>

  return <section className="composition-library catalog-library" aria-label="组件素材库" aria-busy={busy || reading}>
    <div className="asset-section-heading"><Layers3 size={16}/><h2>素材库</h2><span>{scope === 'mine' && !ready ? '待读取' : sourceItems.length}</span></div>
    <div className="catalog-actions" role="group" aria-label="素材库操作"><button type="button" aria-pressed={!managementOpen} onClick={() => setManagementOpen(false)}>浏览素材</button><button type="button" aria-expanded={managementOpen} aria-controls={managementId} onClick={() => setManagementOpen(value => !value)}>导入/管理{selected.length ? ` · 已选 ${selected.length}` : ''}</button></div>
    {reading ? <p className="asset-muted catalog-explanation" role="status">正在读取个人素材库；安装与整理操作将在读取完成后可用。</p> : readError && <div className="catalog-read-feedback" role="alert">
      <strong>个人素材库读取失败</strong>
      <p>{ready ? '以下保留上次读取的内容，尚未确认最新版本。' : '个人素材列表尚未完成读取，不能据此判断素材是否为空。'}已有素材与整理草稿保留，请重新读取后继续。</p>
      <details><summary>查看读取失败原因</summary><p>{readError}</p></details>
      <button className="secondary" disabled={busy || reading} onClick={refresh}><RefreshCw size={12}/>重新读取个人素材库</button>
    </div>}
    <div hidden={managementOpen} inert={managementOpen}>
    <label className="composition-search"><Search size={14}/><input type="search" aria-label="搜索组件素材" placeholder="搜索树木、桌椅、石块…" value={filter.query} onChange={event => updateFilter('query', event.target.value)}/></label>
    <div className="catalog-categories" role="group" aria-label="素材用途分类"><button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>全部</button>{CATALOG_CATEGORIES.map(value => <button type="button" key={value.id} aria-pressed={category === value.id} onClick={() => setCategory(value.id)}>{value.label}</button>)}</div>
    <label className="catalog-source-filter">素材来源<select aria-label="素材来源" value={scope} onChange={event => { const value = event.target.value as Scope; setScope(value); if (value === 'builtin') onBuiltinDemand?.(); if (value === 'variants') onVariantsDemand?.() }}><option value="project">本工程</option><option value="builtin">内置素材</option><option value="variants">地形素材包</option><option value="mine">我的素材</option></select></label>
    <p className="asset-muted catalog-explanation">{scope === 'project' ? '放置到画布 · 材质应用于所选表面' : onUse ? '添加并预览，确认后继续放置或应用。' : '勾选素材，预览添加到本工程。'}</p>
    {scope === 'builtin' && builtinLoading && <p role="status">正在读取内置素材的实际资源…</p>}
    {scope === 'builtin' && builtinError && <div><p role="alert" className="asset-form-error">内置素材缺失或读取失败：{builtinError}</p><button className="secondary" disabled={builtinLoading} onClick={onBuiltinDemand}>重试内置素材</button></div>}
    {scope === 'variants' && variantsLoading && <p role="status">正在读取地形变体的实际资源…</p>}
    {scope === 'variants' && variantsError && <div><p role="alert" className="asset-form-error">地形变体缺失或读取失败：{variantsError}</p><button className="secondary" disabled={variantsLoading} onClick={onVariantsDemand}>重试地形变体</button></div>}
    <details className="catalog-filters"><summary title="类型、标签、颜色与收藏筛选"><span>详细筛选</span><span className="catalog-count">{scope === 'mine' && !ready ? '待读取' : `${found.length} 项匹配`}</span></summary>
      <div className="asset-library-tabs" role="group" aria-label="素材类型"><button aria-pressed={!filter.kinds.length} onClick={() => updateFilter('kinds', [])}>全部类型</button>{(['prop', 'material', 'prefab'] as const).map(kind => <button key={kind} aria-pressed={filter.kinds.includes(kind)} onClick={() => updateFilter('kinds', toggleValue(filter.kinds, kind))}>{KIND_LABELS[kind]}</button>)}</div>
      <fieldset><legend>只读标签（发布者＋目录补充，任一）</legend><div className="catalog-filter-options">{publisherTags.length ? publisherTags.map(tag => <label key={tag}><input type="checkbox" checked={filter.publisherTags.includes(tag)} onChange={() => updateFilter('publisherTags', toggleValue(filter.publisherTags, tag))}/>{tag}</label>) : <span className="asset-muted">此范围没有只读标签</span>}</div></fieldset>
      <fieldset><legend>个人标签</legend><label className="catalog-inline">匹配<select aria-label="个人标签匹配方式" value={filter.tagMatch} onChange={event => updateFilter('tagMatch', event.target.value as 'all' | 'any')}><option value="all">全部所选标签</option><option value="any">任一所选标签</option></select></label><div className="catalog-filter-options">{personalTags.length ? personalTags.map(tag => <label key={normalizeCatalogText(tag)}><input type="checkbox" checked={filter.tags.includes(tag)} onChange={() => updateFilter('tags', toggleValue(filter.tags, tag))}/>{tag}</label>) : <span className="asset-muted">{ready ? '尚未保存个人标签' : '个人素材库读取完成后显示标签'}</span>}</div></fieldset>
      <fieldset><legend>颜色（个人＋目录人工标记，任一）</legend><div className="catalog-colors">{CATALOG_COLORS_V1.map(color => <ColorButton key={color} color={color} selected={filter.colors.includes(color)} onClick={() => updateFilter('colors', toggleValue(filter.colors, color))}/>)}</div></fieldset>
      <label className="catalog-inline"><input type="checkbox" checked={filter.favoriteOnly} onChange={event => updateFilter('favoriteOnly', event.target.checked)}/><Heart size={13}/>仅收藏</label>
    </details>
    {hasFilters && <div className="catalog-filter-chips" aria-label="当前素材筛选条件">
      {category !== 'all' && <FilterChip label={`用途：${CATALOG_CATEGORIES.find(value => value.id === category)!.label}`} onRemove={() => setCategory('all')}/>}
      {filter.query && <FilterChip label={`关键词：${filter.query}`} onRemove={() => updateFilter('query', '')}/>}
      {filter.kinds.map(kind => <FilterChip key={kind} label={KIND_LABELS[kind]} onRemove={() => updateFilter('kinds', toggleValue(filter.kinds, kind))}/>)}
      {filter.publisherTags.map(tag => <FilterChip key={`publisher:${tag}`} label={`只读：${tag}`} onRemove={() => updateFilter('publisherTags', toggleValue(filter.publisherTags, tag))}/>)}
      {filter.tags.map(tag => <FilterChip key={`personal:${tag}`} label={`个人${filter.tagMatch === 'all' ? '全部' : '任一'}：${tag}`} onRemove={() => updateFilter('tags', toggleValue(filter.tags, tag))}/>)}
      {filter.colors.map(color => <FilterChip key={color} label={`颜色：${color}`} onRemove={() => updateFilter('colors', toggleValue(filter.colors, color))}/>)}
      {filter.favoriteOnly && <FilterChip label="仅收藏" onRemove={() => updateFilter('favoriteOnly', false)}/>}
      <button onClick={() => { setFilter({ ...EMPTY_CATALOG_FILTER_V1 }); setCategory('all') }}>清空筛选</button>
    </div>}
    {selected.length > 0 && <div className="catalog-selection-count"><span>已选{selected.length}项</span><button onClick={() => setSelected([])} disabled={busy}>清空选择</button></div>}
    <div className="catalog-entries">{found.slice(0, limit).map(item => {
      const key = item.identity.key, organization = organizationOf(snapshot, key), inProject = currentKeys.has(key)
      return <article key={key} data-definition-id={item.selector.definitionId} className={detailKey === key ? 'selected' : ''}>
        <label className="catalog-select"><input type="checkbox" aria-label={`选择素材 ${item.name}`} checked={selected.includes(key)} disabled={busy} onChange={() => toggleSelection(key)}/></label>
        <button className="catalog-item-main" aria-label={`查看素材 ${item.name}`} onClick={() => { const open = detailKey !== key || !detailVisible; setDetailKey(open ? key : null); onDetailChange?.(open) }}>
          <CatalogThumbnail item={item} loadProject={loadProject} onThumbnailState={updateThumbnailState}/><span className="catalog-item-copy"><strong>{item.name}{organization.favorite && <Heart size={12} aria-label="已收藏" fill="currentColor"/>}</strong><small>{KIND_LABELS[item.identity.kind]} · {catalogSizeLabel(item.widthMm, item.heightMm)}</small>{missingThumbnails.has(key) && <small className="catalog-item-warning">缩略图不可用 · 查看详情</small>}{item.visibility === 'gm' && <small>仅主持人可见</small>}</span>
        </button>
        {inProject && <button className="catalog-place" disabled={disabled || busy} aria-label={`${item.identity.kind === 'material' ? '应用材质' : '放置组件'} ${item.name}`} onClick={() => item.identity.kind === 'prop' ? onPlace(item.selector.definitionId) : item.identity.kind === 'material' ? onMaterial(item.selector.definitionId) : onPrefab(item.selector.definitionId)}><Plus size={14}/>{item.identity.kind === 'material' ? '应用' : '放置'}</button>}
        {!inProject && onUse && <button className="catalog-place catalog-add-use" disabled={disabled || busy} aria-label={`${item.identity.kind === 'material' ? '添加并应用' : '添加并放置'} ${item.name}`} onClick={() => useItem(item)}><Plus size={14}/>{item.identity.kind === 'material' ? '添加并应用' : '添加并放置'}</button>}
      </article>
    })}</div>
    {!found.length && !(scope === 'builtin' && builtinLoading) && !(scope === 'variants' && variantsLoading) && !(scope === 'mine' && (!ready || reading || !!readError)) && <p className="catalog-empty">{scope === 'mine' && !mineItems.length ? '还没有个人素材。可以从内置素材保存，或导入素材库备份。' : '当前来源没有匹配素材。试试切换素材来源，或清空筛选条件。'}</p>}
    {found.length > limit && <button className="asset-wide" onClick={() => setLimit(value => value + 24)}>再显示24项（余{found.length - limit}项）</button>}
    </div>
    {detailTarget !== undefined ? detailTarget && createPortal(detailContent, detailTarget) : detailContent}
    <section id={managementId} aria-label="素材导入与管理" hidden={!managementOpen} inert={!managementOpen}>
    <p className="workspace-panel-intro">导入文件、批量导入、整理个人库或恢复素材库备份。管理操作只作用于明确勾选的素材。</p>
    {scope === 'mine' && organizationOnlyKeys.length > 0 && <details className="catalog-organization-only"><summary>未安装素材的个人整理 · {organizationOnlyKeys.length} 项</summary><p className="asset-muted">这些记录保留原身份、标签、颜色和收藏。选择后可整理或备份；安装与放置仍需要完整素材。</p>{organizationOnlyKeys.map(key => <label key={key}><input type="checkbox" aria-label={`选择个人整理 ${JSON.parse(key)[3]}`} checked={selected.includes(key)} disabled={busy} onChange={() => toggleSelection(key)}/>{allItems.get(key)?.name ?? JSON.parse(key)[3]} · {snapshot.organizations[key].tags.join(' · ')}{snapshot.organizations[key].favorite ? ' · 已收藏' : ''}</label>)}</details>}
    <details className="catalog-management"><summary>批量添加与个人素材管理{selected.length > 0 ? ` · 已选 ${selected.length} 项` : ''}</summary><div className="catalog-batch" aria-label="素材批量操作"><p className="asset-muted">操作仅作用于明确勾选的{selected.length}项，最多64项；切换范围保留所选。</p><div className="catalog-actions">
      <button disabled={!ready || busy || !selectedMissing.length} onClick={saveToMine}><Download size={13}/>{scope === 'project' ? '保存到我的素材' : '安装到我的素材'}{selectedMissing.length > 0 ? `（${selectedMissing.length}）` : ''}</button>
      <button disabled={disabled || busy || !selected.length} onClick={adoptSelected}>预览采用到本工程</button>
      <button disabled={!ready || busy || !selected.length || !!draft} onClick={beginOrganization}>整理所选</button>
      <button disabled={!ready || busy || !selectedBackupKeys.length} onClick={backupSelected}><Download size={13}/>备份所选内容与整理（{selectedBackupKeys.length}）</button>
      <button disabled={!ready || busy || !selectedInstalled.length || !!draft || !!review} onClick={() => setRemoveConfirmation(true)}>移除个人安装条目</button>
    </div><p className="asset-muted">保存到个人库会保留素材原版与许可，不包含场景中的调色；组合保留原有私密设置。</p></div></details>
    {removeConfirmation && <div className="catalog-confirm" role="group" aria-label="确认移除个人素材"><p>将移除明确所选的{selectedInstalled.length}项个人安装条目及其个人标签、颜色和收藏。工程、历史、内置目录和其他素材保持。</p><button disabled={busy} onClick={removeSelected}>确认移除这{selectedInstalled.length}项</button><button disabled={busy} onClick={() => setRemoveConfirmation(false)}>取消移除</button></div>}
    {draft && <form className="catalog-organization" aria-label="个人素材整理草稿" onSubmit={event => { event.preventDefault(); void saveOrganization() }}><fieldset disabled={busy}><legend>整理明确选中的{draft.keys.length}项</legend><p className="asset-muted">{draft.keys.length > 1 ? '保存会以此处完整标签、颜色和收藏替换这批所选条目的个人整理。' : '只更改个人整理；不安装素材，不改发布者信息或工程。'}该草稿的范围保持固定。</p><label>个人标签（每行一个，最多32个）<textarea aria-label="个人素材标签" rows={3} value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })}/></label><fieldset><legend>个人颜色（最多8色）</legend><div className="catalog-colors">{CATALOG_COLORS_V1.map(color => <ColorButton key={color} color={color} selected={draft.colors.includes(color)} disabled={!draft.colors.includes(color) && draft.colors.length >= CATALOG_LIMITS_V1.colors} onClick={() => setDraft({ ...draft, colors: toggleValue(draft.colors, color) })}/>)}</div></fieldset><label className="catalog-inline"><input type="checkbox" aria-label="收藏所选素材" checked={draft.favorite} onChange={event => setDraft({ ...draft, favorite: event.target.checked })}/>收藏</label><div className="catalog-actions"><button type="submit">保存这{draft.keys.length}项整理</button><button type="button" onClick={() => setDraft(null)}>取消整理草稿</button></div></fieldset></form>}
    <details className="catalog-backup"><summary><Upload size={13}/>完整库备份与导入</summary><p className="asset-muted">备份包含所选安装条目的实际资源、许可，以及明确选择的个人整理；未安装记录也可单独备份。首批每次最多64项、文件64MiB；不含工程场景和历史。</p><label>选择完整库备份<input type="file" aria-label="导入素材库备份" accept=".sceneweave-library,application/json" disabled={!ready || busy || !!review || !!draft} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readBackup(file) }}/></label></details>
    {review && <div className="catalog-review" aria-label="素材库导入预览"><h3>导入预览</h3><p>完整验证{review.records.length}项素材、{Object.keys(review.organizations).length}项整理，明确选中{new Set([...review.keys, ...review.organizationKeys]).size}个目标。固定内容冲突{fixedConflicts.length}项，个人整理差异{organizationConflicts.length}项。</p><div className="catalog-review-list">{review.records.map(record => { const item = record.entry.item; return <label key={item.identity.key}><input type="checkbox" checked={review.keys.includes(item.identity.key)} disabled={busy} onChange={() => setReview({ ...review, keys: toggleValue(review.keys, item.identity.key) })}/>{item.name} · v{item.identity.fixedVersion}</label> })}</div>{review.organizationKeys.length > 0 || Object.keys(review.organizations).some(key => !review.records.some(record => record.entry.item.identity.key === key)) ? <fieldset><legend>未安装素材的个人整理</legend>{Object.keys(review.organizations).filter(key => !review.records.some(record => record.entry.item.identity.key === key)).map(key => <label key={key}><input type="checkbox" disabled={busy} checked={review.organizationKeys.includes(key)} onChange={() => setReview({ ...review, organizationKeys: toggleValue(review.organizationKeys, key) })}/>{JSON.parse(key)[3]} · {review.organizations[key].tags.join(" · ") || "个人整理"}</label>)}</fieldset> : null}<label>个人整理冲突处理<select aria-label="导入个人整理策略" disabled={busy} value={review.strategy} onChange={event => setReview({ ...review, strategy: event.target.value as Review['strategy'] })}><option value="keep-local">保留本机整理</option><option value="replace-selected">替换本次选中整理</option></select></label>{fixedConflicts.length > 0 && <p className="asset-form-error">相同固定身份具有不同内容，不能覆盖或改名导入。请取消这些条目。</p>}<div className="catalog-actions"><button disabled={busy || !review.keys.length && !review.organizationKeys.length || new Set([...review.keys, ...review.organizationKeys]).size > 64 || fixedConflicts.length > 0} onClick={applyBackup}>确认导入所选{new Set([...review.keys, ...review.organizationKeys]).size}项</button><button disabled={busy} onClick={() => setReview(null)}>取消导入预览</button></div></div>}
    <AssetImportForm key={importResetKey} disabled={importDisabled || busy} onImport={onImport}/>
    {onImportBatch && <AssetBatchImportForm key={`${project.document.sceneId}-${importResetKey}-batch`} disabled={importDisabled || busy} onPreview={onImportBatch} candidateActive={assetBatchPreviewActive} onDraftChange={onAssetBatchDraftChange} onInvalidate={onInvalidateAssetBatch}/>}
    </section>
    <div className="catalog-status-actions"><button disabled={busy || reading} onClick={refresh}><RefreshCw size={12}/>{draft || review ? '刷新基线（保留草稿）' : '刷新素材库'}</button>{busy && <button onClick={() => controller.current?.abort()}>取消当前操作</button>}</div>
    {status && <p className="catalog-operation-status" role="status">{status}</p>}{error && error !== readError && <p className="asset-form-error" role="alert">{error}</p>}
  </section>
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button aria-label={`移除筛选 ${label}`} onClick={onRemove}>{label}<X size={11}/></button>
}
function ColorButton({ color, selected, onClick, disabled }: { color: CatalogColorV1; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="catalog-color" aria-pressed={selected} aria-label={`${color}色`} disabled={disabled} onClick={onClick}><i style={{ background: COLORS[color] }}/>{color}{selected && <Check size={10}/>}</button>
}
function CatalogThumbnail({ item, loadProject, onThumbnailState, eager = false }: { item: CatalogItemV1; loadProject: (item: CatalogItemV1) => Promise<EditableProject>; onThumbnailState: (key: string, missing: boolean) => void; eager?: boolean }) {
  const thumbnailCallback = useRef(onThumbnailState); thumbnailCallback.current = onThumbnailState
  const host = useRef<HTMLSpanElement>(null), [urls, setUrls] = useState<string[]>([]), [state, setState] = useState<'waiting' | 'loading' | 'ready' | 'missing'>('waiting')
  useEffect(() => {
    let active = true, started = false; const created: string[] = []
    const load = () => {
      if (started) return; started = true; setState('loading')
      loadProject(item).then(async project => {
        if (!active) return
        for (const id of item.thumbnailAssetIds.slice(0, 4)) { const asset = project.document.assets[id], record = asset ? project.assets[asset.sha256] : undefined; if (record) { const bytes = await project.resources.read(record.sha256); if (!active) return; created.push(URL.createObjectURL(new Blob([bytes.slice().buffer], { type: record.mimeType }))) } }
        setUrls([...created]); setState(created.length || !item.thumbnailAssetIds.length ? 'ready' : 'missing'); thumbnailCallback.current(item.identity.key, created.length < Math.min(4, item.thumbnailAssetIds.length))
      }).catch(() => { if (active) { setState('missing'); thumbnailCallback.current(item.identity.key, true) } })
    }
    // A selected source comparison is explicit demand, including when details extend below the panel's clipped viewport.
    if (eager) load()
    const observer = eager || typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect() } }, { rootMargin: '80px' })
    if (observer && host.current) observer.observe(host.current); else load()
    return () => { active = false; observer?.disconnect(); created.forEach(url => URL.revokeObjectURL(url)) }
  }, [item, loadProject, eager])
  return <span ref={host} className={`catalog-thumbnail ${urls.length > 1 ? 'multiple' : ''}`} aria-label={`${item.name}固定源缩略图`}>
    {urls.map(url => <img key={url} src={url} alt="" onError={() => { setState('missing'); thumbnailCallback.current(item.identity.key, true) }}/>)}
    {state === 'missing' && <span>图片缺失</span>}{state === 'ready' && !item.thumbnailAssetIds.length && <span>几何素材</span>}{(state === 'waiting' || state === 'loading') && <span>载入图片</span>}
    {item.thumbnailAssetIds.length > 4 && <small>+{item.thumbnailAssetIds.length - 4}</small>}
  </span>
}
