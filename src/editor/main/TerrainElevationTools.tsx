import { useMemo, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'
import { formatLengthInput } from '../native-canvas/length-input'
import { createEntityLabeler } from './entity-label'
import { assertTerrainElevation, assertTerrainElevationStep, inspectTerrainElevationSelection, stepTerrainElevation,
  terrainElevationCommands, type TerrainElevationToolState } from './terrain-elevation-tools'

export interface TerrainElevationToolsProps {
  scene: SceneDocument
  selectedIds: readonly string[]
  state: TerrainElevationToolState
  disabled?: boolean
  disabledReason?: string
  onChange: (state: TerrainElevationToolState) => void
  onPreview: (commands: SceneCommand[], description: string) => void
  onCancel: () => void
}

/** Controlled session UI. Canvas supplies wheel/sample input to the same state. */
export default function TerrainElevationTools({ scene, selectedIds, state, disabled = false, disabledReason,
  onChange, onPreview, onCancel }: TerrainElevationToolsProps) {
  const selection = useMemo(() => inspectTerrainElevationSelection(scene, selectedIds), [scene, selectedIds])
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  const [error, setError] = useState<string | null>(null)
  const blocked = disabled || !!selection.reason
  const format = (value: number) => `${formatLengthInput(value, scene.units.display)} ${scene.units.display}`
  const run = (action: () => void) => {
    try { setError(null); action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const setTarget = (targetElevationMm: number) => run(() => { assertTerrainElevation(targetElevationMm); onChange({ ...state, targetElevationMm }) })
  const preview = () => run(() => {
    const commands = terrainElevationCommands(scene, selectedIds, state.targetElevationMm)
    if (!commands.length) { setError('所选地形已处于目标高程，没有需要采用的修改。'); return }
    onChange({ ...state, mode: 'idle' })
    onPreview(commands, `${selection.areaIds.length > 1 ? '平整所选整面' : '调整整面高程'} · ${format(state.targetElevationMm)}`)
  })
  const sampleFloorAvailable = scene.mapMode === 'scene' && (selection.floorId !== null ? Object.hasOwn(scene.floors, selection.floorId) : Object.keys(scene.floors).length === 1)
  return <section className="asset-section" aria-label="地形高程工具">
    <h2>地形高程</h2>
    <p className="asset-muted">调整已选地形的整面高度。取高只设置工具参数；本工具不切出局部山台，也不会自动抬升建筑或补坡。</p>
    <p className="asset-muted">整面材质及其局部材质覆盖按原世界坐标保留。带建筑、道路、布景、管理规则、曲线或显式边缘的地形仍需先处理依赖。</p>
    <div className="asset-facts" aria-label="高程操作范围">
      <p>已选 {selection.areaIds.length} 个地形面{selection.currentElevationMm !== null ? ` · 当前 ${format(selection.currentElevationMm)}` : selection.areaIds.length > 1 ? ' · 当前高程不同' : ''}。</p>
      {!!selection.areaIds.length && <details><summary>查看完整作用范围</summary><ul>{selection.areaIds.map(id => <li key={id}>{name(id)} · {id}</li>)}</ul></details>}
    </div>
    {disabled && disabledReason && <p role="status" className="asset-muted">{disabledReason}</p>}
    {selection.reason && <p role="status" className="asset-form-error">{selection.reason}</p>}
    {selection.blockers.length > 1 && <details><summary>需要处理的依赖 · {selection.blockers.length} 项</summary><ul>{selection.blockers.map((blocker, index) => <li key={`${blocker.entityId}-${index}`}>{blocker.message}</li>)}</ul></details>}
    <fieldset disabled={disabled}>
      <NumberInput label="目标高程" ariaLabel="整面目标高程" displayUnit={scene.units.display} value={state.targetElevationMm} onCommit={setTarget}/>
      <NumberInput label="每次升降" ariaLabel="高程升降步长" displayUnit={scene.units.display} value={state.stepMm} onCommit={stepMm => run(() => { assertTerrainElevationStep(stepMm); onChange({ ...state, stepMm }) })}/>
      <button type="button" className="secondary asset-wide" aria-pressed={state.mode === 'sample'} disabled={!sampleFloorAvailable}
        onClick={() => run(() => onChange({ ...state, mode: state.mode === 'sample' ? 'idle' : 'sample' }))}>{state.mode === 'sample' ? '结束取高' : '从地面取高'}</button>
      <button type="button" className="secondary asset-wide" disabled={selection.currentElevationMm === null}
        onClick={() => selection.currentElevationMm !== null && setTarget(selection.currentElevationMm)}>使用所选地形当前高程</button>
      <button type="button" className="secondary asset-wide" aria-pressed={state.mode === 'elevate'} disabled={blocked || selection.areaIds.length !== 1}
        onClick={() => run(() => onChange({ ...state, mode: state.mode === 'elevate' ? 'idle' : 'elevate' }))}>{state.mode === 'elevate' ? '结束滚轮升降' : '启用整面滚轮升降'}</button>
      {state.mode === 'elevate' && <p role="status">在蓝色所选整面轮廓内滚轮向上抬高、向下降低，每次 {format(state.stepMm)}。当前仅调整草稿，点击预览后再采用；Escape 取消。</p>}
      {state.mode === 'sample' && <p role="status">点击真实地面读取高程，保持当前地形与选择不变；Escape 取消。</p>}
      <div className="composition-fields">
        <button type="button" className="secondary" disabled={blocked || selection.areaIds.length !== 1} onClick={() => run(() => onChange(stepTerrainElevation({ ...state, mode: 'elevate' }, -1)))}>降低一步</button>
        <button type="button" className="secondary" disabled={blocked || selection.areaIds.length !== 1} onClick={() => run(() => onChange(stepTerrainElevation({ ...state, mode: 'elevate' }, 1)))}>抬高一步</button>
      </div>
      <button type="button" className="primary asset-wide" disabled={blocked} onClick={preview}>{selection.areaIds.length > 1 ? '预览所选整面平整' : '预览整面高程'}</button>
    </fieldset>
    <button type="button" className="secondary asset-wide" onClick={() => { setError(null); onCancel() }}>取消高程草稿</button>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </section>
}
