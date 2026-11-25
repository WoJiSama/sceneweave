import type { Path, PointMm, TerrainArea } from '../model/scene.js'
import { distanceToSegment, pointInPolygon, polygonDistance, polygonValid, polylineBand, terrainPoints } from '../geometry/geometry.js'
import { createTerrainRelief, reliefBounds } from '../geometry/terrain-relief.js'
import { connectionArcFrame } from '../geometry/connection-route.js'
import type { ExecutionBudget } from '../budget/task-budget.js'
import { terrainRandomUnit, terrainValueNoise } from './field.js'
import type { coastSkeletonV9 } from './coast-layout-v9.js'
import { NATURAL_STONE_SHAPES, type NaturalStoneKey } from '../visual/natural-stone-shapes.js'

type XY = readonly [number, number]
type LayoutInput = { seed: string; widthMm: number; heightMm: number }

// These are the two rock crests, in millimetres on the smallest canvas.
// Keep space between them for the bench and leave a broad break for each stair.
const bench: readonly XY[] = [
  [-5210,-820],[-4970,-2240],[-3350,-2860],[-2770,-2550],[-1620,-3930],[-190,-3400],
  [960,-3720],[2400,-3100],[3730,-2520],[4540,-1590],[4370,-870],[4920,190],
  [4900,1120],[4840,1990],[3960,3050],[2720,3570],[2160,3920],[980,4050],
  [-490,4030],[-1450,4210],[-3040,3650],[-3850,3020],[-4310,1850],[-4710,650],[-4310,-440],
]
const summit: readonly XY[] = [
  [-2780,-710],[-2520,-1780],[-1320,-1550],[-650,-2600],[300,-2270],[1080,-2460],
  [1740,-1460],[2390,-1190],[2230,-460],[2510,230],[1930,1060],[1290,1240],
  [760,1460],[-460,1330],[-1150,1630],[-1980,1240],[-2420,520],
]

const island: readonly XY[] = [
  [.105,.285],[.172,.207],[.245,.202],[.285,.155],[.371,.161],[.445,.116],[.507,.125],
  [.585,.085],[.649,.071],[.718,.096],[.816,.128],[.896,.215],[.919,.287],[.902,.335],
  [.936,.403],[.92,.501],[.862,.517],[.821,.568],[.735,.639],[.664,.663],[.621,.686],
  [.606,.728],[.638,.76],[.630,.816],[.566,.875],[.49,.947],[.398,.967],[.314,.928],
  [.229,.839],[.213,.712],[.112,.604],[.092,.426],
]
const reefLocations = [[.11,.145,.027,.028],[.92,.154,.026,.032],[.853,.655,.037,.028],
  [.748,.786,.038,.054],[.694,.824,.021,.026]] as const

const point = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) })

export function coastalEdgeDetailScale(scale: number, quality: 'standard' | 'detailed') {
  return Math.max(1, scale / (quality === 'detailed' ? 2 : 1))
}

function shapedCoastalReefs(land: PointMm[], landPoint: (u: number, v: number) => PointMm, orient: (ring: PointMm[]) => PointMm[],
  scale: number, random: (key: string) => number) {
  const forms: NaturalStoneKey[] = ['shingle', 'weathered', 'slab', 'chip', 'shingle']
  const reefs: PointMm[][] = []
  for (const [i, [x, y, rx, ry]] of reefLocations.entries()) {
    const rock = NATURAL_STONE_SHAPES[forms[i]], rotation = .31 + (random(`reef/${i}/strike`) - .5) * 1.68
    const c = Math.cos(rotation), s = Math.sin(rotation)
    const outline = rock.outline.map(([u, v], j) => {
      const l = (u - 50) / 50 * rx * (i === 2 ? 1.15 : 1.06)
      const d = (v - 50) / 50 * ry * (i === 1 ? .95 : .66)
      const weathering = .94 + .12 * random(`reef/${i}/${j}/wear`)
      return [(l * c - d * s) * weathering, (l * s + d * c) * weathering] as const
    })
    const fit = [1, .83, .63, .45].map(size => orient(outline.map(([u, v]) => landPoint(x + u * size, y + v * size))))
      .find(ring => [land, ...reefs].every(other => polygonDistance(ring, other) > 142 * scale))
    if (!fit) throw new Error('离岸露岩与主陆或相邻礁体的间距不足。')
    reefs.push(fit)
  }
  return reefs
}

export function groundCoverPatch(center: PointMm, rx: number, ry: number, seed: string, channel: string, angle = 0) {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return Array.from({ length: 20 }, (_, i) => {
    const t = i / 20 * Math.PI * 2
    const varying = .89 + .15 * Math.sin(3 * t + angle) + .24 * terrainRandomUnit(seed, `${channel}/${i}`)
    const x = rx * varying * Math.cos(t), y = ry * varying * Math.sin(t)
    return point(center.x + x * cos - y * sin, center.y + x * sin + y * cos)
  })
}

export function coastalAscentLayout({ seed, widthMm: width, heightMm: height }: LayoutInput, coast?: ReturnType<typeof coastSkeletonV9>, naturalStones = false, eroded = false) {
  const random = (key: string) => terrainRandomUnit(seed, `coastal-ascent/${key}`)
  const sign = coast ? -coast.bayDirection.x : random('side') < .5 ? -1 : 1
  const scale = Math.min(width / 24000, height / 18000)
  const centerX = coast?.plateauCenter.x ?? width * (sign > 0 ? .613 : .387)
  const sx = scale * (.97 + .06 * random('width')), sy = scale * (.97 + .06 * random('depth'))
  const pitch = (random('angle') - .5) * (eroded && coast ? .25 : .18)
  const centerY = height * (coast ? .465 : .395)
  const elbow = (random('spur reach') - .5) * 1180, crown = (random('crest offset') - .5) * 840
  const spurReach = eroded && coast ? 560 + 430 * random('striking spur') : 0
  const local = (x: number, y: number) => {
    // Move each spur, its walking shelf and its stair together. Attenuation
    // towards the opposite side leaves a different saddle for each seed.
    const spur = spurReach * Math.exp(-(((x + 4400) / 1850) ** 2 + ((y - 60) / 2500) ** 2))
    const u = x - spur + elbow * Math.exp(-(((x - 2900) / 2100) ** 2 + ((y - 1400) / 3300) ** 2))
    const v = y + crown * Math.exp(-(((x + 1850) / 2700) ** 2 + ((y + 1050) / 2300) ** 2))
    return point(centerX + sign * (sx * u + sy * v * pitch), centerY + sy * v - sx * u * pitch * .6)
  }
  const landPoint = (u: number, v: number) => point(width * (sign > 0 ? u : 1 - u), height * v)
  const orient = (ring: PointMm[]) => sign > 0 ? ring : ring.reverse()
  const skirtCenter = 1200 + (eroded ? (random('slope toe') - .5) * 1400 : 0)
  const toeReach = coast ? 1410 : 0
  const crest = (ring: readonly XY[], label: string) => orient(ring.map(([x, y], i) => {
    const foot = eroded && label === 'bench' ? Math.max(0, Math.min(1, (y - 2050) / 1950))
      * toeReach * Math.exp(-(((x - skirtCenter) / 1440) ** 2)) : 0
    return local(x + (random(`${label}/${i}/x`) - .5) * 330, y + (random(`${label}/${i}/y`) - .5) * 340 + foot)
  }))
  const benchOutline = crest(bench, 'bench')
  const islandOutline = coast ? undefined : orient(island.map(([x, y], i) => landPoint(
    x + (random(`shore/${i}/x`) - .5) * .019, y + (random(`shore/${i}/y`) - .5) * .021)))
  const reefs = coast ? [] : naturalStones ? shapedCoastalReefs(islandOutline!, landPoint, orient, scale, random) : reefLocations.map(([x, y, rx, ry], i) => {
    const rotation = random(`reef/${i}/rotation`) * Math.PI * 2
    return Array.from({ length: 6 + i % 3 }, (_, j) => {
      const angle = rotation + j * Math.PI * 2 / (6 + i % 3), radius = .65 + .38 * random(`reef/${i}/${j}`)
      return landPoint(x + Math.cos(angle) * radius * rx, y + Math.sin(angle) * radius * ry)
    })
  })
  const entry = coast ? point(centerX - sign * scale * (5300 + 650 * random('entry')), height * .929)
    : landPoint(.385 + .035 * random('entry'), .895)
  const foot = local(-2530, 5240)
  const coastApproach = [point(entry.x + (foot.x - entry.x) * .32, entry.y + (foot.y - entry.y) * .19),
    point(entry.x + (foot.x - entry.x) * .81, entry.y + (foot.y - entry.y) * .46),
    local(-2530, 6180)]
  const lower = coast ? eroded
    ? [point(entry.x, height * .906), local(-4520, 6350), local(-3320, 6000), foot]
    : [entry, ...coastApproach, foot]
    : [entry, local(-5100, 7130), local(-3940, 6240), local(-2530, 5700), foot]
  const middlePoints: readonly XY[] = [[-2530,2410],[-1620,2690],[-630,2780],[820,2720],[2140,2430],
    [3100,1860],[3630,1130],[3670,420],[3500,-210]]
  const shelfLean = eroded ? (random('shelf lean') - .5) * 300 : 0
  const middle = middlePoints.map(([x, y], i) => local(x, y + Math.sin(i / (middlePoints.length - 1) * Math.PI) * shelfLean))
  const upper = ([[1040,-580],[380,-675],[-360,-430]] as const).map(([x, y]) => local(x, y))
  const widthMm = Math.round(1470 + Math.min(1550, (scale - 1) * 425))
  const stairBends = eroded ? [
    local(-2820 + random('lower stair bend') * 180, 3850),
    local(2240, -225 + random('upper stair bend') * 295),
  ] : undefined
  const riseScale = Math.min(2.25, 1 + (scale - 1) * .32)
  const vergePatches = [
    [landPoint(.255, coast ? .756 : .575), 3560, 1840, -.42, 0],
    [landPoint(.38, coast ? .839 : .805), 2940, 1580, .29, 0],
    [local(-4950, 4500), 2300, 1540, -.33, 0],
    [landPoint(.36, coast ? .70 : .32), 2500, 1390, .26, 0],
    [local(-3470,-680), 1230, 1900, .22, 1],
    [local(2810,-2150), 1260, 1020, -.35, 1],
    [local(1630,2300), 2250, 1060, .12, 1],
    [local(-640,100), 1750, 1320, -.36, 2],
  ] as const
  const coastalLowland = coast && (() => {
    const clearance = Math.max(...benchOutline.map((a, i) => {
      const b = benchOutline[(i + 1) % benchOutline.length]
      return Math.max(coast.shorelineAt(a.x) - a.y, coast.shorelineAt((a.x + b.x) / 2) - (a.y + b.y) / 2)
    }))
    const shift = Math.max(0, Math.round(clearance + 830 * scale))
    const shorelineAt = (x: number) => {
      const original = coast.shorelineAt(x)
      return Math.max(original * .27, original - shift)
    }
    const inland = Array.from({ length: 22 }, (_, i) => {
      const x = width * i / 21
      return point(x, shorelineAt(x) + coast.duneAt(x) - coast.shorelineAt(x) + height * (.017 + .012 * random(`dunes/${i}`)))
    })
    inland.push(point(width, height), point(0, height))
    return { shorelineAt, inland }
  })()
  const outcrops = [
    [landPoint(.22, coast ? .76 : .42), 2550, 870, -.58, 0],
    [landPoint(.53, coast ? .70 : .86), 1780, 650, -.51, 0],
    [local(-3560, 500), 1050, 1920, .18, 1],
    [local(1740, -2900), 1750, 720, .22, 1],
    [local(-1530, -1140), 1420, 770, -.62, 2],
  ] as const
  return {
    name: coast ? '潮湾崖道' : '层岩旧道',
    center: local(60, -380), scale, islandOutline, reefs, ...coastalLowland, vergePatches, outcrops,
    bench: benchOutline, summit: crest(summit, 'summit'),
    benchHeightMm: 800 + Math.round(1430 * riseScale), summitHeightMm: 800 + Math.round(3060 * riseScale),
    trails: [lower, middle, upper], widthMm, stairBends, slopeToe: local(skirtCenter, 3900 + toeReach * .84),
    bayDirection: { x: -sign, y: coast ? 0 : 1 },
  }
}

/** Shallow compact beds and worn slopes make the individual reef tops read
 * as rock. The real surface stays above water over its complete outline. */
export function shapeCoastalReef(area: TerrainArea, index: number, seed: string, scale: number, meter?: ExecutionBudget) {
  const bounds = reliefBounds(terrainPoints(area)), rise = area.groundElevationMm
  const shape = createTerrainRelief(bounds, p => {
    const x = (p.x - bounds.x) / bounds.width - .5, y = (p.y - bounds.y) / bounds.height - .5
    const ridge = Math.max(0, .74 - Math.abs(x + .22 * y + .10) * 1.78 - Math.abs(y - .06) * 1.32)
    const tilt = index % 2 ? x * .41 - y * .63 : y * .51 - x * .12
    const fracture = terrainValueNoise(seed, `reef bed/${index}`, x * 3.3, y * 2.5)
    return rise * (.65 * ridge + .42 * tilt + .15 * fracture)
  }, Math.round(Math.max(195, 245 * scale)))
  meter?.charge({ gridNodes: shape.offsetsMm.length, fieldEvaluations: shape.offsetsMm.length })
  area.relief = shape
}

/** The path drawn over the pasture leaves continuous shoulders. Vary the
 * width and break up the cover perimeter with short seeded edges. */
export function trailGrassOutline(points: PointMm[], widthMm: number, scale: number, seed: string, index: number): PointMm[] {
  const lobes = points.map(p => terrainValueNoise(seed, `coastal-ascent/verge/${index}`, p.x / (1900 * scale), p.y / (1500 * scale)))
  const reach = Math.min(4300, 1940 * scale)
  for (const factor of [1, .74, .52, .28, 0]) {
    const widths = lobes.map(lobe => widthMm + reach * factor * (1 + .48 * lobe))
    const strip = polylineBand(points, widths, false).map(({ x, y }) => point(x, y))
    if (!polygonValid(strip, false)) continue
    const uneven = strip.flatMap((a, i) => {
      const b = strip[(i + 1) % strip.length], dx = b.x - a.x, dy = b.y - a.y
      const length = Math.hypot(dx, dy), count = Math.min(7, Math.max(2, Math.ceil(length / (610 * scale))))
      return Array.from({ length: count }, (_, j) => {
        const t = .10 + j / count * .84
        const n = (terrainRandomUnit(seed, `verge-edge/${index}/${i}/${j}`) - .49) * Math.min(400 * scale, length * .28)
        return point(a.x + dx * t - dy / length * n, a.y + dy * t + dx / length * n)
      })
    })
    return polygonValid(uneven, false) ? uneven : strip
  }
  throw new Error('沿路草地转角没有足够空间。')
}

/** Keep the trail, landings and summit clearing level while the rock behind
 * them changes height. The extra cell of clearance protects interpolation. */
export function shapeCoastalRock(area: TerrainArea, trail: Path, activity: PointMm[] | undefined, seed: string, scale: number, meter?: ExecutionBudget, dropMm?: number) {
  const ridge = terrainPoints(area), bounds = reliefBounds(ridge), cellMm = Math.round(450 * scale)
  const pathEdges = trail.centerlineMm.slice(1).map((b, i) => [trail.centerlineMm[i], b] as const)
  const activityEdges = activity?.map((a, i) => [a, activity[(i + 1) % activity.length]] as const) ?? []
  const high = !!activity, collar = cellMm * Math.SQRT2
  const gullies = dropMm ? (() => {
    const frame = connectionArcFrame([...ridge, ridge[0]])
    const phase = terrainRandomUnit(seed, `${area.id}/gully phase`)
    return [0, .39, .71].map(offset => frame.at((phase + offset) % 1 * frame.length))
  })() : []
  const shape = createTerrainRelief(bounds, q => {
    if (activity && pointInPolygon(q, activity)) return 0
    const roadClearance = Math.min(...pathEdges.map(([a, b]) => distanceToSegment(q, a, b))) - trail.widthMm * .79
    const activityClearance = Math.min(...activityEdges.map(([a, b]) => distanceToSegment(q, a, b))) - 180
    const t = Math.min(1, Math.max(0, (Math.min(roadClearance, activityClearance) - collar) / (840 * scale)))
    if (!t) return 0
    const x = q.x / scale, y = q.y / scale
    const folded = terrainValueNoise(seed, `${area.id}/fold`, (x + y * .38) / 2100, (y - x * .18) / 1500)
    const worn = terrainValueNoise(seed, `${area.id}/worn`, x / 570, y / 790)
    let rise = Math.min(1.8, Math.sqrt(scale)) * ((high ? 430 : 150) + folded * (high ? 510 : 430) + worn * 135)
    if (dropMm) {
      const reach = Math.min(5400, scale * (high ? 1740 : 2480))
      const furrow = Math.max(...gullies.map(center => Math.max(0, 1 - Math.hypot(q.x - center.x, q.y - center.y) / reach)))
      rise = rise * .69 - dropMm * .77 * furrow * (2 - furrow) + dropMm * .12 * folded
    }
    return rise * t * t * (3 - 2 * t)
  }, cellMm)
  const samples = shape.offsetsMm.length
  meter?.charge({ gridNodes: samples, fieldEvaluations: samples * (2 + gullies.length), intersectionPairs: samples * (pathEdges.length + activityEdges.length) })
  area.relief = shape
}
