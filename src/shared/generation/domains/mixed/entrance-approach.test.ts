import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { resolveBuildingEntrancePort } from '../../building-port.js'
import { ENTRANCE_APPROACH_LIMITS, planBuildingEntranceApproaches } from './entrance-approach.js'

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture(side: 'top' | 'right' | 'bottom' | 'left' = 'top', reversed = false) {
  const source = createShoreBlankDocument('island', { sceneId: 'mixed-v3-approach', title: '法向接路', now: '2026-11-10T00:00:00.000Z', widthMm: 20000, heightMm: 16000, preset: 'narrative' })
  let sequence = 0
  const runtime = { clock: { now: () => source.updatedAt }, ids: { nextId: () => `approach-native-${++sequence}` } }
  const boundaryMm = rectangle(4000, 4000, 6000, 6000)
  let document = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rectangle(0, 0, 20000, 16000), groundElevationMm: 0, coveragePriority: 0 },
    { type: 'createRoom', id: 'building', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: reversed ? boundaryMm.reverse() : boundaryMm, thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime)
  const wall = Object.values(document.walls).find(row => {
    const a = document.vertices[row.startVertexId], b = document.vertices[row.endVertexId]
    return side === 'top' ? a.yMm === 4000 && b.yMm === 4000 : side === 'bottom' ? a.yMm === 10000 && b.yMm === 10000
      : side === 'left' ? a.xMm === 4000 && b.xMm === 4000 : a.xMm === 10000 && b.xMm === 10000
  })!
  document = applyCommands(document, [{ type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open' }], runtime)
  const port = resolveBuildingEntrancePort(document, 'door', 1000)
  const fromMm = { top: { x: 2000, y: 2000 }, right: { x: 15000, y: 2000 }, bottom: { x: 16000, y: 13000 }, left: { x: 2000, y: 13000 } }[side]
  const input = { port, fromMm, viaMm: [], buildingBoundsMm: { x: 4000, y: 4000, width: 6000, height: 6000 }, wallThicknessMm: 400 }
  return { document, runtime, input }
}

describe('version 3 finite doorway approach planning', () => {
  it.each(['top', 'right', 'bottom', 'left'] as const)('enters the actual %s doorway along its outward normal in either room winding', side => {
    for (const reversed of [false, true]) {
      const { document, input } = fixture(side, reversed), before = canonicalJson(document), plan = planBuildingEntranceApproaches(input), port = input.port
      expect(plan.variantsMm.length).toBeLessThanOrEqual(ENTRANCE_APPROACH_LIMITS.variants)
      const usable = plan.variantsMm.filter(pointsMm => checkTerrainRoute(document, { floorId: port.floorId, widthMm: port.widthMm, pointsMm: [...pointsMm, port.insideMm] }).ok)
      expect(usable.length).toBeGreaterThan(0)
      for (const points of usable) {
        const last = points.at(-1)!, previous = points.at(-2)!
        expect(last).toEqual(port.outsideMm)
        expect(previous).toEqual(plan.leadPointMm)
        // The incoming vector has exactly the doorway corridor's inward direction.
        expect(Math.sign(last.x - previous.x)).toBe(Math.sign(port.insideMm.x - port.outsideMm.x))
        expect(Math.sign(last.y - previous.y)).toBe(Math.sign(port.insideMm.y - port.outsideMm.y))
        expect(Math.hypot(last.x - previous.x, last.y - previous.y)).toBeGreaterThanOrEqual(port.widthMm)
      }
      expect(canonicalJson(document)).toBe(before)
    }
  })

  it('keeps explicit waypoints in order while trying finite alternatives after the last waypoint', () => {
    const { document, input } = fixture(), viaMm = [{ x: 2000, y: 1500 }, { x: 4500, y: 1500 }]
    const plan = planBuildingEntranceApproaches({ ...input, viaMm })
    for (const points of plan.variantsMm) expect(points.slice(0, 3)).toEqual([input.fromMm, ...viaMm])
    expect(plan.variantsMm.some(pointsMm => checkTerrainRoute(document, { floorId: input.port.floorId, widthMm: 1000, pointsMm: [...pointsMm, input.port.insideMm] }).ok)).toBe(true)
    const replay = planBuildingEntranceApproaches({ ...input, viaMm })
    plan.variantsMm[0][0].x++
    expect(replay).toEqual(planBuildingEntranceApproaches({ ...input, viaMm }))
    expect(input.fromMm.x).toBe(2000)
  })

  it('finds a bounded detour when direct travel crosses the building and refuses a narrow blocked final band', () => {
    const { document, runtime, input } = fixture(), across = { ...input, fromMm: { x: 7000, y: 13000 } }
    const plan = planBuildingEntranceApproaches(across)
    const checked = plan.variantsMm.map(pointsMm => checkTerrainRoute(document, { floorId: input.port.floorId, widthMm: 1000, pointsMm: [...pointsMm, input.port.insideMm] }))
    expect(checked[0].ok).toBe(false); expect(checked.some(row => row.ok)).toBe(true)
    const blocked = applyCommands(document, [{ type: 'createTerrainArea', id: 'edge-blocker', floorId: input.port.floorId, boundaryMm: rectangle(7450, 2700, 400, 300), groundElevationMm: 0, coveragePriority: 1, blocksMovement: true }], runtime)
    const near = planBuildingEntranceApproaches(input)
    expect(near.variantsMm.some(pointsMm => checkTerrainRoute(blocked, { floorId: input.port.floorId, widthMm: 800, pointsMm: [...pointsMm, input.port.insideMm] }).ok)).toBe(true)
    expect(near.variantsMm.every(pointsMm => !checkTerrainRoute(blocked, { floorId: input.port.floorId, widthMm: 1000, pointsMm: [...pointsMm, input.port.insideMm] }).ok)).toBe(true)
  })

  it('rejects inconsistent ports, excessive via points and unsafe arithmetic before returning suggestions', () => {
    const { input } = fixture(), wrong = cloneJson(input)
    wrong.port.directionDeg = 0
    expect(() => planBuildingEntranceApproaches(wrong)).toThrow(/正交/)
    expect(() => planBuildingEntranceApproaches({ ...input, viaMm: Array(17).fill(input.fromMm) })).toThrow(/有限/)
    expect(() => planBuildingEntranceApproaches({ ...input, buildingBoundsMm: { ...input.buildingBoundsMm, x: Number.MAX_SAFE_INTEGER } })).toThrow(/范围/)
  })
})
