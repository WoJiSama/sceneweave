import type { CompositionContent } from '../model/appearance.js'
import type { PointMm, SurfaceRef, SurfaceStyle } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { terrainPoints, polygonInside, polygonsOverlap, polygonDistance, pathPolygon, propFootprint, connectionFootprint } from '../geometry/geometry.js'
import { checkTerrainRoute, assertTerrainConnectionClearances } from '../geometry/terrain-travel.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { volcanoEntityId } from './domains/volcano/index.js'
import { assertLocalManaged, finishLocalOwnership, localOwner, type LocalDomainResult, type LocalWrite } from './local-common.js'

export type LocalVolcanoRequest = { operation: 'volcano-material'; recipeId: string; areaId: string; materialRef: { id: string; version: number } }
  | { operation: 'volcano-boundary'; recipeId: string; areaId: string; positionsMm: PointMm[] }
export function regenerateVolcanoSurface(content: CompositionContent, request: LocalVolcanoRequest, runtime: PreparationContext, checkCancelled: () => void): LocalDomainResult {
  checkCancelled()
  const before = content.document, gen = getLegacyGeneration(before)!, recipe = gen.recipes[request.recipeId]
  if (!recipe || !('domain' in recipe) || recipe.domain !== 'volcano') throw new Error('须选择已保存的火山配方。')
  const owner = localOwner(before, 'terrainArea', request.areaId)
  if (gen.rules[owner.ruleId]?.recipeRef.id !== recipe.id) throw new Error('目标表面不属于该火山配方。')
  const area = before.terrainAreas[request.areaId]
  if (!area) throw new Error('目标地形面已删除。')
  const id = (key: string) => volcanoEntityId(before.sceneId, recipe.seed, key)
  const reads = new Set([recipe.id, area.id, before.entityLayers[area.id], owner.id, owner.ruleId])
  const commands: SceneCommand[] = [], writes: LocalWrite[] = []
  if (request.operation === 'volcano-material') {
    assertLocalManaged(content, 'terrainArea', area.id, ['surface'])
    if ((content.appearance.instanceAdjustments[area.id] ?? []).length || (content.appearance.layerAdjustments[before.entityLayers[area.id]] ?? []).length) throw new Error('选定表面或图层已有人工外观覆盖，局部生成不覆盖它们。')
    const material = before.materials[request.materialRef.id]
    if (!material || material.version !== request.materialRef.version || !material.applicableSurfaces.includes('terrain')) throw new Error('须选择确切且适用地形的固定材质。')
    const style: SurfaceStyle = area.surfaceStyle ? cloneJson(area.surfaceStyle) : { base: { materialRef: request.materialRef, tileSizeMm: material.defaultTileSizeMm, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
    style.base.materialRef = cloneJson(request.materialRef)
    commands.push({ type: 'updateTerrainArea', id: area.id, changes: { surfaceStyle: style } })
    writes.push({ kind: 'terrainArea', entityId: area.id, fields: ['surface'] }); reads.add(material.id); reads.add(material.textureAssetId)
  } else {
    if (area.id !== id('crater')) throw new Error('首条结构局部修改仅支持已生成火口的同拓扑轮廓。')
    assertLocalManaged(content, 'terrainArea', area.id, ['geometry'])
    if (request.positionsMm.length !== area.boundaryMm.length) throw new Error('同拓扑轮廓须保留现有点/段数量与顺序；新增删除拓扑尚不支持。')
    const witness = content.historyIdentity.outdoorTokens[area.id]
    if (!witness || witness.kind !== 'terrainArea') throw new Error('缺少当前真实室外出生与拓扑身份。')
    const boundaryMm = area.boundaryMm.map((row, index) => ({ ...cloneJson(row), positionMm: cloneJson(request.positionsMm[index]) }))
    const mountain = before.terrainAreas[id('mountain')], platform = before.terrainAreas[id('platform')]
    if (!mountain || !platform || !polygonInside(request.positionsMm, terrainPoints(mountain)) || request.positionsMm.some(point => !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y))
      || polygonsOverlap(request.positionsMm, terrainPoints(platform))) throw new Error('火口轮廓须留在当前山体且避开活动平台。')
    reads.add(mountain.id); reads.add(platform.id)
    // Preserve every exact current support reference and endpoint. The complete
    // native candidate refuses any connection/prop that the new contour breaks.
    commands.push({ type: 'updateTerrainArea', id: area.id, changes: { boundaryMm } })
    writes.push({ kind: 'terrainArea', entityId: area.id, fields: ['geometry'] })
    for (const region of Object.values(before.regions)) if (region.id === id('region:crater')) {
      assertLocalManaged(content, 'region', region.id, ['geometry'])
      if (canonicalJson(region.boundaryMm) !== canonicalJson(terrainPoints(area))) throw new Error('火口策略区域已有独立轮廓，不能隐式重映射。')
      commands.push({ type: 'updateRegion', id: region.id, changes: { boundaryMm: cloneJson(request.positionsMm) } })
      writes.push({ kind: 'region', entityId: region.id, fields: ['geometry'] }); reads.add(region.id)
    }
    const flow = before.terrainAreas[id('flow')]
    if (flow && !polygonInside(terrainPoints(flow), request.positionsMm)) throw new Error('新火口轮廓不能吞没或移走现存流道支撑。')
    if (flow) reads.add(flow.id)
    const near = (points: PointMm[]) => polygonDistance(points, terrainPoints(area)) === 0 || polygonDistance(points, request.positionsMm) === 0
    const onChangedSupport = (ref: SurfaceRef): boolean => ref.kind === 'room' ? onChangedSupport(before.rooms[ref.id].supportRef) : ref.kind === 'terrainArea' && ref.id === area.id
    const readSupport = (ref: SurfaceRef): void => {
      reads.add(ref.id)
      if (ref.kind === 'room') readSupport(before.rooms[ref.id].supportRef)
      else if (ref.kind === 'terrainArea') reads.add(before.terrainAreas[ref.id].floorId)
    }
    // Real building walls participate in the route/connection checks below.
    // Keep their current geometry, support, opening state and locks visible in
    // the read-only closure rather than silently treating them as terrain.
    for (const room of Object.values(before.rooms)) if (room.floorId === area.floorId) {
      reads.add(room.id); readSupport(room.supportRef)
      for (const vertexId of room.boundaryVertexIds) reads.add(vertexId)
    }
    for (const wall of Object.values(before.walls)) if (wall.floorId === area.floorId) {
      reads.add(wall.id); reads.add(wall.startVertexId); reads.add(wall.endVertexId)
    }
    for (const opening of Object.values(before.openings)) if (opening.floorId === area.floorId) reads.add(opening.id)
    for (const row of Object.values(before.terrainEdges)) if (row.source.areaId === area.id || row.neighborAreaId === area.id) reads.add(row.id)
    for (const row of Object.values(before.terrainConnections)) if (onChangedSupport(row.from.surfaceRef) || onChangedSupport(row.to.surfaceRef) || near(connectionFootprint(row))) {
      reads.add(row.id); readSupport(row.from.surfaceRef); readSupport(row.to.surfaceRef)
      if (row.openingId) reads.add(row.openingId)
    }
    for (const row of Object.values(before.paths)) if (row.supportRefs.some(onChangedSupport) || near(pathPolygon(row))) {
      reads.add(row.id); row.supportRefs.forEach(readSupport)
    }
    for (const row of Object.values(before.props)) if (onChangedSupport(row.supportRef) || near(propFootprint(row))) reads.add(row.id)
    for (const row of Object.values(before.regions)) if (near(row.boundaryMm)) reads.add(row.id)
    for (const row of Object.values(before.decorationClusters)) if (row.supportRef.id === area.id) reads.add(row.id)
    for (const row of Object.values(before.decorations)) if (row.supportRef.id === area.id) reads.add(row.id)
    for (const row of Object.values(before.surfaceRules)) if (row.supportRef.id === area.id) reads.add(row.id)
    for (const entityId of [...reads]) if (before.entityLayers[entityId]) reads.add(before.entityLayers[entityId])
  }
  checkCancelled()
  const document = applyCommands(before, commands, runtime, { appearance: content.appearance })
  if (request.operation === 'volcano-boundary') {
    for (const collection of ['rooms', 'walls', 'openings'] as const) if (canonicalJson(before[collection]) !== canonicalJson(document[collection])) throw new Error('火口局部修改不能改变已有建筑或门窗。')
    const connectionIds = Object.values(document.terrainConnections).filter(row => reads.has(row.id)).map(row => row.id)
    assertTerrainConnectionClearances(document, connectionIds.map(connectionId => ({ connectionId, minWidthMm: document.terrainConnections[connectionId].widthMm, approachDepthMm: Math.max(1, Math.floor(document.terrainConnections[connectionId].widthMm / 3)) })))
    for (const row of Object.values(document.paths)) if (reads.has(row.id)) {
      const checked = checkTerrainRoute(document, { floorId: row.floorId, pointsMm: row.centerlineMm, widthMm: row.widthMm })
      if (!checked.ok) throw new Error(`当前路线依赖冲突：${checked.issues.map(issue => issue.message).join('；')}`)
    }
  }
  for (const note of Object.values(before.notes)) if (note.anchor.type === 'entity' && reads.has(note.anchor.entityId)) reads.add(note.id)
  finishLocalOwnership(before, document, writes, recipe.id)
  checkCancelled()
  return { document, writes, readIds: [...reads].sort(), commands, notes: [request.operation === 'volcano-material' ? '只修改选定表面底材；高程、危险、阻挡与移动代价保持。' : '保留当前点段身份、连接端点和支撑引用；仅调整火口与仍受管的同轮廓策略区域，其他依赖只读核对。'] }
}
