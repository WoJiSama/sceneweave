import type { PointMm } from '../../../shared/model/scene.js'
import type { ProjectedNote } from '../../../shared/projection/types.js'

// The existing label background is 220 mm high; keep a 60 mm gap between rows.
export const NOTE_LABEL_ROW_MM = 280

/** Paint only the already audience-filtered projection. Anchors remain unchanged. */
export function noteLabelPositions(notes: readonly ProjectedNote[]): Map<string, PointMm> {
  const groups = new Map<string, ProjectedNote[]>()
  for (const note of notes) {
    const key = `${note.positionMm.x},${note.positionMm.y}`
    const group = groups.get(key)
    if (group) group.push(note)
    else groups.set(key, [note])
  }
  const positions = new Map<string, PointMm>()
  for (const group of groups.values()) {
    // Public names precede GM detail; IDs give a fixed order within each audience.
    group.sort((a, b) => Number(a.visibility === 'gm') - Number(b.visibility === 'gm') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    group.forEach((note, row) => positions.set(note.id, { x: note.positionMm.x, y: note.positionMm.y + row * NOTE_LABEL_ROW_MM }))
  }
  return positions
}
