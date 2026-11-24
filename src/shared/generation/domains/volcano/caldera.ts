import type { PointMm } from '../../../model/scene.js'
import { distanceToSegment, polylineSides } from '../../../geometry/geometry.js'
import { terrainRandomUnit } from '../../../terrain-generation/field.js'
import type { VolcanoParameters } from './contracts.js'

type Layout = Pick<VolcanoParameters, 'boundsMm' | 'mountain' | 'crater' | 'ascent' | 'descent' | 'route' | 'flow'>
type NaturalLayout = Pick<VolcanoParameters, 'relief' | 'mountain' | 'crater' | 'platform' | 'entrance' | 'ascent' | 'descent' | 'route' | 'flow'>

/** A narrow source widens into a pool. The same closed ring defines the
 * editable lava surface and its movement region. */
export function calderaFlowBoundary(points: PointMm[], widthMm: number): PointMm[] {
  const widest = Math.round((points.length - 1) * .76), swell = Math.max(1, (points.length - 1) * .31)
  const widths = points.map((_, i) => widthMm * (.73 + .27 * Math.exp(-(((i - widest) / swell) ** 2))))
  const { left, right } = polylineSides(points, widths)
  if (!left.length) return []
  const cap = (center: PointMm, a: PointMm, b: PointMm) => Array.from({ length: 5 }, (_, i) => {
    const angle = Math.atan2(a.y - center.y, a.x - center.x) + Math.PI * (i + 1) / 6
    const radius = Math.hypot(b.x - center.x, b.y - center.y)
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
  return [...left, ...cap(points.at(-1)!, left.at(-1)!, right.at(-1)!), ...right.slice().reverse(), ...cap(points[0], right[0], left[0])]
    .map(({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))
}

/** Plan a real ridge and basin around the requested crater footprint.
 * Use the simpler terrace on small maps or when the width/shape controls
 * need its full straight landing clearance. */
export function calderaLayout(parameters: Layout, seed: string): NaturalLayout | undefined {
  const { boundsMm: b, crater, ascent, descent, route, flow } = parameters
  const { width, height } = b
  const [topLeft, , bottomRight] = crater.boundaryMm
  const cw = bottomRight.x - topLeft.x, ch = bottomRight.y - topLeft.y
  const cy = (topLeft.y + bottomRight.y - 2 * b.y) / (2 * height)
  const s = Math.min(width / 40000, height / 32000)
  if (width < 28000 || height < 22000 || width / height > 2 || height / width > 1.25
    || route.widthMm > 1900 * s || cw < width * .16 || cw > width * .30
    || ch < height * .24 || topLeft.y < b.y + height * .17 || bottomRight.y > b.y + height * .82
    || flow && (flow.widthMm > cw * .25 || flow.widthMm > ch * .2)) return
  const at = (x: number, y: number): PointMm => ({ x: b.x + Math.round(width * x), y: b.y + Math.round(height * y) })
  const inCrater = (x: number, y: number): PointMm => ({ x: topLeft.x + Math.round(cw * x), y: topLeft.y + Math.round(ch * y) })
  const drift = (index: number) => (terrainRandomUnit(seed, `caldera/rim/${index}`) - .5) * .024
  const mountain = [[.24,.22],[.34,.15],[.45,.10],[.57,.105],[.66,.065],[.79,.10],[.89,.16],[.945,.29],
    [.932,.40],[.958,.51],[.936,.64],[.946,.77],[.867,.873],[.742,.922],[.626,.906],[.527,.925],[.422,.887],
    [.319,.90],[.239,.831],[.168,.72],[.151,.61],[.168,.55],[.16,.48],[.177,.397],[.165,.33],[.199,.263]]
    .map(([x, y], i) => at(x + drift(i) * .52, y + drift(i + 31)))
  // The west lip has a readable breach. Preserve room on both sides for the
  // width-aware native stair/ramp connection.
  const rim = [[.045,.31],[.11,.171],[.23,.072],[.36,.095],[.48,.00],[.60,.049],[.73,.113],[.84,.128],
    [.948,.25],[1,.384],[.96,.55],[.985,.68],[.90,.81],[.79,.916],[.63,.956],[.51,1],[.37,.942],
    [.25,.95],[.14,.858],[.062,.72],[.025,.60],[0,.50],[.035,.42]]
    .map(([x,y], i) => inCrater(x, y <= .025 || y >= .98 || x < .04 ? y : y + drift(i + 57) * 1.1))
  const platform = [[.305,.535],[.333,.503],[.407,.49],[.452,.511],[.474,.55],[.455,.606],
    [.386,.626],[.322,.609],[.298,.581]].map(([x,y]) => at(x,y))
  const anchorMm = at(.385,.557), entrance = at(.052,.735)
  const approachY = .596
  const craterEntry = inCrater(.20,.50)
  const crestEntry = at(.492,cy)
  const branch = inCrater(.67 + drift(98), .24)
  const lava = flow && [branch, inCrater(.641,.34), inCrater(.595,.42), inCrater(.588,.48), inCrater(.622,.54),
    inCrater(.67,.60), inCrater(.685,.67), inCrater(.66,.74)]
  if (flow && lava && distanceToSegment(craterEntry, lava[1], lava[2]) < (route.widthMm + flow.widthMm) / 2 + 250) return
  return {
    relief: 'caldera-v1',
    mountain: { ...parameters.mountain, boundaryMm: mountain },
    crater: { ...crater, boundaryMm: rim },
    platform: { boundaryMm: platform, anchorMm },
    entrance: { positionMm: entrance, directionDeg: 311 },
    ascent: { ...ascent, fromMm: at(.116,approachY), toMm: at(.236,approachY) },
    descent: { ...descent, fromMm: crestEntry, toMm: craterEntry },
    route: { ...route, toPlatformViaMm: [at(.263,approachY), at(.29,.601), at(.323,.588), at(.353,.57)],
      toCraterViaMm: [at(.423,.555), at(.453,(cy * .35 + .55 * .65)), at(.471,cy)] },
    flow: flow && lava ? { ...flow, centerlineMm: lava } : null,
  }
}
