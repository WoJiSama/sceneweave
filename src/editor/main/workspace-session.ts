import { Workspace } from '../../application/workspace/workspace'
import type { EditableProject } from '../../application/workspace/project'
import { createStarterProject, prepareCanvasGround, type BlankOptions } from '../../platform/browser/content/factories'
import { projectRepository, runtime, validation } from '../../platform/browser/runtime'
import { validateIslandEdits } from './island-constraints'
import { validateOutpostEdits } from './outpost-constraints'
import { validateStudyEdits } from './study-constraints'

export const nativeWorkspace = new Workspace(projectRepository, {
  validation, runtime,
  validateCandidate(document) {
    validateStudyEdits(document)
    validateIslandEdits(document)
    validateOutpostEdits(document)
  },
})

export async function saveNewScene(project: EditableProject, checkpoint: number, signal: AbortSignal, onSaving: () => void) {
  signal.throwIfAborted()
  nativeWorkspace.assertCheckpoint(checkpoint)
  onSaving()
  await nativeWorkspace.adoptNew(project, checkpoint)
}

export async function prepareStartupScene(options: BlankOptions, signal: AbortSignal, preloadedArchive?: Promise<Uint8Array>) {
  signal.throwIfAborted()
  const checkpoint = nativeWorkspace.checkpoint()
  const blank = await createStarterProject(options, signal, undefined, preloadedArchive)
  const project = await prepareCanvasGround(blank, signal)
  signal.throwIfAborted()
  return (onSaving: () => void) => saveNewScene(project, checkpoint, signal, onSaving)
}
