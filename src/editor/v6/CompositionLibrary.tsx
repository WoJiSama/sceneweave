import { useMemo, useState } from 'react'
import { Layers3, Plus, Search } from 'lucide-react'
import type { CompleteProjectV6 } from '../../io/v6/types'
import AssetImportForm, { type AssetImportFieldsV6 } from './AssetImportForm'

type Kind = 'all' | 'prop' | 'material' | 'prefab'
export default function CompositionLibrary({ project, disabled, onPlace, onMaterial, onPrefab, onImport }: { project: CompleteProjectV6; disabled: boolean; onPlace: (id: string) => void; onMaterial: (id: string) => void; onPrefab: (id: string) => void; onImport: (input: AssetImportFieldsV6) => void }) {
  const [query, setQuery] = useState(''), [kind, setKind] = useState<Kind>('all'), [detailId, setDetailId] = useState<string | null>(null)
  const scene = project.document
  const definitions = useMemo(() => [
    ...Object.values(scene.propDefinitions).filter(item => !(item.id.startsWith('composition-retained-prop-') && item.tags.includes('sceneweave:retained-appearance'))).map(item => ({ id: item.id, name: item.name, tags: item.tags, kind: 'prop' as const, version: item.version, catalogId: item.catalogId, origin: item.origin, licenseRef: item.licenseRef, width: item.defaultVisualBoundsMm.width, height: item.defaultVisualBoundsMm.height, footprint: `${item.defaultFootprintMm.width} × ${item.defaultFootprintMm.height} mm` })),
    ...Object.values(scene.materials).map(item => ({ id: item.id, name: item.name, tags: item.tags, kind: 'material' as const, version: item.version, catalogId: item.catalogId, origin: item.origin, licenseRef: item.licenseRef, width: item.defaultTileSizeMm.width, height: item.defaultTileSizeMm.height, footprint: '保持表面几何' })),
    ...Object.values(scene.prefabDefinitions).map(item => ({ id: item.id, name: item.name, tags: item.tags, kind: 'prefab' as const, version: item.version, catalogId: item.catalogId, origin: item.origin, licenseRef: item.licenseRef, width: null, height: null, footprint: `${item.members.length} 个固定成员` })),
  ], [scene])
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean), found = definitions.filter(item => (kind === 'all' || item.kind === kind) && terms.every(term => `${item.name}\n${item.id}\n${item.catalogId}\n${item.tags.join(' ')}`.toLocaleLowerCase().includes(term)))
  const detail = definitions.find(item => item.id === detailId), binding = detail && project.licenseBindings.find(item => item.subjectId === detail.id), license = binding ? project.licenses[binding.licensePath.replace(/^licenses\//, '').replace(/\.txt$/, '')] : undefined
  return <section className="composition-library" aria-label="组件素材库"><div className="asset-section-heading"><Layers3 size={16}/><h2>组件素材库</h2><span>{definitions.length}</span></div>
    <label className="composition-search"><Search size={14}/><input type="search" aria-label="搜索组件素材" placeholder="名称、标签或 ID" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="asset-library-tabs" role="group" aria-label="素材类型">{(['all', 'prop', 'material', 'prefab'] as const).map(value => <button key={value} disabled={disabled} aria-pressed={kind === value} onClick={() => setKind(value)}>{{ all: '全部', prop: '物件', material: '材质', prefab: '组合' }[value]}</button>)}</div>
    <p className="asset-muted">{found.length} 项匹配 · 固定版本随工程保存</p><div className="composition-catalog">{found.map(item => <article key={item.id} data-definition-id={item.id} className={detailId === item.id ? 'selected' : ''}><button disabled={disabled} aria-label={`查看素材 ${item.name}`} onClick={() => setDetailId(current => current === item.id ? null : item.id)}><strong>{item.name}</strong><small>{{ prop: '物件', material: '材质', prefab: '组合' }[item.kind]} · v{item.version} · {item.width === null ? `${scene.prefabDefinitions[item.id].members.length} 件成员` : `${item.width} × ${item.height} mm`}</small><small>{item.tags.join(' · ')}</small></button><button className="composition-place" disabled={disabled} aria-label={`${item.kind === 'material' ? '应用材质' : '放置组件'} ${item.name}`} onClick={() => item.kind === 'prop' ? onPlace(item.id) : item.kind === 'material' ? onMaterial(item.id) : onPrefab(item.id)}><Plus size={14}/>{item.kind === 'material' ? '应用' : '放置'}</button></article>)}</div>
    {detail && <div className="composition-source" aria-label="素材来源详情"><h3>{detail.name}</h3><dl className="asset-facts"><dt>固定 ID</dt><dd>{detail.id} · v{detail.version}</dd><dt>来源</dt><dd>{detail.origin.kind} · {detail.catalogId} · {detail.origin.attribution}</dd><dt>物理范围</dt><dd>{detail.footprint}</dd><dt>许可</dt><dd>{detail.licenseRef}</dd></dl>{license && <details><summary>完整许可与署名</summary><pre>{license.text}</pre></details>}</div>}
    {!found.length && <p className="asset-muted">没有匹配素材。</p>}<AssetImportForm disabled={disabled} onImport={onImport}/>
  </section>
}
