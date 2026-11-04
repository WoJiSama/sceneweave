import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointMm } from '../../shared/model/scene'
import type { CubicSegment, VisualBoundary } from '../../shared/visual/types'
import { connectionRouteSchema, sampleConnectionRoute, type ConnectionRoute } from '../../shared/geometry/connection-route'
import type { VisualBoundaryEditor } from './VisualPanel'

export interface ConnectionRouteDraft {
  mode: 'classic' | 'polyline' | 'cubic'
  controls: string
  style: ConnectionRoute['stairStyle']
  spacing: string
  tolerance: string
  tread: string
  handles: boolean
}
export const routeControlText = (segments: readonly CubicSegment[]) => segments.map(segment =>
  [segment.start, segment.control1, segment.control2, segment.end].map(point => `${point.x}, ${point.y}`).join(' ; ')).join('\n')
export const newConnectionRouteDraft = (route?: ConnectionRoute): ConnectionRouteDraft => ({
  mode: route?.kind ?? 'classic', controls: route ? routeControlText(route.segments) : '', style: route?.stairStyle ?? 'stone',
  spacing: String(route?.sampleSpacingMm ?? 500), tolerance: String(route?.toleranceMm ?? 20), tread: String(route?.treadDepthMm ?? 280), handles: false,
})
export function connectionPoints(text: string): PointMm[] {
  const rows = text.trim().split(/\r?\n/).filter(row => row.trim())
  if (rows.length < 2 || rows.length > 17) throw new Error('连接路线须有2–17个整数毫米节点。')
  return rows.map((row, index) => {
    const values = row.trim().split(/[,，\s]+/).map(Number)
    if (values.length !== 2 || values.some(value => !Number.isSafeInteger(value))) throw new Error(`连接路线第${index + 1}行需要x, y整数毫米。`)
    return { x: values[0], y: values[1] }
  })
}
const sourceId = (index: number, retained?: ConnectionRoute, kind?: ConnectionRoute['kind'], count?: number) =>
  retained && retained.kind === kind && retained.segments.length === count ? retained.segments[index].id : `route-segment-${crypto.randomUUID()}`
/** Explicitly chosen interpolation only prepares editable controls; the saved
 * physical route is always the strictly verified deterministic full sample. */
export function smoothConnectionControls(points: PointMm[]): Omit<CubicSegment, 'id'>[] {
  return points.slice(1).map((end, index) => {
    const start = points[index], previous = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 2)]
    return { start: { ...start }, control1: { x: Math.round(start.x + (end.x - previous.x) / 6), y: Math.round(start.y + (end.y - previous.y) / 6) },
      control2: { x: Math.round(end.x - (next.x - start.x) / 6), y: Math.round(end.y - (next.y - start.y) / 6) }, end: { ...end } }
  })
}
export function readConnectionRoute(text: string, draft: ConnectionRouteDraft, retained?: ConnectionRoute): { route?: ConnectionRoute; points: PointMm[] } {
  if (draft.mode === 'classic') {
    const points = connectionPoints(text)
    if (points.length !== 2) throw new Error('经典直连接需要恰好两个端点。')
    return { points }
  }
  let raw: Omit<CubicSegment, 'id'>[]
  if (draft.mode === 'polyline') {
    const points = connectionPoints(text)
    raw = points.slice(1).map((end, index) => {
    const start = points[index]
    return { start: { ...start }, control1: { ...start }, control2: { ...end }, end: { ...end } }
    })
  }
  else {
    const rows = draft.controls.trim().split(/\r?\n/).filter(row => row.trim())
    if (rows.length < 1 || rows.length > 16) throw new Error('曲线连接须有1–16段控制源；可以先从路线节点生成。')
    raw = rows.map((row, index) => {
      const values = row.trim().split(/[,，;；\s]+/).map(Number)
      if (values.length !== 8 || values.some(value => !Number.isSafeInteger(value))) throw new Error(`曲线第${index + 1}段需要起点、两个控制点、终点的8个整数毫米坐标。`)
      return { start: { x: values[0], y: values[1] }, control1: { x: values[2], y: values[3] }, control2: { x: values[4], y: values[5] }, end: { x: values[6], y: values[7] } }
    })
  }
  const segments = raw.map((segment, index) => ({ ...segment, id: sourceId(index, retained, draft.mode as ConnectionRoute['kind'], raw.length) }))
  const source = { version: 1 as const, kind: draft.mode, segments, sampleSpacingMm: Number(draft.spacing), toleranceMm: Number(draft.tolerance), stairStyle: draft.style, treadDepthMm: Number(draft.tread) }
  const route = connectionRouteSchema.parse({ ...source, centerlineMm: sampleConnectionRoute(source) })
  return { route, points: [route.centerlineMm[0], route.centerlineMm.at(-1)!] }
}

interface Props {
  enabled: boolean
  text: string
  draft: ConnectionRouteDraft
  retained?: ConnectionRoute
  floorId: string
  layerId: string
  visibility: 'public' | 'gm'
  onChange: (value: ConnectionRouteDraft) => void
  onBoundaryEditor?: (value: VisualBoundaryEditor | null) => void
}
export default function ConnectionRouteFields({ enabled, text, draft, retained, floorId, layerId, visibility, onChange, onBoundaryEditor }: Props) {
  const callback = useRef(onBoundaryEditor); callback.current = onBoundaryEditor
  const change = useRef(onChange); change.current = onChange
  const current = useRef(draft); current.current = draft
  const draftIds = useRef<string[]>([]), [error, setError] = useState('')
  const preview = useMemo(() => {
    if (!enabled || draft.mode !== 'cubic' || !draft.handles) return null
    try {
      const route = readConnectionRoute(text, draft, retained).route!
      const segments = route.segments.map((segment, index) => ({ ...segment, id: retained?.segments[index]?.id ?? (draftIds.current[index] ??= `route-draft-${crypto.randomUUID()}`) }))
      return { id: 'connection-route-session-draft', floorId, layerId, visibility, editLocked: false, closed: false, binding: { kind: 'decoration' as const },
        sampleSpacingMm: route.sampleSpacingMm, toleranceMm: route.toleranceMm, segments } satisfies VisualBoundary
    } catch { return null }
  }, [enabled, text, draft, retained, floorId, layerId, visibility])
  useEffect(() => {
    if (preview) callback.current?.({ boundary: preview, onChange: boundary => change.current({ ...current.current, controls: routeControlText(boundary.segments) }) })
    else callback.current?.(null)
    return () => callback.current?.(null)
  }, [preview])
  const patch = (value: Partial<ConnectionRouteDraft>) => { setError(''); onChange({ ...draft, ...value }) }
  return <div className="connection-route-fields">
    {!enabled ? <p className="asset-muted">曲线、回折和三种踏面需要完整v5。先在工程面板保存独立地形副本至v4，再保存独立曲线连接副本；原工程与历史保留。</p> : <>
      <label>连接路线<select aria-label="连接路线形态" value={draft.mode} onChange={event => patch({ mode: event.target.value as ConnectionRouteDraft['mode'], handles: false })}><option value="classic">经典直连接</option><option value="polyline">直行／折线／之字回折</option><option value="cubic">曲线控制点</option></select></label>
      {draft.mode !== 'classic' && <><p className="asset-muted">路线首末点分别使用明确的两端支撑。回折须保留足宽转角，完整带区与高差会在候选中校验。</p>
        {draft.mode === 'cubic' && <><button type="button" className="secondary asset-wide" onClick={() => { try { patch({ controls: routeControlText(smoothConnectionControls(connectionPoints(text)).map((segment, index, all) => ({ ...segment, id: sourceId(index, retained, 'cubic', all.length) }))) }) } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } }}>从路线节点生成曲线控制点</button>
          <label>每行：起点；控制点1；控制点2；终点 · mm<textarea aria-label="连接曲线控制点" rows={6} value={draft.controls} onChange={event => patch({ controls: event.target.value })}/></label>
          <label className="composition-check"><input type="checkbox" aria-label="在画布编辑连接控制点" checked={draft.handles} onChange={event => patch({ handles: event.target.checked })}/>在画布编辑连接控制点</label></>}
        <label>踏面风格<select aria-label="连接踏面风格" value={draft.style} onChange={event => patch({ style: event.target.value as ConnectionRoute['stairStyle'] })}><option value="stone">石砌</option><option value="wood">木梯</option><option value="naturalRock">自然岩阶</option></select></label>
        <label>踏面间距 mm<input type="number" aria-label="连接踏面间距毫米" min="50" max="2000" step="1" value={draft.tread} onChange={event => patch({ tread: event.target.value })}/></label>
        <div className="composition-fields"><label>采样间距 mm<input type="number" aria-label="连接采样间距毫米" min="4" max="20000" step="1" value={draft.spacing} onChange={event => patch({ spacing: event.target.value })}/></label><label>曲线容差 mm<input type="number" aria-label="连接曲线容差毫米" min="1" max="1000" step="1" value={draft.tolerance} onChange={event => patch({ tolerance: event.target.value })}/></label></div>
        <small>控制源、完整整数采样与踏面参数共同保存；宽度和踏面间距使用世界毫米。</small></>}
    </>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </div>
}
