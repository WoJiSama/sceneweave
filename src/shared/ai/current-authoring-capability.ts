import type { ProjectData } from '../model/project.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'

/** Explicit protocol capability. Legacy callers retain their version guards. */
export const CURRENT_AUTHORING_CAPABILITY = 'sceneweave-current-authoring@1' as const
export type CurrentAuthoringCapability = typeof CURRENT_AUTHORING_CAPABILITY
export function assertCurrentAuthoringCapability(project: ProjectData, capability?: CurrentAuthoringCapability): boolean {
  if (capability === undefined) return false
  if (capability !== CURRENT_AUTHORING_CAPABILITY || project.schemaVersion < 3 || project.schemaVersion > 7
    || project.document.schemaVersion !== project.schemaVersion) throw new Error('当前工程创作能力与完整工程版本不符。')
  return true
}
/** Fixed starting closure, independent of later scene/override transactions. */
export const currentAuthoringResourceClosureHash = (project: ProjectData): string => sha256Text(canonicalJson({
  assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings, authoringSources: project.authoringSources,
  propDefinitions: project.document.propDefinitions, prefabDefinitions: project.document.prefabDefinitions,
  materials: project.document.materials, styleThemes: project.document.styleThemes,
  sources: project.appearance.sources, variants: project.appearance.variants, presentations: project.appearance.presentations ?? {},
}))
export function currentAuthoringOperationSupported(version: number, kind: string): boolean {
  if (['terrainGenerate', 'terrainEdit', 'regionalGenerate', 'regionalEdit'].includes(kind)) return version === 3
  if (kind === 'terrainLocal') return version === 4
  if (kind === 'connectionRoute' || kind === 'connectionRouteUpdate') return version >= 5
  if (kind.startsWith('decoration')) return version >= 6
  return true
}
