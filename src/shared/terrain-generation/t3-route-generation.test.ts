import { getLegacyGeneration } from './composition-contracts.js'
import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { constraintInputHash, managedOutputHash } from './integrity.js'
import { visualCommandCost } from '../visual/commands.js'
import { composeTerrainDocument } from './compose.js'
import { generateTerrainDocument, terrainGenerationResultSchema, type TerrainGenerationInput } from './generate.js'

const blank = () => createRefinedBlankDocument('island', { sceneId: 't3-route-generation', title: '指定路线', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-26T00:00:00.000Z' })
const request = (kind: TerrainGenerationInput['kind']): TerrainGenerationInput => ({ sceneId: 't3-route-generation', kind, seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000, route: { from: { x: 3000, y: 13500 }, to: { x: 21000, y: 13500 }, widthMm: 1000, crossing: 'ford' } })

describe('T3 explicit route materialization', () => {
  it.each(['river', 'lake', 'forest', 'hill', 'mixed'] as const)('%s preserves exact endpoints, complete width, real supports and honest costs', kind => {
    const base = blank(), input = request(kind), before = canonicalJson(base), result = generateTerrainDocument(base, input)
    expect(canonicalJson(base)).toBe(before)
    expect(terrainGenerationResultSchema.safeParse(result).success).toBe(true)
    expect(result.route!.pointsMm[0]).toEqual(input.route!.from)
    expect(result.route!.pointsMm.at(-1)).toEqual(input.route!.to)
    expect(result.route!.expandedNodes).toBeLessThanOrEqual(2048)
    const checked = checkTerrainRoute(result.document, { floorId: 'visual-floor', pointsMm: result.route!.pointsMm, widthMm: 1000 })
    expect(checked.issues).toEqual([])
    expect(checked.ok).toBe(true)
    expect(result.document.paths['terrain-route'].supportRefs).toEqual(checked.supportRefs)
    expect(result.cost.pathPoints).toBe(result.route!.pointsMm.length)
    expect(result.cost.legacyTotal).toBe(visualCommandCost(base, result.document))
    const complete = composeTerrainDocument(base, result, 'route-birth')
    expect(complete.cost.total).toBe(result.cost.total)
    expect(complete.cost.total).toBeLessThanOrEqual(256)
    expect(validateSceneDocument(complete.document).ok).toBe(true)
    expect(getLegacyGeneration(complete.document)!.checks['terrain-route-check'].state).toBe('passed')
    if (kind === 'river' || kind === 'mixed') {
      expect(checked.supportRefs).toContainEqual({ kind: 'terrainArea', id: 'terrain-shallow' })
      expect(checked.connectionIds).toEqual(expect.arrayContaining(['terrain-shallow-left', 'terrain-shallow-right']))
    }
  }, 30000)

  it('climbs the actual highland ramp instead of crossing an unsupported height edge', () => {
    const input = request('hill'); input.route!.from = { x: 6000, y: 8100 }; input.route!.to = { x: 10320, y: 8100 }
    const result = generateTerrainDocument(blank(), input), checked = checkTerrainRoute(result.document, { floorId: 'visual-floor', pointsMm: result.route!.pointsMm, widthMm: 1000 })
    expect(checked.ok).toBe(true)
    expect(checked.connectionIds).toContain('terrain-stairs')
    expect(checked.supportRefs).toContainEqual({ kind: 'terrainArea', id: 'terrain-high' })
  }, 30000)

  it.each((['river','lake','forest','hill','mixed'] as const).flatMap(kind => ['terrain-v1-0', 'terrain-v1-1', 'terrain-v1-2', 'terrain-v1-3', 'terrain-v1-4'].map(seed => ({kind,seed}))))('keeps $kind routes deterministic for $seed', ({kind,seed}) => {
    const input = request(kind); input.seed = seed
    const first = generateTerrainDocument(blank(), input), second = generateTerrainDocument(blank(), input)
    expect(canonicalJson(second)).toBe(canonicalJson(first))
    expect(terrainGenerationResultSchema.safeParse(first).success).toBe(true)
    if(kind==='river'||kind==='mixed')expect(first.document.paths['terrain-route'].supportRefs).toContainEqual({ kind: 'terrainArea', id: 'terrain-shallow' })
    const complete=composeTerrainDocument(blank(),first,'matrix-route-birth')
    expect(validateSceneDocument(complete.document).ok).toBe(true)
    expect(complete.cost.total).toBe(first.cost.total)
  }, 30000)

  it('never silently uses shallow water for a ground-only route', () => {
    const input = request('river'); input.route!.crossing = 'ground'
    expect(() => generateTerrainDocument(blank(), input)).toThrow(/有限.*路线|路线.*有限/)
    input.route!.to = { x: 6000, y: 13500 }
    const result = generateTerrainDocument(blank(), input)
    expect(result.document.paths['terrain-route'].supportRefs.some(ref => ref.id === 'terrain-shallow')).toBe(false)
    expect(checkTerrainRoute(result.document, { floorId: 'visual-floor', pointsMm: result.route!.pointsMm, widthMm: 1000 }).ok).toBe(true)
    const complete=composeTerrainDocument(blank(),result,'ground-birth')
    expect(getLegacyGeneration(complete.document)!.checks['terrain-route-check'].algorithmId).toBe('terrain-route-ground')
    expect(validateSceneDocument(JSON.parse(canonicalJson(complete.document))).ok).toBe(true)
  }, 30000)

  it('cold validation rejects a forged passed receipt even after all public hashes are refreshed', () => {
    const base=blank(),result=generateTerrainDocument(base,request('hill')),scene=composeTerrainDocument(base,result,'forgery-birth').document
    const prop=Object.values(scene.props)[0]
    prop.positionMm={x:18000,y:13500};prop.supportRef={kind:'terrainArea',id:'terrain-low'};prop.blocksMovement=true
    const rule=getLegacyGeneration(scene)!.rules['terrain-rule'];rule.managedOutputHash=managedOutputHash(scene,rule)
    for(const row of Object.values(getLegacyGeneration(scene)!.checks))row.inputHash=constraintInputHash(scene,row.constraintId)
    const check=getLegacyGeneration(scene)!.checks['terrain-route-check']
    expect(checkTerrainRoute(scene,{floorId:'visual-floor',pointsMm:scene.paths['terrain-route'].centerlineMm,widthMm:1000}).ok).toBe(false)
    const loaded=validateSceneDocument(JSON.parse(canonicalJson(scene)))
    expect(loaded.ok).toBe(false)
    if(!loaded.ok)expect(loaded.errors.some(issue=>issue.code==='TERRAIN_ROUTE_RECEIPT')).toBe(true)
    check.state='unchecked'
    expect(validateSceneDocument(scene).ok).toBe(true)
  },30000)

  it('rejects bridges, invalid water endpoints and forged route receipts without changing the baseline', () => {
    const base = blank(), before = canonicalJson(base), bridge = request('river'); bridge.route!.crossing = 'bridge'
    expect(() => generateTerrainDocument(base, bridge)).toThrow(/不支持.*桥/)
    const water = request('river'); water.route!.from = { x: 10080, y: 4000 }; water.route!.to = { x: 21000, y: 4000 }
    expect(() => generateTerrainDocument(base, water)).toThrow(/路线/)
    const outside = request('hill'); outside.route!.from = { x: -100, y: 1000 }
    expect(() => generateTerrainDocument(base, outside)).toThrow(/路线/)
    expect(canonicalJson(base)).toBe(before)
    const result = generateTerrainDocument(base, request('hill')), changed = cloneJson(result)
    changed.route!.pointsMm[0].x += 1
    expect(terrainGenerationResultSchema.safeParse(changed).success).toBe(false)
    const badCost = cloneJson(result); badCost.cost.pathPoints--
    expect(terrainGenerationResultSchema.safeParse(badCost).success).toBe(false)
  }, 30000)
})
