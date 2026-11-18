import { useMemo, useState } from 'react'
import type { SceneDocument, PointMm } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { connectionCenterline } from '../../shared/geometry/connection-route'
import { defaultStaircase } from '../../shared/stairs/contracts'
import { prepareStaircaseCommands } from '../../shared/stairs/edit'
import { effectiveEditLocked } from '../../shared/commands/layers'
import ConnectionRouteFields, { newConnectionRouteDraft, readConnectionRoute } from './ConnectionRouteFields'
import OutdoorCoordinates from './OutdoorCoordinates'
import { pointText } from './outdoor-coordinates'
import type { VisualBoundaryEditor } from './VisualPanel'
import StaircaseFields from './StaircaseFields'

const routeLength = (points: readonly PointMm[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0)

/** All previews use the same command preparation as the other editor paths.
 * Shape changes rebuild an existing physical slope as one proposed edit. */
export default function StaircaseTools({ scene, id, disabled, onPreview, onBoundaryEditor }: {
  scene: SceneDocument; id: string; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void
  onBoundaryEditor?: (editor: VisualBoundaryEditor | null) => void
}) {
  const connection = scene.terrainConnections[id]
  const retained = connection?.terrainInlay?.originalConnection.route ?? connection?.route
  const [staircase, setStaircase] = useState(() => structuredClone(connection?.staircase ?? defaultStaircase()))
  const [points, setPoints] = useState(() => pointText(retained ? [retained.segments[0].start, ...retained.segments.map(segment => segment.end)] : connection ? [connection.from.positionMm, connection.to.positionMm] : []))
  const [draft, setDraft] = useState(() => newConnectionRouteDraft(retained))
  const [width, setWidth] = useState(String(connection?.widthMm ?? 2000)), [length, setLength] = useState<string | null>(null), [rotation, setRotation] = useState('0')
  const [leftBank, setLeftBank] = useState('1000'), [rightBank, setRightBank] = useState('750')
  const [error, setError] = useState('')
  const routeDraft = useMemo(() => {
    try {
      const parsed = readConnectionRoute(points, draft, retained)
      const centerlineMm = parsed.route?.centerlineMm ?? parsed.points
      return { centerlineMm, length: routeLength(centerlineMm), error: '' }
    } catch (failure) {
      return { centerlineMm: undefined, length: 0, error: failure instanceof Error ? failure.message : String(failure) }
    }
  }, [points, draft, retained])
  const fieldCenterline = useMemo(() => {
    const centerline = routeDraft.centerlineMm
    if (!centerline) return undefined
    if (length === null) return centerline
    const factor = Number(length) / routeDraft.length
    if (!(factor > 0) || !Number.isFinite(factor)) return undefined
    const start = centerline[0]
    return centerline.map(point => ({ x: Math.round((point.x - start.x) * factor), y: Math.round((point.y - start.y) * factor) }))
  }, [routeDraft, length])
  if (!connection || scene.mapMode !== 'scene' || connection.carvedStrip) return null
  const attempt = (prepare: () => SceneCommand[], description: string) => {
    try { setError(''); onPreview(prepare(), description) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <fieldset className="staircase-tools" data-staircase-tools disabled={disabled || effectiveEditLocked(scene, id)}>
    <legend>阶梯工具</legend>
    <p className="asset-muted">阶梯铺在支撑表面上。样式、材质和局部覆盖可独立修改；形状调整先预览，再确认采用。</p>
    <StaircaseFields value={staircase} onChange={setStaircase} centerlineMm={fieldCenterline ?? connectionCenterline(connection)} widthMm={Number(width)}/>
    <small>外观预览使用当前已保存的形状；下方形状预览会同时采用这里的外观与路线。</small>
    <button type="button" className="primary asset-wide" onClick={() => attempt(() => prepareStaircaseCommands(scene, id, { staircase }), '更新阶梯样式、材质与局部覆盖')}>预览阶梯外观</button>
    <details>
      <summary>长度、宽度、旋转与弯曲</summary>
      <label>阶梯净宽（毫米）<input aria-label="阶梯净宽毫米" type="number" min="1" step="1" value={width} onChange={event => setWidth(event.target.value)}/></label>
      <label>路线总长度（毫米）<input aria-label="阶梯总长度毫米" type="number" min="1" step="1" value={length ?? String(Math.round(routeDraft.length))} onChange={event => setLength(event.target.value)}/></label>
      <label>绕起点旋转（度）<input aria-label="阶梯旋转角度" type="number" min="-360" max="360" step="1" value={rotation} onChange={event => setRotation(event.target.value)}/></label>
      <p className="asset-muted">旋转以当前路线起点为中心。调整节点或控制点后，总长度按新路线重新计算。</p>
      <OutdoorCoordinates text={points} onChange={value => { setPoints(value); setLength(null) }} label="阶梯路线" ariaLabel="阶梯路线节点" minimum={2} unit={scene.units.display}/>
      <ConnectionRouteFields enabled text={points} draft={draft} retained={retained} floorId={connection.floorId} layerId={scene.entityLayers[id]} visibility={connection.visibility} onChange={value => { setDraft(value); setLength(null) }} onBoundaryEditor={onBoundaryEditor} appearanceControls={false}/>
      {routeDraft.error && <p className="asset-form-error" role="alert">{routeDraft.error}</p>}
      {connection.terrainInlay && <>
        <p className="asset-muted">改变形状会按新路线重建连续坡体，并替换当前坡体的人工形状；整个预览可取消，采用后可整笔撤销。</p>
        <div className="composition-fields"><label>左侧坡体延伸（毫米）<input aria-label="阶梯左侧坡体延伸毫米" type="number" min="1" max="20000" step="1" value={leftBank} onChange={event => setLeftBank(event.target.value)}/></label><label>右侧坡体延伸（毫米）<input aria-label="阶梯右侧坡体延伸毫米" type="number" min="1" max="20000" step="1" value={rightBank} onChange={event => setRightBank(event.target.value)}/></label></div>
      </>}
      <button type="button" className="secondary asset-wide" onClick={() => attempt(() => {
        // A dedicated stair always has an explicit route, including a straight
        // two-endpoint route. An omitted helper option means no route change.
        const parsed = readConnectionRoute(points, draft.mode === 'classic' ? { ...draft, mode: 'polyline' } : draft, retained)
        if (!parsed.route) throw new Error('请先设置有效的阶梯路线。')
        const draftLength = routeLength(parsed.route.centerlineMm)
        if (!(draftLength > 0)) throw new Error('阶梯路线总长度须大于0。')
        if (!width.trim() || !Number.isSafeInteger(Number(width)) || Number(width) <= 0) throw new Error('阶梯净宽须为正整数毫米。')
        if (length !== null && (!length.trim() || !Number.isSafeInteger(Number(length)) || Number(length) <= 0)) throw new Error('阶梯总长度须为正整数毫米。')
        if (!rotation.trim() || !Number.isFinite(Number(rotation))) throw new Error('请填写有效的旋转角度。')
        if (connection.terrainInlay && [leftBank, rightBank].some(input => !input.trim() || !Number.isSafeInteger(Number(input)) || Number(input) < 1 || Number(input) > 20000)) throw new Error('两侧坡体延伸须为1–20000整数毫米。')
        return prepareStaircaseCommands(scene, id, { staircase, route: parsed.route, widthMm: Number(width), transform: { rotationDeg: Number(rotation), lengthScale: length === null ? 1 : Number(length) / draftLength }, ...(connection.terrainInlay ? { bankWidthMm: { left: Number(leftBank), right: Number(rightBank) } } : {}) })
      }, connection.terrainInlay ? '调整阶梯形状并按路线重建连续坡体' : '调整阶梯长度、宽度、旋转与弯曲路线')}>预览阶梯形状</button>
    </details>
    {connection.staircase && <button type="button" className="secondary asset-wide" onClick={() => attempt(() => prepareStaircaseCommands(scene, id, { staircase: null }), '恢复原有表面外观')}>预览恢复原有表面</button>}
    {error && <p className="asset-form-error" role="alert">{error}</p>}
  </fieldset>
}
