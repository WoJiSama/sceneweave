import { describe, expect, it } from 'vitest'
import type { PropDefinition, SceneDocument } from '../model/scene.js'
import { applySceneryCandidate, inspectScenerySources, orderSceneryProps, prepareSceneryRegeneration } from './scenery.js'

const bounds = { x: 0, y: 0, width: 12000, height: 9000 }
const definition = (id: string, layer: PropDefinition['defaultRenderLayer'] = 'canopy'): PropDefinition => ({
  id, catalogId: `catalog-${id}`, version: 1, licenseRef: 'mit', origin: { kind: 'original', attribution: 'fixture', canEmbed: true }, name: id, tags: ['tree'],
  defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -1200, y: -2400, width: 2400, height: 2400 },
  defaultFootprintMm: { width: 600, height: 600 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false,
  defaultRenderLayer: layer, defaultShadowClass: 'vegetation',
})
function fixture(): SceneDocument {
  const prop = { id: 'manual-tree', floorId: 'floor', editLocked: false, definitionRef: { id: 'tree-a', version: 1 }, appearance: definition('tree-a').defaultAppearance,
    visualBoundsMm: definition('tree-a').defaultVisualBoundsMm, positionMm: { x: 5000, y: 5000 }, rotationDeg: 0, footprintMm: { width: 600, height: 600 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false, visibility: 'public' as const, supportRef: { kind: 'terrainArea' as const, id: 'meadow' }, renderLayer: 'canopy' as const, renderOrder: 3, shadowClass: 'vegetation' as const, shadowOverride: null }
  const area = { id: 'meadow', floorId: 'floor', editLocked: false, visibility: 'public' as const, boundaryMm: [{ id: 'meadow-p0', segmentId: 'meadow-s0', positionMm: { x: 1000, y: 1000 } }, { id: 'meadow-p1', segmentId: 'meadow-s1', positionMm: { x: 11000, y: 1000 } }, { id: 'meadow-p2', segmentId: 'meadow-s2', positionMm: { x: 11000, y: 8000 } }, { id: 'meadow-p3', segmentId: 'meadow-s3', positionMm: { x: 1000, y: 8000 } }], groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  return { format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'scenery-fixture', revision: 4, title: 'scenery', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: { 'manual-tree': prop }, regions: {}, notes: {}, assets: {}, propDefinitions: { 'tree-a': definition('tree-a'), 'tree-b': definition('tree-b', 'object') }, materials: {}, terrainAreas: { meadow: area }, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {
      trees: { id: 'trees', floorId: 'floor', editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: 'meadow' }, palette: [{ key: 'a', propDefinitionRef: { id: 'tree-a', version: 1 }, weight: 3 }, { key: 'b', propDefinitionRef: { id: 'tree-b', version: 1 }, weight: 1 }], seed: 'trees-1', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 1000, y: 1000 }, cellSizeMm: 2000, densityFactor: .35, minDistanceMm: 800, rotationRangeDeg: { min: 0, max: 20 }, members: { manual: { propId: 'manual-tree', state: 'manual', overrideFields: [] } }, exclusions: [],
      },
    }, styleThemes: {}, activeStyleThemeRef: null, userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false } }, entityLayers: { 'manual-tree': 'layer', trees: 'layer' }, presetSnapshot: { presetId: 'fixture', presetVersion: 1, distanceMode: 'metric', source: 'fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] },
  }
}

describe('T11 conditional scenery', () => {
  it('audits fixed sources and produces a deterministic candidate without mutating the scene', () => {
    const scene = fixture(), before = structuredClone(scene), source = inspectScenerySources(scene, 'trees')
    expect(source.palette.map(item => item.key)).toEqual(['a', 'b']); expect(source.palette[0].visualBoundsMm.width).toBe(2400)
    const a = prepareSceneryRegeneration(scene, 'trees'), b = prepareSceneryRegeneration(scene, 'trees')
    expect(a).toEqual(b); expect(a.changedIds).toContain('trees'); expect(a.protectedMemberKeys).toEqual(['manual']); expect(scene).toEqual(before)
  })
  it('applies only the detached managed candidate and keeps manual members/overrides', () => {
    const scene = fixture(), candidate = prepareSceneryRegeneration(scene, 'trees'), next = applySceneryCandidate(scene, candidate)
    expect(next.props['manual-tree']).toEqual(scene.props['manual-tree'])
    expect(next.scatterGroups.trees.members.manual).toEqual(scene.scatterGroups.trees.members.manual)
    expect(Object.values(next.scatterGroups.trees.members).some(member => member.state === 'managed')).toBe(true)
    expect(() => applySceneryCandidate({ ...scene, revision: 5 }, candidate)).toThrow(/基线/)
    const changed = structuredClone(scene); changed.scatterGroups.trees.members.manual.state = 'detached'
    expect(() => applySceneryCandidate(changed, candidate)).toThrow(/保护成员/)
    const forged = structuredClone(candidate); forged.proposalHash = '0'.repeat(64)
    expect(() => applySceneryCandidate(scene, forged)).toThrow(/候选内容/)
  })
  it('rejects public private domains and keeps render order deterministic', () => {
    const scene = fixture(); scene.terrainAreas.meadow.visibility = 'gm'
    expect(() => inspectScenerySources(scene, 'trees')).toThrow(/GM/)
    const props = Object.values(fixture().props)
    expect(orderSceneryProps([{ ...props[0], id: 'z', renderOrder: 0 }, { ...props[0], id: 'a', renderLayer: 'object', renderOrder: 0 }]).map(prop => prop.id)).toEqual(['a', 'z'])
  })
})
