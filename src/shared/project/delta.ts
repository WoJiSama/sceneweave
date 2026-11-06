import type { ProjectData } from '../model/project.js'
import { captureJson, cloneJson, encodeUtf8, inspectJsonInput, JSON_LIMITS } from '../validation/json.js'
import { sha256Bytes } from '../validation/hash.js'
import { validateProjectData } from './validate.js'
import { decodeProjectCoordinates, encodeProjectCoordinates } from '../aggregates/scene-coordinates.js'

export type DeltaValue = null | boolean | number | string | DeltaValue[] | { [key: string]: DeltaValue }
export type DeltaSlot = { present: false } | { present: true; value: DeltaValue }
export interface DeltaChange { path: string[]; before: DeltaSlot; after: DeltaSlot }
export interface JsonDelta {
  format: 'sceneweave-project-delta'
  version: 1
  beforeHash: string
  afterHash: string
  changes: DeltaChange[]
}
export interface ProjectDeltaChainResult {
  project: ProjectData
  states: { contentHash: string; revision: number }[]
}

const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
// Every digest input is this operation's detached strict ProjectData result.
const persisted = (value: ProjectData) => value.document.aggregateCoordinates?.encoding === 'world' ? cloneJson(encodeProjectCoordinates(value)) : value
const world = (value: ProjectData) => value.document.aggregateCoordinates?.encoding === 'local' ? decodeProjectCoordinates(value) : value
const digest = (value: ProjectData) => sha256Bytes(encodeUtf8(canonicalOwned(persisted(value))))
const record = (value: unknown): value is Record<string, DeltaValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
const MAX_DELTA_VALUES = 1_200_000
const MAX_FORWARD_DELTAS = 3

export class DeltaSizeError extends Error {
  constructor() { super('增量前后值超过1200000项保护预算；请保存完整检查点。'); this.name = 'DeltaSizeError' }
}

function safeRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('增量记录须为普通数据对象。')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('增量记录包含缺失、未知或非数据字段。')
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]))
}
function captureArray<T>(value: unknown, maximum: number, capture: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Reflect.ownKeys(value).length !== value.length + 1) throw new Error('增量数组超过范围或包含额外字段。')
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('增量数组不能含空洞或访问器。')
    return capture(descriptor.value)
  })
}
function countJsonValues(value: DeltaValue): number {
  let count = 0
  const stack: DeltaValue[] = [value]
  while (stack.length) {
    const next = stack.pop()!
    count++
    if (Array.isArray(next)) { for (const child of next) stack.push(child) }
    else if (record(next)) { for (const child of Object.values(next)) stack.push(child) }
  }
  return count
}
function canonicalOwned(value: unknown): string {
  const order = (item: unknown): unknown => Array.isArray(item) ? item.map(order)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, order((item as Record<string, unknown>)[key])])) : item
  return JSON.stringify(order(value))
}
function equal(left: DeltaValue, right: DeltaValue): boolean {
  if (left === right) return true
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]))
  if (!record(left) || !record(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]))
}
/** Strict and detached. A delta never gains authority from its declared hashes. */
export function validateProjectDelta(input: unknown): JsonDelta {
  const value = safeRecord(input, ['format', 'version', 'beforeHash', 'afterHash', 'changes'])
  if (value.format !== 'sceneweave-project-delta' || value.version !== 1 || !hash(value.beforeHash) || !hash(value.afterHash)
    || !Array.isArray(value.changes)) throw new Error('增量格式、版本或完整内容hash无效。')
  const rawChanges = value.changes
  if (rawChanges.length > MAX_DELTA_VALUES) throw new DeltaSizeError()
  let valueCount = 0
  const changes = captureArray(rawChanges, MAX_DELTA_VALUES, raw => {
    const change = safeRecord(raw, ['path', 'before', 'after'])
    const path = captureArray(change.path, JSON_LIMITS.depth, segment => {
      if (typeof segment !== 'string' || segment === '__proto__') throw new Error('增量路径须为非空安全字段路径。')
      return segment
    })
    const captureSlot = (rawSlot: unknown): DeltaSlot => {
      if (!rawSlot || typeof rawSlot !== 'object' || Array.isArray(rawSlot) || ![Object.prototype, null].includes(Object.getPrototypeOf(rawSlot))) throw new Error('增量前后值须为普通数据记录。')
      const descriptors = Object.getOwnPropertyDescriptors(rawSlot), present = descriptors.present
      if (!present || !present.enumerable || !('value' in present)) throw new Error('增量前后值须显式记录存在状态。')
      const expectedKeys = present.value === true ? ['present', 'value'] : ['present']
      if (Reflect.ownKeys(rawSlot).length !== expectedKeys.length || !expectedKeys.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('增量前后值包含缺失、未知或非数据字段。')
      if (present.value === false) return { present: false }
      if (present.value !== true) throw new Error('增量前后值须显式记录存在状态。')
      const issue = inspectJsonInput(descriptors.value.value)
      if (issue) throw new Error(issue.message)
      const owned = captureJson(descriptors.value.value) as DeltaValue
      valueCount += countJsonValues(owned)
      if (valueCount > MAX_DELTA_VALUES) throw new DeltaSizeError()
      return { present: true, value: owned }
    }
    if (!path.length) throw new Error('增量路径须为非空安全字段路径。')
    return { path, before: captureSlot(change.before), after: captureSlot(change.after) }
  })
  interface PathNode { leaf: boolean; children: Map<string, PathNode> }
  const root: PathNode = { leaf: false, children: new Map() }
  for (const change of changes) {
    if (change.before.present === change.after.present && (!change.before.present || change.after.present && equal(change.before.value, change.after.value))) throw new Error('增量不能包含未改变的前后值。')
    let node = root
    for (const key of change.path) {
      if (node.leaf) throw new Error('增量路径不能重复或互为祖先。')
      let child = node.children.get(key)
      if (!child) { child = { leaf: false, children: new Map() }; node.children.set(key, child) }
      node = child
    }
    if (node.leaf || node.children.size) throw new Error('增量路径不能重复或互为祖先。')
    node.leaf = true
  }
  if ((changes.length === 0) !== (value.beforeHash === value.afterHash)) throw new Error('增量变更列表与完整内容hash不一致。')
  return { format: 'sceneweave-project-delta', version: 1, beforeHash: value.beforeHash, afterHash: value.afterHash, changes }
}

/** Actual immutable-result differences, including identity, appearance and resource/permission metadata. */
export function createProjectDelta(before: ProjectData, after: ProjectData): JsonDelta {
  const source = persisted(validateProjectData(before)), target = persisted(validateProjectData(after)), changes: DeltaChange[] = []
  const visit = (left: DeltaValue, right: DeltaValue, path: string[]) => {
    if (left === right) return
    if (record(left) && record(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        const old = Object.hasOwn(left, key), next = Object.hasOwn(right, key), childPath = [...path, key]
        if (old && next) visit(left[key], right[key], childPath)
        else changes.push({ path: childPath, before: old ? { present: true, value: cloneJson(left[key]) } : { present: false },
          after: next ? { present: true, value: cloneJson(right[key]) } : { present: false } })
      }
    } else if (!equal(left, right)) changes.push({ path, before: { present: true, value: cloneJson(left) }, after: { present: true, value: cloneJson(right) } })
  }
  visit(source as unknown as DeltaValue, target as unknown as DeltaValue, [])
  return validateProjectDelta({ format: 'sceneweave-project-delta', version: 1, beforeHash: digest(source), afterHash: digest(target), changes })
}

/** Mutates only a private owned project, using an already detached strict delta. */
function applyChanges(result: ProjectData, checked: JsonDelta, forward: boolean): void {
  for (const change of checked.changes) {
    const expected = forward ? change.before : change.after, next = forward ? change.after : change.before
    let parent = result as unknown as Record<string, DeltaValue>
    for (const key of change.path.slice(0, -1)) {
      if (!Object.hasOwn(parent, key) || !record(parent[key])) throw new Error('增量路径缺失或穿过原子值。')
      parent = parent[key] as Record<string, DeltaValue>
    }
    const key = change.path.at(-1)!, present = Object.hasOwn(parent, key)
    if (present !== expected.present || expected.present && !equal(parent[key], expected.value)) throw new Error('增量前置字段值不符；原工程保持。')
    // Own-only traversal and data-property writes also safely preserve valid IDs named constructor/prototype.
    if (next.present) Object.defineProperty(parent, key, { value: cloneJson(next.value), enumerable: true, writable: true, configurable: true })
    else delete parent[key]
  }
}

/** Applies either direction only to the exact complete baseline and verifies the complete result. */
export function applyProjectDelta(input: ProjectData, delta: unknown, direction: 'forward' | 'backward'): ProjectData {
  if (direction !== 'forward' && direction !== 'backward') throw new Error('增量应用方向无效。')
  const result = persisted(validateProjectData(input)), checked = validateProjectDelta(delta), forward = direction === 'forward'
  if (digest(result) !== (forward ? checked.beforeHash : checked.afterHash)) throw new Error('增量完整基线hash不符；原工程保持。')
  applyChanges(result, checked, forward)
  const project = validateProjectData(world(result))
  if (digest(project) !== (forward ? checked.afterHash : checked.beforeHash)) throw new Error('增量重建完整内容hash不符；原工程保持。')
  return project
}

/** Strict synchronous forward reconstruction; no validation authority escapes this operation. */
export function applyProjectDeltaChain(input: ProjectData, deltas: readonly unknown[], expectedBeforeHash: string): ProjectDeltaChainResult {
  if (!hash(expectedBeforeHash)) throw new Error('增量链完整基线hash无效。')
  const pending = captureArray(deltas, MAX_FORWARD_DELTAS, value => value)
  let project = validateProjectData(input), contentHash = digest(project)
  if (contentHash !== expectedBeforeHash) throw new Error('增量链完整基线hash不符；原工程保持。')
  const states: ProjectDeltaChainResult['states'] = []
  for (const raw of pending) {
    const checked = validateProjectDelta(raw)
    // This hash was computed from the complete owned root or the previous
    // step's strictly validated output within this synchronous operation.
    if (contentHash !== checked.beforeHash) throw new Error('增量链前一步完整内容hash不符；原工程保持。')
    // The strict root/previous output is already private and detached. No
    // intermediate project escapes this synchronous operation, including on failure.
    const stored = persisted(project)
    applyChanges(stored, checked, true)
    project = validateProjectData(world(stored))
    contentHash = digest(project)
    if (contentHash !== checked.afterHash) throw new Error('增量重建完整内容hash不符；原工程保持。')
    states.push({ contentHash, revision: project.document.revision })
  }
  return { project, states }
}

export function projectDeltaBytes(delta: unknown): number {
  return encodeUtf8(projectDeltaJson(delta)).length
}

/** Canonical serialization uses the delta's own aggregate budget, rather than the one-project JSON limit. */
export function projectDeltaJson(delta: unknown): string {
  return canonicalOwned(validateProjectDelta(delta))
}
