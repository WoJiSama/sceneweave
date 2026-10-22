import { useState } from 'react'
import { Upload } from 'lucide-react'

export interface AssetImportFieldsV5 {
  file: Blob; name: string; kind: 'prop' | 'material'; widthMm: number; heightMm: number
  footprintWidthMm?: number; footprintHeightMm?: number; blocksMovement?: boolean; blocksSight?: boolean
  tags?: string[]; licenseText: string; attribution: string; canEmbed: true
}
export default function AssetImportForm({ disabled, onImport }: { disabled: boolean; onImport: (input: AssetImportFieldsV5) => void }) {
  const [file, setFile] = useState<File | null>(null), [name, setName] = useState(''), [kind, setKind] = useState<'prop' | 'material'>('prop')
  const [width, setWidth] = useState('1000'), [height, setHeight] = useState('1000'), [footWidth, setFootWidth] = useState('1000'), [footHeight, setFootHeight] = useState('1000')
  const [movement, setMovement] = useState(true), [sight, setSight] = useState(false), [tags, setTags] = useState('')
  const [license, setLicense] = useState(''), [attribution, setAttribution] = useState(''), [embed, setEmbed] = useState(false), [error, setError] = useState<string | null>(null)
  const submit = () => {
    const dimensions = [width, height, ...(kind === 'prop' ? [footWidth, footHeight] : [])].map(Number)
    if (!file || !name.trim() || !license.trim() || !attribution.trim() || !embed) { setError('请选图片，并填写名称、完整许可、署名和嵌入声明。'); return }
    if (dimensions.some(value => !Number.isSafeInteger(value) || value <= 0)) { setError('图像、占地或铺装尺寸须为正整数毫米。'); return }
    setError(null)
    onImport({ file, name: name.trim(), kind, widthMm: dimensions[0], heightMm: dimensions[1], ...(kind === 'prop' ? { footprintWidthMm: dimensions[2], footprintHeightMm: dimensions[3], blocksMovement: movement, blocksSight: sight } : {}), tags: tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean), licenseText: license.trim(), attribution: attribution.trim(), canEmbed: true })
  }
  return <details className="asset-details composition-import"><summary><Upload size={14}/>导入自有素材</summary><form onSubmit={event => { event.preventDefault(); submit() }}><fieldset disabled={disabled}>
    <p className="asset-muted">静态 PNG / JPEG / WebP。采用前会规范化图片、剥离元数据并预览；图像尺寸与物理占地分别填写。</p>
    <label>素材图片<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="素材图片" onChange={event => { const selected = event.target.files?.[0] ?? null; setFile(selected); if (selected && !name) setName(selected.name.replace(/\.[^.]+$/, '')); setError(null) }}/></label>
    <label>素材名称<input required aria-label="素材名称" value={name} maxLength={120} onChange={event => setName(event.target.value)}/></label>
    <label>素材用途<select aria-label="素材用途" value={kind} onChange={event => setKind(event.target.value as 'prop' | 'material')}><option value="prop">独立物件</option><option value="material">平铺材质</option></select></label>
    <div className="composition-fields"><label>{kind === 'prop' ? '图像宽 mm' : '铺装宽 mm'}<input aria-label="素材宽度毫米" type="number" min="1" step="1" value={width} onChange={event => setWidth(event.target.value)}/></label><label>{kind === 'prop' ? '图像高 mm' : '铺装高 mm'}<input aria-label="素材高度毫米" type="number" min="1" step="1" value={height} onChange={event => setHeight(event.target.value)}/></label></div>
    {kind === 'prop' && <><div className="composition-fields"><label>占地宽 mm<input aria-label="素材占地宽度毫米" type="number" min="1" step="1" value={footWidth} onChange={event => setFootWidth(event.target.value)}/></label><label>占地高 mm<input aria-label="素材占地高度毫米" type="number" min="1" step="1" value={footHeight} onChange={event => setFootHeight(event.target.value)}/></label></div><label className="composition-check"><input type="checkbox" checked={movement} onChange={event => setMovement(event.target.checked)}/>阻挡移动</label><label className="composition-check"><input type="checkbox" checked={sight} onChange={event => setSight(event.target.checked)}/>阻挡视线</label></>}
    <label>标签（逗号分隔）<input aria-label="素材标签" value={tags} onChange={event => setTags(event.target.value)}/></label>
    <label>署名与来源<input required aria-label="素材署名与来源" value={attribution} onChange={event => setAttribution(event.target.value)}/></label>
    <label>完整许可文本<textarea required aria-label="素材完整许可" rows={4} value={license} onChange={event => setLicense(event.target.value)}/></label>
    <label className="composition-check"><input aria-label="确认素材可嵌入工程" type="checkbox" checked={embed} onChange={event => setEmbed(event.target.checked)}/>我有权将此素材及许可嵌入、分享于工程</label>
    {error && <p className="asset-form-error" role="alert">{error}</p>}<button className="primary asset-wide" type="submit" disabled={disabled || !file}>预览素材导入</button>
  </fieldset></form></details>
}
