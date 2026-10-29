import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { Workspace } from './workspace.js'
import { fromBundle, type EditableProject } from './project.js'
import { fixture, NOW, pixelPng, runtime, validation } from './test-fixtures.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import type { ProjectBundle } from '../../shared/model/project.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { compositionPreset } from '../../shared/terrain-generation/composition-presets.js'

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
type V4Project = EditableProject & {
  schemaVersion: 4
  document: EditableProject['document'] & {
    schemaVersion: 4
    generation: Extract<NonNullable<EditableProject['document']['generation']>, { version: 5 }>
  }
  historyIdentity: EditableProject['historyIdentity'] & {
    version: 3
    terrainTokens: NonNullable<EditableProject['historyIdentity']['terrainTokens']>
  }
}
function asV4(project: EditableProject): V4Project {
  if (project.schemaVersion !== 4 || project.document.schemaVersion !== 4 || project.document.generation?.version !== 5
    || project.historyIdentity.version !== 3 || !project.historyIdentity.terrainTokens) throw new Error('expected complete v4 project')
  return project as V4Project
}

async function blank(): Promise<EditableProject> {
  const document = createRefinedBlankDocument('island', {
    title: 'v4 history fixture', sceneId: runtime.ids.nextId(), now: NOW,
    widthMm: 48000, heightMm: 36000, preset: 'narrative',
  })
  const bytes = pixelPng([74, 108, 61, 255]), hash = sha256Bytes(bytes)
  for (const asset of Object.values(document.assets)) {
    asset.sha256 = hash; asset.mimeType = 'image/png'; asset.pixelWidth = 1; asset.pixelHeight = 1
  }
  const content = createCompositionContent(document, runtime)
  const text = 'Sceneweave v4 history fixture license', licenseHash = sha256Bytes(new TextEncoder().encode(text))
  const bundle: ProjectBundle = {
    project: {
      format: 'sceneweave-complete-project', schemaVersion: 2, ...content,
      assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 } },
      licenses: { [licenseHash]: { sha256: licenseHash, text } },
      licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({
        ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const,
      })),
      authoringSources: {},
    },
    resources: createMemoryResources(new Map([[hash, bytes]])),
  }
  return fromBundle(bundle, validation)
}

afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) {
    const name = repository.database.name
    repository.close()
    await Dexie.delete(name)
  }
})

describe('v4 composition history restoration', () => {
  it('restores frozen composition history through undo and redo without rewriting receipts', async () => {
    const repository = new ProjectRepository({ name: `v4-history-${crypto.randomUUID()}`, runtime, validation })
    repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation })
    workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(fixture({ image: true }), validation))

    const base = await blank(), request = compositionPreset({
      sceneId: base.document.sceneId, seed: 'terrain-compose-0', preset: 'archipelago',
      widthMm: 48000, heightMm: 36000, islandCount: 3,
    }).request
    const preview = await workspace.previewTerrainComposition(base, request)
    await workspace.adoptTerrainGeneration(preview)
    const adopted = asV4(workspace.getState().project!)
    const originalRow = adopted.document.generation!.compositions['t9-composition']
    expect(originalRow.state).toBe('active')
    const originalReceipt = originalRow.outputHash
    const originalToken = adopted.historyIdentity.terrainTokens['t9-composition']

    const moved = adopted.document.terrainAreas['t9-land-0'].boundaryMm[0]
    const originalPointToken = adopted.historyIdentity.outdoorTokens[moved.id]
    await workspace.execute([{ type: 'moveTerrainPoint', areaId: 't9-land-0', pointId: moved.id, positionMm: { x: moved.positionMm.x + 100, y: moved.positionMm.y + 100 } }])
    const edited = asV4(workspace.getState().project!)
    const editedRow = edited.document.generation!.compositions['t9-composition']
    expect(editedRow.state).toBe('paused')
    expect(editedRow.outputHash).toBe(originalReceipt)
    const editedToken = edited.historyIdentity.terrainTokens['t9-composition']
    expect(editedToken.topologyToken).toBe(originalToken.topologyToken)
    expect(edited.historyIdentity.outdoorTokens[moved.id].topologyToken).toBe(originalPointToken.topologyToken)
    expect(Object.isFrozen(adopted.document)).toBe(true)

    expect(() => workspace.undo()).not.toThrow()
    const undone = asV4(workspace.getState().project!)
    const undoneRow = undone.document.generation!.compositions['t9-composition']
    expect(undoneRow.state).toBe('paused')
    expect(undoneRow.outputHash).toBe(originalReceipt)
    expect(undone.document.generation!.checks['t9-land-count-check']?.state).toBe('unchecked')
    const undoneToken = undone.historyIdentity.terrainTokens['t9-composition']
    expect(undoneToken.topologyToken).toBe(editedToken.topologyToken)
    expect(undone.historyIdentity.outdoorTokens[moved.id].topologyToken).toBe(originalPointToken.topologyToken)
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true })
    expect(undone.historyIdentity.terrainTokens['t9-composition'].token).toBe(originalToken.token)

    expect(() => workspace.redo()).not.toThrow()
    const redone = asV4(workspace.getState().project!)
    const redoneRow = redone.document.generation!.compositions['t9-composition']
    expect(redoneRow.state).toBe('paused')
    expect(redoneRow.outputHash).toBe(editedRow.outputHash)
    expect(redone.historyIdentity.terrainTokens['t9-composition'].topologyToken).toBe(undoneToken.topologyToken)
    expect(redone.historyIdentity.outdoorTokens[moved.id].topologyToken).toBe(originalPointToken.topologyToken)
    expect(workspace.getState()).toMatchObject({ canUndo: true, canRedo: false })
    expect(adopted.document.generation.compositions['t9-composition'].state).toBe('active')
    expect(adopted.document.generation.compositions['t9-composition'].outputHash).toBe(originalReceipt)
  })
})
