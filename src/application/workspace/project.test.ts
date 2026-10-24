import { describe, expect, it, vi } from 'vitest'
import { cloneJson } from '../../shared/validation/json.js'
import { getVerifiedProjectBundle, validateProjectBundle } from '../../shared/project/resources.js'
import { fixture, validation } from './test-fixtures.js'
import { fromBundle, fromVerifiedBundle, getVerifiedEditableProject, toBundle, validateEditableProject } from './project.js'

const options = () => ({ images: { ...validation.images, decode: vi.fn(validation.images.decode) } })

describe('owned editable project verification handoff', () => {
  it('requires a real private certificate instead of frozen metadata or a caller flag', async () => {
    const input = fixture({ image: true }), checking = options()
    expect(() => fromVerifiedBundle(input)).toThrow(/验证证明/)
    Object.freeze(input.project)
    expect(() => fromVerifiedBundle(Object.freeze(input))).toThrow(/验证证明/)
    expect(checking.images.decode).not.toHaveBeenCalled()
    const verified = await validateProjectBundle(input, checking)
    expect(() => fromVerifiedBundle({ ...verified, validated: true } as typeof verified)).toThrow(/验证证明/)
  })

  it('preserves only the exact validator metadata and independently owned byte port', async () => {
    const checking = options(), verified = await validateProjectBundle(fixture({ image: true }), checking)
    const editable = fromVerifiedBundle({ project: verified.project, resources: verified.resources })
    expect(checking.images.decode).toHaveBeenCalledTimes(1)
    expect(getVerifiedEditableProject(editable)).toBe(editable)
    expect(Object.isFrozen(editable)).toBe(true)
    expect(Object.isFrozen(editable.document.props.item.positionMm)).toBe(true)
    expect(toBundle(editable)).toBe(verified)
    expect(getVerifiedProjectBundle(toBundle(editable))).toBe(verified)
    expect(() => fromVerifiedBundle({ project: cloneJson(verified.project), resources: verified.resources })).toThrow(/验证证明/)
    expect(() => fromVerifiedBundle({ project: verified.project, resources: Object.freeze({ read: verified.resources.read }) })).toThrow(/验证证明/)
  })

  it('does not grant editable reuse to spread copies, changed metadata or replacement ports', async () => {
    const project = await fromBundle(fixture({ image: true }), options()), bundle = toBundle(project)
    for (const candidate of [
      Object.freeze({ ...project }),
      Object.freeze({ ...project, document: cloneJson(project.document) }),
      Object.freeze({ ...project, resources: Object.freeze({ read: project.resources.read }) }),
    ]) {
      expect(getVerifiedEditableProject(candidate)).toBeUndefined()
      const captured = toBundle(candidate)
      expect(captured).not.toBe(bundle)
      expect(getVerifiedProjectBundle(captured)).toBeUndefined()
    }
  })

  it('continues to fully decode public fromBundle and validateEditableProject calls', async () => {
    const checking = options(), verified = await validateProjectBundle(fixture({ image: true }), checking)
    const internal = fromVerifiedBundle(verified)
    const publicCopy = await fromBundle(verified, checking)
    const publicEditable = await validateEditableProject(internal, checking)
    expect(checking.images.decode).toHaveBeenCalledTimes(3)
    expect(publicCopy).not.toBe(internal)
    expect(publicEditable).not.toBe(internal)
    expect(toBundle(publicCopy).resources).not.toBe(verified.resources)
    expect(toBundle(publicEditable).resources).not.toBe(verified.resources)
  })

  it('keeps detached bytes and rejects accessors without evaluating them', async () => {
    const input = fixture({ image: true }), originalTitle = input.project.document.title
    const verified = await validateProjectBundle(input, options()), project = fromVerifiedBundle(verified)
    input.project.document.title = 'outside change'
    expect(project.document.title).toBe(originalTitle)
    const hash = Object.keys(project.assets)[0], bytes = await project.resources.read(hash)
    bytes.fill(0)
    expect(await project.resources.read(hash)).not.toEqual(bytes)
    let reads = 0
    const accessor = Object.defineProperty({ ...verified }, 'project', { enumerable: true, get() { reads++; return verified.project } })
    expect(() => fromVerifiedBundle(accessor)).toThrow(/验证证明/)
    expect(reads).toBe(0)
    const editableAccessor = Object.defineProperty({ ...project }, 'document', { enumerable: true, get() { reads++; return project.document } })
    expect(() => toBundle(editableAccessor)).toThrow(/访问器/)
    expect(reads).toBe(0)
  })

  it('checks cancellation even when the bundle already has an owned certificate', async () => {
    const verified = await validateProjectBundle(fixture({ image: true }), options())
    expect(() => fromVerifiedBundle(verified, { signal: { aborted: true } })).toThrow(/取消/)
    expect(fromVerifiedBundle(verified).document).toBe(verified.project.document)
  })
})
