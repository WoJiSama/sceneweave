import { useEffect, useMemo, useRef, useState } from 'react'
import type { Decoration, DecorationCluster, SceneDocument, SurfaceRef } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import type { DecorationCommand } from '../../shared/decorations/commands'
import { estimateSurfaceRegionInstances } from '../../shared/decorations/generate'
import { terrainPoints } from '../../shared/geometry/geometry'
import { TERRAIN_VARIANT_SPECS } from '../../platform/browser/content/terrain-variant-catalog'
import type { CanvasTerrainBrush } from '../native-canvas/AssetCanvas'
import { connectedTerrainAreaIds, surfaceRegionsFromStroke } from './canopy-brush'
import { effectiveEditLocked, effectiveLayerLocked } from '../../shared/commands/layers'
import EntityLockNotice from './EntityLockNotice'

type CreateCommand = Extract<DecorationCommand, { type: 'createDecorationCluster' }>
type Props = { scene: SceneDocument; layerId: string; disabled: boolean; onCreate: (command: CreateCommand) => void; onCanvasBrushChange: (brush: CanvasTerrainBrush | null) => void; onDraftChange: (dirty: boolean) => void; onPrepareSources: (definitionIds: string[]) => void; onPreview: (commands: SceneCommand[], label: string) => void; onSelect: (id: string) => void }
const parseSupport = (value: string): SurfaceRef => { const [kind, id] = value.split(':'); return { kind: kind as SurfaceRef['kind'], id } }
const supportOptions = (scene: SceneDocument, floorId: string) => [
  ...Object.values(scene.floors).filter(row => row.id === floorId).map(row => ({ value: `floor:${row.id}`, label: row.name })),
  ...Object.values(scene.terrainAreas).filter(row => row.floorId === floorId).map(row => ({ value: `terrainArea:${row.id}`, label: `地形 · ${row.id}` })),
  ...Object.values(scene.rooms).filter(row => row.floorId === floorId).map(row => ({ value: `room:${row.id}`, label: `房间 · ${row.id}` })),
]

export default function DecorationPanel({ scene, layerId, disabled, onCreate, onCanvasBrushChange, onDraftChange, onPrepareSources, onPreview, onSelect }: Props) {
  const floorId = scene.userLayers[layerId]?.floorId ?? Object.keys(scene.floors)[0], bounds = scene.floors[floorId].boundsMm
  const [support, setSupport] = useState(`floor:${floorId}`), [region, setRegion] = useState(`${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}`)
  const [seed, setSeed] = useState('clustered-dressing-0'), [count, setCount] = useState('16'), [spacing, setSpacing] = useState('650'), [radius, setRadius] = useState('2400'), [clearance, setClearance] = useState('600')
  const [palette, setPalette] = useState('mixed'), [visibility, setVisibility] = useState<'public' | 'gm'>('public'), [error, setError] = useState<string>()
  const treeDefinitions = Object.values(scene.propDefinitions).filter(row => row.defaultAppearance.kind === 'image' && (row.tags.some(tag => /tree|树/i.test(tag)) || /tree|树/i.test(row.name)))
  const canopyAreas = Object.values(scene.terrainAreas).filter(row => row.floorId === floorId)
  const [surfaceAreaId, setSurfaceAreaId] = useState(() => canopyAreas[0]?.id ?? '')
  const [surfaceField, setSurfaceField] = useState<'material' | 'trees' | 'shrubs' | 'grass'>('trees')
  const [surfaceMode, setSurfaceMode] = useState<'paint' | 'erase'>('paint'), [surfacePainting, setSurfacePainting] = useState(false)
  const [surfaceMaterialId, setSurfaceMaterialId] = useState(() => Object.keys(scene.materials)[0] ?? '')
  const [surfaceTreeId, setSurfaceTreeId] = useState(() => treeDefinitions[0]?.id ?? '')
  const [surfaceCoveragePpm, setSurfaceCoveragePpm] = useState(180_000), [surfaceRadiusMm, setSurfaceRadiusMm] = useState(700)
  const [surfaceSeed, setSurfaceSeed] = useState('surface-plants-0'), [surfaceClearanceMm, setSurfaceClearanceMm] = useState(300), [surfaceBlendWidthMm, setSurfaceBlendWidthMm] = useState(180)
  const [extendConnected, setExtendConnected] = useState(false)
  const surfaceCallbacks = useRef({ onPreview, onDraftChange, onCanvasBrushChange })
  surfaceCallbacks.current = { onPreview, onDraftChange, onCanvasBrushChange }
  const specs = TERRAIN_VARIANT_SPECS.filter(row => palette === 'mixed' || palette === 'light' && !row.blocksMovement && !row.blocksSight || palette === 'vegetation' && !['rock', 'scree'].some(role => row.role.includes(role)) || palette === 'rocks' && ['rock', 'scree'].some(role => row.role.includes(role)))
  const missing = specs.filter(row => !scene.propDefinitions[row.definitionId])
  const surfaceArea = scene.terrainAreas[surfaceAreaId]
  const surfaceRole = surfaceField === 'trees' ? 'tree' : surfaceField === 'shrubs' ? 'shrub' : surfaceField === 'grass' ? 'grass' : null
  const surfaceSpecs = surfaceRole ? TERRAIN_VARIANT_SPECS.filter(row => row.role === surfaceRole) : []
  const surfaceDefinitions = surfaceSpecs.map(row => scene.propDefinitions[row.definitionId]).filter((row): row is NonNullable<typeof row> => !!row)
  const surfaceMissing = surfaceField === 'trees'
    ? treeDefinitions.find(row => row.id === surfaceTreeId) ? [] : surfaceTreeId ? [surfaceTreeId] : surfaceSpecs.filter(row => !scene.propDefinitions[row.definitionId]).map(row => row.definitionId)
    : surfaceSpecs.filter(row => !scene.propDefinitions[row.definitionId]).map(row => row.definitionId)
  const surfacePalette = surfaceField === 'trees'
    ? treeDefinitions.filter(row => row.id === surfaceTreeId).map(row => ({ key: `tree-${row.id}`, definitionRef: { id: row.id, version: row.version }, kind: 'prop' as const, weight: 1 }))
    : surfaceDefinitions.map(row => ({ key: row.id, definitionRef: { id: row.id, version: row.version }, kind: 'decoration' as const, weight: 1 }))
  const surfaceBrush = useMemo<CanvasTerrainBrush | null>(() => {
    if (!surfacePainting || !surfaceArea || disabled) return null
    if (surfaceMode === 'paint' && surfaceField === 'material' && !scene.materials[surfaceMaterialId]) return null
    if (surfaceMode === 'paint' && surfaceField !== 'material' && (surfaceMissing.length || !surfacePalette.length)) return null
    const targetAreas = (extendConnected ? connectedTerrainAreaIds(scene, surfaceArea.id) : [surfaceArea.id]).map(id => scene.terrainAreas[id]).filter(Boolean)
    const allPoints = targetAreas.flatMap(area => terrainPoints(area))
    const xs = allPoints.map(point => point.x), ys = allPoints.map(point => point.y)
    return {
      radiusMm: surfaceRadiusMm, strokes: [], scope: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
      label: `地表规则 · ${surfaceMode === 'erase' ? '局部擦除' : ({ material: '材质', trees: '树木', shrubs: '灌木', grass: '草簇' }[surfaceField])} · 抬笔生成候选 · Escape 取消`,
      onStroke: stroke => {
        try {
          if (surfaceMode === 'paint' && surfaceField !== 'material' && (!surfaceSeed.trim() || surfaceSeed.length > 128)) throw new Error('植被种子长度须为1–128个字符。')
          const commands: SceneCommand[] = [], estimates: string[] = []
          for (const area of targetAreas) {
            const regionsMm = surfaceRegionsFromStroke(stroke, surfaceRadiusMm, terrainPoints(area))
            if (surfaceMode === 'erase') {
              commands.push({ type: 'eraseSurfaceRules', supportRef: { kind: 'terrainArea', id: area.id }, field: surfaceField, visibility, regionsMm })
            } else if (surfaceField === 'material') {
              const material = scene.materials[surfaceMaterialId]
              if (!material) throw new Error('请选择已采用的地形材质。')
              commands.push({ type: 'paintSurfaceMaterial', id: crypto.randomUUID(), floorId, layerId, visibility, supportRef: { kind: 'terrainArea', id: area.id }, regionsMm,
                paint: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, blendWidthMm: surfaceBlendWidthMm })
            } else {
              const polygons = regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm }))
              const expected = estimateSurfaceRegionInstances(scene, surfacePalette, { polygons, coveragePpm: surfaceCoveragePpm })
              const clusterId = crypto.randomUUID()
              commands.push({ type: 'paintSurfaceVegetation', id: crypto.randomUUID(), clusterId, floorId, layerId, visibility, supportRef: { kind: 'terrainArea', id: area.id }, regionsMm,
                field: surfaceField, coveragePpm: surfaceCoveragePpm, seed: surfaceSeed, palette: surfacePalette, spacingMm: surfaceField === 'trees' ? 900 : 350,
                clusterRadiusMm: surfaceField === 'trees' ? 2200 : 700, clearanceMm: surfaceClearanceMm })
              estimates.push(`${area.id}：预计${expected}件`)
            }
          }
          if (!commands.length) throw new Error('笔迹没有落在所选地形面上。')
          surfaceCallbacks.current.onPreview(commands, surfaceMode === 'erase' ? '局部擦除地表规则并显露下层设置' : `绘制${({ material: '连续地表', trees: '树木规则', shrubs: '灌木规则', grass: '草簇规则' })[surfaceField]}`)
          setSurfacePainting(false)
          surfaceCallbacks.current.onDraftChange(false)
          if (estimates.length) setError(estimates.join('；'))
        } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
      },
      onCancel: () => { setSurfacePainting(false); surfaceCallbacks.current.onDraftChange(false); surfaceCallbacks.current.onCanvasBrushChange(null) },
      onError: setError,
    }
  }, [scene, surfacePainting, surfaceArea, disabled, surfaceMode, surfaceField, surfaceMaterialId, surfaceMissing, surfacePalette, surfaceSeed, surfaceCoveragePpm, surfaceRadiusMm, surfaceClearanceMm, surfaceBlendWidthMm, floorId, layerId, visibility, extendConnected])
  const activeBrush = surfaceBrush
  useEffect(() => { onCanvasBrushChange(activeBrush); return () => onCanvasBrushChange(null) }, [activeBrush, onCanvasBrushChange])
  useEffect(() => () => surfaceCallbacks.current.onDraftChange(false), [])
  const submit = () => {
    try {
      const values = region.split(/[,，\s]+/).filter(Boolean).map(Number)
      if (values.length !== 4 || !values.every(Number.isSafeInteger) || values[2] <= 0 || values[3] <= 0) throw new Error('范围需要 x、y、宽、高四个整数毫米值，宽高须为正。')
      onCreate({ type: 'createDecorationCluster', id: crypto.randomUUID(), floorId, layerId, visibility, supportRef: parseSupport(support), boundsMm: { x: values[0], y: values[1], width: values[2], height: values[3] }, seed,
        maxInstances: Number(count), spacingMm: Number(spacing), clusterRadiusMm: Number(radius), clearanceMm: Number(clearance),
        palette: specs.map(row => ({ key: row.key, definitionRef: { id: row.definitionId, version: 1 }, kind: row.blocksMovement || row.blocksSight ? 'prop' : 'decoration', weight: row.blocksMovement || row.blocksSight ? 1 : 3 })) })
      setError(undefined)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  return <section className="asset-section" aria-label="簇状布景">
    <h2>簇状布景</h2><p className="asset-muted">树岩保留碰撞，小型装饰可逐件编辑。预览会检查支撑、活动区、道路及楼梯净空，并保留人工修改。</p>
    {<details className="decoration-canopy-rules" open>
      <summary>连续地表与区域植被</summary>
      <fieldset disabled={disabled || surfacePainting}>
        <label>支撑地形面<select aria-label="地表规则支撑地形面" value={surfaceAreaId} onChange={event => setSurfaceAreaId(event.target.value)}>{canopyAreas.map(area => { const layer = scene.userLayers[scene.entityLayers[area.id]]; return <option key={area.id} value={area.id} disabled={area.editLocked || layer?.editLocked}>{area.id} · 高程 {area.groundElevationMm / 1000} 米{area.editLocked || layer?.editLocked ? ' · 已锁定' : ''}</option> })}</select></label>
        <div className="asset-library-tabs" role="group" aria-label="地表规则通道">{(['material', 'trees', 'shrubs', 'grass'] as const).map(value => <button key={value} type="button" aria-pressed={surfaceField === value} onClick={() => setSurfaceField(value)}>{{ material: '材质', trees: '树木', shrubs: '灌木', grass: '草簇' }[value]}</button>)}</div>
        <div className="asset-library-tabs" role="group" aria-label="地表绘制模式"><button type="button" aria-pressed={surfaceMode === 'paint'} onClick={() => setSurfaceMode('paint')}>涂绘</button><button type="button" aria-pressed={surfaceMode === 'erase'} onClick={() => setSurfaceMode('erase')}>局部擦除</button></div>
        {surfaceMode === 'paint' && surfaceField === 'material' && <>
          <label>地表材质<select aria-label="地表规则材质" value={surfaceMaterialId} onChange={event => setSurfaceMaterialId(event.target.value)}><option value="">选择材质</option>{Object.values(scene.materials).filter(row => row.applicableSurfaces.includes('terrain')).map(row => <option key={row.id} value={row.id}>{row.name} · v{row.version}</option>)}</select></label>
          <label>过渡宽度 mm<input type="number" min="0" max="10000" step="50" value={surfaceBlendWidthMm} onChange={event => setSurfaceBlendWidthMm(Number(event.target.value))} aria-label="地表规则过渡宽度"/></label>
        </>}
        {surfaceMode === 'paint' && surfaceField === 'trees' && <label>树木素材<select aria-label="区域树木素材" value={surfaceTreeId} onChange={event => setSurfaceTreeId(event.target.value)}><option value="">选择树木素材</option>{treeDefinitions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
        {surfaceMode === 'paint' && surfaceField !== 'material' && <>
          {surfaceMissing.length > 0 && <button type="button" className="secondary asset-wide" onClick={() => onPrepareSources(surfaceMissing)}>预览所需固定植被素材 · {surfaceMissing.length} 项</button>}
          <label>目标覆盖率 <output>{(surfaceCoveragePpm / 10_000).toFixed(0)}%</output><input aria-label="区域植被目标覆盖率" type="range" min="0" max="1_000_000" step="10_000" value={surfaceCoveragePpm} onChange={event => setSurfaceCoveragePpm(Number(event.target.value))}/></label>
          <label>植被种子<input aria-label="区域植被种子" maxLength={128} value={surfaceSeed} onChange={event => setSurfaceSeed(event.target.value)}/></label>
          <label>净空余量 mm<input aria-label="区域植被净空" type="number" min="0" max="10000" step="50" value={surfaceClearanceMm} onChange={event => setSurfaceClearanceMm(Number(event.target.value))}/></label>
        </>}
        <label>画笔半径 mm<input aria-label="地表规则画笔半径" type="number" min="100" max="10000" step="100" value={surfaceRadiusMm} onChange={event => setSurfaceRadiusMm(Number(event.target.value))}/></label>
        <label className="building-check"><input type="checkbox" aria-label="扩展到相连地形面" checked={extendConnected} onChange={event => setExtendConnected(event.target.checked)}/>延伸到共享边界或实际地形连接的表面</label>
        <label>受众<select aria-label="地表规则受众" value={visibility} onChange={event => setVisibility(event.target.value as 'public' | 'gm')}><option value="public">玩家可见</option><option value="gm">仅主持人</option></select></label>
        <button type="button" className={surfacePainting ? 'secondary asset-wide' : 'primary asset-wide'} aria-pressed={surfacePainting}
          disabled={!surfaceArea || (surfaceMode === 'paint' && surfaceField === 'material' && !surfaceMaterialId) || (surfaceMode === 'paint' && surfaceField !== 'material' && (surfaceMissing.length > 0 || !surfacePalette.length))}
          onClick={() => { const next = !surfacePainting; setSurfacePainting(next); setError(undefined); onDraftChange(next); if (!next) onCanvasBrushChange(null) }}>{surfacePainting ? '结束地表绘制' : surfaceMode === 'erase' ? '开始局部擦除' : '开始地表涂绘'}</button>
      </fieldset>
      {surfacePainting && <button type="button" className="secondary asset-wide" onClick={() => { setSurfacePainting(false); onDraftChange(false); onCanvasBrushChange(null) }}>取消当前笔迹</button>}
      <p className="asset-muted">材质、树木、灌木和草簇分别叠加；局部擦除只移除当前覆盖，露出仍有效的旧规则。笔迹不改变地形支撑或通行。</p>
      <div className="asset-entry-list" aria-label="已有地表规则">{Object.values(scene.surfaceRules ?? {}).filter(rule => scene.userLayers[scene.entityLayers[rule.id]]).sort((a, b) => a.paintOrder - b.paintOrder).map(rule => <div key={rule.id} className="asset-entry">
        <span>{({ material: '材质', trees: '树木', shrubs: '灌木', grass: '草簇' })[rule.field]} · {scene.terrainAreas[rule.supportRef.id]?.id ?? rule.supportRef.id}{rule.field !== 'material' ? ` · ${(rule.coveragePpm / 10_000).toFixed(0)}%` : ''}</span>
        {rule.field !== 'material' && <button type="button" disabled={disabled || rule.editLocked || scene.userLayers[scene.entityLayers[rule.id]]?.editLocked} onClick={() => onPreview([{ type: 'updateSurfaceVegetation', id: rule.id, coveragePpm: Math.max(0, Math.min(1_000_000, rule.coveragePpm + (rule.coveragePpm < 500_000 ? 100_000 : -100_000))) }], '调整区域植被覆盖并保全人工记录')}>调整覆盖</button>}
        <button type="button" aria-label={`${rule.editLocked ? '解锁' : '锁定'}地表规则`} disabled={disabled} onClick={() => onPreview([{ type: 'setEditLock', kind: 'surfaceRule', id: rule.id, locked: !rule.editLocked }], rule.editLocked ? '解锁地表规则' : '锁定地表规则')}>{rule.editLocked ? '解锁' : '锁定'}</button>
        <button type="button" disabled={disabled || rule.editLocked} onClick={() => onPreview([{ type: 'deleteSurfaceRule', id: rule.id }], '移除地表规则并显露下层设置')}>移除</button>
      </div>)}</div>
    </details>}
    <fieldset disabled={disabled || surfacePainting}>
      <label>支撑表面<select aria-label="布景支撑表面" value={support} onChange={e => setSupport(e.target.value)}>{supportOptions(scene, floorId).map(row => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
      <label>世界范围 · x, y, 宽, 高 mm<input aria-label="布景世界范围" value={region} onChange={e => setRegion(e.target.value)}/></label>
      <label>固定素材组合<select aria-label="布景素材组合" value={palette} onChange={e => setPalette(e.target.value)}><option value="mixed">树岩、灌丛、草缘与碎石</option><option value="vegetation">植被簇</option><option value="rocks">岩石与碎石</option><option value="light">仅轻量装饰</option></select></label>
      <label>种子<input aria-label="布景种子" value={seed} maxLength={128} onChange={e => setSeed(e.target.value)}/></label>
      <label>最多实例数<input type="number" min="1" max="64" aria-label="布景最多实例数" value={count} onChange={e => setCount(e.target.value)}/></label>
      <label>最小间隔 mm<input type="number" aria-label="布景最小间隔" value={spacing} onChange={e => setSpacing(e.target.value)}/></label>
      <label>簇半径 mm<input type="number" aria-label="布景簇半径" value={radius} onChange={e => setRadius(e.target.value)}/></label>
      <label>净空余量 mm<input type="number" aria-label="布景净空余量" value={clearance} onChange={e => setClearance(e.target.value)}/></label>
      <label>受众<select aria-label="布景受众" value={visibility} onChange={e => setVisibility(e.target.value as 'public' | 'gm')}><option value="public">玩家可见</option><option value="gm">仅主持人</option></select></label>
      {missing.length > 0 && <button className="secondary asset-wide" onClick={() => onPrepareSources(missing.map(row => row.definitionId))}>预览所选布景素材 · {missing.length} 项</button>}
      <button className="primary asset-wide" disabled={missing.length > 0} onClick={submit}>预览簇状布景</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <p className="asset-muted">{missing.length ? '先预览并采用所选固定素材，再准备布景。素材会保存在工程中，后续布景直接复用。' : '所选固定素材已就绪。布景按实际实例和人工记录一次采用；空间或预算不足会说明原因。'}</p>
    {Object.values(scene.decorationClusters ?? {}).map(group => <div key={group.id} className="asset-entry"><button title={group.id} onClick={() => onSelect(group.id)}>{group.id} · {Object.values(group.members).filter(row => row.entityId && row.state !== 'deleted').length} 件</button><button disabled={disabled || group.editLocked} onClick={() => onPreview([{ type: 'regenerateDecorationCluster', id: group.id }], '重新布景并保全人工记录')}>预览重新布景</button></div>)}
  </section>
}

export function DecorationInspector({ scene, id, disabled, onPreview, onSelect, onOpenLayers }: Pick<Props, 'scene' | 'disabled' | 'onPreview' | 'onSelect'> & { id: string; onOpenLayers?: () => void }) {
  const decoration: Decoration | undefined = scene.decorations?.[id], cluster: DecorationCluster | undefined = scene.decorationClusters?.[id], row = decoration ?? cluster
  const [x, setX] = useState(String(decoration?.positionMm.x ?? 0)), [y, setY] = useState(String(decoration?.positionMm.y ?? 0)), [scale, setScale] = useState(String((decoration?.scalePpm ?? 1_000_000) / 1_000_000)), [rotation, setRotation] = useState(String(decoration?.rotationDeg ?? 0))
  const [visibility, setVisibility] = useState<'public' | 'gm'>(row?.visibility ?? 'public')
  if (!row) return null
  const owner = Object.values(scene.decorationClusters ?? {}).find(group => Object.values(group.members).some(member => member.entityId === id && member.state !== 'detached' && member.state !== 'deleted'))
  const ownerRule = owner && Object.values(scene.surfaceRules ?? {}).find(rule => rule.field !== 'material' && rule.clusterId === owner.id)
  const locked = effectiveEditLocked(scene, id)
  const lockChangeBlocked = effectiveLayerLocked(scene, id) || !!owner && (owner.editLocked || effectiveLayerLocked(scene, owner.id)) || !!ownerRule && (ownerRule.editLocked || effectiveLayerLocked(scene, ownerRule.id))
  return <section aria-label="轻量装饰属性"><h2>{decoration ? '轻量装饰' : '布景簇'}</h2><p className="asset-muted">{id}</p>
    <EntityLockNotice scene={scene} id={id} onSelect={onSelect} onOpenLayers={onOpenLayers}/>
    {decoration && <><p>{scene.propDefinitions[decoration.definitionRef.id]?.name}</p><fieldset disabled={disabled || locked}>
      <label>X mm<input aria-label="装饰位置X" value={x} onChange={e => setX(e.target.value)}/></label><label>Y mm<input aria-label="装饰位置Y" value={y} onChange={e => setY(e.target.value)}/></label>
      <label>尺寸倍数<input aria-label="装饰尺寸倍数" value={scale} onChange={e => setScale(e.target.value)}/></label><label>朝向 °<input aria-label="装饰朝向" value={rotation} onChange={e => setRotation(e.target.value)}/></label>
      <label>受众<select aria-label="装饰受众" value={visibility} onChange={e => setVisibility(e.target.value as 'public' | 'gm')}><option value="public">玩家可见</option><option value="gm">仅主持人</option></select></label>
      <button className="primary asset-wide" onClick={() => onPreview([{ type: 'updateDecoration', id, changes: { positionMm: { x: Number(x), y: Number(y) }, scalePpm: Math.round(Number(scale) * 1_000_000), rotationDeg: Number(rotation), visibility } }], '修改轻量装饰并保留人工位置')}>预览装饰修改</button>
      <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'deleteDecoration', id }], '删除装饰并保存人工删除记录')}>预览删除装饰</button>
      {owner && <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'detachDecorationMember', clusterId: owner.id, entityId: id }], '保留当前装饰并退出自动布景')}>退出自动布景</button>}
    </fieldset></>}
    <button className="secondary asset-wide" disabled={disabled || lockChangeBlocked} onClick={() => onPreview([{ type: 'setEditLock', kind: decoration ? 'decoration' : 'decorationCluster', id, locked: !row.editLocked }], row.editLocked ? '解锁布景对象' : '锁定布景对象')}>{row.editLocked ? '解锁布景对象' : '锁定布景对象'}</button>
    {cluster && <><p>人工记录随工程保存；重新布景不会复活删除项。</p><button className="primary asset-wide" disabled={disabled || locked} onClick={() => onPreview([{ type: 'regenerateDecorationCluster', id }], '重新布景并保全人工记录')}>预览重新布景</button><button className="secondary asset-wide" disabled={disabled || locked} onClick={() => onPreview([{ type: 'deleteDecorationCluster', id }], '删除布景簇及仍受管理的成员')}>预览删除布景簇</button><ul>{Object.entries(cluster.members).map(([key, member]) => <li key={key}>{member.entityId ? <button title={member.entityId} onClick={() => onSelect(member.entityId!)}>{scene.props[member.entityId] ? '完整物件' : '轻量装饰'} · {member.entityId}</button> : '已删除'} · {({ managed: '自动', manual: '人工保留', deleted: '删除保留', detached: '已退出' })[member.state]}</li>)}</ul></>}
  </section>
}
