import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures'
import { createBrowserSvgPort } from '../../platform/browser/ai/svg-port'
import { initializeCanonicalSvgRasterizer } from '../../platform/browser/ai/svg-raster'
import { LEGACY_SVG_PROCESSOR } from '../ai/svg'
import { addPropAppearanceSource, addSurfaceAppearanceSource, bitmapVariant, resolveAppearance } from '../appearance/graph'
import { inspectDependencies } from '../commands/dependencies'
import { createHistoryIdentity } from '../history/identity'
import type { ProjectBundle } from '../model/project'
import type { CompleteValidationOptions } from '../ports/resources'
import { cloneJson } from '../validation/json'
import { sha256Bytes } from './binary'
import { exportHistoryArchive, exportProject, importHistoryArchive, importProject } from './file'
import { prepareLegacySvgMigrationCandidate } from './legacy-svg-migration'
import { decodeCanonicalPng, encodeCanonicalPng } from './png-rgba'
import { transformRgba } from './pixels'
import { createMemoryResources, deriveBitmapVariant } from './resources'
import { projectContentHash } from './validate'

const oldPixels = [199, 100, 50, 255]
const context = (prefix = 'migration') => {
  let sequence = 0
  return { ids: { nextId: () => `${prefix}-${++sequence}` }, clock: { now: () => '2026-11-06T00:00:00.000Z' } }
}
const validation = (): CompleteValidationOptions => ({
  svg: createBrowserSvgPort(),
  // Explicit native-pixel double; production legacy ports still use the actual
  // original browser. This deliberate one-channel difference proves reraster.
  legacySvg: { processor: LEGACY_SVG_PROCESSOR, async rasterize() { return { width: 1, height: 1, rgba: new Uint8ClampedArray(oldPixels) } } },
  images: {
    async decode(bytes) { return decodeCanonicalPng(bytes) },
    async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
    async encodePng(image) { return encodeCanonicalPng(image) },
  },
})
function legacyFixture() {
  const fixture = svgProjectFixture(undefined, oldPixels), source = fixture.bundle.project.authoringSources.image
  const { rasterizer: _rasterizer, pixelFormat: _pixelFormat, ...records } = source as typeof source & { rasterizer: unknown; pixelFormat: unknown }
  fixture.bundle.project.authoringSources.image = { ...records, ...LEGACY_SVG_PROCESSOR }
  return fixture
}
function bindExactLicenses(bundle: ProjectBundle): void {
  const path = bundle.project.licenseBindings[0].licensePath
  bundle.project.licenseBindings = inspectDependencies(bundle.project.document).subjects.map(subject => ({ ...subject, licensePath: path, embedding: 'allowed' }))
}

beforeAll(async () => {
  await initializeCanonicalSvgRasterizer(new Uint8Array(await readFile(new URL('../../../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url))))
})

describe('explicit legacy SVG copy migration', () => {
  it('preserves the original and all physical/private/lock/text fields while making a canonical cold-readable copy', async () => {
    const { bundle, bytes } = legacyFixture(), project = bundle.project, scene = project.document, options = validation()
    scene.props.item.visibility = 'gm'; scene.props.item.editLocked = true
    scene.userLayers[scene.entityLayers.item].editLocked = true
    scene.notes.note = { id: 'note', floorId: scene.props.item.floorId, editLocked: true, kind: 'note', visibility: 'gm',
      anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' }, text: 'image / definition / svg-resource-owner remain literal text' }
    scene.entityLayers.note = scene.entityLayers.item
    const material = { ...cloneJson(scene.propDefinitions.definition), id: 'material', catalogId: 'fixed-material', textureAssetId: 'image',
      defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain' as const] }
    scene.materials.material = { id: material.id, catalogId: material.catalogId, version: 1, licenseRef: material.licenseRef, origin: material.origin,
      name: 'Original material', tags: [], textureAssetId: material.textureAssetId, defaultTileSizeMm: material.defaultTileSizeMm, applicableSurfaces: material.applicableSurfaces }
    scene.terrainAreas.area = { id: 'area', floorId: scene.props.item.floorId, editLocked: true, visibility: 'gm',
      boundaryMm: [{ x: 1000, y: 1000 }, { x: 9000, y: 1000 }, { x: 9000, y: 9000 }, { x: 1000, y: 9000 }].map((positionMm, i) => ({ id: `point-${i}`, segmentId: `segment-${i}`, positionMm })),
      groundElevationMm: 25, coveragePriority: 1, blocksMovement: false, blocksSight: false, movementCostMultiplier: 2,
      surfaceStyle: { base: { materialRef: { id: 'material', version: 1 }, tileSizeMm: { width: 2000, height: 3000 }, rotationDeg: 15, alignment: 'world', originMm: { x: 100, y: 200 }, tint: null, opacity: 1 }, overlays: [] } }
    scene.entityLayers.area = scene.entityLayers.item
    scene.props.item.supportRef = { kind: 'terrainArea', id: 'area' }
    project.appearance.surfaceSources.area = addSurfaceAppearanceSource(project.appearance, scene.terrainAreas.area.surfaceStyle!)
    const { id: _id, floorId: _floorId, editLocked: _editLocked, visibility: _visibility, supportRef: _supportRef, ...template } = scene.props.item
    scene.prefabDefinitions.prefab = { id: 'prefab', catalogId: 'fixed-prefab', version: 1, licenseRef: material.licenseRef, origin: material.origin,
      name: 'Fixed template', tags: [], members: [{ key: 'member', propTemplate: template }] }
    project.appearance.prefabAppearanceTemplates.prefab = { definitionRef: { id: 'prefab', version: 1 }, visibility: 'gm',
      members: { member: { sourceId: project.appearance.propSources.item, adjustments: [] } } }
    const variant = bitmapVariant('image', '#A0C0E0', 1.25)!, rootRecord = project.assets[scene.assets.image.sha256]
    const derived = await deriveBitmapVariant(bytes.get(rootRecord.sha256)!, rootRecord, { tint: variant.tint, brightness: variant.brightness }, options)
    project.appearance.variants[variant.id] = variant
    project.appearance.instanceAdjustments.item = [{ id: 'manual-tint', enabled: true, kind: 'tint', value: variant.tint }, { id: 'manual-brightness', enabled: true, kind: 'brightness', value: variant.brightness }]
    project.appearance.instanceAdjustments.area = cloneJson(project.appearance.instanceAdjustments.item)
    scene.assets[variant.outputAssetId] = { ...cloneJson(scene.assets.image), id: variant.outputAssetId, sha256: derived.record.sha256 }
    project.assets[derived.record.sha256] = derived.record; bytes.set(derived.record.sha256, derived.bytes)
    Object.assign(project, resolveAppearance(project))
    project.historyIdentity = createHistoryIdentity(project.document, context('original'))
    bindExactLicenses(bundle); bundle.resources = createMemoryResources(bytes)
    const before = cloneJson(project), originalArchive = await exportProject(bundle, options), untouched = originalArchive.slice()
    const candidate = await prepareLegacySvgMigrationCandidate(originalArchive, 'complete', options, context())
    expect(originalArchive).toEqual(untouched); expect(project).toEqual(before)
    expect(candidate.originalArchiveBytes).toEqual(untouched); expect(candidate.originalArchiveBytes).not.toBe(originalArchive)
    expect(candidate.originalArchiveSha256).toBe(sha256Bytes(untouched))
    const after = candidate.bundle.project, nextAsset = candidate.mappings.fixed.asset.image
    expect(after.document.sceneId).not.toBe(before.document.sceneId)
    expect(after.historyIdentity.lineageId).not.toBe(before.historyIdentity.lineageId)
    expect(after.historyIdentity.rootSceneId).toBe(after.document.sceneId)
    expect(after.historyIdentity.propTokens.item).not.toBe(before.historyIdentity.propTokens.item)
    expect(after.document.revision).toBe(0)
    expect(after.authoringSources[nextAsset].processorVersion).toBe(2)
    expect(after.document.assets[nextAsset].sha256).not.toBe(before.document.assets.image.sha256)
    expect(decodeCanonicalPng(await candidate.bundle.resources.read(after.document.assets[nextAsset].sha256)).rgba).toEqual(new Uint8ClampedArray([200, 100, 50, 255]))
    expect(after.document.notes).toEqual(before.document.notes); expect(after.document.userLayers).toEqual(before.document.userLayers)
    const { definitionRef: _beforeDef, appearance: _beforeAppearance, ...beforeProp } = before.document.props.item
    const { definitionRef: _afterDef, appearance: _afterAppearance, ...afterProp } = after.document.props.item
    expect(afterProp).toEqual(beforeProp)
    const { surfaceStyle: _beforeStyle, ...beforeArea } = before.document.terrainAreas.area
    const { surfaceStyle: _afterStyle, ...afterArea } = after.document.terrainAreas.area
    expect(afterArea).toEqual(beforeArea)
    expect(after.appearance.instanceAdjustments).toEqual(before.appearance.instanceAdjustments)
    expect(after.document.terrainAreas.area.surfaceStyle!.base.tileSizeMm).toEqual(before.document.terrainAreas.area.surfaceStyle!.base.tileSizeMm)
    for (const kind of Object.keys(candidate.mappings.fixed) as (keyof typeof candidate.mappings.fixed)[]) for (const [oldId, newId] of Object.entries(candidate.mappings.fixed[kind])) expect(newId).not.toBe(oldId)
    for (const id of Object.keys(before.appearance.sources)) expect(after.appearance.sources[id]).toBeUndefined()
    expect(after.licenses).toEqual(before.licenses)
    const { legacySvg: _legacy, ...ordinary } = options
    expect((await importProject(candidate.archiveBytes, ordinary)).project).toEqual(after)
    const variantNext = after.appearance.variants[candidate.mappings.variants[variant.id]]
    expect(decodeCanonicalPng(await candidate.bundle.resources.read(after.document.assets[variantNext.outputAssetId].sha256)).rgba)
      .toEqual(transformRgba(new Uint8ClampedArray([200, 100, 50, 255]), variant.tint, variant.brightness))
    await expect(candidate.bundle.resources.read(rootRecord.sha256)).rejects.toThrow(/闭包/)
    expect((await importProject(candidate.originalArchiveBytes, options)).project).toEqual(before)
  })

  it('keeps selected old history in the exact original archive instead of fabricating continuity', async () => {
    const { bundle } = legacyFixture(), options = validation(), current = { ...bundle, project: cloneJson(bundle.project) }
    current.project.document.revision = 1
    const snapshot = { id: 'original-snapshot', ownerSceneId: bundle.project.document.sceneId, lineageId: bundle.project.historyIdentity.lineageId, sourceRevision: 0,
      name: 'Original old pixels', kind: 'named' as const, createdAt: '2026-11-05T00:00:00.000Z', contentHash: projectContentHash(bundle.project), bundle }
    const bytes = await exportHistoryArchive({ current, snapshots: [snapshot] }, options)
    const candidate = await prepareLegacySvgMigrationCandidate(bytes, 'history', options, context())
    expect(candidate.preservedSnapshotIds).toEqual(['original-snapshot'])
    expect((await importHistoryArchive(candidate.originalArchiveBytes, options)).snapshots[0].bundle.project).toEqual(bundle.project)
    expect(candidate.bundle.project.historyIdentity.lineageId).not.toBe(snapshot.lineageId)
    await expect(importHistoryArchive(candidate.archiveBytes, options)).rejects.toThrow()
  })

  it('requires exact old pixels before invoking canonical rerasterization and never mutates caller bytes', async () => {
    const { bundle } = legacyFixture(), options = validation(), bytes = await exportProject(bundle, options), before = bytes.slice()
    const canonical = vi.fn(options.svg!.rasterize); options.svg!.rasterize = canonical
    options.legacySvg!.rasterize = async () => ({ width: 1, height: 1, rgba: new Uint8ClampedArray([0, 0, 0, 255]) })
    await expect(prepareLegacySvgMigrationCandidate(bytes, 'complete', options, context())).rejects.toThrow(/实际栅格像素/)
    expect(canonical).not.toHaveBeenCalled(); expect(bytes).toEqual(before)
    const missing = validation(); delete missing.legacySvg
    await expect(prepareLegacySvgMigrationCandidate(bytes, 'complete', missing, context())).rejects.toThrow(/显式/)
  })

  it('rejects unsupported generation records without clearing their meaning', async () => {
    const { bundle } = legacyFixture(), project = bundle.project, options = validation()
    project.document.generation.legacy.constraints.port = { id: 'port', floorId: project.document.props.item.floorId, visibility: 'gm', strength: 'hard', kind: 'port', positionMm: { x: 1000, y: 1000 }, directionDeg: 0, widthMm: 2000 }
    project.historyIdentity = createHistoryIdentity(project.document, context('original'))
    const bytes = await exportProject(bundle, options), before = cloneJson(project)
    await expect(prepareLegacySvgMigrationCandidate(bytes, 'complete', options, context())).rejects.toMatchObject({ code: 'legacy-svg-migration-unsupported', paths: ['generation.legacy.constraints'] })
    expect(project).toEqual(before)
  })

  it('rejects a source that cannot get a distinct fixed identity and rejects reused allocated identities', async () => {
    const { bundle } = legacyFixture(), project = bundle.project, options = validation()
    addPropAppearanceSource(project.appearance, { ...cloneJson(project.document.props.item), definitionRef: null, appearance: { kind: 'symbol', symbol: 'chair', tint: null, opacity: 1 } })
    const bytes = await exportProject(bundle, options)
    await expect(prepareLegacySvgMigrationCandidate(bytes, 'complete', options, context())).rejects.toMatchObject({ code: 'legacy-svg-migration-unsupported' })
    await expect(prepareLegacySvgMigrationCandidate(bytes, 'complete', options, { ...context(), ids: { nextId: () => project.document.sceneId } })).rejects.toThrow(/身份无效|重复/)
  })

  it('captures archive and rasterizer inputs before awaits and returns no candidate after cancellation', async () => {
    const { bundle } = legacyFixture(), options = validation(), bytes = await exportProject(bundle, options), before = bytes.slice()
    const migrating = prepareLegacySvgMigrationCandidate(bytes, 'complete', options, context())
    bytes.fill(0); options.svg!.rasterize = async () => { throw new Error('changed callable') }
    expect((await migrating).originalArchiveBytes).toEqual(before)
    const cancelled = validation(), signal = { aborted: false }, original = cancelled.svg!.rasterize
    cancelled.signal = signal; cancelled.svg!.rasterize = async (...args) => { const result = await original(...args); signal.aborted = true; return result }
    await expect(prepareLegacySvgMigrationCandidate(before, 'complete', cancelled, context())).rejects.toMatchObject({ name: 'AbortError' })
  })
})
