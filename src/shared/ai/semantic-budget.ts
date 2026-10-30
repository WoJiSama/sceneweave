import type { ProjectData } from '../model/project.js'
import { LAYER_ENTITY_COLLECTIONS, type SceneDocument } from '../model/scene.js'
import { visualBase } from '../visual/base.js'
import { canonicalJson } from '../validation/json.js'
import { CONTINUATION_POLICY } from './budget-policy.js'
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()
const deny = (message: string): never => { throw new Error(`AI接续无效：${message}`) }
const kindFor = { vertices: 'vertex', rooms: 'room', walls: 'wall', openings: 'opening', props: 'prop', regions: 'region', notes: 'note',
  terrainAreas: 'terrainArea', terrainEdges: 'terrainEdge', terrainConnections: 'terrainConnection', paths: 'path', prefabInstances: 'prefab', scatterGroups: 'scatter' } as const

/** Editable targets only. Points, birth records, fixed sources and generated
 * receipts remain fully validated complexity, never extra user edit targets. */
export function semanticTargetEntries(document: SceneDocument): Map<string, { id: string; value: unknown }> {
  const rows = new Map<string, { id: string; value: unknown }>()
  const memberships = new Map<string, unknown[]>()
  for (const kind of ['prefabInstances', 'scatterGroups'] as const) for (const group of Object.values(document[kind])) {
    for (const [key, member] of Object.entries(group.members) as [string, { propId: string | null }][]) if (member.propId) {
      const list = memberships.get(member.propId) ?? []
      list.push({ kind, groupId: group.id, key, member }); memberships.set(member.propId, list)
    }
  }
  for (const list of memberships.values()) list.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
  for (const key of LAYER_ENTITY_COLLECTIONS) for (const [id, row] of Object.entries(document[key])) {
    let value: unknown = row
    if (key === 'prefabInstances' || key === 'scatterGroups') {
      const { members: _members, ...properties } = row as unknown as Record<string, unknown>
      value = properties
    }
    rows.set(`${kindFor[key]}:${id}`, { id, value: { row: value, layerId: document.entityLayers[id], ...(key === 'props' ? { memberships: memberships.get(id) ?? [] } : {}) } })
  }
  for (const [id, row] of Object.entries(document.userLayers)) rows.set(`layer:${id}`, { id, value: row })
  const visual = visualBase(document)
  for (const key of ['boundaries', 'edgeLooks', 'lights', 'fogs', 'filters'] as const) for (const [id, row] of Object.entries(visual?.[key] ?? {})) rows.set(`visual.${key}:${id}`, { id, value: row })
  if (visual) rows.set('visual.environment:environment', { id: 'environment', value: visual.environment })
  if (document.visual?.version === 3) for (const [id, row] of Object.entries(document.visual.transitions)) rows.set(`visual.transition:${id}`, { id, value: row })
  for (const key of ['areas', 'lines', 'landmarks', 'symbols'] as const) for (const [id, row] of Object.entries(document.regional?.[key] ?? {})) rows.set(`regional.${key}:${id}`, { id, value: row })
  const filtersByTarget = new Map<string, unknown[]>()
  for (const filter of Object.values(visual?.filters ?? {})) {
    if (filter.target.kind !== 'entities' || !filter.enabled) continue
    const { target: _target, ...effect } = filter
    for (const id of filter.target.ids) {
      const list = filtersByTarget.get(id) ?? []
      list.push(effect); filtersByTarget.set(id, list)
    }
  }
  for (const list of filtersByTarget.values()) list.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
  for (const [key, row] of rows) if (filtersByTarget.has(row.id)) rows.set(key, { ...row, value: { target: row.value, filters: filtersByTarget.get(row.id) } })
  return rows
}
export function semanticChangedDocumentTargets(before: SceneDocument, after: SceneDocument): string[] {
  const a = semanticTargetEntries(before), b = semanticTargetEntries(after)
  const changed = sorted([...a.keys(), ...b.keys()].filter(key => !same(a.get(key)?.value, b.get(key)?.value)))
  return changed.filter(key => {
    if (key.startsWith('visual.filters:')) {
      const id = key.slice('visual.filters:'.length), first = visualBase(before)?.filters[id], second = visualBase(after)?.filters[id]
      // A finite filter changes its actual targets. Its bookkeeping row does
      // not add one more edit on top of the same expanded appearance update.
      if (first?.target.kind === 'entities' || second?.target.kind === 'entities') return false
    }
    const members = groupMemberIds(before, after, key)
    if (!members.some(id => changed.includes(`prop:${id}`))) return true
    const [kind, id] = splitTarget(key), collection = kind === 'prefab' ? 'prefabInstances' : 'scatterGroups'
    const first = before[collection][id], second = after[collection][id]
    if (!first || !second) return false
    const business = (row: unknown) => {
      const { members: _members, anchorMm: _anchor, rotationDeg: _rotation, densityFactor: _density, exclusions: _exclusions, ...value } = row as Record<string, unknown>
      return value
    }
    return !same(business(first), business(second))
  })
}
const splitTarget = (target: string): [string, string] => [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)]
export function groupMemberIds(before: SceneDocument, after: SceneDocument, target: string): string[] {
  const [kind, id] = splitTarget(target)
  if (kind !== 'prefab' && kind !== 'scatter') return []
  const key = kind === 'prefab' ? 'prefabInstances' : 'scatterGroups'
  return sorted([before, after].flatMap(document => Object.values(document[key][id]?.members ?? {}).flatMap(member => member.propId ?? [])))
}
export const semanticChangedTargets = (before: ProjectData, after: ProjectData) => semanticChangedDocumentTargets(before.document, after.document)
export function assertContinuationAdoptionBudget(before: ProjectData, after: ProjectData): string[] {
  const targets = semanticChangedTargets(before, after)
  if (targets.length > CONTINUATION_POLICY.finalAdoptionTargets) deny('完整采用超过512语义目标。')
  return targets
}
