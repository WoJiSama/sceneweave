import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands.js'
import type { BoundsMm, SceneDocument } from '../../shared/model/scene.js'
import { NumberInput } from '../native-canvas/controls.js'
import { PlayerCoverageError } from '../../shared/projection/projection.js'
import PrivacyCoverageNotice from './PrivacyCoverageNotice.js'

type MaskEdit = BoundsMm & { preservePublicRooms: boolean }
export default function PrivacyMaskReviewControls({ scene, floorId, commands, disabled, onDraftChange, onRecheck }: {
  scene: SceneDocument; floorId: string; commands: readonly SceneCommand[]; disabled: boolean
  onDraftChange: (dirty: boolean) => void; onRecheck: (commands: SceneCommand[], onFailure: (error: unknown) => void) => void
}) {
  const [edits, setEdits] = useState<Record<string, MaskEdit>>({}), [error, setError] = useState<unknown>(null)
  const masks = Object.values(scene.regions).filter(region => region.kind === 'manualMask' && region.floorId === floorId)
  if (!masks.length) return null
  const bounds = (id: string): MaskEdit => {
    if (edits[id]) return edits[id]
    const mask = scene.regions[id], xs = mask.boundaryMm.map(p => p.x), ys = mask.boundaryMm.map(p => p.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), preservePublicRooms: mask.preservePublicRooms ?? false }
  }
  const edit = (id: string, changes: Partial<MaskEdit>) => { setEdits(current => ({ ...current, [id]: { ...bounds(id), ...changes } })); setError(null); onDraftChange(true) }
  const recheck = () => {
    const ids = new Set(Object.keys(edits)), next = commands.filter(command => command.type !== 'upsertManualMask' || !ids.has(command.id))
    for (const id of ids) {
      const { preservePublicRooms, ...boundsMm } = edits[id]
      next.push({ type: 'upsertManualMask', id, floorId, layerId: scene.entityLayers[id], boundsMm, preservePublicRooms })
    }
    setError(null); onRecheck(next, setError)
  }
  return <section className="building-details" aria-label="候选遮罩调整">
    <h3>在候选中调整遮罩</h3>
    <p className="asset-muted">保留公开房间会使用玩家可见房间的真实内轮廓；秘密内容和完整覆盖继续校验。修改后重检会更新两张实际预览，采用仍为一次编辑。</p>
    <fieldset disabled={disabled}>
      {masks.map((mask, index) => <details key={mask.id} open={index === 0}><summary>遮罩 {index + 1}{mask.editLocked || scene.userLayers[scene.entityLayers[mask.id]]?.editLocked ? ' · 已锁定' : ''}</summary>
        <label className="building-check"><input type="checkbox" aria-label={`遮罩 ${index + 1} 保留公开房间`} checked={bounds(mask.id).preservePublicRooms} onChange={event => edit(mask.id, { preservePublicRooms: event.target.checked })}/>保留相邻公开房间的玩家画面</label>
        <div className="workspace-field-pair">{(['x', 'y', 'width', 'height'] as const).map((key, field) => <NumberInput key={key} displayUnit={scene.units.display} label={`候选遮罩 ${index + 1} ${['X', 'Y', '宽度', '高度'][field]}`} value={bounds(mask.id)[key]} onCommit={value => edit(mask.id, { [key]: value })}/>)}</div>
      </details>)}
      {Object.keys(edits).length > 0 && <p role="status">以下预览仍是上一次通过的候选。请更新并重检，当前调整尚未写入工程。</p>}
      <button type="button" className="secondary asset-wide" disabled={!Object.keys(edits).length} onClick={recheck}>更新遮罩并重检</button>
    </fieldset>
    {error instanceof PlayerCoverageError ? <PrivacyCoverageNotice scene={scene} issues={error.issues}/> : error ? <p role="alert">重检失败：{error instanceof Error ? error.message : String(error)}。输入和上一份候选均已保留。</p> : null}
  </section>
}
