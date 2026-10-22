import { validateSceneSnapshotV2 } from '../../core/v2/snapshots'
import { checkCancelled } from '../../io/v2/limits'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { projectSceneV2 } from './projection'
import { encodePng, renderRasterProjection, EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE } from '../shared/canvas-renderer'
import type { RenderOptions, EditorRenderOptions } from '../shared/canvas-renderer'

export type { RenderMetrics as RenderMetricsV2, RenderOptions as RenderOptionsV2, EditorRenderOptions as EditorRenderOptionsV2, WallGeometry as WallGeometryV2 } from '../shared/canvas-renderer'
export { EDITOR_MAX_LONG_EDGE as EDITOR_MAX_LONG_EDGE_V2, PNG_MAX_LONG_EDGE as PNG_MAX_LONG_EDGE_V2, PNG_MAX_PIXELS as PNG_MAX_PIXELS_V2, wallGeometry as wallGeometryV2, connectionPolygon as connectionPolygonV2, terrainFace as terrainFaceV2, terrainShadow as terrainShadowV2 } from '../shared/canvas-renderer'

/** Strict v2 entrypoint. No newer document is downgraded or accepted here. */
export async function renderProjectV2(project: CompleteProjectV2, options: RenderOptions): Promise<HTMLCanvasElement> {
  return renderProjectInternalV2(project, options)
}

/** Full audience resource verification precedes disposable crop and object LOD. */
export async function renderEditorProjectV2(project: CompleteProjectV2, options: EditorRenderOptions): Promise<HTMLCanvasElement> {
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > EDITOR_MAX_LONG_EDGE) throw new Error('编辑预览长边须为 256–2048 整数像素。')
  return renderProjectInternalV2(project, options, options)
}

async function renderProjectInternalV2(project: CompleteProjectV2, options: RenderOptions, editor?: EditorRenderOptions): Promise<HTMLCanvasElement> {
  options = { ...options }
  const started = options.onMetrics ? performance.now() : 0
  checkCancelled(options.signal)
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('图片长边须为 256–4096 整数像素。')
  const validated = validateSceneSnapshotV2(project.document)
  if (!validated.ok) throw new Error(`场景不能绘制：${validated.errors[0]?.message ?? '结构不合法。'}`)
  const sources = { assetRefs: validated.document.assets, assets: Object.fromEntries(Object.entries(project.assets).map(([hash, resource]) => [hash, { ...resource }])) }
  return renderRasterProjection(sources, projectSceneV2(validated.document, options.audience), options, editor, started)
}

export async function exportPngV2(project: CompleteProjectV2, options: RenderOptions): Promise<Blob> {
  options = { ...options }
  return encodePng(await renderProjectV2(project, options), options.signal)
}
