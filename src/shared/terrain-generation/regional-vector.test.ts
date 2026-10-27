import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { terrainCommandCost } from './cost.js'
import { createRegionalFeasibilityVector } from './regional-vector.js'

const blank = () => createRefinedBlankDocument('island', { sceneId: 'regional-vector-test', title: '区域技术向量', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-26T00:00:00.000Z' })
describe('T0 independent 10x8km regional budget witness', () => {
  it('retains a full strict regional result with actual per-point/per-record budget below256', () => {
    const base = blank(), before = canonicalJson(base), vector = createRegionalFeasibilityVector(base), { document, empty, cost } = vector
    expect(canonicalJson(base)).toBe(before)
    expect(document.schemaVersion).toBe(3); expect(document.mapMode).toBe('regional')
    expect(document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 10000000, height: 8000000 })
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(Object.keys(document.regional!.areas)).toHaveLength(3)
    expect(Object.keys(document.regional!.lines)).toHaveLength(3)
    expect(Object.keys(document.regional!.landmarks)).toHaveLength(0)
    expect(Object.keys(document.regional!.symbols)).toHaveLength(0)
    for (const key of ['props', 'terrainAreas', 'terrainConnections', 'paths'] as const) expect(document[key]).toEqual({})
    expect(cost).toEqual(terrainCommandCost(empty, document))
    expect(cost.total).toBeLessThanOrEqual(256)
    expect(cost.items['regional.areas']).toBe(Object.values(document.regional!.areas).reduce((sum, area) => sum + 1 + area.boundaryMm.length * 2, 0))
    expect(cost.items['regional.lines']).toBe(Object.values(document.regional!.lines).reduce((sum, line) => sum + 1 + line.pointsMm.length * 2 - 1, 0))
    expect(cost.items['generation.ownership']).toBe(6)
    expect(Object.values(document.generation!.rules)[0].state).toBe('paused')
    expect(document.regional!.lines['regional-vector-road'].actualWidthMm).toBeNull()
  })
  it('keeps exact metadata/resources and is deterministic after a strict JSON cold read', () => {
    const first = createRegionalFeasibilityVector(blank()), second = createRegionalFeasibilityVector(blank())
    expect(canonicalJson(second)).toBe(canonicalJson(first))
    const cold = JSON.parse(canonicalJson(first.document))
    expect(validateSceneDocument(cold).ok).toBe(true)
    expect(first.document.assets).toEqual(blank().assets)
  })
  it('rejects locked or populated input and exposes stale managed output rather than repairing it on load', () => {
    const locked = blank(); locked.userLayers['visual-layer-ground'].editLocked = true
    expect(() => createRegionalFeasibilityVector(locked)).toThrow(/图层/)
    const { document } = createRegionalFeasibilityVector(blank()), changed = cloneJson(document)
    changed.regional!.areas['regional-vector-water'].boundaryMm[3].y += 1000
    expect(validateSceneDocument(changed).ok).toBe(false)
    expect(validateSceneDocument(document).ok).toBe(true)
  })
})
