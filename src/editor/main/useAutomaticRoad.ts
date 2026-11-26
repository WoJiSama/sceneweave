import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { AutomaticRoadPlan } from '../../shared/geometry/automatic-road'
import { distanceToSegment } from '../../shared/geometry/geometry'
import { createSupportQuery } from '../../shared/geometry/support-sample'
import { publicTerrainView } from '../../shared/geometry/visibility'
import { roadPointEquals } from '../../shared/geometry/road-domain'
import { AUTOMATIC_ROAD_MAX_FIXED_POINTS, AUTOMATIC_ROAD_VERSION, createRoadSurfaceSampler, roadLandingSchema, type RoadLanding } from '../../shared/geometry/road-surface'
import type { Path, PointMm, SceneDocument, VersionRef } from '../../shared/model/scene'
import { planStaircase } from '../../shared/stairs/geometry'
import type { AutomaticRoadCanvas } from '../native-canvas/AutomaticRoadOverlay'
import type { CanvasWorldTool } from '../native-canvas/building-session'
import type { OutdoorSketch } from './OutdoorToolsPanel'

export type AutomaticRoadSettings = Pick<Path, 'floorId' | 'visibility' | 'widthMm'> & { materialRef?: VersionRef }
export type AutomaticRoadSession = AutomaticRoadSettings & { document: SceneDocument; layerId: string; id: string; existing?: Path }

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
type DraftResult = { plan: AutomaticRoadPlan | null; error: string | null }
const empty: DraftResult = { plan: null, error: null }
const noLandings: readonly RoadLanding[] = []
const loadAutomaticRoadPlanner = () => import('./automatic-road-planner')
type RoadPlanner = Awaited<ReturnType<typeof loadAutomaticRoadPlanner>>

/** Insert a newly authored anchor into the leg that the handle came from. */
function placePoint(fixed: PointMm[], plan: AutomaticRoadPlan, index: number, point: PointMm): { points: PointMm[]; selected: number } {
  const handle = plan.centerlineMm[index]
  const anchor = fixed.findIndex(p => roadPointEquals(p, handle))
  if (anchor >= 0) return { points: fixed.map((p, i) => i === anchor ? point : p), selected: anchor }
  const insertion = fixed.findIndex(p => plan.centerlineMm.findIndex(q => roadPointEquals(q, p)) > index)
  if (insertion < 1 || fixed.length >= AUTOMATIC_ROAD_MAX_FIXED_POINTS) throw new Error('这条道路的途经点已满。可以选中一个途经点恢复自动。')
  return { points: [...fixed.slice(0, insertion), point, ...fixed.slice(insertion)], selected: insertion }
}

function nearestLeg(plan: AutomaticRoadPlan, point: PointMm) {
  let index = 0, best = Infinity
  for (let i = 1; i < plan.centerlineMm.length; i++) {
    const distance = distanceToSegment(point, plan.centerlineMm[i - 1], plan.centerlineMm[i])
    if (distance < best) { index = i - 1; best = distance }
  }
  return index
}

export function useAutomaticRoad(sketch: OutdoorSketch | null, setSketch: Dispatch<SetStateAction<OutdoorSketch | null>>, scene: SceneDocument | undefined,
  preview: (commands: SceneCommand[], description: string, id: string) => void) {
  const session = sketch?.automaticRoad
  const active = !!session
  const [tools, setTools] = useState<RoadPlanner>()
  const [loadError, setLoadError] = useState<string>()
  useEffect(() => {
    if (!active || tools) return
    let current = true
    setLoadError(undefined)
    void loadAutomaticRoadPlanner().then(module => { if (current) setTools(module) },
      () => { if (current) setLoadError('自动选路工具加载失败。请检查网络后刷新页面。') })
    return () => { current = false }
  }, [active, tools])
  const planner = useMemo(() => session && tools?.createAutomaticRoadPlanner(session.document,
    { ...session, widthSections: session.existing?.widthSections }, session.existing?.id), [session, tools])
  const existing = session?.existing, intent = existing?.automaticRoute
  const saved = useMemo(() => existing && intent ? { centerlineMm: existing.centerlineMm, fixedPointsMm: intent.fixedPointsMm,
    roadSurface: existing.roadSurface, landings: intent.algorithm === AUTOMATIC_ROAD_VERSION ? intent.landings : undefined } : undefined, [existing, intent])
  const legacyStaircase = intent?.automaticStairs === false && intent.algorithm !== AUTOMATIC_ROAD_VERSION ? existing?.staircase ?? null : undefined
  const fixed = sketch?.points ?? []
  const committed = useMemo<DraftResult>(() => {
    if (!planner || fixed.length < 2) return empty
    if (sketch?.automaticPlan) return { plan: sketch.automaticPlan, error: null }
    try { return { plan: planner(fixed, saved, { legacyStaircase, landings: saved?.landings }), error: null } }
    catch (error) { return { plan: null, error: errorMessage(error) } }
  }, [planner, fixed, saved, legacyStaircase, sketch?.automaticPlan])
  type Live = DraftResult & { session: AutomaticRoadSession; sketch: OutdoorSketch; point: PointMm; index?: number }
  const [live, setLive] = useState<Live | null>(null)
  const [notice, setNotice] = useState<{ sketch: OutdoorSketch; text: string } | null>(null)
  const [selected, setSelected] = useState<{ session: AutomaticRoadSession; index: number } | null>(null)
  const pending = useRef<Live | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearLive = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    setLive(null)
  }
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; pending.current = null }, [session])
  if (!sketch || !session) return null
  if (!tools || !planner) return { pending: true as const, loadError, cancel: () => setSketch(null) }
  const ready = scene === session.document
  const activeLive = live?.session === session && live.sketch === sketch ? live : null
  const selection = selected?.session === session ? selected.index : -1
  const base = committed.plan ?? saved
  const landings = base?.landings ?? noLandings
  const canEditLanding = legacyStaircase === undefined && !!committed.plan && selection > 0 && selection < fixed.length - 1
  const landing = canEditLanding ? landings.find(row => roadPointEquals(row.pointMm, fixed[selection])) : undefined
  const movedLanding = (index: number, point: PointMm) => landings.map(row =>
    fixed[index] && roadPointEquals(row.pointMm, fixed[index]) ? { ...row, pointMm: point } : row)
  const resolve = (points: PointMm[], pin = landings) => planner(points, base, { legacyStaircase, landings: pin })
  const change = (points: PointMm[], index: number, pin = landings) => {
    clearLive()
    try {
      const automaticPlan = points.length >= 2 ? resolve(points, pin) : undefined
      setSketch(current => current === sketch ? { ...current, points, automaticPlan } : current)
      setNotice(null)
      setSelected({ session, index })
    } catch (error) { setNotice({ sketch, text: errorMessage(error) }) }
  }
  const movingPoints = (index: number, point: PointMm) => {
    if (!base || !committed.plan) {
      const selected = base ? fixed.findIndex(p => roadPointEquals(p, base.centerlineMm[index])) : index
      if (selected < 0) throw new Error('请先调整起终点或已固定的途经点。')
      return { points: fixed.map((p, i) => i === selected ? point : p), selected, pin: movedLanding(selected, point) }
    }
    const next = placePoint(fixed, committed.plan, index, point), anchor = fixed.findIndex(p => roadPointEquals(p, base.centerlineMm[index]))
    return { ...next, pin: movedLanding(anchor, point) }
  }
  const move = (point: PointMm, index?: number) => {
    if (!ready || index === undefined && fixed.length !== 1) return
    if (pending.current?.sketch === sketch && pending.current.index === index && roadPointEquals(pending.current.point, point)) return
    pending.current = { ...empty, session, sketch, point, index }
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      const next = pending.current
      if (!next || next.sketch !== sketch) return
      try {
        const draft = next.index === undefined ? { points: [fixed[0], next.point], pin: landings } : movingPoints(next.index, next.point)
        setLive({ ...next, plan: draft.points.length >= 2 ? resolve(draft.points, draft.pin) : null })
      } catch (error) { setLive({ ...next, error: errorMessage(error) }) }
    }, 55)
  }
  const finish = () => {
    if (!ready || !committed.plan || pending.current?.index !== undefined) return
    const { centerlineMm, supportRefs, roadSurface } = committed.plan
    const automaticRoute: NonNullable<Path['automaticRoute']> = roadSurface
      ? { algorithm: AUTOMATIC_ROAD_VERSION, fixedPointsMm: fixed, automaticStairs: true,
        ...(intent?.algorithm === AUTOMATIC_ROAD_VERSION && intent.alignment ? { alignment: intent.alignment } : {}),
        ...(landings.length ? { landings: [...landings] } : {}) }
      : { algorithm: intent?.algorithm === 'terrain-road1' ? 'terrain-road1' : 'terrain-road2', fixedPointsMm: fixed, automaticStairs: false }
    const command: SceneCommand = existing
      ? { type: 'updatePath', id: session.id, changes: { centerlineMm, supportRefs, automaticRoute, ...(roadSurface ? { roadSurface } : {}),
        ...(roadSurface && !existing.roadSurface && intent?.automaticStairs ? { staircase: null } : {}) } }
      : { type: 'createPath', id: session.id, floorId: session.floorId, layerId: session.layerId, visibility: session.visibility, widthMm: session.widthMm,
        centerlineMm, supportRefs, automaticRoute, ...(session.materialRef ? { materialRef: session.materialRef } : {}), ...(roadSurface ? { roadSurface } : {}) }
    preview([command], existing ? '调整自动道路' : '铺设自动道路', session.id)
  }
  const cancel = () => { clearLive(); setSketch(null) }
  const restore = () => { if (selection > 0 && selection < fixed.length - 1) change(fixed.filter((_, i) => i !== selection), -1,
    landings.filter(row => !roadPointEquals(row.pointMm, fixed[selection]))) }
  const updateLanding = (patch?: Partial<Pick<RoadLanding, 'lengthMm' | 'elevationMm'>>) => {
    if (!canEditLanding) return
    const point = fixed[selection], geometry = committed.plan?.geometry
    const source = () => createSupportQuery(session.visibility === 'public' ? publicTerrainView(session.document) : session.document, session.floorId, undefined, false)
    try {
      const initial = landing ?? tools.makeRoadLanding(point, p => (geometry && createRoadSurfaceSampler(geometry).sample(p)?.zMm) ?? source().sourceSample(p)?.zMm ?? null)
      const next = roadLandingSchema.parse({ ...initial, ...patch })
      change(fixed, selection, [...landings.filter(row => row !== landing), next])
    } catch (error) { setNotice({ sketch, text: errorMessage(error) }) }
  }
  const restoreLanding = () => { if (landing) change(fixed, selection, landings.filter(row => row !== landing)) }
  const displayed = activeLive?.plan ?? committed.plan
  const centerline = base?.centerlineMm ?? fixed
  const overlay: AutomaticRoadCanvas = {
    points: displayed?.centerlineMm ?? centerline,
    band: displayed?.band ?? [],
    treads: displayed?.geometry?.risers.map(({ lower }) => [lower[1], lower[2]])
      ?? (displayed && legacyStaircase ? planStaircase(displayed.centerlineMm, session.widthMm, legacyStaircase, existing?.widthSections).treads.map(tread => tread.frontMm) : []),
    landings: displayed?.geometry?.spans.flatMap(({ kind, start, end }) => kind === 'landing' ? [[start[1], end[1], end[2], start[2]]] : []) ?? [],
    invalidPoint: activeLive?.error ? activeLive.point : undefined,
    handles: centerline.map<AutomaticRoadCanvas['handles'][number]>((point, index) => {
      const anchor = fixed.findIndex(p => roadPointEquals(p, point))
      const kind = anchor === 0 ? 'start' : anchor === fixed.length - 1 ? 'end' : anchor >= 0 ? 'fixed' : 'bend'
      return { index, point, kind, selected: anchor >= 0 && anchor === selection }
    }).filter(handle => committed.plan || handle.kind !== 'bend'),
    onSelect: index => setSelected({ session, index: fixed.findIndex(p => roadPointEquals(p, centerline[index])) }),
    onMove: (index, point) => move(point, index),
    onDrop: (index, point) => { try { const next = movingPoints(index, point); change(next.points, next.selected, next.pin) } catch (error) { clearLive(); setNotice({ sketch, text: errorMessage(error) }) } },
    onCancelDrag: clearLive,
  }
  const problem = !ready ? '工程已变化，请退出后重新开始自动选路。' : activeLive?.error ?? (notice?.sketch === sketch ? notice.text : null) ?? committed.error
  const label = fixed.length === 0 ? '点选道路起点' : fixed.length === 1 ? '移动鼠标查看路线，点选道路终点' : '拖动端点或转弯。点画布可加途经点'
  const canvas: CanvasWorldTool | null = ready ? {
    kind: 'polyline', points: centerline, cursor: null, snapMm: scene.units.snapMm, label,
    automaticRoad: overlay, onMove: move, onClearCursor: () => { if (fixed.length === 1) clearLive() }, onCancel: cancel, onFinish: finish,
    onPoint: point => {
      if (fixed.length < 2) { change([...fixed, point], fixed.length); return }
      if (!committed.plan) return
      const nearest = nearestLeg(committed.plan, point)
      const after = committed.plan.centerlineMm[nearest + 1]
      const index = fixed.findIndex(p => committed.plan!.centerlineMm.findIndex(q => roadPointEquals(q, p)) >= nearest + 1)
      if (fixed.length >= AUTOMATIC_ROAD_MAX_FIXED_POINTS || index < 1 || roadPointEquals(point, after)) return
      change([...fixed.slice(0, index), point, ...fixed.slice(index)], index)
    },
  } : null
  return { pending: false as const, canvas, finish, cancel, restore, problem, label, ready: ready && !!committed.plan, canRestore: selection > 0 && selection < fixed.length - 1,
    canEditLanding, landing, updateLanding, restoreLanding, lengthMm: displayed?.lengthMm, steps: overlay.treads.length }
}
