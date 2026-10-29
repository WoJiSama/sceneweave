import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { generateTerrainDocument, TERRAIN_FIXED_SEEDS } from './generate.js'
import { compositionPreset } from './composition-presets.js'
import { materializeTerrainComposition } from './composition-materialize.js'
import { BASE_MAP_LIMITS, executeBaseMapRequest, parseBaseMapResponse, prepareBaseMapRequest } from './base-map.js'

const blank = (widthMm = 24000, heightMm = 18000) => createRefinedBlankDocument('island', {
  title: '独立底图', sceneId: 'base-map-scene', now: '2026-10-29T00:00:00.000Z',
  widthMm, heightMm, preset: 'narrative',
})
const input = () => ({ requestId: 'base-map-request', workspaceSceneId: 'open-workspace', checkpoint: 7,
  operationEpoch: 3, base: blank(), generation: { kind: 'terrain' as const,
    input: { sceneId: 'base-map-scene', kind: 'island' as const, seed: TERRAIN_FIXED_SEEDS[0] } } })
const compositionInput = (recipeVersion?: 1 | 2) => ({ ...input(), base: blank(48000, 36000),
  generation: { kind: 'composition' as const, input: { sceneId: 'base-map-scene', seed: 'composition-fixed',
    preset: 'archipelago' as const, widthMm: 48000, heightMm: 36000,
    ...(recipeVersion === undefined ? {} : { recipeVersion }) } } })
function rehash<T extends { generation: unknown; result: unknown; domainCost: unknown; resultHash: string }>(response: T): T {
  response.resultHash = sha256Text(canonicalJson({ generation: response.generation, result: response.result, domainCost: response.domainCost }))
  return response
}

describe('pure program base-map wire protocol', () => {
  it('normalizes defaults once, owns and freezes all input, and binds each independent hash', () => {
    const raw = input(), request = prepareBaseMapRequest(raw)
    expect(request).toMatchObject({ protocol: 'sceneweave-base-map', version: 1, type: 'generate',
      algorithm: { id: 'terrain-scene', version: 1, recipeVersion: 1 },
      generation: { input: { widthMm: 24000, heightMm: 18000 } } })
    expect(request.generation.input).not.toHaveProperty('algorithmVersion')
    expect(request.inputHash).toBe(sha256Text(canonicalJson(request.generation)))
    expect(request.baseHash).toBe(sha256Text(canonicalJson(request.base)))
    expect(Object.isFrozen(request.base.materials)).toBe(true)
    raw.base.title = 'caller mutation'; raw.generation.input.seed = 'changed'
    expect(request.base.title).toBe('独立底图')
    expect(request.generation.input.seed).toBe(TERRAIN_FIXED_SEEDS[0])
    // Object property order has no influence on hashes; nested data stays complete.
    const reverse = Object.fromEntries(Object.entries(input()).reverse())
    expect(prepareBaseMapRequest(reverse).inputHash).toBe(request.inputHash)
  })

  it.each([1, 2] as const)('keeps explicit terrain algorithm %i and exact old/new domain output', version => {
    const raw = input(); Object.assign(raw.generation.input, { algorithmVersion: version })
    const request = prepareBaseMapRequest(raw), response = executeBaseMapRequest(request)
    expect(request.algorithm).toEqual({ id: 'terrain-scene', version, recipeVersion: version })
    expect(response.result.kind).toBe('terrain')
    if (response.result.kind !== 'terrain' || request.generation.kind !== 'terrain') throw new Error('test shape')
    expect(response.result.terrain).toEqual(generateTerrainDocument(request.base, request.generation.input))
    expect(response.domainCost.total).toBeLessThanOrEqual(256)
    expect(response.domainCost.total).toBe(Object.values(response.domainCost.items).reduce((sum, cost) => sum + cost, 0))
    expect(response.domainCost).toMatchObject({ limit: 256, finalAdoptionCostChecked: false })
    expect(parseBaseMapResponse(request, JSON.parse(canonicalJson(response)))).toEqual(response)
  })

  it('retains omitted old terrain selector and distinguishes T3 without promoting it', () => {
    const request = prepareBaseMapRequest(input()), response = executeBaseMapRequest(request)
    expect(response.generation.input).not.toHaveProperty('algorithmVersion')
    expect(response.result.kind === 'terrain' && response.result.terrain.input.algorithmVersion).toBeUndefined()
    const forest = { ...input(), generation: { kind: 'terrain' as const, input: { ...input().generation.input, kind: 'forest' as const } } }
    expect(prepareBaseMapRequest(forest).algorithm).toEqual({ id: 'terrain-scene-t3', version: 1, recipeVersion: 1 })
    Object.assign(forest.generation.input, { algorithmVersion: 2 })
    expect(() => prepareBaseMapRequest(forest)).toThrow()
  })

  it.each([undefined, 2] as const)('keeps composition recipe %s and complete raw materialization with actual metadata cost', version => {
    const request = prepareBaseMapRequest(compositionInput(version)), response = executeBaseMapRequest(request)
    expect(request.algorithm).toEqual({ id: 'terrain-compose', version: 1, recipeVersion: version ?? 1 })
    if (request.generation.kind !== 'composition' || response.result.kind !== 'composition') throw new Error('test shape')
    const preset = compositionPreset(request.generation.input)
    const expected = materializeTerrainComposition(request.base, preset.input, preset.requirements, preset.name, 'plain', version ?? 1)
    expect(response.result).toEqual({ kind: 'composition', ...expected })
    expect(Object.keys(response.domainCost.items).some(key => key.startsWith('composition.identity.actual.'))).toBe(true)
    expect(Object.keys(response.domainCost.items).some(key => key.startsWith('composition.identity.estimate.'))).toBe(false)
    expect(response.domainCost.total).toBeLessThanOrEqual(256)
    expect(parseBaseMapResponse(request, cloneJson(response))).toEqual(response)
    if (version === undefined) expect(response.generation.input).not.toHaveProperty('recipeVersion')
  })

  it('separates input, palette and complete blank hashes', () => {
    const first = prepareBaseMapRequest(input()), changedTitle = input(), changedPalette = input(), changedInput = input()
    changedTitle.base.title = '不同标题'
    const asset = Object.values(changedPalette.base.assets)[0]; asset.sha256 = 'a'.repeat(64)
    changedInput.generation.input.seed = 'different-seed'
    const titled = prepareBaseMapRequest(changedTitle), palette = prepareBaseMapRequest(changedPalette), seeded = prepareBaseMapRequest(changedInput)
    expect(titled.baseHash).not.toBe(first.baseHash); expect(titled.paletteHash).toBe(first.paletteHash)
    expect(palette.paletteHash).not.toBe(first.paletteHash); expect(palette.inputHash).toBe(first.inputHash)
    expect(seeded.inputHash).not.toBe(first.inputHash); expect(seeded.baseHash).toBe(first.baseHash)
  })

  it('rejects altered stamps, hashes, noncanonical wire defaults and future protocol versions', () => {
    const request = prepareBaseMapRequest(input())
    for (const mutate of [
      (row: typeof request) => { row.checkpoint++ },
      (row: typeof request) => { row.base.title = 'tampered' },
      (row: typeof request) => { row.algorithm.version = 2 },
      (row: typeof request) => { Object.assign(row, { version: 999 }) },
      (row: typeof request) => { if (row.generation.kind === 'terrain') Reflect.deleteProperty(row.generation.input, 'widthMm') },
    ]) {
      const altered = cloneJson(request); mutate(altered)
      if (altered.checkpoint !== request.checkpoint) expect(() => parseBaseMapResponse(altered, executeBaseMapRequest(request))).toThrow()
      else expect(() => executeBaseMapRequest(altered)).toThrow()
    }
    const response = cloneJson(executeBaseMapRequest(request)); response.operationEpoch++
    expect(() => parseBaseMapResponse(request, response)).toThrow()
  })

  it('rejects rehashed cost, palette and geometry tampering before application replay', () => {
    const request = prepareBaseMapRequest(input()), original = executeBaseMapRequest(request)
    const cost = cloneJson(original); cost.domainCost.total = 0; cost.domainCost.items = {}
    expect(() => parseBaseMapResponse(request, rehash(cost))).toThrow()
    const overflow = cloneJson(original); overflow.domainCost.total = 257; overflow.domainCost.items = { physicalAndVisual: 257 }
    expect(() => parseBaseMapResponse(request, rehash(overflow))).toThrow()
    const palette = cloneJson(original)
    if (palette.result.kind !== 'terrain') throw new Error('test shape')
    Object.values(palette.result.terrain.document.assets)[0].sha256 = 'b'.repeat(64)
    expect(() => parseBaseMapResponse(request, rehash(palette))).toThrow()
    const geometry = cloneJson(original)
    if (geometry.result.kind !== 'terrain') throw new Error('test shape')
    geometry.result.terrain.document.terrainConnections['terrain-stairs'].from.positionMm = { x: -900000, y: -900000 }
    expect(() => parseBaseMapResponse(request, rehash(geometry))).toThrow()
  })

  it('retains managed-target closure after map ordering without accepting missing, duplicate or foreign targets', () => {
    const request = prepareBaseMapRequest(input()), original = executeBaseMapRequest(request)
    for (const change of ['missing', 'duplicate', 'foreign'] as const) {
      const response = cloneJson(original)
      if (response.result.kind !== 'terrain') throw new Error('test shape')
      const targets = response.result.terrain.managedTargets
      if (change === 'missing') targets.pop()
      else if (change === 'duplicate') targets.push(cloneJson(targets[0]))
      else targets[0].id = 'not-a-real-entity'
      expect(() => parseBaseMapResponse(request, rehash(response))).toThrow()
    }
    const cold = JSON.parse(canonicalJson(original)), parsed = parseBaseMapResponse(request, cold)
    expect(canonicalJson(parsed)).toBe(canonicalJson(cold))
    expect(parsed.resultHash).toBe(original.resultHash)
    expect(Object.isFrozen(parsed.result)).toBe(true)
  })

  it('strictly validates every composition plan field, ring and geometry receipt', () => {
    const request = prepareBaseMapRequest(compositionInput(2)), original = executeBaseMapRequest(request)
    for (const change of [
      (plan: Record<string, unknown>) => { plan.unrecognized = true },
      (plan: Record<string, unknown>) => { plan.geometryBudget = { gridNodes: 1, polygons: 1, rings: 1, points: 1, finalAdoptionCostChecked: false } },
      (plan: Record<string, unknown>) => { plan.fields = {} },
    ]) {
      const response = cloneJson(original)
      if (response.result.kind !== 'composition') throw new Error('test shape')
      change(response.result.plan as unknown as Record<string, unknown>)
      expect(() => parseBaseMapResponse(request, rehash(response))).toThrow()
    }
    const selfCrossing = cloneJson(original)
    if (selfCrossing.result.kind !== 'composition') throw new Error('test shape')
    const plan = selfCrossing.result.plan, polygon = plan.fields.land.polygons[0]
    polygon.outer = [{ x: 1000, y: 1000 }, { x: 5000, y: 5000 }, { x: 1000, y: 5000 }, { x: 5000, y: 1000 }]
    plan.fields.land.contours[0].pointsMm = cloneJson(polygon.outer)
    expect(() => parseBaseMapResponse(request, rehash(selfCrossing))).toThrow()
    const forgedSource = cloneJson(original)
    if (forgedSource.result.kind !== 'composition') throw new Error('test shape')
    forgedSource.result.plan.thresholds.land!.sourceInput.seed = 'different-source'
    expect(() => parseBaseMapResponse(request, rehash(forgedSource))).toThrow()
  })

  it('rejects populated, locked, historical, private or complete-project input rather than accepting a patch', () => {
    const raw = input(), generated = generateTerrainDocument(raw.base, raw.generation.input)
    const populated = input(); populated.base = generated.document
    const locked = input(); locked.base.userLayers['visual-layer-ground'].editLocked = true
    const history = input(); history.base.revision = 1
    const marker = input(); marker.base.generationMetadata = { generatorVersion: 'old', seed: 'secret', adoptedAt: marker.base.updatedAt }
    const privateScene = input(); privateScene.base.notes.secret = { id: 'secret', floorId: 'visual-floor', editLocked: false,
      anchor: { type: 'point', positionMm: { x: 0, y: 0 } }, kind: 'note', text: 'private', visibility: 'gm' }
    for (const invalid of [populated, locked, history, marker, privateScene, { ...input(), historyIdentity: {} }, { ...input(), appearance: {} }]) {
      expect(() => prepareBaseMapRequest(invalid)).toThrow()
    }
    const mismatched = input(); mismatched.base.exportBoundsMm.width = 25000
    expect(() => prepareBaseMapRequest(mismatched)).toThrow()
  })

  it('enforces byte limits and rejects getters without evaluating them', () => {
    expect(BASE_MAP_LIMITS).toEqual({ requestBytes: 4 * 1024 * 1024, resultBytes: 8 * 1024 * 1024, operations: 256 })
    const tooBig = input(); tooBig.base.title = '图'.repeat(Math.ceil(BASE_MAP_LIMITS.requestBytes / 3))
    expect(() => prepareBaseMapRequest(tooBig)).toThrow()
    let read = false
    const accessor = { ...input(), get malicious() { read = true; return 'secret' } }
    expect(() => prepareBaseMapRequest(accessor)).toThrow(); expect(read).toBe(false)
    const request = prepareBaseMapRequest(input()), response = executeBaseMapRequest(request)
    expect(() => parseBaseMapResponse(request, { ...response, padding: 'x'.repeat(BASE_MAP_LIMITS.resultBytes) })).toThrow()
    let responseRead = false
    expect(() => parseBaseMapResponse(request, { ...response, get hidden() { responseRead = true; return null } })).toThrow()
    expect(responseRead).toBe(false)
    const owned = parseBaseMapResponse(request, cloneJson(response))
    expect(owned).not.toBe(response); expect(owned.result).not.toBe(response.result)
  })
})

describe('program base-map compatibility with the remaining existing palettes',()=>{
  it.each(['river','lake','forest','hill','mixed'] as const)('keeps %s domain output through the new transport and canonical cold read',kind=>{
    const raw=input(),request=prepareBaseMapRequest({...raw,generation:{kind:'terrain',input:{...raw.generation.input,kind}}}),response=executeBaseMapRequest(request)
    if(request.generation.kind!=='terrain'||response.result.kind!=='terrain')throw new Error('Expected terrain')
    expect(canonicalJson(response.result.terrain)).toBe(canonicalJson(generateTerrainDocument(request.base,request.generation.input)))
    expect(parseBaseMapResponse(request,JSON.parse(canonicalJson(response)))).toEqual(response)
  })
  it.each(['forestValley','grassRidge'] as const)('keeps %s complete plan and domain document through the new protocol',preset=>{
    const raw=compositionInput(),request=prepareBaseMapRequest({...raw,generation:{kind:'composition',input:{...raw.generation.input,preset,seed:'terrain-compose-0'}}}),response=executeBaseMapRequest(request)
    if(request.generation.kind!=='composition'||response.result.kind!=='composition')throw new Error('Expected composition')
    const spec=compositionPreset(request.generation.input),expected=materializeTerrainComposition(request.base,spec.input,spec.requirements,spec.name)
    expect(response.result).toEqual({kind:'composition',...expected})
    expect(parseBaseMapResponse(request,JSON.parse(canonicalJson(response)))).toEqual(response)
  })
})
