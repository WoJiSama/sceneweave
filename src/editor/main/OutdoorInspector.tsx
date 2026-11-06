import { runtime } from './runtime'
import { useMemo, useState } from 'react'
import { Mountain, Trash2 } from 'lucide-react'
import type { SceneCommand } from '../../shared/commands/commands'
import { canonicalTerrainEdge, reconcileTerrainBoundary } from '../../shared/commands/outdoor'
import type { SceneDocument } from '../../shared/model/scene'
import { MaterialSelect, outdoorPoints, parseSurface, pointText, SurfaceMultiSelect, SurfaceSelect, surfaceValue } from './OutdoorToolsPanel'
import { outdoorInspectorStyle as styleFor } from './outdoor-inspector-style'
import ConnectionRouteFields, { newConnectionRouteDraft, readConnectionRoute } from './ConnectionRouteFields'
import type { VisualBoundaryEditor } from './VisualPanel'
import { createEntityLabeler } from './entity-label'
import { NumberInput } from '../native-canvas/controls'
import OutdoorCoordinates from './OutdoorCoordinates'
import { effectiveEditLocked } from '../../shared/commands/layers'
import EntityLockNotice from './EntityLockNotice'

export const outdoorEntityKind = (scene: SceneDocument, id: string) => scene.terrainAreas[id] ? 'terrainArea' : scene.terrainEdges[id] ? 'terrainEdge' : scene.terrainConnections[id] ? 'terrainConnection' : scene.paths[id] ? 'path' : scene.scatterGroups[id] ? 'scatterGroup' : scene.regions[id] && scene.regions[id].kind !== 'manualMask' ? 'region' : null

export default function OutdoorInspector({ scene, id, disabled, onPreview, onSelect, onBoundaryEditor, onOpenLayers }: { scene: SceneDocument; id: string; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void; onSelect: (id: string) => void; onBoundaryEditor?: (editor: VisualBoundaryEditor | null) => void; onOpenLayers?: () => void }) {
  const kind = outdoorEntityKind(scene, id), area = scene.terrainAreas[id], edge = scene.terrainEdges[id], connection = scene.terrainConnections[id], path = scene.paths[id], scatter = scene.scatterGroups[id], region = scene.regions[id]
  const entity = area ?? edge ?? connection ?? path ?? scatter ?? region
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  const surface = area?.surfaceStyle ?? edge?.surfaceStyle ?? connection?.surfaceStyle ?? path?.surfaceStyle ?? null
  const [points, setPoints] = useState(pointText(area?.boundaryMm.map(point => point.positionMm) ?? path?.centerlineMm ?? region?.boundaryMm ?? []))
  const [elevation, setElevation] = useState(String(area?.groundElevationMm ?? 0)), [priority, setPriority] = useState(String(area?.coveragePriority ?? 0)), [material, setMaterial] = useState(surface?.base.materialRef.id ?? '')
  const [visibility, setVisibility] = useState(entity.visibility), [blocking, setBlocking] = useState('blocksMovement' in entity ? entity.blocksMovement : false), [cost, setCost] = useState(String('movementCostMultiplier' in entity ? entity.movementCostMultiplier : 1)), [width, setWidth] = useState(String(connection?.widthMm ?? path?.widthMm ?? 2000))
  const [support, setSupport] = useState(connection ? surfaceValue(connection.from.surfaceRef) : ''), [toSupport, setToSupport] = useState(connection ? surfaceValue(connection.to.surfaceRef) : '')
  const [pathSupports, setPathSupports] = useState(path?.supportRefs.map(surfaceValue) ?? [])
  const [ends, setEnds] = useState(connection ? pointText(connection.route ? [connection.route.segments[0].start, ...connection.route.segments.map(segment => segment.end)] : [connection.from.positionMm, connection.to.positionMm]) : ''), [connectionKind, setConnectionKind] = useState(connection?.kind ?? 'stairs')
  const [connectionRoute, setConnectionRoute] = useState(() => newConnectionRouteDraft(connection?.route))
  const [density, setDensity] = useState(String(scatter?.densityFactor ?? 0.4)), [spacing, setSpacing] = useState(String(scatter?.minDistanceMm ?? 300)), [cell, setCell] = useState(String(scatter?.cellSizeMm ?? 2500))
  const [extraBoundary, setExtraBoundary] = useState(''), [extraMaterial, setExtraMaterial] = useState(''), [blend, setBlend] = useState('150'), [segment, setSegment] = useState(area?.boundaryMm[0]?.segmentId ?? ''), [exclusionReason, setExclusionReason] = useState<'manual' | 'entrance'>('manual')
  const [error, setError] = useState<string | null>(null), [deleteConfirm, setDeleteConfirm] = useState(false)
  const relatedEdges = area ? Object.values(scene.terrainEdges).filter(item => item.source.areaId === id || item.neighborAreaId === id) : []
  const [remapEdges, setRemapEdges] = useState(false), [edgeSegments, setEdgeSegments] = useState<Record<string, number>>({})
  const [edgeSource, setEdgeSource] = useState(edge ? `${edge.source.areaId}\n${edge.source.segmentId}` : '')
  const [edgeKind, setEdgeKind] = useState(edge?.kind ?? 'materialTransition')
  const [shoreline, setShoreline] = useState(edge?.shoreline ?? false)
  const boundaryDraft = useMemo(() => {
    if (!area) return null
    try { return reconcileTerrainBoundary(area.boundaryMm, outdoorPoints(points), runtime) } catch { return null }
  }, [area, points])
  const run = (prepare: () => SceneCommand[], label: string) => { try { setError(null); onPreview(prepare(), label) } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } }
  if (!kind) return null
  const locked = effectiveEditLocked(scene, id)
  const edit = () => run(() => {
    if ((path || connection) && Number(width) <= 0) throw new Error('通路净宽须大于 0，请调整后重新预览。')
    if (area) {
      const next = outdoorPoints(points)
      const boundaryMm = reconcileTerrainBoundary(area.boundaryMm, next, runtime)
      const changes = { boundaryMm, groundElevationMm: Number(elevation), coveragePriority: Number(priority), surfaceStyle: styleFor(scene, material, surface), visibility, blocksMovement: blocking, movementCostMultiplier: Number(cost) }
      const commands: SceneCommand[] = [{ type: 'updateTerrainArea', id, changes }]
      if (remapEdges) {
        const candidate = structuredClone(scene); Object.assign(candidate.terrainAreas[id], changes)
        for (const item of relatedEdges) {
          const selectedIndex = edgeSegments[item.id]
          const point = item.source.areaId === id
            ? selectedIndex !== undefined && selectedIndex >= 0 ? boundaryMm[selectedIndex] : boundaryMm.find(value => value.segmentId === item.source.segmentId)
            : null
          if (item.source.areaId === id && !point) throw new Error(`请为来源边缘 ${item.id} 明确选择新段序号。`)
          const relation = canonicalTerrainEdge(candidate, point ? { areaId: id, segmentId: point.segmentId } : item.source)
          commands.push({ type: 'updateTerrainEdge', id: item.id, changes: { source: relation.source, neighborAreaId: relation.neighborAreaId, kind: relation.requiresCliff ? 'cliff' : item.kind === 'cliff' ? 'materialTransition' : item.kind, blocksMovement: relation.requiresCliff || item.blocksMovement } })
        }
      }
      return commands
    }
    if (path) return [{ type: 'updatePath', id, changes: { centerlineMm: outdoorPoints(points, 2), widthMm: Number(width), supportRefs: pathSupports.map(parseSurface), surfaceStyle: styleFor(scene, material, surface), visibility, movementCostMultiplier: Number(cost) } }]
    if (connection) {
      const { points: positions, route } = readConnectionRoute(ends, connectionRoute, connection.route)
      return [{ type: 'updateTerrainConnection', id, changes: { kind: connectionKind, from: { surfaceRef: parseSurface(support), positionMm: positions[0] }, to: { surfaceRef: parseSurface(toSupport), positionMm: positions.at(-1)! }, widthMm: Number(width), surfaceStyle: styleFor(scene, material, surface), visibility, blocksMovement: blocking, movementCostMultiplier: Number(cost), ...(scene.mapMode === 'scene' ? { route: route ?? null } : {}) } }]
    }
    if (edge) {
      const [areaId, segmentId, ...rest] = edgeSource.trim().split(/\s+/)
      if (!areaId || !segmentId || rest.length) throw new Error('来源须为两行：地形ID、边段ID。')
      const relation = canonicalTerrainEdge(scene, { areaId, segmentId })
      return [{ type: 'updateTerrainEdge', id, changes: { source: relation.source, neighborAreaId: relation.neighborAreaId, kind: edgeKind, shoreline, surfaceStyle: styleFor(scene, material, surface), visibility, blocksMovement: blocking } }]
    }
    if (scatter) return [{ type: 'configureScatter', id, changes: { densityFactor: Number(density), minDistanceMm: Number(spacing), cellSizeMm: Number(cell), visibility } }]
    return [{ type: 'updateRegion', id, changes: { boundaryMm: outdoorPoints(points), visibility, blocksMovement: blocking, movementCostMultiplier: Number(cost) } }]
  }, '编辑室外对象')
  return <section className="outdoor-inspector" aria-label="室外对象属性">
    <div className="asset-section-heading"><Mountain size={16}/><h2>{name(id)}</h2></div><details><summary>对象编号</summary><code>{id}</code></details>
    <p className="asset-muted">图层：{scene.userLayers[scene.entityLayers[id]]?.name} {locked ? '· 当前锁定' : ''}。尺寸使用{scene.units.display === 'ft' ? '英尺' : '米'}，按最近 1 mm 保存。</p>
    <EntityLockNotice scene={scene} id={id} onSelect={onSelect} onOpenLayers={onOpenLayers}/>
    <fieldset disabled={disabled || locked}>
      {(area || edge || connection || path) && <><MaterialSelect scene={scene} value={material} onChange={setMaterial} label="对象表面材质"/><small>更换底材保留铺法、着色和局部覆盖；选择“无铺装”移除全部铺装。</small></>}
      {area && <NumberInput label="地面高度" ariaLabel="对象地形高程" displayUnit={scene.units.display} value={Number(elevation)} onCommit={value => setElevation(String(value))}/>}
      {(path || connection) && <NumberInput label="通路净宽" ariaLabel="对象通路净宽" displayUnit={scene.units.display} value={Number(width)} onCommit={value => setWidth(String(value))}/>}
      {connection && <><label>连接类型<select aria-label="对象连接类型" value={connectionKind} onChange={event => setConnectionKind(event.target.value as typeof connectionKind)}><option value="stairs">台阶</option><option value="ramp">坡道</option></select></label><SurfaceSelect scene={scene} value={support} onChange={setSupport} label="对象连接起点表面"/><SurfaceSelect scene={scene} value={toSupport} onChange={setToSupport} label="对象连接终点表面"/></>}
      {path && <><SurfaceMultiSelect scene={scene} values={pathSupports} onChange={setPathSupports} label="对象道路支撑"/><small>按住 Ctrl / ⌘ 可多选。整条道路须位于所选支撑面的并集内。</small></>}
      {connection && <OutdoorCoordinates text={ends} onChange={setEnds} label="连接路线节点" ariaLabel="对象连接端点" minimum={2} unit={scene.units.display}/>}
      {connection && <details><summary>路线形态与踏面</summary><ConnectionRouteFields enabled={scene.mapMode === 'scene'} text={ends} draft={connectionRoute} retained={connection.route} onChange={setConnectionRoute} floorId={connection.floorId} layerId={scene.entityLayers[id]} visibility={visibility} onBoundaryEditor={onBoundaryEditor}/></details>}
      {(area || path || region) && <OutdoorCoordinates text={points} onChange={value => { setPoints(value); setEdgeSegments({}) }} label={path ? '道路中心线' : '轮廓'} ariaLabel="室外对象坐标" minimum={path ? 2 : 3} unit={scene.units.display}/>}
      {relatedEdges.length > 0 && <details><summary>关联来源边缘 · {relatedEdges.length}</summary><label className="composition-check"><input type="checkbox" aria-label="同时重映射来源边缘" checked={remapEdges} onChange={event => setRemapEdges(event.target.checked)}/>同一事务重新确认来源、相邻面与崖边</label><small>逐项选择编辑后轮廓的段序号。高差边缘变为崖边并阻挡移动；完整变化在采用前展示。无法保持唯一来源会拒绝整笔修改。</small>{relatedEdges.map(item => { const retainedIndex = boundaryDraft?.findIndex(point => point.segmentId === item.source.segmentId) ?? -1; return <label key={item.id}>{name(item.id)}{item.source.areaId === id ? <input aria-label={`重映射边段 ${item.id}`} type="number" min="0" max="2048" value={(edgeSegments[item.id] !== undefined && edgeSegments[item.id] >= 0 ? edgeSegments[item.id] : retainedIndex) + 1} onChange={event => setEdgeSegments(current => ({ ...current, [item.id]: Number(event.target.value) - 1 }))}/> : <small>保留来源 {name(item.source.segmentId)}，重新核对相邻面</small>}</label>})}</details>}
      {edge && <><details><summary>来源地形与边段</summary><p className="asset-muted">{name(edge.source.segmentId)}。修改来源需完整检查相邻地面。</p><label>地形编号 / 边段编号<textarea aria-label="边缘来源映射" rows={2} value={edgeSource} onChange={event => setEdgeSource(event.target.value)}/></label></details><label>边缘类型<select aria-label="对象边缘类型" value={edgeKind} onChange={event => setEdgeKind(event.target.value as typeof edgeKind)}><option value="materialTransition">材质边界</option><option value="cliff">崖边</option><option value="shore">岸地边缘</option></select></label><label className="composition-check"><input type="checkbox" aria-label="显示岸线" checked={shoreline} onChange={event => setShoreline(event.target.checked)}/>显示岸线</label></>}
      {scatter && <><div className="composition-fields"><label>密度 0–1<input aria-label="对象散布密度" type="number" min="0" max="1" step="0.05" value={density} onChange={event => setDensity(event.target.value)}/></label><NumberInput label="生成采样间隔" ariaLabel="对象散布格距" displayUnit={scene.units.display} value={Number(cell)} onCommit={value => setCell(String(value))}/></div><NumberInput label="物件最小间距" ariaLabel="对象散布间距" displayUnit={scene.units.display} value={Number(spacing)} onCommit={value => setSpacing(String(value))}/><small>保存配置不自动重新散布。手工移动、删除、退出和锁定保持。</small></>}
      {'blocksMovement' in entity && <label className="composition-check"><input aria-label="对象阻挡移动" type="checkbox" checked={blocking} onChange={event => setBlocking(event.target.checked)}/>阻挡移动</label>}
      {(area || 'movementCostMultiplier' in entity) && <details><summary>覆盖与通行设置</summary>{area && <label>覆盖优先级<input aria-label="对象覆盖优先级" type="number" step="1" value={priority} onChange={event => setPriority(event.target.value)}/></label>}{'movementCostMultiplier' in entity && <label>移动代价倍率<input aria-label="对象移动代价" type="number" min="1" step="0.1" value={cost} onChange={event => setCost(event.target.value)}/></label>}</details>}
      <label>可见性<select aria-label="对象室外可见性" value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="public">公开</option><option value="gm">仅主持人</option></select></label>
      <button className="primary asset-wide" onClick={edit}>预览对象修改</button>
      {area && <details><summary>来源边缘与局部铺装</summary><label>来源边段<select aria-label="来源边段" value={segment} onChange={event => setSegment(event.target.value)}>{area.boundaryMm.map((point, index) => <option key={point.segmentId} value={point.segmentId}>第 {index + 1} 段 · {point.positionMm.x}, {point.positionMm.y}</option>)}</select></label><button className="secondary asset-wide" onClick={() => run(() => [{ type: 'createTerrainEdge', id: `edge-${crypto.randomUUID()}`, source: { areaId: id, segmentId: segment }, layerId: scene.entityLayers[id] }], '固定来源边缘')}>预览来源边缘</button><OutdoorCoordinates text={extraBoundary} onChange={setExtraBoundary} label="局部覆盖轮廓" ariaLabel="局部覆盖坐标" minimum={3} unit={scene.units.display}/><MaterialSelect scene={scene} value={extraMaterial} onChange={setExtraMaterial} label="局部覆盖材质"/><NumberInput label="材质过渡宽度" ariaLabel="局部覆盖过渡宽度" displayUnit={scene.units.display} value={Number(blend)} onCommit={value => setBlend(String(value))}/><button className="secondary asset-wide" onClick={() => run(() => {
        const paint = styleFor(scene, extraMaterial, null)?.base
        if (!paint || !area.surfaceStyle) throw new Error('先给地形设置底材，再选择覆盖材质。')
        return [{ type: 'updateTerrainArea', id, changes: { surfaceStyle: { ...area.surfaceStyle, overlays: [...area.surfaceStyle.overlays, { id: `overlay-${crypto.randomUUID()}`, boundaryMm: outdoorPoints(extraBoundary), paint, blendWidthMm: Number(blend), renderOrder: area.surfaceStyle.overlays.reduce((max, overlay) => Math.max(max, overlay.renderOrder + 1), 0) }] } } }]
      }, '增加地形局部覆盖')}>预览增加覆盖</button>{area.surfaceStyle?.overlays.map((overlay, index) => <button className="secondary asset-wide" key={overlay.id} onClick={() => run(() => [{ type: 'updateTerrainArea', id, changes: { surfaceStyle: { ...area.surfaceStyle!, overlays: area.surfaceStyle!.overlays.filter(item => item.id !== overlay.id) } } }], '移除地形局部覆盖')}>移除覆盖 {index + 1}</button>)}</details>}
      {scatter && <><button className="secondary asset-wide" onClick={() => run(() => [{ type: 'regenerateScatter', id, densityFactor: Number(density) }], '重新预览散布')}>预览重新散布</button><details open><summary>排除区 · {scatter.exclusions.length}</summary><OutdoorCoordinates text={extraBoundary} onChange={setExtraBoundary} label="散布排除轮廓" ariaLabel="散布排除坐标" minimum={3} unit={scene.units.display}/><label>排除用途<select aria-label="散布排除用途" value={exclusionReason} onChange={event => setExclusionReason(event.target.value as typeof exclusionReason)}><option value="manual">人工保留区</option><option value="entrance">入口净空</option></select></label><button className="secondary asset-wide" onClick={() => run(() => [{ type: 'upsertScatterExclusion', groupId: id, exclusion: { id: `exclusion-${crypto.randomUUID()}`, boundaryMm: outdoorPoints(extraBoundary), reason: exclusionReason } }], '增加散布排除区')}>预览排除区</button>{scatter.exclusions.map((exclusion, index) => <p className="asset-muted" key={exclusion.id}>{index + 1}. {exclusion.reason === 'delete' ? '成员删除保留区' : exclusion.reason === 'entrance' ? '入口净空' : '人工排除'}{exclusion.reason !== 'delete' && <button className="secondary" onClick={() => run(() => [{ type: 'removeScatterExclusion', groupId: id, exclusionId: exclusion.id }], '移除明确排除区')}>移除</button>}</p>)}</details><details><summary>完整成员记录 · {Object.keys(scatter.members).length}</summary>{Object.entries(scatter.members).map(([key, member]) => <div className="outdoor-object-list" key={key}><small>{member.state} · {key}</small>{member.propId ? <><button className="secondary" onClick={() => onSelect(member.propId!)}>{name(member.propId)}</button><button className="secondary" onClick={() => run(() => [{ type: 'detachScatterMember', groupId: id, propId: member.propId! }], '退出散布保留物件')}>退出组并保留物件</button></> : <small>保留抑制记录</small>}</div>)}</details></>}
      {edge && <details><summary>关联地形</summary><p className="asset-muted">来源 {name(edge.source.segmentId)}；邻接 {edge.neighborAreaId ? name(edge.neighborAreaId) : '基础地面'}。来源和相邻关系在轮廓编辑中重新校验。</p></details>}
      <button className="secondary outdoor-delete asset-wide" onClick={() => setDeleteConfirm(value => !value)}><Trash2 size={13}/>删除此对象</button>{deleteConfirm && <><p className="asset-muted">有支撑、成员或注记依赖时将拒绝。预览不会删除当前内容。</p><button className="secondary outdoor-delete asset-wide" onClick={() => run(() => [{ type: 'deleteOutdoorEntity', kind, id }], '删除室外对象')}>预览删除室外对象</button></>}
    </fieldset>
    <button className="secondary asset-wide" disabled={disabled || scene.userLayers[scene.entityLayers[id]]?.editLocked} onClick={() => onPreview([{ type: 'setEditLock', kind, id, locked: !entity.editLocked }], entity.editLocked ? '解除对象编辑锁' : '锁定对象编辑')}>{entity.editLocked ? '解除对象编辑锁' : '锁定对象编辑'}</button>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </section>
}
