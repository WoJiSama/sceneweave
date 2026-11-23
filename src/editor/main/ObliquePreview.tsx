import { useEffect, useRef, useState } from 'react'
import { Box, Download, Move, RotateCcw, X } from 'lucide-react'
import type { ProjectBundle } from '../../shared/model/project'
import type { Audience } from '../../shared/projection/types'
import { DEFAULT_OBLIQUE_CAMERA, zoomOblique, type ObliqueCamera } from '../../platform/browser/render/oblique-camera'
import type { prepareObliquePreview } from '../../platform/browser/render/oblique-renderer'
import './oblique-preview.css'

interface Props {
  bundle: ProjectBundle
  audience: Audience
  floorId: string
  hiddenLayerIds?: ReadonlySet<string>
}

function ObliqueDialog({ bundle, audience, floorId, hiddenLayerIds, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<Awaited<ReturnType<typeof prepareObliquePreview>>>(null)
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const lifetime = useRef<AbortController>(null)
  const [camera, setCamera] = useState(DEFAULT_OBLIQUE_CAMERA)
  const [ready, setReady] = useState(false), [error, setError] = useState('')
  const [exporting, setExporting] = useState(false), [exportIssue, setExportIssue] = useState('')
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { if (element.open) element.close() }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    const canvasElement = canvas.current!
    const contextLost = (event: Event) => { event.preventDefault(); setError('3D 设备已断开。关闭预览后可以重新打开。') }
    canvasElement.addEventListener('webglcontextlost', contextLost)
    void import('../../platform/browser/render/oblique-renderer').then(({ prepareObliquePreview }) =>
      prepareObliquePreview(canvasElement, bundle, { floorId, audience, hiddenLayerIds, signal: controller.signal })).then(result => {
      if (controller.signal.aborted) { result.dispose(); return }
      view.current = result
      result.draw(DEFAULT_OBLIQUE_CAMERA)
      setReady(true)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => {
      controller.abort()
      canvasElement.removeEventListener('webglcontextlost', contextLost)
      view.current?.dispose()
      view.current = null
    }
  }, [bundle, floorId, audience, hiddenLayerIds])
  useEffect(() => {
    if (!ready || error) return
    const frame = requestAnimationFrame(() => {
      try { view.current?.draw(camera) }
      catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    })
    return () => cancelAnimationFrame(frame)
  }, [ready, camera, error])
  const zoom = (current: ObliqueCamera, amount: number, toward?: { x: number; y: number }) =>
    view.current ? zoomOblique(current, view.current.bounds, amount, toward) : current
  const exportFrame = async () => {
    setExporting(true)
    setExportIssue('')
    const signal = lifetime.current?.signal
    try {
      const { exportObliquePng } = await import('../../platform/browser/render/oblique-renderer')
      const output = await exportObliquePng(bundle, { audience, floorId, hiddenLayerIds, camera, longEdgePx: 2560, aspectRatio: 1.28, signal })
      if (signal?.aborted) return
      const url = URL.createObjectURL(output), link = document.createElement('a')
      link.href = url
      link.download = `${bundle.project.document.title.replace(/[\\/:*?"<>|]/g, '-')}-3D.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      if (!signal?.aborted) setExportIssue(failure instanceof Error ? failure.message : String(failure))
    } finally { if (!signal?.aborted) setExporting(false) }
  }
  return <dialog className="oblique-dialog" ref={dialog} aria-labelledby="oblique-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}>
    <header className="oblique-heading">
      <div><h2 id="oblique-title">斜俯视</h2><span>{bundle.project.document.floors[floorId]?.name} · {audience === 'gm' ? '主持人' : '玩家'}</span></div>
      <button type="button" className="secondary" onClick={onClose}><X size={16}/>返回俯视</button>
    </header>
    <div className="oblique-stage">
      <canvas ref={canvas} width={1280} height={1000} aria-label="可旋转地图预览" tabIndex={ready && !error ? 0 : -1} data-ready={ready && !error}
        onPointerDown={event => {
          if (!ready || error || event.button !== 0) return
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const start = pointer.current
          if (!start || event.pointerId !== start.id) return
          const dx = event.clientX - start.x, dy = event.clientY - start.y
          pointer.current = { id: start.id, x: event.clientX, y: event.clientY }
          setCamera(current => ({ ...current, azimuthDeg: (current.azimuthDeg + dx * .36) % 360, elevationDeg: Math.max(30, Math.min(90, current.elevationDeg + dy * .21)) }))
        }}
        onLostPointerCapture={() => { pointer.current = null }}
        onWheel={event => {
          if (!ready || error) return
          const { left, top, width, height } = event.currentTarget.getBoundingClientRect()
          const x = (event.clientX - left) / width - .5, y = (event.clientY - top) / height - .5
          setCamera(current => {
            const yaw = current.azimuthDeg * Math.PI / 180, up = event.deltaY < 0
            return zoom(current, current.zoom * (up ? 1.17 : 1 / 1.17), up ? { x: x * Math.cos(yaw) - y * Math.sin(yaw), y: x * Math.sin(yaw) + y * Math.cos(yaw) } : undefined)
          })
        }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(event.key)) return
          event.preventDefault()
          setCamera(current => {
            if (event.key === '+' || event.key === '=' || event.key === '-') return zoom(current, current.zoom * (event.key === '-' ? .9 : 1.12))
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return { ...current, azimuthDeg: (current.azimuthDeg + (event.key === 'ArrowLeft' ? -12 : 12)) % 360 }
            return { ...current, elevationDeg: Math.max(30, Math.min(90, current.elevationDeg + (event.key === 'ArrowUp' ? 5 : -5))) }
          })
        }}/>
      {error ? <p className="oblique-status" role="alert">{error}</p> : !ready && <p className="oblique-status" role="status">正在准备 3D 地形和素材…</p>}
    </div>
    <footer className="oblique-controls">
      <span className="oblique-hint"><Move size={15}/>拖动或用方向键转动 · 滚轮缩放</span>
      <label>俯角 <input type="range" aria-label="俯角" min={30} max={90} step={1} value={Math.round(camera.elevationDeg)} disabled={!ready || !!error} onChange={event => setCamera(current => ({ ...current, elevationDeg: Number(event.target.value) }))}/></label>
      <label>缩放 <input type="range" aria-label="3D 缩放" min={.65} max={4} step={.05} value={camera.zoom} disabled={!ready || !!error} onChange={event => setCamera(current => zoom(current, Number(event.target.value)))}/></label>
      <label><input type="checkbox" checked={!!camera.fadeCanopy} onChange={event => setCamera(current => ({ ...current, fadeCanopy: event.target.checked }))}/>近处树冠淡出</label>
      <button type="button" className="secondary" onClick={() => setCamera(DEFAULT_OBLIQUE_CAMERA)} disabled={!ready || !!error}><RotateCcw size={15}/>重置视角</button>
      <button type="button" className="primary" disabled={!ready || !!error || exporting} onClick={() => void exportFrame()}><Download size={15}/>{exporting ? '正在出图…' : '导出当前画面'}</button>
      {exportIssue && <span role="alert">{exportIssue}</span>}
    </footer>
  </dialog>
}

export default function ObliquePreview(props: Props & { disabled: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [request, setRequest] = useState(false)
  return <><button ref={trigger} type="button" className="secondary" disabled={props.disabled} onClick={() => setRequest(true)}><Box size={15}/>斜俯视</button>
    {request && <ObliqueDialog key={JSON.stringify([props.bundle.project.document.sceneId, props.bundle.project.document.revision, props.floorId,
      props.audience, [...props.hiddenLayerIds ?? []].sort()])} {...props}
      onClose={() => { setRequest(false); requestAnimationFrame(() => trigger.current?.focus()) }}/>}</>
}
