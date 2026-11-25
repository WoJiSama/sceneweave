import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Download, Move, RotateCcw, X } from 'lucide-react'
import type { ProjectBundle } from '../../shared/model/project'
import type { Audience } from '../../shared/projection/types'
import { DEFAULT_OBLIQUE_CAMERA } from '../../platform/browser/render/oblique-camera'
import { useObliqueView } from '../native-canvas/useObliqueView'
import './oblique-preview.css'

interface Props {
  bundle: ProjectBundle
  audience: Audience
  floorId: string
  hiddenLayerIds?: ReadonlySet<string>
}

function sizePreview(canvas: HTMLCanvasElement) {
  const width = canvas.getBoundingClientRect().width
  if (width <= 0) return false
  const pixels = Math.min(1920, Math.round(width * Math.min(devicePixelRatio, 2)))
  const height = Math.max(1, Math.round(pixels / 1.28))
  if (pixels <= 0 || canvas.width === pixels && canvas.height === height) return false
  canvas.width = pixels
  canvas.height = height
  return true
}

function ObliqueDialog({ bundle, audience, floorId, hiddenLayerIds, open, onClose }: Props & { open: boolean; onClose: (retain: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const exportTask = useRef<AbortController>(null)
  const prepare = useCallback(async (canvas: HTMLCanvasElement, signal: AbortSignal) => {
    const { prepareObliquePreview } = await import('../../platform/browser/render/oblique-renderer')
    sizePreview(canvas)
    return prepareObliquePreview(canvas, bundle, { floorId, audience, hiddenLayerIds, signal })
  }, [bundle, floorId, audience, hiddenLayerIds])
  const { canvas, view, camera, setCamera, setZoom, ready, error, handlers } = useObliqueView(prepare)
  const latestCamera = useRef(camera)
  latestCamera.current = camera
  const [showLoading, setShowLoading] = useState(false)
  const [exporting, setExporting] = useState(false), [exportIssue, setExportIssue] = useState('')
  useEffect(() => {
    if (!open) return
    const element = dialog.current!
    element.showModal()
    return () => {
      exportTask.current?.abort()
      if (element.open) element.close()
    }
  }, [open])
  useEffect(() => {
    if (!open || ready || error) return
    const timer = setTimeout(() => setShowLoading(true), 250)
    return () => clearTimeout(timer)
  }, [open, ready, error])
  useEffect(() => {
    if (!open || !ready) return
    const element = canvas.current!
    const controller = new AbortController()
    const observer = new ResizeObserver(() => {
      if (exportTask.current) return
      try {
        if (sizePreview(element)) view.current?.draw(latestCamera.current)
        void view.current?.refine(latestCamera.current.zoom, controller.signal).catch(() => undefined)
      } catch { /* The canvas context-loss listener owns the error state. */ }
    })
    observer.observe(element)
    return () => { observer.disconnect(); controller.abort() }
  }, [open, ready, canvas, view])
  useEffect(() => {
    if (!open || !ready || camera.zoom <= 1.2) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void view.current?.refine(camera.zoom, controller.signal).catch(() => undefined)
    }, 240)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, ready, camera.zoom, view])
  const close = () => {
    exportTask.current?.abort()
    exportTask.current = null
    setExporting(false)
    setExportIssue('')
    setCamera(DEFAULT_OBLIQUE_CAMERA)
    setShowLoading(false)
    onClose(ready && view.current?.cacheable === true)
  }
  const exportFrame = async () => {
    if (!view.current || exportTask.current) return
    const controller = new AbortController()
    exportTask.current = controller
    setExporting(true)
    setExportIssue('')
    const signal = controller.signal
    try {
      const output = await view.current.exportPng({ camera, longEdgePx: 2560, aspectRatio: 1.28, signal })
      if (signal.aborted) return
      const url = URL.createObjectURL(output), link = document.createElement('a')
      link.href = url
      link.download = `${bundle.project.document.title.replace(/[\\/:*?"<>|]/g, '-')}-3D.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      if (!signal.aborted) setExportIssue(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (exportTask.current === controller) {
        exportTask.current = null
        setExporting(false)
      }
    }
  }
  return <dialog className="oblique-dialog" ref={dialog} aria-labelledby="oblique-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}>
    <header className="oblique-heading">
      <div><h2 id="oblique-title">斜俯视</h2><span>{bundle.project.document.floors[floorId]?.name} · {audience === 'gm' ? '主持人' : '玩家'}</span></div>
      <button type="button" className="secondary" onClick={close}><X size={16}/>{showLoading && !ready && !error ? '取消加载' : '返回俯视'}</button>
    </header>
    <div className="oblique-stage">
      <canvas ref={canvas} width={1280} height={1000} aria-label="可旋转地图预览" tabIndex={ready ? 0 : -1} data-ready={ready} {...handlers}/>
      {error ? <p className="oblique-status" role="alert">{error}</p> : !ready && showLoading && <p className="oblique-status" role="status">正在准备 3D 地形和素材…</p>}
    </div>
    <footer className="oblique-controls">
      <span className="oblique-hint"><Move size={15}/>拖动或用方向键转动 · 滚轮缩放</span>
      <label>俯角 <input type="range" aria-label="俯角" min={30} max={90} step={1} value={Math.round(camera.elevationDeg)} disabled={!ready} onChange={event => setCamera(current => ({ ...current, elevationDeg: Number(event.target.value) }))}/></label>
      <label>缩放 <input type="range" aria-label="3D 缩放" min={.65} max={4} step={.05} value={camera.zoom} disabled={!ready} onChange={event => setZoom(Number(event.target.value))}/></label>
      <label><input type="checkbox" checked={!!camera.fadeCanopy} onChange={event => setCamera(current => ({ ...current, fadeCanopy: event.target.checked }))}/>近处树冠淡出</label>
      <button type="button" className="secondary" onClick={() => setCamera(DEFAULT_OBLIQUE_CAMERA)} disabled={!ready}><RotateCcw size={15}/>重置视角</button>
      <button type="button" className="primary" disabled={!ready || exporting} onClick={() => void exportFrame()}><Download size={15}/>{exporting ? '正在出图…' : '导出当前画面'}</button>
      {exporting && <button type="button" className="secondary" onClick={() => exportTask.current?.abort()}>取消出图</button>}
      {exportIssue && <span role="alert">{exportIssue}</span>}
    </footer>
  </dialog>
}

export default function ObliquePreview(props: Props & { disabled: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [request, setRequest] = useState(false)
  const [retained, setRetained] = useState<{ bundle: ProjectBundle; key: string }>()
  const input = useRef({ bundle: props.bundle, epoch: 0 })
  if (input.current.bundle !== props.bundle) input.current = { bundle: props.bundle, epoch: input.current.epoch + 1 }
  const layerKey = JSON.stringify([...props.hiddenLayerIds ?? []].sort())
  const hiddenLayerIds = useMemo(() => new Set<string>(JSON.parse(layerKey) as string[]), [layerKey])
  const key = JSON.stringify([input.current.epoch, props.floorId, props.audience, layerKey])
  const keep = retained?.bundle === props.bundle && retained.key === key
  useEffect(() => {
    if (request || !retained) return
    if (!keep) { setRetained(undefined); return }
    const timer = setTimeout(() => setRetained(undefined), 30_000)
    return () => clearTimeout(timer)
  }, [request, retained, keep])
  return <><button ref={trigger} type="button" className="secondary" disabled={props.disabled} onClick={() => setRequest(true)}><Box size={15}/>斜俯视</button>
    {(request || keep) && <ObliqueDialog key={key} {...props} hiddenLayerIds={hiddenLayerIds} open={request}
      onClose={retain => {
        setRetained(retain ? { bundle: props.bundle, key } : undefined)
        setRequest(false)
        requestAnimationFrame(() => trigger.current?.focus())
      }}/>}</>
}
