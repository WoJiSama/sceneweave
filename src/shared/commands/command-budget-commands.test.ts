import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { layerSceneV3, scatterLayerSceneV3 } from '../../core/v3/test-fixtures.js'
import { createCompositionContent, inspectAppearanceScope, resolveAppearance } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { MANUAL_TRANSACTION_BUDGET, measureCommandBudget } from '../budget/command-budget.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import type { CompositionContent } from '../model/appearance.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { materializedBoundaryHash } from '../terrain-generation/integrity.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { visualBase } from '../visual/base.js'
import { applyCommands, type SceneCommand } from './commands.js'
import { previewLayerMove } from './layers.js'

const runtime = () => ({ ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-11-05T00:00:00.000Z' } })
const blank = () => createRefinedBlankDocument('island', { sceneId: 'manual-budget-commands', title: '预算', now: '2026-11-05T00:00:00.000Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
const ring = (count: number) => Array.from({ length: count }, (_, index) => ({ x: Math.round(12000 + 4000 * Math.cos(index * 2 * Math.PI / count)), y: Math.round(9000 + 4000 * Math.sin(index * 2 * Math.PI / count)) }))

describe('explicit ordinary command budgets', () => {
  it('separates a terrain object from its internal points without changing legacy rejection', () => {
    const source = blank(), before = cloneJson(source)
    const command: SceneCommand = { type: 'createTerrainArea', id: 'land', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: ring(200) }
    expect(() => applyCommands(source, [command], runtime())).toThrow(/256/)
    const next = applyCommands(source, [command], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(next.terrainAreas.land.boundaryMm).toHaveLength(200)
    expect(validateSceneDocument(next).ok).toBe(true)
    expect(source).toEqual(before)
  })

  it('passes the explicit budget into materialized visual geometry', () => {
    const source = blank(), start = { x: 4000, y: 4000 }, end = { x: 16000, y: 4000 }
    const boundary = { id: 'edge-source', floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public' as const, editLocked: false,
      closed: false, binding: { kind: 'decoration' as const }, sampleSpacingMm: 2000, toleranceMm: 50,
      segments: [{ id: 'edge-source-segment', start, control1: start, control2: end, end }] }
    visualBase(source)!.boundaries[boundary.id] = boundary
    const command: SceneCommand = { type: 'upsertMaterializedEdge', edge: { id: 'paint', floorId: boundary.floorId, layerId: boundary.layerId,
      visibility: 'public', editLocked: false, boundaryId: boundary.id, inputHash: materializedBoundaryHash(boundary), kind: 'cliff', polygons: [ring(130)],
      strokes: [{ id: 'paint-stroke', pointsMm: ring(130), widthMm: 45, color: '#D9C8A0', opacity: .4 }], materialRef: null, fillColor: '#737D76', opacity: .9 } }
    expect(() => applyCommands(source, [command], runtime())).toThrow(/256/)
    expect(() => applyCommands(source, [command], runtime(), { budget: taskBudgetProfile('small') })).toThrow(/256/)
    const next = applyCommands(source, [command], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(next.visual.base.materializedEdges.paint.polygons[0]).toHaveLength(130)
    expect(measureCommandBudget(source, next).semanticTargets).toBe(1)
    expect(validateSceneDocument(next).ok).toBe(true)
  })

  it('deduplicates a container and its 256 live members when moving layers, while keeping locks', () => {
    const source = toCurrentSceneDocument({ ...scatterLayerSceneV3(256), format: 'sceneweave-scene' })
    source.userLayers.target = { id: 'target', floorId: 'blank-floor', name: '目标', order: 1, editLocked: false }
    expect(previewLayerMove(source, ['scatter'], 'target').reason).toMatch(/256/)
    expect(previewLayerMove(source, ['scatter'], 'target', taskBudgetProfile('small')).reason).toMatch(/256/)
    expect(previewLayerMove(source, ['scatter'], 'target', MANUAL_TRANSACTION_BUDGET).reason).toBeNull()
    const next = applyCommands(source, [{ type: 'moveEntitiesToLayer', ids: ['scatter'], layerId: 'target' }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(next.entityLayers['scatter-item-255']).toBe('target')
    const locked = cloneJson(source); locked.props['scatter-item-255'].editLocked = true
    expect(previewLayerMove(locked, ['scatter'], 'target', MANUAL_TRANSACTION_BUDGET).reason).toMatch(/锁定/)
    expect(source.entityLayers.scatter).not.toBe('target')
  })

  it('exposes synchronized intermediate content for both scene and appearance commands', () => {
    const source = createCompositionContent(toCurrentSceneDocument({ ...layerSceneV3(), format: 'sceneweave-scene' }), runtime()), ordinary: CompositionContent[] = []
    const moved = applyCompositionCommands(source, [
      { type: 'updateProp', id: 'item', changes: { positionMm: { x: 4500, y: 4000 } } },
      { type: 'updateProp', id: 'item', changes: { positionMm: { x: 5000, y: 4000 } } },
    ], runtime(), { budget: MANUAL_TRANSACTION_BUDGET, onContentDraft: draft => ordinary.push(cloneJson(draft)) })
    expect(ordinary.map(draft => draft.document.props.item.positionMm.x)).toEqual([4500, 5000, 5000])
    expect(ordinary.every(draft => !!draft.historyIdentity.propTokens.item && !!draft.appearance.propSources.item)).toBe(true)
    const appearances: CompositionContent[] = []
    applyCompositionCommands(moved, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'fade', kind: 'opacity', value: .5, enabled: true } }], runtime(), {
      budget: MANUAL_TRANSACTION_BUDGET, onContentDraft: draft => appearances.push(cloneJson(draft)),
    })
    expect(appearances).toHaveLength(2)
    expect(appearances.every(draft => draft.appearance.instanceAdjustments.item.some(row => row.id === 'fade'))).toBe(true)
  })

  it('keeps a wide layer scope usable when instance overrides mask almost all effective changes', () => {
    let source = createCompositionContent(toCurrentSceneDocument({ ...scatterLayerSceneV3(256), format: 'sceneweave-scene' }), runtime())
    for (const id of Object.keys(source.document.props).filter(id => id !== 'item')) {
      source.appearance.instanceAdjustments[id] = [{ id: `keep-${id}`, kind: 'opacity', value: .7, enabled: true }]
    }
    source = resolveAppearance(source)
    const scope = { kind: 'layer' as const, layerId: source.document.entityLayers.item }
    expect(() => inspectAppearanceScope(source, scope)).toThrow(/256/)
    expect(inspectAppearanceScope(source, scope, ['opacity'], MANUAL_TRANSACTION_BUDGET).targetIds).toHaveLength(257)
    const next = applyCompositionCommands(source, [{ type: 'setAppearanceAdjustment', scope,
      adjustment: { id: 'layer-fade', kind: 'opacity', value: .5, enabled: true } }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(next.appearance.layerAdjustments[scope.layerId]).toContainEqual({ id: 'layer-fade', kind: 'opacity', value: .5, enabled: true })
    expect(next.appearance.instanceAdjustments).toEqual(source.appearance.instanceAdjustments)
  })
})
