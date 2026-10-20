import type { SceneDocument } from '../core/types'
import { drawProjection } from './draw'
import { projectScene } from './projection'
import type { Audience } from './projection'

export interface PngOptions { longEdge?: number; grid?: boolean; labels?: boolean }
export interface PngResult { blob: Blob; width: number; height: number; durationMs: number; sourceRevision: number }
export const PNG_MAX_LONG_EDGE = 4096
export const PNG_MAX_PIXELS = 16_777_216

/** A fresh canvas encoder adds no scene, text, asset-source or prompt metadata. */
export async function renderPng(scene: SceneDocument, audience: Audience, options: PngOptions = {}): Promise<PngResult> {
  const started = performance.now()
  const snapshot = structuredClone(scene)
  const projection = projectScene(snapshot, audience)
  const longEdge = options.longEdge ?? PNG_MAX_LONG_EDGE
  if (!Number.isInteger(longEdge) || longEdge < 256 || longEdge > PNG_MAX_LONG_EDGE) throw new Error(`PNG 长边须为 256–${PNG_MAX_LONG_EDGE} 整数像素；请下调导出尺寸。`)
  const scale = longEdge / Math.max(projection.bounds.width, projection.bounds.height)
  const width = Math.max(1, Math.round(projection.bounds.width * scale))
  const height = Math.max(1, Math.round(projection.bounds.height * scale))
  if (width * height > PNG_MAX_PIXELS) throw new Error('PNG 超过 16M 像素预算，请下调导出尺寸。')
  if (projection.props.some(prop => prop.assetId !== null)) throw new Error('M0 仅能导出原创程序符号；请先移除尚不支持的外部素材引用。')
  if (typeof document === 'undefined') throw new Error('PNG 导出需要支持 Canvas 的浏览器环境。')
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('浏览器无法建立导出画布，请下调尺寸或更换浏览器。')
  ctx.setTransform(width / projection.bounds.width, 0, 0, height / projection.bounds.height, -projection.bounds.x * width / projection.bounds.width, -projection.bounds.y * height / projection.bounds.height)
  try {
    drawProjection(ctx, projection, options)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 编码失败，请下调尺寸后重试。')), 'image/png'))
    return { blob, width, height, durationMs: performance.now() - started, sourceRevision: snapshot.revision }
  } finally {
    // Releasing the backing store matters when repeatedly exporting 4K previews.
    canvas.width = 1; canvas.height = 1
  }
}
