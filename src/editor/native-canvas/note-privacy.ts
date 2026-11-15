import type { AppearanceGraph } from '../../shared/model/appearance'
import type { SceneDocument } from '../../shared/model/scene'
import { projectScene } from '../../shared/projection/projection'

export interface NotePrivacySummary {
  hidden: { id: string; label: string }[]
  outputError?: string
}

/** GM session feedback consumes the actual public projection, rather than a
 * second implementation of support, recursive-anchor or mask visibility. */
export function notePrivacySummary(scene: SceneDocument, floorId: string, appearance?: AppearanceGraph): NotePrivacySummary {
  const publicNotes = Object.values(scene.notes).filter(note => note.floorId === floorId && note.visibility === 'public')
  if (!publicNotes.length) return { hidden: [] }
  try {
    const visible = new Set(projectScene(scene, 'player', appearance, { floorId }).notes.map(note => note.id))
    return { hidden: publicNotes.filter(note => !visible.has(note.id)).sort((a, b) => a.id.localeCompare(b.id)).map(note => ({
      id: note.id, label: (note.title?.trim() || note.text.trim() || '未命名注记').slice(0, 96),
    })) }
  } catch (error) {
    // A failed public projection provides no evidence about individual notes.
    return { hidden: [], outputError: error instanceof Error ? error.message : String(error) }
  }
}
