import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../../../platform/browser/content/refined-blank.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { applyCommands } from '../../../commands/commands.js'
import { terrainCommandCost } from '../../../terrain-generation/cost.js'
import type { SceneDocument } from '../../../model/scene.js'
import { cloneJson } from '../../../validation/json.js'
import { reviewSavedInterior } from './review.js'
import { normalizeInteriorInput, runInteriorGeneration, type InteriorGenerationInput } from './index.js'

const profile = taskBudgetProfile('standard')
const options = { profile, nowMilliseconds: () => 0 }
const source = () => createRefinedBlankDocument('interior', { title: '活动空间', sceneId: 'interior-program-test',
  now: '2026-11-27T00:00:00.000Z', widthMm: 19500, heightMm: 21000, preset: 'narrative' })
function request(): InteriorGenerationInput {
  return { version: 1, algorithmVersion: 23, seed: 'border-waystation', parameters: {
    floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 1101, y: 1101, width: 17298, height: 18798 }, wallThicknessMm: 180,
    rooms: [
      { id: 'hall', purpose: '公共大厅', minAreaMm2: 72e6, maxAreaMm2: 170e6, minClearSideMm: 6500 },
      { id: 'kitchen', purpose: '厨房', minAreaMm2: 22e6, maxAreaMm2: 75e6, minClearSideMm: 3200 },
      { id: 'guest-a', purpose: '客房一', minAreaMm2: 13e6, maxAreaMm2: 45e6, minClearSideMm: 2900 },
      { id: 'guest-b', purpose: '客房二', minAreaMm2: 13e6, maxAreaMm2: 45e6, minClearSideMm: 2900 },
    ],
    relations: [], corridor: { axis: 'horizontal', clearWidthMm: 1800 }, materials: { floor: null, wall: null },
    arrangement: { doors: true, entrance: true, furniture: true, doorWidthMm: 1100, clearWidthMm: 1100,
      palette: [
        { role: 'table', ref: { id: 'refined-prop-interior-table-long', version: 1 } },
        { role: 'seat', ref: { id: 'refined-prop-interior-chair-slat', version: 1 } },
        { role: 'work', ref: { id: 'refined-prop-interior-counter-kitchen', version: 1 } },
      ] },
    program: { corridorId: 'public-corridor', roomLabels: true,
      entrances: [{ id: 'front', role: 'main', roomId: 'hall', side: 'south', widthMm: 1800 }, { id: 'loading', role: 'service', roomId: 'kitchen', side: 'north', widthMm: 1400 }],
      connections: [{ a: 'hall', b: 'public-corridor', widthMm: 2400 }, { a: 'hall', b: 'kitchen' },
        { a: 'public-corridor', b: 'guest-a' }, { a: 'public-corridor', b: 'guest-b' }],
      furnishings: [{ roomId: 'hall', seatingGroups: 2, counterNextTo: 'kitchen' }],
    },
  } }
}

describe('structure, furnishings and saved circulation from one indoor program', () => {
  it('materializes and independently checks two entries, a wide shared door and complete spaced groups', () => {
    const result = runInteriorGeneration(source(), request(), options)
    const scene = cloneJson(result.candidate.document) as SceneDocument
    const report = result.report.connectivity
    expect(report.routes).toHaveLength(6)
    expect(report.routes.every(route => route.status === 'clear' && route.widthMm === 1100)).toBe(true)
    expect(report.entrances?.map(row => row.side).sort()).toEqual(['north', 'south'])
    const wide = Object.values(scene.openings).find(row => row.widthMm === 2400)!
    expect(wide.presentation).toMatchObject({ kind: 'double' })
    expect(Object.values(scene.openings).filter(item => item.kind === 'window').length).toBeGreaterThan(0)
    expect(Object.keys(scene.notes)).toHaveLength(5)
    const layoutRule = Object.values(scene.generation.legacy.rules)[0]
    expect(terrainCommandCost(source(), scene).items['generation.rules']).toBe(1 + layoutRule.outputs.length + layoutRule.inputs.length)
    const review = reviewSavedInterior(scene, 'visual-floor', result.input.seed, profile)
    expect(review.issues).toEqual([])
    expect(review.furnishings[0].groups.map(group => group.seatIds.length)).toEqual([4, 4])
    expect(review.furnishings[0].counterId).toBeTruthy()
    const closed = applyCommands(scene, [{ type: 'updateOpening', id: wide.id, changes: { state: 'closed' } }],
      { ids: { nextId: () => 'unused' }, clock: { now: () => scene.updatedAt } })
    expect(terrainCommandCost(scene, closed).items['generation.rules']).toBe(1)
    expect(reviewSavedInterior(closed, 'visual-floor', result.input.seed, profile).issues).toContainEqual(expect.stringContaining('2400 mm'))
  }, 30000)

  it('rejects a narrow requested passage, missing space and accidental use with an older version', () => {
    const invalid = request()
    invalid.parameters.corridor.clearWidthMm = 900
    expect(() => normalizeInteriorInput(invalid)).toThrow(/走廊净宽/)
    const missing = request()
    missing.parameters.program!.entrances![0].roomId = 'missing'
    expect(() => normalizeInteriorInput(missing)).toThrow(/missing/)
    expect(() => normalizeInteriorInput({ ...request(), algorithmVersion: 22 })).toThrow(/算法版本/)
  })
})
