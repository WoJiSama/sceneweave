import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, FileUp, FolderOpen, Layers3, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { projectRepository } from '../../platform/browser/runtime'
import type { ProjectSummary } from '../../platform/browser/storage/repository'
import type { WorkspaceRequest, WorkspaceSessionSummary } from './session'
import SampleShowcase from './SampleShowcase'
import '../workspace/home.css'
import './home-ux.css'

export default function WorkspaceHome({ session, onContinue, onRequest, disabled = false, developmentTools }: {
  session: WorkspaceSessionSummary | null; onContinue: () => void; onRequest: (request: WorkspaceRequest) => void
  disabled?: boolean
  developmentTools?: ReactNode
}) {
  const [entries, setEntries] = useState<ProjectSummary[]>([]), [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const clearSearch = () => { setQuery(''); searchInput.current?.focus() }
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
  useEffect(() => { let active = true; setLoading(true)
    void projectRepository.list().then(value => { if (active) { setEntries(value); setError(null) } }, failure => { if (active) setError(String(failure instanceof Error ? failure.message : failure)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh, session?.sceneId, session?.revision])
  const search = query.trim().toLocaleLowerCase()
  const filtered = entries.filter(entry => `${entry.title} ${entry.sceneId}`.toLocaleLowerCase().includes(search))
  const titleCounts = new Map<string, number>()
  for (const entry of entries) titleCounts.set(entry.title, (titleCounts.get(entry.title) ?? 0) + 1)
  const sessionStatus: Record<string, string> = { saved: '本地已保存', saving: '正在保存', unsaved: '等待保存', error: '保存失败，请返回处理', conflict: '版本冲突，请返回处理' }
  return <div className="workspace-home" data-testid="workspace-home">
    <header className="home-header"><a href="#home" className="home-brand" aria-label="织境首页"><Layers3 size={28}/><span>织境 <small>Sceneweave</small></span></a><span className="home-local"><ShieldCheck size={15}/>本地优先 · 完整工程</span></header>
    <main className="home-content">
      <section className="home-hero"><div className="home-intro"><p className="home-eyebrow">YOUR NEXT ADVENTURE STARTS HERE</p><h1>把故事画成可以探索的地方</h1><p>从一间房、一段海岸开始。用建筑、地形与素材，编织你的下一场冒险。</p><div className="home-actions"><button className="primary" disabled={disabled} onClick={() => onRequest({ type: 'new' })}><Plus size={18}/>新建场景</button><button className="secondary" disabled={disabled} onClick={() => onRequest({ type: 'generate' })}><Layers3 size={17}/>生成地图</button><button className="secondary" disabled={disabled} onClick={() => onRequest({ type: 'import' })}><FileUp size={17}/>打开工程文件</button></div><small>完整工程保留素材、许可与明确选择的历史。请定期下载备份。</small></div><div className="home-map" aria-hidden="true"><div className="home-map-grid"/><div className="home-map-room room-one"/><div className="home-map-room room-two"/><div className="home-map-table"/><i className="home-map-tree tree-one"/><i className="home-map-tree tree-two"/><i className="home-map-tree tree-three"/><span>一张地图，无数种故事</span></div></section>
      {session && <section className="home-continue" aria-label="当前编辑会话"><div><p>当前编辑会话</p><h2>{session.title}</h2><span>r{session.revision} · {sessionStatus[session.status] ?? session.status} · 保留选区、视口和撤销记录</span></div><button className="primary" disabled={disabled} onClick={onContinue}>继续编辑<ArrowRight size={16}/></button></section>}
      <section className="home-projects"><div className="home-section-heading"><h2>最近工程</h2><div className="home-list-tools"><label><Search size={16}/><input ref={searchInput} aria-label="搜索最近工程" placeholder="名称或 ID" value={query} onChange={event => setQuery(event.target.value)}/></label>{query && <button className="secondary" onClick={clearSearch}>清空搜索</button>}<button className="secondary" aria-label="刷新工程列表" disabled={loading || disabled} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/>刷新</button></div></div><p className="home-project-note">当前完整工程仓库。工程文件包含场景、素材、许可和明确选择的历史。</p>
        {loading && <p role="status">正在读取本地工程列表…{entries.length > 0 && '下方暂时显示上次结果。'}</p>}{error && <p role="alert" className="home-diagnostic">工程列表读取失败：{error}。请点击刷新重试。{entries.length > 0 && '下方保留上次结果。'}</p>}
        {!loading && !error && <p className="home-project-note" role="status">{search ? `找到 ${filtered.length} 个工程，共 ${entries.length} 个` : `共 ${entries.length} 个工程，按最近保存排序`}</p>}
        {!loading && !error && !filtered.length && <div className="home-empty"><FolderOpen size={25}/><p>{search ? '没有匹配的工程' : '从第一张场景开始'}</p>{search ? <button className="secondary" onClick={clearSearch}>清空工程搜索</button> : <p>可以新建空白场景、生成地图，或打开已有工程文件。</p>}</div>}
        <div className="home-project-list">{filtered.map(entry => <article className="home-project-row" key={entry.sceneId} data-project-key={`native:${entry.sceneId}`}><span className="home-file-icon"><Layers3 size={21}/></span><div className="home-project-info"><h3>{entry.title}</h3><p>完整工程 · r{entry.revision} · {new Date(entry.savedAt).toLocaleString('zh-CN')}</p><span className="home-project-identity">{session?.sceneId === entry.sceneId ? '当前会话 · ' : ''}{(titleCounts.get(entry.title) ?? 0) > 1 ? '同名工程 · ' : ''}标识 {entry.sceneId.slice(0, 8)}</span><details className="home-project-id"><summary>完整工程 ID</summary><small>{entry.sceneId}</small></details></div><button className="secondary" title={`${session?.sceneId === entry.sceneId ? '继续编辑' : '打开'}：${entry.title} · ${entry.sceneId.slice(0, 8)}`} disabled={disabled} onClick={() => session?.sceneId === entry.sceneId ? onContinue() : onRequest({ type: 'open', sceneId: entry.sceneId })}>{session?.sceneId === entry.sceneId ? '继续编辑' : '打开'}<ArrowRight size={15}/></button></article>)}</div>
      </section>
      <SampleShowcase onRequest={onRequest} disabled={disabled}/>
      {developmentTools}
      <footer className="home-footer"><p>工程保存在此浏览器。当前版本使用完整工程和统一工作区；不同浏览器、设备和站点地址拥有各自的存储。</p></footer>
    </main>
  </div>
}
