import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Archive, ArrowLeft, CheckCircle2, Download, FolderOpen, Layers3, LoaderCircle, Move, Redo2, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { SceneRepositoryV2 } from '../../io/v2/storage'
import { diagnoseCompleteProjectV2, exportProjectV2, ProjectValidationErrorV2 } from '../../io/v2/project-file'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { SceneRepository } from '../../io/storage'
import { bootEditor, flushSave, useEditorStore } from '../store'
import { createCalibrationProject } from './calibration'
import { validateStudyEditsV2 } from './study-constraints'
import { validateIslandEditsV2 } from './island-constraints'
import { createPlacedPropV2, type SceneCommandV2 } from '../../core/v2/commands'
import type { PointMm, PropV2, SceneDocumentV2 } from '../../core/v2/types'
import { exportPngV2 } from '../../render/v2/renderer'
import { NumberInput } from './controls'
import SceneInspector from './SceneInspector'
import SceneLibrary from './SceneLibrary'
import TerrainTravelPanel from './TerrainTravelPanel'
import { migrateProjectV1, prepareProjectFile } from './migration-project'
import { forkProjectV2, WorkspaceV2 } from './workspace'
import AssetCanvas from './AssetCanvas'
import ProjectDiagnostics from './ProjectDiagnostics'
import type { ProjectDiagnosticsNoticeV2 } from './ProjectDiagnostics'
import NewSceneForm, { type NewSceneOptionsV2 } from './NewSceneForm'
import PlacementInspector from './PlacementInspector'
import SelectionInspector from './SelectionInspector'
import SceneContextMenu, { type SceneMenuV2 } from './SceneContextMenu'
import { normalizeSelectionV2 } from './selection'
import { selectionCommandsV2, type SelectionActionV2 } from './selection-actions'
import { SelectionSessionV2 } from './selection-session'
import { SelectionSubscriber } from './SelectionSubscriber'
import './assets.css'

const repository = new SceneRepositoryV2()
export const assetWorkspace = new WorkspaceV2(repository, document => { validateStudyEditsV2(document); validateIslandEditsV2(document) })
const createStudyProject = async (signal: AbortSignal) => (await import('./study-sample')).createStudyProject(signal)
const createIslandProject = async (signal: AbortSignal) => (await import('./island-sample')).createIslandProject(signal)
let opened: Promise<void> | undefined
const ready = () => opened ??= repository.open().catch(error => { opened = undefined; throw error })
const bytesLabel = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
type Candidate = { project: CompleteProjectV2; checkpoint: number; description: string }
type StructurePreview = { checkpoint: number; commands: SceneCommandV2[]; document: SceneDocumentV2; description: string; kind?: 'batch' }

export default function AssetWorkbench({ onBack, onOpenLayers }: { onBack: () => void; onOpenLayers: (source: CompleteProjectV2 | null) => void }) {
  const state = useSyncExternalStore(assetWorkspace.subscribe, assetWorkspace.getState), project = state.project
  const [recent, setRecent] = useState<Awaited<ReturnType<SceneRepositoryV2['list']>>>([])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [selectionSession] = useState(() => new SelectionSessionV2())
  const setSelected = (id: string | null) => selectionSession.set(id ? [id] : [])
  const [memberMode, setMemberMode] = useState(false), [menu, setMenu] = useState<SceneMenuV2 | null>(null), [fitRequest, setFitRequest] = useState(0)
  const [candidate, setCandidate] = useState<Candidate | null>(null), [snapshots, setSnapshots] = useState<Awaited<ReturnType<SceneRepositoryV2['listSnapshots']>> | null>(null)
  const [structure, setStructure] = useState<StructurePreview | null>(null), [audience, setAudience] = useState<'gm' | 'player'>('gm')
  const [diagnostics, setDiagnostics] = useState<ProjectDiagnosticsNoticeV2 | null>(null)
  const [newScene, setNewScene] = useState(false)
  const [creatingStage, setCreatingStage] = useState<'preparing' | 'saving' | null>(null)
  const creatingStageRef = useRef<'preparing' | 'saving' | null>(null)
  const [placement, setPlacement] = useState<{ prop: PropV2; checkpoint: number } | null>(null)
  const [placementReady, setPlacementReady] = useState(false)
  const previewRef = useRef(false)
  previewRef.current = !!structure
  const placingRef = useRef(false)
  placingRef.current = !!placement
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), shell = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const modalOrigin = useRef<HTMLElement | null>(null)
  const actionPending = useRef(false)
  const refresh = async () => { await ready(); setRecent(await repository.list()) }
  const action = async (run: () => Promise<void>, failureSource = '工程操作') => {
    if (actionPending.current) return
    actionPending.current = true
    if (!candidate && !snapshots && !newScene && !document.activeElement?.closest('[role="dialog"]')) modalOrigin.current = document.activeElement as HTMLElement | null
    setBusy(true); setMessage(null)
    try { await run() } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setMessage('准备已取消，当前工程和本地存档未改变。')
      else if (error instanceof ProjectValidationErrorV2) {
        setDiagnostics({ source: failureSource, report: { complete: false, issues: error.issues, summary: null } })
        setMessage('完整工程检查未通过，请查看问题清单。')
      } else setMessage(error instanceof Error ? error.message : String(error))
    }
    finally { actionPending.current = false; setBusy(false) }
  }
  useEffect(() => { void refresh().catch(error => setMessage(String(error))); return () => { controller.current?.abort() } }, [])
  useEffect(() => {
    // Remembering the selection is optional; IndexedDB owns the complete project.
    try { if (project) localStorage.setItem('sceneweave.assetSceneId', project.document.sceneId) } catch { /* The recent list still permits reopening. */ }
    setSelected(null)
    setStructure(null); setAudience('gm'); setMemberMode(false)
    if (project) void refresh().catch(() => {})
  }, [project?.document.sceneId])
  useEffect(() => { if (state.status === 'saved') void refresh().catch(() => {}) }, [state.status, project?.document.revision])
  useEffect(() => { setDiagnostics(null) }, [project?.document.sceneId, project?.document.revision, audience])
  useEffect(() => { setPlacement(null); setMenu(null); if (project) selectionSession.set(normalizeSelectionV2(project.document, selectionSession.getSnapshot(), true)) }, [project, audience])
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, '__sceneweaveAssetsDev', { workspace: assetWorkspace, repository })
    const unload = (event: BeforeUnloadEvent) => { if (!['empty', 'saved'].includes(assetWorkspace.getState().status)) { event.preventDefault(); event.returnValue = '' } }
    const key = (event: KeyboardEvent) => {
      if (actionPending.current) return
      if (previewRef.current) { if (event.key === 'Escape' && !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); setStructure(null) }; return }
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || event.isComposing || document.querySelector('[role="dialog"],[role="menu"]')) return
      if (event.key === 'Escape' && placingRef.current) { event.preventDefault(); setPlacement(null); return }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        try {
          if (event.key.toLowerCase() === 's') void action(() => assetWorkspace.flush())
          else if (event.key.toLowerCase() === 'y' || event.shiftKey) assetWorkspace.redo()
          else assetWorkspace.undo()
        } catch (error) { setMessage(String(error)) }
      }
    }
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', key) }
  }, [])
  useEffect(() => {
    if (!candidate && !snapshots && !newScene) return
    const prior = modalOrigin.current, background = shell.current
    if (background) background.inert = true
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (newScene && creatingStageRef.current === 'preparing') { controller.current?.abort(); setNewScene(false) }
        else if (!busy) { setCandidate(null); setSnapshots(null); setNewScene(false) }
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? [])
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => { if (background) background.inert = false; window.removeEventListener('keydown', key); requestAnimationFrame(() => { if (prior?.isConnected) prior.focus() }) }
  }, [candidate, snapshots, newScene, busy])
  // Reopen the last successful asset scene without changing M0's database or selection.
  useEffect(() => {
    if (assetWorkspace.getState().project) return
    let id: string | null = null
    try { id = localStorage.getItem('sceneweave.assetSceneId') } catch { /* Preferences may be unavailable independently of IndexedDB. */ }
    if (!id) return
    const checkpoint = assetWorkspace.checkpoint()
    void action(async () => { await ready(); const saved = await repository.load(id); if (saved) await assetWorkspace.openPersisted(saved, checkpoint) })
  }, [])
  const prepare = (factory: (signal: AbortSignal) => Promise<CompleteProjectV2>, description: string) => void action(async () => {
    // Preparing a host project leaves player preview so failures can show their dependency report.
    setAudience('gm'); setDiagnostics(null)
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    const checkpoint = assetWorkspace.checkpoint()
    try {
      const prepared = await factory(abort.signal)
      abort.signal.throwIfAborted(); assetWorkspace.assertCheckpoint(checkpoint)
      setCandidate({ project: prepared, checkpoint, description })
    } finally { if (controller.current === abort) controller.current = null }
  }, '准备打开工程')
  const migrateCurrent = () => prepare(async signal => {
    await bootEditor(); await flushSave(); signal.throwIfAborted()
    const current = useEditorStore.getState().document
    if (!current) throw new Error('尚无可迁移的 M0 场景。')
    const old = new SceneRepository()
    try {
      const persisted = await old.load(current.sceneId)
      if (!persisted) throw new Error('M0 场景尚未成功保存。请返回几何工坊完成保存。')
      signal.throwIfAborted()
      return await migrateProjectV1(persisted)
    } finally { old.close() }
  }, '从 M0 已保存修订创建独立副本，保留原工程及迁移来源。')
  const openNewScene = () => {
    modalOrigin.current = document.activeElement as HTMLElement | null
    setPlacement(null); setMessage(null); setNewScene(true)
  }
  const createScene = (options: NewSceneOptionsV2) => void action(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    creatingStageRef.current = 'preparing'; setCreatingStage('preparing')
    const checkpoint = assetWorkspace.checkpoint()
    try {
      await ready(); await assetWorkspace.flush(); abort.signal.throwIfAborted()
      const { createBlankProjectV2 } = await import('./blank-project')
      abort.signal.throwIfAborted()
      const prepared = await createBlankProjectV2(options, abort.signal)
      abort.signal.throwIfAborted(); assetWorkspace.assertCheckpoint(checkpoint)
      creatingStageRef.current = 'saving'; setCreatingStage('saving')
      await assetWorkspace.adoptNew(prepared, checkpoint)
      setNewScene(false); setSelected(null); setAudience('gm'); await refresh()
    } finally { if (controller.current === abort) controller.current = null; creatingStageRef.current = null; setCreatingStage(null) }
  }, '创建空白场景')
  const cancelNewScene = () => {
    if (actionPending.current && creatingStageRef.current !== 'preparing') return
    if (creatingStageRef.current === 'preparing') controller.current?.abort()
    setNewScene(false)
  }
  const choosePlacement = (definitionId: string, position?: PointMm) => {
    if (!project || busy || structure || audience !== 'gm') return
    try {
      const b = project.document.exportBoundsMm
      const prop = createPlacedPropV2(project.document, definitionId, position ?? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) })
      setPlacementReady(false); setPlacement({ prop, checkpoint: assetWorkspace.checkpoint() }); setSelected(null); setMessage(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const placeAt = (positionMm: PointMm) => {
    if (!placement || busy || structure || audience !== 'gm') return
    if (!placementReady) return
    try {
      assetWorkspace.assertCheckpoint(placement.checkpoint)
      const prop = placement.prop
      assetWorkspace.execute([{ type: 'addProp', id: prop.id, floorId: prop.floorId, definitionRef: prop.definitionRef!, positionMm, rotationDeg: prop.rotationDeg, supportRef: prop.supportRef }])
      setPlacement(null); setSelected(prop.id); setMessage(null)
    } catch (error) { setMessage(`未放置：${error instanceof Error ? error.message : String(error)}`) }
  }
  const backup = () => { if (project) void action(async () => { download(await exportProjectV2(project), 'sceneweave-complete.sceneweave'); setMessage('完整主持人工程已生成，包含全部资源、许可和秘密。') }) }
  const commit = (run: () => void) => { try { if (structure) throw new Error('请先采用或取消结构预览。'); run(); setMessage(null) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const preview = (input: SceneCommandV2[] | (() => SceneCommandV2[]), description: string) => {
    if (!project) return
    try {
      const commands = typeof input === 'function' ? input() : input
      const checkpoint = structure?.checkpoint ?? assetWorkspace.checkpoint()
      assetWorkspace.assertCheckpoint(checkpoint)
      const document = assetWorkspace.preview(commands)
      setStructure({ checkpoint, commands, document, description }); setMessage(null)
    } catch (error) { setMessage(`候选未通过，工程未修改：${error instanceof Error ? error.message : String(error)}`) }
  }
  const select = (id: string | null, operation: 'replace' | 'add' | 'subtract' = 'replace') => { if (structure) return; setPlacement(null); setMenu(null); if (id && project?.document.props[id] && Object.values(project.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))) setMemberMode(true); else if (id && project?.document.prefabInstances[id]) setMemberMode(false); selectionSession.set(!id ? [] : normalizeSelectionV2(project!.document, operation === 'replace' ? [id] : operation === 'add' ? [...selectionSession.getSnapshot(), id] : selectionSession.getSnapshot().filter(current => current !== id), true)) }
  const selectMany = (ids: readonly string[]) => { if (structure) return; setPlacement(null); setMenu(null); selectionSession.set(ids) }
  const batchAction = (action: SelectionActionV2, values?: { dx?: number; dy?: number; angle?: number }, ids = selectionSession.getSnapshot(), checkpoint = assetWorkspace.checkpoint()) => {
    if (!project || busy || structure || audience !== 'gm') return
    try {
      assetWorkspace.assertCheckpoint(checkpoint)
      const commands = selectionCommandsV2(project.document, ids, action, values)
      if (action === 'lock' || action === 'unlock') { assetWorkspace.execute(commands); setMessage(null); return }
      const document = assetWorkspace.preview(commands)
      setStructure({ checkpoint, commands, document, kind: 'batch', description: `${{ move: '批量移动', rotate: '批量旋转', delete: '删除所选', copy: '复制所选' }[action]} · ${ids.length} 个选择单元${action === 'move' ? ` · 位移 ${values?.dx ?? 0}, ${values?.dy ?? 0} mm` : action === 'rotate' ? ` · 旋转 ${values?.angle ?? 0}°` : action === 'copy' ? ' · 副本偏移 300, 300 mm' : ''}` }); setMessage(null)
    } catch (error) { setMessage(`整批未采用，工程未修改：${error instanceof Error ? error.message : String(error)}`) }
  }
  const openMenu = (point: PointMm, hits: string[], position: { x: number; y: number }, origin: HTMLElement) => {
    if (!project || structure || busy || audience !== 'gm') return
    const currentIds = selectionSession.getSnapshot(), retained = !!hits[0] && currentIds.includes(hits[0]), ids = hits.length && !retained ? [hits[0]] : [...currentIds]
    if (!retained && hits.length) selectionSession.set(ids)
    setMenu({ ...position, point, hits, ids, checkpoint: assetWorkspace.checkpoint(), origin, blank: !hits.length })
  }
  const closeMenu = (restore = false) => { const origin = menu?.origin; setMenu(null); if (restore) requestAnimationFrame(() => origin?.isConnected && origin.focus({ preventScroll: true })) }
  const visibleProject = useMemo(() => project && structure ? { ...project, document: structure.document } : project, [project, structure])
  const exportImage = () => { if (project) void action(async () => {
    // Capture the complete immutable project and audience at the click boundary.
    const blob = await exportPngV2(project, { audience, longEdgePx: 4096 })
    download(blob, `sceneweave-${audience}-map.png`)
    setMessage(`${audience === 'gm' ? '主持人' : '玩家'} PNG 已生成 · r${project.document.revision} · 固定工程范围 · 长边 4096 px`)
  }) }
  const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }
  return <>
    <div className="asset-shell" ref={shell} data-testid="asset-workbench" data-revision={project?.document.revision}>
      <header className="asset-header"><button className="asset-brand" disabled={!!structure} onClick={() => void action(async () => { await assetWorkspace.flush(); onBack() })}><ArrowLeft size={18}/><span>织境<small>Sceneweave</small></span></button><div className="asset-header-title"><Layers3 size={20}/><span>素材工坊</span><b>室内 · 室外</b></div><div className="asset-header-actions"><button className="secondary" disabled={busy || !!structure} onClick={() => void action(async () => { const checkpoint = assetWorkspace.checkpoint(); await assetWorkspace.flush(); assetWorkspace.assertCheckpoint(checkpoint); onOpenLayers(assetWorkspace.getState().project) })}><Layers3 size={15}/>用户图层</button><span role="status" className={`asset-save ${state.status}`}>{state.status === 'saving' ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} {saveLabels[state.status]}</span><button className="secondary" disabled={busy || !!structure} onClick={() => file.current?.click()}><Upload size={15}/>打开工程</button><button className="primary" disabled={busy || !!structure || !project} onClick={backup}><Download size={15}/>完整工程</button><button className="secondary" disabled={busy || !!structure || !project} onClick={exportImage}><Download size={15}/>4K PNG</button></div></header>
      <div className="asset-phase-note">空白创作 · 墨绘原野素材<span>放置与编辑 / 完整本地保存 / 室内外样板参考</span></div>
      {(state.error || message) && <div className="asset-notice" role="alert"><span>{message ?? state.error}</span>{state.status === 'error' && <button onClick={() => void action(() => assetWorkspace.retry())}>重试保存</button>}{['conflict', 'error'].includes(state.status) && <button onClick={() => void action(async () => { await assetWorkspace.saveAsCopy(); await refresh() })}>另存副本</button>}<button aria-label="关闭工坊提示" onClick={() => setMessage(null)}><X size={16}/></button></div>}
      {diagnostics && audience === 'gm' && <ProjectDiagnostics notice={diagnostics} onClose={() => setDiagnostics(null)} onChooseFile={() => file.current?.click()}/>}
      <div className="asset-layout">
        <SelectionSubscriber session={selectionSession}>{ids => <SceneLibrary project={project} selected={ids.length === 1 ? ids[0] : null} selectedIds={[...ids]} busy={busy || !!structure} recent={recent} onSelect={select} onNew={openNewScene} onPlace={choosePlacement} placingId={placement?.prop.definitionRef?.id ?? null} canPlace={audience === 'gm'}
          onIsland={() => prepare(createIslandProject, '原创室外样板：双层岩岛、草岩浅水、高差台阶与可保留人工调整的散布。')}
          onStudy={() => prepare(createStudyProject, '原创室内建筑样板：书房与露台、厚墙与斜窗、墨绘原野材质及可拆分组合。')}
          onCalibration={() => prepare(createCalibrationProject, 'B1 原创程序校样：重复木纹、透明书桌与椅子，用于验证素材和工程保存。')}
          onMigrate={migrateCurrent} onOpen={id => void action(async () => {
            setAudience('gm'); setDiagnostics(null)
            const checkpoint = assetWorkspace.checkpoint(); await ready(); const saved = await repository.load(id)
            if (!saved) throw new Error('工程不存在。')
            await assetWorkspace.openPersisted(saved, checkpoint); setSelected(null)
          }, '打开本地工程')}/>}</SelectionSubscriber>
        <main className="asset-center"><div className="asset-scene-bar"><div><small>{audience === 'gm' ? '主持人场景' : '玩家场景'}</small><h1>{project?.document.title ?? '让空间有材质，也有故事'}</h1></div><div className="asset-toolbar"><button aria-label="撤销素材编辑" disabled={!state.canUndo || busy || !!structure} onClick={() => commit(() => assetWorkspace.undo())}><Undo2 size={17}/></button><button aria-label="重做素材编辑" disabled={!state.canRedo || busy || !!structure} onClick={() => commit(() => assetWorkspace.redo())}><Redo2 size={17}/></button><button aria-label="素材历史快照" disabled={!project || busy || !!structure} onClick={() => void action(async () => { await assetWorkspace.flush(); setSnapshots(await repository.listSnapshots(project!.document.sceneId)) })}><Archive size={17}/></button></div></div>
          <div className="asset-view-bar"><div role="group" aria-label="预览受众" className="asset-audience"><button disabled={busy || !!structure} aria-pressed={audience === 'gm'} onClick={() => setAudience('gm')}>主持人</button><button disabled={busy || !!structure} aria-pressed={audience === 'player'} onClick={() => { setAudience('player'); setSelected(null) }}>玩家</button></div><span>{project ? `${(project.document.exportBoundsMm.width / 1000).toFixed(1)} × ${(project.document.exportBoundsMm.height / 1000).toFixed(1)} m · 固定范围` : '二维俯视 · 毫米世界坐标'}</span></div>
          {structure && <div className="asset-structure-preview" role="status"><div><strong>{structure.description} · 候选预览</strong><span>尚未写入工程，采用后作为一次编辑保存</span></div><button className="secondary" onClick={() => setStructure(null)}>{structure.kind === 'batch' ? '取消批量预览' : '取消结构预览'}</button><button className="primary" onClick={() => {
            try { assetWorkspace.assertCheckpoint(structure.checkpoint); assetWorkspace.execute(structure.commands); setStructure(null); setMessage(null) }
            catch (error) { setStructure(null); setMessage(error instanceof Error ? error.message : String(error)) }
          }}>{structure.kind === 'batch' ? '采用批量修改' : '采用结构修改'}</button></div>}
          <div className="asset-stage">{visibleProject ? <AssetCanvas project={visibleProject} selected={null} selectionSession={selectionSession} onSelect={select} onSelectMany={selectMany} onContext={openMenu} memberMode={memberMode} onMemberMode={setMemberMode} fitRequest={fitRequest} audience={audience} disabled={busy || !!structure || audience === 'player'} placement={placement?.prop} onPlacementMove={positionMm => setPlacement(current => current ? { ...current, prop: { ...current.prop, positionMm } } : null)} onPlace={placeAt} onPlacementReady={setPlacementReady} onPlacementError={error => { setPlacement(null); setMessage(error) }} onCancelPlacement={() => setPlacement(null)}/> : <div className="asset-empty"><div className="asset-empty-icon"><Layers3 size={36}/></div><span>从一张空白画布开始</span><p>选择画布范围与使用预设，逐件放入素材。<br/>也可从左侧打开书房或岩岛样板。</p><button className="primary" disabled={busy} onClick={openNewScene}>新建场景</button></div>}</div><footer className="asset-canvas-footer"><span>{audience === 'gm' ? '主持人视图 · 工程可能包含秘密' : '玩家视图 · 已过滤私密内容'}</span>{project && <span>{Object.keys(project.assets).length} 张位图 · {Object.keys(project.document.props).length} 件物件 · r{project.document.revision}</span>}</footer>
        </main>
        <SelectionSubscriber session={selectionSession}>{ids => { const selectedIds = ids, selected = ids.length === 1 ? ids[0] : null; return <aside className="asset-inspector">{project && selectedIds.length > 0 && audience === 'gm' && !placement && <button className="secondary asset-wide" disabled={busy || !!structure} onClick={event => { const b = event.currentTarget.getBoundingClientRect(), bounds = project.document.exportBoundsMm; openMenu(project.document.props[selectedIds[0]]?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }, [...selectedIds], { x: b.left, y: b.bottom }, event.currentTarget) }}>更多操作</button>}{project && placement && audience === 'gm' ? <PlacementInspector scene={project.document} prop={placement.prop} busy={busy} ready={placementReady} onChange={changes => setPlacement(current => current ? { ...current, prop: { ...current.prop, ...changes } } : null)} onPlace={() => placeAt(placement.prop.positionMm)} onCancel={() => setPlacement(null)}/> : visibleProject && selectedIds.length > 1 && audience === 'gm' ? <SelectionInspector scene={project!.document} ids={selectedIds} busy={busy || !!structure} onAction={batchAction} onClear={() => select(null)}/> : visibleProject && selected && audience === 'gm' ? <SceneInspector project={visibleProject} selected={selected} busy={busy || !!structure} workspace={assetWorkspace} onSelect={select} onCommit={commit} onPreview={preview}/> : <>
          <div className="asset-section-heading"><Move size={16}/><h2>{audience === 'player' ? '玩家输出' : '工程信息'}</h2></div>
          {project ? <><h3>{project.document.activeStyleThemeRef ? '墨绘原野 · v1' : '完整工程 · v2'}</h3><p className="asset-muted">{audience === 'player' ? '预览与 PNG 使用同一投影和绘制流程，私密内容在材质与阴影派生前过滤。' : '选择画面中的物件，或从左侧切换组合、散布与场景结构。全部素材、定义和许可随工程保存。'}</p>
            <dl className="asset-facts"><dt>场景修订</dt><dd>r{project.document.revision}</dd><dt>素材字节</dt><dd>{bytesLabel(Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0))}</dd><dt>定义快照</dt><dd>{Object.keys(project.document.propDefinitions).length} 件物件 / {Object.keys(project.document.materials).length} 种材质</dd><dt>许可绑定</dt><dd>{project.licenseBindings.length} 条</dd></dl>
            {audience === 'gm' && <><h3>地面材质</h3>{Object.values(project.document.rooms).filter(room => room.floorStyle).map(room => <fieldset key={room.id} disabled={busy || !!structure || room.editLocked}><NumberInput label="木纹方向" value={room.floorStyle!.base.rotationDeg} unit="°" onCommit={rotation => commit(() => assetWorkspace.rotateRoomMaterial(room.id, rotation))}/></fieldset>)}<button className="secondary asset-wide" disabled={busy || !!structure} onClick={() => void action(async () => {
              const report = await diagnoseCompleteProjectV2(project)
              setDiagnostics({ source: `当前工程 · r${project.document.revision}`, report })
              setMessage(report.complete ? '完整工程校验通过：格式、引用、位图与许可一致。' : '完整工程检查未通过，请查看问题清单。')
            }, '当前工程完整性检查')}><CheckCircle2 size={15}/>校验完整工程</button></>}
            {audience === 'gm' && project.document.presetSnapshot.presetId === 'sceneweave-vis02' && <TerrainTravelPanel scene={project.document} disabled={busy || !!structure}/>}
            {project.migrationSource && <div className="asset-provenance"><strong>M0 迁移副本</strong><p>来源修订 r{project.migrationSource.sourceRevision}，原始文件保存在本地迁移记录中。</p><button onClick={() => download(project.migrationSource!.original, project.migrationSource!.original.type === 'application/json' ? 'sceneweave-original-v1.json' : 'sceneweave-original-v1.sceneweave')}>下载迁移原件</button></div>}
          </> : <p className="asset-muted">新建空白场景，打开室内外样板，或导入完整工程。</p>}
          <div className="asset-next"><RotateCw size={16}/><strong>把场景保存完整</strong><p>工程文件携带素材、材质与许可。定期下载备份，继续编辑前可检查工程完整性。</p></div>
        </>}</aside> }}</SelectionSubscriber>
      </div>
      <input hidden ref={file} type="file" accept=".sceneweave" aria-label="选择完整素材工程" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) prepare(signal => prepareProjectFile(selected, signal), '打开为独立副本，不覆盖当前工程。M0 文件会显式迁移到 v2。') }}/>
      {busy && <div className="asset-busy" role="status"><LoaderCircle size={17} className="spin"/>正在处理完整工程…{controller.current && <button onClick={() => controller.current?.abort()}>取消准备</button>}</div>}
    </div>
    {menu && project && <SceneContextMenu key={`${menu.checkpoint}-${menu.x}-${menu.y}-${menu.ids.join('|')}`} project={project} menu={menu} onClose={closeMenu} onAction={action => batchAction(action, undefined, menu.ids, menu.checkpoint)} onSelect={select} onFit={() => setFitRequest(value => value + 1)} onPlace={(id, point) => { try { assetWorkspace.assertCheckpoint(menu.checkpoint); choosePlacement(id, point) } catch (error) { setMessage(String(error)) } }} onEdit={() => requestAnimationFrame(() => { const input = shell.current?.querySelector<HTMLElement>('.asset-inspector input:not(:disabled)') ?? shell.current?.querySelector<HTMLElement>('.asset-inspector button:not(:disabled)'); input?.focus() })}/>}
    {(candidate || snapshots || newScene) && <div className="modal-scrim"><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={newScene ? '新建空白场景' : candidate ? '确认打开素材工程' : '素材历史快照'}><div className="modal-heading"><h2>{newScene ? '新建空白场景' : candidate ? '确认打开素材工程' : '素材历史快照'}</h2><button className="icon-button" disabled={busy && !(newScene && creatingStage === 'preparing')} aria-label={newScene ? '取消新建场景' : '取消打开素材工程'} onClick={() => { if (newScene) cancelNewScene(); else { setCandidate(null); setSnapshots(null) } }}><X size={18}/></button></div>{newScene ? <NewSceneForm busy={busy} cancellable={creatingStage === 'preparing'} failure={message ?? state.error} onCreate={createScene} onCancel={cancelNewScene}/> : candidate ? <><p>{candidate.description}</p><div className="asset-candidate"><strong>{candidate.project.document.title}</strong><span>{Object.keys(candidate.project.assets).length} 张位图 · {Object.keys(candidate.project.document.props).length} 件物件 · v2 完整工程</span>{candidate.project.migrationSource && <span>实际来源修订 r{candidate.project.migrationSource.sourceRevision}</span>}</div><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void action(async () => { await ready(); await assetWorkspace.adoptNew(candidate.project, candidate.checkpoint); setCandidate(null); setSelected(null); await refresh() })}>保存并打开副本</button></div></> : <><p>最近 20 次成功保存。恢复会新建完整副本。</p><div className="asset-snapshots">{snapshots?.map(snapshot => <div key={snapshot.revision}><span>r{snapshot.revision}</span><small>{new Date(snapshot.savedAt).toLocaleString('zh-CN')}</small><button className="secondary" disabled={busy} onClick={() => void action(async () => {
      const checkpoint = assetWorkspace.checkpoint(), recovered = await repository.loadSnapshot(snapshot.sceneId, snapshot.revision)
      if (!recovered) throw new Error('快照已不存在。')
      assetWorkspace.assertCheckpoint(checkpoint); setSnapshots(null); setCandidate({ project: forkProjectV2(recovered), checkpoint, description: '从历史快照创建副本。当前工程继续保留。' })
    })}>恢复副本</button></div>)}</div></>}</div></div>}
  </>
}
