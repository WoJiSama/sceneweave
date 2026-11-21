import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toBundle, type EditableProject } from '../../application/workspace/project.js'
import { exportPng } from '../../platform/browser/render/renderer.js'
import { resolveFloorOutput } from '../../shared/floors/output.js'
import type { BoundsMm } from '../../shared/model/scene.js'
import type { RoomPrivacyPublicImpact } from './building-privacy-review.js'
import './privacy-comparison.css'

type Images = { project: EditableProject; floorId: string; attempt: number; gm: string; player: string }
const viewBox = (b: BoundsMm) => `${b.x} ${b.y} ${b.width} ${b.height}`
function cropAround(boxes: readonly BoundsMm[], output: BoundsMm): BoundsMm {
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y))
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height))
  const margin = Math.max(right - left, bottom - top, 1800) / 3
  const x = Math.max(output.x, left - margin), y = Math.max(output.y, top - margin)
  return { x, y, width: Math.min(output.x + output.width, right + margin) - x, height: Math.min(output.y + output.height, bottom + margin) - y }
}

export default function PrivacyComparisonPreview({ project, floorId, publicImpacts, onReadyChange }: {
  project: EditableProject; floorId: string; publicImpacts: readonly RoomPrivacyPublicImpact[]
  onReadyChange?: (ready: boolean) => void
}) {
  const ready = useRef(onReadyChange); ready.current = onReadyChange
  const [images, setImages] = useState<Images | null>(null), [failure, setFailure] = useState<{ project: EditableProject; floorId: string; attempt: number; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0), dialog = useRef<HTMLDialogElement>(null)
  const [focused, setFocused] = useState<RoomPrivacyPublicImpact | null>(null)
  useEffect(() => {
    const abort = new AbortController(), urls: string[] = []
    const notifyReady = ready.current
    let alive = true
    notifyReady?.(false)
    const generate = async () => {
      try {
        const bundle = toBundle(project), outputs: Record<string, string> = {}
        for (const audience of ['gm', 'player'] as const) {
          const blob = await exportPng(bundle, { audience, floorId, longEdgePx: 960, signal: abort.signal })
          if (!alive) return
          const url = URL.createObjectURL(blob); urls.push(url)
          const image = new Image(); image.src = url
          await image.decode()
          if (!alive) return
          outputs[audience] = url
        }
        setImages({ project, floorId, attempt, gm: outputs.gm, player: outputs.player })
        notifyReady?.(true)
      } catch (error) {
        if (!alive) return
        urls.splice(0).forEach(url => URL.revokeObjectURL(url))
        setFailure({ project, floorId, attempt, message: error instanceof Error ? error.message : String(error) })
        notifyReady?.(false)
      }
    }
    void generate()
    return () => { alive = false; abort.abort(); urls.splice(0).forEach(url => URL.revokeObjectURL(url)) }
  }, [project, floorId, attempt])
  const current = images?.project === project && images.floorId === floorId && images.attempt === attempt ? images : null
  const error = failure?.project === project && failure.floorId === floorId && failure.attempt === attempt ? failure.message : null
  const bounds = resolveFloorOutput(project.document, floorId).boundsMm
  const showComparison = (impact: RoomPrivacyPublicImpact | null) => {
    setFocused(impact)
    dialog.current?.showModal()
  }
  const pictures = (impact: RoomPrivacyPublicImpact | null = null) => {
    if (!current) return null
    const boxes = impact?.coveredBoundsMm ?? publicImpacts.flatMap(item => item.coveredBoundsMm)
    const crop = impact ? cropAround(boxes, bounds) : bounds
    const markers = boxes.map((box, index) => <rect key={index} x={box.x} y={box.y} width={box.width} height={box.height} fill="none" stroke="#ef7b14" strokeWidth={Math.max(crop.width, crop.height) / 300}/>)
    return <div className="privacy-comparison-grid">{(['gm', 'player'] as const).map(audience => {
      const label = audience === 'gm' ? '主持人' : '玩家'
      return <figure key={audience}>
        <figcaption>{label} · {project.document.floors[floorId].name}</figcaption>
        <div className="privacy-comparison-picture">
          {impact ? <svg className="privacy-comparison-crop" role="img" aria-label={`${label}地图局部`} viewBox={viewBox(crop)}>
            <image href={current[audience]} x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} preserveAspectRatio="none"/>
            {markers}
          </svg> : <>
            <img src={current[audience]} alt={`候选${label}地图`}/>
            {!!markers.length && <svg className="privacy-comparison-overlay" aria-hidden="true" viewBox={viewBox(bounds)} preserveAspectRatio="none">{markers}</svg>}
          </>}
        </div>
      </figure>
    })}</div>
  }
  return <section className="privacy-comparison" aria-label="玩家与主持人对照预览" aria-busy={!current && !error}>
    <h3>采用前检查两种画面</h3>
    {error ? <><p role="alert">对照预览失败：{error}。完成预览后可采用。</p><button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>重试对照预览</button></> : !current ? <p role="status">正在生成主持人图与玩家图…</p> : <>
      {pictures()}
      <button type="button" className="secondary asset-wide" onClick={() => showComparison(null)}>放大对照预览</button>
      {!!publicImpacts.length && <section className="building-details" aria-label="遮罩对公开内容的影响">
        <h3>公开内容的遮挡</h3>
        <p className="asset-muted">选择名称放大对应位置。橙框标出需要核对的范围。</p>
        <ul>{publicImpacts.map(impact => <li key={`${impact.kind}-${impact.id}`}>
          <button type="button" className="secondary" onClick={() => showComparison(impact)}>定位 {impact.label}</button>{impact.fullyHidden && ' · 整件隐藏'}
        </li>)}</ul>
      </section>}
    </>}
    {createPortal(<dialog ref={dialog} className="privacy-comparison-dialog" aria-label="放大玩家与主持人对照" onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}>
      <div className="privacy-comparison-dialog-heading">
        <strong>{focused?.label ?? '主持人／玩家 · 整层'}</strong>
        <button type="button" className="secondary" onClick={() => dialog.current?.close()}>关闭放大预览</button>
      </div>
      {pictures(focused)}
      {focused && <button type="button" className="secondary asset-wide" onClick={() => setFocused(null)}>查看整层</button>}
    </dialog>, document.body)}
  </section>
}
