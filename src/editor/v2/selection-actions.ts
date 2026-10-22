import { roundMmV2 } from '../../core/v2/commands'
import { orderedPropsV2 } from '../../render/v2/projection'
import type { SceneCommandV2 } from '../../core/v2/commands'
import type { PointMm, SceneDocumentV2 } from '../../core/v2/types'
import { effectiveEditLockedV2, normalizeSelectionV2, selectionGeometryV2 } from './selection'

export type SelectionActionV2 = 'move' | 'rotate' | 'delete' | 'copy' | 'lock' | 'unlock'
export function selectionActionReasonV2(scene: SceneDocumentV2, ids: readonly string[], action: SelectionActionV2): string | null {
  if (!ids.length) return '请先选择对象。'
  if (ids.length > 256) return '一次事务最多 256 条命令，请缩小选择范围。'
  const targets = normalizeSelectionV2(scene, [...ids], true)
  if (targets.length !== ids.length) return '选择已失效，请重新选择。'
  for (const id of targets) {
    const prop = scene.props[id], prefab = scene.prefabInstances[id]
    if (action === 'lock' || action === 'unlock') {
      if (!prop && !prefab && !scene.scatterGroups[id] && !scene.terrainAreas[id] && !scene.terrainConnections[id]) return '此选择包含尚不支持批量锁定的结构类型。'
      if (prop && prop.editLocked !== (action === 'lock') && [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].some(parent => parent.editLocked && Object.values(parent.members).some(member => member.propId === id))) return '物件受组合或散布锁定，请选择其容器调整编辑锁。'
      continue
    }
    if (!prop && !(prefab && (action === 'move' || action === 'rotate'))) return '此操作只支持物件；组合可整体移动和旋转，删除或复制前请先拆开。结构请使用专用属性工具。'
    if (effectiveEditLockedV2(scene, id)) return '选择含锁定对象或锁定成员，请先解除对应编辑锁。'
    if (prop && action === 'copy' && (Object.values(scene.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id)) || Object.values(scene.scatterGroups).some(group => Object.values(group.members).some(member => member.propId === id)))) return '复制只支持独立物件，请先拆开组合或退出散布。'
  }
  return null
}
const degrees = (value: number) => ((value % 360) + 360) % 360
export function selectionCommandsV2(scene: SceneDocumentV2, ids: readonly string[], action: SelectionActionV2, values: { dx?: number; dy?: number; angle?: number } = {}): SceneCommandV2[] {
  const reason = selectionActionReasonV2(scene, ids, action)
  if (reason) throw new Error(reason)
  const dx = values.dx ?? 0, dy = values.dy ?? 0, angle = values.angle ?? 0
  if (![dx, dy, angle].every(Number.isFinite) || !Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) throw new Error('位移须为整数毫米，角度须为有限数值。')
  const points = action === 'rotate' ? ids.flatMap(id => selectionGeometryV2(scene, id).flat()) : []
  const center: PointMm = points.length ? { x: (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2, y: (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2 } : { x: 0, y: 0 }
  const rotate = (p: PointMm): PointMm => { const a = angle * Math.PI / 180, x = p.x - center.x, y = p.y - center.y; return { x: roundMmV2(center.x + x * Math.cos(a) - y * Math.sin(a)), y: roundMmV2(center.y + x * Math.sin(a) + y * Math.cos(a)) } }
  // Recreate bottom-to-top order so copies preserve their relative overlap.
  const orderedIds = action === 'copy' ? orderedPropsV2(ids.map(id => scene.props[id])).map(prop => prop.id) : ids
  return orderedIds.map(id => {
    const prop = scene.props[id], group = scene.prefabInstances[id]
    if (action === 'lock' || action === 'unlock') return { type: 'setEditLock', kind: prop ? 'prop' : group ? 'prefabInstance' : scene.scatterGroups[id] ? 'scatterGroup' : scene.terrainAreas[id] ? 'terrainArea' : 'terrainConnection', id, locked: action === 'lock' }
    if (action === 'delete') return { type: 'deleteProp', id }
    if (action === 'copy') return { type: 'copyProp', id, newId: crypto.randomUUID(), offsetMm: { x: 300, y: 300 } }
    if (group) return { type: 'transformPrefab', id, anchorMm: action === 'move' ? { x: group.anchorMm.x + dx, y: group.anchorMm.y + dy } : rotate(group.anchorMm), ...(action === 'rotate' ? { rotationDeg: degrees(group.rotationDeg + angle) } : {}) }
    return { type: 'updateProp', id, changes: action === 'move' ? { positionMm: { x: prop.positionMm.x + dx, y: prop.positionMm.y + dy } } : { positionMm: rotate(prop.positionMm), rotationDeg: degrees(prop.rotationDeg + angle) } }
  })
}
