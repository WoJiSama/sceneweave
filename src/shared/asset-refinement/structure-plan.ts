import { z } from 'zod'
import { normalizeStaticSvg, STATIC_SVG_LIMITS } from '../ai/svg.js'
import { captureJson, encodeUtf8 } from '../validation/json.js'

/** A source-bound drawing plan, supplied by visual analysis or deliberate editing. */
export const VECTOR_STRUCTURE_LIMITS = Object.freeze({ elements: 96, gradients: 32, stops: 16, sourcePixels: 1_000_000 })
const id = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/)
const colour = z.string().regex(/^#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i)
const coordinate = z.number().min(0).max(STATIC_SVG_LIMITS.coordinate)
const paint = z.union([colour, z.literal('none'), z.strictObject({ gradient: id })])
const sourceSchema = z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) })
const common = {
  id, name: z.string().trim().min(1).max(200), evidence: z.enum(['observed', 'inferred']),
  reason: z.string().trim().min(1).max(1000), fill: paint, stroke: paint.optional(), strokeWidth: z.number().min(0).max(32).optional(),
  opacity: z.number().min(0).max(1).optional(), fillRule: z.enum(['nonzero', 'evenodd']).optional(),
  linecap: z.enum(['butt', 'round', 'square']).optional(), linejoin: z.enum(['miter', 'round', 'bevel']).optional(),
}
const rawSchema = z.strictObject({
  version: z.literal(1), source: sourceSchema, summary: z.string().trim().min(1).max(2000),
  gradients: z.array(z.strictObject({ id, x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate,
    stops: z.array(z.strictObject({ offset: z.number().min(0).max(1), color: colour, opacity: z.number().min(0).max(1).optional() }))
      .min(2).max(VECTOR_STRUCTURE_LIMITS.stops) })).max(VECTOR_STRUCTURE_LIMITS.gradients),
  elements: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ ...common, kind: z.literal('path'), d: z.string().min(1).max(STATIC_SVG_LIMITS.sourceBytes) }),
    z.strictObject({ ...common, kind: z.literal('repeatRects'), x: coordinate, y: coordinate,
      width: z.number().positive().max(8192), height: z.number().positive().max(8192),
      stepX: z.number().min(-8192).max(8192), stepY: z.number().min(-8192).max(8192), count: z.number().int().min(1).max(STATIC_SVG_LIMITS.paths) }),
  ])).min(1).max(VECTOR_STRUCTURE_LIMITS.elements),
})
export type VectorStructurePlan = z.infer<typeof rawSchema>
export type VectorStructureSource = VectorStructurePlan['source']
type Element = VectorStructurePlan['elements'][number]
type Paint = Element['fill']
const number = (value: number) => String(Object.is(value, -0) ? 0 : value)
function invalid(message: string): never { throw new Error(`矢量结构稿无效：${message}`) }

/** A small absolute path grammar keeps every control point in the source frame. */
function pathData(input: string, frame: VectorStructureSource): { d: string; commands: number; bounds: { left: number; top: number; right: number; bottom: number } } {
  if (/(^\s*,|,\s*,|,\s*[A-Za-z]|,\s*$)/.test(input)) invalid('路径分隔符无效。')
  const token = /[MLQCZ]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
  const tokens: string[] = []
  let offset = 0
  while (offset < input.length) {
    if (/[\s,]/.test(input[offset])) { offset++; continue }
    token.lastIndex = offset
    const match = token.exec(input)
    if (!match) invalid('路径仅支持绝对M/L/Q/C/Z与有限十进制坐标。')
    tokens.push(match[0]); offset = token.lastIndex
    if (tokens.length > STATIC_SVG_LIMITS.pathCommands * 7) invalid('路径指令预算超限。')
  }
  if (tokens[0] !== 'M') invalid('路径必须以绝对M开始。')
  const arity: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 }
  const output: string[] = []
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  let at = 0, commands = 0, open = false, drawn = false
  while (at < tokens.length) {
    const command = tokens[at++]
    if (!Object.hasOwn(arity, command)) invalid('每组路径坐标必须声明命令。')
    if (command === 'Z') {
      if (!open) invalid('闭合路径缺少起点。')
      output.push('Z'); open = false; commands++; continue
    }
    if (command !== 'M' && !open) invalid('路径段缺少M起点。')
    const count = arity[command]
    let groups = 0
    while (at < tokens.length && !/^[MLQCZ]$/.test(tokens[at])) {
      if (at + count > tokens.length || tokens.slice(at, at + count).some(value => /^[MLQCZ]$/.test(value))) invalid('路径命令坐标数量无效。')
      const values = tokens.slice(at, at + count).map(Number)
      if (values.some((value, index) => !Number.isFinite(value) || value < 0 || value > (index % 2 ? frame.height : frame.width))) invalid('路径坐标或控制点超出源图框。')
      for (let index = 0; index < values.length; index += 2) {
        bounds.left = Math.min(bounds.left, values[index]); bounds.right = Math.max(bounds.right, values[index])
        bounds.top = Math.min(bounds.top, values[index + 1]); bounds.bottom = Math.max(bounds.bottom, values[index + 1])
      }
      const actual = command === 'M' && groups > 0 ? 'L' : command
      output.push(`${actual}${values.map(number).join(' ')}`)
      if (actual !== 'M') drawn = true
      open = true; at += count; groups++; commands++
      if (commands > STATIC_SVG_LIMITS.pathCommands) invalid('路径指令预算超限。')
    }
    if (!groups) invalid('路径命令缺少坐标。')
  }
  if (!drawn) invalid('路径必须包含实际线段或曲线。')
  return { d: output.join(''), commands, bounds }
}

function checkStrokeBounds(element: Element, bounds: { left: number; top: number; right: number; bottom: number }, frame: VectorStructureSource): void {
  if (element.stroke === undefined || element.stroke === 'none' || element.strokeWidth === 0) return
  // SVG defaults: stroke-width=1, linejoin=miter and miterlimit=4. The
  // control-point box is conservative for curves; square caps add diagonally.
  const halfWidth = (element.strokeWidth ?? 1) / 2
  const joinFactor = element.linejoin === undefined || element.linejoin === 'miter' ? 4 : 1
  const margin = halfWidth * Math.max(joinFactor, element.linecap === 'square' ? Math.SQRT2 : 1)
  if (bounds.left - margin < 0 || bounds.top - margin < 0 || bounds.right + margin > frame.width || bounds.bottom + margin > frame.height)
    invalid('描边外扩超出源图框，未静默裁切。')
}

function validatePlan(plan: VectorStructurePlan): void {
  const { width, height } = plan.source
  if (width * height > VECTOR_STRUCTURE_LIMITS.sourcePixels) invalid('源图超过100万像素预算。')
  // Reject the aggregate text before serializing; each individual d may be large.
  let characters = plan.summary.length
  for (const element of plan.elements) {
    characters += element.name.length + element.reason.length + (element.kind === 'path' ? element.d.length : 0)
    if (characters > STATIC_SVG_LIMITS.sourceBytes) invalid('结构稿文本超过1MiB预算。')
  }
  if (encodeUtf8(JSON.stringify(plan)).length > STATIC_SVG_LIMITS.sourceBytes) invalid('结构稿文本超过1MiB预算。')
  const ids = new Set<string>(), gradients = new Set<string>()
  const unique = (value: string) => { if (ids.has(value)) invalid('元素或渐变ID重复。'); ids.add(value) }
  for (const gradient of plan.gradients) {
    unique(gradient.id); gradients.add(gradient.id)
    if ([gradient.x1, gradient.x2].some(x => x > width) || [gradient.y1, gradient.y2].some(y => y > height)) invalid('渐变端点超出源图框。')
    if (gradient.x1 === gradient.x2 && gradient.y1 === gradient.y2) invalid('渐变端点不能相同。')
    if (gradient.stops[0].offset !== 0 || gradient.stops.at(-1)!.offset !== 1
      || gradient.stops.some((stop, index) => index > 0 && stop.offset <= gradient.stops[index - 1].offset)) invalid('渐变stop须从0到1严格递增。')
  }
  const checkPaint = (value: Paint | undefined) => { if (typeof value === 'object' && value && !gradients.has(value.gradient)) invalid('渐变引用缺失。') }
  let paths = 0, commands = 0
  for (const element of plan.elements) {
    unique(element.id); checkPaint(element.fill); checkPaint(element.stroke)
    if (element.fill === 'none' && (element.stroke === undefined || element.stroke === 'none' || element.strokeWidth === 0)) invalid('元素需要可见填色或描边。')
    if (element.kind === 'path') {
      const path = pathData(element.d, plan.source)
      paths++; commands += path.commands; checkStrokeBounds(element, path.bounds, plan.source)
    }
    else {
      const endX = element.x + element.stepX * (element.count - 1), endY = element.y + element.stepY * (element.count - 1)
      if (Math.min(element.x, endX) < 0 || Math.min(element.y, endY) < 0 || Math.max(element.x, endX) + element.width > width
        || Math.max(element.y, endY) + element.height > height) invalid('重复矩形超出源图框。')
      if (element.count > 1 && element.stepX === 0 && element.stepY === 0) invalid('重复矩形需要非零步距。')
      checkStrokeBounds(element, { left: Math.min(element.x, endX), top: Math.min(element.y, endY),
        right: Math.max(element.x, endX) + element.width, bottom: Math.max(element.y, endY) + element.height }, plan.source)
      paths += element.count; commands += element.count * 5
    }
    if (paths > STATIC_SVG_LIMITS.paths || commands > STATIC_SVG_LIMITS.pathCommands) invalid('展开后超过256路径或16384指令预算。')
  }
}

/** captureJson precedes Zod so direct schema users cannot execute accessors. */
export const vectorStructurePlanSchema = z.preprocess(input => captureJson(input), rawSchema.superRefine((plan, context) => {
  try { validatePlan(plan) } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '矢量结构稿无效。' }) }
}))
export function parseVectorStructurePlan(input: unknown): VectorStructurePlan { return vectorStructurePlanSchema.parse(input) }

function paintText(value: Paint): string { return typeof value === 'string' ? value : `url(#${value.gradient})` }
function attributes(element: Element): string {
  const fields = [`fill="${paintText(element.fill)}"`]
  if (element.stroke !== undefined) fields.push(`stroke="${paintText(element.stroke)}"`)
  if (element.strokeWidth !== undefined) fields.push(`stroke-width="${number(element.strokeWidth)}"`)
  if (element.opacity !== undefined) fields.push(`opacity="${number(element.opacity)}"`)
  if (element.fillRule !== undefined) fields.push(`fill-rule="${element.fillRule}"`)
  if (element.linecap !== undefined) fields.push(`stroke-linecap="${element.linecap}"`)
  if (element.linejoin !== undefined) fields.push(`stroke-linejoin="${element.linejoin}"`)
  return fields.join(' ')
}

/** Compiles declared geometry. It does not detect objects or infer a plan from pixels. */
export function compileVectorStructurePlan(input: unknown, expectedSource?: VectorStructureSource): {
  plan: VectorStructurePlan; sourceSvg: string; stats: { pathCount: number; pathCommandCount: number; observedElements: number; inferredElements: number }
} {
  const plan = parseVectorStructurePlan(input)
  if (expectedSource !== undefined) {
    const expected = sourceSchema.parse(captureJson(expectedSource))
    if (plan.source.sha256 !== expected.sha256 || plan.source.width !== expected.width || plan.source.height !== expected.height) invalid('结构稿来源hash或尺寸与当前基线不匹配。')
  }
  const definitions = plan.gradients.map(gradient => `<linearGradient id="${gradient.id}" gradientUnits="userSpaceOnUse" x1="${number(gradient.x1)}" y1="${number(gradient.y1)}" x2="${number(gradient.x2)}" y2="${number(gradient.y2)}">${gradient.stops.map(stop => `<stop offset="${number(stop.offset)}" stop-color="${stop.color}"${stop.opacity === undefined ? '' : ` stop-opacity="${number(stop.opacity)}"`}/>`).join('')}</linearGradient>`).join('')
  let shapes = ''
  for (const element of plan.elements) {
    const attrs = attributes(element)
    if (element.kind === 'path') shapes += `<path d="${pathData(element.d, plan.source).d}" ${attrs}/>`
    else for (let index = 0; index < element.count; index++) {
      const x = element.x + index * element.stepX, y = element.y + index * element.stepY
      shapes += `<path d="M${number(x)} ${number(y)}L${number(x + element.width)} ${number(y)}L${number(x + element.width)} ${number(y + element.height)}L${number(x)} ${number(y + element.height)}Z" ${attrs}/>`
    }
  }
  const normalized = normalizeStaticSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.source.width} ${plan.source.height}">${definitions ? `<defs>${definitions}</defs>` : ''}${shapes}</svg>`)
  return { plan, sourceSvg: normalized.normalizedSource, stats: { pathCount: normalized.pathCount, pathCommandCount: normalized.pathCommandCount,
    observedElements: plan.elements.filter(element => element.evidence === 'observed').length, inferredElements: plan.elements.filter(element => element.evidence === 'inferred').length } }
}
