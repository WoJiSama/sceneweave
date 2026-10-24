import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Maximize2, X } from 'lucide-react'
import type { WorkspaceRequest } from './session'
import manifest from './showcase-manifest.json'
import './showcase.css'

const samples = [
  { id: 'study', name: '书房与露台', kind: '室内建筑', description: '从木纹书房走向石板露台，逐件调整桌椅、书籍与盆栽。', features: ['厚墙与附着门窗', '书桌与露台桌椅组合', '室内外材质衔接'] },
  { id: 'island', name: '双层岩岛', kind: '地形与室外', description: '海水环绕两层岩岸，沿台阶探索草地、礁石与树丛。', features: ['离散高差与台阶连接', '海岸材质与岸边细节', '保留人工调整的散布'] },
  { id: 'outpost', name: '海岸哨所', kind: '建筑与室外混合', description: '把哨所房间、院落与海岸连在一起，继续布置营地和补给。', features: ['两间房与室外地形', '道路与地形连接', '营地物件和补给组合'] },
  { id: 'graveyard', name: '苔石墓园', kind: '墓地内容小样', description: '沿苔石步道走入墓园，查看墓碑、石棺、铁栏与自然植被。', features: ['苔石步道与细砾土', '四组可编辑纪念组合', '精修树冠与灌丛'] },
  { id: 'volcano', name: '灰烬熔脉', kind: '火山内容小样', description: '灰烬覆盖岩台，橙红熔隙穿过黑色冷壳，坡道连接高低地面。', features: ['可辨识的熔岩与冷却岩片', '独立危险区与熔岩外观', '一米岩台与显式坡道'] },
  { id: 'calibration', name: '原创材质校样', kind: '材质与透明物件', description: '用简洁书房检查木纹、墙体、透明物件与格线的实际显示。', features: ['木纹地面与墙体', '两件独立透明物件', '可编辑的格线与单位'] },
] as const
type Sample = typeof samples[number]
const sceneImage = (id: Sample['id']) => `${import.meta.env.BASE_URL}assets/home-scenes/${manifest.entries[id].file}`
const dimensions = (id: Sample['id']) => { const { width, height } = manifest.entries[id].boundsMm; return `${width / 1000} × ${height / 1000} m` }

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
    <div className="home-detail-body"><figure><img src={sceneImage(sample.id)} width={entry.width} height={entry.height} alt={`${sample.name}主持人视图完整场景`}/><figcaption>实际样板全图 · 主持人视图</figcaption></figure><div className="home-detail-copy"><p>{sample.description}</p><ul>{sample.features.map(feature => <li key={feature}>{feature}</li>)}</ul><p className="home-detail-counts">{entry.rooms ? `${entry.rooms} 间房 · ` : ''}{entry.terrainAreas ? `${entry.terrainAreas} 处地形 · ` : ''}{entry.props} 件物件{entry.prefabInstances ? ` · ${entry.prefabInstances} 组组合` : ''}</p><p className="home-detail-note">保存为独立副本后，可继续编辑结构、素材和图层。</p></div></div>
    <div className="home-detail-actions"><button className="secondary" onClick={() => dismiss(onClose)}>返回首页</button><button className="primary" disabled={disabled} onClick={() => dismiss(onOpen)}>用此样板创建副本<ArrowRight size={16}/></button></div>
  </dialog>
}

export default function SampleShowcase({ onRequest, disabled }: { onRequest: (request: WorkspaceRequest) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<{ sample: Sample; trigger: HTMLButtonElement } | null>(null)
  const open = (sample: Sample) => { setSelected(null); onRequest({ type: 'sample', sample: sample.id }) }
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
