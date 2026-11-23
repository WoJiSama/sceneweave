import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { artStyleDividerGeometry, moveArtStyleDivider, type ArtStyleDivider, type CompareRect } from './art-style-divider'
import { PreviewScheduler } from '../../platform/browser/render/preview-scheduler.js'
import type { SceneArtStyle } from '../../shared/visual/art-style'
import './art-style-divider.css'

type Handle = 'move' | 'start' | 'end'
type ComparisonRender = (signal: AbortSignal) => Promise<HTMLCanvasElement>
// Coalesce slider moves before scheduling another complete preview.
export const ART_STYLE_PREVIEW_DELAY_MS = 70

export function useArtStyleComparison(paintContext: object, render: ComparisonRender | undefined, style: SceneArtStyle | undefined, onPaint?: (style: SceneArtStyle | undefined) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const lastContext = useRef<object | null>(null)
  const scheduler = useMemo(() => new PreviewScheduler<HTMLCanvasElement>(image => { image.width = image.height = 0 }), [])
  const scope = useMemo(() => ({}), [paintContext, render])
  const [painted, setPainted] = useState<{ context: object; scope: object } | null>(null)
  const [failure, setFailure] = useState<object | null>(null)
  useLayoutEffect(() => {
    scheduler.setScope(scope)
    onPaint?.(undefined)
    if (!render && ref.current) { ref.current.width = ref.current.height = 0 }
    if (!render) { lastContext.current = null; setPainted(null); setFailure(null) }
  }, [scheduler, scope, render, onPaint])
  useEffect(() => () => scheduler.dispose(), [scheduler])
  useEffect(() => {
    if (!render) return
    const paint = () => scheduler.runMain(scope, {
      run: render,
      publish: image => {
        const target = ref.current
        if (!target) return
        target.width = image.width; target.height = image.height
        const context = target.getContext('2d', { colorSpace: 'srgb' })
        if (!context) { setFailure(scope); return }
        context.drawImage(image, 0, 0)
        lastContext.current = paintContext
        setPainted({ context: paintContext, scope })
        if (style) onPaint?.(style)
      },
      fail: () => setFailure(scope),
    })
    if (lastContext.current !== paintContext) {
      const request = paint()
      return () => request.cancel()
    }
    let request: ReturnType<typeof paint> | undefined
    const timer = setTimeout(() => { request = paint() }, ART_STYLE_PREVIEW_DELAY_MS)
    return () => { clearTimeout(timer); request?.cancel() }
  }, [scheduler, scope, render, paintContext, style, onPaint])
  const failed = !!render && failure === scope
  const visible = !!render && painted?.context === paintContext && !failed
  return { ref, visible, pending: !!render && painted?.scope !== scope && !failed, failed }
}

export function ArtStyleComparison({ divider, area, labels, onChange }: {
  divider: ArtStyleDivider; area: CompareRect; labels?: readonly [string, string]; onChange: (value: ArtStyleDivider) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ pointer: number; handle: Handle; initial: ArtStyleDivider; clientX: number; clientY: number } | null>(null)
  useEffect(() => {
    const element = svg.current!
    // A quick handle drag can start a native fling that consumes the next tap.
    const preventFling = (event: TouchEvent) => {
      if (drag.current && event.cancelable) event.preventDefault()
    }
    element.addEventListener('touchstart', preventFling, { passive: false })
    return () => element.removeEventListener('touchstart', preventFling)
  }, [])
  const { pivot, normal, distance, ends: [start, end], handles } = artStyleDividerGeometry(divider, area)
  const setAngle = (angle: number) => onChange({ ...divider, angle: ((angle % 360) + 360) % 360 })
  const down = (handle: Handle, event: PointerEvent<SVGElement>) => {
    if (event.button !== 0 || drag.current) return
    event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, handle, initial: divider, clientX: event.clientX, clientY: event.clientY }
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current
    if (active?.pointer !== event.pointerId) return
    event.stopPropagation()
    const dx = event.clientX - active.clientX, dy = event.clientY - active.clientY
    if (active.handle === 'move') {
      onChange(moveArtStyleDivider(active.initial, active.initial.x + dx / area.width, active.initial.y + dy / area.height, area))
      return
    }
    const rect = svg.current!.getBoundingClientRect(), x = event.clientX - rect.left - pivot.x, y = event.clientY - rect.top - pivot.y
    if (Math.hypot(x, y) < 7) return
    setAngle(Math.atan2(y, x) * 180 / Math.PI - (active.handle === 'end' ? 90 : -90))
  }
  const release = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointer !== event.pointerId) return
    event.stopPropagation()
    drag.current = null
  }
  const key = (handle: Handle, event: KeyboardEvent<SVGElement>) => {
    if (event.key === 'Home') {
      onChange({ x: .5, y: .5, angle: 0 })
    } else {
      const directions: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
      const step = directions[event.key]
      if (!step) return
      if (handle === 'move') onChange(moveArtStyleDivider(divider, divider.x + step[0] * 8 / area.width, divider.y + step[1] * 8 / area.height, area))
      else setAngle(divider.angle + (step[0] || step[1]) * (event.shiftKey ? 15 : 3))
    }
    event.preventDefault()
    event.stopPropagation()
  }
  const line = { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
  const label = (after: boolean) => {
    const text = labels?.[after ? 1 : 0] ?? (after ? '调整后' : '调整前')
    const halfWidth = Math.max(30, 10 + text.length * 5.8)
    const [left, right] = [area.x + halfWidth + 4, area.x + area.width - halfWidth - 4], [top, bottom] = [area.y + 17, area.y + area.height - 17]
    const points = [{ x: left, y: top }, { x: right, y: top }, { x: left, y: bottom }, { x: right, y: bottom }]
    const direction = after ? 1 : -1
    const best = points.reduce((a, b) => direction * (distance(b) - distance(a)) > .01 ? b : a)
    if (direction * distance(best) < (halfWidth - 3) * Math.abs(normal.x) + 12 * Math.abs(normal.y)) return null
    return <g className="art-style-side" transform={`translate(${best.x},${best.y})`} aria-hidden="true"><rect x={-halfWidth} y={-12} width={halfWidth * 2} height={24} rx={4}/><text y={4} textAnchor="middle">{text}</text></g>
  }
  return <svg ref={svg} className="art-style-divider" aria-label={labels ? '两侧画风对比线' : '画风前后对比'} data-angle={divider.angle} data-position-x={divider.x} data-position-y={divider.y}
    onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onClick={event => event.stopPropagation()}>
    <line {...line} className="art-style-divider-outline" aria-hidden="true"/>
    <line {...line} className="art-style-divider-rule" aria-hidden="true"/>
    <line {...line} className="art-style-divider-grab" aria-hidden="true" onPointerDown={event => down('move', event)}/>
    <circle cx={pivot.x} cy={pivot.y} r={11} className="art-style-divider-handle art-style-divider-grab" tabIndex={0} role="button"
      aria-label="移动画风对比线" onPointerDown={event => down('move', event)} onKeyDown={event => key('move', event)}/>
    {handles.map((point, index) => {
      const handle = index === 0 ? 'start' : 'end'
      return <circle key={handle} cx={point.x} cy={point.y} r={9} className="art-style-divider-handle art-style-divider-turn" tabIndex={0} role="button"
        aria-label={index === 0 ? '旋转对比线端点一' : '旋转对比线端点二'} onPointerDown={event => down(handle, event)} onKeyDown={event => key(handle, event)}/>
    })}
    {label(false)}
    {label(true)}
  </svg>
}
