import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import type { ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { maskCoverage } from './repair-scope.js'

export interface StructureMotifReport {
  algorithm: 'structure-motif-observations-v1'
  gates: { contrast: 12; radiusPx: 3; minimumComponentPixels: 2; minimumOriginalPixels: 3; connectivity: 8 }
  /** components/anchoredComponents count whole components. uncertainComponents
   * also includes distinct off-axis fragments of anchored components. */
  counts: { components: number; anchoredComponents: number; uncertainComponents: number; branchComponents: number; uncertainPixels: number; unlistedComponents: number; unlistedPixels: number; branchScanSkippedComponents: number }
  sites: Array<{
    boundsPx: PixelBounds
    pixels: number
    originalDarkPixels: number
    kind: 'component' | 'branch'
    extent: 'along' | 'across' | 'compact'
    instruction: string
  }>
  limitation: string
}

/** Detect candidate dark connected components with little ORIGINAL continuation.
 * Geometry and local contrast are observations, never semantic plank/nail labels.
 * Source RGB is read only outside this step's write mask and after trusted().
 * Repaired pixels are used only for the actual writable area. No resynthesis. */
export function inspectImageStructureMotifs(source: ImagePixels, repaired: ImagePixels, surface: ImagePixelMask, writable: ImagePixelMask,
  trusted: (x: number, y: number) => boolean, orientation: 'horizontal' | 'vertical', signal?: ImageNeighborhoodSignal): StructureMotifReport {
  const cancel = () => { signal?.throwIfAborted?.(); if (signal?.aborted) throw new Error('补图笔迹检查已取消。') }
  cancel()
  if (!source || !repaired || ![source.width, source.height].every(Number.isSafeInteger) || source.width < 1 || source.height < 1 || source.width > 8192 || source.height > 8192
    || source.width * source.height > 32_000_000 || repaired.width !== source.width || repaired.height !== source.height
    || !(source.data instanceof Uint8ClampedArray) || !(repaired.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height * 4 || repaired.data.length !== source.data.length
    || orientation !== 'horizontal' && orientation !== 'vertical') throw new Error('补图笔迹检查需要同尺寸完整有界RGBA及明确纹向。')
  for (const mask of [surface, writable]) {
    const b = mask?.boundsPx
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isSafeInteger) || b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1 || b.x + b.width > source.width || b.y + b.height > source.height
      || mask.width !== b.width || mask.height !== b.height || mask.width * mask.height > (mask === writable ? 250_000 : 1_000_000)
      || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height || mask.data.some(v => v !== 0 && v !== 255)) throw new Error('补图笔迹检查需要原图内二值范围；写入图框最多25万像素。')
  }
  const b = writable.boundsPx, x0 = Math.max(0, b.x - 3), y0 = Math.max(0, b.y - 3)
  const width = Math.min(source.width, b.x + b.width + 3) - x0, height = Math.min(source.height, b.y + b.height + 3) - y0, size = width * height
  const lum = new Float32Array(size), valid = new Uint8Array(size), writes = new Uint8Array(size), dark = new Uint8Array(size)
  // Capture allowed colours once. Neither hidden original RGB nor non-writable
  // repaired context may influence the contrast field or component selection.
  for (let y = 0; y < height; y++) {
    cancel()
    for (let x = 0; x < width; x++) {
      const sx = x + x0, sy = y + y0, i = y * width + x, at = (sy * source.width + sx) * 4
      if (!maskCoverage(surface, sx, sy)) continue
      const write = !!maskCoverage(writable, sx, sy)
      if (!write && !trusted(sx, sy)) continue
      const data = write ? repaired.data : source.data
      if (data[at + 3] !== 255) continue
      valid[i] = 1; writes[i] = +write
      lum[i] = (data[at] + data[at + 1] + data[at + 2]) / 3
    }
  }
  for (let y = 0; y < height; y++) {
    cancel()
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!valid[i]) continue
      const values = [lum[i]]
      for (let d = -3; d <= 3; d++) if (d) {
        if (x + d >= 0 && x + d < width && valid[i + d]) values.push(lum[i + d])
        if (y + d >= 0 && y + d < height && valid[i + d * width]) values.push(lum[i + d * width])
      }
      if (values.length < 6) continue
      values.sort((a, b) => a - b)
      if (values[Math.floor((values.length - 1) * .75)] - lum[i] >= 12) dark[i] = 1
    }
  }
  const report: StructureMotifReport = { algorithm: 'structure-motif-observations-v1',
    gates: { contrast: 12, radiusPx: 3, minimumComponentPixels: 2, minimumOriginalPixels: 3, connectivity: 8 },
    counts: { components: 0, anchoredComponents: 0, uncertainComponents: 0, branchComponents: 0, uncertainPixels: 0, unlistedComponents: 0, unlistedPixels: 0, branchScanSkippedComponents: 0 }, sites: [],
    limitation: '仅以补区及外侧3px内允许的原图局部对比和八邻接分量提示，最多定位六处；整分量至少3个原图深色像素只表示局部锚点数量。另查长分量偏离局部主线至少3px的分叉，分叉不能借主线的原图锚点通过；13px窗口和有限扫描仍可能漏掉弯线／浅分叉，也可能提示真实板头。未决组数含这些分叉。形状不认证缝线角色、远端连续性或视觉质量；宽色块、低对比笔迹、完全隐藏且未生成的原板头及3px之外均可能漏检。提示不修改补图，也不授权添加、擦除或扩大范围。',
  }
  const queue = new Uint32Array(size)
  let branchWork = 0
  const record = (pixels: number, originals: number, left: number, top: number, right: number, bottom: number, kind: 'component' | 'branch') => {
    report.counts.uncertainComponents++; report.counts.uncertainPixels += pixels
    if (kind === 'branch') report.counts.branchComponents++
    if (report.sites.length === 6) { report.counts.unlistedComponents++; report.counts.unlistedPixels += pixels; return }
    const bw = right - left + 1, bh = bottom - top + 1, along = orientation === 'horizontal' ? bw : bh, across = orientation === 'horizontal' ? bh : bw
    const extent = along >= across * 4 ? 'along' : across >= along * 4 ? 'across' : 'compact'
    report.sites.push({ boundsPx: { x: x0 + left, y: y0 + top, width: bw, height: bh }, pixels, originalDarkPixels: originals, extent, kind,
      instruction: `这组${kind === 'branch' ? '偏离长线的分叉' : '补图深色笔迹'}有${pixels}px，仅连到${originals}个可见原图深色像素${kind === 'branch' ? '；不借主线锚点确认分叉' : ''}。请局部判断是应保留的钉点／板头、需接续的板缝，还是不合适的补片笔迹；对照附近同材质原图，必要时补少量结构辅助或换取样。形状和颜色相似不能确认隐藏角色，不自动擦除或补线。` })
  }
  for (let start = 0; start < size; start++) {
    if (!dark[start]) continue
    cancel()
    let head = 0, tail = 1, pixels = 0, originals = 0, left = width, top = height, right = -1, bottom = -1
    queue[0] = start; dark[start] = 0
    while (head < tail) {
      if ((head & 1023) === 0) cancel()
      const i = queue[head++], x = i % width, y = Math.floor(i / width)
      if (writes[i]) { pixels++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) } else originals++
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue
        const next = i + dy * width + dx
        if (dark[next]) { dark[next] = 0; queue[tail++] = next }
      }
    }
    if (pixels < 2) continue
    report.counts.components++
    if (originals < 3) { record(pixels, originals, left, top, right, bottom, 'component'); continue }
    report.counts.anchoredComponents++
    // A nail or board-end connected to a long anchored seam must not inherit
    // that seam's evidence. Inspect only clear off-axis fragments separately.
    let fullLeft = width, fullTop = height, fullRight = -1, fullBottom = -1
    for (let n = 0; n < tail; n++) { const i = queue[n], x = i % width, y = Math.floor(i / width); fullLeft = Math.min(fullLeft, x); fullRight = Math.max(fullRight, x); fullTop = Math.min(fullTop, y); fullBottom = Math.max(fullBottom, y) }
    const horizontal = orientation === 'horizontal', u0 = horizontal ? fullLeft : fullTop, v0 = horizontal ? fullTop : fullLeft
    const along = (horizontal ? fullRight - fullLeft : fullBottom - fullTop) + 1, across = (horizontal ? fullBottom - fullTop : fullRight - fullLeft) + 1
    if (along < 12 || along < across * 3) continue
    branchWork += along * across + tail
    if (branchWork > 8_000_000) { report.counts.branchScanSkippedComponents++; continue }
    const slices: number[][] = Array.from({ length: along }, () => []), frequencies = new Uint32Array(across), spine = new Int32Array(along)
    for (let n = 0; n < tail; n++) { const i = queue[n], x = i % width, y = Math.floor(i / width); slices[(horizontal ? x : y) - u0].push((horizontal ? y : x) - v0) }
    for (let u = 0; u < Math.min(along, 6); u++) for (const v of slices[u]) frequencies[v]++
    for (let u = 0; u < along; u++) {
      if (u + 6 < along) for (const v of slices[u + 6]) frequencies[v]++
      if (u >= 7) for (const v of slices[u - 7]) frequencies[v]--
      let peak = 0
      for (let v = 1; v < across; v++) if (frequencies[v] > frequencies[peak]) peak = v
      spine[u] = peak
    }
    const offAxis = new Set<number>()
    for (let n = 0; n < tail; n++) { const i = queue[n], x = i % width, y = Math.floor(i / width); if (Math.abs((horizontal ? y : x) - v0 - spine[(horizontal ? x : y) - u0]) >= 3) offAxis.add(i) }
    for (const seed of offAxis) {
      offAxis.delete(seed)
      const pending = [seed]; let p = 0, o = 0, l = width, t = height, r = -1, b = -1
      for (let n = 0; n < pending.length; n++) {
        const i = pending[n], x = i % width, y = Math.floor(i / width)
        if (writes[i]) { p++; l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y) } else o++
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) {
          const next = i + dy * width + dx
          if (offAxis.delete(next)) pending.push(next)
        }
      }
      if (p >= 2 && o < 3) record(p, o, l, t, r, b, 'branch')
    }
  }
  cancel()
  return report
}
