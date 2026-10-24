import { describe, expect, it } from 'vitest'
import { sha256Bytes } from '../../shared/project/binary.js'
import { fromBundle, toBundle, validateEditableProject } from './project.js'
import { materializeProject, prepareCompositionCommands } from './prepare.js'
import { fixture, runtime, validation } from './test-fixtures.js'

describe('native editable capture and bitmap preparation', () => {
  it('owns real bytes and rejects getters without executing them', async () => {
    const input = fixture({ image: true }), project = await fromBundle(input, validation), hash = Object.keys(project.assets)[0]
    const bytes = await project.resources.read(hash); bytes.fill(0)
    expect(sha256Bytes(await project.resources.read(hash))).toBe(hash)
    let reads = 0
    const getter = { ...project }; Object.defineProperty(getter, 'document', { enumerable: true, get() { reads++; return project.document } })
    await expect(validateEditableProject(getter, validation)).rejects.toThrow(/访问器/); expect(reads).toBe(0)
    expect(Object.keys(toBundle(project))).toEqual(['project', 'resources'])
  })

  it('materializes actual PNG bytes from the fixed source while preserving source, physical fields and revision', async () => {
    const original = await fromBundle(fixture({ image: true }), validation), before = original.document.props.item
    const prepared = await prepareCompositionCommands(original, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'half-brightness', kind: 'brightness', enabled: true, value: .5 } }], { validation, runtime })
    expect(prepared.document.revision).toBe(original.document.revision)
    expect(original.appearance.variants).toEqual({}); expect(Object.values(prepared.appearance.variants)).toHaveLength(1)
    const variant = Object.values(prepared.appearance.variants)[0], source = prepared.document.assets[variant.sourceAssetId], output = prepared.document.assets[variant.outputAssetId]
    expect(source.sha256).toBe(original.document.assets.image.sha256); expect(output.sha256).not.toBe(source.sha256)
    const record = prepared.assets[output.sha256], bytes = await prepared.resources.read(output.sha256)
    expect(sha256Bytes(bytes)).toBe(record.sha256)
    expect([...((await validation.images.decode(bytes, record)).rgba)]).toEqual([100, 50, 25, 255])
    expect(prepared.document.props.item.footprintMm).toEqual(before.footprintMm)
    expect(prepared.document.props.item.supportRef).toEqual(before.supportRef)
    expect(prepared.document.props.item.visibility).toBe(before.visibility)
    expect(await materializeProject(prepared, { validation, runtime })).toMatchObject({ document: { revision: original.document.revision }, appearance: { variants: prepared.appearance.variants } })
  })

  it('rejects corrupt fixed source bytes and cancellation without yielding an adoptable draft', async () => {
    const original = await fromBundle(fixture({ image: true }), validation)
    const corrupted = { ...original, resources: { read: async () => new Uint8Array([1, 2, 3]) } }
    await expect(prepareCompositionCommands(corrupted, [], { validation, runtime })).rejects.toThrow(/字节/)
    await expect(materializeProject(original, { validation, runtime, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('checks inherited cancellation before allocating command identities on an owned project', async () => {
    const original = await fromBundle(fixture({ image: true }), validation)
    let identities = 0
    const trackedRuntime = { ...runtime, ids: { nextId: () => { identities++; return 'cancelled-command' } } }
    await expect(prepareCompositionCommands(original, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'cancelled-opacity', kind: 'opacity', enabled: true, value: .5 } }],
    { validation: { ...validation, signal: { aborted: true } }, runtime: trackedRuntime })).rejects.toMatchObject({ name: 'AbortError' })
    expect(identities).toBe(0)
    expect(original.appearance.instanceAdjustments).toEqual({})
  })
})
