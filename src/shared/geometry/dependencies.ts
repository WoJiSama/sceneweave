import type { Appearance, DefinitionIdentity, Editable, Issue, SceneDocument, SurfaceRef, SurfaceStyle, VersionRef } from '../model/scene.js'

export type LicenseSubject = { subjectKind: 'asset' | 'material' | 'propDefinition' | 'prefabDefinition' | 'styleTheme' | 'regionalSymbolDefinition'; subjectId: string; licenseRef: string }
const own = <T>(record: Record<string, T>, id: string): T | undefined => Object.hasOwn(record, id) ? record[id] : undefined
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

export interface DependencyIssue extends Issue { dependencyId?: string; expectedVersion?: number; actualVersion?: number }

/** Caller must first validate the document shape; this report also covers broken closures. */
export function inspectDependencies(scene: SceneDocument): { errors: DependencyIssue[]; assetIds: string[]; subjects: LicenseSubject[] } {
  const errors: DependencyIssue[] = [], assetIds = new Set<string>(), subjects: LicenseSubject[] = []
  const error = (code: string, message: string, entityId?: string, detail: Partial<DependencyIssue> = {}) => errors.push({ code, message, ...(entityId ? { entityId } : {}), ...detail })
  const seenIds = new Set<string>()
  const register = (id: string, key?: string) => {
    if (key !== undefined && id !== key) error('ID_KEY_MISMATCH', '集合键必须等于快照/实体 id。', id)
    if (id === '__proto__') error('UNSAFE_KEY', '保留键不能用作 ID。', id)
    if (seenIds.has(id)) error('DUPLICATE_ID', '实体、定义与内嵌轮廓 ID 必须在整个工程中唯一。', id)
    seenIds.add(id)
  }
  const collections = ['floors', 'vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'assets', 'propDefinitions', 'materials', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabDefinitions', 'prefabInstances', 'scatterGroups', 'styleThemes'] as const
  for (const collection of collections) for (const [key, value] of Object.entries(scene[collection])) {
    register(value.id, key)
    if ('floorId' in value && !own(scene.floors, value.floorId)) error('MISSING_FLOOR', '实体所在 Floor 不存在。', value.id)
  }
  const definitions = ['materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const
  const definitionCount = definitions.reduce((sum, key) => sum + Object.keys(scene[key]).length, 0)
  if (definitionCount > 4096) error('DEFINITION_BUDGET', '定义快照总数不得超过 4096。')
  const entityCount = collections.filter(key => !definitions.includes(key as typeof definitions[number]) && key !== 'assets').reduce((sum, key) => sum + Object.keys(scene[key]).length, 0)
  if (entityCount > 10000) error('ENTITY_BUDGET', '展开后的实体总数不得超过 10000。')
  for (const area of Object.values(scene.terrainAreas)) for (const vertex of area.boundaryMm) { register(vertex.id); register(vertex.segmentId) }
  for (const check of scene.constraints.pathChecks) register(check.id)
  const checkVersion = <T extends DefinitionIdentity>(ref: VersionRef, record: Record<string, T>, owner: string): T | undefined => {
    const target = own(record, ref.id)
    if (!target) error('MISSING_DEFINITION', `定义快照 ${ref.id}@${ref.version} 不存在；请恢复该固定版本或采用可用定义。`, owner, { dependencyId: ref.id, expectedVersion: ref.version })
    else if (target.version !== ref.version) error('DEFINITION_VERSION', `定义 ${ref.id} 引用版本 ${ref.version} 与快照 ${target.version} 不同；请恢复引用的固定版本。`, owner, { dependencyId: ref.id, expectedVersion: ref.version, actualVersion: target.version })
    return target
  }
  const useAsset = (id: string, owner: string) => {
    if (!own(scene.assets, id)) error('MISSING_ASSET', `图片素材 ${id} 不存在；请恢复原素材或显式采用可用替代。完整工程不能用占位补齐。`, owner, { dependencyId: id })
    else assetIds.add(id)
  }
  const checkAppearance = (appearance: Appearance, definitionRef: VersionRef | null, owner: string) => {
    if (definitionRef) checkVersion(definitionRef, scene.propDefinitions, owner)
    if (appearance.kind === 'image') {
      useAsset(appearance.assetId, owner)
      if (!definitionRef) error('IMAGE_WITHOUT_DEFINITION', '图片物件必须采用固定版本物件定义。', owner)
    }
  }
  const surface = (ref: SurfaceRef, owner: Editable) => {
    const target = ref.kind === 'floor' ? own(scene.floors, ref.id) : ref.kind === 'terrainArea' ? own(scene.terrainAreas, ref.id) : own(scene.rooms, ref.id)
    if (!target) error('MISSING_SUPPORT', '支撑面引用不存在。', owner.id)
    else if (ref.kind === 'floor' ? target.id !== owner.floorId : ('floorId' in target && target.floorId !== owner.floorId)) error('CROSS_FLOOR_REFERENCE', '支撑面必须与实体同 Floor。', owner.id)
  }
  const checkStyle = (style: SurfaceStyle | null, kind: 'room' | 'wall' | 'terrain' | 'path', owner: string) => {
    if (!style) return
    if (style.base.opacity !== 1) error('TRANSLUCENT_BASE', '地面基础铺装必须不透明。', owner)
    for (const [index, paint] of [style.base, ...style.overlays.map(item => item.paint)].entries()) {
      const material = checkVersion(paint.materialRef, scene.materials, owner)
      if (material && !material.applicableSurfaces.includes(kind)) error('MATERIAL_SURFACE', `材质不适用于 ${kind} 表面（层 ${index}）。`, owner)
    }
    for (const item of style.overlays) register(item.id)
  }
  const semanticIdentities = new Map<string, string>()
  const adopted = (kind: LicenseSubject['subjectKind'], definition: DefinitionIdentity) => {
    subjects.push({ subjectKind: kind, subjectId: definition.id, licenseRef: definition.licenseRef })
    const key = `${kind}\0${definition.catalogId}\0${definition.version}`
    const { id: _id, ...content } = definition
    const value = canonical(content)
    if (semanticIdentities.has(key) && semanticIdentities.get(key) !== value) error('DEFINITION_IDENTITY_CONFLICT', '相同定义种类/catalogId/version 不能对应不同内容。', definition.id)
    semanticIdentities.set(key, value)
  }
  for (const definition of Object.values(scene.propDefinitions)) {
    adopted('propDefinition', definition)
    if (definition.defaultAppearance.kind === 'image') useAsset(definition.defaultAppearance.assetId, definition.id)
  }
  for (const material of Object.values(scene.materials)) { adopted('material', material); useAsset(material.textureAssetId, material.id) }
  for (const definition of Object.values(scene.prefabDefinitions)) {
    adopted('prefabDefinition', definition)
    if (new Set(definition.members.map(item => item.key)).size !== definition.members.length) error('DUPLICATE_TEMPLATE_KEY', '组合模板的子项 key 必须唯一。', definition.id)
    for (const member of definition.members) checkAppearance(member.propTemplate.appearance, member.propTemplate.definitionRef, definition.id)
  }
  if(scene.schemaVersion>=3 && scene.regional) for(const definition of Object.values(scene.regional.symbolDefinitions)) { adopted('regionalSymbolDefinition',definition); useAsset(definition.assetId,definition.id) }
  for (const theme of Object.values(scene.styleThemes)) {
    adopted('styleTheme', theme)
    for (const ref of theme.materialSuggestions) checkVersion(ref, scene.materials, theme.id)
    for (const ref of theme.propSuggestions) checkVersion(ref, scene.propDefinitions, theme.id)
    for (const ref of theme.prefabSuggestions) checkVersion(ref, scene.prefabDefinitions, theme.id)
  }
  if (scene.activeStyleThemeRef) checkVersion(scene.activeStyleThemeRef, scene.styleThemes, scene.sceneId)
  for (const room of Object.values(scene.rooms)) { surface(room.supportRef, room); checkStyle(room.floorStyle, 'room', room.id) }
  for (const wall of Object.values(scene.walls)) checkStyle(wall.topStyle, 'wall', wall.id)
  for (const area of Object.values(scene.terrainAreas)) checkStyle(area.surfaceStyle, 'terrain', area.id)
  for (const edge of Object.values(scene.terrainEdges)) checkStyle(edge.surfaceStyle, 'terrain', edge.id)
  for (const path of Object.values(scene.paths)) { for (const ref of path.supportRefs) surface(ref, path); checkStyle(path.surfaceStyle, 'path', path.id) }
  for (const connection of Object.values(scene.terrainConnections)) { surface(connection.from.surfaceRef, connection); surface(connection.to.surfaceRef, connection); checkStyle(connection.surfaceStyle, 'path', connection.id) }
  for (const prop of Object.values(scene.props)) {
    checkAppearance(prop.appearance, prop.definitionRef, prop.id); surface(prop.supportRef, prop)
    if (prop.roomId !== undefined) {
      const room = own(scene.rooms, prop.roomId)
      if (!room) error('MISSING_ROOM', '物件归属的 Room 不存在。', prop.id)
      else if (room.floorId !== prop.floorId) error('CROSS_FLOOR_REFERENCE', '物件归属 Room 必须同 Floor。', prop.id)
      if (prop.supportRef.kind === 'room' && prop.supportRef.id !== prop.roomId) error('ROOM_SUPPORT_MISMATCH', 'room 支撑与 roomId 必须指向相同 Room。', prop.id)
    }
  }
  const managedBy = new Map<string, string>()
  const member = (propId: string, owner: Editable) => {
    const prop = own(scene.props, propId)
    if (!prop) error('MISSING_MEMBER', '采用后的成员 Prop 不存在。', owner.id)
    else if (prop.floorId !== owner.floorId) error('CROSS_FLOOR_REFERENCE', '组与成员必须同 Floor。', owner.id)
    if (managedBy.has(propId)) error('DUPLICATE_MANAGEMENT', 'Prop 只能属于一个组合或散布组。', propId)
    managedBy.set(propId, owner.id)
  }
  for (const group of Object.values(scene.prefabInstances)) {
    const definition = checkVersion(group.definitionRef, scene.prefabDefinitions, group.id)
    if (definition) {
      const expected = new Set(definition.members.map(item => item.key))
      if (Object.keys(group.members).length !== expected.size || Object.keys(group.members).some(key => !expected.has(key))) error('PREFAB_MEMBER_KEYS', '组合实例必须保存模板的全部稳定子项键，删除项使用 null。', group.id)
    }
    for (const value of Object.values(group.members)) if (value.propId !== null) member(value.propId, group)
  }
  for (const group of Object.values(scene.scatterGroups)) {
    const domain = group.domain.kind === 'area' ? own(scene.terrainAreas, group.domain.areaId) : group.domain.kind === 'path' ? own(scene.paths, group.domain.pathId) : own(scene.terrainEdges, group.domain.edgeId)
    if (!domain) error('MISSING_SCATTER_DOMAIN', '散布域不存在。', group.id)
    else if (domain.floorId !== group.floorId) error('CROSS_FLOOR_REFERENCE', '散布域必须与散布组同 Floor。', group.id)
    if (new Set(group.palette.map(item => item.key)).size !== group.palette.length) error('DUPLICATE_PALETTE_KEY', '散布 palette key 不能重复。', group.id)
    for (const item of group.palette) checkVersion(item.propDefinitionRef, scene.propDefinitions, group.id)
    let active = 0, suppressed = 0
    for (const [key, value] of Object.entries(group.members)) {
      if (value.state === 'managed' || value.state === 'manual') {
        active++
        if (value.propId === null) error('MISSING_MEMBER', 'managed/manual 散布成员必须保存真实 Prop。', group.id)
        else {
          member(value.propId, group)
          const prop = own(scene.props, value.propId)
          if (prop && value.state === 'managed' && !group.palette.some(item => item.propDefinitionRef.id === prop.definitionRef?.id && item.propDefinitionRef.version === prop.definitionRef.version)) error('SCATTER_PALETTE', 'managed 成员必须采用当前 palette 中的固定定义。', prop.id)
        }
      } else {
        suppressed++
        if (value.propId !== null) error('SUPPRESSED_MEMBER', 'deleted/detached 只保存永久抑制记录，propId 必须为 null。', group.id)
        if (value.state === 'deleted' && !group.exclusions.some(item => item.reason === 'delete' && item.sourceCandidateKey === key)) error('MISSING_DELETE_EXCLUSION', '删除散布成员必须保留对应世界排除区。', group.id)
      }
    }
    for (const exclusion of group.exclusions) {
      register(exclusion.id)
      if (exclusion.reason === 'delete' && (exclusion.sourceCandidateKey === null || own(group.members, exclusion.sourceCandidateKey)?.state !== 'deleted')) error('INVALID_DELETE_EXCLUSION', '删除排除区必须对应 deleted 成员的稳定 candidateKey。', group.id)
    }
    if (active > 5000 || suppressed + group.exclusions.length > 10000) error('SCATTER_BUDGET', '散布组超过 5000 活成员或 10000 抑制/排除记录。', group.id)
  }
  for (const [id, asset] of Object.entries(scene.assets)) {
    if (!assetIds.has(id)) error('UNUSED_ASSET', '未被已采用场景或定义引用的资源不能进入正式工程。', id)
    else subjects.push({ subjectKind: 'asset', subjectId: id, licenseRef: asset.licenseRef })
  }
  return { errors, assetIds: [...assetIds].sort(), subjects: subjects.sort((a, b) => a.subjectKind.localeCompare(b.subjectKind) || a.subjectId.localeCompare(b.subjectId)) }
}

export const validateDependencies = (scene: SceneDocument): DependencyIssue[] => inspectDependencies(scene).errors

/** Adopted definitions are editing roots even when no current scene instance uses them. */
export function collectDependencies(scene: SceneDocument): { assetIds: string[]; subjects: LicenseSubject[] } {
  const result = inspectDependencies(scene)
  if (result.errors.length) throw new Error(result.errors.map(issue => `${issue.code}: ${issue.message}`).join('\n'))
  return { assetIds: result.assetIds, subjects: result.subjects }
}
