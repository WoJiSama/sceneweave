import type { PointMm } from '../../../model/scene.js'
import { calderaLayout } from '../volcano/caldera.js'
import type { MixedParameters } from './contracts.js'

/** Reserve a flat building shelf above the caldera approach and crater trail. */
export function planVolcanoPlatformBuilding(parameters: MixedParameters, seed: string): void {
  if (parameters.outdoor.kind !== 'volcano') return
  const volcano = parameters.outdoor.parameters, layout = calderaLayout(volcano, seed)
  if (!layout) return
  const b = volcano.boundsMm
  const at = (x: number, y: number): PointMm => ({ x: b.x + Math.round(b.width * x), y: b.y + Math.round(b.height * y) })
  const shelf = [[.262, .43], [.272, .292], [.301, .237], [.35, .219], [.414, .219], [.46, .244], [.493, .288],
    [.497, .36], [.489, .45], [.467, .51], [.474, .55], [.455, .606], [.386, .626], [.322, .609], [.294, .581], [.272, .506]]
  const nw = at(.308, .266), se = at(.458, .449)
  parameters.building.boundsMm = { ...nw, width: se.x - nw.x, height: se.y - nw.y }
  parameters.approach.fromMm = { ...layout.platform.anchorMm }
  Object.assign(volcano, layout, { platform: { ...layout.platform, boundaryMm: shelf.map(([x, y]) => at(x, y)) } })
}
