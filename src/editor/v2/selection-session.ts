/** UI-only selection. The complete scene and command history remain in Workspace. */
export class SelectionSessionV2 {
  private ids: readonly string[] = Object.freeze([])
  private listeners = new Set<() => void>()
  getSnapshot = (): readonly string[] => this.ids
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  set(input: readonly string[]) {
    const ids = [...new Set(input)]
    if (ids.length === this.ids.length && ids.every((id, i) => id === this.ids[i])) return
    this.ids = Object.freeze(ids)
    this.listeners.forEach(listener => listener())
  }
  clear() { this.set([]) }
}
