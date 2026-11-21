import { checkCancelled } from '../../../shared/ports/resources.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { validateProjectBundle, validateProjectSnapshot } from '../../../shared/project/resources.js'
import { browserProjectValidation } from '../project-validation.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import { encodePng, renderRasterProjection, EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE } from './canvas-renderer'
import type { RenderOptions, EditorRenderOptions } from './canvas-renderer'
import { atmosphereComparison } from './atmosphere-comparison'
import { floorDisplayStack } from '../../../shared/floors/output.js'
import type { Projection } from '../../../shared/projection/types.js'
import { editorViewBounds } from './editor-render-plan.js'
import { planFloorShadows } from '../../../shared/projection/floor-shadows.js'
import { drawFloorShadows } from './floor-shadows.js'
import { resolvePartitionOutput } from '../../../shared/geometry/partitions.js'

export type { RenderMetrics, RenderOptions, WallGeometry } from './canvas-renderer'
export { EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE, PNG_MAX_PIXELS, wallGeometry, connectionPolygon, terrainFace, terrainShadow } from './canvas-renderer'
export interface EditorProjectRenderOptions extends EditorRenderOptions {
  /** GM session only. Ignored by player previews and both formal audiences. */
  hiddenLayerIds?: ReadonlySet<string>
  groundView?: boolean
  /** Temporary GM color/light/fog/filter comparison; never a public output option. */
  atmosphereBypass?: boolean
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
  const validation = { ...browserProjectValidation, signal: options.signal }
  const bundle = await (editor ? validateProjectSnapshot(input, validation) : validateProjectBundle(input, validation)), project = bundle.project, scene = project.document
  checkCancelled(options.signal)
  const sources = { assetRefs: scene.assets, assets: project.assets, resources: bundle.resources }
  const partition = options.partitionId ? resolvePartitionOutput(scene, options.partitionId, options.audience) : undefined
  if (partition && (editor || options.floorId !== undefined && options.floorId !== partition.region.floorId)) throw new Error('分区输出需要使用它所在的楼层。')
  // The unhidden audience closure is verified before session hiding, crop or LOD.
  const projection = projectScene(scene, options.audience, project.appearance, { floorId: partition?.region.floorId ?? options.floorId })
  const finishPartition = (result: HTMLCanvasElement) => {
    if (!partition) return result
    const { bounds, region } = partition, sx = result.width / bounds.width, sy = result.height / bounds.height
    const ctx = result.getContext('2d')!
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.rect(0, 0, result.width, result.height)
    for (const [index, point] of region.boundaryMm.entries()) {
      const x = (point.x - bounds.x) * sx, y = (point.y - bounds.y) * sy
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath(); ctx.fill('evenodd'); ctx.restore()
    return result
  }
  function drawable(source: Projection): Projection {
    const drawing = options.audience === 'gm' && editor?.hiddenLayerIds?.size
      ? projectEditorScene(scene, { floorId: source.floorId ?? options.floorId, hiddenLayerIds: new Set(editor.hiddenLayerIds) }, project.appearance) : source
    return options.audience === 'gm' && editor?.atmosphereBypass ? atmosphereComparison(drawing) : drawing
  }
  function renderFloor(source: Projection, drawing: Projection, stacked = false) {
    const linkedFloor = source.floorId !== projection.floorId
    const bounds = stacked ? projection.bounds : source.bounds
    const align = (floor: Projection): Projection => stacked ? {
      ...floor, bounds, outputBackground: { mode: 'transparent' }, gridSizeMm: linkedFloor ? null : floor.gridSizeMm,
    } : floor
    // The unhidden audience closure is verified before session hiding, crop or LOD.
    const preview = editor && { ...editor, hiddenLayerIds: undefined, drawingProjection: align(options.audience === 'gm' && editor.groundView && !linkedFloor ? { ...drawing, groundView: true } : drawing) }
    return renderRasterProjection(sources, align(source), { ...options, floorId: source.floorId ?? options.floorId,
      onMetrics: linkedFloor ? undefined : options.onMetrics }, preview, started, partition?.bounds)
  }
  const floorId = projection.floorId ?? options.floorId ?? Object.keys(scene.floors)[0]
  if (!scene.floors[floorId].underlayFloorId) return finishPartition(await renderFloor(projection, drawable(projection)))
  const stack = floorDisplayStack(scene, floorId)
  const view = partition?.bounds ?? (editor ? editorViewBounds(projection.bounds, editor.viewBoundsMm) : projection.bounds)
  const lower: Projection[] = []
  let result: HTMLCanvasElement | undefined, context: CanvasRenderingContext2D | undefined
  try {
    for (const floor of stack) {
      const layer = floor.id === floorId ? projection : projectScene(scene, options.audience, project.appearance, { floorId: floor.id })
      const left = Math.max(view.x, layer.bounds.x), top = Math.max(view.y, layer.bounds.y)
      const right = Math.min(view.x + view.width, layer.bounds.x + layer.bounds.width)
      const bottom = Math.min(view.y + view.height, layer.bounds.y + layer.bounds.height)
      if (right <= left || bottom <= top) continue
      const drawing = drawable(layer)
      const canvas = await renderFloor(layer, drawing, true)
      try {
        checkCancelled(options.signal)
        if (!result) {
          result = document.createElement('canvas')
          result.width = canvas.width
          result.height = canvas.height
          context = result.getContext('2d', { willReadFrequently: !editor && options.longEdgePx === PNG_MAX_LONG_EDGE }) ?? undefined
          if (!context) throw new Error('无法创建楼层叠绘缓冲。')
          if (projection.outputBackground?.mode !== 'transparent') {
            context.fillStyle = projection.outputBackground?.mode === 'solid' ? projection.outputBackground.color : '#D8D5C5'
            context.fillRect(0, 0, result.width, result.height)
          }
        }
        const ctx = context!, sx = result.width / view.width, sy = result.height / view.height
        drawFloorShadows(ctx, view, planFloorShadows(drawing, lower, view, options.signal))
        ctx.save()
        ctx.beginPath()
        ctx.rect((left - view.x) * sx, (top - view.y) * sy, (right - left) * sx, (bottom - top) * sy)
        ctx.clip()
        ctx.drawImage(canvas, 0, 0)
        ctx.restore()
        lower.push(drawing)
      } finally { canvas.width = canvas.height = 0 }
    }
    return finishPartition(result!)
  } catch (error) {
    if (result) result.width = result.height = 0
    throw error
  }
}

export async function exportPng(input: ProjectBundle, options: RenderOptions): Promise<Blob> {
  options = { ...options }
  return encodePng(await renderProject(input, options), options.signal, options.onPngMetrics)
}

// Existing leaf prop names remain source-compatible while all data and runtime paths are native-v1.
export { renderEditorProject as renderEditorProjectV2 }
export type { RenderOptions as RenderOptionsV2, EditorProjectRenderOptions as EditorRenderOptionsV2 }
export { wallGeometry as wallGeometryV2, wallGeometry as wallGeometryV3, connectionPolygon as connectionPolygonV2 } from './canvas-renderer'

/** Actual public crop for explicitly authorized visual feedback. No editor LOD or hidden-layer state is used. */
export async function exportPublicViewportPng(input: ProjectBundle, boundsMm: import('../../../shared/model/scene.js').BoundsMm, longEdgePx = 768, signal?: AbortSignal, floorId?: string): Promise<Blob> {
  const values = [boundsMm.x, boundsMm.y, boundsMm.width, boundsMm.height, boundsMm.x + boundsMm.width, boundsMm.y + boundsMm.height]
  if (!values.every(Number.isSafeInteger) || boundsMm.width <= 0 || boundsMm.height <= 0) throw new Error('视觉回读范围须为有效整数毫米矩形。')
  if (!Number.isSafeInteger(longEdgePx) || longEdgePx < 256 || longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('视觉回读长边须为256–4096整数像素。')
  checkCancelled(signal)
  const bundle = await validateProjectBundle(input, { ...browserProjectValidation, signal }), scene = bundle.project.document
  const projection = projectScene(scene, 'player', bundle.project.appearance, { floorId }), b = projection.bounds
  if (boundsMm.x < b.x || boundsMm.y < b.y || boundsMm.x + boundsMm.width > b.x + b.width || boundsMm.y + boundsMm.height > b.y + b.height) throw new Error('视觉回读范围须完全落在固定导出范围内。')
  const sources = { assetRefs: scene.assets, assets: bundle.project.assets, resources: bundle.resources }
  return encodePng(await renderRasterProjection(sources, projection, { audience: 'player', longEdgePx, signal, ...(floorId === undefined ? {} : { floorId }) }, undefined, undefined, { ...boundsMm }), signal)
}
