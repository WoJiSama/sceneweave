import { prepareDomainProject, type DomainCandidate, type DomainPreparationOptions } from './generation.js'
import type { EditableProject } from './project.js'

export type ForestCandidate = DomainCandidate<'forest'>
export type ForestPreparationOptions = DomainPreparationOptions

export function prepareForestProject(base: EditableProject, raw: unknown, options: ForestPreparationOptions): Promise<ForestCandidate> {
  return prepareDomainProject('forest', base, raw, options)
}
