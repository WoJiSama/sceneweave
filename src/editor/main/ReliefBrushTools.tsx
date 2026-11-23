import { useLayoutEffect, useMemo, useState } from 'react'
import type { PointMm, SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { terrainPoints, pointInPolygon } from '../../shared/geometry/geometry'
import { assertReliefKeepsStairLandings, fixedReliefTreads, sculptTerrainRelief, touchedReliefTreads } from '../../shared/geometry/terrain-relief-edit'
import { reliefBounds } from '../../shared/geometry/terrain-relief'
import { effectiveEditLocked } from '../../shared/commands/layers'
import { newId } from './runtime'
import { NumberInput } from '../native-canvas/controls'
import type { CanvasTerrainBrush } from '../native-canvas/AssetCanvas'

interface Props {
  scene: SceneDocument
  areaId?: string
  floorId: string
  layerId: string
  disabled: boolean
  onTool: (brush: CanvasTerrainBrush | null) => void
  onCancel: () => void
  onPreview: (commands: SceneCommand[], label: string, selection: string) => void
}

export default function ReliefBrushTools({ scene, areaId, floorId, layerId, disabled, onTool, onCancel, onPreview }: Props) {
  const area = areaId ? scene.terrainAreas[areaId] : undefined
  const outline = useMemo(() => area ? terrainPoints(area) : undefined, [area])
  const treads = useMemo(() => area ? fixedReliefTreads(scene, area.id) : [], [scene, area])
  const [radiusMm, setRadius] = useState(1800), [amountMm, setAmount] = useState(600)
  const [points, setPoints] = useState<PointMm[]>([]), [protect, setProtect] = useState(false)
  const [error, setError] = useState('')
  const noSupport = !!areaId && (!area || area.rockBody || area.facade || area.waterSurface || effectiveEditLocked(scene, area.id))
  const blocked = disabled || !!noSupport || radiusMm < 100 || radiusMm > 100_000 || !amountMm || Math.abs(amountMm) > 20_000
  const marks = (points: readonly PointMm[]) => amountMm < 0 ? touchedReliefTreads({ points, radiusMm, amountMm }, treads, outline) : []
  const hits = marks(points)
  useLayoutEffect(() => {
    if (blocked) { onTool(null); return }
    onTool({
      radiusMm, strokes: points.length ? [{ pointsMm: points, radiusMm }] : [], color: amountMm < 0 ? '#ad614459' : '#438c5b62',
      stairMarks: live => ({ polygons: marks(live.length ? live : points), protected: protect && !live.length }),
      label: area ? '沿所选地形刷出起伏' : '拖动笔刷创建起伏地形',
      onStroke: stroke => { setPoints(stroke); setProtect(false); setError('') },
      onError: setError, onCancel,
    })
    return () => onTool(null)
  }, [blocked, radiusMm, amountMm, points, protect, scene, area, onTool, onCancel])
  const preview = () => {
    if (!points.length || blocked) return
    try {
      const floor = scene.floors[floorId], stroke = { points, radiusMm, amountMm }
      const id = area?.id ?? newId()
      let boundary = outline
      if (!boundary) {
        const b = reliefBounds(points), { boundsMm: world } = floor
        const x = Math.max(world.x, b.x - radiusMm), y = Math.max(world.y, b.y - radiusMm)
        const right = Math.min(world.x + world.width, b.x + b.width + radiusMm), bottom = Math.min(world.y + world.height, b.y + b.height + radiusMm)
        if (right <= x || bottom <= y) throw new Error('请从当前楼层范围内起笔。')
        boundary = [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }]
      }
      if (!points.some(p => pointInPolygon(p, boundary!))) throw new Error('笔画需要经过所选地形。')
      const relief = sculptTerrainRelief(boundary, area?.relief, stroke, protect ? hits : [])
      if (amountMm < 0 && area) assertReliefKeepsStairLandings(scene, area.id, relief)
      if (area?.relief?.offsetsMm.every((height, i) => height === relief.offsetsMm[i]) || relief.offsetsMm.every(height => height === 0) && !area?.relief) {
        throw new Error('这笔没有改变可编辑地面。请调整位置、半径或强度。')
      }
      const commands: SceneCommand[] = area ? [{ type: 'updateTerrainArea', id, changes: { relief } }]
        : [{ type: 'createTerrainArea', id, floorId, layerId, boundaryMm: boundary, relief }]
      onPreview(commands, protect ? '调整起伏并保留阶下岩土' : amountMm < 0 ? '压低地形' : '抬高地形', id)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <section className="terrain-relief-tools" aria-label="起伏笔刷设置">
    <NumberInput label="笔刷半径" displayUnit={scene.units.display} value={radiusMm} onCommit={setRadius}/>
    <NumberInput label="每笔高程变化（负数下挖）" displayUnit={scene.units.display} value={amountMm} onCommit={setAmount}/>
    {hits.length > 0 && <span role="status">{protect ? `保留 ${hits.length} 级下方的岩肩` : `${hits.length} 级台阶的承托会受影响`}</span>}
    {hits.length > 0 && <button type="button" className="secondary" aria-pressed={protect} onClick={() => setProtect(value => !value)}>保留阶下岩土</button>}
    <button type="button" className="primary" disabled={blocked || !points.length || hits.length > 0 && !protect} onClick={preview}>预览这笔起伏</button>
    <button type="button" className="secondary" onClick={onCancel}>退出笔刷</button>
    {noSupport && <span role="status">请选择未锁定的开放地形。</span>}
    {error && <span role="alert">{error}</span>}
  </section>
}
