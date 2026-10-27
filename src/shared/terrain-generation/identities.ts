import type { SceneDocument } from '../model/scene.js'
import type { HistoryIdentity } from '../model/history.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { ExtendedIdentityToken, GenerationSystem3, GenerationSystem4 } from './contracts.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
export const TERRAIN_IDENTITY_FIELDS = ['generationTokens', 'regionalTokens', 'presentationTokens'] as const
export interface ExtendedIdentityDescriptor {
  field: typeof TERRAIN_IDENTITY_FIELDS[number]
  kind: ExtendedIdentityToken['kind']
  topologyHash: string
}
export type ExtendedIdentityDescriptors = Record<string, ExtendedIdentityDescriptor>
const unordered = (values: readonly unknown[]) => values.map(value => canonicalJson(value)).sort()

/** Capture relationship hashes now; coordinate/style edits alone retain continuity. */
export function extendedIdentityDescriptors(scene: Readonly<SceneDocument>): ExtendedIdentityDescriptors {
  const result: ExtendedIdentityDescriptors = {}
  const add = (id: string, field: ExtendedIdentityDescriptor['field'], kind: ExtendedIdentityToken['kind'], topology: unknown) => {
    if (Object.hasOwn(result, id)) throw new Error(`新地形身份重复：${id}。`)
    result[id] = { field, kind, topologyHash: sha256Text(canonicalJson([kind, topology])) }
  }
  if (scene.schemaVersion !== 3) return result
  const generation = scene.generation!
  if(generation.version!==1)for(const row of Object.values(generation.strokes))add(row.id,'generationTokens','generationStroke',[row.operationId,row.floorId,row.brush,row.targetAreaId,row.pointsMm.length])
  if(generation.version>=3)for(const row of Object.values((generation as GenerationSystem3|GenerationSystem4).surroundings))add(row.id,'generationTokens','surroundingsOperation',[row.operationId,row.floorId,row.algorithmId,row.algorithmVersion,row.boundaryIds,row.preserved.map(item=>[item.collection,item.entityId])])
  if(generation.version===4)for(const row of Object.values(generation.topology))add(row.id,'generationTokens','topologyOperation',[row.request.operationId,row.floorId,row.request.operation,row.request.areaIds,row.outputAreaIds])
  for (const row of Object.values(generation.recipes)) add(row.id, 'generationTokens', 'generationRecipe',
    [row.recipeVersion, row.algorithmId, row.algorithmVersion, row.mapMode, unordered(row.materials), unordered(row.props)])
  for (const row of Object.values(generation.intents)) {
    add(row.id, 'generationTokens', 'generationIntent', [row.floorId, row.skeleton.map(node => node.id).sort(), [...row.constraintIds].sort(), [...row.preserveIds].sort()])
    for (const node of row.skeleton) add(node.id, 'generationTokens', 'generationSkeleton', [row.id, row.floorId, node.kind])
  }
  for (const row of Object.values(generation.rules)) add(row.id, 'generationTokens', 'generationRule',
    [row.floorId, row.kind, row.recipeRef, unordered(row.inputs), unordered(row.outputs)])
  for (const row of Object.values(generation.ownership)) add(row.id, 'generationTokens', 'outputOwnership', [row.ruleId, row.outputKey, row.target])
  for (const row of Object.values(generation.exclusions)) add(row.id, 'generationTokens', 'generationExclusion',
    [row.floorId, row.key, row.reason, row.candidateKey, row.birthToken, row.boundaryMm.length])
  for (const row of Object.values(generation.constraints)) add(row.id, 'generationTokens', 'terrainConstraint', [row.floorId, row.kind,
    'target' in row ? row.target : 'boundaryMm' in row ? row.boundaryMm.length : 'pointsMm' in row ? row.pointsMm.length : null])
  for (const row of Object.values(generation.checks)) add(row.id, 'generationTokens', 'constraintCheck', [row.constraintId, row.algorithmId, row.algorithmVersion])
  for (const row of Object.values(generation.sourceLinks)) {
    const source = [row.sourceSceneId, row.sourceRevision, row.sourceContentHash]
    add(row.id, 'generationTokens', 'sourceRegionLink', [source, unordered(row.recipeRefs), row.inherited.map(feature => feature.id).sort()])
    for (const feature of row.inherited) add(feature.id, 'generationTokens', 'sourceRegionFeature',
      [row.id, source, feature.kind, feature.sourceEntityId, feature.terrainKind, feature.pointsMm.length])
  }
  if (scene.regional) {
    for (const row of Object.values(scene.regional.areas)) add(row.id, 'regionalTokens', 'regionalArea', [row.floorId, row.boundaryMm.length])
    for (const row of Object.values(scene.regional.lines)) {
      add(row.id, 'regionalTokens', 'regionalLine', [row.floorId, row.kind, row.pointsMm.map(point => point.id), [...row.portIds].sort(), [...row.connectedLineIds].sort()])
      row.pointsMm.forEach((point, index) => add(point.id, 'regionalTokens', 'regionalPoint',
        [row.id, row.floorId, row.pointsMm[index - 1]?.id ?? null, row.pointsMm[index + 1]?.id ?? null]))
    }
    for (const row of Object.values(scene.regional.landmarks)) add(row.id, 'regionalTokens', 'regionalLandmark', [row.floorId, row.areaId, row.definitionRef])
    for (const row of Object.values(scene.regional.symbols)) add(row.id, 'regionalTokens', 'regionalSymbol', [row.floorId, row.sourceRef, row.definitionRef])
  }
  for (const collection of ['rooms', 'walls', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths'] as const) for (const entity of Object.values(scene[collection])) {
    const style = 'floorStyle' in entity ? entity.floorStyle : 'topStyle' in entity ? entity.topStyle : entity.surfaceStyle
    for (const overlay of style?.overlays ?? []) add(overlay.id, 'presentationTokens', 'surfaceOverlay', [collection, entity.id, entity.floorId, overlay.boundaryMm.length])
  }
  if (scene.visual?.version === 2) for (const edge of Object.values(scene.visual.materializedEdges)) {
    const source = scene.visual.base.boundaries[edge.boundaryId]
    const binding = source ? [source.closed, source.segments.map(segment => segment.id), source.binding] : null
    add(edge.id, 'presentationTokens', 'materializedEdge',
      [edge.floorId, edge.boundaryId, binding, edge.kind, edge.polygons.map(ring => ring.length), edge.strokes.map(stroke => [stroke.id, stroke.pointsMm.length])])
    for (const stroke of edge.strokes) add(stroke.id, 'presentationTokens', 'materializedStroke', [edge.id, edge.floorId, edge.boundaryId, binding, stroke.pointsMm.length])
  }
  return result
}

/** Only this captured descriptor transition grants continuity; IDs alone do not. */
export function advanceExtendedIdentityDescriptors(identity: HistoryIdentity, before: ExtendedIdentityDescriptors, after: ExtendedIdentityDescriptors,
  context: PreparationContext, allowResurrection = false): void {
  identity.version = 2
  for (const field of TERRAIN_IDENTITY_FIELDS) identity[field] ??= {}
  for (const [id, descriptor] of Object.entries(after)) {
    if (Object.hasOwn(identity.propTokens, id) || Object.hasOwn(identity.prefabTokens, id) || Object.hasOwn(identity.outdoorTokens, id)
      || TERRAIN_IDENTITY_FIELDS.some(field => field !== descriptor.field && Object.hasOwn(identity[field]!, id))) {
      throw new Error(`新地形出生身份与已分配身份冲突：${id}。`)
    }
    const records = identity[descriptor.field]!, record = Object.hasOwn(records, id) ? records[id] : undefined
    const previous = Object.hasOwn(before, id) ? before[id] : undefined
    if (record) {
      if (record.kind !== descriptor.kind || previous && (previous.kind !== descriptor.kind || previous.field !== descriptor.field)
        || !previous && !allowResurrection) throw new Error(`新地形出生身份不能复用：${id}。`)
      if (record.topologyHash !== descriptor.topologyHash || !previous) records[id] = { ...record, topologyHash: descriptor.topologyHash, topologyToken: context.ids.nextId() }
    } else records[id] = { kind: descriptor.kind, token: context.ids.nextId(), topologyToken: context.ids.nextId(), topologyHash: descriptor.topologyHash }
  }
}

export function advanceExtendedIdentities(identity: HistoryIdentity, previous: SceneDocument | null, next: SceneDocument,
  context: PreparationContext, allowResurrection = false): void {
  if (next.schemaVersion !== 3) return
  advanceExtendedIdentityDescriptors(identity, previous ? extendedIdentityDescriptors(previous) : {}, extendedIdentityDescriptors(next), context, allowResurrection)
}
