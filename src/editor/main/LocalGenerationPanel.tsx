import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { GenerationRecipe } from '../../shared/terrain-generation/contracts'
import { getLegacyGeneration } from '../../shared/terrain-generation/composition-contracts'
import { localGenerationRequestSchema, type LocalGenerationRequest } from '../../shared/generation/local'
import { volcanoEntityId } from '../../shared/generation/domains/volcano/index'
import type { LocalGenerationPreview } from '../../application/workspace/workspace'
import './terrain-generation.css'
import './local-generation.css'

type DomainRecipe = Extract<GenerationRecipe, { domain: 'interior' | 'forest' | 'volcano' }>
type Operation = LocalGenerationRequest['operation']
const operationLabels: Record<Operation, string> = { 'interior-furniture': '房间家具摆位', 'forest-density': '林区植被密度', 'volcano-material': '火山表面材质', 'volcano-boundary': '火口轮廓调整' }
const names = { interior: '室内', forest: '森林', volcano: '火山' }
const coordinates = (points: readonly { x: number; y: number }[]) => points.map(point => `${point.x}, ${point.y}`).join('\n')

export default function LocalGenerationPanel({ document, busy, disabled, dirty, error, candidate, onChange, onPreview, onAdopt, onCancel }: {
  document: SceneDocument; busy: boolean; disabled: boolean; dirty: boolean; error: string | null; candidate: LocalGenerationPreview | null
  onChange: () => void; onPreview: (request: LocalGenerationRequest) => void | Promise<void>; onAdopt: () => void | Promise<void>; onCancel: () => void
}) {
  const gen = getLegacyGeneration(document)
  const recipes = Object.values(gen?.recipes ?? {}).filter((recipe): recipe is DomainRecipe => 'domain' in recipe && recipe.domain !== 'mixed')
  const [recipeId, setRecipeId] = useState(''), [operation, setOperation] = useState<Operation>('volcano-boundary'), [targetId, setTargetId] = useState('')
  const [variation, setVariation] = useState('local-1'), [coverage, setCoverage] = useState(3), [role, setRole] = useState<'tree' | 'shrub' | 'grass'>('tree')
  const [materialId, setMaterialId] = useState(''), [expansion, setExpansion] = useState(0), [positions, setPositions] = useState<string | null>(null)
  const recipe = recipes.find(row => row.id === recipeId) ?? recipes[0], locked = disabled || busy
  const operations: Operation[] = !recipe ? [] : recipe.domain === 'interior' ? ['interior-furniture'] : recipe.domain === 'forest' ? ['forest-density'] : ['volcano-boundary', 'volcano-material']
  const selectedOperation = operations.includes(operation) ? operation : operations[0]
  const owners = Object.values(gen?.ownership ?? {}).filter(owner => gen?.rules[owner.ruleId]?.recipeRef.id === recipe?.id && !['deleted', 'detached'].includes(owner.state))
  const targets = recipe?.domain === 'forest' ? recipe.parameters.zones.map(zone => ({ id: zone.id, label: zone.id }))
    : selectedOperation === 'interior-furniture' ? owners.filter(owner => owner.target.kind === 'room' && document.rooms[owner.target.entityId]).map(owner => ({ id: owner.target.entityId, label: document.rooms[owner.target.entityId].purpose + ' · ' + owner.target.entityId }))
      : owners.filter(owner => owner.target.kind === 'terrainArea' && document.terrainAreas[owner.target.entityId]
        && (selectedOperation !== 'volcano-boundary' || owner.target.entityId === volcanoEntityId(document.sceneId, recipe!.seed, 'crater')))
        .map(owner => ({ id: owner.target.entityId, label: recipe?.domain === 'volcano' ? (['ground', 'mountain', 'crater', 'platform', 'flow'].find(key => volcanoEntityId(document.sceneId, recipe.seed, key) === owner.target.entityId) ?? owner.target.entityId).replace('ground', '地面').replace('mountain', '山体').replace('crater', '火口').replace('platform', '活动平台').replace('flow', '流道') : owner.target.entityId }))
  const selectedTarget = targets.find(row => row.id === targetId)?.id ?? targets[0]?.id ?? ''
  const area = document.terrainAreas[selectedTarget], originalPoints = area?.boundaryMm.map(row => row.positionMm) ?? []
  const right = Math.max(...originalPoints.map(point => point.x))
  const adjustedPoints = originalPoints.map(point => ({ ...point, x: point.x === right ? point.x + Math.round(expansion * 1000) : point.x }))
  const text = positions ?? coordinates(adjustedPoints)
  const parsedPoints = text.trim().split('\n').map(line => { const pair = line.trim().split(/[,，\s]+/); return { x: pair.length === 2 ? Number(pair[0]) : NaN, y: pair.length === 2 ? Number(pair[1]) : NaN } })
  const materials = Object.values(document.materials).filter(material => material.applicableSurfaces.includes('terrain'))
  const material = materials.find(row => row.id === materialId) ?? materials.find(row => row.id !== area?.surfaceStyle?.base.materialRef.id) ?? materials[0]
  const request = recipe && selectedTarget ? localGenerationRequestSchema.safeParse(selectedOperation === 'interior-furniture'
    ? { version: 1, recipeId: recipe.id, operation: selectedOperation, roomId: selectedTarget, variation: variation.trim() }
    : selectedOperation === 'forest-density' ? { version: 1, recipeId: recipe.id, operation: selectedOperation, zoneId: selectedTarget, role, coveragePpm: Math.round(coverage * 10000) }
      : selectedOperation === 'volcano-material' ? { version: 1, recipeId: recipe.id, operation: selectedOperation, areaId: selectedTarget, materialRef: material && { id: material.id, version: material.version } }
        : { version: 1, recipeId: recipe.id, operation: selectedOperation, areaId: selectedTarget, positionsMm: parsedPoints }) : null
  const change = (run: () => void) => { if (!locked) { onChange(); run() } }
  const resetTarget = () => { setTargetId(''); setPositions(null); setExpansion(0) }
  if (!recipes.length) return null
  return <section className="terrain-generation-panel local-generation-panel" aria-label="受限局部重生成">
    <h2>局部重生成</h2>
    <p>调整当前工程的选定生成结果，先审阅写入范围与依赖，再保护并一次采用。</p>
    <p className="asset-muted">人工移动、删除、退出和锁定优先保留。改变连接、支撑或建筑拓扑的请求可能被拒绝。</p>
    <form onSubmit={event => { event.preventDefault(); if (!locked && request?.success) void onPreview(request.data) }}>
      <fieldset disabled={locked}>
        <legend>选择范围</legend>
        <label>生成配方<select aria-label="局部生成配方" value={recipe?.id ?? ''} onChange={event => change(() => { setRecipeId(event.target.value); resetTarget() })}>{recipes.map(row => <option key={row.id} value={row.id}>{names[row.domain]} · {row.seed}</option>)}</select></label>
        <label>调整内容<select aria-label="局部调整内容" value={selectedOperation} onChange={event => change(() => { setOperation(event.target.value as Operation); resetTarget() })}>{operations.map(value => <option key={value} value={value}>{operationLabels[value]}</option>)}</select></label>
        <label>目标<select aria-label="局部生成目标" value={selectedTarget} onChange={event => change(() => { setTargetId(event.target.value); setPositions(null); setExpansion(0) })}>{targets.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        {selectedOperation === 'interior-furniture' && <label>摆位变化<input aria-label="家具摆位变化" value={variation} maxLength={128} onChange={event => change(() => setVariation(event.target.value))}/></label>}
        {selectedOperation === 'forest-density' && <><label>植被角色<select aria-label="局部植被角色" value={role} onChange={event => change(() => setRole(event.target.value as typeof role))}><option value="tree">树木</option><option value="shrub">灌木</option><option value="grass">草</option></select></label><label>目标覆盖（%）<input aria-label="局部植被覆盖百分比" type="number" min="0" max="100" step="0.1" value={coverage} onChange={event => change(() => setCoverage(Number(event.target.value)))}/></label></>}
        {selectedOperation === 'volcano-material' && <label>新底材<select aria-label="局部火山材质" value={material?.id ?? ''} onChange={event => change(() => setMaterialId(event.target.value))}>{materials.map(row => <option key={row.id} value={row.id}>{row.name} · v{row.version}</option>)}</select></label>}
        {selectedOperation === 'volcano-boundary' && <><label>当前坐标（毫米）<textarea aria-label="火口当前轮廓坐标" rows={4} readOnly value={coordinates(originalPoints)}/></label><label>右侧扩展（米）<input aria-label="火口右侧扩展米" type="number" step="0.1" value={expansion} onChange={event => change(() => { setExpansion(Number(event.target.value)); setPositions(null) })}/></label><label>调整后坐标（毫米，每行 x, y）<textarea aria-label="火口调整后轮廓坐标" rows={4} value={text} onChange={event => change(() => setPositions(event.target.value))}/></label><p className="asset-muted">保持点数与顺序；预览会核对实际支撑、流道、连接端点及通路净宽。</p></>}
      </fieldset>
      <button className="primary asset-wide" disabled={locked || !request?.success} type="submit">{busy ? '正在准备局部候选…' : '预览局部重生成'}</button>
    </form>
    {error && <p className="asset-error" role="alert">{error}</p>}
    {candidate && <div className="local-generation-candidate" aria-label="局部重生成候选摘要">
      <h3>完整影响范围</h3><p>实际编辑量 {candidate.cost.total}/{candidate.cost.limit}；写入 {candidate.changes.length} 项，读取依赖 {candidate.readIds.length} 项。</p>
      <details open><summary>实际写入</summary><ul>{candidate.changes.map((row, index) => <li key={`${row.id}-${index}`}>{row.collection ?? 'project'} · {row.id} · {row.fields.join('、')}</li>)}</ul></details>
      <details><summary>只读依赖</summary><textarea aria-label="局部生成只读依赖" readOnly rows={5} value={candidate.readIds.join('\n')}/></details>
      <ul aria-label="局部生成说明">{candidate.result.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
      <button className="primary asset-wide" disabled={locked} onClick={() => void onAdopt()}>保护并采用局部修改</button>
    </div>}
    {(dirty || candidate || busy) && <button className="secondary asset-wide" disabled={disabled} onClick={onCancel}>取消局部重生成</button>}
  </section>
}
