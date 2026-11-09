import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { prepareCompositionCommands } from '../../application/workspace/prepare.js'
import { fromBundle, toBundle, tryDeriveEditableProject, type EditableProject } from '../../application/workspace/project.js'
import * as geometry from '../../shared/geometry/geometry.js'
import * as relations from '../../shared/aggregates/relations.js'
import { MANUAL_TRANSACTION_BUDGET } from '../../shared/budget/command-budget.js'
import { createCompositionContent, propAppearanceSnapshot } from '../../shared/appearance/graph.js'
import { copyScenePresentations, presentationSourceId } from '../../shared/appearance/presentation.js'
import { releaseCompositionTransactionReceipt } from '../../shared/appearance/commands.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { getProjectTransactionReceipt, releaseProjectTransactionReceipt } from '../../shared/project/validate.js'
import { reviseCompositionContent } from '../../shared/validation/content.js'
import { cloneJson } from '../../shared/validation/json.js'
import { isCertifiedSceneSnapshot } from '../../shared/validation/snapshots.js'
import { ownedSelectionViewSource, selectionScene } from './selection-scene.js'
import { inheritSelectionGeometry, selectionGeometry } from './selection.js'
import { hitTestLayersV3, inheritSelectionGeometryForProject, selectInBoundsLayersV3, selectionGeometryLayersV3, summarizeSelectionLayersV3 } from './layer-view.js'

const move = (x: number, y = 4000): CompositionCommand => ({ type: 'updateProp', id: 'item', changes: { positionMm: { x, y } } })
const view = (scene: SceneDocument) => selectionScene(scene, { effectiveLocks: true, layerOrder: true })
const shapes = (scene: SceneDocument, id: string) => selectionGeometryLayersV3(scene)(scene, id)
const pick = (scene: SceneDocument, x: number, y: number) => hitTestLayersV3(scene)(scene, { x, y }, 0)
const marquee = (scene: SceneDocument) => selectInBoundsLayersV3(scene)(scene, { x: 0, y: 0, width: 20000, height: 20000 }, 'intersect')
function uncached(scene: SceneDocument): SceneDocument {
  const result = cloneJson(scene)
  copyScenePresentations(scene, result)
  return result
}
async function source(nearSide = false): Promise<EditableProject> {
  const bundle = fixture({ image: nearSide }), document = cloneJson(bundle.project.document)
  document.paths.road = { id: 'road', floorId: 'blank-floor', editLocked: false, visibility: 'public', centerlineMm: [{ x: 1000, y: 8000 }, { x: 19000, y: 8000 }],
    widthMm: 600, supportRefs: [{ kind: 'floor', id: 'blank-floor' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
  document.entityLayers.road = document.entityLayers.item
  if (nearSide) document.props.other = { ...cloneJson(document.props.item), id: 'other', positionMm: { x: 4000, y: 4050 } }
  const content = createCompositionContent(document, runtime)
  if (nearSide) for (const propId of ['item', 'other']) {
    const previous = content.appearance.sources[content.appearance.propSources[propId]]
    if (previous.kind !== 'prop') throw new Error('Expected fixed Prop source')
    const presentation = { mode: 'nearSide' as const, rootAnchorMm: { x: 0, y: -50 }, orientation: 'fixedUpright' as const,
      fixedRotationDeg: 0 as const, footprintAxes: 'world' as const, groundShadowMm: null }
    const id = presentationSourceId(propAppearanceSnapshot(previous.snapshot), previous.parentSourceId, presentation)
    content.appearance.sources[id] = { ...previous, id }
    content.appearance.propSources[propId] = id
    content.appearance.presentations![id] = presentation
  }
  return fromBundle({ ...bundle, project: { ...bundle.project, ...content } }, validation)
}
async function commit(before: EditableProject, commands: readonly CompositionCommand[]) {
  const prepared = await prepareCompositionCommands(before, commands, { runtime, validation, budget: MANUAL_TRANSACTION_BUDGET })
  const revised = reviseCompositionContent({ document: prepared.document, historyIdentity: prepared.historyIdentity, appearance: prepared.appearance },
    before.document.revision + 1, runtime.clock.now())
  const after = tryDeriveEditableProject({ ...prepared, ...revised }, prepared, validation)
  if (!after) throw new Error('Expected exact committed project')
  return after
}
afterEach(() => vi.restoreAllMocks())

describe('selection-owned immutable views and exact transaction handoff', () => {
  it('caches actual layer-selector geometry without certifying its inspector view as a scene', async () => {
    const before = await source(), domain = view(before.document), path = vi.spyOn(geometry, 'pathPolygon')
    expect(isCertifiedSceneSnapshot(before.document)).toBe(true)
    expect(isCertifiedSceneSnapshot(domain)).toBe(false)
    expect(ownedSelectionViewSource(domain)?.source).toBe(before.document)
    const first = shapes(before.document, 'road')
    first[0][0].x = -999999
    expect(shapes(before.document, 'road')[0][0].x).not.toBe(-999999)
    expect(path).toHaveBeenCalledTimes(1)
    expect(selectionGeometry(domain, 'road')).toEqual(shapes(before.document, 'road'))
    expect(path).toHaveBeenCalledTimes(1)

    const external = uncached(before.document), externalView = view(external)
    expect(ownedSelectionViewSource(externalView)).toBeUndefined()
    Object.freeze(external)
    const select = selectionGeometryLayersV3(external), original = select(external, 'road')
    external.paths.road.widthMm = 1000
    expect(select(external, 'road')).not.toEqual(original)
    expect(ownedSelectionViewSource(cloneJson(domain))).toBeUndefined()
  })

  it('reuses only warmed unaffected geometry and lets the new residency consume it', async () => {
    const before = await source(), oldRoad = shapes(before.document, 'road'), oldProp = shapes(before.document, 'item')
    const after = await commit(before, [move(4500), { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } }])
    const project = toBundle(after).project, receipt = getProjectTransactionReceipt(project)!
    expect(receipt.baseline).toBe(toBundle(before).project)
    expect(receipt.composition.validation.mode).toBe('prop-proof')
    const path = vi.spyOn(geometry, 'pathPolygon'), closure = vi.spyOn(relations, 'aggregateAffectedClosure')
    expect(inheritSelectionGeometryForProject(project)).toBeGreaterThan(0)
    expect(closure.mock.calls.map(call => call[0])).toEqual([before.document, after.document])
    expect(shapes(after.document, 'road')).toEqual(oldRoad)
    expect(shapes(after.document, 'item')).not.toEqual(oldProp)
    const hits = marquee(after.document)
    expect(hits.ids).toContain('road')
    expect(path).not.toHaveBeenCalled()
    expect(pick(after.document, 4500, 4000)).toContain('item')
    expect(pick(after.document, 4000, 4000)).not.toContain('item')
    const fresh = uncached(after.document)
    expect(hits).toEqual(marquee(fresh))
    for (const id of ['item', 'other', 'road']) expect(shapes(after.document, id)).toEqual(shapes(fresh, id))
    expect(inheritSelectionGeometryForProject(project)).toBe(0)
    releaseProjectTransactionReceipt(project)
    expect(inheritSelectionGeometryForProject(project)).toBe(0)
    expect(shapes(after.document, 'road')).toEqual(oldRoad)
  })

  it('does not manufacture a prior index or accept an unrelated view with matching scene identity', async () => {
    const before = await source(), after = await commit(before, [move(4500)]), project = toBundle(after).project
    expect(inheritSelectionGeometryForProject(project)).toBe(0)
    shapes(before.document, 'road')
    expect(inheritSelectionGeometry(project, view(uncached(before.document)), view(after.document))).toBe(0)
    expect(inheritSelectionGeometry(project, view(before.document), view(uncached(after.document)))).toBe(0)
    expect(inheritSelectionGeometryForProject({ ...project })).toBe(0)
    expect(inheritSelectionGeometryForProject(cloneJson(project))).toBe(0)
    expect(inheritSelectionGeometryForProject(project)).toBeGreaterThan(0)
  })

  it.each(['project', 'composition'] as const)('rejects a released %s receipt before reusing shapes', async owner => {
    const before = await source(); shapes(before.document, 'road')
    const after = await commit(before, [move(4500)]), project = toBundle(after).project
    const receipt = getProjectTransactionReceipt(project)!
    if (owner === 'project') releaseProjectTransactionReceipt(project)
    else releaseCompositionTransactionReceipt(receipt.composition)
    expect(inheritSelectionGeometryForProject(project)).toBe(0)
    expect(marquee(after.document)).toEqual(marquee(uncached(after.document)))
  })

  it.each(['baseline', 'result', 'throw'] as const)('falls back completely when the %s dependency closure is unproven', async failure => {
    const before = await source(); shapes(before.document, 'road')
    const after = await commit(before, [move(4500)]), original = relations.aggregateAffectedClosure
    vi.spyOn(relations, 'aggregateAffectedClosure').mockImplementation((scene, roots, options) => {
      if (failure === 'throw') throw new Error('closure budget exhausted')
      const result = original(scene, roots, options)
      return scene === (failure === 'baseline' ? before.document : after.document) ? { ...result, requiresSceneWideFallback: true } : result
    })
    const path = vi.spyOn(geometry, 'pathPolygon')
    expect(inheritSelectionGeometryForProject(toBundle(after).project)).toBe(0)
    shapes(after.document, 'road')
    expect(path).toHaveBeenCalledTimes(1)
  })

  it('rebuilds near-side overlap order after a move while retaining the fixed presentation', async () => {
    const before = await source(true)
    expect(pick(before.document, 4000, 4080).slice(0, 2)).toEqual(['other', 'item'])
    shapes(before.document, 'road')
    const after = await commit(before, [move(4000, 4100)])
    expect(inheritSelectionGeometryForProject(toBundle(after).project)).toBeGreaterThan(0)
    expect(pick(after.document, 4000, 4080).slice(0, 2)).toEqual(['item', 'other'])
    const fresh = uncached(after.document)
    expect(pick(after.document, 4000, 4080)).toEqual(pick(fresh, 4000, 4080))
    expect(shapes(after.document, 'item')).toEqual(shapes(fresh, 'item'))
    expect(marquee(after.document)).toEqual(marquee(fresh))
  })

  it('rebuilds locks and rejects unsupported step writes even when a later step restores their net value', async () => {
    const before = await source(); marquee(before.document)
    const layer = before.document.entityLayers.item
    const after = await commit(before, [{ type: 'setLayerLock', id: layer, locked: true }])
    expect(inheritSelectionGeometryForProject(toBundle(after).project)).toBe(0)
    expect(marquee(after.document).ids).toEqual([])
    expect(summarizeSelectionLayersV3(after.document)(after.document, ['item']).effectiveLockedCount).toBe(1)
    const reverted = await commit(before, [{ type: 'setEditLock', kind: 'prop', id: 'item', locked: true },
      { type: 'setEditLock', kind: 'prop', id: 'item', locked: before.document.props.item.editLocked }])
    expect(reverted.document.props.item.editLocked).toBe(before.document.props.item.editLocked)
    expect(inheritSelectionGeometryForProject(toBundle(reverted).project)).toBe(0)
    expect(marquee(reverted.document)).toEqual(marquee(uncached(reverted.document)))
  })

  it('falls back for a prefab member move and recomputes the real group union', async () => {
    const initial = await source(true), before = await prepareCompositionCommands(initial, [{ type: 'createPrefab', id: 'group', definitionId: 'group-definition',
      name: 'Selection group', ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }], { runtime, validation })
    const previous = shapes(before.document, 'group'); shapes(before.document, 'road')
    const after = await commit(before, [move(4500)])
    expect(inheritSelectionGeometryForProject(toBundle(after).project)).toBe(0)
    expect(shapes(after.document, 'group')).not.toEqual(previous)
    expect(shapes(after.document, 'group')).toEqual(shapes(uncached(after.document), 'group'))
  })

  it('does not reuse an appearance-changing transaction through the Prop-only handoff', async () => {
    const before = await source(); shapes(before.document, 'road'); shapes(before.document, 'item')
    const after = await commit(before, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'selection-opacity', kind: 'opacity', value: .5, enabled: true } }])
    expect(after.appearance).not.toBe(before.appearance)
    expect(inheritSelectionGeometryForProject(toBundle(after).project)).toBe(0)
    expect(marquee(after.document)).toEqual(marquee(uncached(after.document)))
  })
})
