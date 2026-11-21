import { useEffect, useMemo, useRef } from 'react'
import type { PointMm, TerrainArea } from '../../shared/model/scene'

const width = 320
const height = 134
const margin = 12

export default function ShorelineSegmentPicker({ boundary, selected, shores, onSelect }: {
  boundary: TerrainArea['boundaryMm']
  selected: string
  shores: ReadonlySet<string>
  onSelect: (segmentId: string) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const segments = useMemo(() => {
    const points = boundary.map(vertex => vertex.positionMm)
    const xs = points.map(p => p.x), ys = points.map(p => p.y)
    const minX = Math.min(...xs), minY = Math.min(...ys), spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY
    const scale = Math.min((width - margin * 2) / Math.max(1, spanX), (height - margin * 2) / Math.max(1, spanY))
    const view = points.map(p => ({ x: (p.x - minX) * scale + (width - spanX * scale) / 2, y: (p.y - minY) * scale + (height - spanY * scale) / 2 }))
    return boundary.map(({ segmentId }, index) => ({ segmentId, a: view[index], b: view[(index + 1) % view.length] }))
  }, [boundary])
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    context.fillStyle = '#E7F1EF'; context.fillRect(0, 0, width, height)
    context.beginPath()
    segments.forEach(({ a }, index) => index ? context.lineTo(a.x, a.y) : context.moveTo(a.x, a.y))
    context.closePath(); context.fillStyle = '#CBE1D8'; context.fill()
    const stroke = ({ a, b }: { a: PointMm; b: PointMm }) => {
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke()
    }
    context.lineCap = 'round'; context.lineWidth = 2
    for (const segment of segments) {
      context.strokeStyle = shores.has(segment.segmentId) ? '#14766D' : '#657E75'
      stroke(segment)
    }
    const current = segments.find(segment => segment.segmentId === selected)
    if (current) { context.strokeStyle = '#A93E24'; context.lineWidth = 4; stroke(current) }
  }, [segments, selected, shores])

  return <canvas ref={canvas} width={width} height={height} aria-label="点选地形边段"
    style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair', borderRadius: 4 }} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = (event.clientX - rect.left) * width / rect.width, y = (event.clientY - rect.top) * height / rect.height
      let closest: string | undefined, limit = 100
      for (const { a, b, segmentId } of segments) {
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy
        if (d2 === 0) continue
        const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / d2))
        const distance = (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2
        if (distance < limit) { closest = segmentId; limit = distance }
      }
      if (closest) onSelect(closest)
    }}/>
}
