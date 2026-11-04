import type { VisualBoundary } from '../../shared/visual/types'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hand, Maximize, MousePointer2, ZoomIn, ZoomOut } from 'lucide-react'
import { connectionFootprint, openingEndpoints as openingEndpointsV2, propFootprint, roomPoints as roomPointsV2, terrainPoints as terrainPointsV2 } from '../../shared/geometry/geometry.js'
import type { BoundsMm, PointMm, Prop as PropV2, SceneDocument as SceneDocumentV2 } from '../../shared/model/scene.js'
import type { EditableProject as CompleteProjectV2 } from '../../application/workspace/project'
import { toBundle } from '../../application/workspace/project'
import { decodePlacementPreviewV2 } from './placement-preview'
import { pointsBoundsV2, projectSceneV2 } from './projection'
import type { AudienceV2, ProjectedWallV2 } from './projection'
import { connectionPolygonV2, renderEditorProjectV2, wallGeometryV2 } from '../../platform/browser/render/renderer'
import type { EditorRenderOptionsV2, RenderOptionsV2 } from '../../platform/browser/render/renderer'
import type { SelectionOptionsV2 } from './selection'
import { constrainViewportV2, FIT_VIEWPORT_V2, MAX_VIEW_ZOOM_V2, MIN_VIEW_ZOOM_V2, resizeViewportV2, viewportMapRectV2, zoomViewportV2 } from './viewport'
import type { MapViewportV2, ViewportSizeV2 } from './viewport'
import type { SelectionSessionV2 } from './selection-session'
import { useSelectionIdsV2 } from './SelectionSubscriber'
import { effectiveEditLockedV2, hitTestAllV2, normalizeSelectionV2, selectInBoundsV2, selectionGeometryV2 } from './selection'
import { decorationPaintGeometry, decorationPaintPolygon } from '../../shared/decorations/presentation.js'
import { summarizeSelectionV2 } from './selection-summary'
import { finishOrthogonalBoundary, formatDistanceMm, normalizeSketchPoint, rectanglePoints, rectangleFromPoints, rulerDistance, wallDragOffset, type CanvasWorldTool } from './building-session'
import { inspectFillCopy, type FillCopyReport } from '../../application/workspace/fill-copy'
import { snapSubgridPoint, type SubgridSnap } from './subgrid'
import { buildingDependants } from '../../shared/commands/building.js'

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
  } else if (scene.decorations?.[id]) { polygon(decorationPaintPolygon(decorationPaintGeometry(scene, scene.decorations[id]))); handle(scene.decorations[id].positionMm) }
  else if (scene.decorationClusters?.[id]) { for (const shape of (nativeGeometry ?? selectionGeometryV2)(scene, id)) polygon(shape) }
  else if (vertex) handle({ x: vertex.xMm, y: vertex.yMm })
  else if (wall) { const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]; if (nativeGeometry) for (const shape of nativeGeometry(scene, id)) polygon(shape); else { ctx.beginPath(); ctx.moveTo(a.xMm, a.yMm); ctx.lineTo(b.xMm, b.yMm); ctx.stroke() }; handle({ x: a.xMm, y: a.yMm }); handle({ x: b.xMm, y: b.yMm }) }
  else if (opening) { const [a, b] = openingEndpointsV2(scene, opening); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); handle(a); handle(b) }
  else if (edge) { const area = scene.terrainAreas[edge.source.areaId], i = area.boundaryMm.findIndex(p => p.segmentId === edge.source.segmentId), a = area.boundaryMm[i].positionMm, b = area.boundaryMm[(i + 1) % area.boundaryMm.length].positionMm; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); handle(a); handle(b) }
  else if (connection) { polygon(connectionFootprint(connection)); const controls = connection.route ? connection.route.segments.flatMap((segment, i) => [...(i ? [] : [segment.start]), segment.control1, segment.control2, segment.end]) : [connection.from.positionMm, connection.to.positionMm]; for (const p of new Map(controls.map(p => [`${p.x},${p.y}`, p])).values()) handle(p) }
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

export interface CanvasTerrainBrush {
  radiusMm: number
  strokes: readonly { pointsMm: readonly PointMm[]; radiusMm: number }[]
  scope?: BoundsMm
  label: string
  onStroke: (points: PointMm[]) => void
  onError?: (message: string) => void
  onCancel: () => void
}

export interface CanvasFillCopy {
  sourceId: string
  count: number
  allowOverlap: boolean
  onPreview: (stepMm: PointMm, report: FillCopyReport) => void
  onCancel: () => void
}

export default function AssetCanvas({ project, selected, onSelect, audience = 'gm', groundView = false, disabled = false, onRenderMetrics, onPaint, placement, fillCopy, onFillCopyCancel, onFillCopyPreview, onPlace, onPlacementMove, onCancelPlacement, onPlacementReady, onPlacementError, selectedIds, selectionSession, onSelectMany, onContext, memberMode = false, onMemberMode, fitRequest = 0, editorRenderer, selectionOptions, pointHitTest, boundsSelector, selectionGeometry, selectionSummaryReader, worldTool, terrainBrush, visualBoundary, onVisualBoundaryChange, onVisualBoundaryFinish, onWallDragPreview, toolControlsTarget, viewControlsTarget }: { groundView?: boolean; terrainBrush?: CanvasTerrainBrush | null; fillCopy?: Omit<CanvasFillCopy, 'onPreview' | 'onCancel'> | null; onFillCopyPreview?: CanvasFillCopy['onPreview']; onFillCopyCancel?: () => void; onVisualBoundaryFinish?: (value: VisualBoundary) => void; onWallDragPreview?: (wallId: string, offsetMm: PointMm) => void; visualBoundary?: VisualBoundary | null; onVisualBoundaryChange?: (value: VisualBoundary) => void; toolControlsTarget?: HTMLElement | null; viewControlsTarget?: HTMLElement | null; worldTool?: CanvasWorldTool | null; editorRenderer?: (options: EditorRenderOptionsV2) => Promise<HTMLCanvasElement>; selectionOptions?: Omit<SelectionOptionsV2, 'memberMode'>; pointHitTest?: typeof hitTestAllV2; boundsSelector?: typeof selectInBoundsV2; selectionGeometry?: typeof selectionGeometryV2; selectionSummaryReader?: typeof summarizeSelectionV2; selectionSession?: SelectionSessionV2; selectedIds?: string[]; onSelectMany?: (ids: string[]) => void; onContext?: (point: PointMm, hits: string[], position: { x: number; y: number }, origin: HTMLElement) => void; memberMode?: boolean; onMemberMode?: (value: boolean) => void; fitRequest?: number; project: CompleteProjectV2; selected: string | null; onSelect: (id: string | null) => void; audience?: AudienceV2; disabled?: boolean; onRenderMetrics?: RenderOptionsV2['onMetrics']; onPaint?: (revision: number) => void; placement?: PropV2 | null; onPlace?: (positionMm: PointMm) => void; onPlacementMove?: (positionMm: PointMm) => void; onCancelPlacement?: () => void; onPlacementReady?: (ready: boolean) => void; onPlacementError?: (message: string) => void }) {
  const brushDrag = useRef<{ pointer: number; points: PointMm[] } | null>(null)
  const [brushPoints, setBrushPoints] = useState<PointMm[]>([]), [brushCursor, setBrushCursor] = useState<PointMm | null>(null)
  const cancelBrushStroke = () => { const active = brushDrag.current; brushDrag.current = null; setBrushPoints([]); if (active && resumeRefinement.current) { resumeRefinement.current = false; setRefinementTick(value => value + 1) }; if (active && viewport.current?.hasPointerCapture(active.pointer)) viewport.current.releasePointerCapture(active.pointer) }
  const visualDrag = useRef<{ pointer: number; segment: number; key: 'start' | 'control1' | 'control2' | 'end'; original: VisualBoundary; current: VisualBoundary } | null>(null)
  const visualCallbacks = useRef({ onVisualBoundaryChange }); visualCallbacks.current = { onVisualBoundaryChange }
  const cancelVisualDrag = () => { const active = visualDrag.current; visualDrag.current = null; if (active) visualCallbacks.current.onVisualBoundaryChange?.(active.original) }
  const wallDrag = useRef<{ pointer: number; owner: SVGSVGElement; wallId: string; document: SceneDocumentV2; startMm: PointMm; offsetMm: PointMm; snapMm: number; floorBounds: BoundsMm; endpoints: PointMm[] } | null>(null)
  const [wallOffsetMm, setWallOffsetMm] = useState<PointMm | null>(null)
  const cancelWallDrag = () => {
    const active = wallDrag.current
    wallDrag.current = null; setWallOffsetMm(null)
    if (active && active.owner.hasPointerCapture(active.pointer)) active.owner.releasePointerCapture(active.pointer)
    if (active && resumeRefinement.current) { resumeRefinement.current = false; setRefinementTick(value => value + 1) }
    if (active) suppressClick.current = true
  }
  const sessionIds = useSelectionIdsV2(selectionSession)
  // The caller supplies the complete native-v1 project and its immutable resource port.
  const renderPreview = editorRenderer ?? ((options: EditorRenderOptionsV2) => renderEditorProjectV2(toBundle(project), options))
  const pointHits = pointHitTest ?? hitTestAllV2
  const boundsHits = boundsSelector ?? selectInBoundsV2
  const readGeometry = selectionGeometry ?? selectionGeometryV2
  const readSummary = selectionSummaryReader ?? summarizeSelectionV2
  const ids = audience !== 'gm' ? [] : selectionSession ? sessionIds : selectedIds ?? (selected ? [selected] : [])
  const [operation, setOperation] = useState<'replace' | 'add' | 'subtract'>('replace'), [intersect, setIntersect] = useState(false), [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null), [selectionNotice, setSelectionNotice] = useState('')
  const [subgrid, setSubgrid] = useState<SubgridSnap | null>(null), [fillReport, setFillReport] = useState<FillCopyReport | null>(null)
  useEffect(() => {
    if (subgrid && project.document.units.gridSizeMm < subgrid.divisions) {
      setSubgrid(null)
      setSelectionNotice('当前格距无法提供互不重复的整数毫米子格，已关闭子格吸附。')
    }
  }, [project.document.units.gridSizeMm, subgrid])
  const fillDrag = useRef<{ pointer: number; anchor: PointMm; stepMm: PointMm; report: FillCopyReport | null } | null>(null)
  const marqueeRef = useRef<{ pointer: number; x: number; y: number; world: PointMm; ids: string[]; operation: 'replace' | 'add' | 'subtract' } | null>(null)
  const selectingRef = useRef(false)
  const resumeRefinement = useRef(false)
  const refinementTask = useRef<{ timer: ReturnType<typeof setTimeout>; controller: AbortController } | null>(null)
  const publish = (next: string[]) => { if (onSelectMany) onSelectMany(next); else onSelect(next[0] ?? null) }
  const mergeSelection = (base: readonly string[], found: readonly string[], op: 'replace' | 'add' | 'subtract') => {
    const foundSet = new Set(found)
    return normalizeSelectionV2(project.document, op === 'replace' ? found : op === 'add' ? [...base, ...found] : base.filter(id => !foundSet.has(id)), memberMode).filter(id => !selectionOptions?.hiddenIds?.has(id))
  }
  const cancelRefinement = () => {
    const task = refinementTask.current
    if (!task) return
    clearTimeout(task.timer); task.controller.abort(); refinementTask.current = null; resumeRefinement.current = true
  }
  const cancelMarquee = (suppress = true) => { const active = marqueeRef.current; marqueeRef.current = null; selectingRef.current = false; setMarquee(null); if (active && resumeRefinement.current) { resumeRefinement.current = false; setRefinementTick(value => value + 1) }; if (active && suppress) suppressClick.current = true; if (active && viewport.current?.hasPointerCapture(active.pointer)) viewport.current.releasePointerCapture(active.pointer) }
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null), detailCanvas = useRef<HTMLCanvasElement>(null), viewport = useRef<HTMLDivElement>(null), current = useRef<object | null>(null)
  const [result, setResult] = useState<{ project: CompleteProjectV2; audience: AudienceV2; token: object; image: HTMLCanvasElement } | null>(null), [error, setError] = useState<{ project: CompleteProjectV2; audience: AudienceV2; message: string } | null>(null)
  const [refinement, setRefinement] = useState<{ project: CompleteProjectV2; audience: AudienceV2; bounds: BoundsMm; screenScalePxPerMm: number; image: HTMLCanvasElement } | null>(null), [refinementCount, setRefinementCount] = useState(0), [refinementTick, setRefinementTick] = useState(0), [refinementPending, setRefinementPending] = useState(false)
  const [placementImage, setPlacementImage] = useState<{ placementId: string; assetId: string; resourcePort: CompleteProjectV2['resources']; bitmap: ImageBitmap } | null>(null)
  const placementAssetId = placement?.appearance.kind === 'image' ? placement.appearance.assetId : null
  const placementAsset = placementAssetId ? project.document.assets[placementAssetId] : null
  const placementBlob = placementAsset ? project.resources : null
  const placementCallbacks = useRef({ onPlacementReady, onPlacementError })
  placementCallbacks.current = { onPlacementReady, onPlacementError }
  useEffect(() => {
    setPlacementImage(null); placementCallbacks.current.onPlacementReady?.(!placementAssetId)
    if (!placementAssetId || audience !== 'gm' || disabled) return
    const abort = new AbortController(); let owned: ImageBitmap | null = null
    void decodePlacementPreviewV2(project, placementAssetId, abort.signal).then(bitmap => {
      if (abort.signal.aborted) { bitmap.close(); return }
      // A single transient preview owns this handle; no cross-project bitmap cache.
      owned = bitmap; setPlacementImage({ placementId: placement!.id, assetId: placementAssetId, resourcePort: placementBlob!, bitmap }); placementCallbacks.current.onPlacementReady?.(true)
    }).catch(error => { if (!abort.signal.aborted) placementCallbacks.current.onPlacementError?.(`待放置素材预览失败：${error instanceof Error ? error.message : String(error)}`) })
    return () => { abort.abort(); owned?.close() }
  }, [project, placement?.id, placementAssetId, audience, disabled])
  const [size, setSize] = useState<ViewportSizeV2>({ width: 1, height: 1 }), [view, setView] = useState<MapViewportV2>(FIT_VIEWPORT_V2), [mode, setMode] = useState<'select' | 'pan'>('select'), [dragging, setDragging] = useState(false), [renderCount, setRenderCount] = useState(0)
  const bounds = project.document.exportBoundsMm
  const fillAnchorReport = useMemo(() => {
    if (!fillCopy) return null
    try { return inspectFillCopy(project.document, { sourceId: fillCopy.sourceId, count: 1, stepMm: { x: 1, y: 0 }, allowOverlap: true }) }
    catch { return null }
  }, [project.document, fillCopy?.sourceId])
  const snapPoint = (point: PointMm) => subgrid ? snapSubgridPoint(point, project.document.units.gridSizeMm, subgrid) : { x: Math.round(point.x), y: Math.round(point.y) }
  const selectionSummary = useMemo(() => readSummary(project.document, ids, true), [project.document, ids, readSummary])
  const selectedWall = ids.length === 1 ? project.document.walls[ids[0]] : null
  const selectedWallEndpoints = selectedWall ? [project.document.vertices[selectedWall.startVertexId], project.document.vertices[selectedWall.endVertexId]] : null
  const wallCanDrag = useMemo(() => {
    if (!selectedWall || !onWallDragPreview || audience !== 'gm' || disabled || placement || fillCopy || worldTool || terrainBrush || visualBoundary || selectionOptions?.hiddenIds?.has(selectedWall.id)) return false
    if (effectiveEditLockedV2(project.document, selectedWall.id)) return false
    return buildingDependants(project.document, [selectedWall.id]).every(id => !effectiveEditLockedV2(project.document, id) && !project.document.userLayers[project.document.entityLayers[id]]?.editLocked)
  }, [project.document, selectedWall?.id, onWallDragPreview, audience, disabled, placement, fillCopy, worldTool, terrainBrush, visualBoundary, selectionOptions])
  const wallOverlay = useMemo(() => {
    if (!selectedWall || !wallOffsetMm) return null
    const scene = project.document, moved = new Set([selectedWall.startVertexId, selectedWall.endVertexId]), offset = wallOffsetMm
    const vertices = { ...scene.vertices }
    for (const id of moved) vertices[id] = { ...vertices[id], xMm: vertices[id].xMm + offset.x, yMm: vertices[id].yMm + offset.y }
    const temporary = { ...scene, vertices }, affectedWalls = Object.values(scene.walls).filter(wall => moved.has(wall.startVertexId) || moved.has(wall.endVertexId))
    const joins = new Set(affectedWalls.flatMap(wall => [wall.startVertexId, wall.endVertexId]))
    const visible = new Set(Object.values(scene.walls).filter(wall => wall.floorId === selectedWall.floorId && (joins.has(wall.startVertexId) || joins.has(wall.endVertexId)) && !selectionOptions?.hiddenIds?.has(wall.id)).map(wall => wall.id))
    const walls: ProjectedWallV2[] = Object.values(scene.walls).filter(wall => wall.floorId === selectedWall.floorId).map(wall => ({
      id: wall.id, sourceIds: [wall.id], start: { x: vertices[wall.startVertexId].xMm, y: vertices[wall.startVertexId].yMm }, end: { x: vertices[wall.endVertexId].xMm, y: vertices[wall.endVertexId].yMm }, thicknessMm: wall.thicknessMm, style: wall.topStyle,
      openings: Object.values(scene.openings).filter(opening => opening.wallId === wall.id).map(opening => { const [start, end] = openingEndpointsV2(temporary, opening); return { id: opening.id, start, end, widthMm: opening.widthMm, kind: opening.kind, state: opening.state, secret: opening.secret } }),
    }))
    let polygons: PointMm[][] = []
    try { polygons = wallGeometryV2(walls).filter(row => visible.has(row.wall.id)).flatMap(row => row.polygons) } catch { /* Degenerate intermediate outlines remain visibly invalid until domain preview. */ }
    return { walls: walls.filter(wall => visible.has(wall.id)), polygons, endpoints: [...moved].map(id => ({ x: vertices[id].xMm, y: vertices[id].yMm })),
      rooms: Object.values(scene.rooms).filter(room => room.boundaryVertexIds.some(id => moved.has(id)) && !selectionOptions?.hiddenIds?.has(room.id)).map(room => roomPointsV2(temporary, room)) }
  }, [project.document, selectedWall?.id, wallOffsetMm, selectionOptions])
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
  const fit = () => { cancelWallDrag(); cancelMarquee(); endDrag(false); changeView({ ...FIT_VIEWPORT_V2 }) }
  useEffect(() => {
    if (worldTool) { endDrag(false); cancelMarquee(); setMode('select') }
  }, [worldTool?.kind])
  const zoom = (factor: number, pointer = { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }) => {
    cancelWallDrag(); cancelMarquee(); changeView(zoomViewportV2(viewRef.current, factor, pointer, sizeRef.current, boundsRef.current))
    // A wheel event may arrive between captured pointer moves. Continue from
    // the new zoom and current pointer rather than restoring the old transform.
    const active = drag.current
    if (active) { active.start = { ...viewRef.current }; active.x = active.lastX; active.y = active.lastY }
  }
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const resize = () => {
      // Home keeps this canvas mounted but hidden. A zero-size observation must
      // not rescale its saved pan to 1px before the same session is shown again.
      if (node.clientWidth <= 0 || node.clientHeight <= 0) return
      cancelWallDrag()
      const previous = sizeRef.current, next = { width: node.clientWidth, height: node.clientHeight }
      // Initial measurement fits the scene; subsequent chrome resizes preserve
      // the center world point and actual pixels/mm rather than fitting again.
      const adjusted = previous.width > 1 && previous.height > 1
        ? resizeViewportV2(viewRef.current, previous, next, boundsRef.current)
        : constrainViewportV2(viewRef.current, next, boundsRef.current)
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
    const blur = () => { endDrag(true); cancelMarquee(); cancelBrushStroke(); cancelVisualDrag(); cancelWallDrag() }
    node.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('blur', blur)
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel); window.removeEventListener('blur', blur); cancelWallDrag(); if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }; if (releaseTimer.current) clearTimeout(releaseTimer.current); drag.current = null; space.current = false }
    // Handlers read current ephemeral view/bounds through refs; no scene work on a gesture.
  }, [])
  useLayoutEffect(() => {
    endDrag(false); if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    viewRef.current = { ...FIT_VIEWPORT_V2 }; setView(viewRef.current); setMode('select')
  }, [project.document.sceneId, audience])
  useEffect(() => { endDrag(true); cancelMarquee(); cancelBrushStroke(); cancelWallDrag(); visualDrag.current = null }, [project, disabled, selectionOptions])
  useEffect(() => { if (!wallCanDrag || wallDrag.current && wallDrag.current.wallId !== selectedWall?.id) cancelWallDrag() }, [wallCanDrag, selectedWall?.id])
  useEffect(() => { if (!terrainBrush) { cancelBrushStroke(); setBrushCursor(null) } }, [!!terrainBrush])
  useEffect(() => { if (fitRequest) fit() }, [fitRequest])
  useEffect(() => { if (placement || fillCopy || worldTool || terrainBrush) { endDrag(false); cancelMarquee(); setMode('select') } }, [placement?.id, fillCopy?.sourceId, worldTool?.kind, !!terrainBrush])
  useEffect(() => {
    const controller = new AbortController(), token = {}; let image: HTMLCanvasElement | null = null; current.current = token; setResult(null); setError(null)
    void renderPreview({ audience, longEdgePx: 1200, signal: controller.signal, onMetrics: onRenderMetrics, groundView }).then(rendered => {
      image = rendered
      if (controller.signal.aborted || current.current !== token) { image.width = 0; image.height = 0; return }
      setResult({ project, audience, token, image })
      setRenderCount(count => count + 1)
    }).catch(reason => { if (!controller.signal.aborted && current.current === token) setError({ project, audience, message: reason instanceof Error ? reason.message : String(reason) }) })
    return () => { controller.abort(); if (current.current === token) current.current = null; if (image) { image.width = 0; image.height = 0 } }
  }, [project, audience, groundView, onRenderMetrics, editorRenderer])
  // Keep the existing world raster moving immediately. A bounded visible crop is
  // rebuilt only after the gesture settles; no selection dependency enters here.
  useEffect(() => {
    if (!result || result.project !== project || result.audience !== audience || size.width <= 1 || size.height <= 1 || dragging) return
    if (selectingRef.current) { resumeRefinement.current = true; setRefinementPending(true); return }
    const controller = new AbortController(); let image: HTMLCanvasElement | null = null
    const task = { controller, timer: null as unknown as ReturnType<typeof setTimeout> }
    refinementTask.current = task; setRefinementPending(true)
    task.timer = setTimeout(() => {
      const rect = viewportMapRectV2(view, size, bounds), scale = rect.width / bounds.width
      const x = Math.max(bounds.x, bounds.x - rect.x / scale), y = Math.max(bounds.y, bounds.y - rect.y / scale)
      const right = Math.min(bounds.x + bounds.width, bounds.x + (size.width - rect.x) / scale), bottom = Math.min(bounds.y + bounds.height, bounds.y + (size.height - rect.y) / scale)
      if (right <= x || bottom <= y) { if (refinementTask.current === task) { refinementTask.current = null; setRefinementPending(false) }; return }
      const crop = { x, y, width: right - x, height: bottom - y }, dpr = Math.min(2, window.devicePixelRatio || 1)
      const longEdgePx = Math.max(256, Math.min(2048, Math.ceil(Math.max(crop.width, crop.height) * scale * dpr)))
      void renderPreview({ audience, longEdgePx, viewBoundsMm: crop, screenScalePxPerMm: scale, signal: controller.signal, groundView }).then(rendered => {
        image = rendered
        if (controller.signal.aborted || refinementTask.current !== task) { rendered.width = 0; rendered.height = 0; return }
        refinementTask.current = null; setRefinementPending(false)
        setRefinement({ project, audience, bounds: crop, screenScalePxPerMm: scale, image: rendered }); setRefinementCount(count => count + 1); setError(null)
      }).catch(reason => { if (refinementTask.current === task) { refinementTask.current = null; setRefinementPending(false) }; if (!controller.signal.aborted) setError({ project, audience, message: reason instanceof Error ? reason.message : String(reason) }) })
    }, 300)
    return () => { if (refinementTask.current === task) { refinementTask.current = null; setRefinementPending(false) }; clearTimeout(task.timer); controller.abort(); if (image) { image.width = 0; image.height = 0 } }
  }, [project, audience, groundView, result, view.zoom, view.panX, view.panY, size.width, size.height, dragging, refinementTick, editorRenderer])
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
      if (placementImage && placementImage.placementId === placement.id && placementImage.assetId === placementAssetId && placementImage.resourcePort === placementBlob && placementImage.bitmap.width > 0 && placementImage.bitmap.height > 0) { ctx.globalAlpha = .7 * placement.appearance.opacity; ctx.drawImage(placementImage.bitmap, visual.x, visual.y, visual.width, visual.height); ctx.globalAlpha = 1 }
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
  const updateWallDrag = (clientX: number, clientY: number): boolean => {
    const active = wallDrag.current
    if (!active) return false
    if (active.document !== project.document || !wallCanDrag || selectedWall?.id !== active.wallId) { cancelWallDrag(); return true }
    const point = pointerWorld(clientX, clientY)
    if (!point) { setSelectionNotice('拖边越出画布，已取消。'); cancelWallDrag(); return true }
    try {
      const offsetMm = wallDragOffset(active.startMm, point, active.snapMm), floor = active.floorBounds
      if (active.endpoints.some(endpoint => !Number.isSafeInteger(endpoint.x + offsetMm.x) || !Number.isSafeInteger(endpoint.y + offsetMm.y) || endpoint.x + offsetMm.x < floor.x || endpoint.x + offsetMm.x > floor.x + floor.width || endpoint.y + offsetMm.y < floor.y || endpoint.y + offsetMm.y > floor.y + floor.height)) {
        setSelectionNotice('拖边会越出所属 Floor，已取消。'); cancelWallDrag(); return true
      }
      active.offsetMm = offsetMm; setWallOffsetMm(offsetMm); setSelectionNotice('')
    } catch (error) { setSelectionNotice(error instanceof Error ? error.message : String(error)); cancelWallDrag() }
    return true
  }
  const selectAll = () => {
    const floors = Object.values(project.document.floors).map(floor => floor.boundsMm), boxes = [bounds, ...floors]
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)), right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height))
    const found = boundsHits(project.document, { x, y, width: right - x, height: bottom - y }, 'intersect', { ...selectionOptions, memberMode })
    publish(found.ids); setSelectionNotice(`全选 ${found.ids.length} 个对象；排除锁定 ${found.excludedLocked} 个、隐藏 ${found.excludedHidden} 个。`)
  }
  const toolControls = <>
      <button aria-label="选择地图对象" aria-pressed={mode === 'select'} disabled={!ready || audience === 'player' || disabled || !!fillCopy} onClick={() => { cancelWallDrag(); endDrag(false); setMode('select'); onCancelPlacement?.(); worldTool?.onCancel() }} title="选择对象"><MousePointer2 size={15}/></button>
      <button aria-label="平移地图" aria-pressed={mode === 'pan'} disabled={!ready} onClick={() => { cancelWallDrag(); endDrag(false); setMode('pan'); worldTool?.onCancel() }} title="拖动画布"><Hand size={15}/></button>
  </>
  const viewControls = <>
      <button aria-label="缩小地图" disabled={!ready || view.zoom <= MIN_VIEW_ZOOM_V2} onClick={() => zoom(1 / 1.25)}><ZoomOut size={15}/></button>
      <output aria-label="地图缩放比例" title="相对于适应全图的倍率">{Math.round(view.zoom * 100)}%</output>
      <button aria-label="放大地图" disabled={!ready || view.zoom >= MAX_VIEW_ZOOM_V2} onClick={() => zoom(1.25)}><ZoomIn size={15}/></button>
      <button aria-label="适应全图" disabled={!ready} onClick={fit} title="适应全图（0）"><Maximize size={15}/><span>全图</span></button>
  </>
  return <div className="asset-map-wrap" aria-busy={!ready && !failed}>
    <div className="asset-viewport-toolbar" role="group" aria-label="地图视口工具">
      {toolControlsTarget ? createPortal(<div className="asset-external-tool-controls" role="group" aria-label="地图选择与平移">{toolControls}</div>, toolControlsTarget) : toolControls}
      {!toolControlsTarget && !viewControlsTarget && <span className="asset-viewport-divider"/>}
      {viewControlsTarget ? createPortal(<div className="asset-external-view-controls" role="group" aria-label="地图缩放与全图">{viewControls}</div>, viewControlsTarget) : viewControls}
      {audience === 'gm' && <><button aria-label="全选可编辑对象" disabled={!ready || disabled || !!placement || !!fillCopy || !!worldTool || !!terrainBrush} onClick={selectAll}>全选</button><span className="asset-viewport-divider"/>{(['replace', 'add', 'subtract'] as const).map(value => <button key={value} aria-label={{ replace: '替换选择', add: '增加选择', subtract: '减去选择' }[value]} aria-pressed={operation === value} disabled={disabled || !!placement || !!fillCopy || !!worldTool || !!terrainBrush} onClick={() => setOperation(value)}>{{ replace: '替换', add: '增加', subtract: '减去' }[value]}</button>)}<label><input type="checkbox" aria-label="包含相交对象" checked={intersect} disabled={disabled || !!placement || !!fillCopy || !!worldTool || !!terrainBrush} onChange={event => setIntersect(event.target.checked)}/>相交</label><label><input type="checkbox" aria-label="选择组合成员" checked={memberMode} disabled={disabled || !!placement || !!fillCopy || !!worldTool || !!terrainBrush} onChange={event => onMemberMode?.(event.target.checked)}/>成员</label>
        <label className="asset-subgrid-control"><span>子格</span><select aria-label="子格细分" value={subgrid?.divisions ?? 0} disabled={!ready || disabled || !!fillCopy} onChange={event => { const divisions = Number(event.target.value); setSubgrid(divisions ? { divisions: divisions as SubgridSnap['divisions'], anchor: subgrid?.anchor ?? 'intersection' } : null) }}><option value={0}>关闭</option><option value={1}>1×</option>{([2, 4, 8] as const).map(divisions => <option key={divisions} value={divisions} disabled={project.document.units.gridSizeMm < divisions}>1/{divisions}</option>)}</select></label>
        {subgrid && <label className="asset-subgrid-control"><span>锚点</span><select aria-label="吸附锚点" value={subgrid.anchor} disabled={!ready || disabled || !!fillCopy} onChange={event => setSubgrid(value => value ? { ...value, anchor: event.target.value as SubgridSnap['anchor'] } : value)}><option value="intersection">格线</option><option value="center">格心</option></select></label>}
      </>}
      {fillCopy && <button className="secondary" aria-label="取消填充复制" disabled={disabled} onClick={() => { fillDrag.current = null; setFillReport(null); onFillCopyCancel?.() }}>取消填充</button>}
      <span className="asset-viewport-hint">{wallOffsetMm ? `拖边 ΔX ${wallOffsetMm.x} · ΔY ${wallOffsetMm.y} mm · 松开预览 · Escape 取消` : fillCopy ? `拖动填充柄 · ${fillCopy.count} 份 · Escape 取消` : terrainBrush ? terrainBrush.label : worldTool ? worldTool.label ?? (worldTool.kind === 'ruler' ? '量尺 · 点击两点 · Escape 退出' : '点击绘图 · 按网格吸附 · Escape 退出') : placement ? '点击放置 · Escape 取消 · 空格拖动' : '滚轮缩放 · 空格拖动'}</span>
    </div>
    <div ref={viewport} className={`asset-viewport${mode === 'pan' ? ' is-pan' : ''}${dragging ? ' is-dragging' : ''}${worldTool || terrainBrush ? ' building-world-tool' : ''}`} role="group" aria-label="地图视口" tabIndex={0}
      data-selected-ids={JSON.stringify(ids)} data-selection-detail={ids.length > 256 ? 'bounds' : ids.length > 32 ? 'outlines' : 'handles'} data-zoom={view.zoom} data-pan-x={view.panX} data-pan-y={view.panY} data-render-count={renderCount} data-refinement-count={refinementCount} data-refinement-pending={refinementPending}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { endDrag(true); cancelMarquee(); cancelBrushStroke(); cancelWallDrag() } }}
      onContextMenu={event => {
        if (!ready || disabled || audience !== 'gm' || placement || fillCopy || worldTool || terrainBrush || mode === 'pan' || drag.current || marqueeRef.current) return
        const point = pointerWorld(event.clientX, event.clientY)
        if (!point || !onContext) return
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true })
        onContext(point, pointHits(project.document, point, 7 / canvas.current!.getBoundingClientRect().width * bounds.width, { ...selectionOptions, memberMode }), { x: event.clientX, y: event.clientY }, event.currentTarget)
      }}
      onPointerDown={event => {
        if (!ready || event.button > 1) return
        if (brushDrag.current || wallDrag.current) { event.preventDefault(); return }
        suppressClick.current = false
        event.currentTarget.focus({ preventScroll: true })
        if (terrainBrush && !disabled && audience === 'gm' && event.button === 0 && mode !== 'pan' && !space.current) {
          const point = pointerWorld(event.clientX, event.clientY)
          if (!point) return
          event.preventDefault(); suppressClick.current = true; cancelMarquee(); cancelRefinement()
          brushDrag.current = { pointer: event.pointerId, points: [point] }; setBrushPoints([point]); setBrushCursor(point)
          event.currentTarget.setPointerCapture(event.pointerId)
        } else if (event.button === 1 || mode === 'pan' || space.current || event.pointerType === 'touch') {
          event.preventDefault(); suppressClick.current = true
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, start: { ...viewRef.current }, original: { ...viewRef.current } }
          cancelMarquee(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true)
        } else if (!disabled && audience === 'gm' && !placement && !fillCopy && !worldTool && !terrainBrush) {
          const world = pointerWorld(event.clientX, event.clientY)
          if (world) { cancelRefinement(); selectingRef.current = true; marqueeRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, world, ids: [...ids], operation: event.altKey ? 'subtract' : event.shiftKey ? 'add' : operation }; event.currentTarget.setPointerCapture(event.pointerId) }
        }
      }}
      onPointerMove={event => {
        if (wallDrag.current?.pointer === event.pointerId) { event.preventDefault(); updateWallDrag(event.clientX, event.clientY); return }
        const brush = brushDrag.current
        if (terrainBrush && !disabled && audience === 'gm' && mode === 'select') {
          const point = pointerWorld(event.clientX, event.clientY); if (point) setBrushCursor(point)
          if (brush?.pointer === event.pointerId && point) {
            event.preventDefault(); const last = brush.points[brush.points.length - 1]
            if (Math.hypot(point.x - last.x, point.y - last.y) >= Math.max(20, terrainBrush.radiusMm / 8)) {
              if (brush.points.length >= 512) { cancelBrushStroke(); suppressClick.current = true; terrainBrush.onError?.('本笔超过 512 个采样点，整笔已取消。请缩短笔画后重新预览。'); return }
              brush.points.push(point); setBrushPoints([...brush.points])
            }
            return
          }
        }
        const start = drag.current
        if (start?.pointer === event.pointerId) { event.preventDefault(); start.lastX = event.clientX; start.lastY = event.clientY; changeView({ ...start.start, panX: start.start.panX + event.clientX - start.x, panY: start.start.panY + event.clientY - start.y }) }
        else if (marqueeRef.current?.pointer === event.pointerId) {
          const active = marqueeRef.current, b = event.currentTarget.getBoundingClientRect()
          if (Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 4) setMarquee({ x: Math.min(active.x, event.clientX) - b.left, y: Math.min(active.y, event.clientY) - b.top, width: Math.abs(event.clientX - active.x), height: Math.abs(event.clientY - active.y) })
        }
        else if (ready && worldTool && !disabled && audience === 'gm' && mode === 'select') { const point = pointerWorld(event.clientX, event.clientY); if (point) worldTool.onMove(normalizeSketchPoint(worldTool, point)) }
        else if (ready && placement && !disabled && audience === 'gm' && mode === 'select') { const point = pointerWorld(event.clientX, event.clientY); if (point) onPlacementMove?.(snapPoint(point)) }
      }}
      onPointerUp={event => {
        if (wallDrag.current?.pointer === event.pointerId) {
          event.preventDefault(); event.stopPropagation(); updateWallDrag(event.clientX, event.clientY)
          const active = wallDrag.current
          if (!active) return
          cancelWallDrag()
          if (active.offsetMm.x || active.offsetMm.y) onWallDragPreview?.(active.wallId, active.offsetMm)
          return
        }
        const brush = brushDrag.current
        if (brush?.pointer === event.pointerId && terrainBrush) {
          event.preventDefault(); const point = pointerWorld(event.clientX, event.clientY)
          if (point && (point.x !== brush.points[brush.points.length - 1].x || point.y !== brush.points[brush.points.length - 1].y)) {
            if (brush.points.length >= 512) { cancelBrushStroke(); suppressClick.current = true; terrainBrush.onError?.('本笔超过 512 个采样点，整笔已取消。请缩短笔画后重新预览。'); return }
            brush.points.push(point)
          }
          const points = [...brush.points]; cancelBrushStroke(); suppressClick.current = true; terrainBrush.onStroke(points); return
        }
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
      onPointerCancel={() => { cancelWallDrag(); cancelBrushStroke(); endDrag(true); cancelMarquee(); suppressClick.current = true }} onLostPointerCapture={() => { if (wallDrag.current) cancelWallDrag(); if (brushDrag.current) cancelBrushStroke(); if (drag.current) endDrag(true); if (marqueeRef.current) { cancelMarquee(); suppressClick.current = true } }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !ready) return
        if (event.key === 'Escape' && wallDrag.current) { event.preventDefault(); event.stopPropagation(); cancelWallDrag(); setSelectionNotice('已取消拖边，工程未修改。'); return }
        if (event.key === 'Escape') { event.preventDefault(); if (fillCopy) { event.stopPropagation(); fillDrag.current = null; setFillReport(null); onFillCopyCancel?.(); return }; if (marqueeRef.current) suppressClick.current = true; cancelMarquee(); cancelBrushStroke(); endDrag(true); setMode('select'); onCancelPlacement?.(); worldTool?.onCancel(); terrainBrush?.onCancel(); return }
        if ((event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) && !disabled && audience === 'gm' && !placement && !worldTool && !terrainBrush && onContext) {
          event.preventDefault(); const image = canvas.current!.getBoundingClientRect(), prop = ids.length === 1 ? project.document.props[ids[0]] ?? project.document.decorations?.[ids[0]] : null, point = prop?.positionMm ?? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
          onContext(point, ids.length ? [...ids] : pointHits(project.document, point, 7 / image.width * bounds.width, { ...selectionOptions, memberMode }), { x: image.left + (point.x - bounds.x) / bounds.width * image.width, y: image.top + (point.y - bounds.y) / bounds.height * image.height }, event.currentTarget); return
        }
        if (event.key === 'Enter' && worldTool?.onFinish && !disabled) { event.preventDefault(); worldTool.onFinish(); return }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !disabled && audience === 'gm' && !placement && !fillCopy && !worldTool && !terrainBrush) { event.preventDefault(); selectAll(); return }
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
        if (!ready || disabled || audience !== 'gm' || mode !== 'select' || placement || fillCopy || worldTool || terrainBrush) return
        const point = pointerWorld(event.clientX, event.clientY)
        if (!point) return
        const id = pointHits(project.document, point, 7 / canvas.current!.getBoundingClientRect().width * bounds.width, { ...selectionOptions, memberMode: true })[0]
        if (id && project.document.props[id] && Object.values(project.document.prefabInstances).some(group => Object.values(group.members).some(member => member.propId === id))) { onMemberMode?.(true); publish([id]) }
      }}
      onClick={event => {
        if (!ready || disabled || audience !== 'gm' || mode === 'pan' || fillCopy || suppressClick.current || !canvas.current) return
        if (terrainBrush) return
        if (worldTool) { const point = pointerWorld(event.clientX, event.clientY); if (point) worldTool.onPoint(normalizeSketchPoint(worldTool, point)); return }
        if (placement) { const point = pointerWorld(event.clientX, event.clientY); if (point) onPlace?.(snapPoint(point)); return }
        const image = canvas.current.getBoundingClientRect()
        if (event.clientX < image.left || event.clientX > image.right || event.clientY < image.top || event.clientY > image.bottom) { publish(mergeSelection(ids, [], event.altKey ? 'subtract' : event.shiftKey ? 'add' : operation)); return }
        const world = { x: bounds.x + (event.clientX - image.left) / image.width * bounds.width, y: bounds.y + (event.clientY - image.top) / image.height * bounds.height }
        const hit = pointHits(project.document, world, 7 / image.width * bounds.width, { ...selectionOptions, memberMode })[0]
        publish(mergeSelection(ids, hit ? [hit] : [], event.altKey ? 'subtract' : event.shiftKey ? 'add' : operation))
      }}>
      <div className="asset-viewport-image" style={{ width: rect.width, height: rect.height, transform: `translate(${rect.x}px, ${rect.y}px)`, visibility: ready ? 'visible' : 'hidden' }}>
        <canvas ref={canvas} aria-label={audience === 'gm' ? '材质场景主持人预览' : '材质场景玩家预览'}/>
        {/* Session-only render inputs preserve precision that CSS percentage serialization can round. */}
        <canvas ref={detailCanvas} className="asset-detail-preview" aria-hidden="true" data-refinement-bounds={refinementBounds ? JSON.stringify(refinementBounds) : undefined} data-refinement-scale={refinementBounds ? refinement?.screenScalePxPerMm : undefined} style={refinementBounds ? { left: `${(refinementBounds.x - bounds.x) / bounds.width * 100}%`, top: `${(refinementBounds.y - bounds.y) / bounds.height * 100}%`, width: `${refinementBounds.width / bounds.width * 100}%`, height: `${refinementBounds.height / bounds.height * 100}%` } : { display: 'none' }}/>
        <canvas ref={overlay} className="asset-selection-overlay" aria-hidden="true"/>
        {wallCanDrag && selectedWall && selectedWallEndpoints && mode === 'select' && <svg className="asset-selection-overlay wall-drag-overlay" data-testid="wall-drag-overlay" aria-label="墙体直接拖边预览" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ position: 'absolute', inset: 0, zIndex: 1, width: '100%', height: '100%', pointerEvents: 'none' }} onClick={event => event.stopPropagation()}
          onPointerMove={event => { if (wallDrag.current?.pointer === event.pointerId) { event.preventDefault(); event.stopPropagation(); updateWallDrag(event.clientX, event.clientY) } }}
          onPointerCancel={event => { event.preventDefault(); event.stopPropagation(); cancelWallDrag(); setSelectionNotice('已取消拖边，工程未修改。') }}
          onLostPointerCapture={() => { if (wallDrag.current) { cancelWallDrag(); setSelectionNotice('指针捕获丢失，拖边已取消。') } }}>
          {wallOverlay?.polygons.map((polygon, index) => <polygon key={`wall-preview-${index}`} points={polygon.map(point => `${point.x},${point.y}`).join(' ')} fill="#176c6422" stroke="#176c64" strokeWidth={3 * bounds.width / rect.width} strokeDasharray={`${8 * bounds.width / rect.width} ${5 * bounds.width / rect.width}`}/>)}
          {wallOverlay?.walls.map(wall => <g key={wall.id} stroke="#b06a38" strokeWidth={2 * bounds.width / rect.width} strokeDasharray={`${6 * bounds.width / rect.width} ${4 * bounds.width / rect.width}`} fill="none">
            {!wallOverlay.polygons.length && <line x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} stroke="#a54a3d"/>}
            {wall.openings.map(opening => <line key={opening.id} x1={opening.start.x} y1={opening.start.y} x2={opening.end.x} y2={opening.end.y} stroke="#a54a3d"/>)}
          </g>)}
          {wallOverlay?.rooms.map((polygon, index) => <polygon key={`room-preview-${index}`} points={polygon.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#aa6e2e" strokeWidth={2 * bounds.width / rect.width} strokeDasharray={`${9 * bounds.width / rect.width} ${5 * bounds.width / rect.width}`}/>)}
          {wallOverlay?.endpoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={7 * bounds.width / rect.width} fill="#176c64" stroke="#fff" strokeWidth={2 * bounds.width / rect.width}/>)}
          <circle data-testid="wall-drag-handle" aria-label="拖动墙体中点" cx={(selectedWallEndpoints[0].xMm + selectedWallEndpoints[1].xMm) / 2 + (wallOffsetMm?.x ?? 0)} cy={(selectedWallEndpoints[0].yMm + selectedWallEndpoints[1].yMm) / 2 + (wallOffsetMm?.y ?? 0)} r={11 * bounds.width / rect.width} fill="#f7f4e8" stroke="#176c64" strokeWidth={3 * bounds.width / rect.width} style={{ pointerEvents: 'all', cursor: wallDrag.current ? 'grabbing' : 'grab', touchAction: 'none' }} onPointerDown={event => {
            if (event.button !== 0 || !ready || space.current) return
            const point = pointerWorld(event.clientX, event.clientY), floor = project.document.floors[selectedWall.floorId]
            if (!point || !floor || !wallCanDrag || !event.currentTarget.ownerSVGElement) return
            event.preventDefault(); event.stopPropagation(); viewport.current?.focus({ preventScroll: true }); cancelMarquee(); cancelRefinement(); setSelectionNotice(''); suppressClick.current = true
            const owner = event.currentTarget.ownerSVGElement, endpoints = selectedWallEndpoints.map(vertex => ({ x: vertex.xMm, y: vertex.yMm }))
            wallDrag.current = { pointer: event.pointerId, owner, wallId: selectedWall.id, document: project.document, startMm: point, offsetMm: { x: 0, y: 0 }, snapMm: project.document.units.snapMm, floorBounds: floor.boundsMm, endpoints }
            setWallOffsetMm({ x: 0, y: 0 }); owner.setPointerCapture(event.pointerId)
          }}/>
        </svg>}
        {fillCopy && fillAnchorReport && audience === 'gm' && !disabled && <svg className="asset-selection-overlay fill-copy-overlay" data-testid="fill-copy-overlay" aria-label="填充复制预览" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ width: '100%', height: '100%', pointerEvents: 'all' }}
          onPointerMove={event => {
            const active = fillDrag.current
            if (!active || active.pointer !== event.pointerId) return
            event.preventDefault(); event.stopPropagation()
            const point = pointerWorld(event.clientX, event.clientY)
            if (!point) { active.report = null; setFillReport(null); setSelectionNotice('填充柄必须在地图范围内松开；本次未生成候选。'); return }
            try {
              const snapped = snapPoint(point), stepMm = { x: snapped.x - active.anchor.x, y: snapped.y - active.anchor.y }
              const report = inspectFillCopy(project.document, { sourceId: fillCopy.sourceId, count: fillCopy.count, stepMm, allowOverlap: fillCopy.allowOverlap })
              active.stepMm = stepMm; active.report = report; setFillReport(report); setSelectionNotice('')
            } catch (error) { active.report = null; setFillReport(null); setSelectionNotice(error instanceof Error ? error.message : String(error)) }
          }}
          onPointerUp={event => {
            const active = fillDrag.current
            if (!active || active.pointer !== event.pointerId) return
            event.preventDefault(); event.stopPropagation()
            const point = pointerWorld(event.clientX, event.clientY)
            if (!point) { active.report = null; setSelectionNotice('填充柄必须在地图范围内松开；本次未生成候选。') }
            else try {
              const snapped = snapPoint(point)
              active.stepMm = { x: snapped.x - active.anchor.x, y: snapped.y - active.anchor.y }
              active.report = inspectFillCopy(project.document, { sourceId: fillCopy.sourceId, count: fillCopy.count, stepMm: active.stepMm, allowOverlap: fillCopy.allowOverlap })
              setSelectionNotice('')
            } catch (error) { active.report = null; setSelectionNotice(error instanceof Error ? error.message : String(error)) }
            fillDrag.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            const report = active.report
            setFillReport(null)
            if (report) onFillCopyPreview?.(active.stepMm, report)
          }}
          onPointerCancel={event => { event.stopPropagation(); fillDrag.current = null; setFillReport(null); onFillCopyCancel?.() }}
          onLostPointerCapture={() => { if (fillDrag.current) { fillDrag.current = null; setFillReport(null); onFillCopyCancel?.() } }}
          onClick={event => event.stopPropagation()}>
          {fillReport && <>
            <defs><marker id="fill-copy-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L6,3 z" fill={fillReport.issues.length ? '#a34f3d' : '#176c64'}/></marker></defs>
            {fillReport.positions.length > 0 && <line x1={fillReport.anchorMm.x} y1={fillReport.anchorMm.y} x2={fillReport.positions.at(-1)!.x} y2={fillReport.positions.at(-1)!.y} stroke={fillReport.issues.length ? '#a34f3d' : '#176c64'} strokeWidth={3 * bounds.width / rect.width} strokeDasharray={`${7 * bounds.width / rect.width} ${4 * bounds.width / rect.width}`} markerEnd="url(#fill-copy-arrow)"/>}
            {fillReport.positions.map((anchor, index) => {
              const dx = anchor.x - fillReport.anchorMm.x, dy = anchor.y - fillReport.anchorMm.y, overlaps = fillReport.overlaps.some(row => row.copyIndex === index + 1)
              const stroke = fillReport.issues.length || overlaps && !fillCopy.allowOverlap ? '#a34f3d' : fillCopy.allowOverlap && overlaps ? '#aa6e2e' : '#176c64'
              return <g key={`${index}-${anchor.x}-${anchor.y}`}>
                {fillReport.sourcePropIds.map(id => { const prop = project.document.props[id]; if (!prop) return null; const polygon = propFootprint(prop).map(point => ({ x: point.x + dx, y: point.y + dy })); return <polygon key={id} points={polygon.map(point => `${point.x},${point.y}`).join(' ')} fill={`${stroke}22`} stroke={stroke} strokeWidth={2 * bounds.width / rect.width} strokeDasharray={`${5 * bounds.width / rect.width} ${3 * bounds.width / rect.width}`}/> })}
                <circle cx={anchor.x} cy={anchor.y} r={9 * bounds.width / rect.width} fill={stroke}/>
                <text x={anchor.x} y={anchor.y} textAnchor="middle" dominantBaseline="middle" fontSize={12 * bounds.width / rect.width} fill="#fff">{index + 1}</text>
              </g>
            })}
          </>}
          <circle data-testid="fill-copy-handle" aria-label="拖动设置填充方向和间距" cx={fillAnchorReport.anchorMm.x} cy={fillAnchorReport.anchorMm.y} r={11 * bounds.width / rect.width} fill="#f7f4e8" stroke="#176c64" strokeWidth={3 * bounds.width / rect.width} style={{ pointerEvents: 'all', cursor: 'crosshair' }} onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault(); event.stopPropagation(); cancelRefinement(); setSelectionNotice('')
            const anchor = fillAnchorReport.anchorMm, owner = event.currentTarget.ownerSVGElement!
            fillDrag.current = { pointer: event.pointerId, anchor, stepMm: { x: 0, y: 0 }, report: null }
            owner.setPointerCapture(event.pointerId)
          }}/>
        </svg>}
        {terrainBrush && audience === 'gm' && <svg className="asset-selection-overlay terrain-brush-overlay" aria-hidden="true" data-testid="terrain-brush-overlay" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {terrainBrush.scope && <rect x={terrainBrush.scope.x} y={terrainBrush.scope.y} width={terrainBrush.scope.width} height={terrainBrush.scope.height} fill="none" stroke="#b16b2d" strokeWidth={2 * bounds.width / rect.width} strokeDasharray={`${6 * bounds.width / rect.width} ${4 * bounds.width / rect.width}`}/>}
          {[...terrainBrush.strokes, ...(brushPoints.length ? [{ pointsMm: brushPoints, radiusMm: terrainBrush.radiusMm }] : [])].map((stroke, index) => <g key={index}>{stroke.pointsMm.length === 1 ? <circle cx={stroke.pointsMm[0].x} cy={stroke.pointsMm[0].y} r={stroke.radiusMm} fill="#4d956452"/> : <polyline points={stroke.pointsMm.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#4d956452" strokeWidth={stroke.radiusMm * 2} strokeLinecap="round" strokeLinejoin="round"/>}</g>)}
          {brushCursor && <circle cx={brushCursor.x} cy={brushCursor.y} r={terrainBrush.radiusMm} fill="none" stroke="#205d48" strokeWidth={1.5 * bounds.width / rect.width}/>}
        </svg>}
        {visualBoundary && audience === 'gm' && !disabled && <svg className="visual-controls" aria-label="曲线控制点" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ width: '100%', height: '100%' }} onClick={event => event.stopPropagation()}
          onPointerMove={event => {
            const drag = visualDrag.current
            if (!drag || drag.pointer !== event.pointerId || !onVisualBoundaryChange) return
            event.preventDefault(); event.stopPropagation()
            const point = pointerWorld(event.clientX, event.clientY); if (!point) return
            const next = structuredClone(drag.current), segments = next.segments, segment = segments[drag.segment], previous = segment[drag.key]
            segment[drag.key] = point
            if (drag.key === 'start') {
              segment.control1 = { x: segment.control1.x + point.x - previous.x, y: segment.control1.y + point.y - previous.y }
              if (drag.segment > 0 || next.closed) { const neighbor = segments[(drag.segment + segments.length - 1) % segments.length]; neighbor.end = { ...point }; neighbor.control2 = { x: neighbor.control2.x + point.x - previous.x, y: neighbor.control2.y + point.y - previous.y } }
            }
            if (drag.key === 'end') {
              segment.control2 = { x: segment.control2.x + point.x - previous.x, y: segment.control2.y + point.y - previous.y }
              if (drag.segment < segments.length - 1 || next.closed) { const neighbor = segments[(drag.segment + 1) % segments.length]; neighbor.start = { ...point }; neighbor.control1 = { x: neighbor.control1.x + point.x - previous.x, y: neighbor.control1.y + point.y - previous.y } }
            }
            drag.current = next; onVisualBoundaryChange(next)
          }}
          onPointerUp={event => { if (visualDrag.current?.pointer !== event.pointerId) return; event.preventDefault(); event.stopPropagation(); const finished = visualDrag.current.current; visualDrag.current = null; onVisualBoundaryFinish?.(finished); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onPointerCancel={event => { const drag = visualDrag.current; if (drag) onVisualBoundaryChange?.(drag.original); visualDrag.current = null; event.stopPropagation() }} onLostPointerCapture={() => { const drag = visualDrag.current; if (drag) onVisualBoundaryChange?.(drag.original); visualDrag.current = null }}>
          <path d={visualBoundary.segments.map((s, i) => `${i ? '' : `M ${s.start.x} ${s.start.y}`} C ${s.control1.x} ${s.control1.y} ${s.control2.x} ${s.control2.y} ${s.end.x} ${s.end.y}`).join(' ')} fill="none" stroke="#165F78" strokeWidth={2 * bounds.width / rect.width}/>
          {visualBoundary.segments.map((segment, i) => <g key={segment.id}>
            <path d={`M ${segment.start.x} ${segment.start.y} L ${segment.control1.x} ${segment.control1.y} M ${segment.end.x} ${segment.end.y} L ${segment.control2.x} ${segment.control2.y}`} fill="none" stroke="#165F78" strokeWidth={bounds.width / rect.width} strokeDasharray={`${4 * bounds.width / rect.width} ${3 * bounds.width / rect.width}`}/>
            {(['start', 'control1', 'control2', 'end'] as const).filter(key => key !== 'end' || i === visualBoundary.segments.length - 1 && !visualBoundary.closed).map(key => <circle key={key} data-testid={`curve-handle-${i}-${key}`} aria-label={`曲线第${i + 1}段${key}`} cx={segment[key].x} cy={segment[key].y} r={(key.startsWith('control') ? 5 : 6) * bounds.width / rect.width} fill={key.startsWith('control') ? '#E3AD62' : '#FFF8DC'} stroke="#165F78" strokeWidth={1.5 * bounds.width / rect.width} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); const owner = event.currentTarget.ownerSVGElement!; owner.setPointerCapture(event.pointerId); visualDrag.current = { pointer: event.pointerId, segment: i, key, original: structuredClone(visualBoundary), current: structuredClone(visualBoundary) } }}/>)}</g>)}
        </svg>}
        {worldTool && audience === 'gm' && !disabled && <svg className="asset-selection-overlay" data-testid="building-sketch" aria-hidden="true" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ width: '100%', height: '100%', pointerEvents: 'none' }}>
          {(() => {
            const points = [...worldTool.points]
            if (worldTool.cursor && (worldTool.kind === 'polygon' || worldTool.kind === 'orthogonal' || worldTool.kind === 'polyline' || points.length === 1) && !(worldTool.kind === 'orthogonal' && points.at(-1)?.x === worldTool.cursor.x && points.at(-1)?.y === worldTool.cursor.y)) points.push(worldTool.cursor)
            let orthogonalClosed = false
            if (worldTool.kind === 'orthogonal' && points.length >= 3) {
              try { const closed = finishOrthogonalBoundary(points); points.splice(0, points.length, ...closed, closed[0]); orthogonalClosed = true } catch { /* Keep the open line visible until a valid closure exists. */ }
            }
            const path = worldTool.kind === 'rectangle' && points.length >= 2 ? rectanglePoints(rectangleFromPoints(points[0], points[1])) : points
            const unit = bounds.width / rect.width
            return <>{orthogonalClosed ? <polygon data-orthogonal-valid="true" points={path.map(p => `${p.x},${p.y}`).join(' ')} fill="#5c865722" stroke="#3c7650" strokeWidth={2 * unit} strokeDasharray={`${7 * unit} ${4 * unit}`}/> : <polyline data-orthogonal-valid={worldTool.kind === 'orthogonal' ? 'false' : undefined} points={path.map(p => `${p.x},${p.y}`).join(' ')} fill={worldTool.kind === 'ruler' || worldTool.kind === 'polyline' || worldTool.kind === 'orthogonal' ? 'none' : '#5c865722'} stroke={worldTool.kind === 'orthogonal' ? '#aa6e2e' : '#3c7650'} strokeWidth={2 * unit} strokeDasharray={`${7 * unit} ${4 * unit}`}/> }{worldTool.kind === 'rectangle' && path.length === 4 && <line x1={path[3].x} y1={path[3].y} x2={path[0].x} y2={path[0].y} stroke="#3c7650" strokeWidth={2 * unit}/>}{worldTool.points.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r={4 * unit} fill="#f9f7e8" stroke="#3c7650" strokeWidth={2 * unit}/>)}{worldTool.kind === 'ruler' && points.length >= 2 && <text x={(points[0].x + points[1].x) / 2} y={(points[0].y + points[1].y) / 2 - 10 * unit} textAnchor="middle" fontSize={14 * unit} fill="#355e34" stroke="#fffcee" strokeWidth={3 * unit} paintOrder="stroke">{formatDistanceMm(rulerDistance(points[0], points[1]).distanceMm, project.document.units.display)}</text>}</>
          })()}
        </svg>}
      </div>
      {marquee && <div className="asset-marquee" data-testid="selection-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}/> }
      {!ready && <div className="asset-viewport-message"><div className="asset-preview-message" role={failed ? 'alert' : 'status'}>{failed ? <><strong>此场景暂时无法绘制</strong><p>{error.message}</p><p>完整工程仍保留，可继续备份与修改。</p></> : '正在解码素材并绘制场景…'}</div></div>}
    </div>
    <div className="asset-selection-notice" role="status">{wallOffsetMm ? `拖边 ΔX ${wallOffsetMm.x} · ΔY ${wallOffsetMm.y} mm；松开后生成候选并检查完整依赖，当前工程未修改。` : fillCopy ? fillReport ? `副本 ${fillReport.count} 份 · 每份偏移 ${fillReport.stepMm.x}, ${fillReport.stepMm.y} mm · ${fillReport.overlaps.length} 处重叠${fillReport.issues.length ? ` · ${fillReport.issues[0]}` : ''}` : selectionNotice || `拖动中心填充柄设置间距与方向；子格吸附${subgrid ? ` 1/${subgrid.divisions} · ${subgrid.anchor === 'center' ? '格心' : '格线'}` : '关闭'}。` : terrainBrush ? terrainBrush.label : worldTool ? worldTool.label ?? (worldTool.kind === 'ruler' ? '量尺只在本次会话显示，不写入工程或 PNG。' : '按网格吸附顶点，在建筑面板预览并采用；当前工程尚未改变。') : selectionNotice || (audience === 'gm' ? '单击选择 · 拖动框选 · Shift 增选 · Option/Alt 减选' : '玩家预览仅提供视口操作')}</div>
  </div>
}
