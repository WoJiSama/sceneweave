import { planOceanDressing, oceanDressingSettingsSchema, type OceanDressingSettings } from '../../shared/ocean/generation.js'
import type { PreparedLibraryEntry } from '../../shared/library/types.js'
import { prepareCatalogAdoption, prepareCompositionCommands, type PrepareOptions } from './prepare.js'
import type { EditableProject } from './project.js'
import { captureJson } from '../../shared/validation/json.js'

/** Reuses the same fixed catalog, command, identity and materialization path as manual editing. */
export async function prepareOceanGeneration(project: EditableProject, raw: OceanDressingSettings, entries: PreparedLibraryEntry[], options: PrepareOptions) {
  const settings = oceanDressingSettingsSchema.parse(captureJson(raw))
  const adopted = entries.length ? await prepareCatalogAdoption(project, entries, options) : { project, operationCost: 0 }
  const { commands, report } = planOceanDressing(adopted.project.document, settings)
  const dressed = await prepareCompositionCommands(adopted.project, commands, { ...options, initialOperationCost: adopted.operationCost })
  return { project: dressed, report }
}
