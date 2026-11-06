import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createEntityLabeler } from './entity-label'
import { NumberInput } from '../native-canvas/controls'
import OutdoorCoordinates from './OutdoorCoordinates'
import { outdoorPoints, pointText } from './outdoor-coordinates'
export { outdoorPoints, pointText } from './outdoor-coordinates'
import ConnectionRouteFields, { newConnectionRouteDraft, readConnectionRoute } from './ConnectionRouteFields'
import type { VisualBoundaryEditor } from './VisualPanel'
import { Mountain, PencilRuler, Sprout, Route } from 'lucide-react'
import type { OutdoorCommand } from '../../shared/commands/outdoor'
import type { PointMm, SceneDocument, SurfaceRef, VersionRef } from '../../shared/model/scene'

export type OutdoorSketch = { kind: 'polygon' | 'polyline'; purpose: 'terrain' | 'region' | 'path' | 'connection'; points: PointMm[]; cursor: PointMm | null }
export const surfaceValue = (ref: SurfaceRef) => `${ref.kind}:${ref.id}`
export function parseSurface(value: string): SurfaceRef {
  const index = value.indexOf(':'), kind = value.slice(0, index), id = value.slice(index + 1)
  if (!['floor', 'room', 'terrainArea'].includes(kind) || !id) throw new Error('请明确选择支撑表面。')
  return { kind: kind as SurfaceRef['kind'], id }
}
export function SurfaceSelect({ scene, value, onChange, label }: { scene: SceneDocument; value: string; onChange: (value: string) => void; label: string }) {
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">明确选择表面</option>{Object.values(scene.floors).map(floor => <option key={floor.id} value={`floor:${floor.id}`}>基础地面 · {name(floor.id)}</option>)}{Object.values(scene.terrainAreas).map(area => <option key={area.id} value={`terrainArea:${area.id}`}>地形 · {name(area.id)}</option>)}{Object.values(scene.rooms).map(room => <option key={room.id} value={`room:${room.id}`}>房间 · {name(room.id)}</option>)}</select></label>
}
export function SurfaceMultiSelect({ scene, values, onChange, label }: { scene: SceneDocument; values: string[]; onChange: (values: string[]) => void; label: string }) {
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  return <label>{label}<select multiple aria-label={label} value={values} onChange={event => onChange([...event.target.selectedOptions].map(option => option.value))}>{Object.values(scene.floors).map(floor => <option key={floor.id} value={`floor:${floor.id}`}>基础地面 · {name(floor.id)}</option>)}{Object.values(scene.terrainAreas).map(area => <option key={area.id} value={`terrainArea:${area.id}`}>地形 · {name(area.id)}</option>)}{Object.values(scene.rooms).map(room => <option key={room.id} value={`room:${room.id}`}>房间 · {name(room.id)}</option>)}</select></label>
}
export function MaterialSelect({ scene, value, onChange, label = '地形材质' }: { scene: SceneDocument; value: string; onChange: (value: string) => void; label?: string }) {
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">无铺装</option>{Object.values(scene.materials).map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
}
const fresh = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export default function OutdoorToolsPanel({ scene, layerId, disabled, sketch, onSketch, onPreview, onSelect, onBoundaryEditor, onFinishReady }: { scene: SceneDocument; layerId: string; disabled: boolean; sketch: OutdoorSketch | null; onSketch: (sketch: OutdoorSketch | null) => void; onPreview: (commands: OutdoorCommand[], description: string) => void; onSelect: (id: string) => void; onBoundaryEditor?: (editor: VisualBoundaryEditor | null) => void; onFinishReady?: (finish: (() => void) | null) => void }) {
  const [tool, setTool] = useState<OutdoorSketch['purpose'] | 'scatter'>('terrain'), [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState('2000, 2000\n12000, 2000\n12000, 10000\n2000, 10000')
  const [material, setMaterial] = useState(Object.values(scene.materials).find(item => item.applicableSurfaces.includes('terrain'))?.id ?? ''), [elevation, setElevation] = useState('0'), [priority, setPriority] = useState('0')
  const [visibility, setVisibility] = useState<'public' | 'gm'>('public'), [blocking, setBlocking] = useState(false), [regionKind, setRegionKind] = useState<'terrain' | 'hazard'>('terrain')
  const [connectionRoute, setConnectionRoute] = useState(newConnectionRouteDraft)
  const floorId = scene.userLayers[layerId]?.floorId ?? Object.keys(scene.floors)[0]
  const [width, setWidth] = useState('2000'), [support, setSupport] = useState(`floor:${floorId}`), [toSupport, setToSupport] = useState(''), [connectionKind, setConnectionKind] = useState<'stairs' | 'ramp'>('stairs'), [openingId, setOpeningId] = useState('')
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  const domains = [...Object.values(scene.terrainAreas).map(area => ({ value: `area:${area.id}`, name: `地形 · ${name(area.id)}` })), ...Object.values(scene.paths).map(path => ({ value: `path:${path.id}`, name: name(path.id) })), ...Object.values(scene.terrainEdges).map(edge => ({ value: `edgeBand:${edge.id}`, name: name(edge.id) }))]
  const [domain, setDomain] = useState(''), [definition, setDefinition] = useState(''), [density, setDensity] = useState('0.4'), [cell, setCell] = useState('2500'), [spacing, setSpacing] = useState('300'), [seed, setSeed] = useState('camp-1')
  useEffect(() => { if (sketch) { setTool(sketch.purpose); setPoints(pointText(sketch.points)) } }, [sketch])
  const materialRef = (): VersionRef | undefined => material ? { id: material, version: scene.materials[material].version } : undefined
  const run = () => {
    try {
      setError(null)
      if ((tool === 'path' || tool === 'connection') && Number(width) <= 0) throw new Error('通路净宽须大于 0，请调整后重新预览。')
      const common = { floorId, layerId, visibility }
      let command: OutdoorCommand
      if (tool === 'terrain') command = { type: 'createTerrainArea', id: fresh('terrain'), ...common, boundaryMm: outdoorPoints(points), groundElevationMm: Number(elevation), coveragePriority: Number(priority), blocksMovement: blocking, materialRef: materialRef() }
      else if (tool === 'region') command = { type: 'createRegion', id: fresh('region'), ...common, boundaryMm: outdoorPoints(points), kind: regionKind, blocksMovement: blocking, movementCostMultiplier: 1 }
      else if (tool === 'path') command = { type: 'createPath', id: fresh('path'), ...common, centerlineMm: outdoorPoints(points, 2), widthMm: Number(width), supportRefs: [parseSurface(support)], materialRef: materialRef() }
      else if (tool === 'connection') {
        const { points: ends, route } = readConnectionRoute(points, connectionRoute)
        command = { type: 'createTerrainConnection', id: fresh('connection'), ...common, kind: connectionKind, from: { surfaceRef: parseSurface(support), positionMm: ends[0] }, to: { surfaceRef: parseSurface(toSupport), positionMm: ends.at(-1)! }, widthMm: Number(width), openingId: openingId || null, ...(route ? { route } : {}) }
      } else {
        const index = domain.indexOf(':'), kind = domain.slice(0, index), id = domain.slice(index + 1), item = scene.propDefinitions[definition]
        if (!item || !id) throw new Error('请明确选择散布域和固定物件素材。')
        const scatterDomain = kind === 'area' ? { kind: 'area' as const, areaId: id } : kind === 'path' ? { kind: 'path' as const, pathId: id } : { kind: 'edgeBand' as const, edgeId: id, widthMm: Number(width) }
        command = { type: 'createScatter', id: fresh('scatter'), ...common, domain: scatterDomain, palette: [{ key: 'chosen', propDefinitionRef: { id: definition, version: item.version }, weight: 1 }], seed, cellSizeMm: Number(cell), densityFactor: Number(density), minDistanceMm: Number(spacing), rotationRangeDeg: { min: 0, max: 359.999 } }
      }
      onPreview([command], { terrain: '新建地形', region: '新建用途或危险区域', path: '铺设道路', connection: '创建高差连接', scatter: '创建散布组' }[tool])
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const minimum = tool === 'path' || tool === 'connection' ? 2 : 3
  const finishReady = !disabled && !!layerId && sketch?.purpose === tool && sketch.points.length >= minimum
  const finishRef = useRef<(() => void) | null>(null), finishListener = useRef(onFinishReady)
  useLayoutEffect(() => { finishRef.current = finishReady ? run : null; finishListener.current = onFinishReady })
  const finish = useCallback(() => finishRef.current?.(), [])
  useLayoutEffect(() => { onFinishReady?.(finishReady ? finish : null); return () => finishListener.current?.(null) }, [finishReady, finish, onFinishReady])
  return <section className="outdoor-panel" aria-label="室外制作工具">
    <div className="asset-section-heading"><Mountain size={17}/><h2>室外制作</h2></div>
    <fieldset disabled={disabled}>
      <label>制作工具<select aria-label="室外制作工具" value={tool} onChange={event => { setTool(event.target.value as typeof tool); setError(null); onSketch(null) }}><option value="terrain">地形与高程</option><option value="region">用途 / 危险区域</option><option value="connection">台阶 / 坡道</option><option value="path">道路</option><option value="scatter">可控散布</option></select></label>
      {tool !== 'scatter' && <>
        <button className="secondary asset-wide" onClick={() => onSketch(sketch?.purpose === tool ? null : { kind: tool === 'path' || tool === 'connection' ? 'polyline' : 'polygon', purpose: tool, points: [], cursor: null })}><PencilRuler size={14}/>{sketch?.purpose === tool ? '结束画布取点' : '在画布逐点绘制'}</button>
        <OutdoorCoordinates text={points} onChange={value => { setPoints(value); onSketch(null) }} label={tool === 'path' ? '道路中心线' : tool === 'connection' ? '连接路线节点' : '区域轮廓'} ariaLabel="室外坐标" minimum={minimum} unit={scene.units.display}/>
      </>}
      {tool === 'terrain' && <>
        <MaterialSelect scene={scene} value={material} onChange={setMaterial}/>
        <NumberInput label="地面高程" ariaLabel="地形高程" value={Number(elevation)} displayUnit={scene.units.display} onCommit={value => setElevation(String(value))}/>
        <details className="outdoor-advanced"><summary>重叠地形的显示顺序</summary><label>覆盖优先级<input aria-label="地形覆盖优先级" type="number" step="1" value={priority} onChange={event => setPriority(event.target.value)}/></label><small>高程决定实际高度，优先级决定重叠时的覆盖顺序；同优先级地形不能重叠。</small></details>
      </>}
      {tool === 'region' && <label>区域用途<select aria-label="区域用途" value={regionKind} onChange={event => setRegionKind(event.target.value as typeof regionKind)}><option value="terrain">用途区域</option><option value="hazard">危险区域</option></select></label>}
      {(tool === 'path' || tool === 'connection') && <>
        <NumberInput label="通路净宽" ariaLabel="室外通路净宽" value={Number(width)} displayUnit={scene.units.display} onCommit={value => setWidth(String(value))}/>
        <SurfaceSelect scene={scene} value={support} onChange={setSupport} label={tool === 'connection' ? '连接起点表面' : '道路支撑表面'}/>
        {tool === 'path' ? <MaterialSelect scene={scene} value={material} onChange={setMaterial} label="道路材质"/> : <>
          <SurfaceSelect scene={scene} value={toSupport} onChange={setToSupport} label="连接终点表面"/>
          <label>连接类型<select aria-label="高差连接类型" value={connectionKind} onChange={event => setConnectionKind(event.target.value as typeof connectionKind)}><option value="stairs">台阶</option><option value="ramp">坡道</option></select></label>
          <details className="outdoor-advanced"><summary>路线形态与踏面</summary><ConnectionRouteFields enabled={scene.mapMode === 'scene'} text={points} draft={connectionRoute} onChange={setConnectionRoute} floorId={floorId} layerId={layerId} visibility={visibility} onBoundaryEditor={onBoundaryEditor}/></details>
          <details className="outdoor-advanced"><summary>连接房间门窗</summary><label>房间端附着开口<select aria-label="连接附着开口" value={openingId} onChange={event => setOpeningId(event.target.value)}><option value="">无房间开口</option>{Object.values(scene.openings).map(opening => <option key={opening.id} value={opening.id}>{name(opening.id)}</option>)}</select></label></details>
        </>}
        <small>明确选择实际支撑面；道路图片和材质不改变高差或通行。</small>
      </>}
      {tool === 'scatter' && <>
        <div className="asset-section-heading"><Sprout size={15}/><h3>保留人工布景</h3></div>
        <label>散布域<select aria-label="散布域" value={domain} onChange={event => setDomain(event.target.value)}><option value="">选择地形、道路或边缘</option>{domains.map(item => <option key={item.value} value={item.value}>{item.name}</option>)}</select></label>
        <label>散布素材<select aria-label="散布素材" value={definition} onChange={event => setDefinition(event.target.value)}><option value="">选择固定素材</option>{Object.values(scene.propDefinitions).filter(item => !item.tags.includes('sceneweave:retained-appearance')).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>密度 0–1<input aria-label="散布密度" type="number" min="0" max="1" step="0.05" value={density} onChange={event => setDensity(event.target.value)}/></label>
        <NumberInput label="最小间距" ariaLabel="散布最小间距" value={Number(spacing)} displayUnit={scene.units.display} onCommit={value => setSpacing(String(value))}/>
        {domain.startsWith('edgeBand:') && <NumberInput label="边缘带宽" ariaLabel="散布边缘带宽" value={Number(width)} displayUnit={scene.units.display} onCommit={value => setWidth(String(value))}/>}
        <details className="outdoor-advanced"><summary>随机方案与候选格距</summary><label>随机方案<input aria-label="散布方案" value={seed} onChange={event => setSeed(event.target.value)}/></label><NumberInput label="候选格距" ariaLabel="散布候选格距" value={Number(cell)} displayUnit={scene.units.display} onCommit={value => setCell(String(value))}/></details>
        <small>先创建组，再选中组预览生成。完整结果与人工记录随工程保存；一次最多修改256个独立对象，几何和资源另行检查。</small>
      </>}
      {(tool === 'terrain' || tool === 'region') && <label className="composition-check"><input aria-label="区域阻挡移动" type="checkbox" checked={blocking} onChange={event => setBlocking(event.target.checked)}/>阻挡移动</label>}
      <label>内容可见性<select aria-label="室外内容可见性" value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="public">公开</option><option value="gm">仅主持人</option></select></label>
      {error && <p role="alert" className="asset-form-error">{error}</p>}<button className="primary asset-wide" onClick={run} disabled={disabled || !layerId}><Route size={14}/>预览室外修改</button>
    </fieldset>
    <details className="asset-details"><summary>室外对象 · {Object.keys(scene.terrainAreas).length} 地形 / {Object.keys(scene.paths).length} 道路</summary>{(['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'scatterGroups', 'regions'] as const).map(collection => Object.values(scene[collection]).length > 0 && <div className="outdoor-object-list" key={collection}><h3>{{ terrainAreas: '地形', terrainEdges: '来源边缘', terrainConnections: '高差连接', paths: '道路', scatterGroups: '散布', regions: '用途与危险区' }[collection]}</h3>{Object.values(scene[collection]).map(entity => <button className="secondary" key={entity.id} disabled={disabled} onClick={() => onSelect(entity.id)} title={entity.id}>{name(entity.id)}{entity.editLocked ? ' · 已锁' : ''}</button>)}</div>)}</details>
  </section>
}
