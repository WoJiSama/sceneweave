import { unzlibSync, zlibSync } from 'fflate'
import { layerSceneV3 } from '../../core/v3/test-fixtures'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { ProjectBundle } from '../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { crc32, sha256Bytes } from '../../shared/project/binary.js'
import { transformRgba } from '../../shared/project/pixels.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { cloneJson, encodeUtf8 } from '../../shared/validation/json.js'

export const NOW = '2026-10-24T12:00:00.000Z'
let sequence = 0
export const runtime = { ids: { nextId: () => `native-session-${++sequence}` }, clock: { now: () => NOW } }
export function pixelPng(pixel: Uint8ClampedArray | number[]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
    view.setUint32(0, data.length); result.set(encodeUtf8(type), 4); result.set(data, 8)
    view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8))); return result
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(new Uint8Array([0, ...pixel]))), chunk('IEND', new Uint8Array())]
  const result = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0; for (const item of chunks) { result.set(item, offset); offset += item.length }; return result
}
/** Actual small PNG bytes/deflate/pixel processing; Chrome separately exercises Canvas. */
export const validation: CompleteValidationOptions = { images: {
  async decode(bytes, record) {
    if (record.pixelWidth !== 1 || record.pixelHeight !== 1) throw new Error('Unit adapter accepts its actual 1px fixture only')
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(33)
    const inflated = unzlibSync(bytes.subarray(41, 41 + length))
    if (inflated.length !== 5 || inflated[0] !== 0) throw new Error('Fixture PNG scanline invalid')
    return { width: 1, height: 1, rgba: new Uint8ClampedArray(inflated.subarray(1)) }
  },
  async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
  async encodePng(image) { return pixelPng(image.rgba) },
} }

export function fixture(options: { image?: boolean; building?: boolean } = {}): ProjectBundle {
  const document: SceneDocument = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 }
  document.sceneId = runtime.ids.nextId(); document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  document.props.other = { ...cloneJson(document.props.item), id: 'other', positionMm: { x: 9000, y: 9000 } }
  const layer = document.entityLayers.item
  document.entityLayers.other = layer
  const bytes = new Map<string, Uint8Array>()
  if (options.image) {
    const encoded = pixelPng([200, 100, 50, 255]), hash = sha256Bytes(encoded), prop = document.props.item
    bytes.set(hash, encoded)
    const origin = { kind: 'original' as const, attribution: 'Sceneweave native workspace fixture', canEmbed: true }
    document.assets.image = { id: 'image', sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'fixture-license', origin }
    document.propDefinitions.definition = { id: 'definition', catalogId: 'test.native-workspace', version: 1, licenseRef: 'fixture-license', origin,
      name: 'Native image', tags: [], defaultAppearance: { kind: 'image', assetId: 'image', tint: null, opacity: 1 }, defaultVisualBoundsMm: prop.visualBoundsMm,
      defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
    prop.definitionRef = { id: 'definition', version: 1 }; prop.appearance = cloneJson(document.propDefinitions.definition.defaultAppearance)
  }
  if (options.building) {
    const points = [{ xMm: 3000, yMm: 3000 }, { xMm: 10000, yMm: 3000 }, { xMm: 10000, yMm: 10000 }, { xMm: 3000, yMm: 10000 }]
    points.forEach((point, i) => {
      const id = `vertex-${i}`, wallId = `wall-${i}`
      document.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, ...point }
      document.walls[wallId] = { id: wallId, floorId: 'blank-floor', editLocked: false, startVertexId: id, endVertexId: `vertex-${(i + 1) % points.length}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
      document.entityLayers[id] = layer; document.entityLayers[wallId] = layer
    })
    document.rooms.room = { id: 'room', floorId: 'blank-floor', editLocked: false, boundaryVertexIds: points.map((_, i) => `vertex-${i}`), purpose: 'original room', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'blank-floor' }, groundElevationMm: 0, floorStyle: null }
    document.entityLayers.room = layer
  }
  const content = createCompositionContent(document, runtime), text = 'Sceneweave native workspace fixture license', hash = sha256Bytes(encodeUtf8(text)), subjects = inspectDependencies(content.document).subjects
  return { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: Object.fromEntries([...bytes].map(([sha256, data]) => [sha256, { sha256, mimeType: 'image/png' as const, sizeBytes: data.length, pixelWidth: 1, pixelHeight: 1 }])),
    licenses: subjects.length ? { [hash]: { sha256: hash, text } } : {}, licenseBindings: subjects.map(subject => ({ ...subject, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' as const })), authoringSources: {} }, resources: createMemoryResources(bytes) }
}
