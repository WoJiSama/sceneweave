import PathStylesPanel from './PathStylesPanel'
import { visualBase } from '../../shared/visual/base'
import type { CompositionCommand } from '../../shared/model/appearance'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createEntityLabeler } from './entity-label'
import { NumberInput } from '../native-canvas/controls'
import { OceanCreateTools } from './OceanTools'
import type { SceneCommand } from '../../shared/commands/commands'
import OutdoorCoordinates from './OutdoorCoordinates'
import { outdoorPoints, pointText } from './outdoor-coordinates'
export { outdoorPoints, pointText } from './outdoor-coordinates'
import ConnectionRouteFields, { newConnectionRouteDraft, readConnectionRoute } from './ConnectionRouteFields'
import StaircaseFields from './StaircaseFields'
import { defaultStaircase } from '../../shared/stairs/contracts'
import { isCoolantPipeSection } from '../../shared/path-assembly/pipe-geometry'
import type { VisualBoundaryEditor } from './VisualPanel'
import { Mountain, PencilRuler, Sprout, Route } from 'lucide-react'
import type { OutdoorCommand } from '../../shared/commands/outdoor'
import type { PointMm, SceneDocument, SurfaceRef, TerrainConnection, VersionRef } from '../../shared/model/scene'
import { checkRoadRouteAdvice, suggestRoadRoute, type RoadRouteAdvice } from './road-route-advice'
import { excavationEndpoints, roadSketchShape, type RoadDrawingSettings, type RoadStrokeSettings } from '../native-canvas/road-sketch'
import { mountainRelief } from '../../shared/geometry/terrain-relief-edit'
import { createRouteSupportCheck } from '../../shared/geometry/geometry'
import { fitRoadWidth } from '../../shared/geometry/fit-road-width'
import { createTerrainInlayCommand } from '../../shared/terrain-inlay/create'
import type { RoadDoorStartInput } from './road-door-start'
import PathAssemblyPanel from './PathAssemblyPanel'
import { appliedStyle, PathStyleFields, styleDefaults, StyleSourceSelect, type StyleForm } from './PathStyleFields'
import type { PathAssemblyRecipe } from '../../shared/path-assembly/contracts'
import type { AutomaticRoadPlan } from '../../shared/geometry/automatic-road'
import type { AutomaticRoadSession, AutomaticRoadSettings } from './useAutomaticRoad'

export type OutdoorSketch = { kind: 'polygon' | 'polyline'; purpose: 'terrain' | 'region' | 'path' | 'bridge' | 'fence' | 'connection'; points: PointMm[]; cursor: PointMm | null; roadStroke?: true; drawnSupports?: SurfaceRef[]; automaticRoad?: AutomaticRoadSession; automaticPlan?: AutomaticRoadPlan }
export type OutdoorTask = OutdoorSketch['purpose'] | 'stairs' | 'scatter' | 'styles'
const taskLabels: Record<OutdoorTask, string> = { terrain: '地形与高程', region: '用途 / 危险区域', path: '道路', bridge: '桥梁', fence: '实体围栏', styles: '沿线样式', connection: '高差连接 / 坡道', stairs: '阶梯工具', scatter: '可控散布' }
const taskHints: Record<OutdoorTask, string> = { terrain: '绘制地形并设置真实高度', region: '标注区域用途与通行', path: '沿中心线铺设道路', bridge: '画桥面，沿两侧铺设构件', fence: '画栅栏，设置围合与开口', styles: '维护源节、尺寸和工程换版', connection: '连接不同高程的实际表面', stairs: '铺设、弯曲和局部覆盖完整阶梯', scatter: '按范围铺放素材并保留人工修改' }
export const surfaceValue = (ref: SurfaceRef) => `${ref.kind}:${ref.id}`
export function parseSurface(value: string): SurfaceRef {
  const index = value.indexOf(':'), kind = value.slice(0, index), id = value.slice(index + 1)
  if (!['floor', 'room', 'terrainArea'].includes(kind) || !id) throw new Error('请明确选择支撑表面。')
  return { kind: kind as SurfaceRef['kind'], id }
}
export function SurfaceSelect({ scene, floorId, value, onChange, label }: { scene: SceneDocument; floorId?: string; value: string; onChange: (value: string) => void; label: string }) {
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">明确选择表面</option>{Object.values(scene.floors).filter(floor => floorId === undefined || floor.id === floorId).map(floor => <option key={floor.id} value={`floor:${floor.id}`}>基础地面 · {name(floor.id)}</option>)}{Object.values(scene.terrainAreas).filter(area => floorId === undefined || area.floorId === floorId).map(area => <option key={area.id} value={`terrainArea:${area.id}`}>地形 · {name(area.id)}</option>)}{Object.values(scene.rooms).filter(room => floorId === undefined || room.floorId === floorId).map(room => <option key={room.id} value={`room:${room.id}`}>房间 · {name(room.id)}</option>)}</select></label>
}
export function SurfaceMultiSelect({ scene, floorId, values, onChange, label }: { scene: SceneDocument; floorId?: string; values: string[]; onChange: (values: string[]) => void; label: string }) {
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  return <label>{label}<select multiple aria-label={label} value={values} onChange={event => onChange([...event.target.selectedOptions].map(option => option.value))}>{Object.values(scene.floors).filter(floor => floorId === undefined || floor.id === floorId).map(floor => <option key={floor.id} value={`floor:${floor.id}`}>基础地面 · {name(floor.id)}</option>)}{Object.values(scene.terrainAreas).filter(area => floorId === undefined || area.floorId === floorId).map(area => <option key={area.id} value={`terrainArea:${area.id}`}>地形 · {name(area.id)}</option>)}{Object.values(scene.rooms).filter(room => floorId === undefined || room.floorId === floorId).map(room => <option key={room.id} value={`room:${room.id}`}>房间 · {name(room.id)}</option>)}</select></label>
}
export function MaterialSelect({ scene, value, onChange, label = '地形材质', kind }: { scene: SceneDocument; value: string; onChange: (value: string) => void; label?: string; kind?: 'terrain' | 'path' }) {
  const materials = Object.values(scene.materials).filter(material => !kind || material.applicableSurfaces.includes(kind))
  return <label>{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">无铺装</option>{materials.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
}
const fresh = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

type Props = {
  scene: SceneDocument; layerId: string; disabled: boolean; sketch: OutdoorSketch | null
  onSketch: (sketch: OutdoorSketch | null) => void
  onPreview: (commands: SceneCommand[], description: string, selectedId?: string) => void
  onStylePreview?: (commands: CompositionCommand[], description: string) => void
  onOceanPreview?: (commands: SceneCommand[], description: string) => void
  onSelect: (id: string) => void
  onBoundaryEditor?: (editor: VisualBoundaryEditor | null) => void
  onFinishReady?: (finish: (() => void) | null) => void
  onRoadSettings?: (settings: RoadDrawingSettings | null) => void
  onRoadStrokeSettings?: (settings: RoadStrokeSettings | null) => void
  roadStart?: RoadDoorStartInput | null
  onRoadStartConsumed?: (id: string) => void
  onAutomaticRoad?: (settings: AutomaticRoadSettings) => void
  detailsTarget?: HTMLElement | null; detailsActive?: boolean
  activeTask?: OutdoorTask; onTaskChange?: (task: OutdoorTask) => void
  onBrowseScene?: () => void
}
export default function OutdoorToolsPanel({ scene, layerId, disabled, sketch, onSketch, onPreview, onSelect, onBoundaryEditor, onFinishReady, onRoadSettings, onRoadStrokeSettings,
  roadStart, onRoadStartConsumed, onAutomaticRoad, detailsTarget, detailsActive = true, activeTask, onTaskChange, onBrowseScene, onOceanPreview, onStylePreview }: Props) {
  const split = detailsTarget !== undefined
  const [localTool, setLocalTool] = useState<OutdoorTask>('terrain'), [error, setError] = useState<string | null>(null)
  const tool = activeTask ?? localTool
  const assemblyTool = tool === 'bridge' || tool === 'fence'
  const connectionTool = tool === 'connection' || tool === 'stairs'
  const sketchPurpose = tool === 'stairs' ? 'connection' : tool
  const chooseTask = (next: OutdoorTask) => {
    if (onTaskChange) onTaskChange(next)
    else { setLocalTool(next); setError(null); onSketch(null) }
  }
  const [points, setPoints] = useState('2000, 2000\n12000, 2000\n12000, 10000\n2000, 10000')
  const [material, setMaterial] = useState(Object.values(scene.materials).find(item => item.applicableSurfaces.includes('terrain'))?.id ?? ''), [elevation, setElevation] = useState('0'), [priority, setPriority] = useState('0')
  const [roadMaterialId, setRoadMaterialId] = useState(Object.values(scene.materials).find(item => item.applicableSurfaces.includes('path'))?.id ?? '')
  const [visibility, setVisibility] = useState<'public' | 'gm'>('public'), [blocking, setBlocking] = useState(false), [regionKind, setRegionKind] = useState<'terrain' | 'hazard' | 'partition'>('terrain')
  const [partitionName, setPartitionName] = useState('')
  const [staircase, setStaircase] = useState(defaultStaircase)
  const [connectionRoute, setConnectionRoute] = useState(newConnectionRouteDraft)
  const floorId = scene.userLayers[layerId]?.floorId ?? (Object.keys(scene.floors).length === 1 ? Object.keys(scene.floors)[0] : '')
  const [width, setWidth] = useState('2000'), [support, setSupport] = useState(`floor:${floorId}`), [toSupport, setToSupport] = useState(''), [connectionKind, setConnectionKind] = useState<'stairs' | 'ramp'>('stairs'), [openingId, setOpeningId] = useState('')
  const [roadSupports, setRoadSupports] = useState<string[] | null>(null)
  const [smoothRoad, setSmoothRoad] = useState(false)
  const [excavateRoad, setExcavateRoad] = useState(false)
  const [roadSteps, setRoadSteps] = useState(false)
  const [automaticRoadSupport, setAutomaticRoadSupport] = useState(true)
  const [automaticRoadWidth, setAutomaticRoadWidth] = useState(true)
  const [roadEdgeStyle, setRoadEdgeStyle] = useState<StyleForm>({ source: 'none', defaults: { lengthMm: 2000 } })
  const [roadEdgeSide, setRoadEdgeSide] = useState<PathAssemblyRecipe['sides']>('both')
  const [roadShoulder, setRoadShoulder] = useState(460)
  const consumedRoadStarts = useRef(new Set<string>())
  useLayoutEffect(() => {
    if (!roadStart || consumedRoadStarts.current.has(roadStart.id)) return
    consumedRoadStarts.current.add(roadStart.id)
    if (roadStart.document !== scene || roadStart.start.floorId !== floorId) {
      setError('门口接路所依据的工程或楼层已改变，请重新从当前门口开始。')
      onRoadStartConsumed?.(roadStart.id)
      return
    }
    setLocalTool('path')
    setWidth(String(roadStart.start.widthMm))
    setAutomaticRoadWidth(false)
    setRoadSupports(roadStart.start.supportRefs.map(surfaceValue))
    setSmoothRoad(false)
    setExcavateRoad(false)
    setVisibility(roadStart.start.visibility)
    setPoints(pointText([roadStart.start.point]))
    setError(null)
    onRoadStartConsumed?.(roadStart.id)
  }, [roadStart, scene, floorId, onRoadStartConsumed])
  const roadSettings = useMemo<RoadDrawingSettings | null>(() => {
    if (tool !== 'path' || !Number.isSafeInteger(Number(width)) || Number(width) <= 0) return null
    try { return { floorId, widthMm: Number(width), supportRefs: (roadSupports ?? [support]).map(parseSurface), visibility, fitWidth: automaticRoadWidth && !excavateRoad } }
    catch { return null }
  }, [tool, floorId, width, roadSupports, support, visibility, automaticRoadWidth, excavateRoad])
  useLayoutEffect(() => { onRoadSettings?.(roadSettings) }, [onRoadSettings, roadSettings])
  useLayoutEffect(() => () => onRoadSettings?.(null), [onRoadSettings])
  const roadStrokeSettings = useMemo<RoadStrokeSettings | null>(() => sketch?.roadStroke && tool === 'path'
    ? { automaticSupport: automaticRoadSupport, smooth: smoothRoad, excavate: excavateRoad } : null,
  [sketch?.roadStroke, tool, automaticRoadSupport, smoothRoad, excavateRoad])
  useLayoutEffect(() => { onRoadStrokeSettings?.(roadStrokeSettings) }, [onRoadStrokeSettings, roadStrokeSettings])
  useLayoutEffect(() => () => onRoadStrokeSettings?.(null), [onRoadStrokeSettings])
  const [peakMm, setPeakMm] = useState(0)
  const [roadReview, setRoadReview] = useState<{ document: SceneDocument; settings: RoadDrawingSettings; points: string; mode: 'check' | 'suggest'; advice: RoadRouteAdvice } | null>(null)
  const currentRoadReview = tool === 'path' && roadReview?.document === scene && roadReview.settings === roadSettings && roadReview.points === points ? roadReview : null
  const name = useMemo(() => createEntityLabeler(scene), [scene])
  const domains = [...Object.values(scene.terrainAreas).filter(area => area.floorId === floorId).map(area => ({ value: `area:${area.id}`, name: `地形 · ${name(area.id)}` })), ...Object.values(scene.paths).filter(path => path.floorId === floorId).map(path => ({ value: `path:${path.id}`, name: name(path.id) })), ...Object.values(scene.terrainEdges).filter(edge => edge.floorId === floorId).map(edge => ({ value: `edgeBand:${edge.id}`, name: name(edge.id) }))]
  const [domain, setDomain] = useState(''), [definition, setDefinition] = useState(''), [density, setDensity] = useState('0.4'), [cell, setCell] = useState('2500'), [spacing, setSpacing] = useState('300'), [seed, setSeed] = useState('camp-1')
  useEffect(() => {
    if (!sketch || sketch.automaticRoad || sketch.purpose === 'bridge' || sketch.purpose === 'fence') return
    setLocalTool(previous => previous === 'stairs' && sketch.purpose === 'connection' ? previous : sketch.purpose)
    setPoints(pointText(sketch.points))
    if (sketch.drawnSupports && !excavateRoad) setRoadSupports(sketch.drawnSupports.map(surfaceValue))
  }, [sketch?.purpose, sketch?.points, sketch?.drawnSupports, sketch?.automaticRoad, excavateRoad])
  const materialRef = (id: string): VersionRef | undefined => scene.materials[id] ? { id, version: scene.materials[id].version } : undefined
  const run = () => {
    if (assemblyTool || tool === 'styles') return
    try {
      setError(null)
      if ((tool === 'path' || connectionTool) && Number(width) <= 0) throw new Error('通路净宽须大于 0，请调整后重新预览。')
      const common = { floorId, layerId, visibility }
      let command: OutdoorCommand
      if (tool === 'terrain') {
        const finish = materialRef(material)
        const boundaryMm = outdoorPoints(points)
        command = { type: 'createTerrainArea', id: fresh('terrain'), ...common, boundaryMm,
          groundElevationMm: Number(elevation), coveragePriority: Number(priority), blocksMovement: blocking, ...(finish ? { materialRef: finish } : {}),
          ...(peakMm ? { relief: mountainRelief(boundaryMm, peakMm) } : {}) }
      } else if (tool === 'region') {
        if (regionKind === 'partition' && !partitionName.trim()) throw new Error('请为编辑分区命名。')
        command = { type: 'createRegion', id: fresh('region'), ...common, boundaryMm: outdoorPoints(points), kind: regionKind,
          ...(regionKind === 'partition' ? { name: partitionName.trim() } : { blocksMovement: blocking }), movementCostMultiplier: 1 }
      }
      else if (tool === 'path') {
        if (!roadSettings) throw new Error('请先设置道路净宽与支撑面。')
        const controls = sketch?.purpose === 'path' ? sketch.points : outdoorPoints(points, 2)
        const { centerlineMm, route } = roadSketchShape(controls, { smooth: smoothRoad, excavate: excavateRoad })
        if (excavateRoad && route) {
          const id = fresh('mountain-road')
          const { from, to } = excavationEndpoints(scene, roadSettings, centerlineMm, automaticRoadSupport)
          const source: TerrainConnection = {
            id, floorId, visibility, editLocked: false, kind: 'ramp', from, to, widthMm: roadSettings.widthMm,
            openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null,
            route: { ...route, segments: route.segments.map((segment, index) => ({ ...segment, id: `${id}-segment-${index}` })) },
          }
          const { editLocked: _editLocked, ...fields } = source
          const create: SceneCommand = { ...fields, type: 'createTerrainConnection', layerId }
          const draft = { ...scene, terrainConnections: { ...scene.terrainConnections, [id]: source } }
          const cut = createTerrainInlayCommand(draft, id)
          const commands: SceneCommand[] = [create, { ...cut, appearance: 'source-ground', finish: { kind: 'slope' } }]
          if (roadSteps) commands.push({ type: 'updateTerrainConnection', id, changes: { staircase } })
          const description = !roadSteps ? '沿绘制路线开凿山路' : staircase.range ? '开凿山路并局部铺阶' : '开凿山路并沿整条路线铺阶'
          onPreview(commands, description, id)
          return
        }
        const roadMaterial = materialRef(roadMaterialId), supportRefs = roadSettings.supportRefs
        const fitted = roadSettings.fitWidth ? fitRoadWidth(centerlineMm, roadSettings.widthMm, createRouteSupportCheck(scene, floorId, supportRefs).band) : null
        if (roadSettings.fitWidth && !fitted) throw new Error('这段道路在可用净宽内仍超出承托范围。请在画布检查冲突位置。')
        command = { type: 'createPath', id: fresh('path'), ...common, centerlineMm, widthMm: roadSettings.widthMm, supportRefs: [...supportRefs],
          ...(fitted?.sections.length ? { widthSections: fitted.sections } : {}), ...(roadSteps ? { staircase } : {}), ...(roadMaterial ? { materialRef: roadMaterial } : {}) }
        if (roadEdgeStyle.source !== 'none' || roadEdgeStyle.defaults.lamps) {
          const recipe = { ...appliedStyle(scene, roadEdgeStyle), sides: roadEdgeSide, shoulderMm: roadShoulder, endClearanceMm: 200 }
          onPreview([command, { type: 'setPathAssembly', id: command.id, floorId, layerId, centerlineMm, widthMm: command.widthMm, recipe }], '铺设道路与沿边构件', command.id)
          return
        }
      }
      else if (connectionTool) {
        const { points: ends, route } = readConnectionRoute(points, connectionRoute)
        command = { type: 'createTerrainConnection', id: fresh('connection'), ...common, kind: tool === 'stairs' ? 'stairs' : connectionKind, ...(tool === 'stairs' ? { staircase } : {}), from: { surfaceRef: parseSurface(support), positionMm: ends[0] }, to: { surfaceRef: parseSurface(toSupport), positionMm: ends.at(-1)! }, widthMm: Number(width), openingId: openingId || null, ...(route ? { route } : {}) }
      } else {
        const index = domain.indexOf(':'), kind = domain.slice(0, index), id = domain.slice(index + 1), item = scene.propDefinitions[definition]
        if (!item || !id) throw new Error('请明确选择散布域和固定物件素材。')
        const scatterDomain = kind === 'area' ? { kind: 'area' as const, areaId: id } : kind === 'path' ? { kind: 'path' as const, pathId: id } : { kind: 'edgeBand' as const, edgeId: id, widthMm: Number(width) }
        command = { type: 'createScatter', id: fresh('scatter'), ...common, domain: scatterDomain, palette: [{ key: 'chosen', propDefinitionRef: { id: definition, version: item.version }, weight: 1 }], seed, cellSizeMm: Number(cell), densityFactor: Number(density), minDistanceMm: Number(spacing), rotationRangeDeg: { min: 0, max: 359.999 } }
      }
      onPreview([command], { terrain: '新建地形', region: regionKind === 'partition' ? '新建编辑分区' : '新建用途或危险区域', path: '铺设道路', connection: '创建高差连接', stairs: '创建独立阶梯', scatter: '创建散布组' }[tool],
        command.type === 'createRegion' && command.kind === 'partition' ? command.id : undefined)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const reviewRoad = (mode: 'check' | 'suggest') => {
    try {
      setError(null)
      if (!roadSettings?.supportRefs.length) throw new Error('请先明确选择道路支撑表面和正整数净宽。')
      const request = { ...roadSettings, pointsMm: roadSketchShape(outdoorPoints(points, 2), { smooth: smoothRoad, excavate: false }).centerlineMm, maxNodes: 512 }
      const advice = mode === 'check' ? checkRoadRouteAdvice(scene, request) : suggestRoadRoute(scene, request)
      setRoadReview({ document: scene, settings: roadSettings, points, mode, advice })
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const useRoadAdvice = () => {
    if (!currentRoadReview?.advice.ok) return
    const advice = currentRoadReview.advice
    setPoints(pointText(advice.pointsMm))
    setSmoothRoad(false)
    if (advice.supportChanged) setRoadSupports(advice.supportRefs.map(surfaceValue))
    if (sketch?.purpose === 'path') onSketch({ ...sketch, points: advice.pointsMm.map(point => ({ ...point })), cursor: null })
    setRoadReview(null)
  }
  const minimum = tool === 'path' || connectionTool ? 2 : 3
  const finishReady = !disabled && !!layerId && !sketch?.automaticRoad && sketch?.purpose === sketchPurpose && sketch.points.length >= minimum
  const finishRef = useRef<(() => void) | null>(null), finishListener = useRef(onFinishReady)
  useLayoutEffect(() => { finishRef.current = finishReady ? run : null; finishListener.current = onFinishReady })
  const finish = useCallback(() => finishRef.current?.(), [])
  useLayoutEffect(() => {
    if (assemblyTool || tool === 'styles') return
    onFinishReady?.(finishReady ? finish : null)
    return () => finishListener.current?.(null)
  }, [tool, assemblyTool, finishReady, finish, onFinishReady])
  const [fenceId, setFenceId] = useState('')
  const fences = Object.values(visualBase(scene)?.boundaries ?? {}).filter(boundary => boundary.floorId === floorId && boundary.fence)
  const fence = fences.find(boundary => boundary.id === fenceId)
  const parameters = <section className="outdoor-panel workspace-tool-parameters" aria-label={split ? `${taskLabels[tool]}参数` : '室外制作工具'} hidden={split && !detailsActive} inert={split && !detailsActive}>
    <div className="asset-section-heading"><Mountain size={17}/><h2>{split ? taskLabels[tool] : '室外制作'}</h2></div>
    {split && <p className="asset-muted">目标图层 · {scene.userLayers[layerId]?.name ?? '未选择'}。预览后确认采用。</p>}
    {tool === 'terrain' && onOceanPreview && <OceanCreateTools scene={scene} layerId={layerId} disabled={disabled} onPreview={onOceanPreview}/>}
    <fieldset disabled={disabled || !!sketch?.automaticRoad}>
      {!split && <label>制作工具<select aria-label="室外制作工具" value={tool} onChange={event => chooseTask(event.target.value as OutdoorTask)}>{Object.entries(taskLabels).filter(([value]) => value !== 'styles' || onStylePreview).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {tool === 'styles' && onStylePreview ? <PathStylesPanel key={scene.revision} scene={scene} disabled={disabled} onPublish={onStylePreview} onReplace={onPreview}/>
        : assemblyTool ? <>
          {tool === 'fence' && <p className="asset-muted">可沿绘制路线铺设围栏、冷却管或其他已保存的沿线样式。</p>}
          {tool === 'fence' && fences.length > 0 && <label>实体围栏<select aria-label="实体围栏" value={fence?.id ?? ''} onChange={event => { onSketch(null); setFenceId(event.target.value) }}>
            <option value="">绘制新围栏或管线</option>{fences.map((entry, index) => {
              const section = entry.fence!.recipe.section
              const pipe = section.kind === 'profile' && section.profile === 'coolantPipe'
                || section.kind === 'prefab' && isCoolantPipeSection(scene.prefabDefinitions[section.ref.id]?.members ?? [])
              const name = entry.fence!.platformBinding ? '平台护栏' : pipe ? '管线' : '围栏'
              return <option key={entry.id} value={entry.id}>{name} {index + 1} · {entry.closed ? '闭合' : '开放'} · {scene.userLayers[entry.layerId].name}</option>
            })}
          </select></label>}
          <PathAssemblyPanel key={`${tool}-${fence?.id ?? ''}-${scene.revision}`} scene={scene} layerId={(tool === 'fence' && fence?.layerId) || layerId}
            mode={tool === 'fence' ? 'fence' : undefined} fence={tool === 'fence' ? fence : undefined}
            disabled={disabled || tool === 'fence' && !!(fence?.editLocked || fence && scene.userLayers[fence.layerId]?.editLocked)}
            onPreview={onPreview} onSelect={onSelect} canvas={{ sketch, setSketch: onSketch, onFinishReady }}/>
        </> : <>
      {tool === 'terrain' && <div className="workspace-form-pair">
        <MaterialSelect scene={scene} value={material} onChange={setMaterial} kind="terrain"/>
        <NumberInput label="地面高程" ariaLabel="地形高程" value={Number(elevation)} displayUnit={scene.units.display} onCommit={value => setElevation(String(value))}/>
        <NumberInput label="山丘高度（零为平地）" value={peakMm} displayUnit={scene.units.display} onCommit={setPeakMm}/>
      </div>}
      {tool === 'region' && <><label>区域用途<select aria-label="区域用途" value={regionKind} onChange={event => setRegionKind(event.target.value as typeof regionKind)}><option value="terrain">用途区域</option><option value="hazard">危险区域</option><option value="partition">编辑分区</option></select></label>
        {regionKind === 'partition' && <label>分区名称<input aria-label="分区名称" maxLength={80} value={partitionName} onChange={event => setPartitionName(event.target.value)}/></label>}
      </>}
      {(tool === 'path' || connectionTool) && <>
        <NumberInput label="通路净宽" ariaLabel="室外通路净宽" value={Number(width)} displayUnit={scene.units.display} onCommit={value => {
          setWidth(String(value)); if (tool === 'path') setAutomaticRoadWidth(false)
        }}/>
        {connectionTool ? <SurfaceSelect scene={scene} floorId={floorId} value={support} onChange={setSupport} label="连接起点表面"/>
          : <SurfaceMultiSelect scene={scene} floorId={floorId} values={roadSupports ?? [support]} onChange={setRoadSupports} label="道路支撑表面"/>}
        {tool === 'path' ? !excavateRoad && <MaterialSelect scene={scene} value={roadMaterialId} onChange={setRoadMaterialId} label="道路材质" kind="path"/> : <>
          <SurfaceSelect scene={scene} floorId={floorId} value={toSupport} onChange={setToSupport} label="连接终点表面"/>
          {tool !== 'stairs' && <label>连接类型<select aria-label="高差连接类型" value={connectionKind} onChange={event => setConnectionKind(event.target.value as typeof connectionKind)}><option value="stairs">台阶</option><option value="ramp">坡道</option></select></label>}
        </>}
        <small>明确选择实际支撑面；道路图片和材质不改变高差或通行。</small>
      </>}
      {tool === 'stairs' && <StaircaseFields value={staircase} onChange={setStaircase} centerlineMm={(() => { try { const route = readConnectionRoute(points, connectionRoute); return route.route?.centerlineMm ?? route.points } catch { return undefined } })()} widthMm={Number(width)}/>}
      {tool === 'scatter' && <>
        <div className="asset-section-heading"><Sprout size={15}/><h3>保留人工布景</h3></div>
        <label>散布域<select aria-label="散布域" value={domain} onChange={event => setDomain(event.target.value)}><option value="">选择地形、道路或边缘</option>{domains.map(item => <option key={item.value} value={item.value}>{item.name}</option>)}</select></label>
        <label>散布素材<select aria-label="散布素材" value={definition} onChange={event => setDefinition(event.target.value)}><option value="">选择固定素材</option>{Object.values(scene.propDefinitions).filter(item => !item.tags.includes('sceneweave:retained-appearance')).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>密度 0–1<input aria-label="散布密度" type="number" min="0" max="1" step="0.05" value={density} onChange={event => setDensity(event.target.value)}/></label>
        <NumberInput label="最小间距" ariaLabel="散布最小间距" value={Number(spacing)} displayUnit={scene.units.display} onCommit={value => setSpacing(String(value))}/>
        {domain.startsWith('edgeBand:') && <NumberInput label="边缘带宽" ariaLabel="散布边缘带宽" value={Number(width)} displayUnit={scene.units.display} onCommit={value => setWidth(String(value))}/>}
        <small>先创建组，再选中组预览生成。完整结果与人工记录随工程保存；一次最多修改256个独立对象，几何和资源另行检查。</small>
      </>}
      {tool === 'path' && <>
        {scene.mapMode === 'scene' && onAutomaticRoad && <div className="workspace-form-actions">
          <button type="button" className="secondary asset-wide" disabled={!!sketch || !Number.isSafeInteger(Number(width)) || Number(width) <= 0} onClick={() => onAutomaticRoad({ floorId, widthMm: Number(width), visibility, ...(excavateRoad ? {} : { materialRef: materialRef(roadMaterialId) }) })}><Route size={15}/>在画布自动选路</button>
          <small>点选起终点，按实际坡度生成路线与土阶。拖动转弯可以固定途经点。</small>
        </div>}
        <label className="composition-check"><input type="checkbox" checked={automaticRoadSupport} onChange={event => setAutomaticRoadSupport(event.target.checked)}/>拖画时按起点选择支撑面</label>
        {!excavateRoad && <label className="composition-check"><input type="checkbox" checked={automaticRoadWidth} onChange={event => setAutomaticRoadWidth(event.target.checked)}/>遇到窄地形时允许收窄默认宽度</label>}
        <label className="composition-check"><input type="checkbox" checked={smoothRoad} onChange={event => { setSmoothRoad(event.target.checked); setRoadReview(null) }}/>自动圆滑道路</label>
        {scene.mapMode === 'scene' && <label className="composition-check"><input type="checkbox" checked={excavateRoad} onChange={event => { setExcavateRoad(event.target.checked); setRoadReview(null) }}/>开凿山路</label>}
        {excavateRoad && <p className="asset-muted">从一个地形平台画到另一个高程的平台。预览同一条路线的路面、补岩与切口。</p>}
        <label className="composition-check"><input type="checkbox" checked={roadSteps} onChange={event => setRoadSteps(event.target.checked)}/>铺设台阶</label>
        {roadSteps && <StaircaseFields value={staircase} onChange={setStaircase} centerlineMm={(() => {
          try { return roadSketchShape(outdoorPoints(points, 2), { smooth: smoothRoad, excavate: excavateRoad }).centerlineMm } catch { return undefined }
        })()} widthMm={Number(width)}/>}
        {!excavateRoad && <details className="outdoor-advanced"><summary>道路沿边构件</summary>
          <StyleSourceSelect scene={scene} value={roadEdgeStyle.source} allowEmpty onChange={source => setRoadEdgeStyle({ source, defaults: styleDefaults(scene, source) })}/>
          <PathStyleFields scene={scene} form={roadEdgeStyle} onChange={setRoadEdgeStyle}/>
          <label>铺设侧<select aria-label="铺设侧" value={roadEdgeSide} onChange={event => setRoadEdgeSide(event.target.value as PathAssemblyRecipe['sides'])}>
            <option value="both">双侧镜像</option><option value="left">路线左侧</option><option value="right">路线右侧</option>
          </select></label>
          <NumberInput label="单侧边带宽" value={roadShoulder} displayUnit={scene.units.display} onCommit={setRoadShoulder}/>
        </details>}
        <p className="asset-muted">默认吸附合法门前、道路端点与中心线；按住 Shift 临时自由取点，松开恢复。门前吸附首版仅支持公开、已打开且未上锁的正交外门。</p>
        {!excavateRoad && <details className="outdoor-advanced"><summary>道路通行与绕行建议</summary>
          <small>检查真实完整带宽、方端帽、转角、墙门与旋转物件占地。绕行保留全部原始经由点，最多共512个搜索节点、128个点；有限搜索失败不表示没有其他路线。检查和建议均不提交工程，也不阻止普通合法草稿。</small>
          <div className="workspace-form-actions">
            <button type="button" className="secondary" onClick={() => reviewRoad('check')}>检查完整带宽通行</button>
            <button type="button" className="secondary" onClick={() => reviewRoad('suggest')}>寻找有限绕行建议</button>
          </div>
          {currentRoadReview && <div role="status" className="asset-muted">
            {currentRoadReview.advice.ok ? <>
              <p>{currentRoadReview.mode === 'check' ? '当前路线完整带宽可通行。' : '已找到保留全部经由点的有限路线建议。'}长度 {(currentRoadReview.advice.lengthMm / (scene.units.display === 'ft' ? 304.8 : 1000)).toFixed(2)} {scene.units.display}；展开 {currentRoadReview.advice.expandedNodes} 个节点。</p>
              <p>当前支撑：{roadSettings?.supportRefs.map(ref => name(ref.id)).join('、') || '未选择'}。实际需要：{currentRoadReview.advice.supportRefs.map(ref => name(ref.id)).join('、') || '无'}。{currentRoadReview.advice.supportChanged ? '支撑有变化，使用前请确认；尚未改动草稿或工程。' : '支撑保持。'}</p>
              {(currentRoadReview.mode === 'suggest' || currentRoadReview.advice.supportChanged) && <button type="button" className="secondary asset-wide" onClick={useRoadAdvice}>{currentRoadReview.advice.supportChanged ? '使用建议路线并改用所列支撑' : '使用建议路线'}</button>}
            </> : <><p>本次完整带宽检查或有限搜索未通过，原草稿保持。</p>{currentRoadReview.advice.issues.map((issue, index) => <p key={`${issue.code}:${issue.entityId ?? ''}:${index}`}>{issue.message}{issue.entityId ? `（${name(issue.entityId)}）` : ''}</p>)}</>}
          </div>}
        </details>}
      </>}
      <div className={tool === 'terrain' || tool === 'region' ? 'workspace-form-pair' : undefined}>
      <label>内容可见性<select aria-label="室外内容可见性" value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="public">公开</option><option value="gm">仅主持人</option></select></label>
      {(tool === 'terrain' || tool === 'region' && regionKind !== 'partition') && <label className="composition-check"><input aria-label="区域阻挡移动" type="checkbox" checked={blocking} onChange={event => setBlocking(event.target.checked)}/>阻挡移动</label>}
      </div>
      {error && <p role="alert" className="asset-form-error">{error}</p>}
      <div className="workspace-form-actions">
      {tool === 'path' && <button type="button" className="secondary asset-wide" onClick={() => onSketch(sketch?.roadStroke ? null : { kind: 'polyline', purpose: 'path', roadStroke: true, points: [], cursor: null })}><PencilRuler size={14}/>{sketch?.roadStroke ? '结束拖画道路' : '在画布拖画道路'}</button>}
      {tool !== 'scatter' && <>
        <button className="secondary asset-wide" onClick={() => onSketch(sketch?.purpose === sketchPurpose ? null : { kind: tool === 'path' || connectionTool ? 'polyline' : 'polygon', purpose: sketchPurpose as OutdoorSketch['purpose'], points: [], cursor: null })}><PencilRuler size={14}/>{sketch?.purpose === sketchPurpose ? '结束画布取点' : '在画布逐点绘制'}</button>
      </>}
      <button className="primary asset-wide" onClick={run} disabled={disabled || !layerId}><Route size={14}/>预览室外修改</button>
      </div>
      {tool !== 'scatter' && <>
        <OutdoorCoordinates text={points} onChange={value => { setPoints(value); onSketch(null) }} label={tool === 'path' ? '道路中心线' : connectionTool ? '连接路线节点' : '区域轮廓'} ariaLabel="室外坐标" minimum={minimum} unit={scene.units.display}/>
      </>}
      {tool === 'terrain' && <details className="outdoor-advanced"><summary>重叠地形的显示顺序</summary><label>覆盖优先级<input aria-label="地形覆盖优先级" type="number" step="1" value={priority} onChange={event => setPriority(event.target.value)}/></label><small>高程决定实际高度，优先级决定重叠时的覆盖顺序；同优先级地形不能重叠。</small></details>}
      {connectionTool && <details className="outdoor-advanced"><summary>{tool === 'stairs' ? '阶梯弯曲路线' : '路线形态与踏面'}</summary><ConnectionRouteFields appearanceControls={tool !== 'stairs'} enabled={scene.mapMode === 'scene'} text={points} draft={connectionRoute} onChange={setConnectionRoute} floorId={floorId} layerId={layerId} visibility={visibility} onBoundaryEditor={onBoundaryEditor}/></details>}
      {connectionTool && <details className="outdoor-advanced"><summary>连接房间门窗</summary><label>房间端附着开口<select aria-label="连接附着开口" value={openingId} onChange={event => setOpeningId(event.target.value)}><option value="">无房间开口</option>{Object.values(scene.openings).filter(opening => opening.floorId === floorId).map(opening => <option key={opening.id} value={opening.id}>{name(opening.id)}</option>)}</select></label></details>}
      {tool === 'scatter' && <details className="outdoor-advanced"><summary>随机方案与候选格距</summary><label>随机方案<input aria-label="散布方案" value={seed} onChange={event => setSeed(event.target.value)}/></label><NumberInput label="候选格距" ariaLabel="散布候选格距" value={Number(cell)} displayUnit={scene.units.display} onCommit={value => setCell(String(value))}/></details>}
      </>}
    </fieldset>
    {!split && <details className="asset-details"><summary>室外对象 · {Object.values(scene.terrainAreas).filter(area => area.floorId === floorId).length} 地形 / {Object.values(scene.paths).filter(path => path.floorId === floorId).length} 道路</summary>{(['terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'scatterGroups', 'regions'] as const).map(collection => Object.values(scene[collection]).some(entity => entity.floorId === floorId) && <div className="outdoor-object-list" key={collection}><h3>{{ terrainAreas: '地形', terrainEdges: '来源边缘', terrainConnections: '高差连接', paths: '道路', scatterGroups: '散布', regions: '用途与危险区' }[collection]}</h3>{Object.values(scene[collection]).filter(entity => entity.floorId === floorId).map(entity => <button className="secondary" key={entity.id} disabled={disabled} onClick={() => onSelect(entity.id)} title={entity.id}>{name(entity.id)}{entity.editLocked ? ' · 已锁' : ''}</button>)}</div>)}</details>}
  </section>
  if (!split) return parameters
  return <section className="outdoor-panel workspace-tool-picker" aria-label="室外制作工具">
    <h3>绘制工具</h3>
    <div className="workspace-task-picker" role="group" aria-label="室外任务">
      {(['terrain', 'region', 'path', 'bridge', 'fence', 'styles', 'stairs', 'connection', 'scatter'] as const).filter(value => value !== 'styles' || onStylePreview).map(value => <button key={value} type="button" aria-pressed={detailsActive && tool === value} disabled={disabled} onClick={() => chooseTask(value)}><strong>{taskLabels[value]}</strong><small>{taskHints[value]}</small></button>)}
    </div>
    {onBrowseScene && <button type="button" className="secondary asset-wide" onClick={onBrowseScene}>查看已有地形与道路</button>}
    {detailsTarget && createPortal(parameters, detailsTarget)}
  </section>
}
