import type { BoundsMm, PointMm, SceneDocument, ScatterGroup } from '../model/scene.js'
import { z } from 'zod'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { pathPolygon, propFootprint, terrainPoints } from '../geometry/geometry.js'
import { sha256Text } from '../geometry/scatter.js'
import { pauseChangedCompositions } from './composition-lifecycle.js'
import { dependencyInputHash } from './composition-integrity.js'
import { terrainCommandCost } from './cost.js'
import { prepareSceneryRegeneration, applySceneryCandidate, inspectScenerySources, type SceneryRegenerationCandidate } from '../visual/scenery.js'
import { refreshTerrainTransitionsLocal, terrainTransitionRefreshBounds } from '../visual/transition.js'
import type { TerrainTransition, VisualSystem3, GenerationSystem5 } from './composition-contracts.js'

/**
 * T12's local refresh boundary. The request is session-only: it deliberately
 * does not add a new persisted scene field. A caller must carry the returned
 * base hash through its own CAS/protection transaction before adoption.
 */
export interface TerrainLocalRefreshRequest {
  sceneId: string
  scopeMm: BoundsMm
  haloMm?: number
  transitionIds?: readonly string[]
  sceneryGroupIds?: readonly string[]
}

const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const localBounds = z.object({ x: z.number().int().safe(), y: z.number().int().safe(), width: z.number().int().positive().safe(), height: z.number().int().positive().safe() }).strict()
export const terrainLocalRefreshRequestSchema = z.object({ sceneId: id, scopeMm: localBounds, haloMm: z.number().int().nonnegative().safe().optional(), transitionIds: z.array(id).max(128).refine(values => new Set(values).size === values.length).optional(), sceneryGroupIds: z.array(id).max(128).refine(values => new Set(values).size === values.length).optional() }).strict()

export interface TerrainLocalDependencyReport {
  readBoundsMm: BoundsMm
  haloMm: number
  transitionIds: string[]
  sceneryGroupIds: string[]
  readIds: string[]
  preservedIds: string[]
  writeIds: string[]
  dependencyInputHashes: Record<string, string>
  /** Hashes for fixed scenery definitions/assets and transition source rows. */
  sourceInputHashes: Record<string, string>
  inputHash: string
}

export interface TerrainLocalRefreshResult {
  request: TerrainLocalRefreshRequest
  document: SceneDocument
  dependencies: TerrainLocalDependencyReport
  sceneryCandidates: Record<string, SceneryRegenerationCandidate>
  changedIds: string[]
  cost: ReturnType<typeof terrainCommandCost>
  outputHash: string
}

const positive = (value: number): boolean => Number.isSafeInteger(value) && value > 0
const nonnegative = (value: number): boolean => Number.isSafeInteger(value) && value >= 0
const boundsOverlap = (a: BoundsMm, b: BoundsMm): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const expand = (bounds: BoundsMm, amount: number): BoundsMm => ({ x: bounds.x - amount, y: bounds.y - amount, width: bounds.width + amount * 2, height: bounds.height + amount * 2 })
const boundsOf = (points: readonly PointMm[]): BoundsMm => {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }
  const xs = points.map(point => point.x), ys = points.map(point => point.y), x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys))
  return { x, y, width: Math.ceil(Math.max(...xs)) - x, height: Math.ceil(Math.max(...ys)) - y }
}
const hash = (value: unknown): string => sha256Text(canonicalJson(value))
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const collectIds = (value: unknown, ids = new Set<string>()): Set<string> => {
  if (!value || typeof value !== 'object') return ids
  if (Array.isArray(value)) { value.forEach(item => collectIds(item, ids)); return ids }
  const row = value as Record<string, unknown>
  if (typeof row.id === 'string') ids.add(row.id)
  Object.values(row).forEach(item => collectIds(item, ids)); return ids
}
function sceneryAllocator(scene: SceneDocument, groupId: string) {
  const used = collectIds(scene), prefix = `scatter-${hash({ sceneId: scene.sceneId, groupId }).slice(0, 20)}`
  let sequence = 0
  return (candidateKey: string) => {
    let value = `${prefix}-${hash(candidateKey).slice(0, 20)}-${sequence++}`
    while (used.has(value)) value = `${prefix}-${hash(candidateKey).slice(0, 20)}-${sequence++}`
    used.add(value); return value
  }
}

function domainBounds(scene: SceneDocument, group: ScatterGroup): BoundsMm {
  if (group.domain.kind === 'area') {
    const area = own(scene.terrainAreas, group.domain.areaId)
    if (!area) throw new Error(`局部布景域不存在：${group.domain.areaId}`)
    return boundsOf(terrainPoints(area))
  }
  if (group.domain.kind === 'path') {
    const path = own(scene.paths, group.domain.pathId)
    if (!path) throw new Error(`局部布景路径不存在：${group.domain.pathId}`)
    return boundsOf(pathPolygon(path))
  }
  const edge = own(scene.terrainEdges, group.domain.edgeId), area = edge && own(scene.terrainAreas, edge.source.areaId)
  const index = area?.boundaryMm.findIndex(point => point.segmentId === edge?.source.segmentId) ?? -1
  if (!edge || !area || index < 0) throw new Error(`局部布景边缘来源不存在：${group.domain.edgeId}`)
  return boundsOf([area.boundaryMm[index].positionMm, area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm])
}

function requiredHalo(scene: SceneDocument, transitionIds: readonly string[], sceneryGroupIds: readonly string[]): number {
  const visual = scene.visual?.version === 3 ? scene.visual as VisualSystem3 : undefined
  const transitions = visual ? transitionIds.map(id => visual.transitions[id]).filter((row): row is TerrainTransition => !!row) : []
  let halo = transitions.reduce((max, row) => Math.max(max, row.widthMm, row.distanceSource.reachMm), 0)
  for (const id of sceneryGroupIds) {
    const group = scene.scatterGroups[id]
    if (!group) continue
    const source = inspectScenerySources(scene, id)
    const footprint = source.palette.reduce((max, item) => Math.max(max, item.footprintMm.width, item.footprintMm.height), 0)
    halo = Math.max(halo, group.minDistanceMm + Math.ceil(footprint / 2))
  }
  const generation = scene.generation?.version === 5 ? scene.generation as GenerationSystem5 : undefined
  for (const row of Object.values(generation?.dependencies ?? {})) halo = Math.max(halo, row.haloMm)
  return halo
}

function checkRequest(scene: SceneDocument, request: TerrainLocalRefreshRequest): { readBoundsMm: BoundsMm; transitionIds: string[]; sceneryGroupIds: string[]; haloMm: number } {
  if (scene.schemaVersion !== 4 || scene.generation?.version !== 5 || scene.visual?.version !== 3) throw new Error('局部联动需要严格scene4/generation5/visual3工程。')
  if (request.sceneId !== scene.sceneId) throw new Error('局部联动候选绑定的工程身份已变化。')
  if (![request.scopeMm.x, request.scopeMm.y, request.scopeMm.width, request.scopeMm.height].every(Number.isSafeInteger) || !positive(request.scopeMm.width) || !positive(request.scopeMm.height)) throw new Error('局部联动范围必须是正整数矩形。')
  const explicitHalo = request.haloMm
  if (explicitHalo !== undefined && !nonnegative(explicitHalo)) throw new Error('局部联动haloMm必须为非负整数。')
  const transitionFilter = request.transitionIds ? new Set(request.transitionIds) : undefined
  const sceneryFilter = request.sceneryGroupIds ? new Set(request.sceneryGroupIds) : undefined
  const visual = scene.visual as VisualSystem3
  if (transitionFilter && [...transitionFilter].some(id => !visual.transitions[id])) throw new Error('局部联动引用了不存在的过渡。')
  if (sceneryFilter && [...sceneryFilter].some(id => !scene.scatterGroups[id])) throw new Error('局部联动引用了不存在的布景组。')
  const selectedTransitionIds = Object.values(visual.transitions).filter(row => (!transitionFilter || transitionFilter.has(row.id)) && boundsOverlap(terrainTransitionRefreshBounds(scene, row), request.scopeMm)).map(row => row.id).sort()
  const selectedSceneryGroupIds = Object.values(scene.scatterGroups).filter(group => (!sceneryFilter || sceneryFilter.has(group.id)) && boundsOverlap(domainBounds(scene, group), request.scopeMm)).map(group => group.id).sort()
  if (transitionFilter && selectedTransitionIds.length !== transitionFilter.size) throw new Error('局部联动指定过渡不在冻结范围内。')
  if (sceneryFilter && selectedSceneryGroupIds.length !== sceneryFilter.size) throw new Error('局部联动指定布景组不在冻结范围内。')
  const required = requiredHalo(scene, selectedTransitionIds, selectedSceneryGroupIds), haloMm = explicitHalo ?? required
  if (haloMm < required) throw new Error(`局部联动haloMm不足，至少需要${required}。`)
  return { readBoundsMm: expand(request.scopeMm, haloMm), transitionIds: selectedTransitionIds, sceneryGroupIds: selectedSceneryGroupIds, haloMm }
}

/** Read-only dependency closure used by both manual and AI local candidates. */
export function inspectTerrainLocalDependencies(scene: SceneDocument, request: TerrainLocalRefreshRequest): TerrainLocalDependencyReport {
  const selected = checkRequest(scene, request), readIds = new Set<string>(), preservedIds = new Set<string>(), writeIds = new Set<string>()
  const generation = scene.generation as GenerationSystem5
  const sourceInputHashes: Record<string, string> = {}
  const add = (value: string | null | undefined) => { if (value) readIds.add(value) }
  const addArea = (areaId: string) => {
    const area = scene.terrainAreas[areaId]
    if (!area) return
    add(area.id); add(scene.entityLayers[area.id]);
    for (const point of area.boundaryMm) { add(point.id); add(point.segmentId) }
    const materialId = area.surfaceStyle?.base.materialRef.id
    add(materialId); add(scene.materials[materialId ?? '']?.licenseRef)
  }
  const visual = scene.visual as VisualSystem3
  for (const id of selected.transitionIds) {
    const row = visual.transitions[id]
    if (!row) continue
    add(row.id); add(row.boundaryId); add(scene.entityLayers[row.id])
    const boundary = visual.base.base.boundaries[row.boundaryId]
    const sourceIds: string[] = []
    if (boundary) {
      add(boundary.id); add(boundary.layerId)
      boundary.segments.forEach(segment => { add(segment.id) })
      if (boundary.binding.kind === 'terrain') boundary.binding.sides.forEach(side => { sourceIds.push(side.areaId); addArea(side.areaId) })
      else if (boundary.binding.kind === 'path') {
        add(boundary.binding.pathId)
        sourceIds.push(`path:${boundary.binding.pathId}`)
        const path = scene.paths[boundary.binding.pathId]
        path?.supportRefs.forEach(ref => ref.kind === 'terrainArea' ? addArea(ref.id) : add(ref.id))
      }
    }
    sourceInputHashes[`transition:${id}`] = hash({ row, boundary: boundary ?? null, sources: sourceIds.sort().map(sourceId => sourceId.startsWith('path:') ? scene.paths[sourceId.slice(5)] ?? null : scene.terrainAreas[sourceId] ?? null) })
    // Masks are part of the transition input even when they do not emit a
    // persisted write. Reading every same-Floor mask is conservative and
    // keeps the report complete when a wall/connection moves into the halo.
    const floorId = row.floorId
    for (const wall of Object.values(scene.walls).filter(value => value.floorId === floorId)) { add(wall.id); add(wall.startVertexId); add(wall.endVertexId) }
    for (const opening of Object.values(scene.openings).filter(value => scene.walls[value.wallId]?.floorId === floorId)) add(opening.id)
    for (const region of Object.values(scene.regions).filter(value => value.floorId === floorId)) add(region.id)
    for (const connection of Object.values(scene.terrainConnections).filter(value => value.floorId === floorId)) { add(connection.id); add(connection.from.surfaceRef.id); add(connection.to.surfaceRef.id) }
    writeIds.add(id)
  }
  for (const id of selected.sceneryGroupIds) {
    const group = scene.scatterGroups[id]!
    const source = inspectScenerySources(scene, id)
    sourceInputHashes[`scenery:${id}`] = source.sourceHash
    readIds.add(id); writeIds.add(id)
    add(source.layerId)
    if (group.domain.kind === 'area') readIds.add(group.domain.areaId)
    else if (group.domain.kind === 'path') readIds.add(group.domain.pathId)
    else readIds.add(group.domain.edgeId)
    if (group.domain.kind === 'area') addArea(group.domain.areaId)
    else if (group.domain.kind === 'path') {
      const path = scene.paths[group.domain.pathId]; path?.supportRefs.forEach(ref => ref.kind === 'terrainArea' ? addArea(ref.id) : add(ref.id))
    } else {
      const edge = scene.terrainEdges[group.domain.edgeId]; if (edge) { add(edge.source.areaId); add(edge.neighborAreaId); addArea(edge.source.areaId); if (edge.neighborAreaId) addArea(edge.neighborAreaId) }
    }
    const domainSource = group.domain.kind === 'area' ? scene.terrainAreas[group.domain.areaId] : group.domain.kind === 'path' ? scene.paths[group.domain.pathId] : scene.terrainEdges[group.domain.edgeId]
    sourceInputHashes[`scenery-domain:${id}`] = hash(domainSource ?? null)
    for (const item of source.palette) {
      add(item.definitionRef.id)
      const definition = scene.propDefinitions[item.definitionRef.id]
      if (definition?.defaultAppearance.kind === 'image') { add(definition.defaultAppearance.assetId); add(scene.assets[definition.defaultAppearance.assetId]?.sha256); add(definition.licenseRef) }
    }
    for (const [key, member] of Object.entries(group.members)) {
      if (member.propId) readIds.add(member.propId)
      const prop = member.propId ? scene.props[member.propId] : undefined
      if (member.state !== 'managed' || prop?.editLocked || scene.userLayers[scene.entityLayers[member.propId ?? '']]?.editLocked || prop && !boundsOverlap(boundsOf(propFootprint(prop)), selected.readBoundsMm)) preservedIds.add(member.propId ?? key)
      else if (member.propId) writeIds.add(member.propId)
    }
  }
  for (const prop of Object.values(scene.props)) if (boundsOverlap(boundsOf(propFootprint(prop)), selected.readBoundsMm)) readIds.add(prop.id)
  const dependencyInputHashes: Record<string, string> = {}
  for (const dependency of Object.values(generation.dependencies).filter(row => boundsOverlap(row.scopeMm, selected.readBoundsMm) || row.transitionIds.some(id => selected.transitionIds.includes(id)))) {
    dependencyInputHashes[dependency.id] = dependencyInputHash(scene, dependency)
    readIds.add(dependency.id); dependency.featureIds.forEach(id => readIds.add(id)); dependency.thresholdIds.forEach(id => readIds.add(id))
  }
  const inputHash = hash({ request: { ...request, haloMm: selected.haloMm }, selected, readIds: [...readIds].sort(), preservedIds: [...preservedIds].sort(), dependencyInputHashes, sourceInputHashes })
  return { ...selected, readIds: [...readIds].sort(), preservedIds: [...preservedIds].sort(), writeIds: [...writeIds].sort(), dependencyInputHashes, sourceInputHashes, inputHash }
}

/**
 * Prepare one deterministic local candidate. Scenery is applied first because
 * transition masks must see the resulting physical obstacles. The input scene
 * is never mutated; manual/deleted/detached/locked members are preserved by
 * the existing scatter candidate contract.
 */
export function prepareTerrainLocalRefresh(scene: SceneDocument, request: TerrainLocalRefreshRequest): TerrainLocalRefreshResult {
  const dependencies = inspectTerrainLocalDependencies(scene, request), next = cloneJson(scene), sceneryCandidates: Record<string, SceneryRegenerationCandidate> = {}, changedIds = new Set<string>()
  for (const groupId of dependencies.sceneryGroupIds) {
    const beforeGroup = next.scatterGroups[groupId]
    const candidate = prepareSceneryRegeneration(next, groupId, { preserveManagedAppearance: true, allocatePropId: sceneryAllocator(next, groupId) })
    // Regeneration is scoped to the dependency halo. Managed members outside
    // that halo remain byte-for-byte identical, including their group records;
    // they are protected receipts so adoption cannot silently widen the write.
    const preservedOutside = Object.entries(beforeGroup.members).filter(([key, member]) => {
      if (member.propId === null) return false
      const prop = next.props[member.propId]
      return !!prop && !boundsOverlap(boundsOf(propFootprint(prop)), dependencies.readBoundsMm)
    })
    const preservedKeys = new Set(preservedOutside.map(([key]) => key))
    for (const [key, member] of Object.entries(beforeGroup.members)) {
      const prop = member.propId ? next.props[member.propId] : undefined
      if (member.state !== 'managed' || prop?.editLocked || next.userLayers[next.entityLayers[member.propId ?? '']]?.editLocked) preservedKeys.add(key)
    }
    const outsideIds = new Set(preservedOutside.map(([, member]) => member.propId).filter((value): value is string => !!value))
    candidate.proposal.removePropIds = candidate.proposal.removePropIds.filter(id => !outsideIds.has(id))
    candidate.proposal.props = candidate.proposal.props.filter(prop => boundsOverlap(boundsOf(propFootprint(prop)), dependencies.readBoundsMm))
    const generatedIds = new Set(candidate.proposal.props.map(prop => prop.id))
    for (const [key, member] of Object.entries(candidate.proposal.group.members)) if (member.propId && !generatedIds.has(member.propId) && !preservedKeys.has(key)) delete candidate.proposal.group.members[key]
    for (const [key, member] of preservedOutside) {
      candidate.proposal.group.members[key] = cloneJson(member)
      if (!candidate.protectedMemberKeys.includes(key)) candidate.protectedMemberKeys.push(key)
      candidate.protectedMemberSnapshots[key] = cloneJson(member)
    }
    candidate.protectedMemberKeys.sort()
    candidate.proposalHash = hash(candidate.proposal)
    candidate.changedIds = [...new Set([...candidate.proposal.removePropIds, ...candidate.proposal.props.map(prop => prop.id), groupId])].sort()
    sceneryCandidates[groupId] = cloneJson(candidate)
    const applied = applySceneryCandidate(next, candidate)
    Object.assign(next, applied)
    candidate.changedIds.forEach(id => changedIds.add(id))
  }
  if (next.visual?.version !== 3) throw new Error('局部联动缺少严格visual3。')
  const refreshed = refreshTerrainTransitionsLocal(next, { scopeMm: request.scopeMm, haloMm: dependencies.haloMm, transitionIds: dependencies.transitionIds })
  next.visual.transitions = refreshed.transitions
  refreshed.changedIds.forEach(id => changedIds.add(id))
  pauseChangedCompositions(scene, next)
  const cost = terrainCommandCost(scene, next)
  if (cost.total > 256) throw new Error(`局部联动实际展开${cost.total}，超过256；请缩小范围。`)
  const outputHash = hash({ document: next, changedIds: [...changedIds].sort(), dependencies })
  return { request: { ...cloneJson(request), haloMm: dependencies.haloMm }, document: next, dependencies, sceneryCandidates, changedIds: [...changedIds].sort(), cost, outputHash }
}
