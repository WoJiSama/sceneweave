import { prepareDomainProject, type DomainCandidate, type DomainPreparationOptions } from './generation.js'
import type { EditableProject } from './project.js'

export type InteriorCandidate = DomainCandidate<'interior'>
export type InteriorPreparationOptions = DomainPreparationOptions

export function prepareInteriorProject(base: EditableProject, raw: unknown, options: InteriorPreparationOptions): Promise<InteriorCandidate> {
  return prepareDomainProject('interior', base, raw, options)
}
