import { Layers3, Mountain, PencilRuler } from 'lucide-react'
import type { SceneCommandV2 } from '../../core/v2/commands'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { NumberInput } from './controls'
import { terrainNameV2, terrainPointCommandsV2 } from './terrain-editing'

type Props = {
  project: CompleteProjectV2; selected: string; busy: boolean
  onSelect: (id: string | null) => void
  onCommit: (commands: SceneCommandV2[]) => void
  onPreview: (commands: SceneCommandV2[] | (() => SceneCommandV2[]), description: string) => void
}

export default function TerrainInspector({ project, selected, busy, onSelect, onCommit, onPreview }: Props) {
  const scene = project.document, area = scene.terrainAreas[selected], edge = scene.terrainEdges[selected], connection = scene.terrainConnections[selected]
  const pointArea = Object.values(scene.terrainAreas).find(area => area.boundaryMm.some(point => point.id === selected))
  const point = pointArea?.boundaryMm.find(point => point.id === selected)
  const clear = <button className="asset-clear" onClick={() => onSelect(null)}>返回工程信息</button>
  if (point && pointArea) return <><div className="asset-section-heading"><PencilRuler size={16}/><h2>地形轮廓</h2></div><h3>{terrainNameV2(pointArea.id)}</h3><p className="asset-muted">预览轮廓变化。接壤顶点与浅水带一起更新，采用后可整体撤销。</p><fieldset disabled={busy || pointArea.editLocked}>
    <NumberInput label="轮廓点 X" value={point.positionMm.x} onCommit={x => onPreview(() => terrainPointCommandsV2(scene, pointArea.id, selected, { ...point.positionMm, x }), '调整地形轮廓')}/>
    <NumberInput label="轮廓点 Y" value={point.positionMm.y} onCommit={y => onPreview(() => terrainPointCommandsV2(scene, pointArea.id, selected, { ...point.positionMm, y }), '调整地形轮廓')}/>
  </fieldset>{clear}</>
  if (area) {
    const style = area.surfaceStyle
    return <><div className="asset-section-heading"><Mountain size={16}/><h2>地形与材质</h2></div><h3>{terrainNameV2(area.id)}</h3><p className="asset-muted">高度和通行使用实际地形；材质、崖面与阴影随之更新。</p>
      <fieldset disabled={busy || area.editLocked}>
        <NumberInput label="地面高程" value={area.groundElevationMm} onCommit={groundElevationMm => onPreview([{ type: 'setTerrainElevation', id: selected, groundElevationMm }], '调整地形高程')}/>
        {style && <><label className="asset-select">地面材质<select aria-label="地面材质" value={style.base.materialRef.id} onChange={event => onCommit([{ type: 'setSurfaceMaterial', kind: 'terrainArea', id: selected, materialRef: { id: event.target.value, version: scene.materials[event.target.value].version } }])}>{Object.values(scene.materials).filter(material => material.applicableSurfaces.includes('terrain')).map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
          <NumberInput label="纹理方向" value={style.base.rotationDeg} unit="°" onCommit={rotationDeg => onCommit([{ type: 'setSurfacePaint', kind: 'terrainArea', id: selected, changes: { rotationDeg } }])}/>
          <details className="asset-details"><summary>铺装尺寸与锚点</summary><NumberInput label="铺装宽度" value={style.base.tileSizeMm.width} onCommit={width => onCommit([{ type: 'setSurfacePaint', kind: 'terrainArea', id: selected, changes: { tileSizeMm: { ...style.base.tileSizeMm, width } } }])}/><NumberInput label="铺装长度" value={style.base.tileSizeMm.height} onCommit={height => onCommit([{ type: 'setSurfacePaint', kind: 'terrainArea', id: selected, changes: { tileSizeMm: { ...style.base.tileSizeMm, height } } }])}/><NumberInput label="铺装原点 X" value={style.base.originMm.x} onCommit={x => onCommit([{ type: 'setSurfacePaint', kind: 'terrainArea', id: selected, changes: { originMm: { ...style.base.originMm, x } } }])}/><NumberInput label="铺装原点 Y" value={style.base.originMm.y} onCommit={y => onCommit([{ type: 'setSurfacePaint', kind: 'terrainArea', id: selected, changes: { originMm: { ...style.base.originMm, y } } }])}/></details>
        </>}
        {style?.overlays.filter(overlay => overlay.id !== 'island-shallow-water').map(overlay => <details className="asset-details asset-overlay-editor" key={overlay.id}><summary>{scene.materials[overlay.paint.materialRef.id].name}覆盖边界</summary><p className="asset-muted">覆盖层在表面范围内裁剪，不改变物理高度。</p>{overlay.boundaryMm.map((point, index) => <div key={index} className="asset-overlay-point"><strong>边界点 {index + 1}</strong><NumberInput label={`覆盖点 ${index + 1} X`} value={point.x} onCommit={x => onPreview([{ type: 'setOverlayBoundary', kind: 'terrainArea', id: area.id, overlayId: overlay.id, boundaryMm: overlay.boundaryMm.map((p, i) => i === index ? { ...p, x } : p) }], '调整草岩交界')}/><NumberInput label={`覆盖点 ${index + 1} Y`} value={point.y} onCommit={y => onPreview([{ type: 'setOverlayBoundary', kind: 'terrainArea', id: area.id, overlayId: overlay.id, boundaryMm: overlay.boundaryMm.map((p, i) => i === index ? { ...p, y } : p) }], '调整草岩交界')}/></div>)}</details>)}
      </fieldset>
      <dl className="asset-facts"><dt>普通移动</dt><dd>{area.blocksMovement ? '阻挡' : '可站立'}</dd><dt>当前高程</dt><dd>{area.groundElevationMm / 1000} m</dd><dt>材质覆盖</dt><dd>{style?.overlays.length ?? 0} 层</dd></dl>
      {!!Object.values(scene.scatterGroups).filter(group => group.domain.kind === 'area' && group.domain.areaId === area.id).length && <><h3>表面散布</h3>{Object.values(scene.scatterGroups).filter(group => group.domain.kind === 'area' && group.domain.areaId === area.id).map(group => <button className="asset-group-link asset-wide" key={group.id} disabled={busy} onClick={() => onSelect(group.id)}><Layers3 size={14}/>管理散布 · {Object.values(group.members).filter(member => member.propId).length} 件</button>)}</>}
      {clear}</>
  }
  if (connection) return <><div className="asset-section-heading"><Mountain size={16}/><h2>高差连接</h2></div><h3>{connection.kind === 'stairs' ? '台阶' : '坡道'}</h3><p className="asset-muted">两端连接真实支撑面；VIS-02 还保留两侧各 2 m 的接入区。</p><dl className="asset-facts"><dt>净宽</dt><dd>{connection.widthMm} mm</dd><dt>起点</dt><dd>{terrainNameV2(connection.from.surfaceRef.id)}</dd><dt>终点</dt><dd>{terrainNameV2(connection.to.surfaceRef.id)}</dd><dt>状态</dt><dd>{connection.blocksMovement ? '阻挡' : '可通行'}</dd></dl><fieldset disabled={busy || connection.editLocked}><button className="secondary asset-wide" onClick={() => onPreview([{ type: 'setConnectionBlocked', id: selected, blocksMovement: !connection.blocksMovement }], '调整连接通行状态')}>{connection.blocksMovement ? '预览恢复通行' : '预览阻断连接'}</button><button className="secondary asset-wide" onClick={() => onPreview([{ type: 'removeTerrainConnection', id: selected }], '移除高差连接')}>预览移除连接</button></fieldset><p className="asset-muted">若修改违反样板已声明的通路要求，会说明原因并保留当前工程。</p>{clear}</>
  if (edge) return <><div className="asset-section-heading"><PencilRuler size={16}/><h2>地形边缘</h2></div><h3>{edge.kind === 'cliff' ? '悬崖' : edge.kind === 'shore' ? '岸线' : '材质过渡'}</h3><p className="asset-muted">边缘跟随源轮廓更新。高差的阻挡由地形决定，外观阴影单独绘制。</p><dl className="asset-facts"><dt>来源表面</dt><dd>{terrainNameV2(edge.source.areaId)}</dd><dt>邻接表面</dt><dd>{edge.neighborAreaId ? terrainNameV2(edge.neighborAreaId) : '楼层基底'}</dd><dt>岸线叠加</dt><dd>{edge.shoreline ? '有' : '无'}</dd><dt>阻挡移动</dt><dd>{edge.blocksMovement ? '是' : '否'}</dd></dl><button className="asset-group-link" disabled={busy} onClick={() => onSelect(edge.source.areaId)}>选择源地形</button>{clear}</>
  return <>{clear}</>
}
