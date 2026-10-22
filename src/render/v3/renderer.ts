import { validateSceneSnapshotV3 } from '../../core/v3/snapshots'
import { checkCancelled } from '../../io/v2/limits'
import type { CompleteProjectV3 } from '../../io/v3/types'
import { projectEditorSceneV3, projectSceneV3 } from './projection'
import { encodePng, renderRasterProjection, EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE } from '../shared/canvas-renderer'
import type { RenderOptions, EditorRenderOptions } from '../shared/canvas-renderer'

export type { RenderMetrics as RenderMetricsV3, RenderOptions as RenderOptionsV3, WallGeometry as WallGeometryV3 } from '../shared/canvas-renderer'
export { EDITOR_MAX_LONG_EDGE as EDITOR_MAX_LONG_EDGE_V3, PNG_MAX_LONG_EDGE as PNG_MAX_LONG_EDGE_V3, PNG_MAX_PIXELS as PNG_MAX_PIXELS_V3, wallGeometry as wallGeometryV3, connectionPolygon as connectionPolygonV3, terrainFace as terrainFaceV3, terrainShadow as terrainShadowV3 } from '../shared/canvas-renderer'
export interface EditorRenderOptionsV3 extends EditorRenderOptions {
  /** GM session only. Player preview and all formal output ignore these IDs. */
  hiddenLayerIds?: ReadonlySet<string>
}

/** Strict v3 entrypoint. No schema stripping or v2 renderer dispatch. */
export async function renderProjectV3(project: CompleteProjectV3, options: RenderOptions): Promise<HTMLCanvasElement> {
  return renderProjectInternalV3(project, options)
}

/** Full audience resource closure precedes GM-only hiding, crop and object LOD. */
export async function renderEditorProjectV3(project: CompleteProjectV3, options: EditorRenderOptionsV3): Promise<HTMLCanvasElement> {
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > EDITOR_MAX_LONG_EDGE) throw new Error('编辑预览长边须为 256–2048 整数像素。')
  return renderProjectInternalV3(project, options, options)
}

async function renderProjectInternalV3(project: CompleteProjectV3, options: RenderOptions, editor?: EditorRenderOptionsV3): Promise<HTMLCanvasElement> {
  options = { ...options }
  const started = options.onMetrics ? performance.now() : 0
  checkCancelled(options.signal)
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('图片长边须为 256–4096 整数像素。')
  const validated = validateSceneSnapshotV3(project.document)
  if (!validated.ok) throw new Error(`场景不能绘制：${validated.errors[0]?.message ?? '结构不合法。'}`)
  const scene = validated.document
  const sources = { assetRefs: scene.assets, assets: Object.fromEntries(Object.entries(project.assets).map(([hash, resource]) => [hash, { ...resource }])) }
  const projection = projectSceneV3(scene, options.audience)
  const preview = editor && { ...editor, hiddenLayerIds: undefined, drawingProjection: options.audience === 'gm' && editor.hiddenLayerIds?.size ? projectEditorSceneV3(scene, { hiddenLayerIds: new Set(editor.hiddenLayerIds) }) : projection }
  return renderRasterProjection(sources, projection, options, preview, started)
}

export async function exportPngV3(project: CompleteProjectV3, options: RenderOptions): Promise<Blob> {
  options = { ...options }
  return encodePng(await renderProjectV3(project, options), options.signal)
}
