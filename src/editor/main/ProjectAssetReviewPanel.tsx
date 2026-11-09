import { useEffect, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { prepareProjectAssetReviews, type ProjectAssetReviews } from '../../platform/browser/assets/review-content'
import AssetReviewPanel from './AssetReviewPanel'

type Prepared = ProjectAssetReviews & { owner: EditableProject }
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Preparing review descriptors is explicit and read-only; recording an actual
 * conclusion remains the independent review panel's deliberate action. */
export default function ProjectAssetReviewPanel({ project, disabled, onPendingChange }: {
  project: EditableProject; disabled: boolean; onPendingChange?: (pending: boolean) => void
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null), [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null), epoch = useRef(0), mounted = useRef(false)
  const latest = useRef(project); latest.current = project
  const activity = useRef({ preparing: false, recording: false }), notify = useRef(onPendingChange); notify.current = onPendingChange
  const report = (patch: Partial<typeof activity.current>) => {
    Object.assign(activity.current, patch); notify.current?.(activity.current.preparing || activity.current.recording)
  }
  useEffect(() => {
    mounted.current = true
    epoch.current++; operation.current?.abort(); operation.current = null
    report({ preparing: false, recording: false })
    setPrepared(null); setSelectedKeys([]); setPending(false); setError('')
    return () => {
      mounted.current = false; epoch.current++; operation.current?.abort(); operation.current = null
      report({ preparing: false, recording: false })
    }
  }, [project])
  const cancel = () => {
    epoch.current++; operation.current?.abort(); operation.current = null
    report({ preparing: false })
    setPending(false); setPrepared(null); setSelectedKeys([]); setError('')
  }
  const prepare = async () => {
    if (disabled || operation.current) return
    const controller = new AbortController(), token = ++epoch.current
    report({ preparing: true })
    operation.current = controller; setPending(true); setError(''); setPrepared(null); setSelectedKeys([])
    const current = () => mounted.current && !controller.signal.aborted && epoch.current === token
      && latest.current === project
    try {
      const result = await prepareProjectAssetReviews(project, controller.signal)
      if (current()) setPrepared({ ...result, owner: project })
    } catch (error) { if (current()) setError(failureText(error)) }
    finally { if (current()) { operation.current = null; setPending(false); report({ preparing: false }) } }
  }
  // A new project is ineligible immediately, before effect cleanup can run.
  const ready = prepared?.owner === project ? prepared : null
  return <details className="theme-pack-review"><summary>本工程素材审核</summary>
    <p>准备后可选择本工程固定素材，记录许可、技术、美术和场景审核。此操作只读取实际素材闭包，不改变工程，也不自动产生审核通过或P3。</p>
    <button type="button" className="secondary asset-wide" disabled={disabled || pending} onClick={() => void prepare()}>准备本工程素材审核</button>
    {pending && <><p role="status">正在核对本工程素材的实际资源与固定依赖…</p><button type="button" className="secondary asset-wide" onClick={cancel}>取消准备素材审核</button></>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
    {ready && (ready.items.length ? <fieldset disabled={disabled || pending}>
      <legend>选择审核项</legend>
      <button type="button" className="secondary" onClick={() => setSelectedKeys(ready.items.map(item => item.identity.key))}>全选素材</button>
      <button type="button" className="secondary" onClick={() => setSelectedKeys([])}>清空选择</button>
      <ul>{ready.items.map(item => <li key={item.identity.key}><label><input type="checkbox" checked={selectedKeys.includes(item.identity.key)}
        onChange={event => setSelectedKeys(current => event.target.checked ? [...current.filter(key => key !== item.identity.key), item.identity.key] : current.filter(key => key !== item.identity.key))}/>
        {item.name} · {item.selector.kind === 'prop' ? '物件' : item.selector.kind === 'material' ? '材质' : '组合'} · {item.originLabel}</label></li>)}</ul>
      <AssetReviewPanel key={ready.content.map(item => item.catalogKey).join('\n')} content={ready.content} items={ready.items}
        selectedKeys={selectedKeys} disabled={disabled} onPendingChange={recording => report({ recording })}/>
    </fieldset> : <p role="status">本工程没有可审核的固定物件、材质或组合。</p>)}
  </details>
}
