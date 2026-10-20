import type { SceneDocument, Vertex, Room, Wall, Prop, Note } from './types'
import { newId } from './types'

/** Original M0 fixture; short opaque IDs are stable inside a scene namespace. */
export function createHouse(sceneId = newId()): SceneDocument {
  const floorId = 'f-a1'
  const stamp = new Date().toISOString()
  const vertex = (id: string, xMm: number, yMm: number): Vertex => ({ id, floorId, xMm, yMm, editLocked: false })
  const vertices = [
    vertex('v-a1', 2000, 4000), vertex('v-b2', 8000, 4000), vertex('v-c3', 14000, 4000),
    vertex('v-d4', 14000, 11000), vertex('v-e5', 8000, 11000), vertex('v-f6', 2000, 11000),
    vertex('v-g7', 2000, 2700), vertex('v-h8', 14000, 2700),
  ]
  const room = (id: string, boundaryVertexIds: string[], purpose: string, visibility: 'public' | 'gm' = 'public'): Room => ({
    id, floorId, boundaryVertexIds, purpose, visibility, editLocked: false, accessExpectation: 'required',
  })
  const rooms = [
    room('r-a1', ['v-a1', 'v-b2', 'v-e5', 'v-f6'], '接待与调查'),
    room('r-b2', ['v-b2', 'v-c3', 'v-d4', 'v-e5'], '阅读与档案'),
    room('r-c3', ['v-g7', 'v-h8', 'v-c3', 'v-b2', 'v-a1'], '秘密通路', 'gm'),
  ]
  const pairs = [['v-a1','v-b2'], ['v-b2','v-c3'], ['v-c3','v-d4'], ['v-d4','v-e5'], ['v-e5','v-f6'],
    ['v-f6','v-a1'], ['v-b2','v-e5'], ['v-g7','v-h8'], ['v-h8','v-c3'], ['v-a1','v-g7']]
  const walls = pairs.map(([startVertexId,endVertexId], i): Wall => ({
    id: `w-${i.toString(16)}a`, floorId, startVertexId, endVertexId,
    thicknessMm: 100, blocksMovement: true, blocksSight: true, editLocked: false,
  }))
  const prop = (id: string, symbol: Prop['symbol'], x: number, y: number, width: number, height: number, roomId: string, visibility: 'public' | 'gm' = 'public', rotationDeg = 0): Prop => ({
    id, floorId, symbol, assetId: null, positionMm: { x,y }, rotationDeg,
    footprintMm: { width,height }, blocksMovement: symbol !== 'rug', blocksSight: symbol === 'shelf', visibility, editLocked: false, roomId,
  })
  const props = [
    prop('p-a1', 'rug', 5000, 7600, 3800, 3200, 'r-a1'),
    prop('p-b2', 'table', 5000, 7600, 1800, 1000, 'r-a1'),
    prop('p-c3', 'chair', 5000, 6500, 650, 650, 'r-a1'),
    prop('p-d4', 'chair', 5000, 8700, 650, 650, 'r-a1', 'public', 180),
    prop('p-e5', 'shelf', 10900, 4700, 3700, 650, 'r-b2'),
    prop('p-f6', 'table', 11100, 8200, 2000, 1000, 'r-b2'),
    prop('p-g7', 'chair', 11100, 9300, 650, 650, 'r-b2', 'public', 180),
    prop('p-h8', 'crate', 4400, 3350, 600, 500, 'r-c3', 'gm'),
  ]
  const note = (id: string, entityKind: 'room' | 'prop', entityId: string, text: string, visibility: 'public' | 'gm', kind: Note['kind'] = 'label'): Note => ({
    id, floorId, anchor: { type: 'entity', entityKind, entityId }, kind, text, visibility, editLocked: false,
  })
  return {
    format: 'sceneweave', schemaVersion: 1, sceneId, revision: 0,
    title: '雾灯宅', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1524, snapMm: 100, gridVisible: true },
    exportBoundsMm: { x: -500, y: -500, width: 19000, height: 15000 },
    floors: { [floorId]: { id: floorId, name: '一层', boundsMm: { x: -1000, y: -1000, width: 22000, height: 18000 } } },
    vertices: Object.fromEntries(vertices.map(v=>[v.id,v])), rooms: Object.fromEntries(rooms.map(v=>[v.id,v])),
    walls: Object.fromEntries(walls.map(v=>[v.id,v])),
    openings: {
      'o-a1': { id: 'o-a1', floorId, wallId: 'w-4a', offsetMm: 2300, widthMm: 1200, kind: 'door', state: 'open', locked: false, secret: false, revealed: false, editLocked: false },
      'o-b2': { id: 'o-b2', floorId, wallId: 'w-6a', offsetMm: 3500, widthMm: 1100, kind: 'door', state: 'closed', locked: false, secret: false, revealed: false, editLocked: false },
      'o-c3': { id: 'o-c3', floorId, wallId: 'w-1a', offsetMm: 3000, widthMm: 900, kind: 'door', state: 'closed', locked: false, secret: true, revealed: false, editLocked: false },
    },
    props: Object.fromEntries(props.map(v=>[v.id,v])),
    regions: { 'g-a1': { id: 'g-a1', floorId, kind: 'manualMask', boundaryMm: [{x:-500,y:-500},{x:18500,y:-500},{x:18500,y:4000},{x:-500,y:4000}], blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm', editLocked: false } },
    notes: Object.fromEntries([
      note('n-a1', 'room', 'r-a1', '会客厅', 'public'), note('n-b2', 'room', 'r-b2', '书房', 'public'),
      note('n-c3', 'room', 'r-c3', '密道 · 净宽 1.20 m', 'gm'),
      { ...note('n-d4', 'prop', 'p-e5', '旧账册的封底夹着一封未寄出的信。', 'gm', 'clue'), title: '未寄出的信', discovered: false },
    ].map(v=>[v.id,v])), assets: {},
    presetSnapshot: { presetId: 'investigation', presetVersion: 1, distanceMode: 'metric', source: 'Sceneweave 通用调查偏好；非官方规则', gridSizeMm: 1524 },
    constraints: { entranceOpeningIds: ['o-a1'], wallEndClearanceMm: 100, pathChecks: [] },
  }
}

/** Deterministic geometry-only workload; no image textures or external requests. */
export function createBenchmarkScene(count: 500 | 2000): SceneDocument {
  const scene = createHouse()
  scene.title = `${count} 物件负载`
  scene.exportBoundsMm = { x: 0, y: 0, width: 76200, height: 76200 }
  scene.floors['f-a1'].boundsMm = { x: -1000, y: -1000, width: 78200, height: 78200 }
  scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.vertices = {}; scene.notes = {}; scene.regions = {}
  scene.constraints.entranceOpeningIds = []
  scene.props = {}
  for (let i=0; i<count; i++) {
    const id = `b-${i.toString(16)}`
    scene.props[id] = { id, floorId: 'f-a1', assetId: null, symbol: ['table','chair','shelf','crate'][i%4] as Prop['symbol'],
      positionMm: { x: 762 + i%50*1524, y: 762 + Math.floor(i/50)*1524 }, rotationDeg: i%4*90,
      footprintMm: { width: 900, height: 700 }, blocksMovement: true, blocksSight: false, visibility: 'public', editLocked: false }
  }
  return scene
}
