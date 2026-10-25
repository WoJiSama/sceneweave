import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import WorkspaceHome from './editor/main-shell/WorkspaceHome'
import type { WorkspaceController, WorkspaceRequest, WorkspaceSessionSummary } from './editor/main-shell/session'
import { fromBundle } from './application/workspace/project'
import { projectRepository, validation } from './platform/browser/runtime'
import { importProject, importHistoryArchive } from './shared/project/file'
import { inspectZip } from './shared/project/zip'
import { parseBoundedJson } from './shared/project/json'

const Workbench = lazy(() => import('./editor/main/Workbench'))
const initialRoute = () => window.location.hash === '#workspace' ? 'workspace' as const : 'home' as const
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function App() {
  const [route, setRoute] = useState<'home' | 'workspace'>(initialRoute), [mounted, setMounted] = useState(initialRoute() === 'workspace')
  const [session, setSession] = useState<WorkspaceSessionSummary | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const controller = useRef<WorkspaceController | null>(null), queued = useRef<WorkspaceRequest | null>(null)
  const routeRef = useRef(route), operation = useRef<AbortController | null>(null), changing = useRef(false)
  const projectFile = useRef<HTMLInputElement>(null)
  const setPage = useCallback((value: 'home' | 'workspace', replace = false) => {
    routeRef.current = value; setRoute(value)
    if (value === 'workspace') setMounted(true)
    if (window.location.hash !== '#' + value) window.history[replace ? 'replaceState' : 'pushState'](null, '', '#' + value)
  }, [])
  const request = useCallback((value: WorkspaceRequest) => {
    if (value.type === 'import') { projectFile.current?.click(); return }
    setPage('workspace')
    if (controller.current) controller.current.request(value)
    else queued.current = value
  }, [setPage])
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
      const destination = initialRoute()
      if (destination === routeRef.current) {
        if (!busy && window.location.hash !== '#' + destination) window.history.replaceState(null, '', '#' + destination)
        return
      }
      if (busy) { window.history.replaceState(null, '', '#' + routeRef.current); return }
      changing.current = true
      void (async () => {
        try {
          if (destination === 'home' && controller.current && !await controller.current.leave()) { window.history.replaceState(null, '', '#' + routeRef.current); return }
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
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return
    const abort = new AbortController()
    operation.current = abort; setBusy(true)
    try { await task(abort.signal) }
    catch (error) { if (!abort.signal.aborted) setNotice(message(error)) }
    finally { if (operation.current === abort) { operation.current = null; setBusy(false) } }
  }
  const preserveCurrent = async () => !controller.current || await controller.current.leave()
  const openInstalled = async (bundle: Parameters<typeof fromBundle>[0], signal: AbortSignal) => {
    const project = await fromBundle(bundle, { ...validation, signal }); signal.throwIfAborted()
    request({ type: 'open-project', project, saved: true })
  }
  const handleFile = (file: File) => void run(async signal => {
    if (!await preserveCurrent()) return
    if (!file.size || file.size > 100 * 1024 * 1024) throw new Error('工程文件为空或超过100MiB。')
    const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted()
    let header: unknown
    try {
      const zip = inspectZip(bytes, signal)
      header = parseBoundedJson(await zip.read('manifest.json'))
    } catch {
      throw new Error('只支持完整 v1 工程文件；旧格式或损坏文件不会导入。')
    }
    if (!header || typeof header !== 'object' || Array.isArray(header) || !('format' in header) || header.format !== 'sceneweave-complete-project') throw new Error('只支持完整 v1 工程文件；旧格式不会导入。')
    const mode = 'packageMode' in header ? header.packageMode : undefined
    const archive = mode === 'history' ? await importHistoryArchive(bytes, { ...validation, signal })
      : mode === 'complete' ? { current: await importProject(bytes, { ...validation, signal }), snapshots: [] }
        : null
    if (!archive) throw new Error('未知的完整 v1 工程包模式。')
    const imported = await projectRepository.importArchive(archive, { signal }); await openInstalled(imported.project, signal)
  })
  const cancel = () => operation.current?.abort()
  return <>
    <div className="native-app-content" inert={busy}>
      {notice && <div className="workspace-notice" role="status"><span>{notice}</span><button className="secondary small" onClick={() => setNotice(null)}>关闭提示</button></div>}
      <div hidden={route !== 'home'}>{route === 'home' && <WorkspaceHome session={session} onContinue={() => setPage('workspace')} onRequest={request} disabled={busy}/>}</div>
      {mounted && <div hidden={route !== 'workspace'}><Suspense fallback={<p role="status">正在打开统一工作区…</p>}><Workbench active={route === 'workspace'} onBack={() => void home()} onController={register} onSession={setSession} onImportFile={handleFile}/></Suspense></div>}
    </div>
    <input ref={projectFile} data-testid="native-project-file" type="file" hidden accept=".sceneweave" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleFile(file) }}/>
    {busy && <div className="modal-scrim"><div className="modal" role="dialog" aria-modal="true" aria-label="检查完整工程"><p role="status">正在检查完整内容…</p><button className="secondary" onClick={cancel}>取消检查</button></div></div>}
  </>
}
