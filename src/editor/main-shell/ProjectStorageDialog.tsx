import { useEffect, useRef, useState } from 'react'
import type { ProjectDirectoryCursor, ProjectDirectoryEntry } from '../../application/ports/project-directory'
import { HISTORY_LIMITS } from '../../shared/model/history'
import { browserStorageStatus, nearProjectStorageLimit, storageBytes, storageDelta, type BrowserStorageStatus } from '../../platform/browser/storage/local-retention'
import type { ImageDraftUsage, ImageWorkflowStore } from '../../platform/browser/content/image-workflow-store'
import { downloadFile } from './recovery-file'
import './project-storage.css'

type StorageUse = { resourceBytes: number; documentBytes: number }
type Confirmation = { id: string; title: string; kind: 'remove' | 'trim'; review: object }

async function withImageDrafts<T>(action: (store: ImageWorkflowStore) => Promise<T>): Promise<T> {
  const { ImageWorkflowStore } = await import('../../platform/browser/content/image-workflow-store')
  const store = new ImageWorkflowStore()
  try { return await action(store) } finally { store.close() }
}

export function ProjectStorageDialog({ onClose, onChange, activeSceneId, onReleaseActive }: {
  onClose(): void; onChange?(): void; activeSceneId?: string; onReleaseActive?(): Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [entries, setEntries] = useState<ProjectDirectoryEntry[]>([]), [next, setNext] = useState<ProjectDirectoryCursor | null>(null)
  const [selected, setSelected] = useState(''), [confirmation, setConfirmation] = useState<Confirmation>()
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [usage, setUsage] = useState<StorageUse>(), [browser, setBrowser] = useState<BrowserStorageStatus>()
  const [projectChange, setProjectChange] = useState<StorageUse>(), [draftUsage, setDraftUsage] = useState<ImageDraftUsage>()
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    let active = true
    void browserStorageStatus().then(value => { if (active) setBrowser(value) })
    void import('../../platform/browser/runtime').then(async ({ projectRepository }) => {
      const page = await projectRepository.projectDirectory({ limit: 50 })
      if (active) { setEntries(page.entries); setNext(page.next) }
    }).catch(failure => { if (active) setError(String(failure instanceof Error ? failure.message : failure)) })
    return () => { active = false; node.close() }
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() }
    catch (failure) { setError(String(failure instanceof Error ? failure.message : failure)) }
    finally { setBusy(false) }
  }
  const row = entries.find(value => value.sceneId === selected)
  const checkUsage = () => run(async () => {
    const { projectRepository } = await import('../../platform/browser/runtime')
    const [project, drafts, status] = await Promise.allSettled([
      projectRepository.usage('local-storage-overview'), withImageDrafts(store => store.usage()), browserStorageStatus(),
    ] as const)
    if (project.status === 'fulfilled') setUsage(project.value)
    if (drafts.status === 'fulfilled') setDraftUsage(drafts.value)
    if (status.status === 'fulfilled') setBrowser(status.value)
    setProjectChange(projectRepository.recentStorageChange())
    const problems = [project, drafts, status].filter(result => result.status === 'rejected')
    if (problems.length) throw new Error(problems.map(result => String(result.reason instanceof Error ? result.reason.message : result.reason)).join(' · '))
  })
  const compactDrafts = () => run(async () => {
    const { result, usage } = await withImageDrafts(async store => {
      const result = await store.compactLegacyDrafts()
      return { result, usage: await store.usage() }
    })
    setDraftUsage(usage); setBrowser(await browserStorageStatus())
    setNotice(`已整理 ${result.drafts} 份旧草稿 · ${storageDelta(-result.bytesFreed)}${result.skipped ? ` · ${result.skipped} 份原包已保留` : ''}。`)
  })
  const reclaim = () => run(async () => {
    const { projectRepository } = await import('../../platform/browser/runtime')
    const result = await projectRepository.reclaimProjectStorage()
    setUsage(undefined)
    setBrowser(await browserStorageStatus())
    setNotice(`已回收 ${result.resourceCount} 份资源、${result.licenseCount} 份许可和 ${result.blockCount} 个工程内容块 · 资源与许可减少 ${storageBytes(result.resourceBytes + result.licenseBytes)}。`)
    onChange?.()
  })
  const backup = () => run(async () => {
    if (!row) return
    const [{ projectRepository, validation }, { exportProjectBackup }] = await Promise.all([
      import('../../platform/browser/runtime'), import('../../platform/browser/export/project-backup'),
    ])
    const project = await projectRepository.load(row.sceneId)
    if (!project) throw new Error('工程没有可读取的已保存版本。')
    const archive = await exportProjectBackup(project, { ...validation, signal: undefined })
    downloadFile(archive, 'sceneweave-complete.sceneweave')
    setNotice(`已发起完整工程备份下载 · ${storageBytes(archive.size)}。文件含主持人信息，请在浏览器下载列表确认。`)
  })
  const verifySelected = () => run(async () => {
    if (!row) return
    const { projectRepository } = await import('../../platform/browser/runtime')
    try {
      if (!await projectRepository.load(row.sceneId)) throw new Error('找不到已保存的版本。')
    } catch (failure) {
      throw new Error(`所选工程无法打开。 ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    setNotice('所选工程的当前存档和实际资源可正常打开。')
  })
  const prepare = (kind: Confirmation['kind']) => run(async () => {
    if (!row || kind === 'remove' && row.sceneId === activeSceneId && !onReleaseActive) return
    const { projectRepository } = await import('../../platform/browser/runtime')
    const review = await projectRepository.reviewProjectMaintenance(row.sceneId, row.summary?.revision)
    setConfirmation({ id: row.sceneId, title: row.summary?.title ?? row.sceneId, kind, review })
  })
  const apply = () => run(async () => {
    if (!confirmation) return
    setConfirmation(undefined)
    const { projectRepository } = await import('../../platform/browser/runtime')
    if (confirmation.kind === 'remove') {
      if (confirmation.id === activeSceneId) {
        if (!onReleaseActive) throw new Error('请先关闭该工程的编辑会话。')
        await onReleaseActive()
      }
      await projectRepository.removeProject(confirmation.review)
      try { if (localStorage.getItem('sceneweave.mainSceneId') === confirmation.id) localStorage.removeItem('sceneweave.mainSceneId') } catch { /* This hint is optional. */ }
      setEntries(value => value.filter(entry => entry.sceneId !== confirmation.id)); setSelected('')
      setNotice('已移除此工程及其历史。可用「回收无引用数据」释放占用。')
    } else {
      const count = await projectRepository.trimProjectHistory(confirmation.review)
      setNotice(count ? `已清理 ${count} 条旧版本。当前存档和已标记的快照可继续使用。` : '该工程没有可清理的未标记版本。')
    }
    setUsage(undefined); onChange?.()
  })
  const more = () => run(async () => {
    if (!next) return
    const { projectRepository } = await import('../../platform/browser/runtime')
    const page = await projectRepository.projectDirectory({ limit: 50, after: next })
    setEntries(value => [...new Map([...value, ...page.entries].map(entry => [entry.sceneId, entry])).values()])
    setNext(page.next)
  })
  const nearLimit = nearProjectStorageLimit(usage)
  const nearBrowserLimit = browser?.quota && (browser.used ?? 0) >= browser.quota * .85
  return <dialog ref={dialog} className="home-detail-dialog project-storage-dialog" aria-labelledby="project-storage-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id="project-storage-title">管理本地存储</h2>
    <div className="project-storage-actions">
      <button type="button" className="secondary" disabled={busy} onClick={() => void checkUsage()}>检查本地存储用量</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => void reclaim()}>回收无引用数据</button>
    </div>
    {usage && <p>工程资源 {storageBytes(usage.resourceBytes)} / {storageBytes(HISTORY_LIMITS.storedResourceBytes)} · 工程与历史 {storageBytes(usage.documentBytes)} / {storageBytes(HISTORY_LIMITS.storedDocumentBytes)}</p>}
    {projectChange && <p>本页最近一次工程写入 · 资源{storageDelta(projectChange.resourceBytes)} · 工程与历史{storageDelta(projectChange.documentBytes)}</p>}
    {draftUsage && <section aria-label="图片草稿占用">
      <p>图片草稿 {draftUsage.drafts} 份 · {storageBytes(draftUsage.bytes)}。草稿记录 {storageBytes(draftUsage.draftBytes)} · 共享图像 {storageBytes(draftUsage.sharedImageBytes)}。</p>
      {draftUsage.lastChange && <p>本页最近一次草稿操作 · {storageDelta(draftUsage.lastChange.bytes)}</p>}
      {draftUsage.legacyDrafts > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => void compactDrafts()}>整理旧图片草稿（{draftUsage.legacyDrafts} 份）</button>}
    </section>}
    {(nearLimit || nearBrowserLimit) && <p role="status" className="home-diagnostic">存储接近上限。请先下载并验证备份，再整理历史或移除不需要的工程。</p>}
    {browser && <section aria-label="浏览器保留状态">
      {browser.used !== undefined && <p>浏览器报告的站点占用约 {storageBytes(browser.used)}{browser.quota !== undefined && ` / ${storageBytes(browser.quota)}`}。</p>}
      <p>{browser.persistent ? '浏览器已允许持久存储。' : '浏览器可能在空间紧张时回收站点数据。'} 请定期下载工程、素材库和模板库备份。</p>
      {!browser.persistent && browser.requestable && <button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => {
        const status = await browserStorageStatus(true)
        setBrowser(status); setNotice(status.persistent ? '浏览器已允许持久存储。' : '浏览器尚未授予持久存储，请保留下载的备份。')
      })}>申请持久存储</button>}
    </section>}
    <label>工程
      <select value={selected} disabled={busy || confirmation !== undefined} onChange={event => setSelected(event.target.value)}>
        <option value="">选择本地工程</option>
        {entries.map(entry => <option key={entry.sceneId} value={entry.sceneId}>{entry.summary?.title ?? '目录不可读'} · {entry.sceneId.slice(0, 8)}</option>)}
      </select>
    </label>
    {next && <button type="button" className="secondary" disabled={busy} onClick={() => void more()}>加载更多工程</button>}
    {row && !confirmation && <>
      {row.sceneId === activeSceneId && <p>{onReleaseActive ? '确认移除时会先关闭编辑会话。' : '此工程仍在编辑会话中。可以先整理其他工程。'}</p>}
      <div className="project-storage-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => void verifySelected()}>检查所选工程</button>
        <button type="button" className="secondary" disabled={busy || !row.summary} onClick={() => void backup()}>下载已保存工程 · 含秘密</button>
        <button type="button" className="secondary" disabled={busy || !row.summary} onClick={() => void prepare('trim')}>整理旧版本</button>
        <button type="button" className="secondary" disabled={busy || row.sceneId === activeSceneId && !onReleaseActive} onClick={() => void prepare('remove')}>移除本地工程</button>
      </div>
    </>}
    {confirmation && <section aria-label="确认工程整理">
      <p><strong>「{confirmation.title}」</strong>{confirmation.kind === 'remove'
        ? '及其历史将从此浏览器移除。请先确认你有可用备份，或明确接受失去这份本地记录。'
        : '将保留当前存档、命名快照、保护快照和导入来源快照。其他历史与分支将移除。'}</p>
      <div className="project-storage-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{confirmation.kind === 'remove' ? '确认移除此工程及历史' : '确认清理其他版本'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmation(undefined)}>取消整理</button>
      </div>
    </section>}
    {busy && <p role="status">正在检查本地数据…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="home-diagnostic">{error}</p>}
    <button className="secondary" type="button" disabled={busy} onClick={onClose} autoFocus>关闭</button>
  </dialog>
}
