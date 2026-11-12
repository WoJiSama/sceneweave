import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import WorkspaceHome from './editor/main-shell/WorkspaceHome'
import type { WorkspaceController, WorkspaceRequest, WorkspaceSessionSummary } from './editor/main-shell/session'
import { fromVerifiedBundle } from './application/workspace/project'
import { validateProjectSnapshot } from './shared/project/resources'
import { projectRepository, validation } from './platform/browser/runtime'
import { importProject, importHistoryArchive } from './shared/project/file'
import { inspectZip } from './shared/project/zip'
import { parseBoundedJson } from './shared/project/json'
import { inspectLocalDevelopmentImport, importLocalDevelopmentData, type DevelopmentImportPreview } from './platform/browser/storage/development-import'

const Workbench = lazy(() => import('./editor/main/Workbench'))
const initialRoute = () => window.location.hash === '#workspace' ? 'workspace' as const : 'home' as const
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function App() {
  const [route, setRoute] = useState<'home' | 'workspace'>(initialRoute), [mounted, setMounted] = useState(initialRoute() === 'workspace')
  const [session, setSession] = useState<WorkspaceSessionSummary | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('正在检查完整内容…')
  const [developmentImport, setDevelopmentImport] = useState<DevelopmentImportPreview | null>(null)
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
  const run = async (task: (signal: AbortSignal) => Promise<void>, label = '正在检查完整内容…') => {
    if (operation.current) return
    const abort = new AbortController()
    operation.current = abort; setBusyLabel(label); setBusy(true)
    try { await task(abort.signal) }
    catch (error) { if (!abort.signal.aborted) setNotice(message(error)) }
    finally { if (operation.current === abort) { operation.current = null; setBusy(false) } }
  }
  const preserveCurrent = async () => !controller.current || await controller.current.leave()
  const openInstalled = async (bundle: Parameters<typeof fromVerifiedBundle>[0], signal: AbortSignal) => {
    const project = fromVerifiedBundle(await validateProjectSnapshot(bundle, { ...validation, signal }), { signal }); signal.throwIfAborted()
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
      throw new Error('只支持当前完整工程v1文件；旧开发数据请使用首页独立迁入工具。')
    }
    if (!header || typeof header !== 'object' || Array.isArray(header) || !('format' in header) || header.format !== 'sceneweave-complete-project') throw new Error('只支持当前完整工程v1文件；旧开发数据请使用首页独立迁入工具。')
    const mode = 'packageMode' in header ? header.packageMode : undefined
    const archive = mode === 'history' ? await importHistoryArchive(bytes, { ...validation, signal })
      : mode === 'complete' ? { current: await importProject(bytes, { ...validation, signal }), snapshots: [] }
        : null
    if (!archive) throw new Error('未知的完整工程包模式。')
    const imported = await projectRepository.importSnapshotArchive(archive, { signal }); await openInstalled(imported.project, signal)
  })
  const closeSession = () => void run(async signal => {
    if (!await preserveCurrent()) return
    signal.throwIfAborted()
    setMounted(false); controller.current = null; queued.current = null; setSession(null); setDevelopmentImport(null)
  }, '正在保存并关闭当前会话…')
  const inspectDevelopment = () => void run(async signal => {
    if (session) throw new Error('请先保存并关闭当前编辑会话。')
    setDevelopmentImport(null)
    const preview = await inspectLocalDevelopmentImport({ validation: { ...validation, signal } })
    signal.throwIfAborted(); setDevelopmentImport(preview)
  }, '正在只读检查旧开发数据…')
  const migrateDevelopment = () => void run(async signal => {
    if (session || !developmentImport) throw new Error('请先关闭编辑会话并检查旧开发数据。')
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
  const cancel = () => operation.current?.abort()
  return <>
    <div className="native-app-content" inert={busy}>
      {notice && <div className="workspace-notice" role="status"><span>{notice}</span><button className="secondary small" onClick={() => setNotice(null)}>关闭提示</button></div>}
      <div hidden={route !== 'home'}>{route === 'home' && <WorkspaceHome session={session} onContinue={() => setPage('workspace')} onRequest={request} disabled={busy} developmentTools={developmentTools}/>}</div>
      {mounted && <div hidden={route !== 'workspace'}><Suspense fallback={<p role="status">正在打开统一工作区…</p>}><Workbench active={route === 'workspace'} onBack={() => void home()} onController={register} onSession={setSession} onImportFile={handleFile}/></Suspense></div>}
    </div>
    <input ref={projectFile} data-testid="native-project-file" type="file" hidden accept=".sceneweave" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleFile(file) }}/>
    {busy && <div className="modal-scrim"><div className="modal" role="dialog" aria-modal="true" aria-label="检查完整工程"><p role="status">{busyLabel}</p><button className="secondary" onClick={cancel}>取消操作</button></div></div>}
  </>
}
