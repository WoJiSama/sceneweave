import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import { floorDisplayStack } from '../../shared/floors/output'
import type { SceneDocument } from '../../shared/model/scene'

export default function FloorUnderlay({ scene, floorId, disabled, onDraftChange, onPreview }: {
  scene: SceneDocument; floorId: string; disabled: boolean
  onDraftChange: (dirty: boolean) => void
  onPreview: (commands: SceneCommand[], label: string) => void
}) {
  const floor = scene.floors[floorId]
  const [target, setTarget] = useState(floor.underlayFloorId ?? '')
  const others = Object.values(scene.floors).filter(row => row.id !== floorId)
  if (!others.length) return null
  const painted = floorDisplayStack(scene, floorId).map(row => row.name).join(' → ')
  return <details className="workspace-advanced" aria-label="楼层叠绘"><summary>楼层叠绘</summary>
    <p className="asset-muted">从下方到当前楼层按世界坐标叠绘，应用于工作台和地图 PNG。物件、通行和支撑在所属楼层编辑。</p>
    <p className="asset-muted">{painted}</p>
    <label>下方楼层<select aria-label="下方楼层" value={target} disabled={disabled} onChange={event => { setTarget(event.target.value); onDraftChange(event.target.value !== (floor.underlayFloorId ?? '')) }}>
      <option value="">单独显示当前层</option>
      {others.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>
    <button className="secondary" disabled={disabled || target === (floor.underlayFloorId ?? '')} onClick={() => onPreview([{ type: 'setFloorUnderlay', id: floorId, underlayFloorId: target || null }], '楼层叠绘')}>预览楼层叠绘</button>
  </details>
}
