import { useSyncExternalStore, type ReactNode } from 'react'
import { SelectionSessionV2 } from './selection-session'
const empty = new SelectionSessionV2()
export function useSelectionIdsV2(session?: SelectionSessionV2): readonly string[] {
  const source = session ?? empty
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}
export function SelectionSubscriber({ session, children }: { session: SelectionSessionV2; children: (ids: readonly string[]) => ReactNode }) {
  return children(useSelectionIdsV2(session))
}

export { useSelectionIdsV2 as useSelectionIds }
