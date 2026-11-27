import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { toBundle, type EditableProject } from '../../application/workspace/project'
import { taskBudgetProfile, type TaskBudgetProfileId } from '../../shared/budget/task-budget'
import { MAP_LANDSCAPE_LIMITS, MAP_REFERENCE_DEFAULTS, MAP_REFERENCE_TOLERANCE, MAP_SHALLOW_POINTS, MAP_STRUCTURE_POINTS, parseMapGenerate,
  type MapAscentRoute, type MapLandscapeRecipe, type MapLandformStructure, type MapShallowZone, type parseMapReference } from '../../shared/generation/map-authoring'
import { referenceLandAt, traceMapReference, type MapReferenceResult } from '../../shared/generation/map-reference'
import { referenceShallowIssue } from '../../shared/generation/map-reference-coast'
import { fitReferenceLandforms } from '../../shared/generation/map-reference-landforms'
import { landformStructureIssue, mapLandformStructure } from '../../shared/generation/landform-structure'
import { polygonsOverlap } from '../../shared/geometry/geometry'
import { simplifyOpenPolyline } from '../../shared/image-import/vector'
import type { PointMm } from '../../shared/model/scene'
import { PACKAGE_LIMITS } from '../../shared/project/limits'
import { drawReferenceFeatures, drawReferenceIssues, readMapReference } from '../../platform/browser/content/map-reference'
import type { diagnoseMapCandidate, generateMapCandidate, prepareMapDiagnosis } from '../../platform/browser/content/map-authoring'
import './reference-map.css'

type SampleMode = 'background' | 'foreground' | 'keep' | 'shallow' | 'omit'
type Mode = SampleMode | 'relief' | 'ascent' | 'cover' | 'scenery' | 'restore-land' | 'restore-background' | 'scale'
type Correction = ReturnType<typeof parseMapReference>['corrections'][number]
type ReferenceImage = { file: File; width: number; height: number; data: Uint8ClampedArray }
type Diagnosis = Awaited<ReturnType<typeof diagnoseMapCandidate>>
type Candidate = Awaited<ReturnType<typeof generateMapCandidate>>
type CheckedDraft = Awaited<ReturnType<typeof prepareMapDiagnosis>>
type Form = MapLandscapeRecipe['landforms'][number]
type Cover = MapLandscapeRecipe['covers'][number]
type Scenery = MapLandscapeRecipe['scenery'][number]
type Mark = { point: PointMm; color: string; radius?: PointMm; rotationDeg?: number }
type Sketch = { kind: 'area' | 'ridge' | 'breakline' | 'shallow'; id?: string; points: PointMm[] }

const tools = { background: '取背景色', foreground: '取陆地色', keep: '保留地块', shallow: '取浅水色', omit: '忽略小块', relief: '标地貌', ascent: '标低处出发区',
  cover: '铺地表', scenery: '标布景', 'restore-land': '补陆地', 'restore-background': '擦成背景', scale: '标定比例' } satisfies Record<Mode, string>
const direction = { north: '北侧', east: '东侧', south: '南侧', west: '西侧' } as const
const covers = { grass: '草地', sand: '沙地', rock: '裸岩' } as const
const forms = { plateau: '台地', hill: '山丘', ridge: '山脊', lowland: '低地' } as const
const palettes = { woodland: '林木', scrub: '灌草', stone: '碎石' } as const

function isSampleMode(mode: Mode): mode is SampleMode {
  return mode === 'background' || mode === 'foreground' || mode === 'keep' || mode === 'shallow' || mode === 'omit'
}

function structureIssue(outline: MapReferenceResult, form: Form, structure: MapLandformStructure) {
  const region = outline.regions.find(row => row.id === form.areaId)
  return region ? landformStructureIssue(structure, form.at, form.radius, region.boundary,
    outline.lakes.filter(row => row.areaId === form.areaId).map(row => row.boundary)) : '先在同一陆地标记地貌。'
}

function marksFit(outline: MapReferenceResult, forms: Form[], routes: MapAscentRoute[], zones: (Cover | Scenery)[]) {
  return forms.every(row => referenceLandAt(outline, row.at) === row.areaId)
    && routes.every(row => referenceLandAt(outline, row.ascent.from.at) === row.areaId
      && forms.some(form => form.id === row.ascent.toLandmarkId && form.areaId === row.areaId))
    && zones.every(row => 'at' in row.region && referenceLandAt(outline, row.region.at) === row.areaId)
}

function extendStroke(stroke: Correction, point: PointMm) {
  const last = stroke.points.at(-1)!
  if (point.x === last.x && point.y === last.y) return stroke
  const points = [...stroke.points, point]
  if (points.length <= MAP_REFERENCE_DEFAULTS.strokePoints) return { ...stroke, points }
  let tolerance = Math.max(1, stroke.radiusPx * .24)
  let reduced = simplifyOpenPolyline(points, tolerance)
  while (reduced.length > MAP_REFERENCE_DEFAULTS.strokePoints) {
    tolerance *= 1.5
    reduced = simplifyOpenPolyline(points, tolerance)
  }
  return { ...stroke, points: reduced }
}

/** Object URLs belong to the current view and are released on input changes. */
function useImageUrl(blob: Blob | null) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) { setUrl(''); return }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

function ReferenceCanvas({ source, outline, marks, landforms, shallows, sketch, scalePoints, diagnosis, correction, corrections, onStroke, onPoint }: {
  source: ReferenceImage; outline: MapReferenceResult | null; marks: Mark[]; landforms: Form[]; shallows: MapShallowZone[]; sketch: Sketch | null;
  scalePoints: PointMm[];
  diagnosis: Diagnosis | null; correction: Omit<Correction, 'points'> | null; corrections: Correction[];
  onStroke: (stroke: Correction) => void; onPoint: (point: PointMm) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null), url = useImageUrl(source.file)
  const dragging = useRef<number | null>(null), [stroke, setStroke] = useState<Correction | null>(null)
  const pending = useRef<Correction | null>(null)
  const scale = Math.min(1, 950 / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
  const position = (event: Pick<PointerEvent<HTMLCanvasElement>, 'currentTarget' | 'clientX' | 'clientY'>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(source.width - 1, Math.floor((event.clientX - rect.left) * source.width / rect.width))),
      y: Math.max(0, Math.min(source.height - 1, Math.floor((event.clientY - rect.top) * source.height / rect.height))) }
  }
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, source.width, source.height)
    ctx.lineWidth = 2.5 / scale; ctx.lineJoin = 'round'
    const paint = (points: PointMm[], stroke: string, fill?: string) => {
      if (!points.length) return
      ctx.beginPath()
      points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
      if (fill) { ctx.closePath(); ctx.fillStyle = fill; ctx.fill() }
      ctx.strokeStyle = stroke; ctx.stroke()
    }
    for (const row of outline?.regions ?? []) paint(row.boundary, '#70FFC6', '#1E8D5124')
    for (const row of outline?.lakes ?? []) paint(row.boundary, '#78EDFF', '#086EB233')
    drawReferenceFeatures(ctx, landforms, shallows, scale)
    if (scalePoints.length === 2) paint(scalePoints, '#FFADDE')
    for (const { points, radiusPx, kind } of [...corrections, ...(stroke ? [stroke] : [])]) {
      const color = kind === 'land' ? '#65FFD366' : '#359CFF88'
      ctx.save(); ctx.lineWidth = radiusPx * 2; ctx.lineCap = 'round'
      if (points.length === 1) {
        ctx.beginPath(); ctx.arc(points[0].x, points[0].y, radiusPx, 0, Math.PI * 2)
        ctx.fillStyle = color; ctx.fill()
      } else paint(points, color)
      ctx.restore()
    }
    if (diagnosis) {
      const b = diagnosis.geometry.boundsMm
      const pixelsPerMm = Math.max(source.width / b.width, source.height / b.height)
      const originX = (source.width - b.width * pixelsPerMm) / 2, originY = (source.height - b.height * pixelsPerMm) / 2
      const map = (p: PointMm) => ({ x: (p.x - b.x) * pixelsPerMm + originX, y: (p.y - b.y) * pixelsPerMm + originY })
      for (const road of diagnosis.geometry.roads) paint(road.pointsMm.map(map), '#FFF196')
      for (const [index, marker] of diagnosis.diagnosticMarkers.entries()) {
        const p = map(marker.atMm)
        ctx.beginPath(); ctx.arc(p.x, p.y, 12 / scale, 0, Math.PI * 2)
        ctx.fillStyle = '#A84025'; ctx.fill(); ctx.strokeStyle = '#FFF'; ctx.stroke()
        ctx.font = `bold ${14 / scale}px sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#FFF'; ctx.fillText(String(index + 1), p.x, p.y)
      }
    }
    for (const { point, color, radius, rotationDeg } of marks) {
      if (radius) {
        ctx.beginPath(); ctx.ellipse(point.x, point.y, radius.x, radius.y, (rotationDeg ?? 0) * Math.PI / 180, 0, Math.PI * 2)
        ctx.strokeStyle = color; ctx.stroke()
      }
      ctx.beginPath(); ctx.arc(point.x, point.y, 4.5 / scale, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#253233'; ctx.stroke()
    }
    if (sketch) {
      paint(sketch.points, '#FFF1A3')
      for (const p of sketch.points) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 / scale, 0, Math.PI * 2); ctx.fillStyle = '#FFF1A3'; ctx.fill()
      }
    }
    if (outline) drawReferenceIssues(ctx, outline.issues, scale)
  }, [source, outline, diagnosis, marks, landforms, shallows, sketch, scalePoints, scale, width, height, corrections, stroke])
  return <div className="reference-map-board" style={{ aspectRatio: `${source.width} / ${source.height}` }}>
    {url && <img src={url} alt="原始参考图"/>}
    <canvas ref={ref} width={width} height={height} aria-label="参考图轮廓及取点画布" data-brush={correction ? 'active' : undefined}
      onPointerDown={event => {
        if (!correction || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId); dragging.current = event.pointerId
        pending.current = { ...correction, points: [position(event)] }; setStroke(pending.current)
      }}
      onPointerMove={event => {
        const current = pending.current
        if (!current || dragging.current !== event.pointerId) return
        const p = position(event)
        const last = current.points.at(-1)!
        if (Math.hypot(p.x - last.x, p.y - last.y) < Math.max(1, current.radiusPx * .36)) return
        pending.current = extendStroke(current, p); setStroke(pending.current)
      }}
      onPointerUp={event => {
        if (dragging.current !== event.pointerId) return
        const current = pending.current
        dragging.current = null; pending.current = null; setStroke(null)
        if (current) onStroke(extendStroke(current, position(event)))
      }}
      onPointerCancel={() => { dragging.current = null; pending.current = null; setStroke(null) }}
      onClick={event => {
        if (!correction) onPoint(position(event))
      }}/>
  </div>
}

export default function ReferenceMapPanel({ active, disabled, onAdopt }: { active: boolean; disabled: boolean; onAdopt: (project: EditableProject) => void }) {
  const task = useRef<AbortController | null>(null), nextId = useRef(1)
  const checkedDraft = useRef<{ key: string; value: CheckedDraft } | null>(null), markerFields = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState(''), [error, setError] = useState('')
  const [source, setSource] = useState<ReferenceImage | null>(null), [title, setTitle] = useState('参考图地形')
  const [guide, setGuide] = useState<Pick<ReturnType<typeof parseMapReference>,
    SampleMode | 'corrections' | 'detail' | 'tolerance' | 'environment' | 'shorelineFromReference'>>({
      background: [], foreground: [], keep: [], shallow: [], omit: [], corrections: [], environment: 'coast', detail: 'balanced',
      tolerance: MAP_REFERENCE_TOLERANCE, shorelineFromReference: true,
    })
  const [mode, setMode] = useState<Mode>('background'), [outline, setOutline] = useState<MapReferenceResult | null>(null)
  const [outlineStale, setOutlineStale] = useState(false)
  const [landforms, setLandforms] = useState<Form[]>([]), [routes, setRoutes] = useState<MapAscentRoute[]>([])
  const [coverZones, setCoverZones] = useState<Cover[]>([]), [sceneryZones, setSceneryZones] = useState<Scenery[]>([])
  const [shape, setShape] = useState<Form['shape']>('plateau'), [elevation, setElevation] = useState(6), [radius, setRadius] = useState(9)
  const [verticalRadius, setVerticalRadius] = useState<number | null>(null), [rotation, setRotation] = useState(0)
  const [preserveRelief, setPreserveRelief] = useState(false), [editingId, setEditingId] = useState('')
  const [cover, setCover] = useState<Cover['cover']>('grass'), [palette, setPalette] = useState<Scenery['palette']>('woodland')
  const [goal, setGoal] = useState(''), [side, setSide] = useState<keyof typeof direction | ''>('')
  const [width, setWidth] = useState(1.5), [rise, setRise] = useState(1.2), [density, setDensity] = useState(.64)
  const [minimumWidth, setMinimumWidth] = useState<number | null>(null)
  const [sceneryDensity, setSceneryDensity] = useState(.92)
  const [mapLength, setMapLength] = useState(MAP_REFERENCE_DEFAULTS.longEdgeMm / 1000)
  const [scalePoints, setScalePoints] = useState<PointMm[]>([]), [scaleMeters, setScaleMeters] = useState<number | null>(null)
  const [routeStyle, setRouteStyle] = useState<MapAscentRoute['style']>('stairs')
  const [staircase, setStaircase] = useState<MapAscentRoute['ascent']['staircase']>('terrain')
  const [artStyle, setArtStyle] = useState<MapLandscapeRecipe['style']>('original')
  const [automaticSurface, setAutomaticSurface] = useState(true)
  const [automaticStructure, setAutomaticStructure] = useState(true)
  const [manualShallows, setManualShallows] = useState<MapShallowZone[]>([])
  const [hiddenShallows, setHiddenShallows] = useState<MapShallowZone[]>([])
  const [sketch, setSketch] = useState<Sketch | null>(null)
  const [budgetId, setBudgetId] = useState<TaskBudgetProfileId>('standard')
  const [keyboard, setKeyboard] = useState<PointMm>({ x: 0, y: 0 })
  const [brushSize, setBrushSize] = useState(12)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null), [candidate, setCandidate] = useState<Candidate | null>(null)
  const [usable, setUsable] = useState<{ result: Candidate; top: Blob; diagnosis: Diagnosis; style: MapLandscapeRecipe['style'] } | null>(null)
  const [top, setTop] = useState<Blob | null>(null), [oblique, setOblique] = useState<Blob | null>(null), [view, setView] = useState<'top' | 'oblique'>('top')
  const topUrl = useImageUrl(top), obliqueUrl = useImageUrl(oblique)
  const { marked: resolvedLandforms, outcrops, cliffs } = useMemo(() => {
    if (!source || !outline || outlineStale || !automaticStructure) return { marked: landforms, outcrops: [], cliffs: [] }
    const [from, to] = scalePoints
    const mmPerPixel = from && to && scaleMeters !== null
      ? Math.round(scaleMeters * 1000) / Math.hypot(to.x - from.x, to.y - from.y)
      : Math.round(mapLength * 1000) / Math.max(source.width, source.height)
    const coast = guide.environment === 'coast' && guide.shorelineFromReference
      ? { mmPerPixel, starts: routes.map(row => row.ascent.from) } : undefined
    return fitReferenceLandforms(source, outline, landforms, coast)
  }, [source, outline, outlineStale, automaticStructure, guide.environment, guide.shorelineFromReference, landforms, routes, scalePoints, scaleMeters, mapLength])
  const shallows = useMemo(() => guide.environment === 'coast' && outline && !outlineStale ? [...manualShallows,
    ...outline.coastFeatures.shallows.filter(row => !hiddenShallows.some(hidden => polygonsOverlap(hidden.boundary, row.boundary))
      && !manualShallows.some(custom => polygonsOverlap(row.boundary, custom.boundary)))
      .slice(0, MAP_LANDSCAPE_LIMITS.shallows - manualShallows.length)] : [],
  [outline, outlineStale, guide.environment, manualShallows, hiddenShallows])
  const cancel = () => { task.current?.abort(); task.current = null; setStatus('') }
  useEffect(() => {
    if (!active) setStatus('')
    return () => { task.current?.abort(); task.current = null }
  }, [active])

  const resetPreview = () => { checkedDraft.current = null; setDiagnosis(null); setCandidate(null); setTop(null); setOblique(null); setView('top'); setError('') }
  const changeGuide = (changes: Partial<typeof guide>) => { setGuide({ ...guide, ...changes }); setSketch(null); setOutlineStale(true); resetPreview() }
  const run = async (label: string, execute: (signal: AbortSignal) => Promise<void>) => {
    if (task.current) return
    const abort = new AbortController()
    task.current = abort; setStatus(label); setError('')
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
      abort.signal.throwIfAborted()
      await execute(abort.signal)
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (task.current === abort && !abort.signal.aborted) { task.current = null; setStatus('') }
    }
  }
  const load = (file: File) => void run('正在读取本地参考图…', async signal => {
    if (!file.size || file.size > PACKAGE_LIMITS.imageBytes) throw new Error('请选择不超过 20 MiB 的静态 PNG、JPEG 或 WebP。')
    const decoded = await readMapReference(new Uint8Array(await file.arrayBuffer()), signal)
    signal.throwIfAborted()
    changeGuide({ background: [], foreground: [], keep: [], shallow: [], omit: [], corrections: [] })
    setSource({ ...decoded, file }); setOutline(null); setMode('background')
    setLandforms([]); setRoutes([]); setCoverZones([]); setSceneryZones([]); setGoal(''); setEditingId('')
    setScalePoints([]); setScaleMeters(null); setUsable(null); setAutomaticSurface(true); setAutomaticStructure(true)
    setManualShallows([]); setHiddenShallows([])
  })
  const trace = (next = guide) => source && void run('正在拟合地形轮廓…', async signal => {
    const value = traceMapReference(source, { ...next, title })
    signal.throwIfAborted()
    const owner = <T extends { areaId: string },>(row: T, p: PointMm) => ({ ...row, areaId: referenceLandAt(value, p) ?? row.areaId })
    const forms = landforms.map(row => owner(row, row.at)), ascents = routes.map(row => owner(row, row.ascent.from.at))
    const ground = coverZones.map(row => 'at' in row.region ? owner(row, row.region.at) : row)
    const scenery = sceneryZones.map(row => 'at' in row.region ? owner(row, row.region.at) : row)
    setLandforms(forms); setRoutes(ascents); setCoverZones(ground); setSceneryZones(scenery)
    resetPreview(); setGuide(next); setOutline(value); setOutlineStale(false); setSketch(null)
    if (!marksFit(value, forms, ascents, [...ground, ...scenery])) {
      setError('有标记落在陆地外，或登高路线的两端分属不同陆地。请移动或移除受影响的标记。')
    }
  })
  const point = (p: PointMm) => {
    if (!source || disabled || status) return
    if (sketch) {
      const limit = sketch.kind === 'shallow' ? MAP_SHALLOW_POINTS : MAP_STRUCTURE_POINTS
      if (sketch.points.length >= limit) { setError('标记点已满，可以保存当前形状或撤回一点。'); return }
      if (!sketch.points.some(point => point.x === p.x && point.y === p.y)) {
        setSketch({ ...sketch, points: [...sketch.points, p] }); setError('')
      }
      return
    }
    if (isSampleMode(mode)) {
      const limit = mode === 'background' ? MAP_REFERENCE_DEFAULTS.backgroundSamples : MAP_REFERENCE_DEFAULTS.detailSamples
      if (guide[mode].length >= limit) { setError('取样点已满。可撤掉最后一点再继续。'); return }
      changeGuide({ [mode]: [...guide[mode], p] })
      return
    }
    if (correction) { addCorrection({ ...correction, points: [p] }); return }
    if (mode === 'scale') {
      const first = scalePoints[0]
      if (scalePoints.length === 1 && first.x === p.x && first.y === p.y) { setError('请选择不同的第二个标尺点。'); return }
      setScalePoints(scalePoints.length === 1 ? [first, p] : [p]); resetPreview(); return
    }
    if (outlineStale) { setError('请重新提取最新轮廓，再继续标记。'); return }
    const areaId = outline && referenceLandAt(outline, p)
    if (!areaId) {
      setError('请在叠图上的陆地内取点。')
      return
    }
    const ry = mode === 'relief' ? verticalRadius ?? radius : radius
    if ([radius, ry].some(value => value < 1 || value > 45 || !Number.isFinite(value))) {
      setError('范围半径须为原图长边的 1% 至 45%。'); return
    }
    if (mode === 'relief' && (elevation < -30 || elevation > 30 || !Number.isFinite(elevation))) {
      setError('地貌高程须在 −30 至 30 米之间。'); return
    }
    const pixelRadius = (percent: number) => Math.max(2, Math.round(Math.max(source.width, source.height) * percent / 100))
    const requestedRadius = pixelRadius(radius)
    const maximum = mode === 'cover' || mode === 'scenery' ? Math.min(p.x, p.y, source.width - p.x, source.height - p.y) : requestedRadius
    const size = Math.min(requestedRadius, maximum)
    if (size < 2) { setError('范围过于靠近裁切边，请在图内取一点。'); return }
    const region = { at: p, radius: { x: size, y: mode === 'relief' ? pixelRadius(ry) : size } }
    const id = editingId || `mark-${nextId.current++}`
    if (mode === 'relief') {
      if (!Number.isFinite(rotation) || rotation < 0 || rotation >= 360) { setError('旋转角度须在 0 至 360° 以内。'); return }
      if (!editingId && landforms.length >= MAP_LANDSCAPE_LIMITS.landforms) { setError('请先移除不需要的地貌标记。'); return }
      if (routes.some(row => row.ascent.toLandmarkId === id && (row.areaId !== areaId || shape === 'lowland'))) {
        setError('这个地貌是登高路线的终点。请先调整或移除关联路线。'); return
      }
      const old = landforms.find(row => row.id === id)
      const structure = old?.structure && mapLandformStructure(old.structure, at => ({ x: at.x + p.x - old.at.x, y: at.y + p.y - old.at.y }))
      const updated: Form = { id, name: old?.name ?? `${forms[shape]} ${nextId.current - 1}`, areaId,
        shape, ...region, elevationMm: Math.round(elevation * 1000), rotationDeg: rotation, cover,
        ...(structure ? { structure } : {}),
        ...(preserveRelief && shape !== 'lowland' ? { preserveRelief: true } : {}) }
      if (structure && outline) {
        const problem = structureIssue(outline, updated, structure)
        if (problem) { setError(problem); return }
      }
      setLandforms(editingId ? landforms.map(row => row.id === id ? updated : row) : [...landforms, updated])
      if (shape !== 'lowland') setGoal(id)
      else if (goal === id) setGoal('')
    } else if (mode === 'ascent') {
      if (!landforms.some(row => row.id === goal && row.areaId === areaId && row.shape !== 'lowland')) {
        setError('请先标出同一陆地上的高处，并选择它作为终点。'); return
      }
      if (width < .1 || width > 6 || rise < .1 || rise > 60 || !Number.isFinite(width + rise)) {
        setError('净宽须在 0.1 至 6 米之间，最小高差须在 0.1 至 60 米之间。'); return
      }
      if (minimumWidth !== null && (!Number.isFinite(minimumWidth) || minimumWidth < .1 || minimumWidth > width)) {
        setError('可接受的净宽下限须至少为 0.1 米，且不超过首选净宽。'); return
      }
      if (!editingId && routes.length >= MAP_LANDSCAPE_LIMITS.routes) { setError('请先移除不需要的路线。'); return }
      const updated: MapAscentRoute = { id, areaId, style: routeStyle, widthMm: Math.round(width * 1000),
        ascent: { from: region, toLandmarkId: goal, minRiseMm: Math.round(rise * 1000), staircase,
          ...(minimumWidth === null ? {} : { minWidthMm: Math.round(minimumWidth * 1000) }) },
        ...(side ? { around: { landmarkId: goal, side } } : {}) }
      setRoutes(editingId ? routes.map(row => row.id === id ? updated : row) : [...routes, updated])
    } else if (mode === 'cover') {
      if (coverZones.length >= MAP_LANDSCAPE_LIMITS.covers) { setError('请先移除不需要的地表标记。'); return }
      setCoverZones([...coverZones, { id, areaId, region, cover }])
    } else {
      if (sceneryZones.length >= MAP_LANDSCAPE_LIMITS.scenery) { setError('请先移除不需要的布景区域。'); return }
      setSceneryZones([...sceneryZones, { id, areaId, region, palette, density: sceneryDensity, pattern: palette === 'woodland' ? 'grove' : 'meadow' }])
    }
    setEditingId(''); resetPreview()
  }
  const correction = !sketch && (mode === 'restore-land' || mode === 'restore-background')
    ? { kind: mode === 'restore-land' ? 'land' as const : 'background' as const, radiusPx: brushSize } : null
  const addCorrection = (stroke: Correction, retrace = false) => {
    if (guide.corrections.length >= MAP_REFERENCE_DEFAULTS.correctionStrokes) { setError('可撤回最后一笔后继续修正。'); return }
    const corrections = [...guide.corrections, stroke]
    if (retrace) trace({ ...guide, corrections })
    else changeGuide({ corrections })
  }
  const saveSketch = () => {
    if (!sketch || !outline) return
    const { kind, points, id } = sketch
    if (kind === 'shallow') {
      const problem = referenceShallowIssue(points, outline.referenceSizePx, outline.regions)
      if (problem) { setError(problem); return }
      if (!manualShallows.some(row => row.id === id) && manualShallows.length >= MAP_LANDSCAPE_LIMITS.shallows) {
        setError('请先移除一个手绘浅水区域。'); return
      }
      const replaced = outline.coastFeatures.shallows.find(row => row.id === id)
      if (replaced && !manualShallows.some(row => row.id === id)) setHiddenShallows(hidden => [...hidden, replaced])
      setManualShallows(previous => [...previous.filter(row => row.id !== id), { id: id ?? `mark-${nextId.current++}`, boundary: points }])
    } else {
      const form = resolvedLandforms.find(row => row.id === id)
      if (!form) return
      const previous = form.structure
      const structure: MapLandformStructure | undefined = kind === 'area' ? { kind, boundary: points }
        : kind === 'ridge' ? { kind, centerline: points }
          : previous && { ...previous, breakline: points }
      if (!structure) return
      const problem = structureIssue(outline, form, structure)
      if (problem) { setError(problem); return }
      setLandforms(current => current.map(row => row.id === id ? { ...row, structure } : row))
    }
    setSketch(null); resetPreview()
  }
  const request = () => {
    if (!outline || outlineStale || outline.request.recipe.kind !== 'landscape') throw new Error('请先确认当前轮廓。')
    if (!marksFit(outline, landforms, routes, [...coverZones, ...sceneryZones])) throw new Error('请核对标记所属陆地和路线的两端。')
    for (const form of resolvedLandforms) if (form.structure) {
      const problem = structureIssue(outline, form, form.structure)
      if (problem) throw new Error(`「${form.name ?? form.id}」${problem}`)
    }
    for (const zone of manualShallows) if (guide.environment === 'coast') {
      const problem = referenceShallowIssue(zone.boundary, outline.referenceSizePx, outline.regions)
      if (problem) throw new Error(problem)
    }
    const { width, height } = outline.referenceSizePx
    const dimension = Math.round(mapLength * 1000)
    if (scalePoints.length && (scalePoints.length !== 2 || scaleMeters === null || !Number.isFinite(scaleMeters) || scaleMeters < .001)) {
      throw new Error('请标记两个标尺点并输入实际距离，或清除标尺点。')
    }
    const dimensions = scalePoints.length === 2 ? { referenceScale: { from: scalePoints[0], to: scalePoints[1], lengthMm: Math.round(scaleMeters! * 1000) } }
      : width >= height ? { widthMm: dimension } : { heightMm: dimension }
    const automatic = outline.request.recipe
    return parseMapGenerate({ ...outline.request, title, ...dimensions, recipe: {
      ...automatic, landforms: [...resolvedLandforms, ...outcrops, ...cliffs], shallows, routes, density, style: artStyle,
      covers: [...(automaticSurface ? automatic.covers.slice(0, MAP_LANDSCAPE_LIMITS.covers - coverZones.length) : []), ...coverZones],
      scenery: [...(automaticSurface ? automatic.scenery.slice(0, MAP_LANDSCAPE_LIMITS.scenery - sceneryZones.length) : []), ...sceneryZones],
    } })
  }
  const analyze = () => void run('正在检查几何和通路…', async signal => {
    const input = request(), key = JSON.stringify([input, budgetId])
    const { prepareMapDiagnosis } = await import('../../platform/browser/content/map-authoring')
    const value = checkedDraft.current?.key === key ? checkedDraft.current.value : await prepareMapDiagnosis(input, taskBudgetProfile(budgetId), signal)
    signal.throwIfAborted()
    checkedDraft.current = { key, value }; setDiagnosis(value.diagnosis)
  })
  const present = async (result: Candidate, style: MapLandscapeRecipe['style'], signal: AbortSignal) => {
    const { mapDiagnosis } = await import('../../platform/browser/content/map-authoring')
    const checked = mapDiagnosis(result.project.document, result, result.usage)
    const { exportPng } = await import('../../platform/browser/render/renderer')
    const image = await exportPng(toBundle(result.project), { audience: 'gm', floorId: result.floorId, longEdgePx: 960, signal })
    signal.throwIfAborted(); setDiagnosis(checked); setCandidate(result); setTop(image); setOblique(null); setView('top')
    if (checked.ok) setUsable({ result, top: image, diagnosis: checked, style })
  }
  const preview = () => void run('正在生成可编辑地图预览…', async signal => {
    const input = request(), key = JSON.stringify([input, budgetId])
    const prior = checkedDraft.current
    if (prior?.key === key) {
      await present(await prior.value.createCandidate(signal), artStyle, signal)
      return
    }
    const { generateMapCandidate } = await import('../../platform/browser/content/map-authoring')
    await present(await generateMapCandidate(input, taskBudgetProfile(budgetId), false, signal), artStyle, signal)
  })
  const selectArtStyle = (style: typeof artStyle) => {
    if (!candidate) { setArtStyle(style); resetPreview(); return }
    if (candidate.artStyle === style) return
    void run('正在渲染同一工程的画风预览…', async signal => {
      const { restyleMapCandidate } = await import('../../platform/browser/content/map-authoring')
      const project = await restyleMapCandidate(candidate.project, candidate.floorId, style, taskBudgetProfile(budgetId), signal)
      await present({ ...candidate, project, artStyle: style }, style, signal)
      setArtStyle(style)
    })
  }
  const showOblique = () => {
    if (!candidate) return
    if (oblique) { setView('oblique'); return }
    void run('正在渲染同一工程的斜俯视…', async signal => {
      const { exportObliquePng } = await import('../../platform/browser/render/oblique-renderer')
      const image = await exportObliquePng(toBundle(candidate.project), { audience: 'gm', floorId: candidate.floorId, longEdgePx: 960, signal })
      signal.throwIfAborted(); setOblique(image); setView('oblique')
    })
  }
  const markers = useMemo(() => [
    ...guide.background.map(point => ({ point, color: '#73DAFF' })),
    ...guide.foreground.map(point => ({ point, color: '#7AFFB4' })),
    ...guide.keep.map(point => ({ point, color: '#FFF170' })),
    ...guide.shallow.map(point => ({ point, color: '#97DED2' })),
    ...guide.omit.map(point => ({ point, color: '#FF9B7B' })),
    ...scalePoints.map(point => ({ point, color: '#FFADDE' })),
    ...resolvedLandforms.map(row => ({ point: row.at, radius: row.structure ? undefined : row.radius, rotationDeg: row.rotationDeg, color: '#FFCB81' })),
    ...routes.map(row => ({ point: row.ascent.from.at, radius: row.ascent.from.radius, color: '#FFF196' })),
    ...[...coverZones, ...sceneryZones].flatMap(row => 'at' in row.region ? [{ point: row.region.at, radius: row.region.radius, color: '#C4F1A5' }] : []),
  ], [guide, resolvedLandforms, routes, coverZones, sceneryZones, scalePoints])
  const canEdit = !!outline && !outlineStale
  const target = landforms.find(row => row.id === goal)
  const originalPoint = mode === 'relief' ? landforms.find(row => row.id === editingId)?.at : routes.find(row => row.id === editingId)?.ascent.from.at
  const percent = (pixels: number) => source ? Math.min(45, Math.max(1, pixels / Math.max(source.width, source.height) * 100)) : 1
  const adjustForm = (row: Form) => {
    setSketch(null)
    setMode('relief'); setEditingId(row.id); setError(''); setShape(row.shape); setElevation(row.elevationMm / 1000)
    setRadius(percent(row.radius.x)); setVerticalRadius(row.radius.x === row.radius.y ? null : percent(row.radius.y))
    setRotation(row.rotationDeg); setCover(row.cover ?? 'grass'); setPreserveRelief(row.preserveRelief === true)
  }
  const adjustRoute = (row: MapAscentRoute) => {
    setSketch(null)
    setMode('ascent'); setEditingId(row.id); setError(''); setGoal(row.ascent.toLandmarkId); setSide(row.around?.side ?? '')
    setRadius(percent(row.ascent.from.radius.x)); setWidth(row.widthMm / 1000); setRise(row.ascent.minRiseMm / 1000)
    setMinimumWidth(row.ascent.minWidthMm === undefined ? null : row.ascent.minWidthMm / 1000)
    setRouteStyle(row.style); setStaircase(row.ascent.staircase)
  }
  const candidatePassing = !!candidate && [...candidate.routeChecks, ...candidate.heightChecks, ...candidate.ascentChecks]
    .every(row => row.ok || 'required' in row && !row.required)

  return <div className="reference-map-tool">
    <fieldset disabled={disabled || !!status}>
      <label>参考图片 <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
        const file = event.target.files?.[0]
        if (file) load(file)
        event.target.value = ''
      }}/></label>
      {!source && <p>选取背景颜色，预览拟合轮廓，然后在图上标记地貌和通路。</p>}
      {source && <>
        <div className="reference-map-fields">
          <label>地图名称 <input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); resetPreview() }}/></label>
          <label>环境 <select value={guide.environment} onChange={event => changeGuide({ environment: event.target.value as typeof guide.environment })}>
            <option value="coast">水岸</option><option value="upland">陆地</option>
          </select></label>
          <label>轮廓细节 <select value={guide.detail} onChange={event => changeGuide({ detail: event.target.value as typeof guide.detail })}>
            <option value="balanced">适中</option><option value="coarse">简化</option><option value="fine">细致</option>
          </select></label>
          <label>背景颜色容差 <input type="range" min="8" max="90" value={guide.tolerance} onChange={event => changeGuide({ tolerance: event.target.valueAsNumber })}/></label>
          {guide.environment === 'coast' && <label><input type="checkbox" checked={guide.shorelineFromReference}
            onChange={event => changeGuide({ shorelineFromReference: event.target.checked })}/> 自动识别浅水与礁石</label>}
        </div>
        <div className="reference-map-actions" role="group" aria-label="参考图标记工具" ref={markerFields}>
          {(Object.keys(tools) as Mode[]).filter(item => item !== 'shallow' || guide.environment === 'coast').map(item => <button key={item} type="button" className="secondary"
            aria-pressed={!sketch && mode === item} disabled={!canEdit && ['relief', 'ascent', 'cover', 'scenery'].includes(item)}
            onClick={() => { setSketch(null); setMode(item); setEditingId(''); setError('') }}>{tools[item]}</button>)}
        </div>
        <p className="reference-map-instruction">{sketch ? '在原图上依次点取形状的顶点，再保存形状。'
          : mode === 'background' ? '在水面或空白背景点取颜色，渐变较大时可多取几处。'
          : mode === 'foreground' ? '选取有代表性的陆地颜色。接近水色的陆地样点只影响附近。'
            : mode === 'keep' ? '在需要保留的地块上点取，随后重新提取轮廓。'
            : mode === 'shallow' ? '在已接到外海的浅水中取色，随后重新提取轮廓。'
            : mode === 'omit' ? '点击要忽略的小块，再提取轮廓。' : correction ? '在原图上涂过要修正的边，再提取轮廓。'
              : mode === 'scale' ? '在图上标出已知距离的两个点，再填实际距离。'
                : editingId ? '可应用到原位置，也可在图上点击新位置。' : `设置范围后，在图上${tools[mode]}。`}</p>
        {correction && <div className="reference-map-fields">
          <label>画笔半径（像素） <input type="range" min="1" max="128" value={brushSize} onChange={event => setBrushSize(event.target.valueAsNumber)}/></label>
          <button type="button" className="secondary" disabled={!guide.corrections.length}
            onClick={() => changeGuide({ corrections: guide.corrections.slice(0, -1) })}>撤回最后一笔</button>
        </div>}
        {mode === 'scale' && <div className="reference-map-fields">
          <label>标尺实距（米） <input type="number" min=".001" step=".001" value={scaleMeters ?? ''}
            onChange={event => { setScaleMeters(event.target.value ? event.target.valueAsNumber : null); resetPreview() }}/></label>
          <button type="button" className="secondary" disabled={!scalePoints.length && scaleMeters === null}
            onClick={() => { setScalePoints([]); setScaleMeters(null); resetPreview() }}>清除比例标记</button>
        </div>}
        {(mode === 'relief' || mode === 'ascent' || mode === 'cover' || mode === 'scenery') && <div className="reference-map-fields">
          <label>范围半径（原图长边 %） <input type="number" min="1" max="45" value={radius} onChange={event => setRadius(Number(event.target.value))}/></label>
          {mode === 'relief' && <>
            <label>地貌类型 <select value={shape} onChange={event => setShape(event.target.value as Form['shape'])}>
              {Object.entries(forms).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>高程（米） <input type="number" min="-30" max="30" step=".1" value={elevation} onChange={event => setElevation(Number(event.target.value))}/></label>
            <label>纵向半径（原图长边 %） <input type="number" min="1" max="45" step="any" value={verticalRadius ?? ''}
              placeholder={String(radius)} onChange={event => setVerticalRadius(event.target.value ? event.target.valueAsNumber : null)}/></label>
            <label>旋转角度（度） <input type="number" min="0" max="359.9" step=".1" value={rotation} onChange={event => setRotation(Number(event.target.value))}/></label>
            {shape !== 'lowland' && <label>低地中保留凸起 <input type="checkbox" checked={preserveRelief} onChange={event => setPreserveRelief(event.target.checked)}/></label>}
          </>}
          {(mode === 'relief' || mode === 'cover') && <label>地表 <select value={cover} onChange={event => setCover(event.target.value as Cover['cover'])}>
            {Object.entries(covers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
          {mode === 'scenery' && <>
            <label>布景 <select value={palette} onChange={event => setPalette(event.target.value as Scenery['palette'])}>
              {Object.entries(palettes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>区域布景密度 <input type="range" min="0" max="1" step=".01" value={sceneryDensity} onChange={event => setSceneryDensity(event.target.valueAsNumber)}/></label>
          </>}
          {mode === 'ascent' && <>
            <label>到达地貌 <select value={goal} onChange={event => setGoal(event.target.value)}>
              <option value="">选择地貌</option>{landforms.filter(row => row.shape !== 'lowland').map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select></label>
            <label>绕行方向 <select value={side} onChange={event => setSide(event.target.value as typeof side)}>
              <option value="">自动选择方向</option>{Object.entries(direction).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>登高方式 <select value={routeStyle} onChange={event => setRouteStyle(event.target.value as typeof routeStyle)}>
              <option value="stairs">台阶路</option><option value="trail">步道</option>
            </select></label>
            {routeStyle === 'stairs' && <label>台阶分布 <select value={staircase} onChange={event => setStaircase(event.target.value as typeof staircase)}>
              <option value="terrain">沿坡分布</option><option value="flight">集中成梯段</option>
            </select></label>}
            <label>首选净宽（米） <input type="number" min=".1" max="6" step=".1" value={width} onChange={event => setWidth(Number(event.target.value))}/></label>
            <label>可接受净宽下限（米） <input type="number" min=".1" max={width} step=".1" value={minimumWidth ?? ''}
              placeholder={String(width)} onChange={event => setMinimumWidth(event.target.value ? event.target.valueAsNumber : null)}/></label>
            <label>最小高差（米） <input type="number" min=".1" max="60" step=".1" value={rise} onChange={event => setRise(Number(event.target.value))}/></label>
          </>}
        </div>}
        {originalPoint && !sketch && <div className="reference-map-actions">
          <button type="button" className="secondary" disabled={!canEdit} onClick={() => point(originalPoint)}>应用到原位置</button>
          <button type="button" className="secondary" onClick={() => setEditingId('')}>结束标记调整</button>
        </div>}
        <ReferenceCanvas source={source} outline={outline} marks={markers} landforms={[...resolvedLandforms, ...outcrops, ...cliffs]} shallows={shallows} sketch={sketch} scalePoints={scalePoints} diagnosis={diagnosis}
          correction={status || disabled ? null : correction} corrections={guide.corrections} onStroke={addCorrection} onPoint={point}/>
        {sketch && <div className="reference-map-actions">
          <button type="button" className="secondary"
            disabled={sketch.points.length < (sketch.kind === 'area' || sketch.kind === 'shallow' ? 3 : 2)} onClick={saveSketch}>保存形状</button>
          <button type="button" className="secondary" disabled={!sketch.points.length}
            onClick={() => { setSketch({ ...sketch, points: sketch.points.slice(0, -1) }); setError('') }}>撤回顶点</button>
          <button type="button" className="secondary" onClick={() => { setSketch(null); setError('') }}>取消绘制</button>
        </div>}
        <details><summary>用像素坐标取点</summary>
          <div className="reference-map-fields">
            <label>X 像素 <input type="number" min="0" max={source.width - 1} value={keyboard.x} onChange={event => setKeyboard({ ...keyboard, x: Number(event.target.value) })}/></label>
            <label>Y 像素 <input type="number" min="0" max={source.height - 1} value={keyboard.y} onChange={event => setKeyboard({ ...keyboard, y: Number(event.target.value) })}/></label>
          </div>
          <button type="button" className="secondary" disabled={!Number.isInteger(keyboard.x) || !Number.isInteger(keyboard.y)
            || keyboard.x < 0 || keyboard.y < 0 || keyboard.x >= source.width || keyboard.y >= source.height} onClick={() => point(keyboard)}>添加取点</button>
        </details>
        <div className="reference-map-actions">
          <button type="button" className="secondary" disabled={!guide.background.length} onClick={() => trace()}>提取轮廓</button>
          {!sketch && isSampleMode(mode) && <button type="button" className="secondary"
            disabled={!guide[mode].length} onClick={() => changeGuide({ [mode]: guide[mode].slice(0, -1) })}>撤回最后一个取样</button>}
          {outline && <span>{outlineStale ? '有修正待应用' : `${outline.regions.length} 块陆地${outline.lakes.length ? `，${outline.lakes.length} 处内水` : ''}`}</span>}
        </div>
        {outline?.notes.map(note => <p key={note} className="reference-map-instruction">{note}</p>)}
        {canEdit && outline.issues.length > 0 && <section aria-label="轮廓检查" className="reference-map-diagnosis">
          <strong>核对叠图中的编号位置</strong>
          <ol>{outline.issues.map(({ at, message, correction: proposed }, index) => <li key={`${index}/${at.x}/${at.y}`}>
            {message} {proposed && <button type="button" className="secondary" onClick={() => addCorrection(proposed, true)}>断开并重看轮廓</button>}
          </li>)}</ol>
        </section>}
        {canEdit && <>
          {guide.environment === 'coast' && <section aria-label="浅水与礁石" className="reference-map-diagnosis">
            <div className="reference-map-actions">
              <span>{shallows.length} 处浅水，{outline.coastFeatures.reefs.length} 块礁石{outcrops.length > 0 && `，${outcrops.length} 处露岩`}
                {cliffs.length > 0 && `，${cliffs.length} 处岸崖`}</span>
              <button type="button" className="secondary" disabled={!!sketch} onClick={() => setSketch({ kind: 'shallow', points: [] })}>圈定浅水</button>
              {hiddenShallows.length > 0 && <button type="button" className="secondary" onClick={() => {
                setHiddenShallows([]); resetPreview()
              }}>恢复识别的浅水</button>}
            </div>
            {shallows.map((region, i) => <div className="reference-map-actions" key={region.id}>
              <span>浅水 {i + 1}</span>
              <button type="button" className="secondary" disabled={!!sketch}
                onClick={() => setSketch({ kind: 'shallow', id: region.id, points: [] })}>调整浅水范围</button>
              <button type="button" className="secondary" disabled={!!sketch} onClick={() => {
                if (!manualShallows.some(row => row.id === region.id)) setHiddenShallows(previous => [...previous, region])
                setManualShallows(previous => previous.filter(row => row.id !== region.id)); resetPreview()
              }}>移除浅水</button>
            </div>)}
          </section>}
          <ul className="reference-map-markers">
            {resolvedLandforms.map(row => <li key={row.id}>{row.name} · {row.elevationMm / 1000} 米
              <button type="button" className="secondary" aria-pressed={editingId === row.id} onClick={() => adjustForm(row)}>调整地貌</button>
              <button type="button" className="secondary" disabled={!!sketch} onClick={() => setSketch({
                kind: row.shape === 'ridge' ? 'ridge' : 'area', id: row.id, points: [],
              })}>{row.shape === 'ridge' ? '画山脊线' : '圈地貌范围'}</button>
              {row.structure && <button type="button" className="secondary" disabled={!!sketch}
                onClick={() => setSketch({ kind: 'breakline', id: row.id, points: [] })}>画坡折线</button>}
              {landforms.some(form => form.id === row.id && form.structure) && <button type="button" className="secondary" disabled={!!sketch}
                onClick={() => {
                  setLandforms(previous => previous.map(form => {
                    if (form.id !== row.id) return form
                    const { structure: _structure, ...mark } = form
                    return mark
                  })); resetPreview()
                }}>恢复自动地貌范围</button>}
              <button type="button" className="secondary" onClick={() => {
                const dependent = routes.filter(item => item.ascent.toLandmarkId === row.id)
                setLandforms(landforms.filter(item => item.id !== row.id)); setRoutes(routes.filter(item => !dependent.includes(item)))
                if (target?.id === row.id) setGoal('')
                if (editingId === row.id || dependent.some(item => item.id === editingId)) setEditingId('')
                if (sketch?.id === row.id) setSketch(null)
                resetPreview()
              }}>{routes.some(item => item.ascent.toLandmarkId === row.id) ? '移除地貌及关联路线' : '移除'}</button></li>)}
            {routes.map(row => <li key={row.id}>低处通往 {landforms.find(item => item.id === row.ascent.toLandmarkId)?.name}
              <button type="button" className="secondary" aria-pressed={editingId === row.id} onClick={() => adjustRoute(row)}>调整路线</button>
              <button type="button" className="secondary" onClick={() => {
                setRoutes(routes.filter(item => item.id !== row.id)); if (editingId === row.id) setEditingId(''); resetPreview()
              }}>移除</button></li>)}
            {[...coverZones, ...sceneryZones].map(row => <li key={row.id}>{'cover' in row ? covers[row.cover] : palettes[row.palette]}
              <button type="button" className="secondary" onClick={() => {
                setCoverZones(coverZones.filter(item => item.id !== row.id)); setSceneryZones(sceneryZones.filter(item => item.id !== row.id)); resetPreview()
              }}>移除</button></li>)}
          </ul>
          <div className="reference-map-fields">
            {scalePoints.length ? <button type="button" className="secondary" onClick={() => { setMode('scale'); setEditingId('') }}>调整标尺</button>
              : <label>地图长边（米） <input type="number" min="1" max="120" step=".1" value={mapLength}
                onChange={event => { setMapLength(Number(event.target.value)); resetPreview() }}/></label>}
            <label>自动布景密度 <input type="range" min="0" max="1" step=".01" value={density}
              onChange={event => { setDensity(event.target.valueAsNumber); resetPreview() }}/></label>
            <label>任务预算 <select value={budgetId} onChange={event => { setBudgetId(event.target.value as TaskBudgetProfileId); resetPreview() }}>
              <option value="small">小型</option><option value="standard">标准</option><option value="expanded">扩展</option>
            </select></label>
            <label><input type="checkbox" checked={automaticSurface} onChange={event => { setAutomaticSurface(event.target.checked); resetPreview() }}/>
              按参考图铺草地、林丛和干滩</label>
            <label><input type="checkbox" checked={automaticStructure} onChange={event => { setAutomaticStructure(event.target.checked); resetPreview() }}/>
              自动拟合地貌和岸崖</label>
            <label>画风 <select value={artStyle} onChange={event => selectArtStyle(event.target.value as typeof artStyle)}>
              <option value="original">原画</option><option value="handDrawn">手绘</option><option value="tea">茶绘</option><option value="lineArt">线稿</option>
            </select></label>
          </div>
          <div className="reference-map-actions">
            <button type="button" className="primary" disabled={!!sketch} onClick={preview}>生成地图预览</button>
            <button type="button" className="secondary" disabled={!!sketch} onClick={analyze}>只检查几何</button>
          </div>
        </>}
      </>}
    </fieldset>
    {diagnosis && <section aria-label="几何诊断" className="reference-map-diagnosis">
      <strong>{diagnosis.ok ? '所需几何与通路通过' : '需要调整几何或通路'}</strong>
      {!candidate && checkedDraft.current && <p>生成地图预览会使用这次检查的地形和路线。</p>}
      {diagnosis.ascentChecks.filter(row => row.ok).map(row => <div key={row.id}>
        <p>低处 {row.lowElevationMm! / 1000} 米到地标 {row.highElevationMm! / 1000} 米，实际净宽 {row.actualWidthMm! / 1000} 米</p>
        {row.reduction && <p>{row.reduction.message} {row.reduction.rejected?.[0]?.issues[0]?.message}</p>}
      </div>)}
      {diagnosis.diagnosticMarkers.length > 0 && <ol>{diagnosis.diagnosticMarkers.map(({ id, message, atMm }) => <li key={`${id}/${atMm.x}/${atMm.y}`}>{message}</li>)}</ol>}
      {diagnosis.routeChecks.filter(row => !row.ok).flatMap(check => {
        const route = routes.find(row => row.id === check.id)
        return route ? [<button type="button" className="secondary" key={route.id} disabled={disabled || !!status || !canEdit}
          onClick={() => { adjustRoute(route); markerFields.current?.scrollIntoView({ block: 'start' }) }}>调整失败路线</button>] : []
      })}
      {diagnosis.routeChecks.filter(row => !row.ok).flatMap(row => row.issues.filter(issue => !issue.atMm)
        .map((issue, index) => <p key={`${row.id}/${index}`}>{issue.message}</p>))}
    </section>}
    {status && <div className="reference-map-actions"><p role="status">{status}</p>
      <button type="button" className="secondary" onClick={cancel}>取消当前操作</button>
    </div>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
    {!!usable && candidate !== usable.result && <div className="reference-map-actions">
      <button type="button" className="secondary" disabled={disabled || !!status} onClick={() => {
        setCandidate(usable.result); setTop(usable.top); setDiagnosis(usable.diagnosis); setArtStyle(usable.style); setOblique(null); setView('top'); setError('')
      }}>查看上次通过检查的草稿</button>
    </div>}
    {candidate && topUrl && <section aria-label="可编辑地图预览" className="reference-map-preview">
      <div className="reference-map-actions">
        <button type="button" className="secondary" aria-pressed={view === 'top'} onClick={() => setView('top')}>正俯视</button>
        <button type="button" className="secondary" disabled={!!status} aria-pressed={view === 'oblique'} onClick={showOblique}>斜俯视</button>
        <button type="button" className="primary" disabled={disabled || !!status || !candidatePassing} onClick={() => onAdopt(candidate.project)}>打开为新工程</button>
      </div>
      {!candidatePassing && <p className="reference-map-instruction">根据几何诊断调整后再打开为新工程。</p>}
      <img src={view === 'oblique' ? obliqueUrl || topUrl : topUrl} alt={view === 'oblique' ? '生成地图的斜俯视预览' : '生成地图的正俯视预览'}/>
    </section>}
  </div>
}
