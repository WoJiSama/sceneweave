import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createRegionalFeasibilityVector } from './regional-vector.js'
import { prepareRegionalAuthoring, prepareRegionalDrillDown, regionalAuthoringRequestSchema } from './regional-authoring.js'
import { projectScene } from '../projection/projection.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'

const base = () => createRefinedBlankDocument('island', { sceneId: 'regional-authoring-test', title: '区域测试', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-27T00:00:00.000Z' })
describe('T5 regional authoring', () => {
  it('creates bounded public area and line records without physical entities', () => {
    const source = createRegionalFeasibilityVector(base()).document
    const request = regionalAuthoringRequestSchema.parse({ kind: 'regional', sceneId: 'regional-add', operationId: 'regional-add', seed: 'regional-seed', widthMm: 1_000_000, heightMm: 800_000, title: '区域添加', floorId: 'visual-floor', layerId: 'visual-layer-ground', areas: [{ id: 'regional-new-area', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: [{ x: 100000, y: 100000 }, { x: 200000, y: 100000 }, { x: 200000, y: 200000 }], kind: 'hill', style: { fill: '#AA9977', stroke: '#554433', strokeWidthMm: 1000, opacity: 1 }, relativeElevationMm: 200 }], lines: [{ id: 'regional-new-road', floorId: 'visual-floor', layerId: 'visual-layer-ground', pointsMm: [{ id: 'road-p0', positionMm: { x: 100000, y: 250000 } }, { id: 'road-p1', positionMm: { x: 300000, y: 250000 } }], kind: 'road', displayWidthMm: 10000, actualWidthMm: null, style: { fill: '#BAA27D', stroke: '#8E795C', strokeWidthMm: 10000, opacity: 1 } }] })
    const next = prepareRegionalAuthoring(base(), request).document
    expect(next.regional?.areas['regional-regional-add-land']).toBeDefined(); expect(next.regional?.lines['regional-regional-add-river']).toBeDefined()
    expect(Object.keys(next.rooms)).toHaveLength(0); expect(projectScene(next, 'player').regional?.lines.length).toBeGreaterThan(0)
  })
  it('allows full regional bounds and private rows stay out of player projection', () => {
    const source = createRegionalFeasibilityVector(base()).document
    expect(prepareRegionalAuthoring(base(), { kind: 'regional', sceneId: 'legal-regional', operationId: 'legal-regional', seed: 'seed', widthMm: 500001, heightMm: 800000, areas: [], lines: [] }).document.exportBoundsMm.width).toBe(500001)
    source.regional!.areas['private'] = { ...source.regional!.areas['regional-vector-land'], id: 'private', visibility: 'gm' }
    expect(projectScene(source, 'player').regional?.areas.some(area => area.id === 'private')).toBe(false)
  })

  it('gives a regenerated independent region its own output bounds without changing its source', () => {
    const source = createRegionalFeasibilityVector(base()).document
    source.floors['visual-floor'].outputBoundsMm = { x: 1_000_000, y: 1_000_000, width: 8_000_000, height: 6_000_000 }
    const before = canonicalJson(source)
    const next = prepareRegionalAuthoring(source, { kind: 'regional', sceneId: 'smaller-region', operationId: 'smaller-region', widthMm: 600_000, heightMm: 500_000 }).document
    const bounds = { x: 0, y: 0, width: 600_000, height: 500_000 }
    expect(next.floors['visual-floor'].boundsMm).toEqual(bounds)
    expect(projectScene(next, 'player').bounds).toEqual(bounds)
    expect(validateSceneDocument(next).ok).toBe(true)
    expect(canonicalJson(source)).toBe(before)
  })

  it('normalizes independent drill-down output while retaining the exact nonzero parent selection', () => {
    const source = createRegionalFeasibilityVector(base()).document
    source.floors['visual-floor'].outputBoundsMm = { x: 1_000_000, y: 1_000_000, width: 8_000_000, height: 6_000_000 }
    const before = canonicalJson(source), selectionMm = { x: 2_000_000, y: 3_000_000, width: 100_000, height: 80_000 }
    const request = { kind: 'regionalDrillDown', sourceSceneId: source.sceneId, sceneId: 'independent-child', operationId: 'independent-child', selectionMm, includePrivate: false }
    const result = prepareRegionalDrillDown(source, request), bounds = { x: 0, y: 0, width: 100_000, height: 80_000 }
    expect(result.document.exportBoundsMm).toEqual(bounds)
    expect(result.document.floors['visual-floor'].boundsMm).toEqual(bounds)
    expect(projectScene(result.document, 'player').bounds).toEqual(bounds)
    expect(result.sourceLink.selectionMm).toEqual(selectionMm)
    expect(result.sourceLink.translationMm).toEqual({ x: -2_000_000, y: -3_000_000 })
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(() => prepareRegionalDrillDown(source, { ...request, selectionMm: { ...selectionMm, width: 500_001 } })).toThrow(/500m/)
    expect(canonicalJson(source)).toBe(before)
  })
})
