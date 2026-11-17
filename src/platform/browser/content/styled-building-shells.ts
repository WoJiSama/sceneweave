import { applyCommands } from '../../../shared/commands/commands.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { HANDDRAWN_SURFACE_ART, handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { createHanddrawnSurfacesCatalogDocument, HANDDRAWN_SURFACES_BATCH } from './handdrawn-surfaces-catalog.js'
import { materializeVisualArtBatches } from './visual-art-project.js'
import { runtime } from '../runtime.js'

export const STYLED_BUILDING_SHELLS = [
  { id: 'house', name: '中世纪住宅 · 待布置', era: 'medieval', styleId: 'peasant', missing: '厨房炉具、洗漱与生活小件须另选；四件家具系列不提供这些专用设备。' },
  { id: 'tavern', name: '西幻酒馆 · 待布置', era: 'fantasy', styleId: 'dwarven', missing: '酒具、炉具及专用吧台须另选，储物柜不代表酿造设备。' },
  { id: 'office', name: '1920年代事务所 · 待布置', era: '1920s', styleId: 'arts-crafts', missing: '电话、打字机与档案小件须另选，书写桌不代表完整办公设备。' },
] as const
export type StyledBuildingShell = typeof STYLED_BUILDING_SHELLS[number]['id']
const layouts = {
  house: [ ['卧室', 2000, 2000, 6500, 6500], ['储藏间', 8500, 2000, 3500, 6500], ['书房', 12000, 2000, 3500, 6500], ['起居餐厅', 2000, 8500, 13500, 7000] ],
  tavern: [ ['旅客卧室', 2000, 2000, 8000, 5500], ['酒馆储藏间', 10000, 2000, 9000, 5500], ['酒馆公共厅', 2000, 7500, 17000, 8500] ],
  office: [ ['调查办公室', 2000, 2000, 8500, 8500], ['档案室', 10500, 2000, 7500, 8500], ['接待等候室', 2000, 10500, 16000, 5500] ],
} as const

/** Three independent architectural briefs. They contain real shared walls,
 * doors, windows and floor materials, but no borrowed furniture arrangement. */
export function createStyledBuildingShellDocument(kind: StyledBuildingShell, options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const brief = STYLED_BUILDING_SHELLS.find(row => row.id === kind)
  if (!brief) throw new Error('未知建筑样板。')
  let scene = createHanddrawnSurfacesCatalogDocument(options), serial = 0
  scene.sceneId = options.sceneId ?? `styled-building-shell-${kind}`; scene.title = brief.name
  scene.units.gridVisible = false
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  scene.floors[floorId].name = brief.name; scene.userLayers[layerId].name = '建筑与家具'
  const stamp = { ids: { nextId: () => `styled-${kind}-${++serial}` }, clock: { now: () => scene.updatedAt } }
  const rooms = layouts[kind]
  const bounds = { x: 0, y: 0, width: Math.max(...rooms.map(([, x, , width]) => x + width)) + 1500, height: Math.max(...rooms.map(([, , y, , height]) => y + height)) + 1500 }
  scene.exportBoundsMm = bounds; scene.floors[floorId].boundsMm = { ...bounds }
  for (const [index, [purpose, x, y, width, height]] of rooms.entries()) {
    const key = kind === 'office' && index === rooms.length - 1 ? 'warm-plaster' : kind === 'tavern' && index === 1 ? 'old-limestone-flags' : 'weathered-oak'
    scene = applyCommands(scene, [{ type: 'createRoom', id: `styled-${kind}-room-${index + 1}`, floorId, layerId, purpose, thicknessMm: 250,
      boundaryMm: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], materialRef: { id: handdrawnSurfaceDefinitionId(key), version: 1 } }], stamp)
  }
  const addOpening = (x: number, y: number, kind: 'door' | 'window', id: string, widthMm: number) => {
    const wall = Object.values(scene.walls).find(row => { const a = scene.vertices[row.startVertexId], b = scene.vertices[row.endVertexId]; return a.yMm === y && b.yMm === y && Math.min(a.xMm, b.xMm) < x && Math.max(a.xMm, b.xMm) > x + widthMm })
    if (!wall) throw new Error('建筑样板没有可用的真实墙段。')
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    scene = applyCommands(scene, [{ type: 'addOpening', id, wallId: wall.id, layerId, offsetReferenceVertexId: a.xMm < b.xMm ? a.id : b.id,
      offsetMm: x - Math.min(a.xMm, b.xMm), widthMm, kind, ...(kind === 'door' ? { state: 'open' as const } : {}) }], stamp)
  }
  for (const [index, [, x, y, width, height]] of rooms.entries()) {
    if (index < rooms.length - 1) {
      addOpening(x + Math.floor(width / 2) - 600, y + height, 'door', `styled-${kind}-door-${index}`, 1200)
      addOpening(x + 500, y, 'window', `styled-${kind}-window-${index}`, 1400)
    } else addOpening(x + Math.floor(width / 2) - 700, y + height, 'door', `styled-${kind}-entry`, 1400)
  }
  scene.constraints.entranceOpeningIds = [`styled-${kind}-entry`]
  scene.revision = 0
  const used = new Set(Object.values(scene.rooms).flatMap(room => room.floorStyle?.base.materialRef.id ?? []))
  scene.materials = Object.fromEntries(Object.entries(scene.materials).filter(([id]) => used.has(id)))
  const assets = new Set(Object.values(scene.materials).map(material => material.textureAssetId))
  scene.assets = Object.fromEntries(Object.entries(scene.assets).filter(([id]) => assets.has(id)))
  return scene
}
export async function createStyledBuildingShellProject(kind: StyledBuildingShell, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scene = createStyledBuildingShellDocument(kind, { sceneId: runtime.ids.nextId(), now: runtime.clock.now() })
  return materializeVisualArtBatches(scene, [{ ...HANDDRAWN_SURFACES_BATCH, artwork: HANDDRAWN_SURFACE_ART.filter(art => !!scene.assets[HANDDRAWN_SURFACES_BATCH.assetId(art.key)]) }], signal)
}
