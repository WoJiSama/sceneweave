import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Hand, Maximize, MousePointer2, ZoomIn, ZoomOut } from 'lucide-react'
import { openingEndpointsV2, pointInPolygonV2, roomPointsV2, terrainPointsV2 } from '../../core/v2/geometry'
import type { PointMm, SceneDocumentV2 } from '../../core/v2/types'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { orderedPropsV2, pointsBoundsV2, projectSceneV2 } from '../../render/v2/projection'
import type { AudienceV2 } from '../../render/v2/projection'
import { connectionPolygonV2, renderProjectV2 } from '../../render/v2/renderer'
import type { RenderOptionsV2 } from '../../render/v2/renderer'
import { constrainViewportV2, FIT_VIEWPORT_V2, fittedMapSizeV2, MAX_VIEW_ZOOM_V2, MIN_VIEW_ZOOM_V2, viewportMapRectV2, zoomViewportV2 } from './viewport'
import type { MapViewportV2, ViewportSizeV2 } from './viewport'

/** The supported visual subset is shared with PNG; no incomplete success preview. */
export function previewLimitations(scene: SceneDocumentV2): string[] {
  try { return projectSceneV2(scene, 'gm').limitations }
  catch (error) { return [error instanceof Error ? error.message : String(error)] }
}
const distanceToSegment = (point: PointMm, a: PointMm, b: PointMm): number => {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy, t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}
function hitTest(scene: SceneDocumentV2, point: PointMm, tolerance: number): string | null {
  for (const prop of orderedPropsV2(Object.values(scene.props)).reverse()) {
    const angle = -prop.rotationDeg * Math.PI / 180, dx = point.x - prop.positionMm.x, dy = point.y - prop.positionMm.y
    const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle), v = prop.visualBoundsMm
    if (x >= v.x && x <= v.x + v.width && y >= v.y && y <= v.y + v.height) return prop.id
  }
  const vertex = Object.values(scene.vertices).find(v => Math.hypot(v.xMm - point.x, v.yMm - point.y) <= tolerance)
  if (vertex) return vertex.id
  for (const area of Object.values(scene.terrainAreas)) {
    const handle = area.boundaryMm.find(p => Math.hypot(p.positionMm.x - point.x, p.positionMm.y - point.y) <= tolerance)
    if (handle) return handle.id
  }
  for (const opening of Object.values(scene.openings)) if (distanceToSegment(point, ...openingEndpointsV2(scene, opening)) <= scene.walls[opening.wallId].thicknessMm / 2 + tolerance / 2) return opening.id
  for (const wall of Object.values(scene.walls)) {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    if (distanceToSegment(point, { x: a.xMm, y: a.yMm }, { x: b.xMm, y: b.yMm }) <= wall.thicknessMm / 2 + tolerance / 2) return wall.id
  }
  for (const connection of Object.values(scene.terrainConnections)) if (pointInPolygonV2(point, connectionPolygonV2({ start: connection.from.positionMm, end: connection.to.positionMm, widthMm: connection.widthMm }))) return connection.id
  for (const edge of Object.values(scene.terrainEdges)) {
    const area = scene.terrainAreas[edge.source.areaId], i = area?.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId) ?? -1
    if (area && i >= 0 && distanceToSegment(point, area.boundaryMm[i].positionMm, area.boundaryMm[(i + 1) % area.boundaryMm.length].positionMm) <= tolerance) return edge.id
  }
  for (const room of Object.values(scene.rooms)) if (pointInPolygonV2(point, roomPointsV2(scene, room))) return room.id
  return Object.values(scene.terrainAreas).sort((a, b) => b.coveragePriority - a.coveragePriority || b.id.localeCompare(a.id)).find(a => pointInPolygonV2(point, terrainPointsV2(a)))?.id ?? null
}
function selection(ctx: CanvasRenderingContext2D, scene: SceneDocumentV2, id: string, displayScale = 1): void {
  const bounds = scene.exportBoundsMm, scale = ctx.canvas.width / bounds.width * displayScale
  ctx.save(); ctx.scale(ctx.canvas.width / bounds.width, ctx.canvas.height / bounds.height); ctx.translate(-bounds.x, -bounds.y); ctx.strokeStyle = '#2C7A65'; ctx.fillStyle = '#F6F0DD'; ctx.lineWidth = 2 / scale; ctx.setLineDash([7 / scale, 5 / scale])
  const polygon = (points: PointMm[]) => { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke() }
  const handle = (p: PointMm) => { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(p.x, p.y, 5 / scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke() }
  const prop = scene.props[id], vertex = scene.vertices[id], wall = scene.walls[id], room = scene.rooms[id], opening = scene.openings[id], area = scene.terrainAreas[id], prefab = scene.prefabInstances[id], edge = scene.terrainEdges[id], connection = scene.terrainConnections[id], scatter = scene.scatterGroups[id]
  if (prop) {
    ctx.translate(prop.positionMm.x, prop.positionMm.y); ctx.rotate(prop.rotationDeg * Math.PI / 180)
    const v = prop.visualBoundsMm; ctx.strokeRect(v.x - 45, v.y - 45, v.width + 90, v.height + 90)
    ctx.strokeStyle = '#B0723E'; ctx.lineWidth = 1 / scale; const f = prop.footprintMm, o = prop.footprintOffsetMm; ctx.strokeRect(o.x - f.width / 2, o.y - f.height / 2, f.width, f.height)
  } else if (vertex) handle({ x: vertex.xMm, y: vertex.yMm })
  else if (wall) { const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]; ctx.beginPath(); ctx.moveTo(a.xMm, a.yMm); ctx.lineTo(b.xMm, b.yMm); ctx.stroke(); handle({ x: a.xMm, y: a.yMm }); handle({ x: b.xMm, y: b.yMm }) }
  else if (opening) { const [a, b] = openingEndpointsV2(scene, opening); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); handle(a); handle(b) }
  else if (edge) { const area = scene.terrainAreas[edge.source.areaId], i = area.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId), a = area.boundaryMm[i].positionMm, b = area.boundaryMm[(i + 1) % area.boundaryMm.length].positionMm; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); handle(a); handle(b) }
  else if (connection) { polygon(connectionPolygonV2({ start: connection.from.positionMm, end: connection.to.positionMm, widthMm: connection.widthMm })); handle(connection.from.positionMm); handle(connection.to.positionMm) }
  else if (scatter) {
    if (scatter.domain.kind === 'area' && scene.terrainAreas[scatter.domain.areaId]) polygon(terrainPointsV2(scene.terrainAreas[scatter.domain.areaId]))
    else if (scatter.domain.kind === 'edgeBand') { const e = scene.terrainEdges[scatter.domain.edgeId], a = e && scene.terrainAreas[e.source.areaId], i = a?.boundaryMm.findIndex(p => p.segmentId === e.source.segmentId) ?? -1; if (a && i >= 0) polygon(connectionPolygonV2({ start: a.boundaryMm[i].positionMm, end: a.boundaryMm[(i + 1) % a.boundaryMm.length].positionMm, widthMm: scatter.domain.widthMm })) }
    for (const exclusion of scatter.exclusions) { ctx.strokeStyle = '#A75F45'; polygon(exclusion.boundaryMm) }
    ctx.strokeStyle = '#2C7A65'; for (const member of Object.values(scatter.members)) { const p = member.propId && scene.props[member.propId]; if (p) handle(p.positionMm) }
  }
  else if (room) polygon(roomPointsV2(scene, room))
  else if (area) { polygon(terrainPointsV2(area)); area.boundaryMm.forEach(p => handle(p.positionMm)) }
  else if (prefab) {
    const points = Object.values(prefab.members).flatMap(m => {
      const p = m.propId && scene.props[m.propId]
      if (!p) return []
      const v = p.visualBoundsMm, a = p.rotationDeg * Math.PI / 180
      return [[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]].map(([x, y]) => ({ x: p.positionMm.x + x * Math.cos(a) - y * Math.sin(a), y: p.positionMm.y + x * Math.sin(a) + y * Math.cos(a) }))
    })
    if (points.length) { const b = pointsBoundsV2(points); ctx.strokeRect(b.x - 60, b.y - 60, b.width + 120, b.height + 120) } handle(prefab.anchorMm)
  } else for (const a of Object.values(scene.terrainAreas)) { const p = a.boundaryMm.find(p => p.id === id); if (p) { polygon(terrainPointsV2(a)); handle(p.positionMm); break } }
  ctx.restore()
}

export default function AssetCanvas({ project, selected, onSelect, audience = 'gm', disabled = false, onRenderMetrics, onPaint }: { project: CompleteProjectV2; selected: string | null; onSelect: (id: string | null) => void; audience?: AudienceV2; disabled?: boolean; onRenderMetrics?: RenderOptionsV2['onMetrics']; onPaint?: (revision: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null), viewport = useRef<HTMLDivElement>(null), current = useRef<object | null>(null)
  const [result, setResult] = useState<{ project: CompleteProjectV2; audience: AudienceV2; token: object; image: HTMLCanvasElement } | null>(null), [error, setError] = useState<{ project: CompleteProjectV2; audience: AudienceV2; message: string } | null>(null)
  const [size, setSize] = useState<ViewportSizeV2>({ width: 1, height: 1 }), [view, setView] = useState<MapViewportV2>(FIT_VIEWPORT_V2), [mode, setMode] = useState<'select' | 'pan'>('select'), [dragging, setDragging] = useState(false), [renderCount, setRenderCount] = useState(0)
  const bounds = project.document.exportBoundsMm
  const viewRef = useRef(view), sizeRef = useRef(size), boundsRef = useRef(bounds), readyRef = useRef(false), frame = useRef<number | null>(null)
  const space = useRef(false), suppressClick = useRef(false), releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ pointer: number; x: number; y: number; lastX: number; lastY: number; start: MapViewportV2; original: MapViewportV2 } | null>(null)
  sizeRef.current = size; boundsRef.current = bounds
  const changeView = (next: MapViewportV2) => {
    viewRef.current = constrainViewportV2(next, sizeRef.current, boundsRef.current)
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setView(viewRef.current) })
  }
  const endDrag = (cancel: boolean) => {
    const previous = drag.current
    drag.current = null; space.current = false; setDragging(false)
    if (previous && cancel) changeView(previous.original)
    if (previous && viewport.current?.hasPointerCapture(previous.pointer)) viewport.current.releasePointerCapture(previous.pointer)
    if (releaseTimer.current) clearTimeout(releaseTimer.current)
    releaseTimer.current = setTimeout(() => { suppressClick.current = false }, 0)
  }
  const fit = () => { endDrag(false); changeView({ ...FIT_VIEWPORT_V2 }) }
  const zoom = (factor: number, pointer = { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }) => {
    changeView(zoomViewportV2(viewRef.current, factor, pointer, sizeRef.current, boundsRef.current))
    // A wheel event may arrive between captured pointer moves. Continue from
    // the new zoom and current pointer rather than restoring the old transform.
    const active = drag.current
    if (active) { active.start = { ...viewRef.current }; active.x = active.lastX; active.y = active.lastY }
  }
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const resize = () => {
      const previous = sizeRef.current, next = { width: Math.max(1, node.clientWidth), height: Math.max(1, node.clientHeight) }
      const oldFit = fittedMapSizeV2(previous, boundsRef.current), nextFit = fittedMapSizeV2(next, boundsRef.current)
      const ratio = previous.width > 1 && previous.height > 1 ? nextFit.width / oldFit.width : 1
      const adjusted = constrainViewportV2({ ...viewRef.current, panX: viewRef.current.panX * ratio, panY: viewRef.current.panY * ratio }, next, boundsRef.current)
      sizeRef.current = next; viewRef.current = adjusted; setSize(next); setView(adjusted)
    }
    resize()
    const observer = new ResizeObserver(resize); observer.observe(node)
    const wheel = (event: WheelEvent) => {
      if (!readyRef.current) return
      event.preventDefault()
      const rect = node.getBoundingClientRect(), delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1)
      zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    const blur = () => endDrag(true)
    node.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('blur', blur)
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel); window.removeEventListener('blur', blur); if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }; if (releaseTimer.current) clearTimeout(releaseTimer.current); drag.current = null; space.current = false }
    // Handlers read current ephemeral view/bounds through refs; no scene work on a gesture.
  }, [])
  useLayoutEffect(() => {
    endDrag(false); if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    viewRef.current = { ...FIT_VIEWPORT_V2 }; setView(viewRef.current); setMode('select')
  }, [project.document.sceneId, audience])
  useEffect(() => { endDrag(true) }, [project, disabled])
  useEffect(() => {
    const controller = new AbortController(), token = {}; let image: HTMLCanvasElement | null = null; current.current = token; setResult(null); setError(null)
    void renderProjectV2(project, { audience, longEdgePx: 1200, signal: controller.signal, onMetrics: onRenderMetrics }).then(rendered => {
      image = rendered
      if (controller.signal.aborted || current.current !== token) { image.width = 0; image.height = 0; return }
      setResult({ project, audience, token, image })
      setRenderCount(count => count + 1)
    }).catch(reason => { if (!controller.signal.aborted && current.current === token) setError({ project, audience, message: reason instanceof Error ? reason.message : String(reason) }) })
    return () => { controller.abort(); if (current.current === token) current.current = null; if (image) { image.width = 0; image.height = 0 } }
  }, [project, audience, onRenderMetrics])
  useLayoutEffect(() => {
    if (!canvas.current || !result || result.project !== project || result.audience !== audience || result.token !== current.current) return
    const target = canvas.current; target.width = result.image.width; target.height = result.image.height
    const ctx = target.getContext('2d', { colorSpace: 'srgb' })
    if (!ctx) return
    ctx.drawImage(result.image, 0, 0)
  }, [project, result, audience])
  useLayoutEffect(() => {
    if (!overlay.current || !result || result.project !== project || result.audience !== audience || result.token !== current.current) return
    const target = overlay.current
    if (target.width !== result.image.width || target.height !== result.image.height) { target.width = result.image.width; target.height = result.image.height }
    const ctx = target.getContext('2d', { colorSpace: 'srgb' })
    if (!ctx) return
    ctx.clearRect(0, 0, target.width, target.height)
    const rect = viewportMapRectV2(view, size, bounds)
    if (selected && audience === 'gm' && !disabled) selection(ctx, project.document, selected, rect.width / target.width)
    // Optional tooling observers cannot turn a successful preview into an error.
    try { onPaint?.(project.document.revision) } catch { /* observer only */ }
  }, [project, result, selected, audience, disabled, onPaint, view.zoom, size.width, size.height])
  const ready = result?.project === project && result.audience === audience && result.token === current.current
  readyRef.current = !!ready
  const failed = error?.project === project && error.audience === audience, rect = viewportMapRectV2(view, size, bounds)
  return <div className="asset-map-wrap" aria-busy={!ready && !failed}>
    <div className="asset-viewport-toolbar" role="group" aria-label="地图视口工具">
      <button aria-label="选择地图对象" aria-pressed={mode === 'select'} disabled={!ready || audience === 'player' || disabled} onClick={() => { endDrag(false); setMode('select') }} title="选择对象"><MousePointer2 size={15}/></button>
      <button aria-label="平移地图" aria-pressed={mode === 'pan'} disabled={!ready} onClick={() => { endDrag(false); setMode('pan') }} title="拖动画布"><Hand size={15}/></button>
      <span className="asset-viewport-divider"/>
      <button aria-label="缩小地图" disabled={!ready || view.zoom <= MIN_VIEW_ZOOM_V2} onClick={() => zoom(1 / 1.25)}><ZoomOut size={15}/></button>
      <output aria-label="地图缩放比例" title="相对于适应全图的倍率">{Math.round(view.zoom * 100)}%</output>
      <button aria-label="放大地图" disabled={!ready || view.zoom >= MAX_VIEW_ZOOM_V2} onClick={() => zoom(1.25)}><ZoomIn size={15}/></button>
      <button aria-label="适应全图" disabled={!ready} onClick={fit} title="适应全图（0）"><Maximize size={15}/><span>全图</span></button>
      <span className="asset-viewport-hint">滚轮缩放 · 空格拖动</span>
    </div>
    <div ref={viewport} className={`asset-viewport${mode === 'pan' ? ' is-pan' : ''}${dragging ? ' is-dragging' : ''}`} role="group" aria-label="地图视口" tabIndex={0}
      data-zoom={view.zoom} data-pan-x={view.panX} data-pan-y={view.panY} data-render-count={renderCount}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) endDrag(true) }}
      onContextMenu={event => { if (mode === 'pan' || drag.current) event.preventDefault() }}
      onPointerDown={event => {
        if (!ready || event.button > 1) return
        event.currentTarget.focus({ preventScroll: true })
        if (event.button === 1 || mode === 'pan' || space.current || event.pointerType === 'touch') {
          event.preventDefault(); suppressClick.current = true
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, start: { ...viewRef.current }, original: { ...viewRef.current } }
          event.currentTarget.setPointerCapture(event.pointerId); setDragging(true)
        }
      }}
      onPointerMove={event => { const start = drag.current; if (start?.pointer === event.pointerId) { event.preventDefault(); start.lastX = event.clientX; start.lastY = event.clientY; changeView({ ...start.start, panX: start.start.panX + event.clientX - start.x, panY: start.start.panY + event.clientY - start.y }) } }}
      onPointerUp={event => { if (drag.current?.pointer === event.pointerId) endDrag(false) }}
      onPointerCancel={() => endDrag(true)} onLostPointerCapture={() => { if (drag.current) endDrag(true) }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !ready) return
        if (event.key === 'Escape') { event.preventDefault(); endDrag(true); setMode('select'); return }
        if (event.metaKey || event.ctrlKey || event.altKey) return
        if (event.code === 'Space') { event.preventDefault(); space.current = true; return }
        if (['+', '='].includes(event.key)) { event.preventDefault(); zoom(1.25) }
        else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.25) }
        else if (event.key === '0') { event.preventDefault(); fit() }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault(); const step = event.shiftKey ? 120 : 40
          changeView({ ...viewRef.current, panX: viewRef.current.panX + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), panY: viewRef.current.panY + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) })
        }
      }} onKeyUp={event => { if (event.code === 'Space') { space.current = false; event.preventDefault() } }}
      onClick={event => {
        if (!ready || disabled || audience !== 'gm' || mode === 'pan' || suppressClick.current || !canvas.current) return
        const image = canvas.current.getBoundingClientRect()
        if (event.clientX < image.left || event.clientX > image.right || event.clientY < image.top || event.clientY > image.bottom) { onSelect(null); return }
        const world = { x: bounds.x + (event.clientX - image.left) / image.width * bounds.width, y: bounds.y + (event.clientY - image.top) / image.height * bounds.height }
        onSelect(hitTest(project.document, world, 7 / image.width * bounds.width))
      }}>
      <div className="asset-viewport-image" style={{ width: rect.width, height: rect.height, transform: `translate(${rect.x}px, ${rect.y}px)`, visibility: ready ? 'visible' : 'hidden' }}>
        <canvas ref={canvas} aria-label={audience === 'gm' ? '材质场景主持人预览' : '材质场景玩家预览'}/>
        <canvas ref={overlay} className="asset-selection-overlay" aria-hidden="true"/>
      </div>
      {!ready && <div className="asset-viewport-message"><div className="asset-preview-message" role={failed ? 'alert' : 'status'}>{failed ? <><strong>此场景暂时无法绘制</strong><p>{error.message}</p><p>完整工程仍保留，可继续备份与修改。</p></> : '正在解码素材并绘制场景…'}</div></div>}
    </div>
  </div>
}
