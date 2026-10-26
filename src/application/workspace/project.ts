import type { ProjectBundle, ProjectData, ResourceBytePort } from '../../shared/model/project.js'
import type { CompleteValidationOptions, ResourceOptions } from '../../shared/ports/resources.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { captureProjectBundleInput, getVerifiedProjectBundle, reviseVerifiedProjectBundle, tryDerivedProjectBundle, validateProjectBundle, type VerifiedProjectBundle } from '../../shared/project/resources.js'
import { captureJson } from '../../shared/validation/json.js'

/** Native complete-v1 metadata plus an owned byte reader, never a legacy view. */
export type EditableProject = ProjectData & { resources: ResourceBytePort }
const fields = ['format', 'schemaVersion', 'document', 'historyIdentity', 'appearance', 'assets', 'licenses', 'licenseBindings', 'authoringSources'] as const
// An application wrapper can retain a certificate only when this module created
// it from the validator's exact owned metadata and immutable byte closure.
const verifiedProjects = new WeakMap<EditableProject, VerifiedProjectBundle>()

/** Internal handoff only: clones and replacement ports cannot inherit this entry. */
export function getVerifiedEditableProject(input: EditableProject): EditableProject | undefined {
  return verifiedProjects.has(input) ? input : undefined
}

/** Capture top-level data once, before any caller-owned wrapper can change it. */
export function captureEditableInput(input: EditableProject): EditableProject {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('编辑工程必须为普通数据对象。')
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = [...fields, 'resources']
  if (Reflect.ownKeys(input).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) throw new Error('编辑工程含未知、访问器、隐藏或Symbol字段。')
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value])) as unknown as EditableProject
}

/** Capture descriptors before reading values, including drafts awaiting bitmap materialization. */
export function captureEditableDraft(input: EditableProject): EditableProject {
  const { resources: source, ...metadata } = captureEditableInput(input)
  const data = captureJson(metadata) as unknown as ProjectData
  if (!source || typeof source !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(source))) throw new Error('资源端口无效。')
  const methods = Object.getOwnPropertyDescriptors(source)
  if (Reflect.ownKeys(source).length !== 1 || !methods.read?.enumerable || !('value' in methods.read) || typeof methods.read.value !== 'function') throw new Error('资源端口必须只提供read方法。')
  const read = methods.read.value as (hash: string) => Promise<Uint8Array>
  return { ...data, resources: Object.freeze({ read: (hash: string) => read.call(source, hash) }) }
}

/** Strip only the explicit application byte port before strict native validation. */
export function toBundle(input: EditableProject): ProjectBundle {
  const verified = verifiedProjects.get(input)
  if (verified) return verified
  const { resources, ...project } = captureEditableDraft(input)
  return captureProjectBundleInput({ project, resources })
}

/** Capture an application wrapper without cloning branches used by derivation. */
function captureEditableDerivation(input: EditableProject): ProjectBundle | undefined {
  try {
    const { resources, ...project } = captureEditableInput(input)
    return { project, resources }
  } catch { return undefined }
}

/** Re-certify an edited composition while retaining the baseline byte closure. */
export function tryDeriveEditableProject(input: EditableProject, baseline: EditableProject, options: ResourceOptions = {}): EditableProject | undefined {
  checkCancelled(options.signal)
  if (!baseline || typeof baseline !== 'object') return undefined
  const verified = verifiedProjects.get(baseline)
  if (!verified) return undefined
  const candidate = captureEditableDerivation(input)
  if (!candidate) return undefined
  const derived = tryDerivedProjectBundle(candidate, verified, options)
  return derived ? fromVerifiedBundle(derived, options) : undefined
}

/** Compatibility spelling for callers that prefer the adjective-first form. */
export const tryDerivedEditableProject = tryDeriveEditableProject

/** Internal revision-only handoff; external wrappers cannot inherit it. */
export function tryReviseEditableProject(input: EditableProject, revision: number, updatedAt: string, options: ResourceOptions = {}): EditableProject | undefined {
  checkCancelled(options.signal)
  const verified = verifiedProjects.get(input)
  if (!verified) return undefined
  const revised = reviseVerifiedProjectBundle(verified, revision, updatedAt, options)
  return revised ? fromVerifiedBundle(revised, options) : undefined
}

/** Adopt only a certificate issued for exact independently owned metadata/bytes. */
export function fromVerifiedBundle(input: ProjectBundle, options: ResourceOptions = {}): EditableProject {
  checkCancelled(options.signal)
  const verified = getVerifiedProjectBundle(input)
  if (!verified) throw new Error('完整工程未持有确切不可变资源闭包的验证证明。')
  const project = Object.freeze({ ...verified.project, resources: verified.resources })
  verifiedProjects.set(project, verified)
  return project
}

/** A full capture checks actual bytes and pixels and owns both immutable branches. */
export async function fromBundle(bundle: ProjectBundle, options: CompleteValidationOptions): Promise<EditableProject> {
  const captured = await validateProjectBundle(bundle, options)
  return fromVerifiedBundle(captured, options)
}

export async function validateEditableProject(input: EditableProject, options: CompleteValidationOptions): Promise<EditableProject> {
  return fromBundle(toBundle(input), options)
}
