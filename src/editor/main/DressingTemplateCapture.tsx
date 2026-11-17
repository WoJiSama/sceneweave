import { useEffect, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { prepareDressingTemplate } from '../../application/workspace/dressing-template'
import { validation, runtime } from '../../platform/browser/runtime'
import { CatalogRepositoryV1 } from './catalog'

export default function DressingTemplateCapture({ project, ids, disabled, onPendingChange, onSaved, onDraftChange }: {
  project: EditableProject; ids: readonly string[]; disabled: boolean
  onPendingChange: (pending: boolean) => void; onSaved: () => void
  onDraftChange: (dirty: boolean) => void
}) {
  const [name, setName] = useState('我的布景'), [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const active = useRef<AbortController | null>(null)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { onDraftChange(dirty); return () => onDraftChange(false) }, [dirty, onDraftChange])
  useEffect(() => () => { active.current?.abort() }, [project])
  const save = async () => {
    if (active.current || disabled) return
    const controller = new AbortController(), repository = new CatalogRepositoryV1()
    active.current = controller; setBusy(true); onPendingChange(true); setStatus('正在保存当前摆位与外观…')
    try {
      const baseline = await repository.read()
      const entry = await prepareDressingTemplate(project, { ids: [...ids], name }, { validation, runtime, signal: controller.signal })
      controller.signal.throwIfAborted()
      await repository.commit(baseline.revision, { put: [entry] }, controller.signal)
      setDirty(false); setStatus(`已保存「${entry.item.name}」到我的素材，可在其他工程放置。`); onSaved()
    } catch (error) {
      if (!controller.signal.aborted) setStatus(`布景未入库：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      repository.close()
      if (active.current === controller) { active.current = null; setBusy(false); onPendingChange(false) }
    }
  }
  return <section aria-label="保存当前布景" className="composition-source">
    <h3>保存当前布景</h3>
    <p className="asset-muted">选择独立物件或完整组合，保留当前摆位、有效外观和现存成员，保存到个人素材库。</p>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <label>布景名称<input aria-label="布景模板名称" maxLength={80} value={name} disabled={busy || disabled} onChange={event => { setName(event.target.value); setDirty(true) }}/></label>
      <button className="secondary asset-wide" disabled={disabled || busy || !ids.length || !name.trim()}>保存当前布景到我的素材</button>
    </form>
    {busy && <button className="secondary" onClick={() => active.current?.abort()}>取消保存布景</button>}
    {status && <p role="status">{status}</p>}
  </section>
}
