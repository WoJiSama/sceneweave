import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Download, FileUp, FolderOpen, HardDrive, ImagePlus, Layers3, Map as MapIcon, PencilLine, Plus, RefreshCw, Search } from 'lucide-react'
import { tutorialHash, tutorialHref } from '../../tutorial/location'
import type { ProjectDirectoryEntry, ProjectDirectoryCursor, ProjectDirectoryPage, ProjectDirectoryQuery } from '../../application/ports/project-directory'
import type { WorkspaceRequest, WorkspaceSessionSummary } from './session'
import showcaseManifest from '../../platform/browser/content/home-showcase-manifest.json'
import SampleShowcase, { obliqueImage, sceneImage } from './SampleShowcase'
import HomePreviewImage, { HomePreviewsPaused } from './HomePreviewImage'
import ResourceDownloadButton from './ResourceDownloadButton'
import { HomeArtStyleDemo, HomeObliqueDemo } from './HomeDemos'
import StartupSceneDialog, { type StartupSceneDialogProps } from './StartupSceneDialog'
import { currentDatabaseNames } from '../../platform/browser/storage/current-databases'
import { browserStorageStatus, hadLocalProjects, rememberLocalProjects } from '../../platform/browser/storage/local-retention'
import { ProjectStorageDialog } from './ProjectStorageDialog'
import { ISSUE_LINK } from './WorkspaceCrashBoundary'
import { PROJECT_WRITER_BUILD } from '../../shared/project/format'
import { homeSections, isHomeSectionHash } from './location'
import '../workspace/home.css'
import './home-ux.css'

const scenePreview = showcaseManifest.entries.wilderness

async function listedDatabases() {
  try { return await globalThis.indexedDB?.databases?.() }
  catch { return undefined }
}

async function readProjectDirectory(query: ProjectDirectoryQuery): Promise<ProjectDirectoryPage> {
  const name = currentDatabaseNames().projects
  const databases = await listedDatabases()
  if (databases && !databases.some(database => database.name === name)) return { entries: [], total: 0, next: null }
  const { projectRepository } = await import('../../platform/browser/runtime')
  return projectRepository.projectDirectory(query)
}

export default function WorkspaceHome({ session, onContinue, onRequest, disabled = false, startupScene, onReleaseActive }: {
  session: WorkspaceSessionSummary | null; onContinue: () => void; onRequest: (request: WorkspaceRequest) => void
  disabled?: boolean
  startupScene?: StartupSceneDialogProps
  onReleaseActive?(): Promise<void>
}) {
  const [entries, setEntries] = useState<ProjectDirectoryEntry[]>([]), [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0)
  const [next, setNext] = useState<ProjectDirectoryCursor | null>(null), [total, setTotal] = useState(0)
  const directoryRequest = useRef(0)
  const searchInput = useRef<HTMLInputElement>(null)
  const clearSearch = () => { setQuery(''); searchInput.current?.focus() }
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
  const [storage, setStorage] = useState(false), [storageMissing, setStorageMissing] = useState(false), [browserStorageLow, setBrowserStorageLow] = useState(false)
  const afterMaintenance = useRef(false)
  useEffect(() => {
    let active = true
    void browserStorageStatus().then(value => {
      if (active) setBrowserStorageLow(!!value.quota && (value.used ?? 0) >= value.quota * .85)
    })
    return () => { active = false }
  }, [refresh])
  useEffect(() => {
    const showSection = () => {
      const hash = window.location.hash
      if (!isHomeSectionHash(hash)) return
      const heading = document.getElementById(hash.slice(1))
      heading?.focus({ preventScroll: true })
      heading?.scrollIntoView({ block: 'start' })
    }
    showSection()
    window.addEventListener('hashchange', showSection)
    return () => window.removeEventListener('hashchange', showSection)
  }, [])
  useEffect(() => { const ticket = ++directoryRequest.current; setLoading(true); setNext(null)
    void readProjectDirectory({ query, limit: 50 }).then(value => {
      if (ticket === directoryRequest.current) {
        setEntries(value.entries); setNext(value.next); setTotal(value.total); setError(null)
        if (!query.trim()) {
          if (value.total) rememberLocalProjects()
          else if (afterMaintenance.current) rememberLocalProjects(false)
          setStorageMissing(!value.total && hadLocalProjects())
          afterMaintenance.current = false
        }
      }
    }, failure => { if (ticket === directoryRequest.current) setError(String(failure instanceof Error ? failure.message : failure)) }).finally(() => { if (ticket === directoryRequest.current) setLoading(false) })
    // A new filter/session or unmount also invalidates a later pagination read.
    return () => { directoryRequest.current++ }
  }, [refresh, session?.sceneId, session?.revision, query])
  const loadMore = () => {
    if (!next || loading) return
    const ticket = ++directoryRequest.current; setLoading(true)
    void readProjectDirectory({ query, after: next, limit: 50 }).then(value => {
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
  return <><div id="home" className="workspace-home" data-testid="workspace-home">
    <header className="home-header">
      <a href="#home" className="home-brand" aria-label="织境首页"><Layers3 size={28} aria-hidden="true"/><span>织境 <small>Sceneweave</small></span></a>
      <div className="home-header-actions">
        <span className="home-local"><HardDrive size={15} aria-hidden="true"/>工程保存在此浏览器</span>
        <ResourceDownloadButton className="home-tutorial-link"/>
        <a className="home-tutorial-link" href={tutorialHash}><BookOpen size={16} aria-hidden="true"/>使用教程</a>
      </div>
    </header>
    <main className="home-content">
      <HomePreviewsPaused.Provider value={!!startupScene}>
      <section className="home-entry" aria-labelledby="home-title">
        <div className="home-entry-copy">
          <h1 id="home-title">在浏览器里画跑团地图</h1>
          <p className="home-entry-lead">在正俯视画布上画房间、铺道路、摆家具。切到 3D 斜俯视，转到喜欢的角度出图。</p>
          {session ? <section className="home-current" aria-label="当前编辑会话">
            <div>
              <p className="home-current-label">当前编辑会话</p>
              <h2>{session.title}</h2>
              <p className="home-current-status">r{session.revision} · {sessionStatus[session.status] ?? session.status}</p>
            </div>
            <button type="button" className="primary home-main-action" disabled={disabled} onClick={onContinue}>继续编辑<ArrowRight size={17} aria-hidden="true"/></button>
          </section> : <div className="home-start-actions">
            <a className="home-sample-link" href={`#${homeSections.samples}`}><Layers3 size={17} aria-hidden="true"/>从样板开始<ArrowRight size={17} aria-hidden="true"/></a>
            <button type="button" className="primary home-main-action" disabled={disabled} onClick={() => onRequest({ type: 'new' })}><PencilLine size={17} aria-hidden="true"/>新建场景</button>
          </div>}
          <div className="home-other-actions" role="group" aria-label="其他起步方式">
            {session && <button type="button" disabled={disabled} onClick={() => onRequest({ type: 'new' })}><Plus size={16} aria-hidden="true"/>新建场景</button>}
            {session && <a href={`#${homeSections.samples}`}><Layers3 size={16} aria-hidden="true"/>从样板开始</a>}
            <button type="button" disabled={disabled} onClick={() => onRequest({ type: 'image-import' })}><ImagePlus size={16} aria-hidden="true"/>从图片新建场景</button>
            <button type="button" disabled={disabled} title="按尺寸和用途生成，可在本机完成" onClick={() => onRequest({ type: 'generate' })}><MapIcon size={16} aria-hidden="true"/>生成地图</button>
            <button type="button" disabled={disabled} onClick={() => onRequest({ type: 'import' })}><FileUp size={16} aria-hidden="true"/>打开工程文件</button>
          </div>
          <nav className="home-entry-links" aria-label="首页快捷入口">
            <a href={`#${homeSections.artStyle}`}>试画风</a>
            <a href={`#${homeSections.oblique}`}>试 3D 取景</a>
            <a href={`#${homeSections.projects}`}>最近工程</a>
          </nav>
        </div>
        <figure className="home-scene-preview">
          <div className="home-featured-views">
            <div><HomePreviewImage src={sceneImage('wilderness')} width={scenePreview.width} height={scenePreview.height} alt="溪流旁的小屋、树木和木桥"/><span>正俯视</span></div>
            <div><HomePreviewImage src={obliqueImage(scenePreview.oblique)} width={scenePreview.oblique.width} height={scenePreview.oblique.height} alt="溪岸小屋、树冠和木桥的侧面"/><span>3D 斜俯视</span></div>
          </div>
          <figcaption>{scenePreview.name}</figcaption>
        </figure>
      </section>
      <HomeArtStyleDemo disabled={disabled} onOpen={() => onRequest({ type: 'showcase', sample: 'fantasy' })}/>
      <HomeObliqueDemo disabled={disabled} onOpen={() => onRequest({ type: 'showcase', sample: 'wilderness' })}/>
      <SampleShowcase onRequest={onRequest} disabled={disabled}/>
      </HomePreviewsPaused.Provider>
      <ol className="home-steps" role="list" aria-label="备团步骤">
        <li><PencilLine size={19} aria-hidden="true"/><div><h2><a href={tutorialHref('first-map', 'rooms')}>画出布局</a></h2><p>用「房间」点两个对角，或用「地形」画出地面和道路。</p></div></li>
        <li><Layers3 size={19} aria-hidden="true"/><div><h2><a href={tutorialHref('first-map', 'furnish')}>布置场景</a></h2><p>选中房间接建隔壁一间、开门窗，或挑选家具摆到图上。</p></div></li>
        <li><Download size={19} aria-hidden="true"/><section aria-labelledby="home-delivery-title"><h2 id="home-delivery-title"><a href={tutorialHref('delivery', 'png')}>保存与交付</a></h2><p>在顶栏「导出」下载玩家地图 PNG 和可编辑的 .sceneweave 工程。</p></section></li>
      </ol>
      <section className="home-projects"><div className="home-section-heading"><h2 id={homeSections.projects} tabIndex={-1}>最近工程</h2><div className="home-list-tools"><label><Search size={16}/><input ref={searchInput} aria-label="搜索最近工程" placeholder="名称或 ID" value={query} onChange={event => setQuery(event.target.value)}/></label>{query && <button className="secondary" onClick={clearSearch}>清空搜索</button>}<button className="secondary" aria-label="刷新工程列表" disabled={loading || disabled} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/>刷新</button></div></div><p className="home-project-note">当前完整工程仓库。打开工程时会检查完整内容；目录中的未读取内容尚未检查。</p>
        {loading && <p role="status">正在读取本地工程列表…{entries.length > 0 && '下方暂时显示上次结果。'}</p>}{error && <p role="alert" className="home-diagnostic">工程列表读取失败：{error}。请点击刷新重试。{entries.length > 0 && '下方保留上次结果。'}</p>}
        {!loading && !error && <p className="home-project-note" role="status">{search ? `匹配或待检查 ${total} 个工程，已显示 ${entries.length} 个` : `共 ${total} 个工程，已显示 ${entries.length} 个，按最近保存排序`}</p>}
        {!loading && !error && !filtered.length && <div className="home-empty"><FolderOpen size={25}/><p>{search ? '没有匹配的工程' : '此浏览器还没有工程'}</p>{search && <button className="secondary" onClick={clearSearch}>清空工程搜索</button>}</div>}
        {!loading && !search && !error && storageMissing && <p className="home-diagnostic" role="alert">此地址曾有工程。若浏览器回收了本地数据，可用「打开工程文件」恢复备份。</p>}
        {browserStorageLow && <p className="home-diagnostic" role="status">浏览器站点存储接近上限。请先下载备份，再整理本地存储。</p>}
        <div className="home-project-list">{filtered.map(value => { const entry = value.summary; return entry ? <article className="home-project-row" key={entry.sceneId} data-project-key={`native:${entry.sceneId}`}><span className="home-file-icon"><Layers3 size={21}/></span><div className="home-project-info"><h3>{entry.title}</h3><p>完整工程 · r{entry.revision} · {new Date(entry.savedAt).toLocaleString('zh-CN')}</p><span className="home-project-identity">{session?.sceneId === entry.sceneId ? '当前会话 · ' : ''}{(titleCounts.get(entry.title) ?? 0) > 1 ? '同名工程 · ' : ''}标识 {entry.sceneId.slice(0, 8)}</span><details className="home-project-id"><summary>完整工程 ID</summary><small>{entry.sceneId}</small></details></div><button className="secondary" title={`${session?.sceneId === entry.sceneId ? '继续编辑' : '打开'}：${entry.title} · ${entry.sceneId.slice(0, 8)}`} disabled={disabled} onClick={() => session?.sceneId === entry.sceneId ? onContinue() : onRequest({ type: 'open', sceneId: entry.sceneId })}>{session?.sceneId === entry.sceneId ? '继续编辑' : '打开'}<ArrowRight size={15}/></button></article> : <article className="home-project-row" key={value.sceneId} data-project-key={`native:${value.sceneId}`}><div className="home-project-info"><h3>工程目录不可读</h3><p role="alert">{value.issue}</p><small>工程 ID：{value.sceneId}</small><p>此记录仍保留，请从备份恢复或检查原数据。</p></div>{session?.sceneId === value.sceneId && <button className="secondary" disabled={disabled} onClick={onContinue}>继续当前编辑</button>}</article> })}</div>
        {next && <button className="secondary" disabled={loading || disabled} onClick={loadMore}>加载更多工程</button>}
      </section>
      <footer className="home-footer">
        <h2>本地保存与备份</h2>
        <p>已采用的编辑会自动保存到当前站点的浏览器。清除站点数据或更换设备、浏览器或站点地址前，请下载 .sceneweave 备份。通过首页「打开工程文件」恢复。</p>
        <p>工程备份包含实际素材，素材库和模板库须在各自面板另行备份。工程备份与主持人地图可能包含秘密，请由主持人保管。</p>
        <div className="project-storage-actions">
          <button type="button" className="secondary" disabled={disabled} onClick={() => setStorage(true)}>管理本地存储</button>
          <a href={ISSUE_LINK} target="_blank" rel="noreferrer">反馈问题</a>
          <a href="https://github.com/WoJiSama/sceneweave/releases" target="_blank" rel="noreferrer">版本发布</a>
          <small title={PROJECT_WRITER_BUILD}>构建 {PROJECT_WRITER_BUILD.replace(/\+g([a-f0-9]{7})[a-f0-9]+/, '+g$1')}</small>
        </div>
      </footer>
    </main>
  </div>
    {startupScene && <StartupSceneDialog {...startupScene}/>}
    {storage && <ProjectStorageDialog activeSceneId={session?.sceneId} onReleaseActive={onReleaseActive} onClose={() => setStorage(false)}
      onChange={() => { afterMaintenance.current = true; clearSearch(); setRefresh(value => value + 1) }}/>}
  </>
}
