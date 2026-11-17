import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditableProject } from '../../application/workspace/project'
import { furnishingRoles, furnishingRoleNames, type FurnishingRole, type RoomFurnishingReview as Review } from '../../shared/furnishing/contracts'
import { furnishingDefinitionRole, furnishingMoveReason, roomFurnishingProps } from '../../shared/furnishing/plan'
import { currentFurnishingPalette, furnishingPaletteMatches, furnishingPaletteLabel, furnishingStyle, type FurnishingPalette, type StyledRoomFurnishing } from '../../shared/furnishing/palette'
import { FURNITURE_STYLES } from '../../shared/assets/furniture-collection'
import { recommendInteriorFurniture } from '../../shared/generation/domains/interior/furnishing'
import { roomPoints } from '../../shared/geometry/geometry'
import { furnishingPaletteDocument, furnishingPaletteProject } from '../../platform/browser/content/furnishing-palette'
import RoomFurnishingReview from './RoomFurnishingReview'

const eraNames = { medieval: '中世纪', fantasy: '西幻', '1920s': '1920年代' }
export default function RoomFurnishingPanel({ project, ids, floorId, layerId, disabled, onDraftChange, onPreview }: {
  project: EditableProject; ids: readonly string[]; floorId: string; layerId: string; disabled: boolean
  onDraftChange: (dirty: boolean) => void
  onPreview: (rows: readonly StyledRoomFurnishing[], signal: AbortSignal) => Promise<Review>
}) {
  const scene = project.document, [roomId, setRoomId] = useState(() => ids.find(id => !!scene.rooms[id]) ?? '')
  const [purpose, setPurpose] = useState(() => scene.rooms[roomId]?.furnishingPlan?.purpose ?? scene.rooms[roomId]?.purpose ?? '客房')
  const [palette, setPalette] = useState<FurnishingPalette>(currentFurnishingPalette)
  const [counts, setCounts] = useState<Partial<Record<FurnishingRole, number>>>({ bed: 1, storage: 1, seat: 1 })
  const [definitions, setDefinitions] = useState<Partial<Record<FurnishingRole, string>>>({}), [movable, setMovable] = useState<string[]>([]), [restore, setRestore] = useState<string[]>([])
  const [variation, setVariation] = useState('1'), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const [review, setReview] = useState<Review | null>(null), [queue, setQueue] = useState<StyledRoomFurnishing[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const active = useRef<AbortController | null>(null), urls = useRef<string[]>([])
  const catalog = useMemo(() => furnishingPaletteDocument(palette), [palette.source, palette.era, palette.styleId, palette.allowMixed])
  const room = scene.rooms[roomId], props = roomFurnishingProps(scene, roomId)
  const available = { ...catalog?.propDefinitions, ...scene.propDefinitions }, candidates = Object.values(available)
  const chosen = (role: FurnishingRole) => available[definitions[role] ?? '']
    ?? props.map(prop => available[prop.definitionRef?.id ?? '']).find(row => row && furnishingDefinitionRole(row) === role && furnishingPaletteMatches(row, palette))
    ?? candidates.find(row => furnishingDefinitionRole(row) === role && furnishingPaletteMatches(row, palette))
  const total = furnishingRoles.reduce((sum, role) => sum + (counts[role] ?? 0), 0)
  const invalidCounts = furnishingRoles.some(role => !Number.isInteger(counts[role] ?? 0) || (counts[role] ?? 0) < 0 || (counts[role] ?? 0) > 12) || total > 32
  const missingRoles = furnishingRoles.filter(role => (counts[role] ?? 0) > 0 && !chosen(role))
  const mixedRoles = furnishingRoles.filter(role => (counts[role] ?? 0) > 0 && chosen(role) && !furnishingPaletteMatches(chosen(role)!, palette))
  const existingOtherStyles = props.filter(prop => { const definition = scene.propDefinitions[prop.definitionRef?.id ?? '']; return definition && !furnishingPaletteMatches(definition, palette) }).length
  const valid = !!room && !!purpose.trim() && !!variation.trim() && !invalidCounts && !!total && !missingRoles.length && (!mixedRoles.length || palette.allowMixed)
  const currentRow = (): StyledRoomFurnishing => ({ palette: { ...palette }, request: { roomId, layerId: queue.find(row => row.request.roomId === roomId)?.request.layerId ?? layerId, purpose, variation, functions: furnishingRoles.filter(role => (counts[role] ?? 0) > 0).map(role => {
    const definition = chosen(role)
    if (!definition) throw new Error(`请为${furnishingRoleNames[role]}选择固定素材。`)
    return { role, count: counts[role]!, definitionRef: { id: definition.id, version: definition.version } }
  }), movableIds: [...movable], restoreDeletedKeys: [...restore] } })
  const queued = queue.find(row => row.request.roomId === roomId)
  const queuedChanged = !!queued && (!valid || JSON.stringify(queued) !== JSON.stringify(currentRow()))
  useEffect(() => { onDraftChange(dirty); return () => onDraftChange(false) }, [dirty, onDraftChange])
  useEffect(() => () => active.current?.abort(), [project])
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), [])
  useEffect(() => {
    const selected = ids.find(id => !!scene.rooms[id])
    if (!dirty && selected && selected !== roomId) { setRoomId(selected); setPurpose(scene.rooms[selected].furnishingPlan?.purpose ?? scene.rooms[selected].purpose); setMovable([]); setRestore([]); setReview(null); setStatus('') }
  }, [ids, scene, dirty, roomId])
  useEffect(() => { setMovable([]); setRestore([]); setReview(null); setQueue([]) }, [scene.sceneId, scene.revision])
  const change = () => { setDirty(true); setReview(null); setStatus('') }
  const clearImages = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; setThumbnails({}) }
  const changePalette = (next: FurnishingPalette) => { setPalette(next); setDefinitions({}); clearImages(); change() }
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id]
  const defaults = () => {
    if (!room) return
    const points = roomPoints(scene, room), area = Math.abs(points.reduce((sum, point, i) => { const next = points[(i + 1) % points.length]; return sum + point.x * next.y - next.x * point.y }, 0)) / 2
    const roles = recommendInteriorFurniture(purpose, area, 20)
    setCounts(Object.fromEntries(furnishingRoles.map(role => [role, roles.filter(value => value === role).length]))); change()
  }
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (disabled || active.current) return
    const controller = new AbortController(); active.current = controller; setBusy(true); setStatus('正在准备所选素材与房间…')
    try { await operation(controller.signal) }
    catch (error) { setStatus(controller.signal.aborted ? '已取消准备，设置已保留，可继续调整。' : `布置未完成：${error instanceof Error ? error.message : String(error)} 设置已保留，调整后可再次预览。`) }
    finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }
  const preview = (batch: boolean) => void run(async signal => {
    if (batch ? !queue.length || queuedChanged : !valid) return
    setReview(null)
    const rows = batch ? queue : [currentRow()], result = await onPreview(rows, signal)
    signal.throwIfAborted(); setDirty(false); setReview(result); setStatus('')
  })
  const previewMaterials = () => void run(async signal => {
    const provider = palette.source === 'current' ? project : await furnishingPaletteProject(palette, signal)
    const next: Record<string, string> = {}, created: string[] = []
    try {
      const selected = [...new Map(furnishingRoles.filter(role => (counts[role] ?? 0) > 0).flatMap(role => chosen(role) ?? []).map(row => [row.id, row])).values()]
      for (const definition of selected.filter(row => furnishingPaletteMatches(row, palette))) {
        const appearance = definition.defaultAppearance
        if (appearance.kind !== 'image') continue
        const source = scene.assets[appearance.assetId] ? project : provider, asset = source.document.assets[appearance.assetId]
        if (!asset) continue
        const bytes = await source.resources.read(asset.sha256); signal.throwIfAborted()
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: asset.mimeType })); created.push(url); next[definition.id] = url
      }
      signal.throwIfAborted(); clearImages(); urls.current = created; setThumbnails(next); setStatus('已读取实际素材图；尺寸与占地仍按所选定义计算。')
    } catch (error) { created.forEach(url => URL.revokeObjectURL(url)); throw error }
  })
  const loadQueued = (row: StyledRoomFurnishing) => {
    setRoomId(row.request.roomId); setPurpose(row.request.purpose); setPalette({ ...row.palette }); setVariation(row.request.variation)
    setCounts(Object.fromEntries(row.request.functions.map(fn => [fn.role, fn.count]))); setDefinitions(Object.fromEntries(row.request.functions.map(fn => [fn.role, fn.definitionRef.id])))
    setMovable([...row.request.movableIds]); setRestore([...row.request.restoreDeletedKeys]); clearImages(); change()
  }
  return <section aria-label="按用途布置现有房间" className="composition-source room-furnishing-panel">
    <h3>按用途布置现有房间</h3>
    <p className="asset-muted">选择房间、用途与风格 → 选择家具 → 预览并采用。按实际尺寸和门窗重新布局，已有家具默认保留。</p>
    <fieldset disabled={disabled || busy}>
      <h4>1. 房间与用途</h4>
      <label>目标房间<select aria-label="用途布置目标房间" value={roomId} disabled={queuedChanged} onChange={event => { const saved = queue.find(row => row.request.roomId === event.target.value); if (saved) { loadQueued(saved); return }; setRoomId(event.target.value); setPurpose(scene.rooms[event.target.value]?.furnishingPlan?.purpose ?? scene.rooms[event.target.value]?.purpose ?? '客房'); setMovable([]); setRestore([]); change() }}><option value="">选择现有房间</option>{Object.values(scene.rooms).filter(row => row.floorId === floorId).map((row, index) => <option key={row.id} value={row.id}>{index + 1}. {row.purpose || '未命名房间'}</option>)}</select></label>
      <label>布置用途<input aria-label="布置用途" list="room-furnishing-purposes" value={purpose} maxLength={80} onChange={event => { setPurpose(event.target.value); change() }}/></label>
      <datalist id="room-furnishing-purposes">{['客房', '厨房', '布草储藏间', '餐厅', '书房', '接待休息室', '事务所'].map(value => <option key={value} value={value}/>)}</datalist>
      <label>家具来源<select aria-label="用途布置家具来源" value={palette.source} onChange={event => {
        const source = event.target.value as FurnishingPalette['source']
        changePalette(source === 'inn' ? { source, era: 'medieval', styleId: 'gray-oak', allowMixed: false } : source === 'collection' ? { source, era: 'medieval', styleId: 'peasant', allowMixed: false } : currentFurnishingPalette())
      }}><option value="current">当前工程素材</option><option value="inn">灰橡旅舍功能套装＋当前工程</option><option value="collection">年代与风格家具＋当前工程</option></select></label>
      <label>年代<select aria-label="用途布置年代" value={palette.era} disabled={palette.source === 'inn'} onChange={event => { const era = event.target.value as FurnishingPalette['era']; changePalette({ ...palette, era, styleId: palette.source === 'collection' ? FURNITURE_STYLES.find(row => era === 'all' || row.era === era)!.id : 'all', allowMixed: false }) }}>{palette.source === 'current' && <option value="all">不限年代</option>}{Object.entries(eraNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>风格<select aria-label="用途布置风格" value={palette.styleId} disabled={palette.source === 'inn'} onChange={event => changePalette({ ...palette, styleId: event.target.value, allowMixed: false })}>{palette.source === 'current' && <option value="all">不限风格</option>}{palette.source !== 'collection' && ['all', 'medieval'].includes(palette.era) && <option value="gray-oak">灰橡旅舍</option>}{FURNITURE_STYLES.filter(row => palette.era === 'all' || row.era === palette.era).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <button type="button" className="secondary" onClick={previewMaterials}>查看匹配素材图</button>
      {palette.source === 'collection' && <p className="asset-muted">这组配套素材提供床、桌、椅、柜。炉具、酒具、电话等专用设备需另选；缺项会提示，家具保留原尺寸。</p>}
      {palette.source === 'current' && palette.styleId === 'all' && <p className="asset-muted">自由选材会包含未标注风格的素材；可限定年代或风格后再筛选。</p>}
      {!!existingOtherStyles && <p role="note">房间中有{existingOtherStyles}件其他风格或未标注家具，本次保留原样。</p>}
      <button type="button" className="secondary" disabled={!room} onClick={defaults}>按用途与面积建议数量</button>
      <h4>2. 家具与目标总数</h4>
      <p>数量包含已有家具。例如已有1张床、目标2张时，只尝试补1张。设为0会跳过该功能，保留现有家具。</p>
      {furnishingRoles.map(role => {
        const same = candidates.filter(row => furnishingPaletteMatches(row, palette)), matching = same.filter(row => furnishingDefinitionRole(row) === role), others = same.filter(row => furnishingDefinitionRole(row) !== role)
        const cross = candidates.filter(row => !furnishingPaletteMatches(row, palette)), selected = chosen(role)
        const existing = props.filter(prop => furnishingDefinitionRole(scene.propDefinitions[prop.definitionRef?.id ?? '']) === role).length
        return <div key={role} className="furnishing-function">
          <label>{furnishingRoleNames[role]} · 已有{existing}件<input aria-label={`布置${furnishingRoleNames[role]}数量`} type="number" min={0} max={12} step={1} value={counts[role] ?? 0} onChange={event => { setCounts(current => ({ ...current, [role]: Number(event.target.value) })); change() }}/></label>
          {(counts[role] ?? 0) > 0 && <label>选择{furnishingRoleNames[role]}<select aria-label={`布置${furnishingRoleNames[role]}素材`} value={selected?.id ?? ''} onChange={event => { setDefinitions(current => ({ ...current, [role]: event.target.value })); change() }}><option value="" disabled>选择素材</option>{[{ label: `匹配风格 · 适用于${furnishingRoleNames[role]}`, values: matching }, { label: '匹配风格 · 其他用途（请核对）', values: others }, { label: '跨风格／未标注（需确认）', values: cross }].map(({ label, values }) => <optgroup key={label} label={label}>{values.map(definition => <option key={definition.id} value={definition.id}>{definition.name} · {definition.defaultFootprintMm.width / 1000}×{definition.defaultFootprintMm.height / 1000}米 · {furnishingStyle(definition).name}</option>)}</optgroup>)}</select>
            {selected && thumbnails[selected.id] && <img className="furnishing-material-image" src={thumbnails[selected.id]} alt={`${selected.name}实际素材图`}/>}
            <small>{selected ? `新增使用所选素材；已有${furnishingRoleNames[role]}保留原样。` : '所选风格缺少该功能素材，请逐件选材或调整功能数量。'}</small></label>}
        </div>
      })}
      <p aria-label="用途布置数量汇总">目标总数{total}件 · 当前房间已有{props.length}件；每项0–12件，每房最多32件。</p>
      {invalidCounts && <p role="alert">每项数量须为0–12的整数，目标总数最多32件；请调整数量。</p>}
      {!!missingRoles.length && <p role="alert">还缺少{missingRoles.map(role => furnishingRoleNames[role]).join('、')}素材。请手动选材、切换来源或将对应数量设为0。</p>}
      {!!mixedRoles.length && <p role="alert">{mixedRoles.map(role => furnishingRoleNames[role]).join('、')}使用了跨风格或未标注素材，确认后才可预览。</p>}
      <label><input type="checkbox" aria-label="明确允许本房间跨风格选材" checked={palette.allowMixed} onChange={event => { setPalette(current => ({ ...current, allowMixed: event.target.checked })); change() }}/>明确允许本房间选用跨风格／未标注素材</label>
      <label>布局变化<input aria-label="用途布置布局变化" value={variation} maxLength={80} onChange={event => { setVariation(event.target.value); change() }}/></label>
      <details><summary>明确允许移动的现有家具（默认全部保留）</summary>{props.map(prop => { const reason = furnishingMoveReason(scene, roomId, prop.id); return <label key={prop.id} title={reason ?? '仅移动位置，保留朝向及外观'}><input type="checkbox" disabled={!!reason} checked={movable.includes(prop.id)} onChange={() => { setMovable(current => toggle(current, prop.id)); change() }}/>{scene.propDefinitions[prop.definitionRef?.id ?? '']?.name ?? prop.id}{reason ? ` · ${reason}` : ''}</label> })}</details>
      {!!room?.furnishingPlan && <details><summary>人工删除记忆</summary>{room.furnishingPlan.slots.filter(slot => !scene.props[slot.propId]).map(slot => <label key={slot.key}><input type="checkbox" checked={restore.includes(slot.key)} onChange={() => { setRestore(current => toggle(current, slot.key)); change() }}/>重新允许补充{furnishingRoleNames[slot.role]} · {slot.key}</label>)}</details>}
      <h4>3. 预览与审阅</h4><p>预览后查看实际变化；确认前工程不会修改。可先单独预览本房间，返回调整后再加入整栋布置。</p>
      <button className="secondary asset-wide" disabled={!valid} onClick={() => preview(false)}>预览用途布置</button>
      <button className="secondary asset-wide" disabled={!valid || !queued && queue.length >= 64} onClick={() => { const row = currentRow(); setQueue(current => queued ? current.map(value => value.request.roomId === roomId ? row : value) : [...current, row]); change() }}>{queued ? '更新此房间设置' : '加入本次建筑布置'}</button>
      <section aria-label="本次建筑布置" className="furnishing-queue">
        <h4>多个房间一起布置 · {queue.length}间</h4>
        <p>逐房加入设置后，统一预览并一次采用、撤销。每次最多64间，实际展开仍须通过整体事务预算。</p>
        {queue.map(row => <div key={row.request.roomId} data-furnishing-room={row.request.roomId}>
          <p>{row.request.purpose} · {furnishingPaletteLabel(row.palette)} · {row.request.functions.reduce((n, fn) => n + fn.count, 0)}件目标家具</p>
          <button type="button" className="secondary" disabled={queuedChanged && row.request.roomId !== roomId} onClick={() => loadQueued(row)}>调整{row.request.purpose}</button>
          <button type="button" className="secondary" onClick={() => { setQueue(current => current.filter(value => value.request.roomId !== row.request.roomId)); change() }}>移除{row.request.purpose}</button>
        </div>)}
        {queuedChanged && <><p role="alert">当前房间设置已调整，请先点击“更新此房间设置”，再切换房间或统一预览。</p><button type="button" className="secondary" onClick={() => loadQueued(queued!)}>放弃当前房间调整</button></>}
        <button className="secondary asset-wide" disabled={!queue.length || queuedChanged} onClick={() => preview(true)}>预览本次{queue.length}个房间</button>
      </section>
    </fieldset>
    {busy && <button className="secondary" onClick={() => active.current?.abort()}>取消用途布置准备</button>}
    {status && <p role="status">{status}</p>}
    {review && <RoomFurnishingReview review={review}/>}
  </section>
}
