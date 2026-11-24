import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { CheckCircle2, Search } from 'lucide-react'
import { downloadImages, downloadSnapshot, manifest, refreshDownloads, subscribeDownloads } from '../../platform/browser/content/fixed-downloads'
import type { FixedDownloadItem } from '../../platform/browser/content/fixed-download-manifest'
import SceneweaveLoading from './SceneweaveLoading'
import './resource-download-panel.css'

const groups = { material: '材质', prop: '物件', prefab: '组合' } as const
function sizeOf(hashes: Iterable<string>) {
  const bytes = [...new Set(hashes)].reduce((sum, hash) => sum + manifest.assets[hash].sizeBytes, 0)
  return bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function ResourceDownloadPanel() {
  const state = useSyncExternalStore(subscribeDownloads, downloadSnapshot)
  const [selected, setSelected] = useState(new Set<string>()), [query, setQuery] = useState('')
  const label = useId()
  useEffect(() => {
    void refreshDownloads()
    const refresh = () => { if (!document.hidden) void refreshDownloads() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  if (state.inventoryError) return <div className="resource-download-error" role="alert">
    <p>{state.inventoryError}</p><button className="secondary" type="button" onClick={() => void refreshDownloads()}>重新读取</button>
  </div>
  const { available } = state
  if (!available) return <SceneweaveLoading label="正在检查本地素材…"/>

  const remaining = manifest.items.map(item => ({ ...item, hashes: item.hashes.filter(hash => !available.has(hash)) }))
    .filter(item => item.hashes.length > 0)
  const selectedItems = remaining.filter(item => selected.has(item.id)), selectedHashes = selectedItems.flatMap(item => item.hashes)
  const allHashes = remaining.flatMap(item => item.hashes)
  const failedHashes = [...state.failures.keys()].filter(hash => !available.has(hash))
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const search = query.trim().toLocaleLowerCase()
  const matches = remaining.filter(item => (item.name + groups[item.kind]).toLocaleLowerCase().includes(search))
  function row(item: FixedDownloadItem) {
    const error = item.hashes.map(hash => state.failures.get(hash)).find(Boolean)
    return <label className="resource-download-row" key={item.id}>
      <input type="checkbox" aria-label={item.name} checked={selected.has(item.id)} disabled={state.running} onChange={() => toggle(item.id)}/>
      <span>{item.name}{error && <small>{error}</small>}</span>
      <span className="resource-download-size">{item.kind === 'prefab' && `${item.hashes.length} 张 · `}{sizeOf(item.hashes)}</span>
    </label>
  }
  return <>
    <p className="resource-download-intro">把内置地图素材存到此浏览器，编辑时可直接使用。选择组合会自动补齐缺少的图片。</p>
    {remaining.length > 0 ? <>
      <div className="resource-download-tools">
        <strong id={label}>未下载 {remaining.length} 项 · {sizeOf(allHashes)}</strong>
        <label className="resource-download-search"><Search size={15} aria-hidden="true"/><input type="search" aria-label="搜索未下载素材" placeholder="搜索素材" value={query} onChange={event => setQuery(event.target.value)}/></label>
      </div>
      <div className="resource-download-list" role="region" aria-labelledby={label} tabIndex={0}>
        {(Object.keys(groups) as (keyof typeof groups)[]).map(kind => {
          const items = matches.filter(item => item.kind === kind)
          return items.length > 0 && <fieldset key={kind}><legend>{groups[kind]}</legend>{items.map(row)}</fieldset>
        })}
        {!matches.length && <p className="resource-download-empty">没有与「{query}」匹配的未下载素材。</p>}
      </div>
    </> : <p className="resource-download-empty" role="status"><CheckCircle2 size={24} aria-hidden="true"/>本目录的素材图片已全部下载</p>}
    {state.total > 0 && (state.running || remaining.length > 0) && <div className="resource-download-progress" role="status">
      {state.running ? <><progress max={state.total} value={state.finished} aria-label="素材下载进度"/>
        <span>已处理 {state.finished} / {state.total} 张图片。关闭窗口后会在此标签页继续下载。</span></>
        : failedHashes.length ? <span>{failedHashes.length} 张图片下载失败。已完成的图片已保存。</span>
        : <span>本次已下载 {state.total} 张图片。</span>}
    </div>}
    <div className="resource-download-actions">
      <span>{selectedItems.length ? `已选 ${selectedItems.length} 项 · ${sizeOf(selectedHashes)}` : ''}</span>
      {!state.running && failedHashes.length > 0 && <button type="button" className="secondary" onClick={() => void downloadImages(failedHashes)}>重试失败项</button>}
      <button type="button" className="secondary" disabled={state.running || !remaining.length} onClick={() => void downloadImages(allHashes)}>全部下载</button>
      <button type="button" className="primary" disabled={!selectedItems.length || state.running} onClick={() => void downloadImages(selectedHashes)}>下载所选</button>
    </div>
  </>
}
