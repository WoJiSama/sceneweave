import { zlibSync } from 'fflate'
import { layerSceneV3 } from '../../src/core/v3/test-fixtures'
import { createCompositionContent } from '../../src/shared/appearance/graph'
import { normalizeStaticSvg } from '../../src/shared/ai/svg'
import { inspectDependencies } from '../../src/shared/geometry/dependencies'
import type { ProjectBundle } from '../../src/shared/model/project'
import type { SceneDocument } from '../../src/shared/model/scene'
import type { CompleteValidationOptions, RasterImage } from '../../src/shared/ports/resources'
import { crc32, sha256Bytes } from '../../src/shared/project/binary'
import { createMemoryResources } from '../../src/shared/project/resources'
import { cloneJson, encodeUtf8 } from '../../src/shared/validation/json'

export const SVG_FIXTURE_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect x="0" y="0" width="1" height="1" fill="#c86432"/></svg>'
export const SVG_FIXTURE_RGBA = [200, 100, 50, 255]
export function svgFixturePng(rgba = SVG_FIXTURE_RGBA): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
    view.setUint32(0, data.length); result.set(encodeUtf8(type), 4); result.set(data, 8)
    view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)))
    return result
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(new Uint8Array([0, ...rgba]))), chunk('IEND', new Uint8Array())]
  const bytes = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0; for (const item of chunks) { bytes.set(item, offset); offset += item.length }
  return bytes
}

export function svgProjectFixture(sourceSvg = SVG_FIXTURE_SOURCE, rgba = SVG_FIXTURE_RGBA) {
  const normalized = normalizeStaticSvg(sourceSvg), rasterBytes = svgFixturePng(rgba), rasterSha256 = sha256Bytes(rasterBytes)
  const bytes = new Map<string, Uint8Array>([[rasterSha256, rasterBytes], [normalized.sourceSha256, encodeUtf8(sourceSvg)], [normalized.normalizedSha256, encodeUtf8(normalized.normalizedSource)]])
  const document: SceneDocument = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 }
  document.sceneId = 'svg-resource-owner'; document.title = 'SVG source preservation fixture'
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const prop = document.props.item, origin = { kind: 'original' as const, attribution: 'Sceneweave SVG test fixture', canEmbed: true }
  document.assets.image = { id: 'image', sha256: rasterSha256, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1,
    logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'test-svg-license', origin }
  document.propDefinitions.definition = { id: 'definition', catalogId: 'test.svg-image', version: 1, licenseRef: 'test-svg-license', origin,
    name: 'SVG fixture', tags: [], defaultAppearance: { kind: 'image', assetId: 'image', tint: null, opacity: 1 }, defaultVisualBoundsMm: prop.visualBoundsMm,
    defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false,
    defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  prop.definitionRef = { id: 'definition', version: 1 }; prop.appearance = cloneJson(document.propDefinitions.definition.defaultAppearance)
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `svg-fixture-token-${++sequence}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } })
  const license = 'Original Sceneweave SVG fixture; MIT', licenseHash = sha256Bytes(encodeUtf8(license))
  const bundle: ProjectBundle = { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: { [rasterSha256]: { sha256: rasterSha256, mimeType: 'image/png', sizeBytes: rasterBytes.length, pixelWidth: 1, pixelHeight: 1 } },
    licenses: { [licenseHash]: { sha256: licenseHash, text: license } }, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })),
    authoringSources: { image: { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256,
      sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256, processorId: normalized.processorId, processorVersion: normalized.processorVersion } } }, resources: createMemoryResources(bytes) }
  return { bundle, bytes, normalized }
}

/** Explicit pixel doubles; browser tests independently exercise actual decoders. */
export function svgFixtureValidation(rgba = SVG_FIXTURE_RGBA): CompleteValidationOptions {
  const raster = (): RasterImage => ({ width: 1, height: 1, rgba: new Uint8ClampedArray(rgba) })
  return { images: { async decode() { return raster() }, async transform(image) { return image }, async encodePng() { throw new Error('Validation must not encode fixture PNG') } },
    svg: { async rasterize() { return raster() } } }
}
