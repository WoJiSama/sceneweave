import { prepareDomainProject, type DomainCandidate, type DomainPreparationOptions } from './generation.js'
import type { EditableProject } from './project.js'

export type VolcanoCandidate = DomainCandidate<'volcano'>
export type VolcanoPreparationOptions = DomainPreparationOptions

export function prepareVolcanoProject(base: EditableProject, raw: unknown, options: VolcanoPreparationOptions): Promise<VolcanoCandidate> {
  return prepareDomainProject('volcano', base, raw, options)
}
