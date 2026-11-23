import { useEffect, useMemo, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { PointMm, SceneDocument } from '../../shared/model/scene'
import { resolveFloorOutput } from '../../shared/floors/output'
import { DEFAULT_LIGHT_BEAM, LIGHT_LABELS, lightSourcePoints, normalizeLightDirection, windowReceivers } from '../../shared/visual/light-geometry'
import { visualLightSchema } from '../../shared/visual/schema'
import type { LightShape, VisualLight } from '../../shared/visual/types'
import { visualBase } from '../../shared/visual/base'
import type { CanvasWorldTool } from '../native-canvas/building-session'
import { createEntityLabeler } from './entity-label'
import { newId } from './runtime'

type LightKind = keyof typeof LIGHT_LABELS

export default function LightingPanel({ scene, floorId, layerId, selectedIds, disabled, active, onPreview, onDraftChange, onCanvasTool, onCanvasStart, onCanvasEnd }: {
  scene: SceneDocument
  floorId: string
  layerId: string
  selectedIds: readonly string[]
  disabled: boolean
  active: boolean
  onPreview: (commands: SceneCommand[], label: string) => void
  onDraftChange?: () => void
  onCanvasTool?: (tool: CanvasWorldTool | null) => void
  onCanvasStart?: () => void
  onCanvasEnd?: () => void
}) {
  const bounds = resolveFloorOutput(scene, floorId).boundsMm
  const initial = (): VisualLight => ({
    id: newId(), floorId, layerId, visibility: 'public', editLocked: false,
    positionMm: { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) },
    radiusMm: 4000, color: '#FFCA80', intensity: .65, wallOcclusion: true, enabled: true,
  })
  const [light, setLight] = useState(initial)
  const [picking, setPicking] = useState<{ first?: PointMm; cursor: PointMm | null } | null>(null)
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  const windows = useMemo(() => Object.values(scene.openings).filter(opening => opening.floorId === floorId && opening.kind === 'window')
    .map(window => ({ window, rooms: windowReceivers(scene, window.id) })).filter(row => row.rooms.length), [scene, floorId])
  const paths = Object.values(scene.paths).filter(path => path.floorId === floorId)
  const areas: Extract<LightShape, { kind: 'area' }>['source'][] = [
    ...Object.values(scene.rooms).filter(room => room.floorId === floorId).map(room => ({ kind: 'room' as const, id: room.id })),
    ...Object.values(scene.terrainAreas).filter(area => area.floorId === floorId).map(area => ({ kind: 'terrainArea' as const, id: area.id })),
  ]
  const saved = Object.values(visualBase(scene)?.lights ?? {}).filter(row => row.floorId === floorId)
  const editing = saved.find(row => row.id === light.id)
  const layer = scene.userLayers[light.layerId], shape = light.shape
  const span = Math.max(1, Math.min(2000, Math.round(bounds.width / 4)))
  const segment = () => ({ kind: 'segment' as const, endMm: { x: Math.round(bounds.x + bounds.width / 2) + span, y: Math.round(bounds.y + bounds.height / 2) } })
  const path = paths.find(row => selectedIds.includes(row.id))
  const area = areas.find(row => selectedIds.includes(row.id))
  const selectedWindow = windows.find(row => selectedIds.includes(row.window.id))
  const selectWindow = (id: string) => {
    const rooms = windows.find(row => row.window.id === id)?.rooms ?? []
    if (shape?.kind === 'window') update({ shape: { ...shape, openingId: id, roomId: rooms.find(room => selectedIds.includes(room.id))?.id ?? rooms[0]?.id ?? '' } })
  }
  const update = (values: Partial<VisualLight>) => {
    setLight(current => ({ ...current, ...values }))
    onDraftChange?.()
  }
  const chooseKind = (kind: LightKind) => {
    setPicking(null)
    if (kind === 'point') {
      const { shape: _shape, ...point } = light
      setLight(point); onDraftChange?.()
    } else if (kind === 'window') {
      const room = selectedWindow?.rooms.find(room => selectedIds.includes(room.id)) ?? selectedWindow?.rooms[0]
      update({ shape: { kind, openingId: selectedWindow?.window.id ?? '', roomId: room?.id ?? '', angleOffsetDeg: 0, spreadDeg: 9, softness: .7 } })
    } else if (kind === 'line') {
      update({ shape: { kind, source: path ? { kind: 'path', pathId: path.id, side: 'center' } : segment(), softness: .6 }, radiusMm: 1000 })
    } else if (kind === 'area') {
      update({ shape: { kind, source: area ?? { kind: 'room', id: '' }, surfaceIntensity: .6, softness: .66 }, radiusMm: 1400 })
    } else update({ shape: { kind, ...DEFAULT_LIGHT_BEAM } })
  }
  const lineEnd = shape?.kind === 'line' && shape.source.kind === 'segment' ? shape.source.endMm : undefined
  const canPick = !shape || shape.kind === 'spot' || !!lineEnd
  const twoClicks = !!shape && canPick
  useEffect(() => {
    if (!picking || !canPick || disabled || !active) return
    onCanvasTool?.({
      kind: 'polyline', points: picking.first ? [picking.first] : [], cursor: picking.cursor, snapMm: 1,
      label: (picking.first ? shape?.kind === 'spot' ? '点击画布确定聚光朝向' : '点击画布确定线光终点'
        : twoClicks ? '点击画布确定发光起点' : '点击画布放置点光') + ' · Esc 退出',
      onMove: cursor => setPicking(current => current ? { ...current, cursor } : null),
      onClearCursor: () => setPicking(current => current ? { ...current, cursor: null } : null),
      onCancel: () => setPicking(null),
      onPoint: point => {
        const first = picking.first
        if (twoClicks && !first) { setPicking({ first: point, cursor: null }); return }
        if (first && point.x === first.x && point.y === first.y) return
        if (shape?.kind === 'spot' && first) {
          const directionDeg = normalizeLightDirection(Math.round(Math.atan2(point.y - first.y, point.x - first.x) * 180 / Math.PI))
          update({ positionMm: first, shape: { ...shape, directionDeg } })
        } else if (shape?.kind === 'line' && shape.source.kind === 'segment' && first) {
          update({ positionMm: first, shape: { ...shape, source: { kind: 'segment', endMm: point } } })
        } else update({ positionMm: point })
        setPicking(null)
        onCanvasEnd?.()
      },
    })
    return () => onCanvasTool?.(null)
  }, [picking, canPick, disabled, active, shape, twoClicks, onCanvasTool])
  const numeric = (label: string, value: number, set: (value: number) => void, min?: number, max?: number, step = 1) =>
    <label key={label}>{label}<input aria-label={`视觉${label}`} type="number" min={min} max={max} step={step} value={Number.isNaN(value) ? '' : value} onChange={event => set(event.target.valueAsNumber)}/></label>
  const pointFields = (point: PointMm, label: string, change: (point: PointMm) => void) => <div className="visual-pair">
    {(['x', 'y'] as const).map(axis => numeric(`${label} ${axis.toUpperCase()} mm`, point[axis], value => change({ ...point, [axis]: value })))}
  </div>
  const check = (label: string, value: boolean, change: (value: boolean) => void) =>
    <label className="visual-check"><input aria-label={`视觉${label}`} type="checkbox" checked={value} onChange={event => change(event.target.checked)}/>{label}</label>
  const sourceValid = lightSourcePoints(scene, light).length > 0
  const ready = sourceValid && visualLightSchema.safeParse(light).success
    && (!lineEnd || light.positionMm.x !== lineEnd.x || light.positionMm.y !== lineEnd.y)
  const receivers = shape?.kind === 'window' ? windows.find(row => row.window.id === shape.openingId)?.rooms ?? [] : []
  return <>
    <label>灯光<select aria-label="灯光" value={editing?.id ?? ''} onChange={event => {
      const value = saved.find(row => row.id === event.target.value)
      setPicking(null); setLight(value ? structuredClone(value) : initial())
    }}><option value="">新灯光</option>{saved.map(row => <option key={row.id} value={row.id}>{name(row.id)}</option>)}</select></label>
    <label>灯光类型<select aria-label="灯光类型" value={shape?.kind ?? 'point'} onChange={event => chooseKind(event.target.value as LightKind)}>
      {Object.entries(LIGHT_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
    </select></label>
    {canPick && onCanvasTool && <button type="button" className="secondary asset-wide" onClick={() => {
      if (picking) setPicking(null)
      else { setPicking({ cursor: null }); onCanvasStart?.() }
    }}>{picking ? '退出画布取点' : twoClicks ? shape?.kind === 'spot' ? '在画布定位并瞄准' : '在画布画线' : '在画布定位灯光'}</button>}
    {canPick && pointFields(light.positionMm, '灯光', positionMm => update({ positionMm }))}
    {shape?.kind === 'spot' && <div className="visual-pair">
      {numeric('聚光方向 °', shape.directionDeg, directionDeg => update({ shape: { ...shape, directionDeg } }), 0, 359)}
      {numeric('聚光张角 °', shape.apertureDeg, apertureDeg => update({ shape: { ...shape, apertureDeg } }), 5, 170)}
    </div>}
    {shape?.kind === 'window' && <>
      <label>发光窗户<select aria-label="发光窗户" value={windows.some(row => row.window.id === shape.openingId) ? shape.openingId : ''} onChange={event => selectWindow(event.target.value)}>
        <option value="">选择窗户</option>{windows.map(({ window }) => <option key={window.id} value={window.id}>{name(window.id)}</option>)}
      </select></label>
      {selectedWindow && selectedWindow.window.id !== shape.openingId && <button className="secondary asset-wide" onClick={() => selectWindow(selectedWindow.window.id)}>使用选中的窗户</button>}
      <label>接收房间<select aria-label="接收房间" value={receivers.some(room => room.id === shape.roomId) ? shape.roomId : ''} onChange={event => update({ shape: { ...shape, roomId: event.target.value } })}>
        <option value="">选择房间</option>{receivers.map(room => <option key={room.id} value={room.id}>{name(room.id)}</option>)}
      </select></label>
      <div className="visual-pair">
        {numeric('窗光偏角 °', shape.angleOffsetDeg, angleOffsetDeg => update({ shape: { ...shape, angleOffsetDeg } }), -60, 60)}
        {numeric('窗光扩散 °', shape.spreadDeg, spreadDeg => update({ shape: { ...shape, spreadDeg } }), 0, 40)}
      </div>
    </>}
    {shape?.kind === 'line' && <>
      <label>线光来源<select aria-label="线光来源" value={shape.source.kind} onChange={event => {
        setPicking(null)
        update({ shape: { ...shape, source: event.target.value === 'segment' ? segment() : { kind: 'path', pathId: path?.id ?? '', side: 'center' } } })
      }}><option value="segment">独立线段</option><option value="path">跟随道路或桥梁</option></select></label>
      {shape.source.kind === 'segment' ? pointFields(shape.source.endMm, '终点', endMm => update({ shape: { ...shape, source: { kind: 'segment', endMm } } })) : <>
        <label>道路或桥梁<select aria-label="道路或桥梁" value={paths.some(row => shape.source.kind === 'path' && row.id === shape.source.pathId) ? shape.source.pathId : ''} onChange={event => {
          if (shape.source.kind === 'path') update({ shape: { ...shape, source: { ...shape.source, pathId: event.target.value } } })
        }}><option value="">选择路线</option>{paths.map(row => <option key={row.id} value={row.id}>{name(row.id)}</option>)}</select></label>
        <label>沿路线位置<select aria-label="沿路线位置" value={shape.source.side} onChange={event => {
          if (shape.source.kind === 'path') update({ shape: { ...shape, source: { ...shape.source, side: event.target.value as 'center' | 'left' | 'right' } } })
        }}><option value="center">中心线</option><option value="left">左侧（沿绘制方向）</option><option value="right">右侧（沿绘制方向）</option></select></label>
      </>}
    </>}
    {shape?.kind === 'area' && <>
      <label>发光表面<select aria-label="发光表面" value={areas.some(row => row.id === shape.source.id) ? shape.source.id : ''} onChange={event => {
        update({ shape: { ...shape, source: areas.find(row => row.id === event.target.value) ?? { kind: 'room', id: '' } } })
      }}><option value="">选择房间或地形</option>{areas.map(row => <option key={row.id} value={row.id}>{name(row.id)}</option>)}</select></label>
      {numeric('表面亮度', shape.surfaceIntensity, surfaceIntensity => update({ shape: { ...shape, surfaceIntensity } }), 0, 2, .05)}
    </>}
    {shape && !sourceValid && <p role="status">{editing ? '灯光来源已失效。可以重新绑定，或移除这盏灯。' : '选择本层的发光来源后即可预览。'}</p>}
    <div className="visual-pair">
      {numeric(!shape ? '灯光半径 mm' : shape.kind === 'line' || shape.kind === 'area' ? '溢光范围 mm' : '照射距离 mm', light.radiusMm, radiusMm => update({ radiusMm }), 1, 50_000)}
      {numeric(shape?.kind === 'area' ? '溢光强度' : '灯光强度', light.intensity, intensity => update({ intensity }), 0, 2, .05)}
    </div>
    <label>灯光颜色<input aria-label="视觉灯光颜色" type="color" value={light.color} onChange={event => update({ color: event.target.value })}/></label>
    {shape && numeric('光边柔度', shape.softness, softness => update({ shape: { ...shape, softness } }), 0, 1, .05)}
    {check('墙体与物件遮挡', light.wallOcclusion, wallOcclusion => update({ wallOcclusion }))}
    {check('启用灯光', light.enabled, enabled => update({ enabled }))}
    <label>可见性<select aria-label="灯光可见性" value={light.visibility} onChange={event => update({ visibility: event.target.value === 'gm' ? 'gm' : 'public' })}>
      <option value="public">主持人与玩家</option><option value="gm">仅主持人</option>
    </select></label>
    <p className="asset-muted">图层 · {layer?.name ?? light.layerId}</p>
    <button className="primary asset-wide" disabled={!ready || !!picking} onClick={() => onPreview([{ type: 'upsertVisualLight', light }], `调整${LIGHT_LABELS[shape?.kind ?? 'point']}`)}>预览灯光</button>
    {editing && <button className="secondary asset-wide" onClick={() => {
      setPicking(null); onPreview([{ type: 'removeVisualEffect', kind: 'light', id: light.id }], '移除灯光')
    }}>移除灯光</button>}
  </>
}
