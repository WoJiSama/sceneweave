import type { PointMm, Prop, ScatterGroup, SceneDocument, VersionRef } from '../model/scene.js'
import { buildScatterRegeneration, type ScatterRegeneration, type ScatterRegenerationOptions } from '../geometry/scatter.js'
import { propFootprint } from '../geometry/geometry.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'

/**
 * T11 keeps conditional dressing on the existing strict scatter-cell-v1
 * contract.  The helper only prepares a detached candidate; the workspace
 * still owns the ordinary command/CAS/history transaction that adopts it.
 */
export interface ScenerySourceReport {
  groupId: string
  floorId: string
  layerId: string
  domain: ScatterGroup['domain']
  palette: Array<{
    key: string
    definitionRef: VersionRef
    visualBoundsMm: { x: number; y: number; width: number; height: number }
    footprintMm: { width: number; height: number }
    renderLayer: Prop['renderLayer']
    shadowClass: Prop['shadowClass']
  }>
  sourceHash: string
}

export interface SceneryRegenerationCandidate {
  source: ScenerySourceReport
  proposal: ScatterRegeneration
  inputHash: string
  proposalHash: string
  protectedMemberKeys: string[]
  protectedMemberSnapshots: Record<string, ScatterGroup['members'][string]>
  changedIds: string[]
}

const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0
const point = (value: PointMm): boolean => Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y)
const hash = (value: unknown): string => sha256Text(canonicalJson(value))

function assertDomain(scene: SceneDocument, group: ScatterGroup): void {
  const floor = own(scene.floors, group.floorId)
  if (!floor) throw new Error(`条件布景 Floor 不存在：${group.floorId}`)
  const layerId = scene.entityLayers[group.id], layer = layerId ? own(scene.userLayers, layerId) : undefined
  if (!layer || layer.floorId !== group.floorId) throw new Error('条件布景必须引用同Floor用户图层。')
  const refs = group.domain.kind === 'area'
    ? [own(scene.terrainAreas, group.domain.areaId)]
    : group.domain.kind === 'path'
      ? [own(scene.paths, group.domain.pathId)]
      : [own(scene.terrainEdges, group.domain.edgeId)]
  if (refs.some(value => !value || value.floorId !== group.floorId)) throw new Error('条件布景域不存在或跨Floor。')
  if (group.visibility === 'public') {
    const privateSource = group.domain.kind === 'area'
      ? refs[0]?.visibility === 'gm'
      : group.domain.kind === 'path'
        ? refs[0]?.visibility === 'gm' || (refs[0] as SceneDocument['paths'][string]).supportRefs.some(ref => ref.kind !== 'floor' && ((ref.kind === 'terrainArea' && scene.terrainAreas[ref.id]?.visibility === 'gm') || (ref.kind === 'room' && scene.rooms[ref.id]?.visibility === 'gm')))
        : refs[0]?.visibility === 'gm' || ((refs[0] as SceneDocument['terrainEdges'][string]).neighborAreaId !== null && scene.terrainAreas[(refs[0] as SceneDocument['terrainEdges'][string]).neighborAreaId!]?.visibility === 'gm')
    if (privateSource) throw new Error('公开条件布景不能依赖GM来源。')
  }
}

function assertDefinition(scene: SceneDocument, ref: VersionRef): ScenerySourceReport['palette'][number] {
  const definition = own(scene.propDefinitions, ref.id)
  if (!definition || definition.version !== ref.version) throw new Error(`条件布景固定物件版本缺失：${ref.id}@${ref.version}`)
  const visual = definition.defaultVisualBoundsMm
  if (![visual.x, visual.y, visual.width, visual.height].every(Number.isSafeInteger) || !positiveInteger(visual.width) || !positiveInteger(visual.height)) throw new Error(`条件布景图像范围无效：${definition.id}`)
  if (!positiveInteger(definition.defaultFootprintMm.width) || !positiveInteger(definition.defaultFootprintMm.height)) throw new Error(`条件布景物理占地无效：${definition.id}`)
  if (!point(definition.defaultFootprintOffsetMm)) throw new Error(`条件布景根锚占地偏移无效：${definition.id}`)
  if (definition.defaultAppearance.kind === 'image' && !scene.assets[definition.defaultAppearance.assetId]) throw new Error(`条件布景图片资源缺失：${definition.id}`)
  return { key: '', definitionRef: cloneJson(ref), visualBoundsMm: cloneJson(visual), footprintMm: cloneJson(definition.defaultFootprintMm), renderLayer: definition.defaultRenderLayer, shadowClass: definition.defaultShadowClass }
}

export function inspectScenerySources(scene: SceneDocument, groupId: string): ScenerySourceReport {
  const group = own(scene.scatterGroups, groupId)
  if (!group) throw new Error(`条件布景散布组不存在：${groupId}`)
  assertDomain(scene, group)
  const palette = group.palette.map(item => ({ ...assertDefinition(scene, item.propDefinitionRef), key: item.key }))
  if (!palette.length) throw new Error('条件布景至少需要一个固定物件来源。')
  const layer = scene.userLayers[scene.entityLayers[group.id]]
  if (group.editLocked || layer.editLocked) throw new Error('条件布景组或其用户图层已锁定。')
  const definitions = palette.map(item => scene.propDefinitions[item.definitionRef.id] ?? null)
  const assets = definitions.flatMap(definition => definition?.defaultAppearance.kind === 'image' ? [scene.assets[definition.defaultAppearance.assetId] ?? null] : [])
  // The source receipt covers the fixed definition/asset metadata and the
  // group/layer lock. A palette-only digest cannot prove the PNG/footprint
  // closure or reject a lock change between preview and adoption.
  const sourceHash = hash({ algorithmId: 'terrain-scenery', algorithmVersion: 1, group: { ...group, members: {}, exclusions: group.exclusions }, layer, palette, definitions, assets, domain: group.domain })
  return { groupId: group.id, floorId: group.floorId, layerId: scene.entityLayers[group.id]!, domain: cloneJson(group.domain), palette, sourceHash }
}

function inputHash(scene: SceneDocument, source: ScenerySourceReport): string {
  const group = scene.scatterGroups[source.groupId]
  const groupSource = group ? { ...group, members: {} } : null
  return hash({ sourceHash: source.sourceHash, revision: scene.revision, terrain: scene.terrainAreas, edges: scene.terrainEdges, paths: scene.paths,
    connections: scene.terrainConnections, walls: scene.walls, openings: scene.openings, regions: scene.regions,
    group: groupSource, layer: group ? scene.userLayers[scene.entityLayers[group.id]] ?? null : null,
    props: Object.values(scene.props).map(prop => ({ ...prop, footprint: propFootprint(prop) })), exclusions: group?.exclusions ?? [] })
}

export function prepareSceneryRegeneration(scene: SceneDocument, groupId: string, options: ScatterRegenerationOptions = {}): SceneryRegenerationCandidate {
  const source = inspectScenerySources(scene, groupId), group = scene.scatterGroups[groupId]
  const proposal = buildScatterRegeneration(scene, groupId, undefined, { preserveManagedAppearance: true, ...options })
  const protectedMemberKeys = Object.entries(group.members).filter(([, member]) => member.state !== 'managed' || (member.propId !== null && (scene.props[member.propId]?.editLocked || scene.userLayers[scene.entityLayers[member.propId]]?.editLocked))).map(([key]) => key).sort()
  const changedIds = [...new Set([...proposal.removePropIds, ...proposal.props.map(prop => prop.id), groupId])].sort()
  return { source, proposal: cloneJson(proposal), inputHash: inputHash(scene, source), proposalHash: hash(proposal), protectedMemberKeys, protectedMemberSnapshots: Object.fromEntries(protectedMemberKeys.map(key => [key, cloneJson(group.members[key])])), changedIds }
}

export function applySceneryCandidate(scene: SceneDocument, candidate: SceneryRegenerationCandidate): SceneDocument {
  const source = inspectScenerySources(scene, candidate.source.groupId)
  if (source.sourceHash !== candidate.source.sourceHash || inputHash(scene, source) !== candidate.inputHash) throw new Error('条件布景候选基线已变化，必须重新预览。')
  if (hash(candidate.proposal) !== candidate.proposalHash) throw new Error('条件布景候选内容已变化，必须重新预览。')
  const next = cloneJson(scene), group = next.scatterGroups[candidate.source.groupId]
  if (!group) throw new Error('条件布景散布组已被移除。')
  for (const key of candidate.protectedMemberKeys) if (canonicalJson(group.members[key] ?? null) !== canonicalJson(candidate.protectedMemberSnapshots[key] ?? null)) throw new Error(`条件布景保护成员已变化：${key}`)
  for (const id of candidate.proposal.removePropIds) {
    delete next.props[id]
    delete next.entityLayers[id]
  }
  for (const prop of candidate.proposal.props) {
    next.props[prop.id] = cloneJson(prop)
    // Scatter regeneration creates real top-level props. Their layer
    // membership is part of the strict document and must travel with the
    // candidate instead of being reconstructed by a later validator.
    next.entityLayers[prop.id] = candidate.source.layerId
  }
  next.scatterGroups[group.id] = cloneJson(candidate.proposal.group)
  return next
}

export function orderSceneryProps(props: readonly Prop[]): Prop[] {
  const layer = { ground: 0, object: 1, canopy: 2 } as const
  return props.map(cloneJson).sort((a, b) => layer[a.renderLayer] - layer[b.renderLayer] || a.renderOrder - b.renderOrder || a.positionMm.y - b.positionMm.y || a.id.localeCompare(b.id))
}
