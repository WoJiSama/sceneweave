import { propPresentation } from './presentation.js'
import { z } from 'zod'
import { inspectJsonInput, cloneJson } from '../validation/json.js'
import { roundMm } from '../commands/base.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { applyCommands, applySnapshotCommands, sceneCommandSchema, type SceneCommand } from '../commands/commands.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { effectiveEditLocked, enumerateLayerEntities } from '../commands/layers.js'
import type { PointMm, Prop, SceneDocument, SurfaceRef } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { createHistoryIdentityTrace } from '../history/identity.js'
import { detachChangedAppearance } from '../terrain-generation/appearance-lifecycle.js'
import { pauseChangedCompositionAppearance } from '../terrain-generation/composition-lifecycle.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { addPropAppearanceSource, effectiveAdjustments, equalCompositionValue, freezeEffectivePropAppearance, inspectAppearanceScope, propAppearanceSnapshot, supportedAppearanceKinds, syncAppearanceGraph, syncAppearanceGraphSnapshot } from './graph.js'
import { appearanceAdjustmentSchema, certifyCompositionContent, certifyCompositionDraft, compositionIdSchema, validateCompositionContent, validateCompositionDraft } from '../validation/content.js'
import { COMPOSITION_LIMITS, type AdjustmentKind, type AppearanceAdjustment, type AppearanceScope, type CompositionCommand, type CompositionContent } from '../model/appearance.js'

export type { CompositionCommand } from '../model/appearance.js'

const id = compositionIdSchema, integer = z.number().finite().refine(Number.isSafeInteger), point = z.object({ x: integer, y: integer }).strict()
const ids = z.array(id).min(1).max(256).refine(values => new Set(values).size === values.length, 'ID不能重复')
const scope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('targets'), ids }).strict(), z.object({ kind: z.literal('layer'), layerId: id }).strict()])
const surfaceRef = z.object({ kind: z.enum(['floor', 'room', 'terrainArea']), id }).strict()
const version = z.object({ id, version: z.number().int().positive() }).strict()
const c3Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setAppearanceAdjustment'), scope, adjustment: appearanceAdjustmentSchema }).strict(),
  z.object({ type: z.literal('toggleAppearanceAdjustment'), scope, adjustmentId: id, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('removeAppearanceAdjustment'), scope, adjustmentId: id }).strict(),
  z.object({ type: z.literal('setAppearanceSource'), ids, sourceId: id }).strict(),
  z.object({ type: z.literal('createPrefab'), id, definitionId: id, name: z.string().trim().min(1).max(80), ids: ids.max(128), anchorMm: point, licenseRef: id.optional(), tags: z.array(z.string().min(1).max(256)).max(64).optional() }).strict(),
  z.object({ type: z.literal('instantiatePrefab'), id, definitionRef: version, memberIds: z.record(id, id), anchorMm: point, rotationDeg: z.number().finite().min(0).lt(360).optional(), layerId: id, supportRef: surfaceRef }).strict(),
  z.object({ type: z.literal('duplicatePrefab'), id, newId: id, memberIds: z.record(id, id), offsetMm: point }).strict(),
  z.object({ type: z.literal('deletePrefab'), id, memberIds: z.array(id).max(128).refine(values => new Set(values).size === values.length) }).strict(),
  z.object({ type: z.literal('detachPrefabMember'), groupId: id, propId: id }).strict(),
  z.object({ type: z.literal('resetPrefabMember'), groupId: id, key: id, newId: id.optional(), supportRef: surfaceRef.optional() }).strict(),
])
const schemas = z.array(z.union([c3Schema, sceneCommandSchema])).max(256)
const c3Types = new Set(['setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment', 'setAppearanceSource', 'createPrefab', 'instantiatePrefab', 'duplicatePrefab', 'deletePrefab', 'detachPrefabMember', 'resetPrefabMember'])
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
/** Internal changed-entity accounting receives only independently parsed JSON records. */
function equalOwnedEntity(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
    && left.every((value, index) => equalOwnedEntity(value, right[index]))
  if (Array.isArray(right)) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>, keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalOwnedEntity(a[key], b[key]))
}
const required = <T>(record: Record<string, T>, key: string, label: string): T => { const value = own(record, key); if (!value) throw new Error(`${label}不存在：${key}。`); return value }
function assertUnlocked(document: SceneDocument, ids: readonly string[]): void {
  for (const id of ids) if (effectiveEditLocked(document, id)) throw new Error(`实体、成员、图层或依赖已锁定：${id}。`)
}
function assertFresh(content: CompositionContent, id: string): void {
  if (geometryIdentityIds(content.document).has(id) || Object.hasOwn(content.document.userLayers, id) || Object.hasOwn(content.historyIdentity.propTokens, id) || Object.hasOwn(content.historyIdentity.prefabTokens, id) || Object.hasOwn(content.historyIdentity.outdoorTokens, id)) throw new Error(`新身份不能复用已占用/已分配 ID：${id}。`)
}
function assertSupport(document: SceneDocument, floorId: string, ref: SurfaceRef): void {
  if (ref.kind === 'floor') { if (ref.id !== floorId || !own(document.floors, ref.id)) throw new Error('支撑必须属于同一Floor。'); return }
  const support = ref.kind === 'room' ? required(document.rooms, ref.id, '支撑房间') : required(document.terrainAreas, ref.id, '支撑地形')
  if (support.floorId !== floorId) throw new Error('支撑必须属于同一Floor。')
  assertUnlocked(document, [support.id])
  if (ref.kind === 'room') assertSupport(document, floorId, document.rooms[ref.id].supportRef)
}
function topOrder(document: SceneDocument, prop: Prop): number {
  let rank = -1
  for (const other of Object.values(document.props)) if (other.floorId === prop.floorId && other.renderLayer === prop.renderLayer) rank = Math.max(rank, other.renderOrder)
  if (rank >= 10000) throw new Error('当前系统绘制带顺序达到严格格式上限。')
  return rank + 1
}
function memberOverrides(document: SceneDocument, id: string): void {
  for (const group of [...Object.values(document.prefabInstances), ...Object.values(document.scatterGroups)]) {
    const member = Object.values(group.members).find(member => member.propId === id)
    if (!member) continue
    member.overrideFields = [...new Set([...member.overrideFields, 'definitionRef' as const, 'appearance' as const, 'visualBoundsMm' as const, 'shadowClass' as const, 'shadowOverride' as const])]
    if ('state' in member) member.state = 'manual'
  }
}
function assertIndependent(document: SceneDocument, id: string): Prop {
  const prop = required(document.props, id, '物件')
  if ([...Object.values(document.prefabInstances), ...Object.values(document.scatterGroups)].some(group => Object.values(group.members).some(member => member.propId === id))) throw new Error('组合创建只支持独立物件；不能包含其他组合、散布或结构。')
  return prop
}
function transformed(position: PointMm, anchor: PointMm, angle: number): PointMm {
  const a = angle * Math.PI / 180
  return { x: roundMm(anchor.x + position.x * Math.cos(a) - position.y * Math.sin(a)), y: roundMm(anchor.y + position.x * Math.sin(a) + position.y * Math.cos(a)) }
}
const angle = (value: number) => ((value % 360) + 360) % 360
const memberIdsMatch = (keys: string[], memberIds: Record<string, string>) => keys.length === Object.keys(memberIds).length && keys.every(key => Object.hasOwn(memberIds, key)) && new Set(Object.values(memberIds)).size === keys.length

function createPrefab(content: CompositionContent, command: Extract<CompositionCommand, { type: 'createPrefab' }>): number {
  const document = content.document, graph = content.appearance, props = command.ids.map(id => assertIndependent(document, id))
  assertFresh(content, command.id); assertFresh(content, command.definitionId)
  if (command.id === command.definitionId) throw new Error('组合与定义必须使用独立ID。')
  assertUnlocked(document, command.ids)
  const floorId = props[0].floorId, layerId = document.entityLayers[props[0].id]
  if (props.some(prop => prop.floorId !== floorId || document.entityLayers[prop.id] !== layerId)) throw new Error('创建组合的成员须属于同一Floor和用户图层；请先明确移层。')
  const visibility = createPublicVisibility(document), privateTemplate = props.some(prop => !visibility.prop(prop))
  const licenseRef = command.licenseRef ?? props.flatMap(prop => prop.definitionRef ? [document.propDefinitions[prop.definitionRef.id].licenseRef] : prop.appearance.kind === 'image' ? [document.assets[prop.appearance.assetId].licenseRef] : []).at(0) ?? Object.values(document.propDefinitions)[0]?.licenseRef
  if (!licenseRef) throw new Error('新组合须有明确、已采用的许可。')
  const knownLicense = [...Object.values(document.assets), ...Object.values(document.propDefinitions), ...Object.values(document.prefabDefinitions), ...Object.values(document.materials)].some(item => item.licenseRef === licenseRef)
  if (!knownLicense) throw new Error('组合许可必须来自当前完整工程的已采用许可。')
  const members = props.map((prop, index) => {
    const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, roomId: _room, supportRef: _support, ...template } = cloneJson(prop)
    template.positionMm = { x: prop.positionMm.x - command.anchorMm.x, y: prop.positionMm.y - command.anchorMm.y }
    return { key: `member-${index + 1}`, propTemplate: template }
  })
  document.prefabDefinitions[command.definitionId] = { id: command.definitionId, catalogId: command.definitionId, version: 1, licenseRef, origin: { kind: 'original', attribution: 'Sceneweave user composition; member assets retain their individual provenance and licenses.', canEmbed: true }, name: command.name, tags: command.tags ?? [], members }
  document.prefabInstances[command.id] = { id: command.id, floorId, editLocked: false, visibility: privateTemplate ? 'gm' : 'public', definitionRef: { id: command.definitionId, version: 1 }, anchorMm: cloneJson(command.anchorMm), rotationDeg: 0, members: Object.fromEntries(members.map((member, index) => [member.key, { propId: props[index].id, overrideFields: [] }])) }
  document.entityLayers[command.id] = layerId
  graph.prefabAppearanceTemplates[command.definitionId] = { definitionRef: { id: command.definitionId, version: 1 }, visibility: privateTemplate ? 'gm' : 'public', members: {} }
  for (let index = 0; index < props.length; index++) {
    const prop = props[index], frozen = freezeEffectivePropAppearance(content, prop.id, prop)
    // The reusable fixed template captures this selection, never a live link to its old layer.
    Object.assign(graph.sources, frozen.appearance.sources)
    if (graph.version === 2) Object.assign(graph.presentations!, frozen.appearance.presentations)
    graph.prefabAppearanceTemplates[command.definitionId].members[members[index].key] = { sourceId: frozen.appearance.propSources[prop.id], adjustments: frozen.appearance.instanceAdjustments[prop.id] }
  }
  return props.length + 2
}

function instantiate(content: CompositionContent, command: Extract<CompositionCommand, { type: 'instantiatePrefab' }>): number {
  const document = content.document, graph = content.appearance, definition = required(document.prefabDefinitions, command.definitionRef.id, '固定组合定义')
  if (definition.version !== command.definitionRef.version) throw new Error('组合固定定义版本不匹配。')
  const template = required(graph.prefabAppearanceTemplates, definition.id, '组合外观模板'), layer = required(document.userLayers, command.layerId, '用户图层')
  if (layer.editLocked) throw new Error('目标图层已锁定。')
  assertFresh(content, command.id); assertSupport(document, layer.floorId, command.supportRef)
  if (!memberIdsMatch(definition.members.map(member => member.key), command.memberIds) || Object.values(command.memberIds).includes(command.id)) throw new Error('组合放置须为每个固定成员明确给出不同新ID。')
  const rotation = command.rotationDeg ?? 0, privatePlacement = template.visibility === 'gm' || !createPublicVisibility(document).surface(command.supportRef)
  document.prefabInstances[command.id] = { id: command.id, floorId: layer.floorId, editLocked: false, visibility: privatePlacement ? 'gm' : 'public', definitionRef: cloneJson(command.definitionRef), anchorMm: cloneJson(command.anchorMm), rotationDeg: rotation, members: {} }
  document.entityLayers[command.id] = layer.id
  for (const member of definition.members) {
    const id = command.memberIds[member.key]; assertFresh(content, id)
    const prop: Prop = { ...cloneJson(member.propTemplate), id, floorId: layer.floorId, editLocked: false, visibility: privatePlacement ? 'gm' : 'public', supportRef: cloneJson(command.supportRef), ...(command.supportRef.kind === 'room' ? { roomId: command.supportRef.id } : {}), positionMm: transformed(member.propTemplate.positionMm, command.anchorMm, rotation), rotationDeg: graph.presentations?.[template.members[member.key].sourceId]?.mode === 'nearSide' ? 0 : angle(member.propTemplate.rotationDeg + rotation) }
    prop.renderOrder = topOrder(document, prop); document.props[id] = prop; document.entityLayers[id] = layer.id
    document.prefabInstances[command.id].members[member.key] = { propId: id, overrideFields: [] }
    graph.propSources[id] = template.members[member.key].sourceId; graph.instanceAdjustments[id] = cloneJson(template.members[member.key].adjustments)
  }
  return definition.members.length + 1
}
function duplicate(content: CompositionContent, command: Extract<CompositionCommand, { type: 'duplicatePrefab' }>): number {
  const document = content.document, graph = content.appearance, source = required(document.prefabInstances, command.id, '组合'), entries = Object.entries(source.members).filter(([, member]) => member.propId !== null)
  if (!memberIdsMatch(entries.map(([key]) => key), command.memberIds) || Object.values(command.memberIds).includes(command.newId)) throw new Error('复制组合须为实际活成员明确给出不同新ID；已删除槽保持删除。')
  assertUnlocked(document, [source.id, ...entries.map(([, member]) => member.propId!) ]); assertFresh(content, command.newId)
  const visibility = createPublicVisibility(document), group = cloneJson(source)
  group.id = command.newId; group.editLocked = false; group.anchorMm = { x: source.anchorMm.x + command.offsetMm.x, y: source.anchorMm.y + command.offsetMm.y }
  document.prefabInstances[group.id] = group; document.entityLayers[group.id] = document.entityLayers[source.id]
  const ranks = { ground: 0, object: 1, canopy: 2 }
  entries.sort(([, a], [, b]) => { const x = document.props[a.propId!], y = document.props[b.propId!]; return ranks[x.renderLayer] - ranks[y.renderLayer] || x.renderOrder - y.renderOrder || x.id.localeCompare(y.id) })
  for (const [key, member] of entries) {
    const original = document.props[member.propId!], id = command.memberIds[key]; assertFresh(content, id)
    assertSupport(document, original.floorId, original.supportRef)
    if (original.roomId !== undefined) assertSupport(document, original.floorId, { kind: 'room', id: original.roomId })
    const prop = cloneJson(original); prop.id = id; prop.editLocked = false
    prop.positionMm = { x: original.positionMm.x + command.offsetMm.x, y: original.positionMm.y + command.offsetMm.y }
    if (!visibility.prop(original)) prop.visibility = 'gm'
    prop.renderOrder = topOrder(document, prop); document.props[id] = prop; document.entityLayers[id] = document.entityLayers[original.id]
    group.members[key].propId = id; graph.propSources[id] = graph.propSources[original.id]
    if (own(graph.instanceAdjustments, original.id)) graph.instanceAdjustments[id] = cloneJson(graph.instanceAdjustments[original.id])
  }
  return entries.length + 1
}
function resetMember(content: CompositionContent, command: Extract<CompositionCommand, { type: 'resetPrefabMember' }>): number {
  const document = content.document, graph = content.appearance, group = required(document.prefabInstances, command.groupId, '组合'), member = required(group.members, command.key, '组合成员槽')
  const definition = document.prefabDefinitions[group.definitionRef.id], template = definition.members.find(member => member.key === command.key)!
  const current = member.propId === null ? undefined : required(document.props, member.propId, '成员物件')
  assertUnlocked(document, [group.id, ...(current ? [current.id] : [])])
  if (current && command.newId !== undefined) throw new Error('现有成员重置须保留原身份。')
  if (!current && (!command.newId || !command.supportRef)) throw new Error('已删除成员重建须明确新ID和支撑表面。')
  const id = current?.id ?? command.newId!, support = command.supportRef ?? current!.supportRef
  if (!current) assertFresh(content, id)
  assertSupport(document, group.floorId, support)
  const visibility = createPublicVisibility(document)
  const privatePlacement = group.visibility === 'gm' || graph.prefabAppearanceTemplates[definition.id].visibility === 'gm' || (current !== undefined && !visibility.prop(current)) || !visibility.surface(support)
  const prop: Prop = { ...cloneJson(template.propTemplate), id, floorId: group.floorId, editLocked: false, supportRef: cloneJson(support), ...(support.kind === 'room' ? { roomId: support.id } : {}), visibility: privatePlacement ? 'gm' : 'public', positionMm: transformed(template.propTemplate.positionMm, group.anchorMm, group.rotationDeg), rotationDeg: graph.presentations?.[graph.prefabAppearanceTemplates[definition.id].members[command.key].sourceId]?.mode === 'nearSide' ? 0 : angle(template.propTemplate.rotationDeg + group.rotationDeg) }
  prop.renderOrder = current?.renderOrder ?? topOrder(document, prop); document.props[id] = prop; document.entityLayers[id] = document.entityLayers[group.id]
  group.members[command.key] = { propId: id, overrideFields: [] }
  const appearance = graph.prefabAppearanceTemplates[definition.id].members[command.key]
  graph.propSources[id] = appearance.sourceId; graph.instanceAdjustments[id] = cloneJson(appearance.adjustments)
  return 2
}

/** Pure draft only. IO must materialize required bytes, resolve and fully validate before adoption. */
export function applyCompositionCommands(input: CompositionContent, inputCommands: readonly CompositionCommand[], context: PreparationContext): CompositionContent {
  return applyCompositionCommandsInternal(input, inputCommands, context, false)
}
export interface CompositionOperationAccounting {
  /** Internal same-transaction fixed-source additions; never persisted in the document. */
  initialOperationCost?: number
  onOperationCost?: (cost: number) => void
}
/** Internal immutable draft only; complete resolving/materialization is still mandatory. */
export function applyCompositionDraftCommands(input: CompositionContent, inputCommands: readonly CompositionCommand[], context: PreparationContext, accounting?: CompositionOperationAccounting): CompositionContent {
  return applyCompositionCommandsInternal(input, inputCommands, context, true, accounting)
}
function applyCompositionCommandsInternal(input: CompositionContent, inputCommands: readonly CompositionCommand[], context: PreparationContext, ownedDraft: boolean, accounting?: CompositionOperationAccounting): CompositionContent {
  const initialCost = accounting?.initialOperationCost === undefined ? 0 : accounting.initialOperationCost
  if (!Number.isSafeInteger(initialCost) || initialCost < 0 || initialCost > 256) throw new Error('初始事务预算须为0–256安全整数。')
  const source = ownedDraft ? certifyCompositionContent(input) : validateCompositionContent(input), issue = inspectJsonInput(inputCommands)
  if (issue) throw new Error(`组合指令无效：${issue.message}`)
  const parsed = schemas.safeParse(inputCommands)
  if (!parsed.success) throw new Error(`组合指令无效，单事务最多256条：${parsed.error.issues.map(issue => issue.message).join('；')}`)
  const commands = parsed.data as CompositionCommand[]
  for (const command of commands) if (['createTerrainArea', 'createTerrainEdge', 'createTerrainConnection', 'createPath', 'createScatter', 'createRegion'].includes(command.type) && 'id' in command) assertFresh(source, command.id)
  if (!commands.length) { accounting?.onOperationCost?.(initialCost); return source }
  const isComposition = commands.map(command => c3Types.has(command.type))
  if (isComposition.some(Boolean) && isComposition.some(value => !value)) throw new Error('外观/组件操作与普通场景操作须分别预览采用，不能混批绕过锁或资源准备。')
  // Ordinary commands own their new scene below; do not clone a scene that is
  // immediately replaced. Composition commands still require mutable members.
  let content = ownedDraft && !isComposition[0]
    ? { document: source.document, historyIdentity: source.historyIdentity, appearance: source.appearance }
    : cloneJson(source), cost = 0, generationCost = 0
  const identityTrace = createHistoryIdentityTrace(source.historyIdentity, source.document, context)
  const consume = (value: number) => { cost += value; if (initialCost + cost + generationCost > 256) throw new Error('展开后的组合事务超过256条操作预算，不能拆批绕过。') }
  if (!isComposition[0]) {
    const sceneCommands = commands as SceneCommand[]
    // Position/rotation and member overrides cannot change fixed sources,
    // mappings, presentations or adjustments. Only this owned, fully checked
    // input may carry the unchanged graph through to final draft validation.
    const unchangedAppearance = ownedDraft && sceneCommands.every(command => command.type === 'updateProp')
    const fixedUprightPropIds = new Set(Object.keys(source.document.props).filter(id => propPresentation(source.appearance, id)?.mode === 'nearSide'))
    let accounting = source
    const observer = { fixedUprightPropIds, onSceneDraft: (draft: Readonly<SceneDocument>, command: Readonly<SceneCommand>, commandCost: number) => {
      if (source.document.schemaVersion === 4) {
        // The observer's draft is reused by later commands; retain an owned
        // scene snapshot for the next per-command cost comparison.
        const snapshot = { document: draft as SceneDocument, historyIdentity: identityTrace.finish(draft as SceneDocument), appearance: accounting.appearance }
        const next = unchangedAppearance ? { ...snapshot, document: cloneJson(snapshot.document) }
          : syncAppearanceGraph(snapshot, accounting.document, [command])
        const estimated = terrainCommandCost(accounting.document, draft as SceneDocument)
        const actual = terrainCommandCost(accounting.document, next.document, { before: accounting, after: next })
        const physicalCost = commandCost - (estimated.total - estimated.items.physicalAndVisual)
        consume(Math.max(1, physicalCost, actual.items.physicalAndVisual) + actual.total - actual.items.physicalAndVisual)
        accounting = next
      } else {
        if (source.document.schemaVersion >= 3) consume(commandCost)
        identityTrace.observe(draft)
      }
    } }
    content.document = ownedDraft
      ? applySnapshotCommands(source.document, sceneCommands, context, { ...observer, preserveNoopIdentity: false })
      : applyCommands(source.document, sceneCommands, context, observer)
    if (source.document.schemaVersion < 3) {
      const previousEntities = new Map(enumerateLayerEntities(source.document).map(entity => [entity.id, entity]))
      const currentEntities = new Map(enumerateLayerEntities(content.document).map(entity => [entity.id, entity]))
      const equalEntity = ownedDraft ? equalOwnedEntity : equalCompositionValue
      const changed = new Set([...previousEntities.keys(), ...currentEntities.keys()].filter(id => !equalEntity(previousEntities.get(id), currentEntities.get(id))))
      // Relationship-only operations still touch their members even when their JSON is otherwise unchanged.
      for (const command of sceneCommands) if (command.type === 'unpackPrefab') {
        changed.add(command.id)
        for (const member of Object.values(source.document.prefabInstances[command.id]?.members ?? {})) if (member.propId !== null) changed.add(member.propId)
      }
      consume(Math.max(commands.length, changed.size))
    }
    content = source.document.schemaVersion === 4 ? accounting : unchangedAppearance ? content : ownedDraft
      ? syncAppearanceGraphSnapshot(content, source.document, sceneCommands)
      : syncAppearanceGraph(content, source.document, sceneCommands)
  } else {
    const appearanceOnly = commands.every(command => ['setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment', 'setAppearanceSource'].includes(command.type))
    const anyAppearance = commands.some(command => ['setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment', 'setAppearanceSource'].includes(command.type))
    if (anyAppearance && !appearanceOnly) throw new Error('新外观派生须先完成资源准备，再保存/放置固定组合。')
    for (const command of commands) {
      const beforeTerrain = content.document.schemaVersion >= 3 ? cloneJson(content) : null, beforeCost = cost
      switch (command.type) {
        case 'setAppearanceAdjustment': case 'toggleAppearanceAdjustment': case 'removeAppearanceAdjustment': {
          const graph = content.appearance, record = command.scope.kind === 'layer' ? graph.layerAdjustments : graph.instanceAdjustments
          let kinds: AdjustmentKind[]
          if (command.type === 'setAppearanceAdjustment') kinds = [command.adjustment.kind]
          else {
            const keys = command.scope.kind === 'layer' ? [command.scope.layerId] : inspectAppearanceScope(content, command.scope).targetIds
            kinds = [...new Set(keys.map(key => {
              const existing = (record[key] ?? []).find(item => item.id === command.adjustmentId)
              if (!existing) throw new Error(`调整记录不存在：${key}/${command.adjustmentId}。`)
              return existing.kind
            }))]
          }
          const plan = inspectAppearanceScope(content, command.scope, kinds); consume(plan.commandCost)
          const keys = command.scope.kind === 'layer' ? [command.scope.layerId] : plan.targetIds
          for (const key of keys) {
            const list = record[key] ?? [], adjustmentId = command.type === 'setAppearanceAdjustment' ? command.adjustment.id : command.adjustmentId, existing = list.find(item => item.id === adjustmentId)
            const enabledAdjustment = command.type === 'setAppearanceAdjustment' ? (command.adjustment.enabled ? command.adjustment : undefined) : command.type === 'toggleAppearanceAdjustment' && command.enabled ? existing : undefined
            if (enabledAdjustment?.kind === 'opacity' && enabledAdjustment.value !== 1 && plan.targetIds.some(id => Object.hasOwn(content.appearance.surfaceSources, id))) throw new Error('严格场景材质底面必须完全不透明；包含材质表面的范围不能采用小于1的透明度。')
            if (command.type === 'setAppearanceAdjustment') {
              if (existing && existing.kind !== command.adjustment.kind) throw new Error('调整记录的固定ID不能改为另一属性。')
              record[key] = [...list.filter(item => item.id !== adjustmentId).map(item => command.adjustment.enabled && item.kind === command.adjustment.kind ? { ...item, enabled: false } : item), cloneJson(command.adjustment)]
            } else if (command.type === 'toggleAppearanceAdjustment') {
              if (command.enabled) for (const item of list) if (item.kind === existing!.kind) item.enabled = false
              existing!.enabled = command.enabled
            }
            else record[key] = list.filter(item => item.id !== adjustmentId)
          }
          if (command.scope.kind === 'targets') plan.targetIds.forEach(id => memberOverrides(content.document, id))
          break
        }
        case 'setAppearanceSource': {
          const sourceNode = required(content.appearance.sources, command.sourceId, '固定外观源'), plan = inspectAppearanceScope(content, { kind: 'targets', ids: command.ids })
          consume(plan.commandCost)
          for (const id of plan.targetIds) {
            if (sourceNode.kind === 'prop' && own(content.document.props, id)) content.appearance.propSources[id] = sourceNode.id
            else if (sourceNode.kind === 'surface' && !own(content.document.props, id)) content.appearance.surfaceSources[id] = sourceNode.id
            else throw new Error('外观源类型与显式目标不符。')
            memberOverrides(content.document, id)
          }
          break
        }
        case 'createPrefab': consume(createPrefab(content, command)); break
        case 'instantiatePrefab': consume(instantiate(content, command)); break
        case 'duplicatePrefab': consume(duplicate(content, command)); break
        case 'resetPrefabMember': consume(resetMember(content, command)); break
        case 'detachPrefabMember': {
          const group = required(content.document.prefabInstances, command.groupId, '组合'), prop = required(content.document.props, command.propId, '成员物件'), member = Object.values(group.members).find(member => member.propId === prop.id)
          if (!member) throw new Error('此物件不是指定组合的活成员。')
          assertUnlocked(content.document, [group.id, prop.id]); consume(2)
          if (!createPublicVisibility(content.document).prop(prop)) prop.visibility = 'gm'
          member.propId = null
          break
        }
        case 'deletePrefab': {
          const document = content.document, group = required(document.prefabInstances, command.id, '组合'), live = Object.values(group.members).flatMap(member => member.propId ?? [])
          if (command.memberIds.length !== live.length || live.some(id => !command.memberIds.includes(id))) throw new Error('删除组合须明确确认全部当前活成员，不能隐式展开。')
          assertUnlocked(document, [group.id, ...live]); consume(live.length + 1)
          if (Object.values(document.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === group.id) || document.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityId === group.id))) throw new Error('组合仍有注记/路径依赖，不能删除。')
          content.document = live.length ? applyCommands(document, live.map(id => ({ type: 'deleteProp', id })), context) : document
          delete content.document.prefabInstances[group.id]; delete content.document.entityLayers[group.id]
          break
        }
        default: throw new Error('不支持的组合操作。')
      }
      if (beforeTerrain) {
        detachChangedAppearance(beforeTerrain, content)
        pauseChangedCompositionAppearance(beforeTerrain, content)
        if (content.document.schemaVersion === 4) content.historyIdentity = identityTrace.finish(content.document)
        const expanded = terrainCommandCost(beforeTerrain.document, content.document, { before: beforeTerrain, after: content })
        consume(Math.max(1, cost - beforeCost, expanded.items.physicalAndVisual) - (cost - beforeCost))
        generationCost += expanded.total - expanded.items.physicalAndVisual
        if (initialCost + cost + generationCost > 256) throw new Error('外观、实体与生成记录累计展开超过256条操作预算。')
      }
      if (content.document.schemaVersion !== 4) identityTrace.observe(content.document)
    }
    const beforeSync = content
    content = syncAppearanceGraph(content)
    if (content.document.schemaVersion === 4) {
      generationCost += terrainCommandCost(beforeSync.document, content.document, { before: beforeSync, after: content }).total
      if (initialCost + cost + generationCost > 256) throw new Error('固定源保全与组合事务累计展开超过256条操作预算。')
    }
  }
  let operationCost = cost + generationCost
  if (content.document.schemaVersion >= 3) {
    // Snapshot-command results can already be privately frozen. Detachment
    // owns a detached generation branch rather than mutating that witness.
    const beforeFinal = content
    content = { ...content, document: cloneJson(content.document) }
    detachChangedAppearance(source, content)
    pauseChangedCompositionAppearance(source, content)
    content.historyIdentity = identityTrace.finish(content.document)
    const finalDelta = terrainCommandCost(beforeFinal.document, content.document, { before: beforeFinal, after: content })
    generationCost += finalDelta.total - finalDelta.items.physicalAndVisual
    const expanded = terrainCommandCost(source.document, content.document, { before: source, after: content })
    operationCost = Math.max(cost + generationCost, expanded.total)
    if (initialCost + operationCost > 256) throw new Error('外观、实体与生成记录实际展开超过256条操作预算。')
  }
  content.historyIdentity = identityTrace.finish(content.document)
  const result = ownedDraft ? certifyCompositionDraft(content) : validateCompositionDraft(content)
  accounting?.onOperationCost?.(initialCost + operationCost)
  return result
}
