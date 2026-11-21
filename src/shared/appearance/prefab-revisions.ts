import { z } from 'zod'
import type { CompositionContent } from '../model/appearance.js'
import type { PrefabDefinition, PropTemplate, SceneDocument } from '../model/scene.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { id } from '../validation/primitives.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { captureEffectivePropAppearance, equalCompositionValue, propAppearanceSnapshot } from './graph.js'

const revisionField = z.enum(['sightOccluder', 'appearance'])
const revisionChange = z.object({ key: id, field: revisionField }).strict()
export type PrefabRevisionChange = z.infer<typeof revisionChange>
const appearanceFields = ['definitionRef', 'appearance', 'visualBoundsMm', 'shadowClass', 'shadowOverride'] as const
const appearanceFieldSet: ReadonlySet<string> = new Set(appearanceFields)

function equalSight(before: PropTemplate, after: PropTemplate) {
  return equalCompositionValue(before.sightOccluder ?? null, after.sightOccluder ?? null)
}

function unchangedMemberFields(template: PropTemplate) {
  return Object.fromEntries(Object.entries(template).filter(([field]) => field !== 'sightOccluder' && !appearanceFieldSet.has(field)))
}

function equalFixedAppearance(content: CompositionContent, a: PrefabDefinition, b: PrefabDefinition, key: string) {
  const before = content.appearance.prefabAppearanceTemplates[a.id].members[key]
  const after = content.appearance.prefabAppearanceTemplates[b.id].members[key]
  return equalCompositionValue(before, after)
}

export const publishPrefabRevisionSchema = z.object({
  type: z.literal('publishPrefabRevision'), id, definitionId: id,
  version: z.number().int().positive(),
  changes: z.array(revisionChange).min(1).max(256)
    .refine(changes => new Set(changes.map(({ key, field }) => JSON.stringify([key, field]))).size === changes.length),
}).strict()
export const syncPrefabRevisionSchema = z.object({
  type: z.literal('syncPrefabRevision'), id, definitionId: id,
}).strict()
export type PublishPrefabRevision = z.infer<typeof publishPrefabRevisionSchema>
export type SyncPrefabRevision = z.infer<typeof syncPrefabRevisionSchema>

export function samePrefabFamily(a: PrefabDefinition, b: PrefabDefinition) {
  return a.catalogId === b.catalogId && canonicalJson(a.origin) === canonicalJson(b.origin)
}

export function latestPrefabDefinition(scene: SceneDocument, base: PrefabDefinition): PrefabDefinition {
  return Object.values(scene.prefabDefinitions).reduce((latest, definition) =>
    samePrefabFamily(base, definition) && definition.version > latest.version ? definition : latest, base)
}

function groupAndDefinition(scene: SceneDocument, id: string) {
  const group = Object.hasOwn(scene.prefabInstances, id) ? scene.prefabInstances[id] : undefined
  const base = group && scene.prefabDefinitions[group.definitionRef.id]
  if (!group || !base || base.pathStyle) throw new Error('请选择由固定模块定义创建的组合。')
  return { group, base }
}

export function changedPrefabRevisionMembers(scene: SceneDocument, id: string) {
  const { group, base } = groupAndDefinition(scene, id)
  const changes: (PrefabRevisionChange & { propId: string })[] = []
  for (const { key, propTemplate } of base.members) {
    const { propId, overrideFields } = group.members[key]
    const prop = propId ? scene.props[propId] : undefined
    if (!prop) continue
    if (!equalSight(propTemplate, prop)) changes.push({ key, propId: prop.id, field: 'sightOccluder' })
    if (overrideFields.some(field => appearanceFieldSet.has(field)) &&
        !equalCompositionValue(propAppearanceSnapshot(propTemplate), propAppearanceSnapshot(prop))) {
      changes.push({ key, propId: prop.id, field: 'appearance' })
    }
  }
  return changes
}

export function publishPrefabRevision(content: CompositionContent, command: PublishPrefabRevision) {
  const scene = content.document
  const { group, base } = groupAndDefinition(scene, command.id)
  const changes = changedPrefabRevisionMembers(scene, group.id)
  const latest = latestPrefabDefinition(scene, base)
  if (latest.version + 1 !== command.version) {
    throw new Error('模块版本已更新，请重新准备新版。')
  }
  const result = cloneJson(latest)
  result.id = command.definitionId
  result.version = command.version
  const template = cloneJson(content.appearance.prefabAppearanceTemplates[latest.id])
  template.definitionRef = { id: result.id, version: result.version }
  const visibility = createPublicVisibility(scene)
  for (const { key, field } of command.changes) {
    const change = changes.find(change => change.key === key && change.field === field)
    if (!change) throw new Error(`成员 ${key} 的所选改动已变化，请重新选择要发布的内容。`)
    const member = result.members.find(member => member.key === key)
    const original = base.members.find(member => member.key === key)!
    if (!member) throw new Error(`最新版已移除成员 ${key}。请同步后重新选择发布内容。`)
    const concurrent = field === 'sightOccluder' ? !equalSight(original.propTemplate, member.propTemplate)
      : !equalFixedAppearance(content, base, latest, key)
    if (concurrent) throw new Error(`最新版也修改了成员 ${key} 的${field === 'appearance' ? '外观' : '视线遮挡'}。请先同步并检查改动。`)
    const prop = scene.props[change.propId], isPublic = visibility.prop(prop)
    if (field === 'sightOccluder') {
      if (prop.sightOccluder) member.propTemplate.sightOccluder = {
        ...cloneJson(prop.sightOccluder), visibility: isPublic ? prop.sightOccluder.visibility : 'gm',
      }
      else delete member.propTemplate.sightOccluder
    } else {
      if (!isPublic && template.visibility === 'public') throw new Error(`成员 ${key} 的外观属于主持人内容。请保存为独立的主持人模块。`)
      Object.assign(member.propTemplate, propAppearanceSnapshot(prop))
      template.members[key] = captureEffectivePropAppearance(content, prop.id, prop)
    }
  }
  scene.prefabDefinitions[result.id] = result
  content.appearance.prefabAppearanceTemplates[result.id] = template
  return 1 + command.changes.length
}

export function planPrefabRevisionSync(content: CompositionContent, command: SyncPrefabRevision) {
  const scene = content.document, { group, base } = groupAndDefinition(scene, command.id)
  if (group.editLocked || scene.userLayers[scene.entityLayers[group.id]]?.editLocked) throw new Error('组合或图层已锁定。')
  const next = Object.hasOwn(scene.prefabDefinitions, command.definitionId) ? scene.prefabDefinitions[command.definitionId] : undefined
  if (!next || !samePrefabFamily(base, next) || next.version <= base.version || next.pathStyle) throw new Error('请选择同一模块的更新版本。')
  const currentAppearance = content.appearance.prefabAppearanceTemplates[base.id]
  const nextAppearance = content.appearance.prefabAppearanceTemplates[next.id]
  if (currentAppearance.visibility !== nextAppearance.visibility) throw new Error('模块版本的可见范围已变化，请选择适用于当前画布的版本。')
  const previous = new Map(base.members.map(member => [member.key, member.propTemplate]))
  const upcoming = new Map(next.members.map(member => [member.key, member.propTemplate]))
  const changes: (PrefabRevisionChange & { propId: string | null; outcome: 'apply' | 'manual' | 'locked' | 'deleted' })[] = []
  for (const key of new Set([...previous.keys(), ...upcoming.keys()])) {
    const before = previous.get(key), after = upcoming.get(key)
    if (!before || !after || !equalCompositionValue(unchangedMemberFields(before), unchangedMemberFields(after))) {
      throw new Error(`模块新版的成员 ${key} 有结构改动。请检查该成员的新增、移除或位置。`)
    }
    const sightChanged = !equalSight(before, after)
    const appearanceChanged = !equalFixedAppearance(content, base, next, key)
    if (!sightChanged && !appearanceChanged) continue
    const { propId, overrideFields } = group.members[key], prop = propId ? scene.props[propId] : undefined
    const preserved = !prop ? 'deleted' : effectiveEditLocked(scene, prop.id) ? 'locked' : null
    if (sightChanged) changes.push({ key, field: 'sightOccluder', propId, outcome: preserved ??
      (overrideFields.includes('sightOccluder') || !equalSight(before, prop!) ? 'manual' : 'apply') })
    if (appearanceChanged) changes.push({ key, field: 'appearance', propId, outcome: preserved ??
      (overrideFields.some(field => appearanceFieldSet.has(field)) ||
        !equalCompositionValue(propAppearanceSnapshot(before), propAppearanceSnapshot(prop!)) ? 'manual' : 'apply') })
  }
  return changes
}

export function syncPrefabRevision(content: CompositionContent, command: SyncPrefabRevision) {
  const changes = planPrefabRevisionSync(content, command), scene = content.document
  const group = scene.prefabInstances[command.id], next = scene.prefabDefinitions[command.definitionId]
  const templates = new Map(next.members.map(member => [member.key, member.propTemplate]))
  const graph = content.appearance, appearance = graph.prefabAppearanceTemplates[next.id]
  let cost = 1
  for (const { key, field, propId, outcome } of changes) {
    if (!propId) continue
    const member = group.members[key], prop = scene.props[propId]
    if (outcome === 'apply') {
      if (field === 'sightOccluder') {
        const active = templates.get(key)!.sightOccluder
        if (active) prop.sightOccluder = cloneJson(active)
        else delete prop.sightOccluder
      } else {
        const template = appearance.members[key]
        graph.propSources[propId] = template.sourceId
        graph.instanceAdjustments[propId] = cloneJson(template.adjustments)
      }
      cost++
    } else {
      const fields = field === 'appearance' ? appearanceFields : ['sightOccluder'] as const
      const added = fields.filter(field => !member.overrideFields.includes(field))
      if (added.length) { member.overrideFields.push(...added); cost++ }
    }
  }
  group.definitionRef = { id: next.id, version: next.version }
  return cost
}
