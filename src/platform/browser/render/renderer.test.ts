import { afterEach, describe, expect, it, vi } from 'vitest'
import { zlibSync } from 'fflate'
import { layerSceneV3 } from '../../../core/v3/test-fixtures'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/geometry/dependencies.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { crc32, sha256Bytes } from '../../../shared/project/binary.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { exportPng, renderEditorProject, renderProject } from './renderer'
import { encodePng, PNG_MAX_ENCODED_BYTES } from './canvas-renderer'
import { inspectImageBytes, normalizePngChunks } from '../../../shared/project/image-bytes.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function pixelPng(width = 1, height = 1, metadata?: string): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
    view.setUint32(0, data.length); bytes.set(encodeUtf8(type), 4); bytes.set(data, 8)
    view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8))); return bytes
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
  const scanlines = width === 1 && height === 1 ? new Uint8Array([0, 200, 100, 50, 255]) : new Uint8Array((width * 4 + 1) * height)
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...(metadata ? [chunk('eXIf', encodeUtf8(metadata))] : []), chunk('IDAT', zlibSync(scanlines)), chunk('IEND', new Uint8Array())]
  const output = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0))
  let offset = 0; for (const bytes of chunks) { output.set(bytes, offset); offset += bytes.length }; return output
}

function fixture(): ProjectBundle {
  const document: SceneDocument = { ...structuredClone(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 }
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  document.units.gridVisible = false
  const bytes = pixelPng(), hash = sha256Bytes(bytes), origin = { kind: 'original' as const, attribution: 'Native renderer unit fixture', canEmbed: true }
  document.assets.pixel = { id: 'pixel', sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'unit-license', origin }
  document.props.item.appearance = { kind: 'image', assetId: 'pixel', tint: null, opacity: 1 }
  const prop = document.props.item
  document.propDefinitions.pixelDefinition = { id: 'pixelDefinition', catalogId: 'test.native-render', version: 1, licenseRef: 'unit-license', origin,
    name: 'Native pixel', tags: [], defaultAppearance: prop.appearance, defaultVisualBoundsMm: prop.visualBoundsMm,
    defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false,
    defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  prop.definitionRef = { id: 'pixelDefinition', version: 1 }
  let next = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `render-token-${++next}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } })
  const text = 'Native renderer unit license', licenseHash = sha256Bytes(encodeUtf8(text))
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 } },
    licenses: { [licenseHash]: { sha256: licenseHash, text } },
    licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, embedding: 'allowed', licensePath: `licenses/${licenseHash}.txt` })), authoringSources: {} },
    resources: createMemoryResources(new Map([[hash, bytes]])) }
}

/** Ownership/order checks using Node primitives; real Canvas pixels are exercised in Chrome. */
function primitives() {
  const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = []
  const decode = vi.fn(async () => { const bitmap = { width: 1, height: 1, close: vi.fn() }; bitmaps.push(bitmap); return bitmap })
  vi.stubGlobal('createImageBitmap', decode)
  const canvases: { width: number; height: number; context: Record<string, unknown>; toBlob: ReturnType<typeof vi.fn> }[] = []
  const contextCalls: { width: number; height: number; options: CanvasRenderingContext2DSettings | undefined }[] = []
  const createElement = vi.fn(() => {
    const output = { width: 0, height: 0, context: {} as Record<string, unknown>, getContext: (_kind: string, options?: CanvasRenderingContext2DSettings) => { contextCalls.push({ width: output.width, height: output.height, options }); return output.context },
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob([pixelPng(output.width, output.height).slice().buffer], { type: 'image/png' }))) }
    const context = output.context
    Object.assign(context, { canvas: output, getImageData: () => ({ data: new Uint8ClampedArray([200, 100, 50, 255]) }),
      drawImage: vi.fn(), createImageData: () => ({ data: new Uint8ClampedArray(4) }) })
    for (const key of ['fillRect', 'strokeRect', 'setTransform', 'resetTransform', 'save', 'restore', 'translate', 'rotate', 'putImageData']) context[key] = vi.fn()
    canvases.push(output); return output
  })
  vi.stubGlobal('document', { createElement })
  return { decode, bitmaps, canvases, createElement, contextCalls }
}

describe('native complete-v1 browser rendering boundary (Node primitives)', () => {
  it('rejects old formats, extra fields and accessors before browser IO', async () => {
    const input = fixture(), browser = primitives(), read = vi.fn(input.resources.read)
    input.resources = { read }
    await expect(renderProject({ ...input, project: { ...input.project, format: 'sceneweave-project' } } as never, { audience: 'gm', longEdgePx: 256 })).rejects.toThrow()
    let getterCalls = 0
    Object.defineProperty(input.project, 'assets', { enumerable: true, get() { getterCalls++; throw new Error('getter') } })
    await expect(renderProject(input, { audience: 'gm', longEdgePx: 256 })).rejects.toThrow()
    expect(getterCalls).toBe(0); expect(read).not.toHaveBeenCalled(); expect(browser.createElement).not.toHaveBeenCalled()
  })

  it('verifies the entire native bundle before hidden-layer/crop/LOD filtering', async () => {
    const input = fixture(), browser = primitives(), layer = input.project.document.entityLayers.item
    input.resources = { read: vi.fn(async () => { throw new Error('missing original bytes') }) }
    await expect(renderEditorProject(input, { audience: 'gm', longEdgePx: 256, hiddenLayerIds: new Set([layer]), viewBoundsMm: { x: 15000, y: 15000, width: 1000, height: 1000 } })).rejects.toThrow('missing original bytes')
    expect(browser.createElement).not.toHaveBeenCalled(); expect(browser.decode).not.toHaveBeenCalled()
  })

  it('checks actual bytes even when a caller supplies a self-consistent modified metadata wrapper', async () => {
    const input = fixture(), browser = primitives(), source = input.resources
    input.resources = { async read(hash) { const bytes = await source.read(hash); bytes[bytes.length - 1] ^= 1; return bytes } }
    await expect(renderProject(input, { audience: 'player', longEdgePx: 256 })).rejects.toThrow(/SHA256/)
    expect(browser.createElement).not.toHaveBeenCalled()
  })

  it('owns both full-validation and draw bitmaps, reports metrics and releases them after a successful render', async () => {
    const input = fixture(), browser = primitives(), metrics = vi.fn()
    const output = await renderProject(input, { audience: 'gm', longEdgePx: 256, onMetrics: metrics })
    expect(output.width).toBe(256); expect(output.height).toBe(256)
    expect(browser.decode).toHaveBeenCalledTimes(2)
    expect(browser.bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true)
    expect(browser.canvases[0]).toMatchObject({ width: 0, height: 0 })
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ audience: 'gm', width: 256, height: 256, decodedImages: 1, decodedPixels: 1 }))
  })

  it('uses GM-only layer hiding while keeping formal and player output on their audience projection', async () => {
    const input = fixture(), browser = primitives(), layer = input.project.document.entityLayers.item
    await renderEditorProject(input, { audience: 'gm', longEdgePx: 256, hiddenLayerIds: new Set([layer]) })
    expect(browser.canvases.at(-1)!.context.drawImage).not.toHaveBeenCalled()
    await renderEditorProject(input, { audience: 'player', longEdgePx: 256, hiddenLayerIds: new Set([layer]), screenScalePxPerMm: .4 })
    expect(browser.canvases.at(-1)!.context.drawImage).toHaveBeenCalledTimes(1)
    await renderProject(input, { audience: 'gm', longEdgePx: 256, hiddenLayerIds: new Set([layer]) } as never)
    expect(browser.canvases.at(-1)!.context.drawImage).toHaveBeenCalledTimes(1)
  })

  it('does not allocate for invalid preview/export sizes and releases encoded PNG output', async () => {
    const input = fixture(), browser = primitives()
    for (const longEdgePx of [0, 255, 4097, 256.5]) await expect(renderProject(input, { audience: 'gm', longEdgePx })).rejects.toThrow(/256/)
    await expect(renderEditorProject(input, { audience: 'gm', longEdgePx: 2049 })).rejects.toThrow(/2048/)
    expect(browser.createElement).not.toHaveBeenCalled()
    expect((await exportPng(input, { audience: 'player', longEdgePx: 256 })).type).toBe('image/png')
    expect(browser.canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
  })

  it('stops on real decoder failure and closes a bitmap cancelled immediately after decode', async () => {
    const input = fixture(), browser = primitives(), abort = new AbortController()
    browser.decode.mockRejectedValueOnce(new Error('decode failed'))
    await expect(renderProject(input, { audience: 'gm', longEdgePx: 256 })).rejects.toThrow(/解码失败/)
    browser.decode.mockImplementationOnce(async () => { const bitmap = { width: 1, height: 1, close: vi.fn() }; browser.bitmaps.push(bitmap); abort.abort(); return bitmap })
    await expect(renderProject(input, { audience: 'gm', longEdgePx: 256, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(browser.bitmaps.at(-1)!.close).toHaveBeenCalledTimes(1)
  })

  it('removes Canvas-added EXIF at the formal PNG boundary and rejects corrupt/mismatched encodings while releasing the surface', async () => {
    const encoded = pixelPng(2, 1, 'private-file-metadata')
    const surface = (bytes: Uint8Array) => ({ width: 2, height: 1, toBlob: (callback: BlobCallback) => callback(new Blob([bytes.slice().buffer], { type: 'image/png' })) }) as HTMLCanvasElement
    const output = surface(encoded), actual = new Uint8Array(await (await encodePng(output)).arrayBuffer())
    expect(inspectImageBytes(actual)).toEqual({ mimeType: 'image/png', width: 2, height: 1 })
    expect(actual).toEqual(normalizePngChunks(encoded))
    expect(new TextDecoder().decode(actual)).not.toContain('private-file-metadata')
    expect(output.width).toBe(0); expect(output.height).toBe(0)
    expect(PNG_MAX_ENCODED_BYTES).toBeGreaterThan(4096 * (4096 * 4 + 1))
    const mismatch = surface(pixelPng(1, 1))
    await expect(encodePng(mismatch)).rejects.toThrow('尺寸')
    expect(mismatch.width).toBe(0); expect(mismatch.height).toBe(0)
    const corrupt = encoded.slice(); corrupt[corrupt.length - 1] ^= 1
    const broken = surface(corrupt)
    await expect(encodePng(broken)).rejects.toThrow('CRC')
    expect(broken.width).toBe(0); expect(broken.height).toBe(0)
  })

  it('requests a consistent Canvas readback path only for formal 4K surfaces, keeping editor previews unchanged', async () => {
    const input = fixture(), browser = primitives()
    const preview = await renderEditorProject(input, { audience: 'player', longEdgePx: 2048 })
    expect(browser.contextCalls.find(call => call.width === 2048)?.options).toEqual({ colorSpace: 'srgb' })
    preview.width = preview.height = 0
    const output = await renderProject(input, { audience: 'player', longEdgePx: 4096 })
    expect(browser.contextCalls.find(call => call.width === 4096)?.options).toEqual({ colorSpace: 'srgb', willReadFrequently: true })
    output.width = output.height = 0
    expect(browser.bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true)
  })
})
