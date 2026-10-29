import type { Issue, PointMm, SceneDocument } from '../model/scene.js'
import type { VisualSystem } from '../visual/types.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { TERRAIN_CONTRACT_LIMITS, type GenerationSystem1, type GenerationSystem3, type GenerationSystem4, type GenerationRule, type GenerationReference,
  type GenerationFieldGroup } from './contracts.js'
import { getLegacyGeneration, legacyTerrainView, type LegacyTerrainScene } from './composition-contracts.js'
import { normalizeTerrainStroke, terrainStrokePolygon } from './stroke.js'
import { surroundingsEntityHash, surroundingsOutputHash } from './surroundings.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'

export type TerrainContractDocument = LegacyTerrainScene
const terrain = (value: SceneDocument): TerrainContractDocument => legacyTerrainView(value)
const hashValue = (value: unknown) => sha256Text(canonicalJson(value))
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const entityKey = (ref: GenerationReference) => canonicalJson([ref.kind, ref.parentId, ref.entityId])
const sameEntity = (a: GenerationReference, b: GenerationReference) => entityKey(a) === entityKey(b)
const fields: Record<GenerationFieldGroup, readonly string[]> = {
  geometry: ['boundaryMm', 'centerlineMm', 'positionMm', 'rotationDeg', 'footprintMm', 'footprintOffsetMm', 'widthMm', 'from', 'to', 'segments', 'closed', 'pointsMm', 'polygons', 'strokes', 'visualBoundsMm', 'groundElevationMm', 'side', 'sampleSpacingMm', 'toleranceMm'],
  properties: ['floorId', 'layerId', 'visibility', 'editLocked', 'blocksMovement', 'blocksSight', 'movementCostMultiplier', 'kind', 'coveragePriority', 'name', 'description', 'purpose', 'relativeElevationMm', 'flow', 'displayWidthMm', 'actualWidthMm', 'shoreline', 'enabled', 'openingId'],
  surface: ['surfaceStyle', 'floorStyle', 'topStyle', 'style', 'paint', 'blendWidthMm', 'materialRef', 'fillColor', 'opacity'],
  appearance: ['appearance', 'definitionRef', 'visualBoundsMm', 'shadowClass', 'shadowOverride', 'renderLayer', 'renderOrder', 'color', 'accentColor', 'opacity', 'intensity', 'seed', 'repeatMm', 'enabled', 'fillColor'],
  membership: ['members', 'domain', 'palette', 'portIds', 'connectedLineIds', 'areaId', 'managementKey'],
  exclusions: ['exclusions'], presentation: ['rootAnchorMm', 'orientation', 'groundShadowMm', 'fixedRotationDeg', 'footprintAxes'],
  source: ['source', 'neighborAreaId', 'binding', 'boundaryId', 'inputHash', 'materialRef', 'definitionRef', 'sourceRef', 'supportRef', 'supportRefs', 'roomId', 'algorithmVersion', 'gridOriginMm', 'cellSizeMm', 'densityFactor', 'minDistanceMm', 'rotationRangeDeg'],
}

/** Resolve the persisted target only. No generator invocation, resource IO or caller field accessors. */
export function resolveGenerationEntity(input: SceneDocument, ref: GenerationReference): Record<string, unknown> | null {
  const doc = terrain(input), collections = { terrainArea: doc.terrainAreas, terrainEdge: doc.terrainEdges, terrainConnection: doc.terrainConnections,
    path: doc.paths, prop: doc.props, scatterGroup: doc.scatterGroups, visualBoundary: doc.visual.base.boundaries, visualEdgeLook: doc.visual.base.edgeLooks,
    materializedEdge: doc.visual.materializedEdges, regionalArea: doc.regional?.areas, regionalLine: doc.regional?.lines,
    regionalLandmark: doc.regional?.landmarks, regionalSymbol: doc.regional?.symbols }
  if (ref.kind in collections) {
    const value = collections[ref.kind as keyof typeof collections]?.[ref.entityId]
    return value ? { ...value, layerId: 'layerId' in value ? value.layerId : doc.entityLayers[ref.entityId] ?? null } : null
  }
  if (ref.kind === 'terrainPoint' || ref.kind === 'terrainSegment') {
    const area = ref.parentId ? doc.terrainAreas[ref.parentId] : undefined
    const index = area?.boundaryMm.findIndex(point => (ref.kind === 'terrainPoint' ? point.id : point.segmentId) === ref.entityId) ?? -1
    if (!area || index < 0) return null
    return ref.kind === 'terrainPoint' ? { positionMm: area.boundaryMm[index].positionMm }
      : { pointsMm: [area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm] }
  }
  if (ref.kind === 'scatterMember') {
    const member = ref.parentId ? doc.scatterGroups[ref.parentId]?.members[ref.entityId] : undefined
    return member ? { members: member } : null
  }
  if (ref.kind === 'surfaceOverlay' && ref.parentId) {
    const style = doc.terrainAreas[ref.parentId]?.surfaceStyle ?? doc.paths[ref.parentId]?.surfaceStyle ?? doc.terrainEdges[ref.parentId]?.surfaceStyle
      ?? doc.terrainConnections[ref.parentId]?.surfaceStyle ?? doc.rooms[ref.parentId]?.floorStyle ?? doc.walls[ref.parentId]?.topStyle
    const overlay = style?.overlays.find(row => row.id === ref.entityId)
    return overlay ? { ...overlay } : null
  }
  return null
}
export function resolveGenerationTarget(input: SceneDocument, ref: GenerationReference): Record<string, unknown> | null {
  const target = resolveGenerationEntity(input, ref)
  return target && Object.fromEntries(fields[ref.fieldGroup].filter(key => Object.hasOwn(target, key)).map(key => [key, target[key]]))
}
export function generationInputHash(input: SceneDocument, rule: GenerationRule): string {
  const doc = terrain(input)
  return hashValue({ recipe: doc.generation.recipes[rule.recipeRef.id], parameters: rule.parameters,
    inputs: rule.inputs.map(ref => ({ ref, value: resolveGenerationTarget(input, ref) })).sort((a, b) => compareText(canonicalJson(a.ref), canonicalJson(b.ref))) })
}
/** Manual/deleted/detached groups remain in the project hash, but are excluded from this managed hash. */
export function managedOutputHash(input: SceneDocument, rule: GenerationRule): string {
  const rows = Object.values(terrain(input).generation.ownership).filter(row => row.ruleId === rule.id && (row.state === 'managed' || row.state === 'manual'))
  return hashValue(rows.flatMap(row => row.managedFields.filter(field => !row.manualFields.includes(field)).map(fieldGroup => ({
    outputKey: row.outputKey, fieldGroup, value: resolveGenerationTarget(input, { ...row.target, fieldGroup }),
  }))).sort((a, b) => compareText(canonicalJson([a.outputKey, a.fieldGroup]), canonicalJson([b.outputKey, b.fieldGroup]))))
}
export function materializedBoundaryHash(boundary: VisualSystem['boundaries'][string]): string { return hashValue(boundary) }
export function constraintInputHash(input: SceneDocument, constraintId: string): string {
  const doc = terrain(input)
  return hashValue({ constraint: doc.generation.constraints[constraintId] ?? null, terrainAreas: doc.terrainAreas, terrainEdges: doc.terrainEdges,
    terrainConnections: doc.terrainConnections, paths: doc.paths, props: doc.props, regions: doc.regions, rooms: doc.rooms,
    vertices: doc.vertices, walls: doc.walls, openings: doc.openings, regional: doc.regional })
}

/** Derived audience policy; never mutates a public symbol because its source is GM. */
export function regionalEntityVisibility(input: SceneDocument, kind: 'area' | 'line' | 'landmark' | 'symbol', id: string): 'public' | 'gm' {
  const region = terrain(input).regional
  if (!region) return 'gm'
  const row = { area: region.areas, line: region.lines, landmark: region.landmarks, symbol: region.symbols }[kind][id]
  if (!row || row.visibility === 'gm') return 'gm'
  if (kind === 'landmark') {
    const landmark = region.landmarks[id]
    if (landmark.areaId && regionalEntityVisibility(input, 'area', landmark.areaId) === 'gm') return 'gm'
  }
  if (kind === 'symbol') {
    const symbol = region.symbols[id]
    if (symbol.sourceRef && regionalEntityVisibility(input, symbol.sourceRef.kind, symbol.sourceRef.id) === 'gm') return 'gm'
  }
  return 'public'
}

const cross = (a: PointMm, b: PointMm, c: PointMm) => (BigInt(b.x) - BigInt(a.x)) * (BigInt(c.y) - BigInt(a.y)) - (BigInt(b.y) - BigInt(a.y)) * (BigInt(c.x) - BigInt(a.x))
const onSegment = (a: PointMm, b: PointMm, p: PointMm) => cross(a, b, p) === 0n && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
function intersects(a: PointMm, b: PointMm, c: PointMm, d: PointMm): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  return (abC < 0n && abD > 0n || abC > 0n && abD < 0n) && (cdA < 0n && cdB > 0n || cdA > 0n && cdB < 0n)
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}
function simplePolygon(ring: PointMm[]): boolean {
  if (ring.length < 3 || ring.some((p, i) => equal(p, ring[(i + 1) % ring.length]))) return false
  let area = 0n
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; area += BigInt(a.x) * BigInt(b.y) - BigInt(a.y) * BigInt(b.x)
    for (let j = i + 1; j < ring.length; j++) if (j !== i + 1 && !(i === 0 && j === ring.length - 1)
      && intersects(a, b, ring[j], ring[(j + 1) % ring.length])) return false
  }
  return area !== 0n
}

/** Called after the strict shape parser; never recursively calls validateSceneDocument. */
export function validateTerrainContracts(input: SceneDocument): Issue[] {
  const doc = terrain(input), issues: Issue[] = []
  const fail = (code: string, message: string, entityId?: string) => issues.push({ code, message, ...(entityId ? { entityId } : {}) })
  if (doc.schemaVersion !== 3) return issues
  if (encodeUtf8(canonicalJson(doc.generation)).byteLength > TERRAIN_CONTRACT_LIMITS.normalizedBytes) fail('TERRAIN_INPUT_BUDGET', '生成规范输入、关系和来源快照合计超过4MiB。')
  const seen = new Set<string>([doc.sceneId])
  const register = (key: string, value: { id: string }) => {
    if (key !== value.id) fail('TERRAIN_ID_KEY', '新记录键与id不一致。', value.id)
    if (seen.has(value.id)) fail('TERRAIN_ID_CONFLICT', '新记录与工程内已有ID冲突。', value.id)
    seen.add(value.id)
  }
  const oldCollections = ['floors', 'vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'assets', 'propDefinitions', 'materials', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabDefinitions', 'prefabInstances', 'scatterGroups', 'styleThemes', 'userLayers'] as const
  for (const collection of oldCollections) for (const row of Object.values(doc[collection])) seen.add(row.id)
  for (const area of Object.values(doc.terrainAreas)) for (const point of area.boundaryMm) { seen.add(point.id); seen.add(point.segmentId) }
  for (const check of doc.constraints.pathChecks) seen.add(check.id)
  for (const style of [...Object.values(doc.rooms).map(row => row.floorStyle), ...Object.values(doc.walls).map(row => row.topStyle),
    ...[...Object.values(doc.terrainAreas), ...Object.values(doc.paths), ...Object.values(doc.terrainEdges), ...Object.values(doc.terrainConnections)].map(row => row.surfaceStyle)]) {
    for (const overlay of style?.overlays ?? []) seen.add(overlay.id)
  }
  for (const collection of ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const) for (const row of Object.values(doc.visual.base[collection])) seen.add(row.id)
  for (const boundary of Object.values(doc.visual.base.boundaries)) for (const row of boundary.segments) seen.add(row.id)
  const checkScope = (row: { id: string; floorId: string; layerId?: string }) => {
    if (!doc.floors[row.floorId]) fail('TERRAIN_FLOOR', '新记录Floor缺失。', row.id)
    if (row.layerId && (!doc.userLayers[row.layerId] || doc.userLayers[row.layerId].floorId !== row.floorId)) fail('TERRAIN_LAYER', '新记录所属图层缺失或跨Floor。', row.id)
  }
  const geometry = (ring: PointMm[], owner: string) => { if (!simplePolygon(ring)) fail('TERRAIN_POLYGON', '新记录多边形必须简单且非退化。', owner) }
  const checkRef = (ref: GenerationReference, floorId: string, owner: string, missingAllowed = false) => {
    const nested = ['terrainPoint', 'terrainSegment', 'scatterMember', 'surfaceOverlay'].includes(ref.kind)
    if (nested === (ref.parentId === null)) fail('TERRAIN_REFERENCE_PARENT', '内嵌引用须明确父ID，顶层引用父ID须为null。', owner)
    const target = resolveGenerationEntity(input, ref)
    if (!target) { if (!missingAllowed) fail('TERRAIN_REFERENCE', '生成目标引用缺失。', owner); return }
    const parent = ref.parentId ? doc.terrainAreas[ref.parentId] ?? doc.scatterGroups[ref.parentId] ?? doc.rooms[ref.parentId]
      ?? doc.walls[ref.parentId] ?? doc.paths[ref.parentId] ?? doc.terrainEdges[ref.parentId] ?? doc.terrainConnections[ref.parentId] : undefined
    const actualFloor = target.floorId ?? parent?.floorId
    if (actualFloor && actualFloor !== floorId) fail('TERRAIN_CROSS_FLOOR', '生成引用不能跨Floor。', owner)
  }
  let records = 0
  for (const name of ['recipes', 'intents', 'rules', 'ownership', 'exclusions', 'constraints', 'checks', 'sourceLinks'] as const) for (const [key, row] of Object.entries(doc.generation[name])) {
    register(key, row); records++
    if ('floorId' in row) checkScope(row)
  }
  if (records > TERRAIN_CONTRACT_LIMITS.records) fail('TERRAIN_RECORD_BUDGET', '生成记录总数超过8192项。')
  const strokeOperations=new Map<string,number[]>()
  if(doc.generation.version!==1)for(const [key,row] of Object.entries(doc.generation.strokes)){
    register(key,row);records++;checkScope(row)
    const indices=strokeOperations.get(row.operationId)??[];indices.push(row.strokeIndex);strokeOperations.set(row.operationId,indices)
    if(row.id!==`terrain-edit-${hashValue(row.operationId).slice(0,20)}-stroke-${row.strokeIndex}`)fail('TERRAIN_STROKE_ID','规范笔画身份必须绑定操作与笔画序号。',row.id)
    if(!equal(row.pointsMm,normalizeTerrainStroke(row.pointsMm)))fail('TERRAIN_STROKE_NORMALIZATION','规范笔画必须保持10mm量化且无重复或共线采样。',row.id)
    const area=doc.terrainAreas[row.targetAreaId]
    if(!area||area.floorId!==row.floorId)fail('TERRAIN_STROKE_TARGET','规范笔画目标地形缺失或跨Floor。',row.id)
    if(row.visibility==='public'&&area?.visibility==='gm')fail('TERRAIN_STROKE_VISIBILITY','私密目标的规范笔画不得公开。',row.id)
    const material=row.materialRef&&doc.materials[row.materialRef.id]
    if(row.materialRef&&(!material||material.version!==row.materialRef.version||!material.applicableSurfaces.includes('terrain'))||row.brush==='paintGrass'&&!row.materialRef)fail('TERRAIN_STROKE_MATERIAL','规范笔画固定地形材质缺失。',row.id)
    const contains=(point:PointMm,bounds:{x:number;y:number;width:number;height:number})=>point.x>=bounds.x&&point.y>=bounds.y&&point.x<=bounds.x+bounds.width&&point.y<=bounds.y+bounds.height
    try{
      const polygon=terrainStrokePolygon(row),floor=doc.floors[row.floorId]
      if(polygon.some(point=>!contains(point,row.scopeMm))||floor&&polygon.some(point=>!contains(point,floor.boundsMm)))fail('TERRAIN_STROKE_SCOPE','规范笔画完整笔刷范围越出冻结范围或Floor。',row.id)
    }catch{fail('TERRAIN_STROKE_GEOMETRY','规范笔画足迹无效。',row.id)}
  }
  if(doc.generation.version>=3)for(const [key,row]of Object.entries((doc.generation as GenerationSystem3|GenerationSystem4).surroundings)){
    register(key,row);records++;checkScope(row)
    if(row.id!==`terrain-edit-${hashValue(row.operationId).slice(0,20)}-surroundings`)fail('SURROUNDINGS_ID','外围操作身份必须绑定确切操作。',row.id)
    if(row.state==='current'){
      if(row.boundaryIds.some(id=>doc.visual.base.boundaries[id]?.floorId!==row.floorId))fail('SURROUNDINGS_BOUNDARY','外围轮廓缺失或跨Floor。',row.id)
      for(const preserved of row.preserved)if(surroundingsEntityHash(input,preserved.collection,preserved.entityId)!==preserved.contentHash)fail('SURROUNDINGS_PRESERVATION','外围保全内容与见证不一致。',preserved.entityId)
      if(surroundingsOutputHash(input,row)!==row.outputHash)fail('SURROUNDINGS_OUTPUT','外围操作的实际完整输出与记录不同。',row.id)
    }
  }
  if(doc.generation.version===4)for(const [key,row] of Object.entries(doc.generation.topology)){
    register(key,row); records++; checkScope(row)
    if(row.id!==`terrain-edit-${hashValue(row.request.operationId).slice(0,20)}-topology`)fail('TOPOLOGY_ID','拓扑操作身份必须绑定确切操作。',row.id)
    if(row.state==='current'){
      if(row.request.floorId!==row.floorId || row.outputAreaIds.some(id=>doc.terrainAreas[id]?.floorId!==row.floorId))fail('TOPOLOGY_OUTPUT','拓扑当前输出缺失或跨Floor。',row.id)
      if(!equal(row.inputs.map(input=>input.entityId),row.request.areaIds) || row.componentCount+row.holeCount!==row.outputAreaIds.length)fail('TOPOLOGY_INPUT','拓扑输入或分量回执不一致。',row.id)
      if(row.outputAreaIds.every(id=>!!doc.terrainAreas[id])) {
        if(hashValue(row.outputAreaIds.map(id=>doc.terrainAreas[id]))!==row.outputHash)fail('TOPOLOGY_HASH','拓扑完整输出与回执不同。',row.id)
        try {
          const expected=polygonBoolean({operation:row.request.operation,subject:row.inputs.map(input=>input.boundaryMm),clip:row.request.clip})
          const rings=expected.polygons.flatMap(polygon=>[polygon.outer,...polygon.holes.map(hole=>{const reversed=[...hole].reverse();const first=reversed.findIndex(point=>point.x===hole[0].x&&point.y===hole[0].y);return reversed.slice(first).concat(reversed.slice(0,first))})])
          if(expected.polygons.length!==row.componentCount || rings.length!==row.outputAreaIds.length || rings.some((ring,index)=>!equal(ring,doc.terrainAreas[row.outputAreaIds[index]].boundaryMm.map(point=>point.positionMm))))fail('TOPOLOGY_REPLAY','拓扑实际坐标与布尔输入不一致。',row.id)
        }catch {fail('TOPOLOGY_REPLAY','拓扑布尔回执无法完整核验。',row.id)}
      }
    }
  }
  for(const [operation,indices]of strokeOperations)if(indices.sort((a,b)=>a-b).some((value,index)=>value!==index))fail('TERRAIN_STROKE_OPERATION','同一操作笔画必须有唯一连续序号。',operation)
  if(records>TERRAIN_CONTRACT_LIMITS.records)fail('TERRAIN_RECORD_BUDGET','生成记录总数超过8192项。')
  for (const intent of Object.values(doc.generation.intents)) for (const node of intent.skeleton) register(node.id, node)
  for (const link of Object.values(doc.generation.sourceLinks)) for (const feature of link.inherited) register(feature.id, feature)
  for (const recipe of Object.values(doc.generation.recipes)) {
    if (recipe.mapMode !== doc.mapMode) fail('TERRAIN_RECIPE_MODE', '配方与地图模式不符。', recipe.id)
    for (const row of recipe.materials) if (doc.materials[row.ref.id]?.version !== row.ref.version) fail('TERRAIN_MATERIAL', '生成材质固定版本缺失。', recipe.id)
    for (const row of recipe.props) if (doc.propDefinitions[row.ref.id]?.version !== row.ref.version) fail('TERRAIN_DEFINITION', '生成物件固定版本缺失。', recipe.id)
  }
  for (const rule of Object.values(doc.generation.rules)) {
    for (const ref of rule.inputs) checkRef(ref, rule.floorId, rule.id, rule.state === 'detached')
    for (const ref of rule.outputs) {
      const owners = Object.values(doc.generation.ownership).filter(row => row.ruleId === rule.id && sameEntity(row.target, ref)
        && (row.state === 'deleted' || row.state === 'detached' || row.managedFields.includes(ref.fieldGroup) || row.manualFields.includes(ref.fieldGroup)))
      checkRef(ref, rule.floorId, rule.id, owners.some(row => row.state === 'deleted' || row.state === 'detached'))
      if (!owners.length && rule.state !== 'detached') fail('TERRAIN_OUTPUT_OWNERSHIP', '生成输出必须有明确所有权记录。', rule.id)
    }
    if (generationInputHash(input, rule) !== rule.inputHash) fail('TERRAIN_INPUT_HASH', '生成输入hash与已保存输入不符。', rule.id)
    if (managedOutputHash(input, rule) !== rule.managedOutputHash) fail('TERRAIN_OUTPUT_HASH', '生成受管输出hash与已保存结果不符。', rule.id)
  }
  for (const row of Object.values(doc.generation.ownership)) {
    const rule = doc.generation.rules[row.ruleId]
    if (!rule) continue
    if (!rule.outputs.some(ref => sameEntity(ref, row.target))) fail('TERRAIN_OWNERSHIP_TARGET', '所有权目标未列于规则输出。', row.id)
    if ((row.state === 'deleted' || row.state === 'detached') && row.managedFields.length) fail('TERRAIN_MANUAL_FIELDS', '已删除或退出目标不能仍有受管字段。', row.id)
    if (row.state === 'deleted' && resolveGenerationEntity(input, row.target)) fail('TERRAIN_DELETED_OUTPUT', '已删除所有权目标不能仍作为存活实体存在。', row.id)
    if (row.state === 'managed' && row.manualFields.length) fail('TERRAIN_MANUAL_STATE', '已有人工字段的输出须明确标记manual。', row.id)
  }
  const managed = new Set<string>()
  for (const row of Object.values(doc.generation.ownership)) for (const field of row.managedFields) {
    const key = canonicalJson([entityKey(row.target), field])
    if (managed.has(key)) fail('TERRAIN_MULTIPLE_WRITERS', '同一目标字段组不得存在多个受管所有权。', row.id)
    managed.add(key)
  }
  for (const row of Object.values(doc.generation.exclusions)) geometry(row.boundaryMm, row.id)
  for (const row of Object.values(doc.generation.constraints)) {
    if ('boundaryMm' in row) geometry(row.boundaryMm, row.id)
    if ('target' in row) checkRef(row.target, row.floorId, row.id)
  }
  for (const row of Object.values(doc.generation.checks)) {
    if (row.state === 'unchecked') continue
    if (row.inputHash !== constraintInputHash(input, row.constraintId)) fail('TERRAIN_CHECK_STALE', '已检查约束所依据的输入已变化。', row.id)
    // Public hashes prove consistency, not that a route was physically checked.
    // Recheck known saved algorithms on cold reads; never run generation/search.
    if (row.algorithmVersion === 1 && (row.algorithmId === 'terrain-route' || row.algorithmId === 'terrain-route-ground')) {
      const constraint = doc.generation.constraints[row.constraintId]
      if (constraint?.kind !== 'route') { fail('TERRAIN_ROUTE_RECEIPT', '路线检查器必须对应真实路线约束。', row.id); continue }
      const checked = checkTerrainRoute(input, { floorId: constraint.floorId, pointsMm: constraint.pointsMm, widthMm: constraint.minWidthMm })
      const passed = checked.ok && (row.algorithmId !== 'terrain-route-ground' || !checked.supportRefs.some(ref => ref.id === 'terrain-shallow'))
      if ((row.state === 'passed') !== passed) fail('TERRAIN_ROUTE_RECEIPT', '已存路线回执与当前完整净宽、障碍、高差或渡水方式不一致。', row.id)
    }
  }
  let edgePoints = 0
  for (const [key, edge] of Object.entries(doc.visual.materializedEdges)) {
    register(key, edge); checkScope(edge)
    const source = doc.visual.base.boundaries[edge.boundaryId]
    if (!source || source.floorId !== edge.floorId || materializedBoundaryHash(source) !== edge.inputHash) fail('TERRAIN_EDGE_SOURCE', '物化边缘来源缺失、跨Floor或源hash已变化；须预览重生成或明确退出。', edge.id)
    if (edge.visibility === 'public' && source?.visibility === 'gm') fail('TERRAIN_EDGE_VISIBILITY', '私密曲线的物化边缘不得公开。', edge.id)
    if (Object.values(doc.visual.base.edgeLooks).some(look => look.enabled && look.boundaryId === edge.boundaryId && look.kind === edge.kind)) {
      fail('TERRAIN_EDGE_DUPLICATE', '同一曲线用途不能同时启用旧边带与物化边缘，请在同一候选中明确替换。', edge.id)
    }
    if (edge.materialRef && doc.materials[edge.materialRef.id]?.version !== edge.materialRef.version) fail('TERRAIN_EDGE_MATERIAL', '物化边缘材质固定版本缺失。', edge.id)
    for (const ring of edge.polygons) { geometry(ring, edge.id); edgePoints += ring.length }
    for (const stroke of edge.strokes) { register(stroke.id, stroke); edgePoints += stroke.pointsMm.length }
  }
  if (edgePoints > TERRAIN_CONTRACT_LIMITS.edgePoints) fail('TERRAIN_EDGE_BUDGET', '工程物化边缘几何合计超过8192点。')
  if (doc.regional) {
    const region = doc.regional
    register(region.profile.id, region.profile)
    for (const collection of [region.areas, region.lines, region.landmarks, region.symbols, region.symbolDefinitions]) for (const [key, row] of Object.entries(collection)) {
      register(key, row); if ('floorId' in row) checkScope(row)
    }
    for (const row of Object.values(region.areas)) geometry(row.boundaryMm, row.id)
    const symbolDefinition = (ref: { id: string; version: number }, owner: string) => { if (region.symbolDefinitions[ref.id]?.version !== ref.version) fail('REGIONAL_DEFINITION', '区域图符固定定义缺失。', owner) }
    for (const row of Object.values(region.symbolDefinitions)) if (!doc.assets[row.assetId]) fail('REGIONAL_ASSET', '区域图符真实资源缺失。', row.id)
    for (const row of Object.values(region.landmarks)) {
      symbolDefinition(row.definitionRef, row.id)
      if (row.areaId && (!region.areas[row.areaId] || region.areas[row.areaId].floorId !== row.floorId)) fail('REGIONAL_AREA', '地标地貌引用缺失或跨Floor。', row.id)
    }
    for (const row of Object.values(region.symbols)) {
      symbolDefinition(row.definitionRef, row.id)
      const source = row.sourceRef && ({ area: region.areas, line: region.lines, landmark: region.landmarks }[row.sourceRef.kind][row.sourceRef.id])
      if (row.sourceRef && (!source || source.floorId !== row.floorId)) fail('REGIONAL_SOURCE', '区域图符来源缺失或跨Floor。', row.id)
    }
    for (const row of Object.values(region.lines)) {
      for (const point of row.pointsMm) register(point.id, point)
      for (const other of row.connectedLineIds) if (!region.lines[other] || region.lines[other].floorId !== row.floorId) fail('REGIONAL_LINE', '区域线网引用缺失或跨Floor。', row.id)
      for (const portId of row.portIds) {
        const port = doc.generation.constraints[portId]
        if (port?.kind !== 'port' || port.floorId !== row.floorId) fail('REGIONAL_PORT', '区域端口引用必须指向同Floor明确端口约束。', row.id)
      }
    }
  }
  return issues
}

/** Ordinary manual edits preserve results and explicitly stop affected generation; never rebuild geometry. */
export type GenerationAppearanceChange = Omit<GenerationReference, 'fieldGroup'> & { fieldGroup: 'appearance' | 'surface' | 'source' }
export function detachChangedOutputs(beforeInput: SceneDocument, nextInput: SceneDocument, appearanceChanges: readonly GenerationAppearanceChange[] = []): number {
  if (![3, 4].includes(beforeInput.schemaVersion) || ![3, 4].includes(nextInput.schemaVersion)) return 0
  const before = terrain(beforeInput), originalGeneration = getLegacyGeneration(nextInput)!
  // Write the owned legacy partition into the real candidate, never save the compatibility view.
  const replaceGeneration = (generation: GenerationSystem1) => {
    if (nextInput.generation?.version === 5) nextInput.generation.legacy = generation
    else nextInput.generation = generation
  }
  replaceGeneration(cloneJson(originalGeneration))
  const next = terrain(nextInput)
  let cost = 0, changed = false
  if(next.generation.version>=3&&canonicalJson(beforeInput)!==canonicalJson(nextInput))for(const row of Object.values((next.generation as GenerationSystem3|GenerationSystem4).surroundings))if(row.state==='current'){row.state='historical';cost++;changed=true}
  if(next.generation.version===4&&canonicalJson(beforeInput)!==canonicalJson(nextInput))for(const row of Object.values(next.generation.topology))if(row.state==='current'){row.state='historical';cost++;changed=true}
  const assertRuleUnlocked = (ruleId: string) => {
    const rule = before.generation.rules[ruleId]
    if (rule && (rule.editLocked || before.userLayers[rule.layerId]?.editLocked)) throw new Error(`生成规则或其图层已锁定，不能隐式改写人工记录：${ruleId}。`)
  }
  for (const row of Object.values(next.generation.ownership)) {
    const prior = before.generation.ownership[row.id]
    if (!prior || row.state === 'detached') continue
    const previousEntity = resolveGenerationEntity(beforeInput, row.target), nextEntity = resolveGenerationEntity(nextInput, row.target)
    if (row.state === 'deleted') {
      // Explicit historical recreation is an independent manual result, never
      // implicit permission to restore generation ownership or rule activity.
      if (nextEntity) { assertRuleUnlocked(row.ruleId); row.state = 'manual'; cost++; changed = true }
      continue
    }
    // Only trusted appearance callers supply these references. Geometry is
    // always compared against real persisted results after materialization.
    const touched = row.managedFields.filter(fieldGroup => !equal(resolveGenerationTarget(beforeInput, { ...row.target, fieldGroup }), resolveGenerationTarget(nextInput, { ...row.target, fieldGroup }))
      || appearanceChanges.some(ref => ['appearance', 'surface', 'source'].includes(ref.fieldGroup) && ref.fieldGroup === fieldGroup && sameEntity(ref, row.target)))
    if (!touched.length && !(previousEntity && !nextEntity)) continue
    assertRuleUnlocked(row.ruleId)
    row.state = nextEntity ? 'manual' : 'deleted'
    row.manualFields = [...new Set([...row.manualFields, ...touched])]
    row.managedFields = row.managedFields.filter(field => !touched.includes(field))
    if (row.state === 'deleted') {
      row.managedFields = []
      if(row.target.kind==='prop'&&before.props[row.target.entityId]){
        const prop=before.props[row.target.entityId],angle=prop.rotationDeg*Math.PI/180,offset=prop.footprintOffsetMm,w=prop.footprintMm.width/2,h=prop.footprintMm.height/2
        const ring=[{x:offset.x-w,y:offset.y-h},{x:offset.x+w,y:offset.y-h},{x:offset.x+w,y:offset.y+h},{x:offset.x-w,y:offset.y+h}].map(p=>({x:Math.round(prop.positionMm.x+p.x*Math.cos(angle)-p.y*Math.sin(angle)),y:Math.round(prop.positionMm.y+p.x*Math.sin(angle)+p.y*Math.cos(angle))}))
        const id=`terrain-delete-${hashValue(row.outputKey).slice(0,24)}`
        if(!next.generation.exclusions[id]){next.generation.exclusions[id]={id,key:row.outputKey,floorId:prop.floorId,visibility:prop.visibility,boundaryMm:ring,reason:'delete',candidateKey:row.outputKey,birthToken:row.birthToken};cost++}
      }
    }
    cost++; changed = true
  }
  for (const rule of Object.values(next.generation.rules)) {
    const inputHash = generationInputHash(nextInput, rule), outputHash = managedOutputHash(nextInput, rule)
    if (rule.inputHash !== inputHash || rule.managedOutputHash !== outputHash) {
      assertRuleUnlocked(rule.id)
      rule.inputHash = inputHash; rule.managedOutputHash = outputHash
      if (rule.state === 'active') rule.state = 'paused'
      cost++; changed = true
    }
  }
  for (const check of Object.values(next.generation.checks)) if (check.state !== 'unchecked'
    && (changed || check.inputHash !== constraintInputHash(nextInput, check.constraintId))) { check.state = 'unchecked'; cost++ }
  if (!cost) replaceGeneration(originalGeneration)
  return cost
}
