import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImagePixels, ImagePixelMask, PixelBounds } from '../../shared/image-import/pixels'
import type { previewImageImportSubject } from '../../shared/image-import/subject-refinement'
import type { ImageImportRecipe } from '../../shared/image-import/recipe'
import './image-subject-refinement-review.css'

type SubjectOptions = NonNullable<ImageImportRecipe['layers'][number]['subjectRefinement']>
type Candidate = ReturnType<typeof previewImageImportSubject>
interface Props {
  targetName: string
  adopted?: SubjectOptions
  method: SubjectOptions['method']
  inputNote: string
  bandPx: 1 | 2
  strength: SubjectOptions['strength']
  protection: string
  protectionPixels: number
  brush: 'keep' | 'remove' | null
  brushRadius: number
  excluded: string
  candidate: Candidate | null
  error: string
  disabled: boolean
  onBand: (value: 1 | 2) => void
  onMethod: (value: SubjectOptions['method']) => void
  onStrength: (value: SubjectOptions['strength']) => void
  onProtection: (value: string) => void
  onBrush: (value: 'keep' | 'remove' | null) => void
  onBrushRadius: (value: number) => void
  onResetProtection: (toAdopted: boolean) => void
  onExcluded: (value: string) => void
  onGenerate: () => void
  onAdopt: () => void
  onRestore: () => void
  onLocate: (bounds: PixelBounds, label: string) => void
}

function SubjectPixels({ pixels, grid, label, scale, background, uncertainty }: { pixels: ImagePixels & { boundsPx: PixelBounds }; grid: PixelBounds; label: string; scale: number; background: string; uncertainty?: ImagePixelMask }) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const context = target.getContext('2d')!, image = context.createImageData(pixels.width, pixels.height)
    image.data.set(pixels.data); context.clearRect(0, 0, grid.width, grid.height)
    context.putImageData(image, pixels.boundsPx.x - grid.x, pixels.boundsPx.y - grid.y)
    if (overlay.current) {
      const top = overlay.current.getContext('2d')!, marks = top.createImageData(grid.width, grid.height)
      if (uncertainty) for (let y = 0; y < uncertainty.height; y++) for (let x = 0; x < uncertainty.width; x++) {
        if (!uncertainty.data[y * uncertainty.width + x]) continue
        const xx = uncertainty.boundsPx.x + x - grid.x, yy = uncertainty.boundsPx.y + y - grid.y
        if (xx >= 0 && yy >= 0 && xx < grid.width && yy < grid.height) marks.data.set([255, 165, 30, 170], (yy * grid.width + xx) * 4)
      }
      top.clearRect(0, 0, grid.width, grid.height); top.putImageData(marks, 0, 0)
    }
  }, [pixels, grid, uncertainty])
  return <figure className="image-subject-stage"><figcaption>{label}</figcaption><div className="image-subject-scroller">
    <div className="image-subject-pixels" data-background={background} style={{ width: grid.width * scale, height: grid.height * scale }}>
      <canvas ref={canvas} width={grid.width} height={grid.height} style={{ width: grid.width * scale, height: grid.height * scale }} aria-label={label} data-source-grid={JSON.stringify(grid)} data-stage-bounds={JSON.stringify(pixels.boundsPx)}/>
      <canvas ref={overlay} className="image-subject-uncertainty" width={grid.width} height={grid.height} style={{ width: grid.width * scale, height: grid.height * scale }} aria-hidden="true"/>
    </div></div></figure>
}

const metricLabels: Record<string, string> = {
  candidatePixels: '边带候选像素', alphaChangedPixels: '覆盖度变化像素', rgbChangedPixels: '颜色变化像素', uncertainPixels: '待判断像素', protectedPixels: '受保护像素',
  stableForegroundPixels: '稳定主体依据像素', stableBackgroundPixels: '稳定背景依据像素', binaryBoundaryPixels: '不透明边缘像素', fractionalBoundaryPixels: '原有半透明边缘像素', estimatedPixels: '获得混色估计的像素',
  coreChangedPixels: '核心变化像素', outsideSupportChangedPixels: '原轮廓外变化像素', holeChangedPixels: '孔洞变化像素', thinChangedPixels: '细杆变化像素',
  originalSelectedRgbChangedPixels: '原选中像素的颜色变化', originalSupportRemovedPixels: '原选中像素完全消失数', outerSupportAddedPixels: '轮廓外新增覆盖像素',
  outerCoverageAreaPx: '轮廓外推断覆盖面积（像素）', originalCoverageAreaPx: '原始覆盖面积（像素）', coverageAreaPx: '派生覆盖面积（像素）', areaDeltaPx: '覆盖面积变化（像素）', areaPreserved: '总覆盖面积保持',
  maxVertexMovePx: '轮廓点最大移动（像素）', normalOffsetPx: '面积补偿偏移（像素）', comparisons: '局部计算次数', coverageIsEstimated: '覆盖度含估计', foregroundIsEstimated: '主体颜色含混色估计', outerPlacementIsInferred: '外侧位置含推断', colorSpace: '颜色空间',
}
const reasonLabels: Record<string, string> = { 'low-contrast': '内外色差不足', 'unstable-foreground': '主体颜色依据不稳定', 'unstable-background': '底色依据不稳定', 'model-residual': '局部混色解释不足', 'thin-feature': '细杆或窄边保全', 'excluded-evidence': '保护或排除范围限制', 'coverage-estimate': '局部覆盖估计', 'inferred-outer-coverage': '轮廓外覆盖推断', 'area-constraint': '局部面积补偿受限' }
const metricValue = (value: unknown) => typeof value === 'boolean' ? value ? '是' : '否' : value === 'captured-srgb' ? '原图捕获色彩' : typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(4) : String(value)

export default function ImageSubjectRefinementReview({ targetName, adopted, method, inputNote, bandPx, strength, protection, protectionPixels, brush, brushRadius, excluded, candidate, error, disabled,
  onMethod, onBand, onStrength, onProtection, onBrush, onBrushRadius, onResetProtection, onExcluded, onGenerate, onAdopt, onRestore, onLocate }: Props) {
  const [background, setBackground] = useState('checker'), [scale, setScale] = useState(4), [uncertain, setUncertain] = useState(true)
  const grid = useMemo(() => {
    if (!candidate) return null
    const bounds = [candidate.original.boundsPx, candidate.coveragePixels.boundsPx, candidate.pixels.boundsPx]
    const x = Math.min(...bounds.map(value => value.x)), y = Math.min(...bounds.map(value => value.y))
    return { x, y, width: Math.max(...bounds.map(value => value.x + value.width)) - x, height: Math.max(...bounds.map(value => value.y + value.height)) - y }
  }, [candidate])
  return <section className="image-subject-review" aria-label="主体边带精修" data-import-target="subject-refinement" tabIndex={-1}>
    <h3>{targetName} · 主体边带精修</h3>
    <p>先比较原始裁片、覆盖度估计和最终派生结果。边带变化是估计的外观；原始裁片、选区记录和补底保留，采用后的外观用于物件预览与新工程。轮廓抗锯齿允许在原轮廓外1像素内推断覆盖，轮廓范围可能扩大。</p>
    <p role="status">{adopted ? `当前已采用派生：${adopted.bandPx}px · ${{ gentle: '轻度', balanced: '均衡', strong: '较强' }[adopted.strength]}。已采用方式：${adopted.method === 'subject-contour-v1' ? '轮廓抗锯齿' : '颜色混合估计'}。` : '当前使用原始裁片。'}生成候选不会改变物件。</p>
    {inputNote && <p role="note">{inputNote}可以显式选择其他方式；不适用时会说明原因，不会改写选区或自动切换已采用配方。</p>}
    <div className="image-subject-settings"><label>处理方式<select aria-label="主体精修方式" value={method} disabled={disabled} onChange={event => onMethod(event.target.value as SubjectOptions['method'])}><option value="subject-contour-v1">轮廓抗锯齿 · 保留整体粗细</option><option value="subject-matte-v1">颜色混合估计 · 需要可信底色</option></select></label>
      <label>边带范围<select aria-label="主体精修边带" value={bandPx} disabled={disabled || method === 'subject-contour-v1'} onChange={event => onBand(Number(event.target.value) as 1 | 2)}><option value={1}>1个原图像素</option><option value={2}>2个原图像素</option></select></label>
      <label>处理强度<select aria-label="主体精修强度" value={strength} disabled={disabled} onChange={event => onStrength(event.target.value as SubjectOptions['strength'])}><option value="gentle">轻度</option><option value="balanced">均衡</option><option value="strong">较强</option></select></label></div>
    {method === 'subject-contour-v1' && <p role="note">沿选区轮廓计算像素覆盖并尝试保持总覆盖面积，实际是否保持见变化指标。原选中颜色保持，外侧1像素内的新增覆盖延拓原前景颜色并标为待判断；此方式尚未去混色，下面两个派生阶段相同。先确认主体归属，再检查边缘是否自然。</p>}
    <div className="image-subject-protection" role="group" aria-label="主体描边保护画笔">
      <p>描边容易被当作混色时，在原图上涂少量必须保留的地方。黄色覆盖为主体保护，保护处的透明度和颜色保持原样。</p>
      <div className="image-subject-settings"><label>保护画笔半径<input aria-label="主体保护画笔半径" type="number" min={.5} max={16} step={.5} value={brushRadius} disabled={disabled} onChange={event => onBrushRadius(Math.max(.5, Math.min(16, Number(event.target.value) || .5)))}/><span>原图像素</span></label></div>
      <div className="image-subject-actions"><button type="button" disabled={disabled} aria-pressed={brush === 'keep'} onClick={() => onBrush('keep')}>保护主体描边</button><button type="button" disabled={disabled} aria-pressed={brush === 'remove'} onClick={() => onBrush('remove')}>擦除主体保护</button><button type="button" disabled={disabled || !brush} onClick={() => onBrush(null)}>结束主体保护画笔</button></div>
      <p role="status">主体保护 · {protectionPixels} 个原图像素{brush ? ` · 正在${brush === 'keep' ? '涂保护' : '擦除保护'}` : ''}。此输入须生成候选并显式采用后才随工作包保存。</p>
      <div className="image-subject-actions"><button type="button" disabled={disabled || !protection.trim()} onClick={() => onResetProtection(false)}>清空主体保护</button><button type="button" disabled={disabled} onClick={() => onResetProtection(true)}>取消本次保护修改</button></div>
    </div>
    <details><summary>保护主体与排除取证范围</summary><p>可填原图坐标的RLE蒙版JSON（x、y、width、height、runs）；留空表示未设置。主体保护范围不改动，也不作为估计依据；取证排除范围不用于背景判断。此处临时输入须采用后才随工作包保存。</p>
      <label>主体保护蒙版JSON<textarea aria-label="主体保护蒙版JSON" rows={3} maxLength={65536} value={protection} disabled={disabled} onChange={event => onProtection(event.target.value)}/></label>
      <label>主体取证排除蒙版JSON<textarea aria-label="主体取证排除蒙版JSON" rows={3} maxLength={65536} value={excluded} disabled={disabled} onChange={event => onExcluded(event.target.value)}/></label></details>
    <div className="image-subject-actions"><button type="button" disabled={disabled} onClick={onGenerate}>生成主体精修候选</button>
      <button type="button" disabled={disabled || !candidate} onClick={onAdopt}>采用此主体精修</button>
      <button type="button" disabled={disabled || !adopted} onClick={onRestore}>恢复原始裁片</button></div>
    {error && <p role="alert" className="image-import-error">{error}</p>}
    {candidate && grid ? <>
      <p>只读候选 · 尚未采用。三阶段对齐到同一原图网格：({grid.x}, {grid.y}) · {grid.width} × {grid.height} px，使用相同倍率；原裁片范围外以透明像素补齐对照。</p>
      <div className="image-subject-settings"><label>精修检查背景<select aria-label="主体精修检查背景" value={background} onChange={event => setBackground(event.target.value)}><option value="checker">棋盘格</option><option value="black">黑色</option><option value="white">白色</option></select></label>
        <label>精修对照倍率<select aria-label="主体精修对照倍率" value={scale} onChange={event => setScale(Number(event.target.value))}><option value={1}>100%</option><option value={2}>200%</option><option value={4}>400%</option></select></label></div>
      <SubjectPixels pixels={candidate.original} grid={grid} label="原始裁片 · 未精修" scale={scale} background={background}/>
      <SubjectPixels pixels={candidate.coveragePixels} grid={grid} label={candidate.method === 'subject-contour-v1' ? '覆盖度阶段 · 轮廓抗锯齿' : '覆盖度阶段 · 仅调整透明度'} scale={scale} background={background}/>
      <SubjectPixels pixels={candidate.pixels} grid={grid} label={candidate.method === 'subject-contour-v1' ? '轮廓派生结果 · 尚未去混色' : '去混色阶段 · 派生结果'} scale={scale} background={background} uncertainty={uncertain ? candidate.uncertaintyMask : undefined}/>
      <label><input type="checkbox" checked={uncertain} onChange={event => setUncertain(event.target.checked)}/>在派生结果上显示橙色待判断区</label>
      <details><summary>实际变化与依据</summary><ul>{Object.entries(candidate.metrics).filter(([key]) => key in metricLabels).map(([key, value]) => <li key={key}>{metricLabels[key]}：{metricValue(value)}</li>)}</ul></details>
      <div className="image-subject-issues"><h4>需要局部判断的地方 · {candidate.issues.length} 处</h4>{candidate.issues.length ? candidate.issues.map((issue, index) => <details key={index} open={index === 0}><summary>{issue.message}</summary><p>原图 ({issue.boundsPx.x}, {issue.boundsPx.y}) · {issue.boundsPx.width} × {issue.boundsPx.height} px。{reasonLabels[issue.reason] ?? '局部依据待确认'}</p><button type="button" disabled={disabled} onClick={() => onLocate(issue.boundsPx, issue.message)}>定位主体待判断区域</button></details>) : <p>当前规则没有列出局部问题，仍须在黑白底检查描边、细杆、孔洞与色边。</p>}</div>
      <p>零变化不代表改善。橙色范围、数值和成功生成都不能代替视觉审核；原图保真面板只校验原始裁片与补底，派生边带另行审阅。</p>
    </> : <p>生成只读候选后可比较三个阶段；输入、参数或图层变化后旧候选失效，请重新生成。</p>}
  </section>
}
