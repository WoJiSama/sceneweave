import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PencilRuler, Route } from 'lucide-react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { Path, SceneDocument } from '../../shared/model/scene'
import { bridgeDeckIds, type PathAssemblyCommand, type PathAssemblyRecipe } from '../../shared/path-assembly/contracts'
import { PATH_ENDS } from '../../shared/path-assembly/bridge-link-contracts'
import { DEFAULT_PLATFORM_FENCE_INSET_MM } from '../../shared/path-assembly/platform-fence-binding'
import { isCoolantPipeSection, isPipeBoundary } from '../../shared/path-assembly/pipe-geometry'
import { rootSurfaceElevation } from '../../shared/geometry/support-sample'
import { effectiveEditLocked } from '../../shared/commands/layers'
import type { RouteWidthSection } from '../../shared/geometry/route-width'
import { fenceRoutePoints } from '../../shared/path-assembly/fitted-layout'
import type { VisualBoundary } from '../../shared/visual/types'
import { appliedStyle, PathStyleFields, sectionOption, styleDefaults, StyleSourceSelect, type StyleForm } from './PathStyleFields'
import { NumberInput } from '../native-canvas/controls'
import OutdoorCoordinates from './OutdoorCoordinates'
import { outdoorPoints, pointText } from './outdoor-coordinates'
import { outdoorInspectorStyle } from './outdoor-inspector-style'
import PathLocalWidthFields, { readPathWidthSections } from './PathLocalWidthFields'
import PipeLinkControls from './PipeLinkControls'
import { createEntityLabeler } from './entity-label'
import type { OutdoorSketch } from './OutdoorToolsPanel'

interface Props {
  scene: SceneDocument
  layerId: string
  path?: Path
  fence?: VisualBoundary
  mode?: 'fence' | 'bridge-conversion'
  disabled: boolean
  onPreview: (commands: SceneCommand[], label: string, selectedId?: string) => void
  onSelect?: (id: string) => void
  canvas?: {
    sketch: OutdoorSketch | null
    setSketch: (sketch: OutdoorSketch | null) => void
    onFinishReady?: (finish: (() => void) | null) => void
  }
}

export default function PathAssemblyPanel({ scene, layerId, path, fence, mode, disabled, onPreview, onSelect, canvas }: Props) {
  const previous = path?.assembly ?? fence?.fence, priorRecipe = previous?.recipe
  const bridge = path?.assembly?.bridge, isFence = mode === 'fence', converting = mode === 'bridge-conversion'
  const isBridge = !isFence && (!path || !!bridge || converting)
  const editLocalWidth = !!path?.assembly && !isBridge && !Object.values(scene.pathAttachments ?? {}).some(row => row.pathId === path.id)
  const unit = scene.units.display
  const [pointsText, setPointsText] = useState(path ? pointText(path.centerlineMm) : fence ? pointText(fenceRoutePoints(fence)) : '')
  const [closed, setClosed] = useState(fence?.closed ?? false)
  const [width, setWidth] = useState(path?.widthMm ?? 2400)
  const [widthSections, setWidthSections] = useState<RouteWidthSection[]>(() => path?.widthSections ?? [])
  const [finish, setFinish] = useState(bridge?.finish ?? (converting ? 'timber' : 'steel'))
  const [roadMaterial, setRoadMaterial] = useState(path?.surfaceStyle?.base.materialRef.id ?? '')
  const [elevation, setElevation] = useState(bridge?.elevationMm ?? (converting && path?.supportRefs[0] ? rootSurfaceElevation(scene, path.supportRefs[0]) ?? 0 : 0))
  const [visibility, setVisibility] = useState(fence?.visibility ?? bridge?.visibility ?? path?.visibility ?? 'public')
  const [roadRange, setRoadRange] = useState({ startPpm: 250_000, endPpm: 750_000 })
  const [style, setStyle] = useState<StyleForm>(() => priorRecipe ? {
    source: sectionOption(priorRecipe.section), defaults: { lengthMm: 'lengthMm' in priorRecipe.section ? priorRecipe.section.lengthMm : 2000,
      dimensions: priorRecipe.dimensions, fit: priorRecipe.fit, lamps: priorRecipe.lamps, structure: path?.assembly?.recipe.structure },
  } : converting ? { source: 'timber', defaults: styleDefaults(scene, 'timber') }
    : isFence ? { source: 'profile:ironPickets', defaults: styleDefaults(scene, 'profile:ironPickets') }
    : isBridge ? { source: 'profile:boxGirder', defaults: { ...styleDefaults(scene, 'profile:boxGirder'), lamps: { every: 2 } } }
    : { source: 'steel', defaults: styleDefaults(scene, 'steel') })
  const [sides, setSides] = useState<PathAssemblyRecipe['sides']>(path?.assembly?.recipe.sides ?? 'both')
  const [shoulder, setShoulder] = useState(path?.assembly?.recipe.shoulderMm ?? (isBridge ? 720 : 460))
  const [endClearance, setEndClearance] = useState(priorRecipe?.endClearanceMm ?? (isFence ? 0 : 200))
  const [gaps, setGaps] = useState<NonNullable<PathAssemblyRecipe['gaps']>>(priorRecipe?.gaps ?? [])
  const priorBinding = fence?.fence?.platformBinding
  const [platformId, setPlatformId] = useState(priorBinding?.platformId ?? '')
  const [platformSegments, setPlatformSegments] = useState<string[] | undefined>(() =>
    priorBinding?.selection.kind === 'segments' ? [...priorBinding.selection.segmentIds] : undefined)
  const [insetMm, setInsetMm] = useState(priorBinding?.insetMm ?? DEFAULT_PLATFORM_FENCE_INSET_MM)
  const [error, setError] = useState('')
  const floorId = scene.userLayers[layerId]?.floorId
  const platforms = useMemo(() => {
    if (!isFence) return []
    const decks = bridgeDeckIds(scene)
    return Object.values(scene.terrainAreas).filter(area =>
      area.floorId === floorId && !area.waterSurface && !decks.has(area.id))
  }, [scene, floorId, isFence])
  const platform = platforms.find(area => area.id === platformId)
  const name = useMemo(() => isFence ? createEntityLabeler(scene) : (id: string) => id, [scene, isFence])
  const purpose = isFence ? 'fence' : 'bridge'
  const sketchPoints = canvas?.sketch?.purpose === purpose ? canvas.sketch.points : undefined
  const routeText = sketchPoints ? pointText(sketchPoints) : pointsText
  useLayoutEffect(() => { if (sketchPoints) setPointsText(pointText(sketchPoints)) }, [sketchPoints])

  const run = () => {
    try {
      setError('')
      if (!floorId) throw new Error('请选择目标图层。')
      const id = path?.id ?? fence?.id ?? (isFence ? 'fence-' : 'bridge-') + crypto.randomUUID()
      if (platform) {
        onPreview([{ type: 'setFenceAssembly', id, layerId, floorId, visibility,
          platformBinding: { version: 1, platformId: platform.id, insetMm, openingPolicy: 'structural',
            selection: platformSegments ? { kind: 'segments', segmentIds: platformSegments } : { kind: 'all' },
          },
          recipe: { ...appliedStyle(scene, style), fit: true, endClearanceMm: 0 },
        }], fence ? '更新平台护栏' : '安装平台护栏')
        return
      }
      const centerlineMm = converting && path ? path.centerlineMm : outdoorPoints(routeText, closed ? 3 : 2)
      const common = { ...appliedStyle(scene, style, isBridge), endClearanceMm: closed ? 0 : endClearance, ...(gaps.length ? { gaps } : {}) }
      if (isFence) {
        onPreview([{ type: 'setFenceAssembly', id, layerId, floorId, centerlineMm, closed, visibility, recipe: common }], fence ? '更新实体围栏' : '绘制实体围栏')
        return
      }
      const recipe: PathAssemblyRecipe = { ...common, sides, shoulderMm: shoulder }
      const command: PathAssemblyCommand = { type: 'setPathAssembly', id, layerId, floorId, centerlineMm, widthMm: width, recipe,
        ...(editLocalWidth && (widthSections.length || path.widthSections) ? { widthSections: readPathWidthSections(widthSections) } : {}) }
      const commands: SceneCommand[] = [command]
      if (isBridge) {
        command.bridge = { finish, elevationMm: elevation, visibility }
        if (converting) command.roadRange = roadRange
        if (!path && roadMaterial) commands.push({ type: 'updatePath', id,
          changes: { surfaceStyle: outdoorInspectorStyle(scene, roadMaterial, null, 'path') } })
      }
      onPreview(commands, converting ? '将道路选段改成桥并接续引道' : path ? isBridge ? '更新桥梁与构件' : '沿道路铺设构件' : '绘制桥梁', id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const finishRef = useRef(run)
  useLayoutEffect(() => { finishRef.current = run })
  const finishSketch = useCallback(() => finishRef.current(), [])
  const onFinishReady = canvas?.onFinishReady
  const canFinish = !disabled && !platform && !!sketchPoints && sketchPoints.length >= (closed ? 3 : 2)
  useLayoutEffect(() => {
    onFinishReady?.(canFinish ? finishSketch : null)
    return () => onFinishReady?.(null)
  }, [onFinishReady, canFinish, finishSketch])
  const setGap = (index: number, fields: Partial<NonNullable<PathAssemblyRecipe['gaps']>[number]>) => setGaps(current => current.map((gap, i) => index === i ? { ...gap, ...fields } : gap))
  const placedMembers = Object.entries(previous?.members ?? {}).flatMap(([key, member]) => member.state === 'placed' ? [{ key, id: member.propId }] : [])
  const removedCount = Object.keys(previous?.members ?? {}).length - placedMembers.length

  const previewRoadMaterial = () => {
    if (!path || roadMaterial === (path.surfaceStyle?.base.materialRef.id ?? '')) return
    try {
      setError('')
      const surfaceStyle = outdoorInspectorStyle(scene, roadMaterial, path.surfaceStyle, 'path')
      onPreview([{ type: 'updatePath', id: path.id, changes: { surfaceStyle } }], '更新桥上道路铺装', path.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const roadMaterialField = <label>桥上道路材质<select aria-label="桥上道路材质" value={roadMaterial} onChange={event => setRoadMaterial(event.target.value)}>
        <option value="">默认道路铺面</option>
        {Object.values(scene.materials).filter(material => material.applicableSurfaces.includes('path')).map(material => <option key={material.id} value={material.id}>{material.name}</option>)}
      </select></label>

  return <>{path && bridge && <fieldset disabled={disabled} aria-label="桥上道路铺装">
    {roadMaterialField}
    <button type="button" className="secondary asset-wide" onClick={previewRoadMaterial}
      disabled={roadMaterial === (path.surfaceStyle?.base.materialRef.id ?? '')}>预览更新道路铺装</button>
  </fieldset>}<fieldset disabled={disabled} aria-label={converting ? '道路转桥参数' : isFence ? '实体围栏参数' : isBridge ? '桥梁参数' : '沿线构件参数'}>
    {isFence && platforms.length > 0 && <label>护栏平台<select aria-label="护栏平台" value={platformId} onChange={event => {
      setPlatformId(event.target.value); setPlatformSegments(undefined); canvas?.setSketch(null)
    }}>
      {!priorBinding && <option value="">沿手绘路线</option>}
      {platforms.map(area => {
        const { x, y } = area.boundaryMm[0].positionMm
        return <option key={area.id} value={area.id} disabled={effectiveEditLocked(scene, area.id) || visibility === 'public' && area.visibility !== 'public'}>
          {name(area.id)} · {x / 1000}, {y / 1000} m
        </option>
      })}
    </select></label>}
    {platform && <>
      <label>护栏范围<select aria-label="护栏范围" value={platformSegments ? 'segments' : 'all'} onChange={event =>
        setPlatformSegments(event.target.value === 'segments' ? [] : undefined)}>
        <option value="all">完整轮廓</option><option value="segments">指定连续边段</option>
      </select></label>
      {platformSegments && <label>护栏边段<select multiple aria-label="护栏边段" value={platformSegments}
        onChange={event => setPlatformSegments([...event.target.selectedOptions].map(option => option.value))}>
        {platform.boundaryMm.map(({ segmentId, positionMm }, index) => <option key={segmentId} value={segmentId}>第 {index + 1} 段 · {positionMm.x}, {positionMm.y}</option>)}
      </select></label>}
      <NumberInput label="护栏向内距离" value={insetMm} displayUnit={unit} onCommit={setInsetMm}/>
      <small>护栏跟随平台轮廓，在桥头、台阶和坡道处为通行留口。</small>
    </>}
    {canvas && !platform && <button type="button" className="secondary asset-wide" onClick={() => canvas.setSketch(sketchPoints ? null : { kind: 'polyline', purpose, points: [], cursor: null })}>
      <PencilRuler size={14}/>{sketchPoints ? '结束取点' : isFence ? '在画布绘制围栏路线' : '在画布绘制桥梁路线'}
    </button>}
    {converting ? <div className="workspace-form-pair">
      <label>桥段起点（%）<input type="number" min="0" max="100" step="0.1" value={roadRange.startPpm / 10000} onChange={event => setRoadRange({ ...roadRange, startPpm: Math.round(Number(event.target.value) * 10000) })}/></label>
      <label>桥段终点（%）<input type="number" min="0" max="100" step="0.1" value={roadRange.endPpm / 10000} onChange={event => setRoadRange({ ...roadRange, endPpm: Math.round(Number(event.target.value) * 10000) })}/></label>
    </div> : !platform && <OutdoorCoordinates text={routeText} onChange={text => { setPointsText(text); if (sketchPoints) canvas?.setSketch(null) }}
      label={isFence ? '围栏路线' : isBridge ? '桥梁路线' : '装配路线'} ariaLabel="沿线构件坐标" minimum={closed ? 3 : 2} unit={unit}/>}
    {isFence && !platform && <label className="asset-check"><input type="checkbox" aria-label="闭合围栏" checked={closed} onChange={event => setClosed(event.target.checked)}/>闭合围栏 · 自动连接首尾</label>}
    {!isFence && <NumberInput label="通行净宽" ariaLabel="装配通行净宽" value={width} displayUnit={unit} onCommit={setWidth}/>}
    {editLocalWidth && <PathLocalWidthFields sections={widthSections} setSections={setWidthSections} widthMm={width} unit={unit}/>}
    {isBridge && <>
      <label>桥梁结构饰面<select aria-label="桥梁结构饰面" value={finish} onChange={event => setFinish(event.target.value as typeof finish)}>
        <option value="steel">钢构</option><option value="timber">木构</option>
      </select></label>
      {!path && roadMaterialField}
      <NumberInput label="桥面高程" value={elevation} displayUnit={unit} onCommit={setElevation}/>
      <small>路线两端接到与桥面等高的地面。遇到高差时可用阶梯或坡道接入。</small>
    </>}
    <StyleSourceSelect scene={scene} value={style.source} allowEmpty={!isFence} onChange={source => setStyle({ source, defaults: styleDefaults(scene, source) })}/>
    {(style.source === 'profile:coolantPipe' || style.source.startsWith('prefab:') && isCoolantPipeSection(scene.prefabDefinitions[style.source.slice(7)]?.members ?? []))
      && <small>接合铺设会在转角加装接头，在起终点和开口加装套筒。将路线端点对准设备接口即可对接。</small>}
    <PathStyleFields scene={scene} form={style} onChange={setStyle} allowStructure={isBridge} forceFit={!!platform}/>
    {!isFence && <label>铺设侧<select aria-label="铺设侧" value={sides} onChange={event => setSides(event.target.value as PathAssemblyRecipe['sides'])}>
      <option value="both">双侧镜像</option><option value="left">路线左侧</option><option value="right">路线右侧</option>
    </select></label>}
    {!platform && <details className="outdoor-advanced">
      <summary>{isFence ? '入口与端部留空' : '边带与入口留空'}</summary>
      {!isFence && <NumberInput label="单侧边带宽" value={shoulder} displayUnit={unit} onCommit={setShoulder}/>}
      {!closed && <NumberInput label="两端留空长度" value={endClearance} displayUnit={unit} onCommit={setEndClearance}/>}
      {gaps.map((gap, index) => <div key={index} className="outdoor-object-list">
        {!isFence && <label>开口侧<select aria-label={'开口侧 ' + (index + 1)} value={gap.side} onChange={event => setGap(index, { side: event.target.value as typeof gap.side })}>
          <option value="left">左侧</option><option value="right">右侧</option><option value="both">两侧</option>
        </select></label>}
        <NumberInput label="开始里程" ariaLabel={'开口开始里程 ' + (index + 1)} value={gap.fromMm} displayUnit={unit} onCommit={fromMm => setGap(index, { fromMm })}/>
        <NumberInput label="结束里程" ariaLabel={'开口结束里程 ' + (index + 1)} value={gap.toMm} displayUnit={unit} onCommit={toMm => setGap(index, { toMm })}/>
        <button type="button" className="secondary" onClick={() => setGaps(current => current.filter((_, i) => i !== index))}>移除开口</button>
      </div>)}
      <button type="button" className="secondary asset-wide" disabled={gaps.length >= 8} onClick={() => setGaps(current => [...current, { side: isFence ? 'both' : 'left', fromMm: 0, toMm: style.defaults.lengthMm }])}>添加沿线开口</button>
      <small>里程从第一个路线点起算。{(style.defaults.fit || isBridge && style.defaults.structure || style.source.startsWith('profile:')) ? '接合铺设按起止里程留口。' : '开口与整节相交时跳过该节。'}</small>
    </details>}
    {!converting && (isBridge || isFence) && <label>{isFence ? '围栏可见性' : '桥梁可见性'}<select aria-label={isFence ? '围栏可见性' : '桥梁可见性'} value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}>
      <option value="public">公开</option><option value="gm">仅主持人</option>
    </select></label>}
    {error && <p role="alert" className="asset-form-error">{error}</p>}
    <button type="button" className="primary asset-wide" onClick={run} disabled={!layerId || (platform ? platformSegments?.length === 0 : !routeText.trim()) || converting && roadRange.startPpm >= roadRange.endPpm}>
      <Route size={14}/>{platform ? '预览平台护栏' : converting ? '预览将选段改成桥' : isFence ? fence ? '预览更新实体围栏' : '预览实体围栏' : path ? '预览更新沿线构件' : '预览桥梁'}
    </button>
    {fence && priorBinding && <button type="button" className="secondary asset-wide" onClick={() => onPreview([{
      type: 'setFenceAssembly', id: fence.id, floorId: fence.floorId, layerId: fence.layerId, visibility: fence.visibility,
      centerlineMm: fenceRoutePoints(fence), closed: fence.closed, recipe: fence.fence!.recipe, platformBinding: null,
    }], '解除平台护栏绑定')}>预览解除平台绑定</button>}
    {path && bridge && <details className="outdoor-advanced">
      <summary>桥头链接</summary>
      <small>拖桥靠近道路端点建立链接。按住 Shift 可自由放置。</small>
      {PATH_ENDS.map(end => {
        const link = bridge.roadLinks?.[end], label = end === 'start' ? '起点' : '终点'
        return <div key={end} className="outdoor-object-list"><strong>{label}{link ? ' · 已链接' : ' · 空闲'}</strong>
          {link && <>{onSelect && <button type="button" className="secondary" onClick={() => onSelect(link.pathId)}>{label}相接道路</button>}
            <button type="button" className="secondary" onClick={() => onPreview([{ type: 'detachBridgeRoad', id: path.id, end }], `断开桥梁${label}链接`, path.id)}>预览断开{label}链接</button></>}
        </div>
      })}
    </details>}
    {fence && isPipeBoundary(scene, fence) && <details className="outdoor-advanced">
      <summary>管端链接</summary>
      <small>可拖设备的管口靠近空闲管端，也可在这里选择附近管口。</small>
      {PATH_ENDS.map(end => <PipeLinkControls key={end} scene={scene} fence={fence} end={end} onPreview={onPreview} onSelect={onSelect}/>)}
    </details>}
    {fence && <button type="button" className="secondary asset-wide" onClick={() => onPreview([{ type: 'removeFenceAssembly', id: fence.id }], '移除围栏线及排布构件，保留手工修改的构件')}>预览移除实体围栏</button>}
    {previous && <details className="outdoor-advanced">
      <summary>构件 {placedMembers.length} 件 · 保留 {removedCount} 处删除</summary>
      {onSelect && placedMembers.map(({ key, id }) => {
        const [side, leg, slot, role] = key.split(':')
        const segment = '路段 ' + (Number(leg) + 1)
        const part = role === 'pipeBend' ? segment + ' · 分流接头'
          : role === 'startSocket' || role === 'endSocket' ? segment + (role === 'startSocket' ? ' · 起点套筒' : ' · 终点套筒')
          : role === 'landingLamp' ? `${slot === '0' ? '起点' : '终点'}桥头灯`
          : role === 'corner' || role === 'cornerLamp' ? segment + (role === 'corner' ? ' · 转角件' : ' · 转角灯')
          : `${segment} · 第 ${Number(slot) + 1} ${role === 'support' ? '处支座' : role === 'supportLamp' ? '处支座灯' : role === 'lamp' ? '节 · 灯' : '节'}`
        const label = (isFence ? '' : (side === 'left' ? '左' : '右') + '侧 · ') + part
        return <button type="button" key={id} className="secondary asset-wide" onClick={() => onSelect(id)} aria-label={'选择构件 ' + label}>{label}</button>
      })}
    </details>}
  </fieldset></>
}
