import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { domainExecutionFixture } from '../../../tools/testing/domain-execution-fixtures.js'
import { forestRectangle, normalizeForestInput, runForestGeneration } from '../../shared/generation/domains/forest/index.js'
import { defaultMixedInputV4, runMixedGeneration } from '../../shared/generation/domains/mixed/index.js'
import { estimateSurfaceRegionInstances } from '../../shared/decorations/generate.js'
import { polygonBooleanWithHoles } from '../../shared/geometry/polygon-boolean.js'
import { checkTerrainRoute } from '../../shared/geometry/terrain-travel.js'
import { polygonInside, polygonsOverlap, propFootprint, supportedPolygon } from '../../shared/geometry/geometry.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'
import { canonicalJson, cloneJson } from '../../shared/validation/json.js'
import { taskBudgetProfile } from '../../shared/budget/task-budget.js'
import type { ForestGenerationInput, ForestParameters, ForestVegetation } from '../../shared/generation/domains/forest/contracts.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import { createWoodlandZones } from './woodland-distribution.js'

const options = { profile: taskBudgetProfile('standard'), nowMilliseconds: () => 0 }
function fixture(width = 32000, height = 24000, x = 0, y = 0) {
  const document = createShoreBlankDocument('island', { sceneId: 'woodland-test', title: 'Woodland', now: '2026-11-12T00:00:00.000Z',
    widthMm: width, heightMm: height, preset: 'narrative' }, true, true)
  const floor = Object.values(document.floors)[0], layer = Object.values(document.userLayers).find(row => row.floorId === floor.id)!
  floor.boundsMm = { x, y, width, height }; document.exportBoundsMm = { ...floor.boundsMm }
  const supportRef = { kind: 'generated-ground' as const }
  const vegetation: ForestVegetation[] = [
    { role: 'tree', coveragePpm: 50000, spacingMm: 2500, clusterRadiusMm: 6000, clearanceMm: 200,
      palette: [{ key: 'tree', kind: 'prop', definitionRef: { id: 'terrain-variants-v2-prop-tree-highland-copse', version: 1 }, weight: 1 }] },
    { role: 'shrub', coveragePpm: 4000, spacingMm: 800, clusterRadiusMm: 4000, clearanceMm: 180,
      palette: [{ key: 'shrub', kind: 'decoration', definitionRef: { id: 'terrain-variants-v1-prop-shrub-heath-mound', version: 1 }, weight: 1 }] },
    { role: 'grass', coveragePpm: 1000, spacingMm: 300, clusterRadiusMm: 3000, clearanceMm: 180,
      palette: [{ key: 'grass', kind: 'decoration', definitionRef: { id: 'terrain-variants-v1-prop-grass-sedge-fan', version: 1 }, weight: 1 }] },
  ]
  const parameters: ForestParameters = { floorId: floor.id, layerId: layer.id, boundsMm: { ...floor.boundsMm }, ground: { kind: 'new', elevationMm: 0, materialRef: null },
    zones: [{ id: 'woodland', supportRef, boundaryMm: forestRectangle(floor.boundsMm), vegetation }],
    clearings: [{ id: 'camp', supportRef, boundaryMm: forestRectangle({ x: x + Math.round(width * .4), y: y + Math.round(height * .4), width: Math.round(width * .2), height: Math.round(height * .2) }),
      anchorMm: { x: x + Math.round(width * .5), y: y + Math.round(height * .5) }, clearanceMm: 300 }],
    entrances: [], routes: [] }
  return { document, parameters }
}
function targets(document: ReturnType<typeof fixture>['document'], parameters: ForestParameters) {
  const result = { tree: 0, shrub: 0, grass: 0 }
  for (const zone of parameters.zones) {
    const polygons = polygonBooleanWithHoles({ operation: 'difference', subject: [{ outer: zone.boundaryMm, holes: [] }],
      clip: parameters.clearings.map(row => ({ outer: row.boundaryMm, holes: [] })) }).polygons
    for (const row of zone.vegetation) result[row.role] += estimateSurfaceRegionInstances(document, row.palette, { polygons, coveragePpm: row.coveragePpm })
  }
  return result
}

describe('complete woodland form preset', () => {
  it.each([
    [16000, 16000, 0, 0, 'small-wood'], [32000, 24000, 7000, -9000, 'normal-wood'],
    [50000, 38000, -23000, 18000, 'large-wood'], [70000, 50000, 0, 0, 'wide-wood'],
  ] as const)('keeps exact requested counts and finite legal copse/undergrowth zones in %s×%s', (width, height, x, y, seed) => {
    const { document, parameters } = fixture(width, height, x, y), before = canonicalJson({ document, parameters })
    if (width > 50000) parameters.zones[0].vegetation.forEach(row => { row.coveragePpm = Math.floor(row.coveragePpm / 2) })
    const preparedBefore = canonicalJson({ document, parameters })
    const zones = createWoodlandZones(document, parameters, seed)
    const normalized = normalizeForestInput({ version: 1, algorithmVersion: 2, seed, parameters: { ...parameters, zones } })
    expect(zones).toHaveLength(4)
    expect(targets(document, normalized.parameters)).toEqual(targets(document, parameters))
    expect(createWoodlandZones(document, parameters, seed)).toEqual(zones)
    for (const zone of zones) {
      expect(zone.boundaryMm).toHaveLength(12)
      expect(polygonInside(zone.boundaryMm, parameters.zones[0].boundaryMm)).toBe(true)
      expect(zone.boundaryMm.every(p => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y))).toBe(true)
      expect(zone.supportRef).toEqual(parameters.zones[0].supportRef)
      for (const other of zones) if (zone !== other && zone.vegetation.some(row => other.vegetation.some(value => row.role === value.role))) {
        expect(polygonsOverlap(zone.boundaryMm, other.boundaryMm)).toBe(false)
      }
    }
    for (let index = 0; index < 2; index++) expect(polygonInside(zones[index * 2].boundaryMm, zones[index * 2 + 1].boundaryMm)).toBe(true)
    expect(canonicalJson({ document, parameters })).toBe(preparedBefore)
    if (width <= 50000) expect(preparedBefore).toBe(before)
  })

  it('responds to the seed, deducts the actual clearing area and does not invent zero targets', () => {
    const { document, parameters } = fixture()
    expect(createWoodlandZones(document, parameters, 'one')).not.toEqual(createWoodlandZones(document, parameters, 'two'))
    parameters.clearings[0].boundaryMm = forestRectangle({ x: 0, y: 0, width: 16000, height: 24000 })
    const zones = createWoodlandZones(document, parameters, 'cleared-half')
    expect(targets(document, { ...parameters, zones })).toEqual(targets(document, parameters))
    const treeCounts = zones.filter(zone => zone.vegetation.some(row => row.role === 'tree')).map(zone => targets(document, { ...parameters, zones: [zone] }).tree)
    expect(treeCounts[0]).toBe(0); expect(treeCounts[1]).toBeGreaterThan(0)
    parameters.zones[0].vegetation.forEach(row => { row.coveragePpm = 0 })
    const zero = createWoodlandZones(document, parameters, 'zero')
    expect(zero.flatMap(zone => zone.vegetation).every(row => row.coveragePpm === 0)).toBe(true)
  })

  it('rejects insufficient regions, excessive existing targets and unsupported shapes without mutating the source', () => {
    const { document, parameters } = fixture(), before = canonicalJson(parameters)
    expect(() => createWoodlandZones(document, { ...parameters, boundsMm: { ...parameters.boundsMm, width: 15000 } }, 'small')).toThrow(/矩形|至少16/)
    const many = cloneJson(parameters); many.zones.push(cloneJson(many.zones[0]))
    expect(() => createWoodlandZones(document, many, 'many')).toThrow(/单块完整矩形/)
    const dense = cloneJson(parameters); dense.zones[0].vegetation = [dense.zones[0].vegetation[0]]
    const def = document.propDefinitions[dense.zones[0].vegetation[0].palette[0].definitionRef.id]
    def.defaultVisualBoundsMm.width = 10000; def.defaultVisualBoundsMm.height = 10000
    dense.zones[0].vegetation[0].coveragePpm = 1_000_000
    expect(() => createWoodlandZones(document, dense, 'dense')).toThrow(/区域不足/)
    def.defaultVisualBoundsMm.width = 100; def.defaultVisualBoundsMm.height = 100
    expect(() => createWoodlandZones(document, dense, 'many')).toThrow(/64件保护上限/)
    expect(canonicalJson(parameters)).toBe(before)
  })

  it('preserves the existing total limit of 64 instead of using two zones to bypass it', () => {
    const { document, parameters } = fixture()
    parameters.clearings = []
    parameters.zones[0].vegetation = [parameters.zones[0].vegetation[0]]
    const row = parameters.zones[0].vegetation[0], def = document.propDefinitions[row.palette[0].definitionRef.id]
    def.defaultVisualBoundsMm.width = 1000; def.defaultVisualBoundsMm.height = 1000
    row.coveragePpm = 83334
    const zones = createWoodlandZones(document, parameters, '64-trees')
    expect(targets(document, { ...parameters, zones }).tree).toBe(64)
    row.coveragePpm = 85000
    expect(() => createWoodlandZones(document, parameters, '65-trees')).toThrow(/64件保护上限/)
  })

  it('executes and replays strict forest inputs with real roots, activity clearing and full-width route', () => {
    const { document, parameters } = fixture(), supportRef = { kind: 'generated-ground' as const }
    parameters.entrances = [{ id: 'west', supportRef, positionMm: { x: 1200, y: 12000 }, directionDeg: 0, widthMm: 1800 }]
    parameters.routes = [{ id: 'route', fromEntranceId: 'west', toClearingId: 'camp', viaMm: [], widthMm: 1800, materialRef: null }]
    parameters.zones = createWoodlandZones(document, parameters, 'actual-copses')
    const input: ForestGenerationInput = { version: 1, algorithmVersion: 2, seed: 'actual-copses', parameters }
    const first = runForestGeneration(document, input, options), scene = cloneJson(first.candidate.document) as SceneDocument
    expect(first.report.propIds.length).toBeGreaterThan(0)
    expect(first.report.vegetation.filter(row => row.role === 'tree').every(row => row.placed > 0)).toBe(true)
    expect(runForestGeneration(document, input, options)).toEqual(first)
    expect(validateSceneDocument(scene).ok).toBe(true)
    const path = scene.paths[first.report.pathIds[0]]
    expect(checkTerrainRoute(scene, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok).toBe(true)
    for (const row of first.report.vegetation.filter(row => row.role === 'tree')) {
      const zone = parameters.zones.find(zone => zone.id === row.zoneId)!, cluster = scene.decorationClusters[row.clusterId]
      for (const member of Object.values(cluster.members)) if (member.entityId) {
        const footprint = propFootprint(scene.props[member.entityId])
        expect(polygonInside(footprint, zone.boundaryMm)).toBe(true)
        expect(supportedPolygon(scene, footprint, cluster.supportRef, path.floorId)).toBe(true)
      }
    }
  }, 30000)

  it('changes mixed vegetation while retaining exact building and approach inputs and actual geometry', () => {
    const document = domainExecutionFixture('forest').base, input = defaultMixedInputV4(document, 'forest', 'woodland-building')
    input.parameters.building.arrangement.furniture = false
    if (input.parameters.outdoor.kind !== 'forest') throw new Error('forest expected')
    const copied = cloneJson(input), before = canonicalJson(input)
    if (copied.parameters.outdoor.kind !== 'forest') throw new Error('forest expected')
    copied.parameters.outdoor.parameters.zones = createWoodlandZones(document, input.parameters.outdoor.parameters, input.seed)
    expect(copied.parameters.building).toEqual(input.parameters.building)
    expect(copied.parameters.approach).toEqual(input.parameters.approach)
    expect(canonicalJson(input)).toBe(before)
    const uniform = runMixedGeneration(document, input, options), copses = runMixedGeneration(document, copied, options)
    for (const collection of ['vertices', 'walls', 'rooms', 'openings', 'paths'] as const) expect(copses.candidate.document[collection]).toEqual(uniform.candidate.document[collection])
    expect(validateSceneDocument(copses.candidate.document).ok).toBe(true)
    expect(copses.report.propIds.length).toBeGreaterThan(0)
  }, 30000)
})
