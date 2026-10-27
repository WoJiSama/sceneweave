import type { Projection } from '../../../shared/projection/types.js'

/** Draws the disposable public regional layer; no source links or private definitions enter the canvas. */
export function drawRegionalProjection(ctx: CanvasRenderingContext2D, projection: Projection, _scaleX: number, _scaleY: number, bitmaps: ReadonlyMap<string, CanvasImageSource>): void {
  const regional = projection.regional
  if (!regional) return
  const point = (p: { x: number; y: number }) => p
  for (const area of regional.areas) {
    ctx.save(); ctx.globalAlpha = area.style.opacity; ctx.fillStyle = area.style.fill; ctx.strokeStyle = area.style.stroke; ctx.lineWidth = area.style.strokeWidthMm
    const path = new Path2D(); area.points.forEach((p, i) => { const q = point(p); if (i) path.lineTo(q.x, q.y); else path.moveTo(q.x, q.y) }); path.closePath(); ctx.fill(path); ctx.stroke(path); ctx.restore()
  }
  for (const line of regional.lines) {
    ctx.save(); ctx.globalAlpha = line.style.opacity; ctx.strokeStyle = line.style.stroke; ctx.lineWidth = line.displayWidthMm; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); line.points.forEach((p, i) => { const q = point(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y) }); ctx.stroke(); ctx.restore()
  }
  const drawSymbol = (row: NonNullable<Projection['regional']>['symbols'][number] | NonNullable<Projection['regional']>['landmarks'][number]) => {
    const image = bitmaps.get(row.assetId)
    if (!image) throw new Error('区域图符所需位图没有完成解码。')
    const v = row.visualBoundsMm
    ctx.drawImage(image, row.positionMm.x + v.x - row.rootAnchorMm.x, row.positionMm.y + v.y - row.rootAnchorMm.y, v.width, v.height)
  }
  for (const landmark of regional.landmarks) {
    ctx.save(); drawSymbol(landmark)
    if (landmark.name) { ctx.fillStyle = '#263c30'; ctx.font = '24000px sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(landmark.name, landmark.positionMm.x + 15000, landmark.positionMm.y + 14000) }
    ctx.restore()
  }
  for (const symbol of [...regional.symbols].sort((a, b) => a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))) {
    ctx.save(); drawSymbol(symbol); ctx.restore()
  }
}
