import type { SceneDocument } from '../../shared/model/scene'

/** Organization edits have real members even when their world geometry did not
 * move. Review the changed groups and their descendants on both sides. */
export function aggregateReviewMembers(before: SceneDocument, after: SceneDocument): string[] {
  const oldGroups = before.aggregateCoordinates?.groups ?? {}, newGroups = after.aggregateCoordinates?.groups ?? {}
  const changed = new Set([...Object.keys(oldGroups), ...Object.keys(newGroups)].filter(id =>
    JSON.stringify(oldGroups[id]) !== JSON.stringify(newGroups[id])))
  const members = new Set<string>()
  for (const groups of [oldGroups, newGroups]) {
    const pending = [...changed], seen = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      for (const member of groups[id]?.members ?? []) members.add(member.id)
      for (const group of Object.values(groups)) if (group.parentId === id) pending.push(group.id)
    }
  }
  return [...members].sort()
}
