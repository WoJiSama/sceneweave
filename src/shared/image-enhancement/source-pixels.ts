import type { RasterImage } from '../ports/resources.js'
import { decodeCanonicalPng } from '../project/png-rgba.js'

/**
 * The new colour-fringe recipe uses exact straight RGBA8 when its PNG supports
 * the bounded shared decoder. Native premultiplication rounding is not colour
 * contamination. Unsupported PNGs and other formats retain the existing image
 * adapter path; this optional decode never replaces full resource validation.
 */
export function tryDecodeDecontaminationSource(bytes: Uint8Array, mimeType: string): RasterImage | undefined {
  if (mimeType !== 'image/png') return undefined
  try { return decodeCanonicalPng(bytes) }
  catch { return undefined }
}
