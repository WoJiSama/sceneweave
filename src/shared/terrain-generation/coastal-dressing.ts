import { connectionArcFrame } from '../geometry/connection-route.js'
import { corridor, pathPolygon, pointInPolygon, pointOnSurface, polygonDistance, polygonInside, polygonsOverlap, propFootprint, supportedPolygon, terrainPoints, transformBounds } from '../geometry/geometry.js'
import { reliefBounds, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import type { PointMm, Prop, PropDefinition, SceneDocument, TerrainArea } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { visualBase } from '../visual/base.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import { naturalStoneDefinitionId, SCREE_STONES, STRAND_STONES, type NaturalStoneKey } from '../visual/natural-stone-shapes.js'
import { COASTAL_CLIFF_REPEAT_MM, COASTAL_INLAND_CLIFF_WIDTH_MM, shoreEdgePaintSeed } from '../visual/shore-surfaces.js'
import { weatheredCliffToeReach } from '../visual/terrain-cliff-plan.js'
import { terrainRandomUnit } from './field.js'

export function terrainProp(definition: PropDefinition, id: string, floorId: string, supportId: string, positionMm: PointMm, scale: number, rotationDeg: number): Prop {
  const bounds = definition.defaultVisualBoundsMm, footprint = definition.defaultFootprintMm
  return { id, floorId, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: definition.version }, appearance: cloneJson(definition.defaultAppearance),
    visualBoundsMm: { x: Math.round(bounds.x * scale), y: Math.round(bounds.y * scale), width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) },
    footprintMm: { width: Math.round(footprint.width * scale), height: Math.round(footprint.height * scale) }, footprintOffsetMm: { x: 0, y: 0 }, positionMm,
    rotationDeg, blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
    supportRef: { kind: 'terrainArea', id: supportId }, renderLayer: definition.defaultRenderLayer, renderOrder: 0,
    shadowClass: definition.defaultShadowClass, shadowOverride: null }
}

/** A beach has tide debris. Stone fragments gather at the foot of a scarp,
 * and wind-pruned cover grows in pockets of dry ground above the strand. */
export function placeCoastalDressing(scene: SceneDocument, seed: string, activity: PointMm[], floorId: string, detailsLayer: string, propsLayer: string,
  stoneDetailScale?: number) {
  const naturalStones = stoneDetailScale !== undefined
  const { width, height } = scene.floors[floorId].boundsMm, scale = Math.min(width / 24000, height / 18000)
  const random = (key: string) => terrainRandomUnit(seed, `coastal-dressing/${key}`)
  const inland = scene.terrainAreas['terrain-low'].surfaceStyle?.overlays.find(row => row.id === 'terrain-coast-inland-cover')?.boundaryMm
  const rockland = inland ? 'coastal' : 'island'
  const supports = ['terrain-high', 'terrain-bench', 'terrain-low']
  const protectedBands = [activity, ...Object.values(scene.paths).map(pathPolygon), ...Object.values(scene.terrainConnections)
    .map(c => corridor(c.from.positionMm, c.to.positionMm, c.widthMm + 550, true))]
  const placed: PointMm[][] = []
  const place = (definitionId: string, key: string, position: PointMm, size: number,
    options: { owner?: string; beach?: boolean; heading?: number; stone?: boolean } = {}) => {
    const positionMm = { x: Math.round(position.x), y: Math.round(position.y) }
    const supportId = supports.find(id => pointOnSurface(scene, positionMm, { kind: 'terrainArea', id }, floorId))
    if (!supportId || options.owner && supportId !== options.owner) return false
    const definition = scene.propDefinitions[definitionId]
    if (!definition) throw new Error(`沿海布景缺少固定物件：${definitionId}。`)
    const id = `terrain-prop-${placed.length}`
    const rotation = options.heading === undefined ? Math.floor(random(`${key}/rotation`) * 360) : (Math.round(options.heading) + 720) % 360
    const prop = terrainProp(definition, id, floorId, supportId, positionMm, size, rotation)
    const footprint = propFootprint(prop), visual = transformBounds(prop.visualBoundsMm, positionMm, prop.rotationDeg)
    if (visual.some(q => q.x < 0 || q.x > width || q.y < 0 || q.y > height)
      || !supportedPolygon(scene, footprint, prop.supportRef, floorId)
      || options.stone && !supportedPolygon(scene, visual, prop.supportRef, floorId)
      || inland && supportId === 'terrain-low' && (options.beach ? polygonsOverlap(footprint, inland) : !polygonInside(footprint, inland))
      || protectedBands.some(band => polygonDistance(visual, band) < 125)
      || placed.some(other => polygonDistance(footprint, other) < 185)) return false
    scene.props[id] = prop
    scene.entityLayers[id] = prop.renderLayer === 'ground' ? detailsLayer : propsLayer
    placed.push(footprint)
    return true
  }
  const stock = (key: string) => `refined-prop-${key}`
  const rockAt = (palette: readonly NaturalStoneKey[], key: string) => palette[Math.floor(random(`${key}/form`) * palette.length)]
  const patch = (frame: ReturnType<typeof connectionArcFrame>, station: number, reach: number, owner: string, key: string,
    palette: readonly NaturalStoneKey[], beach = false, toeAt?: (at: number) => number) => {
    const rock = rockAt(palette, key), direction = frame.station(station).tangent
    const heading = Math.atan2(direction.y, direction.x) * 180 / Math.PI
    const primary = beach ? .66 + .34 * random(`${key}/mass`) : .74 + .34 * random(`${key}/mass`)
    if (!place(naturalStoneDefinitionId(rock), key, frame.at(station, reach), primary,
      { owner, beach, heading: heading + 52 * (random(`${key}/cant`) - .5), stone: true })) return false
    // Each offcut is its own small object. Drift along the slope and vary
    // the number of offcuts as well as the relative size and bed direction.
    const side = random(`${key}/scatter side`) < .5 ? -1 : 1
    const spread = random(`${key}/count`), count = spread < .36 ? 0 : spread < .82 ? 1 : 2
    for (let i = 0; i < count; i++) {
      const part = `${key}/offcut/${i}`, advance = (beach ? 490 : 700) + 270 * random(`${part}/scatter`)
      const at = station + side * advance * (i ? -1 : 1)
      const outside = Math.sign(reach) * Math.max(Math.abs(reach) + 110 + i * 170 + 210 * random(`${part}/downslope`), toeAt ? toeAt(at) + 315 : 0)
      place(naturalStoneDefinitionId(rockAt(palette, part)), part, frame.at(at, outside), .35 + .21 * random(`${part}/mass`),
        { owner, beach, heading: heading + 112 * (random(`${part}/cant`) - .5), stone: true })
    }
    return true
  }

  const ground = Array.from({ length: 88 }, (_, i) => {
    const key = `ground/${i}`, x = (i % 11 + .5 + random(`${key}/x`) * .7) * width / 12,
      y = (Math.floor(i / 11) + .5 + random(`${key}/y`) * .7) * height / 9
    return { x, y, key, rank: random(`${key}/rank`) }
  }).sort((a, b) => a.rank - b.rank)
  if (inland) {
    const beachCells = ground.filter(cell => !pointInPolygon(cell, inland))
    if (naturalStones) {
      beachCells.some(cell => place(stock('coast-driftwood'), cell.key, cell, .69, { owner: 'terrain-low', beach: true }))
      const line = sampleVisualBoundary(visualBase(scene)!.boundaries['terrain-coast-curve']).points
      const frame = connectionArcFrame(line), count = Math.min(5, Math.round(2 + Math.sqrt(scale)))
      for (let i = 0; i < count + 2; i++) {
        const key = `strand/${i}`, station = frame.length * (i + .37 + random(key) * .41) / (count + 2)
        if (i < count || random(`${key}/bare sand`) < .32) patch(frame, station, 350 + 475 * random(`${key}/reach`), 'terrain-low', key, STRAND_STONES, true)
      }
    } else {
      const shore = ['coast-pebbles', 'coast-wrack', 'coast-driftwood', 'coast-pebbles']
      let objects = 0
      for (const cell of beachCells) {
        if (place(stock(shore[objects % shore.length]), cell.key, cell, .62 + .26 * random(`${cell.key}/size`), { owner: 'terrain-low', beach: true })) objects++
        if (objects >= Math.min(6, 2 + Math.round(scale))) break
      }
    }
  }

  const heightAt = (area: TerrainArea) => {
    const bounds = reliefBounds(terrainPoints(area)), relief = area.relief
    return (point: PointMm) => area.groundElevationMm + (relief ? sampleTerrainRelief(relief, bounds, point).offsetMm : 0)
  }
  for (const [high, low] of [['terrain-bench', 'terrain-low'], ['terrain-high', 'terrain-bench']]) {
    const ring = terrainPoints(scene.terrainAreas[high]), frame = connectionArcFrame([...ring, ring[0]])
    const slots = Math.min(14, Math.ceil(frame.length / (2850 * Math.sqrt(scale))))
    const top = heightAt(scene.terrainAreas[high]), base = heightAt(scene.terrainAreas[low])
    const paint = { seed: shoreEdgePaintSeed(seed, `${high}-curve`, 'cliff'), widthMm: COASTAL_INLAND_CLIFF_WIDTH_MM,
      repeatMm: Math.round(COASTAL_CLIFF_REPEAT_MM * (stoneDetailScale ?? 1)) }
    const toeAt = (station: number) => {
      const { positionMm, normal } = frame.station(station)
      return weatheredCliffToeReach(paint, positionMm, Math.max(0, top(positionMm) - base(positionMm)), -normal.y)
    }
    let pockets = 0
    for (let i = 0; i < slots; i++) {
      const key = `${high}/talus/${i}`, station = frame.length * (i + .16 + .68 * random(key)) / slots
      const reach = 480 + 850 * random(`${key}/reach`) * Math.sqrt(scale)
      if (naturalStones) {
        const toe = toeAt(station), minimum = toe + 475
        const foot = Math.max(reach, minimum + 120 + 340 * random(`${key}/bed`))
        if (!patch(frame, station, -foot, low, key, SCREE_STONES, false, toeAt)
          && !patch(frame, station, -minimum, low, `${key}/near`, SCREE_STONES, false, toeAt)) continue
      } else {
        if (!place(stock(`${rockland}-debris-scree`), key, frame.at(station, -reach), .65 + .52 * random(`${key}/size`), { owner: low })) continue
        place(stock(`${rockland}-shrub-scree-sedge`), `${key}/sedge`, frame.at(station + 370, -reach - 410), .62 + .24 * random(`${key}/plant`), { owner: low })
      }
      if (++pockets >= Math.round(2 + Math.sqrt(scale))) break
    }
  }

  const scrubLimit = Math.min(16, Math.round(8 + 2 * Math.sqrt(scale)))
  let pockets = 0
  for (const cell of ground) {
    if (!place(stock(`${rockland}-shrub-coastal-heath`), cell.key, cell, .86 + .42 * random(`${cell.key}/size`))) continue
    const angle = random(`${cell.key}/angle`) * Math.PI * 2, distance = 640 + 460 * random(`${cell.key}/distance`)
    const neighbor = { x: cell.x + Math.cos(angle) * distance, y: cell.y + Math.sin(angle) * distance }
    const companion = random(`${cell.key}/neighbor`) < .58 ? 'shrub-coastal-heath' : 'shrub-scree-sedge'
    if (!naturalStones || companion === 'shrub-coastal-heath') place(stock(`${rockland}-${companion}`), `${cell.key}/neighbor`, neighbor, .55 + .23 * random(`${cell.key}/size2`))
    if (++pockets >= scrubLimit) break
  }
}
