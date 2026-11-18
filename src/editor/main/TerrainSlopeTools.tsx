import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { createTerrainSlopeCommand } from '../../shared/terrain-inlay/slope'
import { terrainInlayHash } from '../../shared/terrain-inlay/scene'
import { cloneJson } from '../../shared/validation/json'

export default function TerrainSlopeTools({ scene, id, disabled, onPreview }: {
  scene: SceneDocument; id: string; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const connection = scene.terrainConnections[id], existing = connection?.terrainInlay
  const [left, setLeft] = useState('1000'), [right, setRight] = useState('1000')
  const [error, setError] = useState<string | null>(null)
  if (!connection || connection.carvedStrip || connection.from.surfaceRef.kind !== 'terrainArea' || connection.to.surfaceRef.kind !== 'terrainArea') return null
  const attempt = (action: () => void) => { try { setError(null); action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  return <fieldset disabled={disabled} data-terrain-slope-tools>
    <legend>坡体与表面</legend>
    <p className="asset-muted">用完整坡体连接两端平台，再在坡内保留原路线和净宽。两侧坡面参与真实填挖；可行走范围仍以原路线为准。</p>
    <p className="asset-muted">两侧延伸为最大宽度，在入口渐收；原路线净宽保持完整。</p>
    <p className="asset-muted">需要铺设阶梯时使用上方“阶梯工具”；这里调整实际坡体及平顺山径表面。</p>
    {existing && <button className="secondary asset-wide" onClick={() => attempt(() => onPreview([
      { type: 'setTerrainInlayFinish', id, finish: { kind: 'slope' }, expectedConnectionHash: terrainInlayHash(connection) },
      ...(connection.staircase ? [{ type: 'updateTerrainConnection' as const, id, changes: { staircase: null } }] : []),
    ], '坡体表面改为平顺山径'))}>预览平顺山径表面</button>}
    <label>路线左侧坡体延伸（毫米）<input type="number" min="1" max="20000" value={left} onChange={event => setLeft(event.target.value)}/></label>
    <label>路线右侧坡体延伸（毫米）<input type="number" min="1" max="20000" value={right} onChange={event => setRight(event.target.value)}/></label>
    {existing && <p className="asset-muted">重建将替换当前坡体的人工形状；原连接和源地形保留，可取消或整笔撤销。</p>}
    <button className="secondary asset-wide" onClick={() => attempt(() => {
      const commands: SceneCommand[] = [], sourceScene = existing ? cloneJson(scene) : scene
      if (existing) {
        sourceScene.terrainConnections[id] = { ...cloneJson(existing.originalConnection), editLocked: connection.editLocked,
          visibility: connection.visibility, blocksMovement: connection.blocksMovement, movementCostMultiplier: connection.movementCostMultiplier, surfaceStyle: connection.surfaceStyle }
        delete sourceScene.terrainConnections[id].staircase
        if (connection.staircase) sourceScene.terrainConnections[id].staircase = cloneJson(connection.staircase)
        commands.push({ type: 'restoreTerrainInlaySource', id, disposition: 'restore-original-connection-and-ground' })
      }
      const command = createTerrainSlopeCommand(sourceScene, id, { bankWidthMm: { left: Number(left), right: Number(right) } })
      commands.push({ ...command, appearance: 'source-ground', finish: { kind: 'slope' } })
      onPreview(commands, '完整坡体连接两端平台，保留原路线净宽，坡面沿用周围地表')
    })}>{existing ? '预览重建完整坡体' : '预览完整坡体'}</button>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </fieldset>
}
