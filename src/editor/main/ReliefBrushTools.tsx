import { useLayoutEffect, useMemo, useState } from 'react'
import type { PointMm, SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { createReliefBrush, sculptTerrainRelief } from '../../shared/geometry/terrain-relief-edit'
import { reliefBounds } from '../../shared/geometry/terrain-relief'
import { newId } from './runtime'
import { NumberInput } from '../native-canvas/controls'
import type { CanvasTerrainBrush } from '../native-canvas/AssetCanvas'

interface Props {
  scene: SceneDocument
  areaId?: string
  floorId: string
  layerId: string
  hiddenLayers?: ReadonlySet<string>
  disabled: boolean
  onTool: (brush: CanvasTerrainBrush | null) => void
  onCancel: () => void
  onPreview: (commands: SceneCommand[], label: string, selection: string) => void
}

export default function ReliefBrushTools({ scene, areaId, floorId, layerId, hiddenLayers, disabled, onTool, onCancel, onPreview }: Props) {
  const brush = useMemo(() => createReliefBrush(scene, floorId, areaId, hiddenLayers), [scene, floorId, areaId, hiddenLayers])
  const [radiusMm, setRadius] = useState(1800), [amountMm, setAmount] = useState(600)
  const [points, setPoints] = useState<PointMm[]>([]), [protect, setProtect] = useState(false)
  const [error, setError] = useState('')
  const blocked = disabled || !!brush.selectionIssue || radiusMm < 100 || radiusMm > 100_000 || !amountMm || Math.abs(amountMm) > 20_000
  const marks = (points: readonly PointMm[]) => {
    try { return blocked ? [] : brush.marks({ points, radiusMm, amountMm }) }
    catch { return [] } // The preview action reports the bounded geometry failure.
  }
  const hits = marks(points)
  useLayoutEffect(() => {
    if (blocked) { onTool(null); return }
    onTool({
      radiusMm, strokes: points.length ? [{ pointsMm: points, radiusMm }] : [], color: amountMm < 0 ? '#ad614459' : '#438c5b62',
      stairMarks: live => ({ polygons: marks(live.length ? live : points), protected: protect && !live.length }),
      label: '拖动笔刷调整相邻地形起伏',
      onStroke: stroke => { setPoints(stroke); setProtect(false); setError('') },
      onError: setError, onCancel,
    })
    return () => onTool(null)
  }, [blocked, radiusMm, amountMm, points, protect, brush, onTool, onCancel])
  const preview = () => {
    if (!points.length || blocked) return
    try {
      const floor = scene.floors[floorId], stroke = { points, radiusMm, amountMm }
      const updates = brush.plan(stroke, protect)
      const id = updates.find(update => update.area.id === areaId)?.area.id ?? updates[0]?.area.id ?? newId()
      const commands: SceneCommand[] = updates.map(update => ({ type: 'updateTerrainArea', id: update.area.id, changes: { relief: update.relief } }))
      if (!commands.length) {
        const b = reliefBounds(points), { boundsMm: world } = floor
        const x = Math.max(world.x, b.x - radiusMm), y = Math.max(world.y, b.y - radiusMm)
        const right = Math.min(world.x + world.width, b.x + b.width + radiusMm), bottom = Math.min(world.y + world.height, b.y + b.height + radiusMm)
        if (right <= x || bottom <= y) throw new Error('请从当前楼层范围内起笔。')
        const boundary = [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
        const relief = sculptTerrainRelief(boundary, undefined, stroke)
        if (relief.offsetsMm.every(height => height === 0)) throw new Error('这笔没有改变可编辑地面。请调整位置、半径或强度。')
        commands.push({ type: 'createTerrainArea', id, floorId, layerId, boundaryMm: boundary, relief })
      }
      onPreview(commands, protect ? '调整起伏并保留承托地形' : amountMm < 0 ? '压低地形' : '抬高地形', id)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <section className="terrain-relief-tools" aria-label="起伏笔刷设置">
    <NumberInput label="笔刷半径" displayUnit={scene.units.display} value={radiusMm} onCommit={setRadius}/>
    <NumberInput label="每笔高程变化（负数下挖）" displayUnit={scene.units.display} value={amountMm} onCommit={setAmount}/>
    {hits.length > 0 && <span role="status">{protect ? '保留标记范围内的承托' : '这笔经过固定道路、台阶或其他承托地面'}</span>}
    {hits.length > 0 && <button type="button" className="secondary" aria-pressed={protect} onClick={() => setProtect(value => !value)}>保留承托地形</button>}
    <button type="button" className="primary" disabled={blocked || !points.length || hits.length > 0 && !protect} onClick={preview}>预览这笔起伏</button>
    <button type="button" className="secondary" onClick={onCancel}>退出笔刷</button>
    {brush.selectionIssue && <span role="status">{brush.selectionIssue}</span>}
    {error && <span role="alert">{error}</span>}
  </section>
}
