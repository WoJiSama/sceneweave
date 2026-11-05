import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createSpaceContext } from './space.js'
import { createRegionalFeasibilityVector } from '../terrain-generation/regional-vector.js'
import { propFootprint } from '../geometry/geometry.js'
const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
function scene() { return createShoreBlankDocument('island', { sceneId: 'space', title: '实际空间', now: '2026-11-04T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' }) }
describe('validated readonly common space facts', () => {
  it('uses full higher-priority support geometry and captures independent scene ownership', () => {
    const source = scene(); source.terrainAreas.high = { id: 'high', floorId: 'visual-floor', editLocked: false, visibility: 'gm', boundaryMm: rectangle(10000, 0, 14000, 18000).map((positionMm, i) => ({ id: `p${i}`, segmentId: `s${i}`, positionMm })), groundElevationMm: 1800, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }; source.entityLayers.high = 'visual-layer-ground'
    const context = createSpaceContext(source), within = rectangle(11000, 2000, 1000, 1000), crossing = rectangle(9500, 2000, 1000, 1000)
    expect(context.supportsPolygon(within, { kind: 'floor', id: 'visual-floor' }, 'visual-floor')).toBe(false)
    expect(context.supportsPolygon(within, { kind: 'terrainArea', id: 'high' }, 'visual-floor')).toBe(true)
    expect(context.supportsPolygon(crossing, { kind: 'terrainArea', id: 'high' }, 'visual-floor')).toBe(false)
    source.terrainAreas.high.boundaryMm[0].positionMm.x = 20000
    expect(context.supportsPolygon(within, { kind: 'terrainArea', id: 'high' }, 'visual-floor')).toBe(true)
    expect(context.artifacts.find(item => item.kind === 'support-surface' && item.payload.sourceRef.id === 'high')?.payload).toMatchObject({ elevationMm: 1800, visibility: 'gm' })
  })
  it('checks rotated physical footprints, independent of transparent visual bounds', () => {
    const source = scene(); source.props.blocker = { id: 'blocker', floorId: 'visual-floor', editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 0 }, visualBoundsMm: { x: 0, y: 0, width: 10, height: 10 }, positionMm: { x: 6000, y: 6000 }, rotationDeg: 45, footprintMm: { width: 3000, height: 1000 }, footprintOffsetMm: { x: 500, y: 0 }, blocksMovement: true, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: 'visual-floor' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }; source.entityLayers.blocker = 'visual-layer-ground'
    const context = createSpaceContext(source)
    expect(context.conflicts(rectangle(6200, 6200, 50, 50), 'visual-floor')).toEqual(['blocker'])
    expect(context.conflicts(rectangle(6200, 6200, 50, 50), 'visual-floor', 0, ['blocker'])).toEqual([])
    const footprint = context.artifacts.find(item => item.kind === 'footprint')
    expect(footprint?.kind === 'footprint' && footprint.payload.boundaryMm).toEqual(propFootprint(source.props.blocker))
    expect(Object.isFrozen(footprint?.payload)).toBe(true)
  })
  it('rejects an incomplete or invalid complete scene rather than projecting it', () => { const source = scene(); delete (source as Partial<typeof source>).surfaceRules; expect(() => createSpaceContext(source)).toThrow(/上下文无效/) })
  it('uses actual wall thickness and current door state for net clearance', () => {
    const source = scene()
    source.vertices.a = { id: 'a', floorId: 'visual-floor', editLocked: false, xMm: 1000, yMm: 5000 }
    source.vertices.b = { id: 'b', floorId: 'visual-floor', editLocked: false, xMm: 12000, yMm: 5000 }
    source.walls.wall = { id: 'wall', floorId: 'visual-floor', editLocked: false, startVertexId: 'a', endVertexId: 'b', thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    source.openings.door = { id: 'door', floorId: 'visual-floor', editLocked: false, wallId: 'wall', offsetReferenceVertexId: 'a', offsetMm: 4000, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    for (const id of ['a', 'b', 'wall', 'door']) source.entityLayers[id] = 'visual-layer-ground'
    const open = createSpaceContext(source)
    expect(open.conflicts(rectangle(5200, 4950, 100, 100), 'visual-floor')).toEqual([])
    expect(open.conflicts(rectangle(2000, 5050, 100, 100), 'visual-floor')).toContain('wall')
    const wall = open.artifacts.find(item => item.kind === 'wall'), door = open.artifacts.find(item => item.kind === 'opening')
    expect(wall?.payload).toMatchObject({ entityId: 'wall', visibility: 'public', startMm: { x: 1000, y: 5000 }, endMm: { x: 12000, y: 5000 }, thicknessMm: 200, blocksMovement: true, editLocked: false })
    expect(door?.payload).toMatchObject({ entityId: 'door', wallId: 'wall', visibility: 'public', startMm: { x: 5000, y: 5000 }, endMm: { x: 6000, y: 5000 }, widthMm: 1000, openingKind: 'door', state: 'open', locked: false, editLocked: false })
    expect(Object.isFrozen(wall?.payload)).toBe(true)
    expect(Object.isFrozen(door?.payload)).toBe(true)
    source.openings.door.state = 'closed'
    source.openings.door.secret = true
    source.userLayers['visual-layer-ground'].editLocked = true
    const closed = createSpaceContext(source)
    expect(closed.conflicts(rectangle(5200, 4950, 100, 100), 'visual-floor')).toContain('wall')
    expect(closed.artifacts.find(item => item.kind === 'wall')?.payload).toMatchObject({ editLocked: true })
    expect(closed.artifacts.find(item => item.kind === 'opening')?.payload).toMatchObject({ visibility: 'gm', state: 'closed', secret: true, editLocked: true })
    expect(door?.payload).toMatchObject({ visibility: 'public', state: 'open', secret: false, editLocked: false })
  })
  it('captures full wall and opening extents including joins independently of blocking and door state', () => {
    const source = scene()
    for (const [id, xMm, yMm] of [['a', 6000, 6000], ['b', 10000, 6000], ['c', 6000, 10000]] as const) source.vertices[id] = { id, floorId: 'visual-floor', editLocked: false, xMm, yMm }
    for (const [id, endVertexId, thicknessMm] of [['wall', 'b', 200], ['joined', 'c', 400]] as const) source.walls[id] = { id, floorId: 'visual-floor', editLocked: false, startVertexId: 'a', endVertexId, thicknessMm, blocksMovement: false, blocksSight: true, topStyle: null }
    source.openings.door = { id: 'door', floorId: 'visual-floor', editLocked: false, wallId: 'wall', offsetReferenceVertexId: 'a', offsetMm: 1000, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    for (const id of ['a', 'b', 'c', 'wall', 'joined', 'door']) source.entityLayers[id] = 'visual-layer-ground'
    const context = createSpaceContext(source), wall = context.entityGeometryPoints('wall'), door = context.entityGeometryPoints('door')
    // This miter corner lies outside both individual wall bands.
    expect(wall).toContainEqual({ x: 5800, y: 5900 })
    expect(wall).toContainEqual({ x: 10000, y: 6100 })
    expect(door).toEqual([{ x: 7000, y: 6100 }, { x: 8000, y: 6100 }, { x: 8000, y: 5900 }, { x: 7000, y: 5900 }])
    expect(context.entityGeometryPoints('missing')).toEqual([])
    expect(Object.isFrozen(wall)).toBe(true); expect(Object.isFrozen(wall[0])).toBe(true)
    expect(Object.isFrozen(door)).toBe(true); expect(Object.isFrozen(door[0])).toBe(true)
    source.walls.wall.thicknessMm = 600; source.openings.door.state = 'closed'
    const changed = createSpaceContext(source)
    expect(changed.entityGeometryPoints('door')).toContainEqual({ x: 7000, y: 6300 })
    expect(context.entityGeometryPoints('door')).toEqual(door)
    expect(context.entityGeometryPoints('wall')).toEqual(wall)
  })
  it('never grants tactical support or ports to a regional map', () => {
    const regional = createRegionalFeasibilityVector(scene()).document, context = createSpaceContext(regional)
    expect(context.coordinateFrame).toBe('region-mm')
    expect(context.artifacts.every(fact => fact.kind === 'plan-region')).toBe(true)
    expect(context.supportsPolygon(rectangle(1000, 1000, 1000, 1000), { kind: 'floor', id: 'visual-floor' }, 'visual-floor')).toBe(false)
    expect(context.connectionUsable('regional-vector-road', 100)).toBe(false)
    expect(context.entityGeometryPoints('regional-vector-road')).toEqual([])
  })

})
