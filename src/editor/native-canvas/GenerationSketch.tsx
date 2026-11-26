import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { DrawingMarkKind } from '../../platform/browser/generation/drawing'
import type { PointMm } from '../../shared/model/scene'
import { DETAIL_MS, FILL_DELAY_MS, FILL_MS, isDrawingDetail, OUTLINE_MS, type GenerationPlayback } from './generation-playback'
import './generation-sketch.css'

const PAPER = '#f7f3e7'
const INK = '#36584e'
const FILLS: Partial<Record<DrawingMarkKind, string>> = {
  terrain: '#dce6d0', water: '#c1dcd9', room: '#e8d6b8', path: '#dfc6a3', stairs: '#c9bba5', prop: '#bf9764', plant: '#80a784',
}
const elapsed = (now: number, start: number, duration: number) => Math.max(0, Math.min(1, (now - start) / duration))

function inkPath(points: readonly PointMm[], closed: boolean) {
  const path = new Path2D()
  const first = points[0]
  let length = 0
  if (first) {
    path.moveTo(first.x, first.y)
    for (let index = 1; index < points.length; index++) {
      const point = points[index], previous = points[index - 1]
      path.lineTo(point.x, point.y)
      length += Math.hypot(point.x - previous.x, point.y - previous.y)
    }
    if (closed) {
      const last = points[points.length - 1]
      path.closePath()
      length += Math.hypot(first.x - last.x, first.y - last.y)
    }
  }
  return { path, length }
}

export default function GenerationSketch({ playback, complete, onComplete, style }: {
  playback: GenerationPlayback
  complete?: boolean
  onComplete: (token: object) => void
  style?: CSSProperties
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { bounds } = playback.drawing
  const scale = 960 / Math.max(bounds.width, bounds.height)
  const width = Math.max(1, Math.round(bounds.width * scale)), height = Math.max(1, Math.round(bounds.height * scale))

  useLayoutEffect(() => {
    const node = canvas.current!
    const context = node.getContext('2d')
    if (!context) { if (complete) onComplete(playback.token); return }
    const ctx = context
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const unit = 1 / scale
    const entries = playback.marks.map(mark => {
      const area = mark.kind !== 'wall' && mark.kind !== 'opening'
      const face = inkPath(mark.points, area)
      return { ...mark, face, ink: mark.trace ? inkPath(mark.trace, false) : face }
    })
    const spaces = entries.filter(entry => !isDrawingDetail(entry.kind))
    const details = entries.filter(entry => isDrawingDetail(entry.kind))
    let frame = 0
    let fadeAt: number | undefined
    ctx.setTransform(width / bounds.width, 0, 0, height / bounds.height, -bounds.x * width / bounds.width, -bounds.y * height / bounds.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    function paint(now: number) {
      frame = 0
      const reduced = motion.matches
      if (complete && (reduced || now >= playback.endsAt)) {
        fadeAt ??= now
        const opacity = reduced ? 0 : 1 - elapsed(now, fadeAt, 180)
        node.style.opacity = String(opacity)
        if (!opacity) { onComplete(playback.token); return }
      } else node.style.opacity = '1'

      const time = reduced ? playback.endsAt : now
      ctx.globalAlpha = 1
      ctx.fillStyle = PAPER
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
      let stage = 'lines'
      for (const mark of spaces) {
        const fill = FILLS[mark.kind]
        const amount = elapsed(time, mark.startsAt + FILL_DELAY_MS, FILL_MS)
        if (!fill || !amount) continue
        stage = 'spaces'
        ctx.fillStyle = fill
        ctx.globalAlpha = amount
        ctx.fill(mark.face.path)
      }
      for (const mark of spaces) {
        const amount = elapsed(time, mark.startsAt, OUTLINE_MS)
        if (!amount || !mark.ink.length || mark.kind === 'room') continue
        const wall = mark.kind === 'wall'
        ctx.globalAlpha = wall ? .91 : .65
        ctx.strokeStyle = INK
        ctx.lineWidth = (wall ? 3.9 : 2.2) * unit
        ctx.setLineDash(amount < 1 ? [mark.ink.length, mark.ink.length] : [])
        ctx.lineDashOffset = (1 - amount) * mark.ink.length
        ctx.stroke(mark.ink.path)
      }
      ctx.setLineDash([])
      for (const mark of details) {
        const amount = elapsed(time, mark.startsAt, DETAIL_MS)
        if (!amount) continue
        stage = 'details'
        ctx.globalAlpha = amount
        if (mark.kind === 'opening') {
          ctx.strokeStyle = PAPER
          ctx.lineWidth = 7 * unit
          ctx.stroke(mark.face.path)
          ctx.strokeStyle = '#986842'
          ctx.lineWidth = 2.6 * unit
        } else {
          ctx.fillStyle = FILLS[mark.kind]!
          ctx.fill(mark.face.path)
          ctx.strokeStyle = INK
          ctx.lineWidth = 1.3 * unit
        }
        ctx.stroke(mark.face.path)
      }
      if (node.dataset.drawingPhase !== stage) node.dataset.drawingPhase = stage
      if (!reduced && (now < playback.endsAt || fadeAt !== undefined)) frame = requestAnimationFrame(paint)
    }

    function updateMotion() {
      if (frame) cancelAnimationFrame(frame)
      paint(performance.now())
    }
    updateMotion()
    motion.addEventListener('change', updateMotion)
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', updateMotion) }
  }, [bounds, complete, height, onComplete, playback, scale, width])

  return <canvas ref={canvas} className="generation-sketch" aria-hidden="true" data-testid="generation-sketch"
    width={width} height={height} style={style}/>
}
