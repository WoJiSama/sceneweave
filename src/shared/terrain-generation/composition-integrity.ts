import { z } from 'zod'
import type { BoundsMm, Issue, PointMm, Prop, SceneDocument } from '../model/scene.js'
import type { HistoryIdentity } from '../model/history.js'
import { canonicalJson, encodeUtf8 } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { propFootprint } from '../geometry/geometry.js'
import { sceneDocumentSchema } from '../validation/scene.js'
import { visualBoundarySchema, visualEdgeLookSchema } from '../visual/schema.js'
import { generationReferenceV5Schema, legacyTerrainView, type GenerationSystem5, type TerrainComposition, type TerrainDependency,
  type TerrainFeature, type TerrainIdentityToken, type TerrainRequirement, type TerrainThreshold } from './composition-contracts.js'
import { materializedEdgeSchema, regionalAreaSchema, regionalLineSchema, regionalLandmarkSchema, regionalSymbolSchema, TERRAIN_CONTRACT_LIMITS, type GenerationReference } from './contracts.js'
import { resolveGenerationEntity, resolveGenerationTarget } from './integrity.js'
import { recomputeCompositionThreshold } from './composition-field.js'
import { evaluateTerrainRequirement } from './composition-requirements.js'
import { validateTerrainTransitions as validateTransitionRows } from '../visual/transition.js'

export { legacyTerrainView, getLegacyGeneration, getLegacyVisual } from './composition-contracts.js'
export type TerrainCompositionReference = z.infer<typeof generationReferenceV5Schema>
const hash = (value: unknown): string => sha256Text(canonicalJson(value))
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const refKey = (ref: TerrainCompositionReference) => canonicalJson(ref)
const nested = new Set(['terrainPoint', 'terrainSegment', 'scatterMember', 'surfaceOverlay'])
const building = new Set(['vertex', 'room', 'wall', 'opening', 'note', 'prefabInstance'])
const fields = {
  geometry: ['boundaryMm', 'centerlineMm', 'positionMm', 'rotationDeg', 'footprintMm', 'footprintOffsetMm', 'widthMm', 'from', 'to', 'segments', 'closed', 'pointsMm', 'polygons', 'strokes', 'visualBoundsMm', 'groundElevationMm', 'side', 'sampleSpacingMm', 'toleranceMm'],
  properties: ['floorId', 'layerId', 'visibility', 'editLocked', 'blocksMovement', 'blocksSight', 'movementCostMultiplier', 'kind', 'coveragePriority', 'name', 'description', 'purpose', 'relativeElevationMm', 'flow', 'displayWidthMm', 'actualWidthMm', 'shoreline', 'enabled', 'openingId'],
  surface: ['surfaceStyle', 'floorStyle', 'topStyle', 'style', 'paint', 'blendWidthMm', 'materialRef', 'fillColor', 'opacity'],
  appearance: ['appearance', 'definitionRef', 'visualBoundsMm', 'shadowClass', 'shadowOverride', 'renderLayer', 'renderOrder', 'color', 'accentColor', 'opacity', 'intensity', 'seed', 'repeatMm', 'enabled', 'fillColor'],
  membership: ['members', 'domain', 'palette', 'portIds', 'connectedLineIds', 'areaId', 'managementKey'], exclusions: ['exclusions'],
  presentation: ['rootAnchorMm', 'orientation', 'groundShadowMm', 'fixedRotationDeg', 'footprintAxes'],
  source: ['source', 'neighborAreaId', 'binding', 'boundaryId', 'inputHash', 'materialRef', 'definitionRef', 'sourceRef', 'supportRef', 'supportRefs', 'roomId', 'algorithmVersion', 'gridOriginMm', 'cellSizeMm', 'densityFactor', 'minDistanceMm', 'rotationRangeDeg'],
} as const
const nativeCollection = { vertex: 'vertices', room: 'rooms', wall: 'walls', opening: 'openings', note: 'notes', prefabInstance: 'prefabInstances' } as const
const v5 = (scene: SceneDocument): GenerationSystem5 => { if (scene.schemaVersion !== 4 || scene.generation?.version !== 5) throw new Error('组合合同需要严格scene4/generation5。'); return scene.generation }
const inBounds = (point: PointMm, bounds: BoundsMm) => point.x >= bounds.x && point.y >= bounds.y && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height
const contains = (outer: BoundsMm, inner: BoundsMm) => inBounds(inner, outer) && inBounds({ x: inner.x + inner.width, y: inner.y + inner.height }, outer)

export function resolveCompositionEntity(scene: SceneDocument, ref: TerrainCompositionReference): Record<string, unknown> | null {
  if (building.has(ref.kind)) {
    const row = scene[nativeCollection[ref.kind as keyof typeof nativeCollection]][ref.entityId]
    return row ? { ...row } : null
  }
  return resolveGenerationEntity(legacyTerrainView(scene), ref as GenerationReference)
}
export function resolveCompositionTarget(scene: SceneDocument, ref: TerrainCompositionReference): Record<string, unknown> | null {
  return building.has(ref.kind) ? resolveCompositionEntity(scene, ref) : resolveGenerationTarget(legacyTerrainView(scene), ref as GenerationReference)
}

/** Strict native snapshot projection. Baselines are validated without substituting adopted output. */
function snapshotSchema(ref: TerrainCompositionReference): z.ZodType {
  const shape = sceneDocumentSchema.shape
  if (building.has(ref.kind)) return shape[nativeCollection[ref.kind as keyof typeof nativeCollection]].valueType
  const schema = ({ terrainArea: shape.terrainAreas.valueType, terrainEdge: shape.terrainEdges.valueType, terrainConnection: shape.terrainConnections.valueType,
    path: shape.paths.valueType, prop: shape.props.valueType, scatterGroup: shape.scatterGroups.valueType,
    visualBoundary: visualBoundarySchema, visualEdgeLook: visualEdgeLookSchema, materializedEdge: materializedEdgeSchema,
    regionalArea: regionalAreaSchema, regionalLine: regionalLineSchema, regionalLandmark: regionalLandmarkSchema, regionalSymbol: regionalSymbolSchema,
    terrainPoint: z.object({ positionMm: shape.terrainAreas.valueType.shape.boundaryMm.element.shape.positionMm }).strict(),
    terrainSegment: z.object({ pointsMm: z.array(shape.terrainAreas.valueType.shape.boundaryMm.element.shape.positionMm).length(2) }).strict(),
    scatterMember: z.object({ members: shape.scatterGroups.valueType.shape.members.valueType }).strict(),
    surfaceOverlay: shape.rooms.valueType.shape.floorStyle.unwrap().shape.overlays.element,
  } as Record<string, z.ZodObject>)[ref.kind]
  if (!schema) throw new Error('不支持的原生快照类型。')
  const targetShape:Record<string,z.ZodType> = { ...schema.shape, ...('floorId' in schema.shape ? { layerId: z.string().min(1).max(256).nullable() } : {}) }
  const selected = Object.fromEntries(fields[ref.fieldGroup].filter(key => Object.hasOwn(targetShape, key)).map(key => [key, targetShape[key]]))
  if (!Object.keys(selected).length) throw new Error('该实体不支持空字段组快照。')
  return z.object(selected).strict()
}

function fixedResources(scene: SceneDocument, values: unknown[]): unknown {
  const materials = new Set<string>(), definitions = new Set<string>(), assets = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const row = value as Record<string, unknown>
    for (const [key, item] of Object.entries(row)) {
      if (key === 'materialRef' && item && typeof item === 'object' && 'id' in item) materials.add(String(item.id))
      if ((key === 'definitionRef' || key === 'propDefinitionRef') && item && typeof item === 'object' && 'id' in item) definitions.add(String(item.id))
      if ((key === 'assetId' || key === 'textureAssetId') && typeof item === 'string') assets.add(item)
      visit(item)
    }
  }
  values.forEach(visit)
  for (const value of values) if (value && typeof value === 'object' && 'materials' in value && 'props' in value) {
    const recipe = value as { materials: { ref: { id: string } }[]; props: { ref: { id: string } }[] }
    recipe.materials.forEach(row => materials.add(row.ref.id)); recipe.props.forEach(row => definitions.add(row.ref.id))
  }
  for (const id of materials) visit(scene.materials[id])
  for (const id of definitions) visit(scene.propDefinitions[id])
  return { materials: [...materials].sort().map(id => [id, scene.materials[id] ?? null]), definitions: [...definitions].sort().map(id => [id, scene.propDefinitions[id] ?? null]), assets: [...assets].sort().map(id => [id, scene.assets[id] ?? null]) }
}
function snapshotResourceIssues(scene: SceneDocument, snapshot: unknown): string[] {
  const issues: string[] = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'materialRef' || key === 'definitionRef' || key === 'propDefinitionRef') && item && typeof item === 'object') {
        const ref = item as {id:string;version:number}
        const definitions = key === 'materialRef' ? [scene.materials] : key === 'propDefinitionRef' ? [scene.propDefinitions] : [scene.propDefinitions,scene.prefabDefinitions,scene.regional?.symbolDefinitions??{}]
        if (!definitions.some(collection=>collection[ref.id]?.version===ref.version)) issues.push(`依赖快照固定版本不存在：${ref.id}。`)
      }
      if ((key === 'assetId' || key === 'textureAssetId') && typeof item === 'string' && !scene.assets[item]) issues.push(`依赖快照资源不存在：${item}。`)
      visit(item)
    }
  }
  visit(snapshot); return issues
}
export function thresholdInputHash(row: TerrainThreshold): string { return hash({ field: row.field, targetCoveragePpm: row.targetCoveragePpm, grid: row.grid, sourceInput: row.sourceInput }) }
export function dependencyInputHash(scene: SceneDocument, row: TerrainDependency): string {
  const generation = v5(scene), { inputHash: _hash, ...input } = row
  const features = row.featureIds.map(id => generation.features[id] ?? null), thresholds = row.thresholdIds.map(id => generation.thresholds[id] ?? null)
  // A local v4 dependency can read materialized transitions.  Their complete
  // source/geometry records are part of the frozen input; hashing only the
  // transition IDs lets an edited boundary slip past the dependency CAS.
  const transitions = row.transitionIds.map(id => scene.visual?.version === 3 ? scene.visual.transitions[id] ?? null : null)
  return hash({ ...input, features, thresholds, transitions, resources: fixedResources(scene, [features, thresholds, transitions, row.reads.map(read => read.snapshot)]) })
}
export function compositionInputHash(scene: SceneDocument, row: TerrainComposition): string {
  const generation = v5(scene), recipe = generation.legacy.recipes[row.recipeRef.id] ?? null
  const features = row.members.map(member => generation.features[member.featureId] ?? null), thresholds = row.thresholdIds.map(id => generation.thresholds[id] ?? null)
  const requirements = row.requirementIds.map(id => generation.requirements[id] ?? null), dependencies = Object.values(generation.dependencies).filter(dependency => dependency.compositionId === row.id).sort((a,b) => a.id < b.id ? -1 : 1)
  return hash({ algorithmId: row.algorithmId, algorithmVersion: row.algorithmVersion, seed: row.seed, recipe, boundsMm: row.boundsMm, precision: row.precision,
    baseElevationMm: row.baseElevationMm, members: row.members, features, thresholds, requirements, dependencies, resources: fixedResources(scene, [recipe, features, thresholds, dependencies.flatMap(row => row.reads.map(read => read.snapshot))]) })
}
export function terrainRequirementInputHash(scene: SceneDocument, row: TerrainRequirement): string {
  const generation = v5(scene)
  const composition = generation.compositions[row.compositionId]
  return hash({ algorithmId: 'terrain-requirement', algorithmVersion: 1, requirement: row, composition: composition ? {boundsMm:composition.boundsMm,floorId:composition.floorId,recipe:generation.legacy.recipes[composition.recipeRef.id]??null} : null,
    legacyConstraint: row.kind === 'legacyConstraint' ? generation.legacy.constraints[row.constraintId] ?? null : null,
    terrainAreas: scene.terrainAreas, terrainEdges: scene.terrainEdges, terrainConnections: scene.terrainConnections, paths: scene.paths, props: scene.props,
    regions: scene.regions, rooms: scene.rooms, vertices: scene.vertices, walls: scene.walls, openings: scene.openings, materials: scene.materials })
}
export function compositionOutputHash(scene: SceneDocument, row: TerrainComposition, identity?: HistoryIdentity): string {
  const generation = v5(scene), targets = new Set(row.outputRefs.flatMap(ref => [ref.entityId, ...(ref.parentId ? [ref.parentId] : [])]))
  const ownership = Object.values(generation.legacy.ownership).filter(record => targets.has(record.target.entityId))
  const transitionIds = Object.values(generation.dependencies).filter(record => record.compositionId === row.id).flatMap(record => record.transitionIds)
  const identityIds = new Set<string>()
  const collect = (value: unknown) => { if (!value || typeof value !== 'object') return; if (!Array.isArray(value)) { const row = value as Record<string, unknown>; if (typeof row.id === 'string') identityIds.add(row.id); if (typeof row.segmentId === 'string') identityIds.add(row.segmentId) }; Object.values(value).forEach(collect) }
  row.outputRefs.forEach(ref => { identityIds.add(ref.entityId); collect(resolveCompositionEntity(scene, ref)) })
  ownership.forEach(collect)
  identityIds.add(row.id)
  row.members.forEach(member=>identityIds.add(member.featureId))
  row.thresholdIds.forEach(id=>identityIds.add(id));row.requirementIds.forEach(id=>identityIds.add(id))
  Object.values(generation.checks).filter(check=>row.requirementIds.includes(check.requirementId)).forEach(check=>identityIds.add(check.id))
  Object.values(generation.dependencies).filter(dependency=>dependency.compositionId===row.id).forEach(dependency=>identityIds.add(dependency.id))
  transitionIds.forEach(id=>{identityIds.add(id);if(scene.visual?.version===3)collect(scene.visual.transitions[id])})
  const tokens = identity ? Object.fromEntries(['propTokens', 'prefabTokens', 'outdoorTokens', 'generationTokens', 'regionalTokens', 'presentationTokens', 'terrainTokens'].map(field => [field,
    Object.fromEntries(Object.entries(identity[field as keyof HistoryIdentity] as Record<string, unknown> ?? {}).filter(([id]) => identityIds.has(id)).sort(([a],[b]) => a < b ? -1 : 1))])) : null
  return hash({ outputs: row.outputRefs.map(ref => ({ ref, value: resolveCompositionTarget(scene, ref) })), ownership,
    manualAndDeleted: [...targets].sort().map(id => ({ id, scatter: scene.scatterGroups[id] ?? null })),
    transitions: transitionIds.map(id => { const transition = scene.visual?.version === 3 ? scene.visual.transitions[id] : undefined; return transition ? { id, polygons: transition.polygons, strokes: transition.strokes } : null }), tokens })
}

/** Validate every persisted T10 source/result without repairing declarations. */
export function validateTerrainTransitions(scene: Readonly<SceneDocument>): Issue[] { return validateTransitionRows(scene) }

export interface TerrainIdentityDescriptor { kind: TerrainIdentityToken['kind']; topologyHash: string }
export function terrainIdentityDescriptors(scene: Readonly<SceneDocument>): Record<string, TerrainIdentityDescriptor> {
  if (scene.schemaVersion !== 4 || scene.generation?.version !== 5) return {}
  const generation = scene.generation, result: Record<string, TerrainIdentityDescriptor> = {}
  const add = (id: string, kind: TerrainIdentityToken['kind'], floorId: string | null, parentIds: unknown[], orderedChildIds: unknown[], geometryStructure: unknown) => {
    if (Object.hasOwn(result,id)) throw new Error(`组合身份重复：${id}。`)
    result[id] = { kind, topologyHash: hash({ kind, floorId, parentIds, orderedChildIds, geometryStructure }) }
  }
  for (const feature of Object.values(generation.features)) add(feature.id, 'terrainFeature', feature.floorId, Object.values(generation.compositions).filter(row => row.members.some(member => member.featureId === feature.id)).map(row => row.id).sort(), [], feature.shape)
  for (const row of Object.values(generation.compositions)) add(row.id, 'terrainComposition', row.floorId, [], [...row.members.map(member => [member.featureId,member.field]), ...row.outputRefs], { boundsMm: row.boundsMm })
  for (const row of Object.values(generation.requirements)) add(row.id,'terrainRequirement',generation.compositions[row.compositionId]?.floorId??null,[row.compositionId],row.kind==='legacyConstraint'?[row.constraintId]:[],row.kind==='channelWidth'?{kind:row.kind,pointsMm:row.pointsMm}: {kind:row.kind})
  for (const row of Object.values(generation.checks)) add(row.id,'terrainCheck',generation.compositions[generation.requirements[row.requirementId]?.compositionId]?.floorId??null,[row.requirementId],[],null)
  for (const row of Object.values(generation.thresholds)) add(row.id,'terrainThreshold',generation.compositions[row.compositionId]?.floorId??null,[row.compositionId],row.sourceInput.members.map(member=>[member.featureId,member.field]),{grid:row.grid,boundsMm:row.sourceInput.boundsMm,features:Object.fromEntries(Object.entries(row.sourceInput.features).map(([id,row])=>[id,row.shape]))})
  for (const row of Object.values(generation.dependencies)) add(row.id,'terrainDependency',generation.compositions[row.compositionId]?.floorId??null,[row.compositionId],[...row.reads.map(read=>read.target),...row.writes,...row.transitionIds],{scopeMm:row.scopeMm,haloMm:row.haloMm})
  if(scene.visual?.version===3)for(const row of Object.values(scene.visual.transitions)) {
    add(row.id,'terrainTransition',row.floorId,[row.boundaryId],[...row.polygons.map(row=>row.id),...row.strokes.map(row=>row.id)],{clipMm:row.distanceSource.clipMm})
    for(const polygon of row.polygons)add(polygon.id,'terrainTransitionPolygon',row.floorId,[row.id],[],polygon.pointsMm)
    for(const stroke of row.strokes)add(stroke.id,'terrainTransitionStroke',row.floorId,[row.id],[],stroke.pointsMm)
  }
  return result
}

/** Called after strict shape parsing. It never repairs hashes, geometry or saved receipts. */
export function validateCompositionContracts(scene: SceneDocument): Issue[] {
  if (scene.schemaVersion !== 4) return []
  const generation = v5(scene), issues: Issue[] = [], fail = (code: string, message: string, entityId?: string) => issues.push({ code, message, ...(entityId ? {entityId} : {}) })
  if(scene.visual?.version!==3)return [{code:'COMPOSITION_VERSION',message:'scene4必须使用visual3。'}]
  issues.push(...validateTerrainTransitions(scene))
  const collections = ['features','compositions','requirements','checks','thresholds','dependencies'] as const
  if(scene.mapMode==='regional'&&collections.some(key=>Object.keys(generation[key]).length))fail('COMPOSITION_REGIONAL','区域模式不接受物理地貌组合记录。')
  if(encodeUtf8(canonicalJson(generation)).length>TERRAIN_CONTRACT_LIMITS.normalizedBytes)fail('COMPOSITION_BYTE_BUDGET','完整生成分区超过4MiB。')
  const usedIds=geometryIdentityIds(legacyTerrainView(scene));for(const id of Object.keys(scene.userLayers))usedIds.add(id)
  let records=0
  const count=(value:unknown):void=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){records+=value.length;value.forEach(count)}else{for(const item of Object.values(value))count(item)}}
  count(generation.legacy)
  for(const key of collections)for(const row of Object.values(generation[key])){records++;if(usedIds.has(row.id))fail('COMPOSITION_ID','新记录ID与现有实体、定义、图层或其他记录冲突。',row.id);usedIds.add(row.id);count(row)}
  if(records>8192)fail('COMPOSITION_RELATION_BUDGET','生成记录与关系合计超过8192项。')
  const scope=(row:{id:string;floorId:string;layerId:string})=>{if(!scene.floors[row.floorId]||scene.userLayers[row.layerId]?.floorId!==row.floorId)fail('COMPOSITION_SCOPE','新记录必须引用同Floor现存用户图层。',row.id)}
  const allowed:Record<TerrainFeature['kind'],string[]>={landmass:['land'],lakeBasin:['land'],riverValley:['land','elevation'],ridge:['elevation'],forest:['vegetation'],clearing:['vegetation'],plateau:['elevation']}
  for(const feature of Object.values(generation.features)){
    scope(feature)
    const expected=['riverValley','ridge'].includes(feature.kind)?'corridor':'ellipse'
    if(feature.shape.kind!==expected)fail('COMPOSITION_FEATURE_SHAPE','特征类型与shape分支不匹配。',feature.id)
    const points=feature.shape.kind==='ellipse'?[feature.shape.centerMm]:feature.shape.pointsMm
    if(points.some(point=>!inBounds(point,scene.exportBoundsMm)))fail('COMPOSITION_FEATURE_BOUNDS','特征控制点越出场景范围。',feature.id)
    if(!Object.values(generation.compositions).some(row=>row.members.some(member=>member.featureId===feature.id)))fail('COMPOSITION_FEATURE_OWNER','特征至少须属于一个组合。',feature.id)
  }
  const writers=new Map<string,string>(), links=new Map<string,Set<string>>()
  for(const rule of Object.values(generation.legacy.rules))if(rule.state!=='detached')for(const ref of rule.outputs)writers.set(refKey(ref),rule.id)
  for(const row of Object.values(generation.compositions)){
    scope(row);links.set(row.id,new Set())
    if(!contains(scene.exportBoundsMm,row.boundsMm)||!contains(scene.floors[row.floorId]?.boundsMm??scene.exportBoundsMm,row.boundsMm))fail('COMPOSITION_BOUNDS','组合范围必须位于场景及Floor内。',row.id)
    const recipe=generation.legacy.recipes[row.recipeRef.id]
    if(!recipe||recipe.recipeVersion!==row.recipeRef.version||recipe.mapMode!=='scene')fail('COMPOSITION_RECIPE','组合固定配方不存在或版本/模式不符。',row.id)
    for(const member of row.members){const feature=generation.features[member.featureId];if(!feature)continue;if(feature.floorId!==row.floorId||!allowed[feature.kind].includes(member.field))fail('COMPOSITION_MEMBER','组合成员跨Floor或特征字段不匹配。',row.id);if(row.visibility==='public'&&feature.visibility==='gm')fail('COMPOSITION_VISIBILITY','公开组合不得读取GM特征。',row.id)}
    if(row.state==='active'&&!row.outputRefs.length)fail('COMPOSITION_OUTPUT','活动组合必须具有物化输出。',row.id)
    for(const ref of row.outputRefs){checkRef(ref,row,true);if(row.state==='active'){const key=refKey(ref);if(writers.has(key))fail('COMPOSITION_WRITER','同一字段组只能有一个活动写者。',row.id);writers.set(key,row.id)}}
    if(row.state==='active'&&compositionInputHash(scene,row)!==row.inputHash)fail('COMPOSITION_INPUT_HASH','组合冻结输入hash与完整来源不符。',row.id)
    if(row.state==='active'&&!Object.values(generation.dependencies).some(dep=>dep.compositionId===row.id))fail('COMPOSITION_DEPENDENCY','活动组合缺少完整依赖记录。',row.id)
    for(const id of row.thresholdIds)if(generation.thresholds[id]?.compositionId!==row.id)fail('COMPOSITION_THRESHOLD_OWNER','阈值不属于本组合。',row.id)
    for(const id of row.requirementIds)if(generation.requirements[id]?.compositionId!==row.id)fail('COMPOSITION_REQUIREMENT_OWNER','要求不属于本组合。',row.id)
  }
  function checkRef(ref:TerrainCompositionReference,owner:TerrainComposition,write:boolean,role?:'preserve'|'baseline'):void{
    if(nested.has(ref.kind)===(ref.parentId===null))fail('COMPOSITION_REFERENCE_PARENT','引用parentId与原生父子关系不符。',owner.id)
    if(building.has(ref.kind)&&(write||role!=='preserve'||ref.fieldGroup!=='geometry'))fail('COMPOSITION_BUILDING_READ_ONLY','建筑引用只支持preserve完整geometry快照。',owner.id)
    const target=resolveCompositionEntity(scene,ref),value=resolveCompositionTarget(scene,ref)
    if(!target||!value||!Object.keys(value).length){if(owner.state==='active')fail('COMPOSITION_REFERENCE','活动组合目标不存在或字段组不受支持。',owner.id);return}
    const parent=ref.parentId?scene.terrainAreas[ref.parentId]??scene.scatterGroups[ref.parentId]??scene.rooms[ref.parentId]??scene.walls[ref.parentId]??scene.paths[ref.parentId]??scene.terrainEdges[ref.parentId]??scene.terrainConnections[ref.parentId]:undefined
    if((target.floorId??parent?.floorId)!==undefined&&(target.floorId??parent?.floorId)!==owner.floorId)fail('COMPOSITION_REFERENCE_FLOOR','组合引用不能跨Floor。',owner.id)
    if(owner.visibility==='public'&&(target.visibility??parent?.visibility)==='gm')fail('COMPOSITION_VISIBILITY','公开组合不得引用GM来源。',owner.id)
  }
  for(const row of Object.values(generation.thresholds)){
    const owner=generation.compositions[row.compositionId]
    if(!owner||!owner.thresholdIds.includes(row.id)){fail('COMPOSITION_THRESHOLD_OWNER','阈值必须由所属组合引用。',row.id);continue}
    const g=row.grid,b=row.sourceInput.boundsMm
    if(g.originMm.x>b.x||g.originMm.y>b.y||g.originMm.x+(g.columns-1)*g.spacingMm<b.x+b.width||g.originMm.y+(g.rows-1)*g.spacingMm<b.y+b.height)fail('COMPOSITION_THRESHOLD_GRID','阈值网格没有完整覆盖冻结来源范围。',row.id)
    if(row.inputHash!==thresholdInputHash(row))fail('COMPOSITION_THRESHOLD_HASH','阈值冻结输入hash不符。',row.id)
    try{if(recomputeCompositionThreshold(row.sourceInput,row.field,row.targetCoveragePpm,row.grid)!==row.valueQ)fail('COMPOSITION_THRESHOLD_VALUE','阈值valueQ与冻结完整来源复算不符。',row.id)}catch(error){fail('COMPOSITION_THRESHOLD_REPLAY',error instanceof Error?error.message:String(error),row.id)}
  }
  for(const row of Object.values(generation.requirements)){
    const owner=generation.compositions[row.compositionId];if(!owner||!owner.requirementIds.includes(row.id)){fail('COMPOSITION_REQUIREMENT_OWNER','要求必须由所属组合引用。',row.id);continue}
    if(row.kind==='minimumComponentArea'&&row.minAreaMm2>owner.boundsMm.width*owner.boundsMm.height||row.kind==='channelWidth'&&row.minWidthMm>Math.ceil(Math.hypot(owner.boundsMm.width,owner.boundsMm.height)))fail('COMPOSITION_REQUIREMENT_SIZE','要求面积或宽度超出组合可用范围。',row.id)
    if(row.kind==='channelWidth'&&row.pointsMm.some(point=>!inBounds(point,owner.boundsMm)))fail('COMPOSITION_REQUIREMENT_BOUNDS','水道要求越出组合范围。',row.id)
    if(row.kind==='legacyConstraint'&&generation.legacy.constraints[row.constraintId]?.strength!=='hard')fail('COMPOSITION_LEGACY_REQUIREMENT','旧约束引用须指向真实hard约束。',row.id)
    const checks=Object.values(generation.checks).filter(check=>check.requirementId===row.id)
    if(checks.length!==1)fail('COMPOSITION_REQUIREMENT_CHECK','每条要求必须恰好保存一条检查。',row.id)
    if(owner.state==='active'){
      const actual=evaluateTerrainRequirement(scene,row)
      for(const check of checks)if(check.inputHash!==terrainRequirementInputHash(scene,row)||check.state!==actual.state||!same(check.issues,actual.issues))fail('COMPOSITION_REQUIREMENT_RECEIPT','要求回执与当前真实几何重验不一致。',check.id)
      if(actual.state!=='passed')fail('COMPOSITION_HARD_REQUIREMENT','活动组合未通过真实硬要求。',row.id)
    }
  }
  for(const row of Object.values(generation.dependencies)){
    const owner=generation.compositions[row.compositionId];if(!owner){fail('COMPOSITION_DEPENDENCY_OWNER','依赖所属组合不存在。',row.id);continue}
    if(!contains(owner.boundsMm,row.scopeMm)||row.haloMm>Math.ceil(Math.hypot(owner.boundsMm.width,owner.boundsMm.height))||row.haloMm<Math.max(owner.precision.sampleSpacingMm,owner.precision.noiseCellMm,owner.precision.toleranceMm))fail('COMPOSITION_HALO','依赖写范围或halo不足以覆盖固定采样和噪声。',row.id)
    if(!same([...new Set(owner.members.map(member=>member.featureId))].sort(),[...row.featureIds].sort())||!same([...owner.thresholdIds].sort(),[...row.thresholdIds].sort()))fail('COMPOSITION_DEPENDENCY_INPUTS','依赖必须完整列出所属组合特征和阈值。',row.id)
    for (const transitionId of row.transitionIds) if (!scene.visual.transitions[transitionId]) fail('COMPOSITION_TRANSITION_REFERENCE', '依赖引用的过渡不存在。', row.id)
    for(const ref of row.writes){checkRef(ref,owner,true);if(!owner.outputRefs.some(output=>same(output,ref)))fail('COMPOSITION_DEPENDENCY_WRITE','依赖写目标须属于完整组合输出。',row.id)}
    if(owner.state==='active'&&owner.outputRefs.some(output=>!Object.values(generation.dependencies).filter(dep=>dep.compositionId===owner.id).some(dep=>dep.writes.some(ref=>same(ref,output)))))fail('COMPOSITION_DEPENDENCY_WRITE','完整依赖必须覆盖每个实际输出字段组。',row.id)
    for(const read of row.reads){
      checkRef(read.target,owner,false,read.role)
      const written=row.writes.some(ref=>same(ref,read.target))
      if(read.role==='preserve'&&written||read.role==='baseline'&&!written)fail('COMPOSITION_READ_ROLE','preserve不能写入；baseline必须是写目标。',row.id)
      try{const parsed=snapshotSchema(read.target).safeParse(read.snapshot);if(!parsed.success||!same(parsed.data,read.snapshot))fail('COMPOSITION_READ_SNAPSHOT','依赖快照必须是完整严格原生字段组。',row.id)}catch(error){fail('COMPOSITION_READ_SNAPSHOT',error instanceof Error?error.message:String(error),row.id)}
      if(hash(read.snapshot)!==read.contentHash)fail('COMPOSITION_READ_HASH','依赖快照hash不符。',row.id)
      for(const message of snapshotResourceIssues(scene,read.snapshot))fail('COMPOSITION_READ_RESOURCE',message,row.id)
      const target=resolveCompositionEntity(scene,read.target)
      if(read.target.kind==='prop'&&target){
        const b=owner.boundsMm,scope=row.scopeMm,reach={x:Math.max(b.x,scope.x-row.haloMm),y:Math.max(b.y,scope.y-row.haloMm),width:0,height:0}
        reach.width=Math.min(b.x+b.width,scope.x+scope.width+row.haloMm)-reach.x;reach.height=Math.min(b.y+b.height,scope.y+scope.height+row.haloMm)-reach.y
        if(propFootprint(target as unknown as Prop).some(point=>!inBounds(point,reach)))fail('COMPOSITION_READ_FOOTPRINT','依赖读取halo没有覆盖物件完整旋转占地。',row.id)
        const support=(target as unknown as Prop).supportRef
        if(support.kind!=='floor'&&!row.reads.some(other=>other.target.entityId===support.id&&other.target.fieldGroup==='geometry')&&!row.writes.some(other=>other.entityId===support.id&&other.fieldGroup==='geometry'))fail('COMPOSITION_READ_SUPPORT','物件读取缺少真实支撑依赖。',row.id)
      }
      if(owner.state==='active'&&read.role==='preserve'&&!same(read.snapshot,resolveCompositionTarget(scene,read.target)))fail('COMPOSITION_PRESERVE','保全来源已发生变化。',row.id)
      const writer=writers.get(refKey(read.target));if(writer&&writer!==owner.id){const parents=links.get(owner.id)??new Set();parents.add(writer);links.set(owner.id,parents)}
    }
    const preservedIds=new Set(row.reads.filter(read=>read.role==='preserve'&&read.target.fieldGroup==='geometry').map(read=>read.target.entityId))
    const requirePreserved=(id:string)=>{if(!preservedIds.has(id))fail('COMPOSITION_PRESERVE_CLOSURE','建筑保全缺少相邻几何、成员或递归注记依赖。',id)}
    for(const read of row.reads.filter(read=>building.has(read.target.kind)&&read.role==='preserve')){
      const target=resolveCompositionEntity(scene,read.target)
      if(!target)continue
      if(read.target.kind==='room')for(const id of target.boundaryVertexIds as string[])requirePreserved(id)
      if(read.target.kind==='wall'){
        requirePreserved(target.startVertexId as string);requirePreserved(target.endVertexId as string)
        for(const opening of Object.values(scene.openings))if(opening.wallId===read.target.entityId)requirePreserved(opening.id)
        for(const room of Object.values(scene.rooms))if(room.boundaryVertexIds.includes(target.startVertexId as string)&&room.boundaryVertexIds.includes(target.endVertexId as string))requirePreserved(room.id)
      }
      if(read.target.kind==='opening')requirePreserved(target.wallId as string)
      if(read.target.kind==='prefabInstance')for(const member of Object.values(target.members as Record<string,{propId:string|null}>))if(member.propId)requirePreserved(member.propId)
      if(read.target.kind==='note'){
        const anchor=target.anchor as {type:string;entityId?:string};if(anchor.type==='entity'&&anchor.entityId)requirePreserved(anchor.entityId)
      }
    }
    for(const note of Object.values(scene.notes))if(note.anchor.type==='entity'&&preservedIds.has(note.anchor.entityId))requirePreserved(note.id)
    if(owner.state==='active'&&row.inputHash!==dependencyInputHash(scene,row))fail('COMPOSITION_DEPENDENCY_HASH','依赖完整冻结输入hash不符。',row.id)
  }
  for(const rule of Object.values(generation.legacy.rules))if(rule.state!=='detached'){
    const parents=links.get(rule.id)??new Set<string>();for(const ref of rule.inputs){const writer=writers.get(refKey(ref));if(writer&&writer!==rule.id)parents.add(writer)}links.set(rule.id,parents)
  }
  const visiting=new Set<string>(),visited=new Set<string>(),visit=(id:string):boolean=>{if(visiting.has(id))return false;if(visited.has(id))return true;visiting.add(id);for(const parent of links.get(id)??[])if(!visit(parent))return false;visiting.delete(id);visited.add(id);return true}
  if([...links.keys()].some(id=>!visit(id)))fail('COMPOSITION_DEPENDENCY_CYCLE','组合依赖图存在循环。')
  return issues
}
/** Token-dependent output receipts are checked only after the complete identity has been parsed. */
export function validateCompositionIdentityContracts(scene: SceneDocument, identity: HistoryIdentity): Issue[] {
  if(scene.schemaVersion!==4||scene.generation?.version!==5)return []
  return Object.values(scene.generation.compositions).filter(row=>row.state==='active'&&row.outputHash!==compositionOutputHash(scene,row,identity)).map(row=>({code:'COMPOSITION_OUTPUT_HASH',message:'组合实际输出、人工状态或身份token与冻结回执不符。',entityId:row.id}))
}
