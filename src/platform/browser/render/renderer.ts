import { checkCancelled } from '../../../shared/ports/resources.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { createBrowserImagePort } from '../images/adapter'
import { createBrowserSvgPort } from '../ai/svg-port.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import { encodePng, renderRasterProjection, EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE } from './canvas-renderer'
import type { RenderOptions, EditorRenderOptions } from './canvas-renderer'

export type { RenderMetrics, RenderOptions, WallGeometry } from './canvas-renderer'
export { EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE, PNG_MAX_PIXELS, wallGeometry, connectionPolygon, terrainFace, terrainShadow } from './canvas-renderer'
export interface EditorProjectRenderOptions extends EditorRenderOptions {
  /** GM session only. Ignored by player previews and both formal audiences. */
  hiddenLayerIds?: ReadonlySet<string>
}

/** Complete native-v1 boundary. Pure shared validation precedes any browser resource IO. */
export async function renderProject(input: ProjectBundle, options: RenderOptions): Promise<HTMLCanvasElement> {
  return renderInternal(input, options)
}

export async function renderEditorProject(input: ProjectBundle, options: EditorProjectRenderOptions): Promise<HTMLCanvasElement> {
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > EDITOR_MAX_LONG_EDGE) throw new Error('编辑预览长边须为 256–2048 整数像素。')
  return renderInternal(input, options, options)
}

async function renderInternal(input: ProjectBundle, options: RenderOptions, editor?: EditorProjectRenderOptions): Promise<HTMLCanvasElement> {
  options = { ...options }
  const started = options.onMetrics ? performance.now() : 0
  checkCancelled(options.signal)
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('图片长边须为 256–4096 整数像素。')
  const bundle = await validateProjectBundle(input, { images: createBrowserImagePort(), svg: createBrowserSvgPort(), signal: options.signal }), project = bundle.project, scene = project.document
  const sources = { assetRefs: scene.assets, assets: project.assets, resources: bundle.resources }
  // The unhidden audience closure is verified before session hiding, crop or LOD.
  const projection = projectScene(scene, options.audience)
  const preview = editor && { ...editor, hiddenLayerIds: undefined, drawingProjection: options.audience === 'gm' && editor.hiddenLayerIds?.size
    ? projectEditorScene(scene, { hiddenLayerIds: new Set(editor.hiddenLayerIds) }) : projection }
  return renderRasterProjection(sources, projection, options, preview, started)
}

export async function exportPng(input: ProjectBundle, options: RenderOptions): Promise<Blob> {
  options = { ...options }
  return encodePng(await renderProject(input, options), options.signal)
}

// Existing leaf prop names remain source-compatible while all data and runtime paths are native-v1.
export { renderEditorProject as renderEditorProjectV2 }
export type { RenderOptions as RenderOptionsV2, EditorProjectRenderOptions as EditorRenderOptionsV2 }
export { wallGeometry as wallGeometryV2, wallGeometry as wallGeometryV3, connectionPolygon as connectionPolygonV2 } from './canvas-renderer'

/** Actual public crop for explicitly authorized visual feedback. No editor LOD or hidden-layer state is used. */
export async function exportPublicViewportPng(input: ProjectBundle, boundsMm: import('../../../shared/model/scene.js').BoundsMm, longEdgePx = 768, signal?: AbortSignal): Promise<Blob> {
  const values = [boundsMm.x, boundsMm.y, boundsMm.width, boundsMm.height, boundsMm.x + boundsMm.width, boundsMm.y + boundsMm.height]
  if (!values.every(Number.isSafeInteger) || boundsMm.width <= 0 || boundsMm.height <= 0) throw new Error('视觉回读范围须为有效整数毫米矩形。')
  if (!Number.isSafeInteger(longEdgePx) || longEdgePx < 256 || longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('视觉回读长边须为256–4096整数像素。')
  checkCancelled(signal)
  const bundle = await validateProjectBundle(input, { images: createBrowserImagePort(), svg: createBrowserSvgPort(), signal }), scene = bundle.project.document
  const projection = projectScene(scene, 'player'), b = projection.bounds
  if (boundsMm.x < b.x || boundsMm.y < b.y || boundsMm.x + boundsMm.width > b.x + b.width || boundsMm.y + boundsMm.height > b.y + b.height) throw new Error('视觉回读范围须完全落在固定导出范围内。')
  const sources = { assetRefs: scene.assets, assets: bundle.project.assets, resources: bundle.resources }
  return encodePng(await renderRasterProjection(sources, projection, { audience: 'player', longEdgePx, signal }, undefined, undefined, { ...boundsMm }), signal)
}
