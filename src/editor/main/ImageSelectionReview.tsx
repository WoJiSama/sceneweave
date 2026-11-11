import { useEffect, useRef, useState } from 'react'
import type { ImagePixelMask, ImagePixels } from '../../shared/image-import/pixels'

interface Props { image: ImagePixels; mask: ImagePixelMask }

/** Review the actual extracted pixels without touching the draft's coordinates. */
export default function ImageSelectionReview({ image, mask }: Props) {
  const [background, setBackground] = useState('checker')
  const [angle, setAngle] = useState(0), [offset, setOffset] = useState({ x: 0, y: 0 })
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; before: { x: number; y: number } } | null>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const context = target.getContext('2d')!
    const surface = document.createElement('canvas')
    surface.width = mask.width; surface.height = mask.height
    const source = surface.getContext('2d')!, pixels = source.createImageData(mask.width, mask.height)
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const index = y * mask.width + x, from = ((mask.boundsPx.y + y) * image.width + mask.boundsPx.x + x) * 4
      pixels.data.set(image.data.subarray(from, from + 3), index * 4)
      pixels.data[index * 4 + 3] = Math.round(image.data[from + 3] * mask.data[index] / 255)
    }
    source.putImageData(pixels, 0, 0)
    context.clearRect(0, 0, target.width, target.height)
    const scale = Math.min((target.width - 72) / mask.width, (target.height - 72) / mask.height, 8)
    context.save(); context.translate(target.width / 2 + offset.x, target.height / 2 + offset.y)
    context.rotate(angle * Math.PI / 180)
    context.imageSmoothingEnabled = false
    context.drawImage(surface, -mask.width * scale / 2, -mask.height * scale / 2, mask.width * scale, mask.height * scale)
    context.restore(); surface.width = surface.height = 0
  }, [image, mask, angle, offset])
  const cancelDrag = () => {
    const current = drag.current
    if (current) {
      setOffset(current.before); drag.current = null
      if (canvas.current?.hasPointerCapture(current.id)) canvas.current.releasePointerCapture(current.id)
    }
  }
  useEffect(() => {
    window.addEventListener('blur', cancelDrag)
    return () => window.removeEventListener('blur', cancelDrag)
  }, [])
  return <section className="image-selection-review" aria-label="物件边缘检查">
    <div className="image-selection-review-header"><h3>物件边缘检查</h3><label>检查背景<select aria-label="物件检查背景" value={background} onChange={event => setBackground(event.target.value)}>
      <option value="checker">棋盘格</option><option value="white">白色</option><option value="black">黑色</option>
    </select></label></div>
    <canvas ref={canvas} width={640} height={320} data-background={background} aria-label="物件透明边缘预览" onPointerDown={event => {
      if (event.button !== 0 || drag.current) return
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, before: offset }
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={event => {
      const current = drag.current
      if (!current || current.id !== event.pointerId) return
      const bounds = event.currentTarget.getBoundingClientRect()
      setOffset({ x: Math.max(-240, Math.min(240, current.before.x + (event.clientX - current.x) * 640 / bounds.width)),
        y: Math.max(-120, Math.min(120, current.before.y + (event.clientY - current.y) * 320 / bounds.height)) })
    }} onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }} onPointerCancel={event => { if (drag.current?.id === event.pointerId) cancelDrag() }} onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) cancelDrag() }}/>
    <div className="image-selection-review-actions"><label>试转角度<input aria-label="物件检查旋转角度" type="range" min={-180} max={180} step={1} value={angle} onChange={event => setAngle(Number(event.target.value))}/><output>{angle}°</output></label>
      <button type="button" onClick={() => { cancelDrag(); setOffset({ x: 0, y: 0 }); setAngle(0) }}>复位检查视角</button></div>
    <p>拖动或旋转检查漏边、残留底色和孔洞，仅改变此处的查看位置。原图边缘已混入的底色仍需人工判断。</p>
  </section>
}
