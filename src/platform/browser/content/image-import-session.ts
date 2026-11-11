import type { EditableProject } from '../../../application/workspace/project.js'
import { captureJson, freezeJson } from '../../../shared/validation/json.js'
import { cropImageRegion, imagePolygonMask, suggestImageRegion, type ImagePixels, type PixelBounds } from '../../../shared/image-import/pixels.js'
import { encodeSelectionMask, decodeSelectionMask, assertSelectionMaskBudget } from '../../../shared/image-import/selection-mask.js'
import { paintImageSelection, snapImageContour, type ImageSelectionStroke } from '../../../shared/image-import/selection.js'
import { imageImportToolArguments, parseImageImportRecipe, type ImageImportRecipe, type ImageImportToolName } from '../../../shared/image-import/recipe.js'
import { createImageCalibration, assertImagePoint } from '../../../shared/image-import/calibration.js'
import { createBrowserImagePort, normalizeBrowserImage } from '../images/adapter.js'
import { encodeSourcePng } from '../../../shared/project/png-rgba.js'
import { createImageImportProject } from './image-import-project.js'
import { vectorizeImageLayer, type ImageVectorOptions } from '../../../shared/image-import/vector.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { rasterizeCanonicalSvgPixels } from '../ai/svg-raster.js'
import { reconstructSourceLayers } from '../../../shared/image-import/reconstruction.js'
import { replayImageLayers } from '../../../shared/image-import/layer-replay.js'
import { scaleSourcePixels } from '../../../shared/image-import/sampling.js'
import { assertSourcePreservingRecipe, compareImageFidelity, IMAGE_IMPORT_FIDELITY_RULES, ImageFidelityError } from '../../../shared/image-import/fidelity.js'

export interface ImageImportSource { image: ImageImportRecipe['image']; pixels: ImagePixels }
export interface ImageImportRights { licenseText: string; attribution: string }

export async function loadImageImportSource(bytes: Uint8Array, mime = '', signal?: AbortSignal): Promise<ImageImportSource> {
  const normalized = await normalizeBrowserImage(bytes, mime, { signal })
  const raster = await createBrowserImagePort().decode(normalized.bytes, normalized.record, { signal })
  return { image: { sha256: normalized.record.sha256, pixelWidth: raster.width, pixelHeight: raster.height },
    pixels: { width: raster.width, height: raster.height, data: raster.rgba } }
}

export async function encodeImageImportPixels(pixels: ImagePixels, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  // Canvas premultiplication rounds RGB at partial coverage. The fixed encoder
  // retains every source channel alongside the independently edited alpha.
  const bytes = encodeSourcePng({ width: pixels.width, height: pixels.height, rgba: pixels.data })
  signal?.throwIfAborted()
  return bytes
}

/** Geometric mask coverage must not be mistaken for source material opacity. */
function materialPixels(pixels: ImagePixels, bounds: PixelBounds, unmasked: ImagePixels): ImagePixels {
  const data = pixels.data.slice()
  for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
    const index = (y * pixels.width + x) * 4
    if (data[index + 3]) data[index + 3] = unmasked.data[((bounds.y + y) * unmasked.width + bounds.x + x) * 4 + 3]
  }
  return { width: pixels.width, height: pixels.height, data }
}

export function replayImageImportRecipe(source: ImageImportSource, input: unknown) {
  const recipe = parseImageImportRecipe(input)
  if (recipe.image.sha256 !== source.image.sha256 || recipe.image.pixelWidth !== source.pixels.width || recipe.image.pixelHeight !== source.pixels.height) {
    throw new Error('拆解提案与当前原图身份或尺寸不符。')
  }
  assertSourcePreservingRecipe(recipe)
  const reconstructed = reconstructSourceLayers(source.pixels, recipe)
  return { ...reconstructed, layers: reconstructed.layers.map(layer => ({ ...layer, vectorPixels: undefined as ImagePixels | undefined })) }
}

/** Original-source comparison is independent of storage round trips. Masks are derived here. */
export async function prepareImageImportFidelityPreview(source: ImageImportSource, input: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const replay = replayImageImportRecipe(source, input)
  const visible = compareImageFidelity(replay.source, replay.composite, { scopeMask: replay.scopeMask, allowedInferenceMask: replay.edgeMask, comparisonKind: 'source' })
  const background = compareImageFidelity(source.pixels, replay.remaining, { scopeMask: replay.scopeMask, allowedInferenceMask: replay.inferenceMask, comparisonKind: 'source' })
  const difference = { width: source.pixels.width, height: source.pixels.height, data: new Uint8ClampedArray(source.pixels.data.length) }
  const inference = { width: source.pixels.width, height: source.pixels.height, data: replay.source.data.slice() }
  let occlusionPixels = 0
  for (let index = 0; index < replay.scopeMask.length; index++) {
    if (!replay.scopeMask[index]) continue
    const offset = index * 4
    if ([0, 1, 2, 3].some(channel => replay.source.data[offset + channel] !== replay.composite.data[offset + channel])) {
      difference.data.set(replay.edgeMask[index] ? [235, 165, 30, 255] : [225, 35, 45, 255], offset)
    }
    if (replay.inferenceMask[index]) {
      occlusionPixels++
      for (let channel = 0; channel < 3; channel++) inference.data[offset + channel] = Math.round(inference.data[offset + channel] * .55 + [35, 140, 235][channel] * .45)
    }
  }
  signal?.throwIfAborted()
  return { source: replay.source, composite: replay.composite, difference, inference,
    report: { ...visible, background, occlusionPixels, inferenceIsUnverified: true as const, sourceReport: replay.sourceReport } }
}

function reconstructedLayers(source: ImageImportSource, input: unknown) {
  const replay = replayImageImportRecipe(source, input)
  const reconstruct = (pixels: ImagePixels, boundsPx: PixelBounds, options?: ImageVectorOptions) => {
    if (!options) return { pixels, boundsPx, sourceSvg: undefined, stats: undefined, targetLongEdgePx: undefined }
    const result = vectorizeImageLayer(pixels, options)
    return { pixels, boundsPx, sourceSvg: result.sourceSvg, stats: result.stats, targetLongEdgePx: options.longEdgePx }
  }
  const cropped = replay.recipe.floorVector ? cropImageRegion(replay.remaining, replay.recipe.roomPointsPx) : null
  const floorPixels = cropped && replay.recipe.floorVector?.kind !== 'trace' ? materialPixels(cropped, cropped.boundsPx, replay.remaining) : cropped ?? replay.remaining
  const floor = reconstruct(floorPixels, cropped?.boundsPx ?? { x: 0, y: 0, width: replay.remaining.width, height: replay.remaining.height }, replay.recipe.floorVector)
  return { recipe: replay.recipe, floor, layers: replay.layers.map(layer => ({ ...layer, ...reconstruct(layer.vectorPixels ?? layer.pixels, layer.boundsPx, layer.vector) })) }
}

/** Actual vector pixels, shared by manual preview and the MCP reconstruction preview. */
export async function prepareImageImportVectorPreview(source: ImageImportSource, input: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const reconstructed = reconstructedLayers(source, input)
  const render = async (layer: typeof reconstructed.floor) => {
    signal?.throwIfAborted()
    if (!layer.sourceSvg) return { pixels: layer.pixels, boundsPx: layer.boundsPx }
    const normalized = normalizeStaticSvg(layer.sourceSvg), scale = (layer.targetLongEdgePx ?? 2048) / Math.max(normalized.viewBox.width, normalized.viewBox.height)
    const result = await rasterizeCanonicalSvgPixels(normalized, { width: Math.max(1, Math.round(normalized.viewBox.width * scale)), height: Math.max(1, Math.round(normalized.viewBox.height * scale)) }, signal)
    return { pixels: { width: result.width, height: result.height, data: new Uint8ClampedArray(result.rgba) }, boundsPx: layer.boundsPx }
  }
  const floor = await render(reconstructed.floor), layers = []
  for (const layer of reconstructed.layers) layers.push({ ...await render(layer), id: layer.id })
  signal?.throwIfAborted()
  return { floor, layers, stats: { floor: reconstructed.floor.stats, layers: reconstructed.layers.map(layer => ({ id: layer.id, ...layer.stats })) } }
}

/** Both the interactive page and model tools replay the same source pixels and recipe. */
export async function prepareImageImportRecipe(source: ImageImportSource, input: unknown, rights: ImageImportRights, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const credits = freezeJson(captureJson(rights))
  const replay = replayImageImportRecipe(source, input), assessment = await prepareImageImportFidelityPreview(source, replay.recipe, signal)
  if (!assessment.report.passed || !assessment.report.background.passed) throw new Error('原图保真检查失败：可见像素发生变化，不能创建工程。请检查差异图与推断区。')
  const raster = async (pixels: ImagePixels, boundsPx: PixelBounds) => {
    signal?.throwIfAborted()
    const output = scaleSourcePixels(pixels, replay.recipe.outputScale ?? 1)
    return { pngBytes: await encodeImageImportPixels(output, signal), pixelWidth: output.width, pixelHeight: output.height, boundsPx }
  }
  const floor = await raster(replay.floor, replay.floor.boundsPx)
  const layers = []
  for (const layer of [...replay.layers].reverse()) {
    layers.push({ ...await raster(layer.pixels, layer.boundsPx), id: layer.id, name: layer.name,
      renderLayer: layer.renderLayer, blocksMovement: layer.blocksMovement, ...(layer.footprintPx ? { footprintPx: layer.footprintPx } : {}) })
  }
  const project = await createImageImportProject({ title: replay.recipe.title, calibration: { ...replay.recipe.calibration,
    pixelWidth: replay.recipe.image.pixelWidth, pixelHeight: replay.recipe.image.pixelHeight }, roomPointsPx: replay.recipe.roomPointsPx,
    floor, layers, sourceArtwork: { kind: 'preserve-original', roomBoundaryPx: replay.recipe.roomPointsPx }, licenseText: credits.licenseText, attribution: credits.attribution }, signal)
  assertNativeSourceAppearance(project)
  return project
}

/** The renderer's normal theme must never silently repaint a source-backed import. */
function assertNativeSourceAppearance(project: EditableProject): void {
  const scene = project.document, room = Object.values(scene.rooms)[0], paint = room?.floorStyle?.base
  const theme = scene.activeStyleThemeRef ? scene.styleThemes[scene.activeStyleThemeRef.id] : undefined
  if (!paint || !theme || theme.outline.widthMm !== 0 || Object.values(theme.shadowPresets).some(shadow => shadow.opacity !== 0)) throw new ImageFidelityError('theme-override', '原图保真禁止默认墙描边或阴影覆盖原画。')
  for (const wall of Object.values(scene.walls)) {
    const source = wall.topStyle?.base
    if (!source || source.materialRef.id !== paint.materialRef.id || source.tint !== null || source.opacity !== 1 || source.rotationDeg !== paint.rotationDeg
      || source.originMm.x !== paint.originMm.x || source.originMm.y !== paint.originMm.y || source.tileSizeMm.width !== paint.tileSizeMm.width || source.tileSizeMm.height !== paint.tileSizeMm.height) throw new ImageFidelityError('theme-override', '墙体必须使用同坐标原画，不能替换为默认墙色或新材质。')
  }
  const art = Object.values(scene.props).filter(prop => prop.definitionRef && scene.propDefinitions[prop.definitionRef.id]?.tags.includes('source-building-art'))
  if (!art.length || art.some(prop => prop.roomId !== room.id || prop.supportRef?.kind !== 'room' || prop.supportRef.id !== room.id || prop.blocksMovement || prop.shadowClass !== 'none')) throw new ImageFidelityError('source-building-art-missing', '原图墙沿必须作为房间关联的源外观保全，不能遗漏或丢失受众关联。')
}

type Draft = Omit<ImageImportRecipe, 'format' | 'version' | 'image' | 'calibration'> & { calibration: ImageImportRecipe['calibration'] | null }

/** A host-owned session grants access to one image. Tool arguments never contain file paths or permissions. */
export class ImageImportToolSession {
  private generation = 0
  private draft: Draft = { title: '图片拆解场景', calibration: null, roomPointsPx: [], layers: [] }
  private history: Draft[] = []
  private source: ImageImportSource
  private readonly rights: ImageImportRights
  constructor(source: ImageImportSource, rights: ImageImportRights) {
    this.source = { image: freezeJson(captureJson(source.image)), pixels: { ...source.pixels, data: source.pixels.data.slice() } }
    this.rights = freezeJson(captureJson(rights))
  }
  inspect() { return freezeJson({ generation: this.generation, image: this.source.image, draft: captureJson(this.draft), fidelityRules: IMAGE_IMPORT_FIDELITY_RULES }) }
  private recipe(draft: Draft = this.draft): ImageImportRecipe {
    if (!draft.calibration) throw new Error('请先设置图片比例。')
    return parseImageImportRecipe({ format: 'sceneweave-image-import-recipe', version: 1, image: this.source.image, ...draft })
  }
  async execute(name: ImageImportToolName, input: unknown, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    if (!Object.hasOwn(imageImportToolArguments, name)) throw new Error('不支持的图片拆解工具。')
    const args = imageImportToolArguments[name].parse(captureJson(input))
    const startedGeneration = this.generation
    const assertCurrent = () => { signal?.throwIfAborted(); if (this.generation !== startedGeneration) throw new Error('拆解草稿在处理期间已变化，请重新预览。') }
    if ('generation' in args && args.generation !== this.generation) throw new Error('拆解草稿已变化，请读取新代次后重试。')
    if (name === 'image_import_inspect') return this.inspect()
    if (name === 'image_import_assess_fidelity') {
      const preview = await prepareImageImportFidelityPreview(this.source, this.recipe(this.draft), signal)
      assertCurrent()
      return { image: this.source.image, generation: startedGeneration, rules: IMAGE_IMPORT_FIDELITY_RULES, report: preview.report }
    }
    if (name === 'image_import_vector_source') {
      const { target } = args as { target: string }, replay = replayImageImportRecipe(this.source, this.recipe(this.draft))
      const cropped = target === 'floor' ? cropImageRegion(replay.remaining, replay.recipe.roomPointsPx) : undefined
      const item = replay.layers.find(layer => layer.id === target), options = target === 'floor' ? replay.recipe.floorVector : item?.vector
      if (!options || (!cropped && !item)) throw new Error('目标没有矢量源，请先设置矢量重建。')
      const pixels = cropped ? options.kind === 'trace' ? cropped : materialPixels(cropped, cropped.boundsPx, replay.remaining) : item!.vectorPixels ?? item!.pixels
      const result = vectorizeImageLayer(pixels, options)
      assertCurrent()
      return { target, ...result, boundsPx: cropped?.boundsPx ?? item!.boundsPx, generation: startedGeneration }
    }
    if (name === 'image_import_suggest_region') {
      const pixels = replayImageLayers(this.source.pixels, this.draft.layers).remaining
      const { mask, ...suggestion } = suggestImageRegion(pixels, args as unknown as Parameters<typeof suggestImageRegion>[1])
      return { ...suggestion, selectionMask: encodeSelectionMask(mask), generation: this.generation }
    }
    if (name === 'image_import_preview') {
      const view = args as { view: 'original' | 'remaining' | 'reconstructed' | 'difference' | 'inference' }
      if (view.view === 'difference' || view.view === 'inference') {
        const preview = await prepareImageImportFidelityPreview(this.source, this.recipe(this.draft), signal)
        const bytes = await encodeImageImportPixels(preview[view.view], signal)
        assertCurrent()
        return { mimeType: 'image/png', bytes, generation: startedGeneration }
      }
      if (view.view === 'reconstructed') {
        const project = await prepareImageImportRecipe(this.source, this.recipe(this.draft), this.rights, signal)
        const { exportPng } = await import('../render/renderer.js')
        const { toBundle } = await import('../../../application/workspace/project.js')
        const png = await exportPng(toBundle(project), { audience: 'player', longEdgePx: 2048, signal })
        const bytes = new Uint8Array(await png.arrayBuffer())
        assertCurrent()
        return { mimeType: 'image/png', bytes, generation: startedGeneration }
      }
      const pixels = view.view === 'remaining' ? replayImageLayers(this.source.pixels, this.draft.layers).remaining : this.source.pixels
      const bytes = await encodeImageImportPixels(pixels, signal)
      assertCurrent()
      return { mimeType: 'image/png', bytes, generation: startedGeneration }
    }
    if (name === 'image_import_build_project') {
      const title = (args as { title?: string }).title
      const recipe = this.recipe(title ? { ...this.draft, title } : this.draft)
      const project = await prepareImageImportRecipe(this.source, recipe, this.rights, signal)
      const sourceFidelity = (await prepareImageImportFidelityPreview(this.source, recipe, signal)).report
      assertCurrent()
      return { project, recipe, sourceFidelity, generation: startedGeneration }
    }
    if (name === 'image_import_undo') {
      const previous = this.history.at(-1)
      if (!previous) throw new Error('没有可撤销的拆解操作。')
      this.draft = previous; this.history = this.history.slice(0, -1); this.generation++
      return this.inspect()
    }
    let next = captureJson(this.draft)
    if (name === 'image_import_set_scale') {
      const { generation: ignored, ...calibration } = args as ImageImportRecipe['calibration'] & { generation: number }
      createImageCalibration({ ...calibration, pixelWidth: this.source.image.pixelWidth, pixelHeight: this.source.image.pixelHeight })
      next = { ...next, calibration }
    } else if (name === 'image_import_set_room') {
      next = { ...next, roomPointsPx: (args as unknown as { points: ImageImportRecipe['roomPointsPx'] }).points }
      for (const point of next.roomPointsPx) {
        if (point.x < 0 || point.y < 0 || point.x > this.source.image.pixelWidth || point.y > this.source.image.pixelHeight) throw new Error('房间轮廓超出原图。')
      }
    } else if (name === 'image_import_set_source_boundary') {
      const points = (args as unknown as { points: ImageImportRecipe['roomPointsPx'] }).points
      for (const point of points) assertImagePoint(this.source.image, point)
      next = { ...next, sourceBoundaryPx: points }
    } else if (name === 'image_import_set_output_scale') {
      next = { ...next, outputScale: (args as unknown as { scale: 1 | 2 | 4 }).scale }
    } else if (name === 'image_import_extract_item') {
      const { generation: ignored, ...layer } = args as ImageImportRecipe['layers'][number] & { generation: number }
      assertSourcePreservingRecipe({ layers: [layer] })
      if (next.layers.length >= 64 || next.layers.some(item => item.id === layer.id)) throw new Error('物件数量超限或身份重复。')
      if (layer.footprintPx) {
        assertImagePoint(this.source.image, { x: layer.footprintPx.x, y: layer.footprintPx.y })
        assertImagePoint(this.source.image, { x: layer.footprintPx.x + layer.footprintPx.width, y: layer.footprintPx.y + layer.footprintPx.height })
      }
      replayImageLayers(this.source.pixels, [...next.layers, layer])
      next = { ...next, layers: [...next.layers, layer] }
    } else if (name === 'image_import_refine_selection') {
      const { target, strokes, contour } = args as { target: string; strokes: ImageSelectionStroke[];
        contour?: { points: ImageImportRecipe['roomPointsPx']; radiusPx?: number } }
      const index = next.layers.findIndex(layer => layer.id === target)
      if (index < 0) throw new Error('精修目标不存在，请先拆出物件。')
      if (!contour && !strokes.length) throw new Error('请提供磁性轮廓或保留/排除笔迹。')
      const pixels = replayImageLayers(this.source.pixels, next.layers.slice(0, index)).remaining
      const layer = next.layers[index]
      let mask = contour
        ? imagePolygonMask(pixels, snapImageContour(pixels, contour.points, { radiusPx: contour.radiusPx, closed: true }))
        : layer.selectionMask ? decodeSelectionMask(layer.selectionMask, pixels) : imagePolygonMask(pixels, layer.polygon)
      for (const stroke of strokes) { assertCurrent(); mask = paintImageSelection(pixels, mask, stroke) }
      const selectionMask = encodeSelectionMask(mask)
      const { x, y, width, height } = mask.boundsPx
      const polygon = contour ? contour.points.length <= 256 ? contour.points
        : [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] : layer.polygon
      next = { ...next, layers: next.layers.map((row, position) => position === index ? { ...row, polygon, selectionMask } : row) }
      // Recompute every following occlusion before committing one atomic undo step.
      assertCurrent()
      replayImageLayers(this.source.pixels, next.layers)
      if (next.calibration && next.roomPointsPx.length >= 3) replayImageImportRecipe(this.source, this.recipe(next))
    } else if (name === 'image_import_set_vector') {
      const { target, options } = args as { target: string; options: ImageVectorOptions | null }
      if (options) assertSourcePreservingRecipe({ floorVector: options, layers: [] })
      if (target === 'floor') {
        if (options) next = { ...next, floorVector: options }
        else delete next.floorVector
      } else {
        const index = next.layers.findIndex(layer => layer.id === target)
        if (index < 0) throw new Error('矢量重建目标不存在，请先拆出物件。')
        const layer = { ...next.layers[index] }
        if (options) layer.vector = options
        else delete layer.vector
        next = { ...next, layers: next.layers.map((existing, position) => position === index ? layer : existing) }
      }
    } else if (name === 'image_import_apply_recipe') {
      const replay = replayImageImportRecipe(this.source, (args as unknown as { recipe: ImageImportRecipe }).recipe)
      const { format: ignoredFormat, version: ignoredVersion, image: ignoredImage, ...draft } = replay.recipe
      next = draft
    }
    assertCurrent()
    assertSelectionMaskBudget(next.layers.map(layer => layer.selectionMask))
    if (next.layers.length + 1 > 64) throw new Error('地板材质与拆出物件合计最多64项，请收窄采用范围。')
    this.history = [...this.history, this.draft]; this.draft = freezeJson(next); this.generation++
    return this.inspect()
  }
}
