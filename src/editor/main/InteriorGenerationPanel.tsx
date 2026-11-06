import { useId, useRef, useState } from 'react'
import type { InteriorPreview } from '../../application/workspace/workspace'
import type { InteriorLayoutParameters } from '../../shared/generation/domains/interior/contracts'
import './terrain-generation.css'
import './interior-generation.css'

export interface InteriorGenerationUiRequest {
  title: string
  widthMm: number
  heightMm: number
  seed: string
  wallThicknessMm: number
  rooms: InteriorLayoutParameters['rooms']
  relations: InteriorLayoutParameters['relations']
  corridor: InteriorLayoutParameters['corridor']
  arrangement: Omit<InteriorLayoutParameters['arrangement'], 'palette'>
}
const initialRooms = (): InteriorLayoutParameters['rooms'] => [
  { id: 'room-1', purpose: '公共室', minAreaMm2: 8_000_000, maxAreaMm2: 80_000_000, minClearSideMm: 2000 },
  { id: 'room-2', purpose: '储藏室', minAreaMm2: 8_000_000, maxAreaMm2: 80_000_000, minClearSideMm: 2000 },
]
const mm = (metres: string) => Math.round(Number(metres) * 1000)
const squareMm = (metres: string) => Math.round(Number(metres) * 1_000_000)

/** Business parameters only. The host owns immutable candidates and saving. */
export default function InteriorGenerationPanel({ busy, disabled, error, candidate, dirty, onGenerate, onAdopt, onCancel, onChange }: {
  busy: boolean; disabled: boolean; error: string | null; candidate: InteriorPreview | null; dirty: boolean
  onGenerate: (input: InteriorGenerationUiRequest) => void | Promise<void>
  onAdopt: () => void | Promise<void>; onCancel: () => void; onChange: () => void
}) {
  const [title, setTitle] = useState('室内布局'), [seed, setSeed] = useState('interior-1')
  const [widthMm, setWidthMm] = useState(12000), [heightMm, setHeightMm] = useState(8000), [wallThicknessMm, setWallThicknessMm] = useState(200)
  const [rooms, setRooms] = useState(initialRooms), [relations, setRelations] = useState<InteriorLayoutParameters['relations']>([])
  const [corridor, setCorridor] = useState<InteriorLayoutParameters['corridor']>({ axis: 'none', clearWidthMm: 1500 })
  const [arrangement, setArrangement] = useState<InteriorGenerationUiRequest['arrangement']>({ doors: true, entrance: true, furniture: true, doorWidthMm: 1100, clearWidthMm: 900 })
  const nextRoom = useRef(3)
  const validationId = useId()
  const locked = busy || disabled
  const change = (apply: () => void) => { if (locked) return; onChange(); apply() }
  const updateRoom = (id: string, patch: Partial<InteriorLayoutParameters['rooms'][number]>) => change(() => setRooms(current => current.map(room => room.id === id ? { ...room, ...patch } : room)))
  const updateRelation = (index: number, patch: Partial<InteriorLayoutParameters['relations'][number]>) => change(() => setRelations(current => current.map((relation, at) => at === index ? { ...relation, ...patch } : relation)))
  const cleanSeed = seed.trim(), cleanTitle = title.trim()
  const validationReason = (() => {
    if (!cleanTitle || cleanTitle.length > 120) return '请填写工程名称，最多120个字符。'
    if (!cleanSeed || cleanSeed.length > 128) return '请填写生成种子，最多128个字符。'
    if (![widthMm, heightMm].every(value => Number.isSafeInteger(value) && value >= 1000 && value <= 200000)) return '建筑宽和高须为1–200米，请调整建筑尺寸。'
    if (!(Number.isSafeInteger(wallThicknessMm) && wallThicknessMm > 0 && wallThicknessMm <= 2000)) return '墙厚须大于0且不超过200厘米，请调整墙厚。'
    for (const [index, room] of rooms.entries()) {
      if (!room.purpose.trim() || room.purpose.length > 120) return `请填写房间${index + 1}的用途，最多120个字符。`
      if (![room.minAreaMm2, room.maxAreaMm2].every(value => Number.isSafeInteger(value) && value > 0)) return `房间${index + 1}的最小、最大净面积须大于0，请调整面积要求。`
      if (!(Number.isSafeInteger(room.minClearSideMm) && room.minClearSideMm > 0)) return `房间${index + 1}的最小净边长须大于0，请调整净边长。`
      if (room.maxAreaMm2 < room.minAreaMm2) return `房间${index + 1}的最大净面积小于最小净面积，请调整其中一个面积要求。`
    }
    for (const [index, relation] of relations.entries()) {
      if (relation.a === relation.b) return `关系${index + 1}选择了同一个房间，请选择两个不同房间。`
      if (!(relation.minimumSharedWallMm >= 0 && Number.isSafeInteger(relation.minimumSharedWallMm))) return `关系${index + 1}的最小共墙长度须为非负数，请调整共墙长度。`
    }
    if (!(Number.isSafeInteger(corridor.clearWidthMm) && corridor.clearWidthMm > 0 && corridor.clearWidthMm <= 1_000_000)) return corridor.axis === 'none' ? '走廊净宽须大于0且不超过1000米，请先选择横向或纵向走廊后调整净宽。' : '走廊净宽须大于0且不超过1000米，请调整净宽。'
    if (!(Number.isSafeInteger(arrangement.doorWidthMm) && arrangement.doorWidthMm > 0 && arrangement.doorWidthMm <= 5000)) return '建议门宽须大于0且不超过5米，请调整门宽。'
    if (!(Number.isSafeInteger(arrangement.clearWidthMm) && arrangement.clearWidthMm > 0 && arrangement.clearWidthMm <= 5000)) return '建议通路净宽须大于0且不超过5米，请调整净宽。'
    return null
  })()
  const valid = validationReason === null
  return <section className="terrain-generation-panel interior-generation-panel" aria-label="室内布局生成">
    <h2>室内布局</h2>
    <p>按房间面积、净边长和相邻关系安排房间。候选包含真实房间与共享墙，可保存后继续编辑。</p>
    <p className="asset-muted">首次生成会按用途、大小与实际空间建议门和家具，并核对通路净空。未完成的建议会说明原因；保存后可自由修改、删除，不会自动补回。</p>
    {dirty && !busy && !candidate && !error && <p className="terrain-generation-notice" role="status">参数已修改，请预览当前设置。当前工程尚未改变。</p>}
    <form onSubmit={event => { event.preventDefault(); if (valid && !locked) void onGenerate({ title: cleanTitle, widthMm, heightMm, seed: cleanSeed, wallThicknessMm, rooms: rooms.map(room => ({ ...room, purpose: room.purpose.trim() })), relations, corridor, arrangement }) }}>
      <fieldset disabled={locked}>
        <legend>建筑与房间要求</legend>
        <label>工程名称<input aria-label="室内工程名称" value={title} maxLength={120} onChange={event => change(() => setTitle(event.target.value))}/></label>
        <div className="interior-field-pair">
          <label>建筑宽（米）<input aria-label="室内建筑宽米" type="number" min="1" max="200" step="0.1" value={widthMm / 1000} onChange={event => change(() => setWidthMm(mm(event.target.value)))}/></label>
          <label>建筑高（米）<input aria-label="室内建筑高米" type="number" min="1" max="200" step="0.1" value={heightMm / 1000} onChange={event => change(() => setHeightMm(mm(event.target.value)))}/></label>
        </div>
        <label>墙厚（厘米）<input aria-label="室内墙厚厘米" type="number" min="0.1" max="200" step="0.1" value={wallThicknessMm / 10} onChange={event => change(() => setWallThicknessMm(Math.round(Number(event.target.value) * 10)))}/></label>
        <label>生成种子<input aria-label="室内生成种子" value={seed} maxLength={128} onChange={event => change(() => setSeed(event.target.value))}/></label>
        <h3>房间 · {rooms.length}</h3>
        {rooms.map((room, index) => <fieldset className="interior-room-requirement" key={room.id}>
          <legend>房间 {index + 1}</legend>
          <label>用途<input aria-label={`房间${index + 1}用途`} value={room.purpose} maxLength={120} onChange={event => updateRoom(room.id, { purpose: event.target.value })}/></label>
          <div className="interior-field-pair">
            <label>最小净面积（平方米）<input aria-label={`房间${index + 1}最小面积`} type="number" min="0.1" step="0.1" value={room.minAreaMm2 / 1_000_000} onChange={event => updateRoom(room.id, { minAreaMm2: squareMm(event.target.value) })}/></label>
            <label>最大净面积（平方米）<input aria-label={`房间${index + 1}最大面积`} type="number" min="0.1" step="0.1" value={room.maxAreaMm2 / 1_000_000} onChange={event => updateRoom(room.id, { maxAreaMm2: squareMm(event.target.value) })}/></label>
          </div>
          <label>最小净边长（米）<input aria-label={`房间${index + 1}最小净边长`} type="number" min="0.1" step="0.1" value={room.minClearSideMm / 1000} onChange={event => updateRoom(room.id, { minClearSideMm: mm(event.target.value) })}/></label>
          <button className="secondary" type="button" disabled={rooms.length <= 1} onClick={() => change(() => { setRooms(current => current.filter(item => item.id !== room.id)); setRelations(current => current.filter(item => item.a !== room.id && item.b !== room.id)) })}>移除房间 {index + 1}</button>
        </fieldset>)}
        <button className="secondary asset-wide" type="button" disabled={rooms.length >= 24} onClick={() => change(() => { const id = `room-${nextRoom.current++}`; setRooms(current => [...current, { id, purpose: `房间 ${current.length + 1}`, minAreaMm2: 8_000_000, maxAreaMm2: 80_000_000, minClearSideMm: 2000 }]) })}>增加房间</button>
        <h3>房间关系</h3>
        {!relations.length && <p className="asset-muted">未指定关系时，按面积与净边长安排。</p>}
        {relations.map((relation, index) => <fieldset key={index} className="interior-room-requirement"><legend>关系 {index + 1}</legend>
          <label>房间<select aria-label={`关系${index + 1}房间一`} value={relation.a} onChange={event => updateRelation(index, { a: event.target.value })}>{rooms.map((room, at) => <option key={room.id} value={room.id}>{at + 1} · {room.purpose}</option>)}</select></label>
          <label>与<select aria-label={`关系${index + 1}房间二`} value={relation.b} onChange={event => updateRelation(index, { b: event.target.value })}>{rooms.map((room, at) => <option key={room.id} value={room.id}>{at + 1} · {room.purpose}</option>)}</select></label>
          <label>要求<select aria-label={`关系${index + 1}要求`} value={relation.kind} onChange={event => updateRelation(index, { kind: event.target.value as InteriorLayoutParameters['relations'][number]['kind'] })}><option value="adjacent">必须共墙相邻</option><option value="separate">不得直接相邻</option><option value="no-direct-connection">不安排两房间之间的门</option></select></label>
          {relation.kind === 'adjacent' && <label>最小共墙长度（米）<input aria-label={`关系${index + 1}共墙长度`} type="number" min="0.1" step="0.1" value={relation.minimumSharedWallMm / 1000} onChange={event => updateRelation(index, { minimumSharedWallMm: mm(event.target.value) })}/></label>}
          <button className="secondary" type="button" onClick={() => change(() => setRelations(current => current.filter((_, at) => at !== index)))}>移除关系 {index + 1}</button>
        </fieldset>)}
        <button className="secondary asset-wide" type="button" disabled={rooms.length < 2 || relations.length >= 256} onClick={() => change(() => setRelations(current => [...current, { a: rooms[0].id, b: rooms[1].id, kind: 'adjacent', minimumSharedWallMm: 1000 }]))}>增加房间关系</button>
        <label>走廊<select aria-label="室内走廊方向" value={corridor.axis} onChange={event => change(() => setCorridor(current => ({ ...current, axis: event.target.value as InteriorLayoutParameters['corridor']['axis'] })))}><option value="none">不单独安排走廊</option><option value="horizontal">横向走廊</option><option value="vertical">纵向走廊</option></select></label>
        {corridor.axis !== 'none' && <label>走廊净宽（米）<input aria-label="室内走廊净宽米" type="number" min="0.1" step="0.1" value={corridor.clearWidthMm / 1000} onChange={event => change(() => setCorridor(current => ({ ...current, clearWidthMm: mm(event.target.value) })))}/></label>}
        <fieldset className="interior-arrangement"><legend>首次布置建议</legend>
          <label><input aria-label="自动安排房间门" type="checkbox" checked={arrangement.doors} onChange={event => change(() => setArrangement(current => ({ ...current, doors: event.target.checked })))}/>安排房间之间的门</label>
          <label><input aria-label="自动安排建筑入口" type="checkbox" checked={arrangement.entrance} onChange={event => change(() => setArrangement(current => ({ ...current, entrance: event.target.checked })))}/>安排一个对外入口</label>
          <label><input aria-label="自动安排用途家具" type="checkbox" checked={arrangement.furniture} onChange={event => change(() => setArrangement(current => ({ ...current, furniture: event.target.checked })))}/>按用途和空间安排家具</label>
          <label>建议门宽（米）<input aria-label="室内建议门宽米" type="number" min="0.1" max="5" step="0.1" value={arrangement.doorWidthMm / 1000} onChange={event => change(() => setArrangement(current => ({ ...current, doorWidthMm: mm(event.target.value) })))}/></label>
          <label>建议通路净宽（米）<input aria-label="室内建议通路净宽米" type="number" min="0.1" max="5" step="0.1" value={arrangement.clearWidthMm / 1000} onChange={event => change(() => setArrangement(current => ({ ...current, clearWidthMm: mm(event.target.value) })))}/></label>
          <p className="asset-muted">空间不足时保留合法布局并列出未完成建议。生成后的编辑不会强制维持这些建议。</p>
        </fieldset>
        {!candidate && validationReason && <p id={validationId} className="asset-form-error" role="status">{validationReason}</p>}
        <button className="primary asset-wide" type="submit" disabled={!valid} aria-describedby={!candidate && validationReason ? validationId : undefined}>{busy ? '正在准备室内布局…' : '预览室内布局'}</button>
      </fieldset>
    </form>
    {error && <><p className="asset-error" role="alert">{error}</p><p className="asset-muted">请按提示修改参数后重新预览，或选择「取消室内布局」返回当前工程。</p></>}
    {candidate && <div className="interior-candidate" aria-label="室内布局候选摘要"><h3>候选 · {candidate.layout.rooms.length} 个房间</h3>
      <p>{candidate.layout.corridors.length ? '包含独立走廊。' : ''}画布展示完整候选，当前工程尚未改变。</p>
      <ul>{candidate.layout.rooms.map(room => <li key={room.requirementId}>{candidate.input.parameters.rooms.find(item => item.id === room.requirementId)?.purpose ?? '房间'} · 净面积 {(room.clearAreaMm2 / 1_000_000).toFixed(1)} 平方米</li>)}</ul>
      <p aria-label="室内首次布置结果">实际安排 {Object.keys(candidate.project.document.openings).length} 扇门、{Object.keys(candidate.project.document.props).length} 件家具；{candidate.report.connectivity.routes.filter(route => route.status === 'clear').length}/{candidate.report.connectivity.routes.length} 条建议通路通过净空检查。</p>
      {candidate.report.notes.length > 0 && <div aria-label="室内未完成建议"><h3>布置说明</h3><ul>{candidate.report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
      <p className="asset-muted">门、家具及通路检查反映本次生成结果。保存后可继续删改，系统不会自动恢复被删除的内容。</p>
      <button className="primary asset-wide" disabled={busy || disabled} onClick={() => void onAdopt()}>保存为新工程</button>
    </div>}
    {(dirty || busy || candidate) && <button className="secondary asset-wide" disabled={disabled} onClick={onCancel}>取消室内布局</button>}
  </section>
}
