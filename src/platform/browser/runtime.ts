import { ProjectRepository } from './storage/index.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { browserProjectValidation } from './project-validation.js'

export const runtime: PreparationContext = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => new Date().toISOString() } }
export const validation = browserProjectValidation
// Constructors do not open IndexedDB. Home and the editor share the same native repositories.
export const projectRepository = new ProjectRepository({ runtime, validation })

let library: Promise<import('./library/index.js').LibraryRepository> | undefined
export function loadLibraryRepository() {
  return library ??= import('./library/index.js').then(({ LibraryRepository }) => new LibraryRepository({ validation }))
}
