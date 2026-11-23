import { connectionBand } from '../geometry/geometry.js'
import { routeWidthFrame } from '../geometry/route-width.js'
import type { BridgeArt, Path, PointMm, PropDefinition, PropTemplate } from '../model/scene.js'
import { LINE_PROFILES, type LineProfile } from './profiles.js'
import { PATH_ASSEMBLY_MEMBER_LIMIT, pathSectionPartKey, type BridgeStructure, type PathAssemblyRecipe } from './contracts.js'

const radians = Math.PI / 180
const roundMm = (value: number) => Math.round(value) || 0
const yaw = (angle: number) => ((angle % 360) + 360) % 360

export function propDefinitionSection(definition: PropDefinition): PropTemplate {
  return {
    definitionRef: { id: definition.id, version: definition.version }, appearance: definition.defaultAppearance,
    positionMm: { x: 0, y: 0 }, rotationDeg: 0, visualBoundsMm: definition.defaultVisualBoundsMm,
    footprintMm: definition.defaultFootprintMm, footprintOffsetMm: definition.defaultFootprintOffsetMm,
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
    renderLayer: definition.defaultRenderLayer, renderOrder: 0, shadowClass: definition.defaultShadowClass, shadowOverride: null,
  }
}

function builtInSection(bridgeArt: BridgeArt, lengthMm: number): PropTemplate {
  const lamp = bridgeArt === 'lamp'
  const depthMm = bridgeArt === 'steelRail' ? 362 : 220
  return {
    definitionRef: null, appearance: { kind: 'symbol', symbol: 'crate', bridgeArt, tint: null, opacity: 1 },
    positionMm: { x: 0, y: 0 }, rotationDeg: 0,
    visualBoundsMm: lamp ? { x: -440, y: -600, width: 880, height: 820 }
      : { x: -Math.floor(lengthMm / 2), y: -Math.floor(depthMm / 2), width: lengthMm, height: depthMm },
    footprintMm: lamp ? { width: 80, height: 80 } : { width: Math.max(1, lengthMm - 4), height: depthMm },
    footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: !lamp, blocksSight: false,
    renderLayer: 'object', renderOrder: lamp ? 1 : 0, shadowClass: 'none', shadowOverride: null,
  }
}

export function standardPathSection(kind: 'steel' | 'timber', lengthMm: number): PropTemplate {
  return builtInSection(kind === 'steel' ? 'steelRail' : 'timberRail', lengthMm)
}

export function profilePathSection(profile: LineProfile, lengthMm: number): PropTemplate {
  const template = builtInSection(profile, lengthMm), height = LINE_PROFILES[profile].widthMm
  return { ...template, visualBoundsMm: { ...template.visualBoundsMm, y: -Math.floor(height / 2), height },
    footprintMm: { width: lengthMm, height }, blocksMovement: profile !== 'coolantPipe' }
}

/** Match the authored pipe width while keeping its non-blocking placement behavior. */
export function pipeFittingTemplate(art: 'pipeManifold' | 'pipeSocket', lengthMm: number, pipe: PropTemplate): PropTemplate {
  const joint = art === 'pipeManifold'
  const height = Math.ceil(pipe.visualBoundsMm.height * (joint ? 1.32 : 1.04))
  const footprintHeight = pipe.footprintMm.height
  return { ...builtInSection(art, lengthMm), blocksMovement: pipe.blocksMovement, renderLayer: pipe.renderLayer, renderOrder: pipe.renderOrder + 1,
    visualBoundsMm: { x: -Math.floor(lengthMm / 2), y: -Math.floor(height / 2), width: lengthMm, height },
    footprintMm: { width: joint ? Math.min(lengthMm, footprintHeight) : lengthMm, height: footprintHeight } }
}

export const standardPathLamp = () => builtInSection('lamp', 80)

export function bridgeNodeLamp(): PropTemplate {
  const lamp = standardPathLamp()
  return { ...lamp, appearance: { kind: 'symbol', symbol: 'crate', bridgeArt: 'nodeLamp', tint: null, opacity: 1 },
    visualBoundsMm: { x: -350, y: -350, width: 700, height: 700 }, renderOrder: 4 }
}

export function bridgeJointTemplate(palette: BridgeStructure['palette'], role: 'support' | 'corner',
  { lengthMm, visualWidthMm, footprintWidthMm }: BridgeStructure['support'] | NonNullable<BridgeStructure['corner']>, detailPercent?: number): PropTemplate {
  const bridgeArt = role === 'support' ? `${palette}Support` as const : `${palette}Corner` as const
  // The extra cladding projects outboard while the load-bearing foot stays centered on the beam.
  const outboard = Math.max(0, roundMm((visualWidthMm - footprintWidthMm) / 4))
  return { ...builtInSection(bridgeArt, lengthMm),
    appearance: { kind: 'symbol', symbol: 'crate', bridgeArt, tint: null, opacity: 1, ...(detailPercent === undefined ? {} : { detailPercent }) },
    visualBoundsMm: { x: -Math.floor(lengthMm / 2), y: outboard - Math.floor(visualWidthMm / 2), width: lengthMm, height: visualWidthMm },
    footprintMm: { width: lengthMm, height: footprintWidthMm }, renderOrder: role === 'support' ? 2 : 3 }
}

export interface BridgeLanding {
  side: 'start' | 'end'
  originMm: PointMm
  endMm: PointMm
  outline: [PointMm, PointMm, PointMm, PointMm]
}

/** Widen the real deck by the shoulders and give integer vertices room to round at both caps. */
export function bridgeDeckGeometry(path: Pick<Path, 'centerlineMm' | 'widthMm'>, shoulderMm: number,
  bridgehead?: BridgeStructure['bridgehead']): { outline: PointMm[]; landings: BridgeLanding[] } {
  const runs = straightRuns(path.centerlineMm)
  if (!runs.length) return { outline: [], landings: [] }
  const end = path.centerlineMm.at(-1)!
  const points = [...runs.map(run => run.start), end], start = points[0]
  const extend = (point: PointMm, neighbor: PointMm) => {
    const x = point.x - neighbor.x, y = point.y - neighbor.y, length = Math.hypot(x, y)
    return length ? { x: point.x + 2 * x / length, y: point.y + 2 * y / length } : point
  }
  const front = extend(start, points[1]), back = extend(end, points.at(-2)!)
  const half = path.widthMm / 2 + shoulderMm + 2
  const roundPoint = (p: PointMm) => ({ x: roundMm(p.x), y: roundMm(p.y) })
  const outline = connectionBand([front, ...points.slice(1, -1), back], half * 2).map(roundPoint)
  if (!bridgehead || !outline.length) return { outline, landings: [] }

  const middle = outline.length / 2
  const landing = (side: BridgeLanding['side']): BridgeLanding | undefined => {
    if (bridgehead.ends !== 'both' && bridgehead.ends !== side) return undefined
    const first = side === 'start', point = first ? start : end, run = first ? runs[0] : runs.at(-1)!
    const distance = bridgehead.lengthMm * (first ? -1 : 1)
    const endMm = { x: point.x + run.dx * distance, y: point.y + run.dy * distance }
    const reach = half + bridgehead.wideningMm
    const outerLeft = roundPoint({ x: endMm.x + run.dy * reach, y: endMm.y - run.dx * reach })
    const outerRight = roundPoint({ x: endMm.x - run.dy * reach, y: endMm.y + run.dx * reach })
    return { side, originMm: point, endMm,
      outline: [outline[first ? 0 : middle - 1], outerLeft, outerRight, outline[first ? outline.length - 1 : middle]] }
  }
  const first = landing('start'), last = landing('end')
  return {
    outline: [...(first ? [first.outline[1]] : []), ...outline.slice(0, middle),
      ...(last ? last.outline.slice(1, 3) : []), ...outline.slice(middle), ...(first ? [first.outline[2]] : [])],
    landings: [first, last].filter(row => row !== undefined),
  }
}

export function straightRuns(points: readonly PointMm[], mergeCollinear = true) {
  const vertices: PointMm[] = []
  for (const end of points) {
    const middle = vertices.at(-1), start = vertices.at(-2)
    if (middle) {
      const u = { x: end.x - middle.x, y: end.y - middle.y }
      if (!u.x && !u.y) return []
      if (start && mergeCollinear) {
        const v = { x: middle.x - start.x, y: middle.y - start.y }
        if (u.x * v.y === u.y * v.x && u.x * v.x + u.y * v.y > 0) vertices.pop()
      }
    }
    vertices.push(end)
  }
  return vertices.slice(0, -1).map((start, index) => {
    const end = vertices[index + 1], length = Math.hypot(end.x - start.x, end.y - start.y)
    return { start, length, dx: (end.x - start.x) / length, dy: (end.y - start.y) / length }
  })
}

export function positionSection(template: PropTemplate, anchor: PointMm, dx: number, dy: number, side: number): PropTemplate {
  const local = template.positionMm, mirror = side < 0
  const bounds = template.visualBoundsMm, footprintOffsetMm = template.footprintOffsetMm
  const appearance = { ...template.appearance }
  if (mirror) {
    if (appearance.mirrorY) delete appearance.mirrorY
    else appearance.mirrorY = true
  }
  return {
    ...template, appearance,
    positionMm: { x: roundMm(anchor.x + dx * local.x - side * dy * local.y), y: roundMm(anchor.y + dy * local.x + side * dx * local.y) },
    rotationDeg: yaw(Math.atan2(dy, dx) / radians + side * template.rotationDeg),
    visualBoundsMm: mirror ? { ...bounds, y: -bounds.y - bounds.height } : bounds,
    footprintOffsetMm: mirror ? { ...footprintOffsetMm, y: -footprintOffsetMm.y || 0 } : footprintOffsetMm,
  }
}

export interface SectionPart { key: string; propTemplate: PropTemplate }

/** The authored anchor is placed in the middle of every full-length section. */
export function minimumPathSectionLength(templates: readonly PropTemplate[]): number {
  let reach = 50
  for (const { positionMm, rotationDeg, visualBoundsMm: bounds, footprintMm, footprintOffsetMm } of templates) {
    const cos = Math.cos(rotationDeg * radians), sin = Math.sin(rotationDeg * radians)
    const projectedReach = (x: number, y: number, width: number, height: number) =>
      Math.abs(positionMm.x + x * cos - y * sin) + (width * Math.abs(cos) + height * Math.abs(sin)) / 2
    reach = Math.max(reach,
      projectedReach(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width, bounds.height),
      projectedReach(footprintOffsetMm.x, footprintOffsetMm.y, footprintMm.width, footprintMm.height))
  }
  return Math.ceil(reach * 2 - 1e-7)
}

/** Full rigid pieces, stationed from each run's start. Shoulders cover the joints and end remainder. */
export function planPathSections(path: Pick<Path, 'centerlineMm' | 'widthMm' | 'widthSections'>, recipe: PathAssemblyRecipe,
  section: readonly SectionPart[], lamp: PropTemplate | undefined): SectionPart[] {
  if (recipe.section.kind === 'none' && !lamp) return []
  const runs = straightRuns(path.centerlineMm), planned: SectionPart[] = []
  const pitch = recipe.section.kind === 'none' ? 2000 : recipe.section.lengthMm
  if (recipe.section.kind === 'prop' || recipe.section.kind === 'prefab') {
    const minimum = minimumPathSectionLength(section.map(part => part.propTemplate))
    if (pitch < minimum) throw new Error('当前源节至少需要 ' + minimum + ' 毫米的长度，请加大节距或将锚点移到中间。')
  }
  const width = path.widthSections && routeWidthFrame(path.centerlineMm, path.widthMm, path.widthSections)
  const widthAt = (station: number) => width?.widthAt(station) ?? path.widthMm
  const cornerClearance = (i: number, station: number) => {
    const a = runs[i - 1], b = runs[i]
    if (!a || !b) return recipe.endClearanceMm
    const dot = a.dx * b.dx + a.dy * b.dy
    if (dot < -.999) throw new Error('沿线构件无法在折返处接合，请分开绘制。')
    const outer = widthAt(station) / 2 + recipe.shoulderMm
    return Math.ceil(outer * Math.abs(a.dx * b.dy - a.dy * b.dx) / (1 + dot)) + 2
  }
  const sides = recipe.sides === 'both' ? ['left', 'right'] as const : [recipe.sides]
  let cadence = 0, travelled = 0
  for (const [index, run] of runs.entries()) {
    const from = cornerClearance(index, travelled), through = run.length - cornerClearance(index + 1, travelled + run.length)
    const count = Math.floor((through - from + 1e-7) / pitch)
    for (let tile = 0; tile < count; tile++, cadence++) {
      const distance = from + pitch * (tile + .5)
      const fromMm = travelled + from + pitch * tile
      for (const side of sides) {
        if (recipe.gaps?.some(gap => (gap.side === 'both' || gap.side === side) && fromMm < gap.toMm && fromMm + pitch > gap.fromMm)) continue
        const sign = side === 'left' ? -1 : 1
        const offset = (widthAt(travelled + distance) + recipe.shoulderMm) / 2
        const anchor = { x: run.start.x + distance * run.dx - sign * offset * run.dy,
          y: run.start.y + distance * run.dy + sign * offset * run.dx }
        const slope = sign * (widthAt(fromMm + pitch) - widthAt(fromMm)) / (2 * pitch)
        const headingLength = Math.hypot(1, slope)
        const dx = (run.dx - slope * run.dy) / headingLength, dy = (run.dy + slope * run.dx) / headingLength
        const prefix = [side, index, tile].join(':')
        for (const part of section) planned.push({ key: prefix + ':' + pathSectionPartKey(part.key),
          propTemplate: positionSection(part.propTemplate, anchor, dx, dy, sign) })
        if (lamp && cadence % recipe.lamps!.every === 0) planned.push({ key: prefix + ':lamp',
          propTemplate: positionSection(lamp, anchor, dx, dy, sign) })
        if (planned.length > PATH_ASSEMBLY_MEMBER_LIMIT) throw new Error('沿线构件最多 ' + PATH_ASSEMBLY_MEMBER_LIMIT + ' 件。请缩短路线、加大节距或减少部件。')
      }
    }
    travelled += run.length
  }
  if (!cadence) throw new Error('可用直段放不下一节构件。请缩短节距、减小留空或选用空边。')
  return planned
}
