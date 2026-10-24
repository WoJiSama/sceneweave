import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import WorkspaceHome from './editor/main-shell/WorkspaceHome'
import ConversionDialog, { type ConversionPending } from './editor/main-shell/ConversionDialog'
import type { WorkspaceController, WorkspaceRequest, WorkspaceSessionSummary } from './editor/main-shell/session'
import { fromBundle } from './application/workspace/project'
import { projectRepository, libraryRepository, runtime, validation } from './platform/browser/runtime'
import { importProject, importHistoryArchive } from './shared/project/file'
import { inspectZip } from './shared/project/zip'
import { parseBoundedJson } from './shared/project/json'
import type { MigrationSetFiles } from './shared/migration/set'
import type { LegacyReference } from './compat/legacy/capture'

const Workbench = lazy(() => import('./editor/main/Workbench'))
const projectEnvironment = { repository: projectRepository, runtime, validation }
const libraryEnvironment = { repository: libraryRepository, runtime, validation }
const initialRoute = () => window.location.hash === '#workspace' ? 'workspace' as const : 'home' as const
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function App() {
  const [route, setRoute] = useState<'home' | 'workspace'>(initialRoute), [mounted, setMounted] = useState(initialRoute() === 'workspace')
  const [session, setSession] = useState<WorkspaceSessionSummary | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<ConversionPending | null>(null), [busy, setBusy] = useState(false), [conversionError, setConversionError] = useState<string | null>(null)
  const controller = useRef<WorkspaceController | null>(null), queued = useRef<WorkspaceRequest | null>(null)
  const routeRef = useRef(route), operation = useRef<{ abort: AbortController; finished: Promise<void> } | null>(null), changing = useRef(false), closing = useRef(false)
  const projectFile = useRef<HTMLInputElement>(null), libraryFile = useRef<HTMLInputElement>(null), preservationFiles = useRef<HTMLInputElement>(null)
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
    if (busy || pending) return
    if (!controller.current || await controller.current.leave('home')) setPage('home')
  }, [busy, pending, setPage])
  useEffect(() => {
    const navigate = () => {
      if (changing.current) return
      const destination = initialRoute()
      if (destination === routeRef.current) return
      if (busy || pending) { window.history.replaceState(null, '', '#' + routeRef.current); return }
      changing.current = true
      void (async () => {
        try {
          if (destination === 'home' && controller.current && !await controller.current.leave('home')) { window.history.replaceState(null, '', '#' + routeRef.current); return }
          setPage(destination, true)
        } catch (error) { setNotice(message(error)); window.history.replaceState(null, '', '#' + routeRef.current) }
        finally { changing.current = false }
      })()
    }
    window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate)
    return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate) }
  }, [busy, pending, setPage])
  useEffect(() => {
    if (['#geometry', '#assets', '#layers', '#history', '#composition', '#outdoor'].includes(window.location.hash)) {
      setNotice('旧版整页入口已合并到统一工作区。请新建场景，或在首页保全并转换旧工程。')
      setPage('home', true)
    }
    return () => operation.current?.abort.abort()
  }, [setPage])
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current || closing.current) return
    const abort = new AbortController()
    let finish!: () => void
    const active = { abort, finished: new Promise<void>(resolve => { finish = resolve }) }
    operation.current = active; setBusy(true); setConversionError(null)
    try { await task(abort.signal) }
    catch (error) { if (!abort.signal.aborted) { setConversionError(message(error)); setNotice(message(error)) } }
    finally { if (operation.current === active) { operation.current = null; if (!closing.current) setBusy(false) }; finish() }
  }
  const preserveCurrent = async () => !controller.current || await controller.current.leave('home')
  const openInstalled = async (bundle: Parameters<typeof fromBundle>[0], signal: AbortSignal) => {
    const project = await fromBundle(bundle, { ...validation, signal }); signal.throwIfAborted()
    request({ type: 'open-project', project, saved: true })
  }
  const beginLegacy = (reference: LegacyReference) => void run(async signal => {
    if (!await preserveCurrent()) return
    const migration = await import('./application/migration/conversion')
    const start = await migration.beginProjectConversion(reference, projectEnvironment, { signal }); signal.throwIfAborted()
    if (start.reused) { await openInstalled(start.reused, signal); return }
    if (!start.backup) {
      const completed = await migration.continueProjectConversion({ jobId: start.job.jobId }, projectEnvironment, { signal })
      await openInstalled(completed.bundle, signal); return
    }
    setPending({ kind: 'project', jobId: start.job.jobId, files: start.backup, label: '旧工程家族：' + reference.sceneId })
  })
  const beginLibrary = () => void run(async signal => {
    if (!await preserveCurrent()) return
    const migration = await import('./application/migration/library-conversion')
    const start = await migration.beginLibraryConversion(libraryEnvironment, { signal }); signal.throwIfAborted()
    if (start.reused) { setNotice('此来源已经转换，保留当前素材及后来的整理。'); return }
    if (!start.backup) { await migration.continueLibraryConversion({ jobId: start.job.jobId }, libraryEnvironment, { signal }); setNotice('已完成旧个人素材库转换。'); return }
    setPending({ kind: 'library', jobId: start.job.jobId, files: start.backup, organizationPolicy: start.job.organizationPolicy, label: '完整旧个人素材库，包含未安装素材的整理记录' })
  })
  const handleFile = (file: File) => void run(async signal => {
    if (!await preserveCurrent()) return
    if (!file.size || file.size > 100 * 1024 * 1024) throw new Error('工程文件为空或超过100MiB。')
    const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted()
    let mode: unknown
    try {
      const zip = inspectZip(bytes, signal), header = parseBoundedJson(await zip.read('manifest.json')) as Record<string, unknown>
      if (header.format === 'sceneweave-complete-project') mode = header.packageMode
    } catch { /* Only a legacy reader may accept a different format; malformed inputs never replace the current project. */ }
    if (mode !== undefined) {
      const archive = mode === 'history' ? await importHistoryArchive(bytes, { ...validation, signal })
        : mode === 'complete' ? { current: await importProject(bytes, { ...validation, signal }), snapshots: [] }
          : null
      if (!archive) throw new Error('未知的新完整工程包模式。')
      const imported = await projectRepository.importArchive(archive, { signal }); await openInstalled(imported.project, signal); return
    }
    const migration = await import('./application/migration/conversion')
    const start = await migration.beginProjectFileConversion(bytes, projectEnvironment, { signal }); signal.throwIfAborted()
    if (start.reused) { await openInstalled(start.reused, signal); return }
    if (!start.backup) { const completed = await migration.continueProjectConversion({ jobId: start.job.jobId }, projectEnvironment, { signal }); await openInstalled(completed.bundle, signal); return }
    setPending({ kind: 'project', jobId: start.job.jobId, files: start.backup, label: '旧工程原文件：' + file.name })
  })
  const handleLibraryFile = (file: File) => void run(async signal => {
    if (!await preserveCurrent()) return
    if (!file.size || file.size > 64 * 1024 * 1024) throw new Error('旧素材库备份为空或超过64MiB。')
    const migration = await import('./application/migration/library-conversion')
    const start = await migration.beginLibraryFileConversion(new Uint8Array(await file.arrayBuffer()), libraryEnvironment, { signal }); signal.throwIfAborted()
    if (start.reused) { setNotice('此旧备份已经转换，保留当前个人整理。'); return }
    if (!start.backup) { await migration.continueLibraryConversion({ jobId: start.job.jobId }, libraryEnvironment, { signal }); return }
    setPending({ kind: 'library', jobId: start.job.jobId, files: start.backup, organizationPolicy: start.job.organizationPolicy, label: '旧素材库所选备份：' + file.name })
  })
  const handlePreservation = (selected: File[]) => void run(async signal => {
    if (!await preserveCurrent()) return
    const reader = await import('./editor/main-shell/read-preservation')
    const { files, scope } = await reader.readPreservationFiles(selected, { signal })
    const migration = await import('./application/migration/preservation')
    if (scope.kind === 'project-family') {
      const start = await migration.beginPreservedProjectConversion(files, projectEnvironment, { signal }); signal.throwIfAborted()
      if (start.reused) { await openInstalled(start.reused, signal); return }
      if (!start.backup) {
        setPending({ kind: 'project', jobId: start.job.jobId, files, label: '本机已保留待开放副本；重新核验保全文件并明确选择源内容策略' }); return
      }
      setPending({ kind: 'project', jobId: start.job.jobId, files: start.backup, label: '已重新读取的完整工程保全集合；源库不可用时可明确选择已保全副本' })
    } else {
      const start = await migration.beginPreservedLibraryConversion(files, libraryEnvironment, { signal }); signal.throwIfAborted()
      if (start.reused) { setNotice('此保全集合已经转换，当前个人整理保持。'); return }
      if (!start.backup) {
        setPending({ kind: 'library', jobId: start.job.jobId, files, organizationPolicy: start.job.organizationPolicy, label: '本机已保留待开放个人库；重新核验保全文件并明确选择源内容策略' }); return
      }
      setPending({ kind: 'library', jobId: start.job.jobId, files: start.backup, organizationPolicy: start.job.organizationPolicy, label: '已重新读取的完整个人素材库保全集合' })
    }
  })
  const finish = (files: MigrationSetFiles, sourcePolicy: 'require-unchanged' | 'captured-copy', organizationPolicy: 'keep-local' | 'replace-selected') => {
    const current = pending
    if (!current) return
    void run(async signal => {
      if (current.kind === 'project') {
        const migration = await import('./application/migration/conversion')
        const result = await migration.continueProjectConversion({ jobId: current.jobId, backup: files, sourcePolicy }, projectEnvironment, { signal })
        signal.throwIfAborted(); setPending(null); await openInstalled(result.bundle, signal)
        setNotice(['changed', 'unavailable'].includes(result.sourceState) ? '已从核验的保全内容建立副本；源库未改动。' : '完整保全已核验，工程已转换并打开。')
      } else {
        const migration = await import('./application/migration/library-conversion')
        const result = await migration.continueLibraryConversion({ jobId: current.jobId, backup: files, sourcePolicy, organizationPolicy }, libraryEnvironment, { signal })
        signal.throwIfAborted(); setPending(null); setNotice(['changed', 'unavailable'].includes(result.sourceState) ? '已转换核验的素材库保全内容；源库未改动。' : '素材库已完整转换，可在“我的素材”刷新查看。')
      }
    })
  }
  const cancel = () => {
    if (closing.current) return
    closing.current = true; setBusy(true)
    const current = pending, active = operation.current
    active?.abort.abort()
    void (async () => {
      try {
        await active?.finished
        if (current?.kind === 'project') await (await import('./application/migration/conversion')).cancelProjectConversion(current.jobId, projectEnvironment)
        else if (current) await (await import('./application/migration/library-conversion')).cancelLibraryConversion(current.jobId, libraryEnvironment)
      } catch (error) { setNotice(message(error)) }
      finally { setPending(null); setConversionError(null); closing.current = false; setBusy(false) }
    })()
  }
  return <>
    <div className="native-app-content" inert={!!pending || busy}>
      {notice && <div className="workspace-notice" role="status"><span>{notice}</span><button className="secondary small" onClick={() => setNotice(null)}>关闭提示</button></div>}
      <div hidden={route !== 'home'}>{route === 'home' && <WorkspaceHome session={session} onContinue={() => setPage('workspace')} onRequest={request} onLegacyProject={beginLegacy} onLegacyLibrary={beginLibrary} onLegacyLibraryFile={() => libraryFile.current?.click()} onPreservationFiles={() => preservationFiles.current?.click()} disabled={busy}/>}</div>
      {mounted && <div hidden={route !== 'workspace'}><Suspense fallback={<p role="status">正在打开统一工作区…</p>}><Workbench unified active={route === 'workspace'} onBack={() => void home()} onController={register} onSession={setSession} onImportFile={handleFile}/></Suspense></div>}
    </div>
    <input ref={projectFile} data-testid="native-project-file" type="file" hidden accept=".sceneweave" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleFile(file) }}/>
    <input ref={libraryFile} data-testid="legacy-library-file" type="file" hidden accept=".sceneweave-library,.json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleLibraryFile(file) }}/>
    <input ref={preservationFiles} data-testid="preservation-files" type="file" multiple hidden accept=".json,.sceneweave-migration-part" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) handlePreservation(files) }}/>
    {pending && <ConversionDialog key={pending.jobId} pending={pending} busy={busy} error={conversionError} onCancel={cancel} onContinue={finish}/>}
    {busy && !pending && <div className="modal-scrim"><div className="modal" role="dialog" aria-modal="true" aria-label="检查完整工程"><p role="status">正在检查完整内容…</p><button className="secondary" onClick={cancel}>取消检查</button></div></div>}
  </>
}
