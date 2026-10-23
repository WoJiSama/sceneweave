import { sha256TextV2 } from '../v2/scatter'
import { createPublicVisibilityV2 } from '../v2/visibility'
import { geometryDocumentForValidationV3 } from '../v3/domain'
import { effectiveEditLockedV3, enumerateLayerEntitiesV3 } from '../v3/layers'
import { validateSceneSnapshotV3 } from '../v3/snapshots'
import type { MaterialPaint, PropV2, SceneDocumentV3, SurfaceStyle } from '../v3/types'
import type { SceneCommandV3 } from '../v3/commands'
import { createHistoryIdentityV6 } from './identity'
import { COMPOSITION_LIMITS_V6, type AdjustmentKindV6, type AppearanceAdjustmentV6, type AppearanceGraphV6, type AppearanceScopePlanV6, type AppearanceScopeV6, type BitmapVariantV6, type CompositionContentV6, type PropAppearanceSnapshotV6 } from './types'

export const canonicalJsonV6 = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
export const equalCompositionValueV6 = (a: unknown, b: unknown): boolean => canonicalJsonV6(a) === canonicalJsonV6(b)
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
export function propAppearanceSnapshotV6(prop: PropAppearanceSnapshotV6): PropAppearanceSnapshotV6 {
  return structuredClone({ definitionRef: prop.definitionRef, appearance: prop.appearance, visualBoundsMm: prop.visualBoundsMm, shadowClass: prop.shadowClass, shadowOverride: prop.shadowOverride })
}
export function addPropAppearanceSourceV6(graph: AppearanceGraphV6, snapshot: PropAppearanceSnapshotV6, parentSourceId: string | null = null): string {
  const body = { kind: 'prop' as const, parentSourceId, snapshot: propAppearanceSnapshotV6(snapshot) }, id = `composition-source-${sha256TextV2(canonicalJsonV6(body))}`
  if (own(graph.sources, id) && !equalCompositionValueV6(graph.sources[id], { id, ...body })) throw new Error('固定外观源 ID 内容冲突。')
  graph.sources[id] = { id, ...body }; return id
}
export function addSurfaceAppearanceSourceV6(graph: AppearanceGraphV6, snapshot: SurfaceStyle, parentSourceId: string | null = null): string {
  const body = { kind: 'surface' as const, parentSourceId, snapshot: structuredClone(snapshot) }, id = `composition-source-${sha256TextV2(canonicalJsonV6(body))}`
  if (own(graph.sources, id) && !equalCompositionValueV6(graph.sources[id], { id, ...body })) throw new Error('固定外观源 ID 内容冲突。')
  graph.sources[id] = { id, ...body }; return id
}
export function surfaceStyleV6(document: SceneDocumentV3, id: string): SurfaceStyle | null | undefined {
  const room = own(document.rooms, id), wall = own(document.walls, id)
  if (room) return room.floorStyle
  if (wall) return wall.topStyle
  return (own(document.terrainAreas, id) ?? own(document.terrainEdges, id) ?? own(document.terrainConnections, id) ?? own(document.paths, id))?.surfaceStyle
}
export function setSurfaceStyleV6(document: SceneDocumentV3, id: string, style: SurfaceStyle): void {
  const room = own(document.rooms, id), wall = own(document.walls, id)
  if (room) room.floorStyle = style
  else if (wall) wall.topStyle = style
  else {
    const target = own(document.terrainAreas, id) ?? own(document.terrainEdges, id) ?? own(document.terrainConnections, id) ?? own(document.paths, id)
    if (!target) throw new Error(`受支持表面不存在：${id}。`)
    target.surfaceStyle = style
  }
}
export function supportedAppearanceKindsV6(content: CompositionContentV6, id: string): AdjustmentKindV6[] {
  const prop = own(content.document.props, id)
  if (prop) {
    const source = own(content.appearance.sources, content.appearance.propSources[id])
    const image = source?.kind === 'prop' ? source.snapshot.appearance.kind === 'image' : prop.appearance.kind === 'image'
    return image ? ['tint', 'brightness', 'opacity', 'shadowClass'] : ['opacity', 'shadowClass']
  }
  return surfaceStyleV6(content.document, id) ? ['tint', 'brightness', 'opacity'] : []
}
export function inspectAppearanceScopeV6(content: CompositionContentV6, scope: AppearanceScopeV6, kinds: readonly AdjustmentKindV6[] = ['opacity']): AppearanceScopePlanV6 {
  const document = content.document
  if (scope.kind === 'layer' && !own(document.userLayers, scope.layerId)) throw new Error('外观图层不存在。')
  const requested = scope.kind === 'targets' ? scope.ids : enumerateLayerEntitiesV3(document).filter(entity => document.entityLayers[entity.id] === scope.layerId).map(entity => entity.id)
  if (!requested.length && scope.kind === 'targets') throw new Error('须明确选择外观目标。')
  if (new Set(requested).size !== requested.length) throw new Error('外观目标 ID 不能重复。')
  const expanded = scope.kind === 'targets' ? [...new Set(requested.flatMap(id => {
    const group = own(document.prefabInstances, id)
    return group ? Object.values(group.members).flatMap(member => member.propId ?? []) : [id]
  }))] : requested
  if (scope.kind === 'targets' && !expanded.length) throw new Error('所选组合没有可调整的活成员。')
  const targetIds: string[] = [], inapplicableIds: string[] = []
  for (const id of expanded) {
    const supported = supportedAppearanceKindsV6(content, id)
    if (!kinds.every(kind => supported.includes(kind))) {
      if (scope.kind === 'targets') throw new Error(`显式目标不支持此外观属性：${id}。`)
      inapplicableIds.push(id)
    } else targetIds.push(id)
  }
  const affected = new Set(targetIds)
  for (const group of [...Object.values(document.prefabInstances), ...Object.values(document.scatterGroups)]) if (Object.values(group.members).some(member => member.propId !== null && affected.has(member.propId))) affected.add(group.id)
  const commandCost = Math.max(1, affected.size)
  if (commandCost > COMPOSITION_LIMITS_V6.commandCost) throw new Error(`外观范围展开为 ${commandCost} 个操作，超过单次256预算。`)
  if (scope.kind === 'layer' && document.userLayers[scope.layerId].editLocked) throw new Error(`用户图层已锁定：${scope.layerId}。`)
  for (const id of affected) if (effectiveEditLockedV3(document, id)) throw new Error(`外观目标或依赖已锁定：${id}。`)
  return { targetIds, inapplicableIds, affectedIds: [...affected], commandCost }
}

export function createAppearanceGraphV6(input: SceneDocumentV3): AppearanceGraphV6 {
  const checked = validateSceneSnapshotV3(input)
  if (!checked.ok) throw new Error(`外观源场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const document = checked.document
  const graph: AppearanceGraphV6 = { version: 1, sources: {}, propSources: {}, surfaceSources: {}, instanceAdjustments: {}, layerAdjustments: {}, variants: {}, prefabAppearanceTemplates: {} }
  for (const prop of Object.values(document.props)) graph.propSources[prop.id] = addPropAppearanceSourceV6(graph, prop)
  for (const entity of enumerateLayerEntitiesV3(document)) {
    const style = surfaceStyleV6(document, entity.id)
    if (style) graph.surfaceSources[entity.id] = addSurfaceAppearanceSourceV6(graph, style)
  }
  const visibility = createPublicVisibilityV2(geometryDocumentForValidationV3(document))
  for (const definition of Object.values(document.prefabDefinitions)) {
    const instances = Object.values(document.prefabInstances).filter(group => group.definitionRef.id === definition.id)
    const privateTemplate = instances.some(group => group.visibility !== 'public' || Object.values(group.members).some(member => member.propId !== null && !visibility.prop(document.props[member.propId])))
    graph.prefabAppearanceTemplates[definition.id] = { definitionRef: { id: definition.id, version: definition.version }, visibility: privateTemplate ? 'gm' : 'public',
      members: Object.fromEntries(definition.members.map(member => [member.key, { sourceId: addPropAppearanceSourceV6(graph, member.propTemplate), adjustments: [] }])) }
  }
  return graph
}
export function createCompositionContentV6(document: SceneDocumentV3): CompositionContentV6 {
  const content = { document: structuredClone(document), historyIdentity: createHistoryIdentityV6(document), appearance: createAppearanceGraphV6(document) }
  retainSourceAssets(content)
  return content
}

/** Strict v3 keeps every adopted bitmap reachable from a real immutable definition, even after its last instance changes. */
function retainPropAsset(document: SceneDocumentV3, snapshot: PropAppearanceSnapshotV6, roots: Set<string>): void {
  if (snapshot.appearance.kind !== 'image' || roots.has(snapshot.appearance.assetId)) return
  const asset = own(document.assets, snapshot.appearance.assetId), original = snapshot.definitionRef && own(document.propDefinitions, snapshot.definitionRef.id)
  if (!asset || !original || original.version !== snapshot.definitionRef!.version) throw new Error('保全图片源需要实际资源及其固定物件定义。')
  const body = { definitionRef: snapshot.definitionRef, appearance: snapshot.appearance, visualBoundsMm: snapshot.visualBoundsMm, shadowClass: snapshot.shadowClass }
  const id = `composition-retained-prop-${sha256TextV2(canonicalJsonV6(body))}`
  const definition = { ...structuredClone(original), id, catalogId: id, version: 1, licenseRef: asset.licenseRef, origin: structuredClone(asset.origin),
    name: original.name, tags: ['sceneweave:retained-appearance', ...original.tags.filter(tag => tag !== 'sceneweave:retained-appearance')].slice(0, 64),
    defaultAppearance: structuredClone(snapshot.appearance), defaultVisualBoundsMm: structuredClone(snapshot.visualBoundsMm), defaultShadowClass: snapshot.shadowClass }
  const existing = own(document.propDefinitions, id)
  if (existing && !equalCompositionValueV6(existing, definition)) throw new Error('固定外观保全定义 ID 内容冲突。')
  document.propDefinitions[id] = definition; roots.add(snapshot.appearance.assetId)
}
function fixedAssetRoots(document: SceneDocumentV3): Set<string> {
  return new Set([
    ...Object.values(document.propDefinitions).flatMap(definition => definition.defaultAppearance.kind === 'image' ? [definition.defaultAppearance.assetId] : []),
    ...Object.values(document.materials).map(material => material.textureAssetId),
    ...Object.values(document.prefabDefinitions).flatMap(definition => definition.members.flatMap(member => member.propTemplate.appearance.kind === 'image' ? [member.propTemplate.appearance.assetId] : [])),
  ])
}
function retainSourceAssets(content: CompositionContentV6): Set<string> {
  const roots = fixedAssetRoots(content.document)
  for (const source of Object.values(content.appearance.sources)) if (source.kind === 'prop') retainPropAsset(content.document, source.snapshot, roots)
  return roots
}
/** Complete fixed source closure before strict draft validation; no pixels are generated or effective overrides resolved. */
export function ensureSourceAssetRootsV6(input: CompositionContentV6): CompositionContentV6 {
  const content = structuredClone(input)
  retainSourceAssets(content)
  return content
}

/** Sync only real source edits; geometry, layer moves and output recomputation never bake overrides into a source. */
export function syncAppearanceGraphV6(input: CompositionContentV6, previousDocument?: SceneDocumentV3, commands: readonly SceneCommandV3[] = []): CompositionContentV6 {
  const content = structuredClone(input), graph = content.appearance, document = content.document
  for (const command of commands) {
    if (command.type === 'copyProp' && own(graph.propSources, command.id)) {
      graph.propSources[command.newId] = graph.propSources[command.id]
      if (own(graph.instanceAdjustments, command.id)) graph.instanceAdjustments[command.newId] = structuredClone(graph.instanceAdjustments[command.id])
    } else if (command.type === 'replacePropAppearance') {
      const sourceId = graph.propSources[command.id], source = graph.sources[sourceId], definition = document.propDefinitions[command.definitionRef.id]
      if (source?.kind === 'prop') {
        const snapshot = { ...source.snapshot, definitionRef: command.definitionRef, appearance: definition.defaultAppearance }
        if (!equalCompositionValueV6(source.snapshot, snapshot)) graph.propSources[command.id] = addPropAppearanceSourceV6(graph, snapshot, sourceId)
      }
    } else if ((command.type === 'updateTerrainArea' || command.type === 'updateTerrainEdge' || command.type === 'updateTerrainConnection' || command.type === 'updatePath') && 'surfaceStyle' in command.changes) {
      const sourceId = graph.surfaceSources[command.id], source = graph.sources[sourceId]
      const style = command.changes.surfaceStyle
      if (style && source?.kind === 'surface' && !equalCompositionValueV6(source.snapshot, style)) graph.surfaceSources[command.id] = addSurfaceAppearanceSourceV6(graph, style, sourceId)
    } else if (command.type === 'setSurfaceMaterial' || command.type === 'setSurfacePaint' || command.type === 'setOverlayBoundary') {
      const sourceId = graph.surfaceSources[command.id], source = graph.sources[sourceId]
      if (source?.kind === 'surface') {
        const style = structuredClone(source.snapshot)
        if (command.type === 'setSurfaceMaterial') style.base.materialRef = structuredClone(command.materialRef)
        else if (command.type === 'setSurfacePaint') Object.assign(style.base, structuredClone(command.changes))
        else { const overlay = style.overlays.find(item => item.id === command.overlayId); if (overlay) overlay.boundaryMm = structuredClone(command.boundaryMm) }
        if (!equalCompositionValueV6(source.snapshot, style)) graph.surfaceSources[command.id] = addSurfaceAppearanceSourceV6(graph, style, sourceId)
      }
    }
  }
  for (const id of Object.keys(graph.propSources)) if (!own(document.props, id)) delete graph.propSources[id]
  for (const id of Object.keys(graph.surfaceSources)) if (!surfaceStyleV6(document, id)) delete graph.surfaceSources[id]
  for (const prop of Object.values(document.props)) if (!own(graph.propSources, prop.id)) graph.propSources[prop.id] = addPropAppearanceSourceV6(graph, prop)
  for (const entity of enumerateLayerEntitiesV3(document)) {
    const style = surfaceStyleV6(document, entity.id)
    if (style && !own(graph.surfaceSources, entity.id)) graph.surfaceSources[entity.id] = addSurfaceAppearanceSourceV6(graph, style)
  }
  for (const id of Object.keys(graph.instanceAdjustments)) if (!own(graph.propSources, id) && !own(graph.surfaceSources, id)) delete graph.instanceAdjustments[id]
  for (const id of Object.keys(graph.layerAdjustments)) if (!own(document.userLayers, id)) delete graph.layerAdjustments[id]
  // Imported new definitions are fixed roots even before an instance is placed.
  const visibility = createPublicVisibilityV2(geometryDocumentForValidationV3(document))
  for (const definition of Object.values(document.prefabDefinitions)) if (!own(graph.prefabAppearanceTemplates, definition.id)) {
    const privateTemplate = Object.values(document.prefabInstances).some(group => group.definitionRef.id === definition.id && (group.visibility !== 'public' || Object.values(group.members).some(member => member.propId !== null && !visibility.prop(document.props[member.propId]))))
    graph.prefabAppearanceTemplates[definition.id] = { definitionRef: { id: definition.id, version: definition.version }, visibility: privateTemplate ? 'gm' : 'public', members: Object.fromEntries(definition.members.map(member => [member.key, { sourceId: addPropAppearanceSourceV6(graph, member.propTemplate), adjustments: [] }])) }
  }
  void previousDocument
  return content
}
export function effectiveAdjustmentsV6(content: CompositionContentV6, id: string): Partial<Record<AdjustmentKindV6, AppearanceAdjustmentV6['value']>> {
  const result: Partial<Record<AdjustmentKindV6, AppearanceAdjustmentV6['value']>> = {}, supported = supportedAppearanceKindsV6(content, id)
  for (const adjustment of [...(content.appearance.layerAdjustments[content.document.entityLayers[id]] ?? []), ...(content.appearance.instanceAdjustments[id] ?? [])]) {
    if (adjustment.enabled && supported.includes(adjustment.kind)) result[adjustment.kind] = adjustment.value
  }
  return result
}
export function bitmapVariantV6(sourceAssetId: string, tint: string | null, brightness: number): BitmapVariantV6 | null {
  tint = tint?.toUpperCase() ?? null
  if (tint === null && brightness === 1) return null
  const hash = sha256TextV2(canonicalJsonV6({ sourceAssetId, tint, brightness }))
  return { id: `composition-variant-${hash}`, sourceAssetId, tint, brightness, outputAssetId: `composition-image-${hash}` }
}
function desiredVariants(content: CompositionContentV6): BitmapVariantV6[] {
  const variants = new Map<string, BitmapVariantV6>()
  const add = (asset: string, tint: string | null, brightness: number) => { const variant = bitmapVariantV6(asset, tint, brightness); if (variant) variants.set(variant.id, variant) }
  for (const [id, sourceId] of Object.entries(content.appearance.propSources)) {
    const source = content.appearance.sources[sourceId]
    if (source?.kind !== 'prop') throw new Error(`物件外观源不存在或类型不符：${id}。`)
    const appearance = source.snapshot.appearance, adjustments = effectiveAdjustmentsV6(content, id)
    if (appearance.kind === 'image') add(appearance.assetId, 'tint' in adjustments ? adjustments.tint as string | null : appearance.tint, adjustments.brightness as number ?? 1)
  }
  for (const [id, sourceId] of Object.entries(content.appearance.surfaceSources)) {
    const source = content.appearance.sources[sourceId]
    if (source?.kind !== 'surface') throw new Error(`表面外观源不存在或类型不符：${id}。`)
    const adjustments = effectiveAdjustmentsV6(content, id)
    for (const paint of [source.snapshot.base, ...source.snapshot.overlays.map(overlay => overlay.paint)]) {
      const material = content.document.materials[paint.materialRef.id]
      if (!material || material.version !== paint.materialRef.version) throw new Error(`固定材质版本缺失：${paint.materialRef.id}。`)
      add(material.textureAssetId, 'tint' in adjustments ? adjustments.tint as string | null : paint.tint, adjustments.brightness as number ?? 1)
    }
  }
  return [...variants.values()]
}
export function listRequiredVariantsV6(content: CompositionContentV6): BitmapVariantV6[] { return desiredVariants(content) }
function resolvedAsset(content: CompositionContentV6, asset: string, tint: string | null, brightness: number): string {
  const desired = bitmapVariantV6(asset, tint, brightness)
  if (!desired) return asset
  const adopted = own(content.appearance.variants, desired.id)
  if (!adopted || !equalCompositionValueV6(adopted, desired) || !own(content.document.assets, adopted.outputAssetId)) throw new Error(`外观派生位图尚未完整采用：${desired.id}。`)
  return adopted.outputAssetId
}
/** Requires actual adopted variant assets; this never generates or guesses resource bytes. */
export function resolveAppearanceV6(input: CompositionContentV6): CompositionContentV6 {
  const content = structuredClone(input), document = content.document, fixedRoots = retainSourceAssets(content)
  for (const [id, sourceId] of Object.entries(content.appearance.propSources)) {
    const source = content.appearance.sources[sourceId], prop = own(document.props, id)
    if (!prop || source?.kind !== 'prop') throw new Error(`物件外观映射悬空：${id}。`)
    const snapshot = propAppearanceSnapshotV6(source.snapshot), adjustments = effectiveAdjustmentsV6(content, id)
    if (snapshot.appearance.kind === 'image') {
      snapshot.appearance.assetId = resolvedAsset(content, snapshot.appearance.assetId, 'tint' in adjustments ? adjustments.tint as string | null : snapshot.appearance.tint, adjustments.brightness as number ?? 1)
      snapshot.appearance.tint = null
    }
    if ('opacity' in adjustments) snapshot.appearance.opacity = adjustments.opacity as number
    if ('shadowClass' in adjustments) snapshot.shadowClass = adjustments.shadowClass as PropV2['shadowClass']
    retainPropAsset(document, snapshot, fixedRoots)
    Object.assign(prop, snapshot)
  }
  for (const [id, sourceId] of Object.entries(content.appearance.surfaceSources)) {
    const source = content.appearance.sources[sourceId]
    if (source?.kind !== 'surface') throw new Error(`表面外观映射悬空：${id}。`)
    const style = structuredClone(source.snapshot), adjustments = effectiveAdjustmentsV6(content, id)
    const resolvePaint = (paint: MaterialPaint) => {
      const material = document.materials[paint.materialRef.id], tint = 'tint' in adjustments ? adjustments.tint as string | null : paint.tint, brightness = adjustments.brightness as number ?? 1
      const outputAssetId = resolvedAsset(content, material.textureAssetId, tint, brightness)
      if (outputAssetId !== material.textureAssetId) {
        const derivedId = `composition-material-${sha256TextV2(canonicalJsonV6({ materialRef: paint.materialRef, tint: tint?.toUpperCase() ?? null, brightness }))}`
        const derived = { ...structuredClone(material), id: derivedId, catalogId: derivedId, version: 1, textureAssetId: outputAssetId }
        if (own(document.materials, derivedId) && !equalCompositionValueV6(document.materials[derivedId], derived)) throw new Error('固定派生材质 ID 内容冲突。')
        document.materials[derivedId] = derived; paint.materialRef = { id: derivedId, version: 1 }
      }
      paint.tint = null
      if ('opacity' in adjustments) paint.opacity = adjustments.opacity as number
    }
    resolvePaint(style.base); style.overlays.forEach(overlay => resolvePaint(overlay.paint)); setSurfaceStyleV6(document, id, style)
  }
  return content
}

/** Freeze historical effective pixels/fields as one target's fixed source, with neutral field overrides that isolate current layer rules. */
export function freezeEffectivePropAppearanceV6(input: CompositionContentV6, id: string, historicalProp: PropV2): CompositionContentV6 {
  const content = structuredClone(input), graph = content.appearance
  if (!own(content.document.props, id)) throw new Error('冻结外观的目标不存在。')
  graph.propSources[id] = addPropAppearanceSourceV6(graph, historicalProp, graph.propSources[id] ?? null)
  const values: AppearanceAdjustmentV6[] = [
    { id: `frozen-opacity-${sha256TextV2(id)}`, kind: 'opacity', value: historicalProp.appearance.opacity, enabled: true },
    { id: `frozen-shadow-${sha256TextV2(id)}`, kind: 'shadowClass', value: historicalProp.shadowClass, enabled: true },
  ]
  if (historicalProp.appearance.kind === 'image') values.push({ id: `frozen-tint-${sha256TextV2(id)}`, kind: 'tint', value: historicalProp.appearance.tint, enabled: true }, { id: `frozen-brightness-${sha256TextV2(id)}`, kind: 'brightness', value: 1, enabled: true })
  graph.instanceAdjustments[id] = values
  return content
}

export function freezeEffectiveSurfaceAppearanceV6(input: CompositionContentV6, id: string, historicalStyle: SurfaceStyle): CompositionContentV6 {
  const content = structuredClone(input), current = surfaceStyleV6(content.document, id)
  if (!current) throw new Error('恢复表面必须已具有可编辑材质。')
  if (current.overlays.length !== historicalStyle.overlays.length || current.overlays.some(overlay => !historicalStyle.overlays.some(item => item.id === overlay.id))) throw new Error('表面覆盖拓扑不同，不能隐式新增或删除覆盖。')
  const style = structuredClone(current)
  const restorePaint = (target: MaterialPaint, historic: MaterialPaint) => { target.materialRef = structuredClone(historic.materialRef); target.tint = historic.tint; target.opacity = historic.opacity }
  restorePaint(style.base, historicalStyle.base)
  for (const overlay of style.overlays) restorePaint(overlay.paint, historicalStyle.overlays.find(item => item.id === overlay.id)!.paint)
  const opacities = [style.base.opacity, ...style.overlays.map(overlay => overlay.paint.opacity)], sameOpacity = opacities.every(value => value === opacities[0])
  const layerOpacity = (content.appearance.layerAdjustments[content.document.entityLayers[id]] ?? []).some(adjustment => adjustment.enabled && adjustment.kind === 'opacity')
  if (!sameOpacity && layerOpacity) throw new Error('当前层透明度覆盖下，单字段实例覆盖不能精确恢复不同底材/局部透明度；请选择保留当前层的源/参数模式。')
  content.appearance.surfaceSources[id] = addSurfaceAppearanceSourceV6(content.appearance, style, content.appearance.surfaceSources[id] ?? null)
  content.appearance.instanceAdjustments[id] = [
    { id: `frozen-tint-${sha256TextV2(id)}`, kind: 'tint', value: null, enabled: true },
    { id: `frozen-brightness-${sha256TextV2(id)}`, kind: 'brightness', value: 1, enabled: true },
    ...(sameOpacity ? [{ id: `frozen-opacity-${sha256TextV2(id)}`, kind: 'opacity' as const, value: opacities[0], enabled: true }] : []),
  ]
  return content
}
