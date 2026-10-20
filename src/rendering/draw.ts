import type { PointMm, Prop } from '../core/types'
import type { RenderNote, RenderProjection, RenderWall } from './projection'

export interface DrawOptions { grid?: boolean; labels?: boolean }
export const mapPalette = {
  background: '#e8dfca', floor: '#f4ecda', wall: '#34483e', ink: '#3c453b',
  grid: '#b9b29f', wood: '#a08259', woodLight: '#c1a57a', gold: '#b1843d',
} as const

function polygon(ctx: CanvasRenderingContext2D, points: PointMm[]): void {
  if (!points.length) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.closePath()
}

function drawGrid(ctx: CanvasRenderingContext2D, projection: RenderProjection): void {
  const { bounds, gridSizeMm: grid } = projection
  if (!Number.isFinite(grid) || grid < 100 || bounds.width / grid + bounds.height / grid > 10000) return
  ctx.strokeStyle = mapPalette.grid
  ctx.lineWidth = 12
  ctx.globalAlpha = 0.45
  ctx.beginPath()
  for (let x = Math.ceil(bounds.x / grid) * grid; x <= bounds.x + bounds.width; x += grid) {
    ctx.moveTo(x, bounds.y); ctx.lineTo(x, bounds.y + bounds.height)
  }
  for (let y = Math.ceil(bounds.y / grid) * grid; y <= bounds.y + bounds.height; y += grid) {
    ctx.moveTo(bounds.x, y); ctx.lineTo(bounds.x + bounds.width, y)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

function drawProp(ctx: CanvasRenderingContext2D, prop: Prop): void {
  const { width, height } = prop.footprintMm
  ctx.save()
  ctx.translate(prop.positionMm.x, prop.positionMm.y)
  ctx.rotate(prop.rotationDeg * Math.PI / 180)
  ctx.lineWidth = 25
  ctx.strokeStyle = '#6a6048'
  ctx.fillStyle = mapPalette.woodLight
  if (prop.symbol === 'rug') {
    ctx.fillStyle = '#b6a080'
    ctx.fillRect(-width / 2, -height / 2, width, height)
    ctx.strokeStyle = '#8b785a'
    ctx.strokeRect(-width / 2 + 100, -height / 2 + 100, width - 200, height - 200)
    ctx.strokeRect(-width / 2 + 180, -height / 2 + 180, width - 360, height - 360)
    ctx.globalAlpha = 0.45
    for (const y of [-height / 2 + 220, height / 2 - 220]) {
      ctx.beginPath()
      ctx.moveTo(-width / 2 + 250, y); ctx.lineTo(width / 2 - 250, y); ctx.stroke()
    }
    ctx.globalAlpha = 1
  } else if (prop.symbol === 'table') {
    for (const x of [-width / 2 + 90, width / 2 - 90]) for (const y of [-height / 2 + 90, height / 2 - 90]) {
      ctx.fillStyle = '#736048'; ctx.fillRect(x - 65, y - 65, 130, 130)
    }
    ctx.fillStyle = mapPalette.woodLight
    ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, Math.min(130, height / 6)); ctx.fill(); ctx.stroke()
    ctx.strokeStyle = '#ac8d61'
    ctx.lineWidth = 15
    for (const y of [-height / 4, height / 4]) {
      ctx.beginPath(); ctx.moveTo(-width / 2 + 100, y); ctx.lineTo(width / 2 - 100, y); ctx.stroke()
    }
  } else if (prop.symbol === 'chair') {
    ctx.fillStyle = '#b79b6c'
    ctx.fillRect(-width / 2 + 50, -height / 2 + 100, width - 100, height - 150)
    ctx.strokeRect(-width / 2 + 50, -height / 2 + 100, width - 100, height - 150)
    ctx.fillStyle = '#8b704a'
    ctx.fillRect(-width / 2, -height / 2, width, 115)
    ctx.strokeRect(-width / 2, -height / 2, width, 115)
  } else if (prop.symbol === 'shelf') {
    ctx.fillStyle = '#8c704d'
    ctx.fillRect(-width / 2, -height / 2, width, height)
    ctx.strokeRect(-width / 2, -height / 2, width, height)
    const count = Math.max(1, Math.min(40, Math.floor(width / 140)))
    const colors = ['#68735b', '#a28a63', '#77766a', '#9b6f50']
    for (let index = 0; index < count; index++) {
      const bookWidth = (width - 120) / count
      ctx.fillStyle = colors[index % colors.length]
      ctx.fillRect(-width / 2 + 60 + index * bookWidth, -height / 2 + 70, bookWidth - 18, height - 140)
    }
    ctx.strokeStyle = '#d0bb91'
    ctx.beginPath(); ctx.moveTo(-width / 2 + 50, 0); ctx.lineTo(width / 2 - 50, 0); ctx.stroke()
  } else {
    ctx.fillStyle = '#a28a62'
    ctx.fillRect(-width / 2, -height / 2, width, height)
    ctx.strokeRect(-width / 2, -height / 2, width, height)
    ctx.beginPath()
    ctx.moveTo(-width / 2 + 45, -height / 2 + 45); ctx.lineTo(width / 2 - 45, height / 2 - 45)
    ctx.moveTo(width / 2 - 45, -height / 2 + 45); ctx.lineTo(-width / 2 + 45, height / 2 - 45)
    ctx.stroke()
  }
  if (prop.visibility === 'gm') {
    ctx.strokeStyle = mapPalette.gold
    ctx.lineWidth = 22
    ctx.setLineDash([90, 65])
    ctx.strokeRect(-width / 2 - 50, -height / 2 - 50, width + 100, height + 100)
  }
  ctx.restore()
}

function drawWall(ctx: CanvasRenderingContext2D, wall: RenderWall): void {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
  if (length === 0) return
  ctx.save()
  ctx.translate(wall.start.x, wall.start.y)
  ctx.rotate(Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x))
  ctx.strokeStyle = mapPalette.wall
  ctx.fillStyle = mapPalette.wall
  ctx.lineWidth = wall.thicknessMm
  ctx.lineCap = 'butt'
  let cursor = 0
  for (const opening of [...wall.openings, { offsetMm: length, widthMm: 0 }]) {
    if (opening.offsetMm > cursor) {
      ctx.beginPath(); ctx.moveTo(cursor, 0); ctx.lineTo(opening.offsetMm, 0); ctx.stroke()
    }
    cursor = opening.offsetMm + opening.widthMm
  }
  // Endpoint squares close corners without shrinking the clear width of openings.
  for (const x of [0, length]) ctx.fillRect(x - wall.thicknessMm / 2, -wall.thicknessMm / 2, wall.thicknessMm, wall.thicknessMm)
  for (const opening of wall.openings) {
    const { offsetMm: offset, widthMm: width } = opening
    ctx.strokeStyle = opening.secret ? mapPalette.gold : '#746044'
    ctx.lineWidth = 36
    if (opening.kind === 'window') {
      ctx.strokeStyle = '#6f9391'
      for (const y of [-25, 25]) {
        ctx.beginPath(); ctx.moveTo(offset, y); ctx.lineTo(offset + width, y); ctx.stroke()
      }
      ctx.beginPath(); ctx.moveTo(offset + width / 2, -60); ctx.lineTo(offset + width / 2, 60); ctx.stroke()
    } else if (opening.state === 'closed') {
      ctx.beginPath(); ctx.moveTo(offset, 0); ctx.lineTo(offset + width, 0); ctx.stroke()
      if (opening.secret) {
        ctx.lineWidth = 18
        ctx.strokeRect(offset + width * 0.15, -85, width * 0.7, 170)
      }
    } else {
      ctx.beginPath(); ctx.moveTo(offset, 0); ctx.lineTo(offset, width); ctx.stroke()
      ctx.save()
      ctx.globalAlpha = 0.45; ctx.lineWidth = 15; ctx.setLineDash([65, 55])
      ctx.beginPath(); ctx.arc(offset, 0, width, 0, Math.PI / 2); ctx.stroke()
      ctx.restore()
    }
  }
  ctx.restore()
}

function drawNote(ctx: CanvasRenderingContext2D, note: RenderNote): void {
  ctx.save()
  ctx.translate(note.positionMm.x, note.positionMm.y)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const isLabel = note.kind === 'label'
  const text = isLabel ? note.text : note.title || (note.kind === 'clue' ? '线索' : '注记')
  ctx.font = isLabel ? '500 330px Georgia, "Songti SC", serif' : '500 230px system-ui, sans-serif'
  const maxWidth = isLabel ? 5200 : 2600
  const textWidth = Math.min(ctx.measureText(text).width, maxWidth)
  ctx.fillStyle = note.visibility === 'gm' ? '#eee1bd' : '#f4ecda'
  ctx.globalAlpha = 0.94
  ctx.fillRect(-textWidth / 2 - 120, -210, textWidth + 240, 420)
  ctx.globalAlpha = 1
  ctx.fillStyle = note.visibility === 'gm' ? '#937036' : mapPalette.ink
  ctx.fillText(text, 0, 0, maxWidth)
  if (note.kind === 'clue') {
    ctx.strokeStyle = mapPalette.gold; ctx.lineWidth = 25
    ctx.beginPath(); ctx.arc(-textWidth / 2 - 260, 0, 105, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-textWidth / 2 - 260, -55); ctx.lineTo(-textWidth / 2 - 260, 20); ctx.stroke()
    ctx.fillRect(-textWidth / 2 - 273, 50, 26, 26)
  }
  ctx.restore()
}

/** Draw in integer-mm world coordinates; caller owns the canvas and its transform. */
export function drawProjection(ctx: CanvasRenderingContext2D, projection: RenderProjection, options: DrawOptions = {}): void {
  const { bounds } = projection
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = 'transparent'
  ctx.filter = 'none'
  ctx.setLineDash([])
  ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height); ctx.clip()
  ctx.fillStyle = mapPalette.background
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  for (const room of projection.rooms) {
    polygon(ctx, room.points)
    ctx.fillStyle = room.visibility === 'gm' ? '#e4dbc4' : mapPalette.floor
    ctx.fill()
  }
  if (options.grid !== false) drawGrid(ctx, projection)
  for (const region of projection.regions) {
    polygon(ctx, region.boundaryMm)
    ctx.fillStyle = region.kind === 'hazard' ? '#be956b' : '#b3baa0'
    ctx.globalAlpha = 0.4; ctx.fill(); ctx.globalAlpha = 1
    ctx.strokeStyle = '#8c8e71'; ctx.lineWidth = 20; ctx.stroke()
  }
  // Rugs belong below furniture independent of collection insertion order.
  for (const prop of projection.props.filter(prop => prop.symbol === 'rug')) drawProp(ctx, prop)
  for (const prop of projection.props.filter(prop => prop.symbol !== 'rug')) drawProp(ctx, prop)
  for (const wall of projection.walls) drawWall(ctx, wall)
  if (options.labels !== false) for (const note of projection.notes) drawNote(ctx, note)
  for (const mask of projection.masks) {
    polygon(ctx, mask)
    if (projection.audience === 'player') {
      ctx.globalAlpha = 1
      ctx.fillStyle = mapPalette.background
      ctx.fill()
    } else {
      ctx.strokeStyle = '#b1843d'; ctx.lineWidth = 20; ctx.setLineDash([130, 90]); ctx.stroke(); ctx.setLineDash([])
    }
  }
  ctx.restore()
}
