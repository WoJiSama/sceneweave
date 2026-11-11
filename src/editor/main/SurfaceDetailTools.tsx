import { useState } from 'react'
import type { MaterialPaint, SceneDocument } from '../../shared/model/scene'
import type { AppearanceGraph } from '../../shared/model/appearance'
import type { SceneCommand } from '../../shared/commands/commands'
import { buildNaturalSurfacePatchPlan } from '../../shared/surface-details/natural-patches'
import { buildRoadCampPatchPlan } from '../../shared/surface-details/road-camp-patches'
import { terrainPoints } from '../../shared/geometry/geometry'
import { outdoorPoints, pointText } from './outdoor-coordinates'
import OutdoorCoordinates from './OutdoorCoordinates'
import { NumberInput } from '../native-canvas/controls'
import { newId } from './runtime'
import { createEntityLabeler } from './entity-label'

/** Requests only. The ordinary composition candidate owns actual resources,
 * exact baseline, source ancestry, adoption, save and undo. */
export default function SurfaceDetailTools({ floorId, scene, appearance, selectedIds, onPreview }: {
  floorId?: string; scene: SceneDocument; appearance: AppearanceGraph; selectedIds: readonly string[]
  onPreview: (commands: SceneCommand[], label: string) => void
}) {
  const [areaId, setAreaId] = useState(''), [mode, setMode] = useState<'natural' | 'shoulder' | 'camp'>('natural')
  const [materialId, setMaterialId] = useState(''), [region, setRegion] = useState(''), [pathIds, setPathIds] = useState<string[]>([])
  const [supportIds, setSupportIds] = useState<string[]>([]), [seed, setSeed] = useState('natural-surface-1')
  const [blend, setBlend] = useState(120), [variation, setVariation] = useState(0), [width, setWidth] = useState(500)
  const [tileWidth, setTileWidth] = useState(2000), [tileHeight, setTileHeight] = useState(2000)
  const [originX, setOriginX] = useState(0), [originY, setOriginY] = useState(0), [rotation, setRotation] = useState(0), [opacity, setOpacity] = useState(1)
  const [profile, setProfile] = useState<'grassOnRock' | 'rockOnGrass'>('grassOnRock'), [grassEdges, setGrassEdges] = useState(false)
  const [fragments, setFragments] = useState(0), [error, setError] = useState('')
  const name = createEntityLabeler(scene), area = scene.terrainAreas[areaId]
  const materials = Object.values(scene.materials).filter(row => row.applicableSurfaces.includes('terrain'))
  const chooseArea = (id: string) => { setAreaId(id); setError(''); if (id) setSupportIds([id]) }
  const chooseMaterial = (id: string) => {
    setMaterialId(id)
    const material = scene.materials[id]
    if (material) { setTileWidth(material.defaultTileSizeMm.width); setTileHeight(material.defaultTileSizeMm.height) }
  }
  const paint = (): MaterialPaint => {
    const material = scene.materials[materialId]
    if (!material) throw new Error('请明确选择工程中已采用的地表材质。')
    return { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: tileWidth, height: tileHeight },
      alignment: 'world', originMm: { x: originX, y: originY }, rotationDeg: rotation, opacity, tint: null }
  }
  const run = () => {
    try {
      setError('')
      if (!area) throw new Error('请明确选择真实地形面。')
      const project = { document: scene, appearance }, operationId = newId()
      if (mode === 'natural') {
        const plan = buildNaturalSurfacePatchPlan(project, { operationId, areaId, paint: paint(), regionsMm: [outdoorPoints(region)],
          profile, seed, variationMm: variation, blendWidthMm: blend, fragments, grassEdges })
        onPreview(plan.commands, `自然草岩覆盖 · ${plan.createdOverlayIds.length} 片 · ${plan.counts.grassEdges} 段草沿`)
      } else {
        const plan = buildRoadCampPatchPlan(project, { operationId, paint: paint(),
          roads: mode === 'shoulder' ? pathIds.map(pathId => ({ pathId, supportAreaIds: supportIds, shoulder: { leftWidthMm: width, rightWidthMm: width,
            variationMm: variation, sampleSpacingMm: 1500, blendWidthMm: blend, seed } })) : [],
          patches: mode === 'camp' ? [{ targetAreaId: areaId, selectionMm: outdoorPoints(region), blendWidthMm: blend }] : [] })
        onPreview(plan.commands, `${mode === 'shoulder' ? '自然路肩' : '营地地表接片'} · ${plan.createdOverlayIds.length} 片`)
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <details className="workspace-advanced"><summary>自然地表细节 · 草岩、路肩与营地</summary>
    <section aria-label="自然地表细节">
      <p className="asset-muted">为明确地形追加可编辑的材质片段，保留原铺装。选择自然风格和范围后预览；结果为静态世界覆盖，后续移动道路不会自动重贴。</p>
      <label>细节用途<select aria-label="地表细节用途" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setError('') }}><option value="natural">草岩接缝</option><option value="shoulder">道路路肩</option><option value="camp">营地接片</option></select></label>
      <label>目标地形<select aria-label="细节目标地形" value={areaId} onChange={e => chooseArea(e.target.value)}><option value="">明确选择地形</option>{Object.values(scene.terrainAreas).filter(area => !floorId || area.floorId === floorId).filter(row => row.visibility === 'public').map(row => <option key={row.id} value={row.id}>{name(row.id)}</option>)}</select></label>
      <button type="button" className="secondary asset-wide" disabled={selectedIds.length !== 1 || !scene.terrainAreas[selectedIds[0]]} onClick={() => chooseArea(selectedIds[0])}>使用画布所选地形</button>
      <label>覆盖材质<select aria-label="细节覆盖材质" value={materialId} onChange={e => chooseMaterial(e.target.value)}><option value="">明确选择材质</option>{materials.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {mode === 'natural' && <><label>自然风格<select aria-label="草岩细节风格" value={profile} onChange={e => setProfile(e.target.value as typeof profile)}><option value="grassOnRock">岩地上的草舌</option><option value="rockOnGrass">草地中的裸岩缺口</option></select></label><label className="composition-check"><input type="checkbox" aria-label="添加断续草沿" checked={grassEdges} onChange={e => setGrassEdges(e.target.checked)}/>添加有限断续草沿</label><label>独立碎片数量<input aria-label="地表细节碎片数" type="number" min="0" max="4" value={fragments} onChange={e => setFragments(Number(e.target.value))}/></label></>}
      {mode === 'shoulder' ? <><label>道路<select multiple aria-label="细节道路" value={pathIds} onChange={e => setPathIds([...e.target.selectedOptions].map(row => row.value))}>{Object.values(scene.paths).filter(path => !floorId || path.floorId === floorId).filter(row => area && row.floorId === area.floorId && row.visibility === 'public').map(row => <option key={row.id} value={row.id}>{name(row.id)}</option>)}</select></label>
        <label>道路的完整地形支撑<select multiple aria-label="路肩地形支撑" value={supportIds} onChange={e => setSupportIds([...e.target.selectedOptions].map(row => row.value))}>{Object.values(scene.terrainAreas).filter(area => !floorId || area.floorId === floorId).filter(row => area && row.floorId === area.floorId && row.visibility === 'public').map(row => <option key={row.id} value={row.id}>{name(row.id)}</option>)}</select></label><NumberInput label="两侧路肩宽度" ariaLabel="自然路肩宽度" displayUnit={scene.units.display} value={width} onCommit={setWidth}/></>
        : <><button type="button" className="secondary asset-wide" disabled={!area} onClick={() => { if (area) setRegion(pointText(terrainPoints(area))) }}>读取目标地形轮廓作为范围</button><OutdoorCoordinates text={region} onChange={setRegion} label="细节覆盖范围" ariaLabel="细节覆盖范围坐标" unit={scene.units.display}/></>}
      <NumberInput label="边缘羽化" ariaLabel="细节边缘羽化" displayUnit={scene.units.display} value={blend} onCommit={setBlend}/>
      {mode !== 'camp' && <><NumberInput label="轮廓起伏" ariaLabel="细节轮廓起伏" displayUnit={scene.units.display} value={variation} onCommit={setVariation}/><label>变化种子<input aria-label="地表细节种子" value={seed} onChange={e => setSeed(e.target.value)}/></label></>}
      <details><summary>世界材质尺度与相位</summary><NumberInput label="纹理宽" ariaLabel="细节纹理宽" displayUnit={scene.units.display} value={tileWidth} onCommit={setTileWidth}/><NumberInput label="纹理高" ariaLabel="细节纹理高" displayUnit={scene.units.display} value={tileHeight} onCommit={setTileHeight}/><NumberInput label="世界原点 X" ariaLabel="细节世界原点X" displayUnit={scene.units.display} value={originX} onCommit={setOriginX}/><NumberInput label="世界原点 Y" ariaLabel="细节世界原点Y" displayUnit={scene.units.display} value={originY} onCommit={setOriginY}/><label>纹理方向<input aria-label="细节纹理方向" type="number" min="0" max="359" value={rotation} onChange={e => setRotation(Number(e.target.value))}/></label><label>覆盖透明度<input aria-label="细节覆盖透明度" type="number" min="0" max="1" step=".05" value={opacity} onChange={e => setOpacity(Number(e.target.value))}/></label></details>
      <button type="button" className="primary asset-wide" disabled={!area || !materialId || (mode === 'shoulder' ? !pathIds.length || !supportIds.length : !region.trim())} onClick={run}>预览自然地表细节</button>
      {error && <p role="alert" className="asset-form-error">{error}</p>}
    </section>
  </details>
}
