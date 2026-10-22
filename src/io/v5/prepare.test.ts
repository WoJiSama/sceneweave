import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { materializeProjectV5, prepareAssetImportV5, prepareCompositionCommandsV5 } from './prepare'
import { emptyProject, pixelPng } from './test-fixtures'
import type { AssetImportRequestV5 } from './types'

const request = (): AssetImportRequestV5 => ({ file: new Blob([pixelPng().slice().buffer], { type: 'image/png' }), kind: 'prop', name: 'Original pixel', widthMm: 1000, heightMm: 1000,
  footprintWidthMm: 500, footprintHeightMm: 500, licenseText: 'CC0-1.0. Original test artwork.', attribution: 'Sceneweave tests', canEmbed: true })
beforeEach(() => vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('complete composition preparation boundary', () => {
  it('captures commands and source before waiting, preserves physical fields and leaves revision for adoption', async () => {
    const source = emptyProject(), before = structuredClone(source), id = Object.keys(source.document.props)[0]
    const command = { type: 'setAppearanceAdjustment' as const, scope: { kind: 'targets' as const, ids: [id] }, adjustment: { id: 'opacity', kind: 'opacity' as const, value: .5, enabled: true } }
    const pending = prepareCompositionCommandsV5(source, [command])
    command.adjustment.value = .75; source.document.title = 'caller mutation'
    const prepared = await pending
    expect(prepared.document.title).toBe(before.document.title); expect(prepared.document.revision).toBe(before.document.revision)
    expect(prepared.document.props[id]).toEqual({ ...before.document.props[id], appearance: { ...before.document.props[id].appearance, opacity: .5 } })
    expect(prepared.appearance.sources).toEqual(before.appearance.sources)
    expect(prepared.appearance.variants).toEqual({}); expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('requires complete valid graph references before allocation or bitmap work', async () => {
    const source = emptyProject(), before = structuredClone(source), id = Object.keys(source.document.props)[0]
    source.appearance.propSources[id] = 'missing-fixed-source'
    await expect(materializeProjectV5(source)).rejects.toThrow('引用悬空')
    expect(source.document).toEqual(before.document); expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('rejects missing explicit dimensions, footprint, licenses, embed declaration and unknown fields before decode', async () => {
    const source = emptyProject(), cases = [
      { ...request(), widthMm: 0 }, { ...request(), heightMm: 1.5 }, { ...request(), footprintWidthMm: undefined },
      { ...request(), licenseText: '' }, { ...request(), attribution: '' }, { ...request(), canEmbed: false }, { ...request(), secretPrompt: 'not a supported field' },
    ]
    for (const input of cases) await expect(prepareAssetImportV5(source, input as AssetImportRequestV5)).rejects.toThrow()
    expect(createImageBitmap).not.toHaveBeenCalled(); expect(source.assets).toEqual({})
  })

  it('bounds and inspects actual image bytes before invoking native decode', async () => {
    const source = emptyProject()
    for (const file of [new Blob(['<svg/>'], { type: 'image/svg+xml' }), new Blob([pixelPng().slice().buffer], { type: 'image/jpeg' }), new Blob([pixelPng([], 8193).slice().buffer], { type: 'image/png' })]) {
      await expect(prepareAssetImportV5(source, { ...request(), file })).rejects.toThrow()
    }
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('keeps cancellation distinct and does not mutate the source or enter image decoding', async () => {
    const source = emptyProject(), before = structuredClone(source), controller = new AbortController(); controller.abort()
    await expect(prepareAssetImportV5(source, request(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(materializeProjectV5(source, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(prepareCompositionCommandsV5(source, [], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(source).toEqual(before); expect(createImageBitmap).not.toHaveBeenCalled()
  })
})
