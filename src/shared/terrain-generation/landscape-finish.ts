import type { ExecutionBudget } from '../budget/task-budget.js'
import type { MapCoverZone, MapLandscapeRecipe, MapRouteCheck, MapSceneryZone } from '../generation/map-authoring.js'
import { pointInPolygon, polygonValid, polygonsOverlap, terrainPoints } from '../geometry/geometry.js'
import { buildScatterRegeneration } from '../geometry/scatter.js'
import { LANDSCAPE_SCATTER_VERSION } from '../geometry/scatter-algorithm.js'
import { createSupportQuery } from '../geometry/support-sample.js'
import { reliefBounds, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import { terrainRouteBand } from '../geometry/terrain-travel.js'
import type { Floor, PointMm, SceneDocument, ScatterGroup, SurfaceOverlay, TerrainArea } from '../model/scene.js'
import { naturalStoneDefinitionId } from '../visual/natural-stone-shapes.js'
import { sha256Text } from '../validation/hash.js'
import { LANDSCAPE_WATER_ID, landscapeEllipse, landscapePaint } from './landscape-authoring.js'
import { terrainRandomUnit } from './field.js'

const sceneryDefinitions = [
  ['whole-plants-v1-prop-pine-branched', 'pine', 6], ['whole-plants-v1-prop-oak-spreading', 'tree', 4],
  ['whole-plants-v1-prop-hazel-bush', 'bush', 5], ['refined-prop-coastal-shrub-coastal-heath', 'heath', 7],
  ['refined-prop-coast-grass-fan', 'grass', 8], [naturalStoneDefinitionId('weathered'), 'stone', 4],
  [naturalStoneDefinitionId('shingle'), 'chips', 2],
] as const
const paletteKeys = { woodland: ['pine', 'tree', 'bush'], scrub: ['bush', 'heath', 'grass'], stone: ['stone', 'chips'] }

function sceneryPalette(scene: SceneDocument, kind?: MapSceneryZone['palette']) {
  return sceneryDefinitions.flatMap(([id, key, weight]) => {
    const definition = scene.propDefinitions[id]
    return definition && (!kind || paletteKeys[kind].includes(key))
      ? [{ key, weight, propDefinitionRef: { id, version: definition.version } }] : []
  })
}

type SceneryFrame = { point: (p: PointMm) => PointMm; size: (p: PointMm) => PointMm }
type Exclusion = ScatterGroup['exclusions'][number]

function landscapeZoneBoundary(floor: Floor, area: TerrainArea, zone: MapCoverZone | MapSceneryZone, frame: SceneryFrame) {
  const boundaryMm = 'boundary' in zone.region ? zone.region.boundary.map(frame.point)
    : landscapeEllipse(frame.point(zone.region.at), frame.size(zone.region.radius), 24, 0, 'cover' in zone
      ? angle => .90 + .064 * Math.sin(angle * 3 + terrainRandomUnit(zone.id, 'rim') * 6) + .033 * Math.cos(angle * 5)
      : undefined)
  const bounds = floor.boundsMm
  if (!polygonValid(boundaryMm, false) || boundaryMm.some(p => p.x < bounds.x || p.y < bounds.y
    || p.x > bounds.x + bounds.width || p.y > bounds.y + bounds.height) || !polygonsOverlap(boundaryMm, terrainPoints(area))) {
    throw new Error(`区域「${zone.id}」须是画布内的有效轮廓，并与指定陆地重叠。`)
  }
  return boundaryMm
}

const covers = { grass: ['grass', '#BAC290'], sand: ['sandDry', '#F1DFBE'], rock: ['rockDry', '#A3ADB2'] } as const
export function landscapeCover(scene: SceneDocument, floor: Floor, area: TerrainArea, zone: MapCoverZone, frame: SceneryFrame): SurfaceOverlay {
  const boundaryMm = landscapeZoneBoundary(floor, area, zone, frame)
  const box = reliefBounds(boundaryMm), [material, tint] = covers[zone.cover]
  const id = `landscape/cover/${zone.id}`
  const order = area.surfaceStyle?.overlays.find(row => row.id === id)?.renderOrder
    ?? Math.max(3, ...(area.surfaceStyle?.overlays.map(row => row.renderOrder) ?? [])) + 1
  return { id, boundaryMm, paint: { ...landscapePaint(scene, material, tint), opacity: .9 },
    blendWidthMm: Math.round(Math.min(850, Math.min(box.width, box.height) * .065)), renderOrder: order }
}

export function landscapeRouteClearances(checks: readonly MapRouteCheck[], floor: Floor, point: SceneryFrame['point']) {
  const bands = new Map<string, { id: string; boundaryMm: PointMm[] }>()
  for (const check of checks) if (check.required) {
    // Leave enough room to quantize the square caps to integer millimetres.
    const band = terrainRouteBand({ floorId: floor.id, pointsMm: check.points.map(point), widthMm: check.widthMm + 4 })
    const boundaryMm = band.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }))
      .filter((p, i, points) => p.x !== points[(i + points.length - 1) % points.length].x || p.y !== points[(i + points.length - 1) % points.length].y)
    // Invalid check geometry is diagnosed by the route evaluator.
    if (polygonValid(boundaryMm, false)) bands.set(check.id, { id: check.id, boundaryMm })
  }
  return [...bands.values()]
}

export function landscapeSceneryExclusions(groupId: string, boundaryMm: PointMm[], clearances: ReturnType<typeof landscapeRouteClearances>): Exclusion[] {
  return clearances.filter(row => polygonsOverlap(row.boundaryMm, boundaryMm))
    .map(row => ({ id: `landscape/clear/${sha256Text(JSON.stringify([groupId, row.id]))}`, boundaryMm: row.boundaryMm, reason: 'entrance', sourceCandidateKey: null }))
}

export function landscapeSceneryZone(scene: SceneDocument, floor: Floor, area: TerrainArea, zone: MapSceneryZone, frame: SceneryFrame, seed: string) {
  const boundaryMm = landscapeZoneBoundary(floor, area, zone, frame)
  const palette = sceneryPalette(scene, zone.palette)
  if (!palette.length) throw new Error(`工程中没有「${zone.palette}」所需的固定布景素材。`)
  const box = reliefBounds(boundaryMm)
  const cellSizeMm = Math.round(Math.max(zone.pattern ? 1250 : 1750, Math.max(box.width, box.height) / 26))
  const config = { domain: { kind: 'area' as const, areaId: area.id, boundaryMm }, palette,
    seed: `${seed.slice(0, 72)}/${zone.id.slice(0, 50)}`, algorithmVersion: LANDSCAPE_SCATTER_VERSION as typeof LANDSCAPE_SCATTER_VERSION,
    gridOriginMm: { x: box.x, y: box.y }, cellSizeMm, densityFactor: zone.density, minDistanceMm: 390,
    rotationRangeDeg: { min: 0, max: 359.9 } }
  const exclusions: Exclusion[] = []
  if (zone.pattern === 'meadow') {
    const unit = (key: string) => terrainRandomUnit(seed, `${zone.id}/meadow/${key}`)
    const open = landscapeEllipse({ x: box.x + box.width * (.49 + .16 * unit('x')), y: box.y + box.height * (.42 + .16 * unit('y')) },
      { x: box.width * .25, y: box.height * .27 }, 14, 0, angle => .93 + .12 * Math.sin(angle * 3 + unit('edge')))
    if (polygonValid(open, false) && polygonsOverlap(open, boundaryMm)) {
      exclusions.push({ id: `landscape/${zone.id}/meadow`, boundaryMm: open, reason: 'entrance', sourceCandidateKey: null })
    }
  }
  return { config, exclusions, fieldEvaluations: (Math.floor(box.width / cellSizeMm) + 1) * (Math.floor(box.height / cellSizeMm) + 1) }
}

export function finishLandscape(scene: SceneDocument, floor: Floor, recipe: MapLandscapeRecipe, forms: MapLandscapeRecipe['landforms'],
  frame: SceneryFrame, seed: string, meter: ExecutionBudget, clearances: ReturnType<typeof landscapeRouteClearances> = []) {
  const coastal = recipe.environment === 'coast', floorId = floor.id
  const layers = Object.values(scene.userLayers).filter(row => row.floorId === floorId).sort((a, b) => a.order - b.order)
  const detailLayer = layers[1]?.id ?? layers[0].id, propLayer = layers[2]?.id ?? detailLayer
  const support = createSupportQuery(scene, floorId, undefined, false)
  const stone = { base: landscapePaint(scene, 'rockWet', '#9D9DA2'), overlays: [] }
  const scatter = (group: ScatterGroup, fieldEvaluations: number) => {
    meter.charge({ fieldEvaluations })
    scene.scatterGroups[group.id] = group; scene.entityLayers[group.id] = propLayer
    const proposal = buildScatterRegeneration(scene, group.id)
    scene.scatterGroups[group.id] = proposal.group
    for (const prop of proposal.props) {
      scene.props[prop.id] = prop
      scene.entityLayers[prop.id] = propLayer
    }
  }
  for (const row of recipe.land) {
    const owner = scene.terrainAreas[row.id], outline = terrainPoints(owner), box = reliefBounds(outline)
    const localZones = recipe.scenery.filter(zone => zone.areaId === row.id)
    const rand = (key: string) => terrainRandomUnit(seed, `${row.id}/${key}`)
    if (coastal && row.shore !== 'none') for (const [i, point] of owner.boundaryMm.entries()) {
      const a = point.positionMm, b = outline[(i + 1) % outline.length], dx = b.x - a.x, dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal = { x: -dy * .05 / length, y: dx * .05 / length }
      const inside = support.rootAt({ x: mid.x + normal.x, y: mid.y + normal.y })
      const outside = support.rootAt({ x: mid.x - normal.x, y: mid.y - normal.y })
      if (inside?.id !== owner.id || outside?.id !== LANDSCAPE_WATER_ID) continue
      const edgeId = `landscape/${owner.id}/shore/${i}`, cliff = owner.groundElevationMm !== 0
      const shelf = owner.relief && sampleTerrainRelief(owner.relief, box, { x: mid.x + normal.x * 18000, y: mid.y + normal.y * 18000 })
      const waveDepth = row.form === 'reef' ? 560 : shelf && shelf.normal.z < .88 ? 780 : 1330
      scene.terrainEdges[edgeId] = { id: edgeId, floorId, editLocked: false, visibility: 'public',
        source: { areaId: owner.id, segmentId: point.segmentId }, neighborAreaId: LANDSCAPE_WATER_ID,
        kind: cliff ? 'cliff' : 'shore', shoreline: true, blocksMovement: cliff, blocksSight: false,
        surfaceStyle: cliff ? stone : null,
        ...(row.shore === 'hard'
          ? { styleOverride: { strokeWidthMm: 35, bandWidthMm: 0, color: '#5C5147' }, shoreStyle: { strokeWidthMm: 0, bandWidthMm: 0, color: '#D8D3AC' } }
          : { styleOverride: null,
            shoreStyle: { strokeWidthMm: row.form === 'reef' ? 24 : 29, bandWidthMm: waveDepth, color: '#DAECE5' } }),
      }
      scene.entityLayers[edgeId] = detailLayer
    }
    if (row.cover === 'natural' && row.form === 'natural') {
      const style = owner.surfaceStyle!, tile = Math.max(4100, Math.max(box.width, box.height) / 10), spots = []
      const nx = Math.ceil(box.width / tile), ny = Math.ceil(box.height / tile)
      meter.charge({ fieldEvaluations: nx * ny, intersectionPairs: nx * ny * outline.length })
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const key = `cover/${x}/${y}`
        const at = { x: Math.round(box.x + (x + .12 + rand(`${key}/x`) * .72) * tile), y: Math.round(box.y + (y + .12 + rand(`${key}/y`) * .72) * tile) }
        if (!pointInPolygon(at, outline)) continue
        const relief = owner.relief && sampleTerrainRelief(owner.relief, box, at)
        const rocky = !!relief && relief.normal.z < .945
        const wet = coastal && (relief?.offsetMm ?? 0) + owner.groundElevationMm < 690
        if (wet || !rocky && rand(`${key}/keep`) < (coastal ? .43 : .18)) continue
        const tilt = rocky ? Math.atan2(relief.normal.y, relief.normal.x) + Math.PI / 2 : rand(`${key}/angle`) * Math.PI
        const span = (rocky ? .29 + .24 * rand(`${key}/size`) : .43 + .23 * rand(`${key}/size`)) * tile
        spots.push({ key, at, tilt, span, rocky, score: rand(`${key}/score`) })
      }
      const scored = spots.sort((a, b) => b.score - a.score)
      const selected = [...scored.filter(spot => spot.rocky).slice(0, 13), ...scored.filter(spot => !spot.rocky).slice(0, 13)]
      for (const [i, { key, at, tilt, span, rocky }] of selected.entries()) {
        const boundaryMm = landscapeEllipse(at, { x: span, y: span * (.57 + .28 * rand(`${key}/aspect`)) }, 13, tilt,
          angle => 1 + .13 * Math.sin(angle * 3 + rand(key) * 7) + .085 * Math.cos(angle * 5))
        const paint = landscapePaint(scene, rocky ? 'rockDry' : 'grass', rocky ? '#AAB3B6' : coastal ? '#B4BD95' : '#A9BA93')
        style.overlays.push({ id: `landscape/${row.id}/cover/${i}`, boundaryMm, paint: { ...paint, opacity: rocky ? .72 : .76 },
          blendWidthMm: Math.round(span * .26), renderOrder: rocky ? 2 : 1 })
      }
    }
    for (const form of forms) if (form.areaId === owner.id && form.cover) {
      const grass = form.cover === 'grass', sand = form.cover === 'sand'
      const reach = form.shape === 'hill' ? .36 : .54
      const boundaryMm = landscapeEllipse(form.at, { x: form.radius.x * reach, y: form.radius.y * reach }, 17,
        form.rotationDeg * Math.PI / 180, angle => 1 + .17 * Math.sin(3 * angle + rand(form.id) * 6) + .11 * Math.cos(5 * angle))
      const paint = landscapePaint(scene, grass ? 'grass' : sand ? 'sandDry' : 'rockDry', grass ? '#ADB996' : sand ? '#F4E1B5' : '#A7ADB0')
      owner.surfaceStyle!.overlays.push({ id: `landscape/${form.id}/cover`, boundaryMm, paint: { ...paint, opacity: .77 },
        blendWidthMm: Math.round(Math.min(2600, Math.min(form.radius.x, form.radius.y) * .26)), renderOrder: 3 })
    }
    for (const zone of recipe.covers.filter(zone => zone.areaId === row.id)) {
      owner.surfaceStyle!.overlays.push(landscapeCover(scene, floor, owner, zone, frame))
    }
    for (const zone of localZones) {
      const { config, exclusions, fieldEvaluations } = landscapeSceneryZone(scene, floor, owner, zone, frame, seed)
      scatter({ ...config, id: zone.id, floorId, visibility: 'public', editLocked: false, members: {},
        exclusions: [...exclusions, ...landscapeSceneryExclusions(zone.id, config.domain.boundaryMm, clearances)] }, fieldEvaluations)
    }
    if (row.form === 'reef' && box.width * box.height < 24_000_000) continue
    const palette = sceneryPalette(scene)
    const cellSizeMm = Math.round(Math.max(2150, Math.max(box.width, box.height) / 27))
    const group: ScatterGroup = { id: `landscape/${row.id}/scenery`, floorId,
      visibility: 'public', editLocked: false, algorithmVersion: LANDSCAPE_SCATTER_VERSION,
      domain: { kind: 'area', areaId: owner.id }, palette, seed: `${seed.slice(0, 75)}/${row.id.slice(0, 50)}`, gridOriginMm: { x: 0, y: 0 },
      densityFactor: recipe.density, cellSizeMm, minDistanceMm: 210, rotationRangeDeg: { min: 0, max: 359.9 }, members: {},
      exclusions: [
        ...recipe.landforms.filter(form => form.areaId === owner.id && (form.keepClear ?? (form.shape === 'hill' || form.shape === 'plateau')))
          .map(form => ({ id: `landscape/${form.id}/clearing`, boundaryMm: scene.regions[form.id].boundaryMm, reason: 'entrance' as const, sourceCandidateKey: null })),
        ...localZones.filter(zone => zone.pattern).map(zone => ({ id: `landscape/${zone.id}/background`, reason: 'entrance' as const,
          sourceCandidateKey: null, boundaryMm: landscapeZoneBoundary(floor, owner, zone, frame) })),
        ...landscapeSceneryExclusions(`landscape/${row.id}/scenery`, outline, clearances),
      ],
    }
    const grid = (Math.ceil(box.width / cellSizeMm) + 2) * (Math.ceil(box.height / cellSizeMm) + 2)
    scatter(group, grid)
  }
}
