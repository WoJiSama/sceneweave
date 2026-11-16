import { localToWorldPoint } from '../aggregates/coordinates.js'
import type { AggregateFrame } from '../model/aggregate.js'
import type { SceneDocument, TerrainArea } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { RockShell } from './contracts.js'

function rigidFrame(prior: TerrainArea, area: TerrainArea, quarterTurns: AggregateFrame['quarterTurns']): AggregateFrame | undefined {
  const first = area.boundaryMm.findIndex(point => point.id === prior.boundaryMm[0].id)
  if (first < 0) return
  const rotated = localToWorldPoint({ translationMm: { x: 0, y: 0 }, quarterTurns }, prior.boundaryMm[0].positionMm)
  const frame = { translationMm: { x: area.boundaryMm[first].positionMm.x - rotated.x, y: area.boundaryMm[first].positionMm.y - rotated.y }, quarterTurns }
  return prior.boundaryMm.every((point, i) => {
    const next = area.boundaryMm[(first + i) % area.boundaryMm.length], transformed = localToWorldPoint(frame, point.positionMm)
    return point.id === next.id && point.segmentId === next.segmentId && transformed.x === next.positionMm.x && transformed.y === next.positionMm.y
  }) ? frame : undefined
}
function transformedShell(previous: RockShell, frame: AggregateFrame): RockShell {
  const result = cloneJson(previous)
  for (const point of result.sourceBoundaryMm) point.positionMm = { ...localToWorldPoint(frame, point.positionMm) }
  for (const point of Object.values(result.verticesMm)) {
    const xy = localToWorldPoint(frame, { x: point.x, y: point.y }); point.x = xy.x; point.y = xy.y
  }
  let { x, y } = result.recipe.direction
  for (let i = 0; i < frame.quarterTurns; i++) { const previousX = x; x = -y; y = previousX }
  result.recipe.direction = { x: x || 0, y: y || 0 }
  return result
}

/** Ordinary boundary edits may carry an unchanged saved shell by translation.
 * An aggregate owner may already have transformed the complete saved shape;
 * accept only the exact same rigid XY transform of every persisted field.
 * Neither path regenerates geometry or changes manual records or identity. */
export function followRockShells(before: SceneDocument, after: SceneDocument): void {
  for (const [id, area] of Object.entries(after.terrainAreas)) {
    const prior = before.terrainAreas[id], shell = area.rockBody?.shell, previous = prior?.rockBody?.shell
    if (!shell || !previous || !prior.rockBody || !area.rockBody) continue
    const changed = canonicalJson(prior.boundaryMm) !== canonicalJson(area.boundaryMm)
      || prior.groundElevationMm !== area.groundElevationMm || prior.rockBody.baseElevationMm !== area.rockBody.baseElevationMm
    if (!changed) continue
    if (prior.groundElevationMm !== area.groundElevationMm || prior.rockBody.baseElevationMm !== area.rockBody.baseElevationMm
      || prior.boundaryMm.length !== area.boundaryMm.length) throw new Error('真实侧壳只支持同拓扑、同高程的刚性XY变换。')
    const unchangedShell = canonicalJson(shell) === canonicalJson(previous)
    if (unchangedShell) {
      const frame = rigidFrame(prior, area, 0)
      if (!frame) throw new Error('真实侧壳不能隐式跟随非刚体轮廓或换拓扑。')
      area.rockBody.shell = transformedShell(previous, frame)
      continue
    }
    const matches = ([0, 1, 2, 3] as const).some(turns => {
      const frame = rigidFrame(prior, area, turns)
      return frame !== undefined && canonicalJson(shell) === canonicalJson(transformedShell(previous, frame))
    })
    if (!matches) throw new Error('宿主与真实侧壳同时改动，不能猜测人工形体意图。')
  }
}
