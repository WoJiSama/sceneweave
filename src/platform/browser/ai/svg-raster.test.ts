import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CANONICAL_SVG_PROCESSOR, normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { REFINED_INTERIOR_ART } from '../../../shared/visual/interior-art.js'
import { REFINED_COAST_ART } from '../../../shared/visual/coast-art.js'
import { REFINED_ISLAND_ART } from '../../../shared/visual/island-art.js'
import { initializeCanonicalSvgRasterizer, rasterizeNormalizedSvg } from './svg-raster.js'
import { createBrowserSvgPort } from './svg-port.js'
import { svgProjectFixture } from '../../../../tests/helpers/m24-svg-fixtures.js'
import { bitmapVariant, resolveAppearance } from '../../../shared/appearance/graph.js'
import { createMemoryResources, deriveBitmapVariant, bitmapVariantPixelPipeline, validateProjectBundle } from '../../../shared/project/resources.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { transformRgba } from '../../../shared/project/pixels.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { SVG_PROCESSOR2_GOLDENS } from '../../../../tests/helpers/svg-processor2-goldens.js'

const moduleBytes = new Uint8Array(readFileSync(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm')))
beforeAll(async () => { await initializeCanonicalSvgRasterizer(moduleBytes) })

describe('fixed software SVG processor 2', () => {
  it('checks actual module bytes even after initialization', () => {
    const changed = moduleBytes.slice(); changed[64] ^= 1
    expect(() => initializeCanonicalSvgRasterizer(changed)).toThrow(/SHA256/)
    expect(() => initializeCanonicalSvgRasterizer(changed.subarray(1))).toThrow(/长度/)
  })

  it.each([
    REFINED_INTERIOR_ART.find(art => art.key === 'interior-armchair')!,
    REFINED_COAST_ART.find(art => art.key === 'coast-driftwood')!,
    REFINED_ISLAND_ART.find(art => art.key === 'island-debris-driftwood')!,
  ])('renders the actual failed $key input without browser pixels and preserves its source', async art => {
    const native = vi.fn(() => { throw new Error('Native rasterization must not execute') })
    for (const name of ['Image', 'OffscreenCanvas', 'createImageBitmap', 'document']) vi.stubGlobal(name, native)
    try {
      const normalized = normalizeStaticSvg(art.sourceSvg), captured = structuredClone(normalized)
      const first = await rasterizeNormalizedSvg(normalized, { longEdgePx: 512 })
      const second = await rasterizeNormalizedSvg(normalized, { longEdgePx: 512 })
      expect(first).toMatchObject({ ...CANONICAL_SVG_PROCESSOR, pixelWidth: 512, pixelHeight: 512 })
      expect(first.pngBytes).toEqual(second.pngBytes)
      expect(first.sha256).toBe(second.sha256)
      expect(normalized).toEqual(captured)
      expect([first.pngBytes[24], first.pngBytes[25], first.pngBytes[28]]).toEqual([8, 6, 0])
      const decoded = decodeCanonicalPng(first.pngBytes)
      const golden = SVG_PROCESSOR2_GOLDENS.find(item => item.key === art.key)!
      expect(normalized.normalizedSha256).toBe(golden.normalizedSha256)
      expect(sha256Bytes(Uint8Array.from(decoded.rgba))).toBe(golden.rgbaSha256)
      expect(decoded.rgba.some((channel, i) => i % 4 === 3 && channel > 0 && channel < 255)).toBe(true)
      expect(decodeCanonicalPng(encodeCanonicalPng(decoded))).toEqual(decoded)
      expect(native).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('uses known straight-alpha color values and explicit aspect ratio', async () => {
    const source = normalizeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><rect x="0" y="0" width="64" height="32" fill="#804020" opacity="0.5"/></svg>')
    const output = await rasterizeNormalizedSvg(source, { longEdgePx: 32 })
    expect([output.pixelWidth, output.pixelHeight]).toEqual([32, 16])
    expect([...decodeCanonicalPng(output.pngBytes).rgba.subarray(0, 4)]).toEqual([128, 64, 32, 128])
  })

  it('validates one unchanged curved/transparent asset and its tinted derivative with different native readbacks', async () => {
    const art = REFINED_INTERIOR_ART.find(item => item.key === 'interior-armchair')!
    const output = await rasterizeNormalizedSvg(normalizeStaticSvg(art.sourceSvg), { longEdgePx: 512 })
    const fixture = svgProjectFixture(art.sourceSvg), { bundle, bytes } = fixture, project = bundle.project
    const oldHash = project.document.assets.image.sha256
    bytes.delete(oldHash); delete project.assets[oldHash]
    project.document.assets.image = { ...project.document.assets.image, sha256: output.sha256, pixelWidth: 512, pixelHeight: 512 }
    const record = { sha256: output.sha256, mimeType: 'image/png' as const, sizeBytes: output.pngBytes.length, pixelWidth: 512, pixelHeight: 512 }
    project.assets[output.sha256] = record; project.authoringSources.image.rasterSha256 = output.sha256
    bytes.set(output.sha256, output.pngBytes)
    const nativeTransform = vi.fn(async () => { throw new Error('Canonical descendants must not use native pixels') })
    const validation = (readbackDrift: boolean): CompleteValidationOptions => ({ svg: createBrowserSvgPort(), images: {
      async decode(data) { const image = decodeCanonicalPng(data); if (readbackDrift) image.rgba[0] ^= 1; return image },
      transform: nativeTransform, encodePng: nativeTransform,
    } })
    const variant = bitmapVariant('image', '#A0C0E0', 1.4)!
    const derived = await deriveBitmapVariant(output.pngBytes, record, { tint: variant.tint, brightness: variant.brightness }, validation(false), bitmapVariantPixelPipeline(project, 'image'))
    const originalPixels = decodeCanonicalPng(output.pngBytes)
    expect(decodeCanonicalPng(derived.bytes).rgba).toEqual(transformRgba(originalPixels.rgba, variant.tint, variant.brightness))
    project.appearance.variants[variant.id] = variant
    project.document.assets[variant.outputAssetId] = { ...project.document.assets.image, id: variant.outputAssetId, sha256: derived.record.sha256 }
    project.assets[derived.record.sha256] = derived.record; bytes.set(derived.record.sha256, derived.bytes)
    project.licenseBindings.push({ ...project.licenseBindings.find(binding => binding.subjectKind === 'asset' && binding.subjectId === 'image')!, subjectId: variant.outputAssetId })
    project.appearance.instanceAdjustments.item = [{ id: 'tint', enabled: true, kind: 'tint', value: '#A0C0E0' }, { id: 'brightness', enabled: true, kind: 'brightness', value: 1.4 }]
    Object.assign(project, resolveAppearance(project))
    const licensePath = project.licenseBindings[0].licensePath
    project.licenseBindings = inspectDependencies(project.document).subjects.map(subject => ({ ...subject, licensePath, embedding: 'allowed' }))
    bundle.resources = createMemoryResources(bytes)
    const archive = await exportProject(bundle, validation(false))
    expect((await importProject(archive, validation(true))).project).toEqual(project)
    expect(nativeTransform).not.toHaveBeenCalled()
    // A wrong but valid PNG with recomputed byte/hash declarations still fails.
    const wrongPixels = decodeCanonicalPng(derived.bytes); wrongPixels.rgba[0] ^= 1
    const wrong = encodeCanonicalPng(wrongPixels), hash = sha256Bytes(wrong)
    bytes.delete(derived.record.sha256); bytes.set(hash, wrong); delete project.assets[derived.record.sha256]
    project.assets[hash] = { ...derived.record, sha256: hash, sizeBytes: wrong.length }
    project.document.assets[variant.outputAssetId].sha256 = hash
    bundle.resources = createMemoryResources(bytes)
    await expect(validateProjectBundle(bundle, validation(false))).rejects.toThrow(/固定派生真实像素/)
  })

  it('rejects forged normalized records, oversized pixels and cancellation', async () => {
    const source = normalizeStaticSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>')
    await expect(rasterizeNormalizedSvg({ ...source, normalizedSource: '<svg><script/></svg>' }, { longEdgePx: 16 })).rejects.toThrow()
    await expect(rasterizeNormalizedSvg(source, { longEdgePx: 8192 })).rejects.toThrow(/保护预算/)
    await expect(rasterizeNormalizedSvg(source, { longEdgePx: 16, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
