import type { Path, PointMm, PropTemplate } from '../model/scene.js'
import { routeWidthFrame } from '../geometry/route-width.js'
import { assertSimpleVisualPolyline } from '../visual/geometry.js'
import { PATH_ASSEMBLY_MEMBER_LIMIT, pathSectionPartKey, type BridgeStructure, type FenceAssemblyRecipe, type PathAssemblyRecipe } from './contracts.js'
import { bridgeJointTemplate, minimumPathSectionLength, pipeFittingTemplate, positionSection, straightRuns, type BridgeLanding, type SectionPart } from './layout.js'
import { isCoolantPipeSection } from './pipe-geometry.js'

const round = (number: number) => Math.round(number) || 0

type Extent = { min: number; max: number }
type Axis = 'x' | 'y'
type Shape = 'visual' | 'footprint'

function templateBox(template: PropTemplate, shape: Shape) {
  const { visualBoundsMm: bounds, footprintMm, footprintOffsetMm } = template
  return shape === 'visual'
    ? { width: bounds.width, height: bounds.height, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : { ...footprintMm, ...footprintOffsetMm }
}

function axisExtent(parts: readonly SectionPart[], shape: Shape, axis: Axis): Extent {
  const extents = parts.map(({ propTemplate: template }) => {
    const theta = template.rotationDeg * Math.PI / 180
    const cos = Math.cos(theta), sin = Math.sin(theta), box = templateBox(template, shape)
    const center = axis === 'y' ? box.x * sin + box.y * cos : box.x * cos - box.y * sin
    const half = axis === 'y' ? (Math.abs(sin) * box.width + Math.abs(cos) * box.height) / 2
      : (Math.abs(cos) * box.width + Math.abs(sin) * box.height) / 2
    return { min: template.positionMm[axis] + center - half, max: template.positionMm[axis] + center + half }
  })
  return { min: Math.min(...extents.map(box => box.min)), max: Math.max(...extents.map(box => box.max)) }
}

export function sectionWidths(parts: readonly SectionPart[]) {
  const width = (shape: Shape) => { const { min, max } = axisExtent(parts, shape, 'y'); return Math.ceil(max - min - 1e-7) }
  return { visualWidthMm: width('visual'), footprintWidthMm: width('footprint') }
}

/** Full local cross-section, including source parts whose anchors are off center. */
export function sectionSideReachMm(parts: readonly SectionPart[]): number {
  if (!parts.length) return 0
  const visual = axisExtent(parts, 'visual', 'y'), footprint = axisExtent(parts, 'footprint', 'y')
  return Math.ceil(Math.max(-visual.min, visual.max, -footprint.min, footprint.max) - 1e-7)
}

function scaleBox(template: PropTemplate, shape: Shape, axis: Axis, ratio: number, position: PointMm) {
  const box = templateBox(template, shape)
  const theta = template.rotationDeg * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta)
  const aligned = Math.abs(sin) < 1e-7 || Math.abs(cos) < 1e-7
  // An oblique rectangle has no exact anisotropic transform in the object model.
  // Scale its extents uniformly, retaining its heading and the target cross-axis reach.
  const localWidth = axis === 'x' ? Math.abs(cos) > .5 : Math.abs(sin) > .5
  const width = Math.max(1, round(box.width * (!aligned || localWidth ? ratio : 1)))
  const height = Math.max(1, round(box.height * (!aligned || !localWidth ? ratio : 1)))
  const center = { x: template.positionMm.x + box.x * cos - box.y * sin,
    y: template.positionMm.y + box.x * sin + box.y * cos }
  center[axis] *= ratio
  const dx = center.x - position.x, dy = center.y - position.y
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos, width, height }
}

function scaleTemplate(template: PropTemplate, axis: Axis, visual: number, footprint: number): PropTemplate {
  if (visual === 1 && footprint === 1) return template
  const positionMm = { ...template.positionMm }
  if (visual === footprint) positionMm[axis] = round(positionMm[axis] * visual)
  const v = scaleBox(template, 'visual', axis, visual, positionMm), f = scaleBox(template, 'footprint', axis, footprint, positionMm)
  return { ...template, positionMm,
    visualBoundsMm: { x: round(v.x - v.width / 2), y: round(v.y - v.height / 2), width: v.width, height: v.height },
    footprintMm: { width: f.width, height: f.height }, footprintOffsetMm: { x: round(f.x), y: round(f.y) } }
}

export function sizeSection(parts: readonly SectionPart[], dimensions: PathAssemblyRecipe['dimensions']): readonly SectionPart[] {
  if (!parts.length || !dimensions) return parts
  const widths = sectionWidths(parts)
  const visual = dimensions.visualWidthMm === undefined ? 1 : dimensions.visualWidthMm / widths.visualWidthMm
  const footprint = dimensions.footprintWidthMm === undefined ? 1 : dimensions.footprintWidthMm / widths.footprintWidthMm
  return parts.map(({ key, propTemplate }) => {
    const template = scaleTemplate(propTemplate, 'y', visual, footprint), appearance = template.appearance
    if (dimensions.detailPercent === undefined || appearance.kind !== 'symbol' || !appearance.bridgeArt || appearance.bridgeArt === 'lamp') return { key, propTemplate: template }
    return { key, propTemplate: { ...template, appearance: { ...appearance, detailPercent: dimensions.detailPercent } } }
  })
}

export function fittingSectionLength(parts: readonly SectionPart[]): number {
  if (!parts.length) throw new Error('接合铺设需要一个源节。')
  if (parts.some(({ propTemplate }) => Math.abs(propTemplate.rotationDeg % 90) > 1e-7)) throw new Error('接合铺设的源节部件须沿纵横轴对齐。请调整部件角度，或选用固定节长。')
  return minimumPathSectionLength(parts.map(part => part.propTemplate))
}

export function fitSectionParts(parts: readonly SectionPart[], lengthMm: number): SectionPart[] {
  const ratio = lengthMm / fittingSectionLength(parts)
  return parts.map(({ key, propTemplate }) => ({ key, propTemplate: scaleTemplate(propTemplate, 'x', ratio, ratio) }))
}

function avoidOpenings(from: number, to: number, openings: NonNullable<PathAssemblyRecipe['gaps']>): [number, number][] {
  const spans: [number, number][] = []
  for (const gap of [...openings].sort((a, b) => a.fromMm - b.fromMm)) {
    if (gap.toMm <= from || gap.fromMm >= to) continue
    if (gap.fromMm > from) spans.push([from, gap.fromMm])
    from = Math.max(from, gap.toMm)
    if (from >= to) break
  }
  if (from < to) spans.push([from, to])
  return spans
}

// On a bend the rails meet at the intersection of their offset lines. Both
// tractable rail reaches and their actual, placed footprints are checked.
function joinShift(before: { dx: number; dy: number }, after: { dx: number; dy: number }, offset: number) {
  const dot = before.dx * after.dx + before.dy * after.dy
  if (dot < -.5000001) throw new Error('接合转角过锐。请拆成两条线，或增加一个转折过渡点。')
  return -offset * (before.dx * after.dy - before.dy * after.dx) / (1 + dot)
}

export function fenceRoutePoints(boundary: { segments: { start: PointMm; end: PointMm }[]; closed: boolean }): PointMm[] {
  return boundary.closed ? boundary.segments.map(segment => segment.start)
    : [...boundary.segments.map(segment => segment.start), boundary.segments.at(-1)!.end]
}

interface LayoutOptions {
  offsetMm: number
  widthOffsetAt?: (stationMm: number) => number
  closed: boolean
  sides: readonly ('left' | 'right')[]
  fit: boolean
  structure?: BridgeStructure
  landings?: readonly BridgeLanding[]
  preserveLegs?: boolean
}

function nodeRadius(template: PropTemplate) {
  const reach = (box: ReturnType<typeof templateBox>) => Math.hypot(Math.abs(box.x) + box.width / 2, Math.abs(box.y) + box.height / 2)
  return Math.hypot(template.positionMm.x, template.positionMm.y) + Math.max(reach(templateBox(template, 'visual')), reach(templateBox(template, 'footprint')))
}

function planConnectedSections(points: readonly PointMm[], recipe: FenceAssemblyRecipe, section: readonly SectionPart[],
  lamp: PropTemplate | undefined, { offsetMm, widthOffsetAt, closed, sides, fit, structure, landings = [], preserveLegs = false }: LayoutOptions): SectionPart[] {
  assertSimpleVisualPolyline(points, closed)
  const runs = straightRuns(closed ? [...points, points[0]] : points, !preserveLegs)
  const length = runs.reduce((sum, run) => sum + run.length, 0)
  const pitch = recipe.section.kind === 'none' ? 2000 : recipe.section.lengthMm
  const referenceLength = fit ? fittingSectionLength(section) : pitch
  if (!fit && section.length && pitch < minimumPathSectionLength(section.map(part => part.propTemplate))) throw new Error('源节的现有占地或外观长于当前节距。')
  if (!runs.length) throw new Error('请至少绘制一条有效线段。')
  if (recipe.gaps?.some(gap => gap.toMm > Math.ceil(length))) throw new Error('开口超出路线总长。')
  const result: SectionPart[] = []
  const add = (key: string, propTemplate: PropTemplate) => {
    if (result.length >= PATH_ASSEMBLY_MEMBER_LIMIT) throw new Error('沿线构件最多 192 件。请缩短路线、增大节距或减少部件。')
    result.push({ key, propTemplate })
  }
  const pipe = fit && isCoolantPipeSection(section) ? section[0].propTemplate : undefined
  const manifold = pipe && pipeFittingTemplate('pipeManifold', Math.ceil(pipe.visualBoundsMm.height * 1.32), pipe)
  const manifoldReach = manifold ? manifold.visualBoundsMm.width / 2 : 0
  const detail = recipe.dimensions?.detailPercent
  const support = structure && bridgeJointTemplate(structure.palette, 'support', structure.support, detail)
  const corner = structure?.corner && bridgeJointTemplate(structure.palette, 'corner', structure.corner, detail)
  const nodeLamp = structure && lamp && { ...lamp, renderOrder: Math.max(4, lamp.renderOrder) }
  const supportReach = support ? minimumPathSectionLength([support]) / 2 + 1 : 0
  const litSupportReach = support && nodeLamp ? minimumPathSectionLength([support, nodeLamp]) / 2 + 1 : supportReach
  const cornerReach = corner ? Math.max(nodeRadius(corner), nodeLamp ? nodeRadius(nodeLamp) : 0) : 0
  const begin = closed ? 0 : recipe.endClearanceMm, end = closed ? length : length - recipe.endClearanceMm
  let station = 0
  const cadence = { left: 0, right: 0 }
  for (const [index, run] of runs.entries()) {
    const nextStation = station + run.length
    for (const side of sides) {
      const sign = side === 'left' ? -1 : 1
      const offsetAt = (at: number) => sign * (offsetMm + (widthOffsetAt?.(station + Math.min(run.length, Math.max(0, at))) ?? 0))
      const openings = (recipe.gaps ?? []).filter(gap => gap.side === 'both' || gap.side === side)
      const before = runs[index - 1] ?? (closed ? runs.at(-1) : undefined)
      const after = runs[index + 1] ?? (closed ? runs[0] : undefined)
      const joined = (value: number) => value >= begin && value <= end && !openings.some(gap => gap.fromMm <= value && gap.toMm >= value)
        && (!closed || (value > 0 && value < length) || !openings.some(gap => gap.fromMm === 0 || gap.toMm >= length))
      const startJoined = fit && before && joined(station), endJoined = fit && after && joined(nextStation)
      const startShift = startJoined ? -joinShift(before, run, offsetAt(0)) : 0
      const endShift = endJoined ? joinShift(run, after, offsetAt(run.length)) : 0
      const anchorAt = (at: number) => {
        const offset = offsetAt(at)
        return { x: run.start.x + run.dx * at - run.dy * offset, y: run.start.y + run.dy * at + run.dx * offset }
      }
      let tile = 0
      for (const [from, to] of avoidOpenings(Math.max(station, begin), Math.min(nextStation, end), openings)) {
        const a = from - station + (from === station ? startShift : 0)
        const b = to - station + (to === nextStation ? endShift : 0)
        if (b - a < 2) throw new Error(`里程 ${round(from)} mm 附近的转角或开口间距过短。`)
        const count = fit ? Math.ceil((b - a) / pitch - 1e-7) : Math.floor((b - a) / pitch + 1e-7)
        const step = fit ? (b - a) / count : pitch
        if (count > PATH_ASSEMBLY_MEMBER_LIMIT) throw new Error('沿线构件超过数量预算。请缩短路线或增大节距。')
        for (let i = 0; i < count; i++, tile++) {
          const anchor = anchorAt(a + step * (i + .5))
          const slope = (offsetAt(a + step * (i + 1)) - offsetAt(a + step * i)) / step
          const scale = Math.hypot(1, slope)
          const dx = (run.dx - slope * run.dy) / scale, dy = (run.dy + slope * run.dx) / scale
          const prefix = `${side}:${index}:${tile}`
          for (const { key, propTemplate } of section) add(`${prefix}:${pathSectionPartKey(key)}`,
            positionSection(fit ? scaleTemplate(propTemplate, 'x', step * scale / referenceLength, step * scale / referenceLength) : propTemplate, anchor, dx, dy, sign))
          if (!structure && lamp && cadence[side] % recipe.lamps!.every === 0) add(`${prefix}:lamp`, positionSection(lamp, anchor, dx, dy, sign))
          cadence[side]++
        }
        if (pipe) {
          // Seat each terminal sleeve inside its span, including both sides of a deliberate gap.
          const lengthMm = Math.floor(Math.min(pipe.visualBoundsMm.height * .57, (b - a) / 2))
          const socket = pipeFittingTemplate('pipeSocket', lengthMm, pipe)
          if (from > station || !startJoined) add(`${side}:${index}:${tile - count}:startSocket`,
            positionSection(socket, anchorAt(a + lengthMm / 2), run.dx, run.dy, sign))
          if (to < nextStation || !endJoined) add(`${side}:${index}:${tile - 1}:endSocket`,
            positionSection(socket, anchorAt(b - lengthMm / 2), run.dx, run.dy, sign))
        }
        if (structure && support) {
          const spacing = structure.support.spacingMm
          const low = Math.max(from - station, a + (from === station && before ? cornerReach : 0))
          const high = Math.min(to - station, b - (to === nextStation && after ? cornerReach : 0))
          const first = Math.max(0, Math.ceil((low + supportReach) / spacing - .5))
          for (let slot = first, at = (slot + .5) * spacing; at + supportReach <= high; at = (++slot + .5) * spacing) {
            const prefix = `${side}:${index}:${slot}`, anchor = anchorAt(at)
            add(`${prefix}:support`, positionSection(support, anchor, run.dx, run.dy, sign))
            if (nodeLamp && slot % recipe.lamps!.every === 0 && at - litSupportReach >= low && at + litSupportReach <= high) {
              add(`${prefix}:supportLamp`, positionSection(nodeLamp, anchor, run.dx, run.dy, sign))
            }
          }
        }
      }
      const fittingReach = Math.abs(startShift) + manifoldReach
      if (manifold && before && startJoined) {
        // The paired runs enter a shared housing. Its center is the same
        // offset intersection used for both fitted straight sections.
        const stationBefore = station === 0 ? length : station
        const nearOpening = openings.some(gap => gap.fromMm < station + fittingReach && gap.toMm > station - fittingReach
          || gap.fromMm < stationBefore + fittingReach && gap.toMm > stationBefore - fittingReach)
        if (nearOpening || (!closed && (station - fittingReach < begin || station + fittingReach > end))) {
          throw new Error('管线端口或开口离转角太近。请移开开口或缩窄管线。')
        }
        const dx = run.dx + before.dx, dy = run.dy + before.dy, norm = Math.hypot(dx, dy)
        add(`${side}:${index}:0:pipeBend`, positionSection(manifold, anchorAt(startShift), dx / norm, dy / norm, sign))
      }
      const reach = Math.abs(startShift) + cornerReach
      if (corner && before && station - reach >= begin && station + reach <= end
        && !openings.some(gap => gap.fromMm < station + reach && gap.toMm > station - reach)) {
        const dx = run.dx + before.dx, dy = run.dy + before.dy, norm = Math.hypot(dx, dy)
        const anchor = anchorAt(startShift), prefix = `${side}:${index}:0`
        add(`${prefix}:corner`, positionSection(corner, anchor, dx / norm, dy / norm, sign))
        if (nodeLamp) add(`${prefix}:cornerLamp`, positionSection(nodeLamp, anchor, dx / norm, dy / norm, sign))
      }
      const landing = index === 0 || index === runs.length - 1 ? landings.filter(row => row.side === 'start' ? index === 0 : index === runs.length - 1) : []
      if (nodeLamp && structure?.bridgehead) for (const { side: endSide, originMm, endMm } of landing) {
        const endStation = endSide === 'start' ? 0 : length
        if (openings.some(gap => gap.fromMm <= endStation && gap.toMm >= endStation)) continue
        const reach = sign * (offsetMm + structure.bridgehead.wideningMm / 2)
        const anchor = { x: (originMm.x + endMm.x) / 2 - run.dy * reach, y: (originMm.y + endMm.y) / 2 + run.dx * reach }
        add(`${side}:0:${endSide === 'start' ? 0 : 1}:landingLamp`, positionSection(nodeLamp, anchor, run.dx, run.dy, sign))
      }
    }
    station = nextStation
  }
  if (!result.length) throw new Error('可用线段放不下一节构件。请缩短节距、减少留空或选择接合铺设。')
  return result
}

export function planFittingPathSections(path: Pick<Path, 'centerlineMm' | 'widthMm' | 'widthSections'>, recipe: PathAssemblyRecipe, section: readonly SectionPart[], lamp: PropTemplate | undefined,
  landings?: readonly BridgeLanding[]) {
  const width = path.widthSections && routeWidthFrame(path.centerlineMm, path.widthMm, path.widthSections)
  return planConnectedSections(path.centerlineMm, recipe, section, lamp, { offsetMm: (path.widthMm + recipe.shoulderMm) / 2,
    widthOffsetAt: width ? station => (width.widthAt(station) - path.widthMm) / 2 : undefined,
    closed: false, sides: recipe.sides === 'both' ? ['left', 'right'] : [recipe.sides], fit: true, structure: recipe.structure, landings })
}

export function planFenceSections(points: readonly PointMm[], closed: boolean, recipe: FenceAssemblyRecipe, section: readonly SectionPart[], lamp: PropTemplate | undefined, preserveLegs = false) {
  return planConnectedSections(points, recipe, section, lamp, { offsetMm: 0, closed, sides: ['right'], fit: !!recipe.fit || recipe.section.kind === 'profile', preserveLegs })
}
