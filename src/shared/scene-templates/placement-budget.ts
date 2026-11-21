import type { ProjectData } from '../model/project.js'
import { assertCommandBudget, MANUAL_TRANSACTION_BUDGETS, measureCommandBudget, selectManualTransactionBudget, type CommandBudgetUsage, type ManualTransactionBudget } from '../budget/command-budget.js'
import { measureBudgetDependencies, measureBudgetGeometry } from '../budget/task-budget.js'
import { projectResourceRecords } from '../project/source-resources.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../validation/json.js'

/** Licenses and authoring records are metadata too, rather than editable furniture. */
export function templateMetadata(project: ProjectData): { metadataRecords: number; metadataBytes: number } {
  const value = { licenses: project.licenses, licenseBindings: project.licenseBindings, authoringSources: project.authoringSources }
  const records = (value: unknown): number => !value || typeof value !== 'object' ? 0
    : (Array.isArray(value) ? 0 : 1) + Object.values(value).reduce<number>((sum, row) => sum + records(row), 0)
  return { metadataRecords: records(value), metadataBytes: encodeUtf8(canonicalJson(value)).length }
}

export function templateResourceUsage(...projects: ProjectData[]) {
  const records = new Map(projects.flatMap(project => [...projectResourceRecords(project)]))
  const assets = new Map(projects.flatMap(project => Object.entries(project.assets)))
  return { assetBytes: [...records.values()].reduce((sum, bytes) => sum + bytes, 0),
    decodePixels: [...assets.values()].reduce((sum, asset) => sum + asset.pixelWidth * asset.pixelHeight, 0) }
}

/** Assessment uses validated source/target closures before IDs, merging or geometry
 * preparation. Estimates choose one registered profile; actual work can still
 * reject it, never retry automatically with a larger profile. */
export function assessSceneTemplatePlacement(current: ProjectData, source: ProjectData): { profile: ManualTransactionBudget; estimate: CommandBudgetUsage } {
  const empty = cloneJson(source)
  for (const key of ['vertices', 'rooms', 'walls', 'openings', 'props', 'notes', 'regions', 'prefabInstances', 'paths', 'terrainAreas', 'assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) empty.document[key] = {}
  empty.document.entityLayers = {}
  for (const key of Object.keys(empty.historyIdentity)) if (key.endsWith('Tokens')) Object.assign(empty.historyIdentity, { [key]: {} })
  for (const key of ['sources', 'variants', 'prefabAppearanceTemplates', 'presentations', 'propSources', 'surfaceSources', 'instanceAdjustments'] as const) empty.appearance[key] = {}
  const incoming = measureCommandBudget(empty.document, source.document, { before: empty, after: source }, undefined, MANUAL_TRANSACTION_BUDGETS.compact)
  const extra = templateMetadata(source), entities = incoming.semanticTargets
  const polygonBound = (project: ProjectData) => {
    const degrees = new Map<string, number>()
    for (const wall of Object.values(project.document.walls)) for (const id of [wall.startVertexId, wall.endVertexId]) degrees.set(id, (degrees.get(id) ?? 0) + 1)
    return Object.keys(project.document.walls).length + [...degrees.values()].reduce((sum, degree) => sum + degree * (degree - 1) / 2 * 4, 0)
  }
  const oldProps = Object.values(current.document.props).filter(prop => prop.blocksMovement).length
  const newProps = Object.values(source.document.props).filter(prop => prop.blocksMovement).length
  const walls = Object.keys(current.document.walls).length + Object.keys(source.document.walls).length
  const collisionPairs = walls * (walls - 1) / 2 + 16 * (oldProps * polygonBound(source) + newProps * (oldProps + polygonBound(current)))
  // Transforming effective appearance can add fixed sources; fresh identities
  // and target-layer membership introduce additional dependency records.
  const estimate: CommandBudgetUsage = { ...incoming, ...templateResourceUsage(current, source),
    dependencyRefs: measureBudgetDependencies(current.document) + measureBudgetDependencies(current.historyIdentity) + measureBudgetDependencies(current.appearance)
      + incoming.dependencyRefs + entities * 8,
    metadataRecords: incoming.metadataRecords * 2 + extra.metadataRecords,
    metadataBytes: incoming.metadataBytes * 2 + extra.metadataBytes + entities * 512,
    intersectionPairs: collisionPairs + incoming.intersectionPairs + incoming.geometrySegments * Object.values(current.document).reduce<number>((sum, collection) => sum + (!collection || typeof collection !== 'object' || Array.isArray(collection) ? 0 : Object.values(collection).reduce<number>((total, row) => total + measureBudgetGeometry(row).geometrySegments, 0)), 0) }
  const minimum = selectManualTransactionBudget(current, entities, incoming.groupMembers)
  const profiles = Object.values(MANUAL_TRANSACTION_BUDGETS).filter(profile => profile.semanticTargets >= minimum.semanticTargets)
  for (const profile of profiles) {
    try { assertCommandBudget(profile, estimate); return { profile, estimate } } catch { /* inspect the next registered envelope before starting */ }
  }
  assertCommandBudget(MANUAL_TRANSACTION_BUDGETS.expanded, estimate)
  throw new Error('模板没有可用的普通事务策略。')
}
