import type { VisualEdgeLook } from './types.js'

/** Conservative world-space reach of the native continuous edge painter.
 * Bounded miter joins reach 2 widths and shore blur reaches another .48 width.
 * Arc details have a tangent radius up to .55 * repeatMm, independent of width;
 * fixed minimum strokes/marks need room even when widthMm is only 1 mm.
 * This bounds paint only and does not change the saved geometry or seed. */
export function edgeLookPaintPadding(look: Pick<VisualEdgeLook, 'kind' | 'widthMm' | 'repeatMm' | 'intensity'>): number {
  if (![look.widthMm, look.repeatMm, look.intensity].every(Number.isFinite) || look.widthMm <= 0 || look.repeatMm <= 0 || look.intensity < 0) throw new Error('边带绘制包络需要有效宽度、重复间距和强度。')
  // Cliff details are clipped to the relief face; fence marks depend on width.
  const repeatedDetail = look.intensity > 0 && look.kind !== 'cliff' && look.kind !== 'fence' ? look.repeatMm * .55 : 0
  return look.widthMm * 2.5 + repeatedDetail + 24
}

/** square cap / miterLimit 2 reaches at most one full width on either axis;
 * integer-mm materialization can round outward by another .5 mm. */
export const transitionStrokePaintPadding = (widthMm: number): number => widthMm + 1
