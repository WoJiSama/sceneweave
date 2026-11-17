import { useState } from 'react'
import type { PointMm, SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { floorEntrances } from '../../shared/floors/links'
import { NumberInput } from '../native-canvas/controls'

export default function FloorLinks({ scene, floorId, disabled, onPreview, onNavigate, onDraftChange }: {
  scene: SceneDocument; floorId: string; disabled: boolean
  onPreview: (commands: SceneCommand[], label: string) => void
  onNavigate: (floorId: string, positionMm: PointMm) => void; onDraftChange: () => void
}) {
  const floor = scene.floors[floorId], others = Object.values(scene.floors).filter(row => row.id !== floorId)
  const [name, setName] = useState('楼梯入口'), [target, setTarget] = useState(others[0]?.id ?? '')
  const [from, setFrom] = useState<PointMm>({ x: floor.boundsMm.x + Math.round(floor.boundsMm.width / 2), y: floor.boundsMm.y + Math.round(floor.boundsMm.height / 2) })
  const [to, setTo] = useState<PointMm>(from), [aligned, setAligned] = useState(true)
  if (!others.length) return null
  return <details className="workspace-advanced" aria-label="楼层入口关联"><summary>楼层入口与定位</summary>
    <p className="asset-muted">入口双向关联两层坐标；同坐标对齐适合楼梯和船舱。此关联用于主持人编辑导航，实际通行与公开标记由地图内容另行设置。</p>
    {floorEntrances(scene, floorId).map(row => <div key={`${row.ownerFloorId}-${row.link.id}`} className="workspace-floor-link">
      <strong>{row.link.name}</strong><p className="asset-muted">({row.positionMm.x}, {row.positionMm.y}) → {scene.floors[row.targetFloorId].name} ({row.targetMm.x}, {row.targetMm.y}) mm</p>
      <button className="secondary" disabled={disabled} onClick={() => onNavigate(floorId, row.positionMm)}>定位本层入口 {row.link.name}</button>
      <button className="secondary" disabled={disabled} onClick={() => onNavigate(row.targetFloorId, row.targetMm)}>前往 {scene.floors[row.targetFloorId].name} · {row.link.name}</button>
      <button className="secondary" disabled={disabled} onClick={() => onPreview([{ type: 'setFloorLinks', id: row.ownerFloorId, links: scene.floors[row.ownerFloorId].links!.filter(link => link.id !== row.link.id) }], `移除双向入口 · ${row.link.name}`)}>移除入口 {row.link.name}</button>
    </div>)}
    <fieldset disabled={disabled} onChangeCapture={onDraftChange}>
      <label>入口名称<input aria-label="入口名称" value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
      <label>入口目标楼层<select aria-label="入口目标楼层" value={target} onChange={event => setTarget(event.target.value)}>{others.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {(['x', 'y'] as const).map(axis => <NumberInput key={axis} label={`本层入口${axis.toUpperCase()}`} value={from[axis]} onCommit={value => setFrom(current => ({ ...current, [axis]: value }))}/>)}
      <label><input type="checkbox" aria-label="入口使用同一世界坐标" checked={aligned} onChange={event => setAligned(event.target.checked)}/>两层使用同一世界坐标</label>
      {!aligned && (['x', 'y'] as const).map(axis => <NumberInput key={axis} label={`目标入口${axis.toUpperCase()}`} value={to[axis]} onCommit={value => setTo(current => ({ ...current, [axis]: value }))}/>)}
      <button className="primary asset-wide" disabled={!name.trim() || !target} onClick={() => onPreview([{ type: 'setFloorLinks', id: floorId, links: [...(floor.links ?? []), { id: crypto.randomUUID(), name: name.trim(), targetFloorId: target, fromMm: from, toMm: aligned ? from : to }] }], `关联双向楼层入口 · ${name.trim()}`)}>预览关联楼层入口</button>
    </fieldset>
  </details>
}
