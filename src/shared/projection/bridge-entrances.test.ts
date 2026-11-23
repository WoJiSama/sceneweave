import { describe, expect, it } from 'vitest'
import { createVisualBlankDocument } from '../../platform/browser/content/visual-samples.js'
import { TERRAIN_FACADES } from '../appearance/terrain-facade.js'
import { applyCommands } from '../commands/commands.js'
import { pointInPolygon } from '../geometry/geometry.js'
import type { Path, PointMm } from '../model/scene.js'
import { DEFAULT_BRIDGE_RELIEF, DEFAULT_BRIDGE_STRUCTURE } from '../path-assembly/contracts.js'
import { bridgeSideOffset } from '../path-assembly/profiles.js'
import { bridgeWalkCap, exposedEdgeSegments, fitSteelLandingFacades, planBridgeEntrances, replacePathCaps } from './bridge-entrances.js'
import { projectEditorScene, projectScene } from './projection.js'
import { projectPath } from './paths.js'
import type { ProjectedBridgeEntrance, ProjectedSurface } from './types.js'

const p = (x: number, y: number) => ({ x, y })
const surface = (id: string, x: number, right: number, elevationMm = 1000): ProjectedSurface => ({ id,
  points: [p(x, -5000), p(right, -5000), p(right, 5000), p(x, 5000)], style: null, priority: 1, elevationMm,
})
const ref = (id: string) => ({ kind: 'terrainArea' as const, id })
const path = (id: string, widthMm: number, centerlineMm: PointMm[], supportRefs: Path['supportRefs']): Path => ({ id, floorId: 'floor', editLocked: false,
  visibility: 'public', centerlineMm, widthMm, supportRefs, renderOrder: 0, movementCostMultiplier: 1, surfaceStyle: null,
})
function fixture(bent = false) {
  const bridge = path('bridge', 2200, bent ? [p(5000, 0), p(8500, 0), p(12000, 1400), p(15500, 1400)] : [p(5000, 0), p(15500, 0)], [ref('deck')])
  bridge.assembly = { version: 1, routeFingerprint: '', members: {},
    bridge: { deckId: 'deck', elevationMm: 1000, finish: 'steel', visibility: 'public' },
    recipe: { sides: 'both', shoulderMm: 720, endClearanceMm: 200, section: { kind: 'steel', lengthMm: 2400 }, structure: DEFAULT_BRIDGE_STRUCTURE },
  }
  const west = path('in-west', 2900, [p(-800, -1700), p(4000, -170)], [ref('west'), ref('deck')])
  const east = path('in-east', 1800, [p(16500, bent ? 1420 : 20), p(21500, bent ? 2350 : 950)], [ref('east'), ref('deck')])
  const rows = [west, east, bridge].map(source => ({ source, projected: projectPath(source, null), elevationMm: 1000 }))
  const deck = { ...surface('deck', 0, 1), points: rows[2].projected.bridge!.outline, bridgeSupport: true as const }
  return { rows, terrain: [surface('west', -3000, 4400), surface('east', 16100, 23500), deck] }
}

describe('projected bridge entrances', () => {
  it.each([false, true])('connects two supported approaches with width transitions (bent %s)', bent => {
    const { rows, terrain } = fixture(bent)
    const before = JSON.stringify([rows, terrain]), joins = planBridgeEntrances(rows, terrain, [])
    expect(joins.map(join => [join.end, join.platform?.id, join.approach?.pathId])).toEqual([['start', 'west', 'in-west'], ['end', 'east', 'in-east']])
    expect(joins[0].platform?.contactMm.x).toBeCloseTo(4400)
    expect(joins[1].platform?.contactMm.x).toBeCloseTo(16100)
    for (const join of joins) {
      const approach = join.approach!, path = rows.find(row => row.source.id === approach.pathId)!.projected
      expect(join.platform?.shoulderCut.length).toBe(1)
      const [right, left] = approach.sides
      expect(Math.hypot(right[0].x - left[0].x, right[0].y - left[0].y)).toBeCloseTo(2200)
      expect(Math.hypot(right.at(-1)!.x - left.at(-1)!.x, right.at(-1)!.y - left.at(-1)!.y)).toBeCloseTo(rows.find(row => row.source.id === path.id)!.source.widthMm)
      expect(pointInPolygon(approach.from, replacePathCaps(path.points, [approach]))).toBe(true)
      expect(bridgeWalkCap(rows[2].projected.bridge!, join.end).every(p => pointInPolygon(p, rows[2].projected.points))).toBe(true)
    }
    expect(JSON.stringify([rows, terrain])).toBe(before)
  })

  it('leaves other heights, unavailable roads and unbound crossings independent', () => {
    const { rows: [west, east, bridge], terrain } = fixture(true)
    const distant = { ...west, source: { ...west.source, supportRefs: [ref('elsewhere')] } }
    const high = { ...east, elevationMm: 2500 }
    const joins = planBridgeEntrances([bridge, distant, high], terrain.map(area => area.id === 'east' ? { ...area, elevationMm: 2500 } : area), [])
    expect(joins.map(join => [join.end, join.platform?.id, join.approach])).toEqual([['start', 'west', undefined]])
    expect(planBridgeEntrances([bridge], [], [])).toEqual([])
  })

  it.each([false, true])('opens the facade when the full bridge mouth meets the platform at its exact cap (landing %s)', landing => {
    const { rows: [, , row] } = fixture()
    const { bridgehead, ...structure } = row.source.assembly!.recipe.structure!
    row.source.assembly!.recipe.structure = landing ? { ...structure, bridgehead } : structure
    const bridge = { ...row, projected: projectPath(row.source, null) }
    const capX = Math.min(...bridge.projected.bridge!.outline.map(point => point.x))
    const bank = surface('west', -3000, capX)
    const [join] = planBridgeEntrances([bridge], [bank], [])
    expect(join?.platform).toMatchObject({ id: bank.id, contactMm: p(capX, 0) })
    expect(join.platform!.edgeOpening.some(region => pointInPolygon(p(capX, 0), region.outerMm))).toBe(true)
    const outline = bridge.projected.bridge!.outline
    const exposed = exposedEdgeSegments(outline.map((a, i) => [a, outline[(i + 1) % outline.length]]), join.platform!.shoulderCut)
    expect(exposed).toHaveLength(outline.length - 1)
    expect(exposed.some(([a, b]) => a.x === capX && b.x === capX)).toBe(false)
    expect(planBridgeEntrances([bridge], [surface('west', -3000, capX - 1)], [])).toEqual([])
    expect(planBridgeEntrances([bridge], [{ ...bank, elevationMm: 1001 }], [])).toEqual([])
    const narrowBank = { ...bank, points: bank.points.map(point => p(point.x, point.y / 10)) }
    expect(planBridgeEntrances([bridge], [narrowBank], [])).toEqual([])
  })

  it('places the compact bridge seam on the linked deck cap and keeps the road taper supported', () => {
    const { rows: [west, , bridge] } = fixture()
    delete bridge.source.assembly!.recipe.structure
    bridge.source.assembly!.bridge!.finish = 'timber'
    bridge.source.assembly!.bridge!.roadLinks = { start: { pathId: west.source.id, end: 'end', restMm: p(3547, 0) } }
    west.source.centerlineMm = [p(-800, 0), p(2097, 0), p(3547, 0)]
    const rows = [west, bridge].map(row => ({ ...row, projected: projectPath(row.source, null) }))
    const land = [surface('west', -3000, 5001)]
    const [joined] = planBridgeEntrances(rows, land, [])
    expect(joined.approach).toMatchObject({ pathId: 'in-west', deckEdgeMm: p(5000, 0) })
    expect(joined.approach!.from.x).toBeGreaterThan(5000)
    expect(joined.approach!.to.x).toBeLessThan(5000)
    expect(rows[1].projected.bridge!.relief?.depthMm).toBeGreaterThan(0)
    const mask = [p(12000, -800), p(14000, -800), p(14000, 800), p(12000, 800)]
    expect(projectPath(bridge.source, null, [mask]).bridge!.relief).toBeUndefined()

    delete bridge.source.assembly!.bridge!.roadLinks
    expect(planBridgeEntrances(rows, land, [])[0]?.approach?.deckEdgeMm).toBeUndefined()
    expect(planBridgeEntrances([rows[1]], land, [])[0]?.approach).toBeUndefined()
  })

  it('derives the visible steel landing in both views while preserving the authored facade', () => {
    const now = '2026-11-22T00:00:00.000Z'
    const blank = createVisualBlankDocument({ sceneId: 'landing-fit', title: 'Landing fit', widthMm: 24000, heightMm: 18000, preset: 'narrative', now })
    const floorId = Object.keys(blank.floors)[0], layerId = Object.keys(blank.userLayers)[0]
    let id = 0
    const context = { clock: { now: () => now }, ids: { nextId: () => `landing-fit-${++id}` } }
    const glass = { ...TERRAIN_FACADES['glazed-v1'], depthMm: 6150 }
    const layered = applyCommands(blank, [{ type: 'createLayer', id: 'steel-layer', floorId, name: 'Steel bridge' }], context)
    let scene = applyCommands(layered, [
      { type: 'createTerrainArea', id: 'landing', floorId, layerId, groundElevationMm: 4200, coveragePriority: 1,
        boundaryMm: [p(1000, 2500), p(6200, 2500), p(6200, 9500), p(1000, 9500)], facade: glass },
      { type: 'createTerrainArea', id: 'other-roof', floorId, layerId, groundElevationMm: 5100, coveragePriority: 2,
        boundaryMm: [p(14800, 2500), p(23000, 2500), p(23000, 9500), p(14800, 9500)], facade: glass },
      { type: 'setPathAssembly', id: 'steel-crossing', floorId, layerId: 'steel-layer', centerlineMm: [p(5500, 6000), p(17500, 6000)], widthMm: 2200,
        bridge: { elevationMm: 4200, finish: 'steel', visibility: 'public' }, recipe: { sides: 'both', shoulderMm: 1400, endClearanceMm: 200,
          section: { kind: 'steel', lengthMm: 2000 }, structure: { ...DEFAULT_BRIDGE_STRUCTURE, relief: { ...DEFAULT_BRIDGE_RELIEF, depthMm: 2200 } } } },
    ], context)
    const first = projectScene(scene, 'gm')
    expect(first.bridgeEntrances?.map(({ platform }) => platform?.id)).toEqual(['landing'])
    const facadeOf = (areaId: string, projection = projectScene(scene, 'gm')) => projection.terrain.find(area => area.id === areaId)!.facade!
    const landingOffset = (projection = projectScene(scene, 'gm')) => projection.bridgeEntrances?.find(row => row.platform?.id === 'landing')?.platform?.girderOffsetMm
    for (const audience of ['gm', 'player'] as const) {
      const projection = projectScene(scene, audience)
      expect(facadeOf('landing', projection)).toEqual(glass)
      expect(landingOffset(projection)).toEqual(bridgeSideOffset(2200))
    }
    expect(facadeOf('other-roof')).toEqual(glass)
    expect(facadeOf('landing', projectEditorScene(scene, { hiddenLayerIds: new Set(['steel-layer']) }))).toEqual(glass)
    expect(scene.terrainAreas.landing.facade).toEqual(glass)

    const privateBridge = applyCommands(scene, [{ type: 'setPathAssembly', id: 'steel-crossing', floorId,
      centerlineMm: scene.paths['steel-crossing'].centerlineMm, widthMm: 2200,
      bridge: { elevationMm: 4200, finish: 'steel', visibility: 'gm' }, recipe: scene.paths['steel-crossing'].assembly!.recipe,
    }], context)
    const masked = applyCommands(privateBridge, [{ type: 'upsertManualMask', id: 'bridge-mask', floorId, layerId,
      boundsMm: { x: 0, y: 0, width: 24000, height: 18000 } }], context)
    const player = projectScene(masked, 'player')
    expect(player.paths).toEqual([])
    expect(player.bridgeEntrances).toBeUndefined()
    expect(facadeOf('landing', player)).toEqual(glass)
    expect(facadeOf('landing', projectScene(masked, 'gm'))).toEqual(glass)

    const deep = { ...TERRAIN_FACADES['girder-v1'], depthMm: 2600, facing: 'left' as const }
    scene = applyCommands(scene, [{ type: 'updateTerrainArea', id: 'landing', changes: { facade: null } }], context)
    expect(facadeOf('landing')).toMatchObject({ profile: 'girder-v1', depthMm: 1276 })
    expect(scene.terrainAreas.landing.facade).toBeNull()
    scene = applyCommands(scene, [{ type: 'updateTerrainArea', id: 'landing', changes: { facade: deep } }], context)
    expect(facadeOf('landing')).toEqual(deep)
    scene = applyCommands(scene, [{ type: 'updateTerrainArea', id: 'landing', changes: { facade: { ...deep, depthMm: 900 } } }], context)
    expect(facadeOf('landing')).toMatchObject({ depthMm: 900, facing: 'left' })
    expect(scene.terrainAreas.landing.facade?.facing).toBe('left')
    const crossing = scene.paths['steel-crossing'], recipe = crossing.assembly!.recipe
    scene = applyCommands(scene, [{ type: 'setPathAssembly', id: crossing.id, floorId, centerlineMm: crossing.centerlineMm, widthMm: crossing.widthMm,
      bridge: { elevationMm: 4200, finish: 'steel', visibility: 'public' }, recipe: { ...recipe,
        structure: { ...recipe.structure!, relief: { ...DEFAULT_BRIDGE_RELIEF, depthMm: 1500 } } } }], context)
    expect(facadeOf('landing')).toMatchObject({ depthMm: 900, facing: 'left' })
    expect(landingOffset()).toEqual(bridgeSideOffset(1500))
    expect(facadeOf('other-roof')).toEqual(glass)
    scene = applyCommands(scene, [{ type: 'setPathAssembly', id: crossing.id, floorId, centerlineMm: crossing.centerlineMm, widthMm: crossing.widthMm,
      bridge: { elevationMm: 4200, finish: 'steel', visibility: 'public' }, recipe: { ...recipe,
        structure: { ...recipe.structure!, relief: { ...DEFAULT_BRIDGE_RELIEF, depthMm: 0 } } } }], context)
    expect(facadeOf('landing')).toMatchObject({ depthMm: 900, facing: 'left' })
    expect(landingOffset()).toEqual(p(0, 0))
    scene = applyCommands(scene, [{ type: 'updateTerrainArea', id: 'landing', changes: { facade: null } }], context)
    scene = applyCommands(scene, [{ type: 'setPathAssembly', id: crossing.id, floorId, centerlineMm: crossing.centerlineMm, widthMm: crossing.widthMm,
      bridge: { elevationMm: 4200, finish: 'steel', visibility: 'public' }, recipe: { ...recipe, structure: DEFAULT_BRIDGE_STRUCTURE } }], context)
    scene = applyCommands(scene, [{ type: 'upsertManualMask', id: 'unrelated-mask', floorId, layerId,
      boundsMm: { x: 21000, y: 14000, width: 2000, height: 2000 } }], context)
    expect(facadeOf('landing', projectScene(scene, 'player'))).toBeUndefined()
  })

  it('uses the shallowest visible girder as the fallback and keeps each actual landing offset', () => {
    const { rows, terrain } = fixture(true)
    const [bridgeRow] = rows.filter(row => row.projected.bridge)
    bridgeRow.source.assembly!.recipe.structure = { ...DEFAULT_BRIDGE_STRUCTURE, relief: DEFAULT_BRIDGE_RELIEF }
    const near = projectPath(bridgeRow.source, null)
    const shallow = { ...near, id: 'other-bridge', bridge: { ...near.bridge!, relief: { ...near.bridge!.relief!, depthMm: 800 } } }
    const start = planBridgeEntrances([{ ...bridgeRow, projected: near }], terrain, [])[0]
    const joins: ProjectedBridgeEntrance[] = [start, { ...start, bridgeId: shallow.id }]
    const glass = { ...TERRAIN_FACADES['glazed-v1'] }
    for (const order of [joins, joins.toReversed()]) {
      const auto = terrain.map(area => ({ ...area }))
      const platforms = terrain.map(area => ({ ...area, facade: glass }))
      const entrances = order.map(entrance => ({ ...entrance, platform: { ...entrance.platform! } }))
      fitSteelLandingFacades(platforms, [near, shallow], entrances)
      expect(platforms[0].facade).toEqual(glass)
      expect(platforms[1].facade).toEqual(glass)
      expect(Object.fromEntries(entrances.map(({ bridgeId, platform }) => [bridgeId, platform.girderOffsetMm])))
        .toEqual({ bridge: bridgeSideOffset(1500), 'other-bridge': bridgeSideOffset(800) })
      fitSteelLandingFacades(auto, [near, shallow], entrances)
      expect(auto[0].facade).toMatchObject({ profile: 'girder-v1', depthMm: 464 })
    }
    const platforms = terrain.map(area => ({ ...area, facade: glass }))
    fitSteelLandingFacades(platforms, [near, shallow], joins, [[p(0, 0), p(1000, 0), p(1000, 1000), p(0, 1000)]])
    expect(platforms[0].facade).toEqual(glass)
  })
})
