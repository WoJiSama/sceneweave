import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { OutdoorCommand } from '../../shared/commands/outdoor'
import { NumberInput } from '../native-canvas/controls'
import { formatLengthInput } from '../native-canvas/length-input'
import { assertTerrainElevation } from './terrain-elevation-tools'
import { createEntityLabeler } from './entity-label'
import { inspectTerrainSculptSelection, terrainSculptCommands, TERRAIN_SCULPT_MAX_POINTS, type TerrainSculptProject, type TerrainSculptToolState } from './terrain-sculpt-tools'

export interface TerrainSculptToolsProps {
  project: TerrainSculptProject
  selectedIds: readonly string[]
  state: TerrainSculptToolState
  operationId: string
  excludedIds?: ReadonlySet<string>
  disabled?: boolean
  disabledReason?: string
  onChange: (state: TerrainSculptToolState) => void
  onPreview: (commands: OutdoorCommand[], description: string, createdAreaId: string) => void
  onCancel: () => void
  onFinishReady?: (finish: (() => void) | null) => void
}

/** Controlled polygon draft. It never writes a scene or invents a replacement schema. */
export default function TerrainSculptTools({ project, selectedIds, state, operationId, excludedIds, disabled = false, disabledReason,
  onChange, onPreview, onCancel, onFinishReady }: TerrainSculptToolsProps) {
  const scene = project.document
  const selection = useMemo(() => inspectTerrainSculptSelection(project, selectedIds, excludedIds), [project, selectedIds, excludedIds])
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  const [error, setError] = useState<string | null>(null)
  const blocked = disabled || !!selection.reason
  const format = (value: number) => `${formatLengthInput(value, scene.units.display)} ${scene.units.display}`
  const run = (action: () => void) => { try { setError(null); action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } }
  const preview = () => run(() => {
    if (blocked) return
    const result = terrainSculptCommands(project, selectedIds, state.points, state.targetElevationMm, operationId, excludedIds)
    onChange({ ...state, mode: 'idle', cursor: null })
    onPreview(result.commands, `新增局部${state.targetElevationMm > selection.currentElevationMm! ? '台地' : '洼地'} · ${format(state.targetElevationMm)} · ${result.overlayFragmentCount} 片材质覆盖 · 原面保留`, result.createdAreaId)
  })
  const finishRef = useRef<(() => void) | null>(null), listenerRef = useRef(onFinishReady)
  const finishReady = !blocked && state.mode === 'polygon' && state.points.length >= 3
  useLayoutEffect(() => { finishRef.current = finishReady ? preview : null; listenerRef.current = onFinishReady })
  const finish = useCallback(() => finishRef.current?.(), [])
  useLayoutEffect(() => { onFinishReady?.(finishReady ? finish : null); return () => listenerRef.current?.(null) }, [finishReady, finish, onFinishReady])
  return <section className="asset-section" aria-label="局部地形塑形工具">
    <h2>局部台地与洼地</h2>
    <p className="asset-muted">在所选地形内部画闭合范围，新增真实高程面与阻挡通行的崖边。世界对齐材质覆盖按范围精确裁切，原面保留，原覆盖保持不变；采用后可继续编辑、撤销和保存。此工具不会自动补坡或搬动建筑。</p>
    {selection.areaId && <p>目标：{name(selection.areaId)} · 当前 {format(selection.currentElevationMm!)}。</p>}
    {disabled && disabledReason && <p role="status" className="asset-muted">{disabledReason}</p>}
    {selection.reason && <p role="status" className="asset-form-error">{selection.reason}</p>}
    {selection.blockers.length > 1 && <details><summary>需要处理的依赖 · {selection.blockers.length} 项</summary><ul>{selection.blockers.map((item, index) => <li key={`${item.entityId}-${index}`}>{item.message}</li>)}</ul></details>}
    <fieldset disabled={blocked}>
      <NumberInput label="局部目标高程" ariaLabel="局部目标高程" displayUnit={scene.units.display} value={state.targetElevationMm}
        onCommit={targetElevationMm => run(() => { assertTerrainElevation(targetElevationMm); onChange({ ...state, targetElevationMm }) })}/>
      <button type="button" className="secondary asset-wide" aria-pressed={state.mode === 'polygon'}
        onClick={() => run(() => onChange({ ...state, mode: state.mode === 'polygon' ? 'idle' : 'polygon', cursor: null }))}>{state.mode === 'polygon' ? '暂停画局部范围' : state.points.length ? '继续画局部范围' : '在画布画局部范围'}</button>
      <p role="status">已取 {state.points.length} 个点，输入限 3–{TERRAIN_SCULPT_MAX_POINTS} 点，实际点、边及依赖展开仍须通过单次预算；超限请简化轮廓。逐点绘制后按 Enter 或预览；范围必须完全在原面内部。Escape 取消整笔草稿。</p>
      <div className="composition-fields">
        <button type="button" className="secondary" disabled={!state.points.length} onClick={() => onChange({ ...state, points: state.points.slice(0, -1), cursor: null })}>撤回最后一点</button>
        <button type="button" className="secondary" disabled={!state.points.length} onClick={() => onChange({ ...state, points: [], cursor: null })}>清空局部范围</button>
      </div>
      {!!state.points.length && <details><summary>查看范围坐标 · mm</summary><ol>{state.points.map((point, index) => <li key={index}>{point.x}, {point.y}</li>)}</ol></details>}
      <button type="button" className="primary asset-wide" disabled={state.points.length < 3} onClick={preview}>预览局部高程与崖边</button>
    </fieldset>
    <button type="button" className="secondary asset-wide" onClick={() => { setError(null); onCancel() }}>取消局部塑形草稿</button>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </section>
}
