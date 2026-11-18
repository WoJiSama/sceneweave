import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, Download, FileUp, FolderOpen, HardDrive, ImagePlus, Layers3, Map as MapIcon, PencilLine, Plus, RefreshCw, Search } from 'lucide-react'
import { projectRepository } from '../../platform/browser/runtime'
import type { ProjectDirectoryEntry, ProjectDirectoryCursor } from '../../application/ports/project-directory'
import type { WorkspaceRequest, WorkspaceSessionSummary } from './session'
import showcaseManifest from '../../platform/browser/content/home-showcase-manifest.json'
import SampleShowcase from './SampleShowcase'
import '../workspace/home.css'
import './home-ux.css'

const scenePreview = showcaseManifest.entries.wilderness

export default function WorkspaceHome({ session, onContinue, onRequest, disabled = false, developmentTools }: {
  session: WorkspaceSessionSummary | null; onContinue: () => void; onRequest: (request: WorkspaceRequest) => void
  disabled?: boolean
  developmentTools?: ReactNode
}) {
  const [entries, setEntries] = useState<ProjectDirectoryEntry[]>([]), [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0)
  const [next, setNext] = useState<ProjectDirectoryCursor | null>(null), [total, setTotal] = useState(0)
  const directoryRequest = useRef(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const clearSearch = () => { setQuery(''); searchInput.current?.focus() }
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
  useEffect(() => { const ticket = ++directoryRequest.current; setLoading(true); setNext(null)
    void projectRepository.projectDirectory({ query, limit: 50 }).then(value => {
      if (ticket === directoryRequest.current) { setEntries(value.entries); setNext(value.next); setTotal(value.total); setError(null) }
    }, failure => { if (ticket === directoryRequest.current) setError(String(failure instanceof Error ? failure.message : failure)) }).finally(() => { if (ticket === directoryRequest.current) setLoading(false) })
    // A new filter/session or unmount also invalidates a later pagination read.
    return () => { directoryRequest.current++ }
  }, [refresh, session?.sceneId, session?.revision, query])
  const loadMore = () => {
    if (!next || loading) return
    const ticket = ++directoryRequest.current; setLoading(true)
    void projectRepository.projectDirectory({ query, after: next, limit: 50 }).then(value => {
      if (ticket === directoryRequest.current) {
        setEntries(current => [...new Map([...current, ...value.entries].map(entry => [entry.sceneId, entry])).values()])
        setNext(value.next); setTotal(value.total); setError(null)
      }
    }, failure => { if (ticket === directoryRequest.current) setError(String(failure instanceof Error ? failure.message : failure)) }).finally(() => { if (ticket === directoryRequest.current) setLoading(false) })
  }
  const search = query.trim().toLocaleLowerCase()
  const filtered = entries
  const titleCounts = new Map<string, number>()
  for (const entry of entries) if (entry.summary) titleCounts.set(entry.summary.title, (titleCounts.get(entry.summary.title) ?? 0) + 1)
  const sessionStatus: Record<string, string> = { saved: '已保存到此浏览器', saving: '正在保存到此浏览器', unsaved: '等待保存到此浏览器', error: '保存失败，请返回处理', conflict: '版本冲突，请返回处理' }
  return <div className="workspace-home" data-testid="workspace-home">
    <header className="home-header">
      <a href="#home" className="home-brand" aria-label="织境首页"><Layers3 size={28} aria-hidden="true"/><span>织境 <small>Sceneweave</small></span></a>
      <div className="home-header-actions">
        <span className="home-local"><HardDrive size={15} aria-hidden="true"/>工程保存在此浏览器</span>
      </div>
    </header>
    <main className="home-content">
      <section className="home-entry" aria-labelledby="home-title">
        <div className="home-entry-copy">
          <h1 id="home-title">为跑团准备可编辑地图</h1>
          <p className="home-entry-lead">从一间房、一处营地或一段海岸开始。</p>
          {session ? <section className="home-current" aria-label="当前编辑会话">
            <div>
              <p className="home-current-label">当前编辑会话</p>
              <h2>{session.title}</h2>
              <p className="home-current-status">r{session.revision} · {sessionStatus[session.status] ?? session.status}</p>
            </div>
            <button type="button" className="primary home-main-action" disabled={disabled} onClick={onContinue}>继续编辑<ArrowRight size={17} aria-hidden="true"/></button>
          </section> : <button type="button" className="primary home-main-action" disabled={disabled} onClick={() => onRequest({ type: 'generate' })}>
            生成地图<ArrowRight size={17} aria-hidden="true"/>
          </button>}
          <div className="home-other-actions" role="group" aria-label="其他起步方式">
            {session && <button type="button" disabled={disabled} onClick={() => onRequest({ type: 'generate' })}><MapIcon size={16} aria-hidden="true"/>生成地图</button>}
            <button type="button" disabled={disabled} onClick={() => onRequest({ type: 'new' })}><Plus size={16} aria-hidden="true"/>新建场景</button>
            <button type="button" disabled={disabled} onClick={() => onRequest({ type: 'import' })}><FileUp size={16} aria-hidden="true"/>打开工程文件</button>
            <button type="button" disabled={disabled} onClick={() => onRequest({ type: 'image-import' })}><ImagePlus size={16} aria-hidden="true"/>从图片新建场景</button>
          </div>
        </div>
        <figure className="home-scene-preview">
          <img src={`${import.meta.env.BASE_URL}assets/home-scenes/${scenePreview.file}`} width={scenePreview.width} height={scenePreview.height} alt="溪流旁带小屋、营地和步道的俯视地图"/>
          <figcaption>{scenePreview.name} · 可编辑样板</figcaption>
        </figure>
      </section>
      <ol className="home-steps" role="list" aria-label="备团步骤">
        <li><MapIcon size={19} aria-hidden="true"/><div><h2>生成地图</h2><p>在「生成」中选择场景类型，预览后采用。</p></div></li>
        <li><PencilLine size={19} aria-hidden="true"/><div><h2>局部修改</h2><p>在画布上选择要调整的对象，修改房间、地形或摆设。</p></div></li>
        <li><Download size={19} aria-hidden="true"/><section aria-labelledby="home-delivery-title"><h2 id="home-delivery-title">保存与交付</h2><p>在顶栏「导出」下载玩家地图 PNG 和可编辑的 .sceneweave 工程。</p></section></li>
      </ol>
      <section className="home-projects"><div className="home-section-heading"><h2>最近工程</h2><div className="home-list-tools"><label><Search size={16}/><input ref={searchInput} aria-label="搜索最近工程" placeholder="名称或 ID" value={query} onChange={event => setQuery(event.target.value)}/></label>{query && <button className="secondary" onClick={clearSearch}>清空搜索</button>}<button className="secondary" aria-label="刷新工程列表" disabled={loading || disabled} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/>刷新</button></div></div><p className="home-project-note">当前完整工程仓库。打开工程时会检查完整内容；目录中的未读取内容尚未检查。</p>
        {loading && <p role="status">正在读取本地工程列表…{entries.length > 0 && '下方暂时显示上次结果。'}</p>}{error && <p role="alert" className="home-diagnostic">工程列表读取失败：{error}。请点击刷新重试。{entries.length > 0 && '下方保留上次结果。'}</p>}
        {!loading && !error && <p className="home-project-note" role="status">{search ? `匹配或待检查 ${total} 个工程，已显示 ${entries.length} 个` : `共 ${total} 个工程，已显示 ${entries.length} 个，按最近保存排序`}</p>}
        {!loading && !error && !filtered.length && <div className="home-empty"><FolderOpen size={25}/><p>{search ? '没有匹配的工程' : '此浏览器还没有工程'}</p>{search && <button className="secondary" onClick={clearSearch}>清空工程搜索</button>}</div>}
        <div className="home-project-list">{filtered.map(value => { const entry = value.summary; return entry ? <article className="home-project-row" key={entry.sceneId} data-project-key={`native:${entry.sceneId}`}><span className="home-file-icon"><Layers3 size={21}/></span><div className="home-project-info"><h3>{entry.title}</h3><p>完整工程 · r{entry.revision} · {new Date(entry.savedAt).toLocaleString('zh-CN')}</p><span className="home-project-identity">{session?.sceneId === entry.sceneId ? '当前会话 · ' : ''}{(titleCounts.get(entry.title) ?? 0) > 1 ? '同名工程 · ' : ''}标识 {entry.sceneId.slice(0, 8)}</span><details className="home-project-id"><summary>完整工程 ID</summary><small>{entry.sceneId}</small></details></div><button className="secondary" title={`${session?.sceneId === entry.sceneId ? '继续编辑' : '打开'}：${entry.title} · ${entry.sceneId.slice(0, 8)}`} disabled={disabled} onClick={() => session?.sceneId === entry.sceneId ? onContinue() : onRequest({ type: 'open', sceneId: entry.sceneId })}>{session?.sceneId === entry.sceneId ? '继续编辑' : '打开'}<ArrowRight size={15}/></button></article> : <article className="home-project-row" key={value.sceneId} data-project-key={`native:${value.sceneId}`}><div className="home-project-info"><h3>工程目录不可读</h3><p role="alert">{value.issue}</p><small>工程 ID：{value.sceneId}</small><p>此记录仍保留，请从备份恢复或检查原数据。</p></div>{session?.sceneId === value.sceneId && <button className="secondary" disabled={disabled} onClick={onContinue}>继续当前编辑</button>}</article> })}</div>
        {next && <button className="secondary" disabled={loading || disabled} onClick={loadMore}>加载更多工程</button>}
      </section>
      <SampleShowcase onRequest={onRequest} disabled={disabled}/>
      {developmentTools}
      <footer className="home-footer">
        <h2>本地保存与备份</h2>
        <p>已采用的编辑会自动保存到当前站点的浏览器。清除站点数据或更换设备、浏览器或站点地址前，请下载 .sceneweave 备份。通过首页「打开工程文件」恢复。</p>
        <p>工程备份包含实际素材。工程备份与主持人地图可能包含秘密，请由主持人保管。</p>
      </footer>
    </main>
  </div>
}
