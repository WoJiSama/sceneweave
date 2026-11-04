import { z } from 'zod'
import type { Decoration, DecorationCluster, Editable, PointMm, SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import type { AppearanceGraph } from '../model/appearance.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { polygonDistance, polygonInside, terrainPoints } from '../geometry/geometry.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { decorationClusterSchema, decorationSchema } from './contracts.js'
import { buildDecorationRegeneration, decorationProtectedGeometry } from './generate.js'
import { decorationClusterRecords, decorationFootprint, decorationRecords } from './geometry.js'
import { decorationMemberOwner } from './validation.js'

const id = z.string().min(1).max(128).refine(value => value !== '__proto__')
const point = z.object({ x: z.number().int().refine(Number.isSafeInteger), y: z.number().int().refine(Number.isSafeInteger) }).strict()
export const decorationCommandSchemas = [
  decorationClusterSchema.omit({ members: true, editLocked: true, algorithmVersion: true }).extend({ type: z.literal('createDecorationCluster'), layerId: id }).strict(),
  z.object({ type: z.literal('createCanopyRegion'), id, floorId: id, layerId: id, visibility: z.enum(['public', 'gm']),
    supportRef: z.object({ kind: z.literal('terrainArea'), id }).strict(), regionsMm: z.array(z.array(point).min(3).max(512)).min(1).max(128),
    definitionRef: z.object({ id, version: z.number().int().positive() }).strict(), seed: z.string().min(1).max(128),
    mode: z.enum(['plant', 'erase']), canopyCoveragePpm: z.number().int().min(0).max(1_000_000),
    spacingMm: z.number().int().positive(), clusterRadiusMm: z.number().int().positive(), clearanceMm: z.number().int().positive(),
  }).strict(),
  z.object({ type: z.literal('updateCanopyRegion'), id, mode: z.enum(['plant', 'erase']), canopyCoveragePpm: z.number().int().min(0).max(1_000_000) }).strict(),
  z.object({ type: z.literal('regenerateDecorationCluster'), id }).strict(),
  z.object({ type: z.literal('updateDecoration'), id, changes: decorationSchema.pick({ positionMm: true, rotationDeg: true, scalePpm: true, renderOrder: true, visibility: true, supportRef: true }).partial().strict() }).strict(),
  z.object({ type: z.literal('deleteDecoration'), id }).strict(),
  z.object({ type: z.literal('detachDecorationMember'), clusterId: id, entityId: id }).strict(),
  z.object({ type: z.literal('deleteDecorationCluster'), id }).strict(),
] as const
export type DecorationCommand = z.infer<typeof decorationCommandSchemas[number]>
const types = new Set(['createDecorationCluster', 'createCanopyRegion', 'updateCanopyRegion', 'regenerateDecorationCluster', 'updateDecoration', 'deleteDecoration', 'detachDecorationMember', 'deleteDecorationCluster'])
export const isDecorationCommand = (command: { type: string }): command is DecorationCommand => types.has(command.type)
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const allEntities = (scene: Readonly<SceneDocument>): Editable[] => ['vertices','rooms','walls','openings','props','regions','notes','terrainAreas','terrainEdges','terrainConnections','paths','prefabInstances','scatterGroups','decorations','decorationClusters'].flatMap(key => Object.values((scene as unknown as Record<string, Record<string, Editable>>)[key] ?? {}))
function unlocked(scene: Readonly<SceneDocument>, row: Editable) {
  if (row.editLocked || scene.userLayers[scene.entityLayers[row.id]]?.editLocked) throw new Error(`簇状布景涉及已锁定的实体或图层：${row.id}。`)
}
export function assertDecorationMemberUnlocked(scene: Readonly<SceneDocument>, id: string): void {
  const owner = decorationMemberOwner(scene, id)
  if (owner) {
    unlocked(scene, owner.cluster)
    const rule = Object.values(scene.surfaceRules ?? {}).find(row => row.field !== 'material' && row.clusterId === owner.cluster.id)
    if (rule) unlocked(scene, rule)
  }
}
function supportUnlocked(scene: Readonly<SceneDocument>, row: { supportRef: { kind: string; id: string } }) {
  const ref = row.supportRef, support = ref.kind === 'terrainArea' ? scene.terrainAreas[ref.id] : ref.kind === 'room' ? scene.rooms[ref.id] : null
  if (support) unlocked(scene, support)
}
/** Mark manual changes even when they enter through ordinary Prop/appearance commands. */
export function reconcileDecorationMembers(before: SceneDocument, after: SceneDocument): number {
  if (after.schemaVersion < 6) return 0
  let changes = 0
  for (const oldCluster of Object.values(decorationClusterRecords(before))) {
    const cluster = decorationClusterRecords(after)[oldCluster.id]
    if (!cluster) continue
    for (const [key, oldMember] of Object.entries(oldCluster.members)) {
      if (oldMember.state === 'deleted' || !oldMember.entityId) continue
      if (oldMember.state === 'detached') {
        const present = oldMember.kind === 'prop' ? after.props[oldMember.entityId] : decorationRecords(after)[oldMember.entityId]
        if (!present && cluster.members[key]?.entityId !== null) { cluster.members[key] = { ...cluster.members[key], entityId: null }; changes++ }
        continue
      }
      const old = oldMember.kind === 'prop' ? before.props[oldMember.entityId] : decorationRecords(before)[oldMember.entityId]
      const row = oldMember.kind === 'prop' ? after.props[oldMember.entityId] : decorationRecords(after)[oldMember.entityId]
      if (same(old, row) && before.entityLayers[oldMember.entityId] === after.entityLayers[oldMember.entityId]) continue
      unlocked(before, oldCluster)
      if (old && !(row && same({ ...old, editLocked: row.editLocked }, row) && before.entityLayers[old.id] === after.entityLayers[row.id])) { unlocked(before, old); supportUnlocked(before, old) }
      const member = cluster.members[key]
      if (!member) throw new Error('外部编辑不能隐式删除布景成员的人工记录。')
      const next = row ? { ...member, state: 'manual' as const } : { ...member, entityId: null, state: 'deleted' as const }
      if (!same(member, next)) { cluster.members[key] = next; changes++ }
    }
  }
  return changes
}

export interface DecorationImpact { changedIds: string[]; affectedIds: string[]; layerIds: string[]; commandCost: number }
/** Exact writes plus read-only support, world clearance and recursive annotation dependencies. */
export function inspectDecorationChanges(before: SceneDocument, after: SceneDocument): DecorationImpact {
  const changed = new Set<string>(), affected = new Set<string>(), layers = new Set<string>()
  let cost = 0
  for (const collection of ['props', 'decorations', 'decorationClusters'] as const) {
    const a = before[collection] ?? {}, b = after[collection] ?? {}
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[id], b[id]) || before.entityLayers[id] !== after.entityLayers[id]) { changed.add(id); cost++ }
  }
  for (const id of new Set([...Object.keys(decorationClusterRecords(before)), ...Object.keys(decorationClusterRecords(after))])) {
    const a = decorationClusterRecords(before)[id]?.members ?? {}, b = decorationClusterRecords(after)[id]?.members ?? {}
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[key], b[key])) {
      cost++
      if (a[key]?.entityId) affected.add(a[key].entityId!)
      if (b[key]?.entityId) affected.add(b[key].entityId!)
    }
  }
  for (const id of changed) affected.add(id)
  for (const scene of [before, after]) {
    const entities = new Map(allEntities(scene).map(row => [row.id, row]))
    for (const id of changed) {
      const row = entities.get(id) as (Editable & { supportRef?: { id: string } }) | undefined
      if (row?.supportRef) affected.add(row.supportRef.id)
      const owner = decorationMemberOwner(scene, id); if (owner) affected.add(owner.cluster.id)
    }
    for (const cluster of Object.values(decorationClusterRecords(scene))) if (changed.has(cluster.id) || Object.values(cluster.members).some(member => member.state === 'managed' && member.entityId && changed.has(member.entityId))) {
      affected.add(cluster.supportRef.id)
      const b = cluster.boundsMm, bounds = [{ x:b.x,y:b.y },{ x:b.x+b.width,y:b.y },{ x:b.x+b.width,y:b.y+b.height },{ x:b.x,y:b.y+b.height }]
      const reach = Math.max(1, ...cluster.palette.map(item => { const v = scene.propDefinitions[item.definitionRef.id]?.defaultVisualBoundsMm; return v ? Math.hypot(v.width, v.height) * 1.5 : 1 }))
      for (const record of decorationProtectedGeometry(scene, cluster)) if (polygonDistance(record.polygon, bounds) <= record.marginMm + reach) affected.add(record.id)
      const visible = createPublicVisibility(scene), publicOnly = cluster.visibility === 'public'
      for (const prop of Object.values(scene.props)) if (prop.floorId === cluster.floorId && (!publicOnly || visible.prop(prop)) && polygonDistance([{ x:prop.positionMm.x-1,y:prop.positionMm.y-1 },{ x:prop.positionMm.x+1,y:prop.positionMm.y-1 },{ x:prop.positionMm.x+1,y:prop.positionMm.y+1 },{ x:prop.positionMm.x-1,y:prop.positionMm.y+1 }], bounds) <= reach + cluster.spacingMm) affected.add(prop.id)
      for (const row of Object.values(decorationRecords(scene))) if (row.floorId === cluster.floorId && (!publicOnly || visible.decoration(row)) && polygonDistance(decorationFootprint(scene, row), bounds) <= reach + cluster.spacingMm) affected.add(row.id)
    }
    let added = true
    while (added) { added = false; for (const note of Object.values(scene.notes)) if (note.anchor.type === 'entity' && affected.has(note.anchor.entityId) && !affected.has(note.id)) { affected.add(note.id); added = true } }
    for (const id of affected) if (scene.entityLayers[id]) layers.add(scene.entityLayers[id])
  }
  return { changedIds: [...changed].sort(), affectedIds: [...affected].sort(), layerIds: [...layers].sort(), commandCost: cost }
}

export function applyDecorationCommand(scene: SceneDocument, command: DecorationCommand, context: PreparationContext, appearance?: AppearanceGraph): DecorationImpact {
  if (scene.schemaVersion < 6) throw new Error('轻量装饰与簇状布景需要显式完整v6或更新副本。')
  const before = cloneJson(scene), decorations = scene.decorations!, clusters = scene.decorationClusters!
  const requireDecoration = (id: string) => { const row = decorations[id]; if (!row) throw new Error(`轻量装饰不存在：${id}。`); unlocked(before, row); assertDecorationMemberUnlocked(before, id); supportUnlocked(before, row); return row }
  const requireCluster = (id: string) => { const row = clusters[id]; if (!row) throw new Error(`簇状布景不存在：${id}。`); unlocked(before, row); supportUnlocked(before, row); return row }
  const install = (cluster: DecorationCluster) => {
    const result = buildDecorationRegeneration(scene, cluster, context, appearance)
    for (const id of result.removePropIds) { delete scene.props[id]; delete scene.entityLayers[id] }
    for (const id of result.removeDecorationIds) { delete decorations[id]; delete scene.entityLayers[id] }
    for (const row of result.props) { scene.props[row.id] = row; scene.entityLayers[row.id] = scene.entityLayers[cluster.id] }
    for (const row of result.decorations) { decorations[row.id] = row; scene.entityLayers[row.id] = scene.entityLayers[cluster.id] }
    clusters[cluster.id] = result.cluster
    if (!cluster.canopyRule && !Object.values(result.cluster.members).some(member => member.entityId && member.state !== 'detached')) throw new Error('当前范围、素材尺度及净空没有可采用的布景实例；请调整范围或来源。')
  }
  const reflowCanopyRules = (areaId: string, visibility: DecorationCluster['visibility']) => {
    const ordered = Object.values(clusters).filter(cluster => cluster.canopyRule?.channel === 'trees' && cluster.visibility === visibility
      && cluster.supportRef.kind === 'terrainArea' && cluster.supportRef.id === areaId)
      .sort((a, b) => a.canopyRule!.paintOrder - b.canopyRule!.paintOrder || a.id.localeCompare(b.id))
    for (const cluster of ordered) { unlocked(scene, cluster); supportUnlocked(scene, cluster) }
    for (const cluster of ordered) install(cluster)
  }
  const regionBounds = (regions: PointMm[][]) => {
    const points = regions.flat(), xs = points.map(point => point.x), ys = points.map(point => point.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  switch (command.type) {
    case 'createDecorationCluster': {
      if (geometryIdentityIds(scene).has(command.id) || scene.userLayers[command.id]) throw new Error('新布景簇必须使用未分配的独立ID。')
      const layer = scene.userLayers[command.layerId]
      if (!layer || layer.floorId !== command.floorId || layer.editLocked) throw new Error('簇状布景须选择同Floor未锁定的用户图层。')
      const { type: _type, layerId, ...fields } = command
      const cluster: DecorationCluster = { ...cloneJson(fields), editLocked: false, algorithmVersion: 'cluster-v1', members: {} }
      supportUnlocked(before, cluster); clusters[cluster.id] = cluster; scene.entityLayers[cluster.id] = layerId; install(cluster)
      break
    }
    case 'createCanopyRegion': {
      if (scene.schemaVersion !== 7) throw new Error('树木区域规则需要显式完整v7副本。')
      if (geometryIdentityIds(scene).has(command.id) || scene.userLayers[command.id]) throw new Error('新树木区域须使用未分配的独立ID。')
      const layer = scene.userLayers[command.layerId], area = scene.terrainAreas[command.supportRef.id]
      if (!layer || layer.floorId !== command.floorId || layer.editLocked) throw new Error('树木区域须选择同Floor未锁定的用户图层。')
      if (!area || area.floorId !== command.floorId || area.editLocked || scene.userLayers[scene.entityLayers[area.id]]?.editLocked) throw new Error('树木区域须依赖同Floor未锁定地形面。')
      if (command.regionsMm.some(region => !polygonInside(region, terrainPoints(area)))) throw new Error('树木区域必须完整位于选定地形面内。')
      const definition = scene.propDefinitions[command.definitionRef.id]
      if (!definition || definition.version !== command.definitionRef.version || definition.defaultAppearance.kind !== 'image' || !definition.tags.some(tag => /tree|树/i.test(tag)) && !/tree|树/i.test(definition.name)) throw new Error('树木区域须引用工程内固定树木素材。')
      if (command.mode === 'erase' && command.canopyCoveragePpm !== 0) throw new Error('擦除树木规则的覆盖目标必须为0。')
      const paintOrder = Math.max(0, ...Object.values(clusters).filter(cluster => cluster.canopyRule?.channel === 'trees' && cluster.supportRef.kind === 'terrainArea' && cluster.supportRef.id === area.id).map(cluster => cluster.canopyRule!.paintOrder)) + 1
      const cluster: DecorationCluster = { id: command.id, floorId: command.floorId, editLocked: false, visibility: command.visibility,
        supportRef: cloneJson(command.supportRef), boundsMm: regionBounds(command.regionsMm), seed: command.seed, algorithmVersion: 'cluster-v1',
        palette: [{ key: 'tree', definitionRef: cloneJson(command.definitionRef), kind: 'prop', weight: 1 }], maxInstances: 64,
        spacingMm: command.spacingMm, clusterRadiusMm: command.clusterRadiusMm, clearanceMm: command.clearanceMm, members: {},
        canopyRule: { regionsMm: cloneJson(command.regionsMm), channel: 'trees', paintOrder, mode: command.mode, canopyCoveragePpm: command.canopyCoveragePpm } }
      supportUnlocked(before, cluster); clusters[cluster.id] = cluster; scene.entityLayers[cluster.id] = command.layerId
      reflowCanopyRules(area.id, command.visibility)
      break
    }
    case 'updateCanopyRegion': {
      const cluster = requireCluster(command.id)
      if (!cluster.canopyRule || cluster.supportRef.kind !== 'terrainArea') throw new Error('目标不是树木区域规则。')
      if (command.mode === 'erase' && command.canopyCoveragePpm !== 0) throw new Error('擦除规则的树冠覆盖目标必须为0。')
      cluster.canopyRule = { ...cluster.canopyRule, mode: command.mode, canopyCoveragePpm: command.canopyCoveragePpm }
      reflowCanopyRules(cluster.supportRef.id, cluster.visibility)
      break
    }
    case 'regenerateDecorationCluster': {
      const cluster = requireCluster(command.id)
      if (Object.values(before.surfaceRules ?? {}).some(rule => rule.field !== 'material' && rule.clusterId === cluster.id)) throw new Error('该簇由连续地表规则管理；请从规则入口调整并预览。')
      install(cluster); break
    }
    case 'updateDecoration': { const row = requireDecoration(command.id); Object.assign(row, cloneJson(command.changes)); supportUnlocked(scene, row); reconcileDecorationMembers(before, scene); break }
    case 'deleteDecoration': { requireDecoration(command.id); delete decorations[command.id]; delete scene.entityLayers[command.id]; reconcileDecorationMembers(before, scene); break }
    case 'detachDecorationMember': {
      const cluster = requireCluster(command.clusterId), entry = Object.values(cluster.members).find(member => member.entityId === command.entityId && member.state !== 'deleted' && member.state !== 'detached')
      if (!entry) throw new Error('退出成员必须属于该簇的当前活槽。')
      const row = entry.kind === 'prop' ? scene.props[command.entityId] : decorations[command.entityId]
      if (!row) throw new Error('退出成员实际实例缺失。')
      unlocked(before, row); supportUnlocked(before, row)
      if (cluster.visibility === 'gm' || !createPublicVisibility(scene).surface(cluster.supportRef)) row.visibility = 'gm'
      entry.state = 'detached'
      break
    }
    case 'deleteDecorationCluster': {
      const cluster = requireCluster(command.id)
      const reflowAreaId = cluster.canopyRule && cluster.supportRef.kind === 'terrainArea' ? cluster.supportRef.id : null
      for (const member of Object.values(cluster.members)) if (member.entityId && member.state !== 'detached' && member.state !== 'deleted') {
        const row = member.kind === 'prop' ? scene.props[member.entityId] : decorations[member.entityId]
        if (!row) throw new Error('布景成员实际实例缺失。')
        unlocked(before, row); supportUnlocked(before, row)
        if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === row.id) || scene.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityId === row.id))) throw new Error('布景成员仍有注记或路径依赖，不能隐式删除。')
        if (member.kind === 'prop') delete scene.props[row.id]; else delete decorations[row.id]
        delete scene.entityLayers[row.id]
      }
      delete clusters[cluster.id]; delete scene.entityLayers[cluster.id]
      if (reflowAreaId) reflowCanopyRules(reflowAreaId, cluster.visibility)
      break
    }
  }
  const impact = inspectDecorationChanges(before, scene)
  const detachedCleanupOnly = (id: string) => {
    const a = decorationClusterRecords(before)[id], b = decorationClusterRecords(scene)[id]
    if (!a || !b || !same({ ...a, members: b.members }, b) || Object.keys(a.members).length !== Object.keys(b.members).length) return false
    return Object.entries(a.members).every(([key, old]) => {
      const row = b.members[key]
      return same(old, row) || old.state === 'detached' && row?.state === 'detached' && row.entityId === null && same({ ...old, entityId: null }, row) && !!old.entityId && !(old.kind === 'prop' ? scene.props[old.entityId] : decorations[old.entityId])
    })
  }
  for (const id of impact.changedIds) {
    if (detachedCleanupOnly(id)) continue
    const row = allEntities(before).find(row => row.id === id)
    if (row) unlocked(before, row)
  }
  if (impact.commandCost > 256) throw new Error('轻量装饰、成员和人工记录实际展开超过256，不能拆批绕过。')
  return impact
}
