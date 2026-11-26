import { describe, expect, it } from 'vitest'
import { FIXTURE_STAMP, groupLayerScene, layerScene, sampleScene, scatterLayerScene } from '../../tests/helpers/current-project-fixtures.js'
import { inspectDependencies } from './commands/dependencies'
import { geometryDocumentForValidation } from './commands/domain'
import { openingEndpoints, pathPolygon, propFootprint, validateGeometry } from './geometry/geometry'
import { sampleScatterCellV1, buildScatterRegeneration } from './geometry/scatter'
import { checkTerrainTravel } from './geometry/terrain-travel'
import { projectScene, projectEditorScene } from './projection/projection'
import { validateSceneDocument } from './validation/scene'
import { isCertifiedSceneSnapshot, reviseSceneSnapshot, validateSceneSnapshot } from './validation/snapshots'

function sceneErrors(input: unknown): string[] {
  const result = validateSceneDocument(input)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.errors.map(issue => issue.code)
}

describe('Complete-v1 scene rules', () => {
  it('preserves strict parsed fields, complete resource dependencies and geometry on indoor, outdoor and grouped fixtures', () => {
    for (const source of [sampleScene('study'), sampleScene('island'), groupLayerScene()]) {
      const checked = validateSceneDocument(source)
      expect(checked.ok).toBe(true)
      if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
      expect(checked.document).toEqual(source)
      expect(inspectDependencies(checked.document).errors).toEqual([])
      expect(validateGeometry(checked.document).errors).toEqual([])
    }
  })

  it('dispatches by the new discriminator and rejects unknown persisted or session-only fields', () => {
    const source = layerScene(), layer = Object.values(source.userLayers)[0]
    expect(validateSceneDocument({ ...source, format: 'sceneweave', schemaVersion: 1 }).ok).toBe(false)
    expect(validateSceneDocument({ ...source, schemaVersion: 2 }).ok).toBe(false)
    expect(validateSceneDocument({ ...source, hiddenLayerIds: [] }).ok).toBe(false)
    expect(validateSceneDocument({ ...source, userLayers: { [layer.id]: { ...layer, visible: false } } }).ok).toBe(false)
  })

  it('rejects accessors and non-JSON input without executing a supplied getter', () => {
    let reads = 0
    const accessor = layerScene()
    Object.defineProperty(accessor, 'title', { enumerable: true, get: () => { reads++; throw new Error('caller getter executed') } })
    expect(sceneErrors(accessor)).toContain('JSON_BUDGET')
    expect(reads).toBe(0)
    for (const value of [new Date(FIXTURE_STAMP), 1n, () => 'not JSON', Number.NaN, undefined]) {
      expect(sceneErrors({ ...layerScene(), unknown: value })).toContain('NON_JSON_INPUT')
    }
    const symbol = layerScene()
    Object.defineProperty(symbol, Symbol('hidden'), { enumerable: true, value: 'secret' })
    expect(sceneErrors(symbol)).toContain('UNSAFE_KEY')
    const unsafe = layerScene()
    Object.defineProperty(unsafe.props, '__proto__', { enumerable: true, value: unsafe.props.item })
    expect(sceneErrors(unsafe)).toContain('UNSAFE_KEY')
  })

  it('retains JSON depth/value guards in the ownership pass and rejects cycles without throwing', () => {
    let nested: unknown = null
    for (let i = 0; i < 129; i++) nested = { child: nested }
    expect(sceneErrors(nested)).toContain('JSON_BUDGET')
    expect(sceneErrors(Array.from({ length: 600_000 }, () => null))).toContain('JSON_BUDGET')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(sceneErrors(cyclic)).toContain('NON_JSON_INPUT')
  })

  it('retains layer membership, group-layer and embedded identity invariants', () => {
    const missing = layerScene(); delete missing.entityLayers.item
    expect(sceneErrors(missing)).toContain('MISSING_LAYER_MEMBERSHIP')
    const grouped = groupLayerScene(), base = Object.values(grouped.userLayers)[0]
    grouped.userLayers.other = { ...base, id: 'other', name: 'Other', order: 1 }
    grouped.entityLayers.left = 'other'
    expect(sceneErrors(grouped)).toContain('GROUP_LAYER_MISMATCH')
    const terrain = scatterLayerScene(0)
    terrain.entityLayers['domain-point-0'] = terrain.entityLayers.domain
    expect(sceneErrors(terrain)).toContain('UNKNOWN_LAYER_MEMBER')
  })

  it('checks actual rotated footprint support rather than its centre, layer or declared floor alone', () => {
    const source = scatterLayerScene(0), prop = source.props.item
    prop.positionMm = { x: 1050, y: 4000 }; prop.rotationDeg = 45
    prop.footprintMm = { width: 300, height: 300 }
    expect(sceneErrors(source)).toContain('PROP_SUPPORT')
    prop.positionMm.x = 4000
    expect(validateSceneDocument(source).ok).toBe(true)
    prop.supportRef = { kind: 'floor', id: prop.floorId }
    expect(sceneErrors(source)).toContain('PROP_SUPPORT')
    source.userLayers[source.entityLayers.item].editLocked = true
    expect(sceneErrors(source)).toContain('PROP_SUPPORT')
  })

  it('preserves stable opening endpoints, real footprint offsets and square-cap path bands', () => {
    const source = sampleScene('study'), opening = source.openings['terrace-door']
    const endpoints = openingEndpoints(source, opening)
    expect(Math.hypot(endpoints[1].x - endpoints[0].x, endpoints[1].y - endpoints[0].y)).toBeCloseTo(opening.widthMm)
    const prop = Object.values(source.props)[0], original = propFootprint(prop)
    prop.rotationDeg = 37; prop.footprintOffsetMm = { x: 123, y: -79 }
    expect(propFootprint(prop)).not.toEqual(original)
    const path = { id: 'path-band', floorId: Object.keys(source.floors)[0], editLocked: false, visibility: 'public' as const,
      centerlineMm: [{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3100, y: 3000 }], widthMm: 400,
      supportRefs: [{ kind: 'floor' as const, id: Object.keys(source.floors)[0] }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    const polygon = pathPolygon(path)
    expect(Math.min(...polygon.map(point => point.x))).toBe(800)
  })

  it('retains full-width current terrain travel and refuses a visually plausible blocked crossing', () => {
    const source = sampleScene('island'), stairs = source.terrainConnections['island-stairs']
    const route = { floorId: stairs.floorId, from: stairs.from.positionMm, to: stairs.to.positionMm, widthMm: stairs.widthMm }
    expect(checkTerrainTravel(source, route).ok).toBe(true)
    expect(checkTerrainTravel(source, { ...route, widthMm: route.widthMm + 1 }).ok).toBe(false)
    stairs.blocksMovement = true
    expect(checkTerrainTravel(source, route).ok).toBe(false)
  })

  it('preserves scatter streams, UTF-8 stable keys, adopted results and permanent deletion records', () => {
    const source = scatterLayerScene(0), group = source.scatterGroups.scatter
    group.seed = '中文 seed'
    const cell = sampleScatterCellV1(group, 2, -1)
    expect(sampleScatterCellV1(structuredClone(group), 2, -1)).toEqual(cell)
    const deletion = { propId: null, state: 'deleted' as const, overrideFields: [] }
    group.members[cell.candidateKey] = structuredClone(deletion)
    const exclusion = { id: 'deleted-cell', boundaryMm: [{ x: 1000, y: 1000 }, { x: 1200, y: 1000 }, { x: 1200, y: 1200 }, { x: 1000, y: 1200 }], reason: 'delete' as const, sourceCandidateKey: cell.candidateKey }
    group.exclusions.push(exclusion)
    const regenerated = buildScatterRegeneration(source, 'scatter')
    expect(regenerated.props.length).toBeGreaterThan(0)
    expect(regenerated.group.members[cell.candidateKey]).toEqual(deletion)
  })

  it('preserves complete GM and player projections for representative indoor and elevated outdoor scenes', () => {
    for (const source of [sampleScene('study'), sampleScene('island')]) {
      const before = structuredClone(source)
      for (const audience of ['gm', 'player'] as const) {
        const projection = projectScene(source, audience)
        expect(projection.audience).toBe(audience)
        for (const connection of projection.connections) {
          const input = source.terrainConnections[connection.id]
          expect(connection.surfaceIds).toEqual([input.from.surfaceRef.id, input.to.surfaceRef.id])
        }
      }
      expect(source).toEqual(before)
    }
  })

  it('filters private group members and anchored notes, while keeping editor hiding separate from published audiences', () => {
    const source = groupLayerScene(), base = Object.keys(source.userLayers)[0]
    source.regions.mask = { id: 'mask', floorId: 'blank-floor', editLocked: false,
      boundaryMm: [{ x: 5000, y: 3000 }, { x: 9000, y: 3000 }, { x: 9000, y: 5000 }, { x: 5000, y: 5000 }],
      kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm' }
    source.entityLayers.mask = base
    source.notes.secret = { id: 'secret', floorId: 'blank-floor', editLocked: false,
      anchor: { type: 'entity', entityKind: 'prefabInstance', entityId: 'group' }, kind: 'label', text: 'PRIVATE-GROUP-NOTE', visibility: 'public' }
    source.entityLayers.secret = base
    const player = projectScene(source, 'player'), hiddenLayerIds = new Set([base])
    expect(player.props.map(prop => prop.id)).toEqual(['item'])
    expect(JSON.stringify(player)).not.toContain('PRIVATE-GROUP-NOTE')
    expect(projectScene(source, 'gm').props).toHaveLength(3)
    expect(projectEditorScene(source, { hiddenLayerIds }).props).toEqual([])
    expect(projectScene(source, 'player')).toEqual(player)
  })

  it('certifies only independently parsed frozen output and revalidates shallow-frozen caller mutations', () => {
    const input = layerScene(); Object.freeze(input)
    const first = validateSceneSnapshot(input)
    if (!first.ok) throw new Error(JSON.stringify(first.errors))
    expect(isCertifiedSceneSnapshot(input)).toBe(false)
    expect(isCertifiedSceneSnapshot(first.document)).toBe(true)
    expect(Object.isFrozen(first.document.props.item.positionMm)).toBe(true)
    expect(validateSceneSnapshot(first.document)).toBe(first)
    input.props.item.positionMm.x = 7000
    const second = validateSceneSnapshot(input)
    if (!second.ok) throw new Error(JSON.stringify(second.errors))
    expect(second.document.props.item.positionMm.x).toBe(7000)
    expect(first.document.props.item.positionMm.x).toBe(4000)
    input.props.item.supportRef = { kind: 'floor', id: 'missing' }
    expect(validateSceneSnapshot(input).ok).toBe(false)
    expect(validateSceneSnapshot(first.document)).toBe(first)
  })

  it('keeps the native format and layers in effective-lock views and shares only certified content on revision changes', () => {
    const source = layerScene(), layerId = source.entityLayers.item
    source.userLayers[layerId].editLocked = true
    const checked = validateSceneSnapshot(source)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    const effective = geometryDocumentForValidation(checked.document, true)
    expect(effective.format).toBe('sceneweave-scene'); expect(effective.schemaVersion).toBe(1)
    expect(effective.userLayers).toBe(checked.document.userLayers)
    expect(effective.entityLayers).toBe(checked.document.entityLayers)
    expect(effective.props.item.editLocked).toBe(true); expect(checked.document.props.item.editLocked).toBe(false)
    const revised = reviseSceneSnapshot(checked.document, 1, FIXTURE_STAMP)
    expect(revised.revision).toBe(1); expect(checked.document.revision).toBe(0)
    expect(revised.props).toBe(checked.document.props); expect(revised.userLayers).toBe(checked.document.userLayers)
    expect(isCertifiedSceneSnapshot(revised)).toBe(true)
    expect(() => reviseSceneSnapshot(checked.document, Number.MAX_SAFE_INTEGER + 1, FIXTURE_STAMP)).toThrow(/安全整数/)
    expect(() => reviseSceneSnapshot(checked.document, 1, 'invalid')).toThrow()
  })
})
