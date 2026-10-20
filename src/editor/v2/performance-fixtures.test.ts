import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCommandsV2, type SceneCommandV2 } from '../../core/v2/commands'
import { propFootprintV2, supportedPolygon } from '../../core/v2/geometry'
import { validateSceneV2 } from '../../core/v2/schema'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import { inspectImageBytes } from '../../io/v2/resources'
import { orderedPropsV2 } from '../../render/v2/projection'
import { validateIslandEditsV2 } from './island-constraints'
import { createIslandDocument } from './island-sample'
import { createPerformanceDocumentV2, createPerformanceFixtureV2, type PerformanceAssetFetcherV2, type PerformancePropCountV2, type PerformanceSampleV2 } from './performance-fixtures'
import { validateStudyEditsV2 } from './study-constraints'
import { createStudyDocument } from './study-sample'
import { terrainPointCommandsV2 } from './terrain-editing'

const combinations = [['study', 500], ['study', 2000], ['island', 500], ['island', 2000]] as const
const fetchFiles: PerformanceAssetFetcherV2 = async url => {
  const match = /^\/assets\/(sceneweave-handdrawn(?:-outdoor)?)\/([a-z-]+\.png)$/.exec(url)
  if (!match) throw new Error(`Unexpected asset path: ${url}`)
  const bytes = await readFile(new URL(`../../../public/assets/${match[1]}/${match[2]}`, import.meta.url))
  return { ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer }
}

beforeEach(() => {
  // Node has no browser bitmap decoder. Only that capability is stubbed; authored bytes, PNG CRC, hashes,
  // scene/complete-project admission and fixture alpha reconstruction are real. Production runs decode again.
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    const header = inspectImageBytes(new Uint8Array(await blob.arrayBuffer()))
    return { width: header.width, height: header.height, close: vi.fn() }
  }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('B5 real-art workloads', () => {
  it.each(combinations)('retains the original %s sample and strictly admits exactly %i on-screen public props', async (sample, count) => {
    const { project, summary } = await createPerformanceFixtureV2(sample, count, fetchFiles)
    const document = project.document, original = sample === 'study' ? createStudyDocument() : createIslandDocument()
    expect(Object.keys(document.props)).toHaveLength(count)
    expect(summary).toMatchObject({ sample, propCount: count, originalPropCount: sample === 'study' ? 13 : 39,
      projectedPropCounts: { gm: count, player: count }, propsWhollyInsideExport: count, postOcclusionVisiblePropCount: null,
      uniqueImageCount: sample === 'study' ? 15 : 13, materialDefinitionCount: sample === 'study' ? 4 : 6,
      propDefinitionCount: sample === 'study' ? 11 : 7, prefabInstanceCount: sample === 'study' ? 2 : 0,
      scatterGroupCount: sample === 'study' ? 0 : 3, originalScatterMemberCount: sample === 'study' ? 0 : 36 })
    for (const [id, prop] of Object.entries(original.props)) expect(document.props[id]).toEqual(prop)
    for (const field of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'prefabInstances', 'scatterGroups', 'walls', 'rooms', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'notes', 'regions'] as const) {
      expect(document[field]).toEqual(original[field])
    }
    for (const prop of Object.values(document.props).filter(prop => prop.id.startsWith('b5-'))) {
      const definition = document.propDefinitions[prop.definitionRef!.id]
      expect(prop.visibility).toBe('public'); expect(prop.editLocked).toBe(false)
      expect(prop.appearance).toEqual(definition.defaultAppearance)
      expect(prop.visualBoundsMm).toEqual(definition.defaultVisualBoundsMm)
      expect(prop.footprintMm).toEqual(definition.defaultFootprintMm)
      expect(prop.shadowClass).toEqual(definition.defaultShadowClass)
      expect(supportedPolygon(document, propFootprintV2(prop), prop.supportRef, prop.floorId)).toBe(true)
    }
    expect(validateSceneV2(document).ok).toBe(true)
    expect(() => validateStudyEditsV2(document)).not.toThrow(); expect(() => validateIslandEditsV2(document)).not.toThrow()
    await expect(validateCompleteProjectV2(project)).resolves.toBeUndefined()
    expect(summary.uniqueImagePixels).toBe(sample === 'study' ? 2121728 : 8208384)
    expect(summary.alphaStatistics.filter(stat => stat.kind === 'material').every(stat => stat.zeroAlphaPixels === 0 && stat.partialAlphaPixels === 0)).toBe(true)
    expect(summary.alphaStatistics.filter(stat => stat.kind === 'prop').every(stat => stat.zeroAlphaPixels > 0 && stat.partialAlphaPixels > 0 && stat.opaquePixels > 0)).toBe(true)
    expect(summary.transparency.instanceAlphaWeightedAreaMm2).toBeLessThan(summary.transparency.instanceVisualRectangleAreaMm2)
    expect(summary.transparency.rectangleGrid.multipleCoverageFraction).toBeGreaterThan(0)

    // Match the current workbench's reverse render-order rectangle hit semantics without adding a benchmark-only selection algorithm.
    const point = summary.selectionPointMm
    const hit = orderedPropsV2(Object.values(document.props)).reverse().find(prop => {
      const a = -prop.rotationDeg * Math.PI / 180, dx = point.x - prop.positionMm.x, dy = point.y - prop.positionMm.y
      const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a), b = prop.visualBoundsMm
      return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
    })
    expect(hit?.id).toBe(summary.editablePropId)

    // Real commands and the same opt-in passage guards must work on both load sizes.
    const prop = document.props[summary.editablePropId]
    let edited = applyCommandsV2(document, [{ type: 'updateProp', id: prop.id, changes: { positionMm: { x: prop.positionMm.x + 1, y: prop.positionMm.y } } }])
    validateStudyEditsV2(edited); validateIslandEditsV2(edited)
    const target = summary.contourEditTarget, positionMm = { x: target.positionMm.x - 1, y: target.positionMm.y }
    const commands: SceneCommandV2[] = target.kind === 'vertex' ? [{ type: 'moveVertex', id: target.id, positionMm }]
      : terrainPointCommandsV2(edited, target.areaId, target.pointId, positionMm)
    edited = applyCommandsV2(edited, commands)
    validateStudyEditsV2(edited); validateIslandEditsV2(edited)
    expect(edited.props[prop.id].positionMm.x).toBe(prop.positionMm.x + 1)
    expect(target.kind === 'vertex' ? edited.vertices[target.id].xMm : edited.terrainAreas[target.areaId].boundaryMm.find(point => point.id === target.pointId)!.positionMm.x).toBe(positionMm.x)
    const oppositePosition = { x: target.positionMm.x + 1, y: target.positionMm.y }
    const opposite = applyCommandsV2(document, target.kind === 'vertex' ? [{ type: 'moveVertex', id: target.id, positionMm: oppositePosition }]
      : terrainPointCommandsV2(document, target.areaId, target.pointId, oppositePosition))
    validateStudyEditsV2(opposite); validateIslandEditsV2(opposite)
  }, 15000)

  it.each(['study', 'island'] as const)('constructs %s deterministically with strict argument and cancellation handling', async sample => {
    expect(createPerformanceDocumentV2(sample, 500)).toEqual(createPerformanceDocumentV2(sample, 500))
    expect(() => createPerformanceDocumentV2(sample, 501 as PerformancePropCountV2)).toThrow('500/2000')
    const controller = new AbortController(); controller.abort()
    const fetcher = vi.fn(fetchFiles)
    await expect(createPerformanceFixtureV2(sample, 500, fetcher, controller.signal)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects missing or corrupted source images rather than returning a reduced-art workload', async () => {
    await expect(createPerformanceFixtureV2('study', 500, async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }))).rejects.toThrow('404')
    await expect(createPerformanceFixtureV2('island', 500, async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }))).rejects.toThrow()
    expect(() => createPerformanceDocumentV2('other' as PerformanceSampleV2, 500)).toThrow('study/island')
  })

  it('reports actual source alpha counts independently cross-checked against authored filter-zero bytes', async () => {
    const { summary } = await createPerformanceFixtureV2('study', 500, fetchFiles)
    const statistics = summary.alphaStatistics.find(item => item.file === 'envelope.png')!
    const bytes = new Uint8Array(await (await fetchFiles('/assets/sceneweave-handdrawn/envelope.png')).arrayBuffer())
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), compressed: Uint8Array[] = []
    for (let cursor = 8; cursor < bytes.length;) {
      const length = view.getUint32(cursor)
      if (String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8)) === 'IDAT') compressed.push(bytes.subarray(cursor + 8, cursor + 8 + length))
      cursor += length + 12
    }
    const raw = inflateSync(Buffer.concat(compressed)), counts = { zero: 0, partial: 0, opaque: 0, sum: 0 }, stride = statistics.width * 4 + 1
    for (let y = 0; y < statistics.height; y++) {
      expect(raw[y * stride]).toBe(0)
      for (let x = 0; x < statistics.width; x++) {
        const alpha = raw[y * stride + 1 + x * 4 + 3]
        counts.sum += alpha
        if (alpha === 0) counts.zero++; else if (alpha === 255) counts.opaque++; else counts.partial++
      }
    }
    expect(statistics).toMatchObject({ zeroAlphaPixels: counts.zero, partialAlphaPixels: counts.partial, opaquePixels: counts.opaque, alphaWeightedPixels: counts.sum / 255 })
  })
})
