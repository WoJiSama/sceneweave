import type { ProjectData } from '../model/project.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'

/** The task protocol capability is independent from the single project format. */
export const CURRENT_AUTHORING_CAPABILITY = 'sceneweave-current-authoring@1' as const
export type CurrentAuthoringCapability = typeof CURRENT_AUTHORING_CAPABILITY
export function assertCurrentAuthoringCapability(project: ProjectData, capability?: CurrentAuthoringCapability): boolean {
  if (capability === undefined) return false
  if (capability !== CURRENT_AUTHORING_CAPABILITY || project.schemaVersion !== 1 || project.document.schemaVersion !== 1
    || project.historyIdentity.version !== 5 || project.appearance.version !== 2
    || project.document.generation?.version !== 5 || project.document.visual?.version !== 3
    || !project.document.decorations || !project.document.decorationClusters || !project.document.surfaceRules) throw new Error('当前工程创作能力与完整工程合同不符。')
  return true
}
/** Fixed starting closure, independent of later scene/override transactions. */
export const currentAuthoringResourceClosureHash = (project: ProjectData): string => sha256Text(canonicalJson({
  assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings, authoringSources: project.authoringSources,
  propDefinitions: project.document.propDefinitions, prefabDefinitions: project.document.prefabDefinitions,
  materials: project.document.materials, styleThemes: project.document.styleThemes,
  sources: project.appearance.sources, variants: project.appearance.variants, presentations: project.appearance.presentations ?? {},
}))
const ordinaryOperations = new Set(['room', 'wall', 'vertex', 'opening', 'entrance', 'terrain', 'terrainUpdate', 'edge', 'connection',
  'region', 'path', 'pathUpdate', 'scatter', 'scatterRegenerate', 'prefab', 'furnish', 'gmNote', 'gmNoteUpdate'])
const decorationOperations = new Set(['decorationCluster', 'decorationRegenerate', 'decorationUpdate', 'decorationDelete', 'decorationDetach', 'decorationClusterDelete'])
/** Report implemented operations from actual model capabilities; no schema threshold grants a tool. */
export function currentAuthoringOperationSupported(project: ProjectData, kind: string): boolean {
  const scene = project.document
  if (['terrainGenerate', 'terrainEdit', 'terrainLocal'].includes(kind)) return scene.mapMode === 'scene' && scene.generation?.version === 5 && scene.visual?.version === 3
  if (kind === 'regionalGenerate') return scene.generation?.version === 5 && scene.visual?.version === 3
  // A fixed scope may authorize generate then edit; actual regional existence is checked at execution.
  if (kind === 'regionalEdit') return scene.generation?.version === 5 && scene.visual?.version === 3
  if (kind === 'connectionRoute' || kind === 'connectionRouteUpdate') return scene.mapMode === 'scene' && scene.visual?.version === 3
  if (decorationOperations.has(kind)) return scene.mapMode === 'scene' && !!scene.decorations && !!scene.decorationClusters
  return ordinaryOperations.has(kind) && scene.mapMode === 'scene'
}

/** Rules have no AI scope/context/replay protocol yet. Existing unrelated
 * content may be edited, while every rule and its real support/member closure
 * stays unchanged. Fixed rejection text does not disclose a private rule. */
export function assertUnsupportedRuleContentUnchanged(before: ProjectData, after: ProjectData): void {
  const old = before.document, next = after.document
  const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
  const deny = () => { throw new Error('当前AI操作涉及尚未开放或未授权的规则依赖，此步骤未采用。') }
  if (!same(old.surfaceRules, next.surfaceRules)) deny()
  const protectedIds = new Set<string>()
  for (const rule of Object.values(old.surfaceRules)) {
    protectedIds.add(rule.supportRef.id)
    if (rule.field === 'material') continue
    protectedIds.add(rule.clusterId)
    for (const member of Object.values(old.decorationClusters[rule.clusterId]?.members ?? {})) if (member.entityId) protectedIds.add(member.entityId)
  }
  for (const id of protectedIds) {
    for (const key of ['terrainAreas', 'props', 'decorations', 'decorationClusters'] as const) if (!same(old[key][id], next[key][id])) deny()
    if (old.entityLayers[id] !== next.entityLayers[id]) deny()
    for (const key of ['propSources', 'surfaceSources', 'instanceAdjustments'] as const) if (!same(before.appearance[key][id], after.appearance[key][id])) deny()
    const layerId = old.entityLayers[id]
    if (layerId && !same(before.appearance.layerAdjustments[layerId], after.appearance.layerAdjustments[layerId])) deny()
  }
}
