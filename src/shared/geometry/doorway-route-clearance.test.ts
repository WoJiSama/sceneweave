import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { openingEndpoints, wallOffsetPoint } from './geometry.js'
import { checkTerrainRoute } from './terrain-travel.js'

function room(wallIndex: number, reverseReference: boolean) {
  const scene = createRefinedBlankDocument('coast', { title: 'Exact doorway clearance', widthMm: 24000, heightMm: 18000,
    preset: 'narrative', sceneId: 'doorway-clearance', now: '2026-11-13T00:00:00.000Z' })
  const floorId = 'visual-floor', layerId = 'visual-layer-ground'
  scene.floors[floorId].boundsMm = { x: -2000, y: -2000, width: 28000, height: 22000 }
  const points = [{ xMm: 0, yMm: 0 }, { xMm: 6000, yMm: 0 }, { xMm: 6000, yMm: 6000 }, { xMm: 0, yMm: 6000 }]
  points.forEach((point, i) => {
    const id = 'v' + i, wallId = 'w' + i
    scene.vertices[id] = { id, floorId, editLocked: false, ...point }
    scene.walls[wallId] = { id: wallId, floorId, editLocked: false, startVertexId: id, endVertexId: 'v' + (i + 1) % 4,
      thicknessMm: 100, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.entityLayers[id] = layerId; scene.entityLayers[wallId] = layerId
  })
  scene.rooms.room = { id: 'room', floorId, editLocked: false, boundaryVertexIds: points.map((_, i) => 'v' + i),
    purpose: 'test room', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: floorId }, groundElevationMm: 0, floorStyle: null }
  scene.entityLayers.room = layerId
  const wall = scene.walls['w' + wallIndex]
  scene.openings.door = { id: 'door', floorId, editLocked: false, wallId: wall.id,
    offsetReferenceVertexId: reverseReference ? wall.endVertexId : wall.startVertexId, offsetMm: 2550, widthMm: 900,
    kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
  scene.entityLayers.door = layerId
  const routes = [
    [{ x: 3000, y: -1000 }, { x: 3000, y: 1000 }],
    [{ x: 5000, y: 3000 }, { x: 7000, y: 3000 }],
    [{ x: 3000, y: 5000 }, { x: 3000, y: 7000 }],
    [{ x: -1000, y: 3000 }, { x: 1000, y: 3000 }],
  ]
  return { scene, request: { floorId, pointsMm: routes[wallIndex], widthMm: 900 } }
}

describe('exact orthogonal doorway clearance', () => {
  it.each([0, 1, 2, 3].flatMap(wallIndex => [false, true].map(reverseReference => ({ wallIndex, reverseReference }))))(
    'accepts 900mm at wall $wallIndex with reversed reference $reverseReference and rejects real intrusions', ({ wallIndex, reverseReference }) => {
      const { scene, request } = room(wallIndex, reverseReference)
      expect(checkTerrainRoute(scene, request)).toMatchObject({ ok: true, issues: [] })
      expect(openingEndpoints(scene, scene.openings.door).every(p => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y))).toBe(true)
      expect(checkTerrainRoute(scene, { ...request, widthMm: 901 })).toMatchObject({ ok: false, issues: [{ code: 'TERRAIN_TRAVEL_WALL', entityId: 'w' + wallIndex }] })
      const pointsMm = request.pointsMm.map(p => wallIndex % 2 ? { ...p, y: p.y + 1 } : { ...p, x: p.x + 1 })
      expect(checkTerrainRoute(scene, { ...request, pointsMm }).ok).toBe(false)
      scene.openings.door.locked = true
      expect(checkTerrainRoute(scene, request).ok).toBe(false)
      scene.openings.door.locked = false; scene.openings.door.state = 'closed'
      expect(checkTerrainRoute(scene, request).ok).toBe(false)
      scene.openings.door.state = 'open'; scene.openings.door.kind = 'window'
      expect(checkTerrainRoute(scene, request).ok).toBe(false)
    })

  it('preserves fractional diagonal offsets instead of rounding them to integer millimetres', () => {
    const start = { x: 100, y: 200 }, end = { x: 3100, y: 4200 }
    expect(wallOffsetPoint(start, end, 1250)).toEqual({ x: 850, y: 1200 })
    expect(wallOffsetPoint(start, end, 1)).toEqual({ x: 100.6, y: 200.8 })
    expect(wallOffsetPoint(end, start, 1250)).toEqual({ x: 2350, y: 3200 })
  })
})
