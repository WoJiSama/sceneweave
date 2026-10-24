import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { svgFixtureValidation, svgProjectFixture, SVG_FIXTURE_SOURCE } from '../../tests/helpers/m24-svg-fixtures'
import { createMemoryResources, getVerifiedProjectBundle, validateProjectBundle, validateProjectBundles } from './project/resources'
import { exportHistoryArchive, exportProject, importHistoryArchive, importProject } from './project/file'
import { assertFixedProjectCompatible } from './project/history'
import { projectContentHash, validateProjectData } from './project/validate'
import { projectResourceHashes, projectSourceRecords } from './project/source-resources'
import { decodeUtf8, sha256Bytes } from './project/binary'
import { cloneJson, encodeUtf8 } from './validation/json'

describe('SVG complete-project byte and pixel closure', () => {
  it('owns original, normalized and raster bytes under the exact verified resource scope', async () => {
    const { bundle, bytes, normalized } = svgProjectFixture(), options = svgFixtureValidation()
    const verified = await validateProjectBundle(bundle, options)
    expect(getVerifiedProjectBundle(verified)).toBe(verified)
    expect(projectSourceRecords(verified.project).size).toBe(2)
    expect(new Set(projectResourceHashes(verified.project))).toEqual(new Set(bytes.keys()))
    for (const [hash, expected] of bytes) expect(await verified.resources.read(hash)).toEqual(expected)
    const mutable = await verified.resources.read(normalized.sourceSha256); mutable.fill(0)
    expect(decodeUtf8(await verified.resources.read(normalized.sourceSha256))).toBe(SVG_FIXTURE_SOURCE)
  })

  it('requires an explicit trusted SVG capability only for nonempty sources', async () => {
    const { bundle } = svgProjectFixture(), options = svgFixtureValidation()
    await expect(validateProjectBundle(bundle, { images: options.images })).rejects.toMatchObject({ code: 'svg-capability-unavailable' })
    expect(getVerifiedProjectBundle(bundle)).toBeUndefined()
    bundle.project.authoringSources = {}
    expect(await validateProjectBundle(bundle, { images: options.images })).toBeDefined()
  })

  it('rejects source capability accessors without invoking them and captures its method before awaiting reads', async () => {
    const { bundle } = svgProjectFixture(), options = svgFixtureValidation(), capability = options.svg!
    let getters = 0
    Object.defineProperty(capability, 'rasterize', { enumerable: true, get() { getters++; throw new Error('accessor') } })
    await expect(validateProjectBundle(bundle, options)).rejects.toThrow()
    expect(getters).toBe(0)
    const valid = svgFixtureValidation(), original = valid.svg!.rasterize, called = vi.fn(original)
    valid.svg!.rasterize = called
    const validating = validateProjectBundle(bundle, valid)
    valid.svg!.rasterize = async () => { throw new Error('method changed after capture') }
    expect(await validating).toBeDefined(); expect(called).toHaveBeenCalledOnce()
  })

  it('rejects missing, changed and oversized source bytes without issuing certificates', async () => {
    for (const mode of ['missing', 'changed', 'oversized'] as const) {
      const { bundle, bytes, normalized } = svgProjectFixture()
      if (mode === 'missing') bytes.delete(normalized.sourceSha256)
      else if (mode === 'changed') bytes.get(normalized.sourceSha256)![8] ^= 1
      else bytes.set(normalized.sourceSha256, new Uint8Array(normalized.sourceSizeBytes + 1))
      bundle.resources = createMemoryResources(bytes)
      await expect(validateProjectBundle(bundle, svgFixtureValidation())).rejects.toThrow()
      expect(getVerifiedProjectBundle(bundle)).toBeUndefined()
    }
  })

  it('reparses original SVG even when hashes and its PNG metadata match', async () => {
    const { bundle, bytes } = svgProjectFixture(), malicious = encodeUtf8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script/></svg>'), hash = sha256Bytes(malicious)
    bundle.project.authoringSources.image.sourceSha256 = hash; bundle.project.authoringSources.image.sourceSizeBytes = malicious.length
    bytes.set(hash, malicious); bundle.resources = createMemoryResources(bytes)
    await expect(validateProjectBundle(bundle, svgFixtureValidation())).rejects.toThrow(/标签|静态|SVG/)
  })

  it('rejects a different valid normalized SVG with recomputed source hashes', async () => {
    const { bundle, bytes, normalized } = svgProjectFixture(), changed = encodeUtf8(normalized.normalizedSource.replace('#c86432', '#ffffff')), hash = sha256Bytes(changed)
    bundle.project.authoringSources.image.normalizedSha256 = hash; bundle.project.authoringSources.image.normalizedSizeBytes = changed.length
    bytes.set(hash, changed); bundle.resources = createMemoryResources(bytes)
    await expect(validateProjectBundle(bundle, svgFixtureValidation())).rejects.toThrow(/规范化源/)
  })

  it('compares actual PNG pixels against the trusted rerasterizer and honors cancellation afterwards', async () => {
    const { bundle } = svgProjectFixture(), options = svgFixtureValidation()
    options.svg!.rasterize = async () => ({ width: 1, height: 1, rgba: new Uint8ClampedArray([1, 2, 3, 255]) })
    await expect(validateProjectBundle(bundle, options)).rejects.toThrow(/实际栅格像素/)
    const cancelled = svgFixtureValidation(), signal = { aborted: false }, original = cancelled.svg!.rasterize
    cancelled.svg!.rasterize = async (...args) => { signal.aborted = true; return original(...args) }
    await expect(validateProjectBundle(bundle, { ...cancelled, signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(getVerifiedProjectBundle(bundle)).toBeUndefined()
  })

  it('keeps source scopes separate for independent complete bundles', async () => {
    const first = svgProjectFixture(), second = svgProjectFixture(SVG_FIXTURE_SOURCE.replace('><rect', '>\n<rect'))
    const [left, right] = await validateProjectBundles([first.bundle, second.bundle], svgFixtureValidation())
    await expect(left.resources.read(second.normalized.sourceSha256)).rejects.toThrow(/闭包/)
    await expect(right.resources.read(first.normalized.sourceSha256)).rejects.toThrow(/闭包/)
    expect(await right.resources.read(second.normalized.normalizedSha256)).toEqual(second.bytes.get(second.normalized.normalizedSha256))
  })

  it('forbids redefining a fixed source in selected history and applies source metadata guards', () => {
    const { bundle } = svgProjectFixture(), other = cloneJson(bundle.project)
    other.authoringSources.image.sourceSizeBytes++
    expect(() => assertFixedProjectCompatible(bundle.project, other)).toThrow(/固定来源/)
    const wrong = cloneJson(bundle.project); wrong.authoringSources.image.rasterSha256 = 'a'.repeat(64)
    expect(() => validateProjectData(wrong)).toThrow(/SVG/)
    const collision = cloneJson(bundle.project); collision.authoringSources.image.sourceSha256 = Object.keys(collision.assets)[0]
    expect(() => validateProjectData(collision)).toThrow(/共用资源hash/)
  })

  it('round-trips source files through a normal offline project package', async () => {
    const { bundle, bytes } = svgProjectFixture(), options = svgFixtureValidation(), exported = await exportProject(bundle, options)
    const files = unzipSync(exported)
    expect(Object.keys(files).filter(path => path.startsWith('sources/'))).toHaveLength(2)
    const imported = await importProject(exported, options)
    expect(imported.project).toEqual(bundle.project)
    for (const [hash, value] of bytes) expect(await imported.resources.read(hash)).toEqual(value)
    expect(await exportProject(imported, options)).toEqual(exported)
    const missing = unzipSync(exported); delete missing[`sources/${bundle.project.authoringSources.image.sourceSha256}.svg`]
    await expect(importProject(zipSync(missing), options)).rejects.toThrow(/路径/)
  })

  it('retains snapshot-only SVGs while returned current/snapshot ports enforce their own closures', async () => {
    const { bundle: historical, normalized } = svgProjectFixture(), current = { project: cloneJson(historical.project), resources: historical.resources }
    current.project.document.revision = 1; current.project.authoringSources = {}
    const snapshot = { id: 'svg-snapshot', ownerSceneId: current.project.document.sceneId, lineageId: historical.project.historyIdentity.lineageId, sourceRevision: 0,
      name: 'SVG original', kind: 'named' as const, createdAt: '2026-10-24T00:00:00.000Z', contentHash: projectContentHash(historical.project), bundle: historical }
    const exported = await exportHistoryArchive({ current, snapshots: [snapshot] }, svgFixtureValidation())
    const imported = await importHistoryArchive(exported, svgFixtureValidation())
    expect(imported.current.project.authoringSources).toEqual({})
    expect(imported.snapshots[0].bundle.project.authoringSources).toEqual(historical.project.authoringSources)
    await expect(imported.current.resources.read(normalized.sourceSha256)).rejects.toThrow(/闭包/)
    expect(decodeUtf8(await imported.snapshots[0].bundle.resources.read(normalized.sourceSha256))).toBe(SVG_FIXTURE_SOURCE)
  })
})
