import { useRef, useState, type PointerEvent } from 'react'
import type { ImagePoint } from '../../shared/image-import/calibration'
import type { ImagePixels } from '../../shared/image-import/pixels'
import type { ModelPatch } from '../../shared/asset-refinement/local-model-patch'

export default function ModelPatchSelection({ image, value, onChange, disabled }: {
  image: ImagePixels
  value: ModelPatch | null
  onChange: (patch: ModelPatch | null) => void
  disabled: boolean
}) {
  const drag = useRef<{ id: number; start: ImagePoint } | null>(null)
  const [draft, setDraft] = useState<ModelPatch | null>(null)
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.round(image.width * Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))),
      y: Math.round(image.height * Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))),
    }
  }
  const rectangle = (a: ImagePoint, b: ImagePoint) => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
  })
  const cancel = () => { drag.current = null; setDraft(null) }
  const shown = draft ?? value
  const style = shown ? {
    left: `${shown.x / image.width * 100}%`, top: `${shown.y / image.height * 100}%`,
    width: `${shown.width / image.width * 100}%`, height: `${shown.height / image.height * 100}%`,
  } : undefined
  return <div className="model-patch-selection" aria-label="在原图上框选补画范围" aria-disabled={disabled || undefined}
    onPointerDown={event => {
      if (event.button !== 0 || disabled || drag.current) return
      const start = point(event)
      drag.current = { id: event.pointerId, start }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDraft(rectangle(start, start))
    }}
    onPointerMove={event => {
      if (drag.current?.id === event.pointerId) setDraft(rectangle(drag.current.start, point(event)))
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return
      const next = rectangle(drag.current.start, point(event))
      cancel()
      if (!disabled && next.width && next.height) onChange(next)
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {style && <span style={style}/>}
  </div>
}
