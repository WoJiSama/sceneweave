import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropV2 } from '../../core/v2/types'
import * as schema from '../../core/v2/schema'
import { validateSceneSnapshotV2 } from '../../core/v2/snapshots'
import * as resources from '../../io/v2/resources'
import { imageProject } from '../../io/v2/test-fixtures'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { exportPngV2, renderProjectV2 } from './renderer'
import type { RenderMetricsV2 } from './renderer'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture(): Promise<CompleteProjectV2> {
  const project = await imageProject(), scene = project.document
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.notes = {}; scene.regions = {}
  scene.constraints.entranceOpeningIds = []; scene.units.gridVisible = false
  scene.exportBoundsMm = { x: 0, y: 0, width: 4000, height: 4000 }
  scene.floors['f-a1'].boundsMm = { ...scene.exportBoundsMm }
  scene.assets.alias = { ...scene.assets['test-image'], id: 'alias' }
  scene.propDefinitions.pixel = {
    id: 'pixel', catalogId: 'test.pixel', version: 1, licenseRef: 'test-original-cc0',
    origin: { kind: 'original', attribution: 'Sceneweave test fixture', canEmbed: true }, name: 'Pixel', tags: [],
    defaultAppearance: { kind: 'image', assetId: 'test-image', opacity: 1, tint: null },
    defaultVisualBoundsMm: { x: -250, y: -250, width: 500, height: 500 },
    defaultFootprintMm: { width: 500, height: 500 }, defaultFootprintOffsetMm: { x: 0, y: 0 },
    defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none',
  }
  const license = project.licenseBindings[0]
  project.licenseBindings.push(
    { ...license, subjectKind: 'asset', subjectId: 'alias' },
    { ...license, subjectKind: 'propDefinition', subjectId: 'pixel' },
  )
  const prop = (id: string, assetId: string, x: number): PropV2 => ({
    id, floorId: 'f-a1', editLocked: false, definitionRef: { id: 'pixel', version: 1 },
    appearance: { kind: 'image', assetId, opacity: 1, tint: null },
    visualBoundsMm: { x: -250, y: -250, width: 500, height: 500 },
    footprintMm: { width: 500, height: 500 }, footprintOffsetMm: { x: 0, y: 0 },
    positionMm: { x, y: 2000 }, rotationDeg: 0, blocksMovement: false, blocksSight: false,
    visibility: 'public', supportRef: { kind: 'floor', id: 'f-a1' },
    renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null,
  })
  scene.props = { first: prop('first', 'test-image', 1000), second: prop('second', 'alias', 3000) }
  return project
}

/** Simulated primitives test timing/lifecycle contracts; they do not provide rendering or performance evidence. */
function primitives(project: CompleteProjectV2) {
  let elapsed = 0
  const now = vi.fn(() => elapsed), advance = (ms: number) => { elapsed += ms }
  vi.stubGlobal('performance', { now })
  const blob = Object.values(project.assets)[0].blob, arrayBuffer = blob.arrayBuffer.bind(blob)
  vi.spyOn(blob, 'arrayBuffer').mockImplementation(async () => { advance(7); return arrayBuffer() })
  const close = vi.fn(() => advance(5))
  const decode = vi.fn(async () => { advance(13); return { width: 1, height: 1, close } })
  vi.stubGlobal('createImageBitmap', decode)
  const drawImage = vi.fn(() => advance(3)), translate = vi.fn()
  const getContext = vi.fn<() => Partial<CanvasRenderingContext2D>>()
  const output = {
    width: 0, height: 0,
    getContext,
    toBlob: vi.fn((callback: BlobCallback) => { advance(23); callback(new Blob(['encoded PNG'], { type: 'image/png' })) }),
  }
  getContext.mockImplementation(() => ({
    canvas: output as unknown as HTMLCanvasElement, fillStyle: '', globalAlpha: 1,
    fillRect: vi.fn(() => advance(11)), setTransform: vi.fn(), resetTransform: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate, rotate: vi.fn(), drawImage,
  }))
  const createElement = vi.fn(() => output)
  vi.stubGlobal('document', { createElement })
  return { now, advance, close, decode, output, drawImage, translate, createElement }
}

describe('optional v2 renderer metrics', () => {
  it.each(['gm', 'player'] as const)('preserves layer, renderOrder and id compositing order for %s output', async audience => {
    const project = await fixture(), source = project.document.props.first
    project.document.props = Object.fromEntries([
      { id: 'canopy', renderLayer: 'canopy', renderOrder: -1, x: 700 },
      { id: 'object-z', renderLayer: 'object', renderOrder: 5, x: 600 },
      { id: 'ground-z', renderLayer: 'ground', renderOrder: 0, x: 200 },
      { id: 'object-early', renderLayer: 'object', renderOrder: -5, x: 400 },
      { id: 'object-a', renderLayer: 'object', renderOrder: 5, x: 500 },
      { id: 'ground-a', renderLayer: 'ground', renderOrder: 0, x: 100 },
    ].map(item => [item.id, { ...structuredClone(source), id: item.id, appearance: { ...source.appearance, assetId: item.id === 'canopy' ? 'alias' : 'test-image' }, renderLayer: item.renderLayer as PropV2['renderLayer'], renderOrder: item.renderOrder, positionMm: { x: item.x + 1000, y: 2000 } }]))
    const before = structuredClone(project.document), browser = primitives(project)
    await renderProjectV2(project, { audience, longEdgePx: 256 })
    expect(browser.translate.mock.calls).toEqual([100, 200, 400, 500, 600, 700].map(x => [x + 1000, 2000]))
    expect(project.document).toEqual(before)
    browser.translate.mockClear()
    project.document.props['object-z'].renderOrder = -10
    await renderProjectV2(project, { audience, longEdgePx: 256 })
    expect(browser.translate.mock.calls).toEqual([100, 200, 600, 400, 500, 700].map(x => [x + 1000, 2000]))
  })

  it('reuses only a certified immutable document while rechecking resources on every render', async () => {
    const project = await fixture(), validate = vi.spyOn(schema, 'validateSceneV2'), certified = validateSceneSnapshotV2(project.document)
    expect(certified.ok).toBe(true)
    if (!certified.ok) throw new Error('fixture validation failed')
    project.document = certified.document
    const browser = primitives(project)
    await renderProjectV2(project, { audience: 'gm', longEdgePx: 256 })
    await renderProjectV2(project, { audience: 'player', longEdgePx: 256 })
    expect(validate).toHaveBeenCalledOnce(); expect(browser.decode).toHaveBeenCalledTimes(2)
    const resource = Object.values(project.assets)[0], damaged = new Uint8Array(await resource.blob.arrayBuffer()); damaged[20] ^= 1
    resource.blob = new Blob([damaged.buffer], { type: 'image/png' })
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256 })).rejects.toThrow('CRC')
    expect(validate).toHaveBeenCalledOnce(); expect(browser.decode).toHaveBeenCalledTimes(2)
  })

  it('validates every external document including shallow-frozen lookalikes and detects later mutations', async () => {
    const project = await fixture(), validate = vi.spyOn(schema, 'validateSceneV2'), browser = primitives(project)
    Object.freeze(project.document)
    await renderProjectV2(project, { audience: 'gm', longEdgePx: 256 })
    await renderProjectV2(project, { audience: 'player', longEdgePx: 256 })
    expect(validate).toHaveBeenCalledTimes(2)
    project.document.props.first.rotationDeg = Number.NaN
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256 })).rejects.toThrow('场景不能绘制')
    expect(validate).toHaveBeenCalledTimes(3); expect(browser.decode).toHaveBeenCalledTimes(2)
  })

  it('separates verification, decode and synchronous drawing, and reports SHA-deduplicated pixels after cleanup', async () => {
    const project = await fixture(), before = structuredClone(project), browser = primitives(project)
    const samples: { metrics: RenderMetricsV2; closeCalls: number }[] = []
    const onMetrics = vi.fn((metrics: RenderMetricsV2) => { samples.push({ metrics, closeCalls: browser.close.mock.calls.length }) })
    const output = await renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })
    expect(samples).toEqual([{ closeCalls: 1, metrics: {
      validationProjectionMs: 0, resourceVerificationMs: 7, decoderQueueWaitMs: 0, imageDecodeMs: 13,
      drawSubmissionMs: 17, totalMs: 42, decodedImages: 1, decodedPixels: 1,
      width: 256, height: 256, audience: 'gm',
    } }])
    expect(onMetrics).toHaveBeenCalledOnce(); expect(browser.decode).toHaveBeenCalledOnce()
    expect(browser.drawImage).toHaveBeenCalledTimes(2); expect(output).toBe(browser.output)
    expect(output.width).toBe(256); expect(output.height).toBe(256)
    // Blob method instrumentation is local to the test; persisted document and bytes remain unchanged.
    expect(project.document).toEqual(before.document)
    expect(new Uint8Array(await Object.values(project.assets)[0].blob.arrayBuffer())).toEqual(new Uint8Array(await Object.values(before.assets)[0].blob.arrayBuffer()))
  })

  it('ignores observer failures, leaves successful output usable, and does not sample when disabled', async () => {
    const project = await fixture(), browser = primitives(project), onMetrics = vi.fn(() => { throw new Error('observer failed') })
    const output = await renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })
    expect(onMetrics).toHaveBeenCalledOnce(); expect(browser.close).toHaveBeenCalledOnce()
    expect(output.width).toBe(256); expect(output.height).toBe(256)
    browser.now.mockClear()
    await renderProjectV2(project, { audience: 'player', longEdgePx: 256 })
    expect(browser.now).not.toHaveBeenCalled()
  })

  it('reports the render phase once for PNG, excluding encoding, and disposes the encoded canvas', async () => {
    const project = await fixture(), browser = primitives(project), samples: RenderMetricsV2[] = []
    const blob = await exportPngV2(project, { audience: 'player', longEdgePx: 256, onMetrics: metrics => samples.push(metrics) })
    expect(blob.type).toBe('image/png'); expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({ totalMs: 42, audience: 'player' })
    expect(browser.now()).toBe(65)
    expect(browser.output.width).toBe(0); expect(browser.output.height).toBe(0)
  })

  it('keeps strict validation and byte verification before decode without reporting failed renders', async () => {
    const project = await fixture(), browser = primitives(project), onMetrics = vi.fn()
    project.document.schemaVersion = 1 as never
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })).rejects.toThrow('场景不能绘制')
    expect(browser.decode).not.toHaveBeenCalled(); expect(onMetrics).not.toHaveBeenCalled()
    project.document.schemaVersion = 2
    const record = Object.values(project.assets)[0], damaged = new Uint8Array(await record.blob.arrayBuffer()); damaged[20] ^= 1
    record.blob = new Blob([damaged.buffer], { type: 'image/png' })
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })).rejects.toThrow('CRC')
    expect(browser.decode).not.toHaveBeenCalled(); expect(browser.createElement).not.toHaveBeenCalled(); expect(onMetrics).not.toHaveBeenCalled()
  })

  it('closes a bitmap decoded after cancellation and emits no successful sample', async () => {
    const project = await fixture(), browser = primitives(project), onMetrics = vi.fn(), controller = new AbortController()
    browser.decode.mockImplementation(async () => { controller.abort(); return { width: 1, height: 1, close: browser.close } })
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, signal: controller.signal, onMetrics })).rejects.toMatchObject({ name: 'AbortError' })
    expect(browser.close).toHaveBeenCalledOnce(); expect(browser.createElement).not.toHaveBeenCalled(); expect(onMetrics).not.toHaveBeenCalled()
  })

  it('disposes output and bitmaps on a drawing failure without emitting a successful sample', async () => {
    const project = await fixture(), browser = primitives(project), onMetrics = vi.fn()
    browser.drawImage.mockImplementation(() => { throw new Error('draw failed') })
    await expect(renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics })).rejects.toThrow('draw failed')
    expect(browser.close).toHaveBeenCalledOnce(); expect(browser.output.width).toBe(0); expect(browser.output.height).toBe(0)
    expect(onMetrics).not.toHaveBeenCalled()
  })

  it('separates decoder queue waiting from native decode time', async () => {
    const project = await fixture(), browser = primitives(project), samples: RenderMetricsV2[] = []
    let release!: () => void, requested!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), queued = new Promise<void>(resolve => { requested = resolve })
    const original = resources.withImageDecoderSlotV2, blocker = original(undefined, () => gate)
    vi.spyOn(resources, 'withImageDecoderSlotV2').mockImplementation((signal, action) => {
      const result = original(signal, action); requested(); return result
    })
    try {
      const rendering = renderProjectV2(project, { audience: 'gm', longEdgePx: 256, onMetrics: metrics => samples.push(metrics) })
      await queued
      expect(browser.decode).not.toHaveBeenCalled()
      browser.advance(37); release(); await blocker; await rendering
      expect(samples).toHaveLength(1)
      expect(samples[0]).toMatchObject({ decoderQueueWaitMs: 37, imageDecodeMs: 13, totalMs: 79 })
      expect(browser.close).toHaveBeenCalledOnce()
    } finally { release(); await blocker }
  })

  it('preserves queued cancellation, skips native decode and observers, and releases its queue position', async () => {
    const project = await fixture(), browser = primitives(project), controller = new AbortController(), onMetrics = vi.fn()
    let release!: () => void, requested!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), queued = new Promise<void>(resolve => { requested = resolve })
    const original = resources.withImageDecoderSlotV2, blocker = original(undefined, () => gate)
    vi.spyOn(resources, 'withImageDecoderSlotV2').mockImplementation((signal, action) => {
      const result = original(signal, action); requested(); return result
    })
    try {
      const rendering = renderProjectV2(project, { audience: 'gm', longEdgePx: 256, signal: controller.signal, onMetrics })
      const outcome = rendering.catch(error => error)
      await queued; controller.abort(); release(); await blocker
      expect(await outcome).toMatchObject({ name: 'AbortError' })
      expect(browser.decode).not.toHaveBeenCalled(); expect(browser.createElement).not.toHaveBeenCalled(); expect(onMetrics).not.toHaveBeenCalled()
      await renderProjectV2(project, { audience: 'player', longEdgePx: 256, onMetrics })
      expect(browser.decode).toHaveBeenCalledOnce(); expect(browser.close).toHaveBeenCalledOnce(); expect(onMetrics).toHaveBeenCalledOnce()
    } finally { release(); await blocker }
  })
})
