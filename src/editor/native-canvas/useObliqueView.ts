import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { DEFAULT_OBLIQUE_CAMERA, zoomOblique, type ObliqueCamera } from '../../platform/browser/render/oblique-camera'
import type { ObliquePreviewMode, prepareObliquePreview } from '../../platform/browser/render/oblique-renderer'

type ObliqueView = Awaited<ReturnType<typeof prepareObliquePreview>>
type PrepareView = (canvas: HTMLCanvasElement, signal: AbortSignal, mode: ObliquePreviewMode) => Promise<ObliqueView>
interface ViewOptions {
  enabled?: boolean
  visible?: boolean
  activate?: () => void
  tiltOnOpen?: boolean
  wheelZoom?: boolean
  mode?: ObliquePreviewMode
}

function sizeObliqueCanvas(canvas: HTMLCanvasElement, mode: ObliquePreviewMode) {
  const { width, height } = canvas.getBoundingClientRect()
  if (width <= 0 || height <= 0) return false
  const densityLimit = mode === 'performance' ? 1 : 2
  const edgeLimit = mode === 'performance' ? 960 : 1920
  const scale = Math.min(devicePixelRatio, densityLimit, edgeLimit / Math.max(width, height))
  const pixelWidth = Math.max(1, Math.round(width * scale)), pixelHeight = Math.max(1, Math.round(height * scale))
  if (canvas.width === pixelWidth && canvas.height === pixelHeight) return false
  canvas.width = pixelWidth; canvas.height = pixelHeight
  return true
}

export function useObliqueView(prepare: PrepareView, { enabled = true, visible = true, activate, tiltOnOpen = false, wheelZoom = true, mode = 'normal' }: ViewOptions = {}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<ObliqueView>(null)
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const [camera, setCamera] = useState(DEFAULT_OBLIQUE_CAMERA)
  const latestCamera = useRef(camera)
  latestCamera.current = camera
  const latestMode = useRef(mode)
  latestMode.current = mode
  const introCamera = useRef<ObliqueCamera | null>(null)
  const hasOrbitInput = useRef(false)
  const drawFrame = useRef(0)
  const [phase, setPhase] = useState<'loading' | 'tilting' | 'ready'>('loading')
  const [error, setError] = useState('')
  const [backingEdge, setBackingEdge] = useState(0)
  const ready = enabled && phase === 'ready' && !error

  useEffect(() => {
    if (!enabled) {
      setPhase('loading')
      setCamera(DEFAULT_OBLIQUE_CAMERA)
      setError('')
      return
    }
    const controller = new AbortController()
    const element = canvas.current!
    let frame = 0
    const fail = (failure: unknown) => {
      if (controller.signal.aborted) return
      cancelAnimationFrame(frame)
      cancelAnimationFrame(drawFrame.current)
      drawFrame.current = 0
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      fail(new Error('3D 设备已断开，请重新打开预览。'))
    }
    setPhase('loading')
    setError('')
    if (!hasOrbitInput.current) {
      latestCamera.current = DEFAULT_OBLIQUE_CAMERA
      setCamera(DEFAULT_OBLIQUE_CAMERA)
    }
    element.addEventListener('webglcontextlost', contextLost)
    frame = requestAnimationFrame(() => {
      const initialMode = latestMode.current
      sizeObliqueCanvas(element, initialMode)
      void prepare(element, controller.signal, initialMode).then(result => {
        if (controller.signal.aborted) { result.dispose(); return }
        view.current = result
        if (result.setMode(latestMode.current)) sizeObliqueCanvas(element, latestMode.current)
        if (!tiltOnOpen || hasOrbitInput.current || matchMedia('(prefers-reduced-motion: reduce)').matches) {
          result.draw(latestCamera.current)
          setPhase('ready')
          return
        }
        introCamera.current = { azimuthDeg: 0, elevationDeg: 90, zoom: 1 }
        result.draw(introCamera.current)
        setPhase('tilting')
        const start = performance.now()
        const tilt = (now: number) => {
          try {
            if (hasOrbitInput.current) {
              result.draw(latestCamera.current)
              setPhase('ready')
              return
            }
            const time = Math.max(0, Math.min(1, (now - start) / 430))
            const progress = time * time * (3 - 2 * time)
            introCamera.current = { azimuthDeg: DEFAULT_OBLIQUE_CAMERA.azimuthDeg * progress,
              elevationDeg: 90 + (DEFAULT_OBLIQUE_CAMERA.elevationDeg - 90) * progress, zoom: 1 }
            result.draw(introCamera.current)
            if (time < 1) frame = requestAnimationFrame(tilt)
            else { introCamera.current = null; setPhase('ready') }
          } catch (failure) { fail(failure) }
        }
        frame = requestAnimationFrame(tilt)
      }).catch(fail)
    })
    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
      cancelAnimationFrame(drawFrame.current)
      drawFrame.current = 0
      element.removeEventListener('webglcontextlost', contextLost)
      view.current?.dispose()
      view.current = null
      pointer.current = null
      introCamera.current = null
      hasOrbitInput.current = false
    }
  }, [prepare, tiltOnOpen, enabled])

  useEffect(() => {
    if (!ready || drawFrame.current) return
    drawFrame.current = requestAnimationFrame(() => {
      drawFrame.current = 0
      try { view.current?.draw(latestCamera.current) }
      catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    })
  }, [ready, camera])

  useEffect(() => {
    if (!visible || !ready) return
    const element = canvas.current!
    let density: MediaQueryList | undefined
    const measure = () => {
      try {
        const resized = sizeObliqueCanvas(element, mode)
        const changed = view.current?.setMode(mode)
        if (resized || changed) view.current?.draw(latestCamera.current)
        setBackingEdge(Math.max(element.width, element.height))
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    }
    const watchDensity = () => {
      density?.removeEventListener('change', watchDensity)
      density = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
      density.addEventListener('change', watchDensity)
      measure()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    watchDensity()
    return () => { observer.disconnect(); density?.removeEventListener('change', watchDensity) }
  }, [ready, visible, mode])

  useEffect(() => {
    if (!visible || !ready || !backingEdge || mode === 'performance') return
    const controller = new AbortController()
    const timer = setTimeout(() => void view.current?.refine(camera.zoom, controller.signal).catch(() => undefined), 240)
    return () => { clearTimeout(timer); controller.abort() }
  }, [ready, visible, camera.zoom, backingEdge, mode])

  const zoom = (current: ObliqueCamera, amount: number, toward?: { x: number; y: number }) =>
    view.current ? zoomOblique(current, view.current.bounds, amount, toward) : current
  const changeElevation = (elevation: number) => Math.max(30, Math.min(90, elevation))
  const endPointer = (event: PointerEvent<HTMLElement>) => {
    if (pointer.current?.id !== event.pointerId) return
    pointer.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if ((!ready && !activate) || error || !event.isPrimary || event.button !== 0 || pointer.current) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture(event.pointerId)
      hasOrbitInput.current = true
      if (introCamera.current) {
        latestCamera.current = introCamera.current
        setCamera(introCamera.current)
        introCamera.current = null
      }
      if (!enabled) activate?.()
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = pointer.current
      if (start?.id !== event.pointerId || error) return
      const dx = event.clientX - start.x, dy = event.clientY - start.y
      pointer.current = { id: start.id, x: event.clientX, y: event.clientY }
      setCamera(current => ({ ...current, azimuthDeg: (current.azimuthDeg + dx * .36) % 360, elevationDeg: changeElevation(current.elevationDeg + dy * .21) }))
    },
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onLostPointerCapture: endPointer,
    onWheel: wheelZoom ? (event: WheelEvent<HTMLElement>) => {
      if (!ready || !event.deltaY) return
      const { left, top, width, height } = event.currentTarget.getBoundingClientRect()
      const x = (event.clientX - left) / width - .5, y = (event.clientY - top) / height - .5
      setCamera(current => {
        const yaw = current.azimuthDeg * Math.PI / 180, up = event.deltaY < 0
        return zoom(current, current.zoom * (up ? 1.17 : 1 / 1.17), up ? { x: x * Math.cos(yaw) - y * Math.sin(yaw), y: x * Math.sin(yaw) + y * Math.cos(yaw) } : undefined)
      })
    } : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const { key } = event
      if (!enabled && activate && (key === 'Enter' || key === ' ')) {
        event.preventDefault()
        activate()
        return
      }
      if (!ready || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(key)) return
      event.preventDefault()
      setCamera(current => {
        if (key === '+' || key === '=' || key === '-') return zoom(current, current.zoom * (key === '-' ? .9 : 1.12))
        if (key === 'ArrowLeft' || key === 'ArrowRight') return { ...current, azimuthDeg: (current.azimuthDeg + (key === 'ArrowLeft' ? -12 : 12)) % 360 }
        return { ...current, elevationDeg: changeElevation(current.elevationDeg + (key === 'ArrowUp' ? 5 : -5)) }
      })
    },
  }
  return { canvas, view, camera, setCamera, phase, ready, error, handlers,
    setZoom: (value: number) => setCamera(current => zoom(current, value)) }
}
