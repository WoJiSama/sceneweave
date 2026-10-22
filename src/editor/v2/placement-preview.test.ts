import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_LIMITS_V2 } from '../../io/v2/limits'
import * as resources from '../../io/v2/resources'
import { imageProject, imageRecord, pixelPng, pngChunk } from '../../io/v2/test-fixtures'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { decodePlacementPreviewV2 } from './placement-preview'

const bitmap = (width = 1, height = 1) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap
const ref = (project: CompleteProjectV2) => project.document.assets['test-image']
const record = (project: CompleteProjectV2) => project.assets[ref(project).sha256]
beforeEach(() => { vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap())) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('verified placement preview decode', () => {
  it('verifies real resource bytes, decodes once with renderer settings, and transfers bitmap disposal to the caller', async () => {
    const project = await imageProject(), result = await decodePlacementPreviewV2(project, 'test-image')
    expect(createImageBitmap).toHaveBeenCalledExactlyOnceWith(record(project).blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
    expect(result.width).toBe(1); expect(result.height).toBe(1)
    expect(result.close).not.toHaveBeenCalled()
    result.close(); expect(result.close).toHaveBeenCalledOnce()
  })

  it('rejects missing references/bytes and inherited records without invoking the decoder', async () => {
    const project = await imageProject()
    await expect(decodePlacementPreviewV2(project, 'missing')).rejects.toThrow('缺失')
    await expect(decodePlacementPreviewV2(project, 'constructor')).rejects.toThrow('缺失')
    delete project.assets[ref(project).sha256]
    await expect(decodePlacementPreviewV2(project, 'test-image')).rejects.toThrow('缺失')
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it.each(['reference-id', 'record-hash', 'record-mime', 'record-dimensions', 'blob-mime', 'byte-length', 'extra-record-field'] as const)('rejects inconsistent %s metadata before decode', mutation => {
    return imageProject().then(async project => {
      const resource = record(project)
      if (mutation === 'reference-id') ref(project).id = 'another-image'
      if (mutation === 'record-hash') resource.sha256 = '0'.repeat(64)
      if (mutation === 'record-mime') resource.mimeType = 'image/jpeg'
      if (mutation === 'record-dimensions') resource.pixelWidth = 2
      if (mutation === 'blob-mime') resource.blob = new Blob([resource.blob], { type: 'image/jpeg' })
      if (mutation === 'byte-length') resource.sizeBytes++
      if (mutation === 'extra-record-field') Object.assign(resource, { ignored: true })
      await expect(decodePlacementPreviewV2(project, 'test-image')).rejects.toThrow('字节记录')
      expect(createImageBitmap).not.toHaveBeenCalled()
    })
  })

  it('checks actual hash, CRC, normalized metadata and header dimensions before native decode', async () => {
    const hashProject = await imageProject(), original = record(hashProject), wrongHash = '0'.repeat(64)
    delete hashProject.assets[ref(hashProject).sha256]
    ref(hashProject).sha256 = wrongHash; hashProject.assets[wrongHash] = { ...original, sha256: wrongHash }
    await expect(decodePlacementPreviewV2(hashProject, 'test-image')).rejects.toThrow('hash')

    const installBytes = async (bytes: Uint8Array) => {
      const project = await imageProject(), replacement = await imageRecord(bytes)
      delete project.assets[ref(project).sha256]
      ref(project).sha256 = replacement.sha256; project.assets[replacement.sha256] = replacement
      return project
    }
    const damaged = pixelPng(); damaged[20] ^= 1
    await expect(decodePlacementPreviewV2(await installBytes(damaged), 'test-image')).rejects.toThrow('CRC')
    const metadata = pixelPng([pngChunk('tEXt', new TextEncoder().encode('secret\0private'))])
    await expect(decodePlacementPreviewV2(await installBytes(metadata), 'test-image')).rejects.toThrow('元数据')
    await expect(decodePlacementPreviewV2(await installBytes(pixelPng([], 2, 1)), 'test-image')).rejects.toThrow('尺寸')
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it.each(['bytes', 'side', 'pixels', 'fractional-dimensions'] as const)('rejects the single-image %s budget before reading/decode', async mutation => {
    const project = await imageProject(), resource = record(project), image = ref(project)
    if (mutation === 'bytes') {
      resource.blob = new Blob([new Uint8Array(PROJECT_LIMITS_V2.imageBytes + 1)], { type: 'image/png' }); resource.sizeBytes = resource.blob.size
    }
    if (mutation === 'side') resource.pixelWidth = image.pixelWidth = PROJECT_LIMITS_V2.imageSide + 1
    if (mutation === 'pixels') { resource.pixelWidth = image.pixelWidth = 8000; resource.pixelHeight = image.pixelHeight = 8000 }
    if (mutation === 'fractional-dimensions') resource.pixelWidth = image.pixelWidth = 1.5
    const read = vi.spyOn(resource.blob, 'arrayBuffer')
    await expect(decodePlacementPreviewV2(project, 'test-image')).rejects.toThrow('预算')
    expect(read).not.toHaveBeenCalled(); expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('fails on missing/native decode support and closes dimension mismatches, then allows a healthy call', async () => {
    const project = await imageProject()
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(decodePlacementPreviewV2(project, 'test-image')).rejects.toThrow('实际解码失败')
    const rejected = vi.fn(async () => { throw new Error('native failure') }); vi.stubGlobal('createImageBitmap', rejected)
    await expect(decodePlacementPreviewV2(project, 'test-image')).rejects.toThrow('实际解码失败')
    const wrong = bitmap(2, 1), good = bitmap()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(wrong).mockResolvedValueOnce(good))
    await expect(decodePlacementPreviewV2(project, 'test-image')).rejects.toThrow('解码尺寸')
    expect(wrong.close).toHaveBeenCalledOnce()
    expect(await decodePlacementPreviewV2(project, 'test-image')).toBe(good)
    expect(good.close).not.toHaveBeenCalled(); good.close()
  })

  it('cancels before reading and disposes a bitmap that finishes decoding after cancellation', async () => {
    const project = await imageProject(), before = new AbortController(); before.abort()
    const read = vi.spyOn(record(project).blob, 'arrayBuffer')
    await expect(decodePlacementPreviewV2(project, 'test-image', before.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).not.toHaveBeenCalled(); expect(createImageBitmap).not.toHaveBeenCalled()
    const during = new AbortController(), late = bitmap()
    vi.mocked(createImageBitmap).mockImplementationOnce(async () => { during.abort(); return late })
    await expect(decodePlacementPreviewV2(project, 'test-image', during.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(late.close).toHaveBeenCalledOnce()
  })

  it('shares the native decoder slot with resource validation and skips cancelled queued previews', async () => {
    const project = await imageProject(), controller = new AbortController(), native = bitmap()
    let release!: () => void, queued!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), pendingSlot = new Promise<void>(resolve => { queued = resolve })
    const original = resources.withImageDecoderSlotV2
    // A validation decode occupies the same native slot while the preview verifies/queues.
    vi.mocked(createImageBitmap).mockImplementationOnce(async () => { await gate; return native })
    const validation = resources.validateImageAssetRecord(record(project))
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce())
    vi.spyOn(resources, 'withImageDecoderSlotV2').mockImplementation((signal, action) => { const result = original(signal, action); queued(); return result })
    try {
      const cancelled = decodePlacementPreviewV2(project, 'test-image', controller.signal).catch(error => error)
      await pendingSlot
      expect(createImageBitmap).toHaveBeenCalledOnce()
      controller.abort(); release(); await validation
      expect(await cancelled).toMatchObject({ name: 'AbortError' })
      expect(createImageBitmap).toHaveBeenCalledOnce(); expect(native.close).toHaveBeenCalledOnce()
      const healthy = await decodePlacementPreviewV2(project, 'test-image')
      expect(createImageBitmap).toHaveBeenCalledTimes(2)
      healthy.close()
    } finally { release(); await validation }
  })
})
