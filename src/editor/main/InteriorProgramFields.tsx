import { useRef } from 'react'
import { DEFAULT_INTERIOR_CORRIDOR_ID, INTERIOR_FURNITURE_ROLE_LIMIT, INTERIOR_SEATS_PER_GROUP,
  type InteriorLayoutParameters, type InteriorProgram, type InteriorSide } from '../../shared/generation/domains/interior/contracts'

type RoomChoice = { id: string; purpose: string }
const directions: Record<InteriorSide, string> = { north: '北侧', east: '东侧', south: '南侧', west: '西侧' }
const maxGroups = Math.floor((INTERIOR_FURNITURE_ROLE_LIMIT - 1) / (INTERIOR_SEATS_PER_GROUP + 1))
const widthField = (text: string) => text ? Math.round(Number(text) * 1000) : undefined
const roomOptions = (rooms: readonly RoomChoice[]) => rooms.map(room => <option key={room.id} value={room.id}>{room.purpose || room.id}</option>)

export default function InteriorProgramFields({ rooms, corridor, value, onChange }: {
  rooms: readonly RoomChoice[]; corridor: InteriorLayoutParameters['corridor']; value: InteriorProgram; onChange: (next: InteriorProgram) => void
}) {
  const nextDoor = useRef(1)
  const spaces = corridor.axis === 'none' ? rooms : [...rooms, { id: DEFAULT_INTERIOR_CORRIDOR_ID, purpose: '走廊' }]
  const entrances = value.entrances ?? [], doors = value.connections ?? [], furnishings = value.furnishings ?? []
  const updateEntry = (id: string, patch: Partial<(typeof entrances)[number]>) => onChange({ ...value, entrances: entrances.map(row => row.id === id ? { ...row, ...patch } : row) })
  const updateDoor = (index: number, patch: Partial<(typeof doors)[number]>) => onChange({ ...value, connections: doors.map((row, at) => at === index ? { ...row, ...patch } : row) })
  const updateFurniture = (roomId: string, patch: Partial<(typeof furnishings)[number]>) => {
    const next = { ...furnishings.find(row => row.roomId === roomId), roomId, ...patch }
    onChange({ ...value, furnishings: [...furnishings.filter(row => row.roomId !== roomId), ...(next.seatingGroups || next.counterNextTo ? [next] : [])] })
  }
  return <details className="interior-settings interior-program"><summary>指定外门、内门与家具组</summary>
    <h3>对外入口</h3>
    {entrances.map((row, index) => <fieldset key={row.id} className="interior-room-requirement"><legend>外门 {index + 1}</legend>
      <div className="interior-field-pair">
        <label>通向<select aria-label={`外门${index + 1}房间`} value={row.roomId} onChange={event => updateEntry(row.id, { roomId: event.target.value })}>{roomOptions(spaces)}</select></label>
        <label>用途<select aria-label={`外门${index + 1}用途`} value={row.role} onChange={event => updateEntry(row.id, { role: event.target.value === 'main' ? 'main' : 'service' })}><option value="main">主入口</option><option value="service">辅助入口</option></select></label>
        <label>图面朝向<select aria-label={`外门${index + 1}朝向`} value={row.side ?? ''} onChange={event => updateEntry(row.id, { side: (event.target.value || undefined) as InteriorSide | undefined })}><option value="">自动选择</option>{Object.entries(directions).map(([side, label]) => <option key={side} value={side}>{label}</option>)}</select></label>
        <label>门洞净宽（米）<input aria-label={`外门${index + 1}净宽`} type="number" step="0.1" min="0.1" max="5" placeholder="按建议门宽" value={row.widthMm === undefined ? '' : row.widthMm / 1000} onChange={event => updateEntry(row.id, { widthMm: widthField(event.target.value) })}/></label>
      </div>
      <button type="button" className="secondary" onClick={() => onChange({ ...value, entrances: entrances.filter(item => item.id !== row.id) })}>移除外门 {index + 1}</button>
    </fieldset>)}
    <button type="button" className="secondary asset-wide" disabled={entrances.length >= 24} onClick={() => {
      const id = `entry-${nextDoor.current++}`
      onChange({ ...value, entrances: [...entrances, { id, roomId: spaces[0].id, role: entrances.length ? 'service' : 'main' }] })
    }}>增加外门</button>
    <h3>房间之间的门</h3>
    <p>指定连接后，会按这里列出的空间对开内门。需要经走廊进入的房间请选择走廊。</p>
    {doors.map((row, index) => <fieldset key={index} className="interior-room-requirement"><legend>内门 {index + 1}</legend>
      <div className="interior-field-pair">
        <label>一侧<select aria-label={`内门${index + 1}一侧`} value={row.a} onChange={event => updateDoor(index, { a: event.target.value })}>{roomOptions(spaces)}</select></label>
        <label>另一侧<select aria-label={`内门${index + 1}另一侧`} value={row.b} onChange={event => updateDoor(index, { b: event.target.value })}>{roomOptions(spaces)}</select></label>
      </div>
      <label>门洞净宽（米）<input aria-label={`内门${index + 1}净宽`} type="number" step="0.1" min="0.1" max="5" placeholder="按建议门宽" value={row.widthMm === undefined ? '' : row.widthMm / 1000} onChange={event => updateDoor(index, { widthMm: widthField(event.target.value) })}/></label>
      <button type="button" className="secondary" onClick={() => onChange({ ...value, connections: doors.filter((_, at) => at !== index) })}>移除内门 {index + 1}</button>
    </fieldset>)}
    <button type="button" className="secondary asset-wide" disabled={spaces.length < 2 || doors.length >= Math.min(256, spaces.length * (spaces.length - 1) / 2)} onClick={() => {
      const pair = spaces.flatMap((a, i) => spaces.slice(i + 1).map(b => ({ a: a.id, b: b.id })))
        .find(pair => !doors.some(row => row.a === pair.a && row.b === pair.b || row.b === pair.a && row.a === pair.b))
      if (pair) onChange({ ...value, connections: [...doors, pair] })
    }}>增加内门</button>
    <h3>家具组</h3>
    <p>每组桌椅包含一张桌子和 {INTERIOR_SEATS_PER_GROUP} 把椅子。桌椅之间会按设定净宽留通路。</p>
    {rooms.map(room => {
      const row = furnishings.find(item => item.roomId === room.id)
      return <div className="interior-field-pair" key={room.id}>
        <label>{room.purpose || room.id}桌椅组数<input type="number" min="0" max={maxGroups} step="1" value={row?.seatingGroups ?? 0}
          onChange={event => updateFurniture(room.id, { seatingGroups: Number(event.target.value) || undefined })}/></label>
        <label>服务台靠哪间房<select aria-label={`${room.purpose || room.id}服务台邻房`} value={row?.counterNextTo ?? ''}
          onChange={event => updateFurniture(room.id, { counterNextTo: event.target.value || undefined })}><option value="">不指定服务台</option>{roomOptions(rooms.filter(item => item.id !== room.id))}</select></label>
      </div>
    })}
    <label><span><input type="checkbox" checked={!!value.roomLabels} onChange={event => onChange({ ...value, roomLabels: event.target.checked })}/> 添加可编辑房间标注</span></label>
    <label><span><input type="checkbox" checked={value.exteriorWindows ?? !!(entrances.length || doors.length || furnishings.length || value.roomLabels)}
      onChange={event => onChange({ ...value, exteriorWindows: event.target.checked })}/> 自动安排外墙窗户</span></label>
  </details>
}
