import { describe, expect, it } from 'vitest'
import { createDetailedIslandDocument } from '../../platform/browser/content/detailed-island.js'
import { connectionFootprint } from '../geometry/geometry.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { connectionRouteSchema, sampleConnectionRoute } from '../geometry/connection-route.js'
import { validateSceneDocument } from '../validation/scene.js'
import { canonicalJson } from '../validation/json.js'
import { projectScene } from '../projection/projection.js'
import { projectionAssetConsumers } from '../projection/presentation-contract.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { VisualAuthoringOperationSchema } from '../ai/visual-protocol.js'
import { visualBase } from './base.js'

function fixture() {
  const scene = createDetailedIslandDocument()
  // This metadata-only transaction fixture has no browser-materalized tint
  // derivatives. Real fixed pixel/source closure is checked by production UI.
  const untinted = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (Object.hasOwn(record, 'tint')) record.tint = null
    Object.values(record).forEach(untinted)
  }
  untinted(scene)
  const connection = scene.terrainConnections['q1-stairs'], start = connection.from.positionMm, end = connection.to.positionMm
  const controls = { version: 1 as const, kind: 'polyline' as const,
    segments: [{ id: 'detail-profile-route-source', start: { ...start }, control1: { ...start }, control2: { ...end }, end: { ...end } }],
    sampleSpacingMm: 500, toleranceMm: 20, stairStyle: 'naturalRock' as const, treadDepthMm: 280 }
  connection.route = { ...controls, centerlineMm: sampleConnectionRoute(controls) }
  return scene
}

describe('explicit saved rock rendering profiles', () => {
  it.each(['naturalRockSteps2', 'naturalRockSteps3', 'naturalRockSteps4'] as const)('keeps the same full physical connection band while %s reaches both audience projections', profile => {
    const scene = fixture(), source = structuredClone(scene), old = connectionFootprint(scene.terrainConnections['q1-stairs'])
    const cliffProfile = profile === 'naturalRockSteps4' ? 'rockRelief4' : profile === 'naturalRockSteps3' ? 'rockRelief3' : 'rockRelief2'
    scene.terrainConnections['q1-stairs'].route!.renderProfile = profile
    visualBase(scene)!.edgeLooks['q1-crown-cliff'].renderProfile = cliffProfile
    expect(validateSceneDocument(scene).ok).toBe(true)
    expect(polygonBoolean({ operation: 'difference', subject: [old], clip: [connectionFootprint(scene.terrainConnections['q1-stairs'])] }).polygons).toEqual([])
    for (const audience of ['gm', 'player'] as const) {
      const projection = projectScene(scene, audience), previous = projectScene(source, audience)
      expect(projection.connections.find(row => row.id === 'q1-stairs')!.route!.renderProfile).toBe(profile)
      expect(projection.connections.map(row => { const copy = structuredClone(row); if (copy.route) delete copy.route.renderProfile; return copy })).toEqual(previous.connections)
      expect(projection.visual!.edgeLooks.find(row => row.id === 'q1-crown-cliff')!.renderProfile).toBe(cliffProfile)
      expect(projectionAssetConsumers(projection).complete).toBe(true)
    }
  })
  it('rejects unknown or incompatible profiles instead of silently falling back to a different style', () => {
    const scene = fixture(), connection = scene.terrainConnections['q1-stairs'], visual = visualBase(scene)!
    const route = { ...connection.route!, renderProfile: 'naturalRockSteps2' as const }
    expect(connectionRouteSchema.safeParse(route).success).toBe(true)
    for (const value of ['unknown', 2, null]) expect(connectionRouteSchema.safeParse({ ...route, renderProfile: value }).success).toBe(false)
    expect(connectionRouteSchema.safeParse({ ...route, stairStyle: 'wood' }).success).toBe(false)
    connection.route = route; connection.kind = 'ramp'
    const ramp = validateSceneDocument(scene)
    expect(!ramp.ok && ramp.errors.some(row => row.code === 'CONNECTION_RENDER_PROFILE')).toBe(true)
    connection.kind = 'stairs'; visual.edgeLooks['q1-crown-grass'].renderProfile = 'rockRelief2'
    const grass = validateSceneDocument(scene)
    expect(!grass.ok && grass.errors.some(row => row.code === 'VISUAL_RENDER_PROFILE')).toBe(true)
  })
  it.each(['naturalRockSteps2', 'naturalRockSteps3', 'naturalRockSteps4'] as const)('uses ordinary transactions and complete source identity for %s without mutating the original model or fixed assets', profile => {
    const scene = fixture(), before = canonicalJson(scene); let n = 0
    const runtime = { ids: { nextId: () => `detail-profile-token-${++n}` }, clock: { now: () => scene.updatedAt } }
    const content = createCompositionContent(scene, runtime), edge = visualBase(scene)!.edgeLooks['q1-crown-cliff']
    const cliffProfile = profile === 'naturalRockSteps4' ? 'rockRelief4' : profile === 'naturalRockSteps3' ? 'rockRelief3' : 'rockRelief2'
    const next = applyCompositionCommands(content, [{ type: 'updateTerrainConnection', id: 'q1-stairs', changes: { route: { ...scene.terrainConnections['q1-stairs'].route!, renderProfile: profile } } },
      { type: 'upsertVisualEdgeLook', edgeLook: { ...edge, renderProfile: cliffProfile } }], runtime)
    expect(next.historyIdentity).toEqual(content.historyIdentity)
    expect(next.document.assets).toEqual(scene.assets); expect(next.document.materials).toEqual(scene.materials)
    expect(next.document.props).toEqual(scene.props); expect(next.document.terrainAreas).toEqual(scene.terrainAreas)
    const cold = JSON.parse(canonicalJson(next.document))
    expect(validateSceneDocument(cold).ok).toBe(true)
    expect(visualBase(cold)!.edgeLooks['q1-crown-cliff'].renderProfile).toBe(cliffProfile)
    expect(cold.terrainConnections['q1-stairs'].route.renderProfile).toBe(profile)
    expect(canonicalJson(scene)).toBe(before)
  })
  it('keeps private profile edits out of the player projection and does not expand the AI visual protocol', () => {
    const scene = fixture(), edge = visualBase(scene)!.edgeLooks['q1-crown-cliff']
    edge.visibility = 'gm'
    const before = canonicalJson(projectScene(scene, 'player'))
    edge.renderProfile = 'rockRelief4'
    expect(canonicalJson(projectScene(scene, 'player'))).toBe(before)
    const { floorId: _floor, layerId: _layer, visibility: _visibility, editLocked: _lock, kind, ...fields } = edge
    expect(VisualAuthoringOperationSchema.safeParse({ kind: 'visualEdge', edgeKind: kind, ...fields }).success).toBe(false)
  })
})
