import type { PointMm, SceneDocumentV2 } from '../../core/v2/types'

/** Snapshot IDs remain stable while catalogue identities belong to the retained manifest. */
export const ISLAND_IDS = {
  floor: 'island-floor', water: 'island-water', low: 'island-low', high: 'island-high', connection: 'island-stairs',
  theme: 'b3-theme-01', waterOverlay: 'island-shallow-water', lowOverlay: 'island-low-sand', highOverlay: 'island-high-rock',
  scatterTrees: 'island-trees', scatterShrubs: 'island-shrubs', scatterRocks: 'island-rocks',
  materials: { grass: 'b3-m-01', rock: 'b3-m-02', cliffRock: 'b3-m-03', sand: 'b3-m-04', shallow: 'b3-m-05', deep: 'b3-m-06' },
} as const
const equalPoint = (a: PointMm, b: PointMm) => a.x === b.x && a.y === b.y
const roundMm = (value: number) => Math.sign(value) * Math.round(Math.abs(value)) || 0

/**
 * Finite VIS-02 edit helper: one explicit world-space water overlay is updated atomically
 * with coastline edits. Saved documents/rendering never reconstruct this shape from a seed.
 */
export function islandShallowWaterBoundaryMm(scene: SceneDocumentV2): PointMm[] {
  const areas = [scene.terrainAreas[ISLAND_IDS.low], scene.terrainAreas[ISLAND_IDS.high]]
  if (areas.some(area => !area)) throw new Error('双层岩岛浅水带缺少两处台地。')
  const segments = areas.flatMap(area => area.boundaryMm.map((point, index) => ({ a: point.positionMm, b: area.boundaryMm[(index + 1) % area.boundaryMm.length].positionMm })))
  const exposed = segments.filter(segment => !segments.some(other => equalPoint(segment.a, other.b) && equalPoint(segment.b, other.a)))
  const first = [...exposed].sort((a, b) => a.a.x - b.a.x || a.a.y - b.a.y)[0]
  if (!first) throw new Error('双层岩岛没有可用海岸轮廓。')
  const points = [first.a], used = new Set([first])
  let end = first.b
  while (!equalPoint(end, points[0])) {
    points.push(end)
    const next = exposed.find(segment => !used.has(segment) && equalPoint(segment.a, end))
    if (!next || used.size > exposed.length) throw new Error('双层岩岛海岸必须是显式闭合的单一轮廓。')
    used.add(next); end = next.b
  }
  if (used.size !== exposed.length) throw new Error('双层岩岛海岸不能包含分离环。')
  const signedArea = points.reduce((sum, p, index) => { const q = points[(index + 1) % points.length]; return sum + p.x * q.y - q.x * p.y }, 0)
  const direction = signedArea > 0 ? 1 : -1, width = 1500
  return points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length], next = points[(index + 1) % points.length]
    const previousLength = Math.hypot(point.x - previous.x, point.y - previous.y), nextLength = Math.hypot(next.x - point.x, next.y - point.y)
    const a = { x: (point.x - previous.x) / previousLength, y: (point.y - previous.y) / previousLength }, b = { x: (next.x - point.x) / nextLength, y: (next.y - point.y) / nextLength }
    const normalA = { x: a.y * direction, y: -a.x * direction }, normalB = { x: b.y * direction, y: -b.x * direction }
    const denominator = 1 + normalA.x * normalB.x + normalA.y * normalB.y
    if (denominator < .125) throw new Error('海岸转角过尖，1500 mm 浅水带需要调整轮廓。')
    return { x: roundMm(point.x + width * (normalA.x + normalB.x) / denominator), y: roundMm(point.y + width * (normalA.y + normalB.y) / denominator) }
  })
}
