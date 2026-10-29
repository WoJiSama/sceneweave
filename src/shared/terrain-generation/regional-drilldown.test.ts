import { getLegacyGeneration } from './composition-contracts.js'
import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { emptyTerrainDocument } from './compose.js'
import { createEmptyRegional, sourceRegionLinkSchema } from './contracts.js'
import { createRegionalDocument, prepareRegionalDrillDown, regionalAuthorizedSubsetHash } from './regional-authoring.js'

const blank = () => createRefinedBlankDocument('island', { sceneId: 'regional-drilldown-base', title: '区域父图', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-27T00:00:00.000Z' })

describe('T5 regional selection drill-down', () => {
  it('creates a self-contained child with a public source snapshot and no parent mutation', () => {
    const parent = createRegionalDocument(blank(), { kind: 'regional', sceneId: 'regional-parent', operationId: 'regional-parent-create', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000 }).document
    const before = canonicalJson(parent), result = prepareRegionalDrillDown(parent, { kind: 'regionalDrillDown', sourceSceneId: parent.sceneId, sceneId: 'regional-child', operationId: 'regional-child-drill', selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 } })
    expect(canonicalJson(parent)).toBe(before)
    expect(result.sourceLink.sourceSceneId).toBe(parent.sceneId)
    expect(result.sourceLink.translationMm).toEqual({ x: 0, y: 0 })
    expect(result.document.mapMode).toBe('scene'); expect(result.document.regional).toBeNull(); expect(getLegacyGeneration(result.document)?.sourceLinks[result.sourceLink.id]).toEqual(result.sourceLink)
    expect(validateSceneDocument(result.document).ok).toBe(true)
  })

  it('computes an authorized subset hash independently from unrelated parent catalog changes', () => {
    const parent = createRegionalDocument(blank(), { kind: 'regional', sceneId: 'regional-parent-subset', operationId: 'regional-parent-subset-create', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000 }).document
    const result = prepareRegionalDrillDown(parent, { kind: 'regionalDrillDown', sourceSceneId: parent.sceneId, sceneId: 'regional-child-subset', operationId: 'regional-child-subset-drill', selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 } })
    const first = regionalAuthorizedSubsetHash(parent, result.sourceLink)
    parent.regional!.symbolDefinitions.unrelated = { ...Object.values(parent.regional!.symbolDefinitions)[0], id: 'unrelated', catalogId: 'unrelated' }
    expect(regionalAuthorizedSubsetHash(parent, result.sourceLink)).toBe(first)
  })

  it('preserves reverse flow and every turn when a complete polyline is inside the selection', () => {
    const parent = createRegionalDocument(blank(), { kind: 'regional', sceneId: 'regional-parent-reverse', operationId: 'regional-parent-reverse-create', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000,
      lines: [{ id: 'reverse-river', kind: 'river', flow: 'reverse', displayWidthMm: 5000, actualWidthMm: 5000,
        pointsMm: [{ id: 'reverse-river-p0', positionMm: { x: 100000, y: 200000 } }, { id: 'reverse-river-p1', positionMm: { x: 200000, y: 250000 } }, { id: 'reverse-river-p2', positionMm: { x: 500000, y: 300000 } }] }],
    }).document
    const before = canonicalJson(parent), result = prepareRegionalDrillDown(parent, { kind: 'regionalDrillDown', sourceSceneId: parent.sceneId,
      sceneId: 'regional-child-reverse', operationId: 'regional-child-reverse-drill', selectionMm: { x: 100000, y: 100000, width: 400000, height: 400000 } })
    const features = result.sourceLink.inherited.filter(feature => feature.sourceEntityId === 'reverse-river')
    expect(features).toHaveLength(1)
    expect(features[0].pointsMm).toEqual([{ x: 400000, y: 200000 }, { x: 100000, y: 150000 }, { x: 0, y: 100000 }])
    expect(canonicalJson(parent)).toBe(before)
  })

  it('snapshots symbol and landmark definitions in versioned public source evidence', () => {
    const source = emptyTerrainDocument(blank()); source.mapMode = 'regional'; source.regional = createEmptyRegional()
    const asset = Object.values(source.assets)[0]
    const definition = { id: 'regional-symbol-test', catalogId: 'regional.test', version: 1, name: 'Test symbol', assetId: asset.id,
      licenseRef: asset.licenseRef, origin: structuredClone(asset.origin), visualBoundsMm: { x: -1000, y: -2000, width: 2000, height: 3000 },
      rootAnchorMm: { x: 0, y: 0 }, orientation: 'upright' as const }
    source.regional.symbolDefinitions[definition.id] = definition
    const parent = createRegionalDocument(source, { kind: 'regional', sceneId: 'regional-parent-symbols', operationId: 'regional-parent-symbols-create', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000,
      symbols: [{ id: 'symbol-source', definitionRef: { id: definition.id, version: 1 }, positionMm: { x: 240_000, y: 260_000 }, visualBoundsMm: definition.visualBoundsMm, renderOrder: 2 }],
      landmarks: [{ id: 'landmark-source', positionMm: { x: 300_000, y: 320_000 }, purpose: 'ruin', name: 'Old tower', description: 'Public landmark', definitionRef: { id: definition.id, version: 1 }, areaId: null }] }).document
    const result = prepareRegionalDrillDown(parent, { kind: 'regionalDrillDown', sourceSceneId: parent.sceneId, sceneId: 'regional-child-symbols', operationId: 'regional-child-symbols-drill', selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 } })
    expect('version' in result.sourceLink && result.sourceLink.version).toBe(2)
    expect(result.sourceLink.inherited.find(row => row.kind === 'symbol')).toMatchObject({ kind: 'symbol', symbol: { definition, definitionRef: { id: definition.id, version: 1 } } })
    expect(result.sourceLink.inherited.find(row => row.kind === 'landmark')).toMatchObject({ kind: 'landmark', landmark: { definition, definitionRef: { id: definition.id, version: 1 } } })
    const legacy = structuredClone(result.sourceLink) as unknown as Record<string, unknown>
    delete legacy.version; legacy.inherited = []
    expect(() => sourceRegionLinkSchema.parse(legacy)).not.toThrow()
  })

  it('drops regional-only image assets when the child has no symbol definition', () => {
    const source = emptyTerrainDocument(blank()), [assetId, sharedAssetId] = Object.keys(source.assets)
    source.mapMode = 'regional'; source.regional = createEmptyRegional()
    const sharedMaterial = { ...Object.values(source.materials)[0], id: 'regional-child-shared-material', catalogId: 'regional-child-shared-material', textureAssetId: sharedAssetId }
    source.materials = { [sharedMaterial.id]: sharedMaterial }
    source.propDefinitions = {}; source.prefabDefinitions = {}; source.styleThemes = {}; source.activeStyleThemeRef = null
    source.assets = { [assetId]: source.assets[assetId], [sharedAssetId]: source.assets[sharedAssetId] }
    source.regional.symbolDefinitions.symbol = {
      id: 'symbol', catalogId: 'regional.symbol', version: 1, name: '区域图符', assetId,
      licenseRef: source.assets[assetId].licenseRef, origin: source.assets[assetId].origin,
      visualBoundsMm: { x: -1000, y: -1000, width: 2000, height: 2000 }, rootAnchorMm: { x: 0, y: 0 }, orientation: 'upright',
    }
    const parent = createRegionalDocument(source, { kind: 'regional', sceneId: 'regional-parent-assets', operationId: 'regional-parent-assets-create', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000 }).document
    const result = prepareRegionalDrillDown(parent, { kind: 'regionalDrillDown', sourceSceneId: parent.sceneId, sceneId: 'regional-child-assets', operationId: 'regional-child-assets-drill', selectionMm: { x: 0, y: 0, width: 500_000, height: 500_000 } })
    expect(Object.keys(result.document.assets)).toEqual([sharedAssetId])
    expect(validateSceneDocument(result.document).ok).toBe(true)
  })

  it('rejects a selection over 500m or outside the parent range', () => {
    const parent = createRegionalDocument(blank(), { kind: 'regional', sceneId: 'regional-parent', operationId: 'regional-parent-create-2', seed: 'fixed', widthMm: 1_000_000, heightMm: 800_000 }).document
    expect(() => prepareRegionalDrillDown(parent, { kind: 'regionalDrillDown', sourceSceneId: parent.sceneId, sceneId: 'too-wide', operationId: 'too-wide', selectionMm: { x: 0, y: 0, width: 500_001, height: 500_000 } })).toThrow(/500m|500米/)
    expect(() => prepareRegionalDrillDown(parent, { kind: 'regionalDrillDown', sourceSceneId: parent.sceneId, sceneId: 'outside', operationId: 'outside', selectionMm: { x: 700_000, y: 0, width: 500_000, height: 500_000 } })).toThrow(/范围内/)
  })
})
