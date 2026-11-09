import type { SceneDocument } from '../../../model/scene.js'
import { LAYER_ENTITY_COLLECTIONS, DECORATION_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../../../model/scene.js'
import { applyCommands, type SceneCommand } from '../../../commands/commands.js'
import { decorationFootprint } from '../../../decorations/geometry.js'
import { polygonsOverlap, propFootprint, roomPoints } from '../../../geometry/geometry.js'
import { parseTaskBudgetProfile, type TaskBudgetProfile } from '../../../budget/task-budget.js'
import { captureJson, cloneJson, freezeJson, canonicalJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../../../terrain-generation/integrity.js'
import type { GenerationFieldGroup, GenerationRecipe, GenerationRule, OutputOwnership } from '../../../terrain-generation/contracts.js'
import { createSpaceContext } from '../../space.js'
import { generationCreationWrites } from '../../materialization.js'
import { GenerationRegistry, runGeneration, checkGenerationConstraints } from '../../orchestrator.js'
import { hashGenerationValue, type ArtifactInput, type GenerationCandidate, type GenerationRequest, type JsonValue } from '../../contracts.js'
import { interiorGenerationInputSchema, supportedInteriorGenerationInputSchema, type InteriorGenerationInput, type InteriorLayout, type InteriorRectangle, type SupportedInteriorGenerationInput } from './contracts.js'
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

export function normalizeSupportedInteriorInput(raw: unknown): SupportedInteriorGenerationInput {
  let input: SupportedInteriorGenerationInput
  try { input = supportedInteriorGenerationInputSchema.parse(captureJson(raw)) } catch (error) { throw new InteriorGenerationError('invalid-input', `地形建筑输入无效：${error instanceof Error ? error.message : String(error)}`) }
  const { supportRef, ...parameters } = input.parameters
  const normalized = normalizeInteriorInput({ version: 1, algorithmVersion: 2, seed: input.seed, parameters })
  return freezeJson({ version: 1, algorithmVersion: 1, seed: normalized.seed, parameters: { ...cloneJson(normalized.parameters), supportRef } })
}

type InteriorInput = InteriorGenerationInput | SupportedInteriorGenerationInput
type InteriorOptions = { profile: TaskBudgetProfile; nowMilliseconds: () => number; signal?: { readonly aborted: boolean } }
function layoutInput(input: InteriorInput): InteriorGenerationInput {
  if (input.algorithmVersion === 2) return input
  const { supportRef: _supportRef, ...parameters } = input.parameters
  return { version: 1, algorithmVersion: 2, seed: input.seed, parameters }
}

function assertBase(document: SceneDocument, input: InteriorInput): void {
  const checked = validateSceneDocument(document)
  if (!checked.ok) throw new InteriorGenerationError('invalid-input', '室内生成基底必须为严格合法的完整场景。')
  const p = input.parameters, floor = document.floors[p.floorId], layer = document.userLayers[p.layerId]
  if (document.mapMode !== 'scene' || Object.keys(document.floors).length !== 1 || !floor || !layer || layer.floorId !== floor.id || layer.editLocked) throw new InteriorGenerationError('unsupported', '当前室内布局只支持单Floor，并须选择同Floor未锁定的图层。')
  if (input.algorithmVersion === 2) {
    if ([...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS].some(key => Object.keys(document[key]).length)
      || Object.keys(document.vertices).length || Object.keys(getLegacyGeneration(document)!.recipes).length) throw new InteriorGenerationError('unsupported', '室内布局须使用独立空白工程；已有编辑工程的结构重生成将在后续明确范围内提供。')
  } else {
    const support = document.terrainAreas[input.parameters.supportRef.id], boundary = rectanglePoints(p.boundsMm)
    if (!support || support.floorId !== p.floorId || support.blocksMovement) throw new InteriorGenerationError('contradiction', '建筑须选择同Floor真实且可步行的地形支撑。')
    if (support.editLocked || document.userLayers[document.entityLayers[support.id]]?.editLocked) throw new InteriorGenerationError('unsupported', '建筑支撑地形或其图层已锁定。')
    const space = createSpaceContext(document)
    if (!space.supportsPolygon(boundary, input.parameters.supportRef, p.floorId)) throw new InteriorGenerationError('contradiction', '建筑完整范围及墙厚须落在声明的真实有效支撑面内。')
    const conflicts = new Set(space.conflicts(boundary, p.floorId, 1))
    for (const room of Object.values(document.rooms)) if (room.floorId === p.floorId && polygonsOverlap(boundary, roomPoints(document, room))) conflicts.add(room.id)
    for (const prop of Object.values(document.props)) if (prop.floorId === p.floorId && polygonsOverlap(boundary, propFootprint(prop))) conflicts.add(prop.id)
    for (const row of Object.values(document.decorations)) if (row.floorId === p.floorId && polygonsOverlap(boundary, decorationFootprint(document, row))) conflicts.add(row.id)
    for (const region of Object.values(document.regions)) if (region.floorId === p.floorId && region.kind === 'hazard' && polygonsOverlap(boundary, region.boundaryMm)) conflicts.add(region.id)
    if (conflicts.size) throw new InteriorGenerationError('contradiction', `建筑范围与既有墙、房间、路径、连接、物件或保留区冲突：${[...conflicts].sort().join('、')}`)
  }
  const b = p.boundsMm, f = floor.boundsMm
  if (b.x < f.x || b.y < f.y || b.x + b.width > f.x + f.width || b.y + b.height > f.y + f.height) throw new InteriorGenerationError('contradiction', '输入矛盾：建筑范围越过实际Floor边界。')
  for (const row of p.arrangement.palette) if (document.propDefinitions[row.ref.id]?.version !== row.ref.version) throw new InteriorGenerationError('invalid-input', '室内家具授权素材缺失或固定版本不符。')
  for (const [role, ref] of Object.entries(p.materials)) if (ref) {
    const material = document.materials[ref.id]
    if (!material || material.version !== ref.version || !material.applicableSurfaces.includes(role === 'floor' ? 'room' : 'wall')) throw new InteriorGenerationError('invalid-input', '室内固定材质缺失、版本不符或不适用对应表面。')
  }
}

function persistGeneration(document: SceneDocument, input: InteriorInput, layout: InteriorLayout, baseline?: SceneDocument): void {
  const p = input.parameters, gen = getLegacyGeneration(document)!, id = (key: string) => interiorEntityId(document.sceneId, input.seed, key)
  const recipeId = id('recipe'), ruleId = id('layout-rule')
  const bindings = { materials: Object.entries(p.materials).flatMap(([role, ref]) => ref ? [{ role: role as 'floor' | 'wall', ref: cloneJson(ref) }] : []), props: cloneJson(p.arrangement.palette), precision: { sampleSpacingMm: 1, toleranceMm: 1, noiseCellMm: 1 } }
  const recipe: GenerationRecipe = input.algorithmVersion === 2
    ? { id: recipeId, domain: 'interior', recipeVersion: 2, algorithmId: 'interior-layout', algorithmVersion: 2, mapMode: 'scene', seed: input.seed, parameters: cloneJson(input.parameters), ...bindings }
    : { id: recipeId, domain: 'interior', recipeVersion: 1, algorithmId: 'supported-interior', algorithmVersion: 1, mapMode: 'scene', seed: input.seed, parameters: cloneJson(input.parameters), ...bindings }
  gen.recipes[recipeId] = recipe
  const roomKeys = new Map([...layout.rooms.map(row => [row.roomId, `room:${row.requirementId}`] as const), ...layout.corridors.map(row => [row.roomId, 'corridor'] as const)])
  const fields: GenerationFieldGroup[] = ['geometry', 'properties', 'surface', 'source']
  for (const [collection, kind] of [['vertices', 'vertex'], ['rooms', 'room'], ['walls', 'wall'], ['openings', 'opening'], ['props', 'prop']] as const) for (const entity of Object.values(document[collection])) {
    if (baseline && Object.hasOwn(baseline[collection], entity.id)) continue
    const outputKey = `${recipeId}:${roomKeys.get(entity.id) ?? `${kind}:${entity.id}`}`
    const ownership: OutputOwnership = { id: id(`ownership:${kind}:${entity.id}`), outputKey, ruleId, target: { kind, entityId: entity.id, parentId: null, fieldGroup: 'geometry' }, managedFields: [...fields], manualFields: [], state: 'managed', birthToken: id(`provenance:${kind}:${entity.id}`) }
    if (!gen.ownership[ownership.id]) gen.ownership[ownership.id] = ownership
  }
  const owners = Object.values(gen.ownership).filter(row => row.ruleId === ruleId)
  const rule: GenerationRule = { id: ruleId, floorId: p.floorId, layerId: p.layerId, visibility: 'public', editLocked: false, kind: 'building', recipeRef: { id: recipeId, version: recipe.recipeVersion },
    inputs: input.algorithmVersion === 2 ? [] : (['geometry', 'properties', 'surface'] as const).map(fieldGroup => ({ kind: 'terrainArea', entityId: input.parameters.supportRef.id, parentId: null, fieldGroup })),
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

export function runInteriorGeneration(base: SceneDocument, raw: unknown, options: InteriorOptions) {
  return runInteriorKernel(base, normalizeInteriorInput(raw), options)
}
export function runSupportedInteriorGeneration(base: SceneDocument, raw: unknown, options: InteriorOptions) {
  return runInteriorKernel(base, normalizeSupportedInteriorInput(raw), options)
}

/** Shared structure/connection/furnishing implementation. The old descriptors,
 * seed derivation, parameter shape and hashes remain exactly interior-layout@2;
 * real support is an explicitly separate replay contract. */
function runInteriorKernel<Input extends InteriorInput>(base: SceneDocument, input: Input, options: InteriorOptions): { input: Input; layout: InteriorLayout; candidate: GenerationCandidate; report: InteriorArrangementReport; resultHash: string } {
  const profile = parseTaskBudgetProfile(options.profile), document = captureJson(base), interior = layoutInput(input)
  assertBase(document, input)
  const p = input.parameters, registry = new GenerationRegistry(), supported = input.algorithmVersion === 1
  const structureId = supported ? 'supported-interior' : 'interior-layout', connectionsId = supported ? 'supported-interior-connections' : 'interior-connections', furnishingId = supported ? 'supported-interior-furnishing' : 'interior-furnishing', version = supported ? 1 : 2
  const parseParameters = (parameters: Record<string, JsonValue>) => captureJson(supported ? normalizeSupportedInteriorInput(parameters) : normalizeInteriorInput(parameters)) as unknown as Record<string, JsonValue>
  const persist = (next: SceneDocument) => { if (!layout) throw new InteriorGenerationError('invalid-input', '建筑尚未生成真实布局。'); persistGeneration(next, input, layout, supported ? document : undefined) }
  if (supported && getLegacyGeneration(document)!.recipes[interiorEntityId(document.sceneId, input.seed, 'recipe')]) throw new InteriorGenerationError('contradiction', '建筑种子对应的生成身份已存在；请为新建筑选择独立种子。')
  let layout: InteriorLayout | undefined, connectivity: InteriorConnectivityReport | undefined, furnishing: InteriorFurnishingReport | undefined
  registry.register({ id: structureId, version, phase: 'structure', owner: 'structure', consumes: ['support-surface'], produces: ['plan-region', 'support-surface', 'wall'], publishFacts: ['support-surface', 'wall'], requires: [], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' },
    writes: ({ document }) => generationCreationWrites(document, ['vertices', 'rooms', 'walls']),
    parseParameters,
    run(context) {
      layout = solveInteriorLayout(document.sceneId, interior, profile, context.deriveSeed('rectangular-layout'), context.checkCancelled)
      return { outputs: [...layout.rooms.map(row => ({ ...row, purpose: p.rooms.find(r => r.id === row.requirementId)!.purpose })), ...layout.corridors.map(row => ({ ...row, purpose: '通道' }))].map(row => ({ id: `plan:${row.roomId}`, owner: 'structure', kind: 'plan-region', payload: { coordinateFrame: 'scene-mm', floorId: p.floorId, visibility: 'public', domain: 'building', purpose: row.purpose, boundaryMm: rectanglePoints(row.boundsMm) } } as ArtifactInput)) }
    },
    materialize({ document: before, context }) {
      if (!layout) throw new InteriorGenerationError('invalid-input', '室内布局阶段没有结果。')
      let sequence = 0
      const commands: SceneCommand[] = [...layout.rooms.map(row => ({ ...row, purpose: p.rooms.find(r => r.id === row.requirementId)!.purpose })), ...layout.corridors.map(row => ({ ...row, purpose: '通道' }))].map(row => ({ type: 'createRoom', id: row.roomId, floorId: p.floorId, layerId: p.layerId, boundaryMm: rectanglePoints(row.boundsMm), thicknessMm: p.wallThicknessMm, purpose: row.purpose, visibility: 'public', accessExpectation: 'unspecified', supportRef: input.algorithmVersion === 1 ? input.parameters.supportRef : { kind: 'floor', id: p.floorId }, ...(p.materials.floor ? { materialRef: p.materials.floor } : {}) }))
      context.checkCancelled()
      const next = applyCommands(cloneJson(before) as SceneDocument, commands, { ids: { nextId: () => interiorEntityId(document.sceneId, input.seed, `native:${sequence++}`) }, clock: { now: () => document.updatedAt } }, { budget: profile })
      if (p.materials.wall) for (const wall of Object.values(next.walls)) {
        if (supported && Object.hasOwn(document.walls, wall.id)) continue
        const material = next.materials[p.materials.wall.id]
        wall.topStyle = { base: { materialRef: cloneJson(p.materials.wall), tileSizeMm: cloneJson(material.defaultTileSizeMm), rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
      }
      const generatedView = supported ? { ...next, walls: Object.fromEntries(Object.entries(next.walls).filter(([id]) => !Object.hasOwn(document.walls, id))), openings: Object.fromEntries(Object.entries(next.openings).filter(([id]) => !Object.hasOwn(document.openings, id))) } : next
      checkMaterializedInterior(generatedView, interior, layout)
      persist(next)
      return next
    },
  })
  registry.register({ id: connectionsId, version, phase: 'connectivity', owner: 'connectivity', consumes: ['wall', 'support-surface'], produces: ['opening'], publishFacts: ['opening'], requires: [{ id: structureId, version }], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' },
    writes: ({ document }) => [...generationCreationWrites(document, ['openings']), { kind: 'update', collection: 'generation.legacy.rules', ids: [interiorEntityId(document.sceneId, input.seed, 'layout-rule')], fields: ['outputs'] }],
    parseParameters,
    run() { return { outputs: [] } },
    materialize({ document: before, context }) {
      if (!layout) throw new InteriorGenerationError('invalid-input', '室内布局阶段没有结果。')
      const result = arrangeInteriorConnections(cloneJson(before) as SceneDocument, interior, layout, { profile, checkCancelled: context.checkCancelled })
      connectivity = result.report
      persist(result.document)
      return result.document
    },
  })
  registry.register({ id: furnishingId, version, phase: 'content', owner: 'content', consumes: ['opening', 'support-surface'], produces: ['prop-placement', 'footprint'], publishFacts: ['prop-placement', 'footprint'], requires: [{ id: connectionsId, version }], determinism: { replayVersion: 1, seedDerivation: 'request/recipe/step/operator/key' },
    writes: ({ document }) => [...generationCreationWrites(document, ['props']), { kind: 'update', collection: 'generation.legacy.rules', ids: [interiorEntityId(document.sceneId, input.seed, 'layout-rule')], fields: ['outputs'] }],
    parseParameters,
    run() { return { outputs: [] } },
    materialize({ document: before, context }) {
      if (!layout || !connectivity) throw new InteriorGenerationError('invalid-input', '室内门路阶段没有结果。')
      const result = furnishInterior(cloneJson(before) as SceneDocument, interior, layout, connectivity, { profile, checkCancelled: context.checkCancelled })
      furnishing = result.report
      persist(result.document)
      return result.document
    },
  })
  const supportRef = input.algorithmVersion === 1 ? input.parameters.supportRef : { kind: 'floor', id: p.floorId }
  const sourceFact = createSpaceContext(document).artifacts.find(fact => fact.kind === 'support-surface' && fact.payload.sourceRef.kind === supportRef.kind && fact.payload.sourceRef.id === supportRef.id)!
  const parameters = captureJson(input) as unknown as Record<string, JsonValue>
  const recipe = registry.registerRecipe({ id: structureId, version, steps: [
    { id: 'layout', operator: { id: structureId, version }, required: true, parameters, dependsOn: [], inputs: [{ id: 'ground', kind: 'support-surface', from: { kind: 'source' }, cardinality: { min: 1, max: 1 }, artifactIds: [sourceFact.id], floorId: p.floorId, coordinateFrame: 'scene-mm' }] },
    { id: 'connections', operator: { id: connectionsId, version }, required: true, parameters, dependsOn: ['layout'], inputs: (['wall', 'support-surface'] as const).map(kind => ({ id: kind, kind, from: { kind: 'step' as const, stepId: 'layout', operator: { id: structureId, version } }, cardinality: { min: 1, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' as const })) },
    { id: 'furnishing', operator: { id: furnishingId, version }, required: true, parameters, dependsOn: ['layout', 'connections'], inputs: [
      { id: 'openings', kind: 'opening', from: { kind: 'step', stepId: 'connections', operator: { id: connectionsId, version } }, cardinality: { min: 0, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' },
      { id: 'rooms', kind: 'support-surface', from: { kind: 'step', stepId: 'layout', operator: { id: structureId, version } }, cardinality: { min: 1, max: 8192 }, floorId: p.floorId, coordinateFrame: 'scene-mm' },
    ] },
  ] })
  const bounds: GenerationRequest['hardConstraints'] = [{ id: 'building-bounds', kind: 'bounds', boundsMm: p.boundsMm }]
  const request: GenerationRequest = { requestVersion: 1, normalizationVersion: 1, target: { kind: 'new-project' }, coordinateFrame: 'scene-mm', intent: { environment: 'interior', structures: ['building'], purposes: p.rooms.map(room => room.purpose), tags: [] }, intentSource: { kind: 'manual', contentHash: hashGenerationValue(input) }, hardConstraints: supported ? [] : bounds, softGoals: [], seed: input.seed, budgetProfile: profile, recipe }
  const candidate = runGeneration(request, registry, { source: document, nowMilliseconds: options.nowMilliseconds, signal: options.signal })
  if (!layout || !connectivity || !furnishing) throw new InteriorGenerationError('invalid-input', '室内生成没有完整阶段结果。')
  if (supported) {
    // This module's bounds cover all of its actual new geometry, including full
    // wall envelopes/joins, openings and prop footprints, not just layout plans.
    // Existing outdoor connections have source/candidate-prefixed port fact IDs;
    // that derived relinking must not put their unchanged geometry inside this
    // building's local bounds. The original floor-only replay remains untouched.
    const result = cloneJson(candidate.document) as SceneDocument, space = createSpaceContext(result)
    const added = new Set([...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS].flatMap(collection => Object.keys(result[collection]).filter(id => !Object.hasOwn(document[collection], id))))
    const actual = space.artifacts.filter(fact => {
      const value = fact.payload
      const id = 'entityId' in value ? value.entityId : 'sourceRef' in value ? value.sourceRef.id : 'sourceId' in value ? value.sourceId : 'targetId' in value ? value.targetId : null
      return id !== null && added.has(id)
    })
    const failure = checkGenerationConstraints(bounds, [...candidate.outputs, ...actual], space)[0]
    if (failure) throw new InteriorGenerationError('contradiction', failure.message)
  }
  const report: InteriorArrangementReport = { connectivity, furnishing, notes: [...connectivity.notes, ...furnishing.notes] }
  const resultHash = hashGenerationValue({ input, layout, report, documentHash: candidate.documentHash, outputHash: candidate.outputHash, stages: candidate.stages })
  return freezeJson({ input, layout, candidate, report, resultHash })
}
