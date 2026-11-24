import type { PointMm, SceneDocument, SurfaceRef } from '../../../shared/model/scene.js'
import { applyCommands } from '../../../shared/commands/commands.js'
import { createBasePlacedProp } from '../../../shared/commands/base.js'
import { furnitureDefinitionId } from '../../../shared/assets/furniture-collection.js'
import { storageDefinitionId } from '../../../shared/assets/storage-collection.js'
import { architectureDefinitionId } from '../../../shared/assets/architecture-collection.js'
import { handdrawnSurfaceDefinitionId } from '../../../shared/visual/handdrawn-surfaces.js'
import { visualBase } from '../../../shared/visual/base.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { createSceneCollectionSelectionDocument, materializeSceneCollectionDocument } from './scene-collection-catalog.js'
import { appendHanddrawnSurfaceDefinitions, HANDDRAWN_SURFACES_BATCH } from './handdrawn-surfaces-catalog.js'
import { runtime } from '../runtime.js'
import { transportDefinitionId } from '../../../shared/assets/transport-collection.js'
import { lightingDefinitionId } from '../../../shared/assets/lighting-collection.js'

import { workspaceSampleNames } from './workspace-samples.js'

export const SHIP_INTERIOR_NAME = workspaceSampleNames.shipInterior
export const SHIP_FLOORS = [
  { id: 'collection-floor', name: '甲板' }, { id: 'ship-cabin', name: '船舱' }, { id: 'ship-hold', name: '底舱' },
] as const
const HULL: readonly PointMm[] = [{ x: 7000, y: 1600 }, { x: 10000, y: 5200 }, { x: 11000, y: 9500 },
  { x: 11000, y: 24000 }, { x: 10000, y: 27500 }, { x: 4000, y: 27500 }, { x: 3000, y: 24000 }, { x: 3000, y: 9500 }, { x: 4000, y: 5200 }]

/** A static multi-Floor architectural brief. Uses normal rooms, walls, props,
 * notes and Floor switching; it never creates a second ship editor or nav model. */
export function createShipInteriorDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const chest = storageDefinitionId('chest-sea-chest'), barrel = storageDefinitionId('barrel-ale-cask')
  const ladder = architectureDefinitionId('stairs-ladder')
  const bed = furnitureDefinitionId('bed-peasant'), table = furnitureDefinitionId('table-peasant'), chair = furnitureDefinitionId('chair-peasant')
  const cabinet = furnitureDefinitionId('cabinet-peasant'), sack = storageDefinitionId('sack-grain')
  const mast = architectureDefinitionId('column-timber'), cleat = transportDefinitionId('dock-post-medieval-logrope')
  const winch = transportDefinitionId('loading-rig-medieval-handwinch'), capstan = transportDefinitionId('loading-rig-medieval-capstan')
  const lantern = lightingDefinitionId('lantern-horn-pane')
  let scene = appendHanddrawnSurfaceDefinitions(createSceneCollectionSelectionDocument([chest, barrel, ladder, bed, table, chair,
    cabinet, sack, mast, cleat, winch, capstan, lantern], options))
  scene.title = SHIP_INTERIOR_NAME
  const bounds = { x: 0, y: 0, width: 14000, height: 30000 }, wood = handdrawnSurfaceDefinitionId('weathered-oak')
  scene.exportBoundsMm = { ...bounds }; scene.outputBackground = { mode: 'solid', color: '#314E59' }
  scene.userLayers = {}; scene.floors = {}
  for (const floor of SHIP_FLOORS) {
    scene.floors[floor.id] = { ...floor, boundsMm: { ...bounds }, outputBoundsMm: { ...bounds } }
    for (const [order, suffix, name] of [[0, 'hull', '船壳与房间'], [1, 'props', '家具与梯口'], [2, 'labels', '楼层标签']] as const) {
      const id = `${floor.id}-${suffix}`; scene.userLayers[id] = { id, floorId: floor.id, name, order, editLocked: false }
    }
    const hullId = `${floor.id}-hull-surface`
    scene.terrainAreas[hullId] = { id: hullId, floorId: floor.id, editLocked: false, visibility: 'public',
      boundaryMm: HULL.map((point, i) => ({ id: `${hullId}-p${i}`, segmentId: `${hullId}-s${i}`, positionMm: { ...point } })),
      groundElevationMm: 0, coveragePriority: 1, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1,
      surfaceStyle: { base: { materialRef: { id: wood, version: 1 }, tileSizeMm: { width: 3200, height: 3200 }, alignment: 'world', originMm: { x: 0, y: 0 }, rotationDeg: 90, tint: null, opacity: 1 }, overlays: [] } }
    scene.entityLayers[hullId] = `${floor.id}-hull`
    const visual = visualBase(scene)!, boundaryId = `${hullId}-rim`
    visual.boundaries[boundaryId] = { id: boundaryId, floorId: floor.id, layerId: `${floor.id}-hull`, editLocked: false, visibility: 'public', closed: true,
      segments: HULL.map((a, i) => { const b = HULL[(i + 1) % HULL.length]; return { id: `${boundaryId}-s${i}`, start: { ...a }, control1: { ...a }, control2: { ...b }, end: { ...b } } }),
      sampleSpacingMm: 20000, toleranceMm: 1000, binding: { kind: 'terrain', sides: [{ areaId: hullId, startPointId: `${hullId}-p0`, endPointId: `${hullId}-p0`, reverse: false }] } }
    visual.edgeLooks[`${boundaryId}-rail`] = { id: `${boundaryId}-rail`, floorId: floor.id, layerId: `${floor.id}-hull`, editLocked: false, visibility: 'public',
      boundaryId, kind: 'fence', side: 'left', widthMm: 180, color: '#4A392D', accentColor: '#C1A77B', opacity: .9, intensity: .45, seed: 'ship-rim-v1', repeatMm: 900, enabled: true }
  }
  let sequence = 0
  const context = { ids: { nextId: () => `ship-structure-${++sequence}` }, clock: { now: () => scene.updatedAt } }
  const room = (id: string, floorId: string, purpose: string, x: number, y: number, width: number, height: number) => {
    scene = applyCommands(scene, [{ type: 'createRoom', id, floorId, layerId: `${floorId}-hull`, purpose, thicknessMm: 180,
      supportRef: { kind: 'terrainArea', id: `${floorId}-hull-surface` }, materialRef: { id: wood, version: 1 },
      boundaryMm: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] }], context)
  }
  room('ship-captain-room', 'ship-cabin', '船长室', 3500, 7500, 7000, 4500)
  room('ship-crew-room', 'ship-cabin', '船员卧舱', 3500, 12000, 3000, 11000)
  room('ship-cabin-passage', 'ship-cabin', '舱内通廊', 6500, 12000, 2000, 13000)
  room('ship-store-room', 'ship-cabin', '随船物资间', 8500, 12000, 2000, 11000)
  room('ship-cargo-room', 'ship-hold', '底舱货仓', 3500, 7500, 7000, 17000)
  const door = (id: string, floorId: string, axis: 'x' | 'y', coordinate: number, start: number) => {
    const wall = Object.values(scene.walls).find(row => {
      if (row.floorId !== floorId) return false
      const a = scene.vertices[row.startVertexId], b = scene.vertices[row.endVertexId]
      return axis === 'x' ? a.xMm === coordinate && b.xMm === coordinate && Math.min(a.yMm, b.yMm) <= start && Math.max(a.yMm, b.yMm) >= start + 1000
        : a.yMm === coordinate && b.yMm === coordinate && Math.min(a.xMm, b.xMm) <= start && Math.max(a.xMm, b.xMm) >= start + 1000
    })
    if (!wall) throw new Error('船内房间缺少可用门墙。')
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    const first = axis === 'x' ? a.yMm < b.yMm ? a : b : a.xMm < b.xMm ? a : b
    scene = applyCommands(scene, [{ type: 'addOpening', id, wallId: wall.id, layerId: `${floorId}-hull`, offsetReferenceVertexId: first.id,
      offsetMm: start - (axis === 'x' ? first.yMm : first.xMm), widthMm: 1000, kind: 'door', state: 'open' }], context)
  }
  door('ship-captain-door', 'ship-cabin', 'y', 12000, 7000)
  door('ship-crew-door', 'ship-cabin', 'x', 6500, 19100)
  door('ship-store-door', 'ship-cabin', 'x', 8500, 19100)
  const place = (id: string, floorId: string, definition: string, x: number, y: number, roomId?: string, rotationDeg = 0) => {
    const supportRef: SurfaceRef = roomId ? { kind: 'room', id: roomId } : { kind: 'terrainArea', id: `${floorId}-hull-surface` }
    scene.props[id] = createBasePlacedProp(scene, definition, { x, y }, context, { id, floorId, rotationDeg, supportRef })
    scene.entityLayers[id] = `${floorId}-props`
  }
  place('ship-deck-ladder-a', 'collection-floor', ladder, 7500, 15000)
  place('ship-cabin-ladder-a', 'ship-cabin', ladder, 7500, 15000, 'ship-cabin-passage')
  place('ship-cabin-ladder-b', 'ship-cabin', ladder, 7500, 22400, 'ship-cabin-passage')
  place('ship-hold-ladder-b', 'ship-hold', ladder, 7500, 22400, 'ship-cargo-room')
  place('ship-chart-table', 'ship-cabin', table, 7400, 9400, 'ship-captain-room')
  place('ship-captain-chair', 'ship-cabin', chair, 7400, 10800, 'ship-captain-room', 180)
  place('ship-captain-chest', 'ship-cabin', chest, 4700, 10200, 'ship-captain-room')
  for (let i = 0; i < 3; i++) place(`ship-crew-bed-${i}`, 'ship-cabin', bed, 4700, 13700 + i * 3000, 'ship-crew-room')
  for (let i = 0; i < 6; i++) place(`ship-store-barrel-${i}`, 'ship-cabin', barrel, i % 2 ? 9900 : 9100, 13500 + Math.floor(i / 2) * 1450, 'ship-store-room')
  for (let i = 0; i < 10; i++) place(`ship-hold-barrel-${i}`, 'ship-hold', barrel, 4500 + i % 2 * 1300, 10500 + Math.floor(i / 2) * 2000, 'ship-cargo-room')
  for (let i = 0; i < 5; i++) place(`ship-hold-chest-${i}`, 'ship-hold', chest, 9400, 10000 + i * 2200, 'ship-cargo-room', 90)
  place('ship-deck-chest', 'collection-floor', chest, 9500, 19500)
  place('ship-deck-barrel-1', 'collection-floor', barrel, 4700, 19500)
  place('ship-deck-barrel-2', 'collection-floor', barrel, 4700, 20700)
  // All fittings are existing fixed props at their original millimetre sizes.
  // The mast is its deck-level footing; no rigging or functional ship is implied.
  place('ship-deck-mast', 'collection-floor', mast, 7000, 11000)
  place('ship-deck-winch', 'collection-floor', winch, 7000, 6500)
  place('ship-deck-capstan', 'collection-floor', capstan, 7000, 21800)
  for (const [index, x, y] of [[1, 4200, 11000], [2, 9800, 11000], [3, 4200, 23500], [4, 9800, 23500]]) {
    place(`ship-cleat-${index}`, 'collection-floor', cleat, x, y, undefined, index % 2 ? 90 : 270)
  }
  place('ship-deck-cargo-1', 'collection-floor', chest, 4500, 16500)
  place('ship-deck-cargo-2', 'collection-floor', chest, 4500, 17800)
  place('ship-deck-cargo-3', 'collection-floor', sack, 9800, 17500)
  place('ship-deck-cargo-4', 'collection-floor', sack, 9800, 18700)
  place('ship-captain-bed', 'ship-cabin', bed, 4900, 8750, 'ship-captain-room')
  place('ship-captain-cabinet', 'ship-cabin', cabinet, 9600, 9400, 'ship-captain-room')
  place('ship-crew-chest', 'ship-cabin', chest, 4700, 22000, 'ship-crew-room')
  for (let i = 0; i < 3; i++) place(`ship-store-sack-${i}`, 'ship-cabin', sack, 9500, 18500 + i * 1400, 'ship-store-room', i * 12)
  for (let i = 0; i < 4; i++) place(`ship-hold-sack-${i}`, 'ship-hold', sack, 9300, 20700 + i * 950, 'ship-cargo-room', i % 2 ? 15 : 345)
  for (const [id, floorId, x, y, roomId] of [
    ['deck-bow', 'collection-floor', 7000, 9000, undefined], ['deck-stern', 'collection-floor', 7000, 25700, undefined],
    ['captain', 'ship-cabin', 9500, 11000, 'ship-captain-room'], ['crew', 'ship-cabin', 5800, 22000, 'ship-crew-room'],
    ['store', 'ship-cabin', 10000, 22200, 'ship-store-room'], ['hold', 'ship-hold', 9000, 8000, 'ship-cargo-room'],
  ] as const) place(`ship-lantern-${id}`, floorId, lantern, x, y, roomId)
  const label = (id: string, floorId: string, x: number, y: number, text: string) => {
    scene = applyCommands(scene, [{ type: 'createNote', id, floorId, layerId: `${floorId}-labels`, kind: 'label', text, visibility: 'public', anchor: { type: 'point', positionMm: { x, y } } }], context)
  }
  label('ship-deck-title', 'collection-floor', 7000, 5500, '逐潮号 · 甲板')
  label('ship-deck-a', 'collection-floor', 7500, 17200, 'A ↓ 船舱')
  label('ship-cabin-a', 'ship-cabin', 7500, 17200, 'A ↑ 甲板')
  label('ship-cabin-b', 'ship-cabin', 7500, 24400, 'B ↓ 底舱')
  label('ship-hold-b', 'ship-hold', 7500, 24400, 'B ↑ 船舱')
  scene.floors['collection-floor'].links = [{ id: 'ladder-a', name: 'A梯口', targetFloorId: 'ship-cabin', fromMm: { x: 7500, y: 15000 }, toMm: { x: 7500, y: 15000 } }]
  scene.floors['ship-cabin'].links = [{ id: 'ladder-b', name: 'B梯口', targetFloorId: 'ship-hold', fromMm: { x: 7500, y: 22400 }, toMm: { x: 7500, y: 22400 } }]
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-ship-interior', presetVersion: 2,
    source: '静态三Floor船图2；同坐标船壳与A/B入口，普通房间、家具、绞盘、桅座、系缆桩及提灯；固定素材真实尺寸；不授予跨层寻路、航行或机具功能' }
  scene.revision = 0
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`三层船图无效：${checked.errors.map(row => `${row.entityId ?? ''}:${row.message}`).join('；')}`)
  return checked.document
}

export function createShipInteriorProject(signal?: AbortSignal) {
  signal?.throwIfAborted()
  return materializeSceneCollectionDocument(createShipInteriorDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), [HANDDRAWN_SURFACES_BATCH], signal)
}
