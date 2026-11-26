import type { BoundsMm, PointMm, Prop, SceneDocument, VersionRef } from '../../../model/scene.js'
import type { ExecutionBudget } from '../../../budget/task-budget.js'
import { propPaintPolygon } from '../../../appearance/presentation.js'
import { defaultMaterialPaint } from '../../../appearance/surface-paint.js'
import { decorationFootprint } from '../../../decorations/geometry.js'
import { pathPolygon, pointInPolygon, polygonDistance, polygonInside, polygonValid, polylineBand, propFootprint, terrainPoints } from '../../../geometry/geometry.js'
import { polygonBooleanWithHoles, type PolygonWithHoles } from '../../../geometry/polygon-boolean.js'
import { terrainRandomUnit } from '../../../terrain-generation/field.js'
import type { ForestParameters } from './contracts.js'
import type { ForestReport } from './index.js'

function foliagePatch(center: PointMm, rx: number, ry: number, random: (key: string) => number): PointMm[] {
  const phase = random('phase') * Math.PI
  return Array.from({ length: 12 }, (_, index) => {
    const angle = index * Math.PI / 6 + phase, radius = .68 + random(`edge/${index}`) * .32
    return { x: Math.round(center.x + Math.cos(angle) * rx * radius), y: Math.round(center.y + Math.sin(angle) * ry * radius) }
  })
}

function rootPatch(roots: PointMm[], b: BoundsMm, random: (key: string) => number) {
  const xs = roots.map(point => point.x), ys = roots.map(point => point.y)
  const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y
  return foliagePatch({ x: x + width / 2, y: y + height / 2 },
    Math.min(8200, b.width / 2, width * .62 + 2350), Math.min(8200, b.height / 2, height * .62 + 1950), random)
}

/** Compose ordinary material rules over the real new ground and route geometry. */
export function dressForestCampGround(document: SceneDocument, p: ForestParameters, report: ForestReport,
  seed: string, idFor: (key: string) => string, meter: ExecutionBudget, checkCancelled: () => void): void {
  const finish = p.groundFinish
  if (finish?.kind !== 'woodland-v2' || !report.groundAreaId) return
  const b = p.boundsMm, area = document.terrainAreas[report.groundAreaId], boundary = terrainPoints(area)
  const polygon = (outer: PointMm[]): PolygonWithHoles => ({ outer, holes: [] })
  const sample = (name: string) => (key: string) => terrainRandomUnit(seed, `forest-camp/floor/${name}/${key}`)
  let paintOrder = Math.max(0, ...Object.values(document.surfaceRules).map(rule => rule.paintOrder))
  function paint(key: string, ref: VersionRef, regions: PolygonWithHoles[], tint: string, opacity: number, blendWidthMm: number) {
    checkCancelled()
    if (!regions.length) return
    const id = idFor(`floor-paint:${key}`)
    document.surfaceRules[id] = { id, floorId: p.floorId, editLocked: false, visibility: 'public', supportRef: { kind: 'terrainArea', id: area.id },
      field: 'material', paintOrder: ++paintOrder, regionsMm: regions.map(({ outer, holes }) => ({ outerMm: outer, holesMm: holes })), blendWidthMm,
      paint: { ...defaultMaterialPaint(document.materials[ref.id]), tint, opacity } }
    document.entityLayers[id] = p.layerId
    report.surfaceRuleIds.push(id)
  }

  const clearingRings = p.clearings.map(clearing => {
    const xs = clearing.boundaryMm.map(point => point.x), ys = clearing.boundaryMm.map(point => point.y)
    const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys)
    const random = sample(clearing.id)
    return foliagePatch(clearing.anchorMm, width * .58, height * .59, random)
  })
  const shoulders = report.pathIds.map((pathId, index) => {
    const path = document.paths[pathId], random = sample(`route-${index}`)
    const widths = path.centerlineMm.map((_, i) => path.widthMm + Math.round(Math.min(1900, path.widthMm * .85) * (.45 + random(String(i)) * .55)))
    return polylineBand(path.centerlineMm, widths, true).map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))
  })
  let soil: PolygonWithHoles[] = [], incompleteSoil = false
  for (const ring of [...clearingRings, ...shoulders]) {
    checkCancelled()
    if (!polygonValid(ring, true)) { incompleteSoil = true; continue }
    try {
      const clipped = polygonBooleanWithHoles({ operation: 'intersection', subject: [polygon(ring)], clip: [polygon(boundary)] }, meter).polygons
      if (clipped.length) soil = polygonBooleanWithHoles({ operation: 'union', subject: soil, clip: clipped }, meter).polygons
    } catch (error) {
      // An optional paint join may round to an invalid sliver at a road junction.
      if (!(error instanceof Error) || !error.message.startsWith('多边形布尔运算拒绝:')) throw error
      incompleteSoil = true
    }
  }
  if (incompleteSoil) report.notes.push('部分营地或路肩的材质边界无法合并，已保留可用的地表过渡。')
  paint('worn-soil', finish.soilMaterialRef, soil, '#DDCDA8', .93, 400)
  const occupied = soil.map(region => region.outer)
  function fitPatches(rings: PointMm[][]): PolygonWithHoles[] {
    const result: PolygonWithHoles[] = []
    for (const ring of rings) {
      checkCancelled()
      const center = ring.reduce((sum, point) => ({ x: sum.x + point.x / ring.length, y: sum.y + point.y / ring.length }), { x: 0, y: 0 })
      // Leave a small gap before feathering to avoid millimetre slivers in the rule stack.
      for (const scale of [1, .78, .56, .38]) {
        const patch = scale === 1 ? ring : ring.map(point => ({
          x: Math.round(center.x + (point.x - center.x) * scale), y: Math.round(center.y + (point.y - center.y) * scale),
        }))
        meter.charge({ intersectionPairs: patch.length * (boundary.length + occupied.reduce((sum, shape) => sum + shape.length, 0)), fieldEvaluations: patch.length })
        if (!polygonValid(patch, true) || !polygonInside(patch, boundary) || occupied.some(shape => polygonDistance(patch, shape) < 30)) continue
        occupied.push(patch)
        result.push(polygon(patch))
        break
      }
    }
    return result
  }

  const mossRings = report.vegetation.flatMap(({ role, placed, clusterId, zoneId }) => {
    if (role !== 'tree' || !placed) return []
    const cluster = document.decorationClusters[clusterId]
    const roots = Object.values(cluster.members).flatMap(row => row.kind === 'prop' && row.entityId ? [document.props[row.entityId].positionMm] : [])
    // Large stands keep several ground patches near the trees rather than one sheet across the whole forest.
    const groups = new Map<string, PointMm[]>()
    for (const point of roots) {
      const key = `${Math.floor((point.x - b.x) / 11000)}:${Math.floor((point.y - b.y) / 11000)}`
      const rows = groups.get(key) ?? []
      rows.push(point)
      groups.set(key, rows)
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 2)
      .map(([key, points]) => rootPatch(points, b, sample(`${zoneId}/${key}`)))
  })
  const spread = (extent: number) => Math.max(1, Math.min(4, Math.ceil(extent / 12800)))
  const columns = spread(b.width), rows = spread(b.height), width = b.width / columns, height = b.height / rows
  const fresh: PointMm[][] = [], dry: PointMm[][] = [], grit: PointMm[][] = []
  const avoid = p.clearings.map(row => row.boundaryMm).concat(shoulders.filter(ring => polygonValid(ring, true)))
  for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
    checkCancelled()
    const random = sample(`meadow/${column}/${row}`)
    const center = { x: Math.round(b.x + width * (column + .24 + .52 * random('x'))), y: Math.round(b.y + height * (row + .24 + .52 * random('y'))) }
    if (avoid.some(ring => pointInPolygon(center, ring))) continue
    const meadow = foliagePatch(center, Math.min(8500, width * (.24 + random('width') * .2)), Math.min(6900, height * (.19 + random('height') * .24)), random)
    const sunny = (column + row + Math.floor(random('tone') * 2)) % 2 === 0
    const patches = sunny ? dry : fresh
    patches.push(meadow)
    if (sunny && grit.length < 6 && Math.min(width, height) > 3900) {
      const pebble = foliagePatch({ x: center.x + Math.round(width * .12), y: center.y - Math.round(height * .13) },
        Math.min(1750, width * .12), Math.min(1240, height * .09), sample(`gravel/${column}/${row}`))
      if (avoid.every(ring => polygonDistance(ring, pebble) >= 280)) grit.push(pebble)
    }
  }
  const gravel = fitPatches(grit)
  paint('gravel', finish.gravelMaterialRef, gravel, '#D5CBA7', .74, 228)
  paint('root-moss', finish.mossMaterialRef, fitPatches(mossRings), '#C1CDA6', .85, 760)
  paint('fresh-meadow', finish.meadowMaterialRef, fitPatches(fresh), '#CCDDB6', .83, 570)
  paint('dry-meadow', finish.meadowMaterialRef, fitPatches(dry), '#F0D589', .78, 650)

  const stone = document.propDefinitions[finish.stoneDefinitionRef.id]
  const sensitive = [...p.clearings.map(row => row.boundaryMm), ...report.pathIds.map(id => pathPolygon(document.paths[id]))]
  const footprints = [...Object.values(document.props).map(propFootprint), ...Object.values(document.decorations).map(row => decorationFootprint(document, row))]
  for (const [index, region] of gravel.entries()) {
    checkCancelled()
    const random = sample(`stones/${index}`), center = region.outer.reduce((sum, point) => ({ x: sum.x + point.x / region.outer.length, y: sum.y + point.y / region.outer.length }), { x: 0, y: 0 })
    for (let attempt = 0; attempt < 8; attempt++) {
      const positionMm = { x: Math.round(center.x + (attempt ? (random(`x/${attempt}`) - .5) * 1100 : 0)),
        y: Math.round(center.y + (attempt ? (random(`y/${attempt}`) - .5) * 850 : 0)) }
      const id = idFor(`gravel-detail:${index}`), prop: Prop = { id, floorId: p.floorId, visibility: 'public', editLocked: false,
        definitionRef: { ...finish.stoneDefinitionRef }, supportRef: { kind: 'terrainArea', id: area.id }, positionMm, rotationDeg: Math.floor(random(`angle/${attempt}`) * 360),
        appearance: { ...stone.defaultAppearance }, visualBoundsMm: { ...stone.defaultVisualBoundsMm }, footprintMm: { ...stone.defaultFootprintMm }, footprintOffsetMm: { ...stone.defaultFootprintOffsetMm },
        blocksMovement: false, blocksSight: false, renderLayer: stone.defaultRenderLayer, renderOrder: index, shadowClass: stone.defaultShadowClass, shadowOverride: null }
      const footprint = propFootprint(prop), image = propPaintPolygon(prop)
      meter.charge({ fieldEvaluations: 1, intersectionPairs: image.length * (boundary.length + sensitive.reduce((sum, ring) => sum + ring.length, 0))
        + footprint.length * (region.outer.length + footprints.length * 4) })
      if (!polygonInside(footprint, region.outer) || !polygonInside(image, boundary) || sensitive.some(ring => polygonDistance(ring, image) < 420)
        || footprints.some(ring => polygonDistance(ring, footprint) < 150)) continue
      document.props[id] = prop
      document.entityLayers[id] = p.layerId
      footprints.push(footprint)
      break
    }
  }
}
