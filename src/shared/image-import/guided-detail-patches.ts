import type { ImagePixels, PixelBounds } from './pixels.js'

export interface ImageSurfaceDetailPatch {
  /** User-declared purpose; this does not classify the original ink. */
  role: 'board-end' | 'nails' | 'gap'
  /** Replace only generated ink before paper and texture are composed. */
  mode?: 'replace-ink'
  /** Optional finite transition of generated ink only; omitted keeps hard replacement. */
  blendPx?: number
  reference: PixelBounds
  target: { x: number; y: number }
  reason: string
}
export interface PreparedSurfaceDetailPatch {
  target: PixelBounds
  ink: Float32Array
  mode?: 'replace-ink'
  blendPx?: number
}

const paper = (colors: number[][]) => {
  colors.sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2])
  return colors[Math.floor((colors.length - 1) * .8)]
}

/** Capture only complete trusted original tiles. The 2D residual is never
 * stretched, repeated, rotated or promoted to evidence about hidden structure. */
export function prepareImageSurfaceDetailPatches(image: ImagePixels, patches: readonly ImageSurfaceDetailPatch[], trusted: (x: number, y: number) => boolean,
  inSurface: (x: number, y: number) => boolean, cancel: () => void): PreparedSurfaceDetailPatch[] {
  if (!Array.isArray(patches) || patches.length > 16) throw new Error('二维笔迹最多16块。')
  const prepared: PreparedSurfaceDetailPatch[] = []
  for (const patch of patches) {
    cancel()
    const b = patch?.reference, t = patch?.target
    if (!patch || !['board-end', 'nails', 'gap'].includes(patch.role) || patch.mode !== undefined && patch.mode !== 'replace-ink'
      || patch.role === 'gap' && patch.mode !== 'replace-ink' || typeof patch.reason !== 'string' || !patch.reason.trim() || patch.reason.length > 400
      || !b || !t || ![b.x, b.y, b.width, b.height, t.x, t.y].every(Number.isSafeInteger)
      || b.x < 0 || b.y < 0 || b.width < 5 || b.height < 5 || b.width > 64 || b.height > 64
      || b.x + b.width > image.width || b.y + b.height > image.height || t.x < 0 || t.y < 0 || t.x + b.width > image.width || t.y + b.height > image.height) {
      throw new Error('二维笔迹须含明确角色和理由、原图内5至64像素宽高的完整参考，以及原尺寸整数目标坐标。')
    }
    if (patch.blendPx !== undefined && (patch.mode !== 'replace-ink' || !Number.isSafeInteger(patch.blendPx) || patch.blendPx < 1 || patch.blendPx > 4
      || Math.min(b.width, b.height) < patch.blendPx * 2 + 3)) throw new Error('笔迹过渡须显式用于替换模式、为1至4原像素，且宽高各保留至少3像素不混合核心。')
    const target = { ...t, width: b.width, height: b.height }
    if (prepared.some(other => target.x < other.target.x + other.target.width && target.x + target.width > other.target.x
      && target.y < other.target.y + other.target.height && target.y + target.height > other.target.y)) throw new Error('二维笔迹目标不能重叠，请分别判断局部用途。')
    // Validate every pixel before reading any reference RGB, including when
    // this patch does not participate in the current step's removal.
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
      if (!trusted(b.x + x, b.y + y)) throw new Error(`二维笔迹参考整块须为可信原图；不可信像素(${b.x + x}, ${b.y + y})。`)
      if (!inSurface(t.x + x, t.y + y)) throw new Error('二维笔迹目标整块须在当前底材范围内；它不增加移除权限。')
    }
    const ink = new Float32Array(b.width * b.height * 3)
    let strong = 0
    for (let y = 0; y < b.height; y++) {
      cancel()
      for (let x = 0; x < b.width; x++) {
        const colors: number[][] = []
        for (let dy = Math.max(0, y - 3); dy < Math.min(b.height, y + 4); dy++) for (let dx = Math.max(0, x - 3); dx < Math.min(b.width, x + 4); dx++) {
          const at = ((b.y + dy) * image.width + b.x + dx) * 4
          colors.push([image.data[at], image.data[at + 1], image.data[at + 2]])
        }
        const tone = paper(colors), at = ((b.y + y) * image.width + b.x + x) * 4
        const residual = tone.map((value, c) => Math.max(0, Math.min(180, value - image.data[at + c])))
        const depth = residual.reduce((sum, v) => sum + v, 0) / 3, weight = Math.max(0, Math.min(1, (depth - 4) / 8))
        if (depth >= 12) strong++
        for (let c = 0; c < 3; c++) ink[(y * b.width + x) * 3 + c] = residual[c] * weight
      }
    }
    if (!strong && patch.role !== 'gap') throw new Error('二维笔迹参考没有足够局部深色笔触；平色块不能补出板头或钉点。')
    prepared.push({ target, ink, ...(patch.mode ? { mode: patch.mode } : {}), ...(patch.blendPx ? { blendPx: patch.blendPx } : {}) })
  }
  cancel()
  return prepared
}

/** Explicit replacement clears only this solve's generated ink. Captured
 * paper, fine texture, alpha, and every pixel outside writable remain intact.
 * Source zeroes are significant: they preserve the declared original gap. */
export function replaceImageSurfaceDetailInk(ink: Float32Array, bounds: PixelBounds, patches: readonly PreparedSurfaceDetailPatch[],
  writable: (x: number, y: number) => boolean, cancel: () => void): void {
  for (const patch of patches) {
    if (patch.mode !== 'replace-ink') continue
    const b = patch.target
    // Distance uses only current write permissions, including protected holes.
    // This blends two generated ink fields, never reads hidden target RGB or
    // promotes the previous generated ink to original evidence.
    let edge: Uint8Array | undefined
    if (patch.blendPx) {
      edge = new Uint8Array(b.width * b.height)
      for (let y = 0; y < b.height; y++) {
        cancel()
        for (let x = 0; x < b.width; x++) {
          const i = y * b.width + x
          edge[i] = writable(b.x + x, b.y + y) ? Math.min(x + 1, y + 1, b.width - x, b.height - y,
            x ? edge[i - 1] + 1 : 1, y ? edge[i - b.width] + 1 : 1) : 0
        }
      }
      for (let y = b.height - 1; y >= 0; y--) {
        cancel()
        for (let x = b.width - 1; x >= 0; x--) {
          const i = y * b.width + x
          if (edge[i]) edge[i] = Math.min(edge[i], x + 1 < b.width ? edge[i + 1] + 1 : 1, y + 1 < b.height ? edge[i + b.width] + 1 : 1)
        }
      }
    }
    for (let y = 0; y < b.height; y++) {
      cancel()
      for (let x = 0; x < b.width; x++) {
        const px = b.x + x, py = b.y + y
        if (!writable(px, py)) continue
        const target = ((py - bounds.y) * bounds.width + px - bounds.x) * 3, source = (y * b.width + x) * 3
        if (!edge) ink.set(patch.ink.subarray(source, source + 3), target)
        else {
          const t = Math.min(1, Math.max(0, (edge[y * b.width + x] - 1) / patch.blendPx!)), weight = t * t * (3 - 2 * t)
          for (let c = 0; c < 3; c++) ink[target + c] += (patch.ink[source + c] - ink[target + c]) * weight
        }
      }
    }
  }
  cancel()
}

/** Only darken the already generated paper. Use a fixed pre-patch snapshot so
 * patch order cannot change the local paper estimate. Original context is
 * readable only when the caller's current evidence map permits it. */
export function applyImageSurfaceDetailPatches(base: ImagePixels, patches: readonly PreparedSurfaceDetailPatch[], writable: (x: number, y: number) => boolean,
  trusted: (x: number, y: number) => boolean, cancel: () => void): ImagePixels {
  if (!patches.length) return base
  const data = base.data.slice()
  for (const patch of patches) {
    if (patch.mode === 'replace-ink') continue
    const b = patch.target
    for (let y = 0; y < b.height; y++) {
      cancel()
      for (let x = 0; x < b.width; x++) {
        const px = b.x + x, py = b.y + y, inkAt = (y * b.width + x) * 3
        if (!writable(px, py) || !patch.ink.subarray(inkAt, inkAt + 3).some(Boolean)) continue
        const colors: number[][] = []
        for (let dy = Math.max(0, py - 3); dy < Math.min(base.height, py + 4); dy++) for (let dx = Math.max(0, px - 3); dx < Math.min(base.width, px + 4); dx++) {
          if (!writable(dx, dy) && !trusted(dx, dy)) continue
          const at = (dy * base.width + dx) * 4
          colors.push([base.data[at], base.data[at + 1], base.data[at + 2]])
        }
        const tone = paper(colors), at = (py * base.width + px) * 4
        for (let c = 0; c < 3; c++) data[at + c] = Math.min(base.data[at + c], Math.max(0, Math.round(tone[c] - patch.ink[inkAt + c])))
      }
    }
  }
  cancel()
  return { width: base.width, height: base.height, data }
}
