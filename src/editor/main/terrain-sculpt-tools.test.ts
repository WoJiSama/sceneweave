import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import builtin from '../../platform/browser/content/builtin-data.json'
import { applyCompositionCommands } from '../../shared/appearance/commands'
import { addSurfaceAppearanceSource, createCompositionContent } from '../../shared/appearance/graph'
import { applyCommands } from '../../shared/commands/commands'
import { canonicalTerrainEdge, previewOutdoorCommands } from '../../shared/commands/outdoor'
import { supportSurfaceAt, validateGeometry } from '../../shared/geometry/geometry'
import { checkTerrainTravel } from '../../shared/geometry/terrain-travel'
import { projectScene } from '../../shared/projection/projection'
import type { AppearanceGraph } from '../../shared/model/appearance'
import { toCurrentSceneDocument } from '../../shared/model/current-scene'
import type { PointMm, SceneDocument, TerrainArea } from '../../shared/model/scene'
import { createEmptyGeneration5 } from '../../shared/terrain-generation/composition-contracts'
import { emptyVisualSystem } from '../../shared/visual/types'
import TerrainSculptTools from './TerrainSculptTools'
import { createTerrainSculptToolState, inspectTerrainSculptSelection, terrainSculptCommands, TERRAIN_SCULPT_MAX_POINTS } from './terrain-sculpt-tools'

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const scope = () => rect(2000, 2000, 3000, 3000)
const runtime = () => { let id = 0; return { ids: { nextId: () => `sculpt-test-token-${id++}` }, clock: { now: () => '2026-11-10T00:00:00.000Z' } } }
function fixture() {
  const scene = toCurrentSceneDocument(structuredClone(builtin.project.document) as unknown as SceneDocument)
  const floorId = Object.keys(scene.floors)[0], layerId = 'sculpt-layer'
  scene.floors[floorId].boundsMm = { x: -1000, y: -1000, width: 30000, height: 20000 }
  scene.exportBoundsMm = { ...scene.floors[floorId].boundsMm }
  scene.userLayers = { [layerId]: { id: layerId, floorId, name: '裸地形层', order: 0, editLocked: false } }
  scene.vertices = {}; scene.rooms = {}; scene.walls = {}; scene.openings = {}; scene.paths = {}; scene.terrainConnections = {}
  scene.terrainAreas = {}; scene.terrainEdges = {}; scene.props = {}; scene.notes = {}; scene.regions = {}
  scene.prefabInstances = {}; scene.scatterGroups = {}; scene.decorations = {}; scene.decorationClusters = {}; scene.surfaceRules = {}
  scene.entityLayers = {}; scene.constraints = { entranceOpeningIds: [], wallEndClearanceMm: 100, pathChecks: [] }
  scene.generation = createEmptyGeneration5(); scene.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
  delete scene.aggregateCoordinates
  const area = (id: string, points = rect(0, 0, 10000, 10000), height = 0, priority = 1): TerrainArea => {
    const value: TerrainArea = { id, floorId, editLocked: false, visibility: 'public', groundElevationMm: height, coveragePriority: priority,
      boundaryMm: points.map((positionMm, index) => ({ id: `${id}-p-${index}`, segmentId: `${id}-s-${index}`, positionMm })),
      surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.terrainAreas[id] = value; scene.entityLayers[id] = layerId; return value
  }
  area('ground'); area('remote', rect(15000, 0, 5000, 5000), 1000)
  const appearance: AppearanceGraph = { version: 2, sources: {}, propSources: {}, surfaceSources: {}, instanceAdjustments: {}, layerAdjustments: {}, variants: {}, prefabAppearanceTemplates: {}, presentations: {} }
  return { project: { document: scene, appearance }, scene, floorId, layerId, area }
}

describe('real local terrain sculpting', () => {
  it('clips world paint into fresh fragments and keeps the original surface, source and manual appearance intact', () => {
    const { scene } = fixture(), context = runtime(), material = Object.values(scene.materials).find(value => value.applicableSurfaces.includes('terrain'))!
    const paint = { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 1700, height: 2300 }, rotationDeg: 23,
      alignment: 'world' as const, originMm: { x: -600, y: 750 }, tint: null, opacity: 1 }
    scene.terrainAreas.ground.surfaceStyle = { base: paint, overlays: [
      { id: 'manual-crossing', boundaryMm: rect(1000, 1500, 2500, 2500), paint: { ...paint, opacity: .65 }, blendWidthMm: 180, renderOrder: 7 },
      { id: 'manual-outside', boundaryMm: rect(7000, 7000, 1000, 1000), paint, blendWidthMm: 80, renderOrder: 9 },
    ] }
    const base = createCompositionContent(scene, context), before = structuredClone(base)
    const result = terrainSculptCommands(base, ['ground'], scope(), 800, 'paint-fragments')
    const next = applyCompositionCommands(base, result.commands, context), style = next.document.terrainAreas[result.createdAreaId].surfaceStyle!
    expect(result.overlayFragmentCount).toBe(1)
    expect(style.base).toEqual(paint)
    expect(style.overlays[0]).toMatchObject({ boundaryMm: rect(2000, 2000, 1500, 2000), paint: { ...paint, opacity: .65 }, blendWidthMm: 180, renderOrder: 7 })
    expect(style.overlays[0].id).not.toBe('manual-crossing')
    expect(next.document.terrainAreas.ground).toEqual(base.document.terrainAreas.ground)
    expect(next.appearance.surfaceSources.ground).toBe(base.appearance.surfaceSources.ground)
    expect(next.appearance.sources[base.appearance.surfaceSources.ground]).toEqual(base.appearance.sources[base.appearance.surfaceSources.ground])
    expect(next.appearance.surfaceSources[result.createdAreaId]).not.toBe(base.appearance.surfaceSources.ground)
    expect(base).toEqual(before)
  })

  it('keeps all disconnected overlay fragments in source order with independent deterministic identities', () => {
    const { scene } = fixture(), context = runtime(), material = Object.values(scene.materials).find(value => value.applicableSurfaces.includes('terrain'))!
    const paint = { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
    const boundaryMm = [{ x: 1000, y: 1000 }, { x: 8000, y: 1000 }, { x: 8000, y: 8000 }, { x: 6000, y: 8000 }, { x: 6000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 8000 }, { x: 1000, y: 8000 }]
    scene.terrainAreas.ground.surfaceStyle = { base: paint, overlays: [{ id: 'manual-u', boundaryMm, paint, blendWidthMm: 50, renderOrder: 3 }] }
    const base = createCompositionContent(scene, context), selected = rect(2000, 4000, 5000, 1000)
    const result = terrainSculptCommands(base, ['ground'], selected, -500, 'split-paint'), next = applyCompositionCommands(base, result.commands, context)
    const overlays = next.document.terrainAreas[result.createdAreaId].surfaceStyle!.overlays
    expect(overlays.map(row => row.boundaryMm)).toEqual([rect(2000, 4000, 1000, 1000), rect(6000, 4000, 1000, 1000)])
    expect(new Set(overlays.map(row => row.id)).size).toBe(2)
    expect(terrainSculptCommands(base, ['ground'], selected, -500, 'split-paint')).toEqual(result)
  })

  it('rejects fractional clipping and surface-aligned paint before publishing a candidate', () => {
    const { scene } = fixture(), context = runtime(), material = Object.values(scene.materials).find(value => value.applicableSurfaces.includes('terrain'))!
    const paint = { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }
    scene.terrainAreas.ground.surfaceStyle = { base: paint, overlays: [{ id: 'sloped-paint', boundaryMm: [{ x: 1000, y: 1000 }, { x: 5000, y: 1001 }, { x: 1000, y: 5000 }], paint, blendWidthMm: 0, renderOrder: 0 }] }
    const base = createCompositionContent(scene, context), before = structuredClone(base)
    expect(() => terrainSculptCommands(base, ['ground'], scope(), 800, 'fraction')).toThrow(/非整数毫米交点/)
    expect(base).toEqual(before)
    scene.terrainAreas.ground.surfaceStyle.base.alignment = 'surface'
    const aligned = createCompositionContent(scene, context)
    expect(inspectTerrainSculptSelection(aligned, ['ground']).reason).toContain('世界对齐')
  })
  it.each([2200, -800])('creates an editable surface at %i mm with correctly oriented blocking boundaries', height => {
    const { project, scene, floorId } = fixture()
    scene.terrainAreas.ground.groundElevationMm = 700
    const before = structuredClone(project)
    const result = terrainSculptCommands(project, ['ground'], scope(), height, `height-${height}`)
    const next = applyCommands(scene, result.commands, runtime()), fresh = next.terrainAreas[result.createdAreaId]
    expect(result.commands).toHaveLength(5)
    expect(fresh.groundElevationMm).toBe(height); expect(fresh.coveragePriority).toBe(2)
    expect(next.terrainAreas.ground).toEqual(scene.terrainAreas.ground)
    expect(next.terrainAreas.remote).toEqual(scene.terrainAreas.remote)
    expect(supportSurfaceAt(next, { x: 3000, y: 3000 }, floorId)).toEqual({ kind: 'terrainArea', id: fresh.id })
    expect(supportSurfaceAt(next, { x: 6000, y: 3000 }, floorId)).toEqual({ kind: 'terrainArea', id: 'ground' })
    for (const edge of Object.values(next.terrainEdges)) {
      expect(edge).toMatchObject({ source: { areaId: fresh.id }, neighborAreaId: 'ground', kind: 'cliff', blocksMovement: true })
      expect(canonicalTerrainEdge(next, edge.source)).toEqual({ source: edge.source, neighborAreaId: 'ground', requiresCliff: true })
    }
    const projected = projectScene(next, 'gm').edges.filter(edge => edge.sourceAreaId === fresh.id)
    expect(projected).toHaveLength(4)
    for (const edge of projected) {
      expect(edge.elevationMm).toBe(height); expect(edge.neighborElevationMm).toBe(700)
      expect(Math.abs(edge.elevationMm - edge.neighborElevationMm)).toBe(1500)
      expect(edge.neighborAreaId).toBe('ground'); expect(edge.kind).toBe('cliff')
      expect(edge.elevationMm > edge.neighborElevationMm).toBe(height > 700)
    }
    expect(validateGeometry(next).errors).toEqual([])
    expect(checkTerrainTravel(next, { floorId, from: { x: 1000, y: 3000 }, to: { x: 3000, y: 3000 }, widthMm: 200 }).ok).toBe(false)
    expect(project).toEqual(before)
  })

  it('preserves existing birth, topology, fixed material and unrelated content in one ordinary composition transaction', () => {
    const { scene, layerId } = fixture(), context = runtime()
    const material = Object.values(scene.materials).find(value => value.applicableSurfaces.includes('terrain'))!
    scene.terrainAreas.ground.surfaceStyle = { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 2000, height: 2000 },
      rotationDeg: 30, alignment: 'world', originMm: { x: 500, y: -500 }, tint: null, opacity: 1 }, overlays: [] }
    const base = createCompositionContent(scene, context), before = structuredClone(base)
    const result = terrainSculptCommands(base, ['ground'], scope(), 800, 'material-preservation')
    const changed = applyCompositionCommands(base, result.commands, context)
    expect(changed.document.terrainAreas.ground).toEqual(base.document.terrainAreas.ground)
    expect(changed.document.terrainAreas.remote).toEqual(base.document.terrainAreas.remote)
    expect(changed.document.terrainAreas[result.createdAreaId].surfaceStyle).toEqual(base.document.terrainAreas.ground.surfaceStyle)
    expect(changed.document.entityLayers[result.createdAreaId]).toBe(layerId)
    for (const [id, token] of Object.entries(base.historyIdentity.outdoorTokens)) expect(changed.historyIdentity.outdoorTokens[id]).toEqual(token)
    expect(changed.historyIdentity.outdoorTokens[result.createdAreaId].token).not.toBe(base.historyIdentity.outdoorTokens.ground.token)
    expect(changed.appearance.surfaceSources.ground).toBe(base.appearance.surfaceSources.ground)
    expect(changed.appearance.surfaceSources[result.createdAreaId]).toBe(base.appearance.surfaceSources.ground)
    expect(changed.appearance.sources).toEqual(base.appearance.sources)
    expect(base).toEqual(before)
  })

  it('uses deterministic identities and normalizes winding and explicit closure without reshaping the scope', () => {
    const { project } = fixture(), ring = scope()
    const result = terrainSculptCommands(project, ['ground'], ring, 100, 'stable-operation')
    expect(terrainSculptCommands(project, ['ground'], [...ring].reverse(), 100, 'stable-operation')).toEqual(result)
    expect(terrainSculptCommands(project, ['ground'], [...ring, ring[0]], 100, 'stable-operation')).toEqual(result)
    expect(terrainSculptCommands(project, ['ground'], [ring[0], { x: 3500, y: 2000 }, ...ring.slice(1)], 100, 'stable-operation')).toEqual(result)
    expect(terrainSculptCommands(project, ['ground'], ring, 100, 'different-operation').createdAreaId).not.toBe(result.createdAreaId)
  })

  it('rejects outside, boundary-touching, crossing and noninteger scopes without trimming them', () => {
    const { project } = fixture()
    const invalid = [rect(-100, 2000, 3000, 3000), rect(0, 2000, 3000, 3000),
      [{ x: 2000, y: 2000 }, { x: 5000, y: 5000 }, { x: 2000, y: 5000 }, { x: 5000, y: 2000 }],
      [{ x: 2000.1, y: 2000 }, { x: 5000, y: 2000 }, { x: 3000, y: 5000 }]]
    for (const points of invalid) expect(() => terrainSculptCommands(project, ['ground'], points, 100, 'bad-scope')).toThrow()
    expect(() => terrainSculptCommands(project, ['ground'], [{ x: 1_000_000_001, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }], 100, 'range')).toThrow('整数毫米')
  })

  it('checks concave containment between vertices instead of accepting only point samples', () => {
    const { project, area } = fixture()
    area('ground', [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 7000, y: 10000 },
      { x: 7000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 10000 }, { x: 0, y: 10000 }])
    expect(() => terrainSculptCommands(project, ['ground'], [{ x: 1000, y: 1000 }, { x: 9000, y: 1000 }, { x: 9000, y: 9000 }, { x: 1000, y: 9000 }], 200, 'concavity')).toThrow('凹口')
  })

  it('rejects duplicate, self-touching and backtracking input before union can repair it', () => {
    const { project } = fixture(), ring = scope()
    const invalid = [[ring[0], ring[1], ring[2], ring[1], ring[3]],
      [ring[0], ring[1], { x: 3500, y: 2000 }, ring[2], ring[3]],
      [ring[0], ring[1], ring[2], { x: 3500, y: 2000 }, ring[3]]]
    for (const points of invalid) expect(() => terrainSculptCommands(project, ['ground'], points, 100, 'no-repair')).toThrow()
  })

  it('requires one visible, unlocked surface with a valid same-Floor layer', () => {
    const { project, scene, layerId } = fixture()
    for (const ids of [[], ['ground', 'remote'], ['missing']]) expect(() => terrainSculptCommands(project, ids, scope(), 100, 'selection')).toThrow()
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'hidden', new Set(['ground']))).toThrow('隐藏')
    scene.terrainAreas.ground.editLocked = true
    expect(inspectTerrainSculptSelection(project, ['ground']).reason).toContain('已锁定')
    scene.terrainAreas.ground.editLocked = false; scene.userLayers[layerId].editLocked = true
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'layer-lock')).toThrow('已锁定')
    scene.userLayers[layerId].editLocked = false; scene.userLayers[layerId].floorId = 'another-floor'
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'wrong-floor')).toThrow('同楼层')
  })

  it('rejects overlap, high priority exhaustion, unsafe height differences and no-op heights', () => {
    const { project, scene, area } = fixture()
    area('overlap', rect(1000, 1000, 1000, 1000), 0, 2)
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'overlap')).toThrow('叠加')
    delete scene.terrainAreas.overlap; delete scene.entityLayers.overlap
    scene.terrainAreas.ground.coveragePriority = 10000
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'priority')).toThrow('上限')
    scene.terrainAreas.ground.coveragePriority = 1
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 0, 'same')).toThrow('相同')
    for (const value of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) expect(() => terrainSculptCommands(project, ['ground'], scope(), value, 'height')).toThrow('安全整数')
    scene.terrainAreas.ground.groundElevationMm = -100
    expect(() => terrainSculptCommands(project, ['ground'], scope(), Number.MAX_SAFE_INTEGER, 'difference')).toThrow('高差')
  })

  it('refuses existing roads and actual scenery footprints instead of silently rebinding them', () => {
    const { project, scene, floorId } = fixture()
    scene.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public', centerlineMm: [{ x: -1000, y: -100 }, { x: 11000, y: -100 }],
      widthMm: 400, supportRefs: [{ kind: 'floor', id: floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'road')).toThrow('道路')
    scene.paths = {}
    const definition = Object.values(scene.propDefinitions)[0]
    definition.defaultFootprintMm = { width: 400, height: 400 }; definition.defaultFootprintOffsetMm = { x: 0, y: 0 }
    scene.decorations.grass = { id: 'grass', floorId, editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: definition.version },
      supportRef: { kind: 'floor', id: floorId }, positionMm: { x: -200, y: 5000 }, rotationDeg: 0, scalePpm: 1000000, renderOrder: 0 }
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'decoration')).toThrow('装饰 grass')
  })

  it('refuses enabled appearance rules and invalid sources but retains a complete fixed ancestry', () => {
    const { project, scene, layerId } = fixture()
    project.appearance.layerAdjustments[layerId] = [{ id: 'tint', kind: 'tint', value: '#FF0000', enabled: true }]
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'layer-effect')).toThrow('外观调整')
    project.appearance.layerAdjustments = {}; project.appearance.instanceAdjustments.ground = [{ id: 'light', kind: 'brightness', value: .8, enabled: true }]
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'instance-effect')).toThrow('外观调整')
    project.appearance.instanceAdjustments = {}
    const material = Object.values(scene.materials).find(value => value.applicableSurfaces.includes('terrain'))!
    scene.terrainAreas.ground.surfaceStyle = { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 2000, height: 2000 }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
    expect(inspectTerrainSculptSelection(project, ['ground']).reason).toContain('固定表面源')
    const source = addSurfaceAppearanceSource(project.appearance, scene.terrainAreas.ground.surfaceStyle)
    project.appearance.surfaceSources.ground = addSurfaceAppearanceSource(project.appearance, scene.terrainAreas.ground.surfaceStyle, source)
    expect(inspectTerrainSculptSelection(project, ['ground']).reason).toBeNull()
    const sources = structuredClone(project.appearance.sources)
    const context = runtime(), content = createCompositionContent(scene, context)
    Object.assign(content.appearance.sources, sources)
    content.appearance.surfaceSources.ground = project.appearance.surfaceSources.ground
    const planned = terrainSculptCommands(project, ['ground'], scope(), 100, 'fixed-chain')
    const result = applyCompositionCommands(content, planned.commands, context)
    for (const [id, original] of Object.entries(sources)) expect(result.appearance.sources[id]).toEqual(original)
    expect(result.document.terrainAreas.ground).toEqual(scene.terrainAreas.ground)
    const root = project.appearance.sources[source]; root.parentSourceId = project.appearance.surfaceSources.ground
    expect(inspectTerrainSculptSelection(project, ['ground']).reason).toContain('来源链')
  })

  it('refuses aggregate membership and bound visual geometry', () => {
    const { project, scene, floorId, layerId } = fixture()
    scene.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId, parentId: null, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, editLocked: false, members: [{ kind: 'terrainArea', id: 'ground' }] } } }
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'group')).toThrow('自然组')
    delete scene.aggregateCoordinates
    scene.visual.base.base.boundaries.curve = { id: 'curve', floorId, layerId, editLocked: false, visibility: 'public', closed: false,
      binding: { kind: 'terrain', sides: [{ areaId: 'ground', startPointId: 'ground-p-0', endPointId: 'ground-p-1', reverse: false }] }, segments: [], sampleSpacingMm: 100, toleranceMm: 5 }
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, 'curve')).toThrow('视觉曲线')
  })

  it('enforces the bounded polygon input and complete expanded native transaction budget', () => {
    const { project, scene } = fixture()
    const polygon = (count: number) => Array.from({ length: count }, (_, i) => ({ x: Math.round(5000 + 3000 * Math.cos(2 * Math.PI * i / count)), y: Math.round(5000 + 3000 * Math.sin(2 * Math.PI * i / count)) }))
    const points = polygon(16)
    const result = terrainSculptCommands(project, ['ground'], points, 100, 'bounded')
    const impact = previewOutdoorCommands(scene, result.commands, runtime())
    expect(impact.reason).toBeNull(); expect(impact.commandCost).toBeGreaterThan(result.commands.length); expect(impact.commandCost).toBeLessThanOrEqual(256)
    expect(() => terrainSculptCommands(project, ['ground'], polygon(TERRAIN_SCULPT_MAX_POINTS), 100, 'full-budget')).toThrow('超过256')
    expect(() => terrainSculptCommands(project, ['ground'], polygon(TERRAIN_SCULPT_MAX_POINTS + 1), 100, 'over-input')).toThrow('3–48')
    expect(() => terrainSculptCommands(project, ['ground'], scope(), 100, '')).toThrow('操作身份')
  })

  it('presents the exact frozen scope and a cancellation path while rejecting locked input', () => {
    const { project, scene } = fixture(); scene.terrainAreas.ground.editLocked = true
    const state = createTerrainSculptToolState(scene, ['ground'])
    const html = renderToStaticMarkup(createElement(TerrainSculptTools, { project, selectedIds: ['ground'], state, operationId: 'ui', onChange: () => {}, onPreview: () => {}, onCancel: () => {} }))
    expect(html).toContain('ground 已锁定'); expect(html).toContain('原面保留'); expect(html).toContain('取消局部塑形草稿')
    expect(html).toContain('<fieldset disabled="">')
    expect(state).toEqual({ mode: 'idle', points: [], cursor: null, targetElevationMm: 0 })
  })
})
