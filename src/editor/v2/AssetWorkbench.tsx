import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Archive, ArrowLeft, CheckCircle2, Download, FolderOpen, Layers3, LoaderCircle, Move, Redo2, RotateCw, Undo2, Upload, X } from 'lucide-react'
import { SceneRepositoryV2 } from '../../io/v2/storage'
import { exportProjectV2, validateCompleteProjectV2 } from '../../io/v2/project-file'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { SceneRepository } from '../../io/storage'
import { bootEditor, flushSave, useEditorStore } from '../store'
import { createCalibrationProject } from './calibration'
import { migrateProjectV1, prepareProjectFile } from './migration-project'
import { forkProjectV2, WorkspaceV2 } from './workspace'
import AssetCanvas from './AssetCanvas'
import './assets.css'

const repository = new SceneRepositoryV2()
export const assetWorkspace = new WorkspaceV2(repository)
let opened: Promise<void> | undefined
const ready = () => opened ??= repository.open().catch(error => { opened = undefined; throw error })
const bytesLabel = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
function NumberInput({ label, value, onCommit, unit = 'mm' }: { label: string; value: number; onCommit: (value: number) => void; unit?: string }) {
  const [draft, setDraft] = useState(String(value))
  const cancelled = useRef(false)
  useEffect(() => setDraft(String(value)), [value])
  return <label className="asset-number"><span>{label}</span><div><input aria-label={label} type="number" value={draft} step={unit === '°' ? 15 : 100} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelled.current = true; setDraft(String(value)); event.currentTarget.blur() } }} onBlur={() => {
    if (cancelled.current) { cancelled.current = false; return }
    const number = Number(draft)
    if (draft.trim() && Number.isFinite(number) && number !== value) onCommit(number)
    setDraft(String(value))
  }}/><small>{unit}</small></div></label>
}
type Candidate = { project: CompleteProjectV2; checkpoint: number; description: string }

export default function AssetWorkbench({ onBack }: { onBack: () => void }) {
  const state = useSyncExternalStore(assetWorkspace.subscribe, assetWorkspace.getState), project = state.project
  const [recent, setRecent] = useState<Awaited<ReturnType<SceneRepositoryV2['list']>>>([])
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<Candidate | null>(null), [snapshots, setSnapshots] = useState<Awaited<ReturnType<SceneRepositoryV2['listSnapshots']>> | null>(null)
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), shell = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const actionPending = useRef(false)
  const refresh = async () => { await ready(); setRecent(await repository.list()) }
  const action = async (run: () => Promise<void>) => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true); setMessage(null)
    try { await run() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { actionPending.current = false; setBusy(false) }
  }
  useEffect(() => { void refresh().catch(error => setMessage(String(error))); return () => { controller.current?.abort() } }, [])
  useEffect(() => {
    // Remembering the selection is optional; IndexedDB owns the complete project.
    try { if (project) localStorage.setItem('sceneweave.assetSceneId', project.document.sceneId) } catch { /* The recent list still permits reopening. */ }
    setSelected(null)
    if (project) void refresh().catch(() => {})
  }, [project?.document.sceneId])
  useEffect(() => { if (state.status === 'saved') void refresh().catch(() => {}) }, [state.status, project?.document.revision])
  useEffect(() => {
    if (import.meta.env.DEV) Reflect.set(window, '__sceneweaveAssetsDev', { workspace: assetWorkspace, repository })
    const unload = (event: BeforeUnloadEvent) => { if (!['empty', 'saved'].includes(assetWorkspace.getState().status)) { event.preventDefault(); event.returnValue = '' } }
    const key = (event: KeyboardEvent) => {
      if (actionPending.current) return
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || document.querySelector('[role="dialog"]')) return
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
    if (!candidate && !snapshots) return
    const prior = document.activeElement as HTMLElement | null, background = shell.current
    if (background) background.inert = true
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setCandidate(null); setSnapshots(null) }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? [])
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => { if (background) background.inert = false; window.removeEventListener('keydown', key); prior?.focus() }
  }, [candidate, snapshots, busy])
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
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    const checkpoint = assetWorkspace.checkpoint()
    try {
      const prepared = await factory(abort.signal)
      abort.signal.throwIfAborted(); assetWorkspace.assertCheckpoint(checkpoint)
      setCandidate({ project: prepared, checkpoint, description })
    } finally { if (controller.current === abort) controller.current = null }
  })
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
  const backup = () => { if (project) void action(async () => { download(await exportProjectV2(project), 'sceneweave-complete.sceneweave'); setMessage('完整主持人工程已生成，包含全部资源、许可和秘密。') }) }
  const commit = (run: () => void) => { try { run(); setMessage(null) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const prop = selected ? project?.document.props[selected] : null
  const propLabel = (id: string) => { const p = project!.document.props[id]; return p.definitionRef ? project!.document.propDefinitions[p.definitionRef.id].name : `符号物件 · ${id}` }
  const saveLabels = { empty: '尚未打开工程', saved: '本地已保存', unsaved: '等待保存', saving: '正在保存', error: '保存失败', conflict: '版本冲突' }
  return <>
    <div className="asset-shell" ref={shell} data-testid="asset-workbench" data-revision={project?.document.revision}>
      <header className="asset-header"><button className="asset-brand" onClick={() => void action(async () => { await assetWorkspace.flush(); onBack() })}><ArrowLeft size={18}/><span>织境<small>Sceneweave</small></span></button><div className="asset-header-title"><Layers3 size={20}/><span>素材工坊</span><b>B1 校样</b></div><div className="asset-header-actions"><span role="status" className={`asset-save ${state.status}`}>{state.status === 'saving' ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} {saveLabels[state.status]}</span><button className="secondary" disabled={busy} onClick={() => file.current?.click()}><Upload size={15}/>打开工程</button><button className="primary" disabled={busy || !project} onClick={backup}><Download size={15}/>完整工程</button></div></header>
      <div className="asset-phase-note">真实纹理与透明物件 · 主持人工作台<span>建筑与地形工具、正式画风、玩家输出按后续批次开放</span></div>
      {(state.error || message) && <div className="asset-notice" role="alert"><span>{message ?? state.error}</span>{state.status === 'error' && <button onClick={() => void action(() => assetWorkspace.retry())}>重试保存</button>}{['conflict', 'error'].includes(state.status) && <button onClick={() => void action(async () => { await assetWorkspace.saveAsCopy(); await refresh() })}>另存副本</button>}<button aria-label="关闭工坊提示" onClick={() => setMessage(null)}><X size={16}/></button></div>}
      <div className="asset-layout">
        <aside className="asset-library"><div className="asset-section-heading"><Layers3 size={16}/><h2>工程与素材</h2></div><button className="asset-new-card" disabled={busy} onClick={() => prepare(createCalibrationProject, '原创程序校样：重复木纹、透明书桌与椅子，用于验证素材和工程保存。')}><div className="asset-wood-swatch"/><strong>木纹书房</strong><span>打开材质校样</span><small>3 张位图 · 1 种材质 · 2 件家具</small></button><button className="secondary asset-migrate" disabled={busy} onClick={migrateCurrent}><FolderOpen size={15}/>迁移当前 M0 场景</button><h3>最近的完整工程</h3><div className="asset-recent">{recent.length ? recent.map(item => <button key={item.sceneId} disabled={busy} className={item.sceneId === project?.document.sceneId ? 'selected' : ''} onClick={() => void action(async () => {
          const checkpoint = assetWorkspace.checkpoint(); await ready(); const saved = await repository.load(item.sceneId)
          if (!saved) throw new Error('工程不存在。')
          await assetWorkspace.openPersisted(saved, checkpoint); setSelected(null)
        })}><FolderOpen size={15}/><span>{item.title}<small>r{item.revision} · {new Date(item.savedAt).toLocaleDateString('zh-CN')}</small></span></button>) : <p>尚无素材工程。可先打开校样。</p>}</div>{project && <><h3>当前场景物件</h3><div className="asset-entity-list">{Object.keys(project.document.props).map(id => <button key={id} className={id === selected ? 'selected' : ''} onClick={() => setSelected(id)}><Move size={14}/><span>{propLabel(id)}</span>{project.document.props[id].visibility === 'gm' && <small>GM</small>}</button>)}</div></>}</aside>
        <main className="asset-center"><div className="asset-scene-bar"><div><small>主持人场景</small><h1>{project?.document.title ?? '让空间有材质，也有故事'}</h1></div><div className="asset-toolbar"><button aria-label="撤销素材编辑" disabled={!state.canUndo || busy} onClick={() => commit(() => assetWorkspace.undo())}><Undo2 size={17}/></button><button aria-label="重做素材编辑" disabled={!state.canRedo || busy} onClick={() => commit(() => assetWorkspace.redo())}><Redo2 size={17}/></button><button aria-label="素材历史快照" disabled={!project || busy} onClick={() => void action(async () => { await assetWorkspace.flush(); setSnapshots(await repository.listSnapshots(project!.document.sceneId)) })}><Archive size={17}/></button></div></div>
          <div className="asset-stage">{project ? <AssetCanvas project={project} selected={selected} onSelect={setSelected}/> : <div className="asset-empty"><div className="asset-empty-icon"><Layers3 size={36}/></div><span>从一间书房开始</span><p>先确认纹理和组件可以完整存下、重新打开，<br/>再逐步扩展建筑、地形与布景工具。</p><button className="primary" disabled={busy} onClick={() => prepare(createCalibrationProject, '创建原创材质工程校样。')}>打开材质校样</button></div>}</div><footer className="asset-canvas-footer"><span>主画面仅供主持人使用，可能包含秘密内容</span>{project && <span>{Object.keys(project.assets).length} 张位图 · r{project.document.revision}</span>}</footer>
        </main>
        <aside className="asset-inspector"><div className="asset-section-heading"><Move size={16}/><h2>{prop ? '物件属性' : '工程信息'}</h2></div>{prop && selected ? <><h3>{propLabel(selected)}</h3><p className="asset-muted">图像范围与物理占地分别保存。虚线显示视觉边界与占地。</p><fieldset disabled={busy || prop.editLocked}><NumberInput label="物件 X" value={prop.positionMm.x} onCommit={x => commit(() => assetWorkspace.updateProp(selected, { positionMm: { ...prop.positionMm, x } }))}/><NumberInput label="物件 Y" value={prop.positionMm.y} onCommit={y => commit(() => assetWorkspace.updateProp(selected, { positionMm: { ...prop.positionMm, y } }))}/><NumberInput label="物件旋转" value={prop.rotationDeg} unit="°" onCommit={rotationDeg => commit(() => assetWorkspace.updateProp(selected, { rotationDeg }))}/></fieldset><dl className="asset-facts"><dt>物理占地</dt><dd>{prop.footprintMm.width} × {prop.footprintMm.height} mm</dd><dt>图像范围</dt><dd>{prop.visualBoundsMm.width} × {prop.visualBoundsMm.height} mm</dd><dt>阻挡移动</dt><dd>{prop.blocksMovement ? '是' : '否'}</dd><dt>可见范围</dt><dd>{prop.visibility === 'gm' ? '仅主持人' : '公开'}</dd></dl><button className="asset-clear" onClick={() => setSelected(null)}>返回工程信息</button></> : project ? <><h3>完整工程 · v2</h3><p className="asset-muted">位图、固定定义与许可随工程一起备份。校样素材独立于正式主题。</p><dl className="asset-facts"><dt>场景修订</dt><dd>r{project.document.revision}</dd><dt>素材字节</dt><dd>{bytesLabel(Object.values(project.assets).reduce((sum, asset) => sum + asset.sizeBytes, 0))}</dd><dt>定义快照</dt><dd>{Object.keys(project.document.propDefinitions).length} 件物件 / {Object.keys(project.document.materials).length} 种材质</dd><dt>许可绑定</dt><dd>{project.licenseBindings.length} 条</dd></dl><h3>地面材质</h3>{Object.values(project.document.rooms).filter(room => room.floorStyle).map(room => <fieldset key={room.id} disabled={busy || room.editLocked}><NumberInput label="木纹方向" value={room.floorStyle!.base.rotationDeg} unit="°" onCommit={rotation => commit(() => assetWorkspace.rotateRoomMaterial(room.id, rotation))}/></fieldset>)}<button className="secondary" disabled={busy} onClick={() => void action(async () => { await validateCompleteProjectV2(project); setMessage('完整工程校验通过：格式、引用、位图与许可一致。') })}><CheckCircle2 size={15}/>校验完整工程</button>{project.migrationSource && <div className="asset-provenance"><strong>M0 迁移副本</strong><p>来源修订 r{project.migrationSource.sourceRevision}，原始文件保存在本地迁移记录中。</p><button onClick={() => download(project.migrationSource!.original, project.migrationSource!.original.type === 'application/json' ? 'sceneweave-original-v1.json' : 'sceneweave-original-v1.sceneweave')}>下载迁移原件</button></div>}</> : <p className="asset-muted">打开校样、迁移旧场景，或导入完整工程。</p>}<div className="asset-next"><RotateCw size={16}/><strong>接下来的样板</strong><p>厚墙与斜墙 → 材质铺装 → 室外台地与岸线 → 组合和散布。</p></div></aside>
      </div>
      <input hidden ref={file} type="file" accept=".sceneweave" aria-label="选择完整素材工程" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) prepare(signal => prepareProjectFile(selected, signal), '打开为独立副本，不覆盖当前工程。M0 文件会显式迁移到 v2。') }}/>
      {busy && <div className="asset-busy" role="status"><LoaderCircle size={17} className="spin"/>正在处理完整工程…{controller.current && <button onClick={() => controller.current?.abort()}>取消准备</button>}</div>}
    </div>
    {(candidate || snapshots) && <div className="modal-scrim"><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={candidate ? '确认打开素材工程' : '素材历史快照'}><div className="modal-heading"><h2>{candidate ? '确认打开素材工程' : '素材历史快照'}</h2><button className="icon-button" disabled={busy} aria-label="取消打开素材工程" onClick={() => { setCandidate(null); setSnapshots(null) }}><X size={18}/></button></div>{candidate ? <><p>{candidate.description}</p><div className="asset-candidate"><strong>{candidate.project.document.title}</strong><span>{Object.keys(candidate.project.assets).length} 张位图 · {Object.keys(candidate.project.document.props).length} 件物件 · v2 完整工程</span>{candidate.project.migrationSource && <span>实际来源修订 r{candidate.project.migrationSource.sourceRevision}</span>}</div><div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={() => void action(async () => { await ready(); await assetWorkspace.adoptNew(candidate.project, candidate.checkpoint); setCandidate(null); setSelected(null); await refresh() })}>保存并打开副本</button></div></> : <><p>最近 20 次成功保存。恢复会新建完整副本。</p><div className="asset-snapshots">{snapshots?.map(snapshot => <div key={snapshot.revision}><span>r{snapshot.revision}</span><small>{new Date(snapshot.savedAt).toLocaleString('zh-CN')}</small><button className="secondary" disabled={busy} onClick={() => void action(async () => {
      const checkpoint = assetWorkspace.checkpoint(), recovered = await repository.loadSnapshot(snapshot.sceneId, snapshot.revision)
      if (!recovered) throw new Error('快照已不存在。')
      assetWorkspace.assertCheckpoint(checkpoint); setSnapshots(null); setCandidate({ project: forkProjectV2(recovered), checkpoint, description: '从历史快照创建副本。当前工程继续保留。' })
    })}>恢复副本</button></div>)}</div></>}</div></div>}
  </>
}
