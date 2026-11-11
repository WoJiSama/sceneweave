import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditableProject } from '../../application/workspace/project'
import type { ImagePoint } from '../../shared/image-import/calibration'
import { imagePolygonMask, suggestImageRegion, type ImagePixelMask } from '../../shared/image-import/pixels'
import { paintImageSelection, snapImageContour } from '../../shared/image-import/selection'
import { decodeSelectionMask, encodeSelectionMask, type ImageSelectionMask } from '../../shared/image-import/selection-mask'
import { parseImageImportRecipe, type ImageImportRecipe } from '../../shared/image-import/recipe'
import { replayImageLayers } from '../../shared/image-import/layer-replay'
import type { ImageVectorOptions } from '../../shared/image-import/vector'
import { loadImageImportSource, prepareImageImportRecipe, prepareImageImportFidelityPreview } from '../../platform/browser/content/image-import-session'
import './image-import-tool.css'
import ImageSelectionReview from './ImageSelectionReview'
import AssetEditorLayout from './AssetEditorLayout'

interface Props {
  disabled?: boolean
  requestKey?: number
  onDraftChange: (token: string | null) => void
  onPrepare: (factory: (signal: AbortSignal) => Promise<EditableProject>, description: string, draftToken: string, imageItemIds?: string[]) => boolean
}
type PointMode = 'source-boundary' | 'room' | 'ruler' | 'object' | 'donor' | 'fill-region' | 'fill-donor'
type Mode = PointMode | 'seed' | 'pan' | 'magnetic' | 'keep' | 'remove'
type View = 'source' | 'composite' | 'floor' | 'difference' | 'inference'
type Stage = 'source' | 'structure' | 'objects' | 'overview'
const stages: Array<[Stage, string, string]> = [['source', '原图', '文件与原色像素'], ['structure', '结构', '保留范围、房间和比例'], ['objects', '物件', '选区、占地与补底'], ['overview', '总览', '来源、许可和工程预览']]
interface Raster { width: number; height: number; data: Uint8ClampedArray }
interface Source extends Raster { sha256: string }
interface Layer {
  id: string
  name: string
  polygon: ImagePoint[]
  donor: { x: number; y: number; width: number; height: number }
  renderLayer: 'ground' | 'object'
  blocksMovement: boolean
  repair?: 'tile' | 'seamless' | 'aligned'
  cleanupPx?: number
  fills?: Array<{ polygon: ImagePoint[]; donor: Layer['donor'] }>
  vector?: ImageVectorOptions
  footprintPx?: { x: number; y: number; width: number; height: number }
  selectionMask?: ImageSelectionMask
}
interface Preview { floor: Raster; layers: Array<{ raster: Raster; boundsPx: Layer['donor']; id: string }> }
interface PointEdit { mode: PointMode; points: ImagePoint[]; mask?: ImagePixelMask | null }
type Drag = { pointerId: number; kind: 'vertex'; mode: PointMode; index: number; before: ImagePoint[]; beforeMask: ImagePixelMask | null; moved: boolean }
  | { pointerId: number; kind: 'pan'; clientX: number; clientY: number; scrollLeft: number; scrollTop: number }
  | { pointerId: number; kind: 'selection'; mode: 'magnetic' | 'keep' | 'remove'; points: ImagePoint[]; beforePoints: ImagePoint[]; beforeMask: ImagePixelMask | null; painted: ImagePixelMask | null }
const modes: Array<[Mode, string]> = [['source-boundary', '原图保留范围'], ['room', '房间轮廓'], ['ruler', '比例尺'], ['object', '物件轮廓'], ['donor', '补底取样'], ['seed', '点选相似颜色'], ['pan', '平移']]
const selectionModes: Array<[Mode, string]> = [['magnetic', '磁性套索'], ['keep', '保留画笔'], ['remove', '排除画笔']]
const maskRectangle = (mask: ImagePixelMask): ImagePoint[] => {
  const { x, y, width, height } = mask.boundsPx
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
}
const failureText = (error: unknown) => error instanceof Error ? error.message : String(error)
const rectangle = (points: ImagePoint[]) => ({ x: Math.floor(Math.min(points[0].x, points[1].x)), y: Math.floor(Math.min(points[0].y, points[1].y)),
  width: Math.ceil(Math.abs(points[0].x - points[1].x)), height: Math.ceil(Math.abs(points[0].y - points[1].y)) })

function previewLayers(source: Source, layers: Layer[]): Preview {
  const replay = replayImageLayers(source, layers)
  return { floor: replay.remaining, layers: replay.layers.map(({ layer, extracted }) =>
    ({ id: layer.id, raster: extracted.layer, boundsPx: extracted.layer.boundsPx })) }
}

function drawRaster(context: CanvasRenderingContext2D, raster: Raster, x = 0, y = 0, width = raster.width, height = raster.height): void {
  const surface = document.createElement('canvas')
  surface.width = raster.width; surface.height = raster.height
  const target = surface.getContext('2d')!
  const pixels = target.createImageData(raster.width, raster.height)
  pixels.data.set(raster.data)
  target.putImageData(pixels, 0, 0)
  context.drawImage(surface, x, y, width, height)
  surface.width = surface.height = 0
}

function localVectorSize(points: ImagePoint[]) {
  if (points.length < 3) return undefined
  return { width: Math.ceil(Math.max(...points.map(point => point.x))) - Math.floor(Math.min(...points.map(point => point.x))),
    height: Math.ceil(Math.max(...points.map(point => point.y))) - Math.floor(Math.min(...points.map(point => point.y))) }
}

function OriginalAppearance({ label, legacy }: { label: string; legacy: ImageVectorOptions | undefined }) {
  return <div className="image-import-vector-fields">
    <label>{label}<select aria-label={label} value={legacy?.kind ?? 'pixel'} disabled>
      <option value="pixel">原图保真 · 原色像素分层</option><option value="trace" disabled>旧矢量描摹 · 会改变原画</option><option value="wood" disabled>旧木板重绘 · 会改变原画</option><option value="rug" disabled>旧织物重绘 · 会改变原画</option>
    </select></label>
  </div>
}

/** A local pixel-coordinate draft. The workspace owns the eventual adopt/save transaction. */
export default function ImageImportTool({ disabled = false, requestKey = 0, onDraftChange, onPrepare }: Props) {
  const [open, setOpen] = useState(false), [source, setSource] = useState<Source | null>(null)
  const [stage, setStage] = useState<Stage>('source')
  const [objectFieldsDirty, setObjectFieldsDirty] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ target: string } | null>(null)
  const [title, setTitle] = useState('图片重建场景'), [room, setRoom] = useState<ImagePoint[]>([])
  const [sourceBoundary, setSourceBoundary] = useState<ImagePoint[]>([]), [outputScale, setOutputScale] = useState<1 | 2 | 4>(1)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [ruler, setRuler] = useState<ImagePoint[]>([]), [distance, setDistance] = useState('1000')
  const [origin, setOrigin] = useState<ImagePoint | undefined>()
  const [polygon, setPolygon] = useState<ImagePoint[]>([]), [donor, setDonor] = useState<ImagePoint[]>([])
  const [selection, setSelection] = useState<ImagePixelMask | null>(null), [selectionStroke, setSelectionStroke] = useState<ImagePoint[]>([])
  const [brushRadius, setBrushRadius] = useState(3), [snapRadius, setSnapRadius] = useState(6), [snapping, setSnapping] = useState(true)
  const [brushCursor, setBrushCursor] = useState<ImagePoint | null>(null)
  const [gestureActive, setGestureActive] = useState(false), [reviewSelection, setReviewSelection] = useState(false)
  const [layers, setLayers] = useState<Layer[]>([]), [preview, setPreview] = useState<Preview | null>(null)
  const [mode, setMode] = useState<Mode>('room'), [view, setView] = useState<View>('source')
  const [name, setName] = useState('物件 1'), [renderLayer, setRenderLayer] = useState<'ground' | 'object'>('object')
  const [movement, setMovement] = useState(true), [tolerance, setTolerance] = useState('32')
  const [customFootprint, setCustomFootprint] = useState(false)
  const [footprintPx, setFootprintPx] = useState<NonNullable<Layer['footprintPx']>>({ x: 0, y: 0, width: 1, height: 1 })
  const [repair, setRepair] = useState<'seamless' | 'tile' | 'aligned'>('seamless'), [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const [cleanupPx, setCleanupPx] = useState(0)
  const [vector, setVector] = useState<ImageVectorOptions | undefined>(), [floorVector, setFloorVector] = useState<ImageVectorOptions | undefined>()
  const [fidelityResult, setFidelityResult] = useState<{ key: string; data: Awaited<ReturnType<typeof prepareImageImportFidelityPreview>> } | null>(null)
  const [fidelityPending, setFidelityPending] = useState(false), [fidelityError, setFidelityError] = useState('')
  const [fills, setFills] = useState<NonNullable<Layer['fills']>>([]), [fillPolygon, setFillPolygon] = useState<ImagePoint[]>([]), [fillDonor, setFillDonor] = useState<ImagePoint[]>([])
  const [pointHistory, setPointHistory] = useState<PointEdit[]>([]), [zoom, setZoom] = useState('fit')
  const [hidden, setHidden] = useState<string[]>([]), [license, setLicense] = useState(''), [attribution, setAttribution] = useState('')
  const [embed, setEmbed] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null), dialog = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null)
  const inspector = useRef<HTMLDivElement>(null)
  const zoomAnchor = useRef<ImagePoint | null>(null)
  const generation = useRef(0), controller = useRef<AbortController | null>(null)
  const draftToken = useRef<string | null>(null)
  const markDraft = () => {
    if (draftToken.current === null) {
      draftToken.current = crypto.randomUUID()
      onDraftChange(draftToken.current)
    }
    return draftToken.current
  }
  const occupied = disabled || pending
  const selectionSource = useMemo(() => {
    if (!source) return null
    if (!editingLayerId) return preview?.floor ?? source
    const index = layers.findIndex(layer => layer.id === editingLayerId)
    return previewLayers(source, layers.slice(0, Math.max(0, index))).floor
  }, [source, preview, layers, editingLayerId])
  const effectiveSelection = useMemo(() => {
    if (selection) return selection
    if (!source || polygon.length < 3) return null
    try { return imagePolygonMask(source, polygon) } catch { return null }
  }, [source, polygon, selection])
  const selectedPixels = useMemo(() => effectiveSelection?.data.reduce((count, alpha) => count + (alpha > 0 ? 1 : 0), 0) ?? 0, [effectiveSelection])
  useEffect(() => () => { generation.current++; controller.current?.abort() }, [])
  useEffect(() => { if (requestKey > 0) setOpen(true) }, [requestKey])
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  const cancelGesture = () => {
    const current = drag.current
    if (current?.kind === 'vertex') { setPoints(current.mode, current.before); if (current.mode === 'object') setSelection(current.beforeMask) }
    if (current?.kind === 'selection') { setPolygon(current.beforePoints); setSelection(current.beforeMask) }
    drag.current = null
    setSelectionStroke([]); setGestureActive(false)
    const target = canvas.current
    if (current && target?.hasPointerCapture(current.pointerId)) target.releasePointerCapture(current.pointerId)
  }
  useEffect(() => {
    window.addEventListener('blur', cancelGesture)
    return () => window.removeEventListener('blur', cancelGesture)
  }, [])
  useEffect(() => { if (disabled) cancelGesture() }, [disabled])
  useEffect(() => {
    if (!focusRequest) return
    const frame = requestAnimationFrame(() => {
      const target = inspector.current?.querySelector<HTMLElement>(`[data-import-target="${focusRequest.target}"]`)
      target?.scrollIntoView({ block: 'nearest' })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, stage])
  const locate = (next: Stage, target?: string) => {
    cancelGesture(); setStage(next)
    if (target) setFocusRequest({ target })
  }
  const chooseMode = (next: Mode) => {
    cancelGesture(); setMode(next)
    if (next === 'source-boundary' || next === 'room' || next === 'ruler') setStage('structure')
    else if (next !== 'pan') setStage('objects')
    if (next !== 'pan') { setView('source'); setShowAnnotations(true) }
  }
  const chooseView = (next: View) => { cancelGesture(); setView(next) }
  const close = () => {
    cancelGesture()
    generation.current++; controller.current?.abort(); setPending(false); setOpen(false)
  }
  const act = (action: () => void) => { setError(''); setNotice(''); try { action() } catch (error) { setError(failureText(error)) } }
  const load = async (file: File) => {
    markDraft()
    cancelGesture()
    controller.current?.abort()
    const abort = new AbortController(), stamp = ++generation.current
    controller.current = abort; setPending(true); setError('')
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('原图最多20 MiB。')
      const loaded = await loadImageImportSource(new Uint8Array(await file.arrayBuffer()), file.type, abort.signal)
      if (stamp !== generation.current || abort.signal.aborted) return
      const next = { ...loaded.pixels, sha256: loaded.image.sha256 }
      setSource(next); setTitle(file.name.replace(/\.[^.]+$/, '')); setRoom([]); setRuler([]); setPolygon([]); setDonor([])
      setSelection(null); setReviewSelection(false)
      setLayers([]); setPreview({ floor: next, layers: [] }); setHidden([]); setMode('room'); setView('source')
      setPointHistory([]); setEditingLayerId(null); setZoom('fit'); setRepair('seamless'); setCleanupPx(0)
      setObjectFieldsDirty(false)
      setFills([]); setFillPolygon([]); setFillDonor([])
      setVector(undefined); setFloorVector(undefined); setFidelityResult(null)
      setSourceBoundary([]); setOutputScale(1); setShowAnnotations(true); setMode('source-boundary')
      setCustomFootprint(false)
      setEmbed(false); setOrigin(undefined); setNotice('先沿房间内边界依次点选，至少三个点；再标定已知距离。')
    } catch (error) { if (stamp === generation.current && !abort.signal.aborted) setError(failureText(error)) }
    finally { if (stamp === generation.current) { setPending(false); controller.current = null } }
  }
  const hasVector = !!floorVector || layers.some(layer => !!layer.vector)
  const fidelityKey = JSON.stringify({ source: source?.sha256, title, room, sourceBoundary, outputScale, ruler, distance, origin, floorVector, layers })
  useEffect(() => {
    setFidelityResult(null); setFidelityError('')
    if (!open || !source || room.length < 3 || ruler.length !== 2) { setFidelityPending(false); return }
    const abort = new AbortController()
    setFidelityPending(true)
    const timer = setTimeout(() => {
      let input: ImageImportRecipe
      try { input = recipe() } catch (error) { setFidelityError(failureText(error)); setFidelityPending(false); return }
      void prepareImageImportFidelityPreview({ image: input.image, pixels: source }, input, abort.signal).then(data => {
        if (!abort.signal.aborted) setFidelityResult({ key: fidelityKey, data })
      }).catch(error => { if (!abort.signal.aborted) setFidelityError(failureText(error)) })
        .finally(() => { if (!abort.signal.aborted) setFidelityPending(false) })
    }, 150)
    return () => { clearTimeout(timer); abort.abort() }
  }, [fidelityKey, source, open])
  useEffect(() => {
    const target = canvas.current
    if (!source || !target) return
    const generated = fidelityResult?.key === fidelityKey ? fidelityResult.data : null
    target.width = source.width; target.height = source.height
    const context = target.getContext('2d')!
    context.clearRect(0, 0, target.width, target.height)
    if (view === 'source') drawRaster(context, source)
    else {
      if (generated && (view === 'difference' || view === 'inference' || (view === 'composite' && !hidden.length))) {
        drawRaster(context, generated[view === 'difference' ? 'difference' : view === 'inference' ? 'inference' : 'composite'])
      } else if (view === 'floor' || view === 'composite') {
        if (sourceBoundary.length >= 3) { context.beginPath(); context.moveTo(sourceBoundary[0].x, sourceBoundary[0].y); sourceBoundary.slice(1).forEach(point => context.lineTo(point.x, point.y)); context.closePath(); context.clip() }
        drawRaster(context, preview?.floor ?? source)
        if (view === 'composite') for (const layer of [...(preview?.layers ?? [])].reverse()) {
          if (!hidden.includes(layer.id)) drawRaster(context, layer.raster, layer.boundsPx.x, layer.boundsPx.y)
        }
      }
    }
    const outline = (points: ImagePoint[], color: string, closed: boolean, handles = true) => {
      if (!points.length) return
      const displayScale = target.getBoundingClientRect().width / source.width || 1
      const radius = 4 / displayScale
      context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 1.5 / displayScale
      context.beginPath(); context.moveTo(points[0].x, points[0].y)
      points.slice(1).forEach(point => context.lineTo(point.x, point.y))
      if (closed && points.length > 2) context.closePath()
      context.stroke()
      if (handles) for (const point of points) { context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill() }
    }
    if (view === 'source' && showAnnotations) {
      if (cleanupPx > 0 && polygon.length > 2) {
        context.save(); context.beginPath(); context.moveTo(polygon[0].x, polygon[0].y)
        polygon.slice(1).forEach(point => context.lineTo(point.x, point.y))
        context.closePath(); context.lineWidth = cleanupPx * 2; context.lineJoin = 'round'
        context.strokeStyle = '#A66CF5'; context.globalAlpha = .22; context.stroke(); context.restore()
      }
      if (selection) {
        const overlay = { width: selection.width, height: selection.height, data: new Uint8ClampedArray(selection.width * selection.height * 4) }
        for (let index = 0; index < selection.data.length; index++) {
          if (!selection.data[index]) continue
          const x = index % selection.width, y = Math.floor(index / selection.width)
          const boundary = x === 0 || y === 0 || x + 1 === selection.width || y + 1 === selection.height
            || !selection.data[index - 1] || !selection.data[index + 1] || !selection.data[index - selection.width] || !selection.data[index + selection.width]
          overlay.data.set([246, 133, 197, boundary ? 235 : 55], index * 4)
        }
        drawRaster(context, overlay, selection.boundsPx.x, selection.boundsPx.y)
      }
      outline(sourceBoundary, '#4DEBD5', true); outline(room, '#FFE073', true); outline(ruler, '#8DE4FF', false)
      if (!selection) outline(polygon, '#F685C5', true)
      if (selectionStroke.length) outline(selectionStroke, '#F685C5', false, false)
      outline(donor, '#79F2B3', false)
      if (donor.length === 2) { const bounds = rectangle(donor); context.strokeStyle = '#79F2B3'; context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height) }
      outline(fillPolygon, '#FFAA5C', true); outline(fillDonor, '#D4A8FF', false)
      if (fillDonor.length === 2) { const bounds = rectangle(fillDonor); context.strokeStyle = '#D4A8FF'; context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height) }
      if (brushCursor && (mode === 'keep' || mode === 'remove') && Number.isFinite(brushRadius) && brushRadius > 0) {
        const scale = target.getBoundingClientRect().width / source.width || 1
        context.beginPath(); context.arc(brushCursor.x, brushCursor.y, brushRadius, 0, Math.PI * 2)
        context.strokeStyle = '#fff'; context.lineWidth = 3 / scale; context.stroke()
        context.strokeStyle = mode === 'keep' ? '#286f4a' : '#b12842'; context.lineWidth = 1.5 / scale; context.stroke()
      }
    }
  }, [source, preview, room, sourceBoundary, ruler, polygon, selection, selectionStroke, donor, fillPolygon, fillDonor, hidden, view, open, zoom, cleanupPx, fidelityResult, fidelityKey, showAnnotations, brushCursor, brushRadius, mode])
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current, frame = viewport.current, target = canvas.current
    if (!anchor || !source || !frame || !target) return
    const scale = target.getBoundingClientRect().width / source.width
    frame.scrollLeft = anchor.x * scale - frame.clientWidth / 2
    frame.scrollTop = anchor.y * scale - frame.clientHeight / 2
    zoomAnchor.current = null
  }, [zoom, source])
  const changeZoom = (value: string) => {
    cancelGesture()
    const frame = viewport.current, target = canvas.current
    if (source && frame && target) {
      const scale = target.getBoundingClientRect().width / source.width
      zoomAnchor.current = { x: (frame.scrollLeft + frame.clientWidth / 2) / scale, y: (frame.scrollTop + frame.clientHeight / 2) / scale }
    }
    setZoom(value)
  }
  const pointsFor = (target: PointMode) => {
    if (target === 'source-boundary') return sourceBoundary
    if (target === 'room') return room
    if (target === 'ruler') return ruler
    if (target === 'donor') return donor
    if (target === 'fill-region') return fillPolygon
    if (target === 'fill-donor') return fillDonor
    return polygon
  }
  const setPoints = (target: PointMode, points: ImagePoint[]) => {
    if (target === 'source-boundary') setSourceBoundary(points)
    else if (target === 'room') setRoom(points)
    else if (target === 'ruler') setRuler(points)
    else if (target === 'donor') setDonor(points)
    else if (target === 'fill-region') setFillPolygon(points)
    else if (target === 'fill-donor') setFillDonor(points)
    else setPolygon(points)
  }
  const editPoints = (target: PointMode, points: ImagePoint[]) => {
    setPointHistory(current => [...current, { mode: target, points: [...pointsFor(target)], ...(target === 'object' ? { mask: selection } : {}) }].slice(-64))
    if (target === 'object') setSelection(null)
    setPoints(target, points)
  }
  const imagePoint = (event: React.PointerEvent<HTMLCanvasElement>): ImagePoint => {
    if (!source) return { x: 0, y: 0 }
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(source.width - 1, Math.round((event.clientX - bounds.left) * source.width / bounds.width))),
      y: Math.max(0, Math.min(source.height - 1, Math.round((event.clientY - bounds.top) * source.height / bounds.height))) }
  }
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => act(() => {
    if (!source || occupied || drag.current) return
    if (mode === 'pan' || event.button === 1) {
      const frame = viewport.current!
      drag.current = { kind: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: frame.scrollLeft, scrollTop: frame.scrollTop }
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault()
      return
    }
    if (view !== 'source' || !showAnnotations || event.button !== 0) return
    const position = imagePoint(event)
    if (mode === 'magnetic' || mode === 'keep' || mode === 'remove') {
      const before = effectiveSelection ?? { width: 1, height: 1, boundsPx: { ...position, width: 1, height: 1 }, data: new Uint8Array(1) }
      const painted = mode === 'magnetic' ? null : paintImageSelection(selectionSource ?? source, before, { mode, points: [position], radiusPx: brushRadius })
      drag.current = { pointerId: event.pointerId, kind: 'selection', mode, points: [position], beforePoints: [...polygon], beforeMask: selection, painted }
      if (painted) { setSelection(painted); if (polygon.length < 3) setPolygon(maskRectangle(painted)) }
      else setSelectionStroke([position])
      setGestureActive(true); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault()
      return
    }
    if (mode === 'object' && selection) throw new Error('当前精细选区请用保留／排除画笔修正；如需重新点选，请先清空当前标注。')
    if (mode !== 'seed') {
      const points = pointsFor(mode), bounds = event.currentTarget.getBoundingClientRect()
      const tolerancePx = 9 * source.width / bounds.width
      const index = points.findIndex(point => Math.hypot(point.x - position.x, point.y - position.y) <= tolerancePx)
      if (index >= 0) {
        drag.current = { kind: 'vertex', mode, pointerId: event.pointerId, index, before: [...points], beforeMask: selection, moved: false }
        setGestureActive(true)
        event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault()
        return
      }
    }
    if ((mode === 'source-boundary' && sourceBoundary.length >= 256) || (mode === 'room' && room.length >= 256) || (mode === 'object' && polygon.length >= 256) || (mode === 'fill-region' && fillPolygon.length >= 256)) throw new Error('单个轮廓最多256点，请撤销或简化轮廓。')
    if (mode === 'source-boundary') editPoints('source-boundary', [...sourceBoundary, position])
    if (mode === 'room') editPoints('room', [...room, position])
    if (mode === 'ruler') editPoints('ruler', ruler.length === 2 ? [position] : [...ruler, position])
    if (mode === 'object') editPoints('object', [...polygon, position])
    if (mode === 'donor') editPoints('donor', donor.length === 2 ? [position] : [...donor, position])
    if (mode === 'fill-region') editPoints('fill-region', [...fillPolygon, position])
    if (mode === 'fill-donor') editPoints('fill-donor', fillDonor.length === 2 ? [position] : [...fillDonor, position])
    if (mode === 'seed') {
      const result = suggestImageRegion(selectionSource ?? source, { seed: position, tolerance: Number(tolerance), maxPixels: Math.min(source.width * source.height, 1_000_000) })
      encodeSelectionMask(result.mask)
      editPoints('object', result.polygon.length <= 256 ? [...result.polygon] : maskRectangle(result.mask))
      setSelection(result.mask); setMode('keep'); setNotice(`已找到 ${result.pixelCount} 像素的候选，保留 ${result.holes.length} 个孔洞。可用画笔修正后选择补底取样。`)
    }
  })
  const movePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'keep' || mode === 'remove') setBrushCursor(imagePoint(event))
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.kind === 'pan') {
      const frame = viewport.current!
      frame.scrollLeft = current.scrollLeft + current.clientX - event.clientX
      frame.scrollTop = current.scrollTop + current.clientY - event.clientY
    } else if (current.kind === 'vertex') {
      const position = imagePoint(event)
      current.moved = current.moved || position.x !== current.before[current.index].x || position.y !== current.before[current.index].y
      const points = [...current.before]; points[current.index] = position
      setPoints(current.mode, points)
    } else {
      if (!source) return
      const position = imagePoint(event), previous = current.points.at(-1)!
      if (position.x === previous.x && position.y === previous.y) return
      try {
        if (current.points.length >= 4096) throw new Error('这笔标注过长，请分成较短的笔画。')
        current.points.push(position)
        if (current.mode === 'magnetic') setSelectionStroke([...current.points])
        else {
          current.painted = paintImageSelection(selectionSource ?? source, current.painted!, { mode: current.mode, points: [previous, position], radiusPx: brushRadius })
          setSelection(current.painted)
          if (current.beforePoints.length < 3) setPolygon(maskRectangle(current.painted))
        }
      } catch (error) { cancelGesture(); setError(failureText(error)) }
    }
    event.preventDefault()
  }
  const releasePointer = (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (cancelled) { cancelGesture(); return }
    if (current.kind === 'vertex') {
      if (current.moved) setPointHistory(history => [...history, { mode: current.mode, points: current.before, ...(current.mode === 'object' ? { mask: current.beforeMask } : {}) }].slice(-64))
    } else if (current.kind === 'selection' && source) {
      try {
        if (current.mode === 'magnetic') {
          if (current.points.length < 3) throw new Error('请沿物件外沿拖画一圈，松开后闭合。')
          const points = snapping ? snapImageContour(selectionSource ?? source, current.points, { radiusPx: snapRadius, closed: true }) : current.points
          const mask = imagePolygonMask(source, points)
          encodeSelectionMask(mask)
          setPolygon(points.length <= 256 ? points : maskRectangle(mask)); setSelection(mask)
          setNotice(snapping ? '已沿笔迹附近的图像边缘吸附。请用画笔检查并修正漏选或多选。' : '已按自由笔迹生成选区，可继续用画笔修正。')
        }
        setPointHistory(history => [...history, { mode: 'object' as const, points: current.beforePoints, mask: current.beforeMask }].slice(-64))
      } catch (error) { cancelGesture(); setError(failureText(error)); return }
    }
    drag.current = null
    setSelectionStroke([]); setGestureActive(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const addLayer = () => act(() => {
    if (!source || polygon.length < 3 || donor.length !== 2 || !name.trim()) throw new Error('请填写物件名称，圈出至少三个轮廓点，再用两点框选露出的下层取样。')
    if (gestureActive) throw new Error('请先完成或取消当前笔画。')
    if (!selectedPixels) throw new Error('当前物件没有选中像素，请用保留画笔添加选区。')
    if (!Number.isInteger(cleanupPx) || cleanupPx < 0 || cleanupPx > 8) throw new Error('残影清理范围须为0至8的整数像素。')
    if (!editingLayerId && layers.length >= 64) throw new Error('一次拆解最多64层。')
    if (customFootprint && (!Object.values(footprintPx).every(Number.isFinite) || footprintPx.x < 0 || footprintPx.y < 0
      || footprintPx.width <= 0 || footprintPx.height <= 0 || footprintPx.x + footprintPx.width > source.width || footprintPx.y + footprintPx.height > source.height)) throw new Error('物理占地须为原图内的正宽高矩形。')
    const layer = { id: editingLayerId ?? `image-item-${crypto.randomUUID()}`, name: name.trim(), polygon: [...polygon], donor: rectangle(donor), renderLayer, blocksMovement: movement, repair, cleanupPx, ...(fills.length ? { fills } : {}), ...(vector ? { vector } : {}), ...(customFootprint ? { footprintPx: { ...footprintPx } } : {}), ...(selection ? { selectionMask: encodeSelectionMask(selection) } : {}) }
    const next = editingLayerId ? layers.map(item => item.id === editingLayerId ? layer : item) : [...layers, layer]
    const result = previewLayers(source, next)
    setLayers(next); setPreview(result); setPolygon([]); setDonor([]); setName(`物件 ${next.length + 1}`)
    setSelection(null); setReviewSelection(false)
    setEditingLayerId(null); setPointHistory([]); setRepair('seamless'); setCleanupPx(0)
    setObjectFieldsDirty(false)
    setFills([]); setFillPolygon([]); setFillDonor([])
    setVector(undefined)
    setCustomFootprint(false)
    setView('composite'); setNotice('已拆出原始像素并用所选下层取样补底。可取消勾选该层查看补全效果。')
  })
  const undoLayer = () => act(() => {
    if (!source) return
    const next = layers.slice(0, -1)
    setLayers(next); setPreview(previewLayers(source, next)); setHidden(current => current.filter(id => next.some(layer => layer.id === id)))
    setEditingLayerId(null); setPointHistory([]); setPolygon([]); setDonor([])
    setSelection(null); setReviewSelection(false)
    setFills([]); setFillPolygon([]); setFillDonor([])
    setCustomFootprint(false)
  })
  const refineLayer = (layer: Layer) => act(() => {
    cancelGesture()
    setEditingLayerId(layer.id); setName(layer.name); setPolygon([...layer.polygon])
    setSelection(layer.selectionMask && source ? decodeSelectionMask(layer.selectionMask, source) : null); setReviewSelection(false)
    setDonor([{ x: layer.donor.x, y: layer.donor.y }, { x: layer.donor.x + layer.donor.width, y: layer.donor.y + layer.donor.height }])
    setFills(layer.fills ? [...layer.fills] : []); setFillPolygon([]); setFillDonor([])
    setRenderLayer(layer.renderLayer); setMovement(layer.blocksMovement); setRepair(layer.repair ?? 'tile')
    setCleanupPx(layer.cleanupPx ?? 0)
    setVector(layer.vector)
    setCustomFootprint(!!layer.footprintPx)
    if (layer.footprintPx) setFootprintPx({ ...layer.footprintPx })
    setMode('object'); setView('source'); setPointHistory([]); setError('')
    setNotice('可用磁性套索重选，或用保留／排除画笔局部修正。应用后，后续各层将按新选区重新补底。')
    setObjectFieldsDirty(false)
  })
  const addFill = () => act(() => {
    if (polygon.length < 3 || fillPolygon.length < 3 || fillDonor.length !== 2) throw new Error('请先圈出物件，再画补底分区并选取这块分区的下层纹理。')
    if (fills.length >= 8) throw new Error('单个物件最多8个补底分区。')
    setFills(current => [...current, { polygon: [...fillPolygon], donor: rectangle(fillDonor) }])
    setFillPolygon([]); setFillDonor([]); setPointHistory([]); setMode('object')
    setNotice('已添加补底分区。应用物件修正后可隐藏物件检查效果。')
  })
  const recipe = (): ImageImportRecipe => {
    if (!source || ruler.length !== 2) throw new Error('请载入原图并点选两个比例尺端点。')
    return parseImageImportRecipe({ format: 'sceneweave-image-import-recipe', version: 1,
      image: { sha256: source.sha256, pixelWidth: source.width, pixelHeight: source.height }, title,
      calibration: { first: ruler[0], second: ruler[1], distanceMm: Number(distance), ...(origin ? { originPx: origin } : {}) }, roomPointsPx: room, layers, ...(floorVector ? { floorVector } : {}), ...(sourceBoundary.length ? { sourceBoundaryPx: sourceBoundary } : {}), outputScale })
  }
  const exportRecipe = () => act(() => {
    if (gestureActive || polygon.length || selection || editingLayerId || objectFieldsDirty) throw new Error('请先拆出当前物件或应用物件修正，再导出拆解提案。')
    const text = JSON.stringify(recipe(), null, 2), url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'image-import-recipe.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  const importRecipe = async (file: File) => {
    cancelGesture()
    const stamp = ++generation.current
    setPending(true); setError('')
    try {
      if (!source) throw new Error('请先选择这份提案对应的原图。')
      if (file.size > 8 * 1024 * 1024) throw new Error('拆解提案最多8 MiB。')
      const value = parseImageImportRecipe(JSON.parse(await file.text()))
      if (stamp !== generation.current) return
      if (value.image.sha256 !== source.sha256 || value.image.pixelWidth !== source.width || value.image.pixelHeight !== source.height) throw new Error('提案的原图摘要或尺寸不同，请选择匹配的原图。')
      const next = value.layers.map(layer => ({ ...layer, polygon: [...layer.polygon] }))
      const result = previewLayers(source, next)
      setTitle(value.title); setRuler([value.calibration.first, value.calibration.second]); setDistance(String(value.calibration.distanceMm))
      setOrigin(value.calibration.originPx)
      setRoom([...value.roomPointsPx]); setLayers(next); setPreview(result); setPolygon([]); setDonor([]); setHidden([]); setView('composite'); setError('')
      setSelection(null); setReviewSelection(false)
      setPointHistory([]); setEditingLayerId(null); setRepair('seamless'); setCleanupPx(0)
      setObjectFieldsDirty(false)
      setFills([]); setFillPolygon([]); setFillDonor([])
      setVector(undefined); setFloorVector(value.floorVector)
      setSourceBoundary(value.sourceBoundaryPx ? [...value.sourceBoundaryPx] : []); setOutputScale(value.outputScale ?? 1)
      setCustomFootprint(false)
      setNotice('已载入同一原图的拆解提案。请切换原图与各层，检查后再创建工程。')
    } catch (error) { if (stamp === generation.current) setError(failureText(error)) }
    finally { if (stamp === generation.current) setPending(false) }
  }
  const prepare = () => act(() => {
    if (gestureActive || polygon.length || selection || editingLayerId || objectFieldsDirty) throw new Error('请先拆出当前物件或应用物件修正，再预览新工程。')
    const value = recipe()
    if (hasVector) throw new Error('旧提案包含会改变原画的重绘设置，请先恢复原图外观。')
    if (!source || !embed || !license.trim() || !attribution.trim()) throw new Error('请填写署名、完整许可，并确认有权嵌入工程。')
    const capturedSource = { pixels: source, image: value.image }, credits = { licenseText: license, attribution }
    if (onPrepare(signal => prepareImageImportRecipe(capturedSource, value, credits, signal), `图片拆解 · ${value.title}`, markDraft(), value.layers.map(layer => layer.id))) setOpen(false)
  })
  const pointMode: PointMode = mode === 'seed' || mode === 'pan' || mode === 'magnetic' || mode === 'keep' || mode === 'remove' ? 'object' : mode
  const currentPoints = pointsFor(pointMode)
  const undoAnnotation = () => {
    cancelGesture()
    const previous = pointHistory.at(-1)
    if (!previous) return
    setPoints(previous.mode, previous.points)
    if (previous.mode === 'object') setSelection(previous.mask ?? null)
    setMode(previous.mode === 'object' && previous.mask ? 'keep' : previous.mode)
    setView('source'); setShowAnnotations(true); setPointHistory(current => current.slice(0, -1))
  }
  const objectDraft = !!polygon.length || !!selection || !!editingLayerId || objectFieldsDirty
  const report = fidelityResult?.key === fidelityKey ? fidelityResult.data.report : null
  const validDistance = Number.isFinite(Number(distance)) && Number(distance) > 0
  const physicalScale = ruler.length === 2 && validDistance ? Number(distance) / Math.hypot(ruler[1].x - ruler[0].x, ruler[1].y - ruler[0].y) : null
  const objectSize = localVectorSize(polygon)
  const selectLayer = (layer: Layer) => {
    if (objectDraft && editingLayerId !== layer.id) {
      setNotice('当前物件还有未应用的标注。请先应用或取消当前物件修正，再选择其他物件。')
      locate('objects', 'current-object'); return
    }
    if (editingLayerId !== layer.id) refineLayer(layer)
    locate('objects', 'current-object')
  }
  const cancelObjectDraft = () => {
    cancelGesture(); setPolygon([]); setDonor([]); setSelection(null); setReviewSelection(false)
    setEditingLayerId(null); setPointHistory([]); setFills([]); setFillPolygon([]); setFillDonor([])
    setVector(undefined); setCustomFootprint(false); setRepair('seamless'); setCleanupPx(0)
    setObjectFieldsDirty(false)
    setName(`物件 ${layers.length + 1}`); setNotice('当前物件的未应用标注已取消，已拆图层保持。')
  }
  const startObject = () => {
    if (objectDraft) { locate('objects', 'current-object'); return }
    setName(`物件 ${layers.length + 1}`); chooseMode('object'); locate('objects', 'current-object')
  }
  const issues: Array<{ id: string; label: string; blocking: boolean; stage: Stage; target: string }> = []
  if (!source) issues.push({ id: 'source', label: '选择一张原图', blocking: true, stage: 'source', target: 'source' })
  if (source && sourceBoundary.length < 3) issues.push({ id: 'boundary', label: '核对包含墙沿的原图保留范围', blocking: false, stage: 'structure', target: 'boundary' })
  if (room.length < 3) issues.push({ id: 'room', label: '标注房间内边界', blocking: true, stage: 'structure', target: 'room' })
  if (ruler.length !== 2 || !validDistance) issues.push({ id: 'ruler', label: '完成两点标尺与实际距离', blocking: true, stage: 'structure', target: 'ruler' })
  if (objectDraft) issues.push({ id: 'object', label: editingLayerId ? '应用或取消当前物件修正' : '拆出或取消当前物件标注', blocking: true, stage: 'objects', target: 'current-object' })
  if (!license.trim() || !attribution.trim() || !embed) issues.push({ id: 'rights', label: '填写来源、许可并确认嵌入权限', blocking: true, stage: 'overview', target: 'rights' })
  if (hasVector) issues.push({ id: 'legacy', label: '恢复旧提案的原图外观', blocking: true, stage: 'overview', target: 'legacy' })
  if (fidelityError || report && (!report.passed || !report.background.passed)) issues.push({ id: 'fidelity', label: '检查原图保真差异', blocking: true, stage: 'overview', target: 'fidelity' })
  if (report?.sourceReport.extractedInferencePixels) issues.push({ id: 'inferred', label: `${report.sourceReport.extractedInferencePixels} 个裁片像素来自前序补底`, blocking: false, stage: 'overview', target: 'source-report' })
  if (report?.sourceReport.layers.some(row => row.declaredDonors.some(value => value.priorInferencePixels))) issues.push({ id: 'donor', label: '部分取样框包含前序补底区域', blocking: false, stage: 'overview', target: 'source-report' })
  const blockers = issues.filter(issue => issue.blocking).length
  const canPrepare = !!source && room.length >= 3 && ruler.length === 2 && validDistance && !!license.trim() && !!attribution.trim() && embed && !hasVector && !objectDraft && !gestureActive
  const navigation = <>
    <div className="image-import-stages" role="group" aria-label="图片导入阶段">{stages.map(([value, label, hint], index) => <button type="button" key={value} aria-label={({ source: '原图与标定', structure: '结构与比例', objects: '物件与补底', overview: '总览与采用' })[value]} aria-pressed={stage === value} onClick={() => locate(value)}><span>{index + 1}</span><div>{label}<small>{hint}</small></div></button>)}</div>
    <section className="image-import-issues" aria-label="导入待处理问题"><div className="image-import-section-heading"><h3>待处理与复核</h3><span>{issues.length}</span></div>
      {issues.length ? <ul>{issues.map(issue => <li key={issue.id}><button type="button" onClick={() => locate(issue.stage, issue.target)}><span className={issue.blocking ? 'image-import-issue-required' : 'image-import-issue-review'}>{issue.blocking ? '待完成' : '需复核'}</span>{issue.label}</button></li>)}</ul> : <p>准备项已填写。仍需核对物件边缘、补底和原图风格。</p>}
    </section>
    <section className="image-import-objects" aria-label="图片对象清单"><div className="image-import-section-heading"><h3>对象清单</h3><span>{layers.length} / 64</span></div>
      <button type="button" className="image-import-add-object" disabled={!source || occupied} onClick={startObject}>{objectDraft ? '返回当前物件标注' : '＋ 拆出新物件'}</button>
      <div className="image-import-object-list">{layers.map((layer, index) => <div className={`image-import-layer-row${editingLayerId === layer.id ? ' is-current' : ''}`} key={layer.id}>
        <label className="image-import-check" title="在合成图中显示"><input type="checkbox" checked={!hidden.includes(layer.id)} disabled={occupied} aria-label={`显示${layer.name}`} onChange={event => { setView('composite'); setHidden(current => event.target.checked ? current.filter(id => id !== layer.id) : [...current, layer.id]) }}/></label>
        <button type="button" disabled={occupied} aria-label={`精修${layer.name}轮廓`} aria-pressed={editingLayerId === layer.id} onClick={() => selectLayer(layer)}><span>{layer.name}</span><small>{index + 1} · {layer.renderLayer === 'ground' ? '地面' : '物件'}{layer.selectionMask ? ' · 精细选区' : ''}</small></button>
      </div>)}</div>
      {!layers.length && <p>按遮挡顺序拆出物件。已有内容会一直保留在这里。</p>}
      <button type="button" disabled={occupied || !layers.length || objectDraft} onClick={undoLayer}>撤销最近拆层</button>
    </section>
  </>
  const overview = <>
    <div className="image-import-stat"><strong>{source ? `${source.width} × ${source.height}` : '尚未载入'}</strong><span>原图像素</span></div>
    <div className="image-import-stat"><strong>{layers.length} 层</strong><span>已拆物件与装饰</span></div>
    <button type="button" className="image-import-summary-button" onClick={() => locate('structure', ruler.length === 2 ? 'room' : 'ruler')}><strong>房间 {room.length} 点 · 标尺 {ruler.length}/2</strong><span>实际比例与结构</span></button>
    <button type="button" className="image-import-summary-button" onClick={() => locate('overview', 'fidelity')}><strong>{fidelityPending ? '正在核对原图' : report ? report.passed ? '可比较像素保持' : '发现像素差异' : '等待标定'}</strong><span>{report ? `比较 ${report.comparedPixels} · 改变 ${report.changedPixels}` : '保真与推断分开审阅'}</span></button>
    <button type="button" className="image-import-summary-button" onClick={() => locate('overview', 'rights')}><strong>{blockers ? `${blockers} 项待完成` : '可准备工程预览'}</strong><span>{draftToken.current ? '图片草稿未采用' : '本机图片导入'}</span></button>
  </>
  const canvasContent = <section className="image-import-drawing" aria-label="图片标注与分层预览">
    <div className="image-import-canvas-toolbar">
      <div className="image-import-modes" role="group" aria-label="图片标注工具">{modes.map(([key, label]) => <button key={key} type="button" disabled={occupied || !source} aria-pressed={mode === key && (key === 'pan' || view === 'source')} onClick={() => chooseMode(key)}>{label}</button>)}</div>
      <div className="image-selection-tools" role="group" aria-label="物件选区工具"><div className="image-import-modes">{selectionModes.map(([key, label]) => <button key={key} type="button" disabled={occupied || !source} aria-pressed={mode === key && view === 'source'} onClick={() => chooseMode(key)}>{label}</button>)}<button type="button" disabled={!selectedPixels || gestureActive} aria-pressed={reviewSelection} onClick={() => { locate('objects'); setReviewSelection(current => !current) }}>检查物件边缘</button></div>
        {stage === 'objects' && <div className="image-selection-settings"><label>画笔半径<input aria-label="选区画笔半径" type="number" min={1} max={32} step={1} disabled={gestureActive} value={brushRadius} onChange={event => setBrushRadius(Number(event.target.value))}/><span>原图像素</span></label><label>吸附范围<input aria-label="磁性吸附范围" type="number" min={1} max={24} step={1} disabled={gestureActive} value={snapRadius} onChange={event => setSnapRadius(Number(event.target.value))}/></label><label className="image-import-check"><input type="checkbox" checked={snapping} disabled={gestureActive} onChange={event => setSnapping(event.target.checked)}/>吸附到图像边缘</label></div>}
      </div>
      <div className="image-import-modes image-import-annotation-actions"><button type="button" disabled={occupied || gestureActive || mode === 'pan' || currentPoints.length < (pointMode === 'source-boundary' || pointMode === 'room' || pointMode === 'object' || pointMode === 'fill-region' ? 3 : 2)} onClick={() => chooseMode(mode === 'source-boundary' ? 'room' : mode === 'room' ? 'ruler' : pointMode === 'object' ? 'donor' : mode === 'fill-region' ? 'fill-donor' : 'object')}>完成当前标注</button><button type="button" title="撤销上次点选、整笔画笔、套索或顶点拖动" disabled={occupied || gestureActive || !pointHistory.length} onClick={undoAnnotation}>撤销标注</button><button type="button" disabled={occupied || gestureActive || mode === 'pan' || !currentPoints.length} onClick={() => { cancelGesture(); editPoints(pointMode, []) }}>清空当前标注</button></div>
    </div>
    <div className="image-import-viewbar"><div className="image-import-modes" role="group" aria-label="图片预览方式">{(['source', 'composite', 'floor', 'difference', 'inference'] as const).map(key => <button type="button" key={key} aria-pressed={view === key} disabled={!source} onClick={() => chooseView(key)}>{({ source: '原图', composite: '拆层合成', floor: '只看补底', difference: '同坐标差异', inference: '推断区' })[key]}</button>)}</div>
      <div className="image-import-zoom"><label>图像缩放<select aria-label="图片缩放" value={zoom} disabled={!source} onChange={event => changeZoom(event.target.value)}><option value="fit">适应宽度</option><option value="100">100%</option><option value="200">200%</option><option value="400">400%</option></select></label>{view === 'source' && <label className="image-import-check"><input type="checkbox" checked={showAnnotations} onChange={event => { cancelGesture(); setShowAnnotations(event.target.checked) }}/>显示标注</label>}</div>
    </div>
    <div ref={viewport} className="image-import-canvas">{source ? <canvas ref={canvas} style={{ width: zoom === 'fit' ? '100%' : source.width * Number(zoom) / 100, cursor: mode === 'pan' ? 'grab' : 'crosshair' }} onPointerDown={point} onPointerMove={movePointer} onPointerLeave={() => setBrushCursor(null)} onPointerUp={event => releasePointer(event)} onPointerCancel={event => releasePointer(event, true)} onLostPointerCapture={event => releasePointer(event, true)} aria-label="图片标注画布"/> : <div className="image-import-empty"><h3>从一张俯视地图开始</h3><p>保留原图的颜色与笔触，拆出独立物件，检查它们下面的地面。</p><button type="button" onClick={() => locate('source', 'source')}>选择原图</button></div>}</div>
    <div className="image-import-canvas-status">{pending ? <p role="status">正在规范化并读取图片…</p> : error ? <p role="alert" className="image-import-error">{error}</p> : notice ? <p role="status">{notice}</p> : <p>{mode === 'donor' ? '点两个对角，选取露出的同一底材；不要包含当前物件。' : mode === 'fill-region' || mode === 'fill-donor' ? '橙线为补底分区，紫框为该分区取样；后加入分区优先。' : mode === 'magnetic' ? '沿外沿拖画并松开闭合；弱边界请用画笔核对。' : '原图坐标标注 · 拖动顶点精修 · 平移工具或滚动条移动视图'}</p>}</div>
  </section>
  const inspectorContent = <div ref={inspector} className="image-import-controls" aria-label="图片拆解设置">
    <div className="image-import-section-heading"><h3>{stage === 'objects' ? editingLayerId ? '当前物件修正' : '新物件' : stages.find(row => row[0] === stage)?.[1]}</h3><span>{stage === 'objects' && selectedPixels ? `${selectedPixels} px` : ''}</span></div>
    {stage === 'source' && <><fieldset disabled={occupied || gestureActive}><label>原图<input data-import-target="source" type="file" accept="image/png,image/jpeg,image/webp" aria-label="图片转工程原图" disabled={!!source} onChange={event => { const file = event.target.files?.[0]; if (file) void load(file); event.target.value = '' }}/></label>{source && <p>{source.width} × {source.height} px · 已拆 {layers.length} 层。更换原图前需明确丢弃当前草稿。</p>}<label>工程名称<input value={title} maxLength={120} onChange={event => setTitle(event.target.value)}/></label><OriginalAppearance label="地面外观" legacy={floorVector}/>{source && <><label>输出分辨率<select aria-label="原色像素放大倍数" value={outputScale} onChange={event => setOutputScale(Number(event.target.value) as 1 | 2 | 4)}><option value={1}>1× · 原图像素</option><option value={2}>2× · 原色像素放大</option><option value={4}>4× · 原色像素放大</option></select></label><p>输出 {source.width * outputScale} × {source.height * outputScale} 像素。像素放大不生成新细节，遮挡补底仍需审阅。</p></>}</fieldset><details><summary>模型拆解提案 JSON</summary><p>载入同一原图的严格配方。载入后可继续标注和审阅。</p><label>载入提案<input type="file" accept="application/json,.json" disabled={occupied || !source} onChange={event => { const file = event.target.files?.[0]; if (file) void importRecipe(file); event.target.value = '' }}/></label><button type="button" disabled={occupied || !source || objectDraft} onClick={exportRecipe}>导出当前拆解提案</button></details><p className="asset-editor-note">原图与标注保存在当前会话草稿。收起后可继续，强制离开不会自动冷开恢复。</p></>}
    {stage === 'structure' && <fieldset disabled={occupied || gestureActive || !source}><p>保留外框包含原画墙沿；房间使用内边界，比例尺决定实际毫米尺寸。</p><div className="image-import-structure-row"><div><strong>原图保留范围</strong><small>{sourceBoundary.length} 点 · 包含墙沿</small></div><button data-import-target="boundary" type="button" onClick={() => chooseMode('source-boundary')}>编辑保留范围</button></div><div className="image-import-structure-row"><div><strong>房间内边界</strong><small>{room.length} 点</small></div><button data-import-target="room" type="button" onClick={() => chooseMode('room')}>编辑房间轮廓</button></div><div className="image-import-structure-row"><div><strong>比例尺</strong><small>{ruler.length}/2 点</small></div><button type="button" onClick={() => chooseMode('ruler')}>编辑比例尺</button></div><label>两点间实际距离（毫米）<input data-import-target="ruler" type="number" min={1} step={1} value={distance} onChange={event => setDistance(event.target.value)}/></label>{physicalScale && Number.isFinite(physicalScale) ? <p>当前比例：1个原图像素约 {physicalScale.toFixed(2)} mm。</p> : <p>在图上选择两个已知距离端点，再输入实际毫米距离。</p>}<p>保留范围 {sourceBoundary.length} 点 · 房间 {room.length} 点 · 比例尺 {ruler.length}/2 点 · 当前物件 {polygon.length} 点 · 取样 {donor.length}/2 点</p></fieldset>}
    {stage === 'objects' && <><fieldset disabled={occupied || gestureActive || !source} onChangeCapture={() => setObjectFieldsDirty(true)}><label>物件名称<input data-import-target="current-object" value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label><label>绘制位置<select aria-label="绘制位置" value={renderLayer} onChange={event => { const next = event.target.value as 'ground' | 'object'; setRenderLayer(next); if (next === 'ground') setMovement(false) }}><option value="object">物件</option><option value="ground">地面装饰／地毯</option></select></label><OriginalAppearance label="物件外观" legacy={vector}/><label className="image-import-check"><input type="checkbox" checked={movement} onChange={event => setMovement(event.target.checked)}/>阻挡移动</label><label className="image-import-check"><input type="checkbox" checked={customFootprint} onChange={event => { setCustomFootprint(event.target.checked); const size = localVectorSize(polygon); if (event.target.checked && size) setFootprintPx({ x: Math.floor(Math.min(...polygon.map(point => point.x))) + size.width * .1, y: Math.floor(Math.min(...polygon.map(point => point.y))) + size.height * .1, width: size.width * .8, height: size.height * .8 }) }}/>自定义物理占地</label>{objectSize && physicalScale && Number.isFinite(physicalScale) && <p>图像范围约 {Math.round(objectSize.width * physicalScale)} × {Math.round(objectSize.height * physicalScale)} mm；物理占地独立。</p>}{customFootprint && <div><p>从原图左上角计，填写实际占地；图像轮廓独立保留。</p><div className="image-import-zone-coordinates">{([['x', 'X'], ['y', 'Y'], ['width', '宽'], ['height', '高']] as const).map(([key, label]) => <label key={key}>{label}（像素）<input aria-label={`物理占地原图${label}`} type="number" min={key === 'width' || key === 'height' ? .01 : 0} step="any" value={footprintPx[key]} onChange={event => setFootprintPx(current => ({ ...current, [key]: Number(event.target.value) }))}/></label>)}</div></div>}<h4>下层纹理与补底</h4><label>补底方式<select value={repair} onChange={event => setRepair(event.target.value as 'seamless' | 'tile' | 'aligned')}><option value="seamless">纹理衔接</option><option value="aligned">对齐纹理接缝</option><option value="tile">重复取样</option></select></label>{repair === 'aligned' && <p>在所选同材质取样中寻找贴合接缝的位置，不旋转或重画。隐藏区域仍是推断。</p>}<label>残影清理范围（像素）<input type="number" min={0} max={8} step={1} value={cleanupPx} onChange={event => setCleanupPx(Number(event.target.value))}/></label><label>相似颜色容差<input type="number" min={0} max={255} value={tolerance} onChange={event => setTolerance(event.target.value)}/></label><details className="image-import-fill-settings"><summary>分区补底</summary><p>跨越地毯和木板时分别圈出分区，再选择各自露出的纹理。后加入分区优先。</p><button type="button" aria-pressed={mode === 'fill-region'} onClick={() => chooseMode('fill-region')}>画补底分区</button><button type="button" aria-pressed={mode === 'fill-donor'} onClick={() => chooseMode('fill-donor')}>分区取样</button><button type="button" onClick={addFill}>添加补底分区</button>{fills.map((fill, index) => <div className="image-import-fill-row" key={index}><span>分区 {index + 1} · {fill.polygon.length} 点</span><button type="button" onClick={() => setFills(current => current.filter((_, fillIndex) => fillIndex !== index))}>移除分区 {index + 1}</button></div>)}</details>{selection && <p role="status">精细选区 · {selectedPixels} 个原图像素。孔洞与分离部分一并保留。</p>}<div className="image-import-object-actions"><button type="button" className="primary" disabled={!selectedPixels || donor.length !== 2} onClick={addLayer}>{editingLayerId ? '应用物件修正并补底' : '拆出物件并补底'}</button><button type="button" disabled={!objectDraft} onClick={cancelObjectDraft}>取消当前物件标注</button></div></fieldset><p className="asset-editor-note">选进背景时，用画笔修正选区；贴体边缘已混色时另行审阅颜色。不要为消除色边削掉黑描边、细枝或真实阴影。</p>{reviewSelection && selectionSource && effectiveSelection && !!selectedPixels && !gestureActive && <ImageSelectionReview image={selectionSource} mask={effectiveSelection}/>}</>}
    {stage === 'overview' && <><section className="image-import-fidelity" aria-label="原图保真对照" data-import-target="fidelity" tabIndex={-1}><h4>原图保真与推断</h4>{fidelityPending ? <p role="status">正在按原图同坐标比较拆层结果…</p> : report ? <div role="status"><p>{report.passed ? '同坐标像素检查通过' : '同坐标像素检查未通过'} · 比较 {report.comparedPixels} 像素 · 改变 {report.changedPixels} 像素</p><p>推断 {report.inferredPixels} 像素，遮挡 {report.occlusionPixels} 像素。推断区仅标明补底范围，内容仍待人工核对。</p><div aria-label="拆层来源检查" data-import-target="source-report" tabIndex={-1}><p>来源检查：裁片中有 {report.sourceReport.extractedInferencePixels} 个像素来自前序补底。来源检查不能判断轮廓是否准确或木纹是否自然。</p>{report.sourceReport.layers.some(row => row.declaredDonors.some(donor => donor.priorInferencePixels > 0)) ? <ul>{report.sourceReport.layers.flatMap(row => row.declaredDonors.filter(donor => donor.priorInferencePixels > 0).map(donor => <li key={`${row.layerId}-${donor.index}`}><button type="button" className="image-import-report-link" onClick={() => { const layer = layers.find(layer => layer.id === row.layerId); if (layer) selectLayer(layer) }}>{layers.find(layer => layer.id === row.layerId)?.name ?? row.layerId} · 取样 {donor.index + 1}</button>框内 {donor.priorInferencePixels} 个像素来自前序补底，请核对是否应换用原图中露出的底材。这是取样框交集，尚未统计算法实际读取量。</li>))}</ul> : <p>当前取样框未与前序补底区域相交；原图中的取样仍需核对材质、阴影和方向。</p>}</div></div> : <p>完成房间轮廓和比例尺后，可对照同坐标差异和推断区。</p>}{fidelityError && <p role="alert" className="image-import-error">{fidelityError}</p>}<div className="image-import-review-actions"><button type="button" disabled={!source} onClick={() => chooseView('difference')}>查看像素差异</button><button type="button" disabled={!source} onClick={() => chooseView('inference')}>查看推断范围</button></div></section>{hasVector && <div className="image-import-legacy-warning" data-import-target="legacy" tabIndex={-1} role="alert"><p>旧提案含矢量描摹或材质重绘，会改变原画，采用已暂停。</p><button type="button" onClick={() => { setFloorVector(undefined); setVector(undefined); setLayers(current => current.map(layer => { const { vector: ignored, ...rest } = layer; return rest })) }}>恢复原图外观</button></div>}<fieldset disabled={occupied} data-import-target="rights" tabIndex={-1}><h4>来源与许可</h4><label>署名与来源<input value={attribution} onChange={event => setAttribution(event.target.value)}/></label><label>完整许可<textarea rows={4} value={license} onChange={event => setLicense(event.target.value)}/></label><label className="image-import-check"><input type="checkbox" checked={embed} onChange={event => setEmbed(event.target.checked)}/>我确认有权将这些像素和派生素材嵌入工程及个人素材库</label></fieldset><p>准备后将审阅独立完整工程，保存并采用成功后才清除本次图片草稿。</p><p className="image-import-storage-note">保存、重开检查在工程创建后执行，结果另行记录。</p></>}
    {draftToken.current && <div className="image-import-draft-note"><p>图片草稿尚未采用，收起后可继续。</p><button type="button" disabled={occupied} onClick={() => { close(); onDraftChange(null) }}>丢弃图片草稿</button></div>}
  </div>
  return <>
    <button className="secondary asset-wide" disabled={disabled} onClick={() => setOpen(true)}>从图片新建场景</button>
    {createPortal(<dialog ref={dialog} role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} className="asset-editor-dialog image-import-workbench" aria-labelledby="image-import-heading" onChangeCapture={() => { markDraft() }} onCancel={event => { event.preventDefault(); close() }}>
      <AssetEditorLayout title="图片导入工作台" subtitle="原图、结构、物件与整体审阅集中编辑；切换内容保留当前草稿。" scopeLabel="图片导入 · 本机会话草稿" headingId="image-import-heading" navigation={navigation} overview={overview} canvas={canvasContent} inspector={inspectorContent} actions={<button type="button" className="primary" disabled={occupied || !canPrepare} onClick={prepare}>预览可编辑新工程</button>} onClose={close} closeLabel="收起并保留草稿" closeAriaLabel="关闭图片拆解"/>
    </dialog>, document.body)}
  </>
}
