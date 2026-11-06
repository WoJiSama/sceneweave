import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../commands/commands.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { resolveBuildingEntrancePort } from './building-port.js'

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture(side: 'top' | 'right' | 'bottom' | 'left' = 'top', reversed = false) {
  const source = createShoreBlankDocument('island', { sceneId: 'building-port', title: '真实外门端口', now: '2026-11-05T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => `building-native-${++sequence}` } }
  const boundaryMm = rectangle(4000, 4000, 6000, 6000)
  let document = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(0, 0, 20000, 16000), groundElevationMm: 1200, coveragePriority: 0 },
    { type: 'createRoom', id: 'building', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: reversed ? boundaryMm.reverse() : boundaryMm, thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime)
  const wall = Object.values(document.walls).find(row => {
    const a = document.vertices[row.startVertexId], b = document.vertices[row.endVertexId]
    return side === 'top' ? a.yMm === 4000 && b.yMm === 4000 : side === 'bottom' ? a.yMm === 10000 && b.yMm === 10000
      : side === 'left' ? a.xMm === 4000 && b.xMm === 4000 : a.xMm === 10000 && b.xMm === 10000
  })!
  document = applyCommands(document, [{ type: 'addOpening', id: 'entrance', wallId: wall.id, offsetReferenceVertexId: reversed ? wall.endVertexId : wall.startVertexId,
    offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
  return { document, runtime, wall }
}

describe('actual exterior building entrance ports', () => {
  it.each([
    ['top', 270, { x: 7000, y: 3299 }, { x: 7000, y: 4701 }],
    ['right', 0, { x: 10701, y: 7000 }, { x: 9299, y: 7000 }],
    ['bottom', 90, { x: 7000, y: 10701 }, { x: 7000, y: 9299 }],
    ['left', 180, { x: 3299, y: 7000 }, { x: 4701, y: 7000 }],
  ] as const)('resolves %s from real wall/room geometry in either ring direction without modifying the document', (side, directionDeg, outsideMm, insideMm) => {
    for (const reversed of [false, true]) {
      const { document } = fixture(side, reversed), before = canonicalJson(document)
      const port = resolveBuildingEntrancePort(document, 'entrance', 1000)
      expect(port).toMatchObject({ openingId: 'entrance', roomId: 'building', floorId: 'visual-floor', supportRef: { kind: 'terrainArea', id: 'ground' }, elevationMm: 1200,
        directionDeg, outsideMm, insideMm, widthMm: 1000 })
      expect(checkTerrainRoute(document, { floorId: port.floorId, pointsMm: [port.outsideMm, port.insideMm], widthMm: port.widthMm }).ok).toBe(true)
      expect(canonicalJson(document)).toBe(before)
    }
  })
  it('refuses closed, locked, hidden, undersized and half-millimetre doorways', () => {
    const { document } = fixture()
    for (const changes of [{ state: 'closed' as const }, { locked: true }, { secret: true, revealed: false }]) {
      const changed = cloneJson(document); Object.assign(changed.openings.entrance, changes)
      expect(() => resolveBuildingEntrancePort(changed, 'entrance', 1000)).toThrow(/打开|上锁|可见/)
    }
    expect(() => resolveBuildingEntrancePort(document, 'entrance', 1300)).toThrow(/净宽不足/)
    const odd = cloneJson(document); odd.openings.entrance.widthMm = 1201
    expect(() => resolveBuildingEntrancePort(odd, 'entrance', 1000)).toThrow(/整数毫米/)
  })
  it('refuses interior shared doors and an exterior approach crossing another support', () => {
    const { document, runtime } = fixture('right')
    const shared = applyCommands(document, [{ type: 'createRoom', id: 'neighbor', floorId: 'visual-floor', boundaryMm: rectangle(10000, 4000, 6000, 6000), thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } }], runtime)
    expect(() => resolveBuildingEntrancePort(shared, 'entrance', 1000)).toThrow(/恰好/)
    const top = fixture()
    const crossed = applyCommands(top.document, [{ type: 'createTerrainArea', id: 'other-surface', floorId: 'visual-floor', boundaryMm: rectangle(6000, 2500, 2000, 1000), groundElevationMm: 1200, coveragePriority: 1 }], top.runtime)
    expect(() => resolveBuildingEntrancePort(crossed, 'entrance', 1000)).toThrow(/同一真实地形/)
  })
})
