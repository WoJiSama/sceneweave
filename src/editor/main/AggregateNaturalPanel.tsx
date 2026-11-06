import { useEffect, useMemo, useState } from 'react'
import { AGGREGATE_DOMAIN_ADAPTERS, inspectAggregateDomain } from '../../shared/aggregates/domain-adapters'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'
import { normalizeSelection } from '../native-canvas/selection'
import { createEntityLabeler } from './entity-label'
import { newId } from './runtime'

type Props = { scene: SceneDocument; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void;
  onSelect: (id: string) => void; onSelectMany?: (ids: string[]) => void }
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

export default function AggregateNaturalPanel({ scene, disabled, onPreview, onSelect, onSelectMany }: Props) {
  const label = useMemo(() => createEntityLabeler(scene), [scene]), areas = Object.values(scene.terrainAreas)
  const [selected, setSelected] = useState<string[]>([]), [groupId, setGroupId] = useState('')
  const [offset, setOffset] = useState({ x: 0, y: 0 }), [pivot, setPivot] = useState({ x: 0, y: 0 })
  const [quarterTurns, setQuarterTurns] = useState<0 | 1 | 2 | 3>(0), [error, setError] = useState<string | null>(null)
  const areaIds = selected.filter(id => Object.hasOwn(scene.terrainAreas, id))
  const seeds = areaIds.length ? areaIds : areas.length ? [areas[0].id] : []
  const creation = useMemo(() => {
    try {
      if (!seeds.length) return { members: null, reason: null }
      const members = AGGREGATE_DOMAIN_ADAPTERS.natural.members(scene, seeds.map(id => ({ kind: 'terrainArea', id })))
      const occupied = new Set(Object.values(scene.aggregateCoordinates?.groups ?? {}).flatMap(group => group.members.map(member => `${member.kind}:${member.id}`)))
      if (members.some(member => occupied.has(`${member.kind}:${member.id}`))) return { members: null, reason: '所选地形或随动对象已归入其他组，请使用现有组，或先调整归属。' }
      return { members, reason: null }
    } catch (cause) { return { members: null, reason: message(cause) } }
  }, [scene, seeds.join('\0')])
  const groups = useMemo(() => Object.values(scene.aggregateCoordinates?.groups ?? {}).flatMap(group => {
    try { return [{ id: group.id, info: inspectAggregateDomain(scene, group.id, 'natural') }] }
    catch { return [] }
  }), [scene])
  const current = groups.find(group => group.id === groupId) ?? groups[0], frame = current?.info.frame
  useEffect(() => {
    setOffset({ x: 0, y: 0 }); setQuarterTurns(0); setError(null)
    setPivot({ x: frame?.translationMm.x ?? 0, y: frame?.translationMm.y ?? 0 })
  }, [scene.sceneId, current?.id, frame?.translationMm.x, frame?.translationMm.y, frame?.quarterTurns])
  const create = () => {
    if (disabled || !creation.members || !seeds.length) return
    const area = scene.terrainAreas[seeds[0]], point = area.boundaryMm[0].positionMm
    onPreview([{ type: 'createAggregateGroup', group: { id: newId(), floorId: area.floorId, parentId: null,
      frame: { translationMm: { ...point }, quarterTurns: 0 }, members: creation.members, editLocked: false } }], `创建自然组 · ${seeds.length} 块地形`)
  }
  const transform = () => {
    if (disabled || !current) return
    try {
      inspectAggregateDomain(scene, current.id, 'natural'); setError(null)
      onPreview([{ type: 'transformAggregateNatural', id: current.id, offsetMm: { ...offset }, pivotMm: { ...pivot }, quarterTurns }], '自然组整体变换')
    } catch (cause) { setError(message(cause)) }
  }
  return <details className="building-details" aria-label="自然组工具"><summary>自然组</summary>
    <p className="asset-muted">把地形、道路和随动对象组成整体；附着其上的建筑和人工内容也会纳入预览。每次移动先检查完整范围，再确认采用。</p>
    <fieldset disabled={disabled}>
      {areas.length ? <>
        <label className="building-field">组内地形<select multiple aria-label="自然组地形" value={seeds} onChange={event => { setSelected([...event.target.selectedOptions].map(option => option.value)); setError(null) }}>{areas.map(area => <option key={area.id} value={area.id}>{label(area.id)}</option>)}</select></label>
        <button className="secondary asset-wide" type="button" onClick={() => setSelected(areas.map(area => area.id))}>选择全部地形</button>
        <button className="secondary asset-wide" type="button" aria-label="创建自然组" disabled={!creation.members} onClick={create}>创建自然组</button>
        {creation.reason && <p className="history-limit">{creation.reason}</p>}
      </> : <p className="asset-muted">先创建或生成地形，再把相关内容组成自然组。</p>}
      {current && <>
        <label className="building-field">当前自然组<select data-aggregate-session-control aria-label="自然组" value={current.id} onChange={event => setGroupId(event.target.value)}>{groups.map((group, index) => <option key={group.id} value={group.id}>自然组 {index + 1} · {group.info.seedRefs.length} 块地形</option>)}</select></label>
        <p className="asset-muted">包含 {current.info.members.length} 个对象，{current.info.readDependencies.length} 项外部支撑。</p>
        <button className="secondary asset-wide" type="button" disabled={!onSelectMany} onClick={() => onSelectMany?.(normalizeSelection(scene, current.info.members.map(member => member.id), true))}>选择自然组</button>
        <details className="building-details"><summary>进入内部</summary><div className="building-entity-list" aria-label="自然组内部对象">{current.info.members.map(member => <button type="button" key={`${member.kind}:${member.id}`} onClick={() => onSelect(member.id)}>{label(member.id)}</button>)}</div></details>
        <div className="building-coordinate-grid"><NumberInput displayUnit={scene.units.display} label="自然组偏移 X" value={offset.x} onCommit={x => setOffset(value => ({ ...value, x }))}/><NumberInput displayUnit={scene.units.display} label="自然组偏移 Y" value={offset.y} onCommit={y => setOffset(value => ({ ...value, y }))}/></div>
        <label className="building-field">自然组旋转<select aria-label="自然组旋转" value={quarterTurns} onChange={event => setQuarterTurns(Number(event.target.value) as typeof quarterTurns)}><option value="0">不旋转</option><option value="1">顺时针 90°</option><option value="2">180°</option><option value="3">逆时针 90°</option></select></label>
        <NumberInput displayUnit={scene.units.display} label="自然组旋转支点 X" value={pivot.x} onCommit={x => setPivot(value => ({ ...value, x }))}/><NumberInput displayUnit={scene.units.display} label="自然组旋转支点 Y" value={pivot.y} onCommit={y => setPivot(value => ({ ...value, y }))}/>
        <button className="primary asset-wide" type="button" aria-label="预览自然组变换" disabled={offset.x === 0 && offset.y === 0 && quarterTurns === 0} onClick={transform}>预览自然组变换</button>
      </>}
    </fieldset>{error && <p role="alert" className="asset-form-error">{error}</p>}
  </details>
}
