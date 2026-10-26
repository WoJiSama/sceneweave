import { describe, expect, it } from 'vitest'
import { applyCompositionDraftCommands } from '../../shared/appearance/commands.js'
import { getCertifiedCompositionContent, getCertifiedCompositionDraft } from '../../shared/validation/content.js'
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

  it('reuses the owned byte closure for composition-only edits', async () => {
    const original = await fromBundle(fixture({ image: true }), validation)
    let decodes = 0
    const checked = { ...validation, images: { ...validation.images, decode: async (...args: Parameters<NonNullable<typeof validation.images>['decode']>) => {
      decodes++
      return validation.images!.decode(...args)
    } } }
    const prepared = await prepareCompositionCommands(original, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'opacity-only', kind: 'opacity', enabled: true, value: .75 } }], { validation: checked, runtime })
    expect(decodes).toBe(0)
    expect(prepared.resources).toBe(original.resources)
    expect(prepared.document.props.item.appearance.opacity).toBe(.75)
  })

  it('rejects corrupt fixed source bytes and cancellation without yielding an adoptable draft', async () => {
    const original = await fromBundle(fixture({ image: true }), validation)
    const corrupted = { ...original, resources: { read: async () => new Uint8Array([1, 2, 3]) } }
    await expect(prepareCompositionCommands(corrupted, [], { validation, runtime })).rejects.toThrow(/字节/)
    await expect(materializeProject(corrupted, { validation, runtime, baseline: original })).rejects.toThrow(/字节/)
    await expect(materializeProject(original, { validation, runtime, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('captures a changing wrapper resource port once and validates its replacement bytes', async () => {
    const original = await fromBundle(fixture({ image: true }), validation)
    let descriptorReads = 0, byteReads = 0
    const replacement = { read: async () => { byteReads++; return new Uint8Array([1, 2, 3]) } }
    const changing = new Proxy({ ...original }, { getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== 'resources' || !descriptor) return descriptor
      return { ...descriptor, value: ++descriptorReads <= 2 ? replacement : original.resources }
    } })
    await expect(materializeProject(changing, { validation, runtime, baseline: original })).rejects.toThrow(/字节/)
    expect(descriptorReads).toBe(1)
    expect(byteReads).toBeGreaterThan(0)
  })

  it('keeps immutable material ancestors and actual bytes when visual surface scale and overlays change', async () => {
    const input = fixture({ image: true, building: true }), document = input.project.document
    const material = { id: 'wood', catalogId: 'original-wood', version: 1, licenseRef: 'fixture-license', origin: document.assets.image.origin,
      name: 'Wood', tags: [], textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room' as const] }
    document.materials.wood = material
    input.project.licenseBindings.push({ subjectKind: 'material', subjectId: material.id, licenseRef: material.licenseRef,
      licensePath: input.project.licenseBindings[0].licensePath, embedding: 'allowed' })
    const original = await fromBundle(input, validation), style = { base: { materialRef: { id: 'wood', version: 1 }, tileSizeMm: { width: 1000, height: 1000 },
      rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
    const first = await prepareCompositionCommands(original, [{ type: 'setVisualSurface', kind: 'room', id: 'room', style }], { validation, runtime })
    const parent = first.appearance.surfaceSources.room, parentSource = structuredClone(first.appearance.sources[parent])
    const changed = { base: { ...style.base, tileSizeMm: { width: 750, height: 750 }, rotationDeg: 35 },
      overlays: [{ id: 'soft-floor', boundaryMm: [{ x: 4000, y: 4000 }, { x: 5000, y: 4000 }, { x: 5000, y: 5000 }, { x: 4000, y: 5000 }],
        paint: { ...style.base, opacity: .4 }, blendWidthMm: 150, renderOrder: 0 }] }
    const second = await prepareCompositionCommands(first, [{ type: 'setVisualSurface', kind: 'room', id: 'room', style: changed }], { validation, runtime })
    const child = second.appearance.surfaceSources.room
    expect(child).not.toBe(parent); expect(second.appearance.sources[parent]).toEqual(parentSource)
    expect(second.appearance.sources[child]).toMatchObject({ kind: 'surface', parentSourceId: parent, snapshot: changed })
    expect(first.document.rooms.room.floorStyle).toEqual(style); expect(second.document.rooms.room.floorStyle).toEqual(changed)
    expect(second.schemaVersion).toBe(2); expect(original.schemaVersion).toBe(1)
    const { floorStyle: _beforeStyle, ...beforePhysical } = original.document.rooms.room
    const { floorStyle: _afterStyle, ...afterPhysical } = second.document.rooms.room
    expect(afterPhysical).toEqual(beforePhysical); expect(second.document.walls).toEqual(original.document.walls)
    expect(second.document.materials.wood).toEqual(material); expect(second.licenseBindings).toEqual(original.licenseBindings)
    for (const hash of Object.keys(original.assets)) expect(await second.resources.read(hash)).toEqual(await original.resources.read(hash))
    await validateEditableProject(second, validation)
  })

  it('consumes an owned draft only after resolving appearance and retaining complete license/resource validation', async () => {
    const original = await fromBundle(fixture({ image: true }), validation)
    const source = { document: original.document, historyIdentity: original.historyIdentity, appearance: original.appearance }
    const draft = applyCompositionDraftCommands(source, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 15 } }], runtime)
    expect(getCertifiedCompositionDraft(draft)).toBe(draft)
    const prepared = await materializeProject({ ...original, ...draft }, { validation, runtime, baseline: original })
    expect(prepared.resources).toBe(original.resources)
    expect(prepared.document).toBe(draft.document)
    expect(prepared.document.props.item.rotationDeg).toBe(15)
    await expect(materializeProject({ ...original, ...draft, licenseBindings: [] }, { validation, runtime, baseline: original })).rejects.toThrow(/许可/)
    const pending = applyCompositionDraftCommands(source, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'pending-opacity', kind: 'opacity', enabled: true, value: .4 } }], runtime)
    const adopted = await materializeProject({ ...original, ...pending }, { validation, runtime, baseline: original })
    expect(adopted.document.props.item.appearance.opacity).toBe(.4)
    expect(getCertifiedCompositionContent(pending)).toBeUndefined()
    expect(pending.document.props.item.appearance.opacity).toBe(1)
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
