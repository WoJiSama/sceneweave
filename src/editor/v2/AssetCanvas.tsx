import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Hand, Maximize, MousePointer2, ZoomIn, ZoomOut } from 'lucide-react'
import { openingEndpointsV2, roomPointsV2, terrainPointsV2 } from '../../core/v2/geometry'
import type { BoundsMm, PointMm, PropV2, SceneDocumentV2 } from '../../core/v2/types'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { decodePlacementPreviewV2 } from './placement-preview'
import { pointsBoundsV2, projectSceneV2 } from '../../render/v2/projection'
import type { AudienceV2 } from '../../render/v2/projection'
import { connectionPolygonV2, renderEditorProjectV2 } from '../../render/v2/renderer'
import type { EditorRenderOptionsV2, RenderOptionsV2 } from '../../render/v2/renderer'
import type { SelectionOptionsV2 } from './selection'
import { constrainViewportV2, FIT_VIEWPORT_V2, fittedMapSizeV2, MAX_VIEW_ZOOM_V2, MIN_VIEW_ZOOM_V2, viewportMapRectV2, zoomViewportV2 } from './viewport'
import type { MapViewportV2, ViewportSizeV2 } from './viewport'
import type { SelectionSessionV2 } from './selection-session'
import { useSelectionIdsV2 } from './SelectionSubscriber'
import { hitTestAllV2, normalizeSelectionV2, selectInBoundsV2, selectionGeometryV2 } from './selection'
import { summarizeSelectionV2 } from './selection-summary'
import { rectanglePoints, rectangleFromPoints, rulerDistance, snapBuildingPoint, type CanvasWorldTool } from '../v4/building-session'

/** The supported visual subset is checked before editor-only simplification. */
export function previewLimitations(scene: SceneDocumentV2): string[] {
  try { return projectSceneV2(scene, 'gm').limitations }
  catch (error) { return [error instanceof Error ? error.message : String(error)] }
}
function selection(ctx: CanvasRenderingContext2D, scene: SceneDocumentV2, id: string, displayScale = 1, nativeGeometry?: typeof selectionGeometryV2): void {
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
  else if (wall) { const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]; if (nativeGeometry) for (const shape of nativeGeometry(scene, id)) polygon(shape); else { ctx.beginPath(); ctx.moveTo(a.xMm, a.yMm); ctx.lineTo(b.xMm, b.yMm); ctx.stroke() }; handle({ x: a.xMm, y: a.yMm }); handle({ x: b.xMm, y: b.yMm }) }
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

export default function AssetCanvas({ project, selected, onSelect, audience = 'gm', disabled = false, onRenderMetrics, onPaint, placement, onPlace, onPlacementMove, onCancelPlacement, onPlacementReady, onPlacementError, selectedIds, selectionSession, onSelectMany, onContext, memberMode = false, onMemberMode, fitRequest = 0, editorRenderer, selectionOptions, pointHitTest, boundsSelector, selectionGeometry, selectionSummaryReader, worldTool }: { worldTool?: CanvasWorldTool | null; editorRenderer?: (options: EditorRenderOptionsV2) => Promise<HTMLCanvasElement>; selectionOptions?: Omit<SelectionOptionsV2, 'memberMode'>; pointHitTest?: typeof hitTestAllV2; boundsSelector?: typeof selectInBoundsV2; selectionGeometry?: typeof selectionGeometryV2; selectionSummaryReader?: typeof summarizeSelectionV2; selectionSession?: SelectionSessionV2; selectedIds?: string[]; onSelectMany?: (ids: string[]) => void; onContext?: (point: PointMm, hits: string[], position: { x: number; y: number }, origin: HTMLElement) => void; memberMode?: boolean; onMemberMode?: (value: boolean) => void; fitRequest?: number; project: CompleteProjectV2; selected: string | null; onSelect: (id: string | null) => void; audience?: AudienceV2; disabled?: boolean; onRenderMetrics?: RenderOptionsV2['onMetrics']; onPaint?: (revision: number) => void; placement?: PropV2 | null; onPlace?: (positionMm: PointMm) => void; onPlacementMove?: (positionMm: PointMm) => void; onCancelPlacement?: () => void; onPlacementReady?: (ready: boolean) => void; onPlacementError?: (message: string) => void }) {
  const sessionIds = useSelectionIdsV2(selectionSession)
  // The v3 caller supplies a strict renderer; this project is only its domain geometry view.
  const renderPreview = editorRenderer ?? ((options: EditorRenderOptionsV2) => renderEditorProjectV2(project, options))
  const pointHits = pointHitTest ?? hitTestAllV2
  const boundsHits = boundsSelector ?? selectInBoundsV2
  const readGeometry = selectionGeometry ?? selectionGeometryV2
  const readSummary = selectionSummaryReader ?? summarizeSelectionV2
  const ids = audience !== 'gm' ? [] : selectionSession ? sessionIds : selectedIds ?? (selected ? [selected] : [])
  const [operation, setOperation] = useState<'replace' | 'add' | 'subtract'>('replace'), [intersect, setIntersect] = useState(false), [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null), [selectionNotice, setSelectionNotice] = useState('')
  const marqueeRef = useRef<{ pointer: number; x: number; y: number; world: PointMm; ids: string[]; operation: 'replace' | 'add' | 'subtract' } | null>(null)
  const publish = (next: string[]) => { if (onSelectMany) onSelectMany(next); else onSelect(next[0] ?? null) }
  const mergeSelection = (base: readonly string[], found: readonly string[], op: 'replace' | 'add' | 'subtract') => {
    const foundSet = new Set(found)
    return normalizeSelectionV2(project.document, op === 'replace' ? found : op === 'add' ? [...base, ...found] : base.filter(id => !foundSet.has(id)), memberMode).filter(id => !selectionOptions?.hiddenIds?.has(id))
  }
  const cancelMarquee = (suppress = true) => { const active = marqueeRef.current; marqueeRef.current = null; setMarquee(null); if (active && suppress) suppressClick.current = true; if (active && viewport.current?.hasPointerCapture(active.pointer)) viewport.current.releasePointerCapture(active.pointer) }
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null), detailCanvas = useRef<HTMLCanvasElement>(null), viewport = useRef<HTMLDivElement>(null), current = useRef<object | null>(null)
  const [result, setResult] = useState<{ project: CompleteProjectV2; audience: AudienceV2; token: object; image: HTMLCanvasElement } | null>(null), [error, setError] = useState<{ project: CompleteProjectV2; audience: AudienceV2; message: string } | null>(null)
  const [refinement, setRefinement] = useState<{ project: CompleteProjectV2; audience: AudienceV2; bounds: BoundsMm; image: HTMLCanvasElement } | null>(null), [refinementCount, setRefinementCount] = useState(0)
  const [placementImage, setPlacementImage] = useState<{ placementId: string; assetId: string; blob: Blob; bitmap: ImageBitmap } | null>(null)
  const placementAssetId = placement?.appearance.kind === 'image' ? placement.appearance.assetId : null
  const placementAsset = placementAssetId ? project.document.assets[placementAssetId] : null
  const placementBlob = placementAsset ? project.assets[placementAsset.sha256]?.blob : null
  const placementCallbacks = useRef({ onPlacementReady, onPlacementError })
  placementCallbacks.current = { onPlacementReady, onPlacementError }
  useEffect(() => {
    setPlacementImage(null); placementCallbacks.current.onPlacementReady?.(!placementAssetId)
    if (!placementAssetId || audience !== 'gm' || disabled) return
    const abort = new AbortController(); let owned: ImageBitmap | null = null
    void decodePlacementPreviewV2(project, placementAssetId, abort.signal).then(bitmap => {
      if (abort.signal.aborted) { bitmap.close(); return }
      // A single transient preview owns this handle; no cross-project bitmap cache.
      owned = bitmap; setPlacementImage({ placementId: placement!.id, assetId: placementAssetId, blob: placementBlob!, bitmap }); placementCallbacks.current.onPlacementReady?.(true)
    }).catch(error => { if (!abort.signal.aborted) placementCallbacks.current.onPlacementError?.(`待放置素材预览失败：${error instanceof Error ? error.message : String(error)}`) })
    return () => { abort.abort(); owned?.close() }
  }, [project, placement?.id, placementAssetId, audience, disabled])
  const [size, setSize] = useState<ViewportSizeV2>({ width: 1, height: 1 }), [view, setView] = useState<MapViewportV2>(FIT_VIEWPORT_V2), [mode, setMode] = useState<'select' | 'pan'>('select'), [dragging, setDragging] = useState(false), [renderCount, setRenderCount] = useState(0)
  const bounds = project.document.exportBoundsMm
  const selectionSummary = useMemo(() => readSummary(project.document, ids, true), [project.document, ids, readSummary])
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
    if (previous && !cancel) releaseTimer.current = setTimeout(() => { suppressClick.current = false }, 0)
  }
  const fit = () => { cancelMarquee(); endDrag(false); changeView({ ...FIT_VIEWPORT_V2 }) }
  useEffect(() => {
    if (worldTool) { endDrag(false); cancelMarquee(); setMode('select') }
  }, [worldTool?.kind])
  const zoom = (factor: number, pointer = { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }) => {
    cancelMarquee(); changeView(zoomViewportV2(viewRef.current, factor, pointer, sizeRef.current, boundsRef.current))
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
    const blur = () => { endDrag(true); cancelMarquee() }
    node.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('blur', blur)
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel); window.removeEventListener('blur', blur); if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }; if (releaseTimer.current) clearTimeout(releaseTimer.current); drag.current = null; space.current = false }
    // Handlers read current ephemeral view/bounds through refs; no scene work on a gesture.
  }, [])
  useLayoutEffect(() => {
    endDrag(false); if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    viewRef.current = { ...FIT_VIEWPORT_V2 }; setView(viewRef.current); setMode('select')
  }, [project.document.sceneId, audience])
  useEffect(() => { endDrag(true); cancelMarquee() }, [project, disabled, selectionOptions])
  useEffect(() => { if (fitRequest) fit() }, [fitRequest])
  useEffect(() => { if (placement || worldTool) { endDrag(false); setMode('select') } }, [placement?.id, worldTool?.kind])
  useEffect(() => {
    const controller = new AbortController(), token = {}; let image: HTMLCanvasElement | null = null; current.current = token; setResult(null); setError(null)
    void renderPreview({ audience, longEdgePx: 1200, signal: controller.signal, onMetrics: onRenderMetrics }).then(rendered => {
      image = rendered
      if (controller.signal.aborted || current.current !== token) { image.width = 0; image.height = 0; return }
      setResult({ project, audience, token, image })
      setRenderCount(count => count + 1)
    }).catch(reason => { if (!controller.signal.aborted && current.current === token) setError({ project, audience, message: reason instanceof Error ? reason.message : String(reason) }) })
    return () => { controller.abort(); if (current.current === token) current.current = null; if (image) { image.width = 0; image.height = 0 } }
  }, [project, audience, onRenderMetrics, editorRenderer])
  // Keep the existing world raster moving immediately. A bounded visible crop is
  // rebuilt only after the gesture settles; no selection dependency enters here.
  useEffect(() => {
    if (!result || result.project !== project || result.audience !== audience || size.width <= 1 || size.height <= 1 || dragging) return
    const controller = new AbortController(); let image: HTMLCanvasElement | null = null
    const timer = setTimeout(() => {
      const rect = viewportMapRectV2(view, size, bounds), scale = rect.width / bounds.width
      const x = Math.max(bounds.x, bounds.x - rect.x / scale), y = Math.max(bounds.y, bounds.y - rect.y / scale)
      const right = Math.min(bounds.x + bounds.width, bounds.x + (size.width - rect.x) / scale), bottom = Math.min(bounds.y + bounds.height, bounds.y + (size.height - rect.y) / scale)
      if (right <= x || bottom <= y) return
      const crop = { x, y, width: right - x, height: bottom - y }, dpr = Math.min(2, window.devicePixelRatio || 1)
      const longEdgePx = Math.max(256, Math.min(2048, Math.ceil(Math.max(crop.width, crop.height) * scale * dpr)))
      void renderPreview({ audience, longEdgePx, viewBoundsMm: crop, screenScalePxPerMm: scale, signal: controller.signal }).then(rendered => {
        image = rendered
        if (controller.signal.aborted) { rendered.width = 0; rendered.height = 0; return }
        setRefinement({ project, audience, bounds: crop, image: rendered }); setRefinementCount(count => count + 1); setError(null)
      }).catch(reason => { if (!controller.signal.aborted) setError({ project, audience, message: reason instanceof Error ? reason.message : String(reason) }) })
    }, 160)
    return () => { clearTimeout(timer); controller.abort(); if (image) { image.width = 0; image.height = 0 } }
  }, [project, audience, result, view.zoom, view.panX, view.panY, size.width, size.height, dragging, editorRenderer])
  useLayoutEffect(() => {
    // Returning from a candidate can reuse the same project identity after an
    // earlier crop task was disposed. That released canvas must never be read.
    if (!refinement || refinement.project !== project || refinement.audience !== audience || !refinement.image.width || !refinement.image.height || !detailCanvas.current) return
    const target = detailCanvas.current; target.width = refinement.image.width; target.height = refinement.image.height
    target.getContext('2d', { colorSpace: 'srgb' })?.drawImage(refinement.image, 0, 0)
  }, [project, audience, refinement])
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
    if (audience === 'gm' && !disabled) {
      if (ids.length <= 32) for (const id of ids) selection(ctx, project.document, id, rect.width / target.width, selectionGeometry)
      else {
        const scale = rect.width / bounds.width
        ctx.save(); ctx.scale(target.width / bounds.width, target.height / bounds.height); ctx.translate(-bounds.x, -bounds.y)
        ctx.strokeStyle = '#2C7A65'; ctx.lineWidth = 2 / scale; ctx.setLineDash([7 / scale, 5 / scale])
        if (ids.length > 256) {
          const b = selectionSummary.boundsMm
          if (b) ctx.strokeRect(b.x - 3 / scale, b.y - 3 / scale, b.width + 6 / scale, b.height + 6 / scale)
        } else {
          const path = new Path2D(), visible = { x: bounds.x - rect.x / scale, y: bounds.y - rect.y / scale, width: size.width / scale, height: size.height / scale }
          for (const id of ids) for (const polygon of readGeometry(project.document, id)) {
            const b = pointsBoundsV2(polygon)
            if (b.x + b.width < visible.x || b.y + b.height < visible.y || b.x > visible.x + visible.width || b.y > visible.y + visible.height) continue
            polygon.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); if (polygon.length > 2) path.closePath()
          }
          ctx.stroke(path)
        }
        ctx.restore()
      }
    }
    if (placement && audience === 'gm' && !disabled) {
      ctx.save(); ctx.scale(target.width / bounds.width, target.height / bounds.height); ctx.translate(-bounds.x, -bounds.y)
      ctx.translate(placement.positionMm.x, placement.positionMm.y); ctx.rotate(placement.rotationDeg * Math.PI / 180)
      const visual = placement.visualBoundsMm, footprint = placement.footprintMm, offset = placement.footprintOffsetMm
      if (placementImage && placementImage.placementId === placement.id && placementImage.assetId === placementAssetId && placementImage.blob === placementBlob && placementImage.bitmap.width > 0 && placementImage.bitmap.height > 0) { ctx.globalAlpha = .7 * placement.appearance.opacity; ctx.drawImage(placementImage.bitmap, visual.x, visual.y, visual.width, visual.height); ctx.globalAlpha = 1 }
      const scale = target.width / bounds.width * rect.width / target.width
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = '#2C7A65'; ctx.setLineDash([6 / scale, 4 / scale]); ctx.strokeRect(visual.x, visual.y, visual.width, visual.height)
      ctx.strokeStyle = '#B0723E'; ctx.strokeRect(offset.x - footprint.width / 2, offset.y - footprint.height / 2, footprint.width, footprint.height)
      ctx.restore()
    }
    // Optional tooling observers cannot turn a successful preview into an error.
    try { onPaint?.(project.document.revision) } catch { /* observer only */ }
  }, [project, result, selected, selectedIds, sessionIds, selectionSummary, readGeometry, audience, disabled, onPaint, view.zoom, view.panX, view.panY, size.width, size.height, placement, placementImage])
  const failed = error?.project === project && error.audience === audience
  const ready = !failed && result?.project === project && result.audience === audience && result.token === current.current
  readyRef.current = !!ready
  const rect = viewportMapRectV2(view, size, bounds)
  const refinementBounds = refinement?.project === project && refinement.audience === audience && refinement.image.width > 0 && refinement.image.height > 0 ? refinement.bounds : null
  const pointerWorld = (clientX: number, clientY: number): PointMm | null => {
    const image = canvas.current?.getBoundingClientRect()
    if (!image || clientX < image.left || clientX > image.right || clientY < image.top || clientY > image.bottom) return null
    return { x: Math.round(bounds.x + (clientX - image.left) / image.width * bounds.width), y: Math.round(bounds.y + (clientY - image.top) / image.height * bounds.height) }
  }
  const selectAll = () => {
    const floors = Object.values(project.document.floors).map(floor => floor.boundsMm), boxes = [bounds, ...floors]
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)), right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height))
    const found = boundsHits(project.document, { x, y, width: right - x, height: bottom - y }, 'intersect', { ...selectionOptions, memberMode })
    publish(found.ids); setSelectionNotice(`全选 ${found.ids.length} 个对象；排除锁定 ${found.excludedLocked} 个、隐藏 ${found.excludedHidden} 个。`)
  }
  return <div className="asset-map-wrap" aria-busy={!ready && !failed}>
    <div className="asset-viewport-toolbar" role="group" aria-label="地图视口工具">
      <button aria-label="选择地图对象" aria-pressed={mode === 'select'} disabled={!ready || audience === 'player' || disabled} onClick={() => { endDrag(false); setMode('select'); onCancelPlacement?.(); worldTool?.onCancel() }} title="选择对象"><MousePointer2 size={15}/></button>
      <button aria-label="平移地图" aria-pressed={mode === 'pan'} disabled={!ready} onClick={() => { endDrag(false); setMode('pan'); worldTool?.onCancel() }} title="拖动画布"><Hand size={15}/></button>
      <span className="asset-viewport-divider"/>
      <button aria-label="缩小地图" disabled={!ready || view.zoom <= MIN_VIEW_ZOOM_V2} onClick={() => zoom(1 / 1.25)}><ZoomOut size={15}/></button>
      <output aria-label="地图缩放比例" title="相对于适应全图的倍率">{Math.round(view.zoom * 100)}%</output>
      <button aria-label="放大地图" disabled={!ready || view.zoom >= MAX_VIEW_ZOOM_V2} onClick={() => zoom(1.25)}><ZoomIn size={15}/></button>
      <button aria-label="适应全图" disabled={!ready} onClick={fit} title="适应全图（0）"><Maximize size={15}/><span>全图</span></button>
      {audience === 'gm' && <><button aria-label="全选可编辑对象" disabled={!ready || disabled || !!placement || !!worldTool} onClick={selectAll}>全选</button><span className="asset-viewport-divider"/>{(['replace', 'add', 'subtract'] as const).map(value => <button key={value} aria-label={{ replace: '替换选择', add: '增加选择', subtract: '减去选择' }[value]} aria-pressed={operation === value} disabled={disabled || !!placement || !!worldTool} onClick={() => setOperation(value)}>{{ replace: '替换', add: '增加', subtract: '减去' }[value]}</button>)}<label><input type="checkbox" aria-label="包含相交对象" checked={intersect} disabled={disabled || !!placement || !!worldTool} onChange={event => setIntersect(event.target.checked)}/>相交</label><label><input type="checkbox" aria-label="选择组合成员" checked={memberMode} disabled={disabled || !!placement || !!worldTool} onChange={event => onMemberMode?.(event.target.checked)}/>成员</label></>}
      <span className="asset-viewport-hint">{worldTool ? worldTool.kind === 'ruler' ? '量尺 · 点击两点 · Escape 退出' : '点击绘图 · 按网格吸附 · Escape 退出' : placement ? '点击放置 · Escape 取消 · 空格拖动' : '滚轮缩放 · 空格拖动'}</span>
    </div>
    <div ref={viewport} className={`asset-viewport${mode === 'pan' ? ' is-pan' : ''}${dragging ? ' is-dragging' : ''}${worldTool ? ' building-world-tool' : ''}`} role="group" aria-label="地图视口" tabIndex={0}
      data-selected-ids={JSON.stringify(ids)} data-selection-detail={ids.length > 256 ? 'bounds' : ids.length > 32 ? 'outlines' : 'handles'} data-zoom={view.zoom} data-pan-x={view.panX} data-pan-y={view.panY} data-render-count={renderCount} data-refinement-count={refinementCount}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { endDrag(true); cancelMarquee() } }}
      onContextMenu={event => {
        if (!ready || disabled || audience !== 'gm' || placement || worldTool || mode === 'pan' || drag.current || marqueeRef.current) return
        const point = pointerWorld(event.clientX, event.clientY)
        if (!point || !onContext) return
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true })
        onContext(point, pointHits(project.document, point, 7 / canvas.current!.getBoundingClientRect().width * bounds.width, { ...selectionOptions, memberMode }), { x: event.clientX, y: event.clientY }, event.currentTarget)
      }}
      onPointerDown={event => {
        if (!ready || event.button > 1) return
        suppressClick.current = false
        event.currentTarget.focus({ preventScroll: true })
        if (event.button === 1 || mode === 'pan' || space.current || event.pointerType === 'touch') {
          event.preventDefault(); suppressClick.current = true
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, start: { ...viewRef.current }, original: { ...viewRef.current } }
          cancelMarquee(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true)
        } else if (!disabled && audience === 'gm' && !placement && !worldTool) {
          const world = pointerWorld(event.clientX, event.clientY)
          if (world) { marqueeRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, world, ids: [...ids], operation: event.altKey ? 'subtract' : event.shiftKey ? 'add' : operation }; event.currentTarget.setPointerCapture(event.pointerId) }
        }
      }}
      onPointerMove={event => {
        const start = drag.current
        if (start?.pointer === event.pointerId) { event.preventDefault(); start.lastX = event.clientX; start.lastY = event.clientY; changeView({ ...start.start, panX: start.start.panX + event.clientX - start.x, panY: start.start.panY + event.clientY - start.y }) }
        else if (marqueeRef.current?.pointer === event.pointerId) {
          const active = marqueeRef.current, b = event.currentTarget.getBoundingClientRect()
          if (Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 4) setMarquee({ x: Math.min(active.x, event.clientX) - b.left, y: Math.min(active.y, event.clientY) - b.top, width: Math.abs(event.clientX - active.x), height: Math.abs(event.clientY - active.y) })
        }
        else if (ready && worldTool && !disabled && audience === 'gm' && mode === 'select') { const point = pointerWorld(event.clientX, event.clientY); if (point) worldTool.onMove(snapBuildingPoint(point, worldTool.snapMm)) }
        else if (ready && placement && !disabled && audience === 'gm' && mode === 'select') { const point = pointerWorld(event.clientX, event.clientY); if (point) onPlacementMove?.(point) }
      }}
      onPointerUp={event => {
        if (drag.current?.pointer === event.pointerId) endDrag(false)
        const active = marqueeRef.current
        if (active?.pointer === event.pointerId) {
          if (Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 4) {
            const image = canvas.current!.getBoundingClientRect(), point = { x: bounds.x + (event.clientX - image.left) / image.width * bounds.width, y: bounds.y + (event.clientY - image.top) / image.height * bounds.height }
            const selected = boundsHits(project.document, { x: Math.min(active.world.x, point.x), y: Math.min(active.world.y, point.y), width: Math.abs(point.x - active.world.x), height: Math.abs(point.y - active.world.y) }, intersect ? 'intersect' : 'contain', { ...selectionOptions, memberMode })
            publish(mergeSelection(active.ids, selected.ids, active.operation)); setSelectionNotice(`框选 ${selected.ids.length} 个对象；排除锁定 ${selected.excludedLocked} 个、隐藏 ${selected.excludedHidden} 个。`)
            suppressClick.current = true; if (releaseTimer.current) clearTimeout(releaseTimer.current); releaseTimer.current = setTimeout(() => { suppressClick.current = false }, 0)
          }
          cancelMarquee(Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 4)
        }
      }}
      onPointerCancel={() => { endDrag(true); cancelMarquee(); suppressClick.current = true }} onLostPointerCapture={() => { if (drag.current) endDrag(true); if (marqueeRef.current) { cancelMarquee(); suppressClick.current = true } }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !ready) return
        if (event.key === 'Escape') { event.preventDefault(); if (marqueeRef.current) suppressClick.current = true; cancelMarquee(); endDrag(true); setMode('select'); onCancelPlacement?.(); worldTool?.onCancel(); return }
        if ((event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) && !disabled && audience === 'gm' && !placement && !worldTool && onContext) {
          event.preventDefault(); const image = canvas.current!.getBoundingClientRect(), prop = ids.length === 1 ? project.document.props[ids[0]] : null, point = prop?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
          onContext(point, ids.length ? [...ids] : pointHits(project.document, point, 7 / image.width * bounds.width, { ...selectionOptions, memberMode }), { x: image.left + (point.x - bounds.x) / bounds.width * image.width, y: image.top + (point.y - bounds.y) / bounds.height * image.height }, event.currentTarget); return
        }
        if (event.key === 'Enter' && worldTool?.onFinish && !disabled) { event.preventDefault(); worldTool.onFinish(); return }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !disabled && audience === 'gm' && !placement && !worldTool) { event.preventDefault(); selectAll(); return }
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
      onDoubleClick={event => {
        if (!ready || disabled || audience !== 'gm' || mode !== 'select' || placement || worldTool) return
        const point = pointerWorld(event.clientX, event.clientY)
        if (!point) return
        const id = pointHits(project.document, point, 7 / canvas.current!.getBoundingClientRect().width * bounds.width, { ...selectionOptions, memberMode: true })[0]
        if (id && project.document.props[id] && Object.values(project.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))) { onMemberMode?.(true); publish([id]) }
      }}
      onClick={event => {
        if (!ready || disabled || audience !== 'gm' || mode === 'pan' || suppressClick.current || !canvas.current) return
        if (worldTool) { const point = pointerWorld(event.clientX, event.clientY); if (point) worldTool.onPoint(snapBuildingPoint(point, worldTool.snapMm)); return }
        if (placement) { const point = pointerWorld(event.clientX, event.clientY); if (point) onPlace?.(point); return }
        const image = canvas.current.getBoundingClientRect()
        if (event.clientX < image.left || event.clientX > image.right || event.clientY < image.top || event.clientY > image.bottom) { publish(mergeSelection(ids, [], event.altKey ? 'subtract' : event.shiftKey ? 'add' : operation)); return }
        const world = { x: bounds.x + (event.clientX - image.left) / image.width * bounds.width, y: bounds.y + (event.clientY - image.top) / image.height * bounds.height }
        const hit = pointHits(project.document, world, 7 / image.width * bounds.width, { ...selectionOptions, memberMode })[0]
        publish(mergeSelection(ids, hit ? [hit] : [], event.altKey ? 'subtract' : event.shiftKey ? 'add' : operation))
      }}>
      <div className="asset-viewport-image" style={{ width: rect.width, height: rect.height, transform: `translate(${rect.x}px, ${rect.y}px)`, visibility: ready ? 'visible' : 'hidden' }}>
        <canvas ref={canvas} aria-label={audience === 'gm' ? '材质场景主持人预览' : '材质场景玩家预览'}/>
        <canvas ref={detailCanvas} className="asset-detail-preview" aria-hidden="true" style={refinementBounds ? { left: `${(refinementBounds.x - bounds.x) / bounds.width * 100}%`, top: `${(refinementBounds.y - bounds.y) / bounds.height * 100}%`, width: `${refinementBounds.width / bounds.width * 100}%`, height: `${refinementBounds.height / bounds.height * 100}%` } : { display: 'none' }}/>
        <canvas ref={overlay} className="asset-selection-overlay" aria-hidden="true"/>
        {worldTool && audience === 'gm' && !disabled && <svg className="asset-selection-overlay" data-testid="building-sketch" aria-hidden="true" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {(() => {
            const points = [...worldTool.points]
            if (worldTool.cursor && (worldTool.kind === 'polygon' || points.length === 1)) points.push(worldTool.cursor)
            const path = worldTool.kind === 'rectangle' && points.length >= 2 ? rectanglePoints(rectangleFromPoints(points[0], points[1])) : points
            const unit = bounds.width / rect.width
            return <><polyline points={path.map(p => `${p.x},${p.y}`).join(' ')} fill={worldTool.kind === 'ruler' ? 'none' : '#5c865722'} stroke="#3c7650" strokeWidth={2 * unit} strokeDasharray={`${7 * unit} ${4 * unit}`}/>{worldTool.kind === 'rectangle' && path.length === 4 && <line x1={path[3].x} y1={path[3].y} x2={path[0].x} y2={path[0].y} stroke="#3c7650" strokeWidth={2 * unit}/>}{worldTool.points.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r={4 * unit} fill="#f9f7e8" stroke="#3c7650" strokeWidth={2 * unit}/>)}{worldTool.kind === 'ruler' && points.length >= 2 && <text x={(points[0].x + points[1].x) / 2} y={(points[0].y + points[1].y) / 2 - 10 * unit} textAnchor="middle" fontSize={14 * unit} fill="#355e34" stroke="#fffcee" strokeWidth={3 * unit} paintOrder="stroke">{(rulerDistance(points[0], points[1]).distanceMm / 1000).toFixed(3)} m</text>}</>
          })()}
        </svg>}
      </div>
      {marquee && <div className="asset-marquee" data-testid="selection-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}/> }
      {!ready && <div className="asset-viewport-message"><div className="asset-preview-message" role={failed ? 'alert' : 'status'}>{failed ? <><strong>此场景暂时无法绘制</strong><p>{error.message}</p><p>完整工程仍保留，可继续备份与修改。</p></> : '正在解码素材并绘制场景…'}</div></div>}
    </div>
    <div className="asset-selection-notice" role="status">{worldTool ? worldTool.kind === 'ruler' ? '量尺只在本次会话显示，不写入工程或 PNG。' : '按网格吸附顶点，在建筑面板预览并采用；当前工程尚未改变。' : selectionNotice || (audience === 'gm' ? '单击选择 · 拖动框选 · Shift 增选 · Option/Alt 减选' : '玩家预览仅提供视口操作')}</div>
  </div>
}
