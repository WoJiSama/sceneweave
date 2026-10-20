import { describe, expect, it } from 'vitest'
import { createBenchmarkScene, createHouse } from './seed'
import type { PointMm, SceneDocument } from './types'
import { netClearance, openingEndpoints, roomPoints, wallLength } from './geometry'
import { validateScene } from './schema'

const codes = (scene: unknown): string[] => { const result = validateScene(scene); return result.ok ? [] : result.errors.map(issue => issue.code) }
function draftPolygon(points: PointMm[]): SceneDocument {
  const scene = createHouse('test')
  scene.rooms = {}; scene.vertices = {}; scene.walls = {}; scene.openings = {}; scene.props = {}; scene.regions = {}; scene.notes = {}
  scene.constraints.entranceOpeningIds = []
  points.forEach((point, i) => {
    const id = `v-${i}`
    scene.vertices[id] = { id, floorId: 'f-a1', xMm: point.x, yMm: point.y, editLocked: false }
    scene.walls[`w-${i}`] = { id: `w-${i}`, floorId: 'f-a1', startVertexId: id, endVertexId: `v-${(i + 1) % points.length}`, thicknessMm: 100, blocksMovement: true, blocksSight: true, editLocked: false }
  })
  scene.rooms.r = { id: 'r', floorId: 'f-a1', boundaryVertexIds: points.map((_, i) => `v-${i}`), purpose: 'draft', visibility: 'public', accessExpectation: 'unspecified', editLocked: false }
  return scene
}

describe('scene geometry and structural validation', () => {
  it('accepts the original house with one shared wall, closed doors and an unrevealed corridor', () => {
    const scene = createHouse('test')
    const result = validateScene(scene)
    expect(result.ok).toBe(true)
    expect(Object.values(scene.walls).filter(w => w.startVertexId === 'v-b2' && w.endVertexId === 'v-e5')).toHaveLength(1)
    expect(scene.openings['o-c3']).toMatchObject({ state: 'closed', secret: true, revealed: false })
    expect(netClearance(1300, 100, 100)).toBe(1200)
    expect(wallLength(scene, scene.walls['w-6a'])).toBe(7000)
    expect(openingEndpoints(scene, scene.openings['o-b2'])).toEqual([{ x: 8000, y: 7500 }, { x: 8000, y: 8600 }])
    expect(roomPoints(scene, scene.rooms['r-a1'])[0]).toEqual({ x: 2000, y: 4000 })
  })
  it('keeps required structural access through closed, locked and secret doors', () => {
    const scene = createHouse()
    for (const opening of Object.values(scene.openings)) { opening.state = 'closed'; opening.locked = true }
    expect(validateScene(scene).ok).toBe(true)
    expect(scene.openings['o-c3'].revealed).toBe(false)
  })
  it('accepts a 2000-prop workload without requiring rooms or pairwise prop collision checks', () => {
    const scene = createBenchmarkScene(2000)
    expect(validateScene(scene).ok).toBe(true)
    expect(Object.keys(scene.props)).toHaveLength(2000)
  })
  it('rejects unknown top-level and nested fields rather than stripping semantics', () => {
    expect(codes({ ...createHouse(), unknownMeaning: true })).toContain('SCHEMA')
    const scene = createHouse()
    Object.assign(scene.props['p-a1'], { script: 'run()' })
    expect(codes(scene)).toContain('SCHEMA')
  })
  it('rejects fractional world coordinates and nonfinite dimensions', () => {
    const scene = createHouse(); scene.vertices['v-a1'].xMm = 2.5
    expect(codes(scene)).toContain('SCHEMA')
    const other = createHouse(); other.walls['w-0a'].thicknessMm = Infinity
    expect(codes(other)).toContain('SCHEMA')
  })
  it('does not discard prototype dictionary entries or treat inherited names as entity references', () => {
    const scene = createHouse()
    const raw = JSON.parse(JSON.stringify(scene))
    Object.defineProperty(raw.props, '__proto__', { value: { ...scene.props['p-a1'], id: '__proto__' }, enumerable: true })
    expect(codes(raw)).toContain('UNSAFE_KEY')
    scene.vertices['v-a1'].floorId = 'toString'
    scene.openings['o-b2'].wallId = 'constructor'
    expect(codes(scene)).toEqual(expect.arrayContaining(['MISSING_FLOOR', 'MISSING_WALL']))
  })
  it('checks translated integer polygon winding without floating point cancellation', () => {
    const scene = draftPolygon([{x:0,y:0},{x:2000,y:0},{x:2000,y:2000},{x:0,y:2000}])
    const shift = 8_000_000_000_000_000
    for (const vertex of Object.values(scene.vertices)) { vertex.xMm += shift; vertex.yMm += shift }
    scene.floors['f-a1'].boundsMm = {x:shift,y:shift,width:10000,height:10000}
    expect(validateScene(scene).ok).toBe(true)
  })
  it('checks collection identity, globally unique IDs, references and floor membership', () => {
    const scene = createHouse(); scene.vertices['v-a1'].id = 'p-a1'; scene.vertices['v-b2'].floorId = 'missing'
    expect(codes(scene)).toEqual(expect.arrayContaining(['ID_KEY_MISMATCH', 'DUPLICATE_ID', 'MISSING_FLOOR', 'CROSS_FLOOR_REFERENCE']))
    const other = createHouse(); delete other.vertices['v-a1']
    expect(codes(other)).toContain('MISSING_VERTEX')
  })
  it('rejects clockwise reversal, zero area, diagonal rooms and self intersections', () => {
    const backwards = createHouse(); backwards.rooms['r-a1'].boundaryVertexIds.reverse()
    expect(codes(backwards)).toContain('POLYGON_WINDING')
    expect(codes(draftPolygon([{x:0,y:0},{x:2000,y:0},{x:1000,y:1000}]))).toContain('NON_ORTHOGONAL_ROOM')
    expect(codes(draftPolygon([{x:0,y:0},{x:2000,y:0},{x:2000,y:2000},{x:1000,y:2000},{x:1000,y:-500},{x:0,y:-500}]))).toContain('SELF_INTERSECTION')
    expect(codes(draftPolygon([{x:0,y:0},{x:2000,y:0},{x:1000,y:0}]))).toContain('POLYGON_WINDING')
  })
  it('detects coincident room interiors even when every vertex is on the other boundary', () => {
    const scene = createHouse()
    scene.rooms['r-duplicate'] = { ...scene.rooms['r-a1'], id: 'r-duplicate', accessExpectation: 'unspecified' }
    expect(codes(scene)).toContain('ROOM_OVERLAP')
  })
  it('detects positive-area overlap without rejecting edge-only room contact', () => {
    const scene = createHouse()
    expect(codes(scene)).not.toContain('ROOM_OVERLAP')
    scene.rooms['r-overlap'] = { ...scene.rooms['r-a1'], id:'r-overlap', boundaryVertexIds:['v-a1','v-c3','v-d4','v-f6'], accessExpectation:'unspecified' }
    expect(codes(scene)).toContain('ROOM_OVERLAP')
  })
  it('rejects duplicate and partially overlapping walls and unsplit intersections', () => {
    const duplicate = createHouse(); duplicate.walls.extra = { ...duplicate.walls['w-0a'], id: 'extra' }
    expect(codes(duplicate)).toEqual(expect.arrayContaining(['DUPLICATE_WALL', 'OVERLAPPING_WALLS', 'ROOM_WALL_MISMATCH']))
    const crossing = createHouse()
    crossing.vertices.extraA = { id:'extraA', floorId:'f-a1', xMm:4000, yMm:3000, editLocked:false }
    crossing.vertices.extraB = { id:'extraB', floorId:'f-a1', xMm:4000, yMm:6000, editLocked:false }
    crossing.walls.extra = { ...crossing.walls['w-0a'], id:'extra', startVertexId:'extraA', endVertexId:'extraB' }
    expect(codes(crossing)).toContain('UNSPLIT_INTERSECTION')
    const partial = createHouse()
    partial.vertices.extraA = { id:'extraA', floorId:'f-a1', xMm:4000, yMm:4000, editLocked:false }
    partial.walls.extra = { ...partial.walls['w-0a'], id:'extra', startVertexId:'extraA' }
    expect(codes(partial)).toContain('OVERLAPPING_WALLS')
  })
  it('requires one matching wall for every room edge and no coincident vertex aliases', () => {
    const scene = createHouse(); delete scene.walls['w-0a']
    expect(codes(scene)).toContain('ROOM_WALL_MISMATCH')
    const aliases = createHouse(); aliases.vertices.alias = { ...aliases.vertices['v-a1'], id:'alias' }
    expect(codes(aliases)).toContain('COINCIDENT_VERTICES')
  })
  it('checks opening references, wall-end clearance, overlap and configured minimum width', () => {
    const missing = createHouse(); missing.openings['o-b2'].wallId = 'missing'
    expect(codes(missing)).toContain('MISSING_WALL')
    const edge = createHouse(); edge.openings['o-b2'].offsetMm = 50
    expect(codes(edge)).toContain('OPENING_CLEARANCE')
    const overlapping = createHouse(); overlapping.openings.extra = { ...overlapping.openings['o-b2'], id:'extra', offsetMm:4000 }
    expect(codes(overlapping)).toContain('OPENING_OVERLAP')
    const narrow = createHouse(); narrow.constraints.minDoorWidthMm = 1000
    expect(codes(narrow)).toContain('DOOR_WIDTH')
  })
  it('does not confuse windows with a room connection and permits explicitly isolated drafts', () => {
    const scene = createHouse(); scene.openings['o-b2'].kind = 'window'
    expect(codes(scene)).toContain('REQUIRED_UNREACHABLE')
    scene.rooms['r-b2'].accessExpectation = 'intentionalIsolation'
    scene.rooms['r-c3'].accessExpectation = 'intentionalIsolation'
    expect(validateScene(scene).ok).toBe(true)
    scene.rooms['r-b2'].accessExpectation = 'unspecified'
    const result = validateScene(scene)
    expect(result.ok && result.warnings.some(w => w.code === 'DRAFT_ACCESS')).toBe(true)
  })
  it('requires an explicit external entrance when required rooms exist', () => {
    const scene = createHouse(); scene.constraints.entranceOpeningIds = []
    expect(codes(scene)).toContain('REQUIRED_UNREACHABLE')
    scene.constraints.entranceOpeningIds = ['o-b2']
    expect(codes(scene)).toContain('INVALID_ENTRANCE')
  })
  it('uses floor boundaries rather than export crop, including rotated prop footprints', () => {
    const scene = createHouse(); scene.exportBoundsMm = {x:0,y:0,width:1000,height:1000}
    expect(validateScene(scene).ok).toBe(true)
    scene.props['p-b2'].positionMm = {x:-900,y:0}; scene.props['p-b2'].rotationDeg = 45
    expect(codes(scene)).toContain('OUTSIDE_FLOOR')
  })
  it('rejects dangling and cyclic note anchors', () => {
    const scene = createHouse(); scene.notes['n-a1'].anchor = {type:'entity',entityKind:'prop',entityId:'missing'}
    expect(codes(scene)).toContain('MISSING_ANCHOR')
    scene.notes['n-a1'].anchor = {type:'entity',entityKind:'note',entityId:'n-b2'}
    scene.notes['n-b2'].anchor = {type:'entity',entityKind:'note',entityId:'n-a1'}
    expect(codes(scene)).toContain('CYCLIC_ANCHOR')
  })
  it('rejects unsupported path guarantees and floor counts explicitly', () => {
    const scene = createHouse(); scene.constraints.minPathWidthMm = 1200
    expect(codes(scene)).toContain('UNSUPPORTED_PATH_CLEARANCE')
    delete scene.constraints.minPathWidthMm
    scene.constraints.pathChecks = [{id:'path',from:{type:'point',positionMm:{x:3000,y:5000}},to:{type:'point',positionMm:{x:6000,y:5000}},clearanceMm:1000,mode:'current',assumedOpenDoorIds:[]}]
    expect(codes(scene)).toContain('UNSUPPORTED_PATH_CHECK')
    scene.floors.extra = {...scene.floors['f-a1'], id:'extra'}
    expect(codes(scene)).toContain('UNSUPPORTED_FLOORS')
  })
  it('checks region simplicity and keeps a manual mask out of movement semantics', () => {
    const scene = createHouse(); scene.regions['g-a1'].blocksMovement = true
    expect(codes(scene)).toContain('MASK_MOVEMENT')
    scene.regions['g-a1'].blocksMovement = false
    scene.regions['g-a1'].movementCostMultiplier = 2
    expect(codes(scene)).toContain('MASK_MOVEMENT')
    scene.regions['g-a1'].movementCostMultiplier = 1
    scene.regions['g-a1'].boundaryMm.reverse()
    expect(validateScene(scene).ok).toBe(true)
  })
})
