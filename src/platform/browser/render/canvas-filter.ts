export function supportsCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  return 'filter' in Object.getPrototypeOf(ctx)
}

/** Older canvases can soften the edge of the same public silhouette with a
 * native shadow. The caller owns state restoration and the final mask. */
export function setCanvasBlur(ctx: CanvasRenderingContext2D, pixels: number, color = 'transparent'): void {
  if (supportsCanvasFilter(ctx)) {
    ctx.filter = pixels > 0 ? `blur(${pixels}px)` : 'none'
    return
  }
  ctx.shadowBlur = pixels > 0 ? pixels * 2 : 0
  ctx.shadowColor = color
}
