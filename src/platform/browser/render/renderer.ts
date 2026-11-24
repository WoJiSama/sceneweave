import { checkCancelled } from '../../../shared/ports/resources.js'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { getVerifiedProjectBundle, validateProjectBundle, validateProjectSnapshot } from '../../../shared/project/resources.js'
import { browserProjectValidation } from '../project-validation.js'
import { projectEditorScene, projectScene } from '../../../shared/projection/projection.js'
import type { ArtStylePreviewCache, RenderOptions, EditorRenderOptions, verifiedRenderBlob } from './canvas-renderer'
import { EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE } from './render-limits.js'
import { atmosphereComparison } from './atmosphere-comparison'
import { floorDisplayStack } from '../../../shared/floors/output.js'
import type { Projection } from '../../../shared/projection/types.js'
import { editorViewBounds } from './editor-render-plan.js'
import { planFloorShadows } from '../../../shared/projection/floor-shadows.js'
import { drawFloorShadows } from './floor-shadows.js'
import { resolvePartitionOutput } from '../../../shared/geometry/partitions.js'
import { activeArtStyles, activeLineArt, artStyleBrushKey, artStyleLightAmount, sceneArtStyleSchema, usesSeparateArtStyle, type SceneArtStyle } from '../../../shared/visual/art-style.js'
import type { NormalizedStaticSvg } from '../../../shared/ai/svg.js'
import { checkArtStyleSvg } from './art-style-svg.js'
import { projectMaterialBrushes } from '../../../shared/projection/material-drawing.js'
import { applyArtStyleGrades } from './art-style-grade.js'

export type { RenderMetrics, RenderOptions, WallGeometry } from './canvas-renderer'
export { EDITOR_MAX_LONG_EDGE, PNG_MAX_LONG_EDGE, PNG_MAX_PIXELS } from './render-limits.js'
export { wallGeometry, wallGeometry as wallGeometryV2, wallGeometry as wallGeometryV3 } from '../../../shared/geometry/wall-paint-geometry.js'
export { connectionPolygon, connectionPolygon as connectionPolygonV2 } from './connection-geometry.js'
export { terrainFace, terrainShadow } from './terrain-edge-bands.js'
export interface EditorProjectRenderOptions extends EditorRenderOptions {
  /** GM session only. Ignored by player previews and both formal audiences. */
  hiddenLayerIds?: ReadonlySet<string>
  groundView?: boolean
  /** Temporary GM color/light/fog/filter comparison; never a public output option. */
  atmosphereBypass?: boolean
  /** The GM's current paint draft; never used by formal output or a player view. */
  artStyleDraft?: SceneArtStyle
}

/** An adopted candidate can keep its editor pixels when only the revision
 * and timestamp changed. The full renderer remains the path for other data. */
export function sameVerifiedEditorPixels(first: ProjectBundle, second: ProjectBundle): boolean {
  const a = getVerifiedProjectBundle(first), b = getVerifiedProjectBundle(second)
  if (!a || !b || a.resources !== b.resources || a.project.appearance !== b.project.appearance
    || a.project.assets !== b.project.assets || a.project.authoringSources !== b.project.authoringSources) return false
  const before = a.project.document, after = b.project.document, keys = Object.keys(before) as (keyof typeof before)[]
  return keys.length === Object.keys(after).length && keys.every(key => Object.hasOwn(after, key)
    && (key === 'revision' || key === 'updatedAt' || before[key] === after[key]))
}

/** Complete native-v1 boundary. Pure shared validation precedes any browser resource IO. */
export async function renderProject(input: ProjectBundle, options: RenderOptions): Promise<HTMLCanvasElement> {
  return renderInternal(input, options)
}

export async function renderEditorProject(input: ProjectBundle, options: EditorProjectRenderOptions): Promise<HTMLCanvasElement> {
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > EDITOR_MAX_LONG_EDGE) throw new Error('编辑预览长边须为 256–2048 整数像素。')
  return renderInternal(input, options, options)
}

interface PreviewFrame { key: string; frame: NonNullable<ReturnType<ArtStylePreviewCache['readFrame']>> }
let activeArtworkFrames: { owner: WeakRef<ProjectBundle>; frames: Map<string, PreviewFrame>; svg: Map<string, Promise<NormalizedStaticSvg>>;
  imageBlobs: Map<string, Promise<Blob>>; imageBytes: number } | undefined
let previewProjections: { owner: WeakRef<ProjectBundle>; projections: Map<string, { source: Projection; drawing: Projection }> } | undefined

function fullMapProjections(bundle: ProjectBundle, editor: EditorProjectRenderOptions, floorId?: string) {
  if (previewProjections?.owner.deref() !== bundle) previewProjections = { owner: new WeakRef(bundle), projections: new Map() }
  const { projections } = previewProjections, { document, appearance } = bundle.project
  const key = JSON.stringify([floorId, [...(editor.hiddenLayerIds ?? [])].sort()])
  let result = projections.get(key)
  if (result) return result
  const source = projectScene(document, 'gm', appearance, { floorId })
  const drawing = editor.hiddenLayerIds?.size ? projectEditorScene(document, { floorId, hiddenLayerIds: editor.hiddenLayerIds }, appearance) : source
  result = { source, drawing }
  projections.set(key, result)
  if (projections.size > 3) projections.delete(projections.keys().next().value!)
  return result
}

function artStylePreviewCache(bundle: ProjectBundle, drawing: Projection, editor: EditorProjectRenderOptions,
  readVerifiedRenderBlob: typeof verifiedRenderBlob): ArtStylePreviewCache {
  if (activeArtworkFrames?.owner.deref() !== bundle) activeArtworkFrames = {
    owner: new WeakRef(bundle), frames: new Map(), svg: new Map(), imageBlobs: new Map(), imageBytes: 0,
  }
  const session = activeArtworkFrames
  const { frames } = session
  const looks = drawing.artStyles!
  const context = JSON.stringify([drawing.floorId, editor.groundView === true, editor.longEdgePx, editor.screenScalePxPerMm,
    [...(editor.hiddenLayerIds ?? [])].sort(), !!drawing.materialBrushes, looks.map(look => look.preset)])
  const key = artStyleBrushKey(looks)
  return {
    readVerifiedImage: record => {
      const existing = session.imageBlobs.get(record.sha256)
      if (existing) return existing
      const pending = readVerifiedRenderBlob(bundle.resources, record).catch(error => {
        if (session.imageBlobs.get(record.sha256) === pending) {
          session.imageBlobs.delete(record.sha256); session.imageBytes -= record.sizeBytes
        }
        throw error
      })
      if (session.imageBytes + record.sizeBytes <= 32 * 1024 * 1024) {
        session.imageBytes += record.sizeBytes
        session.imageBlobs.set(record.sha256, pending)
      }
      return pending
    },
    readSvg: source => {
      const existing = session.svg.get(source.normalizedSha256)
      if (existing) return existing
      const pending = bundle.resources.read(source.normalizedSha256).then(bytes => checkArtStyleSvg(bytes, source)).catch(error => {
        if (session.svg.get(source.normalizedSha256) === pending) session.svg.delete(source.normalizedSha256)
        throw error
      })
      if (session.svg.size >= 64) session.svg.delete(session.svg.keys().next().value!)
      session.svg.set(source.normalizedSha256, pending)
      return pending
    },
    readFrame: () => {
      const cached = frames.get(context)
      return cached?.key === key ? cached.frame : undefined
    },
    writeFrame: frame => {
      if (editor.signal?.aborted || activeArtworkFrames !== session) return
      frames.delete(context)
      frames.set(context, { key, frame })
      // Each complete editor frame is at most 2048², and the cache belongs to
      // the exact validator-owned snapshot. A/B can share identical brushwork.
      if (frames.size > 3) frames.delete(frames.keys().next().value!)
    },
  }
}

async function renderInternal(input: ProjectBundle, options: RenderOptions, editor?: EditorProjectRenderOptions): Promise<HTMLCanvasElement> {
  options = { ...options }
  if (editor) editor = { ...editor, hiddenLayerIds: editor.hiddenLayerIds && new Set(editor.hiddenLayerIds) }
  const started = options.onMetrics ? performance.now() : 0
  checkCancelled(options.signal)
  if (!Number.isInteger(options.longEdgePx) || options.longEdgePx < 256 || options.longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('图片长边须为 256–4096 整数像素。')
  const draftStyle = options.audience === 'gm' && editor?.artStyleDraft ? sceneArtStyleSchema.parse(editor.artStyleDraft) : undefined
  const validation = { ...browserProjectValidation, signal: options.signal }
  const [bundle, { renderRasterProjection, verifiedRenderBlob }] = await Promise.all([
    editor ? validateProjectSnapshot(input, validation) : validateProjectBundle(input, validation),
    import('./canvas-renderer'),
  ])
  const project = bundle.project, scene = project.document
  checkCancelled(options.signal)
  if (editor && activeArtworkFrames && (options.audience !== 'gm' || activeArtworkFrames.owner.deref() !== bundle)) activeArtworkFrames = undefined
  if (editor && previewProjections && (options.audience !== 'gm' || previewProjections.owner.deref() !== bundle)) previewProjections = undefined
  const sources = { assetRefs: scene.assets, assets: project.assets, resources: bundle.resources, vectorSources: project.authoringSources }
  const partition = options.partitionId ? resolvePartitionOutput(scene, options.partitionId, options.audience) : undefined
  if (partition && (editor || options.floorId !== undefined && options.floorId !== partition.region.floorId)) throw new Error('分区输出需要使用它所在的楼层。')
  // The unhidden audience closure is verified before session hiding, crop or LOD.
  const fullMapPreview = editor && options.audience === 'gm' && (draftStyle || scene.artStyle) && !editor.viewBoundsMm
    ? fullMapProjections(bundle, editor, options.floorId) : undefined
  const projection = fullMapPreview?.source ?? projectScene(scene, options.audience, project.appearance, { floorId: partition?.region.floorId ?? options.floorId })
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
    const drawing = source === fullMapPreview?.source ? fullMapPreview.drawing : options.audience === 'gm' && editor?.hiddenLayerIds?.size
      ? projectEditorScene(scene, { floorId: source.floorId ?? options.floorId, hiddenLayerIds: editor.hiddenLayerIds }, project.appearance) : source
    if (options.audience === 'gm' && editor?.atmosphereBypass) return atmosphereComparison(drawing)
    return draftStyle ? { ...drawing, artStyles: activeArtStyles(draftStyle), materialBrushes: projectMaterialBrushes(scene, drawing, draftStyle) } : drawing
  }
  function renderFloor(source: Projection, drawing: Projection, stacked = false) {
    const linkedFloor = source.floorId !== projection.floorId
    const bounds = stacked ? projection.bounds : source.bounds
    const align = (floor: Projection): Projection => stacked ? {
      ...floor, bounds, outputBackground: { mode: 'transparent' }, gridSizeMm: linkedFloor ? null : floor.gridSizeMm,
    } : floor
    // The unhidden audience closure is verified before session hiding, crop or LOD.
    const preview = editor && { ...editor, hiddenLayerIds: undefined, drawingProjection: align(options.audience === 'gm' && editor.groundView && !linkedFloor ? { ...drawing, groundView: true } : drawing) }
    const cache = editor && !editor.viewBoundsMm && !stacked && drawing.audience === 'gm'
      && drawing.artStyles?.some(look => (look.parameters.paintVersion ?? 0) >= 3)
      ? artStylePreviewCache(bundle, drawing, editor, verifiedRenderBlob) : undefined
    return renderRasterProjection(sources, align(source), { ...options, floorId: source.floorId ?? options.floorId,
      onMetrics: linkedFloor ? undefined : options.onMetrics }, preview, started, partition?.bounds, undefined, cache)
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
      const looks = drawing.artStyles
      const line = activeLineArt(looks)
      const canvas = await renderFloor(layer, drawing, true)
      try {
        checkCancelled(options.signal)
        if (!result) {
          result = document.createElement('canvas')
          result.width = canvas.width
          result.height = canvas.height
          context = result.getContext('2d', { willReadFrequently: !!line || !editor && options.longEdgePx === PNG_MAX_LONG_EDGE }) ?? undefined
          if (!context) throw new Error('无法创建楼层叠绘缓冲。')
          if (projection.outputBackground?.mode !== 'transparent') {
            context.fillStyle = projection.outputBackground?.mode === 'solid' ? projection.outputBackground.color : '#D8D5C5'
            context.fillRect(0, 0, result.width, result.height)
            if (looks && (line || usesSeparateArtStyle(looks))) applyArtStyleGrades(context, view, looks, options.signal, { lineArtEdges: null, bitmapLine: false })
          }
        }
        const ctx = context!, sx = result.width / view.width, sy = result.height / view.height
        const shadowAmount = artStyleLightAmount(looks)
        if (shadowAmount > 0) drawFloorShadows(ctx, view, planFloorShadows(drawing, lower, view, options.signal), shadowAmount)
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
  const [canvas, { encodePng }] = await Promise.all([renderProject(input, options), import('./canvas-renderer')])
  return encodePng(canvas, options.signal, options.onPngMetrics)
}

// Existing leaf prop names remain source-compatible while all data and runtime paths are native-v1.
export { renderEditorProject as renderEditorProjectV2 }
export type { RenderOptions as RenderOptionsV2, EditorProjectRenderOptions as EditorRenderOptionsV2 }

/** Actual public crop for explicitly authorized visual feedback. No editor LOD or hidden-layer state is used. */
export async function exportPublicViewportPng(input: ProjectBundle, boundsMm: import('../../../shared/model/scene.js').BoundsMm, longEdgePx = 768, signal?: AbortSignal, floorId?: string): Promise<Blob> {
  const values = [boundsMm.x, boundsMm.y, boundsMm.width, boundsMm.height, boundsMm.x + boundsMm.width, boundsMm.y + boundsMm.height]
  if (!values.every(Number.isSafeInteger) || boundsMm.width <= 0 || boundsMm.height <= 0) throw new Error('视觉回读范围须为有效整数毫米矩形。')
  if (!Number.isSafeInteger(longEdgePx) || longEdgePx < 256 || longEdgePx > PNG_MAX_LONG_EDGE) throw new Error('视觉回读长边须为256–4096整数像素。')
  checkCancelled(signal)
  const [bundle, { encodePng, renderRasterProjection }] = await Promise.all([
    validateProjectBundle(input, { ...browserProjectValidation, signal }),
    import('./canvas-renderer'),
  ])
  checkCancelled(signal)
  const scene = bundle.project.document
  const projection = projectScene(scene, 'player', bundle.project.appearance, { floorId }), b = projection.bounds
  if (boundsMm.x < b.x || boundsMm.y < b.y || boundsMm.x + boundsMm.width > b.x + b.width || boundsMm.y + boundsMm.height > b.y + b.height) throw new Error('视觉回读范围须完全落在固定导出范围内。')
  const sources = { assetRefs: scene.assets, assets: bundle.project.assets, resources: bundle.resources, vectorSources: bundle.project.authoringSources }
  return encodePng(await renderRasterProjection(sources, projection, { audience: 'player', longEdgePx, signal, ...(floorId === undefined ? {} : { floorId }) }, undefined, undefined, { ...boundsMm }), signal)
}
