import { describe, expect, it } from 'vitest'
import { assertDoorwayClearancesV2 } from '../../core/v2/doorway-clearance'
import { openingEndpointsV2 } from '../../core/v2/geometry'
import { geometryDocumentForValidationV3 } from '../../core/v3/domain'
import { applyCompositionCommandsV6 } from '../../core/v6/commands'
import { createCompositionContentV6 } from '../../core/v6/graph'
import { validateCompositionContentV6 } from '../../core/v6/schema'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { projectSceneV3 } from '../../render/v3/projection'
import { buildAuthoringPlanV6, type AuthoringRecipeIdV6 } from './authoring-recipes'
import { createOutdoorBlankDocument } from './blank-project'
import { OUTPOST_DOORWAYS, OUTPOST_PRESET_ID, validateOutpostEditsV3 } from './outpost-constraints'
import { OUTPOST_IDS } from './outpost-project'
import { appendThemedCatalogDocument } from './themed-catalog'

// These tests exercise real finite command/domain/projection gates. The empty
// resource wrapper deliberately makes no claim about bitmap IO or visual QA.
function blank(): CompleteProjectV6 {
  return { ...createCompositionContentV6(createOutdoorBlankDocument({ title: '分步制作', widthMm: 36000, heightMm: 28000, preset: 'investigation', sceneId: 'authoring-test' })), assets: {}, licenses: {}, licenseBindings: [] }
}
const apply = (project: CompleteProjectV6, commands: Parameters<typeof applyCompositionCommandsV6>[1]) => applyCompositionCommandsV6({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, commands)
function adopt(project: CompleteProjectV6, id: AuthoringRecipeIdV6) {
  const before = structuredClone(project), plan = buildAuthoringPlanV6(project, id), stage = plan.stages.find(stage => stage.status !== 'complete')
  if (!stage || stage.status !== 'ready') throw new Error(`${stage?.id}: ${stage?.reason ?? stage?.status ?? 'complete'}`)
  expect(stage.commands.length).toBeGreaterThan(0)
  expect(stage.commands.length).toBeLessThanOrEqual(256)
  const content = apply(project, stage.commands)
  expect(() => validateCompositionContentV6(content)).not.toThrow()
  expect(() => projectSceneV3(content.document, 'player')).not.toThrow()
  expect(project).toEqual(before)
  return { ...project, ...content, document: { ...content.document, revision: project.document.revision + 1 } }
}

describe('scene authoring recipes use ordinary explicit staged commands', () => {
  it('constructs the prescribed SCN-04 through finite previews from geometric blank', () => {
    let project = blank(), count = 0
    while (buildAuthoringPlanV6(project, 'scn-04').stages.some(stage => stage.status !== 'complete')) {
      if (++count > 40) throw new Error('制作步骤未收敛。')
      project = adopt(project, 'scn-04')
    }
    const scene = project.document
    expect(Object.keys(scene.rooms)).toHaveLength(2)
    expect(Object.keys(scene.walls)).toHaveLength(7)
    expect(Object.keys(scene.openings)).toHaveLength(2)
    expect(scene.exportBoundsMm).toEqual({ x: 0, y: 0, width: 36000, height: 28000 })
    expect(scene.rooms[OUTPOST_IDS.room].groundElevationMm).toBe(1000)
    expect(scene.terrainAreas[OUTPOST_IDS.high].groundElevationMm).toBe(3000)
    expect(scene.terrainConnections[OUTPOST_IDS.connection].widthMm).toBe(2000)
    expect(scene.prefabInstances[OUTPOST_IDS.deskGroup]).toBeDefined()
    expect(Object.values(scene.scatterGroups).every(group => Object.keys(group.members).length > 0)).toBe(true)
    expect(scene.notes[OUTPOST_IDS.secretNote].visibility).toBe('gm')
    expect(projectSceneV3(scene, 'player').notes.some(note => note.id === OUTPOST_IDS.secretNote)).toBe(false)
    expect(() => assertDoorwayClearancesV2(geometryDocumentForValidationV3(scene), OUTPOST_DOORWAYS)).not.toThrow()
    // The opt-in sample checker is evaluated on a detached diagnostic copy;
    // the recipe never forges preset provenance in the saved project.
    const diagnostic = structuredClone(scene)
    diagnostic.presetSnapshot = { ...diagnostic.presetSnapshot, presetId: OUTPOST_PRESET_ID }
    expect(() => validateOutpostEditsV3(diagnostic)).not.toThrow()
    expect(scene.presetSnapshot.presetId).not.toBe(OUTPOST_PRESET_ID)
  }, 30000)

  it('builds the exact seven-room/nine-door SCN-01 baseline then refuses missing real furniture', () => {
    let project = blank(), count = 0
    while (true) {
      const plan = buildAuthoringPlanV6(project, 'scn-01'), stage = plan.stages.find(stage => stage.status !== 'complete')!
      if (stage.status === 'blocked') {
        expect(stage.id).toBe('house-furnishings')
        expect(stage.reason).toContain('bench')
        expect(plan.missingCatalogIds).toHaveLength(7)
        break
      }
      if (++count > 15) throw new Error('制作步骤未在缺素材处停下。')
      project = adopt(project, 'scn-01')
    }
    const scene = project.document
    expect(Object.keys(scene.rooms)).toHaveLength(7)
    expect(Object.values(scene.openings).filter(opening => opening.kind === 'door')).toHaveLength(9)
    expect(Object.values(scene.openings).filter(opening => opening.kind === 'window')).toHaveLength(3)
    expect(scene.exportBoundsMm).toEqual({ x: -500, y: -500, width: 19000, height: 15000 })
    expect(scene.rooms.HS.visibility).toBe('gm')
    expect(scene.rooms.HS.accessExpectation).toBe('required')
    expect(openingEndpointsV2(geometryDocumentForValidationV3(scene), scene.openings['outside-H1'])).toEqual([{ x: 8400, y: 0 }, { x: 9600, y: 0 }])
    expect(scene.openings['H5-HS']).toMatchObject({ secret: true, revealed: false, state: 'closed' })
    expect(Object.keys(scene.props)).toHaveLength(0)
    expect(() => projectSceneV3(scene, 'player')).not.toThrow()
    expect(() => assertDoorwayClearancesV2(geometryDocumentForValidationV3(scene), Object.values(scene.openings).filter(opening => opening.kind === 'door').map(opening => ({ openingId: opening.id, minWidthMm: opening.id === 'outside-H1' ? 1200 : 900, approachDepthMm: 900 })))).not.toThrow()
  }, 30000)

  it('completes SCN-01 with the actual seven fixed interior definitions and independent private clues', () => {
    const initial = blank()
    appendThemedCatalogDocument(initial.document)
    let project: CompleteProjectV6 = { ...initial, ...createCompositionContentV6(initial.document) }, count = 0
    while (buildAuthoringPlanV6(project, 'scn-01').stages.some(stage => stage.status !== 'complete')) {
      if (++count > 25) throw new Error('完整雾灯宅制作步骤未收敛。')
      project = adopt(project, 'scn-01')
    }
    const scene = project.document
    expect(Object.keys(scene.props)).toHaveLength(19)
    expect(Object.keys(scene.prefabInstances)).toHaveLength(2)
    expect(scene.props['H4-bed'].definitionRef).toEqual({ id: 'content-p-bed-single', version: 1 })
    expect(scene.props['H4-bed'].footprintMm).toEqual({ width: 1100, height: 2100 })
    expect(scene.props['H2-stove'].definitionRef).toEqual({ id: 'content-p-hearth', version: 1 })
    expect(Object.values(scene.notes).map(note => note.visibility)).toEqual(['gm', 'gm', 'gm'])
    expect(projectSceneV3(scene, 'player').notes).toEqual([])
    expect(() => assertDoorwayClearancesV2(geometryDocumentForValidationV3(scene), Object.values(scene.openings).filter(opening => opening.kind === 'door').map(opening => ({ openingId: opening.id, minWidthMm: opening.id === 'outside-H1' ? 1200 : 900, approachDepthMm: 900 })))).not.toThrow()
    expect(buildAuthoringPlanV6(project, 'scn-01').missingCatalogIds).toEqual([])
  }, 30000)

  it('blocks unrelated existing geometry and a locked target layer without changing the branch', () => {
    const input = blank()
    const foreign = { ...input, ...apply(input, [{ type: 'addProp', id: 'existing-user-desk', floorId: 'blank-floor', definitionRef: { id: 'b2-p-01', version: 1 }, positionMm: { x: 6000, y: 6000 } }]) }
    const snapshot = structuredClone(foreign)
    expect(buildAuthoringPlanV6(foreign, 'scn-04').stages[0]).toMatchObject({ status: 'blocked', reason: expect.stringContaining('已有其他几何') })
    expect(foreign).toEqual(snapshot)
    const locked = { ...input, ...apply(input, [{ type: 'setLayerLock', id: 'layer-default-0', locked: true }]) }
    expect(buildAuthoringPlanV6(locked, 'scn-04').stages.find(stage => stage.status === 'blocked')?.reason).toContain('未锁定')
  })

  it('derives incomplete status from real content and refuses partial or edited stages', () => {
    let input = blank()
    input = adopt(input, 'scn-04')
    expect(buildAuthoringPlanV6(input, 'scn-04').stages.find(stage => stage.id === 'outpost-water-create')?.status).toBe('complete')
    const edited = { ...input, ...apply(input, [{ type: 'setTerrainElevation', id: OUTPOST_IDS.water, groundElevationMm: -500 }]) }
    const stage = buildAuthoringPlanV6(edited, 'scn-04').stages.find(stage => stage.id === 'outpost-water-create')!
    expect(stage).toMatchObject({ status: 'blocked', commands: [], reason: expect.stringContaining('基线不同') })
    expect(edited.document.terrainAreas[OUTPOST_IDS.water].groundElevationMm).toBe(-500)
  })
})
