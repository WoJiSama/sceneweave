import { fixture } from '../../src/application/workspace/test-fixtures.js'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { inspectDependencies } from '../../src/shared/geometry/dependencies.js'
import type { ProjectBundle, ProjectData } from '../../src/shared/model/project.js'
import { createMemoryResources } from '../../src/shared/project/resources.js'
import { exportProject, importProject } from '../../src/shared/project/file.js'
import { sha256Bytes } from '../../src/shared/project/binary.js'
import { cloneJson, encodeUtf8 } from '../../src/shared/validation/json.js'
import { validation } from '../../src/platform/browser/runtime.js'
import { projectScene } from '../../src/shared/projection/projection.js'

export const RESOURCE_STRESS_CASES = {
  'image-2048': { count: 1, width: 2048, height: 2048 },
  'image-4096': { count: 1, width: 4096, height: 4096 },
  'image-near32mp': { count: 1, width: 8192, height: 3906 },
  'images-50mp': { count: 3, width: 4096, height: 4096 },
  'assets-64': { count: 64, width: 256, height: 256 },
  'assets-128': { count: 128, width: 256, height: 256 },
  'assets-256': { count: 256, width: 256, height: 256 },
  'reject-assets-257': { count: 257, width: 256, height: 256 },
  'reject-pixels-over64mp': { count: 4, width: 4096, height: 4096 },
} as const

/** Synthetic original checker/alpha images isolate dimensions and resource count.
 * They are additional stress inputs, never replacements for authored maps. */
export async function prepareResourceStressFixture(name: keyof typeof RESOURCE_STRESS_CASES) {
  const config = RESOURCE_STRESS_CASES[name]
  if (!config) throw new Error('Unknown resource stress case')
  const document = cloneJson(fixture().project.document), prototype = cloneJson(document.props.item), layer = document.entityLayers.item
  document.props = {}; document.entityLayers = {}; document.title = `资源压力 · ${name}`; document.sceneId = `stress-${name}`
  const resources = new Map<string, Uint8Array>(), assets: ProjectData['assets'] = {}
  const origin = { kind: 'original' as const, attribution: 'Sceneweave deterministic resource stress checker artwork, 2026-11-12', canEmbed: true }
  for (let i = 0; i < config.count; i++) {
    const { width, height } = config, rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4, pattern = ((x >> 5) + (y >> 5)) & 1
      rgba[offset] = (i * 37 + pattern * 89 + 30) % 256; rgba[offset + 1] = (i * 71 + 100) % 256
      rgba[offset + 2] = (i * 17 + pattern * 63 + 60) % 256
      rgba[offset + 3] = (x + y + i) % 97 === 0 ? 80 : 255
    }
    // Every index is distinct, including asset 256 (whose low color bytes wrap).
    rgba[0] = i & 255; rgba[1] = i >> 8; rgba[2] = 231; rgba[3] = 255
    const bytes = await validation.images.encodePng({ width, height, rgba }), hash = sha256Bytes(bytes)
    if (resources.has(hash)) throw new Error('Stress resources must have distinct actual bytes')
    resources.set(hash, bytes); assets[hash] = { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: width, pixelHeight: height }
    const assetId = `stress-image-${i}`, definitionId = `stress-definition-${i}`, id = `stress-prop-${i}`
    document.assets[assetId] = { id: assetId, sha256: hash, mimeType: 'image/png', pixelWidth: width, pixelHeight: height,
      logicalSizeMm: { width: 500, height: 500 }, licenseRef: 'stress-MIT', origin }
    const appearance = { kind: 'image' as const, assetId, tint: null, opacity: 1 }
    document.propDefinitions[definitionId] = { id: definitionId, catalogId: `stress.resource.${i}`, version: 1, licenseRef: 'stress-MIT', origin,
      name: `Pressure image ${i}`, tags: [], defaultAppearance: appearance, defaultVisualBoundsMm: prototype.visualBoundsMm,
      defaultFootprintMm: prototype.footprintMm, defaultFootprintOffsetMm: prototype.footprintOffsetMm,
      defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
    document.props[id] = { ...cloneJson(prototype), id, positionMm: { x: 500 + (i % 16) * 1000, y: 500 + Math.floor(i / 16) * 1000 },
      visibility: i === config.count - 1 && i > 0 ? 'gm' : 'public', definitionRef: { id: definitionId, version: 1 }, appearance }
    document.entityLayers[id] = layer
  }
  // A private image must already have a valid fixed world mask before any
  // ordinary command is attempted; legality of the archive alone is weaker.
  if (config.count > 1) {
    const privateProp = document.props[`stress-prop-${config.count - 1}`], { x, y } = privateProp.positionMm, id = 'stress-fixed-private-mask'
    document.regions[id] = { id, floorId: privateProp.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false,
      movementCostMultiplier: 1, boundaryMm: [{ x: x - 132, y: y - 132 }, { x: x + 132, y: y - 132 }, { x: x + 132, y: y + 132 }, { x: x - 132, y: y + 132 }] }
    document.entityLayers[id] = layer
  }
  try {
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `stress-${name}-identity-${++sequence}` }, clock: { now: () => '2026-11-12T00:00:00.000Z' } })
  for (const audience of ['gm', 'player'] as const) projectScene(content.document, audience, content.appearance)
  const text = 'Original Sceneweave synthetic pressure checker artwork. MIT License; copyright 2026 Sceneweave contributors.', hash = sha256Bytes(encodeUtf8(text))
  const bundle: ProjectBundle = { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets,
    licenses: { [hash]: { sha256: hash, text } }, licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' })),
    authoringSources: {} }, resources: createMemoryResources(resources) }
    const bytes = await exportProject(bundle, validation), cold = await importProject(bytes, validation)
    if (Object.keys(cold.project.assets).length !== config.count) throw new Error('Cold resource count mismatch')
    if (name.startsWith('reject-')) throw new Error('Declared rejection boundary unexpectedly succeeded')
    return { bytes, controls: { remoteEntityId: 'stress-prop-0' }, summary: { ...config, imagePixels: config.count * config.width * config.height,
      imageBytes: [...resources.values()].reduce((sum, bytes) => sum + bytes.length, 0), synthetic: true,
      scope: 'Actual original PNG bytes/alpha/complete Prop/source/license closure. Dense synthetic image pressure; does not establish authored-map playability or visual quality.' } }
  } catch (error) {
    if (!name.startsWith('reject-') || !/256|像素|预算|上限/.test(String(error))) throw error
    return { rejected: true, message: String(error), summary: { ...config, imagePixels: config.count * config.width * config.height, synthetic: true } }
  }
}
