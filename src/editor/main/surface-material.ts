import type { EditableProject } from '../../application/workspace/project'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument, MaterialRef } from '../../shared/model/scene'
import { surfaceStyle } from '../../shared/appearance/graph'

const surfaces = { room: 'rooms', terrainArea: 'terrainAreas', wall: 'walls', path: 'paths', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections' } as const
export function surfaceKind(scene: SceneDocument, id: string) {
  return (Object.keys(surfaces) as (keyof typeof surfaces)[]).find(kind => Object.hasOwn(scene[surfaces[kind]], id))
}
export function assertMaterialTargets(scene: SceneDocument, ids: readonly string[], material?: MaterialRef) {
  if (!ids.length) throw new Error('请先明确选择要铺装的表面。')
  for (const id of ids) {
    const kind = surfaceKind(scene, id)
    if (!kind) throw new Error('所选内容含不支持铺装的对象；请明确选择房间、地形、墙、道路、边缘或高差连接。')
    const applicability = kind === 'room' || kind === 'wall' || kind === 'path' ? kind : kind === 'terrainConnection' ? 'path' : 'terrain'
    if (material && !material.applicableSurfaces.includes(applicability)) throw new Error(`“${material.name}”不适用于所选表面；请重新选择材质或表面。`)
  }
}
/** Replace only the fixed base material; keep texture coordinates and local overlays. */
export function surfaceMaterialCommands(project: EditableProject, ids: readonly string[], materialId: string): SceneCommand[] {
  const scene = project.document, material = scene.materials[materialId]
  if (!material) throw new Error('材质尚未完整加入工程。')
  assertMaterialTargets(scene, ids, material)
  return ids.map(id => {
    const source = project.appearance.sources[project.appearance.surfaceSources[id]]
    const saved = source?.kind === 'surface' ? source.snapshot : surfaceStyle(scene, id)
    const style = saved ? structuredClone(saved) : { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
    style.base.materialRef = { id: material.id, version: material.version }
    return { type: 'setVisualSurface', kind: surfaceKind(scene, id)!, id, style }
  })
}
