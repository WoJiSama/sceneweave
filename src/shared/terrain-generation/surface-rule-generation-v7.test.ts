import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createTerrainVariantCatalogDocument } from '../../platform/browser/content/terrain-variant-catalog.js'
import { createTerrainVariantV2CatalogDocument } from '../../platform/browser/content/terrain-variant-v2-catalog.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument, sceneDocumentSchema } from '../validation/scene.js'
import { decorationProtectedGeometry } from '../decorations/generate.js'
import { decorationFootprint } from '../decorations/geometry.js'
import { connectionFootprint, pointOnSurface, propFootprint, polygonDistance, supportedPolygon } from '../geometry/geometry.js'
import { terrainPoints } from '../geometry/geometry.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { generateTerrainDocumentV6 } from './surface-rule-generation.js'
import { generateTerrainDocumentV7, terrainGenerationInputV7Schema, terrainGenerationResultV7Schema } from './surface-rule-generation-v7.js'
import type { DecorationCluster, SurfaceRule } from '../model/scene.js'

const raw = (algorithmVersion: 6 | 7) => ({ sceneId: 'recipe7-island', seed: 'terrain-v6-closure-20261104', kind: 'island', widthMm: 24000, heightMm: 18000,
  algorithmVersion, budgetProfileId: 'standard', quality: 'standard' })
function base() {
  const scene = createShoreBlankDocument('island', { sceneId: 'recipe7-island', title: '算法7测试', now: '2026-11-04T00:00:00.000Z',
    widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const v1 = createTerrainVariantCatalogDocument(), v2 = createTerrainVariantV2CatalogDocument()
  for (const [catalog, ids] of [[v1, ['terrain-variants-v1-prop-tree-wind-oak', 'terrain-variants-v1-prop-shrub-heath-mound', 'terrain-variants-v1-prop-grass-sedge-fan']],
    [v2, ['terrain-variants-v2-prop-tree-highland-copse']]] as const) for (const id of ids) {
    const definition = catalog.propDefinitions[id]
    scene.propDefinitions[id] = cloneJson(definition)
    if (definition.defaultAppearance.kind === 'image') scene.assets[definition.defaultAppearance.assetId] = cloneJson(catalog.assets[definition.defaultAppearance.assetId])
  }
  return scene
}

describe('automatic terrain surface rules7', () => {
  it('finds real highland members under the existing support and clearance checks, then replays exactly', () => {
    const source = base(), old = generateTerrainDocumentV6(source, raw(6), 'same-physical-birth')
    const request = raw(7), result = generateTerrainDocumentV7(source, request, 'same-physical-birth')
    const replay = generateTerrainDocumentV7(source, request, 'same-physical-birth')
    expect(canonicalJson(source)).toBe(canonicalJson(base()))
    expect(canonicalJson(result)).toBe(canonicalJson(replay))
    expect(terrainGenerationInputV7Schema.safeParse(raw(6)).success).toBe(false)
    expect(terrainGenerationInputV7Schema.safeParse(raw(7)).success).toBe(true)
    expect(terrainGenerationResultV7Schema.safeParse(result).success).toBe(true)
    expect(sceneDocumentSchema.safeParse(result.document).success).toBe(true)
    expect(validateSceneDocument(result.document).ok).toBe(true)

    const high = result.document.terrainAreas['terrain-high']
    const highRules = Object.values(result.document.surfaceRules!).filter(rule => rule.field !== 'material' && 'clusterId' in rule && rule.supportRef.id === high.id) as Array<Extract<SurfaceRule, { clusterId: string }>>
    const counts = Object.fromEntries(highRules.map(rule => {
      const cluster = result.document.decorationClusters![rule.clusterId] as DecorationCluster
      return [rule.field, Object.values(cluster.members).filter(member => member.entityId && member.state === 'managed').length]
    }))
    expect(counts.trees).toBeGreaterThan(0)
    expect(counts.shrubs).toBeGreaterThan(0)

    for (const rule of highRules) {
      const cluster = result.document.decorationClusters![rule.clusterId] as DecorationCluster
      const protectedGeometry = decorationProtectedGeometry(result.document, cluster)
      for (const member of Object.values(cluster.members).filter(member => member.entityId && member.state === 'managed')) {
        if (!member.entityId) continue
        const row = member.kind === 'prop' ? result.document.props[member.entityId] : result.document.decorations![member.entityId]
        const footprint = member.kind === 'prop' ? propFootprint(row as NonNullable<typeof result.document.props[string]>) : decorationFootprint(result.document, row as NonNullable<typeof result.document.decorations[string]>)
        expect(pointOnSurface(result.document, row.positionMm, row.supportRef, row.floorId)).toBe(true)
        expect(supportedPolygon(result.document, footprint, row.supportRef, row.floorId)).toBe(true)
        for (const protectedRow of protectedGeometry) expect(polygonDistance(footprint, protectedRow.polygon)).toBeGreaterThanOrEqual(protectedRow.marginMm)
      }
    }
    expect(Object.values(old.document.terrainConnections).map(row => ({ from: row.from, to: row.to, widthMm: row.widthMm })))
      .toEqual(Object.values(result.document.terrainConnections).map(row => ({ from: row.from, to: row.to, widthMm: row.widthMm })))
    expect(terrainPoints(old.document.terrainAreas['terrain-high'])).toEqual(terrainPoints(result.document.terrainAreas['terrain-high']))
    const physical = (document: typeof result.document) => ({
      areas: Object.values(document.terrainAreas).map(area => ({ id: area.id, floorId: area.floorId, boundaryMm: area.boundaryMm,
        groundElevationMm: area.groundElevationMm, coveragePriority: area.coveragePriority, blocksMovement: area.blocksMovement,
        blocksSight: area.blocksSight, movementCostMultiplier: area.movementCostMultiplier })),
      edges: Object.values(document.terrainEdges).map(edge => ({ id: edge.id, floorId: edge.floorId, source: edge.source,
        neighborAreaId: edge.neighborAreaId, kind: edge.kind, blocksMovement: edge.blocksMovement, blocksSight: edge.blocksSight })),
      connections: Object.values(document.terrainConnections).map(connection => ({ id: connection.id, floorId: connection.floorId,
        kind: connection.kind, from: connection.from, to: connection.to, widthMm: connection.widthMm, openingId: connection.openingId,
        blocksMovement: connection.blocksMovement, movementCostMultiplier: connection.movementCostMultiplier,
        footprint: connectionFootprint(connection).map(point => [point.x, point.y]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!) })),
    })
    expect(physical(result.document)).toEqual(physical(old.document))
  })

  it('keeps v7 composition selector independent and rejects v6 reinterpretation', async () => {
    const request = { sceneId: 'recipe7-island', seed: 'composition7-fixed-seed', preset: 'archipelago', widthMm: 24000, heightMm: 18000,
      recipeVersion: 7, budgetProfileId: 'standard', quality: 'standard' }
    const { compositionPresetV7, compositionPresetV7Schema, materializeTerrainCompositionV7 } = await import('./surface-rule-generation-v7.js')
    const preset = compositionPresetV7(request)
    expect(compositionPresetV7Schema.safeParse(request).success).toBe(true)
    expect(compositionPresetV7Schema.safeParse({ ...request, recipeVersion: 6 }).success).toBe(false)
    const result = materializeTerrainCompositionV7(base(), preset.input, preset.requirements, preset.name, 'plain', 7, taskBudgetProfile('standard'))
    expect(validateSceneDocument(result.document).ok).toBe(true)
    expect(result.document.schemaVersion).toBe(1)
  })
})
