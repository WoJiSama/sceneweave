import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { inspectFillCopy } from '../../application/workspace/fill-copy.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent, resolveAppearance } from '../appearance/graph.js'
import { manualTransactionBudget } from '../budget/command-budget.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { buildRestorePlan } from '../history/restore.js'
import { StructureContinuitySession } from '../history/structure-continuity.js'
import { buildStructureRestorePlan, inspectStructureRestoreScope } from '../history/structure-restore.js'
import { cloneJson } from '../validation/json.js'
import { applyCommands, type SceneCommand } from './commands.js'
import { previewLayerMove } from './layers.js'

function populated(count: number) {
  const source = fixture().project.document, template = cloneJson(source.props.item), layerId = source.entityLayers.item
  source.props = {}; source.entityLayers = {}
  for (let index = 0; index < count; index++) {
    const id = `tier-item-${index}`
    source.props[id] = { ...cloneJson(template), id, positionMm: { x: 1000 + index % 100 * 100, y: 1000 + Math.floor(index / 100) * 400 } }
    source.entityLayers[id] = layerId
  }
  return { source, ids: Object.keys(source.props), layerId }
}

describe('manual tiers propagate through transaction parsers', () => {
  const standard = manualTransactionBudget('standard')

  it('expands only explicit manual raw batches and retains the legacy and task-profile command limits', () => {
    const source = fixture().project.document
    const commands: SceneCommand[] = Array.from({ length: 257 }, () => ({ type: 'updateProp', id: 'item', changes: { rotationDeg: source.props.item.rotationDeg } }))
    expect(() => applyCommands(source, commands, runtime)).toThrow(/256/)
    expect(() => applyCommands(source, commands, runtime, { budget: taskBudgetProfile('small') })).toThrow(/256/)
    expect(applyCommands(source, commands, runtime, { budget: standard }).props.item).toEqual(source.props.item)
    const content = createCompositionContent(source, runtime)
    expect(() => applyCompositionCommands(content, commands, runtime)).toThrow(/256/)
    expect(applyCompositionCommands(content, commands, runtime, { budget: standard }).document.props.item).toEqual(source.props.item)
    expect(() => applyCommands(source, Array.from({ length: 513 }, () => commands[0]), runtime, { budget: standard })).toThrow(/512/)
    const edits: SceneCommand[] = [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 30 } }, { type: 'updateProp', id: 'other', changes: { rotationDeg: 15 } }]
    expect(applyCompositionCommands(content, edits, runtime, { budget: standard })).toEqual(applyCompositionCommands(content, edits, runtime))
  })

  it('allows a 257-target layer command and real appearance scope while preserving default prechecks and locks', () => {
    const { source, ids, layerId } = populated(257)
    source.userLayers.target = { id: 'target', floorId: 'blank-floor', name: '目标', order: 1, editLocked: false }
    expect(previewLayerMove(source, ids, 'target').reason).toMatch(/256/)
    expect(previewLayerMove(source, ids, 'target', standard).reason).toBeNull()
    const moved = applyCommands(source, [{ type: 'moveEntitiesToLayer', ids, layerId: 'target' }], runtime, { budget: standard })
    expect(ids.every(id => moved.entityLayers[id] === 'target')).toBe(true)
    const content = createCompositionContent(source, runtime)
    const command = { type: 'setAppearanceAdjustment' as const, scope: { kind: 'targets' as const, ids }, adjustment: { id: 'fade', kind: 'opacity' as const, value: .5, enabled: true } }
    expect(() => applyCompositionCommands(content, [command], runtime)).toThrow(/256/)
    const adjusted = resolveAppearance(applyCompositionCommands(content, [command], runtime, { budget: standard }))
    expect(ids.every(id => adjusted.document.props[id].appearance.opacity === .5)).toBe(true)
    source.userLayers[layerId].editLocked = true
    expect(previewLayerMove(source, ids, 'target', standard).reason).toMatch(/锁定/)
  })

  it.each([{ tier: 'standard' as const, count: 512 }, { tier: 'expanded' as const, count: 1024 }])('admits $count actual layer targets among 2000 retained props under $tier', ({ tier, count }) => {
    const { source, ids } = populated(2000), selected = ids.slice(0, count), budget = manualTransactionBudget(tier)
    source.userLayers.target = { id: 'target', floorId: 'blank-floor', name: '目标', order: 1, editLocked: false }
    const moved = applyCommands(source, [{ type: 'moveEntitiesToLayer', ids: selected, layerId: 'target' }], runtime, { budget })
    expect(selected.every(id => moved.entityLayers[id] === 'target')).toBe(true)
    expect(ids.slice(count).every(id => moved.entityLayers[id] === source.entityLayers[id])).toBe(true)
    expect(() => applyCommands(source, [{ type: 'moveEntitiesToLayer', ids: ids.slice(0, count + 1), layerId: 'target' }], runtime, { budget })).toThrow()
  })

  it('uses the tier for structure recovery selection while retaining continuity and confirmation', () => {
    const document = fixture().project.document, layerId = document.entityLayers.item
    const ids = Array.from({ length: 257 }, (_, index) => `note-${index}`)
    for (const id of ids) {
      document.notes[id] = { id, floorId: 'blank-floor', editLocked: false, anchor: { type: 'point', positionMm: { x: 2000, y: 2000 } }, kind: 'note', text: 'before', visibility: 'gm' }
      document.entityLayers[id] = layerId
    }
    const historic = createCompositionContent(document, runtime), current = cloneJson(historic)
    ids.forEach(id => { current.document.notes[id].text = 'after' })
    const continuity = new StructureContinuitySession()
    continuity.reset(historic.document); continuity.recordSnapshot('snapshot', 'hash', historic.document); continuity.advance(historic.document, current.document)
    const proof = continuity.prove('snapshot', 'hash', current.document, historic.document), request = { ids, mode: 'properties' as const }
    expect(() => inspectStructureRestoreScope(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, proof)).toThrow(/256/)
    const scope = inspectStructureRestoreScope(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, proof, standard)
    const plan = buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity,
      { ...request, acknowledgedDependencyIds: scope.dependencyIds, confirmedLayerIds: scope.requiredLayerIds }, proof, standard)
    expect(plan.commandCost).toBe(257)
    expect(ids.every(id => plan.document.notes[id].text === 'before')).toBe(true)
  })

  it('uses the same tier for explicit history selections and fill candidate counts', () => {
    const { source, ids } = populated(257)
    const historic = createCompositionContent(source, runtime), current = cloneJson(historic)
    for (const id of ids) current.document.props[id].positionMm.x += 100
    const request = { ids, mode: 'transform' as const }
    expect(() => buildRestorePlan(current, historic, request)).toThrow(/256/)
    const restored = buildRestorePlan(current, historic, request, {}, standard)
    expect(restored.commandCost).toBe(257)
    expect(restored.document.props).toEqual(historic.document.props)
    const fillSource = fixture().project.document
    fillSource.floors['blank-floor'].boundsMm.width = 300000
    const fill = { sourceId: 'item', count: 257, stepMm: { x: 1000, y: 0 }, allowOverlap: true }
    expect(inspectFillCopy(fillSource, fill).issues.join(' ')).toMatch(/256/)
    expect(inspectFillCopy(fillSource, fill, standard).issues).toEqual([])
    expect(inspectFillCopy(fillSource, { ...fill, count: 513 }, standard).issues.join(' ')).toMatch(/512/)
  })
})
