import type { MaterialPaint, PointMm, SceneDocument, SurfaceOverlay } from '../../../shared/model/scene.js'
import { polygonInside, terrainPoints } from '../../../shared/geometry/geometry.js'
import { polygonBoolean } from '../../../shared/geometry/polygon-boolean.js'
import { resolveBuildingEntrancePort } from '../../../shared/generation/building-port.js'
import { geometryIdentityIds } from '../../../shared/commands/domain.js'
import { MANUAL_TRANSACTION_BUDGET, assertCommandBudget, measureCommandBudget } from '../../../shared/budget/command-budget.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { applyOutpostSurfaceTransitions } from './outpost-surfaces.js'

export const OUTPOST_SURFACE_V2_PREFIX = 'outpost-transition-v2-'
const oldPrefix = 'outpost-transition-'
const groundId = 'sample-ground', loamId = 'theme-pack-wilderness-material-forest-loam-v2'
const round = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })
const p = (rows: readonly (readonly number[])[]): PointMm[] => rows.map(([x, y]) => ({ x, y }))
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const baselineError = () => new Error('第二版哨站地表只用于未修改的公开编排1基线；不覆盖人工外观、道路或已应用记录。')
const rounded = (points: PointMm[]) => points.flatMap((a, index) => {
  const b = points[(index + 1) % points.length]
  return [round(a.x * .75 + b.x * .25, a.y * .75 + b.y * .25), round(a.x * .25 + b.x * .75, a.y * .25 + b.y * .75)]
})
const campOutlines = {
  'sample-camp': rounded(p([[17600, 16600], [18600, 14800], [21600, 13900], [24800, 14300], [27700, 15800], [28800, 18400], [27900, 20700], [25500, 21900], [21800, 22000], [18600, 20400]])),
  'sample-abandoned-camp': rounded(p([[23200, 23900], [24700, 22500], [27900, 22000], [31400, 22300], [33900, 23800], [34500, 25100], [32700, 27300], [29000, 27800], [25800, 27500], [23600, 25800]])),
} as const
const roads = [
  { points: p([[2500, 26000], [7000, 22000], [11500, 20000], [15000, 15500], [21000, 13500], [26000, 12000], [33000, 5000]]), width: 1800, supports: ['sample-ground', 'sample-camp'] },
  { points: p([[6750, 12311], [6750, 14600], [8700, 17500], [11500, 20000]]), width: 1400, supports: ['sample-ground'] },
  { points: p([[21000, 13500], [21900, 15600], [22500, 17100]]), width: 1500, supports: ['sample-ground', 'sample-camp'] },
  { points: p([[26000, 12000], [29400, 16900], [30900, 20800], [31500, 23500]]), width: 1100, supports: ['sample-ground', 'sample-camp', 'sample-abandoned-camp'] },
] as const

function baseline(input: SceneDocument): SceneDocument {
  const checked = validateSceneDocument(input)
  if (!checked.ok) throw new Error(`第二版哨站基线无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const scene = checked.document, ground = scene.terrainAreas[groundId], style = ground?.surfaceStyle
  if (scene.revision !== 0 || !['sceneweave-outpost-layout', 'sceneweave-outpost-daylight'].includes(scene.presetSnapshot.presetId) || scene.presetSnapshot.presetVersion !== 1
    || !ground || !style || !same(terrainPoints(ground), p([[0, 0], [36000, 0], [36000, 28000], [0, 28000]]))
    || Object.keys(scene.terrainAreas).length !== 3 || Object.keys(scene.paths).length !== 4 || Object.keys(scene.terrainEdges).length || Object.keys(scene.terrainConnections).length || Object.keys(scene.regions).length) throw baselineError()
  for (const [id, points] of Object.entries(campOutlines)) if (!scene.terrainAreas[id] || !same(terrainPoints(scene.terrainAreas[id]), points)) throw baselineError()
  for (const collection of ['terrainAreas', 'paths', 'rooms', 'walls', 'openings', 'props', 'prefabInstances', 'scatterGroups'] as const) for (const value of Object.values(scene[collection])) {
    if (value.editLocked || scene.userLayers[scene.entityLayers[value.id]]?.editLocked || ('visibility' in value && value.visibility !== 'public')) throw baselineError()
  }
  const material = scene.materials[loamId]
  if (!material || material.version !== 2) throw baselineError()
  const paint: MaterialPaint = { materialRef: { id: loamId, version: 2 }, tileSizeMm: { ...material.defaultTileSizeMm }, alignment: 'world', originMm: { x: 0, y: 0 }, rotationDeg: 0, tint: null, opacity: 1 }
  const meadow = scene.materials['theme-pack-wilderness-material-meadow-grass-v2']
  if (!meadow || meadow.version !== 2 || !same(style.base, { ...paint, materialRef: { id: meadow.id, version: meadow.version }, tileSizeMm: meadow.defaultTileSizeMm })) throw baselineError()
  for (const id of Object.keys(campOutlines)) if (!same(scene.terrainAreas[id].surfaceStyle, { base: paint, overlays: [] })) throw baselineError()
  for (const [index, expected] of roads.entries()) {
    const road = scene.paths[`theme-sample-path-${index + 1}`]
    if (!road || !same(road.centerlineMm, expected.points) || road.widthMm !== expected.width || !same(road.supportRefs, expected.supports.map(id => ({ kind: 'terrainArea', id })))
      || !same(road.surfaceStyle, { base: paint, overlays: [] }) || road.floorId !== ground.floorId || road.renderOrder !== 0 || road.movementCostMultiplier !== 1) throw baselineError()
  }
  const port = resolveBuildingEntrancePort(scene, 'watch-entrance', 1400)
  if (!same(port.outsideMm, roads[1].points[0])) throw baselineError()
  const old = style.overlays.filter(overlay => overlay.id.startsWith(oldPrefix))
  if (old.length !== 6 || old.some(overlay => overlay.id.startsWith(OUTPOST_SURFACE_V2_PREFIX))) throw baselineError()
  // Replay the existing construction on the exact verified physical inputs.
  // An ID, preset marker or matching material alone never authorizes replacement.
  const witness = structuredClone(scene)
  witness.terrainAreas[groundId].surfaceStyle!.overlays = witness.terrainAreas[groundId].surfaceStyle!.overlays.filter(overlay => !overlay.id.startsWith(oldPrefix))
  applyOutpostSurfaceTransitions(witness)
  if (!same(old, witness.terrainAreas[groundId].surfaceStyle!.overlays.filter(overlay => overlay.id.startsWith(oldPrefix)))) throw baselineError()
  return scene
}

function ellipse(center: PointMm, radiusX: number, radiusY: number, angle: number, phase: number): PointMm[] {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return Array.from({ length: 12 }, (_, index) => {
    const theta = index / 12 * Math.PI * 2, wobble = .91 + .07 * Math.sin(index * 1.7 + phase)
    const x = Math.cos(theta) * radiusX * wobble, y = Math.sin(theta) * radiusY * wobble
    return round(center.x + x * cos - y * sin, center.y + x * sin + y * cos)
  })
}
function roadShoulder(points: PointMm[], widthMm: number, roadIndex: number): PointMm[][] {
  const strips: PointMm[][] = [], half = widthMm / 2
  let distance = 0
  const widths = (position: number) => ({
    left: half + 430 + Math.sin(position / 2100 + roadIndex * 1.7) * 175 + Math.cos(position / 870 + roadIndex) * 85,
    right: half + 390 + Math.sin(position / 1700 + roadIndex * 2.1) * 140 + Math.cos(position / 1100 + roadIndex * .8) * 80,
  })
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), tx = dx / length, ty = dy / length, nx = -ty, ny = tx
    const count = Math.max(3, Math.ceil(length / 1300)), left: PointMm[] = [], right: PointMm[] = []
    for (let step = 0; step <= count; step++) {
      const along = length * step / count, width = widths(distance + along)
      left.push(round(a.x + tx * along + nx * width.left, a.y + ty * along + ny * width.left))
      right.push(round(a.x + tx * along - nx * width.right, a.y + ty * along - ny * width.right))
    }
    const endWidth = widths(distance + length), startWidth = widths(distance)
    const cap = (center: PointMm, from: number, leftWidth: number, rightWidth: number) => Array.from({ length: 5 }, (_, k) => {
      const t = (k + 1) / 6, theta = from - t * Math.PI, radius = leftWidth * (1 - t) + rightWidth * t
      return round(center.x + tx * Math.cos(theta) * radius + nx * Math.sin(theta) * radius,
        center.y + ty * Math.cos(theta) * radius + ny * Math.sin(theta) * radius)
    })
    strips.push([...left, ...cap(b, Math.PI / 2, endWidth.left, endWidth.right), ...right.reverse(), ...cap(a, -Math.PI / 2, startWidth.right, startWidth.left)])
    distance += length
  }
  return strips
}

/** Construction-only v2 over the exact original road/camp recipe. Complete
 * results persist as ordinary overlays; no renderer or open hook regenerates
 * them, and the input remains intact on both success and any late rejection. */
export function applyOutpostSurfaceTransitionsV2(input: SceneDocument): SceneDocument {
  const source = baseline(input), scene = structuredClone(source), ground = scene.terrainAreas[groundId], bounds = terrainPoints(ground)
  const retained = ground.surfaceStyle!.overlays.filter(overlay => !overlay.id.startsWith(oldPrefix)), additions: SurfaceOverlay[] = []
  const occupied = geometryIdentityIds(source)
  for (const id of Object.keys(source.userLayers)) occupied.add(id)
  const paint = structuredClone(source.terrainAreas[groundId].surfaceStyle!.overlays.find(overlay => overlay.id.startsWith(oldPrefix))!.paint)
  const add = (id: string, subject: PointMm[][], blendWidthMm: number) => {
    if (occupied.has(`${OUTPOST_SURFACE_V2_PREFIX}${id}`)) throw new Error('第二版哨站新生地表身份已被占用，未替换任何覆盖。')
    const joined = polygonBoolean({ operation: 'union', subject, clip: [] })
    const clipped = polygonBoolean({ operation: 'intersection', subject: joined.polygons.flatMap(polygon => {
      if (polygon.holes.length) throw new Error('第二版哨站土质过渡不得用隐式孔洞改变覆盖。')
      return [polygon.outer]
    }), clip: [bounds] })
    if (clipped.polygons.length !== 1 || clipped.polygons[0].holes.length) throw new Error('第二版哨站每片过渡须为地面内一个明确无孔轮廓。')
    const boundaryMm = clipped.polygons[0].outer
    if (!polygonInside(boundaryMm, bounds)) throw new Error('第二版哨站地表过渡超出真实地面。')
    additions.push({ id: `${OUTPOST_SURFACE_V2_PREFIX}${id}`, boundaryMm, paint: structuredClone(paint), blendWidthMm, renderOrder: 10 + additions.length })
  }
  for (const [index, road] of Object.values(scene.paths).sort((a, b) => a.id.localeCompare(b.id)).entries()) add(road.id, roadShoulder(road.centerlineMm, road.widthMm, index), [390, 340, 430, 350][index])
  for (const [index, campId] of Object.keys(campOutlines).entries()) {
    const points = terrainPoints(scene.terrainAreas[campId]), lobes = points.filter((_, i) => (i + index) % 3 === 0).map((point, i) => ellipse(point, 360 + i % 3 * 125, 260 + i % 4 * 100, i * .7, index + i))
    add(campId, [points, ...lobes], index ? 740 : 660)
  }
  add('trail-wear-west', [ellipse({ x: 16600, y: 16700 }, 590, 350, -.8, 2)], 210)
  add('abandoned-approach-wear', [ellipse({ x: 23000, y: 23100 }, 530, 310, .4, 4)], 240)
  ground.surfaceStyle!.overlays = [...retained, ...additions]
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`第二版哨站过渡无效：${checked.errors.map(issue => issue.message).join('；')}`)
  // Charge the target plus each removed and newly born overlay, alongside the
  // actual geometry/work dimensions. The parent construction still validates
  // its complete source/identity closure before creating or publishing a file.
  assertCommandBudget(MANUAL_TRANSACTION_BUDGET, measureCommandBudget(source, checked.document, undefined, { semanticTargets: 1 + 6 + additions.length }))
  return checked.document
}
