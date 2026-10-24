import { createBrowserImagePort } from './images/index.js'
import { ProjectRepository } from './storage/index.js'
import { LibraryRepository } from './library/index.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { createBrowserSvgPort } from './ai/svg-port.js'

export const runtime: PreparationContext = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => new Date().toISOString() } }
export const validation = { images: createBrowserImagePort(), svg: createBrowserSvgPort() }
// Constructors do not open IndexedDB. Home and the editor share the same native repositories.
export const projectRepository = new ProjectRepository({ runtime, validation })
export const libraryRepository = new LibraryRepository({ runtime, validation })
