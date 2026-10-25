import { encodeUtf8 } from '../validation/json.js'
import { sha256Bytes } from '../validation/hash.js'

/**
 * A deliberately small SVG profile for generated asset drafts. It is parsed as
 * data, never as an application DOM. Limits are guards, not product capacity
 * claims; see docs/05 section 7 for the enclosing M2-4 contract.
 */
export const STATIC_SVG_LIMITS = Object.freeze({
  sourceBytes: 1024 * 1024,
  normalizedBytes: 1024 * 1024,
  nodes: 4096,
  depth: 32,
  attributes: 16_384,
  paths: 256,
  pathCommands: 16_384,
  points: 32_768,
  coordinate: 8192,
  viewBoxSide: 8192,
  rasterSide: 4096,
  rasterPixels: 16_000_000,
  rasterBytes: 20 * 1024 * 1024,
})

export const STATIC_SVG_PROCESSOR_ID = 'sceneweave-static-svg' as const
export const STATIC_SVG_PROCESSOR_VERSION = 1 as const

export interface SvgViewBox { x: number; y: number; width: number; height: number }
export interface NormalizedStaticSvg {
  kind: 'normalized-static-svg'
  processorId: typeof STATIC_SVG_PROCESSOR_ID
  processorVersion: typeof STATIC_SVG_PROCESSOR_VERSION
  sourceSvg: string
  sourceSha256: string
  sourceSizeBytes: number
  normalizedSource: string
  normalizedSha256: string
  normalizedSizeBytes: number
  viewBox: SvgViewBox
  nodeCount: number
  pathCount: number
  pathCommandCount: number
}

interface SvgNode { name: string; attrs: Record<string, string>; children: SvgNode[] }
interface Budget { nodes: number; attributes: number; paths: number; pathCommands: number; points: number }

const SVG_NS = 'http://www.w3.org/2000/svg'
const NAME = /^[A-Za-z][A-Za-z0-9-]*$/
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const HASH_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
const ELEMENTS = new Set(['svg', 'g', 'defs', 'linearGradient', 'radialGradient', 'stop', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const COMMON = ['opacity', 'transform']
const PAINT = ['fill', 'fill-rule', 'opacity', 'stroke', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-width', 'transform']
const ATTRS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  svg: ['height', 'viewBox', 'width', 'xmlns'],
  g: COMMON.concat(PAINT.filter(value => value !== 'opacity' && value !== 'transform')),
  defs: [],
  linearGradient: ['gradientTransform', 'gradientUnits', 'id', 'spreadMethod', 'x1', 'x2', 'y1', 'y2'],
  radialGradient: ['cx', 'cy', 'fx', 'fy', 'gradientTransform', 'gradientUnits', 'id', 'r', 'spreadMethod'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  path: PAINT.concat(['d']),
  rect: PAINT.concat(['height', 'rx', 'ry', 'width', 'x', 'y']),
  circle: PAINT.concat(['cx', 'cy', 'r']),
  ellipse: PAINT.concat(['cx', 'cy', 'rx', 'ry']),
  line: ['opacity', 'stroke', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-width', 'transform', 'x1', 'x2', 'y1', 'y2'],
  polyline: PAINT.concat(['points']),
  polygon: PAINT.concat(['points']),
})

function invalid(message: string): never { throw new Error(`SVG不受支持：${message}`) }
function finiteNumber(value: string, label: string, maximum: number = STATIC_SVG_LIMITS.coordinate): number {
  if (!NUMBER.test(value)) return invalid(`${label}必须是有限十进制数。`)
  const number = Number(value)
  if (!Number.isFinite(number) || Math.abs(number) > maximum) return invalid(`${label}超出坐标限制。`)
  return Object.is(number, -0) ? 0 : number
}
function canonicalNumber(value: number): string { return String(Object.is(value, -0) ? 0 : value) }
function parseNumberList(value: string, label: string, minimum: number, maximum: number): number[] {
  const trimmed = value.trim()
  if (!trimmed) return invalid(`${label}不能为空。`)
  if (trimmed.startsWith(',') || trimmed.endsWith(',') || /,\s*,/.test(trimmed)) return invalid(`${label}含有无效逗号。`)
  const parts = trimmed.split(/[\s,]+/)
  if (parts.some(part => !part)) return invalid(`${label}含有无效分隔符。`)
  const result = parts.map(part => finiteNumber(part, label))
  if (result.length < minimum || result.length > maximum) return invalid(`${label}项目数无效。`)
  return result
}
function parsePath(value: string, budget: Budget): string {
  if (/(^\s*,|,\s*,|,\s*[A-Za-z]|,\s*$)/.test(value)) return invalid('path含有无效逗号。')
  const tokens: string[] = []
  let offset = 0
  const pathToken = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
  while (offset < value.length) {
    if (/[\s,]/.test(value[offset])) { offset++; continue }
    pathToken.lastIndex = offset
    const match = pathToken.exec(value)
    if (!match) return invalid('path只允许受支持的命令和十进制坐标。')
    tokens.push(match[0]); offset = pathToken.lastIndex
    if (tokens.length > STATIC_SVG_LIMITS.pathCommands * 8) return invalid('单条path复杂度过高。')
  }
  if (!tokens.length || !/[Mm]/.test(tokens[0])) return invalid('path必须以Move命令开始。')
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
  let index = 0, active = '', relative = false, commands = 0, points = 0
  let currentX = 0, currentY = 0, subpathX = 0, subpathY = 0
  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) {
      relative = tokens[index] === tokens[index].toLowerCase()
      active = tokens[index++].toUpperCase()
      if (!Object.hasOwn(arity, active)) return invalid('path含不支持的命令。')
      commands++
      if (active === 'Z') { currentX = subpathX; currentY = subpathY; active = ''; continue }
    } else if (!active) return invalid('path坐标缺少命令。')
    const count = arity[active]
    const start = index
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) index++
    const values = index - start
    if (values < count || values % count !== 0) return invalid('path命令参数个数无效。')
    for (let group = 0; group < values; group += count) {
      const args = tokens.slice(start + group, start + group + count).map(token => finiteNumber(token, 'path坐标'))
      for (let j = 0; j < count; j++) {
        const numeric = args[j]
        if (active === 'A' && (j === 3 || j === 4) && numeric !== 0 && numeric !== 1) return invalid('path弧线标志只允许0或1。')
        if (active === 'A' && (j === 0 || j === 1) && numeric < 0) return invalid('path弧线半径不能为负。')
        if (active === 'A' && j === 2 && Math.abs(numeric) > 360) return invalid('path弧线角度超出限制。')
      }
      const pairs: [number, number][] = []
      if (active === 'H') pairs.push([args[0], currentY])
      else if (active === 'V') pairs.push([currentX, args[0]])
      else if (active === 'A') pairs.push([args[5], args[6]])
      else for (let j = 0; j < count; j += 2) pairs.push([args[j], args[j + 1]])
      const mapped = pairs.map(([x, y]) => [relative && active !== 'V' ? currentX + x : x, relative && active !== 'H' ? currentY + y : y] as const)
      if (mapped.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > STATIC_SVG_LIMITS.coordinate || Math.abs(y) > STATIC_SVG_LIMITS.coordinate)) return invalid('path相对坐标累计超限。')
      if (active === 'M') {
        currentX = mapped[0][0]; currentY = mapped[0][1]
        if (group === 0) { subpathX = currentX; subpathY = currentY }
      }
      else if (active === 'H') currentX = mapped.at(-1)![0]
      else if (active === 'V') currentY = mapped.at(-1)![1]
      else { currentX = mapped.at(-1)![0]; currentY = mapped.at(-1)![1] }
      points += Math.ceil(count / 2)
    }
    if (values > count) commands += values / count - 1 // repeated argument groups are implicit path commands
  }
  budget.pathCommands += commands
  budget.points += points
  if (budget.pathCommands > STATIC_SVG_LIMITS.pathCommands || budget.points > STATIC_SVG_LIMITS.points) return invalid('累计path命令/坐标预算超限。')
  return tokens.map(token => /^[A-Za-z]$/.test(token) ? token : canonicalNumber(Number(token))).join(' ')
}

function parseTransform(value: string): string {
  let offset = 0
  const result: string[] = []
  const transform = /(translate|scale|rotate)\s*\(([^()]*)\)/gy
  while (offset < value.length) {
    while (offset < value.length && /[\s,]/.test(value[offset])) offset++
    if (offset >= value.length) break
    transform.lastIndex = offset
    const match = transform.exec(value)
    if (!match) return invalid('transform仅允许translate、scale和rotate。')
    const args = parseNumberList(match[2], 'transform', 1, 3)
    if (match[1] === 'translate' && args.length > 2 || match[1] === 'scale' && args.length > 2
      || match[1] === 'rotate' && ![1, 3].includes(args.length)) return invalid('transform参数个数无效。')
    if (match[1] === 'scale' && args.some(value => value === 0 || Math.abs(value) > 64)) return invalid('scale超出限制。')
    if (match[1] === 'rotate' && Math.abs(args[0]) > 360_000) return invalid('rotate角度超出限制。')
    result.push(`${match[1]}(${args.map(canonicalNumber).join(' ')})`)
    offset = transform.lastIndex
  }
  if (!result.length) return invalid('transform不能为空。')
  return result.join(' ')
}

function canonicalAttribute(element: string, name: string, value: string): string {
  if (name === 'viewBox') {
    const numbers = parseNumberList(value, 'viewBox', 4, 4)
    if (numbers[2] <= 0 || numbers[3] <= 0 || numbers[2] > STATIC_SVG_LIMITS.viewBoxSide || numbers[3] > STATIC_SVG_LIMITS.viewBoxSide) return invalid('viewBox尺寸超限。')
    return numbers.map(canonicalNumber).join(' ')
  }
  if (name === 'width' || name === 'height') {
    const number = finiteNumber(value.trim(), name, STATIC_SVG_LIMITS.viewBoxSide)
    if (number <= 0) return invalid(`${name}须大于0。`)
    return canonicalNumber(number)
  }
  if (['linearGradient', 'radialGradient'].includes(element) && ['x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'fx', 'fy', 'r'].includes(name) && /%$/.test(value.trim())) {
    const percent = finiteNumber(value.trim().slice(0, -1), name, 100)
    if (percent < 0 || percent > 100) return invalid(`${name}百分比超出0到100。`)
    return `${canonicalNumber(percent)}%`
  }
  if (['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'fx', 'fy', 'width', 'height', 'r', 'rx', 'ry', 'stroke-width', 'stroke-miterlimit'].includes(name)) {
    const number = finiteNumber(value.trim(), name)
    if (['width', 'height', 'r', 'rx', 'ry', 'stroke-width'].includes(name) && number < 0) return invalid(`${name}不能为负。`)
    if (name === 'stroke-miterlimit' && (number < 1 || number > 10)) return invalid('stroke-miterlimit超出限制。')
    return canonicalNumber(number)
  }
  if (name === 'opacity' || name === 'stop-opacity') {
    const number = finiteNumber(value.trim(), name, 1)
    if (number < 0 || number > 1) return invalid(`${name}须位于0到1。`)
    return canonicalNumber(number)
  }
  if (name === 'offset') {
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(%)?$/.exec(value.trim())
    if (!match) return invalid('渐变offset格式无效。')
    const numeric = finiteNumber(match[1], name, match[2] ? 100 : 1), normalized = match[2] ? numeric / 100 : numeric
    if (normalized < 0 || normalized > 1) return invalid('渐变offset须位于0到1。')
    return match[2] ? `${canonicalNumber(numeric)}%` : canonicalNumber(numeric)
  }
  if (name === 'fill' || name === 'stroke') {
    const color = value.trim()
    if (color === 'none') return color
    if (HASH_COLOR.test(color)) return color.toLowerCase()
    if (/^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/.test(color)) return color
    return invalid(`${name}只允许none、十六进制颜色或本地渐变引用。`)
  }
  if (name === 'stop-color') {
    const color = value.trim()
    if (!HASH_COLOR.test(color)) return invalid('stop-color只允许十六进制颜色。')
    return color.toLowerCase()
  }
  if (name === 'fill-rule') {
    if (!['nonzero', 'evenodd'].includes(value)) return invalid('fill-rule不受支持。')
    return value
  }
  if (name === 'stroke-linecap') {
    if (!['butt', 'round', 'square'].includes(value)) return invalid('stroke-linecap不受支持。')
    return value
  }
  if (name === 'stroke-linejoin') {
    if (!['miter', 'round', 'bevel'].includes(value)) return invalid('stroke-linejoin不受支持。')
    return value
  }
  if (name === 'id') {
    if (!ID.test(value)) return invalid('本地定义ID格式无效。')
    return value
  }
  if (name === 'xmlns') {
    if (value !== SVG_NS) return invalid('SVG命名空间必须是标准SVG URI。')
    return SVG_NS
  }
  if (name === 'gradientUnits') {
    if (!['objectBoundingBox', 'userSpaceOnUse'].includes(value)) return invalid('gradientUnits不受支持。')
    return value
  }
  if (name === 'spreadMethod') {
    if (value !== 'pad') return invalid('渐变仅支持pad扩展。')
    return value
  }
  if (name === 'gradientTransform' || name === 'transform') return parseTransform(value)
  if (name === 'd') return value // parsed in validateNode with the shared path budget
  if (name === 'points') {
    const numbers = parseNumberList(value, 'points', 4, STATIC_SVG_LIMITS.points * 2)
    if (numbers.length % 2) return invalid('points须包含成对坐标。')
    return numbers.map(canonicalNumber).join(' ')
  }
  return invalid(`属性${name}不在静态子集中。`)
}

function parseXml(source: string, budget: Budget): SvgNode {
  if (!source || source.length > STATIC_SVG_LIMITS.sourceBytes) return invalid('源文本超过输入保护值。')
  if (/<!|<\?|&|\uFEFF/.test(source)) return invalid('拒绝声明、注释、实体、处理指令和BOM。')
  let offset = 0
  const stack: SvgNode[] = [], roots: SvgNode[] = []
  while (offset < source.length) {
    if (source[offset] !== '<') {
      const end = source.indexOf('<', offset), text = source.slice(offset, end < 0 ? source.length : end)
      if (text.trim()) return invalid('不接受文字内容。')
      offset = end < 0 ? source.length : end
      continue
    }
    if (source.startsWith('</', offset)) {
      const close = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>/.exec(source.slice(offset))
      if (!close || !stack.length || stack.at(-1)!.name !== close[1]) return invalid('XML结束标签与结构不匹配。')
      stack.pop(); offset += close[0].length; continue
    }
    const open = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(source.slice(offset))
    if (!open || !NAME.test(open[1]) || !ELEMENTS.has(open[1])) return invalid('存在不支持的标签或无效标签名。')
    const node: SvgNode = { name: open[1], attrs: Object.create(null) as Record<string, string>, children: [] }
    budget.nodes++
    if (budget.nodes > STATIC_SVG_LIMITS.nodes) return invalid('节点数量超限。')
    offset += open[0].length
    let selfClosing = false, closed = false
    while (offset < source.length) {
      const beforeSpace = offset
      while (/[\t\n\r ]/.test(source[offset] ?? '')) offset++
      if (source.startsWith('/>', offset)) { selfClosing = true; offset += 2; closed = true; break }
      if (source[offset] === '>') { offset++; closed = true; break }
      if (offset === beforeSpace) return invalid('属性之间必须使用空格。')
      const attribute = /^[A-Za-z][A-Za-z0-9-]*/.exec(source.slice(offset))
      if (!attribute) return invalid('属性名无效。')
      const name = attribute[0]; offset += name.length
      while (/[\t\n\r ]/.test(source[offset] ?? '')) offset++
      if (source[offset++] !== '=') return invalid('属性必须显式赋值。')
      while (/[\t\n\r ]/.test(source[offset] ?? '')) offset++
      const quote = source[offset++]
      if (quote !== '"' && quote !== "'") return invalid('属性值必须加引号。')
      const end = source.indexOf(quote, offset)
      if (end < 0) return invalid('属性值未闭合。')
      const value = source.slice(offset, end)
      if (value.includes('<') || value.includes('&')) return invalid('属性值不允许markup或实体引用。')
      if (Object.hasOwn(node.attrs, name) || !ATTRS[node.name].includes(name)) return invalid(`属性${name}重复或不受支持。`)
      node.attrs[name] = value; budget.attributes++
      if (budget.attributes > STATIC_SVG_LIMITS.attributes) return invalid('属性总数超限。')
      offset = end + 1
    }
    if (!closed) return invalid('开始标签未闭合。')
    if (stack.length + 1 > STATIC_SVG_LIMITS.depth) return invalid('嵌套深度超限。')
    const parent = stack.at(-1)
    if (parent) parent.children.push(node); else roots.push(node)
    if (!selfClosing) stack.push(node)
  }
  if (stack.length || roots.length !== 1 || roots[0].name !== 'svg') return invalid('须为单一完整svg根节点。')
  return roots[0]
}

function validateNode(node: SvgNode, parent: SvgNode | undefined, budget: Budget, gradientIds: Set<string>, refs: Set<string>): void {
  const required = (key: string) => { if (!Object.hasOwn(node.attrs, key)) invalid(`${node.name}缺少${key}。`) }
  if (node.name === 'svg') {
    if (parent) return invalid('不允许嵌套svg。')
    required('xmlns'); required('viewBox')
    const box = parseNumberList(node.attrs.viewBox, 'viewBox', 4, 4)
    if (box[2] <= 0 || box[3] <= 0 || box[2] > STATIC_SVG_LIMITS.viewBoxSide || box[3] > STATIC_SVG_LIMITS.viewBoxSide) return invalid('viewBox无效。')
    if (Math.abs(box[0] + box[2]) > STATIC_SVG_LIMITS.coordinate || Math.abs(box[1] + box[3]) > STATIC_SVG_LIMITS.coordinate) return invalid('viewBox边界坐标超限。')
    if (node.children.some(child => !['defs', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(child.name))) return invalid('svg子节点不受支持。')
  } else if (node.name === 'defs') {
    if (!parent || parent.name !== 'svg' || !node.children.length) return invalid('defs仅允许作为svg的非空直接子节点。')
    if (node.children.some(child => !['linearGradient', 'radialGradient'].includes(child.name))) return invalid('defs仅允许静态渐变定义。')
  } else if (node.name === 'linearGradient' || node.name === 'radialGradient') {
    if (!parent || parent.name !== 'defs') return invalid('渐变仅允许位于defs中。')
    required('id')
    if (gradientIds.has(node.attrs.id)) return invalid('渐变ID重复。')
    gradientIds.add(node.attrs.id)
    if (!node.children.length || node.children.some(child => child.name !== 'stop')) return invalid('渐变必须仅包含stop。')
  } else if (node.name === 'stop') {
    if (!parent || !['linearGradient', 'radialGradient'].includes(parent.name) || node.children.length) return invalid('stop位置无效。')
    required('offset'); required('stop-color')
  } else if (node.name === 'g') {
    if (!parent || !['svg', 'g'].includes(parent.name)) return invalid('g位置无效。')
  } else {
    if (!parent || !['svg', 'g'].includes(parent.name) || node.children.length) return invalid(`${node.name}必须是svg/g中的叶节点。`)
    if (node.name === 'path') {
      required('d'); budget.paths++
      if (budget.paths > STATIC_SVG_LIMITS.paths) return invalid('path数量超限。')
      node.attrs.d = parsePath(node.attrs.d, budget)
    }
    if (node.name === 'polyline' || node.name === 'polygon') {
      required('points')
      const pairs = node.attrs.points.trim().split(/[\s,]+/).length
      if (pairs < 4 || pairs % 2) return invalid('polyline/polygon至少需要两个坐标点。')
      budget.points += pairs / 2
      if (budget.points > STATIC_SVG_LIMITS.points) return invalid('累计坐标预算超限。')
    }
    if (node.name === 'rect') {
      required('x'); required('y'); required('width'); required('height')
      if (Number(node.attrs.width) <= 0 || Number(node.attrs.height) <= 0) return invalid('rect尺寸必须大于0。')
      if (Math.abs(Number(node.attrs.x) + Number(node.attrs.width)) > STATIC_SVG_LIMITS.coordinate || Math.abs(Number(node.attrs.y) + Number(node.attrs.height)) > STATIC_SVG_LIMITS.coordinate) return invalid('rect边界坐标超限。')
    }
    if (node.name === 'circle') {
      required('cx'); required('cy'); required('r')
      if (Number(node.attrs.r) <= 0) return invalid('circle半径必须大于0。')
      if (Math.abs(Number(node.attrs.cx) - Number(node.attrs.r)) > STATIC_SVG_LIMITS.coordinate || Math.abs(Number(node.attrs.cx) + Number(node.attrs.r)) > STATIC_SVG_LIMITS.coordinate
        || Math.abs(Number(node.attrs.cy) - Number(node.attrs.r)) > STATIC_SVG_LIMITS.coordinate || Math.abs(Number(node.attrs.cy) + Number(node.attrs.r)) > STATIC_SVG_LIMITS.coordinate) return invalid('circle边界坐标超限。')
    }
    if (node.name === 'ellipse') {
      required('cx'); required('cy'); required('rx'); required('ry')
      if (Number(node.attrs.rx) <= 0 || Number(node.attrs.ry) <= 0) return invalid('ellipse半径必须大于0。')
      if (Math.abs(Number(node.attrs.cx) - Number(node.attrs.rx)) > STATIC_SVG_LIMITS.coordinate || Math.abs(Number(node.attrs.cx) + Number(node.attrs.rx)) > STATIC_SVG_LIMITS.coordinate
        || Math.abs(Number(node.attrs.cy) - Number(node.attrs.ry)) > STATIC_SVG_LIMITS.coordinate || Math.abs(Number(node.attrs.cy) + Number(node.attrs.ry)) > STATIC_SVG_LIMITS.coordinate) return invalid('ellipse边界坐标超限。')
    }
    if (node.name === 'line') { for (const key of ['x1', 'y1', 'x2', 'y2']) required(key) }
  }
  for (const [key, value] of Object.entries(node.attrs)) {
    node.attrs[key] = canonicalAttribute(node.name, key, value)
    for (const match of value.matchAll(/url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)/g)) refs.add(match[1])
  }
  for (const child of node.children) validateNode(child, node, budget, gradientIds, refs)
}

function serialize(node: SvgNode): string {
  const attrs = Object.keys(node.attrs).sort().map(key => ` ${key}="${node.attrs[key]}"`).join('')
  if (!node.children.length) return `<${node.name}${attrs}/>`
  return `<${node.name}${attrs}>${node.children.map(serialize).join('')}</${node.name}>`
}

/** Strictly parse, budget-check and deterministically serialize a static SVG. */
export function normalizeStaticSvg(source: string): NormalizedStaticSvg {
  if (typeof source !== 'string' || source.length > STATIC_SVG_LIMITS.sourceBytes) return invalid('源文本超过输入保护值。')
  const sourceBytes = encodeUtf8(source)
  if (!sourceBytes.length || sourceBytes.length > STATIC_SVG_LIMITS.sourceBytes) return invalid('源UTF-8字节超过输入保护值。')
  const budget: Budget = { nodes: 0, attributes: 0, paths: 0, pathCommands: 0, points: 0 }
  const root = parseXml(source, budget), gradientIds = new Set<string>(), refs = new Set<string>()
  validateNode(root, undefined, budget, gradientIds, refs)
  for (const id of refs) if (!gradientIds.has(id)) return invalid('本地渐变引用缺失。')
  // Input intrinsic dimensions are discarded. Rasterization always derives a
  // fresh viewport from the checked viewBox and an explicit pixel budget.
  delete root.attrs.width; delete root.attrs.height
  const normalizedSource = serialize(root), normalizedBytes = encodeUtf8(normalizedSource)
  if (normalizedBytes.length > STATIC_SVG_LIMITS.normalizedBytes) return invalid('规范化源超过字节预算。')
  const viewBoxValues = root.attrs.viewBox.split(' ').map(Number)
  return Object.freeze({
    kind: 'normalized-static-svg', processorId: STATIC_SVG_PROCESSOR_ID, processorVersion: STATIC_SVG_PROCESSOR_VERSION, sourceSvg: source,
    sourceSha256: sha256Bytes(sourceBytes), sourceSizeBytes: sourceBytes.length,
    normalizedSource, normalizedSha256: sha256Bytes(normalizedBytes), normalizedSizeBytes: normalizedBytes.length,
    viewBox: Object.freeze({ x: viewBoxValues[0], y: viewBoxValues[1], width: viewBoxValues[2], height: viewBoxValues[3] }),
    nodeCount: budget.nodes, pathCount: budget.paths, pathCommandCount: budget.pathCommands,
  })
}

/** Re-parse the normalized source and verify its claimed digest before use. */
export function verifyNormalizedStaticSvg(input: unknown): NormalizedStaticSvg {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return invalid('规范化凭证必须是普通对象。')
  const expected = ['kind', 'processorId', 'processorVersion', 'sourceSvg', 'sourceSha256', 'sourceSizeBytes', 'normalizedSource', 'normalizedSha256', 'normalizedSizeBytes', 'viewBox', 'nodeCount', 'pathCount', 'pathCommandCount']
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !expected.includes(key)) || expected.some(key => !Object.hasOwn(input, key))) return invalid('规范化凭证字段不完整或含额外字段。')
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return invalid('规范化凭证不接受访问器或隐藏字段。')
    values[key] = descriptor.value
  }
  if (values.kind !== 'normalized-static-svg' || values.processorId !== STATIC_SVG_PROCESSOR_ID || values.processorVersion !== STATIC_SVG_PROCESSOR_VERSION
    || typeof values.sourceSvg !== 'string' || typeof values.normalizedSource !== 'string' || typeof values.sourceSha256 !== 'string' || typeof values.normalizedSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(values.sourceSha256) || !/^[0-9a-f]{64}$/.test(values.normalizedSha256)
    || !Number.isSafeInteger(values.sourceSizeBytes) || (values.sourceSizeBytes as number) < 1 || (values.sourceSizeBytes as number) > STATIC_SVG_LIMITS.sourceBytes
    || !Number.isSafeInteger(values.normalizedSizeBytes) || (values.normalizedSizeBytes as number) < 1 || (values.normalizedSizeBytes as number) > STATIC_SVG_LIMITS.normalizedBytes
    || !Number.isSafeInteger(values.nodeCount) || !Number.isSafeInteger(values.pathCount) || !Number.isSafeInteger(values.pathCommandCount)) return invalid('规范化凭证值无效。')
  const original = normalizeStaticSvg(values.sourceSvg)
  const checked = normalizeStaticSvg(values.normalizedSource)
  if (original.sourceSha256 !== values.sourceSha256 || original.sourceSizeBytes !== values.sourceSizeBytes
    || original.normalizedSource !== values.normalizedSource || checked.normalizedSource !== values.normalizedSource || checked.normalizedSha256 !== values.normalizedSha256
    || checked.normalizedSizeBytes !== values.normalizedSizeBytes || checked.nodeCount !== values.nodeCount
    || checked.pathCount !== values.pathCount || checked.pathCommandCount !== values.pathCommandCount
    || !values.viewBox || typeof values.viewBox !== 'object') return invalid('规范化内容与摘要/预算不匹配。')
  const viewBox = values.viewBox as Record<string, unknown>
  const viewBoxKeys = ['x', 'y', 'width', 'height']
  if (Object.getPrototypeOf(viewBox) !== Object.prototype || Reflect.ownKeys(viewBox).length !== 4 || viewBoxKeys.some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(viewBox, key)
    return !descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value !== checked.viewBox[key as keyof SvgViewBox]
  })) return invalid('viewBox凭证与内容不匹配。')
  return original
}
