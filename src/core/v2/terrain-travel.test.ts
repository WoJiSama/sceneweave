import { describe, expect, it } from 'vitest'
import { emptyB3V2, rectangleV2, terrainFixtureV2, testPropV2 } from './b3.test-helpers'
import { applyCommandsV2 } from './commands'
import { validateSceneV2 } from './schema'
import { assertTerrainConnectionClearancesV2, checkTerrainTravelV2 } from './terrain-travel'

const route = { floorId: 'f-a1', from: { x: 6500, y: 10000 }, to: { x: 13500, y: 10000 }, widthMm: 2000 }
const fixture = [{ connectionId: 'island-stairs', minWidthMm: 2000, approachDepthMm: 2000 }]

describe('finite current terrain movement', () => {
  it('crosses differing heights only through the valid full-width declared stairs and both approaches', () => {
    const scene = terrainFixtureV2()
    expect(validateSceneV2(scene).ok).toBe(true)
    expect(checkTerrainTravelV2(scene, route)).toEqual({ ok: true, issues: [] })
    expect(() => assertTerrainConnectionClearancesV2(scene, fixture)).not.toThrow()
    const elevated = applyCommandsV2(scene, [{ type: 'setTerrainElevation', id: 'island-high', groundElevationMm: 4000 }])
    expect(checkTerrainTravelV2(elevated, route).ok).toBe(true)
  })
  it('rejects a cliff crossing away from stairs and requires the whole requested width to fit', () => {
    const scene = terrainFixtureV2()
    const elsewhere = checkTerrainTravelV2(scene, { ...route, from: { x: 8000, y: 5000 }, to: { x: 12000, y: 5000 }, widthMm: 500 })
    expect(elsewhere.ok).toBe(false); expect(elsewhere.issues.map(item => item.code)).toContain('TERRAIN_HEIGHT_CONNECTION')
    expect(checkTerrainTravelV2(scene, { ...route, widthMm: 2001 }).ok).toBe(false)
    expect(checkTerrainTravelV2(scene, { ...route, from: { x: 6500, y: 10001 }, to: { x: 13500, y: 10001 } }).ok).toBe(false)
  })
  it('keeps an ordinary no-connection draft valid and reports its actual impassable cliff', () => {
    const scene = terrainFixtureV2(), draft = applyCommandsV2(scene, [{ type: 'removeTerrainConnection', id: 'island-stairs' }])
    expect(validateSceneV2(draft).ok).toBe(true)
    const check = checkTerrainTravelV2(draft, route)
    expect(check.ok).toBe(false); expect(check.issues.map(item => item.code)).toContain('TERRAIN_HEIGHT_CONNECTION')
    expect(() => assertTerrainConnectionClearancesV2(draft, fixture)).toThrow(/required/)
  })
  it('honors connection blocking and never treats shallow-looking water or a reef picture as a path', () => {
    const scene = terrainFixtureV2(), blocked = applyCommandsV2(scene, [{ type: 'setConnectionBlocked', id: 'island-stairs', blocksMovement: true }])
    expect(validateSceneV2(blocked).ok).toBe(true); expect(checkTerrainTravelV2(blocked, route).ok).toBe(false)
    const reef = testPropV2('reef', 500, 500); reef.blocksMovement = false; reef.footprintMm = { width: 100, height: 100 }; reef.visualBoundsMm = { x: -50, y: -50, width: 100, height: 100 }; reef.supportRef = { kind: 'terrainArea', id: 'island-water' }; scene.props.reef = reef
    expect(validateSceneV2(scene).ok).toBe(true)
    const water = checkTerrainTravelV2(scene, { floorId: 'f-a1', from: { x: 100, y: 500 }, to: { x: 900, y: 500 }, widthMm: 100 })
    expect(water.ok).toBe(false); expect(water.issues.map(item => item.code)).toContain('TERRAIN_NOT_WALKABLE')
    expect(checkTerrainTravelV2(scene, { floorId: 'f-a1', from: { x: -100, y: 500 }, to: { x: 900, y: 500 }, widthMm: 100 }).ok).toBe(false)
  })
  it('checks a real rotated footprint entering an approach even when its centre is outside the reserved width', () => {
    const scene = terrainFixtureV2(), tree = testPropV2('tree', 7000, 11200)
    tree.footprintMm = { width: 1400, height: 200 }; tree.visualBoundsMm = { x: -700, y: -100, width: 1400, height: 200 }; tree.rotationDeg = 45
    scene.props.tree = tree
    expect(validateSceneV2(scene).ok).toBe(true)
    // The unrotated rectangle is clear; the rotated long edge enters the route.
    tree.positionMm.y = 11300
    expect(checkTerrainTravelV2(scene, route).ok).toBe(false)
    tree.rotationDeg = 0
    expect(checkTerrainTravelV2(scene, route).ok).toBe(true)
    tree.rotationDeg = 45
    expect(() => assertTerrainConnectionClearancesV2(scene, fixture)).toThrow(/真实旋转占地/)
  })
  it('keeps appearance/layer separate from actual tree trunk movement blocking', () => {
    const scene = terrainFixtureV2(), tree = testPropV2('tree', 7000, 11600)
    tree.visualBoundsMm = { x: -2250, y: -2250, width: 4500, height: 4500 }; tree.footprintMm = { width: 600, height: 600 }; tree.renderLayer = 'canopy'
    scene.props.tree = tree
    expect(checkTerrainTravelV2(scene, route).ok).toBe(true)
    tree.positionMm.y = 11100
    expect(checkTerrainTravelV2(scene, route).ok).toBe(false)
    tree.blocksMovement = false
    expect(checkTerrainTravelV2(scene, route).ok).toBe(true)
  })
  it('uses actual current wall openings and locks even on a zero-height room/floor route', () => {
    const scene = emptyB3V2(), points = rectangleV2(2000, 2000, 6000, 6000)
    points.forEach((p, index) => {
      const id = `v${index}`, wallId = `w${index}`
      scene.vertices[id] = { id, floorId: 'f-a1', editLocked: false, xMm: p.x, yMm: p.y }
      scene.walls[wallId] = { id: wallId, floorId: 'f-a1', editLocked: false, startVertexId: id, endVertexId: `v${(index + 1) % points.length}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    })
    scene.rooms.room = { id: 'room', floorId: 'f-a1', editLocked: false, visibility: 'public', boundaryVertexIds: points.map((_p, index) => `v${index}`), purpose: 'door fixture', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'f-a1' }, groundElevationMm: 0, floorStyle: null }
    scene.openings.door = { id: 'door', floorId: 'f-a1', editLocked: false, wallId: 'w0', offsetReferenceVertexId: 'v0', offsetMm: 2500, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    const doorway = { floorId: 'f-a1', from: { x: 5000, y: 1000 }, to: { x: 5000, y: 3000 }, widthMm: 1000 }
    expect(checkTerrainTravelV2(scene, doorway).ok).toBe(true)
    scene.openings.door.state = 'closed'; expect(checkTerrainTravelV2(scene, doorway).ok).toBe(false)
    scene.openings.door.state = 'open'; scene.openings.door.locked = true; expect(checkTerrainTravelV2(scene, doorway).ok).toBe(false)
    scene.openings.door.locked = false; scene.openings.door.kind = 'window'; expect(checkTerrainTravelV2(scene, doorway).ok).toBe(false)
  })
  it('derives a blocking height boundary even when no decorative TerrainEdge is stored', () => {
    const scene = terrainFixtureV2(); scene.terrainEdges = {}
    const check = checkTerrainTravelV2(scene, { ...route, from: { x: 8000, y: 5000 }, to: { x: 12000, y: 5000 }, widthMm: 500 })
    expect(check.ok).toBe(false); expect(check.issues.some(issue => issue.code === 'TERRAIN_HEIGHT_CONNECTION')).toBe(true)
  })
  it('rejects invalid connection geometry and invalid requests without asserting alternative routes', () => {
    const scene = terrainFixtureV2()
    scene.terrainConnections['island-stairs'].to.positionMm = { x: 19500, y: 10000 }
    expect(checkTerrainTravelV2(scene, route).issues.map(item => item.code)).toContain('CONNECTION_ENDPOINT')
    expect(checkTerrainTravelV2(scene, { ...route, widthMm: 0 }).issues[0].code).toBe('INVALID_TERRAIN_TRAVEL')
    expect(() => assertTerrainConnectionClearancesV2(terrainFixtureV2(), [...fixture, ...fixture])).toThrow(/唯一/)
  })
})
