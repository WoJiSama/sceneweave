import { describe, expect, it } from 'vitest'
import { mapAuthoringExample, mapDimensions, MAP_OPERATION_LIMIT, parseMapEdit, parseMapGenerate } from './map-authoring.js'
import { commandSelectionLimit } from '../budget/command-budget.js'
import { splitNewTerrainJunctions } from '../geometry/terrain-junctions.js'
import { indexEdges, withGeometryPairCounter } from '../geometry/edge-index.js'
import { polygonInside, polygonsOverlap, propFootprint, segmentCuts, terrainPoints } from '../geometry/geometry.js'
import { checkGradedRoadOnValidScene, checkRouteOnValidScene } from '../geometry/terrain-travel.js'
import { reliefBounds, reliefMatchesAlong, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import { captureExecutionBudget, measureTaskBudget, taskBudgetProfile } from '../budget/task-budget.js'
import { LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION, LANDSCAPE_SCATTER_VERSION, LANDSCAPE_WOODLAND_SCATTER_VERSION } from '../geometry/scatter-algorithm.js'
import { buildScatterRegeneration } from '../geometry/scatter.js'
import { gradeLandscapeRouteRelief, shapeLandscape, type LandscapeRoadFailure, type LandscapeWidthAttempt } from '../terrain-generation/landscape-authoring.js'
import { finishLandscape, landscapeRouteClearances } from '../terrain-generation/landscape-finish.js'
import { rankLandscapeCourses } from '../terrain-generation/landscape-route-search.js'
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

  it('meters newly generated shore edges with their land but retains direct edits and real references', () => {
    const request = parseMapGenerate({ title: 'shore', recipe: { kind: 'landscape', environment: 'coast', finish: 'natural', density: 0,
      land: [{ id: 'shoal', form: 'flat', elevationMm: 1000, at: point(500, 500), radius: point(390, 350) }] } })
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const { scene, floor, frame, meter } = landscapeFixture(request), before = structuredClone(scene)
    const forms = shapeLandscape(scene, floor, request.recipe, frame, request.seed, meter)
    finishLandscape(scene, floor, request.recipe, forms, frame, request.seed, meter)
    const generic = measureTaskBudget(before, scene), editing = measureTaskBudget(before, scene, undefined, {}, 'map-spatial-v2')
    const generation = measureTaskBudget(before, scene, undefined, {}, 'landscape-spatial-v3')
    const edges = Object.values(scene.terrainEdges)
    expect(edges.length).toBeGreaterThan(3)
    expect(generation.semanticTargets).toBe(editing.semanticTargets - edges.length)
    expect(generation.geometrySegments).toBe(editing.geometrySegments)
    expect(generation.dependencyRefs).toBe(generic.dependencyRefs - Object.values(scene.terrainAreas).reduce((n, area) => n + area.boundaryMm.length, 0))
    expect(generation.dependencyRefs).toBeGreaterThan(edges.length)
    const edited = structuredClone(scene)
    edited.terrainEdges[edges[0].id].editLocked = true
    expect(measureTaskBudget(scene, edited, undefined, {}, 'landscape-spatial-v3').semanticTargets).toBe(1)
  })

  it('keeps the heights of a ridge beside a basin and of a close preserved outcrop', () => {
    const request = parseMapGenerate({ title: 'adjacent heights', widthMm: 56000, heightMm: 42000,
      recipe: { kind: 'landscape', environment: 'upland', finish: 'natural', density: 0,
        land: [{ id: 'valley', at: point(500, 500), radius: point(490, 465) }], landforms: [
          { id: 'upper-basin', areaId: 'valley', shape: 'lowland', at: point(318, 330), radius: point(170, 100), elevationMm: 650,
            structure: { kind: 'area', boundary: [point(221, 262), point(472, 270), point(461, 392), point(243, 407)] } },
          { id: 'ridge', areaId: 'valley', shape: 'ridge', at: point(441, 351), radius: point(120, 66), elevationMm: 6000,
            structure: { kind: 'ridge', centerline: [point(392, 354), point(441, 351), point(514, 333)] } },
          { id: 'lower-basin', areaId: 'valley', shape: 'lowland', at: point(580, 690), radius: point(155, 156), elevationMm: 450 },
          { id: 'outcrop', areaId: 'valley', shape: 'hill', preserveRelief: true, at: point(604, 653), radius: point(80, 92), elevationMm: 3900 },
        ] } })
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const { scene, floor, frame, meter } = landscapeFixture(request)
    const forms = shapeLandscape(scene, floor, request.recipe, frame, request.seed, meter)
    const area = scene.terrainAreas.valley, bounds = reliefBounds(terrainPoints(area))
    for (const form of forms) {
      const height = area.groundElevationMm + sampleTerrainRelief(area.relief!, bounds, form.at).offsetMm
      expect(Math.abs(height - form.elevationMm), form.id).toBeLessThan(380)
    }
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

  it('places both canopy and understory in an editable grove with an open walking corridor', () => {
    const input = parseMapGenerate({ title: '沟谷林丛', widthMm: 24000, heightMm: 22000, recipe: {
      kind: 'landscape', finish: 'natural', density: 0, land: [{ id: 'valley', form: 'flat',
        boundary: [point(35, 35), point(965, 35), point(965, 965), point(35, 965)] }],
      scenery: [{ id: 'woods', areaId: 'valley', palette: 'woodland', pattern: 'grove', density: 1,
        region: { at: point(500, 500), radius: point(310, 280) } }],
    }, checks: [{ id: 'walk', points: [point(160, 500), point(830, 500)], widthMm: 1400 }] })
    if (input.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const { scene, floor, frame, meter } = landscapeFixture(input)
    const forms = shapeLandscape(scene, floor, input.recipe, frame, input.seed, meter)
    const [walk] = landscapeRouteClearances(input.checks, floor, frame.point)
    finishLandscape(scene, floor, input.recipe, forms, frame, input.seed, meter, [walk])
    const woods = scene.scatterGroups.woods
    expect(woods.algorithmVersion).toBe(LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION)
    const planted = Object.values(scene.props)
    expect(planted.filter(prop => /prop-(oak|pine)/.test(prop.definitionRef!.id)).length).toBeGreaterThan(3)
    expect(planted.some(prop => /hazel-bush|coastal-heath|grass-fan/.test(prop.definitionRef!.id))).toBe(true)
    expect(planted.some(prop => polygonsOverlap(propFootprint(prop), walk.boundaryMm))).toBe(false)
    expect(buildScatterRegeneration(scene, woods.id).group.members).toEqual(woods.members)
    const repeated = buildScatterRegeneration(scene, woods.id, woods.densityFactor, { preserveManagedAppearance: true })
    expect(repeated.group.members).toEqual(woods.members)
    expect(repeated.props).toEqual(repeated.props.map(prop => scene.props[prop.id]))
  })

  it('fits trees into a narrow dry woodland at a low absolute elevation', () => {
    const input = parseMapGenerate({ title: '谷底窄林', widthMm: 24000, heightMm: 22000, seed: 'dry-grove', recipe: {
      kind: 'landscape', finish: 'natural', density: 0,
      land: [{ id: 'valley', form: 'flat', boundary: [point(35, 35), point(965, 35), point(965, 965), point(35, 965)] }],
      landforms: [{ id: 'floor', areaId: 'valley', shape: 'lowland', elevationMm: 200, at: point(500, 500), radius: point(365, 290),
        structure: { kind: 'area', boundary: [point(220, 360), point(780, 360), point(780, 640), point(220, 640)] } }],
      scenery: [{ id: 'woods', areaId: 'valley', palette: 'woodland', pattern: 'grove', density: 1,
        region: { boundary: [point(230, 475), point(765, 483), point(753, 559), point(235, 545)] } }],
    } })
    if (input.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const { scene, floor, frame, meter } = landscapeFixture(input)
    const forms = shapeLandscape(scene, floor, input.recipe, frame, input.seed, meter)
    finishLandscape(scene, floor, input.recipe, forms, frame, input.seed, meter)
    const woods = scene.scatterGroups.woods, area = scene.terrainAreas.valley, bounds = reliefBounds(terrainPoints(area))
    if (woods.domain.kind !== 'area' || !woods.domain.boundaryMm) throw new Error('Expected bounded woodland')
    const boundary = woods.domain.boundaryMm
    const trees = Object.values(scene.props).filter(prop => /prop-(oak|pine)/.test(prop.definitionRef!.id))
    expect(trees.length).toBeGreaterThan(2)
    for (const tree of trees) {
      expect(polygonInside(propFootprint(tree), boundary)).toBe(true)
      expect(area.groundElevationMm + sampleTerrainRelief(area.relief!, bounds, tree.positionMm).offsetMm).toBe(200)
    }
    const old = structuredClone(scene)
    old.scatterGroups.woods = { ...woods, algorithmVersion: LANDSCAPE_WOODLAND_SCATTER_VERSION, members: {} }
    old.props = {}
    expect(buildScatterRegeneration(old, woods.id).props).toHaveLength(0)
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

  it('finishes traced grass with a bounded edge and editable plants inside that cover', () => {
    const input = parseMapGenerate({ title: '沿岸草地', widthMm: 39000, heightMm: 34000, recipe: {
      kind: 'landscape', environment: 'coast', finish: 'natural', density: .95,
      land: [{ id: 'bank', outline: 'traced', boundary: [point(25, 30), point(970, 30), point(940, 950), point(110, 930)] }],
      covers: [{ id: 'grass', areaId: 'bank', cover: 'grass',
        region: { boundary: [point(240, 230), point(620, 210), point(720, 350), point(660, 650), point(315, 770), point(195, 530)] } }],
    } })
    const { scene, floor, frame, meter } = landscapeFixture(input), { recipe } = input
    if (recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const forms = shapeLandscape(scene, floor, recipe, frame, input.seed, meter)
    const area = scene.terrainAreas.bank, relief = structuredClone(area.relief)
    finishLandscape(scene, floor, recipe, forms, frame, input.seed, meter)
    expect(area.relief).toEqual(relief)
    const [grass] = area.surfaceStyle!.overlays
    expect(area.surfaceStyle!.overlays.map(row => row.id)).toEqual(['landscape/cover/grass'])
    expect(grass.boundaryMm.length).toBeGreaterThan(6)
    expect(grass.blendWidthMm).toBeLessThan(600)
    const growth = scene.scatterGroups['landscape/cover/grass/ground-cover']
    expect(growth.domain).toMatchObject({ areaId: area.id, boundaryMm: grass.boundaryMm })
    expect(growth.palette.map(row => row.key)).toEqual(['heath', 'grass'])
    expect(Object.keys(growth.members).length).toBeGreaterThan(0)
    expect(validateSceneSnapshot(scene).ok).toBe(true)
  })

  it('holds the sampled low point next to a broad preserved rock on a large relief grid', () => {
    const request = parseMapGenerate({ title: '湾底露岩', widthMm: 86000, heightMm: 82000, recipe: {
      kind: 'landscape', environment: 'coast', finish: 'natural',
      land: [{ id: 'shelf', boundary: [point(5, 5), point(995, 5), point(995, 995), point(5, 995)] }],
      landforms: [
        { id: 'low', areaId: 'shelf', shape: 'lowland', at: point(478, 735), radius: point(153, 115), elevationMm: 600 },
        { id: 'rock', areaId: 'shelf', shape: 'hill', at: point(480, 690), radius: point(59, 54), elevationMm: 4200,
          preserveRelief: true, structure: { kind: 'area', boundary: [point(442, 662), point(503, 650), point(530, 687), point(502, 731), point(447, 727)] } },
      ],
    } })
    const { scene, floor, frame, meter } = landscapeFixture(request)
    if (request.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    shapeLandscape(scene, floor, request.recipe, frame, request.seed, meter)
    const area = scene.terrainAreas.shelf, box = reliefBounds(terrainPoints(area))
    const elevation = (p: { x: number; y: number }) => area.groundElevationMm + sampleTerrainRelief(area.relief!, box, frame.point(p)).offsetMm
    expect(Math.abs(elevation(point(478, 735)) - 600)).toBeLessThan(50)
    expect(elevation(point(480, 690))).toBeGreaterThan(4100)
  })

  it('keeps far relief nodes unchanged and only evaluates the local road profile', () => {
    const input = parseMapGenerate(mapAuthoringExample('landscape-ascent'))
    if (input.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    input.recipe.routes = []
    const { scene, floor, frame, meter } = landscapeFixture(input)
    shapeLandscape(scene, floor, input.recipe, frame, input.seed, meter)
    const area = scene.terrainAreas.slope, original = area.relief!
    const [start, end] = [point(330, 620), point(465, 620)].map(frame.point)
    const before = meter.snapshot().fieldEvaluations
    const revised = gradeLandscapeRouteRelief(area, {
      id: 'local', areaId: area.id, widthMm: 1300, style: 'trail',
      via: [{ at: start, elevationMm: 1300 }, { at: end, elevationMm: 1500 }],
    }, meter)
    expect(revised.offsetsMm.slice(0, original.columns * 5)).toEqual(original.offsetsMm.slice(0, original.columns * 5))
    expect(revised.offsetsMm).not.toEqual(original.offsetsMm)
    expect(meter.snapshot().fieldEvaluations - before).toBeLessThan(original.offsetsMm.length * 2.5)
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
    requirement.widthMm = 2000
    expect(checkLandscapeAscents(scene, floor, input, false)[0]).toMatchObject({ ok: false,
      issues: [expect.objectContaining({ code: 'ASCENT_WIDTH' })] })
    requirement.ascent.minWidthMm = 1500
    expect(checkLandscapeAscents(scene, floor, input, true)[0]).toMatchObject({ ok: true, preferredWidthMm: 2000, minimumWidthMm: 1500, actualWidthMm: 1500 })
    requirement.around!.side = 'south'
    expect(checkLandscapeAscents(scene, floor, input, false)[0]).toMatchObject({ ok: false,
      issues: [expect.objectContaining({ code: 'ASCENT_SIDE' })] })
    requirement.around!.side = 'north'
    requirement.ascent.from.at = input.recipe.landforms[0].at
    expect(checkLandscapeAscents(scene, floor, input, false)[0].issues).toContainEqual(expect.objectContaining({ code: 'ASCENT_START' }))
    expect(() => checkLandscapeAscents(scene, floor, input, true)).toThrow('标记低处')
    const fallback = landscapeFixture(input), failed: LandscapeRoadFailure[] = []
    requirement.ascent.from.radius = point(10, 10)
    shapeLandscape(fallback.scene, fallback.floor, input.recipe, fallback.frame, input.seed, fallback.meter, failed)
    expect(failed[0].issues[0].code).toBe('LANDSCAPE_ASCENT_START')
    expect(fallback.scene.paths.ascent).toBeUndefined()
  })

  it('reports the exact fixed waypoint in water and leaves the rest of a diagnostic draft intact', () => {
    const input = parseMapGenerate({ title: '湾侧道路', widthMm: 24000, heightMm: 24000, recipe: { kind: 'landscape',
      environment: 'coast', land: [{ id: 'bank', at: point(500, 500), radius: point(450, 450) }],
      lakes: [{ id: 'pool', areaId: 'bank', boundary: [point(430, 410), point(580, 410), point(580, 560), point(430, 560)] }],
      routes: [{ id: 'crossing', areaId: 'bank', via: [{ at: point(260, 510) }, { at: point(505, 500) }, { at: point(710, 440) }] }] } })
    if (input.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const { scene, floor, frame, meter } = landscapeFixture(input), issues: LandscapeRoadFailure[] = []
    shapeLandscape(scene, floor, input.recipe, frame, input.seed, meter, issues)
    expect(scene.paths.crossing).toBeUndefined()
    expect(Object.keys(scene.terrainAreas)).toEqual(['landscape/water', 'bank', 'pool'])
    expect(issues).toMatchObject([{ id: 'crossing', issues: [{ code: 'LANDSCAPE_ROAD_WATER', atMm: frame.point(point(505, 500)) }] }])
    expect(validateSceneSnapshot(scene).ok).toBe(true)
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

  it('shortlists a compact ascent over a brief steep crossing', () => {
    const start = point(4000, 8000), end = point(16000, 8000)
    const compact = [start, end], traverse = [start, point(5800, 15000), point(14200, 15000), end]
    const boundary = [point(0, 0), point(24000, 0), point(24000, 23000), point(0, 23000)]
    const height = ({ x, y }: ReturnType<typeof point>) => {
      const blend = Math.min(1, (y - start.y) / 3500)
      return 3200 * ((x < 10000 ? 0 : 1) * (1 - blend) + blend * (x - start.x) / (end.x - start.x))
    }
    const meter = captureExecutionBudget(taskBudgetProfile('standard'))
    expect(rankLandscapeCourses([traverse, compact], 1400, boundary, [], height, meter, () => 0)[0]).toEqual(compact)
  })

  it('keeps an overlapping terrace open when an ascent crosses or approaches its shelf', () => {
    const input = parseMapGenerate({ title: '山地外台', widthMm: 40000, heightMm: 34000, seed: 'inland-shelf', recipe: {
      kind: 'landscape', finish: 'natural', land: [{ id: 'slope', outline: 'smooth', boundary: [
        point(47, 233), point(172, 80), point(401, 47), point(717, 60), point(918, 156), point(969, 394),
        point(924, 723), point(832, 904), point(656, 931), point(405, 950), point(99, 913), point(36, 655),
      ] }],
      landforms: [
        { id: 'top', areaId: 'slope', shape: 'plateau', at: point(535, 450), radius: point(220, 205), elevationMm: 7600, cover: 'grass',
          structure: { kind: 'area', boundary: [point(395, 300), point(621, 280), point(705, 377), point(690, 540), point(602, 620), point(417, 570)] } },
        { id: 'shelf', areaId: 'slope', shape: 'plateau', at: point(650, 420), radius: point(195, 170), elevationMm: 4200, cover: 'rock',
          structure: { kind: 'area', boundary: [point(566, 335), point(720, 318), point(825, 376), point(870, 470), point(800, 532), point(690, 540), point(581, 497)] } },
        { id: 'foot', areaId: 'slope', shape: 'lowland', at: point(264, 636), radius: point(150, 170), elevationMm: 350, cover: 'grass' },
      ],
    } })
    const { recipe } = input
    if (recipe.kind !== 'landscape') throw new Error('Expected landscape')
    for (const side of [undefined, 'north', 'east'] as const) {
      const { scene, floor, frame, meter } = landscapeFixture(input)
      const routes: typeof recipe.routes = side ? [{ id: 'steps', areaId: 'slope', style: 'stairs', widthMm: 1500,
        around: { landmarkId: 'top', side }, ascent: { from: { at: point(264, 636), radius: point(86, 75) },
          minRiseMm: 6500, toLandmarkId: 'top', staircase: 'flight' } }] : []
      shapeLandscape(scene, floor, { ...recipe, routes }, frame, input.seed, meter)
      const area = scene.terrainAreas.slope, bounds = reliefBounds(terrainPoints(area))
      const height = (at: ReturnType<typeof point>) => area.groundElevationMm + sampleTerrainRelief(area.relief!, bounds, at).offsetMm
      const top = frame.point(point(535, 450)), shelf = frame.point(point(650, 420))
      const angle = Math.atan2(shelf.y - top.y, shelf.x - top.x)
      const outlet = (distance: number) => point(shelf.x + distance * Math.cos(angle), shelf.y + distance * Math.sin(angle))
      expect(height(top)).toBe(7600)
      expect(height(shelf)).toBe(4200)
      for (let distance = 500; distance <= 5500; distance += 500) expect(Math.abs(height(outlet(distance)) - 4200)).toBeLessThan(side ? 300 : 50)
      if (side) expect(checkGradedRoadOnValidScene(scene, scene.paths.steps, 650)).toMatchObject({ ok: true, widthMm: 1500, elevationsMm: [350, 7600] })
      if (side === 'east') {
        const road = scene.paths.steps.centerlineMm
        expect(road.slice(1).some((p, i) => segmentCuts(road[i], p, [[shelf, outlet(5500)]]).length > 2)).toBe(true)
      }
    }
  })

  it('routes around a lower terrace on the approach and preserves the entire land and water rims', () => {
    const input = parseMapGenerate(mapAuthoringExample('landscape-ascent'))
    if (input.recipe.kind !== 'landscape') throw new Error('Expected landscape')
    const { recipe } = input
    recipe.environment = 'coast'
    recipe.landforms.push({ id: 'terrace', areaId: 'slope', shape: 'plateau', at: point(665, 417),
      radius: point(210, 200), elevationMm: 4200, rotationDeg: 0, cover: 'rock' })
    recipe.lakes = [{ id: 'basin', areaId: 'slope', boundary: [point(457, 299), point(486, 290), point(491, 337), point(450, 338)] }]
    const before = landscapeFixture(input), after = landscapeFixture(input)
    shapeLandscape(before.scene, before.floor, { ...recipe, routes: [] }, before.frame, input.seed, before.meter)
    shapeLandscape(after.scene, after.floor, recipe, after.frame, input.seed, after.meter)
    const original = before.scene.terrainAreas.slope, graded = after.scene.terrainAreas.slope
    const boundary = terrainPoints(graded), bounds = reliefBounds(boundary)
    const a = { grid: original.relief, bounds }, b = { grid: graded.relief, bounds }
    expect(graded.relief!.offsetsMm).not.toEqual(original.relief!.offsetsMm)
    expect(reliefMatchesAlong(a, b, boundary)).toBe(true)
    expect(reliefMatchesAlong(a, b, terrainPoints(after.scene.terrainAreas.basin))).toBe(true)
    const terrace = after.frame.point(recipe.landforms.at(-1)!.at)
    expect(sampleTerrainRelief(graded.relief!, bounds, terrace)).toEqual(sampleTerrainRelief(original.relief!, bounds, terrace))
    expect(checkLandscapeAscents(after.scene, after.floor, input, true)).toMatchObject([{ ok: true, actualWidthMm: 1500 }])
  })

  it('tries a narrower ascent only when the author supplies a smaller minimum', () => {
    const input = parseMapGenerate(mapAuthoringExample('landscape-ascent'))
    if (input.recipe.kind !== 'landscape' || !('ascent' in input.recipe.routes[0])) throw new Error('Expected landscape ascent')
    const route = input.recipe.routes[0]
    route.widthMm = 4000
    route.around!.radiusMm = 7500
    const strict = landscapeFixture(input), failed: LandscapeRoadFailure[] = []
    shapeLandscape(strict.scene, strict.floor, input.recipe, strict.frame, input.seed, strict.meter, failed)
    expect(strict.scene.paths.ascent).toBeUndefined()
    expect(failed[0].issues).toContainEqual(expect.objectContaining({ code: 'LANDSCAPE_ROAD_RADIUS' }))
    route.ascent.minWidthMm = 1500
    const flexible = landscapeFixture(input), attempts = new Map<string, LandscapeWidthAttempt[]>()
    shapeLandscape(flexible.scene, flexible.floor, input.recipe, flexible.frame, input.seed, flexible.meter, undefined, attempts)
    const [result] = checkLandscapeAscents(flexible.scene, flexible.floor, input, true, attempts)
    expect(result.actualWidthMm).toBeGreaterThan(1500)
    expect(result.actualWidthMm).toBeLessThan(4000)
    expect(result).toMatchObject({
      ok: true, minimumWidthMm: 1500, preferredWidthMm: 4000, reduction: {
        rejected: [{ widthMm: 4000, issues: expect.arrayContaining([expect.objectContaining({ code: 'LANDSCAPE_ROAD_RADIUS' })]) }],
      },
    })
    const fixedWidth = landscapeFixture(input)
    route.widthMm = result.actualWidthMm!
    delete route.ascent.minWidthMm
    shapeLandscape(fixedWidth.scene, fixedWidth.floor, input.recipe, fixedWidth.frame, input.seed, fixedWidth.meter)
    route.ascent.minWidthMm = 1500
    const lowerAllowed = landscapeFixture(input), reported = new Map<string, LandscapeWidthAttempt[]>()
    shapeLandscape(lowerAllowed.scene, lowerAllowed.floor, input.recipe, lowerAllowed.frame, input.seed, lowerAllowed.meter, undefined, reported)
    expect(lowerAllowed.scene.paths.ascent).toEqual(fixedWidth.scene.paths.ascent)
    expect(reported.size).toBe(0)
  })
})
