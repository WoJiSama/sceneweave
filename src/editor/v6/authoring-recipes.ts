import { openingEndpointsV2, roomPointsV2 } from '../../core/v2/geometry'
import type { BoundsMm, PointMm, SurfaceRef, SurfaceStyle, VersionRef } from '../../core/v3/types'
import { LAYER_ENTITY_COLLECTIONS_V3, type PropDefinition, type SceneDocumentV3 } from '../../core/v3/types'
import { isOutdoorCommandV3 } from '../../core/v3/outdoor'
import { applyCompositionCommandsV6 } from '../../core/v6/commands'
import type { CompositionCommandV6 } from '../../core/v6/types'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { OUTPOST_CATALOG } from './outpost-catalog'
import { OUTPOST_IDS } from './outpost-project'

export type AuthoringRecipeIdV6 = 'scn-01' | 'scn-04'
export interface AuthoringStageV6 {
  id: string
  title: string
  instructions: string[]
  status: 'complete' | 'ready' | 'blocked' | 'waiting'
  reason?: string
  commands: CompositionCommandV6[]
}
export interface AuthoringPlanV6 {
  id: AuthoringRecipeIdV6
  title: string
  stages: AuthoringStageV6[]
  requiredCatalogIds: string[]
  missingCatalogIds: string[]
  limitations: string[]
}
type Stage = Omit<AuthoringStageV6, 'status' | 'commands'> & {
  done: () => boolean
  make: () => CompositionCommandV6[]
  /** Existing targets are never partially overwritten or silently completed. */
  newIds?: string[]
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const points = (data: readonly (readonly number[])[]): PointMm[] => data.map(([x, y]) => ({ x, y }))
const ref = (id: string): VersionRef => ({ id, version: 1 })
const coordinates = (boundary: PointMm[]) => boundary.map(p => `(${p.x}, ${p.y})`).join(' → ')
const entityIds = (scene: SceneDocumentV3) => new Set(LAYER_ENTITY_COLLECTIONS_V3.flatMap(collection => Object.keys(scene[collection])))
const HOUSE_EXPORT: BoundsMm = { x: -500, y: -500, width: 19000, height: 15000 }
const HOUSE_FLOOR: BoundsMm = { x: -2000, y: -2000, width: 22000, height: 18000 }
const OUTPOST_BOUNDS: BoundsMm = { x: 0, y: 0, width: 36000, height: 28000 }
export const AUTHORING_INTERIOR_CATALOG_IDS_V6 = ['coat-rack', 'bench', 'hearth', 'worktable', 'sideboard', 'bed-single', 'wardrobe'].map(key => `prop.sw.${key}`)
const compositionTypes = new Set(['instantiatePrefab', 'createPrefab', 'duplicatePrefab', 'deletePrefab', 'detachPrefabMember', 'resetPrefabMember', 'setAppearanceSource', 'setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment'])
/** Select the existing preview surface, preserving its actual dependency review. */
export function authoringStageKindV6(commands: readonly CompositionCommandV6[]): 'building' | 'outdoor' | 'composition' | 'display' {
  if (commands.every(command => command.type === 'setSceneDisplay')) return 'display'
  if (commands.every(command => compositionTypes.has(command.type))) return 'composition'
  if (commands.every(isOutdoorCommandV3)) return 'outdoor'
  return 'building'
}
function definitionFor(scene: SceneDocumentV3, key: string): PropDefinition {
  const matches = Object.values(scene.propDefinitions).filter(definition => definition.catalogId === `prop.sw.${key}` && definition.version === 1)
  if (matches.length !== 1) throw new Error(`缺少唯一固定物件 prop.sw.${key}@1，请先从内置素材库明确采用。`)
  return matches[0]
}

function wallAt(scene: SceneDocumentV3, center: PointMm) {
  const matches = Object.values(scene.walls).filter(wall => {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    return (center.x - a.xMm) * (b.yMm - a.yMm) === (center.y - a.yMm) * (b.xMm - a.xMm)
      && center.x > Math.min(a.xMm, b.xMm) - .001 && center.x < Math.max(a.xMm, b.xMm) + .001
      && center.y > Math.min(a.yMm, b.yMm) - .001 && center.y < Math.max(a.yMm, b.yMm) + .001
  })
  if (matches.length !== 1) throw new Error(`开口中心 ${coordinates([center])} 未命中唯一墙段，请先检查房间和共墙。`)
  return matches[0]
}
type Opening = { id: string; center: PointMm; width: number; kind?: 'door' | 'window'; secret?: boolean }
function openingCommand(scene: SceneDocumentV3, value: Opening): CompositionCommandV6 {
  const wall = wallAt(scene, value.center), vertex = scene.vertices[wall.startVertexId]
  return { type: 'addOpening', id: value.id, wallId: wall.id, offsetReferenceVertexId: wall.startVertexId,
    offsetMm: Math.round(Math.hypot(value.center.x - vertex.xMm, value.center.y - vertex.yMm) - value.width / 2), widthMm: value.width,
    kind: value.kind ?? 'door', state: value.secret || value.kind === 'window' ? 'closed' : 'open', locked: false, secret: value.secret ?? false, revealed: false }
}
function openingMatches(scene: SceneDocumentV3, value: Opening) {
  const opening = scene.openings[value.id]
  if (!opening || opening.widthMm !== value.width || opening.kind !== (value.kind ?? 'door') || opening.secret !== !!value.secret || opening.revealed || opening.locked) return false
  const [a, b] = openingEndpointsV2(scene, opening)
  return (a.x + b.x) / 2 === value.center.x && (a.y + b.y) / 2 === value.center.y
    && opening.state === (value.secret || value.kind === 'window' ? 'closed' : 'open')
}
function rectangleMatches(scene: SceneDocumentV3, id: string, boundary: PointMm[], thicknessMm: number) {
  const room = scene.rooms[id]
  if (!room) return false
  const actual = roomPointsV2(scene, room), xs = boundary.map(p => p.x), ys = boundary.map(p => p.y)
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
  // Shared-wall splitting can add collinear vertices; all four original corners
  // and every intervening point must still be on the declared rectangle.
  return boundary.every(p => actual.some(q => equal(p, q))) && actual.every(p => (p.x === left || p.x === right) && p.y >= top && p.y <= bottom || (p.y === top || p.y === bottom) && p.x >= left && p.x <= right)
    && room.boundaryVertexIds.every((start, index, ids) => {
      const end = ids[(index + 1) % ids.length]
      const walls = Object.values(scene.walls).filter(wall => wall.startVertexId === start && wall.endVertexId === end || wall.startVertexId === end && wall.endVertexId === start)
      return walls.length === 1 && walls[0].thicknessMm === thicknessMm
    })
}
function materialStyle(scene: SceneDocumentV3, id: string): SurfaceStyle {
  const material = scene.materials[id]
  if (!material || material.version !== 1) throw new Error(`缺少固定材质 ${id}@1，请先从内置素材库明确采用。`)
  return { base: { materialRef: ref(id), tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
}
function buildStages(project: CompleteProjectV6, recipe: AuthoringRecipeIdV6): Stage[] {
  const scene = project.document, floors = Object.values(scene.floors)
  if (floors.length !== 1) throw new Error('制作引导只支持单 Floor 工程，请新建独立空白工程。')
  const floorId = floors[0].id, layerId = Object.values(scene.userLayers).filter(layer => layer.floorId === floorId).sort((a, b) => a.order - b.order)[0]?.id
  if (!layerId) throw new Error('请先创建同 Floor 的用户图层。')
  const stages: Stage[] = [], house = recipe === 'scn-01', expectedBounds = house ? HOUSE_EXPORT : OUTPOST_BOUNDS, floorBounds = house ? HOUSE_FLOOR : OUTPOST_BOUNDS
  const prefix = house ? 'house' : 'outpost'
  const existingGeometry = entityIds(scene)
  const hasRecipeStart = house ? !!scene.rooms.H1 : !!scene.terrainAreas[OUTPOST_IDS.water]
  if (existingGeometry.size && !hasRecipeStart) throw new Error('该工程已有其他几何，且未匹配本基线起点。请新建独立空白工程；引导不会把新场景叠加到现存工程。')
  const stage = (value: Stage) => stages.push(value)
  const newStage = (id: string, title: string, instructions: string[], newIds: string[], make: () => CompositionCommandV6[], done: () => boolean) => stage({ id, title, instructions, newIds, make, done })
  stage({ id: `${prefix}-bounds`, title: '确定固定世界与导出范围',
    instructions: [`世界范围 ${coordinates(rect(floorBounds.x, floorBounds.y, floorBounds.width, floorBounds.height))} mm。`, `固定导出范围 ${coordinates(rect(expectedBounds.x, expectedBounds.y, expectedBounds.width, expectedBounds.height))} mm；导出范围不随秘密变化。`],
    done: () => equal(scene.floors[floorId].boundsMm, floorBounds) && equal(scene.exportBoundsMm, expectedBounds),
    make: () => {
      if (entityIds(scene).size) throw new Error('起始范围尚未匹配且工程已有几何，不能用引导覆盖现存内容。请新建空白工程，或自行明确调整范围。')
      return [{ type: 'setCanvasBounds', floorId, floorBoundsMm: { ...floorBounds }, exportBoundsMm: { ...expectedBounds } }]
    } })
  const propCommand = (id: string, key: string, positionMm: PointMm, supportRef: SurfaceRef, rotationDeg = 0): CompositionCommandV6 => {
    const definition = definitionFor(scene, key)
    return { type: 'addProp', id, floorId, definitionRef: { id: definition.id, version: definition.version }, positionMm, rotationDeg, supportRef, layerId }
  }
  const propMatches = (id: string, key: string, positionMm: PointMm, supportRef: SurfaceRef, rotationDeg = 0) => {
    const prop = scene.props[id], definitions = Object.values(scene.propDefinitions).filter(definition => definition.catalogId === `prop.sw.${key}` && definition.version === 1)
    if (!prop || definitions.length !== 1) return false
    const definition = definitions[0]
    return equal(prop.definitionRef, ref(definition.id)) && equal(prop.positionMm, positionMm) && equal(prop.supportRef, supportRef) && prop.rotationDeg === rotationDeg
      && equal(prop.appearance, definition.defaultAppearance) && equal(prop.visualBoundsMm, definition.defaultVisualBoundsMm) && equal(prop.footprintMm, definition.defaultFootprintMm) && equal(prop.footprintOffsetMm, definition.defaultFootprintOffsetMm)
      && prop.blocksMovement === definition.defaultBlocksMovement && prop.blocksSight === definition.defaultBlocksSight && prop.visibility === 'public'
  }
  const prefabCommand = (id: string, definitionId: string, anchorMm: PointMm, supportRef: SurfaceRef): CompositionCommandV6 => {
    const definition = scene.prefabDefinitions[definitionId]
    if (!definition || definition.version !== 1) throw new Error(`缺少固定组合 ${definitionId}@1，请先从内置素材库明确采用。`)
    return { type: 'instantiatePrefab', id, definitionRef: ref(definitionId), anchorMm, supportRef, layerId, memberIds: Object.fromEntries(definition.members.map(member => [member.key, `${id}-${member.key}`])) }
  }
  const prefabMatches = (id: string, definitionId: string, anchorMm: PointMm, supportRef: SurfaceRef) => {
    const group = scene.prefabInstances[id], definition = scene.prefabDefinitions[definitionId]
    return !!group && !!definition && equal(group.definitionRef, ref(definitionId)) && equal(group.anchorMm, anchorMm) && group.rotationDeg === 0
      && definition.members.every(member => {
        const prop = scene.props[group.members[member.key]?.propId ?? '']
        return !!prop && equal(prop.supportRef, supportRef) && equal(prop.positionMm, { x: anchorMm.x + member.propTemplate.positionMm.x, y: anchorMm.y + member.propTemplate.positionMm.y })
          && equal(prop.definitionRef, member.propTemplate.definitionRef) && equal(prop.appearance, member.propTemplate.appearance) && equal(prop.visualBoundsMm, member.propTemplate.visualBoundsMm)
          && equal(prop.footprintMm, member.propTemplate.footprintMm) && equal(prop.footprintOffsetMm, member.propTemplate.footprintOffsetMm) && prop.rotationDeg === member.propTemplate.rotationDeg
          && prop.blocksMovement === member.propTemplate.blocksMovement && prop.blocksSight === member.propTemplate.blocksSight
      })
  }
  if (house) {
    const rooms = [
      { id: 'H1', purpose: '门厅', boundary: rect(6000, 0, 6000, 6000) },
      { id: 'H2', purpose: '厨房', boundary: rect(0, 0, 6000, 6000) },
      { id: 'H3', purpose: '餐厅', boundary: rect(0, 6000, 6000, 8000) },
      { id: 'H4', purpose: '卧室', boundary: rect(12000, 0, 6000, 6000) },
      { id: 'H5', purpose: '库房', boundary: rect(6000, 6000, 6000, 6700) },
      { id: 'H6', purpose: '书房', boundary: rect(12000, 6000, 6000, 6700) },
      { id: 'HS', purpose: '暗廊', boundary: rect(6000, 12700, 12000, 1300) },
    ]
    for (const room of rooms) newStage(`house-room-${room.id}`, `绘制${room.id} ${room.purpose}`, [
      `墙中心线：${coordinates(room.boundary)} mm；墙厚100 mm，共边沿用唯一现存墙。`, room.id === 'HS' ? '暗廊为GM私密；本步同时创建固定遮罩(5500,12200)→(18500,14500)，覆盖边界和装饰。' : '先保持合法草稿，设置九处门连接后才声明结构必达。',
    ], [room.id, ...(room.id === 'HS' ? ['SCN01-fixed-mask'] : [])], () => [
      { type: 'createRoom', id: room.id, floorId, boundaryMm: room.boundary, thicknessMm: 100, layerId, purpose: room.purpose, visibility: room.id === 'HS' ? 'gm' : 'public', materialRef: ref('b2-m-01') },
      ...(room.id === 'HS' ? [{ type: 'upsertManualMask' as const, id: 'SCN01-fixed-mask', floorId, boundsMm: { x: 5500, y: 12200, width: 13000, height: 2300 }, layerId }] : []),
    ], () => rectangleMatches(scene, room.id, room.boundary, 100) && scene.rooms[room.id].visibility === (room.id === 'HS' ? 'gm' : 'public') && scene.rooms[room.id].purpose === room.purpose && (room.id !== 'HS' || equal(scene.regions['SCN01-fixed-mask']?.boundaryMm, rect(5500, 12200, 13000, 2300))))
    const openings: Opening[] = [
      { id: 'outside-H1', center: { x: 9000, y: 0 }, width: 1200 }, { id: 'H1-H2', center: { x: 6000, y: 3000 }, width: 900 },
      { id: 'H2-H3', center: { x: 3000, y: 6000 }, width: 900 }, { id: 'H1-H4', center: { x: 12000, y: 3000 }, width: 900 },
      { id: 'H1-H5', center: { x: 9000, y: 6000 }, width: 900 }, { id: 'H4-H6', center: { x: 15000, y: 6000 }, width: 900 },
      { id: 'H3-H5', center: { x: 6000, y: 9000 }, width: 900 }, { id: 'H5-HS', center: { x: 9000, y: 12700 }, width: 900, secret: true },
      { id: 'H6-HS', center: { x: 15000, y: 12700 }, width: 900, secret: true },
      { id: 'H2-window', center: { x: 0, y: 3000 }, width: 1200, kind: 'window' }, { id: 'H3-window', center: { x: 0, y: 10000 }, width: 1200, kind: 'window' },
      { id: 'H4-window', center: { x: 18000, y: 3000 }, width: 1200, kind: 'window' },
    ]
    newStage('house-openings', '附着九门与三窗', openings.map(value => `${value.id}：中心 ${coordinates([value.center])}，净宽${value.width} mm；${value.secret ? '未揭示秘密门，关闭' : value.kind === 'window' ? '外窗' : '普通门，开启'}。`), openings.map(value => value.id), () => openings.map(value => openingCommand(scene, value)), () => openings.every(value => openingMatches(scene, value)))
    stage({ id: 'house-access', title: '声明入口与七空间结构必达', instructions: ['指定室外—H1为入口；六主要房间与暗廊均为结构必达。', '普通动线检查须把秘密门保持关闭；本引导不提供全图占地寻路。'],
      done: () => equal(scene.constraints.entranceOpeningIds, ['outside-H1']) && rooms.every(room => scene.rooms[room.id]?.accessExpectation === 'required'),
      make: () => [{ type: 'setEntranceOpenings', ids: ['outside-H1'] }, ...rooms.map(room => ({ type: 'updateRoom' as const, id: room.id, changes: { accessExpectation: 'required' as const } }))] })
    const props = [
      { id: 'H1-bench', key: 'bench', x: 7400, y: 1200, room: 'H1' }, { id: 'H1-hanger', key: 'coat-rack', x: 11000, y: 1200, room: 'H1' },
      { id: 'H2-worktop', key: 'worktable', x: 2300, y: 1500, room: 'H2' }, { id: 'H2-stove', key: 'hearth', x: 1600, y: 4300, room: 'H2' },
      { id: 'H3-cupboard', key: 'sideboard', x: 1600, y: 12400, room: 'H3' }, { id: 'H4-bed', key: 'bed-single', x: 15900, y: 2200, room: 'H4' },
      { id: 'H4-wardrobe', key: 'wardrobe', x: 16400, y: 4700, room: 'H4' }, { id: 'H5-rack', key: 'supply-rack', x: 11000, y: 8500, room: 'H5' },
      { id: 'H5-crate', key: 'crate', x: 7600, y: 11000, room: 'H5' }, { id: 'H6-bookshelf', key: 'bookshelf', x: 17000, y: 9500, room: 'H6' },
    ]
    newStage('house-furnishings', '六房基础独立家具', ['门厅衣架/长凳、厨房炉台/操作桌、餐厅边柜、卧室单床/衣柜、库房架箱、书房书架。', '七件新增室内素材须先从内置素材库明确采用；预览会检查实际占地、支撑。', ...props.map(value => `${value.id}：(${value.x}, ${value.y}) mm，显式支撑${value.room}。`)],
      props.map(value => value.id), () => props.map(value => propCommand(value.id, value.key, { x: value.x, y: value.y }, { kind: 'room', id: value.room })),
      () => props.every(value => propMatches(value.id, value.key, { x: value.x, y: value.y }, { kind: 'room', id: value.room })))
    newStage('house-table-groups', '放置餐桌椅与书桌固定组合', ['餐桌一桌两椅锚点(3000,10000) mm，支撑H3；书桌六件组锚点(15000,8800) mm，支撑H6。', '组合与独立家具分别预览；成员占地、私密性和外观源沿已有组合命令校验。'], ['H3-dining', 'H6-desk'], () => [
        prefabCommand('H3-dining', OUTPOST_CATALOG.terracePrefab, { x: 3000, y: 10000 }, { kind: 'room', id: 'H3' }),
        prefabCommand('H6-desk', OUTPOST_CATALOG.studyPrefab, { x: 15000, y: 8800 }, { kind: 'room', id: 'H6' }),
      ], () => prefabMatches('H3-dining', OUTPOST_CATALOG.terracePrefab, { x: 3000, y: 10000 }, { kind: 'room', id: 'H3' }) && prefabMatches('H6-desk', OUTPOST_CATALOG.studyPrefab, { x: 15000, y: 8800 }, { kind: 'room', id: 'H6' }))
    const notes = [
      { id: 'C1', entityId: 'H6-bookshelf', entityKind: 'prop' as const, text: '书房书架背板有一段重新修补的木纹' },
      { id: 'C2', entityId: 'H5-crate', entityKind: 'prop' as const, text: '库房木箱底有一张未寄出的修灯账单' },
      { id: 'C3', entityId: 'H3-dining', entityKind: 'prefabInstance' as const, text: '餐桌上的杯子仍然温热' },
    ]
    newStage('house-clues', '添加三条独立GM线索', notes.map(note => `${note.id}：${note.text}；初始仅GM可见，锚定${note.entityId}。`), notes.map(note => note.id), () => notes.map(note => ({ type: 'createNote', id: note.id, floorId, layerId, anchor: { type: 'entity', entityKind: note.entityKind, entityId: note.entityId }, kind: 'clue', text: note.text, visibility: 'gm', discovered: false })),
      () => notes.every(note => scene.notes[note.id]?.text === note.text && scene.notes[note.id].visibility === 'gm' && equal(scene.notes[note.id].anchor, { type: 'entity', entityKind: note.entityKind, entityId: note.entityId })))
  } else {
    const areas = [
      { id: OUTPOST_IDS.water, boundary: rect(0, 0, 36000, 28000), elevation: 0, priority: 0, material: 'b3-m-06', blocks: true },
      { id: OUTPOST_IDS.low, boundary: points([[2000, 4000], [17000, 2000], [23000, 5000], [23000, 20000], [17000, 24000], [3000, 23000]]), elevation: 1000, priority: 1, material: 'b3-m-01', blocks: false },
      { id: OUTPOST_IDS.high, boundary: points([[23000, 5000], [32000, 7000], [33000, 18000], [23000, 20000]]), elevation: 3000, priority: 1, material: 'b3-m-02', blocks: false },
    ]
    for (const area of areas) newStage(`${area.id}-create`, area.id === OUTPOST_IDS.water ? '绘制非步行水域基底' : area.id === OUTPOST_IDS.low ? '绘制1000 mm低台地' : '绘制3000 mm瞭望高地', [
      `${coordinates(area.boundary)} mm；高程${area.elevation}、覆盖优先级${area.priority}。`, area.blocks ? '水域明确阻挡移动；换浅蓝图片不授予涉水。' : '高低台地同优先级且不重叠，图片不代替显式高差连接。',
    ], [area.id], () => [{ type: 'createTerrainArea', id: area.id, floorId, layerId, boundaryMm: area.boundary, groundElevationMm: area.elevation, coveragePriority: area.priority, materialRef: ref(area.material), blocksMovement: area.blocks }],
      () => { const existing = scene.terrainAreas[area.id]; return !!existing && equal(existing.boundaryMm.map(point => point.positionMm), area.boundary) && existing.groundElevationMm === area.elevation && existing.coveragePriority === area.priority && existing.blocksMovement === area.blocks })
    const edgeSpecs = [[OUTPOST_IDS.low, [0, 1, 3, 4, 5]], [OUTPOST_IDS.high, [0, 1, 2, 3]]] as const
    const edges = edgeSpecs.flatMap(([areaId, indexes]) => indexes.map(index => ({ id: `${areaId}-edge-${index}`, areaId, index })))
    newStage('outpost-edges', '标明来源岸边与唯一共崖', ['低台地外露段0/1/3/4/5，高台地段0/1/2/3；共边只创建一次。', '全部为明确来源的阻挡崖边；高台地第3段接低台地，其余邻接水面。'], edges.map(edge => edge.id), () => edges.map(edge => {
      const area = scene.terrainAreas[edge.areaId]
      if (!area) throw new Error('请先完成两台地。')
      return { type: 'createTerrainEdge', id: edge.id, layerId, source: { areaId: edge.areaId, segmentId: area.boundaryMm[edge.index].segmentId }, kind: 'cliff', shoreline: !(edge.areaId === OUTPOST_IDS.high && edge.index === 3), blocksMovement: true, surfaceStyle: materialStyle(scene, 'b3-m-03') }
    }), () => edges.every(edge => scene.terrainEdges[edge.id]?.kind === 'cliff' && scene.terrainEdges[edge.id].blocksMovement && scene.terrainEdges[edge.id].source.areaId === edge.areaId && scene.terrainEdges[edge.id].source.segmentId === scene.terrainAreas[edge.areaId]?.boundaryMm[edge.index].segmentId))
    const rooms = [
      { id: OUTPOST_IDS.room, purpose: '值守室', boundary: rect(6000, 7000, 6000, 6000), material: 'b2-m-01' },
      { id: OUTPOST_IDS.store, purpose: '储物间', boundary: rect(12000, 7000, 4000, 6000), material: 'b2-m-03' },
    ]
    for (const room of rooms) newStage(`${room.id}-create`, `绘制${room.purpose}`, [`墙中心线${coordinates(room.boundary)} mm；墙厚200 mm。`, '显式支撑低台地，房间高程继承1000 mm；相邻房共墙唯一。'], [room.id], () => [{ type: 'createRoom', id: room.id, floorId, layerId, boundaryMm: room.boundary, thicknessMm: 200, purpose: room.purpose, materialRef: ref(room.material), supportRef: { kind: 'terrainArea', id: OUTPOST_IDS.low } }],
      () => rectangleMatches(scene, room.id, room.boundary, 200) && scene.rooms[room.id].groundElevationMm === 1000 && equal(scene.rooms[room.id].supportRef, { kind: 'terrainArea', id: OUTPOST_IDS.low }))
    const doors: Opening[] = [{ id: OUTPOST_IDS.entrance, center: { x: 9000, y: 13000 }, width: 1200 }, { id: OUTPOST_IDS.sharedDoor, center: { x: 12000, y: 10000 }, width: 1000 }]
    newStage('outpost-openings', '添加南入口与共墙门', doors.map(value => `${value.id}：中心${coordinates([value.center])}，净宽${value.width} mm，普通开启门。`), doors.map(value => value.id), () => doors.map(value => openingCommand(scene, value)), () => doors.every(value => openingMatches(scene, value)))
    stage({ id: 'outpost-access', title: '声明建筑入口与结构连接', instructions: ['南门为指定入口；值守室、储物间均为结构必达。道路2 m净宽与南门1.2 m净宽分别成立。'],
      done: () => equal(scene.constraints.entranceOpeningIds, [OUTPOST_IDS.entrance]) && rooms.every(room => scene.rooms[room.id]?.accessExpectation === 'required'),
      make: () => [{ type: 'setEntranceOpenings', ids: [OUTPOST_IDS.entrance] }, ...rooms.map(room => ({ type: 'updateRoom' as const, id: room.id, changes: { accessExpectation: 'required' as const } }))] })
    const pathPoints = points([[9000, 14000], [9000, 16000], [21000, 16000], [21500, 13000]])
    newStage('outpost-path-and-stairs', '连接院子道路与跨高差台阶', [`道路中心线${coordinates(pathPoints)} mm，净宽2000，支撑仅低台地。`, '台阶从低台地(21500,13000)到高台地(24500,13000)，净宽2000；这是唯一跨高差连接。'], [OUTPOST_IDS.path, OUTPOST_IDS.connection], () => [
      { type: 'createPath', id: OUTPOST_IDS.path, floorId, layerId, centerlineMm: pathPoints, widthMm: 2000, supportRefs: [{ kind: 'terrainArea', id: OUTPOST_IDS.low }], materialRef: ref(OUTPOST_CATALOG.dirt) },
      { type: 'createTerrainConnection', id: OUTPOST_IDS.connection, floorId, layerId, kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.low }, positionMm: { x: 21500, y: 13000 } }, to: { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.high }, positionMm: { x: 24500, y: 13000 } }, widthMm: 2000, surfaceStyle: materialStyle(scene, 'b2-m-03') },
    ], () => equal(scene.paths[OUTPOST_IDS.path]?.centerlineMm, pathPoints) && scene.paths[OUTPOST_IDS.path]?.widthMm === 2000 && equal(scene.paths[OUTPOST_IDS.path]?.supportRefs, [{ kind: 'terrainArea', id: OUTPOST_IDS.low }])
      && equal(scene.terrainConnections[OUTPOST_IDS.connection]?.from, { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.low }, positionMm: { x: 21500, y: 13000 } }) && equal(scene.terrainConnections[OUTPOST_IDS.connection]?.to, { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.high }, positionMm: { x: 24500, y: 13000 } }) && scene.terrainConnections[OUTPOST_IDS.connection]?.widthMm === 2000)
    newStage('outpost-yard', '铺设院子并标记瞭望场地', ['院子(6000,13000)→(17000,18000)，泥土/碎石覆盖留出门前和道路。', '瞭望点(26500,11500)→(29500,14500)，3000×3000非阻挡区域。'], [OUTPOST_IDS.yard, OUTPOST_IDS.lookout], () => {
      const low = scene.terrainAreas[OUTPOST_IDS.low]
      return [
        { type: 'updateTerrainArea', id: low.id, changes: { surfaceStyle: { ...structuredClone(low.surfaceStyle!), overlays: [...structuredClone(low.surfaceStyle!.overlays), { id: OUTPOST_IDS.yardOverlay, boundaryMm: rect(6000, 13000, 11000, 5000), paint: materialStyle(scene, OUTPOST_CATALOG.dirt).base, blendWidthMm: 250, renderOrder: 1 }] } } },
        { type: 'createRegion', id: OUTPOST_IDS.yard, floorId, layerId, boundaryMm: rect(6000, 13000, 11000, 5000), kind: 'terrain', blocksMovement: false },
        { type: 'createRegion', id: OUTPOST_IDS.lookout, floorId, layerId, boundaryMm: rect(26500, 11500, 3000, 3000), kind: 'terrain', blocksMovement: false },
      ]
    }, () => equal(scene.regions[OUTPOST_IDS.yard]?.boundaryMm, rect(6000, 13000, 11000, 5000)) && equal(scene.regions[OUTPOST_IDS.lookout]?.boundaryMm, rect(26500, 11500, 3000, 3000)) && scene.terrainAreas[OUTPOST_IDS.low]?.surfaceStyle?.overlays.some(overlay => overlay.id === OUTPOST_IDS.yardOverlay) === true)
    const props = [
      { id: OUTPOST_IDS.bookshelf, key: 'bookshelf', x: 6750, y: 9700, support: { kind: 'room' as const, id: OUTPOST_IDS.room } },
      { id: OUTPOST_IDS.crate, key: 'crate', x: 13300, y: 11900, support: { kind: 'room' as const, id: OUTPOST_IDS.store } },
      { id: OUTPOST_IDS.rack, key: 'supply-rack', x: 15000, y: 9300, support: { kind: 'room' as const, id: OUTPOST_IDS.store } },
      { id: OUTPOST_IDS.campfire, key: 'campfire', x: 11700, y: 14200, support: { kind: 'terrainArea' as const, id: OUTPOST_IDS.low } },
      { id: OUTPOST_IDS.lamp, key: 'lamp-stand', x: 28200, y: 12400, support: { kind: 'terrainArea' as const, id: OUTPOST_IDS.high } },
    ]
    newStage('outpost-furnishings', '布置架箱、营火与灯架', props.map(value => `${value.key}：(${value.x}, ${value.y}) mm，显式支撑${value.support.id}。`), props.map(value => value.id), () => props.map(value => propCommand(value.id, value.key, { x: value.x, y: value.y }, value.support)),
      () => props.every(value => propMatches(value.id, value.key, { x: value.x, y: value.y }, value.support)))
    newStage('outpost-table-groups', '放置书桌与补给固定组合', ['书桌六件组(8600,8500)支撑值守室；补给三件组(14500,14200)支撑低台地。', '组合单独预览采用，保持源模板、成员及图层规则。'], [OUTPOST_IDS.deskGroup, OUTPOST_IDS.suppliesGroup], () => [
      prefabCommand(OUTPOST_IDS.deskGroup, OUTPOST_CATALOG.studyPrefab, { x: 8600, y: 8500 }, { kind: 'room', id: OUTPOST_IDS.room }),
      prefabCommand(OUTPOST_IDS.suppliesGroup, OUTPOST_CATALOG.suppliesPrefab, { x: 14500, y: 14200 }, { kind: 'terrainArea', id: OUTPOST_IDS.low }),
    ], () => prefabMatches(OUTPOST_IDS.deskGroup, OUTPOST_CATALOG.studyPrefab, { x: 8600, y: 8500 }, { kind: 'room', id: OUTPOST_IDS.room }) && prefabMatches(OUTPOST_IDS.suppliesGroup, OUTPOST_CATALOG.suppliesPrefab, { x: 14500, y: 14200 }, { kind: 'terrainArea', id: OUTPOST_IDS.low }))
    const exclusions = [
      { name: 'building', boundaryMm: rect(5000, 6000, 12000, 8000), reason: 'manual' as const },
      { name: 'yard-road', boundaryMm: rect(5000, 12000, 17500, 6500), reason: 'entrance' as const },
      { name: 'stairs', boundaryMm: rect(19500, 11500, 7000, 3000), reason: 'entrance' as const },
      { name: 'lookout', boundaryMm: rect(25000, 10500, 6000, 5800), reason: 'manual' as const },
    ]
    const scatters = [
      { id: OUTPOST_IDS.scatterTrees, domain: { kind: 'area' as const, areaId: OUTPOST_IDS.high }, keys: ['tree-broadleaf', 'tree-sparse'], cell: 2500, density: .42, distance: 1600 },
      { id: OUTPOST_IDS.scatterShrubs, domain: { kind: 'area' as const, areaId: OUTPOST_IDS.low }, keys: ['shrub-round', 'shrub-dry'], cell: 2500, density: .30, distance: 500 },
      { id: OUTPOST_IDS.scatterRocks, domain: { kind: 'edgeBand' as const, edgeId: `${OUTPOST_IDS.high}-edge-2`, widthMm: 4500 }, keys: ['rock-small', 'rock-small-worn'], cell: 1200, density: .36, distance: 180 },
    ]
    for (const scatter of scatters) {
      newStage(`${scatter.id}-setup`, scatter.id === OUTPOST_IDS.scatterTrees ? '建立树木可控散布' : scatter.id === OUTPOST_IDS.scatterShrubs ? '建立灌木可控散布' : '建立崖边碎石可控散布', ['建立固定种子和调色板；先保存建筑、院子道路、台阶和瞭望场地的明确排除区。', `格距${scatter.cell} mm，密度${scatter.density}，最小间距${scatter.distance} mm；本步不凭旧种子重放历史。`], [scatter.id], () => [
        { type: 'createScatter', id: scatter.id, floorId, layerId, domain: scatter.domain, palette: scatter.keys.map(key => ({ key, propDefinitionRef: ref(definitionFor(scene, key).id), weight: 1 })), seed: `${scatter.id}-guided-1`, cellSizeMm: scatter.cell, densityFactor: scatter.density, minDistanceMm: scatter.distance, rotationRangeDeg: { min: 0, max: 359.999 } },
        ...exclusions.map(exclusion => ({ type: 'upsertScatterExclusion' as const, groupId: scatter.id, exclusion: { id: `${scatter.id}-exclude-${exclusion.name}`, boundaryMm: exclusion.boundaryMm, reason: exclusion.reason } })),
      ], () => { const group = scene.scatterGroups[scatter.id]; return !!group && equal(group.domain, scatter.domain) && group.seed === `${scatter.id}-guided-1` && exclusions.every(exclusion => group.exclusions.some(current => current.id === `${scatter.id}-exclude-${exclusion.name}` && equal(current.boundaryMm, exclusion.boundaryMm))) })
      stage({ id: `${scatter.id}-generate`, title: `生成${scatter.id === OUTPOST_IDS.scatterTrees ? '树木' : scatter.id === OUTPOST_IDS.scatterShrubs ? '灌木' : '碎石'}实际成员`, instructions: ['检查候选实际成员和占地；生成后人工移动、删除排除、退出和锁继续沿已有编辑工具持久保存。'],
        done: () => Object.keys(scene.scatterGroups[scatter.id]?.members ?? {}).length > 0,
        make: () => [{ type: 'regenerateScatter', id: scatter.id }] })
    }
    const noteSpecs = [
      { id: OUTPOST_IDS.publicLabel, text: '瞭望点', anchor: { type: 'point' as const, positionMm: { x: 27000, y: 14200 } }, visibility: 'public' as const, kind: 'label' as const },
      { id: OUTPOST_IDS.publicDescription, text: '旧灯架守着海湾', anchor: { type: 'point' as const, positionMm: { x: 26200, y: 15000 } }, visibility: 'public' as const, kind: 'label' as const },
      { id: OUTPOST_IDS.secretNote, text: '灯架下藏有返航账目', anchor: { type: 'entity' as const, entityKind: 'prop' as const, entityId: OUTPOST_IDS.lamp }, visibility: 'gm' as const, kind: 'clue' as const },
    ]
    newStage('outpost-notes', '分别添加公开地点与GM线索', ['仅公开“瞭望点”和“旧灯架守着海湾”；返航账目初始仅GM可见。', '公开地标不会连带公开GM注记。固定遮罩隐私对照须另建测试副本，不能拿本地图普通注记代替4K配对验收。'], noteSpecs.map(note => note.id), () => noteSpecs.map(note => ({ type: 'createNote', id: note.id, floorId, layerId, anchor: note.anchor, kind: note.kind, text: note.text, visibility: note.visibility, discovered: false })),
      () => noteSpecs.every(note => scene.notes[note.id]?.text === note.text && scene.notes[note.id].visibility === note.visibility && equal(scene.notes[note.id].anchor, note.anchor)))
  }
  stage({ id: `${prefix}-display`, title: '收尾：米制与弱格线', instructions: ['保持物理毫米坐标；使用米制、1000 mm格距、100 mm吸附并隐藏编辑格线。', '保存、重开、完整工程/所选历史往返、双受众4K和错误恢复继续从工程与历史工具执行，不能以本引导状态代替验收。'],
    done: () => scene.units.display === 'm' && scene.units.gridSizeMm === 1000 && scene.units.snapMm === 100 && !scene.units.gridVisible && scene.presetSnapshot.distanceMode === 'metric',
    make: () => [{ type: 'setSceneDisplay', display: 'm', distanceMode: 'metric', gridSizeMm: 1000, snapMm: 100, gridVisible: false }] })
  return stages
}

/** Derives progress entirely from current scene content. No wizard state, sample
 * loading, document replacement, automatic adoption or hidden persistence. */
export function buildAuthoringPlanV6(project: CompleteProjectV6, id: AuthoringRecipeIdV6): AuthoringPlanV6 {
  const scene = project.document, requiredCatalogIds = id === 'scn-01' ? [...AUTHORING_INTERIOR_CATALOG_IDS_V6] : []
  const missingCatalogIds = requiredCatalogIds.filter(catalogId => !Object.values(scene.propDefinitions).some(definition => definition.catalogId === catalogId && definition.version === 1))
  const result: AuthoringPlanV6 = { id, title: id === 'scn-01' ? 'SCN-01 雾灯宅 · 分步制作' : 'SCN-04 海岸哨所 · 分步制作', stages: [], requiredCatalogIds, missingCatalogIds,
    limitations: ['每一步只准备普通有限编辑指令；检查预览后由你采用，一次采用可以撤销。', '进度依据当前真实实体判断；局部完成、同ID冲突或改离基线会明确停下，不覆盖现存编辑。', '这是创作辅助流程。全图占地寻路、独立无引导手工、完整回归、P3美术签收与真实小团验收须另行记录。'] }
  try {
    const stages = buildStages(project, id), occupied = entityIds(scene)
    let firstPending = true
    result.stages = stages.map(stage => {
      const { done, make, newIds, ...display } = stage
      if (done()) return { ...display, status: 'complete', commands: [] }
      if (!firstPending) return { ...display, status: 'waiting', reason: '先完成前面的基线步骤。', commands: [] }
      firstPending = false
      try {
        const collisions = newIds?.filter(value => occupied.has(value)) ?? []
        if (collisions.length) throw new Error(`本步已有部分对象或基线不同：${collisions.join('、')}。请检查现存编辑；引导不会补写或覆盖它们。`)
        const commands = make()
        if (!commands.length || commands.length > 256) throw new Error('本步不是合法有限事务。')
        // Same core gate as a normal candidate. The workbench still rechecks the
        // current checkpoint, actual resources, dependency expansion and adoption.
        const candidate = applyCompositionCommandsV6({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, commands)
        projectSceneV3(candidate.document, 'player')
        return { ...display, status: 'ready', commands }
      } catch (error) {
        return { ...display, status: 'blocked', reason: error instanceof Error ? error.message : '本步准备失败，当前工程保持。', commands: [] }
      }
    })
  } catch (error) {
    result.stages = [{ id: 'unavailable', title: '当前工程不适用', instructions: [], status: 'blocked', reason: error instanceof Error ? error.message : '请使用独立空白工程。', commands: [] }]
  }
  return result
}
