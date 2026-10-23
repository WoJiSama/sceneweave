import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Clock3, FileUp, FolderOpen, Layers3, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { discoverProjects, repositoryLabels, type DiscoveryResult } from './project-registry'
import type { WorkspaceRequest, WorkspaceSessionSummary } from './session'
import './home.css'

const samples = [
  { id: 'study' as const, name: '书房与露台', kind: '室内建筑', detail: '厚墙、共边与门窗，木纹家具与组合。', className: 'study' },
  { id: 'island' as const, name: '双层岩岛', kind: '地形与室外', detail: '高差、岩岸和台阶，保留人工调整的散布。', className: 'island' },
  { id: 'outpost' as const, name: '海岸哨所', kind: '混合场景', detail: '房间、院子与海岸，在同一工程里继续创作。', className: 'outpost' },
  { id: 'graveyard' as const, name: '苔石墓园', kind: '墓地内容小样', detail: '墓碑、石棺与铁栏组合，逐件编辑苔石墓园。', className: 'study' },
  { id: 'volcano' as const, name: '灰烬熔脉', kind: '火山内容小样', detail: '玄武岩、灰烬与熔脉，危险和高差分别设置。', className: 'island' },
]
export default function WorkspaceHome({ session, onRequest, onContinue, onLegacy }: {
  session: WorkspaceSessionSummary | null
  onRequest: (request: WorkspaceRequest) => void
  onContinue: () => void
  onLegacy: (route: string) => void
}) {
  const [result, setResult] = useState<DiscoveryResult>({ entries: [], issues: [] })
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(''), [refresh, setRefresh] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true); setError(null)
    void discoverProjects(abort.signal).then(value => { if (!abort.signal.aborted) setResult(value) }, failure => {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [refresh])
  const entries = result.entries.filter(entry => `${entry.title} ${entry.reference.sceneId} ${repositoryLabels[entry.reference.repository]}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <div className="workspace-home" data-testid="workspace-home">
    <header className="home-header"><a href="#home" className="home-brand" aria-label="织境首页"><Layers3 size={28}/><span>织境 <small>Sceneweave</small></span></a><span className="home-local"><ShieldCheck size={15}/>本地优先 · 工程保存在此浏览器</span></header>
    <main className="home-content">
      <section className="home-hero"><div className="home-intro"><p className="home-eyebrow">YOUR NEXT ADVENTURE STARTS HERE</p><h1>把故事画成可以探索的地方</h1><p>从一间房、一段海岸开始。用建筑、地形与素材，编织你的下一场冒险。</p><div className="home-actions"><button className="primary" onClick={() => onRequest({ type: 'new' })}><Plus size={18}/>新建场景</button><button className="secondary" onClick={() => onRequest({ type: 'import' })}><FileUp size={17}/>打开工程文件</button></div><small>完整工程保留素材、许可与已选择的历史。请定期下载备份。</small></div><div className="home-map" aria-hidden="true"><div className="home-map-grid"/><div className="home-map-room room-one"/><div className="home-map-room room-two"/><div className="home-map-table"/><i className="home-map-tree tree-one"/><i className="home-map-tree tree-two"/><i className="home-map-tree tree-three"/><span>一张地图，无数种故事</span></div></section>
      {session && <section className="home-continue" aria-label="当前编辑会话"><div><p><Clock3 size={15}/>当前编辑会话</p><h2>{session.title}</h2><span>r{session.revision} · 回到原来的选区、视口和撤销记录</span></div><button className="primary" onClick={onContinue}>继续编辑<ArrowRight size={16}/></button></section>}
      <section className="home-projects" aria-labelledby="home-projects-title"><div className="home-section-heading"><div><p className="home-eyebrow">YOUR PROJECTS</p><h2 id="home-projects-title">最近工程</h2></div><div className="home-list-tools"><label><Search size={16}/><input ref={search} aria-label="搜索最近工程" placeholder="名称、ID 或仓库" value={query} onChange={event => setQuery(event.target.value)}/></label><button className="secondary" aria-label="刷新工程列表" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} className={loading ? 'spin' : ''}/><span>刷新</span></button></div></div>
        <p className="home-project-note">汇总六个本地仓库。同名工程分别保留；旧工程经确认后升级为独立副本。列表仅发现存档，打开时才完整校验。</p>
        {loading && <p role="status" className="home-empty">正在读取本地工程列表…</p>}
        {error && <p role="alert" className="home-diagnostic">无法读取列表：{error}</p>}
        {result.issues.map((issue, index) => <p role="alert" className="home-diagnostic" key={`${issue.repository}:${index}`}>{repositoryLabels[issue.repository]}：{issue.message}</p>)}
        {!loading && entries.length === 0 && <div className="home-empty"><FolderOpen size={25}/><p>{query ? '没有匹配的工程' : '从第一张场景开始'}</p><span>{query ? '试试其他名称，或清空搜索。' : '新建空白场景，或打开下方可编辑样板。'}</span></div>}
        <div className="home-project-list">{entries.map(entry => {
          const current = session?.sceneId === entry.reference.sceneId && entry.reference.repository === 'v6'
          return <article className="home-project-row" key={entry.key} data-project-key={entry.key}><span className="home-file-icon"><Layers3 size={21}/></span><div className="home-project-info"><h3>{entry.title}</h3><p>{repositoryLabels[entry.reference.repository]} · r{entry.revision}{entry.savedAt && ` · ${new Date(entry.savedAt).toLocaleString('zh-CN')}`}</p><small title={entry.reference.sceneId}>{entry.reference.sceneId}</small>{entry.issue && <p role="alert" className="home-row-issue">无法打开：{entry.issue}。原存档已保留，可尝试在旧版入口检查。</p>}</div><button className="secondary" disabled={!!entry.issue} onClick={() => current ? onContinue() : onRequest({ type: 'open', reference: entry.reference })}>{current ? '继续编辑' : entry.reference.repository === 'v6' ? '打开' : '升级为副本'}<ArrowRight size={15}/></button></article>
        })}</div>
      </section>
      <section aria-labelledby="home-samples-title"><div className="home-section-heading"><div><p className="home-eyebrow">START WITH A SCENE</p><h2 id="home-samples-title">从样板开始</h2></div><span>可编辑 · 完整素材与许可 · 打开为副本</span></div><div className="home-samples">{samples.map(sample => <button key={sample.id} className={`home-sample ${sample.className}`} aria-label={sample.name} onClick={() => onRequest({ type: 'sample', sample: sample.id })}><span className="home-sample-art" aria-hidden="true"><i/><i/><i/><b/></span><span className="home-sample-copy"><small>{sample.kind}</small><strong>{sample.name}<ArrowRight size={16}/></strong><span>{sample.detail}</span></span></button>)}</div></section>
      <footer className="home-footer"><p>本地存档不会随站点更新迁移到云端。不同浏览器、设备和站点地址拥有各自的存储。</p><details><summary>旧版兼容入口</summary><p>用于检查旧格式工程与历史包。进入这些编辑器会结束当前编辑会话；原存档保留。</p><div>{([['geometry', '几何原型'], ['assets', '素材工坊'], ['layers', '图层工坊'], ['history', '历史工坊'], ['composition', '组件工坊'], ['outdoor', '室外工坊']] as const).map(([route, label]) => <button key={route} onClick={() => onLegacy(route)}>{label}</button>)}</div></details></footer>
    </main>
  </div>
}
