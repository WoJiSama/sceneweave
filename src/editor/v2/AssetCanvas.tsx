import { useEffect, useRef, useState } from 'react'
import type { CompleteProjectV2 } from '../../io/v2/types'
import type { SceneDocumentV2 } from '../../core/v2/types'

const layerOrder = { ground: 0, object: 1, canopy: 2 }
const orderedProps = (scene: SceneDocumentV2) => Object.values(scene.props).sort((a, b) => layerOrder[a.renderLayer] - layerOrder[b.renderLayer] || a.renderOrder - b.renderOrder || a.id.localeCompare(b.id))

/** This B1 preview is deliberately limited; unsupported features never disappear into a success image. */
export function previewLimitations(scene: SceneDocumentV2): string[] {
  const messages: string[] = []
  if ([scene.terrainAreas, scene.terrainEdges, scene.terrainConnections, scene.paths].some(collection => Object.keys(collection).length)) messages.push('地形、边缘、高差连接或道路的绘制将在后续样板中开放')
  if (scene.activeStyleThemeRef) messages.push('主题描边、开口及阴影尚未接入')
  const styles = [...Object.values(scene.rooms).map(room => room.floorStyle), ...Object.values(scene.walls).map(wall => wall.topStyle)]
  if (styles.some(style => style && (style.overlays.length || style.base.tint))) messages.push('材质叠加与着色尚未接入')
  if (Object.values(scene.walls).some(wall => wall.topStyle)) messages.push('墙顶材质尚未接入')
  if (Object.values(scene.props).some(prop => prop.shadowClass !== 'none' || prop.shadowOverride || prop.appearance.tint)) messages.push('物件主题阴影与着色尚未接入')
  if (Object.values(scene.notes).some(note => note.anchor.type === 'entity' && !['prop', 'vertex', 'room', 'wall', 'opening', 'region'].includes(note.anchor.entityKind))) messages.push('此场景含尚未接入预览的注记锚点')
  return messages
}

function drawScene(ctx: CanvasRenderingContext2D, scene: SceneDocumentV2, bitmaps: Map<string, ImageBitmap>, selected: string | null) {
  const bounds = scene.exportBoundsMm, scale = Math.min(1200 / bounds.width, 900 / bounds.height)
  const width = Math.max(1, Math.round(bounds.width * scale)), height = Math.max(1, Math.round(bounds.height * scale))
  ctx.canvas.width = width; ctx.canvas.height = height
  ctx.fillStyle = '#e9e7de'; ctx.fillRect(0, 0, width, height)
  ctx.scale(width / bounds.width, height / bounds.height); ctx.translate(-bounds.x, -bounds.y)
  const polygon = (points: { x: number; y: number }[]) => {
    ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath()
  }
  for (const room of Object.values(scene.rooms)) {
    const points = room.boundaryVertexIds.map(id => ({ x: scene.vertices[id].xMm, y: scene.vertices[id].yMm }))
    ctx.save(); polygon(points); ctx.clip()
    ctx.fillStyle = room.visibility === 'gm' ? '#d7d0b9' : '#d8c9ad'; ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
    if (room.floorStyle) {
      const paint = room.floorStyle.base, material = scene.materials[paint.materialRef.id], asset = scene.assets[material.textureAssetId], image = bitmaps.get(asset.sha256)!
      const pattern = ctx.createPattern(image, 'repeat')!
      pattern.setTransform(new DOMMatrix().translate(paint.originMm.x, paint.originMm.y).rotate(paint.rotationDeg).scale(paint.tileSizeMm.width / asset.pixelWidth, paint.tileSizeMm.height / asset.pixelHeight))
      ctx.globalAlpha = paint.opacity; ctx.fillStyle = pattern; ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
    }
    ctx.restore()
  }
  for (const wall of Object.values(scene.walls)) {
    const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]
    ctx.strokeStyle = '#3f4841'; ctx.lineWidth = wall.thicknessMm; ctx.lineCap = 'butt'
    ctx.beginPath(); ctx.moveTo(a.xMm, a.yMm); ctx.lineTo(b.xMm, b.yMm); ctx.stroke()
  }
  for (const opening of Object.values(scene.openings)) {
    const wall = scene.walls[opening.wallId], start = scene.vertices[opening.offsetReferenceVertexId], end = scene.vertices[wall.startVertexId === start.id ? wall.endVertexId : wall.startVertexId]
    const length = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm), ux = (end.xMm - start.xMm) / length, uy = (end.yMm - start.yMm) / length
    const a = opening.offsetMm, b = a + opening.widthMm
    ctx.strokeStyle = '#e9e7de'; ctx.lineWidth = wall.thicknessMm + 2; ctx.lineCap = 'butt'
    ctx.beginPath(); ctx.moveTo(start.xMm + ux * a, start.yMm + uy * a); ctx.lineTo(start.xMm + ux * b, start.yMm + uy * b); ctx.stroke()
    ctx.save(); ctx.translate(start.xMm + ux * a, start.yMm + uy * a); ctx.rotate(Math.atan2(uy, ux))
    ctx.strokeStyle = opening.secret ? '#aa8550' : '#6c715e'; ctx.lineWidth = 32
    if (opening.kind === 'window') { ctx.strokeRect(0, -wall.thicknessMm / 3, opening.widthMm, wall.thicknessMm * 2 / 3) }
    else if (opening.state === 'closed') { ctx.strokeRect(0, -26, opening.widthMm, 52) }
    else { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -opening.widthMm); ctx.stroke(); ctx.setLineDash([60, 40]); ctx.beginPath(); ctx.arc(0, 0, opening.widthMm, -Math.PI / 2, 0); ctx.stroke() }
    ctx.restore()
  }
  for (const prop of orderedProps(scene)) {
    ctx.save(); ctx.translate(prop.positionMm.x, prop.positionMm.y); ctx.rotate(prop.rotationDeg * Math.PI / 180); ctx.globalAlpha = prop.appearance.opacity
    const visual = prop.visualBoundsMm
    if (prop.appearance.kind === 'image') ctx.drawImage(bitmaps.get(scene.assets[prop.appearance.assetId].sha256)!, visual.x, visual.y, visual.width, visual.height)
    else {
      const symbol = prop.appearance.symbol
      ctx.fillStyle = symbol === 'rug' ? '#a78a70' : symbol === 'chair' ? '#819071' : '#b29266'
      ctx.strokeStyle = prop.visibility === 'gm' ? '#aa8550' : '#534f40'; ctx.lineWidth = 24
      if (symbol === 'rug') ctx.setLineDash([80, 60])
      ctx.fillRect(visual.x, visual.y, visual.width, visual.height); ctx.strokeRect(visual.x, visual.y, visual.width, visual.height)
      if (symbol === 'shelf') for (let x = visual.x + 150; x < visual.x + visual.width - 100; x += 130) { ctx.beginPath(); ctx.moveTo(x, visual.y + 70); ctx.lineTo(x, visual.y + visual.height - 70); ctx.stroke() }
      if (symbol === 'crate') { ctx.beginPath(); ctx.moveTo(visual.x, visual.y); ctx.lineTo(visual.x + visual.width, visual.y + visual.height); ctx.moveTo(visual.x + visual.width, visual.y); ctx.lineTo(visual.x, visual.y + visual.height); ctx.stroke() }
    }
    if (prop.id === selected) {
      ctx.globalAlpha = 1; ctx.strokeStyle = '#307b68'; ctx.lineWidth = 20; ctx.setLineDash([70, 45]); ctx.strokeRect(visual.x - 50, visual.y - 50, visual.width + 100, visual.height + 100)
      ctx.strokeStyle = '#ab6836'; ctx.lineWidth = 12
      const { width: w, height: h } = prop.footprintMm, o = prop.footprintOffsetMm
      ctx.strokeRect(o.x - w / 2, o.y - h / 2, w, h)
    }
    ctx.restore()
  }
  // Host annotations remain ordinary scene data; no player-facing output is offered here.
  for (const region of Object.values(scene.regions)) {
    ctx.save(); polygon(region.boundaryMm); ctx.strokeStyle = region.visibility === 'gm' ? '#ab855b' : '#8a795a'; ctx.lineWidth = 20; ctx.setLineDash([90, 60]); ctx.stroke(); ctx.restore()
  }
  for (const note of Object.values(scene.notes)) {
    let position: { x: number; y: number } | null = note.anchor.type === 'point' ? note.anchor.positionMm : null
    if (note.anchor.type === 'entity') {
      const { entityKind: kind, entityId: id } = note.anchor
      if (kind === 'prop') position = scene.props[id]?.positionMm ?? null
      if (kind === 'vertex') { const vertex = scene.vertices[id]; if (vertex) position = { x: vertex.xMm, y: vertex.yMm } }
      if (kind === 'room') { const vertices = scene.rooms[id]?.boundaryVertexIds.map(key => scene.vertices[key]); if (vertices?.length) position = { x: vertices.reduce((sum, v) => sum + v.xMm, 0) / vertices.length, y: vertices.reduce((sum, v) => sum + v.yMm, 0) / vertices.length } }
      if (kind === 'wall') { const wall = scene.walls[id]; if (wall) { const a = scene.vertices[wall.startVertexId], b = scene.vertices[wall.endVertexId]; position = { x: (a.xMm + b.xMm) / 2, y: (a.yMm + b.yMm) / 2 } } }
      if (kind === 'opening') {
        const opening = scene.openings[id]
        if (opening) {
          const wall = scene.walls[opening.wallId], start = scene.vertices[opening.offsetReferenceVertexId], end = scene.vertices[wall.startVertexId === start.id ? wall.endVertexId : wall.startVertexId]
          const length = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm), distance = opening.offsetMm + opening.widthMm / 2
          position = { x: start.xMm + (end.xMm - start.xMm) / length * distance, y: start.yMm + (end.yMm - start.yMm) / length * distance }
        }
      }
      if (kind === 'region') { const points = scene.regions[id]?.boundaryMm; if (points?.length) position = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length } }
    }
    if (!position) continue
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${note.kind === 'label' ? 190 : 140}px sans-serif`
    const text = (note.kind === 'label' ? note.text : note.title ?? '主持人注记').slice(0, 100)
    const labelWidth = ctx.measureText(text).width
    ctx.fillStyle = '#faf7e9e8'; ctx.fillRect(position.x - labelWidth / 2 - 80, position.y - 125, labelWidth + 160, 250)
    ctx.fillStyle = note.visibility === 'gm' ? '#967649' : '#56614a'; ctx.fillText(text, position.x, position.y); ctx.restore()
  }
}

export default function AssetCanvas({ project, selected, onSelect }: { project: CompleteProjectV2; selected: string | null; onSelect: (id: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), token = useRef<object | null>(null)
  const [loaded, setLoaded] = useState<{ assets: CompleteProjectV2['assets']; token: object; bitmaps: Map<string, ImageBitmap> } | null>(null), [error, setError] = useState<string | null>(null)
  const limitations = previewLimitations(project.document)
  useEffect(() => {
    let cancelled = false
    const generation = {}; token.current = generation
    const bitmaps = new Map<string, ImageBitmap>()
    setLoaded(null); setError(null)
    void (async () => {
      try {
        for (const [hash, asset] of Object.entries(project.assets)) {
          const bitmap = await createImageBitmap(asset.blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
          if (cancelled) { bitmap.close(); return }
          if (bitmap.width !== asset.pixelWidth || bitmap.height !== asset.pixelHeight) { bitmap.close(); throw new Error('解码尺寸与工程不一致。') }
          bitmaps.set(hash, bitmap)
        }
        if (!cancelled) setLoaded({ assets: project.assets, token: generation, bitmaps })
      } catch (reason) { bitmaps.forEach(bitmap => bitmap.close()); if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) }
    })()
    return () => { cancelled = true; if (token.current === generation) token.current = null; bitmaps.forEach(bitmap => bitmap.close()) }
  }, [project.assets])
  useEffect(() => {
    if (!loaded || loaded.assets !== project.assets || loaded.token !== token.current || !canvas.current || limitations.length) return
    const ctx = canvas.current.getContext('2d', { colorSpace: 'srgb' })
    try { if (ctx) drawScene(ctx, project.document, loaded.bitmaps, selected) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [project.document, loaded, selected, limitations.length])
  if (error) return <div className="asset-preview-message" role="alert">资源无法绘制：{error}。完整工程仍保留。</div>
  if (limitations.length) return <div className="asset-preview-message"><strong>此工程超出 B1 预览范围</strong><ul>{limitations.map(item => <li key={item}>{item}</li>)}</ul><p>所有实体和资源均保存在工程中，可继续备份。此处暂不绘制不完整画面。</p></div>
  const isReady = loaded?.assets === project.assets && loaded?.token === token.current
  return <div className="asset-map-wrap" aria-busy={!isReady}>{!isReady && <div className="asset-preview-message">正在解码素材…</div>}<canvas ref={canvas} aria-label="材质场景主持人预览" style={{ visibility: isReady ? 'visible' : 'hidden' }} onClick={event => {
    const rect = event.currentTarget.getBoundingClientRect(), bounds = project.document.exportBoundsMm
    const world = { x: bounds.x + (event.clientX - rect.left) / rect.width * bounds.width, y: bounds.y + (event.clientY - rect.top) / rect.height * bounds.height }
    const props = orderedProps(project.document).reverse()
    onSelect(props.find(prop => {
      const rad = -prop.rotationDeg * Math.PI / 180, dx = world.x - prop.positionMm.x, dy = world.y - prop.positionMm.y
      const x = dx * Math.cos(rad) - dy * Math.sin(rad), y = dx * Math.sin(rad) + dy * Math.cos(rad), v = prop.visualBoundsMm
      return x >= v.x && y >= v.y && x <= v.x + v.width && y <= v.y + v.height
    })?.id ?? null)
  }}/></div>
}
