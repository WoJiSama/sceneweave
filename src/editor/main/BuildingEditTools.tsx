import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'

export default function BuildingEditTools({ scene, selected, onPreview }: {
  scene: SceneDocument; selected: string; onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const room = scene.rooms[selected], wall = scene.walls[selected]
  const firstVertex = scene.vertices[room?.boundaryVertexIds[0] ?? wall?.startVertexId ?? '']
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [pivot, setPivot] = useState({ x: firstVertex?.xMm ?? 0, y: firstVertex?.yMm ?? 0 })
  const [quarterTurns, setQuarterTurns] = useState<0 | 1 | 2 | 3>(0)
  const [removeOrphanWalls, setRemoveOrphanWalls] = useState(false)
  if (!room && !wall) return null
  return <>
    <details className="building-details"><summary>整栋建筑变换</summary>
      <p className="asset-muted">从当前房间或墙扩展所有共享顶点相连的墙与房间，一次平移或旋转。房间支撑物件随建筑变换；跨范围依赖无法保全时会列出原因。</p>
      <NumberInput label="建筑平移 X" value={offset.x} onCommit={x => setOffset(value => ({ ...value, x }))}/>
      <NumberInput label="建筑平移 Y" value={offset.y} onCommit={y => setOffset(value => ({ ...value, y }))}/>
      <label className="building-field">旋转<select aria-label="建筑旋转" value={quarterTurns} onChange={event => setQuarterTurns(Number(event.target.value) as typeof quarterTurns)}><option value="0">不旋转</option><option value="1">顺时针 90°</option><option value="2">180°</option><option value="3">逆时针 90°</option></select></label>
      <NumberInput label="建筑旋转中心 X" value={pivot.x} onCommit={x => setPivot(value => ({ ...value, x }))}/>
      <NumberInput label="建筑旋转中心 Y" value={pivot.y} onCommit={y => setPivot(value => ({ ...value, y }))}/>
      <button className="secondary asset-wide" disabled={offset.x === 0 && offset.y === 0 && quarterTurns === 0} onClick={() => onPreview([{ type: 'transformBuilding', id: selected, offsetMm: offset, pivotMm: pivot, quarterTurns }], '整栋建筑变换，核对共享结构及支撑依赖')}>预览整栋变换</button>
    </details>
    <details className="building-details"><summary>拓扑修复</summary>
      <p className="asset-muted">合并当前建筑中兼容的共线墙段和冗余直线顶点。保留门窗的实际位置；材质、附着或引用无法精确保全时拒绝。此操作处理当前有效工程。</p>
      <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'repairBuildingTopology', id: selected, operation: 'mergeCollinear' }], '合并共线墙与冗余顶点')}>预览合并共线墙</button>
    </details>
    <details className="building-details"><summary>删除{room ? '房间' : '墙体'}</summary>
      <p className="asset-muted">删除前检查全部引用。仍有门窗、支撑物件、路径、连接或注记时，先明确处理这些依赖再删除。共享墙继续保留给相邻房间。</p>
      {room && <label className="building-check"><input type="checkbox" aria-label="同时删除无邻室外墙" checked={removeOrphanWalls} onChange={event => setRemoveOrphanWalls(event.target.checked)}/>同时删除无邻室外墙</label>}
      <button className="history-danger asset-wide" onClick={() => onPreview([room ? { type: 'deleteRoom', id: selected, removeOrphanWalls } : { type: 'deleteWall', id: selected }], room ? '删除房间，核对保留共享墙及依赖' : '删除无引用墙体')}>预览删除{room ? '房间' : '墙体'}</button>
    </details>
  </>
}
