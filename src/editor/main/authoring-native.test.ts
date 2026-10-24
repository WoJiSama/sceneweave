import { describe, expect, it } from 'vitest'
import data from '../../platform/browser/content/scenes-data.json'
import type { ProjectData } from '../../shared/model/project'
import type { EditableProject } from '../../application/workspace/project'
import { createCompositionContent } from '../../shared/appearance/graph'
import { applyCompositionCommands } from '../../shared/appearance/commands'
import { projectScene } from '../../shared/projection/projection'
import { validateCompositionContent } from '../../shared/validation/content'
import { buildAuthoringPlan, type AuthoringRecipeId } from './authoring-recipes'
import { OUTPOST_IDS } from './outpost-ids'
import { validateOutpostEdits, OUTPOST_PRESET_ID } from './outpost-constraints'

let identitySequence = 0
const context = () => ({ ids: { nextId: () => `native-authoring-${identitySequence++}` }, clock: { now: () => '2026-10-24T00:00:00.000Z' } })
// Geometry-only command checks use independently extracted native templates.
// The byte reader rejects every request: these tests make no image/IO claim.
function blank(allFurniture = false): EditableProject {
  const source = structuredClone(data.scenes.blank) as unknown as ProjectData
  source.document.exportBoundsMm = { x: 0, y: 0, width: 36000, height: 28000 }
  Object.values(source.document.floors)[0].boundsMm = { ...source.document.exportBoundsMm }
  if (allFurniture) {
    const extra = data.scenes.graveyard.document
    for (const field of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) Object.assign(source.document[field], structuredClone(extra[field]))
  }
  return { ...source, ...createCompositionContent(source.document, context()), resources: { read: async () => { throw new Error('No raster IO in this domain-only test.') } } }
}
function complete(input: EditableProject, recipe: AuthoringRecipeId): EditableProject {
  let project = input, rounds = 0
  while (true) {
    const pending = buildAuthoringPlan(project, recipe).stages.find(stage => stage.status !== 'complete')
    if (!pending) return project
    if (++rounds > 40) throw new Error('Native authoring did not converge.')
    expect(pending.status, `${pending.id}: ${pending.reason}`).toBe('ready')
    expect(pending.commands.length).toBeGreaterThan(0)
    expect(pending.commands.length).toBeLessThanOrEqual(256)
    const before = JSON.stringify({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
    const content = applyCompositionCommands({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, pending.commands, context())
    validateCompositionContent(content)
    projectScene(content.document, 'player')
    expect(JSON.stringify({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })).toBe(before)
    project = { ...project, ...content, document: { ...content.document, revision: project.document.revision + 1 } }
  }
}

describe('native main workspace ordinary staged authoring', () => {
  it('keeps SCN-04 building/outdoor/composition/privacy commands on native scene/identity/appearance', () => {
    const project = complete(blank(), 'scn-04'), scene = project.document
    expect(scene).toMatchObject({ format: 'sceneweave-scene', schemaVersion: 1 })
    expect(project.historyIdentity.version).toBe(1)
    expect(Object.keys(scene.rooms)).toHaveLength(2)
    expect(Object.keys(scene.walls)).toHaveLength(7)
    expect(Object.keys(scene.openings)).toHaveLength(2)
    expect(scene.terrainAreas[OUTPOST_IDS.high].groundElevationMm).toBe(3000)
    expect(scene.terrainConnections[OUTPOST_IDS.connection].widthMm).toBe(2000)
    expect(scene.prefabInstances[OUTPOST_IDS.deskGroup]).toBeDefined()
    expect(projectScene(scene, 'player').notes.some(note => note.id === OUTPOST_IDS.secretNote)).toBe(false)
    const diagnostic = structuredClone(scene)
    diagnostic.presetSnapshot.presetId = OUTPOST_PRESET_ID
    expect(() => validateOutpostEdits(diagnostic)).not.toThrow()
    expect(scene.presetSnapshot.presetId).not.toBe(OUTPOST_PRESET_ID)
  }, 30000)

  it('keeps the seven-room SCN-01 finite steps, fixed furniture and independent secret clues', () => {
    const project = complete(blank(true), 'scn-01'), scene = project.document
    expect(Object.keys(scene.rooms)).toHaveLength(7)
    expect(Object.values(scene.openings).filter(opening => opening.kind === 'door')).toHaveLength(9)
    expect(Object.keys(scene.props)).toHaveLength(19)
    expect(Object.keys(scene.prefabInstances)).toHaveLength(2)
    expect(scene.props['H4-bed'].definitionRef).toEqual({ id: 'content-p-bed-single', version: 1 })
    expect(scene.props['H4-bed'].footprintMm).toEqual({ width: 1100, height: 2100 })
    expect(Object.values(scene.notes).map(note => note.visibility)).toEqual(['gm', 'gm', 'gm'])
    expect(projectScene(scene, 'player').notes).toEqual([])
    expect(buildAuthoringPlan(project, 'scn-01').missingCatalogIds).toEqual([])
  }, 30000)
})
