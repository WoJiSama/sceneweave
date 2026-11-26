import { useEffect, useState } from 'react'
import { IMAGE_WORK_STORAGE_LIMITS, type ImageWorkflowStore, type LocalImageDraft, type LocalImageDraftPage } from '../../platform/browser/content/image-workflow-store'

function draftName(draft: LocalImageDraft): string {
  return draft.title || '未命名制作草稿'
}

export function downloadImageWork(bytes: Uint8Array, title: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${title}.sceneweave-image-work`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ImageWorkDrafts({ store, activeId, disabled, onResume, onRemoved }: {
  store: ImageWorkflowStore
  activeId?: string
  disabled: boolean
  onResume: (draft: LocalImageDraft) => Promise<void>
  onRemoved: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [page, setPage] = useState<LocalImageDraftPage | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = () => { setOffset(0); setRefresh(value => value + 1) }
  useEffect(() => {
    let active = true
    setPage(null)
    void store.listLocalDrafts(offset).then(result => { if (active) setPage(result) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [store, offset, refresh])

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); reload() }
    finally { setBusy(false) }
  }
  const locked = disabled || busy
  const latest = offset === 0 ? page?.drafts[0] : undefined
  const selected = page?.drafts.find(draft => draft.id === selectedId) ?? page?.drafts[0]
  const next = page?.nextOffset
  const remove = (draft: LocalImageDraft) => {
    if (!window.confirm(`移除「${draftName(draft)}」的本机制作草稿？可先下载工作包以便恢复。`)) return
    void run(async () => { await store.removeLocalDraft(draft); reload(); onRemoved() })
  }
  return <div data-image-work-drafts>
    {!activeId && latest && <>
      <p>上次：{draftName(latest)}{!latest.title && ` · ${new Date(latest.updatedAt).toLocaleString('zh-CN')}`}
        {latest.nextAction && <><br/>下一步：{latest.nextAction}</>}</p>
      <button type="button" disabled={locked} onClick={() => void run(() => onResume(latest))}>继续上次拆分</button>
    </>}
    <details onToggle={event => { if (event.currentTarget.open) reload() }}>
      <summary>本机制作草稿{page ? ` · ${page.total} 份` : ''}</summary>
      <p>自动保存最多 {IMAGE_WORK_STORAGE_LIMITS.drafts} 份，共 {IMAGE_WORK_STORAGE_LIMITS.bytes / 1024 ** 2} MiB。</p>
      {page?.total === 0 && <p>此浏览器还没有已保存的制作草稿。</p>}
      {selected && <>
        <label>制作草稿<select aria-label="选择本机制作草稿" value={selected.id} disabled={locked} onChange={event => setSelectedId(event.target.value)}>
          {page!.drafts.map(draft => <option key={draft.id} value={draft.id}>
            {draftName(draft)} · {new Date(draft.updatedAt).toLocaleString('zh-CN')} · {(draft.byteLength / 1024).toFixed(1)} KiB
          </option>)}
        </select></label>
        {!activeId && <button type="button" disabled={locked} onClick={() => void run(() => onResume(selected))}>打开所选草稿</button>}
        <button type="button" disabled={locked} onClick={() => void run(async () => {
          const { work, bytes } = await store.loadLocalDraft(selected)
          downloadImageWork(bytes, work.state.draft.title)
        })}>下载所选工作包</button>
        <button type="button" disabled={locked || activeId === selected.id} onClick={() => remove(selected)}>移除所选草稿</button>
      </>}
      {offset > 0 && <button type="button" disabled={locked} onClick={reload}>回到最新草稿</button>}
      {next != null && <button type="button" disabled={locked} onClick={() => setOffset(next)}>更早的草稿</button>}
    </details>
    {error && <p role="alert" className="image-import-error">{error}</p>}
  </div>
}
