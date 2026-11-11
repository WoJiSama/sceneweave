import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../shared/commands/commands.js'
import { canonicalJson } from '../../shared/validation/json.js'
import type { SurfaceRef } from '../../shared/model/scene.js'
import { checkRoadRouteAdvice, suggestRoadRoute, type RoadRouteAdviceRequest } from './road-route-advice.js'

function fixture(blocked = false) {
  let document = createShoreBlankDocument('island', { sceneId: 'road-advice', title: '道路净宽建议', now: '2026-11-10T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
  if (blocked) document = applyCommands(document, [{ type: 'createRegion', id: 'obstacle', floorId: 'visual-floor', layerId: 'visual-layer-ground', kind: 'hazard', visibility: 'public',
    boundaryMm: [{ x: 8000, y: 6000 }, { x: 12000, y: 6000 }, { x: 12000, y: 10000 }, { x: 8000, y: 10000 }], blocksMovement: true, movementCostMultiplier: 1 }],
  { clock: { now: () => document.updatedAt }, ids: { nextId: () => 'unused-road-id' } })
  return document
}
const request = (): RoadRouteAdviceRequest => ({ floorId: 'visual-floor', widthMm: 1000, pointsMm: [{ x: 4000, y: 8000 }, { x: 16000, y: 8000 }],
  supportRefs: [{ kind: 'floor', id: 'visual-floor' }], gridMm: 1000, maxNodes: 512 })

describe('explicit complete road band advice', () => {
  it('checks full width without changing the source or requested supports', () => {
    const scene = fixture(), input = request(), before = canonicalJson(scene), original = canonicalJson(input)
    expect(checkRoadRouteAdvice(scene, input)).toMatchObject({ ok: true, status: 'checked', lengthMm: 12000, supportChanged: false, pointsMm: input.pointsMm })
    expect(canonicalJson(scene)).toBe(before)
    expect(canonicalJson(input)).toBe(original)
    const failed = checkRoadRouteAdvice(fixture(true), input)
    expect(failed.ok).toBe(false)
    expect(failed.issues.some(issue => issue.entityId === 'obstacle')).toBe(true)
  })
  it('preserves every supplied waypoint and does not create a detour for an already clear route', () => {
    const scene = fixture(true), input = { ...request(), pointsMm: [{ x: 4000, y: 8000 }, { x: 4000, y: 4000 }, { x: 16000, y: 4000 }, { x: 16000, y: 8000 }] }
    const result = suggestRoadRoute(scene, input)
    expect(result).toMatchObject({ ok: true, status: 'found', expandedNodes: 0, pointsMm: input.pointsMm })
    result.pointsMm[0].x = 1
    expect(input.pointsMm[0].x).toBe(4000)
  })
  it('reports a bounded search failure without providing a partial replacement', () => {
    const scene = fixture(true), input = { ...request(), maxNodes: 1 }, original = canonicalJson(input)
    expect(suggestRoadRoute(scene, input)).toMatchObject({ ok: false, status: 'budget', pointsMm: [], expandedNodes: 1 })
    expect(canonicalJson(input)).toBe(original)
  })
  it('returns a full-width detour while retaining an explicit intermediate waypoint', () => {
    const scene = fixture(true), via = { x: 5000, y: 8000 }, input = { ...request(), pointsMm: [request().pointsMm[0], via, request().pointsMm[1]] }
    const suggested = suggestRoadRoute(scene, input)
    expect(suggested.ok).toBe(true)
    expect(suggested.pointsMm).toContainEqual(via)
    expect(suggested.pointsMm[0]).toEqual(input.pointsMm[0])
    expect(suggested.pointsMm.at(-1)).toEqual(input.pointsMm.at(-1))
    expect(checkRoadRouteAdvice(scene, { ...input, pointsMm: suggested.pointsMm }).ok).toBe(true)
    expect(suggested.expandedNodes).toBeLessThanOrEqual(input.maxNodes!)
  })
  it('shows a real support change for explicit adoption instead of rewriting the selection', () => {
    const scene = fixture(), input = request()
    const changed = { ...input, supportRefs: [{ kind: 'terrainArea', id: 'previous-support' }] as SurfaceRef[] }
    expect(checkRoadRouteAdvice(scene, changed)).toMatchObject({ ok: true, supportChanged: true, supportRefs: input.supportRefs })
    expect(changed.supportRefs).toEqual([{ kind: 'terrainArea', id: 'previous-support' }])
  })
  it('refuses invalid points, widths and node budgets', () => {
    const scene = fixture()
    for (const change of [{ widthMm: 0 }, { maxNodes: 0 }, { maxNodes: 16385 }, { pointsMm: Array.from({ length: 129 }, (_, x) => ({ x, y: 0 })) },
      { pointsMm: [{ x: 0.5, y: 0 }, { x: 1000, y: 1000 }] }]) {
      expect(suggestRoadRoute(scene, { ...request(), ...change })).toMatchObject({ ok: false, status: 'invalid', pointsMm: [] })
    }
  })
  it('refuses a joined reversal even if each original leg can be travelled', () => {
    const scene = fixture(), input = { ...request(), pointsMm: [{ x: 4000, y: 8000 }, { x: 16000, y: 8000 }, { x: 4000, y: 8000 }] }
    expect(suggestRoadRoute(scene, input)).toMatchObject({ ok: false, status: 'not-found', pointsMm: [] })
  })
})
