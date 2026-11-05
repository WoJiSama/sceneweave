import { beforeAll, describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { generateTerrainDocumentV5 } from '../terrain-generation/surface-generation.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import type { VisualBoundary, VisualEdgeLook } from '../visual/types.js'
import { sampleVisualBoundary, visualSampleAtDistance } from '../visual/geometry.js'
import { visualBase } from '../visual/base.js'
import { buildIslandCliffDetailCommands, createIslandCliffDetailEdge } from './island-cliff-detail.js'
import { getLegacyVisual } from '../terrain-generation/composition-contracts.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { cloneJson } from '../validation/json.js'

let scene: SceneDocument
const context = () => { let id = 0; return { ids: { nextId: () => `island-cliff-token-${id++}` }, clock: { now: () => '2026-11-02T00:00:00Z' } } }
beforeAll(() => {
  const base = createShoreBlankDocument('island', { sceneId: 'cliff-detail-island', title: '固定岩岛', now: '2026-11-02T00:00:00Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const generated = generateTerrainDocumentV5(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000, algorithmVersion: 5, budgetProfileId: 'standard', quality: 'standard' })
  scene = { ...emptyCompositionDocument(composeTerrainDocument(base, generated, 'birth', TASK_BUDGET_PROFILES.standard).document), schemaVersion: 1, decorations: {}, decorationClusters: {} }
}, 60000)

describe('island-only persisted cliff detail', () => {
  it('stores a curve-bound face with light and dark shelves around the complete arc within the actual adoption budget', () => {
    const visual = visualBase(scene)!, crown = Object.values(scene.terrainAreas).sort((a, b) => b.groundElevationMm - a.groundElevationMm)[0]
    const looks = Object.values(visual.edgeLooks).filter(look => look.kind === 'cliff' && visual.boundaries[look.boundaryId].binding.kind === 'terrain'
      && (visual.boundaries[look.boundaryId].binding as { sides: { areaId: string }[] }).sides.some(side => side.areaId === crown.id))
    expect(looks.length).toBeGreaterThan(0)
    for (const look of looks) {
      const boundary = visual.boundaries[look.boundaryId], sampled = sampleVisualBoundary(boundary)
      const edge = createIslandCliffDetailEdge(boundary, look, `detail:${look.id}`)
      expect(createIslandCliffDetailEdge(visual.boundaries[look.boundaryId], look, edge.id)).toEqual(edge)
      expect([...edge.polygons.flat(), ...edge.strokes.flatMap(stroke => stroke.pointsMm)].every(point => Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y))).toBe(true)
      const fillRgb = [1, 3, 5].map(offset => Number.parseInt(edge.fillColor.slice(offset, offset + 2), 16))
      const fillLuminance = fillRgb[0]! * .2126 + fillRgb[1]! * .7152 + fillRgb[2]! * .0722
      expect(fillLuminance, 'the saved face is a readable mid-tone, not the inherited dark cliff band').toBeGreaterThanOrEqual(150)
      expect(edge.opacity).toBe(look.opacity)
      expect(edge.polygons).toHaveLength(1)
      const source = sampled.closed ? sampled.samples.slice(0, -1) : sampled.samples
      const faceSamples = source.length <= 256 ? source
        : Array.from({ length: 256 }, (_, index) => visualSampleAtDistance(sampled, sampled.lengthMm * index / (sampled.closed ? 256 : 255)))
      const face = edge.polygons[0]!
      expect(face).toHaveLength(faceSamples.length * 2)
      const sign = look.side === 'left' ? 1 : -1
      for (const [index, sample] of faceSamples.entries()) {
        expect(face[index]).toEqual(sample.positionMm)
        expect(face[faceSamples.length * 2 - 1 - index]).toEqual({
          x: Math.round(sample.positionMm.x + sample.normal.x * sign * look.widthMm),
          y: Math.round(sample.positionMm.y + sample.normal.y * sign * look.widthMm),
        })
      }
      const polylineLength = (points: PointMm[]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0)
      const strata = edge.strokes.filter(stroke => stroke.id.includes(':stratum-'))
      const fractures = edge.strokes.filter(stroke => stroke.id.includes(':fracture-'))
      expect(strata).toHaveLength(8)
      const nearestArc = (point: PointMm) => {
        let best = { distance: Infinity, arc: -1 }
        for (let index = 1; index < sampled.samples.length; index++) {
          const a = sampled.samples[index - 1]!, b = sampled.samples[index]!, dx = b.positionMm.x - a.positionMm.x, dy = b.positionMm.y - a.positionMm.y
          const t = Math.max(0, Math.min(1, ((point.x - a.positionMm.x) * dx + (point.y - a.positionMm.y) * dy) / (dx * dx + dy * dy)))
          const distance = Math.hypot(point.x - a.positionMm.x - t * dx, point.y - a.positionMm.y - t * dy)
          if (distance < best.distance) best = { distance, arc: a.distanceMm + t * (b.distanceMm - a.distanceMm) }
        }
        return best.arc
      }
      const sectors = new Set<number>()
      for (const [index, stroke] of strata.entries()) {
        expect(stroke.pointsMm).toHaveLength(index % 2 === 0 ? 2 : 3)
        expect(polylineLength(stroke.pointsMm)).toBeLessThanOrEqual(sampled.lengthMm / 8 * 1.05)
        const arcs = stroke.pointsMm.map(nearestArc)
        expect(arcs[0]).toBeLessThan(arcs.at(-1)!)
        const midpointArc = (arcs[0]! + arcs.at(-1)!) / 2
        for (let part = 0; part <= 8; part++) sectors.add(Math.floor(((arcs[0]! + (arcs.at(-1)! - arcs[0]!) * part / 8) % sampled.lengthMm) / sampled.lengthMm * 8))
        sectors.add(Math.floor(midpointArc / sampled.lengthMm * 8))
        expect(stroke.color).toBe(index % 2 ? look.accentColor : '#34443B')
      }
      expect([...sectors].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      for (const stroke of fractures) expect(polylineLength(stroke.pointsMm)).toBeLessThanOrEqual(look.widthMm * 1.2)
    }
    const plan = buildIslandCliffDetailCommands(scene, { nextId: context().ids.nextId })
    expect(plan.commands.filter(command => command.type === 'upsertMaterializedEdge')).toHaveLength(looks.length)
    let operationCost = 0
    const ids = context(), before = createCompositionContent(scene, ids), after = applyCompositionCommands(before, plan.commands, ids, { onOperationCost: value => { operationCost = value } })
    expect(Object.values(getLegacyVisual(after.document)!.materializedEdges).filter(edge => edge.kind === 'cliff')).toHaveLength(looks.length)
    expect(plan.commands.filter(command => command.type === 'upsertVisualEdgeLook').every(command => command.type !== 'upsertVisualEdgeLook' || !command.edgeLook.enabled)).toBe(true)
    expect(after.document.terrainAreas).toEqual(scene.terrainAreas)
    expect(after.document.terrainConnections).toEqual(scene.terrainConnections)
    const netCost = terrainCommandCost(scene, after.document, { before, after }).total
    expect(operationCost).toBeGreaterThan(0)
    expect(operationCost).toBeLessThanOrEqual(256)
    expect(netCost).toBeLessThanOrEqual(256)
    const locked = cloneJson(scene); visualBase(locked)!.boundaries[looks[0]!.boundaryId].editLocked = true
    expect(() => buildIslandCliffDetailCommands(locked, { nextId: context().ids.nextId })).toThrow(/锁定/)
  })

  it('handles short open and closed curves without adding to the source geometry', () => {
    const entity = { floorId: 'floor-short', layerId: 'layer-short', visibility: 'public' as const, editLocked: false }
    const short: VisualBoundary = { ...entity, id: 'short-cliff', closed: false, sampleSpacingMm: 1000, toleranceMm: 50,
      binding: { kind: 'decoration' }, segments: [{ id: 'short-segment', start: { x: 0, y: 0 }, control1: { x: 120, y: 0 },
        control2: { x: 280, y: 0 }, end: { x: 400, y: 0 } }] }
    const square: VisualBoundary = { ...entity, id: 'closed-cliff', closed: true, sampleSpacingMm: 1000, toleranceMm: 50,
      binding: { kind: 'decoration' }, segments: [
        { id: 's0', start: { x: 0, y: 0 }, control1: { x: 1333, y: 0 }, control2: { x: 2667, y: 0 }, end: { x: 4000, y: 0 } },
        { id: 's1', start: { x: 4000, y: 0 }, control1: { x: 4000, y: 1333 }, control2: { x: 4000, y: 2667 }, end: { x: 4000, y: 4000 } },
        { id: 's2', start: { x: 4000, y: 4000 }, control1: { x: 2667, y: 4000 }, control2: { x: 1333, y: 4000 }, end: { x: 0, y: 4000 } },
        { id: 's3', start: { x: 0, y: 4000 }, control1: { x: 0, y: 2667 }, control2: { x: 0, y: 1333 }, end: { x: 0, y: 0 } },
      ] }
    const cliffLook = (boundary: VisualBoundary): VisualEdgeLook => ({ ...entity, id: `${boundary.id}-look`, boundaryId: boundary.id, kind: 'cliff', side: 'right',
      widthMm: 720, color: '#737D76', accentColor: '#D9C8A0', opacity: .9, intensity: 1, seed: boundary.id, repeatMm: 500, enabled: true })
    const shortBefore = cloneJson(short), squareBefore = cloneJson(square)
    const shortEdge = createIslandCliffDetailEdge(short, cliffLook(short), 'short-detail')
    const squareEdge = createIslandCliffDetailEdge(square, cliffLook(square), 'square-detail')
    expect(shortEdge.polygons[0]).toHaveLength(4)
    expect(squareEdge.polygons[0]!.length).toBeGreaterThanOrEqual(8)
    expect(short).toEqual(shortBefore)
    expect(square).toEqual(squareBefore)
  })
})
