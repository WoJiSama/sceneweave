import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Maximize2, X } from 'lucide-react'
import type { WorkspaceRequest } from './session'
import type { HomeShowcaseKind } from '../../platform/browser/content/home-showcase'
import manifest from '../../platform/browser/content/home-showcase-manifest.json'
import './showcase.css'

type Sample = typeof manifest.entries[keyof typeof manifest.entries] & { id: HomeShowcaseKind }
const featuredSampleIds = ['fantasy', 'wilderness', 'ruins', 'volcano'] as const satisfies readonly HomeShowcaseKind[]
const samples: Sample[] = featuredSampleIds.map(id => ({ id, ...manifest.entries[id] }))
type View = 'top' | 'oblique'
type Angle = typeof manifest.entries[HomeShowcaseKind]['oblique']
export function sceneImage(id: HomeShowcaseKind, full = false) {
  const { file, fullFile, pngSha256, fullPngSha256 } = manifest.entries[id]
  return `${import.meta.env.BASE_URL}assets/home-scenes/${full ? fullFile : file}?v=${full ? fullPngSha256 : pngSha256}`
}
export function obliqueImage(image: Angle, full = false) {
  return `${import.meta.env.BASE_URL}assets/home-scenes/${full ? image.fullFile : image.file}?v=${full ? image.fullSha256 : image.sha256}`
}
const dimensions = (id: HomeShowcaseKind) => { const { width, height } = manifest.entries[id].boundsMm; return `${width / 1000} × ${height / 1000} m` }

function Details({ sample, angle, initialView, trigger, disabled, onClose, onOpen }: {
  sample: Sample; angle: Angle | undefined; initialView: View; trigger: HTMLButtonElement; disabled: boolean; onClose: () => void; onOpen: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState(initialView)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => { if (element.open) element.close() }
  }, [])
  const dismiss = (action: () => void) => {
    dialog.current?.close()
    if (trigger.isConnected) trigger.focus({ preventScroll: true })
    action()
  }
  const entry = manifest.entries[sample.id]
  const oblique = view === 'oblique' ? angle : undefined
  return <dialog ref={dialog} className="home-detail-dialog" aria-labelledby="home-detail-title" onCancel={event => { event.preventDefault(); dismiss(onClose) }}>
    <div className="home-detail-heading"><div><p>{sample.kind} · {dimensions(sample.id)}</p><h2 id="home-detail-title">{sample.name} · 场景详情</h2></div><button className="home-detail-close" aria-label="关闭场景详情" onClick={() => dismiss(onClose)}><X size={20}/></button></div>
    <div className="home-detail-body">
      <figure>
        {angle && <div className="home-view-switch" role="group" aria-label="场景预览视角">
          <button type="button" className="secondary" aria-pressed={!oblique} onClick={() => setView('top')}>正俯视</button>
          <button type="button" className="secondary" aria-pressed={!!oblique} onClick={() => setView('oblique')}>3D 斜俯视</button>
        </div>}
        <img src={oblique ? obliqueImage(oblique, true) : sceneImage(sample.id, true)} width={oblique?.fullWidth ?? entry.fullWidth}
          height={oblique?.fullHeight ?? entry.fullHeight} alt={`${sample.name}${oblique ? '3D 斜俯视' : '正俯视'}完整场景`}/>
        <figcaption>实际样板全图 · 主持人视图</figcaption>
      </figure>
      <div className="home-detail-copy"><p>{sample.description}</p><ul>{sample.features.map(feature => <li key={feature}>{feature}</li>)}</ul><p className="home-detail-counts">{entry.rooms ? `${entry.rooms} 间房 · ` : ''}{entry.terrainAreas ? `${entry.terrainAreas} 处地形 · ` : ''}{entry.props} 件物件{entry.prefabInstances ? ` · ${entry.prefabInstances} 组组合` : ''}</p><p className="home-detail-note">打开副本后可编辑场景，点画布上方的「斜俯视」可以旋转取景。</p></div>
    </div>
    <div className="home-detail-actions"><button className="secondary" onClick={() => dismiss(onClose)}>返回首页</button><button className="primary" disabled={disabled} onClick={() => dismiss(onOpen)}>用此样板创建副本<ArrowRight size={16}/></button></div>
  </dialog>
}

export default function SampleShowcase({ onRequest, disabled }: { onRequest: (request: WorkspaceRequest) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<{ sample: Sample; trigger: HTMLButtonElement; view?: View } | null>(null)
  const open = (sample: Sample) => { setSelected(null); onRequest({ type: 'showcase', sample: sample.id }) }
  return <section className="home-showcase" aria-labelledby="home-samples-title"><div className="home-section-heading"><h2 id="home-samples-title" tabIndex={-1}>从样板开始</h2><p className="home-showcase-intro">点图查看高清地图，或打开副本开始编辑。</p></div>
    <div className="home-samples">{samples.map(sample => {
      const entry = manifest.entries[sample.id]
      const angle = (entry as { oblique?: Angle }).oblique
      return <article className={`home-showcase-card sample-${sample.id}`} key={sample.id} data-sample={sample.id}>
        <div className={`home-showcase-views${angle ? ' is-paired' : ''}`}>
          <button className="home-showcase-image" aria-label={`查看${sample.name}详情`} onClick={event => setSelected({ sample, trigger: event.currentTarget })}>
            <img src={sceneImage(sample.id)} width={entry.width} height={entry.height} alt={`${sample.name}正俯视实际场景`} loading="lazy"/>
            <span><Maximize2 size={12}/>正俯视</span>
          </button>
          {angle && <button className="home-showcase-image home-showcase-angle" aria-label={`查看${sample.name}3D 斜俯视`} onClick={event => setSelected({ sample, trigger: event.currentTarget, view: 'oblique' })}>
            <img src={obliqueImage(angle)} width={angle.width} height={angle.height} alt={`${sample.name}3D 斜俯视实际场景`} loading="lazy"/>
            <span><Maximize2 size={12}/>3D 斜俯视</span>
          </button>}
        </div>
        <div className="home-showcase-copy"><div className="home-showcase-meta"><span>{sample.kind}</span><span>{dimensions(sample.id)}</span></div><h3>{sample.name}</h3><p>{sample.description}</p><ul>{sample.features.map(feature => <li key={feature}>{feature}</li>)}</ul><div className="home-showcase-actions"><button className="secondary" aria-label={`${sample.name}场景详情`} onClick={event => setSelected({ sample, trigger: event.currentTarget })}>查看详情</button><button className="home-showcase-open" aria-label={sample.name} disabled={disabled} onClick={() => open(sample)}>打开为副本<ArrowRight size={15}/></button></div></div>
      </article>
    })}</div>
    {selected && <Details sample={selected.sample} angle={(manifest.entries[selected.sample.id] as { oblique?: Angle }).oblique}
      initialView={selected.view ?? 'top'} trigger={selected.trigger} disabled={disabled} onClose={() => setSelected(null)} onOpen={() => open(selected.sample)}/>}
  </section>
}
