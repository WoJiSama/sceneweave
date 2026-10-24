import type { AuthoringScope, SceneAuthoringOperationKind } from '../../shared/ai/authoring-protocol'
import { SceneAuthoringOperationKindSchema } from '../../shared/ai/authoring-protocol'
import type { BoundsMm, SceneDocument } from '../../shared/model/scene'
import type { ProjectData } from '../../shared/model/project'
import { LAYER_ENTITY_COLLECTIONS } from '../../shared/model/scene'
import { assertArtworkProp } from '../../shared/ai/artwork'
import { buildingDependants } from '../../shared/commands/building'
import { outdoorDependencies } from '../../shared/commands/outdoor'
import { selectedWallSurfaceIds } from './ai-wall-scope'

export interface ExtendedScope {
  scene: boolean; sceneIds: string[]; sceneOperations: SceneAuthoringOperationKind[]; prefabs: string[]; materials: string[]
  artwork: boolean; mode: 'single' | 'prefab' | 'range'; artworkIds: string[]; includeNew: boolean; svg: boolean; style: boolean; bounds: BoundsMm | null
}
export const initialExtendedScope = (): ExtendedScope => ({ scene: false, sceneIds: [], sceneOperations: [...SceneAuthoringOperationKindSchema.options], prefabs: [], materials: [], artwork: false, mode: 'single', artworkIds: [], includeNew: false, svg: true, style: true, bounds: null })
const labels: Record<string, string> = { room: '画房间', wall: '墙厚与墙面材质', vertex: '墙体顶点', opening: '添加门窗', entrance: '安排入口', terrain: '创建地形', terrainUpdate: '调整地形/高程', edge: '岸线/崖边', connection: '台阶/坡道', region: '用途区', path: '创建道路', pathUpdate: '调整道路', scatter: '植被散布', scatterRegenerate: '重算散布', prefab: '放置固定组合', furnish: '布置家具', gmNote: '主持人文字', gmNoteUpdate: '修改主持人文字' }
function closure(scene: SceneDocument, ids: readonly string[]): string[] {
  const result = new Set(ids)
  for (const id of result) {
    const room = scene.rooms[id]
    if (room) {
      room.boundaryVertexIds.forEach(value => result.add(value))
      Object.values(scene.walls).filter(w => room.boundaryVertexIds.includes(w.startVertexId) && room.boundaryVertexIds.includes(w.endVertexId)).forEach(w => result.add(w.id))
    }
  }
  const wallIds = [...result].filter(id => scene.walls[id] || scene.vertices[id]).flatMap(id => scene.walls[id] ? [id] : Object.values(scene.walls).filter(w => w.startVertexId === id || w.endVertexId === id).map(w => w.id))
  buildingDependants(scene, wallIds, [...result]).forEach(id => result.add(id))
  outdoorDependencies(scene, [...result]).forEach(id => result.add(id))
  return [...result].filter(id => LAYER_ENTITY_COLLECTIONS.some(key => Object.hasOwn(scene[key], id))).sort()
}
export function extendedAuthoringScope(value: ExtendedScope, project: ProjectData, floorId: string, layerId: string, definitionIds: string[]): Pick<AuthoringScope, 'scene' | 'artwork'> {
  const boundsMm = value.bounds ?? project.document.exportBoundsMm
  return { ...(value.scene ? { scene: { floorId, layerId, boundsMm, entityIds: value.sceneIds, definitionIds, prefabDefinitionIds: value.prefabs, materialIds: value.materials, operations: value.sceneOperations } } : {}),
    ...(value.artwork ? { artwork: { mode: value.mode, targetIds: value.artworkIds, operations: [...(value.svg ? ['svg' as const] : []), ...(value.style ? ['style' as const] : [])], boundsMm, includeNewProps: value.includeNew } } : {}) }
}
export default function AiScopeFields({ value, onChange, project, selectedIds, disabled }: { value: ExtendedScope; onChange: (value: ExtendedScope) => void; project: ProjectData; selectedIds: readonly string[]; disabled: boolean }) {
  const scene = project.document, bounds = value.bounds ?? scene.exportBoundsMm
  const wallSurfaceIds = selectedWallSurfaceIds(scene, selectedIds)
  const set = (patch: Partial<ExtendedScope>) => onChange({ ...value, ...patch })
  const selectArtwork = () => {
    const ids = value.mode === 'prefab' ? selectedIds.filter(id => scene.prefabInstances[id]).slice(0, 1) : [...new Set(selectedIds.flatMap(id => scene.props[id] ? [id] : Object.values(scene.prefabInstances[id]?.members ?? scene.scatterGroups[id]?.members ?? {}).flatMap(member => member.propId ? [member.propId] : [])))]
    set({ artworkIds: value.mode === 'single' ? ids.slice(0, 1) : ids })
  }
  return <fieldset disabled={disabled} className="ai-scope-fields"><legend>完整场景与素材创作</legend>
    <label className="ai-check"><input type="checkbox" aria-label="AI 完整场景创作" checked={value.scene} onChange={e => set({ scene: e.target.checked })}/>允许建筑、室外、组合和主持人文字工具</label>
    {(value.scene || value.artwork) && <details><summary>明确创作范围（整数毫米）</summary>{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: '左侧X', y: '顶部Y', width: '宽', height: '高' })[key]}<input aria-label={`AI 范围 ${key}`} type="number" step="1" value={bounds[key]} onChange={e => set({ bounds: { ...bounds, [key]: Number(e.target.value) } })}/></label>)}<button onClick={() => set({ bounds: null })}>使用当前导出范围</button></details>}
    {value.scene && <><p>新内容写入当前用户图层。现存内容只授权下面列出的对象及依赖；新生成对象可在后续步骤继续使用。</p><button onClick={() => set({ sceneIds: closure(scene, selectedIds) })}>使用选中结构及其依赖</button><button disabled={!wallSurfaceIds.length} onClick={() => set({ sceneIds: wallSurfaceIds, sceneOperations: ['wall'] })}>使用选中房间或墙的墙面</button><p>只改墙面时保留附着线索，不授权其内容；改墙厚或顶点仍须完整依赖，遇私密依赖会拒绝。</p><button onClick={() => set({ sceneIds: [] })}>仅创作新场景</button><details><summary>现存场景授权 {value.sceneIds.length} 项</summary><p>{value.sceneIds.join('、') || '不授权修改现存结构'}</p></details><details><summary>允许的场景操作（{value.sceneOperations.length}）</summary>{SceneAuthoringOperationKindSchema.options.map(kind => <label className="ai-check" key={kind}><input type="checkbox" checked={value.sceneOperations.includes(kind)} onChange={e => set({ sceneOperations: e.target.checked ? [...value.sceneOperations, kind] : value.sceneOperations.filter(v => v !== kind) })}/>{labels[kind] ?? kind}</label>)}</details>
      <details><summary>授权固定组合（{value.prefabs.length}）和材质（{value.materials.length}）</summary><button onClick={() => set({ prefabs: Object.values(scene.prefabDefinitions).filter(v => !v.tags.includes('sceneweave:retained-appearance')).map(v => v.id), materials: Object.keys(scene.materials) })}>授权本工程全部组合和材质</button>{Object.values(scene.prefabDefinitions).filter(v => !v.tags.includes('sceneweave:retained-appearance')).map(v => <label className="ai-check" key={v.id}><input type="checkbox" checked={value.prefabs.includes(v.id)} onChange={e => set({ prefabs: e.target.checked ? [...value.prefabs, v.id] : value.prefabs.filter(id => id !== v.id) })}/>{v.name}</label>)}{Object.values(scene.materials).map(v => <label className="ai-check" key={v.id}><input type="checkbox" checked={value.materials.includes(v.id)} onChange={e => set({ materials: e.target.checked ? [...value.materials, v.id] : value.materials.filter(id => id !== v.id) })}/>{v.name}</label>)}</details></>}
    <label className="ai-check"><input type="checkbox" aria-label="AI 素材创作和同化" checked={value.artwork} onChange={e => set({ artwork: e.target.checked })}/>允许 SVG 制作与所选素材风格同化</label>
    {value.artwork && <><label>素材范围<select aria-label="AI 素材范围" value={value.mode} onChange={e => set({ mode: e.target.value as ExtendedScope['mode'], artworkIds: [] })}><option value="single">单个物件</option><option value="prefab">一个组合的存活成员</option><option value="range">明确范围内的所选物件</option></select></label><button onClick={selectArtwork}>使用画布选中的素材</button>{value.mode === 'range' && <button onClick={() => set({ artworkIds: Object.keys(scene.props).filter(id => { try { assertArtworkProp(project, id, bounds); return true } catch { return false } }) })}>选取范围内全部公开物件</button>}<p>素材目标 {value.artworkIds.length} 项：{value.artworkIds.join('、') || '无'}</p><label className="ai-check"><input type="checkbox" checked={value.svg} onChange={e => set({ svg: e.target.checked })}/>受限 SVG（本机生成实际 PNG，保留原件、源和许可）</label><label className="ai-check"><input type="checkbox" checked={value.style} onChange={e => set({ style: e.target.checked })}/>配色、亮度和透明度协调</label><label className="ai-check"><input type="checkbox" checked={value.includeNew} onChange={e => set({ includeNew: e.target.checked })}/>同时允许制作本任务新建物件的外观</label><p>组合和散布仍保留可编辑成员、人工覆盖与删除记录；物理占地、通行和秘密保持。</p></>}
  </fieldset>
}
