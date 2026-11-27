import { traceMapReference, type MapReferenceIssue, type MapReferenceResult } from '../../../shared/generation/map-reference.js'
import type { MapLandform, MapShallowZone } from '../../../shared/generation/map-authoring.js'
import type { ImagePixels } from '../../../shared/image-import/pixels.js'
import type { PointMm } from '../../../shared/model/scene.js'
import { decodeBrowserSourceImage } from '../images/adapter.js'

export async function readMapReference(bytes: Uint8Array, signal?: AbortSignal): Promise<ImagePixels> {
  const { rgba, width, height } = await decodeBrowserSourceImage(bytes, signal)
  return { data: rgba, width, height }
}

export async function traceReferencePreview(bytes: Uint8Array, guide: unknown) {
  const image = await readMapReference(bytes), result = traceMapReference(image, guide)
  const overlay = await drawReferenceOverlay(image, result)
  return { result, overlay }
}

export function drawReferenceIssues(ctx: CanvasRenderingContext2D, issues: readonly MapReferenceIssue[], scale: number) {
  ctx.save()
  ctx.font = `bold ${13 / scale}px sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.lineWidth = 1.4 / scale
  for (const [index, { at }] of issues.entries()) {
    const radius = 9 / scale
    const x = Math.max(radius, Math.min(ctx.canvas.width / scale - radius, at.x))
    const y = Math.max(radius, Math.min(ctx.canvas.height / scale - radius, at.y))
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#933F25'; ctx.fill()
    ctx.strokeStyle = '#FFEDD9'; ctx.stroke()
    ctx.fillStyle = '#FFF'; ctx.fillText(String(index + 1), x, y)
  }
  ctx.restore()
}

export function drawReferenceFeatures(ctx: CanvasRenderingContext2D, landforms: readonly MapLandform[], shallows: readonly MapShallowZone[], scale: number) {
  const trace = (points: PointMm[], color: string, fill?: string) => {
    ctx.beginPath()
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
    if (fill) { ctx.closePath(); ctx.fillStyle = fill; ctx.fill() }
    ctx.strokeStyle = color; ctx.stroke()
  }
  ctx.save()
  ctx.lineWidth = 2.1 / scale
  ctx.lineJoin = 'round'
  for (const { boundary } of shallows) trace(boundary, '#92F0F9', '#31E1EE35')
  for (const { structure } of landforms) if (structure) {
    if (structure.kind === 'area') trace(structure.boundary, '#FFB95F', '#FFB95F28')
    else trace(structure.centerline, '#FFB95F')
    if (structure.breakline) {
      ctx.setLineDash([5 / scale, 3 / scale])
      trace(structure.breakline, '#FF596F')
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}

async function drawReferenceOverlay(image: ImagePixels, result: MapReferenceResult): Promise<Blob> {
  const source = document.createElement('canvas'), canvas = document.createElement('canvas')
  try {
    source.width = image.width; source.height = image.height
    const ctx = source.getContext('2d')!, pixels = ctx.createImageData(image.width, image.height)
    pixels.data.set(image.data); ctx.putImageData(pixels, 0, 0)
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
    const output = canvas.getContext('2d')!
    output.drawImage(source, 0, 0, canvas.width, canvas.height)
    output.scale(scale, scale)
    output.lineWidth = 2.5 / scale
    output.lineJoin = 'round'
    output.font = `bold ${15 / scale}px sans-serif`
    const lakeIds = new Set(result.lakes.map(row => row.id))
    for (const { boundary, id } of [...result.regions, ...result.lakes]) {
      const lake = lakeIds.has(id)
      output.strokeStyle = lake ? '#5CF2FF' : id === 'main' ? '#79FFAA' : '#FFDC7A'
      output.fillStyle = lake ? '#136CE955' : '#1B8D572A'
      output.beginPath()
      boundary.forEach((p, i) => i ? output.lineTo(p.x, p.y) : output.moveTo(p.x, p.y))
      output.closePath(); output.fill(); output.stroke()
      const anchor = boundary.reduce((top, p) => p.y < top.y ? p : top)
      const x = Math.max(6 / scale, Math.min(image.width - output.measureText(id).width - 5 / scale, anchor.x))
      const y = Math.max(18 / scale, Math.min(image.height - 5 / scale, anchor.y - 4 / scale))
      output.save()
      output.strokeStyle = '#152522'; output.lineWidth = 4 / scale
      output.strokeText(id, x, y)
      output.fillStyle = '#FFFDF5'; output.fillText(id, x, y)
      output.restore()
    }
    if (result.request.recipe.kind === 'landscape') drawReferenceFeatures(output, result.request.recipe.landforms, result.coastFeatures.shallows, scale)
    for (const [key, color] of [['background', '#5CF2FF'], ['foreground', '#79FFAA'], ['keep', '#FFF170'], ['shallow', '#97DED2'], ['omit', '#FF967A']] as const) {
      for (const p of result.guide[key]) {
        output.beginPath(); output.arc(p.x, p.y, 4 / scale, 0, Math.PI * 2)
        output.fillStyle = color; output.fill()
        output.strokeStyle = '#162322'; output.stroke()
      }
    }
    drawReferenceIssues(output, result.issues, scale)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('参考图叠图编码失败。')), 'image/png'))
  } finally {
    canvas.width = source.width = 0
    canvas.height = source.height = 0
  }
}
