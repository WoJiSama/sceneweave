import { describe, expect, it } from 'vitest'
import { mapAuthoringExample, mapDimensions, MAP_OPERATION_LIMIT, parseMapEdit, parseMapGenerate } from './map-authoring.js'
import { commandSelectionLimit } from '../budget/command-budget.js'
import { splitNewTerrainJunctions } from '../geometry/terrain-junctions.js'
import { indexEdges, withGeometryPairCounter } from '../geometry/edge-index.js'
import { polygonsOverlap, propFootprint, segmentCuts, terrainPoints } from '../geometry/geometry.js'
import { checkGradedRoadOnValidScene, checkRouteOnValidScene } from '../geometry/terrain-travel.js'
import { reliefBounds, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import { captureExecutionBudget, taskBudgetProfile } from '../budget/task-budget.js'
import { LANDSCAPE_SCATTER_VERSION } from '../geometry/scatter-algorithm.js'
import { buildScatterRegeneration } from '../geometry/scatter.js'
import { shapeLandscape, type LandscapeRoadFailure } from '../terrain-generation/landscape-authoring.js'
import { finishLandscape, landscapeRouteClearances } from '../terrain-generation/landscape-finish.js'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { appendWholePlantDefinitions } from '../../platform/browser/content/whole-plant-catalog.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { checkLandscapeAscents } from '../../application/workspace/landscape-map.js'

const point = (x: number, y: number) => ({ x, y })
const square = (x: number, y: number) => [point(x, y), point(x + 10, y), point(x + 10, y + 10), point(x, y + 10)]
function landscapeFixture(request: ReturnType<typeof parseMapGenerate>) {
  const dimensions = mapDimensions(request)
  const scene = appendWholePlantDefinitions(createShoreBlankDocument('coast', {
    ...dimensions, title: request.title, sceneId: 'reference-anchors', now: '2026-11-25T00:00:00.000Z', preset: 'narrative',
  }, false, false, 'naturalStone'), new Set(['pine-branched', 'oak-spreading', 'hazel-bush']))
  const source = request.referenceSizePx ?? { width: 1000, height: 1000 }
  const place = ({ x, y }: { x: number; y: number }) => point(Math.round(x * dimensions.widthMm / source.width), Math.round(y * dimensions.heightMm / source.height))
  return { scene, floor: Object.values(scene.floors)[0], frame: { point: place, size: place }, meter: captureExecutionBudget(taskBudgetProfile('standard')) }
}

describe('public map authoring contract', () => {
  it('accepts the native explicit-command range for both generate and edit', () => {
    expect(MAP_OPERATION_LIMIT).toBe(commandSelectionLimit())
    const operations = Array.from({ length: MAP_OPERATION_LIMIT + 1 }, (_, i) =>
      ({ kind: 'terrain', id: `bank-${i}`, boundary: square(i * 20, 20) }))
    const edit = { projectHash: '0'.repeat(64), floorId: 'floor' }
    for (const count of [64, 65, 66, MAP_OPERATION_LIMIT]) {
      expect(parseMapGenerate({ title: 'bank', operations: operations.slice(0, count) }).operations).toHaveLength(count)
      expect(parseMapEdit({ ...edit, operations: operations.slice(0, count) }).operations).toHaveLength(count)
    }
    expect(() => parseMapGenerate({ title: 'bank', operations })).toThrow()
    expect(() => parseMapEdit({ ...edit, operations })).toThrow()
    expect(() => parseMapGenerate({ title: 'bank', operations: [{ ...operations[0], priority: 10001 }] })).toThrow()
  })

  it('calibrates an image with two points and resolves one consistent fallback scale', () => {
    const { recipe } = mapAuthoringExample('landscape')
    const referenceSizePx = { width: 1080, height: 810 }
    const request = { title: 'path', recipe, referenceSizePx }
    expect(mapDimensions(parseMapGenerate(request))).toEqual({ widthMm: 78000, heightMm: 58500 })
    const referenceScale = { from: point(100, 100), to: point(250, 300), lengthMm: 17500 }
    expect(mapDimensions(parseMapGenerate({ ...request, referenceScale }))).toEqual({ widthMm: 75600, heightMm: 56700 })
    expect(() => parseMapGenerate({ ...request, referenceScale: { ...referenceScale, to: referenceScale.from } })).toThrow()
  })

  it('makes a gradeable route with two image endpoints and places a local editable woodland', () => {
    const request = parseMapGenerate(mapAuthoringExample('landscape-reference'))
    const { recipe, referenceSizePx, title, seed } = request
    if (recipe.kind !== 'landscape' || !referenceSizePx) throw new Error('Expected a reference landscape')
    const dimensions = mapDimensions(request)
    const scene = appendWholePlantDefinitions(createShoreBlankDocument('coast', {
      ...dimensions, title, sceneId: 'reference-anchors', now: '2026-11-25T00:00:00.000Z', preset: 'narrative',
    }, false, false, 'naturalStone'), new Set(['pine-branched', 'oak-spreading', 'hazel-bush']))
    const floor = Object.values(scene.floors)[0], scale = dimensions.widthMm / referenceSizePx.width
    const frame = { point: ({ x, y }: { x: number; y: number }) => point(Math.round(x * scale), Math.round(y * scale)),
      size: ({ x, y }: { x: number; y: number }) => point(Math.round(x * scale), Math.round(y * scale)) }
    const meter = captureExecutionBudget(taskBudgetProfile('standard'))
    const forms = shapeLandscape(scene, floor, recipe, frame, seed, meter)
    finishLandscape(scene, floor, recipe, forms, frame, seed, meter)
    const checked = validateSceneSnapshot(scene)
    expect(checked.ok, checked.ok ? undefined : JSON.stringify(checked.errors.slice(0, 5))).toBe(true)
    const route = scene.paths.ascent, summit = forms.find(row => row.id === 'summit')!
    expect(route.automaticRoute?.fixedPointsMm.some(p => Math.abs(p.x - summit.at.x) < 3 && p.y < summit.at.y - 5000)).toBe(true)
    const travel = checkGradedRoadOnValidScene(scene, route)
    expect(travel.ok, JSON.stringify(travel.issues)).toBe(true)
    expect(travel.treadCount).toBeGreaterThan(0)
    expect(travel.elevationsMm[1]).toBeGreaterThan(travel.elevationsMm[0] + 3000)
    const woods = scene.scatterGroups['west-woods']
    expect(woods.algorithmVersion).toBe(LANDSCAPE_SCATTER_VERSION)
    const retained = Object.values(woods.members).find(row => row.propId !== null)
    expect(retained).toBeDefined()
    const prop = scene.props[retained!.propId!]
    prop.editLocked = true
    expect(buildScatterRegeneration(scene, woods.id, 0).group.members).toEqual(
      expect.objectContaining({ [Object.keys(woods.members).find(key => woods.members[key] === retained)!]: retained }))
  })

  it('keeps exact shared junctions without rounding a fractional crossing onto the wrong edge', () => {
    const rows = splitNewTerrainJunctions([
      { id: 'bank', points: square(0, 0) },
      { id: 'terrace', points: [point(10, 4), point(20, 4), point(20, 8), point(10, 8)] },
      { id: 'detached', points: square(30, 30) },
    ])
    expect(rows[0].points).toEqual([point(0, 0), point(10, 0), point(10, 4), point(10, 8), point(10, 10), point(0, 10)])
    expect(rows[2].points).toEqual(square(30, 30))
    const fractional = splitNewTerrainJunctions([{ id: 'a', points: square(0, 0) },
      { id: 'b', points: [point(9, -1), point(11, 2), point(12, -1)] }])
    expect(fractional[0].points).toEqual(square(0, 0))
  })

  it('retains an authored hill in a lowland and paints it without changing terrain or corridor clearance', () => {
    const request = parseMapGenerate({ title: '河谷', widthMm: 36000, heightMm: 32000,
      recipe: { kind: 'landscape', environment: 'upland', land: [{ id: 'valley',
        boundary: [point(10, 10), point(990, 10), point(990, 990), point(10, 990)] }],
      landforms: [
        { id: 'basin', areaId: 'valley', shape: 'lowland', at: point(500, 510), radius: point(330, 300), elevationMm: 300 },
        { id: 'rock', areaId: 'valley', shape: 'hill', at: point(610, 555), radius: point(90, 95), elevationMm: 2800, preserveRelief: true },
      ], covers: [{ id: 'grass-bed', areaId: 'valley', region: { at: point(465, 520), radius: point(330, 245) }, cover: 'grass' }],
      scenery: [{ id: 'meadow', areaId: 'valley', region: { at: point(480, 510), radius: point(320, 250) }, pattern: 'meadow' }] },
      checks: [{ id: 'footway', points: [point(150, 440), point(500, 440), point(770, 444)], widthMm: 1250 }],
    })
    const { scene, floor, frame, meter } = landscapeFixture(request), { recipe } = request
    if (recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const forms = shapeLandscape(scene, floor, recipe, frame, request.seed, meter)
    const area = scene.terrainAreas.valley, terrain = structuredClone(area.relief!)
    const base = reliefBounds(terrainPoints(area))
    const elevation = (site: string) => area.groundElevationMm + sampleTerrainRelief(terrain, base, forms.find(row => row.id === site)!.at).offsetMm
    expect(elevation('rock') - elevation('basin')).toBeGreaterThan(2200)
    const [walk] = request.checks
    const bands = landscapeRouteClearances([walk], floor, frame.point)
    finishLandscape(scene, floor, recipe, forms, frame, request.seed, meter, bands)
    expect(area.relief).toEqual(terrain)
    expect(area.surfaceStyle!.overlays.some(overlay => overlay.id === 'landscape/cover/grass-bed')).toBe(true)
    expect(Object.values(scene.props).length).toBeGreaterThan(5)
    expect(scene.scatterGroups.meadow.exclusions.length).toBe(2)
    expect(Object.values(scene.props).some(prop => polygonsOverlap(propFootprint(prop), bands[0].boundaryMm))).toBe(false)
    expect(checkRouteOnValidScene(scene, { floorId: floor.id, pointsMm: walk.points.map(frame.point), widthMm: walk.widthMm }).ok).toBe(true)
    expect(validateSceneSnapshot(scene).ok).toBe(true)
  })

  it('rounds suitable shore spans while retaining shared edges and a cropped outline', () => {
    const request = parseMapGenerate({ title: '潮岸', widthMm: 36000, heightMm: 29000, recipe: { kind: 'landscape', land: [
      { id: 'bank', form: 'flat', outline: 'smooth', boundary: [point(0, 350), point(50, 0), point(250, 0), point(520, 140), point(520, 490), point(290, 700), point(0, 600)] },
      { id: 'neighbor', form: 'flat', outline: 'smooth', boundary: [point(520, 140), point(770, 140), point(770, 490), point(520, 490)] },
    ] } })
    const { scene, floor, frame, meter } = landscapeFixture(request)
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    shapeLandscape(scene, floor, request.recipe, frame, request.seed, meter)
    const points = terrainPoints(scene.terrainAreas.bank)
    const fixed = [frame.point(point(520, 140)), frame.point(point(520, 490))]
    expect(points.length).toBeGreaterThan(7)
    expect(points.every(p => p.x >= 0 && p.y >= 0)).toBe(true)
    expect(points.slice(points.findIndex(p => p.x === fixed[0].x && p.y === fixed[0].y), points.findIndex(p => p.x === fixed[1].x && p.y === fixed[1].y) + 1)).toEqual(fixed)
    expect(validateSceneSnapshot(scene).ok).toBe(true)
  })

  it('connects to a peak near a boundary with real platforms and preserves a diagnostic draft for insufficient room', () => {
    const request = parseMapGenerate({ title: '崖顶路', widthMm: 78000, heightMm: 75000, recipe: { kind: 'landscape',
      land: [{ id: 'bank', boundary: [point(80, 410), point(170, 205), point(340, 170), point(510, 90),
        point(640, 85), point(770, 130), point(860, 260), point(925, 720), point(300, 810), point(95, 720)] }],
      landforms: [{ id: 'peak', areaId: 'bank', shape: 'hill', at: point(600, 162), radius: point(118, 88), elevationMm: 11200 }],
      routes: [{ id: 'climb', areaId: 'bank', style: 'stairs', widthMm: 1500, via: [{ at: point(408, 392) }, { at: point(629, 145) }],
        around: { landmarkId: 'peak', side: 'west' } }],
    } })
    const { recipe } = request
    if (recipe.kind !== 'landscape') throw new Error('Expected landscape')
    for (const flipped of [false, true]) {
      const fit = landscapeFixture(request), copy = structuredClone(recipe)
      if (flipped) {
        const mirror = ({ x, y }: { x: number; y: number }) => point(1000 - x, y)
        copy.land[0].boundary = copy.land[0].boundary!.map(mirror).reverse()
        copy.landforms[0].at = mirror(copy.landforms[0].at)
        const route = copy.routes[0]
        if (!('via' in route)) throw new Error('Expected explicitly anchored route')
        route.via = route.via.map(anchor => ({ ...anchor, at: mirror(anchor.at) }))
        copy.routes[0].around!.side = 'east'
      }
      shapeLandscape(fit.scene, fit.floor, copy, fit.frame, request.seed, fit.meter)
      const route = fit.scene.paths.climb, travel = checkGradedRoadOnValidScene(fit.scene, route)
      expect(travel.ok).toBe(true)
      expect(travel.widthMm).toBe(1500)
      expect(travel.treadCount).toBeGreaterThan(15)
      expect(route.roadSurface!.stations.some(station => station.kind === 'landing')).toBe(true)
    }
    const impossible = landscapeFixture(request), reasons: LandscapeRoadFailure[] = []
    recipe.routes[0].around!.radiusMm = 1000
    shapeLandscape(impossible.scene, impossible.floor, recipe, impossible.frame, request.seed, impossible.meter, reasons)
    expect(impossible.scene.paths.climb).toBeUndefined()
    expect(reasons[0].issues[0]).toMatchObject({ code: 'LANDSCAPE_ROAD_NOT_FOUND', entityId: 'climb', atMm: impossible.frame.point(recipe.landforms[0].at) })
  })

  it('keeps spatial edge query order and includes contacts exactly at the box boundary', () => {
    const segments = Array.from({ length: 25 }, (_, i) => [point(i * 10, 0), point((i + 1) * 10, 0)] as const)
    expect(indexEdges(segments)(point(20, 0), point(30, 0))).toEqual([1, 2, 3])
    expect(indexEdges(segments)(point(20, 1), point(30, 1))).toEqual([])
    expect(indexEdges(segments)(point(20, 1), point(30, 1), 1)).toEqual([1, 2, 3])
  })

  it('checks dense road bands and small obstacles without comparing distant edges', () => {
    const rim = Array.from({ length: 120 }, (_, i) => point(i * 10, 0))
    const band = [...rim, ...rim.toReversed().map(({ x }) => point(x, 20))]
    let pairs = 0
    withGeometryPairCounter(count => { pairs += count }, () => {
      expect(polygonsOverlap(band, square(515, 4))).toBe(true)
      expect(polygonsOverlap(band, square(515, 20))).toBe(false)
      expect(polygonsOverlap(band, square(515, 15))).toBe(true)
      expect(segmentCuts(point(0, 5), point(10, 5), [
        [point(5, 0), point(5, 10)], [point(6, 25), point(6, 30)], [point(3, 5), point(4, 5)],
      ])).toEqual([0, .3, .4, .5, 1])
    })
    expect(pairs).toBeLessThan(16)
  })

  it('checks the saved road from a low region to its named summit and rejects a shortened route', () => {
    const input = parseMapGenerate(mapAuthoringExample('landscape-ascent'))
    if (input.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const { scene, floor, frame, meter } = landscapeFixture(input)
    shapeLandscape(scene, floor, input.recipe, frame, input.seed, meter)
    const road = scene.paths.ascent, result = checkGradedRoadOnValidScene(scene, road)
    expect(result.ok, JSON.stringify(result.issues)).toBe(true)
    expect(result.treadCount).toBeGreaterThan(10)
    expect(checkLandscapeAscents(scene, floor, input, true)).toMatchObject([{ ok: true, lowElevationMm: 500, highElevationMm: 7200, riseMm: 6700 }])
    const requirement = input.recipe.routes[0]
    if (!('ascent' in requirement)) throw new Error('Expected an ascent requirement')
    requirement.ascent.from.at = input.recipe.landforms[0].at
    expect(checkLandscapeAscents(scene, floor, input, false)[0].issues).toContainEqual(expect.objectContaining({ code: 'ASCENT_START' }))
    expect(() => checkLandscapeAscents(scene, floor, input, true)).toThrow('标记低处')
    const fallback = landscapeFixture(input), failed: LandscapeRoadFailure[] = []
    requirement.ascent.from.radius = point(10, 10)
    shapeLandscape(fallback.scene, fallback.floor, input.recipe, fallback.frame, input.seed, fallback.meter, failed)
    expect(failed[0].issues[0].code).toBe('LANDSCAPE_ASCENT_START')
    expect(fallback.scene.paths.ascent).toBeUndefined()
  })

  it('fits grouped stair flights and checks their actual end approaches', () => {
    const input = parseMapGenerate(mapAuthoringExample('landscape-ascent'))
    if (input.recipe.kind !== 'landscape' || !('ascent' in input.recipe.routes[0])) throw new Error('Expected landscape ascent')
    input.recipe.routes[0].ascent.staircase = 'flight'
    const { scene, floor, frame, meter } = landscapeFixture(input)
    shapeLandscape(scene, floor, input.recipe, frame, input.seed, meter)
    const travel = checkGradedRoadOnValidScene(scene, scene.paths.ascent, 650)
    expect(travel.ok).toBe(true)
    expect(travel.treadCount).toBeGreaterThan(12)
    expect(travel.elevationsMm).toEqual([500, 7200])
  })
})
