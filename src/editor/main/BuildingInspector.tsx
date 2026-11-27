import { supportsWallReliefStyle } from '../../shared/appearance/wall-edge-profile.js'
import { useMemo, useState } from 'react'
import { LockKeyhole, PencilRuler, Plus } from 'lucide-react'
import { newId } from './runtime'
import type { SceneCommand } from '../../shared/commands/commands'
import { effectiveEditLocked } from '../../shared/commands/layers'
import type { SceneDocument } from '../../shared/model/scene'
import { defaultOpeningHeight, spatialWallHeight, wallHeightSchema } from '../../shared/model/building-height'
import { wideDoorPresentation, type DoorPresentation } from '../../shared/model/door-presentation'
import { NumberInput } from '../native-canvas/controls'
import { formatDistanceMm } from '../native-canvas/building-session'
import type { AnnotationCommand } from '../../shared/commands/annotations'
import BuildingEditTools from './BuildingEditTools'
import EntityLockNotice from './EntityLockNotice'
import AttachmentTools from './AttachmentTools'
import { prepareRoadDoorStart, type RoadDoorStartRequest } from './road-door-start'
import type { AppearanceGraph } from '../../shared/model/appearance.js'
import { PlayerCoverageError, type PlayerCoverageIssue } from '../../shared/projection/projection.js'
import { coverageRepairCommands, type BuildingPreviewRequest } from './building-privacy-review.js'
import { planMaskRefit } from './privacy-mask-plan.js'
import RoomPrivacyControls from './RoomPrivacyControls.js'
import PrivacyCoverageNotice from './PrivacyCoverageNotice.js'
import { roomMoveParts } from '../../shared/commands/building'
import { placedObjectIds } from '../../shared/aggregates/placement-relations'
import { createEntityLabeler } from './entity-label'

type Props = { scene: SceneDocument; materialChoices?: SceneDocument['materials']; appearance?: AppearanceGraph; selected: string; layerId: string; disabled: boolean; onPreview: BuildingPreviewRequest; onSelect: (id: string | null) => void; onLock: (kind: 'vertex' | 'room' | 'wall' | 'opening' | 'note' | 'region', id: string, locked: boolean) => void; onOpenLayers?: () => void; onRoadDoorStart?: (request: RoadDoorStartRequest) => void }
export default function BuildingInspector({ scene, materialChoices = scene.materials, appearance, selected, layerId, disabled, onPreview: requestPreview, onSelect, onLock, onOpenLayers, onRoadDoorStart }: Props) {
  const room = scene.rooms[selected], wall = scene.walls[selected], vertex = scene.vertices[selected], opening = scene.openings[selected], note = scene.notes[selected], region = scene.regions[selected]
  const [contentsOpen, setContentsOpen] = useState(false)
  const moveParts = useMemo(() => room && roomMoveParts(scene, room.id), [scene, room])
  const contents = useMemo(() => {
    if (!room || !moveParts || !contentsOpen) return []
    const label = createEntityLabeler(scene)
    const hosts = [room.id, ...room.boundaryVertexIds, ...moveParts.walls.map(wall => wall.id)]
    return placedObjectIds(scene, hosts).map(id => ({ id, name: label(id) }))
  }, [scene, room, moveParts, contentsOpen])
  const entity = room ?? wall ?? vertex ?? opening ?? note ?? region
  const kind = room ? 'room' : wall ? 'wall' : vertex ? 'vertex' : opening ? 'opening' : note ? 'note' : 'region'
  const [purpose, setPurpose] = useState(room?.purpose ?? ''), [visibility, setVisibility] = useState(room?.visibility ?? note?.visibility ?? 'public')
  const [access, setAccess] = useState(room?.accessExpectation ?? 'unspecified')
  const [material, setMaterial] = useState(room?.floorStyle?.base.materialRef.id ?? wall?.topStyle?.base.materialRef.id ?? '')
  const [wallPaint, setWallPaint] = useState({ rotationDeg: wall?.topStyle?.base.rotationDeg ?? 0,
    tileSizeMm: wall?.topStyle?.base.tileSizeMm ?? { width: 1440, height: 1440 },
    originMm: wall?.topStyle?.base.originMm ?? { x: 0, y: 0 } })
  const [openingKind, setOpeningKind] = useState<'door' | 'window'>(opening?.kind ?? 'door'), [offset, setOffset] = useState(opening?.offsetMm ?? 1000), [width, setWidth] = useState(opening?.widthMm ?? 900)
  const savedPresentation = opening?.presentation
  const [openingPose, setOpeningPose] = useState(savedPresentation ? savedPresentation.kind === 'frame' ? 'frame' : `${savedPresentation.kind}-${savedPresentation.side}` : opening ? 'legacy' : 'auto')
  const [roadWidth, setRoadWidth] = useState(opening?.widthMm ?? 1000), [roadError, setRoadError] = useState<string | null>(null)
  const [reference, setReference] = useState(opening?.offsetReferenceVertexId ?? wall?.startVertexId ?? '')
  const [state, setState] = useState<'open' | 'closed'>(opening?.state ?? 'closed'), [doorLocked, setDoorLocked] = useState(opening?.locked ?? false), [secret, setSecret] = useState(opening?.secret ?? false), [revealed, setRevealed] = useState(opening?.revealed ?? false)
  const [entrance, setEntrance] = useState(scene.constraints.entranceOpeningIds.includes(selected))
  const [noteKind, setNoteKind] = useState<'note' | 'clue' | 'label'>(note?.kind ?? 'clue'), [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(note?.text ?? ''), [anchorMode, setAnchorMode] = useState<'point' | 'entity'>(note?.anchor.type ?? 'point')
  const [anchorId, setAnchorId] = useState(note?.anchor.type === 'entity' ? note.anchor.entityId : room?.id ?? wall?.id ?? opening?.id ?? vertex?.id ?? '')
  const [point, setPoint] = useState(note?.anchor.type === 'point' ? note.anchor.positionMm : { x: 3000, y: 3000 })
  const [wallThickness, setWallThickness] = useState(wall?.thicknessMm ?? 100)
  const openingWall = opening ? scene.walls[opening.wallId] : wall
  const shownWallHeight = openingWall ? spatialWallHeight(openingWall) : 1100
  const [wallHeightMm, setWallHeightMm] = useState(Math.round(shownWallHeight))
  const [customOpening, setCustomOpening] = useState(!!opening?.vertical)
  const [sillMm, setSill] = useState(opening?.vertical?.sillMm ?? (opening?.kind === 'window' ? Math.floor(shownWallHeight * .54) : 0))
  const [openingHeightMm, setOpeningHeightMm] = useState(opening?.vertical?.heightMm ?? Math.max(1, Math.floor(shownWallHeight * (opening?.kind === 'window' ? .39 : .95))))
  const openingVertical = customOpening ? { sillMm, heightMm: openingHeightMm } : null
  const doorPresentation: DoorPresentation | undefined = openingKind === 'window' || openingPose === 'legacy' ? undefined
    : openingPose === 'auto' ? wideDoorPresentation(openingKind, width) : openingPose === 'frame' ? { kind: 'frame' }
      : { kind: openingPose.startsWith('double') ? 'double' : 'single', side: openingPose.endsWith('right') ? 'right' : 'left' }
  const presentationField = openingKind === 'door' && <label className="building-field">开启时的门扇<select aria-label="门扇表现" value={openingPose} onChange={e => setOpeningPose(e.target.value)}>
    <option value="auto">按净宽选择</option><option value="legacy">原版单扇</option><option value="single-left">单扇 · 左侧开启</option><option value="single-right">单扇 · 右侧开启</option>
    <option value="double-left">双扇 · 左侧开启</option><option value="double-right">双扇 · 右侧开启</option><option value="frame">只显示门框</option>
  </select></label>
  const openingFits = !openingVertical || sillMm >= 0 && openingHeightMm > 0 && sillMm + openingHeightMm <= shownWallHeight
  const [wallMove, setWallMove] = useState({ x: 0, y: 0 })
  const [roomOffset, setRoomOffset] = useState({ x: 0, y: 0 })
  const [openingsToMove, setOpeningsToMove] = useState<string[]>([])
  const [position, setPosition] = useState({ x: vertex?.xMm ?? 0, y: vertex?.yMm ?? 0 })
  const b = region?.boundaryMm
  const [mask, setMask] = useState({ x: b?.[0].x ?? 0, y: b?.[0].y ?? 0, width: b ? Math.max(...b.map(p => p.x)) - Math.min(...b.map(p => p.x)) : 1000, height: b ? Math.max(...b.map(p => p.y)) - Math.min(...b.map(p => p.y)) : 1000 })
  const [coverageFailure, setCoverageFailure] = useState<{ commands: SceneCommand[]; description: string; issues: readonly PlayerCoverageIssue[] } | null>(null)
  const [coverageRepairError, setCoverageRepairError] = useState<string | null>(null)
  const onPreview: BuildingPreviewRequest = (commands, description, privacy) => {
    setCoverageFailure(null); setCoverageRepairError(null)
    requestPreview(commands, description, privacy, error => {
      if (error instanceof PlayerCoverageError) setCoverageFailure({ commands, description, issues: error.issues })
    })
  }
  const previewMaskRefit = () => {
    try {
      const { commands, floorId } = planMaskRefit(scene, appearance, selected, newId)
      onPreview(commands, '收紧固定遮罩，恢复可显示的公开空间', { floorId })
    } catch (error) { setCoverageRepairError(error instanceof Error ? error.message : String(error)) }
  }
  const existingEntityAnchor = note?.anchor.type === 'entity' ? note.anchor : null
  if (!entity) return null
  const locked = effectiveEditLocked(scene, selected), ownLayerLocked = scene.userLayers[scene.entityLayers[selected]]?.editLocked
  const choices = [...Object.values(scene.rooms).map(item => ({ ...item, kind: 'room' as const, name: item.purpose || item.id })), ...Object.values(scene.walls).map(item => ({ ...item, kind: 'wall' as const, name: `墙 · ${item.id}` })), ...Object.values(scene.openings).map(item => ({ ...item, kind: 'opening' as const, name: `${item.kind === 'door' ? '门' : '窗'} · ${item.id}` })), ...Object.values(scene.vertices).map(item => ({ ...item, kind: 'vertex' as const, name: `顶点 · ${item.id}` })), ...Object.values(scene.notes).filter(item => item.id !== selected).map(item => ({ ...item, kind: 'note' as const, name: `注记 · ${item.title || item.id}` }))]
  const anchor = () => anchorMode === 'point' ? { type: 'point' as const, positionMm: point } : { type: 'entity' as const, entityKind: choices.find(item => item.id === anchorId)?.kind ?? (note?.anchor.type === 'entity' && note.anchor.entityId === anchorId ? note.anchor.entityKind : 'room' as const), entityId: anchorId }
  const makeNote = () => onPreview([{ type: 'createNote', id: newId(), floorId: entity.floorId, layerId, anchor: { type: 'entity', entityKind: kind, entityId: selected }, kind: 'clue', text, visibility }], '添加附属线索')
  const wallMoveCommands = (): SceneCommand[] => wall ? [{ type: 'translateWall', id: wall.id, offsetMm: wallMove }] : []
  const startRoad = () => {
    if (!opening || !onRoadDoorStart || disabled) return
    try {
      setRoadError(null)
      const request = { document: scene, openingId: opening.id, widthMm: roadWidth }
      prepareRoadDoorStart(scene, request)
      onRoadDoorStart(request)
    } catch (error) { setRoadError(error instanceof Error ? error.message : String(error)) }
  }
  const portalFields = <><label className="building-field">类型<select aria-label="开口类型" value={openingKind} onChange={e => setOpeningKind(e.target.value as typeof openingKind)}><option value="door">门</option><option value="window">窗</option></select></label><label className="building-field">从墙哪端量起<select aria-label="开口基准端点" value={reference} onChange={e => setReference(e.target.value)}>{[scene.walls[opening?.wallId ?? selected]?.startVertexId, scene.walls[opening?.wallId ?? selected]?.endVertexId].filter(Boolean).map((id, index) => <option value={id} key={id}>{index === 0 ? '起点' : '终点'} · {formatDistanceMm(scene.vertices[id].xMm, scene.units.display)}, {formatDistanceMm(scene.vertices[id].yMm, scene.units.display)}</option>)}</select></label><NumberInput displayUnit={scene.units.display} label="距该端的距离" ariaLabel="开口近端偏移" value={offset} onCommit={setOffset}/><NumberInput displayUnit={scene.units.display} label="门窗净宽" ariaLabel="开口净宽" value={width} onCommit={setWidth}/><label className="building-field">门窗状态<select aria-label="门窗状态" value={state} onChange={e => setState(e.target.value as typeof state)}><option value="closed">关闭</option><option value="open">开启</option></select></label><label className="building-check"><input type="checkbox" aria-label="门通行锁" checked={doorLocked} onChange={e => setDoorLocked(e.target.checked)}/>通行锁</label><label className="building-check"><input type="checkbox" aria-label="秘密开口" checked={secret} onChange={e => setSecret(e.target.checked)}/>秘密开口</label><label className="building-check"><input type="checkbox" aria-label="揭示秘密开口" checked={revealed} onChange={e => setRevealed(e.target.checked)}/>已向玩家揭示</label></>
  return <div className="building-inspector" aria-label="建筑属性" onChangeCapture={() => { setCoverageFailure(null); setCoverageRepairError(null) }}>
    <div className="asset-section-heading workspace-object-fields-heading"><PencilRuler size={16} aria-hidden="true"/><h2>{room ? '房间属性' : wall ? '墙体属性' : vertex ? '建筑顶点' : opening ? opening.kind === 'door' ? '门' : '窗' : note ? '文字注记' : '固定遮罩'}</h2>
      <button type="button" className="secondary workspace-object-lock" aria-label={entity.editLocked ? '解除建筑对象编辑锁' : '锁定建筑对象'} disabled={disabled || ownLayerLocked} onClick={() => onLock(kind, selected, !entity.editLocked)}><LockKeyhole size={14} aria-hidden="true"/>{entity.editLocked ? '解锁' : '锁定'}</button>
    </div>
    <EntityLockNotice scene={scene} id={selected} onSelect={onSelect} onOpenLayers={onOpenLayers}/>
    {coverageFailure && <PrivacyCoverageNotice scene={scene} issues={coverageFailure.issues} disabled={disabled || locked} onRepair={() => {
      try {
        const commands = coverageRepairCommands(scene, coverageFailure.commands, coverageFailure.issues, entity.floorId, layerId, newId)
        onPreview(commands, `${coverageFailure.description}并补齐保密覆盖`, { floorId: entity.floorId, coverageIssues: coverageFailure.issues })
      } catch (error) { setCoverageRepairError(error instanceof Error ? error.message : String(error)) }
    }}/>} {coverageRepairError && <p role="alert" className="asset-form-error">{coverageRepairError}</p>}
    {opening?.kind === 'door' && onRoadDoorStart && <section className="building-details" aria-label="从门口开始道路" data-road-door-start>
      <h3>从门口接路</h3>
      <p className="asset-muted">使用工程里已采用的门和真实门前位置；仅支持公开、已打开且未上锁的正交外门与同一可步行地形支撑。当前未采用的门窗修改不会带入，也不会自动开门或改动工程。</p>
      <NumberInput displayUnit={scene.units.display} label="道路净宽" ariaLabel="门前道路净宽" value={roadWidth} onCommit={value => { setRoadWidth(value); setRoadError(null) }}/>
      <button type="button" className="secondary asset-wide" disabled={disabled} onClick={startRoad}>从此门口接路</button>
      {roadError && <p role="alert" className="asset-form-error">{roadError}</p>}
    </section>}
    <fieldset disabled={disabled || locked}>
      {room && <>
        <label className="building-field">房间名称<input aria-label="编辑房间名称" value={purpose} onChange={e => setPurpose(e.target.value)}/></label>
        <label className="building-field">房间可见性<select aria-label="房间可见性" value={visibility} onChange={e => setVisibility(e.target.value as typeof visibility)}><option value="public">玩家可见</option><option value="gm">仅主持人</option></select></label>
        <label className="building-field">结构连通要求<select aria-label="房间连通要求" value={access} onChange={e => setAccess(e.target.value as typeof access)}><option value="unspecified">草稿 · 未指定</option><option value="required">须连接入口</option><option value="intentionalIsolation">明确孤立</option></select></label>
        {visibility === 'gm' ? <RoomPrivacyControls scene={scene} appearance={appearance} roomId={selected} purpose={purpose} accessExpectation={access} layerId={layerId} onPreview={onPreview}/>
          : <button className="primary asset-wide" onClick={() => onPreview([{ type: 'updateRoom', id: selected, changes: { purpose, visibility, accessExpectation: access } }], '修改房间属性')}>预览房间属性</button>}
        <details className="workspace-detail-disclosure"><summary>边界顶点 · {room.boundaryVertexIds.length} 个</summary><div className="workspace-room-vertices">{room.boundaryVertexIds.map((id, index) => <button type="button" className="asset-group-link" key={id} onClick={() => onSelect(id)}>顶点 {index + 1} · {formatDistanceMm(scene.vertices[id].xMm, scene.units.display)}, {formatDistanceMm(scene.vertices[id].yMm, scene.units.display)}</button>)}</div></details>
        <details className="workspace-detail-disclosure" onToggle={event => setContentsOpen(event.currentTarget.open)}><summary>房间关联对象</summary>
          {contentsOpen && (contents.length ? <select data-aggregate-session-control aria-label="选择房间关联对象" value="" onChange={event => onSelect(event.target.value)}>
            <option value="" disabled>选择对象（{contents.length} 个）</option>{contents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select> : <p>尚无关联对象。</p>)}
        </details>
        <details className="workspace-detail-disclosure"><summary>移动这一间房</summary>
          <NumberInput displayUnit={scene.units.display} label="房间平移 X" value={roomOffset.x} onCommit={x => setRoomOffset(current => ({ ...current, x }))}/>
          <NumberInput displayUnit={scene.units.display} label="房间平移 Y" value={roomOffset.y} onCommit={y => setRoomOffset(current => ({ ...current, y }))}/>
          {!!moveParts?.sharedWalls.length && <p>移动会分开 {moveParts.sharedWalls.length} 面共墙。</p>}
          {!!moveParts?.sharedOpenings.length && <fieldset><legend>选择要随房间移动的共墙门窗</legend>
            {moveParts.sharedOpenings.map(opening => <label className="building-check" key={opening.id}>
              <input type="checkbox" checked={openingsToMove.includes(opening.id)} onChange={event => setOpeningsToMove(current => event.target.checked ? [...current, opening.id] : current.filter(id => id !== opening.id))}/>
              {opening.kind === 'door' ? '门' : '窗'} · {opening.id}{opening.secret ? ' · 秘密' : ''}
            </label>)}<small>未选择的门窗留在原墙。</small>
          </fieldset>}
          <button type="button" className="secondary asset-wide" disabled={!roomOffset.x && !roomOffset.y} onClick={() => onPreview([
            { type: 'moveRoom', id: room.id, offsetMm: roomOffset, splitId: newId(), openingsToMove },
          ], '移动单间房及其墙面')}>预览移动这间房</button>
        </details>
      </>}
      {room && <><h3>地面材质</h3><label className="building-field">固定材质<select aria-label="编辑房间地面材质" value={material} onChange={event => setMaterial(event.target.value)}><option value="">选择固定材质</option>{Object.values(materialChoices).filter(item => item.applicableSurfaces.includes('room')).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button className="secondary asset-wide" disabled={!materialChoices[material]} onClick={() => onPreview([{ type: 'setSurfaceMaterial', kind: 'room', id: room.id, materialRef: { id: material, version: materialChoices[material].version } }], '修改房间地面材质，保留支撑、高程和占地')}>预览房间地面材质</button><small>地面高程 {room.groundElevationMm} mm · 支撑 {room.supportRef.id}。换材质保留几何与通行。</small></>}
      {wall && <><h3>墙面材质</h3><label className="building-field">固定材质<select aria-label="编辑墙面材质" value={material} onChange={event => setMaterial(event.target.value)}><option value="">选择固定材质</option>{Object.values(materialChoices).filter(item => item.applicableSurfaces.includes('wall')).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button className="secondary asset-wide" disabled={!materialChoices[material]} onClick={() => onPreview([{ type: 'setSurfaceMaterial', kind: 'wall', id: wall.id, materialRef: { id: material, version: materialChoices[material].version } }], '修改墙面材质，保留墙厚、开口与通行')}>预览墙面材质</button>
        {wall.topStyle && <details className="building-details"><summary>墙顶纹理方向与尺寸</summary><p className="asset-muted">尺寸表示整张纹理的一次平铺周期。修改只作用于墙顶外观，保留墙厚与门窗净宽。</p>
          <NumberInput label="墙顶纹理方向" unit="°" value={wallPaint.rotationDeg} onCommit={rotationDeg => setWallPaint(value => ({ ...value, rotationDeg }))}/>
          <NumberInput displayUnit={scene.units.display} label="墙顶平铺宽度" value={wallPaint.tileSizeMm.width} onCommit={width => setWallPaint(value => ({ ...value, tileSizeMm: { ...value.tileSizeMm, width } }))}/>
          <NumberInput displayUnit={scene.units.display} label="墙顶平铺长度" value={wallPaint.tileSizeMm.height} onCommit={height => setWallPaint(value => ({ ...value, tileSizeMm: { ...value.tileSizeMm, height } }))}/>
          <NumberInput displayUnit={scene.units.display} label="墙顶原点 X" value={wallPaint.originMm.x} onCommit={x => setWallPaint(value => ({ ...value, originMm: { ...value.originMm, x } }))}/>
          <NumberInput displayUnit={scene.units.display} label="墙顶原点 Y" value={wallPaint.originMm.y} onCommit={y => setWallPaint(value => ({ ...value, originMm: { ...value.originMm, y } }))}/>
          <button className="secondary asset-wide" onClick={() => setWallPaint(value => ({ ...value, tileSizeMm: { ...scene.materials[wall.topStyle!.base.materialRef.id].defaultTileSizeMm } }))}>使用墙顶材质默认尺寸</button>
          <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'setSurfacePaint', kind: 'wall', id: wall.id, changes: wallPaint }], '修改墙顶纹理方向、尺寸与锚点，保留墙厚和门窗净宽')}>预览墙顶铺装修改</button>
        </details>}</>}
      {wall && <details className="building-details"><summary>斜俯视墙高</summary>
        <NumberInput displayUnit={scene.units.display} label="墙高" value={wallHeightMm} onCommit={setWallHeightMm}/>
        <button type="button" className="secondary asset-wide" disabled={!wallHeightSchema.safeParse(wallHeightMm).success || wallHeightMm === wall.heightMm}
          onClick={() => onPreview([{ type: 'setWallHeight', id: wall.id, heightMm: wallHeightMm }], '调整斜俯视墙高')}>预览墙高</button>
        {wall.heightMm !== undefined && <button type="button" className="secondary asset-wide"
          onClick={() => onPreview([{ type: 'setWallHeight', id: wall.id, heightMm: null }], '恢复自动墙高')}>恢复自动墙高</button>}
      </details>}
      {opening && <details className="building-details"><summary>斜俯视洞口高度</summary>
        <label className="building-check"><input type="checkbox" checked={customOpening} onChange={event => setCustomOpening(event.target.checked)}/>自定义门窗高度</label>
        {customOpening && <>
          <NumberInput displayUnit={scene.units.display} label="洞口底边离地" value={sillMm} onCommit={setSill}/>
          <NumberInput displayUnit={scene.units.display} label="洞口高度" value={openingHeightMm} onCommit={setOpeningHeightMm}/>
          {!openingFits && <small>洞口顶边须在墙高内。</small>}
        </>}
        <button type="button" className="secondary asset-wide" disabled={!openingFits}
          onClick={() => onPreview([{ type: 'updateOpening', id: opening.id, changes: { vertical: openingVertical } }], '调整斜俯视门窗高度')}>预览洞口高度</button>
      </details>}
      {vertex && <><div className="workspace-field-pair" role="group" aria-label="建筑顶点位置"><NumberInput displayUnit={scene.units.display} label="建筑顶点 X" value={position.x} onCommit={x => setPosition(p => ({ ...p, x }))}/><NumberInput displayUnit={scene.units.display} label="建筑顶点 Y" value={position.y} onCommit={y => setPosition(p => ({ ...p, y }))}/></div><button className="primary asset-wide" onClick={() => onPreview([{ type: 'moveVertex', id: selected, positionMm: position }], '移动建筑顶点')}>预览顶点修改</button></>}
      {wall && <><details className="building-details"><summary>墙体外缘</summary><p className="asset-muted">块石外缘用于遗迹石灰岩墙，最多外伸 4.5 厘米。通行尺寸仍按墙厚计算。</p><button className="secondary asset-wide" disabled={!wall.edgeProfile && !supportsWallReliefStyle(wall.topStyle)} onClick={() => onPreview([{ type: 'setWallEdgeProfile', id: wall.id, profile: wall.edgeProfile ? 'straight' : 'stone-blocks-v1' }], wall.edgeProfile ? '恢复平直墙体外缘' : '预览块石外缘和门洞收口')}>{wall.edgeProfile ? '预览恢复平直外缘' : '预览块石外缘'}</button></details><NumberInput displayUnit="cm" label="编辑墙厚" value={wallThickness} onCommit={setWallThickness}/><button className="primary asset-wide" onClick={() => onPreview([{ type: 'setWallThickness', id: selected, thicknessMm: wallThickness }], '调整墙厚')}>预览墙厚修改</button><div className="building-tools"><button className="secondary" onClick={() => onSelect(wall.startVertexId)}>起点</button><button className="secondary" onClick={() => onSelect(wall.endVertexId)}>终点</button><button className="secondary" onClick={() => onPreview([{ type: 'reverseWall', id: selected }], '反转墙方向，保持开口位置')}>反转方向</button></div><h3>在这面墙上添加门窗</h3><p className="asset-muted">先选从哪端量起，再设置门窗近边与该端的距离。预览后可在地图核对位置。</p>{portalFields}{presentationField}<button className="primary asset-wide" onClick={() => onPreview([{ type: 'addOpening', id: newId(), wallId: selected, offsetReferenceVertexId: reference, offsetMm: offset, widthMm: width, kind: openingKind, vertical: defaultOpeningHeight(wall, openingKind), state, locked: doorLocked, secret, revealed, layerId,
        ...(doorPresentation ? { presentation: doorPresentation } : {}) }], '添加附着门窗')}><Plus size={14}/>预览新增门窗</button></>}
      {opening && <>{portalFields}{presentationField}<button className="primary asset-wide" onClick={() => onPreview([{ type: 'updateOpening', id: selected, changes: { offsetReferenceVertexId: reference, offsetMm: offset, widthMm: width, kind: openingKind, state, locked: doorLocked, secret, revealed,
        ...(doorPresentation ? { presentation: doorPresentation } : savedPresentation ? { presentation: null } : {}) } }], '修改附着门窗')}>预览门窗修改</button><label className="building-check"><input type="checkbox" aria-label="设为外部入口" checked={entrance} onChange={event => setEntrance(event.target.checked)}/>外部入口</label><button className="secondary asset-wide" onClick={() => onPreview([{ type: 'setEntranceOpenings', ids: entrance ? [...new Set([...scene.constraints.entranceOpeningIds, selected])] : scene.constraints.entranceOpeningIds.filter(id => id !== selected) }], '调整外部入口集合')}>预览入口修改</button><button className="secondary asset-wide" onClick={() => onSelect(opening.wallId)}>选择附着墙体</button><button className="history-danger asset-wide" onClick={() => onPreview([{ type: 'deleteOpening', id: selected }], '删除门窗')}>预览删除门窗</button></>}
      {wall && <details className="building-details"><summary>平移整面墙</summary>
        <p className="asset-muted">也可拖动画布上的墙中点柄。同时移动两端，共享顶点、邻墙与房间会随之调整。附着门窗保留稳定端点和沿墙距离，采用前核对完整影响。</p>
        <div className="workspace-field-pair" role="group" aria-label="整墙平移"><NumberInput displayUnit={scene.units.display} label="墙平移 X" value={wallMove.x} onCommit={x => setWallMove(value => ({ ...value, x }))}/><NumberInput displayUnit={scene.units.display} label="墙平移 Y" value={wallMove.y} onCommit={y => setWallMove(value => ({ ...value, y }))}/></div>
        <button className="secondary asset-wide" disabled={wallMove.x === 0 && wallMove.y === 0} onClick={() => onPreview(wallMoveCommands(), '平移整面墙，核对附着门窗及共享结构')}>预览整墙平移</button>
        <p className="asset-muted">需要让墙端精确接入另一面墙时，显式选择下方修复：在本候选中共用接点并拆分墙段。内部交叉、共线重叠及跨门窗拆分会拒绝。</p>
        <button className="secondary asset-wide" disabled={wallMove.x === 0 && wallMove.y === 0} onClick={() => onPreview([...wallMoveCommands(), { type: 'repairBuildingTopology', id: wall.id, operation: 'splitJunctions' }], '平移墙并修复精确接点，核对拆墙与门窗映射')}>预览平移并修复接点</button>
      </details>}
      {wall && <details className="building-details"><summary>通行与视线</summary>
        <button type="button" className="secondary asset-wide" onClick={() => onPreview([{ type: 'setWallBlocking', id: wall.id, blocksMovement: !wall.blocksMovement, blocksSight: wall.blocksSight }], '调整墙体的通行阻挡')}>
          {wall.blocksMovement ? '预览允许穿行' : '预览阻挡移动'}
        </button>
        <button type="button" className="secondary asset-wide" onClick={() => onPreview([{ type: 'setWallBlocking', id: wall.id, blocksMovement: wall.blocksMovement, blocksSight: !wall.blocksSight }], '调整墙体的视线遮挡')}>
          {wall.blocksSight ? '预览允许视线穿过' : '预览遮挡视线'}
        </button>
      </details>}
      {region?.kind === 'manualMask' && <><div className="workspace-field-pair" role="group" aria-label="固定遮罩位置与尺寸">{(['x', 'y', 'width', 'height'] as const).map((key, i) => <NumberInput displayUnit={scene.units.display} key={key} label={['编辑遮罩 X', '编辑遮罩 Y', '编辑遮罩宽度', '编辑遮罩高度'][i]} value={mask[key]} onCommit={value => setMask(p => ({ ...p, [key]: value }))}/>)}</div><button className="primary asset-wide" onClick={() => onPreview([{ type: 'upsertManualMask', id: selected, floorId: entity.floorId, boundsMm: mask }], '修改固定玩家遮罩')}>预览遮罩修改</button><button type="button" className="secondary asset-wide" onClick={previewMaskRefit}>预览收紧遮罩</button><button className="history-danger asset-wide" onClick={() => onPreview([{ type: 'deleteManualMask', id: selected }], '删除固定遮罩，玩家出图须重新校验')}>预览删除遮罩</button></>}
      {note && <><label className="building-field">类型<select aria-label="编辑注记类型" value={noteKind} onChange={e => setNoteKind(e.target.value as typeof noteKind)}><option value="label">文字标签</option><option value="note">笔记</option><option value="clue">线索</option></select></label>{noteKind !== 'label' && <label className="building-field">地图标题<input aria-label="编辑注记标题" value={title} maxLength={500} onChange={e => setTitle(e.target.value)}/></label>}<label className="building-field">{noteKind === 'label' ? '地图文字' : '详细内容'}<textarea aria-label="编辑注记内容" value={text} rows={5} onChange={e => setText(e.target.value)}/></label><p className="asset-muted">{noteKind === 'label' ? '标签正文直接显示在地图上。' : '地图优先显示标题；标题为空时显示正文。详细内容保存在注记中。'}</p><label className="building-field">可见性<select aria-label="注记可见性" value={visibility} onChange={e => setVisibility(e.target.value as typeof visibility)}><option value="gm">仅主持人</option><option value="public">玩家可见</option></select></label><label className="building-field">锚点方式<select aria-label="注记锚点方式" value={anchorMode} onChange={e => setAnchorMode(e.target.value as typeof anchorMode)}><option value="point">固定坐标</option><option value="entity">附着建筑对象</option></select></label>{anchorMode === 'point' ? <div className="workspace-field-pair" role="group" aria-label="注记位置"><NumberInput displayUnit={scene.units.display} label="注记 X" value={point.x} onCommit={x => setPoint(p => ({ ...p, x }))}/><NumberInput displayUnit={scene.units.display} label="注记 Y" value={point.y} onCommit={y => setPoint(p => ({ ...p, y }))}/></div> : <label className="building-field">附着对象<select aria-label="注记附着对象" value={anchorId} onChange={e => setAnchorId(e.target.value)}><option value="">选择附着对象</option>{existingEntityAnchor && !choices.some(item => item.id === existingEntityAnchor.entityId) && <option value={existingEntityAnchor.entityId}>现有附着对象 · {existingEntityAnchor.entityId}</option>}{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<button className="primary asset-wide" onClick={() => onPreview([{ type: 'updateNote', id: selected, changes: { kind: noteKind, ...(title === (note.title ?? '') ? {} : { title }), text, visibility, anchor: anchor() } } as AnnotationCommand], '修改文字注记')}>预览注记修改</button><button className="history-danger asset-wide" onClick={() => onPreview([{ type: 'deleteNote', id: selected }], '删除文字注记')}>预览删除注记</button></>}
      {!note && !region && <details className="building-details"><summary>附着线索 / 文字</summary><label className="building-field">线索内容<textarea aria-label="附着线索内容" value={text} rows={3} onChange={e => setText(e.target.value)}/></label><label className="building-field">线索可见性<select aria-label="附着线索可见性" value={visibility} onChange={e => setVisibility(e.target.value as typeof visibility)}><option value="gm">仅主持人</option><option value="public">玩家可见</option></select></label><button className="secondary asset-wide" disabled={!text.trim()} onClick={makeNote}>预览附着线索</button></details>}
      <BuildingEditTools scene={scene} selected={selected} onPreview={onPreview}/>
      {wall && <AttachmentTools key={selected} scene={scene} id={selected} disabled={disabled} onPreview={onPreview}/>}
    </fieldset>
    <details className="workspace-detail-disclosure"><summary>对象编号与单位</summary><code className="building-stable-id">{selected}</code><p className="asset-muted">尺寸使用{scene.units.display === 'ft' ? '英尺' : '米'}，墙厚使用厘米，按最近 1 mm 保存。</p></details>
    <button className="asset-clear" onClick={() => onSelect(null)}>返回工程信息</button>
  </div>
}
