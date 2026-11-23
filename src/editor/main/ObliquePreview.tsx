import { useCallback, useEffect, useRef, useState } from 'react'
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

function ObliqueDialog({ bundle, audience, floorId, hiddenLayerIds, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const prepare = useCallback(async (canvas: HTMLCanvasElement, signal: AbortSignal) => {
    const { prepareObliquePreview } = await import('../../platform/browser/render/oblique-renderer')
    return prepareObliquePreview(canvas, bundle, { floorId, audience, hiddenLayerIds, signal })
  }, [bundle, floorId, audience, hiddenLayerIds])
  const { canvas, camera, setCamera, setZoom, lifetime, ready, error, handlers } = useObliqueView(prepare)
  const [exporting, setExporting] = useState(false), [exportIssue, setExportIssue] = useState('')
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { if (element.open) element.close() }
  }, [])
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
      <canvas ref={canvas} width={1280} height={1000} aria-label="可旋转地图预览" tabIndex={ready ? 0 : -1} data-ready={ready} {...handlers}/>
      {error ? <p className="oblique-status" role="alert">{error}</p> : !ready && <p className="oblique-status" role="status">正在准备 3D 地形和素材…</p>}
    </div>
    <footer className="oblique-controls">
      <span className="oblique-hint"><Move size={15}/>拖动或用方向键转动 · 滚轮缩放</span>
      <label>俯角 <input type="range" aria-label="俯角" min={30} max={90} step={1} value={Math.round(camera.elevationDeg)} disabled={!ready} onChange={event => setCamera(current => ({ ...current, elevationDeg: Number(event.target.value) }))}/></label>
      <label>缩放 <input type="range" aria-label="3D 缩放" min={.65} max={4} step={.05} value={camera.zoom} disabled={!ready} onChange={event => setZoom(Number(event.target.value))}/></label>
      <label><input type="checkbox" checked={!!camera.fadeCanopy} onChange={event => setCamera(current => ({ ...current, fadeCanopy: event.target.checked }))}/>近处树冠淡出</label>
      <button type="button" className="secondary" onClick={() => setCamera(DEFAULT_OBLIQUE_CAMERA)} disabled={!ready}><RotateCcw size={15}/>重置视角</button>
      <button type="button" className="primary" disabled={!ready || exporting} onClick={() => void exportFrame()}><Download size={15}/>{exporting ? '正在出图…' : '导出当前画面'}</button>
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
