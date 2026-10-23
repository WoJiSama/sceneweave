import { describe, expect, it } from 'vitest'
import { applyCommandsV3 } from '../v3/commands'
import { layerSceneV3, scatterLayerSceneV3 } from '../v3/test-fixtures'
import { applyCompositionCommandsV6 } from './commands'
import { addSurfaceAppearanceSourceV6, createCompositionContentV6, resolveAppearanceV6, syncAppearanceGraphV6 } from './graph'
import { advanceHistoryIdentityV6 } from './identity'
import { buildRestorePlanV6 } from './restore'
import { surfaceFixtureV6 } from './test-fixtures'

const key = (index: number) => (index + 1).toString(16).padStart(64, '0')
const rectangle = (x: number, y: number, width = 600, height = 600) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function scatter(count = 3) { const document = scatterLayerSceneV3(count); document.scatterGroups.scatter.visibility = 'public'; return createCompositionContentV6(document) }

describe('C4 persistent outdoor restore scopes', () => {
  it('restores terrain geometry with persisted proof and preserves later notes, props, layers and paint', () => {
    const historic = surfaceFixtureV6(), draft = structuredClone(historic)
    draft.document.terrainAreas.domain.boundaryMm[0].positionMm.x = 900
    draft.document.terrainAreas.domain.groundElevationMm = 300
    draft.document.props.item.rotationDeg = 25
    draft.document.notes.laterNote = { id: 'laterNote', floorId: 'blank-floor', editLocked: false, kind: 'note', text: 'new outside edit', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    draft.document.entityLayers.laterNote = draft.document.entityLayers.item
    const style = draft.document.terrainAreas.domain.surfaceStyle!
    style.base.rotationDeg = 35
    draft.appearance.surfaceSources.domain = addSurfaceAppearanceSourceV6(draft.appearance, style, draft.appearance.surfaceSources.domain)
    const current = resolveAppearanceV6(draft), before = structuredClone(current)
    const plan = buildRestorePlanV6(JSON.parse(JSON.stringify(current)), historic, { ids: ['domain'], mode: 'outdoorGeometry' })
    expect(plan.document.terrainAreas.domain.boundaryMm).toEqual(historic.document.terrainAreas.domain.boundaryMm)
    expect(plan.document.terrainAreas.domain.groundElevationMm).toBe(0)
    expect(plan.document.terrainAreas.domain.surfaceStyle).toEqual(current.document.terrainAreas.domain.surfaceStyle)
    expect(plan.document.props).toEqual(current.document.props); expect(plan.document.notes).toEqual(current.document.notes)
    expect(plan.document.entityLayers).toEqual(current.document.entityLayers)
    expect(plan.affectedIds).toEqual(expect.arrayContaining(['domain', 'item', 'laterNote']))
    expect(plan.commandCost).toBe(1)
    expect(current).toEqual(before)
  })

  it('requires current dependent locks before geometry edits, including recursively anchored notes', () => {
    const historic = surfaceFixtureV6(), current = structuredClone(historic)
    current.document.terrainAreas.domain.groundElevationMm = 300
    current.document.notes.anchor = { id: 'anchor', floorId: 'blank-floor', editLocked: true, kind: 'note', text: 'locked dependent', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
    current.document.entityLayers.anchor = current.document.entityLayers.item
    expect(() => buildRestorePlanV6(current, historic, { ids: ['domain'], mode: 'outdoorGeometry' })).toThrow(/anchor/)
  })

  it('restores outdoor appearance after serialization while preserving current paint geometry', () => {
    const historic = surfaceFixtureV6(), draft = structuredClone(historic), style = draft.document.terrainAreas.domain.surfaceStyle!
    style.base.originMm.x = 700; style.base.rotationDeg = 22; style.overlays[0].paint.opacity = .8
    draft.appearance.surfaceSources.domain = addSurfaceAppearanceSourceV6(draft.appearance, style, draft.appearance.surfaceSources.domain)
    const current = resolveAppearanceV6(draft), plan = buildRestorePlanV6(JSON.parse(JSON.stringify(current)), JSON.parse(JSON.stringify(historic)), { ids: ['domain'], mode: 'appearance' })
    const result = resolveAppearanceV6(plan).document.terrainAreas.domain.surfaceStyle!
    expect(result.base.originMm.x).toBe(700); expect(result.base.rotationDeg).toBe(22)
    expect(result.overlays[0].paint.opacity).toBe(.4)
    expect(plan.changes[0].kind).toBe('surface')
  })

  it('refuses changed topology even after undo restores the historical IDs and coordinates', () => {
    const historic = surfaceFixtureV6(), changed = structuredClone(historic.document)
    changed.terrainAreas.domain.boundaryMm[0].segmentId = 'new-segment'
    const nextIdentity = advanceHistoryIdentityV6(historic.historyIdentity, historic.document, changed)
    const undoIdentity = advanceHistoryIdentityV6(nextIdentity, changed, historic.document, { allowResurrection: true })
    const undone = { ...historic, historyIdentity: undoIdentity }
    expect(() => buildRestorePlanV6(undone, historic, { ids: ['domain'], mode: 'outdoorProperties' })).toThrow(/连续性/)
    expect(() => buildRestorePlanV6(undone, historic, { ids: ['domain'], mode: 'appearance' })).toThrow(/连续性/)
  })

  it('derives the explicit cliff/blocking write required by restored height without edge rebind', () => {
    const base = layerSceneV3(); delete base.props.item; delete base.entityLayers.item
    const document = applyCommandsV3(base, [
      { type: 'createTerrainArea', id: 'low', floorId: 'blank-floor', boundaryMm: rectangle(1000, 1000, 4000, 8000) },
      { type: 'createTerrainArea', id: 'high', floorId: 'blank-floor', boundaryMm: rectangle(5000, 1000, 4000, 8000), groundElevationMm: 1000 },
      { type: 'createTerrainEdge', id: 'cliff', source: { areaId: 'low', segmentId: 'low:segment:1' } },
    ])
    const historic = createCompositionContentV6(document), current = applyCompositionCommandsV6(historic, [
      { type: 'setTerrainElevation', id: 'high', groundElevationMm: 0 },
      { type: 'updateTerrainEdge', id: 'cliff', changes: { kind: 'materialTransition', blocksMovement: false } },
    ])
    const plan = buildRestorePlanV6(current, historic, { ids: ['high'], mode: 'outdoorGeometry' })
    expect(plan.document.terrainEdges.cliff).toMatchObject({ kind: 'cliff', blocksMovement: true, source: current.document.terrainEdges.cliff.source, neighborAreaId: current.document.terrainEdges.cliff.neighborAreaId })
    expect(plan.changes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cliff', fields: ['kind', 'blocksMovement'] })]))
    expect(plan.commandCost).toBe(2)
  })

  it('restores explicit path geometry/business fields separately', () => {
    const document = applyCommandsV3(layerSceneV3(), [{ type: 'createPath', id: 'path', floorId: 'blank-floor', centerlineMm: [{ x: 2000, y: 7000 }, { x: 10000, y: 7000 }], widthMm: 1000, supportRefs: [{ kind: 'floor', id: 'blank-floor' }] }])
    const historic = createCompositionContentV6(document), current = applyCompositionCommandsV6(historic, [{ type: 'updatePath', id: 'path', changes: { widthMm: 1500, movementCostMultiplier: 2 } }])
    const plan = buildRestorePlanV6(current, historic, { ids: ['path'], mode: 'outdoorGeometry' })
    expect(plan.document.paths.path.widthMm).toBe(1000); expect(plan.document.paths.path.movementCostMultiplier).toBe(2)
    const properties = buildRestorePlanV6(current, historic, { ids: ['path'], mode: 'outdoorProperties' })
    expect(properties.document.paths.path.movementCostMultiplier).toBe(1)
  })
})

describe('C4 selected scatter recovery preserves saved manual results', () => {
  it('restores live appearance and preserves moved positions, detached/deleted slots and exclusions', () => {
    const historic = scatter(), altered = resolveAppearanceV6(applyCompositionCommandsV6(historic, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['scatter-item-0'] }, adjustment: { id: 'later-opacity', kind: 'opacity', enabled: true, value: .2 } }]))
    const current = applyCompositionCommandsV6(altered, [
      { type: 'updateProp', id: 'scatter-item-0', changes: { positionMm: { x: 7000, y: 7000 } } },
      { type: 'deleteProp', id: 'scatter-item-1' },
      { type: 'detachScatterMember', groupId: 'scatter', propId: 'scatter-item-2' },
    ])
    const plan = buildRestorePlanV6(current, historic, { ids: ['scatter-item-0'], mode: 'appearance' }), result = resolveAppearanceV6(plan)
    expect(result.document.props['scatter-item-0'].appearance.opacity).toBe(1)
    expect(result.document.props['scatter-item-0'].positionMm).toEqual({ x: 7000, y: 7000 })
    for (const index of [1, 2]) expect(result.document.scatterGroups.scatter.members[key(index)]).toEqual(current.document.scatterGroups.scatter.members[key(index)])
    expect(result.document.scatterGroups.scatter.exclusions).toEqual(current.document.scatterGroups.scatter.exclusions)
    expect(result.document.props['scatter-item-2']).toEqual(current.document.props['scatter-item-2'])
    expect(result.document.scatterGroups.scatter.members[key(0)].overrideFields).toContain('appearance')
    expect(plan.affectedIds).toContain('scatter')
  })

  it('rebuilds only the selected deleted historical birth and removes only its own delete exclusions', () => {
    const historic = scatter(), current = applyCompositionCommandsV6(historic, [
      { type: 'deleteProp', id: 'scatter-item-0' }, { type: 'deleteProp', id: 'scatter-item-1' },
      { type: 'upsertScatterExclusion', groupId: 'scatter', exclusion: { id: 'later-entrance', boundaryMm: rectangle(10000, 10000), reason: 'entrance' } },
    ])
    expect(() => buildRestorePlanV6(current, historic, { ids: ['scatter-item-0'], mode: 'appearance' })).toThrow(/显式/)
    const plan = buildRestorePlanV6(current, historic, { ids: ['scatter-item-0'], mode: 'scatterMembers' })
    expect(plan.document.props['scatter-item-0']).toEqual(historic.document.props['scatter-item-0'])
    expect(plan.historyIdentity.propTokens['scatter-item-0']).toBe(historic.historyIdentity.propTokens['scatter-item-0'])
    expect(plan.document.scatterGroups.scatter.members[key(0)]).toEqual(historic.document.scatterGroups.scatter.members[key(0)])
    expect(plan.document.props['scatter-item-1']).toBeUndefined()
    expect(plan.document.scatterGroups.scatter.exclusions).toEqual(current.document.scatterGroups.scatter.exclusions.filter(item => item.sourceCandidateKey !== key(0)))
    expect(plan.affectedIds).toContain('scatter')
    expect(plan.changes.find(change => change.id === 'scatter-item-0')?.action).toBe('recreate')
  })

  it('refuses retained entrance conflicts, another current birth and changed scatter domain identity', () => {
    const historic = scatter(), removed = applyCompositionCommandsV6(historic, [{ type: 'deleteProp', id: 'scatter-item-0' }])
    const blocked = applyCompositionCommandsV6(removed, [{ type: 'upsertScatterExclusion', groupId: 'scatter', exclusion: { id: 'entrance', boundaryMm: rectangle(1500, 1500, 1000, 1000), reason: 'entrance' } }])
    expect(() => buildRestorePlanV6(blocked, historic, { ids: ['scatter-item-0'], mode: 'scatterMembers' })).toThrow(/保留.*排除区/)
    const document = structuredClone(removed.document), fresh = { ...structuredClone(historic.document.props['scatter-item-0']), id: 'fresh-current-birth' }
    document.props[fresh.id] = fresh; document.entityLayers[fresh.id] = document.entityLayers.scatter
    document.scatterGroups.scatter.members[key(0)] = { propId: fresh.id, state: 'manual', overrideFields: [] }; document.scatterGroups.scatter.exclusions = []
    const occupied = syncAppearanceGraphV6({ ...removed, document, historyIdentity: advanceHistoryIdentityV6(removed.historyIdentity, removed.document, document) })
    expect(() => buildRestorePlanV6(occupied, historic, { ids: ['scatter-item-0'], mode: 'scatterMembers' })).toThrow(/另一个出生身份/)
    const changed = applyCompositionCommandsV6(removed, [{ type: 'configureScatter', id: 'scatter', changes: { seed: 'different-seed' } }])
    expect(() => buildRestorePlanV6(changed, historic, { ids: ['scatter-item-0'], mode: 'scatterMembers' })).toThrow(/连续性/)
  })

  it('counts actual member slots and rejects an expanded over-budget recovery', () => {
    const content = scatter(128)
    expect(() => buildRestorePlanV6(content, content, { ids: Object.values(content.document.scatterGroups.scatter.members).map(member => member.propId!), mode: 'scatterMembers' })).toThrow(/256/)
  })
})
