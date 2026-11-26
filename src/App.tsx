import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { PROJECT_ARCHIVE_MAX_MIB, PACKAGE_LIMITS } from './shared/project/limits'
import { ISSUE_LINK, WorkspaceCrashBoundary, WorkspaceCrashRecovery } from './editor/main-shell/WorkspaceCrashBoundary'
import type { VttImportInput } from './editor/main-shell/VttImportDialog'
import SceneweaveLoading from './editor/main-shell/SceneweaveLoading'
import { lazyView } from './editor/main-shell/lazy-view'
import { isHomeSectionHash } from './editor/main-shell/location'
import type { WorkspaceController, WorkspaceRequest, WorkspaceSessionSummary } from './editor/main-shell/session'
import type { NewSceneOptions } from './editor/main/NewSceneForm'
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
const VttImportDialog = lazyView(() => import('./editor/main-shell/VttImportDialog'),
  ({ onClose }) => <div role="alert"><p>VTT 导入器加载失败。</p><button type="button" onClick={onClose}>关闭</button></div>)
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
  const [unexpectedError, setUnexpectedError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [startupScene, setStartupScene] = useState(false)
  const [startInBuilding, setStartInBuilding] = useState(false)
  const [preparedWorkbench, setPreparedWorkbench] = useState<typeof import('./editor/main/Workbench')['default'] | null>(null)
  const [workbenchAttempt, setWorkbenchAttempt] = useState(0), [workbenchCrashed, setWorkbenchCrashed] = useState(false)
  const [vttFile, setVttFile] = useState<File | null>(null)
  const startupHash = useRef<string | null>(null)
  const [busyLabel, setBusyLabel] = useState('正在检查完整内容…')
  const controller = useRef<WorkspaceController | null>(null), queued = useRef<WorkspaceRequest | null>(null)
  const routeRef = useRef(route), operation = useRef<AbortController | null>(null), changing = useRef(false)
  const projectFile = useRef<HTMLInputElement>(null)
  const setPage = useCallback((value: Page, replace = false) => {
    routeRef.current = value; setRoute(value)
    if (value === 'workspace') setMounted(true)
    const hash = pageHash(value)
    if (window.location.hash !== hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', hash)
  }, [])
  const restartWorkbench = useCallback(() => {
    setWorkbenchCrashed(false)
    setWorkbenchAttempt(value => value + 1)
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
    if (workbenchCrashed) restartWorkbench()
    setPage('workspace')
    if (controller.current) controller.current.request(value)
    else queued.current = value
  }, [mounted, restartWorkbench, setPage, workbenchCrashed])
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
  useEffect(() => {
    const showUnexpected = () => setUnexpectedError(true)
    const reportError = (event: ErrorEvent) => { if (event instanceof ErrorEvent) showUnexpected() }
    window.addEventListener('error', reportError)
    window.addEventListener('unhandledrejection', showUnexpected)
    return () => { window.removeEventListener('error', reportError); window.removeEventListener('unhandledrejection', showUnexpected) }
  }, [])
  const run = async (task: (signal: AbortSignal) => Promise<void>, label = '正在检查完整内容…') => {
    if (operation.current) return
    const abort = new AbortController()
    operation.current = abort; setBusyLabel(label); setBusy(true)
    try { await task(abort.signal) }
    catch (error) { if (!abort.signal.aborted) setNotice(message(error)) }
    finally { if (operation.current === abort) { operation.current = null; setBusy(false) } }
  }
  const preserveCurrent = async () => {
    if (controller.current) return controller.current.leave()
    if (workbenchCrashed) await (await loadWorkspaceSession()).nativeWorkspace.flush()
    return true
  }
  const handleFile = (file: File) => {
    if (/\.(?:uvtt|dd2vtt|df2vtt|json)$/i.test(file.name)) {
      setVttFile(file)
      return
    }
    void run(async signal => {
      if (!await preserveCurrent()) return
      if (!file.size || file.size > PACKAGE_LIMITS.compressedBytes) throw new Error(`工程文件为空或超过 ${PROJECT_ARCHIVE_MAX_MIB} MiB。`)
      const { installProjectFile } = await import('./editor/main-shell/project-file')
      const project = await installProjectFile(file, signal)
      signal.throwIfAborted()
      request({ type: 'open-project', project, saved: true })
    })
  }
  const installVtt = async (file: File, options: VttImportInput, signal: AbortSignal) => {
    if (!await preserveCurrent()) throw new Error('请先保存或收好当前工程的编辑，再导入 VTT 地图。')
    const [{ importUvtt, importFoundryScene, VTT_FILE_BYTES }, { nativeWorkspace }] = await Promise.all([
      import('./platform/browser/content/vtt-import'), loadWorkspaceSession(),
    ])
    if (!file.size || file.size > VTT_FILE_BYTES) throw new Error('VTT 文件须为非空且不超过 32 MiB。')
    const checkpoint = nativeWorkspace.checkpoint()
    if (options.foundry && options.foundry.backdrop.size > PACKAGE_LIMITS.imageBytes) throw new Error('Foundry 本地底图最多 20 MiB。')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const project = options.foundry
      ? await importFoundryScene(bytes, new Uint8Array(await options.foundry.backdrop.arrayBuffer()), options.foundry.origin, options, signal)
      : await importUvtt(bytes, options, signal)
    signal.throwIfAborted()
    await nativeWorkspace.adoptNew(project, checkpoint)
    request({ type: 'open-project', project, saved: true })
  }
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
      {unexpectedError && !workbenchCrashed && <div className="workspace-notice" role="status"><span>页面操作发生异常。可下载工程备份并重试。</span><a href={ISSUE_LINK} target="_blank" rel="noreferrer">反馈问题</a><button className="secondary small" onClick={() => setUnexpectedError(false)}>关闭异常提示</button></div>}
      {route === 'home' && <Suspense fallback={<SceneweaveLoading fullScreen label="正在打开首页…"/>}>
        <WorkspaceHome session={session} onContinue={() => setPage('workspace')} onRequest={request} disabled={busy}
          onReleaseActive={workbenchCrashed ? undefined : async () => {
            const { nativeWorkspace } = await loadWorkspaceSession()
            await nativeWorkspace.close()
            setSession(null)
          }}
          startupScene={startupScene ? { prepareEditor: prepareStartupEditor, onCreate: createStartupScene, onCancel: cancelStartup } : undefined}/>
      </Suspense>}
      {route === 'tutorial' && <Suspense fallback={<SceneweaveLoading fullScreen label="正在打开使用教程…"/>}><TutorialPage onOpenSample={sample => request({ type: 'showcase', sample })}/></Suspense>}
      {mounted && <div hidden={route !== 'workspace'}>
        <WorkspaceCrashBoundary key={workbenchAttempt} onCrash={() => { controller.current = null; setWorkbenchCrashed(true) }}
          fallback={<WorkspaceCrashRecovery onHome={() => setPage('home', true)} onRetry={restartWorkbench}/>}>
          <Suspense fallback={<SceneweaveLoading fullScreen label="正在打开统一工作区…"/>}>
            <WorkbenchView active={route === 'workspace'} startInBuilding={startInBuilding} onBack={() => void home()} onController={register} onSession={setSession} onImportFile={handleFile}/>
          </Suspense>
        </WorkspaceCrashBoundary>
      </div>}
    </div>
    <input ref={projectFile} data-testid="native-project-file" type="file" hidden accept=".sceneweave,.uvtt,.dd2vtt,.df2vtt,.json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleFile(file) }}/>
    {vttFile && <Suspense fallback={<SceneweaveLoading label="正在打开 VTT 导入器…"/>}><VttImportDialog file={vttFile} onImport={installVtt} onClose={() => setVttFile(null)}/></Suspense>}
    {busy && <div className="modal-scrim"><div className="modal" role="dialog" aria-modal="true" aria-label="检查完整工程"><p role="status">{busyLabel}</p><button className="secondary" onClick={cancel}>取消操作</button></div></div>}
  </>
}
