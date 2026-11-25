import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import SceneweaveLoading from './editor/main-shell/SceneweaveLoading'
import { lazyView } from './editor/main-shell/lazy-view'
import { isHomeSectionHash } from './editor/main-shell/location'
import type { WorkspaceController, WorkspaceRequest, WorkspaceSessionSummary } from './editor/main-shell/session'
import type { NewSceneOptions } from './editor/main/NewSceneForm'
import type { DevelopmentImportPreview } from './platform/browser/storage/development-import'
import { isTutorialHash } from './tutorial/location'

const WorkspaceHome = lazyView(() => import('./editor/main-shell/WorkspaceHome'),
  () => <p role="alert">首页加载失败。请检查网络后刷新页面。</p>)
const loadWorkbench = () => import('./editor/main/Workbench')
const loadWorkspaceSession = () => import('./editor/main/workspace-session')
const prepareEditorFrame = () => { void import('./platform/browser/render/canvas-renderer').catch(() => undefined) }
const prepareStartupEditor = () => {
  void loadWorkspaceSession().catch(() => undefined)
  void loadWorkbench().catch(() => undefined)
  prepareEditorFrame()
}
const Workbench = lazyView(loadWorkbench,
  ({ onBack }) => <div role="alert"><p>工作区加载失败。请检查网络后刷新页面。</p><button type="button" onClick={onBack}>回到首页</button></div>)
const TutorialPage = lazyView(() => import('./tutorial/TutorialPage'),
  () => <div role="alert"><p>教程加载失败。请检查网络后刷新页面。</p><a href="#home">回到首页</a></div>)
const loadDevelopmentImport = () => Promise.all([
  import('./platform/browser/storage/development-import'),
  import('./platform/browser/runtime'),
])
type Page = 'home' | 'workspace' | 'tutorial'
const currentPage = (): Page => {
  const hash = window.location.hash
  if (isTutorialHash(hash)) return 'tutorial'
  return hash === '#workspace' ? 'workspace' : 'home'
}
const pageHash = (page: Page) => {
  const hash = window.location.hash
  return (page === 'tutorial' && isTutorialHash(hash) || page === 'home' && isHomeSectionHash(hash)) ? hash : `#${page}`
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function App() {
  const [route, setRoute] = useState(currentPage), [mounted, setMounted] = useState(() => currentPage() === 'workspace')
  const [session, setSession] = useState<WorkspaceSessionSummary | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [startupScene, setStartupScene] = useState(false)
  const [startInBuilding, setStartInBuilding] = useState(false)
  const [preparedWorkbench, setPreparedWorkbench] = useState<typeof import('./editor/main/Workbench')['default'] | null>(null)
  const startupHash = useRef<string | null>(null)
  const [busyLabel, setBusyLabel] = useState('正在检查完整内容…')
  const [developmentImport, setDevelopmentImport] = useState<DevelopmentImportPreview | null>(null)
  const controller = useRef<WorkspaceController | null>(null), queued = useRef<WorkspaceRequest | null>(null)
  const routeRef = useRef(route), operation = useRef<AbortController | null>(null), changing = useRef(false)
  const projectFile = useRef<HTMLInputElement>(null)
  const setPage = useCallback((value: Page, replace = false) => {
    routeRef.current = value; setRoute(value)
    if (value === 'workspace') setMounted(true)
    const hash = pageHash(value)
    if (window.location.hash !== hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', hash)
  }, [])
  const request = useCallback((value: WorkspaceRequest) => {
    if (startupHash.current !== null) return
    if (value.type === 'import') { projectFile.current?.click(); return }
    if (value.type === 'new' && routeRef.current === 'home' && !mounted) {
      startupHash.current = pageHash('home')
      setStartupScene(true)
      return
    }
    if (value.type === 'open' || value.type === 'open-project' || value.type === 'showcase' || value.type === 'sample' || value.type === 'reload') prepareEditorFrame()
    setPage('workspace')
    if (controller.current) controller.current.request(value)
    else queued.current = value
  }, [mounted, setPage])
  const register = useCallback((value: WorkspaceController | null) => {
    controller.current = value
    if (value && queued.current) queueMicrotask(() => {
      // StrictMode replays mount effects. Let that pass finish before starting
      // work so the discarded first controller cannot abort a queued request.
      if (controller.current !== value || !queued.current) return
      const action = queued.current; queued.current = null; value.request(action)
    })
  }, [])
  const home = useCallback(async () => {
    if (busy) return
    if (!controller.current || await controller.current.leave()) setPage('home')
  }, [busy, setPage])
  useEffect(() => {
    const navigate = () => {
      if (changing.current) return
      if (startupHash.current !== null) {
        if (window.location.hash !== startupHash.current) window.history.replaceState(null, '', startupHash.current)
        return
      }
      const destination = currentPage()
      if (destination === routeRef.current) {
        const hash = pageHash(destination)
        if (!busy && window.location.hash !== hash) window.history.replaceState(null, '', hash)
        return
      }
      if (busy) { window.history.replaceState(null, '', '#' + routeRef.current); return }
      changing.current = true
      void (async () => {
        try {
          if (routeRef.current === 'workspace' && controller.current && !await controller.current.leave()) { window.history.replaceState(null, '', '#workspace'); return }
          setPage(destination, true)
        } catch (error) { setNotice(message(error)); window.history.replaceState(null, '', '#' + routeRef.current) }
        finally { changing.current = false }
      })()
    }
    navigate()
    window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate)
    return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate) }
  }, [busy, setPage])
  useEffect(() => {
    return () => operation.current?.abort()
  }, [])
  const run = async (task: (signal: AbortSignal) => Promise<void>, label = '正在检查完整内容…') => {
    if (operation.current) return
    const abort = new AbortController()
    operation.current = abort; setBusyLabel(label); setBusy(true)
    try { await task(abort.signal) }
    catch (error) { if (!abort.signal.aborted) setNotice(message(error)) }
    finally { if (operation.current === abort) { operation.current = null; setBusy(false) } }
  }
  const preserveCurrent = async () => !controller.current || await controller.current.leave()
  const handleFile = (file: File) => void run(async signal => {
    if (!await preserveCurrent()) return
    if (!file.size || file.size > 100 * 1024 * 1024) throw new Error('工程文件为空或超过100MiB。')
    const { installProjectFile } = await import('./editor/main-shell/project-file')
    const project = await installProjectFile(file, signal)
    signal.throwIfAborted()
    request({ type: 'open-project', project, saved: true })
  })
  const closeSession = () => void run(async signal => {
    if (!await preserveCurrent()) return
    signal.throwIfAborted()
    setMounted(false); setStartInBuilding(false); controller.current = null; queued.current = null; setSession(null); setDevelopmentImport(null)
  }, '正在保存并关闭当前会话…')
  const inspectDevelopment = () => void run(async signal => {
    if (session) throw new Error('请先保存并关闭当前编辑会话。')
    setDevelopmentImport(null)
    const [{ inspectLocalDevelopmentImport }, { validation }] = await loadDevelopmentImport()
    signal.throwIfAborted()
    const preview = await inspectLocalDevelopmentImport({ validation: { ...validation, signal } })
    signal.throwIfAborted(); setDevelopmentImport(preview)
  }, '正在只读检查旧开发数据…')
  const migrateDevelopment = () => void run(async signal => {
    if (session || !developmentImport) throw new Error('请先关闭编辑会话并检查旧开发数据。')
    const [{ importLocalDevelopmentData }, { validation }] = await loadDevelopmentImport()
    signal.throwIfAborted()
    await importLocalDevelopmentData({ validation: { ...validation, signal } }, developmentImport.sourceFingerprint)
    window.location.reload()
  }, '正在迁入并校验完整工程、历史和个人素材…')
  const developmentTools = <details className="home-development-import">
    <summary>一次性迁入旧开发数据</summary>
    <p>读取此站点以前保存的开发工程、全部历史和个人素材，迁入当前完整工程 v1。源数据和原件独立保留，全部校验并冷读成功后切换仓库并刷新页面。</p>
    {session && <p>请先保存并关闭当前编辑会话。<button type="button" className="secondary" disabled={busy} onClick={closeSession}>保存并关闭会话</button></p>}
    <div className="home-actions"><button type="button" className="secondary" disabled={busy || !!session} onClick={inspectDevelopment}>检查迁入范围</button>
      {developmentImport && <button type="button" className="primary" disabled={busy || !!session || !(developmentImport.projectCount || developmentImport.historyVersionCount || developmentImport.libraryEntryCount)} onClick={migrateDevelopment}>迁入并切换到 v1</button>}</div>
    {developmentImport && <p role="status">检测到 {developmentImport.projectCount} 个工程、{developmentImport.historyVersionCount} 个增量历史版本、{developmentImport.libraryEntryCount} 个个人素材。命名、保护及旧自动快照和原件一并保全。{!(developmentImport.projectCount || developmentImport.historyVersionCount || developmentImport.libraryEntryCount) && '没有可迁入的旧开发数据。'}</p>}
  </details>
  const cancelStartup = () => {
    startupHash.current = null
    setStartupScene(false)
  }
  const createStartupScene = async (options: NewSceneOptions, signal: AbortSignal, onSaving: () => void, preloadedArchive?: Promise<Uint8Array>) => {
    const editor = loadWorkbench().catch(() => { throw new Error('工作区加载失败。请检查网络后刷新页面。') })
    const project = loadWorkspaceSession().then(({ prepareStartupScene }) => prepareStartupScene(options, signal, preloadedArchive))
    prepareEditorFrame()
    // Keep cancellation available while the workbench downloads. Publish the
    // prepared project only when the editor can open the resulting session.
    const [{ default: Editor }, saveScene] = await Promise.all([editor, project])
    await saveScene(onSaving)
    cancelStartup()
    setPreparedWorkbench(() => Editor)
    setStartInBuilding(true)
    setPage('workspace')
  }
  const WorkbenchView = preparedWorkbench ?? Workbench
  const cancel = () => operation.current?.abort()
  return <>
    <div className="native-app-content" inert={busy}>
      {notice && <div className="workspace-notice" role="status"><span>{notice}</span><button className="secondary small" onClick={() => setNotice(null)}>关闭提示</button></div>}
      {route === 'home' && <Suspense fallback={<SceneweaveLoading fullScreen label="正在打开首页…"/>}>
        <WorkspaceHome session={session} onContinue={() => setPage('workspace')} onRequest={request} disabled={busy}
          startupScene={startupScene ? { prepareEditor: prepareStartupEditor, onCreate: createStartupScene, onCancel: cancelStartup } : undefined} developmentTools={developmentTools}/>
      </Suspense>}
      {route === 'tutorial' && <Suspense fallback={<SceneweaveLoading fullScreen label="正在打开使用教程…"/>}><TutorialPage onOpenSample={sample => request({ type: 'showcase', sample })}/></Suspense>}
      {mounted && <div hidden={route !== 'workspace'}><Suspense fallback={<SceneweaveLoading fullScreen label="正在打开统一工作区…"/>}><WorkbenchView active={route === 'workspace'} startInBuilding={startInBuilding} onBack={() => void home()} onController={register} onSession={setSession} onImportFile={handleFile}/></Suspense></div>}
    </div>
    <input ref={projectFile} data-testid="native-project-file" type="file" hidden accept=".sceneweave" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleFile(file) }}/>
    {busy && <div className="modal-scrim"><div className="modal" role="dialog" aria-modal="true" aria-label="检查完整工程"><p role="status">{busyLabel}</p><button className="secondary" onClick={cancel}>取消操作</button></div></div>}
  </>
}
