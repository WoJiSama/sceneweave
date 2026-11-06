import { prepareDomainProject, type DomainCandidate, type DomainPreparationOptions } from './generation.js'
import type { EditableProject } from './project.js'

export type MixedCandidate = DomainCandidate<'mixed'>
export type MixedPreparationOptions = DomainPreparationOptions

export function prepareMixedProject(base: EditableProject, raw: unknown, options: MixedPreparationOptions): Promise<MixedCandidate> {
  return prepareDomainProject('mixed', base, raw, options)
}
