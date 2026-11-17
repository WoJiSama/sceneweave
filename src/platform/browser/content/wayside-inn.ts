import { applyCommands } from '../../../shared/commands/commands.js'
import { planRoomFurnishing } from '../../../shared/furnishing/plan.js'
import type { FurnishingRole } from '../../../shared/furnishing/contracts.js'
import { innAssetId, innDefinitionId, innMaterialId, INN_FUNCTION_ART, INN_FUNCTION_LICENSE } from '../../../shared/visual/inn-functions-art.js'
import { roomPoints } from '../../../shared/geometry/geometry.js'
import { assertDoorwayClearances } from '../../../shared/geometry/doorway-clearance.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { createInnFunctionCatalogDocument } from './inn-functions.js'
import { materializeVisualArt } from './visual-art-project.js'
import { runtime } from '../runtime.js'
import { createVisualBlankDocument } from './visual-samples.js'
import { checkRouteOnValidScene } from '../../../shared/geometry/terrain-travel.js'
import type { PointMm } from '../../../shared/model/scene.js'

export const WAYSIDE_INN_NAME = '灰橡小旅舍 · 完整可编辑'
const floorId = 'visual-floor', structureLayer = 'visual-layer-ground', furnitureLayer = 'visual-layer-props'
const point = (x: number, y: number) => ({ x, y })
const ref = (id: string) => ({ id, version: 1 })
export const INN_ROOMS = [
  { id: 'inn-guest-west', purpose: '西侧客房', x: 2000, y: 2000, width: 6500, height: 7500 },
  { id: 'inn-guest-east', purpose: '东侧双床客房', x: 8500, y: 2000, width: 6500, height: 7500 },
  { id: 'inn-linen', purpose: '布草储藏间', x: 15000, y: 2000, width: 5000, height: 7500 },
  { id: 'inn-wash', purpose: '洗漱间', x: 20000, y: 2000, width: 6000, height: 7500 },
  { id: 'inn-hall', purpose: '住客与服务通廊', x: 2000, y: 9500, width: 24000, height: 2500 },
  { id: 'inn-common', purpose: '公共餐厅', x: 2000, y: 12000, width: 11000, height: 8000 },
  { id: 'inn-kitchen', purpose: '厨房', x: 13000, y: 12000, width: 7000, height: 8000 },
  { id: 'inn-reception', purpose: '接待休息室', x: 20000, y: 12000, width: 6000, height: 8000 },
] as const
type FunctionRow = readonly [FurnishingRole, number, string]
const functions: Record<string, readonly FunctionRow[]> = {
  'inn-guest-west': [['bed', 1, 'interior-bed-indigo'], ['storage', 1, 'nightstand'], ['table', 1, 'interior-table-round'], ['seat', 1, 'interior-chair-cushion']],
  'inn-guest-east': [['bed', 2, 'interior-bed-indigo'], ['storage', 2, 'nightstand']],
  'inn-linen': [['storage', 2, 'linen-chest'], ['shelf', 3, 'linen-open-rack']],
  'inn-wash': [['work', 3, 'washstand'], ['shelf', 1, 'linen-open-rack']],
  'inn-common': [['table', 2, 'interior-table-long'], ['seat', 8, 'interior-chair-cushion'], ['storage', 1, 'interior-cupboard-linen']],
  'inn-kitchen': [['work', 2, 'prep-block'], ['hearth', 1, 'interior-stove-masonry'], ['storage', 1, 'interior-cupboard-linen'], ['shelf', 2, 'pantry-rack']],
  'inn-reception': [['work', 1, 'interior-counter-kitchen'], ['table', 1, 'interior-table-round'], ['seat', 2, 'interior-chair-cushion'], ['storage', 1, 'linen-chest']],
}

/** A fresh plan: guest rooms and service rooms flank one generous shared hall.
 * Every furnishing pass uses the same command planner exposed in the UI. */
export function createWaysideInnDocument(options: { sceneId?: string; now?: string; checkCancelled?: () => void } = {}) {
  const checkCancelled = options.checkCancelled ?? (() => {})
  let document = createInnFunctionCatalogDocument(), n = 0
  document.sceneId = options.sceneId ?? 'wayside-inn-v1'; document.title = WAYSIDE_INN_NAME
  document.createdAt = document.updatedAt = options.now ?? '2026-11-16T00:00:00.000Z'
  document.exportBoundsMm = { x: 0, y: 0, width: 28000, height: 22000 }
  document.floors[floorId].boundsMm = { ...document.exportBoundsMm }; document.floors[floorId].name = '旅舍一层'
  const theme = Object.values(createVisualBlankDocument({ title: '灰橡主题', widthMm: 10000, heightMm: 10000, preset: 'narrative' }).styleThemes)[0]
  const sample = Object.values(document.propDefinitions)[0]
  Object.assign(theme, { id: 'inn-function-v1-theme', catalogId: 'sceneweave.inn-function.theme', name: '灰橡与青灰织物', licenseRef: sample.licenseRef, origin: sample.origin,
    materialSuggestions: Object.keys(document.materials).map(ref), propSuggestions: Object.keys(document.propDefinitions).map(ref), prefabSuggestions: [], outline: { widthMm: 37, color: '#414B3E' } })
  document.styleThemes[theme.id] = theme; document.activeStyleThemeRef = ref(theme.id)
  const context = { ids: { nextId: () => `wayside-inn-${++n}` }, clock: { now: () => document.updatedAt } }
  for (const room of INN_ROOMS) {
    checkCancelled()
    document = applyCommands(document, [{ type: 'createRoom', id: room.id, floorId, layerId: structureLayer, purpose: room.purpose, thicknessMm: 250,
      boundaryMm: [point(room.x, room.y), point(room.x + room.width, room.y), point(room.x + room.width, room.y + room.height), point(room.x, room.y + room.height)],
      materialRef: ref(innMaterialId(/厨房|洗漱/.test(room.purpose) ? 'interior-material-flags' : 'interior-material-planks')) }], context)
  }
  const doors = [
    ['inn-door-west', 4750, 9500], ['inn-door-east', 11250, 9500], ['inn-door-linen', 16900, 9500], ['inn-door-wash', 22600, 9500],
    ['inn-door-common', 7600, 12000], ['inn-door-kitchen', 16200, 12000], ['inn-door-reception', 22600, 12000], ['inn-entry', 22600, 20000],
  ] as const
  for (const [id, x, y] of doors) {
    const wall = Object.values(document.walls).find(wall => { const a = document.vertices[wall.startVertexId], b = document.vertices[wall.endVertexId]; return a.yMm === y && b.yMm === y && Math.min(a.xMm, b.xMm) <= x && Math.max(a.xMm, b.xMm) >= x + 1200 })
    if (!wall) throw new Error(`旅舍开口缺少真实墙：${id}`)
    const start = document.vertices[wall.startVertexId], end = document.vertices[wall.endVertexId]
    document = applyCommands(document, [{ type: 'addOpening', id, wallId: wall.id, layerId: structureLayer, offsetReferenceVertexId: start.xMm < end.xMm ? start.id : end.id, offsetMm: x - Math.min(start.xMm, end.xMm), widthMm: 1200, kind: 'door', state: 'open' }], context)
  }
  // Public exterior windows are structural openings, independent of pictures.
  for (const room of INN_ROOMS.filter(room => room.y === 2000 || room.y === 12000)) {
    const y = room.y === 2000 ? 2000 : 20000, x = room.x + 1000
    const wall = Object.values(document.walls).find(wall => { const a = document.vertices[wall.startVertexId], b = document.vertices[wall.endVertexId]; return a.yMm === y && b.yMm === y && Math.min(a.xMm, b.xMm) <= x && Math.max(a.xMm, b.xMm) >= x + 1400 })!
    const start = document.vertices[wall.startVertexId], end = document.vertices[wall.endVertexId]
    document = applyCommands(document, [{ type: 'addOpening', id: `${room.id}-window`, wallId: wall.id, layerId: structureLayer, offsetReferenceVertexId: start.xMm < end.xMm ? start.id : end.id, offsetMm: x - Math.min(start.xMm, end.xMm), widthMm: 1400, kind: 'window' }], context)
  }
  const reports = []
  for (const room of INN_ROOMS) {
    if (!functions[room.id]) continue
    const result = planRoomFurnishing(document, { roomId: room.id, layerId: furnitureLayer, purpose: room.purpose, variation: 'wayside-inn-purpose-v1',
      functions: functions[room.id].map(([role, count, key]) => ({ role, count, definitionRef: ref(innDefinitionId(key)) })), movableIds: [], restoreDeletedKeys: [] }, context, checkCancelled)
    document = applyCommands(document, result.commands, context); reports.push({ roomId: room.id, ...result })
  }
  document.constraints.entranceOpeningIds = ['inn-entry']; document.constraints.minDoorWidthMm = 1000
  const label = point(21800, 19200)
  document = applyCommands(document, [{ type: 'createNote', id: 'inn-gm-note', floorId, layerId: structureLayer, kind: 'clue', title: '柜台记事', text: '掌柜留有失踪旅客的欠账。仅供主持人使用。', visibility: 'gm', anchor: { type: 'point', positionMm: label } }], context)
  // Join the solver's actual, full-width door routes into explicit suggestions.
  // The normal path-check validator rechecks every complete route below and on
  // every public save/cold read. A hint is never an exemption from geometry.
  const routeByDoor = new Map(reports.flatMap(report => report.circulation.routes.map(route => [route.openingId, route] as const)))
  const oriented = (door: string, fromRoomId: string | null) => {
    const route = routeByDoor.get(door)
    if (!route || route.status !== 'clear') throw new Error(`旅舍通路没有实际证明：${door}`)
    return route.fromRoomId === fromRoomId ? route.pointsMm : [...route.pointsMm].reverse()
  }
  const receptionToEntry = [...oriented('inn-entry', 'inn-reception'), point(23200, 20800)]
  const hallToEntry = [...oriented('inn-door-reception', 'inn-hall'), ...receptionToEntry.slice(1)]
  const roomDoors: Record<string, string> = { 'inn-guest-west': 'inn-door-west', 'inn-guest-east': 'inn-door-east', 'inn-linen': 'inn-door-linen', 'inn-wash': 'inn-door-wash', 'inn-common': 'inn-door-common', 'inn-kitchen': 'inn-door-kitchen' }
  const simplify = (input: PointMm[]) => {
    const result = [input[0]]
    for (let i = 0; i < input.length - 1;) {
      let next = input.length - 1
      for (; next > i; next--) {
        checkCancelled()
        if (checkRouteOnValidScene(document, { floorId, pointsMm: [...result, input[next]], widthMm: 1000 }).ok) break
      }
      if (next === i) throw new Error('旅舍整段通路缺少可核验的连续净宽。')
      result.push(input[next]); i = next
    }
    return result
  }
  document.constraints.pathChecks = INN_ROOMS.filter(room => room.id !== 'inn-hall').map(room => ({
    id: `${room.id}-entry-route`, name: `${room.purpose}至正门`, floorId,
    from: { type: 'entity' as const, entityKind: 'room' as const, entityId: room.id }, to: { type: 'point' as const, positionMm: point(23200, 20800) }, clearanceMm: 1000,
    mode: 'current' as const, assumedOpenDoorIds: [], routeHintMm: simplify(room.id === 'inn-reception' ? receptionToEntry : [...oriented(roomDoors[room.id], room.id), ...hallToEntry.slice(1)]),
  }))
  document.presetSnapshot = { ...document.presetSnapshot, presetId: 'wayside-inn-v1', source: '全新通廊布局；借鉴独立原画并增绘功能家具；按真实房间重新求解，普通用户可在用途布置入口修改' }
  document.revision = 0
  const checked = validateSceneDocument(document)
  if (!checked.ok) throw new Error(`完整旅舍无效：${checked.errors.map(issue => issue.message).join('；')}`)
  assertDoorwayClearances(checked.document, doors.map(([openingId]) => ({ openingId, minWidthMm: 1000, approachDepthMm: 1000 })))
  // Ensure actual polygons have survived shared-wall subdivision unchanged.
  for (const room of INN_ROOMS) if (roomPoints(checked.document, checked.document.rooms[room.id]).length < 4) throw new Error('旅舍房间轮廓缺失。')
  return { document: checked.document, reports }
}
export async function createWaysideInnProject(signal?: AbortSignal) {
  const { document } = createWaysideInnDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now(), checkCancelled: () => signal?.throwIfAborted() })
  return materializeVisualArt(document, INN_FUNCTION_ART, INN_FUNCTION_LICENSE, innAssetId, signal)
}
