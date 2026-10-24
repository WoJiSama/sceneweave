import { useEffect, useRef, useState } from 'react'
import type { MigrationSetFiles } from '../../shared/migration/set'

export interface ConversionPending { kind: 'project' | 'library'; jobId: string; files: MigrationSetFiles; label: string; organizationPolicy?: 'keep-local' | 'replace-selected' | null }
export function downloadBytes(bytes: Uint8Array, name: string, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime })), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
}
export default function ConversionDialog({ pending, busy, error, onCancel, onContinue }: {
  pending: ConversionPending; busy: boolean; error: string | null; onCancel: () => void
  onContinue: (files: MigrationSetFiles, sourcePolicy: 'require-unchanged' | 'captured-copy', organizationPolicy: 'keep-local' | 'replace-selected') => void
}) {
  const root = useRef<HTMLDivElement>(null), [reread, setReread] = useState<MigrationSetFiles | null>(null), [readError, setReadError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<'require-unchanged' | 'captured-copy'>('require-unchanged'), [organization, setOrganization] = useState<'keep-local' | 'replace-selected'>(pending.organizationPolicy ?? 'keep-local')
  const epoch = useRef(0)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { epoch.current++; previous?.focus() }
  }, [])
  const read = async (files: FileList | null) => {
    const current = ++epoch.current; setReread(null); setReadError(null)
    try {
      const selected = Array.from(files ?? []), index = selected.filter(file => file.name.endsWith('.sceneweave-migration.json'))
      if (index.length !== 1 || selected.length !== pending.files.volumes.size + 1 || new Set(selected.map(file => file.name)).size !== selected.length) throw new Error('请选择一个完整索引和全部分卷，不接受重复或额外文件。')
      if (index[0].size > 16 * 1024 * 1024) throw new Error('保全索引超过16MiB。')
      const volumes = new Map<string, Uint8Array>()
      for (const [name] of pending.files.volumes) {
        const file = selected.find(value => value.name === name)
        if (!file || file.size > 33 * 1024 * 1024) throw new Error('缺少分卷或分卷超过保护值。')
        volumes.set(name, new Uint8Array(await file.arrayBuffer()))
      }
      const value = { index: new Uint8Array(await index[0].arrayBuffer()), volumes }
      if (current === epoch.current) setReread(value)
    } catch (failure) { if (current === epoch.current) setReadError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <div className="modal-scrim"><div ref={root} className="modal wide" role="dialog" aria-modal="true" aria-label="旧存档保全与转换" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel() }
    if (event.key === 'Tab') {
      const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? []), first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div className="modal-heading"><h2>旧存档保全与转换</h2><button className="secondary" onClick={onCancel}>{busy ? '停止转换' : '取消'}</button></div>
    <p>{pending.label}。原库与原文件保持，先下载以下完整文件，再重新选择所有文件核验。</p>
    <div className="snapshot-list"><button className="secondary" disabled={busy} onClick={() => downloadBytes(pending.files.index, pending.jobId + '.sceneweave-migration.json', 'application/json')}>下载保全索引</button>
      {[...pending.files.volumes].map(([name, bytes]) => <button className="secondary" key={name} disabled={busy} onClick={() => downloadBytes(bytes, name)}>下载分卷 {name}（{bytes.length} 字节）</button>)}
    </div>
    <label>重新选择保全索引和全部分卷<input aria-label="重新选择完整保全文件" type="file" multiple accept=".json,.sceneweave-migration-part" disabled={busy} onChange={event => void read(event.target.files)}/></label>
    <label>源内容检查<select aria-label="源内容变化策略" disabled={busy} value={policy} onChange={event => setPolicy(event.target.value as typeof policy)}><option value="require-unchanged">源内容必须保持捕获状态</option><option value="captured-copy">明确使用已保全内容，保留源库后续修改</option></select></label>
    {pending.kind === 'library' && <label>已有个人整理<select aria-label="个人整理冲突策略" disabled={busy || pending.organizationPolicy != null} value={organization} onChange={event => setOrganization(event.target.value as typeof organization)}><option value="keep-local">保留本机已有整理</option><option value="replace-selected">替换本次所选整理，范围外保留</option></select>{pending.organizationPolicy != null && <small>沿用此转换任务已经确认的整理策略。</small>}</label>}
    {(error || readError) && <p role="alert" className="asset-form-error">{error || readError}</p>}
    {reread && <p role="status">已重新读取 {reread.volumes.size} 个分卷，继续后执行完整性和来源校验。</p>}
    <div className="modal-actions"><button className="primary" disabled={!reread || busy} onClick={() => reread && onContinue(reread, policy, organization)}>{busy ? '正在核验与转换…' : '核验并转换'}</button></div>
  </div></div>
}
