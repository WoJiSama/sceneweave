import { Layers3, LockKeyhole, Move, PencilRuler, Sprout } from 'lucide-react'
import type { SceneCommandV2 } from '../../core/v2/commands'
import { createPublicVisibilityV2 } from '../../core/v2/visibility'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { NumberInput } from './controls'
import ScatterInspector from './ScatterInspector'
import TerrainInspector from './TerrainInspector'
import { scatterNameV2 } from './terrain-editing'
import { effectiveEditLockedV2 } from './selection'

export const propName = (project: CompleteProjectV2, id: string) => {
  const prop = project.document.props[id]
  return prop.definitionRef ? project.document.propDefinitions[prop.definitionRef.id].name : `符号物件 · ${id}`
}
export const groupName = (project: CompleteProjectV2, id: string) => project.document.prefabDefinitions[project.document.prefabInstances[id].definitionRef.id].name

type Props = {
  project: CompleteProjectV2; selected: string; busy: boolean; workspace: { execute: (commands: readonly SceneCommandV2[]) => void | Promise<void>; updateProp: (id: string, changes: { positionMm?: { x: number; y: number }; rotationDeg?: number }) => void | Promise<void>; rotateRoomMaterial: (id: string, rotationDeg: number) => void | Promise<void> }
  onSelect: (id: string | null) => void
  onCommit: (run: () => void | Promise<void>) => void
  onPreview: (commands: SceneCommandV2[] | (() => SceneCommandV2[]), description: string) => void
  onPropCommand?: (commands: SceneCommandV2[], description: string, selectionAfterCommit?: string | null) => void
}

export default function SceneInspector({ project, selected, busy, workspace, onSelect, onCommit, onPreview, onPropCommand }: Props) {
  const scene = project.document, prop = scene.props[selected], vertex = scene.vertices[selected], wall = scene.walls[selected]
  const group = scene.prefabInstances[selected], room = scene.rooms[selected], area = scene.terrainAreas[selected]
  const terrain = Object.values(scene.terrainAreas).find(area => area.boundaryMm.some(point => point.id === selected))
  const point = terrain?.boundaryMm.find(point => point.id === selected)
  const surface = room ?? area, surfaceKind = room ? 'room' : 'terrainArea'
  const owner = prop && Object.values(scene.prefabInstances).find(group => Object.values(group.members).some(member => member.propId === selected))
  const scatterOwner = prop && Object.values(scene.scatterGroups).find(group => Object.values(group.members).some(member => member.propId === selected))
  const editProp = (commands: SceneCommandV2[], description: string, selectionAfterCommit?: string | null) => {
    if (onPropCommand) onPropCommand(commands, description, selectionAfterCommit)
    else onCommit(() => {
      const result = workspace.execute(commands)
      const selectAfterCommit = () => { if (selectionAfterCommit !== undefined) onSelect(selectionAfterCommit) }
      if (result) return result.then(selectAfterCommit)
      selectAfterCommit()
    })
  }
  const clear = <button className="asset-clear" onClick={() => onSelect(null)}>返回工程信息</button>
  if (scene.scatterGroups[selected]) return <ScatterInspector {...{ project, selected, busy, onSelect, onPreview }} onCommit={commands => onCommit(() => workspace.execute(commands))}/>
  if (scene.terrainEdges[selected] || scene.terrainConnections[selected] || area && area.id !== 'terrace-area' || terrain && terrain.id !== 'terrace-area') return <TerrainInspector {...{ project, selected, busy, onSelect, onPreview }} onCommit={commands => onCommit(() => workspace.execute(commands))}/>
  if (prop) {
    const effectivelyLocked = effectiveEditLockedV2(scene, selected)
    const variants = Object.values(scene.propDefinitions).filter(definition => !(definition.id.startsWith('composition-retained-prop-') && definition.tags.includes('sceneweave:retained-appearance')) && definition.defaultFootprintMm.width === prop.footprintMm.width && definition.defaultFootprintMm.height === prop.footprintMm.height && definition.defaultVisualBoundsMm.width === prop.visualBoundsMm.width && definition.defaultVisualBoundsMm.height === prop.visualBoundsMm.height)
    return <><div className="asset-section-heading"><Move size={16}/><h2>物件属性</h2></div><h3>{propName(project, selected)}</h3>
      <p className="asset-muted">虚线分别显示图像范围与物理占地。一次修改可以完整撤销。</p>
      {effectivelyLocked && <p className="asset-muted">此物件受自身、容器或锚定依赖的编辑锁保护，只可查看。</p>}
      {owner && <button className="asset-group-link" onClick={() => onSelect(owner.id)}><Layers3 size={14}/>选择整个{groupName(project, owner.id)}</button>}
      {scatterOwner && <button className="asset-group-link" disabled={busy} onClick={() => onSelect(scatterOwner.id)}><Sprout size={14}/>管理{scatterNameV2(scene, scatterOwner)}</button>}
      <fieldset disabled={busy || effectivelyLocked}>
        <NumberInput label="物件 X" value={prop.positionMm.x} onCommit={x => editProp([{ type: 'updateProp', id: selected, changes: { positionMm: { ...prop.positionMm, x } } }], scatterOwner ? '移动散布成员' : '移动物件')}/>
        <NumberInput label="物件 Y" value={prop.positionMm.y} onCommit={y => editProp([{ type: 'updateProp', id: selected, changes: { positionMm: { ...prop.positionMm, y } } }], scatterOwner ? '移动散布成员' : '移动物件')}/>
        <NumberInput label="物件旋转" value={prop.rotationDeg} unit="°" onCommit={rotationDeg => editProp([{ type: 'updateProp', id: selected, changes: { rotationDeg } }], scatterOwner ? '旋转散布成员' : '旋转物件')}/>
        {variants.length > 1 && <label className="asset-select">外观变体<select aria-label="物件外观变体" value={prop.definitionRef?.id ?? ''} onChange={event => editProp([{ type: 'replacePropAppearance', id: selected, definitionRef: { id: event.target.value, version: scene.propDefinitions[event.target.value].version } }], scatterOwner ? '替换散布成员外观' : '替换物件外观')}>{variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</select><small>保留位置、尺寸、占地和公开状态</small></label>}
      </fieldset>
      {!scatterOwner && <button className="secondary asset-wide" disabled={busy || effectivelyLocked} onClick={() => editProp([{ type: 'deleteProp', id: selected }], '删除物件', null)}>删除物件</button>}
      {scatterOwner && <><button className="asset-group-link asset-wide" disabled={busy || scatterOwner.editLocked} onClick={() => onCommit(() => workspace.execute([{ type: 'setEditLock', kind: 'prop', id: selected, locked: !prop.editLocked }]))}><LockKeyhole size={14}/>{prop.editLocked ? '解除物件固定' : '固定此物件'}</button><fieldset disabled={busy || prop.editLocked || scatterOwner.editLocked}><button className="secondary asset-wide" onClick={() => editProp([{ type: 'deleteProp', id: selected }], '删除散布成员并保留排除区', scatterOwner.id)}>删除并保留排除区</button><button className="secondary asset-wide" onClick={() => editProp([{ type: 'detachScatterMember', groupId: scatterOwner.id, propId: selected }], '退出散布并保留物件', null)}>退出散布，保留物件</button></fieldset><p className="asset-muted">手工修改后会保留实际位置。删除与退出记录可撤销，重新散布不会生成副本。</p></>}
      <dl className="asset-facts"><dt>物理占地</dt><dd>{prop.footprintMm.width} × {prop.footprintMm.height} mm</dd><dt>图像范围</dt><dd>{prop.visualBoundsMm.width} × {prop.visualBoundsMm.height} mm</dd><dt>阻挡移动</dt><dd>{prop.blocksMovement ? '是' : '否'}</dd><dt>可见范围</dt><dd>{createPublicVisibilityV2(scene).prop(prop) ? '公开' : '仅主持人'}</dd></dl>{clear}</>
  }
  if (group) return <><div className="asset-section-heading"><Layers3 size={16}/><h2>组合属性</h2></div><h3>{groupName(project, selected)}</h3><p className="asset-muted">成员以实际位置保存。整体变换遵守每一件成员的编辑锁。</p><fieldset disabled={busy || effectiveEditLockedV2(scene, selected)}>
    <NumberInput label="组合 X" value={group.anchorMm.x} onCommit={x => onCommit(() => workspace.execute([{ type: 'transformPrefab', id: selected, anchorMm: { ...group.anchorMm, x } }]))}/>
    <NumberInput label="组合 Y" value={group.anchorMm.y} onCommit={y => onCommit(() => workspace.execute([{ type: 'transformPrefab', id: selected, anchorMm: { ...group.anchorMm, y } }]))}/>
    <NumberInput label="组合旋转" value={group.rotationDeg} unit="°" onCommit={rotationDeg => onCommit(() => workspace.execute([{ type: 'transformPrefab', id: selected, rotationDeg }]))}/>
    <button className="secondary asset-wide" onClick={() => onCommit(async () => { await workspace.execute([{ type: 'unpackPrefab', id: selected }]); onSelect(null) })}>拆开组合</button>
  </fieldset><h3>组合成员</h3><div className="asset-member-list">{Object.entries(group.members).filter(([, member]) => member.propId).map(([key, member]) => <button key={key} onClick={() => onSelect(member.propId!)}>{propName(project, member.propId!)}<small>{key}</small></button>)}</div><p className="asset-muted">拆开后保留每件物品的身份、位置、占地与可见性，可撤销恢复组合。</p>{clear}</>
  if (vertex) return <><div className="asset-section-heading"><PencilRuler size={16}/><h2>建筑顶点</h2></div><h3>{selected === 'study-v1' ? '书房斜角 · 北端' : selected === 'study-v2' ? '书房斜角 · 东端' : '房间边界顶点'}</h3><p className="asset-muted">移动顶点会同时更新相邻墙、附着开口和地板裁剪。先预览，再采用。</p><fieldset disabled={busy || vertex.editLocked}>
    <NumberInput label="顶点 X" value={vertex.xMm} onCommit={x => onPreview([{ type: 'moveVertex', id: selected, positionMm: { x, y: vertex.yMm } }], '调整建筑边界')}/>
    <NumberInput label="顶点 Y" value={vertex.yMm} onCommit={y => onPreview([{ type: 'moveVertex', id: selected, positionMm: { x: vertex.xMm, y } }], '调整建筑边界')}/>
  </fieldset>{clear}</>
  if (wall) {
    const openings = Object.values(scene.openings).filter(opening => opening.wallId === selected)
    return <><div className="asset-section-heading"><PencilRuler size={16}/><h2>墙体属性</h2></div><h3>{selected === 'study-w1' ? '斜角墙与附着窗' : '建筑墙体'}</h3><p className="asset-muted">墙厚以真实毫米保存，开口按稳定端点沿墙定位。</p><fieldset disabled={busy || wall.editLocked}>
      <NumberInput label="墙体厚度" value={wall.thicknessMm} onCommit={thicknessMm => onPreview([{ type: 'setWallThickness', id: selected, thicknessMm }], '调整墙体厚度')}/>
      <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'reverseWall', id: selected }], '反转墙端点，保持开口位置')}>预览反转墙端点</button>
    </fieldset><dl className="asset-facts"><dt>附着开口</dt><dd>{openings.length} 个</dd>{openings.map(opening => <span className="asset-opening-fact" key={opening.id}><dt>{opening.kind === 'window' ? '窗户' : '门'}净宽</dt><dd>{opening.widthMm} mm</dd></span>)}</dl>{clear}</>
  }
  if (point && terrain) return <><div className="asset-section-heading"><PencilRuler size={16}/><h2>露台轮廓</h2></div><p className="asset-muted">修改开放表面边界，保留铺装实尺寸与独立物件。</p><fieldset disabled={busy || terrain.editLocked}>
    <NumberInput label="轮廓点 X" value={point.positionMm.x} onCommit={x => onPreview([{ type: 'moveTerrainPoint', areaId: terrain.id, pointId: selected, positionMm: { ...point.positionMm, x } }], '调整露台边界')}/>
    <NumberInput label="轮廓点 Y" value={point.positionMm.y} onCommit={y => onPreview([{ type: 'moveTerrainPoint', areaId: terrain.id, pointId: selected, positionMm: { ...point.positionMm, y } }], '调整露台边界')}/>
  </fieldset>{clear}</>
  if (surface) {
    const style = room ? room.floorStyle : area.surfaceStyle
    return <><div className="asset-section-heading"><Layers3 size={16}/><h2>表面与铺装</h2></div><h3>{room?.purpose || '石板露台'}</h3><p className="asset-muted">改变外观保留墙、门、占地和高程。纹理以毫米平铺，扩大轮廓不会拉伸图片。</p>{style && <fieldset disabled={busy || surface.editLocked}>
      <label className="asset-select">地面材质<select aria-label="地面材质" value={style.base.materialRef.id} onChange={event => onCommit(() => workspace.execute([{ type: 'setSurfaceMaterial', kind: surfaceKind, id: selected, materialRef: { id: event.target.value, version: scene.materials[event.target.value].version } }]))}>{Object.values(scene.materials).filter(material => material.applicableSurfaces.includes(room ? 'room' : 'terrain')).map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
      <NumberInput label="木纹方向" value={style.base.rotationDeg} unit="°" onCommit={rotationDeg => onCommit(() => workspace.execute([{ type: 'setSurfacePaint', kind: surfaceKind, id: selected, changes: { rotationDeg } }]))}/>
      <details className="asset-details"><summary>铺装尺寸与锚点</summary><NumberInput label="铺装宽度" value={style.base.tileSizeMm.width} onCommit={width => onCommit(() => workspace.execute([{ type: 'setSurfacePaint', kind: surfaceKind, id: selected, changes: { tileSizeMm: { ...style.base.tileSizeMm, width } } }]))}/><NumberInput label="铺装长度" value={style.base.tileSizeMm.height} onCommit={height => onCommit(() => workspace.execute([{ type: 'setSurfacePaint', kind: surfaceKind, id: selected, changes: { tileSizeMm: { ...style.base.tileSizeMm, height } } }]))}/><NumberInput label="铺装原点 X" value={style.base.originMm.x} onCommit={x => onCommit(() => workspace.execute([{ type: 'setSurfacePaint', kind: surfaceKind, id: selected, changes: { originMm: { ...style.base.originMm, x } } }]))}/><NumberInput label="铺装原点 Y" value={style.base.originMm.y} onCommit={y => onCommit(() => workspace.execute([{ type: 'setSurfacePaint', kind: surfaceKind, id: selected, changes: { originMm: { ...style.base.originMm, y } } }]))}/></details>
    </fieldset>}{clear}</>
  }
  const opening = scene.openings[selected]
  if (opening) return <><div className="asset-section-heading"><PencilRuler size={16}/><h2>{opening.kind === 'window' ? '窗户' : '门'}信息</h2></div><dl className="asset-facts"><dt>净宽</dt><dd>{opening.widthMm} mm</dd><dt>稳定端点</dt><dd>{opening.offsetReferenceVertexId}</dd><dt>近端偏移</dt><dd>{opening.offsetMm} mm</dd><dt>状态</dt><dd>{opening.state === 'open' ? '开启' : '关闭'}</dd></dl><button className="asset-group-link" onClick={() => onSelect(opening.wallId)}>选择附着墙体</button>{clear}</>
  return <p className="asset-muted">该对象暂未开放属性编辑。{clear}</p>
}
