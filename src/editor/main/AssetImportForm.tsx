import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import type { AssetImportRequest } from '../../application/workspace/asset-batch'
import { assetDisplayNameFromPath, validateAssetDisplayName } from '../../shared/assets/import-manifest'
import { assetImageDimensions } from '../../platform/browser/assets/image-dimensions'
import AssetImportRequirements from './AssetImportRequirements'
import AssetSemanticsFields, { defaultAssetSemantics } from './AssetSemanticsFields'

export type AssetImportFields = AssetImportRequest
export default function AssetImportForm({ disabled, onImport }: { disabled: boolean; onImport: (input: AssetImportFields) => void }) {
  const [file, setFile] = useState<File | null>(null), [name, setName] = useState(''), [kind, setKind] = useState<'prop' | 'material'>('prop')
  const [width, setWidth] = useState('1000'), [height, setHeight] = useState('1000'), [footWidth, setFootWidth] = useState('1000'), [footHeight, setFootHeight] = useState('1000')
  const [movement, setMovement] = useState(true), [sight, setSight] = useState(false), [tags, setTags] = useState('')
  const [rootX, setRootX] = useState(''), [rootY, setRootY] = useState('')
  const [semantics, setSemantics] = useState(defaultAssetSemantics)
  const [pixels, setPixels] = useState<{ width: number; height: number } | null>(null)
  const customName = useRef(false), selection = useRef(0)
  useEffect(() => () => { selection.current++ }, [])
  const [license, setLicense] = useState(''), [attribution, setAttribution] = useState(''), [embed, setEmbed] = useState(false), [error, setError] = useState<string | null>(null)
  const submit = () => {
    const dimensions = [width, height, ...(kind === 'prop' ? [footWidth, footHeight] : [])].map(Number)
    try { validateAssetDisplayName(name) } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return }
    if (!file || !license.trim() || !attribution.trim() || !embed) { setError('请选图片，并填写名称、完整许可、署名和嵌入声明。'); return }
    if (dimensions.some(value => !Number.isSafeInteger(value) || value <= 0)) { setError('图像、占地或铺装尺寸须为正整数毫米。'); return }
    const anchor = rootX === '' && rootY === '' ? undefined : { x: Number(rootX), y: Number(rootY) }
    if (kind === 'prop' && anchor && (rootX === '' || rootY === '' || !Number.isSafeInteger(anchor.x) || !Number.isSafeInteger(anchor.y)
      || anchor.x < 0 || anchor.y < 0 || anchor.x > dimensions[0] || anchor.y > dimensions[1])) { setError('根锚须为图像范围内的整数毫米；留空使用图像中心。'); return }
    const offset = { x: Number(semantics.offsetX), y: Number(semantics.offsetY) }
    if (kind === 'prop' && ([semantics.offsetX, semantics.offsetY].some(value => value === '') || !Object.values(offset).every(value => Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000))) { setError('占地偏移须为有界整数毫米。'); return }
    if (kind === 'material' && !semantics.applicableSurfaces.length) { setError('请至少选择一种材质适用表面。'); return }
    setError(null)
    onImport({ file, name, kind, widthMm: dimensions[0], heightMm: dimensions[1], ...(kind === 'prop' ? { footprintWidthMm: dimensions[2], footprintHeightMm: dimensions[3], blocksMovement: movement, blocksSight: sight, renderLayer: semantics.renderLayer, shadowClass: semantics.shadowClass, footprintOffsetMm: offset, ...(anchor ? { rootAnchorMm: anchor } : {}) } : { applicableSurfaces: [...semantics.applicableSurfaces] }), tags: [...new Set(tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))], licenseText: license, attribution, canEmbed: true })
  }
  const chooseFile = async (selected: File | null) => {
    const epoch = ++selection.current
    setFile(selected); setPixels(null); setError(null)
    if (!customName.current) setName(selected ? assetDisplayNameFromPath(selected.name) : '')
    if (!selected) return
    try { const dimensions = await assetImageDimensions(selected); if (selection.current === epoch) setPixels(dimensions) }
    catch (failure) { if (selection.current === epoch) setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <details className="asset-details composition-import"><summary><Upload size={14}/>导入自有素材</summary><form onSubmit={event => { event.preventDefault(); submit() }}><fieldset disabled={disabled}>
    <p className="asset-muted">静态 PNG / JPEG / WebP / 受限 SVG。采用前会规范化图片、剥离元数据并预览；图像尺寸与物理占地分别填写。</p>
    <AssetImportRequirements/>
    <label>素材图片<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" aria-label="素材图片" onChange={event => void chooseFile(event.target.files?.[0] ?? null)}/></label>
    <label>素材名称<input required aria-label="素材名称" value={name} onChange={event => { customName.current = event.target.value !== ''; setName(event.target.value) }}/></label>
    {file && <small>名称与内部身份分开；同名不会覆盖已有素材。</small>}
    {pixels && <p role="status">来源比例 {pixels.width} × {pixels.height}。<button type="button" onClick={() => { const value = Number(width); if (Number.isSafeInteger(value) && value > 0) setHeight(String(Math.max(1, Math.round(value * pixels.height / pixels.width)))) }}>按图片比例计算高度</button></p>}
    <label>素材用途<select aria-label="素材用途" value={kind} onChange={event => setKind(event.target.value as 'prop' | 'material')}><option value="prop">独立物件</option><option value="material">平铺材质</option></select></label>
    <div className="composition-fields"><label>{kind === 'prop' ? '图像宽 mm' : '铺装宽 mm'}<input aria-label="素材宽度毫米" type="number" min="1" step="1" value={width} onChange={event => setWidth(event.target.value)}/></label><label>{kind === 'prop' ? '图像高 mm' : '铺装高 mm'}<input aria-label="素材高度毫米" type="number" min="1" step="1" value={height} onChange={event => setHeight(event.target.value)}/></label></div>
    {kind === 'prop' && <><div className="composition-fields"><label>占地宽 mm<input aria-label="素材占地宽度毫米" type="number" min="1" step="1" value={footWidth} onChange={event => setFootWidth(event.target.value)}/></label><label>占地高 mm<input aria-label="素材占地高度毫米" type="number" min="1" step="1" value={footHeight} onChange={event => setFootHeight(event.target.value)}/></label></div><label className="composition-check"><input type="checkbox" checked={movement} onChange={event => setMovement(event.target.checked)}/>阻挡移动</label><label className="composition-check"><input type="checkbox" checked={sight} onChange={event => setSight(event.target.checked)}/>阻挡视线</label></>}
    {kind === 'prop' && <details><summary>根锚与绘制表现</summary><div className="composition-fields"><label>根锚X mm<input aria-label="素材根锚X毫米" type="number" min="0" step="1" value={rootX} onChange={event => setRootX(event.target.value)}/></label><label>根锚Y mm<input aria-label="素材根锚Y毫米" type="number" min="0" step="1" value={rootY} onChange={event => setRootY(event.target.value)}/></label></div><small>从图像左上角计；同时留空使用中心。占地独立标定。</small>
      <AssetSemanticsFields value={{ ...semantics, kind }} onChange={patch => setSemantics(current => ({ ...current, ...patch }))} prefix="素材"/>
    </details>}
    {kind === 'material' && <AssetSemanticsFields value={{ ...semantics, kind }} onChange={patch => setSemantics(current => ({ ...current, ...patch }))} prefix="素材"/>}
    <label>标签（逗号分隔）<input aria-label="素材标签" value={tags} onChange={event => setTags(event.target.value)}/></label>
    <label>署名与来源<input required aria-label="素材署名与来源" value={attribution} onChange={event => setAttribution(event.target.value)}/></label>
    <label>完整许可文本<textarea required aria-label="素材完整许可" rows={4} value={license} onChange={event => setLicense(event.target.value)}/></label>
    <label className="composition-check"><input aria-label="确认素材可嵌入工程" type="checkbox" checked={embed} onChange={event => setEmbed(event.target.checked)}/>我有权将此素材及许可嵌入、分享于工程</label>
    {error && <p className="asset-form-error" role="alert">{error}</p>}<button className="primary asset-wide" type="submit" disabled={disabled || !file}>预览素材导入</button>
  </fieldset></form></details>
}
