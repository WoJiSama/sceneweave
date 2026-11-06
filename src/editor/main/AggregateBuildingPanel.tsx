import { useEffect, useMemo, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import { buildingAggregateMembers, inspectAggregateBuilding } from '../../shared/commands/building'
import type { SceneDocument } from '../../shared/model/scene'
import { normalizeSelection } from '../native-canvas/selection'
import { NumberInput } from '../native-canvas/controls'
import { createEntityLabeler } from './entity-label'
import { newId } from './runtime'

type Props = {
  scene: SceneDocument
  disabled: boolean
  onPreview: (commands: SceneCommand[], description: string) => void
  onSelect: (id: string) => void
  onSelectMany?: (ids: string[]) => void
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

export default function AggregateBuildingPanel({ scene, disabled, onPreview, onSelect, onSelectMany }: Props) {
  const rooms = Object.values(scene.rooms)
  const [roomId, setRoomId] = useState(''), [groupId, setGroupId] = useState('')
  const [offset, setOffset] = useState({ x: 0, y: 0 }), [pivot, setPivot] = useState({ x: 0, y: 0 })
  const [quarterTurns, setQuarterTurns] = useState<0 | 1 | 2 | 3>(0), [error, setError] = useState<string | null>(null)
  const selectedRoomId = scene.rooms[roomId] ? roomId : rooms[0]?.id ?? ''
  const label = useMemo(() => createEntityLabeler(scene), [scene])
  const groups = useMemo(() => Object.values(scene.aggregateCoordinates?.groups ?? {}).map((group, index) => {
    const room = group.members.find(member => member.kind === 'room')
    const name = `${room ? label(room.id) : '建筑'} · 建筑组 ${index + 1}`
    try { return { id: group.id, name, info: inspectAggregateBuilding(scene, group.id), reason: null } }
    catch (cause) { return { id: group.id, name, info: null, reason: message(cause) } }
  }), [scene, label])
  const supported = groups.filter(group => group.info !== null)
  const current = supported.find(group => group.id === groupId) ?? supported[0]
  const frame = current?.info?.frame
  useEffect(() => {
    setOffset({ x: 0, y: 0 }); setQuarterTurns(0); setError(null)
    setPivot({ x: frame?.translationMm.x ?? 0, y: frame?.translationMm.y ?? 0 })
  }, [scene.sceneId, current?.id, frame?.translationMm.x, frame?.translationMm.y, frame?.quarterTurns])
  const creation = useMemo(() => {
    if (!selectedRoomId) return { members: null, reason: null }
    try {
      const members = buildingAggregateMembers(scene, selectedRoomId)
      const occupied = new Set(Object.values(scene.aggregateCoordinates?.groups ?? {}).flatMap(group => group.members.map(member => `${member.kind}:${member.id}`)))
      if (members.some(member => occupied.has(`${member.kind}:${member.id}`))) {
        return { members: null, reason: '这栋建筑已有对象归入建筑组，请从下方选择现有建筑组。' }
      }
      return { members, reason: null }
    } catch (cause) { return { members: null, reason: message(cause) } }
  }, [scene, selectedRoomId])
  const createGroup = () => {
    if (disabled || !creation.members || !selectedRoomId) return
    try {
      const room = scene.rooms[selectedRoomId]
      const firstVertexId = creation.members.find(member => member.kind === 'vertex')?.id ?? room.boundaryVertexIds[0]
      const vertex = scene.vertices[firstVertexId]
      setError(null)
      onPreview([{ type: 'createAggregateGroup', group: { id: newId(), floorId: room.floorId, parentId: null,
        frame: { translationMm: { x: vertex?.xMm ?? 0, y: vertex?.yMm ?? 0 }, quarterTurns: 0 },
        members: creation.members, editLocked: false } }], `创建建筑组 · ${label(room.id)}`)
    } catch (cause) { setError(message(cause)) }
  }
  const previewTransform = () => {
    if (disabled || !current?.info || offset.x === 0 && offset.y === 0 && quarterTurns === 0) return
    try {
      // Recheck the exact current group before entering the normal candidate
      // pipeline. Preview remains responsible for locks and complete geometry.
      inspectAggregateBuilding(scene, current.id)
      setError(null)
      onPreview([{ type: 'transformAggregateBuilding', id: current.id, offsetMm: { ...offset }, pivotMm: { ...pivot }, quarterTurns }],
        `整栋建筑变换 · ${current.name}`)
    } catch (cause) { setError(message(cause)) }
  }
  return <details className="building-details" aria-label="建筑组工具">
    <summary>建筑组</summary>
    <p className="asset-muted">把相连房间和随建筑移动的对象组成整栋。可整体移动，也可进入内部继续编辑；每次变换先预览，再确认采用。</p>
    <fieldset disabled={disabled}>
      {rooms.length ? <>
        <label className="building-field">从房间创建整栋<select aria-label="创建建筑组的房间" value={selectedRoomId} onChange={event => { setRoomId(event.target.value); setError(null) }}>{rooms.map(room => <option key={room.id} value={room.id}>{label(room.id)}</option>)}</select></label>
        <button className="secondary asset-wide" type="button" aria-label="创建建筑组" disabled={!creation.members} onClick={createGroup}>创建建筑组</button>
        {creation.reason && <p className="history-limit">{creation.reason}</p>}
      </> : <p className="asset-muted">先创建房间，再把整栋建筑组成建筑组。</p>}
      {supported.length ? <>
        <label className="building-field">当前建筑组<select data-aggregate-session-control aria-label="建筑组" value={current!.id} onChange={event => { setGroupId(event.target.value); setError(null) }}>{supported.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <p className="asset-muted">整栋包含 {current!.info!.members.length} 个对象。</p>
        <button className="secondary asset-wide" type="button" disabled={!onSelectMany} onClick={() => onSelectMany?.(normalizeSelection(scene, current!.info!.members.map(member => member.id), true))}>选择整栋</button>
        <details className="building-details"><summary>进入内部</summary><div className="building-entity-list" aria-label="建筑组内部对象">{current!.info!.members.map(member => <button type="button" key={`${member.kind}:${member.id}`} onClick={() => onSelect(member.id)}>{label(member.id)}</button>)}</div></details>
        <div className="building-coordinate-grid">
          <NumberInput displayUnit={scene.units.display} label="整栋偏移 X" value={offset.x} onCommit={x => setOffset(value => ({ ...value, x }))}/>
          <NumberInput displayUnit={scene.units.display} label="整栋偏移 Y" value={offset.y} onCommit={y => setOffset(value => ({ ...value, y }))}/>
        </div>
        <label className="building-field">整栋旋转<select aria-label="整栋旋转" value={quarterTurns} onChange={event => setQuarterTurns(Number(event.target.value) as typeof quarterTurns)}><option value="0">不旋转</option><option value="1">顺时针 90°</option><option value="2">180°</option><option value="3">逆时针 90°</option></select></label>
        <NumberInput displayUnit={scene.units.display} label="整栋旋转支点 X" value={pivot.x} onCommit={x => setPivot(value => ({ ...value, x }))}/>
        <NumberInput displayUnit={scene.units.display} label="整栋旋转支点 Y" value={pivot.y} onCommit={y => setPivot(value => ({ ...value, y }))}/>
        <button className="primary asset-wide" type="button" aria-label="预览整栋变换" disabled={offset.x === 0 && offset.y === 0 && quarterTurns === 0} onClick={previewTransform}>预览整栋变换</button>
      </> : <p className="asset-muted">暂无可整体变换的建筑组。创建后即可在这里选择。</p>}
    </fieldset>
    {groups.some(group => group.reason) && <details className="building-details"><summary>其他组的使用范围</summary>{groups.filter(group => group.reason).map(group => <p className="history-limit" key={group.id}>{group.name}：{group.reason}</p>)}</details>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </details>
}
