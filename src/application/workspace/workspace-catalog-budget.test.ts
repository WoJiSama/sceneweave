import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { catalogAdditionCost, CATALOG_ADOPTION_LIMIT } from './catalog-budget.js'
import { captureEditableDraft, fromBundle, toBundle, validateEditableProject, type EditableProject } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'
import { topDownPresentation } from '../../shared/appearance/presentation.js'

const repositories: ProjectRepository[] = []
const workspaces: Workspace[] = []

afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) {
    const name = repository.database.name
    repository.close()
    await Dexie.delete(name)
  }
})

/** Construct an independently valid catalog directly, without batch preparation.
 * Every new definition retains a real fixed source and an explicit license,
 * while its actual image bytes are reused from the existing verified project. */
function appendFixedDefinitions(base: EditableProject, count: number): EditableProject {
  const candidate = captureEditableDraft(base)
  const existing = candidate.document.propDefinitions.definition
  const license = candidate.licenseBindings.find(binding => binding.subjectKind === 'propDefinition' && binding.subjectId === existing.id)!
  for (let index = 0; index < count; index++) {
    const id = `catalog-budget-definition-${index}`, sourceId = `catalog-budget-source-${index}`
    const definition = { ...structuredClone(existing), id, catalogId: id, name: `Catalog budget fixture ${index}` }
    candidate.document.propDefinitions[id] = definition
    candidate.appearance.sources[sourceId] = { id: sourceId, kind: 'prop', parentSourceId: null, snapshot: {
      definitionRef: { id, version: definition.version }, appearance: structuredClone(definition.defaultAppearance),
      visualBoundsMm: structuredClone(definition.defaultVisualBoundsMm), shadowClass: definition.defaultShadowClass, shadowOverride: null,
    } }
    candidate.appearance.presentations![sourceId] = topDownPresentation()
    candidate.licenseBindings.push({ ...license, subjectId: id })
  }
  return candidate
}

describe('public prepared catalog adoption budget', () => {
  it('rejects a fully valid oversized catalog without history or saved residue and preserves another pending preview', async () => {
    const repository = new ProjectRepository({ name: `workspace-catalog-budget-${crypto.randomUUID()}`, runtime, validation })
    repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation })
    workspaces.push(workspace)
    const base = await fromBundle(fixture({ image: true }), validation)
    await workspace.adoptNew(base)
    const initial = workspace.getState().project!, checkpoint = workspace.checkpoint()
    const initialHash = projectContentHash(toBundle(initial).project)

    // Both candidates bypass prepareAssetBatchImport, so this checks the public
    // workspace authority rather than preparation's earlier cost rejection.
    const small = await validateEditableProject(appendFixedDefinitions(initial, 1), validation)
    const pending = await workspace.previewPrepared(small, 'Previously valid catalog', checkpoint)
    const oversized = await validateEditableProject(appendFixedDefinitions(initial, 86), validation)
    expect(catalogAdditionCost(initial, oversized)).toBeGreaterThan(CATALOG_ADOPTION_LIMIT)
    await expect(workspace.previewPrepared(oversized, 'Oversized direct catalog', checkpoint)).rejects.toThrow(/超过256.*整批未采用/)

    expect(workspace.getState()).toMatchObject({ project: initial, status: 'saved', canUndo: false, canRedo: false })
    expect(workspace.getState().project).toBe(initial)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(projectContentHash((await repository.load(initial.document.sceneId))!.project)).toBe(initialHash)

    await workspace.adoptPreview(pending)
    await workspace.flush()
    expect(workspace.getDocument()!.propDefinitions['catalog-budget-definition-0']).toBeDefined()
    expect(workspace.getDocument()!.propDefinitions['catalog-budget-definition-85']).toBeUndefined()
    const saved = (await repository.load(initial.document.sceneId))!.project
    expect(Object.keys(saved.document.propDefinitions)).toHaveLength(Object.keys(initial.document.propDefinitions).length + 1)
    expect(workspace.getState().canUndo).toBe(true)
    workspace.undo()
    expect(workspace.getDocument()!.propDefinitions).toEqual(initial.document.propDefinitions)
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true })
  })
})
