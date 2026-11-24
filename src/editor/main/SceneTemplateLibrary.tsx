import { useEffect, useRef, useState } from 'react'
import { describeBridgeTemplateChanges, prepareBridgeTemplateRevision, type BridgeTemplateField } from '../../application/workspace/bridge-template-revisions'
import type { EditableProject } from '../../application/workspace/project'
import { toBundle } from '../../application/workspace/project'
import { inspectSceneTemplate, loadSceneTemplate, prepareSceneTemplate, SCENE_TEMPLATE_LIMITS, type SceneTemplateEntry, type SceneTemplatePlacement } from '../../shared/scene-templates/content'
import { exportSceneTemplateBackup, importSceneTemplateBackup } from '../../shared/scene-templates/backup'
import { sha256Bytes } from '../../shared/project/binary'
import { SceneTemplateRepository } from '../../platform/browser/library/scene-templates'
import { runtime, validation } from '../../platform/browser/runtime'
import { THEMED_ROOM_PRESETS, createThemedRoomProject, type ThemedRoomPresetId } from '../../platform/browser/content/themed-rooms'
import SceneTemplateGallery from './SceneTemplateGallery'
import { bridgeTemplateFieldLabels } from './bridge-template-labels'

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function SceneTemplateLibrary({ project, ids, floorId, layerId, disabled, onPendingChange, onDraftChange, onPreview, onCanvasPlacement, onBridgeSync }: {
  project: EditableProject; ids: readonly string[]; floorId: string; layerId: string; disabled: boolean
  onPendingChange: (value: boolean) => void; onDraftChange: (value: boolean) => void
  onPreview: (entry: SceneTemplateEntry, placement: SceneTemplatePlacement, signal: AbortSignal) => Promise<void>
  onCanvasPlacement: (entry: SceneTemplateEntry, placement: SceneTemplatePlacement, signal: AbortSignal) => Promise<void>
  onBridgeSync: (bridgeId: string, original: SceneTemplateEntry, next: SceneTemplateEntry, signal: AbortSignal) => Promise<void>
}) {
  const scene = project.document
  const [name, setName] = useState('我的房间'), [rooms, setRooms] = useState<string[]>([]), [notes, setNotes] = useState<string[]>([]), [masks, setMasks] = useState<string[]>([])
  const [entries, setEntries] = useState<SceneTemplateEntry[]>([]), [selected, setSelected] = useState(''), [revision, setRevision] = useState(0)
  const [bridgePredecessors, setBridgePredecessors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(true), [status, setStatus] = useState(''), [dirty, setDirty] = useState(false)
  const [loadedSceneId, setLoadedSceneId] = useState<string | null>(null)
  const loaded = loadedSceneId === scene.sceneId
  const [x, setX] = useState('2'), [y, setY] = useState('2'), [turns, setTurns] = useState<0 | 1 | 2 | 3>(0), [support, setSupport] = useState('floor')
  const [themePreset, setThemePreset] = useState<ThemedRoomPresetId>('guest-compact')
  const [bridgeComparison, setBridgeComparison] = useState<{ id: string; key: string; revision: number; fields: BridgeTemplateField[] }>()
  const [bridgeFields, setBridgeFields] = useState<BridgeTemplateField[]>([]), [bridgeRevisionName, setBridgeRevisionName] = useState('')
  const active = useRef<AbortController | null>(null), fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => { onDraftChange(dirty); return () => onDraftChange(false) }, [dirty, onDraftChange])
  useEffect(() => { setRooms(ids.filter(id => !!scene.rooms[id])) }, [ids, scene.sceneId])
  useEffect(() => { setSupport('floor') }, [floorId])
  useEffect(() => {
    const controller = new AbortController(), repository = new SceneTemplateRepository({ ...validation, signal: controller.signal })
    active.current = controller; setBusy(true); setLoadedSceneId(null); setStatus('正在读取并校验场景模板库…')
    void repository.read().then(value => { if (!controller.signal.aborted) { setEntries(value.entries); setRevision(value.revision); setBridgePredecessors(value.bridgePredecessors); setLoadedSceneId(scene.sceneId); setStatus('') } }).catch(error => { if (!controller.signal.aborted) setStatus(`模板库读取未完成，请刷新重试：${String(error)}`) }).finally(() => {
      repository.close()
      if (active.current === controller) { active.current = null; setBusy(false) }
    })
    return () => { controller.abort(); active.current?.abort() }
  }, [scene.sceneId])
  const run = async (job: (repository: SceneTemplateRepository, signal: AbortSignal) => Promise<void>, pending = true, allowUnread = false) => {
    if (active.current || disabled || (!loaded && !allowUnread)) return
    const controller = new AbortController(), repository = new SceneTemplateRepository({ ...validation, signal: controller.signal })
    active.current = controller; setBusy(true); if (pending) onPendingChange(true)
    try { await job(repository, controller.signal) } catch (error) { if (!controller.signal.aborted) setStatus(`模板操作未完成：${error instanceof Error ? error.message : String(error)}`) }
    finally { repository.close(); if (active.current === controller) { active.current = null; setBusy(false); if (pending) onPendingChange(false) } }
  }
  const update = (value: Awaited<ReturnType<SceneTemplateRepository['read']>>) => { setEntries(value.entries); setRevision(value.revision); setBridgePredecessors(value.bridgePredecessors); setLoadedSceneId(scene.sceneId) }
  const request = { name, roomIds: rooms, noteIds: notes, maskIds: masks }
  const selectedBridge = ids.length === 1 && scene.paths[ids[0]]?.assembly?.bridge ? ids[0] : undefined
  const bridgeKey = selectedBridge ? scene.paths[selectedBridge].assembly!.bridge!.templateKey : undefined
  const originalBridge = entries.find(row => row.key === bridgeKey)
  const bridgeChanges = bridgeComparison && bridgeComparison.id === selectedBridge && bridgeComparison.key === bridgeKey
    && bridgeComparison.revision === scene.revision ? bridgeComparison.fields : undefined
  let scope: ReturnType<typeof inspectSceneTemplate> | undefined, scopeError = ''
  if (rooms.length) { try { scope = inspectSceneTemplate(scene, request) } catch (error) { scopeError = error instanceof Error ? error.message : String(error) } }
  const toggle = (current: string[], id: string) => current.includes(id) ? current.filter(value => value !== id) : [...current, id]
  const chosen = entries.find(row => row.key === selected)
  const saveTemplate = (input: unknown) => void run(async (repository, signal) => {
    setStatus('正在检查完整范围与资源…')
    const entry = await prepareSceneTemplate(toBundle(project), input, { validation: { ...validation, signal }, runtime })
    update(await repository.commit(revision, [entry])); setSelected(entry.key); setDirty(false); setStatus(`已保存「${entry.name}」到场景模板库。`)
  })
  return <section aria-label="房间与建筑模板" className="composition-source">
    <h3>房间、建筑与桥梁模板</h3>
    <details><summary>灰橡主题房间</summary>
      <p>同一套原创灰橡、青灰织物与灰石素材，按真实尺寸布置。紧凑房间重新安排家具，保留实际门前和取用空间。</p>
      <label>主题房间样板<select aria-label="主题房间样板" value={themePreset} disabled={busy || disabled} onChange={event => setThemePreset(event.target.value as ThemedRoomPresetId)}>{THEMED_ROOM_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name} · {preset.widthMm / 1000}×{preset.heightMm / 1000}米</option>)}</select></label>
      <button className="secondary asset-wide" disabled={disabled || busy || !loaded} onClick={() => void run(async (repository, signal) => {
        setStatus('正在准备原创主题家具与真实用途通路…')
        const result = await createThemedRoomProject(themePreset, signal)
        const entry = await prepareSceneTemplate(toBundle(result.project), { name: result.project.document.title, roomIds: Object.keys(result.project.document.rooms) }, { validation: { ...validation, signal }, runtime })
        update(await repository.commit(revision, [entry])); setSelected(entry.key)
        const missing = result.report.rooms.reduce((sum, room) => sum + Math.max(0, room.recommended.length - room.placed.length), 0)
        setStatus(`主题模板「${entry.name}」已入库，已布置${result.report.propIds.length}件功能家具，${missing}项建议未填充。${result.report.notes.join('；')}`)
      })}>准备主题房间模板</button>
    </details>
    <details><summary>保存当前房间／建筑</summary>
      <label>模板名称<input aria-label="场景模板名称" value={name} maxLength={80} disabled={busy} onChange={event => { setName(event.target.value); setDirty(true) }}/></label>
      <fieldset disabled={disabled || busy}><legend>包含的房间</legend>{Object.values(scene.rooms).filter(room => room.floorId === floorId).map(room => <label key={room.id}><input type="checkbox" checked={rooms.includes(room.id)} onChange={() => { setRooms(current => toggle(current, room.id)); setDirty(true) }}/>{room.purpose || room.id}</label>)}</fieldset>
      <fieldset disabled={disabled || busy}><legend>明确携带的注记</legend>{Object.values(scene.notes).filter(note => note.floorId === floorId).map(note => <label key={note.id}><input type="checkbox" checked={notes.includes(note.id)} onChange={() => { setNotes(current => toggle(current, note.id)); setDirty(true) }}/>{note.title || note.text.slice(0, 24)} · {note.visibility === 'gm' ? '主持人' : '公开'}</label>)}</fieldset>
      <fieldset disabled={disabled || busy}><legend>玩家遮罩</legend>{Object.values(scene.regions).filter(region => region.floorId === floorId && region.kind === 'manualMask').map(region => <label key={region.id}><input type="checkbox" checked={masks.includes(region.id)} onChange={() => { setMasks(current => toggle(current, region.id)); setDirty(true) }}/>{region.id}</label>)}</fieldset>
    {scope && <p role="status">将保存{scope.roomIds.length}间房、{scope.wallIds.length}段墙、{scope.openingIds.length}处开口、{scope.propIds.length}件物件、{scope.prefabIds.length}个组合和{scope.noteIds.length}条注记。{scope.attachmentSurfaceIds.length > 0 && `同时保存${scope.attachmentSurfaceIds.length}处物件顶面和${scope.attachmentIds.length}条承托关系。`}放置时，{scope.layerIds.length}个源图层映射到所选目标图层。光照、场景滤镜和环境使用目标工程设置。</p>}
      {scopeError && <p role="alert">{scopeError}</p>}
      <button className="secondary asset-wide" disabled={disabled || busy || !loaded || !scope || !name.trim()} onClick={() => saveTemplate(request)}>保存完整场景模板</button>
    </details>
    {selectedBridge && <details><summary>保存当前整座桥</summary>
      <label>桥梁模板名称<input value={name === '我的房间' ? '我的桥' : name} maxLength={80} disabled={busy} onChange={event => { setName(event.target.value); setDirty(true) }}/></label>
      <fieldset disabled={busy || disabled}><legend>随桥携带的玩家遮罩</legend>{Object.values(scene.regions).filter(region => region.floorId === floorId && region.kind === 'manualMask').map(region => <label key={region.id}><input type="checkbox" checked={masks.includes(region.id)} onChange={() => { setMasks(current => toggle(current, region.id)); setDirty(true) }}/>{region.id}</label>)}</fieldset>
      <button type="button" className="secondary asset-wide" disabled={disabled || busy || !loaded || !name.trim()} onClick={() => saveTemplate({ name: name === '我的房间' ? '我的桥' : name, bridgeId: selectedBridge, maskIds: masks })}>将整座桥保存到模板库</button>
    </details>}
    {selectedBridge && originalBridge && <details><summary>桥梁模板版本</summary>
      <p>当前实例使用「{originalBridge.name}」。</p>
      <button type="button" className="secondary asset-wide" disabled={disabled || busy || !loaded} onClick={() => void run(async (_repository, signal) => {
        const fields = await describeBridgeTemplateChanges(project, selectedBridge, originalBridge, { ...validation, signal })
        setBridgeComparison({ id: selectedBridge, key: originalBridge.key, revision: scene.revision, fields })
        setBridgeFields([]); setBridgeRevisionName(`${originalBridge.name.slice(0, 74)} · 新版`); setStatus('')
      }, false)}>比较原桥梁模板</button>
      {bridgeChanges && <fieldset disabled={disabled || busy || !loaded}>
        <legend>发布所选改动</legend>
        <p>可发布桥体饰面与沿线设置。同步时保留实例的路线、铺面、桥路链接和手改构件。</p>
        {!bridgeChanges.length && <p>当前实例采用原模板的桥体饰面与沿线设置。</p>}
        {bridgeChanges.map(field => <label key={field}><input type="checkbox" checked={bridgeFields.includes(field)} onChange={event => {
          setBridgeFields(current => event.target.checked ? [...current, field] : current.filter(value => value !== field)); setDirty(true)
        }}/>{bridgeTemplateFieldLabels[field]}</label>)}
        {!!bridgeChanges.length && <label>桥梁新版名称<input value={bridgeRevisionName} maxLength={80} onChange={event => { setBridgeRevisionName(event.target.value); setDirty(true) }}/></label>}
        <button type="button" className="secondary asset-wide" disabled={!bridgeFields.length || !bridgeRevisionName.trim()} onClick={() => void run(async (repository, signal) => {
          const entry = await prepareBridgeTemplateRevision(project, originalBridge, { bridgeId: selectedBridge, name: bridgeRevisionName, fields: bridgeFields }, { validation, runtime, signal })
          update(await repository.commit(revision, [entry])); setSelected(entry.key); setDirty(false); setBridgeFields([])
          setStatus(`已发布「${entry.name}」。在「我的场景模板」中选择新版，可以预览同步当前选中的桥梁实例。`)
        })}>发布桥梁模板新版</button>
      </fieldset>}
      {chosen && bridgePredecessors[chosen.key] === originalBridge.key && <button type="button" className="secondary asset-wide" disabled={disabled || busy || !loaded} onClick={() => void run(async (_repository, signal) => {
        await onBridgeSync(selectedBridge, originalBridge, chosen, signal)
        setDirty(false); setStatus('桥梁同步候选已准备，请检查画布和改动范围。')
      }, false)}>预览同步「{chosen.name}」</button>}
    </details>}
    <label>我的场景模板<select aria-label="我的场景模板" value={selected} disabled={busy || !loaded} onChange={event => setSelected(event.target.value)}><option value="">选择模板</option>{entries.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label>
    <SceneTemplateGallery entries={entries} selected={selected} disabled={busy || !loaded} onSelect={setSelected}/>
    <button className="secondary" disabled={busy || disabled} onClick={() => void run(async repository => { update(await repository.read()); setStatus('场景模板库已刷新。') }, true, true)}>刷新模板库</button>
    {chosen && <>
      <p>目标楼层：{scene.floors[floorId]?.name} · 图层：{scene.userLayers[layerId]?.name}</p>
      <label>支撑<select aria-label="场景模板目标支撑" value={support} disabled={busy} onChange={event => { setSupport(event.target.value); setDirty(true) }}><option value="floor">当前楼层地面</option>{Object.values(scene.terrainAreas).filter(area => area.floorId === floorId).map(area => <option key={area.id} value={area.id}>{area.id} · 高程{area.groundElevationMm / 1000}米</option>)}</select></label>
      <label>左上锚点 X（米）<input aria-label="场景模板X米" type="number" step="0.001" value={x} disabled={busy} onChange={event => { setX(event.target.value); setDirty(true) }}/></label>
      <label>左上锚点 Y（米）<input aria-label="场景模板Y米" type="number" step="0.001" value={y} disabled={busy} onChange={event => { setY(event.target.value); setDirty(true) }}/></label>
      <label>绕锚点朝向<select aria-label="场景模板朝向" value={turns} disabled={busy} onChange={event => { setTurns(Number(event.target.value) as 0 | 1 | 2 | 3); setDirty(true) }}>{[0, 1, 2, 3].map(value => <option key={value} value={value}>{value * 90}°</option>)}</select></label>
      <button className="secondary asset-wide" disabled={disabled || busy || !loaded} onClick={() => void run(async (_repository, signal) => {
        if (!x.trim() || !y.trim() || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) throw new Error('请输入有效米制坐标。')
        await onPreview(chosen, { floorId, layerId, anchorMm: { x: Math.round(Number(x) * 1000), y: Math.round(Number(y) * 1000) }, quarterTurns: turns, supportRef: support === 'floor' ? { kind: 'floor', id: floorId } : { kind: 'terrainArea', id: support } }, signal)
        setDirty(false); setStatus('完整模板候选已准备，请审阅画布和实际影响范围。')
      }, false)}>预览放置场景模板</button>
      <button className="secondary asset-wide" disabled={disabled || busy || !loaded} onClick={() => void run(async (_repository, signal) => {
        if (!x.trim() || !y.trim() || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) throw new Error('请输入有效米制锚点。')
        await onCanvasPlacement(chosen, { floorId, layerId, anchorMm: { x: Math.round(Number(x) * 1000), y: Math.round(Number(y) * 1000) }, quarterTurns: turns, supportRef: support === 'floor' ? { kind: 'floor', id: floorId } : { kind: 'terrainArea', id: support } }, signal)
        setDirty(false); setStatus('模板已跟随画布指针。点击检查候选；可旋转、连续放置或取消。')
      }, false)}>在画布上放置模板</button>
      <button className="secondary" disabled={busy || !loaded} onClick={() => download(chosen.bytes, `${chosen.name.replace(/[<>:"/\\|?*]/g, '-')}.sceneweave-template`)}>导出所选模板</button>
      <button className="secondary" disabled={busy || disabled || !loaded} onClick={() => void run(async repository => { update(await repository.commit(revision, [], [chosen.key])); setSelected(''); setStatus('已移除所选本机模板；已放置实例保留。') })}>移除所选本机模板</button>
    </>}
    <input ref={fileInput} type="file" aria-label="导入场景模板文件" accept=".sceneweave-template,.sceneweave-templates" disabled={busy || disabled || !loaded} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void run(async (repository, signal) => {
      if (file.size > 65 * 1024 * 1024) throw new Error('模板导入超过65MiB。')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const imported = file.name.endsWith('.sceneweave-templates') ? await importSceneTemplateBackup(bytes, { ...validation, signal }) : [{ bytes, key: sha256Bytes(bytes), name: (await loadSceneTemplate(bytes, { ...validation, signal })).project.document.title }]
      update(await repository.commit(revision, imported)); setSelected(imported[0].key); setStatus(`已导入${imported.length}个模板；当前工程未修改。`)
    }) }}/>
    <button className="secondary asset-wide" disabled={busy || disabled || !loaded || !entries.length} onClick={() => void run(async (_repository, signal) => { download(await exportSceneTemplateBackup(entries, { ...validation, signal }), '我的场景模板.sceneweave-templates'); setStatus('已导出模板库备份。') })}>备份全部场景模板</button>
    <p className="asset-muted">本机模板库最多{SCENE_TEMPLATE_LIMITS.entries}项。模板库备份与工程备份分别导出。</p>
    {busy && <button className="secondary" onClick={() => active.current?.abort()}>取消模板准备</button>}
    {status && <p role="status">{status}</p>}
  </section>
}
