import type { CompleteProjectV6 } from '../../src/io/v6/types'
import { projectContentHashV6 } from '../../src/io/v6/project-file'

export async function m1dHash(bytes: ArrayBuffer | Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
}

/** Inspect actual complete-project bytes and native image decoding, independently of JSON metadata. */
export async function describeM1DProject(project: CompleteProjectV6) {
  const assets: Record<string, { sha256: string; actualHash: string; sizeBytes: number; actualSize: number; pixelWidth: number; pixelHeight: number; decodedWidth: number; decodedHeight: number; rgbaHash: string }> = {}
  for (const [key, record] of Object.entries(project.assets)) {
    const bitmap = await createImageBitmap(record.blob), canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    try {
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
      context.drawImage(bitmap, 0, 0)
      assets[key] = { sha256: record.sha256, actualHash: await m1dHash(await record.blob.arrayBuffer()), sizeBytes: record.sizeBytes, actualSize: record.blob.size,
        pixelWidth: record.pixelWidth, pixelHeight: record.pixelHeight, decodedWidth: bitmap.width, decodedHeight: bitmap.height,
        rgbaHash: await m1dHash(context.getImageData(0, 0, canvas.width, canvas.height).data) }
    } finally { bitmap.close(); canvas.width = canvas.height = 0 }
  }
  const licenses: Record<string, { sha256: string; text: string; actualHash: string }> = Object.fromEntries(await Promise.all(Object.entries(project.licenses).map(async ([key, license]) => [key, {
    ...license, actualHash: await m1dHash(new TextEncoder().encode(license.text)),
  }])))
  return { document: structuredClone(project.document), appearance: structuredClone(project.appearance), historyIdentity: structuredClone(project.historyIdentity),
    assets, licenses, licenseBindings: structuredClone(project.licenseBindings), contentHash: await projectContentHashV6(project) }
}

export async function describeM1DPng(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), chunks: string[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (offset + length + 12 > bytes.length) throw new Error('Truncated actual M1-D PNG chunk')
    chunks.push(type); offset += length + 12
  }
  const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0)
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
    // Fixed SCN-04 mask center: (14000, 9500), separate from public walls.
    const x = Math.floor(14000 / 36000 * canvas.width), y = Math.floor(9500 / 28000 * canvas.height)
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob)
    })
    return { width: bitmap.width, height: bitmap.height, rgbaHash: await m1dHash(rgba), byteHash: await m1dHash(bytes), bytes: bytes.length, chunks,
      metadata: chunks.filter(chunk => ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(chunk)),
      maskCenterPixel: [...context.getImageData(x, y, 1, 1).data], url }
  } finally { bitmap.close(); canvas.width = canvas.height = 0 }
}
