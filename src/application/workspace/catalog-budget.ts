import type { LicenseBinding } from '../../shared/model/project.js'
import { LIBRARY_LIMITS } from '../../shared/library/types.js'
import { terrainCommandCost } from '../../shared/terrain-generation/cost.js'
import type { EditableProject } from './project.js'

export const CATALOG_ADOPTION_LIMIT = LIBRARY_LIMITS.adoptionOperations
const bindingKey = (binding: Pick<LicenseBinding, 'subjectKind' | 'subjectId'>) => JSON.stringify([binding.subjectKind, binding.subjectId])
const catalogCollections = ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
const fixedAppearanceCollections = ['sources', 'variants', 'prefabAppearanceTemplates', 'presentations'] as const

/** Exact existing catalog append accounting, shared by preparation and the
 * workspace authority. A batch cannot evade the ordinary adoption limit. */
export function catalogAdditionCost(current: EditableProject, candidate: EditableProject): number {
  const added = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter(id => !Object.hasOwn(before, id)).length
  let records = 0
  for (const key of catalogCollections) records += added(current.document[key], candidate.document[key])
  for (const key of fixedAppearanceCollections) records += added(current.appearance[key] ?? {}, candidate.appearance[key] ?? {})
  for (const key of ['assets', 'authoringSources', 'licenses'] as const) records += added(current[key], candidate[key])
  const existingBindings = new Set(current.licenseBindings.map(bindingKey))
  records += candidate.licenseBindings.filter(binding => !existingBindings.has(bindingKey(binding))).length
  return Math.max(records, terrainCommandCost(current.document, candidate.document, { before: current, after: candidate }).total)
}
