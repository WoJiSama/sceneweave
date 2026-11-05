import type { SceneDocument } from '../../../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../../../model/scene.js'
import { applyCommands, type SceneCommand } from '../../../commands/commands.js'
import { parseTaskBudgetProfile, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { captureJson, cloneJson, freezeJson, canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../../../terrain-generation/integrity.js'
import type { GenerationFieldGroup, GenerationRecipe, GenerationRule, OutputOwnership } from '../../../terrain-generation/contracts.js'
import { createSpaceContext } from '../../space.js'
import { GenerationRegistry, runGeneration } from '../../orchestrator.js'
import { hashGenerationValue, type ArtifactInput, type GenerationCandidate, type GenerationRequest, type JsonValue } from '../../contracts.js'
import { interiorGenerationInputSchema, type InteriorGenerationInput, type InteriorLayout, type InteriorRectangle } from './contracts.js'
import { arrangeInteriorConnections, type InteriorConnectivityReport } from './connectivity.js'
import { furnishInterior, type InteriorFurnishingReport } from './furnishing.js'
import { InteriorGenerationError, checkInteriorLayout, clearArea, interiorEntityId, rectanglePoints, solveInteriorLayout } from './layout.js'

export * from './contracts.js'
export * from './layout.js'
export * from './connectivity.js'
export * from './furnishing.js'

export interface InteriorArrangementReport { connectivity: InteriorConnectivityReport; furnishing: InteriorFurnishingReport; notes: string[] }

/** Public input boundary normalizes stable demand/relationship ordering only.
 * No inference can upgrade purpose text into door, travel or furnishing facts. */
export function normalizeInteriorInput(raw: unknown): InteriorGenerationInput {
  let input: InteriorGenerationInput
  try { input = interiorGenerationInputSchema.parse(captureJson(raw)) } catch (error) { throw new InteriorGenerationError('invalid-input', `室内输入无效：${error instanceof Error ? error.message : String(error)}`) }
  const p = input.parameters, ids = new Set(p.rooms.map(room => room.id))
  if (ids.size !== p.rooms.length) throw new InteriorGenerationError('contradiction', '输入矛盾：房间需求ID重复。')
  if (p.rooms.some(room => room.minAreaMm2 > room.maxAreaMm2)) throw new InteriorGenerationError('contradiction', '输入矛盾：房间最小净面积大于最大净面积。')
  if (![p.boundsMm.x + p.boundsMm.width, p.boundsMm.y + p.boundsMm.height].every(Number.isSafeInteger)) throw new InteriorGenerationError('invalid-input', '建筑边界超出安全整数毫米范围。')
  const relations = new Map<string, typeof p.relations[number]>()
  for (const row of p.relations) {
    if (!ids.has(row.a) || !ids.has(row.b) || row.a === row.b) throw new InteriorGenerationError('contradiction', '输入矛盾：房间关系须引用两个不同且存在的需求ID。')
    const [a, b] = [row.a, row.b].sort(), key = canonicalJson([a, b, row.kind])
    if (relations.has(key)) throw new InteriorGenerationError('invalid-input', '同一对房间的同种关系不能重复。')
    relations.set(key, { ...row, a, b })
  }
  for (const row of relations.values()) if (row.kind === 'adjacent' && relations.has(canonicalJson([row.a, row.b, 'separate']))) throw new InteriorGenerationError('contradiction', `输入矛盾：${row.a}/${row.b}同时要求邻接与分离。`)
  const palette = p.arrangement.palette
  if (new Set(palette.map(row => canonicalJson(row))).size !== palette.length) throw new InteriorGenerationError('invalid-input', '室内家具素材角色及固定版本不能重复。')
  palette.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0)
  p.rooms.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  p.relations = [...relations.values()].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0)
  return freezeJson(input)
}

function assertBase(document: SceneDocument, input: InteriorGenerationInput): void {
  const checked = validateSceneDocument(document)
  if (!checked.ok) throw new InteriorGenerationError('invalid-input', '室内生成基底必须为严格合法的完整场景。')
  const p = input.parameters, floor = document.floors[p.floorId], layer = document.userLayers[p.layerId]
  if (document.mapMode !== 'scene' || Object.keys(document.floors).length !== 1 || !floor || !layer || layer.floorId !== floor.id || layer.editLocked) throw new InteriorGenerationError('unsupported', '当前室内布局只支持单Floor，并须选择同Floor未锁定的图层。')
  if ([...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS].some(key => Object.keys(document[key]).length)
    || Object.keys(document.vertices).length || Object.keys(getLegacyGeneration(document)!.recipes).length) throw new InteriorGenerationError('unsupported', '室内布局须使用独立空白工程；已有编辑工程的结构重生成将在后续明确范围内提供。')
  const b = p.boundsMm, f = floor.boundsMm
  if (b.x < f.x || b.y < f.y || b.x + b.width > f.x + f.width || b.y + b.height > f.y + f.height) throw new InteriorGenerationError('contradiction', '输入矛盾：建筑范围越过实际Floor边界。')
  for (const row of p.arrangement.palette) if (document.propDefinitions[row.ref.id]?.version !== row.ref.version) throw new InteriorGenerationError('invalid-input', '室内家具授权素材缺失或固定版本不符。')
  for (const [role, ref] of Object.entries(p.materials)) if (ref) {
    const material = document.materials[ref.id]
    if (!material || material.version !== ref.version || !material.applicableSurfaces.includes(role === 'floor' ? 'room' : 'wall')) throw new InteriorGenerationError('invalid-input', '室内固定材质缺失、版本不符或不适用对应表面。')
  }
}

function persistGeneration(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout): void {
  const p = input.parameters, gen = getLegacyGeneration(document)!, id = (key: string) => interiorEntityId(document.sceneId, input.seed, key)
  const recipeId = id('recipe'), ruleId = id('layout-rule')
  const recipe: GenerationRecipe = { id: recipeId, domain: 'interior', recipeVersion: 2, algorithmId: 'interior-layout', algorithmVersion: 2, mapMode: 'scene', seed: input.seed, parameters: cloneJson(p),
    materials: Object.entries(p.materials).flatMap(([role, ref]) => ref ? [{ role: role as 'floor' | 'wall', ref: cloneJson(ref) }] : []), props: cloneJson(p.arrangement.palette), precision: { sampleSpacingMm: 1, toleranceMm: 1, noiseCellMm: 1 } }
  gen.recipes[recipeId] = recipe
  const roomKeys = new Map([...layout.rooms.map(row => [row.roomId, `room:${row.requirementId}`] as const), ...layout.corridors.map(row => [row.roomId, 'corridor'] as const)])
  const fields: GenerationFieldGroup[] = ['geometry', 'properties', 'surface', 'source']
  for (const [collection, kind] of [['vertices', 'vertex'], ['rooms', 'room'], ['walls', 'wall'], ['openings', 'opening'], ['props', 'prop']] as const) for (const entity of Object.values(document[collection])) {
    const outputKey = `${recipeId}:${roomKeys.get(entity.id) ?? `${kind}:${entity.id}`}`
    const ownership: OutputOwnership = { id: id(`ownership:${kind}:${entity.id}`), outputKey, ruleId, target: { kind, entityId: entity.id, parentId: null, fieldGroup: 'geometry' }, managedFields: [...fields], manualFields: [], state: 'managed', birthToken: id(`provenance:${kind}:${entity.id}`) }
    if (!gen.ownership[ownership.id]) gen.ownership[ownership.id] = ownership
  }
  const owners = Object.values(gen.ownership).filter(row => row.ruleId === ruleId)
  const rule: GenerationRule = { id: ruleId, floorId: p.floorId, layerId: p.layerId, visibility: 'public', editLocked: false, kind: 'building', recipeRef: { id: recipeId, version: 2 }, inputs: [],
    outputs: owners.flatMap(row => fields.map(fieldGroup => ({ ...row.target, fieldGroup }))), parameters: { widthMm: p.boundsMm.width, minWidthMm: 0, maxWidthMm: p.boundsMm.width, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
  gen.rules[ruleId] = rule
  rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule)
}

/** Independently read real native room boundaries; a valid abstract rectangle
 * does not prove materialization preserved the requested geometry. */
export function checkMaterializedInterior(document: SceneDocument, input: InteriorGenerationInput, layout: InteriorLayout): void {
  const actual = (roomId: string): InteriorRectangle => {
    const room = document.rooms[roomId]
    if (!room || room.floorId !== input.parameters.floorId) throw new InteriorGenerationError('invalid-input', '物化房间缺失或跨Floor。')
    const vertices = room.boundaryVertexIds.map(id => document.vertices[id]), xs = vertices.map(v => v.xMm), ys = vertices.map(v => v.yMm)
    const x = Math.min(...xs), y = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys)
    const area2 = vertices.reduce((area, v, index) => {
      const next = vertices[(index + 1) % vertices.length]
      return area + BigInt(v.xMm) * BigInt(next.yMm) - BigInt(v.yMm) * BigInt(next.xMm)
    }, 0n)
    if (vertices.some((v, index) => {
      const next = vertices[(index + 1) % vertices.length]
      return v.xMm !== x && v.xMm !== right && v.yMm !== y && v.yMm !== bottom || v.xMm !== next.xMm && v.yMm !== next.yMm
    }) || (area2 < 0n ? -area2 : area2) !== 2n * BigInt(right - x) * BigInt(bottom - y)) throw new InteriorGenerationError('invalid-input', '物化房间不在已声明的矩形切分范围内。')
    return { x, y, width: right - x, height: bottom - y }
  }
  const real = { rooms: layout.rooms.map(row => { const boundsMm = actual(row.roomId); return { ...row, boundsMm, clearAreaMm2: clearArea(boundsMm, input.parameters.wallThicknessMm) } }), corridors: layout.corridors.map(row => ({ ...row, boundsMm: actual(row.roomId) })) }
  if (canonicalJson(real) !== canonicalJson(layout) || checkInteriorLayout(input, real).length) throw new InteriorGenerationError('contradiction', '实际房间与请求布局、面积或邻接检查不符。')
  if (Object.values(document.walls).some(wall => wall.thicknessMm !== input.parameters.wallThicknessMm)) throw new InteriorGenerationError('contradiction', '实际墙厚与室内请求不符。')
  if (Object.keys(document.openings).length) throw new InteriorGenerationError('invalid-input', '布局阶段不能隐式生成门窗或宣称通达。')
}

export function runInteriorGeneration(base: SceneDocument, raw: unknown, options: { profile: TaskBudgetProfile; nowMilliseconds: () => number; signal?: { readonly aborted: boolean } }): { input: InteriorGenerationInput; layout: InteriorLayout; candidate: GenerationCandidate; report: InteriorArrangementReport; resultHash: string } {
  const input = normalizeInteriorInput(raw), profile = parseTaskBudgetProfile(options.profile), document = captureJson(base)
  assertBase(document, input)
  const p = input.parameters, registry = new GenerationRegistry()
  let layout: InteriorLayout | undefined, connectivity: InteriorConnectivityReport | undefined, furnishing: InteriorFurnishingReport | undefined
  registry.register({ id: 'interior-layout', version: 2, phase: 'structure', owner: 'structure', consumes: ['support-surface'], produces: ['plan-region', 'support-surface', 'wall'], publishFacts: ['support-surface', 'wall'], requires: [], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' },
    parseParameters(parameters) { return captureJson(normalizeInteriorInput(parameters)) as unknown as Record<string, JsonValue> },
    run(context) {
      layout = solveInteriorLayout(document.sceneId, input, profile, context.deriveSeed('rectangular-layout'), context.checkCancelled)
      return { outputs: [...layout.rooms.map(row => ({ ...row, purpose: p.rooms.find(r => r.id === row.requirementId)!.purpose })), ...layout.corridors.map(row => ({ ...row, purpose: '通道' }))].map(row => ({ id: `plan:${row.roomId}`, owner: 'structure', kind: 'plan-region', payload: { coordinateFrame: 'scene-mm', floorId: p.floorId, visibility: 'public', domain: 'building', purpose: row.purpose, boundaryMm: rectanglePoints(row.boundsMm) } } as ArtifactInput)) }
    },
    materialize({ document: before, context }) {
      if (!layout) throw new InteriorGenerationError('invalid-input', '室内布局阶段没有结果。')
      let sequence = 0
      const commands: SceneCommand[] = [...layout.rooms.map(row => ({ ...row, purpose: p.rooms.find(r => r.id === row.requirementId)!.purpose })), ...layout.corridors.map(row => ({ ...row, purpose: '通道' }))].map(row => ({ type: 'createRoom', id: row.roomId, floorId: p.floorId, layerId: p.layerId, boundaryMm: rectanglePoints(row.boundsMm), thicknessMm: p.wallThicknessMm, purpose: row.purpose, visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: p.floorId }, ...(p.materials.floor ? { materialRef: p.materials.floor } : {}) }))
      context.checkCancelled()
      const next = applyCommands(cloneJson(before) as SceneDocument, commands, { ids: { nextId: () => interiorEntityId(document.sceneId, input.seed, `native:${sequence++}`) }, clock: { now: () => document.updatedAt } }, { budget: profile })
      if (p.materials.wall) for (const wall of Object.values(next.walls)) {
        const material = next.materials[p.materials.wall.id]
        wall.topStyle = { base: { materialRef: cloneJson(p.materials.wall), tileSizeMm: cloneJson(material.defaultTileSizeMm), rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
      }
      checkMaterializedInterior(next, input, layout)
      persistGeneration(next, input, layout)
      return next
    },
  })
  registry.register({ id: 'interior-connections', version: 2, phase: 'connectivity', owner: 'connectivity', consumes: ['wall', 'support-surface'], produces: ['opening'], publishFacts: ['opening'], requires: [{ id: 'interior-layout', version: 2 }], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' },
    parseParameters(parameters) { return captureJson(normalizeInteriorInput(parameters)) as unknown as Record<string, JsonValue> },
    run() { return { outputs: [] } },
    materialize({ document: before, context }) {
      if (!layout) throw new InteriorGenerationError('invalid-input', '室内布局阶段没有结果。')
      const result = arrangeInteriorConnections(cloneJson(before) as SceneDocument, input, layout, { profile, checkCancelled: context.checkCancelled })
      connectivity = result.report
      persistGeneration(result.document, input, layout)
      return result.document
    },
  })
  registry.register({ id: 'interior-furnishing', version: 2, phase: 'content', owner: 'content', consumes: ['opening', 'support-surface'], produces: ['prop-placement', 'footprint'], publishFacts: ['prop-placement', 'footprint'], requires: [{ id: 'interior-connections', version: 2 }], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' },
    parseParameters(parameters) { return captureJson(normalizeInteriorInput(parameters)) as unknown as Record<string, JsonValue> },
    run() { return { outputs: [] } },
    materialize({ document: before, context }) {
      if (!layout || !connectivity) throw new InteriorGenerationError('invalid-input', '室内门路阶段没有结果。')
      const result = furnishInterior(cloneJson(before) as SceneDocument, input, layout, connectivity, { profile, checkCancelled: context.checkCancelled })
      furnishing = result.report
      persistGeneration(result.document, input, layout)
      return result.document
    },
  })
  const sourceFact = createSpaceContext(document).artifacts.find(fact => fact.kind === 'support-surface' && fact.payload.sourceRef.kind === 'floor' && fact.payload.sourceRef.id === p.floorId)!
  const parameters = captureJson(input) as unknown as Record<string, JsonValue>
  const recipe = registry.registerRecipe({ id: 'interior-layout', version: 2, steps: [
    { id: 'layout', operator: { id: 'interior-layout', version: 2 }, required: true, parameters, dependsOn: [], inputs: [{ id: 'ground', kind: 'support-surface', from: { kind: 'source' }, cardinality: { min: 1, max: 1 }, artifactIds: [sourceFact.id], floorId: p.floorId, coordinateFrame: 'scene-mm' }] },
    { id: 'connections', operator: { id: 'interior-connections', version: 2 }, required: true, parameters, dependsOn: ['layout'], inputs: (['wall', 'support-surface'] as const).map(kind => ({ id: kind, kind, from: { kind: 'step' as const, stepId: 'layout', operator: { id: 'interior-layout', version: 2 } }, cardinality: { min: 1, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' as const })) },
    { id: 'furnishing', operator: { id: 'interior-furnishing', version: 2 }, required: true, parameters, dependsOn: ['layout', 'connections'], inputs: [
      { id: 'openings', kind: 'opening', from: { kind: 'step', stepId: 'connections', operator: { id: 'interior-connections', version: 2 } }, cardinality: { min: 0, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' },
      { id: 'rooms', kind: 'support-surface', from: { kind: 'step', stepId: 'layout', operator: { id: 'interior-layout', version: 2 } }, cardinality: { min: 1, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' },
    ] },
  ] })
  const request: GenerationRequest = { requestVersion: 1, normalizationVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { environment: 'interior', structures: ['building'], purposes: p.rooms.map(room => room.purpose), tags: [] }, intentSource: { kind: 'manual', contentHash: hashGenerationValue(input) }, hardConstraints: [{ id: 'building-bounds', kind: 'bounds', boundsMm: p.boundsMm }], softGoals: [], seed: input.seed, budgetProfile: profile, recipe }
  const candidate = runGeneration(request, registry, { source: document, nowMilliseconds: options.nowMilliseconds, signal: options.signal })
  if (!layout || !connectivity || !furnishing) throw new InteriorGenerationError('invalid-input', '室内生成没有完整阶段结果。')
  const report: InteriorArrangementReport = { connectivity, furnishing, notes: [...connectivity.notes, ...furnishing.notes] }
  const resultHash = hashGenerationValue({ input, layout, report, documentHash: candidate.documentHash, outputHash: candidate.outputHash, stages: candidate.stages })
  return freezeJson({ input, layout, candidate, report, resultHash })
}
