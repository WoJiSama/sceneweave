import { visualBase } from '../../src/shared/visual/base.js'
import type { EditableProject } from '../../src/application/workspace/project'
import { fromBundle, toBundle } from '../../src/application/workspace/project'
import { Workspace } from '../../src/application/workspace/workspace'
import { createVisualSampleProject } from '../../src/platform/browser/content/visual-samples'
import { exportPng, exportPublicViewportPng } from '../../src/platform/browser/render/renderer'
import { ProjectRepository } from '../../src/platform/browser/storage/repository'
import { runtime, validation } from '../../src/platform/browser/runtime'
import { createCompositionContent } from '../../src/shared/appearance/graph'
import { projectScene } from '../../src/shared/projection/projection'
import { exportProject, importProject } from '../../src/shared/project/file'
import { projectContentHash } from '../../src/shared/project/validate'
import { sha256Bytes } from '../../src/shared/validation/hash'
import { canonicalJson } from '../../src/shared/validation/json'
import type { SceneDocument } from '../../src/shared/model/scene'
import { readActualPng } from './m2-joint-browser'

async function png(blob: Blob) {
  const value = await readActualPng(blob)
  return { width: value.width, height: value.height, rgbaHash: value.rgbaHash, bytes: value.bytes, chunks: value.chunks,
    containsMetadata: /SECRET-VISUAL|sceneweave-complete-project|generationMetadata/.test(value.rawText) }
}
async function resourceHashes(project: EditableProject) {
  const hashes = new Set([...Object.keys(project.assets), ...Object.values(project.authoringSources).flatMap(source => [source.sourceSha256, source.normalizedSha256])])
  return Object.fromEntries(await Promise.all([...hashes].sort().map(async hash => [hash, sha256Bytes(await project.resources.read(hash))])))
}
export async function inspectVisualResourceClosure(project: EditableProject) {
  return { hashes: await resourceHashes(project), sources: structuredClone(project.authoringSources),
    assets: structuredClone(project.assets), licenses: structuredClone(project.licenses), licenseBindings: structuredClone(project.licenseBindings) }
}
export async function stageVisualRoundTrip(project: EditableProject) {
  const bundle = toBundle(project), bytes = await exportProject(bundle, validation)
  return { bytes, contentHash: projectContentHash(bundle.project), visual: canonicalJson(project.document.visual),
    hashes: await resourceHashes(project), sources: canonicalJson(project.authoringSources), licenses: canonicalJson(project.licenses),
    assets: Object.keys(project.assets).length, authoringSources: Object.keys(project.authoringSources).length,
    gm: await png(await exportPng(bundle, { audience: 'gm', longEdgePx: 4096 })),
    player: await png(await exportPng(bundle, { audience: 'player', longEdgePx: 4096 })) }
}
export async function finishVisualRoundTrip(stage: Awaited<ReturnType<typeof stageVisualRoundTrip>>) {
  const imported = await importProject(stage.bytes, validation), name = `visual-offline-${crypto.randomUUID()}`
  let repository = new ProjectRepository({ name, validation, runtime })
  try {
    await repository.save(imported, null); repository.close()
    repository = new ProjectRepository({ name, validation, runtime })
    const loaded = await repository.load(imported.project.document.sceneId)
    if (!loaded) throw new Error('Offline visual cold load lost saved project')
    const project = await fromBundle(loaded, validation)
    const workspace = new Workspace(repository, { validation, runtime }); await workspace.openPersisted(project)
    const active = workspace.getState().project!
    const result = { contentHash: projectContentHash(toBundle(active).project), visual: canonicalJson(active.document.visual),
      hashes: await resourceHashes(active), sources: canonicalJson(active.authoringSources), licenses: canonicalJson(active.licenses),
      schemaVersion: active.schemaVersion, sceneSchemaVersion: active.document.schemaVersion,
      gm: await png(await exportPng(toBundle(active), { audience: 'gm', longEdgePx: 4096 })),
      player: await png(await exportPng(toBundle(active), { audience: 'player', longEdgePx: 4096 })),
      assets: Object.keys(active.assets).length, authoringSources: Object.keys(active.authoringSources).length }
    await workspace.close()
    return result
  } finally {
    repository.close()
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
  }
}

/** Changes only private geometry/effects; public projection and public crop must remain byte-identical. */
async function secretPair() {
  const original = await createVisualSampleProject('interior'), source = toBundle(original), variants = []
  for (const variant of ['a', 'b'] as const) {
    const document = structuredClone(source.project.document), alternate = variant === 'b', visual = visualBase(document)!
    const floorId = Object.keys(document.floors)[0], layerId = Object.keys(document.userLayers)[0]
    const privateProp = Object.values(document.props).find(prop => prop.roomId === 'inn-bedroom')!
    privateProp.visibility = 'gm'; privateProp.blocksSight = true
    privateProp.rotationDeg = alternate ? 90 : 0
    privateProp.positionMm.x += alternate ? 350 : 0
    privateProp.shadowOverride = { color: alternate ? '#00FF00' : '#FF0000', opacity: .6, directionDeg: alternate ? 5 : 160, offsetMm: alternate ? 700 : 200, blurMm: 35 }
    const common = { floorId, layerId, visibility: 'gm' as const, editLocked: false }
    document.regions['fixed-private-bedroom-mask'] = { id: 'fixed-private-bedroom-mask', floorId, editLocked: false, kind: 'manualMask', visibility: 'gm',
      boundaryMm: [{ x: 11000, y: 1000 }, { x: 19500, y: 1000 }, { x: 19500, y: 14000 }, { x: 11000, y: 14000 }], blocksMovement: false, movementCostMultiplier: 1 }
    document.entityLayers['fixed-private-bedroom-mask'] = layerId
    visual.lights['SECRET-VISUAL-light'] = { ...common, id: 'SECRET-VISUAL-light', positionMm: { x: alternate ? 9000 : 13000, y: 6000 }, radiusMm: alternate ? 6000 : 2500, color: alternate ? '#0066FF' : '#FF3300', intensity: .9, wallOcclusion: true, enabled: true }
    visual.fogs['SECRET-VISUAL-fog'] = { ...common, id: 'SECRET-VISUAL-fog', boundaryMm: [{ x: 1000, y: 1000 }, { x: alternate ? 18000 : 8000, y: 1000 }, { x: alternate ? 18000 : 8000, y: 11000 }, { x: 1000, y: 11000 }], color: alternate ? '#AA22BB' : '#22AA99', opacity: .6, directionDeg: alternate ? 30 : 120, scaleMm: 1800, seed: `SECRET-VISUAL-${variant}`, enabled: true }
    visual.filters['SECRET-VISUAL-filter'] = { ...common, id: 'SECRET-VISUAL-filter', target: { kind: 'scene' }, preset: alternate ? 'cool' : 'warm', exposure: alternate ? .5 : 1.4, saturation: .7, contrast: 1.2, grain: .03, vignette: .3, seed: `SECRET-VISUAL-${variant}`, enabled: true }
    // Even a public selective filter must not derive its mask from private objects.
    visual.filters['public-secret-target'] = { ...common, visibility: 'public', id: 'public-secret-target', target: { kind: 'entities', ids: [privateProp.id] }, preset: 'moonlight', exposure: 1, saturation: .5, contrast: 1, grain: .03, vignette: 0, seed: 'fixed-public', enabled: true }
    document.generationMetadata = { generatorVersion: 'visual-browser-fixture', seed: `SECRET-VISUAL-${variant}`, summary: `SECRET-VISUAL-${variant}`, adoptedAt: document.updatedAt }
    const content = createCompositionContent(document, runtime)
    variants.push(await fromBundle({ project: { ...source.project, ...content }, resources: source.resources }, validation))
  }
  return { a: variants[0], b: variants[1] }
}
export async function verifyVisualPrivacy() {
  const pair = await secretPair(), result = []
  for (const project of [pair.a, pair.b]) {
    const bundle = toBundle(project), projected = projectScene(project.document, 'player')
    result.push({ gm: await png(await exportPng(bundle, { audience: 'gm', longEdgePx: 1024 })),
      player: await png(await exportPng(bundle, { audience: 'player', longEdgePx: 1024 })),
      crop: await png(await exportPublicViewportPng(bundle, { x: 2000, y: 2000, width: 15000, height: 10000 }, 768)),
      projectedText: canonicalJson(projected), privateProp: Object.values(project.document.props).find(prop => prop.visibility === 'gm')!.id })
  }
  return { a: result[0], b: result[1] }
}

export function unchangedVisualScope(document: SceneDocument) {
  const { visual: _visual, revision: _revision, updatedAt: _updatedAt, terrainAreas: _areas, ...rest } = document
  const visual = visualBase(document)
  return { physicalAndMetadata: rest, bank: visual?.boundaries['beach-bank'], environment: visual?.environment,
    lights: visual?.lights, fogs: visual?.fogs, filters: visual?.filters,
    effectsOtherThanCoast: Object.values(visual?.edgeLooks ?? {}).filter(edge => edge.boundaryId !== 'beach-coast'),
    surfaces: Object.fromEntries(Object.entries(document.terrainAreas).map(([id, area]) => { const { boundaryMm: _boundary, ...surface } = area; return [id, surface] })) }
}
