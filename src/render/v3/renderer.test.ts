import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateSceneSnapshotV3 } from '../../core/v3/snapshots'
import { migrateSceneV2 } from '../../core/v3/migration'
import * as schema from '../../core/v3/schema'
import type { PropV2 } from '../../core/v3/types'
import { imageProject } from '../../io/v2/test-fixtures'
import type { CompleteProjectV3 } from '../../io/v3/types'
import { renderProjectV2 } from '../v2/renderer'
import { exportPngV3, renderEditorProjectV3, renderProjectV3 } from './renderer'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture(): Promise<CompleteProjectV3> {
  const project = await imageProject(), scene = project.document
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.props = {}; scene.notes = {}; scene.regions = {}
  scene.constraints.entranceOpeningIds = []; scene.units.gridVisible = false
  scene.exportBoundsMm = { x: 0, y: 0, width: 4000, height: 4000 }; scene.floors['f-a1'].boundsMm = { ...scene.exportBoundsMm }
  scene.propDefinitions.pixel = { id: 'pixel', catalogId: 'test.pixel', version: 1, licenseRef: 'test-original-cc0', origin: { kind: 'original', attribution: 'Original pixel', canEmbed: true }, name: 'Pixel', tags: [],
    defaultAppearance: { kind: 'image', assetId: 'test-image', opacity: 1, tint: null }, defaultVisualBoundsMm: { x: -50, y: -50, width: 100, height: 100 }, defaultFootprintMm: { width: 100, height: 100 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  const prop: PropV2 = { id: 'image-prop', floorId: 'f-a1', editLocked: false, definitionRef: { id: 'pixel', version: 1 }, appearance: { kind: 'image', assetId: 'test-image', opacity: 1, tint: null },
    visualBoundsMm: { x: -50, y: -50, width: 100, height: 100 }, footprintMm: { width: 100, height: 100 }, footprintOffsetMm: { x: 0, y: 0 }, positionMm: { x: 3000, y: 3000 }, rotationDeg: 0, blocksMovement: false, blocksSight: false,
    visibility: 'public', supportRef: { kind: 'floor', id: 'f-a1' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
  scene.props[prop.id] = prop
  return { assets: project.assets, licenses: project.licenses, licenseBindings: project.licenseBindings, document: migrateSceneV2(scene, { sceneId: 'renderer-v3', now: '2026-10-21T00:00:00.000Z' }) }
}

/** Primitive ownership assertions only; actual browser pixels are covered by c1c-renderer.spec.ts. */
function primitives() {
  const close = vi.fn(), decode = vi.fn(async () => ({ width: 1, height: 1, close })), translate = vi.fn(), drawImage = vi.fn()
  vi.stubGlobal('createImageBitmap', decode)
  const output = { width: 0, height: 0, getContext: vi.fn(), toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['PNG'], { type: 'image/png' }))) }
  output.getContext.mockImplementation(() => ({ canvas: output, fillRect: vi.fn(), strokeRect: vi.fn(), setTransform: vi.fn(), resetTransform: vi.fn(), save: vi.fn(), restore: vi.fn(), translate, rotate: vi.fn(), drawImage }))
  const createElement = vi.fn(() => output); vi.stubGlobal('document', { createElement })
  return { close, decode, output, translate, drawImage, createElement }
}

describe('strict v3 renderer resource and audience boundary', () => {
  it('keeps v2/v3 entrypoints strict and emits no successful sample on a version mismatch', async () => {
    const project = await fixture(), browser = primitives(), onMetrics = vi.fn()
    await expect(renderProjectV2(project as never, { audience: 'gm', longEdgePx: 256 })).rejects.toThrow('场景不能绘制')
    await expect(renderProjectV3({ ...project, document: { ...project.document, schemaVersion: 2 } as never }, { audience: 'gm', longEdgePx: 256, onMetrics })).rejects.toThrow('场景不能绘制')
    expect(browser.decode).not.toHaveBeenCalled(); expect(browser.createElement).not.toHaveBeenCalled(); expect(onMetrics).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'offscreen', 'tiny'] as const)('still requires %s projected image bytes before any successful canvas', async mode => {
    const project = await fixture(), browser = primitives(), hidden = new Set(Object.keys(project.document.userLayers))
    delete project.assets[project.document.assets['test-image'].sha256]
    await expect(renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 256,
      ...(mode === 'hidden' ? { hiddenLayerIds: hidden } : mode === 'offscreen' ? { viewBoundsMm: { x: 0, y: 0, width: 500, height: 500 } } : { screenScalePxPerMm: .01 }),
    })).rejects.toThrow('缺失')
    expect(browser.decode).not.toHaveBeenCalled(); expect(browser.createElement).not.toHaveBeenCalled()
  })

  it('reuses only its own strict immutable v3 snapshot while verifying CRC/hash and decoding each render', async () => {
    const project = await fixture(), validate = vi.spyOn(schema, 'validateSceneV3'), checked = validateSceneSnapshotV3(project.document)
    if (!checked.ok) throw new Error('fixture invalid')
    project.document = checked.document
    const browser = primitives()
    await renderProjectV3(project, { audience: 'gm', longEdgePx: 256 }); await renderProjectV3(project, { audience: 'player', longEdgePx: 256 })
    expect(validate).toHaveBeenCalledOnce(); expect(browser.decode).toHaveBeenCalledTimes(2); expect(browser.close).toHaveBeenCalledTimes(2)
    const record = Object.values(project.assets)[0], bytes = new Uint8Array(await record.blob.arrayBuffer()); bytes[20] ^= 1; record.blob = new Blob([bytes.buffer], { type: 'image/png' })
    await expect(renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 256, hiddenLayerIds: new Set(Object.keys(project.document.userLayers)) })).rejects.toThrow('CRC')
    expect(browser.decode).toHaveBeenCalledTimes(2); expect(validate).toHaveBeenCalledOnce()
  })

  it('uses hidden layers only for GM editing; player editing and both formal PNG audiences render their content', async () => {
    const project = await fixture(), browser = primitives(), hiddenLayerIds = new Set(Object.keys(project.document.userLayers))
    await renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 256, hiddenLayerIds, screenScalePxPerMm: 1 })
    expect(browser.translate).not.toHaveBeenCalled(); expect(browser.decode).toHaveBeenCalledOnce()
    await renderEditorProjectV3(project, { audience: 'player', longEdgePx: 256, hiddenLayerIds, screenScalePxPerMm: 1 })
    expect(browser.translate).toHaveBeenCalledOnce()
    for (const audience of ['gm', 'player'] as const) await exportPngV3(project, { audience, longEdgePx: 256, ...{ hiddenLayerIds } })
    expect(browser.translate).toHaveBeenCalledTimes(3); expect(browser.decode).toHaveBeenCalledTimes(4); expect(browser.close).toHaveBeenCalledTimes(4)
  })

  it('closes late decoded GM bitmaps and suppresses canvas/metrics after cancellation', async () => {
    const project = await fixture(), browser = primitives(), controller = new AbortController(), onMetrics = vi.fn()
    browser.decode.mockImplementation(async () => { controller.abort(); return { width: 1, height: 1, close: browser.close } })
    await expect(renderEditorProjectV3(project, { audience: 'gm', longEdgePx: 256, hiddenLayerIds: new Set(Object.keys(project.document.userLayers)), signal: controller.signal, onMetrics })).rejects.toMatchObject({ name: 'AbortError' })
    expect(browser.close).toHaveBeenCalledOnce(); expect(browser.createElement).not.toHaveBeenCalled(); expect(onMetrics).not.toHaveBeenCalled()
  })
})
