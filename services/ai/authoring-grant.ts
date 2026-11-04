import { currentAuthoringCreatedIds } from '../../src/shared/ai/current-authoring.js'
import type { StoredTask } from './store.js'

/** Generation is part of the saved G ledger, not a new AI authorisation. Only
 * IDs born after this task's immutable baseline may supplement its frozen scope. */
export function authoringCreatedIds(authoring: NonNullable<StoredTask['authoring']>): readonly string[] {
  return authoring.start.schemaVersion === 4 && authoring.state.schemaVersion === 4
    ? currentAuthoringCreatedIds(authoring.start, authoring.state) : authoring.state.changedIds
}
