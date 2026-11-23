import { connectionCenterline } from '../geometry/connection-route.js'
import { connectionFootprint, corridor, pointInPolygon, polygonDistance, polygonInside, polygonsOverlap, polygonValid, propFootprint, segmentCuts, terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { PointMm, Prop, SceneDocument, TerrainArea, Visibility } from '../model/scene.js'
import { planBridgeEntrances } from '../projection/bridge-entrances.js'
import { projectPath } from '../projection/paths.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { bridgeDeckIds, type FenceAssemblyRecipe, type PlatformFenceBinding } from './contracts.js'
import { sectionSideReachMm, sizeSection } from './fitted-layout.js'
import { standardPathLamp } from './layout.js'
import { planPlatformFenceRoutes, platformFenceBandGaps } from './platform-fence-route.js'
import { resolvePathProp, resolvePathSection } from './sources.js'

export const DEFAULT_PLATFORM_FENCE_INSET_MM = 500
const EPS = 1e-7
const delta = (a: PointMm, b: PointMm): PointMm => ({ x: a.x - b.x, y: a.y - b.y })
const advance = (p: PointMm, step: PointMm, distance: number): PointMm => ({ x: p.x + step.x * distance, y: p.y + step.y * distance })
const dot = (a: PointMm, b: PointMm) => a.x * b.x + a.y * b.y
const unit = (p: PointMm): PointMm => { const length = Math.hypot(p.x, p.y); return { x: p.x / length, y: p.y / length } }
const edges = (ring: readonly PointMm[]): [PointMm, PointMm][] => ring.map((point, index) => [point, ring[(index + 1) % ring.length]])
const reject = (message: string): never => { throw new OperationRejected('invalid_geometry', message) }

export function blocksPlatformFenceOpening(prop: Prop, bands: readonly PointMm[][]): boolean {
  if (!prop.blocksMovement || !bands.length) return false
  const footprint = propFootprint(prop)
  return bands.some(band => polygonsOverlap(footprint, band))
}

/** A single inside ring keeps the same directed terrain edges and shared corners. */
function insetOutline(area: TerrainArea, insetMm: number): TerrainArea['boundaryMm'] {
  if (!insetMm) return area.boundaryMm
  const ring = terrainPoints(area)
  if (!polygonValid(ring, true)) return reject('平台护栏需要有效的平台轮廓。')
  const directions = edges(ring).map(([a, b]) => unit(delta(b, a)))
  const points = ring.map((point, index) => {
    const before = directions[(index + directions.length - 1) % directions.length], after = directions[index]
    const factor = 1 + dot(before, after)
    if (factor < .125) return reject('平台转角过锐，无法连续内缩护栏。')
    return { x: Math.round(point.x - (before.y + after.y) * insetMm / factor) || 0,
      y: Math.round(point.y + (before.x + after.x) * insetMm / factor) || 0 }
  })
  if (!polygonValid(points, true) || !polygonInside(points, ring) || edges(points).some(([a, b], i) => dot(delta(b, a), directions[i]) <= 0)) {
    return reject('护栏内缩后越出平台或折叠。请减小内缩或调整平台轮廓。')
  }
  return area.boundaryMm.map((row, index) => ({ ...row, positionMm: points[index] }))
}

/** Find the first real exit measured from the connection's declared platform end. */
function platformExit(points: readonly PointMm[], ring: PointMm[]) {
  if (!pointInPolygon(points[0], ring)) return
  const boundary = edges(ring)
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], along = delta(points[index], from)
    const cuts = segmentCuts(from, points[index], boundary)
    for (let i = 1; i < cuts.length; i++) {
      if (!pointInPolygon(advance(from, along, (cuts[i - 1] + cuts[i]) / 2), ring)) {
        return { contactMm: advance(from, along, cuts[i - 1]), direction: unit(along), index }
      }
    }
  }
}

function passageAt(point: PointMm, direction: PointMm, reach: number, widthMm: number) {
  return corridor(advance(point, direction, -reach), advance(point, direction, reach), widthMm)
}

function structuralBands(scene: SceneDocument, area: TerrainArea, audience: Visibility, insetMm: number, deckIds: ReadonlySet<string>) {
  const visible = createPublicVisibility(scene), floor = scene.floors[area.floorId], ring = terrainPoints(area)
  const bands: PointMm[][] = []
  const masks = audience === 'public' ? Object.values(scene.regions).filter(row => row.floorId === area.floorId && row.kind === 'manualMask') : []
  const addVisible = (parts: PointMm[][]) => {
    // A fixed mask can hide public entities without changing their visibility.
    // Suppress the entire entrance when it meets the mask, even at a room cutout.
    if (!masks.some(mask => parts.some(part => polygonDistance(part, mask.boundaryMm) < EPS))) bands.push(...parts)
  }
  for (const row of Object.values(scene.terrainConnections)) {
    if (row.floorId !== area.floorId || row.carvedStrip || row.terrainInlay || audience === 'public' && !visible.terrainConnection(row.id)) continue
    const attached = (ref: typeof row.from.surfaceRef) => ref.kind === 'terrainArea' && ref.id === area.id
    const from = attached(row.from.surfaceRef), to = attached(row.to.surfaceRef)
    if (from === to) continue
    const points = connectionCenterline(row)
    if (to) points.reverse()
    const exit = platformExit(points, ring)
    if (!exit) continue
    const footprint = connectionFootprint(row)
    const parts = footprint.length ? [footprint] : []
    // Continue a short initial landing through the setback, at the same angle
    // and width. An approach that turns inside keeps its actual footprint.
    if (exit.index === 1) {
      parts.push(passageAt(exit.contactMm, exit.direction, insetMm * 2 + 2, row.widthMm))
    }
    addVisible(parts)
  }
  const bridges = Object.values(scene.paths).filter(path => path.floorId === area.floorId && path.assembly?.bridge
    && (audience === 'gm' || visible.path(path.id)))
  if (!bridges.length) return bands
  const terrain = Object.values(scene.terrainAreas).filter(row => row.floorId === area.floorId && (audience === 'gm' || visible.terrainArea(row.id)))
    .sort((a, b) => a.coveragePriority - b.coveragePriority || a.id.localeCompare(b.id))
    .map(row => ({ id: row.id, elevationMm: row.groundElevationMm, priority: row.coveragePriority,
      points: terrainPoints(row), style: null, ...(deckIds.has(row.id) && { bridgeSupport: true as const }) }))
  const rows = bridges.map(source => ({ source, projected: projectPath({ ...source, surfaceStyle: null }, null), elevationMm: source.assembly!.bridge!.elevationMm }))
  for (const entry of planBridgeEntrances(rows, terrain, [], floor)) {
    if (entry.platform?.id !== area.id) continue
    const bridge = scene.paths[entry.bridgeId], points = bridge.centerlineMm
    const first = entry.end === 'start', tip = first ? points[0] : points.at(-1)!, inside = first ? points[1] : points.at(-2)!
    addVisible([...entry.platform.edgeOpening.map(region => region.outerMm),
      passageAt(entry.platform.contactMm, unit(delta(tip, inside)), insetMm * 2 + 2, bridge.widthMm)])
  }
  return bands
}

function fenceSideReach(scene: SceneDocument, recipe: FenceAssemblyRecipe) {
  const source = recipe.section
  const raw = source.kind === 'prefab' ? scene.prefabDefinitions[source.ref.id]?.members ?? [] : resolvePathSection(scene, undefined, source, false)
  const parts = sizeSection(raw, recipe.dimensions)
  const lamp = recipe.lamps && (recipe.lamps.ref ? resolvePathProp(scene, undefined, recipe.lamps.ref) : standardPathLamp())
  return Math.max(sectionSideReachMm(parts), lamp ? sectionSideReachMm([{ key: 'lamp', propTemplate: lamp }]) : 0)
}

export function planBoundPlatformFence(scene: SceneDocument, target: { floorId: string; visibility: Visibility; recipe: FenceAssemblyRecipe }, binding: PlatformFenceBinding) {
  const area = Object.hasOwn(scene.terrainAreas, binding.platformId) ? scene.terrainAreas[binding.platformId] : undefined
  const decks = bridgeDeckIds(scene)
  if (!area || area.floorId !== target.floorId || area.waterSurface || decks.has(area.id)) {
    return reject('平台护栏需要本 Floor 的独立实地平台。')
  }
  if (target.visibility === 'public' && area.visibility !== 'public') return reject('公开护栏须绑定公开平台。')
  const insetMm = binding.insetMm ?? DEFAULT_PLATFORM_FENCE_INSET_MM
  const routes = planPlatformFenceRoutes({ boundaryMm: insetOutline(area, insetMm) }, binding.selection)
  if (routes.length !== 1) return reject('每条平台护栏最多覆盖 32 条连续边段。请分段绘制。')
  const route = routes[0]
  const bands = structuralBands(scene, area, target.visibility, insetMm, decks)
  const sideReachMm = fenceSideReach(scene, target.recipe)
  route.gaps = platformFenceBandGaps(route, bands, sideReachMm)
  if (route.gaps.length > 8 || route.gaps.some(gap => gap.toMm > 10_000_000)) return reject('结构留口超过单条护栏预算，请分段绘制。')
  return { area, route, bands, sideReachMm }
}
