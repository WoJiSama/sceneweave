import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { TASK_BUDGET_PROFILES, captureExecutionBudget } from '../budget/task-budget.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { prepareRegionalAuthoring, prepareRegionalEdit } from './regional-authoring.js'
import { canonicalJson } from '../validation/json.js'

const profile = TASK_BUDGET_PROFILES.small
const blank = () => createRefinedBlankDocument('island', { sceneId: 'task-budget-region', title: '区域测试', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-30T00:00:00.000Z' })
describe('explicit profiled terrain admission', () => {
  it('admits a real 160-point area as one edit while legacy mixed expansion remains capped at 256', () => {
    const base = prepareRegionalAuthoring(blank(), { kind: 'regional', sceneId: 'task-budget-region', operationId: 'region-base', widthMm: 1_000_000, heightMm: 800_000 }).document
    const original = canonicalJson(base), request = { kind: 'regionalEdit', sceneId: base.sceneId, operationId: 'large-geometry', operation: 'upsertArea',
      area: { id: 'many-points', kind: 'hill', boundaryMm: Array.from({ length: 160 }, (_, i) => ({ x: Math.round(500000 + 150000 * Math.cos(i * Math.PI / 80)), y: Math.round(400000 + 150000 * Math.sin(i * Math.PI / 80)) })) } }
    expect(() => prepareRegionalEdit(base, request)).toThrow(/256/)
    const next = prepareRegionalEdit(base, request, { budget: profile, meter: captureExecutionBudget(profile) })
    expect(next.cost).toMatchObject({ total: 1, limit: 512 })
    expect(next.budget).toMatchObject({ countingVersion: 2, profileHash: profile.profileHash, usage: { geometryPoints: 160, candidateAttempts: 1 } })
    expect(canonicalJson(base)).toBe(original)
    const locked = structuredClone(base); locked.userLayers['visual-layer-ground'].editLocked = true
    expect(() => prepareRegionalEdit(locked, request, { budget: profile })).toThrow(/锁定/)
  })
  it('meters actual polygon validation comparisons and keeps spent comparisons on failure', () => {
    const meter = captureExecutionBudget(profile), rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(polygonBoolean({ operation: 'union', subject: [rect], clip: [] }, meter).vertexCount).toBe(4)
    expect(meter.snapshot().intersectionPairs).toBeGreaterThan(0)
    const spent = meter.snapshot().intersectionPairs
    expect(() => polygonBoolean({ operation: 'union', subject: [[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 8, y: 0 }]], clip: [] }, meter)).toThrow()
    expect(meter.snapshot().intersectionPairs).toBeGreaterThan(spent)
    expect(meter.snapshot().gridNodes).toBe(0)
  })
})
