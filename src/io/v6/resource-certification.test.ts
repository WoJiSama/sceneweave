import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureOwnedData } from '../v3/owned-data'
import { captureValidatedResourcesV3, getOwnedResourcesV3 } from '../v3/project-file'
import { imageProject as imageV5 } from '../v5/test-fixtures'
import { emptyProject as emptyV4 } from '../v4/test-fixtures'
import { migrateProjectV4ToV5 } from '../v5/migration'
import { captureValidatedMigrationV6, getOwnedMigrationV6, migrateProjectV5ToV6 } from './migration'
import { prepareCompositionCommandsV6 } from './prepare'
import { captureCompleteProjectV6, captureValidatedProjectV6, validateCompleteProjectV6 } from './project-file'
import { imageProject, pixelPng } from './test-fixtures'
import type { CompleteProjectV6 } from './types'

const bitmap = () => ({ width: 1, height: 1, close: vi.fn() })
function gate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const nativeView = (project: CompleteProjectV6) => ({ document: project.document, assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings })

// Only browser decoding is doubled. Actual PNG bytes/CRC/SHA and license hashes remain real.
beforeEach(() => vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap())))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('internal owned resource closures', () => {
  it('reuses the exact closure through ordinary command preparation, while public validation still decodes', async () => {
    const input = await imageProject(), project = await captureValidatedProjectV6(input)
    const hash = Object.keys(project.assets)[0], record = project.assets[hash]
    expect(project.assets).not.toBe(input.assets)
    expect(record.blob).not.toBe(input.assets[hash].blob)
    for (const value of [project.assets, record, record.blob, project.licenses, Object.values(project.licenses)[0], project.licenseBindings, project.licenseBindings[0]]) expect(Object.isFrozen(value)).toBe(true)
    expect(() => Object.defineProperty(record.blob, 'arrayBuffer', { value: async () => new ArrayBuffer(0) })).toThrow()
    expect(() => Object.defineProperty(record.blob, 'size', { value: 0 })).toThrow()
    expect(getOwnedResourcesV3(project)).toEqual({ assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings })
    vi.mocked(createImageBitmap).mockClear()
    const id = Object.keys(project.document.props)[0], position = project.document.props[id].positionMm
    const prepared = await prepareCompositionCommandsV6(project, [{ type: 'updateProp', id, changes: { positionMm: { x: position.x + 10, y: position.y } } }])
    expect(prepared.assets).toBe(project.assets); expect(prepared.licenses).toBe(project.licenses); expect(prepared.licenseBindings).toBe(project.licenseBindings)
    expect(prepared.document.props[id].positionMm.x).toBe(position.x + 10)
    expect(prepared.document.revision).toBe(project.document.revision)
    expect(createImageBitmap).not.toHaveBeenCalled()
    await validateCompleteProjectV6(prepared)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
  })

  it.each(['assets', 'licenses', 'licenseBindings'] as const)('does not reuse a closure with its %s container replaced', async key => {
    const owned = await captureValidatedProjectV6(await imageProject()), external = { ...owned, [key]: structuredClone(owned[key]) }
    Object.freeze(external[key])
    expect(getOwnedResourcesV3(external)).toBeUndefined()
    vi.mocked(createImageBitmap).mockClear()
    const recaptured = await captureValidatedProjectV6(external)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    expect(recaptured.assets).not.toBe(owned.assets)
    expect(recaptured.licenses).not.toBe(owned.licenses)
    expect(recaptured.licenseBindings).not.toBe(owned.licenseBindings)
  })

  it('rejects changed bytes and license text behind unchanged hashes, including caller-frozen records', async () => {
    const project = await captureValidatedProjectV6(await imageProject()), hash = Object.keys(project.assets)[0], licenseHash = Object.keys(project.licenses)[0]
    const bytes = pixelPng(); bytes[bytes.length - 5] ^= 1
    const assets = { ...project.assets, [hash]: Object.freeze({ ...project.assets[hash], blob: Object.freeze(new Blob([bytes.slice().buffer], { type: 'image/png' })) }) }
    await expect(captureValidatedProjectV6({ ...project, assets: Object.freeze(assets) })).rejects.toThrow()
    const licenses = { ...project.licenses, [licenseHash]: Object.freeze({ ...project.licenses[licenseHash], text: 'Different valid text with the old hash.' }) }
    await expect(captureValidatedProjectV6({ ...project, licenses: Object.freeze(licenses) })).rejects.toThrow('SHA-256')
    expect(getOwnedResourcesV3({ ...project, assets })).toBeUndefined()
  })

  it('checks current dependencies, metadata, license subjects, embedding and document budgets even with owned bytes', async () => {
    const project = await captureValidatedProjectV6(await imageProject())
    for (const change of [
      (document: CompleteProjectV6['document']) => { document.assets['test-image'].pixelWidth++ },
      (document: CompleteProjectV6['document']) => { document.assets['test-image'].sha256 = 'a'.repeat(64) },
      (document: CompleteProjectV6['document']) => { document.assets['test-image'].licenseRef = 'unbound-license' },
      (document: CompleteProjectV6['document']) => { document.assets['test-image'].origin.canEmbed = false },
      (document: CompleteProjectV6['document']) => { document.materials['test-material'].origin.canEmbed = false },
      (document: CompleteProjectV6['document']) => { document.title = 'x'.repeat(21 * 1024 * 1024) },
    ]) {
      const document = structuredClone(project.document); change(document)
      const candidate = { ...project, document }
      expect(getOwnedResourcesV3(candidate)).toBeDefined()
      await expect(captureValidatedProjectV6(candidate)).rejects.toThrow()
    }
  })

  it('captures mutable caller data before awaiting native decode', async () => {
    const input = await imageProject(), before = structuredClone(input), entered = gate<void>(), released = gate<ReturnType<typeof bitmap>>()
    vi.mocked(createImageBitmap).mockImplementationOnce(async () => { entered.resolve(); return await released.promise as unknown as ImageBitmap })
    const pending = captureValidatedProjectV6(input)
    await entered.promise
    const hash = Object.keys(input.assets)[0], licenseHash = Object.keys(input.licenses)[0]
    input.document.title = 'late caller title'
    input.assets[hash].blob = new Blob(['late invalid bytes'])
    input.licenses[licenseHash].text = 'late caller license'
    input.licenseBindings.length = 0
    released.resolve(bitmap())
    const captured = await pending
    expect(captured.document.title).toBe(before.document.title)
    expect(await captured.assets[hash].blob.arrayBuffer()).toEqual(await before.assets[hash].blob.arrayBuffer())
    expect(captured.licenses).toEqual(before.licenses); expect(captured.licenseBindings).toEqual(before.licenseBindings)
    expect(getOwnedResourcesV3(input)).toBeUndefined()
  })

  it.each(['failure', 'abort'] as const)('does not certify a %s and retries full decoding', async kind => {
    const input = await imageProject(), entered = gate<void>(), released = gate<ReturnType<typeof bitmap>>(), controller = new AbortController()
    vi.mocked(createImageBitmap).mockImplementationOnce(async () => {
      entered.resolve()
      const result = await released.promise
      if (kind === 'failure') throw new Error('injected native decoder failure')
      return result as unknown as ImageBitmap
    })
    const pending = captureValidatedResourcesV3(nativeView(input), { signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow()
    await entered.promise
    if (kind === 'abort') controller.abort()
    released.resolve(bitmap()); await rejected
    expect(getOwnedResourcesV3(input)).toBeUndefined()
    vi.mocked(createImageBitmap).mockClear()
    await captureValidatedProjectV6(input)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
  })
})

describe('data-only capture and exact migration proofs', () => {
  it('accepts native Blob, sliced Blob and File but refuses extra fields, accessors and subclasses without reading them', async () => {
    for (const value of [new Blob(['original'], { type: 'text/plain' }), new Blob(['original'], { type: 'text/plain' }).slice(), new File(['original'], 'original.txt')]) {
      const captured = captureOwnedData(value)
      expect(await captured.text()).toBe('original'); expect(Object.isFrozen(captured)).toBe(true)
    }
    const getter = vi.fn(() => new ArrayBuffer(0))
    const overridden = Object.defineProperty(new Blob(['x']), 'arrayBuffer', { get: getter })
    const symbol = Object.assign(new Blob(['x']), { [Symbol('caller')]: true })
    class CallerBlob extends Blob {}
    for (const value of [overridden, symbol, new CallerBlob(['x']), Object.defineProperty(new Blob(['x']), 'size', { value: 0 })]) expect(() => captureOwnedData(value)).toThrow()
    expect(getter).not.toHaveBeenCalled()
  })

  it('rejects hidden/symbol/getter fields at the root, records and arrays before executing caller accessors', async () => {
    const project = await captureValidatedProjectV6(await imageProject()), hash = Object.keys(project.assets)[0], getter = vi.fn(() => project.assets)
    const wrappers = [
      { ...project, extra: true },
      { ...project, [Symbol('hidden')]: true },
      Object.defineProperty({ ...project }, 'hidden', { value: true }),
      Object.defineProperty({ ...project }, 'assets', { get: getter, enumerable: true }),
      { ...project, assets: { [hash]: Object.defineProperty({ ...project.assets[hash] }, 'blob', { get: getter, enumerable: true }) } },
      { ...project, licenseBindings: Object.assign([...project.licenseBindings], { extra: true }) },
      { ...project, licenses: Object.create({ inherited: true }) },
    ]
    for (const wrapper of wrappers) await expect(captureValidatedProjectV6(wrapper)).rejects.toThrow()
    expect(getter).not.toHaveBeenCalled()
    const cycle: Record<string, unknown> = {}; cycle.cycle = cycle
    expect(() => captureOwnedData(cycle)).toThrow('循环')
  })

  it('binds a migration proof to exact frozen originals and target identity, and never reads an unknown sceneId getter', async () => {
    const migrated = await migrateProjectV5ToV6(await imageV5(), { sceneId: 'owned-migration-target' }), source = migrated.migrationSource!
    expect(getOwnedMigrationV6(source, migrated.document.sceneId)).toBe(source)
    expect(Object.isFrozen(source)).toBe(true); expect(Object.isFrozen(source.original)).toBe(true)
    expect(await captureValidatedMigrationV6(source, migrated.document.sceneId)).toBe(source)
    expect(getOwnedMigrationV6(source, source.sourceSceneId)).toBeUndefined()
    await expect(captureValidatedMigrationV6(source, source.sourceSceneId)).rejects.toThrow('原件记录无效')
    const badOriginal = { ...source, original: new Blob(['not the original']) }
    await expect(captureValidatedMigrationV6(badOriginal, migrated.document.sceneId)).rejects.toThrow('SHA-256')
    const badMetadata = { ...source, sourceRevision: source.sourceRevision + 1 }
    await expect(captureValidatedMigrationV6(badMetadata, migrated.document.sceneId)).rejects.toThrow('修订不匹配')
    expect(getOwnedMigrationV6(badOriginal, migrated.document.sceneId)).toBeUndefined()
    const getter = vi.fn(() => migrated.document.sceneId), document = Object.defineProperty(structuredClone(migrated.document), 'sceneId', { get: getter, enumerable: true })
    expect(() => captureCompleteProjectV6({ ...migrated, document })).toThrow('访问器')
    expect(getter).not.toHaveBeenCalled()
    const sourceGetter = vi.fn(() => source.original), wrapped = Object.defineProperty({ ...source }, 'original', { get: sourceGetter, enumerable: true })
    await expect(captureValidatedMigrationV6(wrapped, migrated.document.sceneId)).rejects.toThrow('访问器')
    expect(sourceGetter).not.toHaveBeenCalled()
  })

  it('revalidates an owned whole source chain when moving it to an earlier ancestor scene', async () => {
    const ancestor = emptyV4(), v5 = await migrateProjectV4ToV5(ancestor), v6 = await migrateProjectV5ToV6(v5)
    const source = v6.migrationSource!
    expect(getOwnedMigrationV6(source, v6.document.sceneId)).toBe(source)
    await expect(captureValidatedMigrationV6(source, ancestor.document.sceneId)).rejects.toThrow('独立场景身份')
    const external = structuredClone(source), controller = new AbortController(); controller.abort()
    await expect(captureValidatedMigrationV6(external, v6.document.sceneId, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(getOwnedMigrationV6(external, v6.document.sceneId)).toBeUndefined()
    const recaptured = await captureValidatedMigrationV6(external, v6.document.sceneId)
    expect(recaptured).not.toBe(source); expect(recaptured).not.toBe(external)
    expect(await recaptured!.original.arrayBuffer()).toEqual(await source.original.arrayBuffer())
    expect(await recaptured!.previousSource!.original.arrayBuffer()).toEqual(await source.previousSource!.original.arrayBuffer())
  })
})
