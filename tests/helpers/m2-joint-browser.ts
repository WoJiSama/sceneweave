import { createHouse } from '../../src/core/seed'
import { migrateSceneV1 } from '../../src/core/v2/migration'
import { migrateSceneV2 } from '../../src/core/v3/migration'
import { createPrivacyPairB4, type PrivacyCaseB4 } from '../b4-privacy-fixtures'
import { createCompositionContent } from '../../src/shared/appearance/graph'
import { createMemoryResources, validateProjectBundle } from '../../src/shared/project/resources'
import { sha256Bytes } from '../../src/shared/project/binary'
import { normalizePngChunks } from '../../src/shared/project/image-bytes'
import { inspectDependencies } from '../../src/shared/geometry/dependencies'
import { createBrowserImagePort } from '../../src/platform/browser/images'
import { createBrowserSvgPort } from '../../src/platform/browser/ai/svg-port'
import { rasterizeNormalizedSvg } from '../../src/platform/browser/ai/svg-raster'
import { normalizeStaticSvg } from '../../src/shared/ai/svg'
import { ProjectRepository } from '../../src/platform/browser/storage/repository'
import { Workspace } from '../../src/application/workspace/workspace'
import { fromBundle, toBundle } from '../../src/application/workspace/project'
import type { ProjectBundle } from '../../src/shared/model/project'
import type { SceneDocument } from '../../src/shared/model/scene'

export const validation = { images: createBrowserImagePort(), svg: createBrowserSvgPort() }
export const runtime = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => new Date().toISOString() } }

/** Fixture adaptation only. The entire renderer/storage path exercised below uses native complete v1. */
export async function nativePrivacyPair(name: PrivacyCaseB4 | 'M2-SECRET-DOOR') {
  if (name !== 'M2-SECRET-DOOR') {
    const pair = await createPrivacyPairB4(name)
    const variants = []
    for (const input of [pair.a, pair.b]) {
      const document: SceneDocument = { ...migrateSceneV2(input.document, { sceneId: `joint-${name}` }), format: 'sceneweave-scene', schemaVersion: 1 }
      const bytes = new Map<string, Uint8Array>()
      const remap = new Map<string, string>()
      const assets = Object.fromEntries(await Promise.all(Object.entries(input.assets).map(async ([hash, { blob, ...record }]) => {
        const adopted = normalizePngChunks(new Uint8Array(await blob.arrayBuffer())), next = sha256Bytes(adopted)
        bytes.set(next, adopted); remap.set(hash, next); return [next, { ...record, sha256: next, sizeBytes: adopted.length }]
      })))
      for (const ref of Object.values(document.assets)) ref.sha256 = remap.get(ref.sha256)!
      const content = createCompositionContent(document, runtime)
      variants.push(await validateProjectBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets,
        licenses: input.licenses, licenseBindings: input.licenseBindings, authoringSources: {} }, resources: createMemoryResources(bytes) }, validation))
    }
    return { a: variants[0], b: variants[1], privateAssetIds: pair.secretAssetIds, sentinels: pair.sentinelStrings }
  }
  const variants: ProjectBundle[] = []
  for (const variant of ['a', 'b']) {
    const document: SceneDocument = { ...migrateSceneV2(migrateSceneV1(createHouse('joint-secret-source')), { sceneId: 'joint-secret-target' }), format: 'sceneweave-scene', schemaVersion: 1 }
    const other = variant === 'b'
    document.regions['g-a1'].boundaryMm = [{ x: -500, y: -500 }, { x: 18500, y: -500 }, { x: 18500, y: 4500 }, { x: -500, y: 4500 }]
    if (other) {
      document.vertices['v-g7'].yMm = 1800; document.vertices['v-h8'].yMm = 1800
      Object.assign(document.openings['o-c3'], { offsetMm: 1800, widthMm: 1600, state: 'open', locked: true })
      document.props['p-h8'].positionMm = { x: 9300, y: 3000 }; document.props['p-h8'].rotationDeg = 35
    }
    Object.assign(document.openings['o-b2'], { secret: true, revealed: false, offsetMm: other ? 2000 : 3500, widthMm: other ? 1600 : 1100, state: other ? 'open' : 'closed', locked: other })
    document.props['p-h8'].shadowClass = 'furniture'
    document.props['p-h8'].shadowOverride = { color: other ? '#336699' : '#112233', opacity: other ? .8 : .3, directionDeg: other ? 130 : 45, offsetMm: other ? 150 : 50, blurMm: other ? 40 : 10 }
    const marker = `M2-PRIVATE-SOURCE-PROMPT-${variant}`
    document.generationMetadata = { generatorVersion: 'm2-acceptance', seed: marker, summary: marker, adoptedAt: '2026-10-25T00:00:00.000Z' }
    document.notes['n-c3'].text = marker; document.notes['n-d4'].title = marker; document.notes['n-d4'].text = marker
    const normalized = normalizeStaticSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="0" y="0" width="32" height="32" fill="${other ? '#224488' : '#cc8822'}"/></svg>`)
    const raster = await rasterizeNormalizedSvg(normalized, { longEdgePx: 32 }), origin = { kind: 'generated' as const, attribution: marker, canEmbed: true }
    document.assets['private-svg-image'] = { id: 'private-svg-image', sha256: raster.sha256, mimeType: 'image/png', pixelWidth: 32, pixelHeight: 32,
      logicalSizeMm: { width: 600, height: 500 }, licenseRef: 'joint-original', origin }
    const prop = document.props['p-h8']
    document.propDefinitions['private-svg-definition'] = { id: 'private-svg-definition', catalogId: 'joint.private', version: 1, name: marker, tags: [], licenseRef: 'joint-original', origin,
      defaultAppearance: { kind: 'image', assetId: 'private-svg-image', opacity: 1, tint: null }, defaultVisualBoundsMm: prop.visualBoundsMm,
      defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: true, defaultBlocksSight: false,
      defaultRenderLayer: 'object', defaultShadowClass: 'furniture' }
    prop.definitionRef = { id: 'private-svg-definition', version: 1 }; prop.appearance = structuredClone(document.propDefinitions['private-svg-definition'].defaultAppearance)
    const content = createCompositionContent(document, runtime), text = 'Original Sceneweave acceptance artwork; MIT', licenseHash = sha256Bytes(new TextEncoder().encode(text))
    const bytes = new Map([[raster.sha256, raster.pngBytes], [normalized.sourceSha256, new TextEncoder().encode(normalized.sourceSvg)], [normalized.normalizedSha256, new TextEncoder().encode(normalized.normalizedSource)]])
    const bundle: ProjectBundle = { project: { format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
      assets: { [raster.sha256]: { sha256: raster.sha256, mimeType: 'image/png', sizeBytes: raster.pngBytes.length, pixelWidth: 32, pixelHeight: 32 } },
      licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })),
      authoringSources: { 'private-svg-image': { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256, sourceSizeBytes: normalized.sourceSizeBytes,
        normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256: raster.sha256, processorId: normalized.processorId, processorVersion: normalized.processorVersion } } }, resources: createMemoryResources(bytes) }
    variants.push(await validateProjectBundle(bundle, validation))
  }
  return { a: variants[0], b: variants[1], privateAssetIds: ['private-svg-image'], sentinels: ['M2-PRIVATE-SOURCE-PROMPT-', 'generationMetadata', 'sceneweave-complete-project'] }
}

export async function readActualPng(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), chunks: string[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset), end = offset + length + 12
    if (end > bytes.length) throw new Error('Actual PNG chunk exceeds file')
    chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset = end
  }
  if (offset !== bytes.length || chunks.at(-1) !== 'IEND') throw new Error('Trailing or truncated actual PNG')
  const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    return { width: canvas.width, height: canvas.height, rgbaHash: sha256Bytes(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)), pixels, chunks, rawText: new TextDecoder().decode(bytes), bytes: bytes.length }
  } finally { bitmap.close(); canvas.width = canvas.height = 0 }
}

export async function workspaceFixture(name: string) {
  const { svgProjectFixture } = await import('./m24-svg-fixtures')
  const repository = new ProjectRepository({ name, validation, runtime }), workspace = new Workspace(repository, { validation, runtime })
  const fixture = svgProjectFixture(), project = await fromBundle(fixture.bundle, validation)
  await workspace.adoptNew(project)
  const named = await workspace.createNamedSnapshot('Joint SVG baseline')
  await workspace.updateProp('item', { rotationDeg: 25 }); await workspace.flush()
  return { workspace, repository, named, fixture }
}

export async function rows(repository: ProjectRepository) {
  const result: Record<string, number> = {}
  for (const table of repository.database.tables) result[table.name] = await table.count()
  return result
}
export { toBundle }
