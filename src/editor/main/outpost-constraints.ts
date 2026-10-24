import { assertDoorwayClearances, type DoorwayFixture } from '../../shared/geometry/doorway-clearance'
import { openingEndpoints, pathPolygon, polygonsOverlap, propFootprint } from '../../shared/geometry/geometry'
import { assertTerrainConnectionClearances, checkTerrainTravel, type TerrainConnectionFixture } from '../../shared/geometry/terrain-travel'
import type { Issue, PointMm, SceneDocument } from '../../shared/model/scene'
import { geometryDocumentForValidation } from '../../shared/commands/domain'

/** Versioned opt-in for this sample's finite, named fixtures; never a general route solver. */
export const OUTPOST_PRESET_ID = 'sceneweave-scn04'
export const OUTPOST_DOORWAYS: readonly DoorwayFixture[] = [
  { openingId: 'outpost-entrance', minWidthMm: 1200, approachDepthMm: 1000 },
  { openingId: 'outpost-shared-door', minWidthMm: 1000, approachDepthMm: 1000 },
]
export const OUTPOST_CONNECTIONS: readonly TerrainConnectionFixture[] = [
  { connectionId: 'outpost-stairs', minWidthMm: 2000, approachDepthMm: 1500 },
]

function validateOutpostGeometry(scene: SceneDocument): void {
  if (scene.presetSnapshot.presetId !== OUTPOST_PRESET_ID || scene.presetSnapshot.presetVersion !== 1) return
  assertDoorwayClearances(scene, OUTPOST_DOORWAYS)
  assertTerrainConnectionClearances(scene, OUTPOST_CONNECTIONS)
  const path = scene.paths['outpost-path']
  if (!path || path.widthMm < 2000) throw new Error('海岸哨所道路需要现存的至少2000 mm净宽。')
  const polygon = pathPolygon(path)
  for (const prop of Object.values(scene.props)) if (prop.floorId === path.floorId && prop.blocksMovement && polygonsOverlap(polygon, propFootprint(prop))) throw new Error(`海岸哨所道路净宽被真实物件占地阻挡：${prop.id}。`)
  for (const region of Object.values(scene.regions)) if (region.floorId === path.floorId && region.blocksMovement && polygonsOverlap(polygon, region.boundaryMm)) throw new Error(`海岸哨所道路净宽被区域阻挡：${region.id}。`)
  // Follow the current saved centreline rather than freezing the original world coordinates.
  for (let i = 1; i < path.centerlineMm.length; i++) {
    const result = checkTerrainTravel(scene, { floorId: path.floorId, from: path.centerlineMm[i - 1], to: path.centerlineMm[i], widthMm: path.widthMm })
    if (!result.ok) throw new Error(`海岸哨所道路第${i}段净宽未通过：${result.issues.map(issue => issue.message).join('；')}`)
  }
  const stairs = scene.terrainConnections['outpost-stairs'], endpoint = path.centerlineMm.at(-1)!
  if (endpoint.x !== stairs.from.positionMm.x || endpoint.y !== stairs.from.positionMm.y || !path.supportRefs.some(ref => ref.kind === stairs.from.surfaceRef.kind && ref.id === stairs.from.surfaceRef.id)) throw new Error('海岸哨所道路必须显式接到台阶的低台地端点。')
}

export function validateOutpostEdits(scene: SceneDocument): void {
  validateOutpostGeometry(geometryDocumentForValidation(scene))
}

export interface OutpostRouteCheck {
  id: string; label: string; widthMm: number; from: PointMm | null; to: PointMm | null; ok: boolean; issues: Issue[]
}
/** Current-state checks of named straight segments. A blocked segment is a valid editable state. */
export function checkOutpostRoutes(document: SceneDocument): OutpostRouteCheck[] {
  if (document.presetSnapshot.presetId !== OUTPOST_PRESET_ID) return []
  const scene = geometryDocumentForValidation(document), results: OutpostRouteCheck[] = []
  const missing = (id: string, label: string, widthMm: number, message: string, code = 'OUTPOST_MISSING_FIXTURE') => {
    results.push({ id, label, widthMm, from: null, to: null, ok: false, issues: [{ code, message, entityId: id }] })
  }
  if (document.presetSnapshot.presetVersion !== 1) {
    missing('outpost-unsupported-version', '局部通行检查不适用', 0, `当前仅支持海岸哨所检查版本1；工程声明版本${document.presetSnapshot.presetVersion}，未执行路线检查。`, 'OUTPOST_UNSUPPORTED_VERSION')
    return results
  }
  const add = (id: string, label: string, floorId: string, from: PointMm, to: PointMm, widthMm: number) => {
    results.push({ id, label, from, to, widthMm, ...checkTerrainTravel(scene, { floorId, from, to, widthMm }) })
  }
  for (const fixture of OUTPOST_DOORWAYS) {
    const opening = scene.openings[fixture.openingId]
    const label = fixture.openingId === 'outpost-entrance' ? '值守室南门' : '值守室至储物间'
    if (!opening) { missing(fixture.openingId, label, fixture.minWidthMm, `声明检查的门口不存在：${fixture.openingId}。`); continue }
    const [a, b] = openingEndpoints(scene, opening), length = Math.hypot(b.x - a.x, b.y - a.y), center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const normal = { x: -(b.y - a.y) / length * fixture.approachDepthMm, y: (b.x - a.x) / length * fixture.approachDepthMm }
    add(opening.id, label, opening.floorId,
      { x: center.x - normal.x, y: center.y - normal.y }, { x: center.x + normal.x, y: center.y + normal.y }, opening.widthMm)
  }
  const path = scene.paths['outpost-path']
  if (path) for (let i = 1; i < path.centerlineMm.length; i++) add(`${path.id}-${i}`, `院子道路第 ${i} 段`, path.floorId, path.centerlineMm[i - 1], path.centerlineMm[i], path.widthMm)
  else missing('outpost-path', '院子道路', 2000, '声明检查的院子道路不存在，未执行道路净宽检查。')
  const stairs = scene.terrainConnections['outpost-stairs']
  if (stairs) {
    const a = stairs.from.positionMm, b = stairs.to.positionMm, length = Math.hypot(b.x - a.x, b.y - a.y), depth = OUTPOST_CONNECTIONS[0].approachDepthMm
    add(stairs.id, '台阶与两端接入', stairs.floorId, { x: a.x - (b.x - a.x) / length * depth, y: a.y - (b.y - a.y) / length * depth }, { x: b.x + (b.x - a.x) / length * depth, y: b.y + (b.y - a.y) / length * depth }, stairs.widthMm)
  } else missing('outpost-stairs', '台阶与两端接入', 2000, '声明检查的台阶不存在，未执行高差连接与接入检查。')
  return results
}
