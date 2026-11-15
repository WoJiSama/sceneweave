import type { Note, SceneDocument } from '../../shared/model/scene'

/** Follow explicit anchors only. Room membership and spatial proximity are not anchors. */
export function associatedNotes(scene: SceneDocument, selectedId: string): Note[] {
  const children = new Map<string, Note[]>()
  for (const note of Object.values(scene.notes)) {
    if (note.anchor.type !== 'entity') continue
    const siblings = children.get(note.anchor.entityId) ?? []
    siblings.push(note)
    children.set(note.anchor.entityId, siblings)
  }
  const pending = [selectedId], seen = new Set<string>(), result: Note[] = []
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index]
    if (seen.has(id)) continue
    seen.add(id)
    if (scene.notes[id]) result.push(scene.notes[id])
    for (const child of children.get(id) ?? []) pending.push(child.id)
  }
  return result
}

/** The current terminal anchor, including recursive note attachments. */
export function noteAnchorRoot(scene: SceneDocument, selectedId: string): string | null {
  let id = selectedId
  const seen = new Set<string>()
  while (scene.notes[id]) {
    if (seen.has(id)) return null
    seen.add(id)
    const anchor = scene.notes[id].anchor
    if (anchor.type !== 'entity') return null
    id = anchor.entityId
    if (anchor.entityKind !== 'note') return id
  }
  return id
}
