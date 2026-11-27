import type { ExecutionBudget } from '../budget/task-budget.js'
import type { MapCoverZone, MapLandscapeRecipe, MapRouteCheck, MapSceneryZone } from '../generation/map-authoring.js'
import { pointInPolygon, polygonInside, polygonValid, polygonsOverlap, propFootprint, supportedPolygon, terrainPoints, transformBounds } from '../geometry/geometry.js'
import { roadEffectsPolygon } from '../geometry/road-domain.js'
import { buildScatterRegeneration, WOODLAND_SITE_ATTEMPTS } from '../geometry/scatter.js'
import { LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION, LANDSCAPE_GROUND_SCATTER_VERSION, LANDSCAPE_SCATTER_VERSION, type ScatterAlgorithmVersion } from '../geometry/scatter-algorithm.js'
import { createSupportQuery } from '../geometry/support-sample.js'
import { reliefBounds, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import { terrainRouteBand } from '../geometry/terrain-travel.js'
import type { Floor, PointMm, SceneDocument, ScatterGroup, SurfaceOverlay, TerrainArea } from '../model/scene.js'
import { naturalStoneDefinitionId, SCREE_STONES } from '../visual/natural-stone-shapes.js'
import { sha256Text } from '../validation/hash.js'
import { LANDSCAPE_WATER_ID, landscapeEllipse, landscapePaint } from './landscape-authoring.js'
import { terrainProp } from './coastal-dressing.js'
import { terrainRandomUnit, terrainValueNoise } from './field.js'

const sceneryDefinitions = [
  ['whole-plants-v1-prop-pine-branched', 'pine', 6], ['whole-plants-v1-prop-oak-spreading', 'tree', 4],
  ['whole-plants-v1-prop-hazel-bush', 'bush', 5], ['refined-prop-coastal-shrub-coastal-heath', 'heath', 7],
  ['refined-prop-coast-grass-fan', 'grass', 8], [naturalStoneDefinitionId('weathered'), 'stone', 4],
  [naturalStoneDefinitionId('shingle'), 'chips', 2],
] as const
const paletteKeys = { woodland: ['pine', 'tree', 'bush'], scrub: ['bush', 'heath', 'grass'], stone: ['stone', 'chips'] }

function sceneryPalette(scene: SceneDocument, kind?: MapSceneryZone['palette'], natural = false, clusteredTrees = false) {
  return sceneryDefinitions.flatMap(([id, key, weight]) => {
    const definition = scene.propDefinitions[id]
    const understory = key === 'heath' || key === 'grass'
    const weightFactor = clusteredTrees ? key === 'pine' || key === 'tree' ? 2 : 1 : natural && understory ? 2 : 1
    return definition && (!kind || paletteKeys[kind].includes(key) || natural && kind === 'woodland' && understory)
      ? [{ key, weight: weight * weightFactor, propDefinitionRef: { id, version: definition.version } }] : []
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

function tracedCover(overlay: SurfaceOverlay, cover: MapCoverZone['cover'], floor: Floor, seed: string, meter: ExecutionBudget): SurfaceOverlay {
  const boundary = overlay.boundaryMm
  const interpolate = (a: PointMm, b: PointMm, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const rounded = boundary.flatMap((corner, i) => {
    const before = boundary[(i + boundary.length - 1) % boundary.length], after = boundary[(i + 1) % boundary.length]
    const left = Math.hypot(corner.x - before.x, corner.y - before.y), right = Math.hypot(corner.x - after.x, corner.y - after.y)
    const reach = Math.min(1320, left * .34, right * .34)
    if (reach < 110) return [corner]
    const a = interpolate(corner, before, reach / left), b = interpolate(corner, after, reach / right)
    return [a, interpolate(interpolate(a, corner, .5), interpolate(corner, b, .5), .5), b]
  })
  const lengths = rounded.map((p, i) => {
    const next = rounded[(i + 1) % rounded.length]
    return Math.hypot(p.x - next.x, p.y - next.y)
  })
  const spacing = Math.max(540, lengths.reduce((sum, length) => sum + length, 0) / (512 - rounded.length))
  const { x, y, width: boundsWidth, height: boundsHeight } = floor.boundsMm
  const softened = rounded.flatMap((p, i) => {
    const next = rounded[(i + 1) % rounded.length], length = lengths[i]
    const count = Math.max(1, Math.ceil(length / spacing))
    return Array.from({ length: count }, (_, index) => {
      const v = interpolate(p, next, index / count)
      // Break long straight edges into small, continuous turns without
      // changing the traced region at the scale of the map.
      const sway = length ? 265 * terrainValueNoise(seed, overlay.id, v.x / 760, v.y / 710) / length : 0
      return { x: Math.round(Math.max(x, Math.min(x + boundsWidth, v.x + (next.y - p.y) * sway))),
        y: Math.round(Math.max(y, Math.min(y + boundsHeight, v.y - (next.x - p.x) * sway))) }
    })
  })
  meter.charge({ fieldEvaluations: softened.length })
  const tint = cover === 'grass' ? '#D9E4B2' : cover === 'sand' ? '#F8EAD2' : '#C3BEB5'
  const { width, height } = overlay.paint.tileSizeMm
  return { ...overlay, boundaryMm: softened.length <= 512 && polygonValid(softened, false) ? softened : boundary,
    blendWidthMm: Math.min(460, overlay.blendWidthMm),
    paint: { ...overlay.paint, tint, opacity: .96, tileSizeMm: { width: Math.round(width * 1.7), height: Math.round(height * 1.7) } } }
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

export function landscapeSceneryZone(scene: SceneDocument, floor: Floor, area: TerrainArea, zone: MapSceneryZone, frame: SceneryFrame, seed: string,
  natural = area.reliefFinish === 'weathered-v2' || area.reliefFinish === 'weathered-v3') {
  const boundaryMm = landscapeZoneBoundary(floor, area, zone, frame)
  const woodland = natural && zone.palette === 'woodland' && zone.pattern === 'grove'
  const palette = sceneryPalette(scene, zone.palette, natural, woodland)
  if (!palette.length) throw new Error(`工程中没有「${zone.palette}」所需的固定布景素材。`)
  const box = reliefBounds(boundaryMm)
  const cellSizeMm = Math.round(Math.max(woodland ? 900 : zone.pattern ? natural ? 1050 : 1250 : 1750, Math.max(box.width, box.height) / 26))
  const algorithmVersion: ScatterAlgorithmVersion = woodland ? LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION : LANDSCAPE_SCATTER_VERSION
  const config = { domain: { kind: 'area' as const, areaId: area.id, boundaryMm }, palette,
    seed: `${seed.slice(0, 72)}/${zone.id.slice(0, 50)}`, algorithmVersion,
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
  const fields = (Math.floor(box.width / cellSizeMm) + 1) * (Math.floor(box.height / cellSizeMm) + 1)
  const passes = woodland ? Number(palette.some(slot => slot.key === 'pine' || slot.key === 'tree'))
    + Number(palette.some(slot => slot.key !== 'pine' && slot.key !== 'tree')) : 1
  return { config, exclusions, fieldEvaluations: fields * passes * (woodland ? WOODLAND_SITE_ATTEMPTS : 1) }
}

function placeLowlandStones(scene: SceneDocument, floor: Floor, owner: TerrainArea, forms: MapLandscapeRecipe['landforms'],
  seed: string, propLayer: string, density: number, clearances: ReturnType<typeof landscapeRouteClearances>, meter: ExecutionBudget) {
  if (!owner.relief || density === 0) return
  const lowlands = forms.filter(row => row.areaId === owner.id && row.shape === 'lowland' && row.cover !== 'grass' && !row.keepClear)
  if (!lowlands.length) return
  const outline = terrainPoints(owner), box = reliefBounds(outline), bounds = floor.boundsMm
  const protectedBands = [...clearances.map(row => row.boundaryMm), ...Object.values(scene.paths).filter(row => row.floorId === floor.id).map(roadEffectsPolygon)]
  const visualFootprints: PointMm[][] = []
  for (const form of lowlands) {
    const radius = Math.min(form.radius.x, form.radius.y)
    if (radius < 2300) continue
    const asymmetry = terrainRandomUnit(seed, `${form.id}/stone-aspect`) * Math.PI * 2
    const sites = landscapeEllipse(form.at, { x: form.radius.x * .46, y: form.radius.y * .54 }, 12, asymmetry)
    meter.charge({ fieldEvaluations: sites.length + 1 })
    const ground = (p: PointMm) => sampleTerrainRelief(owner.relief!, box, p)
    const base = ground(form.at).offsetMm
    const chosen = sites.filter(point => pointInPolygon(point, outline)).map((point, i) => {
      const surface = ground(point)
      return { point, score: -Math.abs(surface.offsetMm - base) / 1600 + (1 - surface.normal.z) * 3
        + terrainRandomUnit(seed, `${form.id}/site/${i}`), normal: surface.normal.z }
    }).filter(row => row.normal > .88).sort((a, b) => b.score - a.score)
    const reserve = Object.values(scene.regions).filter(row => row.id !== form.id && forms.some(mark => mark.id === row.id && mark.preserveRelief)).map(row => row.boundaryMm)
    const place = (point: PointMm, scale: number, key: string, sizeIndex: number) => {
      const definition = scene.propDefinitions[naturalStoneDefinitionId(SCREE_STONES[sizeIndex % SCREE_STONES.length])]
      if (!definition) return false
      const id = `landscape/${form.id}/talus/${key}`, rotation = Math.floor(360 * terrainRandomUnit(seed, id))
      const prop = terrainProp(definition, id, floor.id, owner.id, point, scale, rotation)
      const visual = transformBounds(prop.visualBoundsMm, point, rotation)
      if (visual.some(p => p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height)
        || !polygonInside(visual, outline) || [...protectedBands, ...reserve, ...visualFootprints].some(band => polygonsOverlap(band, visual))
        || !supportedPolygon(scene, propFootprint(prop), prop.supportRef, floor.id)) return false
      scene.props[id] = prop
      scene.entityLayers[id] = propLayer
      visualFootprints.push(visual)
      return true
    }
    const scale = Math.min(3.6, .85 + radius / 4600) * (.76 + .24 * density)
    for (const { point } of chosen) if (place(point, scale, 'anchor', 0)) {
      const scattered = landscapeEllipse(point, { x: scale * 910, y: scale * 750 }, 5, asymmetry)
      for (const [i, p] of scattered.entries()) if (terrainRandomUnit(seed, `${form.id}/scatter/${i}`) < density) {
        place(p, scale * (.31 + i * .055), `stone-${i + 1}`, i + 1)
      }
      break
    }
  }
}

export function finishLandscape(scene: SceneDocument, floor: Floor, recipe: MapLandscapeRecipe, forms: MapLandscapeRecipe['landforms'],
  frame: SceneryFrame, seed: string, meter: ExecutionBudget, clearances: ReturnType<typeof landscapeRouteClearances> = []) {
  const coastal = recipe.environment === 'coast', natural = recipe.finish === 'natural', floorId = floor.id
  const layers = Object.values(scene.userLayers).filter(row => row.floorId === floorId).sort((a, b) => a.order - b.order)
  const detailLayer = layers[1]?.id ?? layers[0].id, propLayer = layers[2]?.id ?? detailLayer
  const support = createSupportQuery(scene, floorId, undefined, false)
  const stone = { base: landscapePaint(scene, 'rockWet', natural ? '#777682' : '#9D9DA2'), overlays: [] }
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
    const localZones = recipe.scenery.filter(zone => zone.areaId === row.id), localCovers = recipe.covers.filter(zone => zone.areaId === row.id)
    const localForms = forms.filter(form => form.areaId === row.id)
    const reserved = [...clearances, ...localForms.filter(form => form.keepClear).map(form => ({ id: form.id, boundaryMm: scene.regions[form.id].boundaryMm }))]
    const traced = natural && row.outline === 'traced'
    const tracedGrass = traced && localCovers.some(zone => zone.cover === 'grass' && 'boundary' in zone.region)
    const tracedGrove = traced && localZones.some(zone => zone.palette === 'woodland' && zone.pattern === 'grove' && zone.density > 0)
    const groundCovers: SurfaceOverlay[] = []
    const rand = (key: string) => terrainRandomUnit(seed, `${row.id}/${key}`)
    if (coastal && row.shore !== 'none') for (const [i, point] of owner.boundaryMm.entries()) {
      const a = point.positionMm, b = outline[(i + 1) % outline.length], dx = b.x - a.x, dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal = { x: -dy * .05 / length, y: dx * .05 / length }
      const inside = support.rootAt({ x: mid.x + normal.x, y: mid.y + normal.y })
      const outside = support.rootAt({ x: mid.x - normal.x, y: mid.y - normal.y })
      if (inside?.id !== owner.id || outside?.id !== LANDSCAPE_WATER_ID) continue
      const edgeId = `landscape/${owner.id}/shore/${i}`
      const edgeRelief = natural && owner.relief ? sampleTerrainRelief(owner.relief, box, mid).offsetMm : 0
      const cliff = owner.groundElevationMm !== 0 || Math.abs(edgeRelief) >= 400
      const shelf = owner.relief && sampleTerrainRelief(owner.relief, box, { x: mid.x + normal.x * 18000, y: mid.y + normal.y * 18000 })
      const steep = shelf && shelf.normal.z < .88
      const waveDepth = traced ? row.form === 'reef' ? 500 : steep || cliff ? 600 : 1150
        : natural ? row.form === 'reef' ? 740 : steep || cliff ? 920 : 1780
        : row.form === 'reef' ? 560 : steep ? 780 : 1330
      scene.terrainEdges[edgeId] = { id: edgeId, floorId, editLocked: false, visibility: 'public',
        source: { areaId: owner.id, segmentId: point.segmentId }, neighborAreaId: LANDSCAPE_WATER_ID,
        kind: cliff ? 'cliff' : 'shore', shoreline: true, blocksMovement: cliff, blocksSight: false,
        surfaceStyle: cliff ? stone : null,
        ...(row.shore === 'hard'
          ? { styleOverride: { strokeWidthMm: 35, bandWidthMm: 0, color: '#5C5147' }, shoreStyle: { strokeWidthMm: 0, bandWidthMm: 0, color: '#D8D3AC' } }
          : { styleOverride: null,
            shoreStyle: { strokeWidthMm: row.form === 'reef' ? 24 : natural ? 38 : 29, bandWidthMm: waveDepth, color: natural ? '#DEEDD9' : '#DAECE5' } }),
      }
      scene.entityLayers[edgeId] = detailLayer
    }
    if (row.cover === 'natural' && row.form === 'natural' && !tracedGrass) {
      const style = owner.surfaceStyle!, tile = Math.max(natural ? 3000 : 4100, Math.max(box.width, box.height) / (natural ? 15 : 10)), spots = []
      const nx = Math.ceil(box.width / tile), ny = Math.ceil(box.height / tile)
      meter.charge({ fieldEvaluations: nx * ny, intersectionPairs: nx * ny * outline.length })
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const key = `cover/${x}/${y}`
        const at = { x: Math.round(box.x + (x + .12 + rand(`${key}/x`) * .72) * tile), y: Math.round(box.y + (y + .12 + rand(`${key}/y`) * .72) * tile) }
        if (!pointInPolygon(at, outline)) continue
        const relief = owner.relief && sampleTerrainRelief(owner.relief, box, at)
        const slope = relief?.normal.z ?? 1
        const moisture = natural ? terrainValueNoise(seed, `${row.id}/ground`, at.x / 6200, at.y / 5450) : 0
        const rocky = slope < (natural ? .92 - .04 * moisture : .945)
        const wet = coastal && (relief?.offsetMm ?? 0) + owner.groundElevationMm < 690
        if (wet || !rocky && rand(`${key}/keep`) < (coastal ? .43 : .18) - moisture * .26) continue
        const tilt = rocky && relief ? Math.atan2(relief.normal.y, relief.normal.x) + Math.PI / 2 : rand(`${key}/angle`) * Math.PI
        const span = (rocky ? .29 + .24 * rand(`${key}/size`) : .43 + .23 * rand(`${key}/size`) + (natural ? .24 : 0)) * tile
        spots.push({ key, at, tilt, span, rocky, moisture, score: rand(`${key}/score`) + (rocky ? 0 : moisture * .46) })
      }
      const scored = spots.sort((a, b) => b.score - a.score)
      const selected = [...scored.filter(spot => spot.rocky).slice(0, natural ? 17 : 13),
        ...scored.filter(spot => !spot.rocky).slice(0, natural ? 25 : 13)]
      for (const [i, { key, at, tilt, span, rocky, moisture }] of selected.entries()) {
        const aspect = rocky && natural ? .34 + .27 * rand(`${key}/aspect`) : .57 + .28 * rand(`${key}/aspect`)
        const boundaryMm = landscapeEllipse(at, { x: span, y: span * aspect }, 13, tilt,
          angle => 1 + .13 * Math.sin(angle * 3 + rand(key) * 7) + .085 * Math.cos(angle * 5))
        const tint = rocky ? natural ? moisture > .10 ? '#8D8983' : '#AB9680' : '#AAB3B6'
          : natural ? moisture > .10 ? '#849658' : '#B1BD81' : coastal ? '#B4BD95' : '#A9BA93'
        const paint = landscapePaint(scene, rocky ? 'rockDry' : 'grass', tint)
        style.overlays.push({ id: `landscape/${row.id}/cover/${i}`, boundaryMm, paint: { ...paint, opacity: rocky ? .72 : .76 },
          blendWidthMm: Math.round(span * .26), renderOrder: rocky ? 2 : 1 })
      }
    }
    for (const [order, form] of localForms.filter(form => form.cover).sort((a, b) => a.elevationMm - b.elevationMm).entries()) {
      const grass = form.cover === 'grass', sand = form.cover === 'sand'
      const reach = form.shape === 'hill' ? .36 : natural && form.shape === 'plateau' ? .63 : .54
      const boundaryMm = form.structure?.kind === 'area' ? form.structure.boundary : landscapeEllipse(form.at, { x: form.radius.x * reach, y: form.radius.y * reach }, 17,
        form.rotationDeg * Math.PI / 180, angle => 1 + .17 * Math.sin(3 * angle + rand(form.id) * 6) + .11 * Math.cos(5 * angle))
      const paint = landscapePaint(scene, grass ? 'grass' : sand ? 'sandDry' : 'rockDry',
        grass ? natural ? '#A6B678' : '#ADB996' : sand ? '#F4E1B5' : natural ? '#B9A58D' : '#A7ADB0')
      owner.surfaceStyle!.overlays.push({ id: `landscape/${form.id}/cover`, boundaryMm, paint: { ...paint, opacity: natural ? .86 : .77 },
        blendWidthMm: Math.round(Math.min(natural ? 1100 : 2600, Math.min(form.radius.x, form.radius.y) * (natural ? .16 : .26))), renderOrder: 3 + order })
    }
    for (const zone of localCovers) {
      const overlay = landscapeCover(scene, floor, owner, zone, frame)
      const observed = traced && 'boundary' in zone.region
      const finish = observed ? tracedCover(overlay, zone.cover, floor, seed, meter) : overlay
      owner.surfaceStyle!.overlays.push(finish)
      if (observed && zone.cover === 'grass' && recipe.density > 0) groundCovers.push(finish)
    }
    if (natural) placeLowlandStones(scene, floor, owner, forms, seed, propLayer, recipe.density, clearances, meter)
    for (const zone of localZones) {
      const { config, exclusions, fieldEvaluations } = landscapeSceneryZone(scene, floor, owner, zone, frame, seed, natural)
      scatter({ ...config, id: zone.id, floorId, visibility: 'public', editLocked: false, members: {},
        exclusions: [...exclusions, ...landscapeSceneryExclusions(zone.id, config.domain.boundaryMm, reserved)] }, fieldEvaluations)
      if (natural && zone.palette === 'woodland' && zone.density > 0) {
        const paint = landscapePaint(scene, 'grass', '#9BAE77')
        owner.surfaceStyle!.overlays.push({ id: `landscape/${zone.id}/forest-floor`, boundaryMm: config.domain.boundaryMm,
          paint: { ...paint, opacity: .45 + zone.density * .27 }, renderOrder: 2,
          blendWidthMm: Math.min(traced ? 450 : 900, Math.round(config.cellSizeMm * .62)) })
      }
    }
    if (groundCovers.length) {
      const palette = sceneryPalette(scene, 'scrub', true).filter(entry => entry.key === 'grass' || entry.key === 'heath')
      const cellSizeMm = Math.round(Math.max(1200, Math.max(box.width, box.height) / 54))
      if (palette.length) for (const { id: coverId, boundaryMm } of groundCovers) {
        const patch = reliefBounds(boundaryMm), id = `${coverId}/ground-cover`
        scatter({
          id, floorId, visibility: 'public', editLocked: false, domain: { kind: 'area', areaId: owner.id, boundaryMm },
          algorithmVersion: LANDSCAPE_GROUND_SCATTER_VERSION, palette, seed: `${seed.slice(0, 75)}/${coverId.slice(0, 50)}`,
          gridOriginMm: { x: patch.x, y: patch.y }, cellSizeMm, densityFactor: recipe.density * .66, minDistanceMm: 230,
          rotationRangeDeg: { min: 0, max: 359.9 }, members: {},
          exclusions: landscapeSceneryExclusions(id, boundaryMm, reserved),
        }, (Math.floor(patch.width / cellSizeMm) + 1) * (Math.floor(patch.height / cellSizeMm) + 1))
      }
    }
    if (row.form === 'reef' && box.width * box.height < 24_000_000) continue
    const palette = sceneryPalette(scene, undefined, natural).map(entry => {
      const tall = entry.key === 'pine' || entry.key === 'tree'
      const undergrowth = entry.key === 'grass' || entry.key === 'heath'
      return tracedGrove && tall || tracedGrass && undergrowth ? { ...entry, weight: Math.ceil(entry.weight * .35) } : entry
    })
    const cellSizeMm = Math.round(Math.max(natural ? 1750 : 2150, Math.max(box.width, box.height) / (natural ? 31 : 27)))
    const group: ScatterGroup = { id: `landscape/${row.id}/scenery`, floorId,
      visibility: 'public', editLocked: false, algorithmVersion: natural ? LANDSCAPE_GROUND_SCATTER_VERSION : LANDSCAPE_SCATTER_VERSION,
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
