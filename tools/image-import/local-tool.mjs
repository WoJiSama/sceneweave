import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { writeVerified } from '../harness/io.mjs'
import { runLocalSegmentation } from './local-segmentation.mjs'

const bounds = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) })
const argumentsSchema = z.strictObject({ generation: z.number().int().nonnegative(), target: z.string().min(1).max(80).optional(),
  appearanceSource: z.enum(['original', 'working']).optional(),
  contextBounds: bounds, targetBounds: bounds,
  points: z.array(z.strictObject({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(), label: z.union([z.literal(0), z.literal(1)]) })).min(1).max(32),
  cleanup: z.strictObject({ fillHoles: z.number().int().min(0).max(4), removeIslands: z.number().int().min(0).max(4) }).optional() })
export const LOCAL_SEGMENTATION_TOOL = { name: 'image_import_local_segment',
  description: '显式启用的离线CPU分割：用房间上下文与少量正负点提出3个原图选区，保留分数、400%黑白棋盘预览及模型来源。分数不是质量判定；查看全部候选后用extract_item或set_selection采用。target仅选择已有物件拆出前的输入，不自动修改草稿。进程实测峰值约1.9GiB，非浏览器内置或付费服务。',
  inputSchema: z.toJSONSchema(argumentsSchema) }

/** Local inference remains outside the browser; the shared session owns all adoption and history. */
export async function executeLocalSegmentation(page, options, raw) {
  const args = argumentsSchema.parse(raw)
  const input = await page.evaluate(async args => {
    const session = window.imageImportTools, source = window.imageImportSource, state = session.inspect()
    if (args.generation !== state.generation) throw new Error('拆解草稿已变化，请读取新代次。')
    const index = args.target ? state.draft.layers.findIndex(layer => layer.id === args.target) : state.draft.layers.length
    if (index < 0) throw new Error('本机分割目标不存在。')
    const { replayImageLayers } = await import('/src/shared/image-import/layer-replay.ts')
    const { encodeImageImportPixels } = await import('/src/platform/browser/content/image-import-session.ts')
    const { sha256Text } = await import('/src/shared/validation/hash.ts')
    const { canonicalJson } = await import('/src/shared/validation/json.ts')
    const original = args.appearanceSource === 'original' || args.target && state.draft.layers[index].appearanceSource === 'original'
    const prior = original ? [] : state.draft.layers.slice(0, index)
    const bytes = prior.length ? await encodeImageImportPixels(replayImageLayers(source.pixels, prior, state.draft.repairSurfaces, { evidenceLayers: state.draft.layers }).remaining) : source.normalizedBytes
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    return { imageBase64: btoa(binary), sourceSha256: state.image.sha256, priorLayersHash: sha256Text(canonicalJson(prior)) }
  }, args)
  const directory = path.join(options.output, 'local-selection-' + randomUUID())
  await fs.mkdir(directory, { mode: 0o700 })
  try {
    const written = await writeVerified(directory, 'input.png', Buffer.from(input.imageBase64, 'base64'))
    const result = await runLocalSegmentation({ python: options.python, modelDir: options.localModelDir, pythonPath: options.pythonPath }, {
      protocol: 'sceneweave-local-segmentation/1', imagePath: path.join(directory, 'input.png'),
      contextBounds: args.contextBounds, targetBounds: args.targetBounds, points: args.points,
      postprocess: { fillHolesMaxPixels: args.cleanup?.fillHoles ?? 0, removeIslandsMaxPixels: args.cleanup?.removeIslands ?? 0 },
    })
    if (result.source.sha256 !== written.record.sha256) throw new Error('本机模型处理的输入摘要不匹配。')
    const candidates = result.candidates.map(candidate => {
      const mask = candidate.mask, data = new Uint8Array(mask.width * mask.height)
      let offset = 0
      for (let run = 0; run < mask.runs.length; run += 2) { data.fill(mask.runs[run + 1], offset, offset + mask.runs[run]); offset += mask.runs[run] }
      const touchesTargetBoundary = data.some((alpha, index) => alpha && (index < mask.width || index >= data.length - mask.width || index % mask.width === 0 || index % mask.width === mask.width - 1))
      const missedPositivePoints = args.points.filter(point => point.label === 1 && !data[(Math.floor(point.y) - mask.y) * mask.width + Math.floor(point.x) - mask.x]).length
      return { ...candidate, selectionMask: candidate.mask, touchesTargetBoundary, missedPositivePoints,
        warnings: [ ...(touchesTargetBoundary ? ['选区触及目标框，检查是否截断物件；目标框只是裁图范围。'] : []),
          ...(missedPositivePoints ? ['模型没有保留全部正点处像素；提示点不是硬画笔。'] : []) ], selectionOrigin: {
      method: 'local-slimsam', sourceSha256: input.sourceSha256, inputSha256: written.record.sha256, priorLayersHash: input.priorLayersHash,
      modelId: result.model.id, modelRevision: result.model.revision, modelFiles: result.model.files,
      contextBounds: args.contextBounds, targetBounds: args.targetBounds, points: args.points, candidateIndex: candidate.index,
      cleanup: { fillHoles: args.cleanup?.fillHoles ?? 0, removeIslands: args.cleanup?.removeIslands ?? 0 },
      } }
    })
    // Preview the same actual input bytes used by the model, including prior repairs.
    const previews = await page.evaluate(async ({ candidates, imageBase64, generation }) => {
      if (window.imageImportTools.inspect().generation !== generation) throw new Error('拆解草稿在分割期间已变化。')
      const { loadImageImportSource, encodeImageImportPixels } = await import('/src/platform/browser/content/image-import-session.ts')
      const { decodeSelectionMask } = await import('/src/shared/image-import/selection-mask.ts')
      const { imageItemReviewSheet } = await import('/src/shared/image-import/review.ts')
      const { scaleSourcePixels } = await import('/src/shared/image-import/sampling.ts')
      const source = await loadImageImportSource(Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0)))
      const encode = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s) }
      const target = candidates[0].mask, crop = { width: target.width, height: target.height, data: new Uint8ClampedArray(target.width * target.height * 4) }
      for (let y = 0; y < target.height; y++) crop.data.set(source.pixels.data.subarray(((target.y + y) * source.pixels.width + target.x) * 4,
        ((target.y + y) * source.pixels.width + target.x + target.width) * 4), y * target.width * 4)
      const sourcePreview = encode(await encodeImageImportPixels(scaleSourcePixels(crop, 4)))
      const outputs = []
      for (const candidate of candidates) {
        if (!candidate.foregroundPixels) { outputs.push({ index: candidate.index, empty: true }); continue }
        const mask = decodeSelectionMask(candidate.mask, source.pixels)
        const pixels = { width: mask.width, height: mask.height, data: new Uint8ClampedArray(mask.width * mask.height * 4) }
        for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
          const from = ((mask.boundsPx.y + y) * source.pixels.width + mask.boundsPx.x + x) * 4, to = (y * mask.width + x) * 4
          pixels.data.set(source.pixels.data.subarray(from, from + 3), to); pixels.data[to + 3] = Math.round(mask.data[y * mask.width + x] * source.pixels.data[from + 3] / 255)
        }
        outputs.push({ index: candidate.index, item: encode(await encodeImageImportPixels(pixels)),
          review: encode(await encodeImageImportPixels(imageItemReviewSheet(source.pixels, mask))) })
      }
      return { sourcePreview, outputs }
    }, { candidates, imageBase64: input.imageBase64, generation: args.generation })
    await writeVerified(directory, 'source-400.png', Buffer.from(previews.sourcePreview, 'base64'))
    const content = [{ type: 'text', text: '原图相同目标范围 · 400%，用于核对造型与描边。' }, { type: 'image', mimeType: 'image/png', data: previews.sourcePreview }]
    for (const preview of previews.outputs) {
      if (preview.empty) continue
      await writeVerified(directory, `candidate-${preview.index}.png`, Buffer.from(preview.item, 'base64'))
      await writeVerified(directory, `candidate-${preview.index}-400.png`, Buffer.from(preview.review, 'base64'))
      content.push({ type: 'text', text: `候选 ${preview.index} · 400% 黑／白／棋盘。模型分数不等于边缘质量。` }, { type: 'image', mimeType: 'image/png', data: preview.review })
    }
    const record = { generation: args.generation, directory, ...result, candidates, adoption: 'not-adopted' }
    await writeVerified(directory, 'candidates.json', Buffer.from(JSON.stringify(record, null, 2)))
    content.push({ type: 'text', text: JSON.stringify(record) })
    return content
  } catch (error) {
    await writeVerified(directory, 'failure.json', Buffer.from(JSON.stringify({ generation: args.generation, error: String(error), adoption: 'not-adopted' }))).catch(() => {})
    throw error
  }
}
