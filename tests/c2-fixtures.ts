import { createBlankDocumentV2, createBlankProjectV2 } from '../src/editor/v2/blank-project'
import { applyCommandsV3, type SceneCommandV3 } from '../src/core/v3/commands'
import { migrateSceneV2 } from '../src/core/v3/migration'
import { validateSceneV3 } from '../src/core/v3/schema'
import type { PointMm, PropV2, SceneDocumentV3, WallV2 } from '../src/core/v3/types'
import { createHistoryIdentityV4 } from '../src/core/v4/identity'
import type { CompleteProjectV3 } from '../src/io/v3/types'
import type { CompleteProjectV4 } from '../src/io/v4/types'

export const C2_STAMP = '2026-10-22T00:00:00.000Z'
export const C2_EXPORT_BOUNDS = { x: -500, y: -500, width: 19000, height: 15000 }
export const C2_FLOOR_BOUNDS = { x: -2000, y: -2000, width: 22000, height: 18000 }
export const C2_MASK = [{ x: 5500, y: 12200 }, { x: 18500, y: 12200 }, { x: 18500, y: 14500 }, { x: 5500, y: 14500 }]
export const C2_LAYER = 'layer-default-0'
export const C2_FLOOR = 'blank-floor'

/** Coordinates and openings come directly from docs/08 SCN-01, in integer mm. */
export const C2_ROOMS = [
  { id: 'H1', purpose: '门厅', x: 6000, y: 0, width: 6000, height: 6000 },
  { id: 'H2', purpose: '厨房', x: 0, y: 0, width: 6000, height: 6000 },
  { id: 'H3', purpose: '餐厅', x: 0, y: 6000, width: 6000, height: 8000 },
  { id: 'H4', purpose: '卧室', x: 12000, y: 0, width: 6000, height: 6000 },
  { id: 'H5', purpose: '库房', x: 6000, y: 6000, width: 6000, height: 6700 },
  { id: 'H6', purpose: '书房', x: 12000, y: 6000, width: 6000, height: 6700 },
  { id: 'HS', purpose: '暗廊', x: 6000, y: 12700, width: 12000, height: 1300 },
] as const

export const C2_DOORS = [
  { id: 'outside-H1', center: { x: 9000, y: 0 }, width: 1200, rooms: ['H1'] },
  { id: 'H1-H2', center: { x: 6000, y: 3000 }, width: 900, rooms: ['H1', 'H2'] },
  { id: 'H2-H3', center: { x: 3000, y: 6000 }, width: 900, rooms: ['H2', 'H3'] },
  { id: 'H1-H4', center: { x: 12000, y: 3000 }, width: 900, rooms: ['H1', 'H4'] },
  { id: 'H1-H5', center: { x: 9000, y: 6000 }, width: 900, rooms: ['H1', 'H5'] },
  { id: 'H4-H6', center: { x: 15000, y: 6000 }, width: 900, rooms: ['H4', 'H6'] },
  { id: 'H3-H5', center: { x: 6000, y: 9000 }, width: 900, rooms: ['H3', 'H5'] },
  { id: 'H5-HS', center: { x: 9000, y: 12700 }, width: 900, rooms: ['H5', 'HS'] },
  { id: 'H6-HS', center: { x: 15000, y: 12700 }, width: 900, rooms: ['H6', 'HS'] },
] as const

export const C2_WINDOWS = [
  { id: 'H2-window', center: { x: 0, y: 3000 }, width: 1200 },
  { id: 'H3-window', center: { x: 0, y: 10000 }, width: 1200 },
  { id: 'H4-window', center: { x: 18000, y: 3000 }, width: 1200 },
] as const

const rectangle = (x: number, y: number, width: number, height: number): PointMm[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]
const edgeKey = (a: string, b: string) => [a, b].sort().join('\0')

export function c2RoomIdsAtWall(scene: SceneDocumentV3, wall: WallV2): string[] {
  const key = edgeKey(wall.startVertexId, wall.endVertexId)
  return Object.values(scene.rooms).filter(room => room.boundaryVertexIds.some((id, i, ids) => edgeKey(id, ids[(i + 1) % ids.length]) === key)).map(room => room.id).sort()
}

export function c2WallAt(scene: SceneDocumentV3, center: PointMm): WallV2 {
  const matches = Object.values(scene.walls).filter(wall => {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    return (center.x - a.xMm) * (b.yMm - a.yMm) === (center.y - a.yMm) * (b.xMm - a.xMm)
      && center.x >= Math.min(a.xMm, b.xMm) && center.x <= Math.max(a.xMm, b.xMm)
      && center.y >= Math.min(a.yMm, b.yMm) && center.y <= Math.max(a.yMm, b.yMm)
  })
  if (matches.length !== 1) throw new Error(`SCN-01 开口中心须命中恰一条墙：${JSON.stringify(center)}，命中 ${matches.length}。`)
  return matches[0]
}

function openingCommand(scene: SceneDocumentV3, data: { id: string; center: PointMm; width: number }, kind: 'door' | 'window'): SceneCommandV3 {
  const wall = c2WallAt(scene, data.center), reference = scene.vertices[wall.startVertexId]
  return { type: 'addOpening', id: data.id, wallId: wall.id, offsetReferenceVertexId: wall.startVertexId,
    offsetMm: Math.round(Math.hypot(data.center.x - reference.xMm, data.center.y - reference.yMm) - data.width / 2),
    widthMm: data.width, kind, state: 'closed', locked: false, secret: data.id.endsWith('-HS'), revealed: false, layerId: C2_LAYER }
}

function symbol(id: string, roomId: string, x: number, y: number, width: number, height: number, kind: 'table' | 'chair' | 'shelf' | 'rug' | 'crate'): PropV2 {
  return { id, floorId: C2_FLOOR, editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: kind, tint: null, opacity: 1 },
    visualBoundsMm: { x: -width / 2, y: -height / 2, width, height }, positionMm: { x, y }, rotationDeg: 0,
    footprintMm: { width, height }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: kind !== 'rug', blocksSight: kind === 'shelf',
    visibility: roomId === 'HS' ? 'gm' : 'public', roomId, supportRef: { kind: 'room', id: roomId },
    renderLayer: kind === 'rug' ? 'ground' : 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
}

function decorate(scene: SceneDocumentV3, includeSecret: boolean): void {
  const props = [
    symbol('H1-bench', 'H1', 7200, 1200, 1600, 600, 'shelf'), symbol('H1-hanger', 'H1', 11000, 1200, 600, 600, 'crate'),
    symbol('H2-worktop', 'H2', 2000, 1500, 2200, 800, 'table'), symbol('H2-stove', 'H2', 1200, 4300, 800, 800, 'crate'),
    symbol('H3-dining', 'H3', 3000, 10000, 2400, 1400, 'table'), symbol('H3-cupboard', 'H3', 1000, 12500, 800, 1600, 'shelf'),
    symbol('H4-bed', 'H4', 16000, 2200, 2400, 3000, 'rug'), symbol('H4-wardrobe', 'H4', 17200, 4700, 700, 1600, 'shelf'),
    symbol('H5-rack', 'H5', 11000, 8500, 600, 2000, 'shelf'), symbol('H5-crate', 'H5', 7600, 11000, 1000, 1000, 'crate'),
    symbol('H6-desk', 'H6', 15000, 9200, 1800, 800, 'table'), symbol('H6-bookshelf', 'H6', 17000, 9500, 600, 2000, 'shelf'),
    ...(includeSecret ? [symbol('HS-old-wires', 'HS', 16500, 13350, 400, 400, 'crate')] : []),
  ]
  for (const prop of props) { scene.props[prop.id] = prop; scene.entityLayers[prop.id] = C2_LAYER }
  scene.regions['SCN01-fixed-mask'] = { id: 'SCN01-fixed-mask', floorId: C2_FLOOR, editLocked: false, boundaryMm: structuredClone(C2_MASK),
    kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm' }
  scene.entityLayers['SCN01-fixed-mask'] = C2_LAYER
  if (!includeSecret) return
  for (const [id, propId, text] of [
    ['C1', 'H6-bookshelf', '书房书架背板有一段重新修补的木纹'],
    ['C2', 'H5-crate', '库房木箱底有一张未寄出的修灯账单'],
    ['C3', 'H3-dining', '餐桌上的杯子仍然温热'],
  ]) {
    scene.notes[id] = { id, floorId: C2_FLOOR, editLocked: false, anchor: { type: 'entity', entityKind: 'prop', entityId: propId },
      kind: 'clue', text, visibility: 'gm', discovered: false }
    scene.entityLayers[id] = C2_LAYER
  }
}

/** Builds through the actual C2 commands; the public reference never contains HS or either secret opening. */
export function createScn01DocumentC2(options: { publicReference?: boolean; sceneId?: string } = {}): SceneDocumentV3 {
  const empty = createBlankDocumentV2({ title: options.publicReference ? 'SCN-01 独立玩家参考' : 'SCN-01 雾灯宅',
    widthMm: 22000, heightMm: 18000, preset: 'investigation', sceneId: 'scn01-c2-v2-source', now: C2_STAMP, gridVisible: false })
  empty.assets = {}; empty.propDefinitions = {}
  empty.exportBoundsMm = { ...C2_EXPORT_BOUNDS }; empty.floors[C2_FLOOR].boundsMm = { ...C2_FLOOR_BOUNDS }
  let scene = migrateSceneV2(empty, { sceneId: options.sceneId ?? (options.publicReference ? 'scn01-c2-reference' : 'scn01-c2'), now: C2_STAMP })
  const rooms = C2_ROOMS.filter(room => !options.publicReference || room.id !== 'HS')
  for (const room of rooms) scene = applyCommandsV3(scene, [{ type: 'createRoom', id: room.id, floorId: C2_FLOOR,
    boundaryMm: rectangle(room.x, room.y, room.width, room.height), thicknessMm: 100, layerId: C2_LAYER,
    purpose: room.purpose, visibility: room.id === 'HS' ? 'gm' : 'public', accessExpectation: 'unspecified' }])
  scene = applyCommandsV3(scene, [
    ...C2_DOORS.filter(door => !options.publicReference || !door.id.endsWith('-HS')).map(door => openingCommand(scene, door, 'door')),
    ...C2_WINDOWS.map(window => openingCommand(scene, window, 'window')),
  ])
  scene = applyCommandsV3(scene, [{ type: 'setEntranceOpenings', ids: ['outside-H1'] },
    ...rooms.map((room): SceneCommandV3 => ({ type: 'updateRoom', id: room.id, changes: { accessExpectation: 'required' } }))])
  decorate(scene, !options.publicReference)
  const checked = validateSceneV3(scene)
  if (!checked.ok) throw new Error(`SCN-01 夹具无效：${checked.errors.map(issue => `${issue.entityId}: ${issue.message}`).join('；')}`)
  return checked.document
}

export function createScn01ProjectC2(options: { publicReference?: boolean; sceneId?: string } = {}): CompleteProjectV4 {
  const document = createScn01DocumentC2(options)
  return { document, historyIdentity: createHistoryIdentityV4(document), assets: {}, licenses: {}, licenseBindings: [] }
}

/** Actual bundled image bytes and licenses, preserving all geometry and fixed output bounds. */
export async function createScn01BitmapProjectC2(): Promise<CompleteProjectV4> {
  const source = await createBlankProjectV2({ title: 'SCN-01 素材源', widthMm: 22000, heightMm: 18000, preset: 'investigation', now: C2_STAMP })
  let document = createScn01DocumentC2()
  document.assets = structuredClone(source.document.assets); document.propDefinitions = structuredClone(source.document.propDefinitions)
  for (const [id, definitionId] of [['H6-desk', 'b2-p-01'], ['H6-bookshelf', 'b2-p-06'], ['H5-rack', 'b2-p-06']] as const) {
    const prop = document.props[id], definition = document.propDefinitions[definitionId]
    prop.definitionRef = { id: definition.id, version: definition.version }; prop.appearance = structuredClone(definition.defaultAppearance)
    prop.visualBoundsMm = structuredClone(definition.defaultVisualBoundsMm)
    prop.footprintMm = structuredClone(definition.defaultFootprintMm); prop.footprintOffsetMm = structuredClone(definition.defaultFootprintOffsetMm)
    prop.shadowClass = definition.defaultShadowClass; prop.blocksMovement = definition.defaultBlocksMovement; prop.blocksSight = definition.defaultBlocksSight
  }
  const checked = validateSceneV3(document)
  if (!checked.ok) throw new Error(checked.errors.map(issue => issue.message).join('；'))
  document = checked.document
  return { document, historyIdentity: createHistoryIdentityV4(document), assets: source.assets, licenses: source.licenses, licenseBindings: source.licenseBindings }
}

export function c2ProjectView(project: CompleteProjectV4): CompleteProjectV3 {
  return { document: project.document, assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings }
}
