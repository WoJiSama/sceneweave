import type { BoundsMm } from '../model/scene.js'

export type PlayerCoverageEntityKind = 'room' | 'wall' | 'prop' | 'decoration' | 'terrainArea' | 'terrainEdge' | 'terrainConnection' | 'path' | 'region'
export interface PlayerCoverageRequirement {
  entityKind: PlayerCoverageEntityKind
  entityId: string
  boundsMm: BoundsMm
  reason?: 'wall-relief'
}
export interface PlayerCoverageIssue {
  entityKind: PlayerCoverageEntityKind
  entityId: string
  floorId: string
  /** Exact visual envelope clipped to this Floor's fixed output. May be fractional.
   * Legacy standalone wall relief retains its stricter full-envelope check. */
  requiredBoundsMm: BoundsMm
  /** Non-overlapping uncovered rectangles, in the same world coordinate system. */
  missingBoundsMm: BoundsMm[]
  reason?: 'wall-relief'
}

const EPS = 1e-6
export class PlayerCoverageError extends Error {
  readonly issues: PlayerCoverageIssue[]
  constructor(issues: readonly PlayerCoverageIssue[]) {
    super('玩家输出不安全：固定遮罩未覆盖私密几何、视觉范围或装饰阴影；请扩大遮罩或恢复公开。' +
      (issues.some(issue => issue.reason === 'wall-relief') ? '固定遮罩还需覆盖块石外缘。' : ''))
    this.name = 'PlayerCoverageError'
    this.issues = issues.map(issue => ({ ...issue, requiredBoundsMm: { ...issue.requiredBoundsMm }, missingBoundsMm: issue.missingBoundsMm.map(box => ({ ...box })) }))
  }
}

function intersection(a: BoundsMm, b: BoundsMm): BoundsMm | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

/** Rectangle-union subtraction uses the same x slabs and epsilon as the safety
 * coverage predicate. Neighboring identical gaps are joined for readable hints. */
export function missingCoverageBounds(bounds: BoundsMm, rectangles: readonly BoundsMm[]): BoundsMm[] {
  const masks = rectangles.map(mask => intersection(bounds, mask)).filter((mask): mask is BoundsMm => mask !== null)
  const cuts = [...new Set([bounds.x, bounds.x + bounds.width, ...masks.flatMap(mask => [mask.x, mask.x + mask.width])])].sort((a, b) => a - b)
  const missing: BoundsMm[] = []
  let previous = new Map<string, BoundsMm>()
  for (let i = 1; i < cuts.length; i++) {
    const left = cuts[i - 1], right = cuts[i], x = (left + right) / 2
    const intervals = masks.filter(mask => x >= mask.x && x <= mask.x + mask.width).map(mask => [mask.y, mask.y + mask.height]).sort((a, b) => a[0] - b[0])
    const gaps: [number, number][] = []
    let to = bounds.y
    for (const [start, end] of intervals) {
      if (start > to + EPS) gaps.push([to, start])
      to = Math.max(to, end)
    }
    if (to < bounds.y + bounds.height - EPS) gaps.push([to, bounds.y + bounds.height])
    const current = new Map<string, BoundsMm>()
    for (const [top, bottom] of gaps) {
      const key = `${top},${bottom}`, existing = previous.get(key)
      const box = existing && Math.abs(existing.x + existing.width - left) <= EPS ? existing : { x: left, y: top, width: 0, height: bottom - top }
      if (box !== existing) missing.push(box)
      box.width += right - left
      current.set(key, box)
    }
    previous = current
  }
  return missing
}

export function collectPlayerCoverageIssues(requirements: readonly PlayerCoverageRequirement[], masks: readonly BoundsMm[], outputBounds: BoundsMm, floorId: string): PlayerCoverageIssue[] {
  return requirements.flatMap(requirement => {
    const requiredBoundsMm = requirement.reason === 'wall-relief' ? { ...requirement.boundsMm } : intersection(requirement.boundsMm, outputBounds)
    if (!requiredBoundsMm) return []
    const missingBoundsMm = missingCoverageBounds(requiredBoundsMm, masks)
    return missingBoundsMm.length ? [{ entityKind: requirement.entityKind, entityId: requirement.entityId, floorId, requiredBoundsMm, missingBoundsMm,
      ...(requirement.reason ? { reason: requirement.reason } : {}) }] : []
  })
}
