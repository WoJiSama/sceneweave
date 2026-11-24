import { useRef, useState } from 'react'
import type { BoundsMm, PointMm } from '../../shared/model/scene'

export interface AutomaticRoadCanvas {
  points: PointMm[]
  band: PointMm[]
  treads: [PointMm, PointMm][]
  landings: PointMm[][]
  invalidPoint?: PointMm
  handles: { index: number; point: PointMm; kind: 'start' | 'end' | 'fixed' | 'bend'; selected: boolean }[]
  onSelect: (index: number) => void
  onMove: (index: number, point: PointMm) => void
  onDrop: (index: number, point: PointMm) => void
  onCancelDrag: () => void
}
const labels = { start: '起点', end: '终点', fixed: '固定途经点', bend: '自动转弯' }
const coordinates = (points: PointMm[]) => points.map(({ x, y }) => `${x},${y}`).join(' ')

export default function AutomaticRoadOverlay({ road, bounds, pixelMm, snapMm, toWorld }: {
  road: AutomaticRoadCanvas; bounds: BoundsMm; pixelMm: number; snapMm: number
  toWorld: (clientX: number, clientY: number, released: boolean) => PointMm | null
}) {
  const drag = useRef<{ index: number; pointer: number; clientX: number; clientY: number; moved: boolean } | null>(null)
  const [position, setPosition] = useState<{ index: number; point: PointMm } | null>(null)
  const clear = () => { drag.current = null; setPosition(null) }
  const cancel = () => { clear(); road.onCancelDrag() }
  return <svg className="asset-selection-overlay" data-testid="automatic-road-overlay" aria-label="自动道路草图" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
    {!!road.band.length && <polygon data-testid="automatic-road-band" points={coordinates(road.band)} fill="#c69b5e70" stroke="#6f5133" strokeWidth={pixelMm}/>}
    {road.landings.map((points, index) => <polygon data-auto-road-landing="" key={index} points={coordinates(points)} fill="#e2bc71"/>)}
    {road.treads.map(([a, b], index) => <line key={index} data-auto-road-tread="" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#63472b" strokeOpacity=".55" strokeWidth={pixelMm}/>)}
    <polyline points={coordinates(road.points)} fill="none" stroke="#fffdf2" strokeWidth={1.75 * pixelMm} strokeDasharray={`${5 * pixelMm} ${4 * pixelMm}`}/>
    {road.invalidPoint && <circle cx={road.invalidPoint.x} cy={road.invalidPoint.y} r={10 * pixelMm} fill="none" stroke="#ae4838" strokeWidth={2.5 * pixelMm}/>}
    {road.handles.map(({ index, point, kind, selected }) => {
      const { x, y } = position?.index === index ? position.point : point
      return <circle key={index} role="button" tabIndex={0} aria-label={`${labels[kind]}${kind === 'fixed' || kind === 'bend' ? ` ${index}` : ''}`} aria-pressed={selected}
        data-road-handle={kind} cx={x} cy={y} r={(kind === 'bend' ? 5 : 7) * pixelMm} fill={kind === 'bend' ? '#e3f1e9' : '#ffe0a2'} stroke={selected ? '#364a32' : '#5b472d'} strokeWidth={(selected ? 2.8 : 1.5) * pixelMm}
        style={{ cursor: 'move', pointerEvents: 'auto', touchAction: 'none' }}
        onClick={event => { event.stopPropagation(); event.preventDefault() }}
        onPointerDown={event => {
          if (event.button !== 0 || drag.current) return
          event.preventDefault(); event.stopPropagation()
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { index, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false }
          road.onSelect(index)
        }}
        onPointerMove={event => {
          const active = drag.current
          if (active?.pointer !== event.pointerId) return
          event.stopPropagation()
          if (!active.moved && Math.hypot(event.clientX - active.clientX, event.clientY - active.clientY) < 3) return
          active.moved = true
          const next = toWorld(event.clientX, event.clientY, event.shiftKey)
          if (next) { setPosition({ index, point: next }); road.onMove(index, next) }
        }}
        onPointerUp={event => {
          const active = drag.current
          if (active?.pointer !== event.pointerId) return
          event.preventDefault(); event.stopPropagation()
          const next = active.moved ? toWorld(event.clientX, event.clientY, event.shiftKey) : null
          clear()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          if (next) road.onDrop(index, next)
          else road.onCancelDrag()
        }}
        onLostPointerCapture={() => { if (drag.current?.index === index) cancel() }}
        onPointerCancel={event => { event.stopPropagation(); cancel() }}
        onKeyDown={event => {
          if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); return }
          const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
          const move = delta[event.key]
          if (event.key !== ' ' && !move) return
          event.preventDefault(); event.stopPropagation()
          if (move) road.onDrop(index, { x: point.x + move[0] * snapMm, y: point.y + move[1] * snapMm })
          else road.onSelect(index)
        }}/>
    })}
  </svg>
}
