import type { PointMm, SceneDocument, TerrainArea } from '../model/scene.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { terrainPoints, validateGeometry } from '../geometry/geometry.js'
import { terrainTopologyRequestSchema, type TerrainTopologyRequest } from './contracts.js'

const hash = (value: unknown) => sha256Text(canonicalJson(value))
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const generatedId = (operationId: string, suffix: string) => `terrain-topology-${hash(operationId).slice(0, 20)}-${suffix}`
const signedArea = (ring: PointMm[]) => ring.reduce((sum, p, i) => { const n = ring[(i + 1) % ring.length]; return sum + p.x * n.y - n.x * p.y }, 0)
const freshArea = (template: TerrainArea, id: string, ring: PointMm[], priority: number, surface = template.surfaceStyle): TerrainArea => ({
  ...cloneJson(template), id, boundaryMm: ring.map((positionMm, index) => ({ id: `${id}-p${index}`, segmentId: `${id}-s${index}`, positionMm: { ...positionMm } })),
  coveragePriority: priority, surfaceStyle: cloneJson(surface),
})

type Rebinding = TerrainTopologyRequest['rebindings'][number]
const referenceKey = (row: Pick<Rebinding, 'kind' | 'entityId' | 'previousAreaId'>) => canonicalJson([row.kind, row.entityId, row.previousAreaId])
/** Every affected support slot is disclosed separately, including both ends of one connection. */
export function terrainTopologyDependencies(scene: SceneDocument, areaIds: readonly string[]): Omit<Rebinding, 'outputIndex'>[] {
  const selected = (id: string) => areaIds.includes(id)
  const rows: Omit<Rebinding, 'outputIndex'>[] = []
  const add = (kind: Rebinding['kind'], entityId: string, previousAreaId: string) => rows.push({ kind, entityId, previousAreaId })
  for (const prop of Object.values(scene.props)) if (prop.supportRef.kind === 'terrainArea' && selected(prop.supportRef.id)) add('prop', prop.id, prop.supportRef.id)
  for (const room of Object.values(scene.rooms)) if (room.supportRef.kind === 'terrainArea' && selected(room.supportRef.id)) add('room', room.id, room.supportRef.id)
  for (const path of Object.values(scene.paths)) for (const ref of path.supportRefs) if (ref.kind === 'terrainArea' && selected(ref.id)) add('path', path.id, ref.id)
  for (const connection of Object.values(scene.terrainConnections)) {
    if (connection.from.surfaceRef.kind === 'terrainArea' && selected(connection.from.surfaceRef.id)) add('connectionFrom', connection.id, connection.from.surfaceRef.id)
    if (connection.to.surfaceRef.kind === 'terrainArea' && selected(connection.to.surfaceRef.id)) add('connectionTo', connection.id, connection.to.surfaceRef.id)
  }
  for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && selected(note.anchor.entityId)) add('note', note.id, note.anchor.entityId)
  return rows.sort((a,b) => referenceKey(a).localeCompare(referenceKey(b)))
}
function assertWritable(scene: SceneDocument, entityId: string): void {
  const row = scene.terrainAreas[entityId] ?? scene.props[entityId] ?? scene.rooms[entityId] ?? scene.paths[entityId] ?? scene.terrainConnections[entityId] ?? scene.notes[entityId] ?? scene.prefabInstances[entityId] ?? scene.scatterGroups[entityId] ?? scene.generation?.rules[entityId]
  const layerId = row && 'layerId' in row && typeof row.layerId === 'string' ? row.layerId : scene.entityLayers[entityId]
  if (!row || row.editLocked || scene.userLayers[layerId]?.editLocked) throw new Error(`拓扑影响对象或图层已锁定：${entityId}。`)
  if (scene.props[entityId]) for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) if (Object.values(group.members).some(member => member.propId === entityId)) {
    if (group.editLocked || scene.userLayers[scene.entityLayers[group.id]]?.editLocked) throw new Error(`拓扑影响物件所属组合或散布已锁定：${group.id}。`)
  }
}
function requireOutputRefs(scene: SceneDocument, request: TerrainTopologyRequest, outputCount: number): void {
  const required = terrainTopologyDependencies(scene, request.areaIds), expected = new Set(required.map(referenceKey)), supplied = new Set<string>()
  for (const row of request.rebindings) {
    const key = referenceKey(row)
    if (supplied.has(key) || !expected.has(key)) throw new Error(`拓扑重绑类型、基线或重复记录无效：${row.entityId}。`)
    supplied.add(key); assertWritable(scene, row.entityId)
    if (row.outputIndex >= outputCount) throw new Error(`拓扑重绑目标组件不存在：${row.entityId}。`)
  }
  for (const row of required) if (!supplied.has(referenceKey(row))) throw new Error(`拓扑替换缺少${row.kind === 'prop' ? '物件' : row.kind === 'room' ? '房间' : '完整依赖'}支撑重绑：${row.entityId}/${row.kind}。`)
}
function rebind(scene: SceneDocument, request: TerrainTopologyRequest, outputIds: string[]): void {
  for (const row of request.rebindings) {
    const next = outputIds[row.outputIndex]
    if (!scene.terrainAreas[next]) throw new Error(`拓扑重绑目标地形缺失：${next}。`)
    switch (row.kind) {
      case 'prop': scene.props[row.entityId].supportRef = { kind: 'terrainArea', id: next }; break
      case 'room': scene.rooms[row.entityId].supportRef = { kind: 'terrainArea', id: next }; break
      case 'path': scene.paths[row.entityId].supportRefs = scene.paths[row.entityId].supportRefs.map(ref => ref.kind === 'terrainArea' && ref.id === row.previousAreaId ? { kind: 'terrainArea', id: next } : ref); break
      case 'connectionFrom': scene.terrainConnections[row.entityId].from.surfaceRef = { kind: 'terrainArea', id: next }; break
      case 'connectionTo': scene.terrainConnections[row.entityId].to.surfaceRef = { kind: 'terrainArea', id: next }; break
      case 'note': { const note = scene.notes[row.entityId]; if (note.anchor.type !== 'entity') throw new Error('注记附着基线已变化。'); note.anchor.entityId = next; break }
    }
  }
}
/** Apply a complete integer-mm boolean result. Holes become explicit higher-priority surface areas. */
export function applyTerrainTopology(scene: SceneDocument, rawRequest: TerrainTopologyRequest): { outputAreaIds: string[]; componentCount: number; holeCount: number; inputHash: string; outputHash: string } {
  const request = terrainTopologyRequestSchema.parse(rawRequest)
  if (scene.schemaVersion !== 3 || !scene.generation) throw new Error('复杂拓扑需要完整v3场景。')
  if (request.floorId !== scene.terrainAreas[request.templateAreaId]?.floorId) throw new Error('拓扑模板地形与Floor不符。')
  const areas = request.areaIds.map(id => scene.terrainAreas[id])
  if (areas.some(area => !area || area.floorId !== request.floorId)) throw new Error('拓扑输入地形缺失或跨Floor。')
  if (!areas.some(area => area.id === request.templateAreaId)) throw new Error('拓扑模板必须属于输入地形。')
  const contains = (point: PointMm) => point.x >= request.scopeMm.x && point.y >= request.scopeMm.y && point.x <= request.scopeMm.x + request.scopeMm.width && point.y <= request.scopeMm.y + request.scopeMm.height
  const templateInput = scene.terrainAreas[request.templateAreaId]
  for (const area of areas) {
    assertWritable(scene, area.id)
    if (!terrainPoints(area).every(contains)) throw new Error('拓扑替换的完整旧地形超出冻结范围。')
    if (area.visibility !== templateInput.visibility || area.groundElevationMm !== templateInput.groundElevationMm || area.blocksMovement !== templateInput.blocksMovement || area.blocksSight !== templateInput.blocksSight || area.movementCostMultiplier !== templateInput.movementCostMultiplier || area.coveragePriority !== templateInput.coveragePriority || !same(area.surfaceStyle, templateInput.surfaceStyle)) throw new Error('合并地形须有相同高程、物理属性、私密性、优先级和表面；请先明确对齐。')
    if (area.surfaceStyle?.overlays.length) throw new Error('拓扑输入有局部表面覆盖，请先明确处理覆盖范围。')
    for (const owner of Object.values(scene.generation.ownership)) if (owner.target.entityId === area.id) assertWritable(scene, owner.ruleId)
  }
  if (Object.values(scene.terrainEdges).some(edge => request.areaIds.includes(edge.source.areaId) || request.areaIds.includes(edge.neighborAreaId ?? ''))) throw new Error('拓扑输入仍有边缘依赖，请先显式处理边缘。')
  if (scene.visual?.version === 2 && Object.values(scene.visual.base.boundaries).some(boundary => boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => request.areaIds.includes(side.areaId)))) throw new Error('拓扑输入仍有视觉曲线依赖，请先显式处理视觉绑定。')
  requireOutputRefs(scene, request, 128)
  const inputHash = hash({ request, areas: areas.map(area => ({ id: area.id, value: area })) })
  const result = polygonBoolean({ operation: request.operation, subject: areas.map(terrainPoints), clip: request.clip })
  if (!result.polygons.length) throw new Error('拓扑结果为空，不能用空地形替换当前工程。')
  if (result.polygons.some(polygon => ![...polygon.outer, ...polygon.holes.flat()].every(contains))) throw new Error('拓扑新地形超出冻结范围。')
  const template = scene.terrainAreas[request.templateAreaId], nextIds: string[] = [], used = new Set<string>()
  const nextId = (suffix: string) => { const id = generatedId(request.operationId, suffix); if (used.has(id) || scene.terrainAreas[id]) throw new Error('拓扑新身份冲突，请重新开始操作。'); used.add(id); return id }
  for (const [index, polygon] of result.polygons.entries()) {
    const id = nextId(`component-${index}`), area = freshArea(template, id, polygon.outer, template.coveragePriority)
    scene.terrainAreas[id] = area; scene.entityLayers[id] = scene.entityLayers[template.id]; nextIds.push(id)
    for (const [holeIndex, hole] of polygon.holes.entries()) {
      if (!template.surfaceStyle || scene.materials[request.holeSurface.materialRef.id]?.version !== request.holeSurface.materialRef.version || !scene.materials[request.holeSurface.materialRef.id].applicableSurfaces.includes('terrain')) throw new Error('拓扑孔洞需要工程内同版本地形材质。')
      const holeId = nextId(`hole-${index}-${holeIndex}`), holeArea = freshArea(template, holeId, signedArea(hole) < 0 ? [hole[0], ...hole.slice(1).reverse()] : hole, template.coveragePriority + 1, {
        ...cloneJson(template.surfaceStyle), base: { ...cloneJson(template.surfaceStyle.base), materialRef: cloneJson(request.holeSurface.materialRef) }, overlays: [],
      })
      holeArea.groundElevationMm = request.holeSurface.elevationMm; holeArea.blocksMovement = request.holeSurface.blocksMovement; holeArea.movementCostMultiplier = request.holeSurface.movementCostMultiplier
      scene.terrainAreas[holeId] = holeArea; scene.entityLayers[holeId] = scene.entityLayers[template.id]; nextIds.push(holeId)
    }
  }
  requireOutputRefs(scene, request, nextIds.length)
  rebind(scene, request, nextIds)
  for (const owner of Object.values(scene.generation!.ownership)) if (owner.target.kind === 'terrainArea' && request.areaIds.includes(owner.target.entityId)) {
    owner.state = 'deleted'; owner.managedFields = []
  }
  for (const id of request.areaIds) { delete scene.terrainAreas[id]; delete scene.entityLayers[id] }
  const check = validateGeometry(scene)
  if (check.errors.length) throw new Error(`拓扑结果完整几何无效：${check.errors.map(issue => issue.message).join('；')}`)
  return { outputAreaIds: nextIds, componentCount: result.polygons.length, holeCount: result.polygons.reduce((sum, polygon) => sum + polygon.holes.length, 0), inputHash, outputHash: hash(nextIds.map(id => scene.terrainAreas[id])) }
}
