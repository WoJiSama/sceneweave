import type { HistoryIdentity } from '../model/history.js'
import type { Issue, PointMm, SceneDocument, TerrainArea, TerrainConnection } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { coveredEverywhere, connectionBand, pointInPolygon, polygonDistance, polygonsOverlap, terrainPoints } from '../geometry/geometry.js'
import { planTerrainInlay } from './geometry.js'
import type { TerrainInlaySource } from './contracts.js'
import { terrainInlaySchema } from './persistence.js'

export const terrainInlayHash = (value: unknown) => sha256Text(canonicalJson(value))
export function terrainInlaySource(area: TerrainArea): TerrainInlaySource {
  return { id: area.id, floorId: area.floorId, groundElevationMm: area.groundElevationMm,
    coveragePriority: area.coveragePriority, boundaryMm: area.boundaryMm }
}
export function terrainInlayCenterline(connection: TerrainConnection): PointMm[] {
  const inlay = connection.terrainInlay!
  return inlay.centerlineVertexIds.map(id => ({ x: inlay.geometry.verticesMm[id].x, y: inlay.geometry.verticesMm[id].y }))
}
export function terrainInlayFootprint(connection: TerrainConnection, walkOnly = false): PointMm[] {
  const geometry = connection.terrainInlay!.geometry
  return (walkOnly ? geometry.walkBoundaryVertexIds : geometry.footprintVertexIds).map(id => ({ x: geometry.verticesMm[id].x, y: geometry.verticesMm[id].y }))
}
/** Full source geometry is frozen world-space evidence. Actual vertices may be
 * frame-relative at rest, but inspection runs only on the decoded world view. */
export function inspectTerrainInlay(scene: SceneDocument, connection: TerrainConnection): Issue[] {
  if (!connection.terrainInlay) return []
  try {
    const inlay = terrainInlaySchema.parse(connection.terrainInlay), { geometry, originalConnection: original } = inlay
    const assert = (ok: unknown, message: string) => { if (!ok) throw Error(message) }
    assert(!connection.route && !connection.carvedStrip && connection.kind === 'ramp' && connection.openingId === null,
      '跨台山路只保留一条活动坡道，不能叠加旧路线、单宿主切口或门。')
    assert(original.id === connection.id && original.floorId === connection.floorId && terrainInlayHash(original) === inlay.originalConnectionHash,
      '跨台山路的冻结原连接或摘要不完整。')
    assert(original.widthMm === connection.widthMm && terrainInlayHash([original.from, original.to]) === terrainInlayHash([connection.from, connection.to]),
      '跨台山路不能隐式移动冻结路线端点、根基或净宽。')
    assert(connection.from.surfaceRef.kind === 'terrainArea' && connection.to.surfaceRef.kind === 'terrainArea'
      && connection.from.surfaceRef.id !== connection.to.surfaceRef.id, '跨台山路须显式声明两个不同地形端面。')
    assert(geometry.sources.every(source => source.floorId === connection.floorId), '跨台山路源面须同Floor。')
    assert(new Set(inlay.sourceProofs.map(proof => proof.areaId)).size === geometry.sources.length, '跨台山路来源证明不能重复。')
    for (const source of geometry.sources) {
      const current = scene.terrainAreas[source.id], proof = inlay.sourceProofs.find(row => row.areaId === source.id)
      assert(current && !current.rockBody && proof && terrainInlayHash(terrainInlaySource(current)) === terrainInlayHash(source)
        && proof.geometryHash === terrainInlayHash(source), '跨台山路源面已移动、改高、换覆盖顺序或变成未支持的岩体；不能刷新旧来源。')
      assert(!source.boundaryMm.some(point => Object.hasOwn(geometry.verticesMm, point.id)), '实际顶点不得复用源地形身份。')
      assert(connection.visibility !== 'public' || current.visibility === 'public', '公开山路不能依赖私密源地形。')
    }
    for (const end of [connection.from, connection.to]) assert(geometry.sources.some(source => source.id === end.surfaceRef.id), '连接端点根基须属于明确源地形。')
    assert(new Set(inlay.centerlineVertexIds).size === inlay.centerlineVertexIds.length
      && inlay.centerlineVertexIds.every(id => Object.hasOwn(geometry.verticesMm, id)), '跨台山路中心线须引用不同现存实际顶点。')
    const line = terrainInlayCenterline(connection), originalLine = original.route?.centerlineMm ?? [original.from.positionMm, original.to.positionMm]
    assert(terrainInlayHash(line) === terrainInlayHash(originalLine), '跨台山路须保全冻结控制源的完整实际中心线。')
    const walk = terrainInlayFootprint(connection, true), footprint = terrainInlayFootprint(connection)
    const band = connectionBand(line, connection.widthMm)
    assert(coveredEverywhere(band, [walk], point => pointInPolygon(point, walk)), '跨台山路实际步行面未完整覆盖原净宽带。')
    const floor = scene.floors[connection.floorId]
    assert(floor && Object.values(geometry.verticesMm).every(point => point.x >= floor.boundsMm.x && point.y >= floor.boundsMm.y
      && point.x <= floor.boundsMm.x + floor.boundsMm.width && point.y <= floor.boundsMm.y + floor.boundsMm.height), '跨台山路完整实际面越出Floor。')
    const ids = new Set(geometry.sources.map(source => source.id))
    for (const area of Object.values(scene.terrainAreas)) if (area.floorId === connection.floorId && !ids.has(area.id)) {
      // The outside visible owner matters even when only touching the inlay.
      // Refuse an unlisted side, including sub-mm slivers, instead of computing
      // walls against a two-source world that differs from the real scene.
      assert(polygonDistance(footprint, terrainPoints(area)) > .02, '跨台山路影响域或外侧邻面与第三地形相交或接触；须显式纳入来源再制作。')
      if (area.rockBody?.shell) for (const face of Object.values(area.rockBody.shell.faces)) {
        const points = face.vertexIds.map(id => area.rockBody!.shell!.verticesMm[id])
        assert(polygonDistance(footprint, points) > .02, '跨台山路影响域与已有岩体侧壳相交或接触。')
      }
    }
    for (const other of Object.values(scene.terrainConnections)) if (other.id !== connection.id && other.floorId === connection.floorId) {
      const otherFootprints = other.terrainInlay ? [terrainInlayFootprint(other)] : other.carvedStrip
        ? other.carvedStrip.cutCells.map(cell => other.carvedStrip!.faces[cell.lowerFaceId].vertexIds.map(id => other.carvedStrip!.verticesMm[id]))
        : [connectionBand(other.route?.centerlineMm ?? [other.from.positionMm, other.to.positionMm], other.widthMm)]
      assert(otherFootprints.every(points => !polygonsOverlap(footprint, points)), '跨台山路影响域不能与另一连接或切口重叠。')
    }
    planTerrainInlay(geometry)
    return []
  } catch (cause) { return [{ code: 'TERRAIN_INLAY', entityId: connection.id, message: cause instanceof Error ? cause.message : String(cause) }] }
}

/** Identity checks remain on the complete owner, separate from pure geometry. */
export function validateTerrainInlayProofs(scene: SceneDocument, identity: HistoryIdentity): Issue[] {
  const issues: Issue[] = []
  for (const connection of Object.values(scene.terrainConnections)) if (connection.terrainInlay) {
    const inlay = connection.terrainInlay
    if (inlay.lineageId !== identity.lineageId || identity.outdoorTokens[connection.id]?.token !== inlay.connectionBirthToken
      || inlay.sourceProofs.some(proof => { const record = identity.outdoorTokens[proof.areaId]; return !record || record.kind !== 'terrainArea'
        || record.token !== proof.birthToken || record.topologyToken !== proof.topologyToken || record.topologyHash !== proof.topologyHash })) {
      issues.push({ code: 'TERRAIN_INLAY_PROOF', entityId: connection.id, message: '跨台山路的源地形或原连接出生/拓扑来源已失效。' })
    }
  }
  return issues
}
