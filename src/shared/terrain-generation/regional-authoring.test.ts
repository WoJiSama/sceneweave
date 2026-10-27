import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createRegionalFeasibilityVector } from './regional-vector.js'
import { prepareRegionalAuthoring, regionalAuthoringRequestSchema } from './regional-authoring.js'
import { projectScene } from '../projection/projection.js'

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
})
