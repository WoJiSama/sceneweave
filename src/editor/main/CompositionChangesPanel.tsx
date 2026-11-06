import { visualBase } from '../../shared/visual/base.js'
import { terrainRecordChanges } from '../../shared/terrain-generation/review.js'
import { useEffect, useMemo, useState } from 'react'
import { DECORATION_COLLECTIONS, LAYER_ENTITY_COLLECTIONS, SURFACE_RULE_COLLECTIONS } from '../../shared/model/scene'
import { VISUAL_ENTITY_COLLECTIONS } from '../../shared/visual/diagnostics'
import { inspectAppearanceScope } from '../../shared/appearance/graph'
import { MANUAL_TRANSACTION_BUDGET, type CommandBudgetUsage, type ManualTransactionBudget } from '../../shared/budget/command-budget'
import type { CompositionCommand } from '../../shared/model/appearance'
import type { EditableProject } from '../../application/workspace/project'
import type { AggregateEditBoundaryImpact } from '../../application/workspace/aggregate-boundary'
import { createEntityLabeler } from './entity-label'
const fields: Record<string, string> = { layerId: '所属图层', name: '名称', order: '图层顺序', floorId: '所在楼层', purpose: '房间名称', positionMm: '位置', rotationDeg: '角度', appearance: '有效图像与透明度', definitionRef: '固定定义版本', visualBoundsMm: '图像范围', shadowClass: '阴影类别', shadowOverride: '阴影参数', footprintMm: '物理占地', supportRef: '支撑表面', members: '成员映射及人工记录', anchorMm: '组合锚点', visibility: '可见范围', editLocked: '编辑锁', floorStyle: '地面铺装', surfaceStyle: '表面铺装', topStyle: '墙顶铺装', boundaryVertexIds: '房间边界', offsetMm: '开口偏移', widthMm: '净宽', startVertexId: '墙起点', endVertexId: '墙终点', xMm: 'X', yMm: 'Y', thicknessMm: '墙厚' }
function AdoptedImage({ project, hash, name }: { project: EditableProject; hash: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let active = true, created: string | undefined; setUrl(null); void project.resources.read(hash).then(bytes => { if (!active) return; created = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: project.assets[hash].mimeType })); setUrl(created) }).catch(() => {}); return () => { active = false; if (created) URL.revokeObjectURL(created) } }, [project.resources, hash])
  return url ? <img className="composition-import-preview" src={url} alt={`待入库素材预览 ${name}`}/> : null
}
const label = (value: unknown): string => value == null ? '无' : typeof value === 'boolean' ? value ? '是' : '否' : value === 'gm' ? '仅主持人' : value === 'public' ? '公开' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const terrainCollectionNames: Record<string, string> = {
  'generation.recipes': '地形配方', 'generation.intents': '制作要求', 'generation.rules': '地形联动规则',
  'generation.ownership': '自动与手工编辑记录', 'generation.exclusions': '保留与排除范围',
  'generation.strokes': '地形笔画', 'generation.version': '地形记录版本',
  'generation.constraints': '地形要求', 'generation.checks': '要求检查', 'generation.sourceLinks': '区域来源',
  'regional.areas': '区域地貌', 'regional.lines': '区域河流与路线', 'regional.landmarks': '区域地标',
  'regional.symbols': '地图图符', 'regional.symbolDefinitions': '固定图符定义', 'regional.profile': '区域地图样式',
  'visual.materializedEdges': '地形边缘细节',
  'visual3.transitions': '地形过渡',
  'generation.surroundings': '外围调整', 'generation.topology': '地形拓扑',
  'generation5.features': '地貌特征', 'generation5.compositions': '地貌组合', 'generation5.requirements': '地貌要求',
  'generation5.checks': '地貌检查', 'generation5.thresholds': '地貌边界', 'generation5.dependencies': '地貌依赖',
}
const terrainFieldNames: Record<string, string> = { state: '管理状态', managedFields: '自动管理字段', manualFields: '手工保留字段',
  parameters: '规则参数', inputHash: '输入校验', managedOutputHash: '输出校验', issues: '检查结果', boundaryMm: '范围轮廓',
  pointsMm: '线路坐标', polygons: '边缘面', strokes: '边缘线条', fillColor: '填充颜色', opacity: '透明度',
  inherited: '继承内容', sourceContentHash: '来源原图校验', publicInputHash: '公开输入校验', symbolScale: '图符比例',
  sourceRef: '来源要素', style: '外观样式', reason: '保留原因' }
const collectionNames: Record<string, string> = { userLayers: '图层', vertices: '建筑顶点', rooms: '房间', walls: '墙体', openings: '门窗', props: '物件', regions: '区域', notes: '注记', terrainAreas: '地形', terrainEdges: '地形边缘', terrainConnections: '高差连接', paths: '道路', prefabInstances: '组合', scatterGroups: '散布', decorations: '装饰', decorationClusters: '簇状布景', surfaceRules: '地表规则', 'visual.boundaries': '边界曲线', 'visual.edgeLooks': '边带效果', 'visual.lights': '灯光', 'visual.fogs': '区域雾', 'visual.filters': '滤镜', 'visual.environment': '环境' }
const summaryOrder = ['rooms', 'props', 'terrainAreas', 'openings', 'walls', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups', 'decorations', 'decorationClusters', 'regions', 'notes', 'surfaceRules', 'visual.lights', 'visual.fogs', 'visual.filters', 'visual.environment', 'visual.boundaries', 'visual.edgeLooks']
const summaryUnits: Record<string, string> = { rooms: '间', props: '件', terrainAreas: '处', openings: '处', walls: '面', terrainConnections: '处', paths: '条', prefabInstances: '组', scatterGroups: '组', decorations: '件', decorationClusters: '组', regions: '处', notes: '条', 'visual.lights': '盏', 'visual.fogs': '处', 'visual.filters': '个', 'visual.boundaries': '条' }
export default function CompositionChangesPanel({ current, candidate, commands, budgetUsage, budgetProfile = MANUAL_TRANSACTION_BUDGET, aggregateBoundaryImpact }: { current: EditableProject; candidate: EditableProject; commands: readonly CompositionCommand[]; budgetUsage?: CommandBudgetUsage; budgetProfile?: ManualTransactionBudget; aggregateBoundaryImpact?: AggregateEditBoundaryImpact }) {
  const currentName = useMemo(() => createEntityLabeler(current.document), [current.document])
  const candidateName = useMemo(() => createEntityLabeler(candidate.document), [candidate.document])
  const nearbyIds = aggregateBoundaryImpact ? [...new Set(aggregateBoundaryImpact.groups.flatMap(group => [...group.externalCandidates.previous, ...group.externalCandidates.next])
    .filter(row => row.entity.kind !== 'floor').map(row => row.entity.id))] : []
  const dependencyIds = aggregateBoundaryImpact ? [...new Set(aggregateBoundaryImpact.dependencyClosure.affected
    .filter(ref => ref.kind !== 'floor' && !aggregateBoundaryImpact.dependencyClosure.roots.some(root => root.kind === ref.kind && root.id === ref.id)).map(ref => ref.id))] : []
  const changes = useMemo(() => {
    const currentVisual = visualBase(current.document), candidateVisual = visualBase(candidate.document)
    const records = [...[...LAYER_ENTITY_COLLECTIONS, ...DECORATION_COLLECTIONS, ...SURFACE_RULE_COLLECTIONS].map(collection => ({ collection: String(collection), before: current.document[collection] ?? {}, after: candidate.document[collection] ?? {} })),
      ...VISUAL_ENTITY_COLLECTIONS.map(collection => ({ collection: `visual.${collection}`, before: currentVisual?.[collection] ?? {}, after: candidateVisual?.[collection] ?? {} })),
      { collection: 'userLayers', before: current.document.userLayers, after: candidate.document.userLayers },
      { collection: 'visual.environment', before: currentVisual ? { 'visual-environment': currentVisual.environment } : {}, after: candidateVisual ? { 'visual-environment': candidateVisual.environment } : {} }]
    return records.flatMap(({ collection, before: a, after: b }) => [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(id => {
    const withLayer = (record: unknown, layerId: string | undefined): Record<string, unknown> | undefined => record ? { ...(record as Record<string, unknown>), ...(layerId ? { layerId } : {}) } : undefined
    const before = withLayer((a as Record<string, unknown>)[id], current.document.entityLayers[id]), after = withLayer((b as Record<string, unknown>)[id], candidate.document.entityLayers[id])
    if (JSON.stringify(before) === JSON.stringify(after)) return []
    const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    return [{ id, collection, before, after, keys }]
  })) }, [current, candidate])
  const terrainChanges = useMemo(() => terrainRecordChanges(current.document, candidate.document), [current, candidate])
  const aggregateChanges = useMemo(() => {
    const before = current.document.aggregateCoordinates?.groups ?? {}, after = candidate.document.aggregateCoordinates?.groups ?? {}
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => JSON.stringify(before[id]) !== JSON.stringify(after[id]))
      .map(id => ({ id, before: before[id], after: after[id] }))
  }, [current, candidate])
  const scopes = useMemo(() => commands.flatMap(command => {
    if (!['setAppearanceAdjustment', 'toggleAppearanceAdjustment', 'removeAppearanceAdjustment'].includes(command.type)) return []
    if (!('scope' in command)) return []
    let kind = 'adjustment' in command ? command.adjustment.kind : undefined
    if (!kind && 'adjustmentId' in command) { const records = command.scope.kind === 'layer' ? current.appearance.layerAdjustments[command.scope.layerId] ?? [] : command.scope.ids.flatMap(id => current.appearance.instanceAdjustments[id] ?? []); kind = records.find(item => item.id === command.adjustmentId)?.kind }
    try { return [{ scope: command.scope, plan: inspectAppearanceScope(current, command.scope, kind ? [kind] : undefined, budgetProfile) }] } catch { return [] }
  }), [current, commands, budgetProfile])
  const addedDefinitions = Object.keys(candidate.document.propDefinitions).filter(id => !current.document.propDefinitions[id]).length + Object.keys(candidate.document.materials).filter(id => !current.document.materials[id]).length + Object.keys(candidate.document.prefabDefinitions).filter(id => !current.document.prefabDefinitions[id]).length
  const addedAssets = Object.keys(candidate.assets).filter(hash => !current.assets[hash]).length
  const newPrefabs = Object.values(candidate.document.prefabDefinitions).filter(item => !current.document.prefabDefinitions[item.id])
  const newSources = Object.keys(candidate.appearance.sources).filter(id => !current.appearance.sources[id]).length
  const newVariants = Object.keys(candidate.appearance.variants).filter(id => !current.appearance.variants[id]).length
  const newLicenses = Object.keys(candidate.licenses).filter(hash => !current.licenses[hash]).length
  const newDefinitions = [...Object.values(candidate.document.propDefinitions).filter(item => !current.document.propDefinitions[item.id] && !item.tags.includes('sceneweave:retained-appearance')).map(item => ({ id: item.id, name: item.name, assetId: item.defaultAppearance.kind === 'image' ? item.defaultAppearance.assetId : null, size: `${item.defaultVisualBoundsMm.width} × ${item.defaultVisualBoundsMm.height} mm`, origin: item.origin.attribution, license: item.licenseRef })), ...Object.values(candidate.document.materials).filter(item => !current.document.materials[item.id] && !item.id.startsWith('composition-material-')).map(item => ({ id: item.id, name: item.name, assetId: item.textureAssetId, size: `${item.defaultTileSizeMm.width} × ${item.defaultTileSizeMm.height} mm`, origin: item.origin.attribution, license: item.licenseRef }))]
  const newlyPublic = changes.filter(change => change.after?.visibility === 'public' && change.before?.visibility !== 'public').length
    + terrainChanges.filter(change => ['regional.areas', 'regional.lines', 'regional.landmarks', 'regional.symbols', 'visual.materializedEdges'].includes(change.collection)
      && (change.after as { visibility?: string } | null)?.visibility === 'public' && (change.before as { visibility?: string } | null)?.visibility !== 'public').length
  const displayChanged = JSON.stringify(current.document.units) !== JSON.stringify(candidate.document.units) || JSON.stringify(current.document.presetSnapshot) !== JSON.stringify(candidate.document.presetSnapshot)
  const actionName = (before: unknown, after: unknown) => before == null ? '新增' : after == null ? '删除' : '更新'
  const layerChanges = changes.filter(change => change.collection === 'userLayers')
  const objectChanges = changes.filter(change => !['vertices', 'terrainEdges', 'userLayers'].includes(change.collection)).sort((a, b) => summaryOrder.indexOf(a.collection) - summaryOrder.indexOf(b.collection))
  const geometryCount = changes.length - objectChanges.length - layerChanges.length
  const summary = ['新增', '更新', '删除'].flatMap(action => {
    const counts = new Map<string, number>()
    for (const change of objectChanges) if (actionName(change.before, change.after) === action) counts.set(change.collection, (counts.get(change.collection) ?? 0) + 1)
    return counts.size ? [`${action}${[...counts].map(([collection, count]) => `${count}${summaryUnits[collection] ?? '项'}${collectionNames[collection] ?? '对象'}`).join('、')}`] : []
  })
  if (layerChanges.length) summary.push(`调整${layerChanges.length}个图层`)
  if (addedDefinitions > 0) summary.push(`添加${addedDefinitions}项素材`)
  if (displayChanged) summary.push('更新显示设置')
  if (aggregateChanges.length) summary.push(`调整${aggregateChanges.length}个分组`)
  if (!summary.length && scopes.length) summary.push('调整所选范围的外观')
  if (!summary.length && terrainChanges.length) summary.push('调整地形规则与记录')
  if (!summary.length && geometryCount) summary.push('调整建筑或地形轮廓')
  const namedChanges = objectChanges.some(change => change.collection !== 'walls') ? objectChanges.filter(change => change.collection !== 'walls') : objectChanges
  const changeSummary = namedChanges.slice(0, 3).map(change => `${actionName(change.before, change.after)}${collectionNames[change.collection] ?? '对象'}「${(change.after ? candidateName : currentName)(change.id)}」`)
  return <section aria-label="修改内容摘要">{summary.length > 0 && <p>{summary.join('；')}。</p>}
    {aggregateChanges.length > 0 && <div aria-label="分组变化">{aggregateChanges.map(change => <p key={change.id}>{change.before ? change.after ? '更新分组位置或归属' : '解除分组' : '创建分组'} · {(change.after ?? change.before).members.length} 个直接成员。成员仍可单独编辑，整体操作按完整关联范围检查。</p>)}</div>}
    {changeSummary.length > 0 && <p>{changeSummary.join('；')}{namedChanges.length > 3 ? '；其余对象见完整变化。' : '。'}</p>}
    {newlyPublic > 0 && <p role="alert" className="history-limit">其中 {newlyPublic} 个对象将新增公开内容，请核对可见范围。</p>}
    {aggregateBoundaryImpact && <details aria-label="位置关联检查"><summary>位置附近与关联对象</summary>
      <p>本次涉及 {aggregateBoundaryImpact.groups.length} 个组。原位置及新位置附近有 {nearbyIds.length} 个组外对象{nearbyIds.length ? `：${nearbyIds.slice(0, 8).map(id => candidateName(id) === id ? currentName(id) : candidateName(id)).join('、')}${nearbyIds.length > 8 ? '等' : ''}` : ''}。</p>
      <p>另有 {dependencyIds.length} 个关联对象{dependencyIds.length ? `：${dependencyIds.slice(0, 8).map(id => candidateName(id) === id ? currentName(id) : candidateName(id)).join('、')}${dependencyIds.length > 8 ? '等' : ''}` : ''}。附近对象不一定阻挡移动；支撑、通行与编辑锁按本次实际修改检查。</p>
      {aggregateBoundaryImpact.requiresSceneWideFallback && <p>部分关联内容需结合全图检查，已保留完整校验。</p>}
    </details>}
    <details className="composition-preview-details" open={newDefinitions.length > 0 || newPrefabs.length > 0 || displayChanged}><summary>核对实际变化 · {objectChanges.length} 个场景对象{layerChanges.length > 0 ? ` · ${layerChanges.length} 个图层` : ''}{geometryCount > 0 ? ` · ${geometryCount} 项顶点与边缘记录` : ''}{terrainChanges.length > 0 ? ` · ${terrainChanges.length} 项地形记录` : ''}{addedDefinitions > 0 ? ` · ${addedDefinitions} 项新素材` : ''}{addedAssets > 0 ? ` · ${addedAssets} 份新位图` : ''}</summary>
    {budgetUsage && <details aria-label="普通事务保护详情"><summary>事务保护详情</summary><dl className="asset-facts">
      <dt>编辑目标</dt><dd>{budgetUsage.semanticTargets} / {budgetProfile.semanticTargets}</dd>
      {budgetUsage.groupMembers !== undefined && <><dt>组内影响</dt><dd>{budgetUsage.groupMembers} / {budgetProfile.groupMemberLimit}</dd></>}
      {budgetUsage.externalDependencies !== undefined && <><dt>组外依赖</dt><dd>{budgetUsage.externalDependencies}</dd></>}
      <dt>几何点 / 段</dt><dd>{budgetUsage.geometryPoints} / {budgetProfile.limits.geometryPoints} · {budgetUsage.geometrySegments} / {budgetProfile.limits.geometrySegments}</dd><dt>依赖引用</dt><dd>{budgetUsage.dependencyRefs} / {budgetProfile.limits.dependencyRefs}</dd><dt>内部记录</dt><dd>{budgetUsage.metadataRecords} / {budgetProfile.limits.metadataRecords}</dd><dt>资源字节 / 解码像素</dt><dd>{budgetUsage.assetBytes} / {budgetProfile.limits.assetBytes} · {budgetUsage.decodePixels} / {budgetProfile.limits.decodePixels}</dd>
    </dl>{budgetUsage.groupMembers !== undefined && budgetUsage.groupMembers > 0 && <p>保持成员相对位置的整体平移或旋转按组核心计编辑目标，组内成员与组外依赖仍完整检查。</p>}<p>各项分别检查，不折算为同一种编辑次数；锁、支撑与完整资源校验继续执行。</p></details>}
    {(newSources > 0 || newVariants > 0 || newLicenses > 0) && <p>完整依赖：{newSources} 个固定外观来源 · {newVariants} 份位图派生 · {newLicenses} 份许可文本。仅采用素材不会自动放置场景对象。</p>}
    {newPrefabs.map(item => { const template = candidate.appearance.prefabAppearanceTemplates[item.id], binding = candidate.licenseBindings.find(value => value.subjectKind === 'prefabDefinition' && value.subjectId === item.id), license = binding && candidate.licenses[binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, '')]; return <article className="composition-diff-item" key={item.id}><h3>{item.name}</h3><p>组合 · {item.members.length} 个固定成员 · {template.visibility === 'gm' ? '仅主持人' : '公开'}</p><p>{item.origin.attribution} · {item.licenseRef}</p>{template.visibility === 'gm' && <p>放置此组合仍须满足主持人内容的遮罩与支撑检查。</p>}{license && <details><summary>待采用组合许可</summary><p>固定版本：v{item.version} · {item.id}</p><pre>{license.text}</pre></details>}</article> })}
    {displayChanged && <article className="composition-diff-item" aria-label="显示设置变化"><strong>显示设置 · 场景毫米尺寸保持</strong><dl><div><dt>单位</dt><dd>{current.document.units.display} → {candidate.document.units.display}</dd></div><div><dt>距离习惯</dt><dd>{current.document.presetSnapshot.distanceMode} → {candidate.document.presetSnapshot.distanceMode}</dd></div><div><dt>格距</dt><dd>{current.document.units.gridSizeMm} → {candidate.document.units.gridSizeMm} mm</dd></div><div><dt>吸附</dt><dd>{current.document.units.snapMm} → {candidate.document.units.snapMm} mm</dd></div><div><dt>显示格线</dt><dd>{label(current.document.units.gridVisible)} → {label(candidate.document.units.gridVisible)}</dd></div></dl></article>}
    {newDefinitions.map(item => { const asset = item.assetId && candidate.document.assets[item.assetId], record = asset && candidate.assets[asset.sha256], binding = candidate.licenseBindings.find(binding => binding.subjectId === item.id), license = binding && candidate.licenses[binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, '')]; return <article className="composition-diff-item" key={item.id}><h3>{item.name}</h3>{record && <AdoptedImage project={candidate} hash={record.sha256} name={item.name}/>}<p>{item.size} · {item.origin}</p><p>许可：{item.license}</p>{license && <details><summary>待采用完整许可</summary><pre>{license.text}</pre></details>}</article> })}
    {scopes.map(({ scope, plan }, index) => <div key={index}><p>{scope.kind === 'layer' ? `持续作用于图层：${currentName(scope.layerId)}` : '本次所选对象'} · {plan.targetIds.length} 个适用目标</p><p>不适用 {plan.inapplicableIds.length} 项</p><details><summary>完整影响范围与 ID</summary><p>适用目标与只读依赖分别列出；实际编辑对象以完整候选核对。</p><textarea readOnly aria-label="外观完整影响范围" rows={5} value={[...plan.targetIds.map(id => `调整 · ${currentName(id)} · ${id}`), ...plan.affectedIds.filter(id => !plan.targetIds.includes(id)).map(id => `关系与依赖 · ${currentName(id)} · ${id}`), ...plan.inapplicableIds.map(id => `不适用 · ${currentName(id)} · ${id}`)].join('\n')}/></details></div>)}
    {changes.map(change => <article key={`${change.collection}-${change.id}`} className="composition-diff-item"><strong>{actionName(change.before, change.after)}{collectionNames[change.collection] ?? '对象'} · {(change.after ? candidateName : currentName)(change.id)}</strong>{change.collection !== 'userLayers' && <p>图层：{current.document.userLayers[(change.before?.layerId as string) ?? current.document.entityLayers[change.id]]?.name ?? '全图或无'} → {candidate.document.userLayers[(change.after?.layerId as string) ?? candidate.document.entityLayers[change.id]]?.name ?? '全图或无'}</p>}{change.before && change.after && <p>修改：{change.keys.map(key => fields[key]).filter(Boolean).join('、') || '对象设置'}</p>}<details><summary>字段与 ID 详情</summary><p>对象 ID：{change.id} · {change.collection}</p><dl>{change.keys.map(key => <div key={key}><dt>{fields[key] ?? key}</dt><dd>{key === 'layerId' ? current.document.userLayers[change.before?.[key] as string]?.name ?? '全图或无' : label(change.before?.[key])} → {key === 'layerId' ? candidate.document.userLayers[change.after?.[key] as string]?.name ?? '全图或无' : label(change.after?.[key])}</dd></div>)}</dl></details></article>)}
    {terrainChanges.map(change => {
      const before = change.before as Record<string, unknown> | null, after = change.after as Record<string, unknown> | null
      return <article key={`${change.collection}-${change.id}`} className="composition-diff-item" aria-label={`${terrainCollectionNames[change.collection] ?? '地形记录'}变化`}>
        <strong>{actionName(before, after)} · {terrainCollectionNames[change.collection] ?? '地形记录'}{(after ? candidateName : currentName)(change.id) !== change.id ? ` · ${(after ? candidateName : currentName)(change.id)}` : ''}</strong>
        <p>{change.fields.map(key => terrainFieldNames[key] ?? fields[key]).filter(Boolean).join('、') || '关联记录与设置'}</p>
        <details><summary>字段与 ID 详情</summary><p>记录：{change.id} · {change.collection}</p><dl>{change.fields.map(key => <div key={key}><dt>{terrainFieldNames[key] ?? fields[key] ?? key}</dt><dd>{label(before?.[key])} → {label(after?.[key])}</dd></div>)}</dl></details>
      </article>
    })}
    {scopes.length > 0 && <p>规则来源、独立开关及实际位图一同保存。采用时重新检查完整范围和编辑锁。</p>}
  </details></section>
}
