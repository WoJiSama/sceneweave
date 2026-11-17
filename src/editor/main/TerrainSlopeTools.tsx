import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import type { TerrainInlayFinish } from '../../shared/terrain-inlay/persistence'
import { createTerrainSlopeCommand } from '../../shared/terrain-inlay/slope'
import { terrainInlayHash } from '../../shared/terrain-inlay/scene'
import { cloneJson } from '../../shared/validation/json'

export default function TerrainSlopeTools({ scene, id, disabled, onPreview }: {
  scene: SceneDocument; id: string; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void
}) {
  const connection = scene.terrainConnections[id], existing = connection?.terrainInlay
  const [left, setLeft] = useState('1000'), [right, setRight] = useState('1000')
  const [kind, setKind] = useState<'slope' | 'steps'>(existing?.finish?.kind ?? 'slope')
  const [depth, setDepth] = useState(String(existing?.finish?.kind === 'steps' ? existing.finish.treadDepthMm : 350))
  const [error, setError] = useState<string | null>(null)
  if (!connection || connection.carvedStrip || connection.from.surfaceRef.kind !== 'terrainArea' || connection.to.surfaceRef.kind !== 'terrainArea') return null
  const finish = (): TerrainInlayFinish => kind === 'slope' ? { kind } : { kind, treadDepthMm: Number(depth) }
  const attempt = (action: () => void) => { try { setError(null); action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  return <fieldset disabled={disabled} data-terrain-slope-tools>
    <legend>坡体与表面</legend>
    <p className="asset-muted">用完整坡体连接两端平台，再在坡内保留原路线和净宽。两侧坡面参与真实填挖；可行走范围仍以原路线为准。</p>
    <label>表面<select aria-label="坡体表面" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="slope">平顺山径</option><option value="steps">石质踏步</option></select></label>
    {kind === 'steps' && <><label>踏步间距（毫米）<input type="number" min="50" max="2000" value={depth} onChange={event => setDepth(event.target.value)}/></label>
      <p className="asset-muted">踏步表现铺在连续坡面上，通行和承托仍按实际坡体计算。</p></>}
    {existing && <button className="secondary asset-wide" onClick={() => attempt(() => onPreview([
      { type: 'setTerrainInlayFinish', id, finish: finish(), expectedConnectionHash: terrainInlayHash(connection) },
    ], kind === 'slope' ? '坡体表面改为平顺山径' : '在坡体上铺设石质踏步'))}>预览坡面表面</button>}
    <label>路线左侧坡体延伸（毫米）<input type="number" min="1" max="20000" value={left} onChange={event => setLeft(event.target.value)}/></label>
    <label>路线右侧坡体延伸（毫米）<input type="number" min="1" max="20000" value={right} onChange={event => setRight(event.target.value)}/></label>
    {existing && <p className="asset-muted">重建将替换当前坡体的人工形状；原连接和源地形保留，可取消或整笔撤销。</p>}
    <button className="secondary asset-wide" onClick={() => attempt(() => {
      const commands: SceneCommand[] = [], sourceScene = existing ? cloneJson(scene) : scene
      if (existing) {
        sourceScene.terrainConnections[id] = { ...cloneJson(existing.originalConnection), editLocked: connection.editLocked,
          visibility: connection.visibility, blocksMovement: connection.blocksMovement, movementCostMultiplier: connection.movementCostMultiplier, surfaceStyle: connection.surfaceStyle }
        commands.push({ type: 'restoreTerrainInlaySource', id, disposition: 'restore-original-connection-and-ground' })
      }
      const command = createTerrainSlopeCommand(sourceScene, id, { bankWidthMm: { left: Number(left), right: Number(right) } })
      commands.push({ ...command, appearance: 'source-ground', finish: finish() })
      onPreview(commands, '完整坡体连接两端平台，保留原路线净宽，坡面沿用周围地表')
    })}>{existing ? '预览重建完整坡体' : '预览完整坡体'}</button>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </fieldset>
}
