import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Maximize2, X } from 'lucide-react'
import type { WorkspaceRequest } from './session'
import type { HomeShowcaseKind } from '../../platform/browser/content/home-showcase'
import manifest from '../../platform/browser/content/home-showcase-manifest.json'
import './showcase.css'

type Sample = typeof manifest.entries[keyof typeof manifest.entries] & { id: HomeShowcaseKind }
const samples: Sample[] = (Object.keys(manifest.entries) as HomeShowcaseKind[]).map(id => ({ id, ...manifest.entries[id] }))
const sceneImage = (id: HomeShowcaseKind, full = false) => `${import.meta.env.BASE_URL}assets/home-scenes/${full ? manifest.entries[id].fullFile : manifest.entries[id].file}`
const dimensions = (id: HomeShowcaseKind) => { const { width, height } = manifest.entries[id].boundsMm; return `${width / 1000} × ${height / 1000} m` }

function Details({ sample, trigger, disabled, onClose, onOpen }: { sample: Sample; trigger: HTMLButtonElement; disabled: boolean; onClose: () => void; onOpen: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
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
  return <dialog ref={dialog} className="home-detail-dialog" aria-labelledby="home-detail-title" onCancel={event => { event.preventDefault(); dismiss(onClose) }}>
    <div className="home-detail-heading"><div><p>{sample.kind} · {dimensions(sample.id)}</p><h2 id="home-detail-title">{sample.name} · 场景详情</h2></div><button className="home-detail-close" aria-label="关闭场景详情" onClick={() => dismiss(onClose)}><X size={20}/></button></div>
    <div className="home-detail-body"><figure><img src={sceneImage(sample.id, true)} width={entry.fullWidth} height={entry.fullHeight} alt={`${sample.name}主持人视图完整场景`}/><figcaption>实际样板全图 · 主持人视图</figcaption></figure><div className="home-detail-copy"><p>{sample.description}</p><ul>{sample.features.map(feature => <li key={feature}>{feature}</li>)}</ul><p className="home-detail-counts">{entry.rooms ? `${entry.rooms} 间房 · ` : ''}{entry.terrainAreas ? `${entry.terrainAreas} 处地形 · ` : ''}{entry.props} 件物件{entry.prefabInstances ? ` · ${entry.prefabInstances} 组组合` : ''}</p><p className="home-detail-note">保存为独立副本后，可继续编辑结构、素材和图层。</p></div></div>
    <div className="home-detail-actions"><button className="secondary" onClick={() => dismiss(onClose)}>返回首页</button><button className="primary" disabled={disabled} onClick={() => dismiss(onOpen)}>用此样板创建副本<ArrowRight size={16}/></button></div>
  </dialog>
}

export default function SampleShowcase({ onRequest, disabled }: { onRequest: (request: WorkspaceRequest) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<{ sample: Sample; trigger: HTMLButtonElement } | null>(null)
  const open = (sample: Sample) => { setSelected(null); onRequest({ type: 'showcase', sample: sample.id }) }
  return <section className="home-showcase" aria-labelledby="home-samples-title"><div className="home-section-heading"><div><p className="home-eyebrow">EXPLORE THE SCENES</p><h2 id="home-samples-title">从样板开始</h2></div><span>查看场景详情 · 可编辑 · 保存为独立副本</span></div>
    <div className="home-samples">{samples.map(sample => {
      const entry = manifest.entries[sample.id]
      return <article className={`home-showcase-card sample-${sample.id}`} key={sample.id} data-sample={sample.id}>
        <button className="home-showcase-image" aria-label={`查看${sample.name}详情`} onClick={event => setSelected({ sample, trigger: event.currentTarget })}><img src={sceneImage(sample.id)} width={entry.width} height={entry.height} alt={`${sample.name}实际场景`} loading="lazy"/><span><Maximize2 size={13}/>查看全图</span></button>
        <div className="home-showcase-copy"><div className="home-showcase-meta"><span>{sample.kind}</span><span>{dimensions(sample.id)}</span></div><h3>{sample.name}</h3><p>{sample.description}</p><ul>{sample.features.map(feature => <li key={feature}>{feature}</li>)}</ul><div className="home-showcase-actions"><button className="secondary" aria-label={`${sample.name}场景详情`} onClick={event => setSelected({ sample, trigger: event.currentTarget })}>查看详情</button><button className="home-showcase-open" aria-label={sample.name} disabled={disabled} onClick={() => open(sample)}>打开为副本<ArrowRight size={15}/></button></div></div>
      </article>
    })}</div>
    {selected && <Details sample={selected.sample} trigger={selected.trigger} disabled={disabled} onClose={() => setSelected(null)} onOpen={() => open(selected.sample)}/>}
  </section>
}
