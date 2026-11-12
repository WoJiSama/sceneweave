import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { EditableProject } from '../../application/workspace/project'
import type { ImageEnhancementCandidate, ImageEnhancementDirection, ImageEnhancementRecipe } from '../../shared/image-enhancement'
import type { ImagePixelMask, ImagePixels } from '../../shared/image-import/pixels'
import type { ImagePoint } from '../../shared/image-import/calibration'
import { paintImageSelection } from '../../shared/image-import/selection'
import { inspectImageEnhancementTarget, readImageEnhancementSource, type ImageEnhancementSource, type ImageEnhancementTarget } from '../../platform/browser/content/image-enhancement'
import { generateImageEnhancementCandidatesAsync } from '../../platform/browser/content/image-enhancement-worker'
import './image-enhancement-panel.css'

export interface ImageEnhancementPanelProps {
  project: EditableProject
  target: ImageEnhancementTarget
  disabled: boolean
  onPreview: (source: ImageEnhancementSource, recipe: ImageEnhancementRecipe, scopeMask?: Uint8Array, signal?: AbortSignal) => Promise<void>
  onClose: () => void
  embedded?: boolean
  previewContext?: 'scene' | 'asset'
  onPendingChange?: (pending: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}

type Scope = 'all' | 'local'
type Zoom = 'fit' | '100' | '200' | '400'
type Batch = { source: ImageEnhancementSource; scope?: Uint8Array; candidates: ImageEnhancementCandidate[] }
type Stroke = { pointerId: number; before: ImagePixelMask | null; last: ImagePoint; value: ImagePixelMask }
const directions: Array<[ImageEnhancementDirection, string, string]> = [
  ['clarity', '插值放大', '仅用已有像素生成 2 倍图像，比较平滑程度，不增加细节。'],
  ['edge', '边缘更干净', '调整已有半透明边缘，保留孔洞、细枝与原色。'],
  ['contour', '减轻硬边阶梯', '仅软化有实心支撑的二值斜角，保留原色、孔洞与细杆；描边可能略淡，请换底核对。'],
  ['denoise', '减少噪点', '轻量处理相近颜色的杂点，注意保留手绘笔触。'],
  ['decontaminate', '减轻背景色边', '根据稳定的内侧颜色，局部估计并减轻窄边带混色；保留轮廓与亮度，请换底核对真实边饰。'],
]
const message = (error: unknown) => error instanceof Error ? error.message : '画质处理失败，请重新生成。'
const emptyMask = (): ImagePixelMask => ({ width: 1, height: 1, boundsPx: { x: 0, y: 0, width: 1, height: 1 }, data: new Uint8Array(1) })

function expandScope(image: ImagePixels, mask: ImagePixelMask | null): Uint8Array {
  if (!mask || !mask.data.some(value => value > 0)) throw new Error('请先用画笔涂出需要处理的区域。')
  const scope = new Uint8Array(image.width * image.height)
  for (let y = 0; y < mask.height; y++) scope.set(mask.data.subarray(y * mask.width, (y + 1) * mask.width), (y + mask.boundsPx.y) * image.width + mask.boundsPx.x)
  return scope
}

function PixelCanvas({ pixels, baseWidth, zoom, label, mask, brush, ...events }: {
  pixels: ImagePixels
  baseWidth: number
  zoom: Zoom
  label: string
  mask?: ImagePixelMask | null
  brush?: { point: ImagePoint; radius: number } | null
  onPointerDown?: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerMove?: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerUp?: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerCancel?: (event: PointerEvent<HTMLCanvasElement>) => void
  onLostPointerCapture?: (event: PointerEvent<HTMLCanvasElement>) => void
  onPointerLeave?: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    target.width = pixels.width; target.height = pixels.height
    const context = target.getContext('2d')!
    const raster = context.createImageData(pixels.width, pixels.height)
    raster.data.set(pixels.data); context.putImageData(raster, 0, 0)
    if (mask) {
      const overlay = document.createElement('canvas')
      overlay.width = mask.width; overlay.height = mask.height
      const tint = overlay.getContext('2d')!, selected = tint.createImageData(mask.width, mask.height)
      for (let index = 0; index < mask.data.length; index++) selected.data.set([39, 158, 119, Math.round(mask.data[index] * .4)], index * 4)
      tint.putImageData(selected, 0, 0)
      context.drawImage(overlay, mask.boundsPx.x, mask.boundsPx.y)
      overlay.width = overlay.height = 0
    }
  }, [pixels, mask])
  return <div className="image-enhancement-raster" style={{ width: zoom === 'fit' ? '100%' : baseWidth * Number(zoom) / 100 }}>
    <canvas ref={canvas} aria-label={label} {...events}/>
    {brush && <span className="image-enhancement-brush-cursor" aria-hidden="true" style={{ left: `${brush.point.x / pixels.width * 100}%`, top: `${brush.point.y / pixels.height * 100}%`, width: `${brush.radius * 2 / pixels.width * 100}%` }}/>}
  </div>
}

/** Candidate pixels are local review data. The workspace owns preview, adoption, undo and save. */
export default function ImageEnhancementPanel({ project, target, disabled, onPreview, onClose, embedded = false, previewContext = 'scene', onPendingChange, onDirtyChange }: ImageEnhancementPanelProps) {
  const [basis, setBasis] = useState<'current' | 'original'>('current')
  const [source, setSource] = useState<ImageEnhancementSource | null>(null)
  const [direction, setDirection] = useState<ImageEnhancementDirection>('clarity'), [count, setCount] = useState<2 | 3>(2)
  const [scope, setScope] = useState<Scope>('all'), [mask, setMask] = useState<ImagePixelMask | null>(null)
  const [showScope, setShowScope] = useState(true)
  const [brushMode, setBrushMode] = useState<'keep' | 'remove'>('keep'), [radius, setRadius] = useState(12)
  const [cursor, setCursor] = useState<ImagePoint | null>(null), [strokeActive, setStrokeActive] = useState(false)
  const [scopeHistory, setScopeHistory] = useState<Array<ImagePixelMask | null>>([])
  const [batch, setBatch] = useState<Batch | null>(null), [selected, setSelected] = useState<string | null>(null)
  const [background, setBackground] = useState('checker'), [zoom, setZoom] = useState<Zoom>('fit')
  const [collapsed, setCollapsed] = useState(false), [pending, setPending] = useState<'load' | 'generate' | 'preview' | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const operation = useRef<AbortController | null>(null), generation = useRef(0), stroke = useRef<Stroke | null>(null)
  const latest = useRef({ project, target, basis }); latest.current = { project, target, basis }
  const sourceViewport = useRef<HTMLDivElement>(null), candidateViewport = useRef<HTMLDivElement>(null)
  const scopeCanvas = useRef<HTMLCanvasElement | null>(null)
  const info = useMemo(() => inspectImageEnhancementTarget(project, target), [project, target.kind, target.id])
  const stale = !!source && (!info || info.baseline !== source.baseline)
  const selectedCandidate = batch?.candidates.find(candidate => candidate.id === selected)
  const sourcePixels = source ? direction === 'decontaminate' || direction === 'contour' ? source.canonicalPixels ?? source.pixels : source.pixels : null
  const selectedPixels = useMemo(() => mask?.data.reduce((total, value) => total + (value > 0 ? 1 : 0), 0) ?? 0, [mask])
  const editing = disabled || !!pending
  const pendingCallback = useRef(onPendingChange), dirtyCallback = useRef(onDirtyChange)
  pendingCallback.current = onPendingChange; dirtyCallback.current = onDirtyChange
  useEffect(() => { pendingCallback.current?.(pending !== null) }, [pending])
  useEffect(() => { dirtyCallback.current?.(!!batch || selectedPixels > 0) }, [batch, selectedPixels])
  useEffect(() => () => { pendingCallback.current?.(false); dirtyCallback.current?.(false) }, [])

  const cancelStroke = () => {
    const current = stroke.current
    if (!current) return
    stroke.current = null; setMask(current.before); setStrokeActive(false)
    const canvas = scopeCanvas.current
    if (canvas?.hasPointerCapture(current.pointerId)) canvas.releasePointerCapture(current.pointerId)
  }
  const cancelOperation = () => {
    generation.current++; operation.current?.abort(); operation.current = null; setPending(null)
  }
  const discard = () => { cancelOperation(); cancelStroke(); setBatch(null); setSelected(null); setNotice('候选已丢弃，场景保持原样。'); setError('') }
  const invalidateCandidates = () => { setBatch(null); setSelected(null); setNotice(''); setError('') }
  const load = async () => {
    cancelOperation(); cancelStroke()
    const abort = new AbortController(), stamp = ++generation.current, captured = latest.current
    operation.current = abort; setPending('load'); setSource(null); setMask(null); setScopeHistory([]); setCursor(null); invalidateCandidates()
    try {
      const result = await readImageEnhancementSource(captured.project, captured.target, captured.basis, abort.signal)
      if (abort.signal.aborted || stamp !== generation.current) return
      setSource(result)
    } catch (error) { if (!abort.signal.aborted && stamp === generation.current) setError(message(error)) }
    finally { if (stamp === generation.current) { operation.current = null; setPending(null) } }
  }
  useEffect(() => {
    void load()
    return () => { generation.current++; operation.current?.abort(); operation.current = null; stroke.current = null }
  }, [target.kind, target.id, basis])
  useEffect(() => {
    window.addEventListener('blur', cancelStroke)
    return () => window.removeEventListener('blur', cancelStroke)
  }, [])
  useEffect(() => { if (disabled || stale) cancelStroke() }, [disabled, stale])

  const generate = async () => {
    if (!source || !sourcePixels || stale || disabled || pending || strokeActive) return
    let selectedScope: Uint8Array | undefined
    try { selectedScope = scope === 'local' ? expandScope(source.pixels, mask) : undefined }
    catch (error) { setError(message(error)); return }
    cancelOperation()
    const abort = new AbortController(), stamp = ++generation.current
    operation.current = abort; setPending('generate'); setError(''); setNotice(''); setBatch(null); setSelected(null)
    try {
      const candidates = await generateImageEnhancementCandidatesAsync(sourcePixels, { direction, count, scopeMask: selectedScope }, abort.signal)
      if (abort.signal.aborted || stamp !== generation.current) return
      setBatch({ source, scope: selectedScope, candidates }); setSelected(candidates[0]?.id ?? null); setShowScope(false); setCursor(null)
      setNotice(candidates.every(candidate => candidate.metrics.changedPixels === 0)
        ? '本组没有像素变化，本次未处理；这不表示原图没有色边或画质已改善。若选进了背景，请回到选区精修；混色需另行局部审阅。'
        : '候选已生成。先比较，再到场景中预览；还没有修改物件或地板。')
    } catch (error) { if (!abort.signal.aborted && stamp === generation.current) setError(message(error)) }
    finally { if (stamp === generation.current) { operation.current = null; setPending(null) } }
  }
  const preview = async () => {
    if (!batch || !selectedCandidate || stale || disabled || pending) return
    const abort = new AbortController(), stamp = ++generation.current
    operation.current = abort; setPending('preview'); setError('')
    try {
      await onPreview(batch.source, selectedCandidate.recipe, batch.scope, abort.signal)
      if (abort.signal.aborted || stamp !== generation.current) return
      if (!embedded) setCollapsed(true)
      setNotice(previewContext === 'asset' ? '候选已放入本页编辑草稿，保存素材副本后才进入我的素材。' : '请在场景的候选审阅中采用或取消。采用后可读取当前结果继续处理。')
    } catch (error) { if (!abort.signal.aborted && stamp === generation.current) setError(message(error)) }
    finally { if (stamp === generation.current) { operation.current = null; setPending(null) } }
  }
  const pointAt = (event: PointerEvent<HTMLCanvasElement>): ImagePoint => {
    const bounds = event.currentTarget.getBoundingClientRect(), pixels = source!.pixels
    return { x: Math.max(0, Math.min(pixels.width, (event.clientX - bounds.x) * pixels.width / bounds.width)),
      y: Math.max(0, Math.min(pixels.height, (event.clientY - bounds.y) * pixels.height / bounds.height)) }
  }
  const paint = (points: ImagePoint[], current: ImagePixelMask) => paintImageSelection(source!.pixels, current, { points, radiusPx: radius, mode: brushMode })
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!source || scope !== 'local' || editing || stale || event.button !== 0 || stroke.current) return
    event.preventDefault(); const point = pointAt(event)
    try {
      const value = paint([point], mask ?? emptyMask())
      invalidateCandidates(); setShowScope(true); scopeCanvas.current = event.currentTarget
      stroke.current = { pointerId: event.pointerId, before: mask, last: point, value }
      event.currentTarget.setPointerCapture(event.pointerId); setMask(value); setCursor(point); setStrokeActive(true)
    } catch (error) { setError(message(error)) }
  }
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!source || scope !== 'local') return
    const point = pointAt(event); setCursor(point)
    const current = stroke.current
    if (!current || current.pointerId !== event.pointerId) return
    try {
      const value = paint([current.last, point], current.value)
      current.value = value; current.last = point; setMask(value)
    } catch (error) { cancelStroke(); setError(message(error)) }
  }
  const pointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = stroke.current
    if (!current || current.pointerId !== event.pointerId) return
    stroke.current = null; setStrokeActive(false); setScopeHistory(previous => [...previous.slice(-19), current.before])
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const syncScroll = (from: HTMLDivElement, other: HTMLDivElement | null) => {
    if (!other) return
    if (Math.abs(other.scrollLeft - from.scrollLeft) > 1) other.scrollLeft = from.scrollLeft
    if (Math.abs(other.scrollTop - from.scrollTop) > 1) other.scrollTop = from.scrollTop
  }

  const content = <section className={`image-enhancement-panel${embedded ? ' is-embedded' : ''}${collapsed ? ' is-collapsed' : ''}`} aria-label="画质候选编辑">
    {!embedded && <header><div><h2>图像处理</h2><p>{source?.label ?? info?.label ?? '读取图片…'}</p></div><div>
      <button type="button" onClick={() => { cancelStroke(); setCollapsed(value => !value) }} aria-expanded={!collapsed}>{collapsed ? '展开对照' : '收起对照'}</button>
      <button type="button" aria-label="关闭画质优化" onClick={() => { cancelOperation(); cancelStroke(); onClose() }}>关闭</button>
    </div></header>}
    {stale && <div className="image-enhancement-stale" role="status">此对象已修改，旧候选仅供对照。<button type="button" disabled={editing} onClick={() => void load()}>读取当前版本</button></div>}
    {pending && <div className="image-enhancement-progress" role="status">{pending === 'load' ? '正在读取原图与来源…' : pending === 'generate' ? '正在生成候选，可继续编辑场景。' : '正在准备场景预览…'}<button type="button" onClick={() => { cancelOperation(); setNotice('已取消本次处理。') }}>取消处理</button></div>}
    {error && <p className="image-enhancement-error" role="alert">{error}</p>}
    {!source && !pending && <div className="image-enhancement-progress"><button type="button" disabled={disabled} onClick={() => void load()}>重新读取图片</button></div>}
    {!collapsed && <div className="image-enhancement-body">
      <fieldset disabled={editing || strokeActive} className="image-enhancement-settings">
        <label>处理依据<select aria-label="画质处理依据" value={basis} onChange={event => { cancelStroke(); setBasis(event.target.value as 'current' | 'original') }}><option value="current">当前结果</option><option value="original">保留原图</option></select></label>
        <label>改善方向<select aria-label="画质改善方向" value={direction} onChange={event => { invalidateCandidates(); setDirection(event.target.value as ImageEnhancementDirection) }}>{directions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>候选数量<select aria-label="画质候选数量" value={count} onChange={event => { invalidateCandidates(); setCount(Number(event.target.value) as 2 | 3) }}><option value={2}>2 个</option><option value={3}>3 个</option></select></label>
        <label>处理范围<select aria-label="画质处理范围" value={scope} onChange={event => { cancelStroke(); invalidateCandidates(); setScope(event.target.value as Scope) }}><option value="all">整件图片</option><option value="local">画笔局部</option></select></label>
      </fieldset>
      <p className="image-enhancement-hint">{directions.find(row => row[0] === direction)?.[2]} 增强不会恢复原图未知的细节。</p>
      {scope === 'local' && <fieldset className="image-enhancement-brush" disabled={editing || stale || strokeActive}>
        <div role="group" aria-label="画质范围画笔"><button type="button" aria-pressed={brushMode === 'keep'} onClick={() => { cancelStroke(); setBrushMode('keep') }}>涂入范围</button><button type="button" aria-pressed={brushMode === 'remove'} onClick={() => { cancelStroke(); setBrushMode('remove') }}>擦除范围</button></div>
        <label>半径<input aria-label="画质范围画笔半径" type="number" min={1} max={64} step={1} value={radius} onChange={event => setRadius(Math.max(1, Math.min(64, Number(event.target.value) || 1)))}/><span>原图像素</span></label>
        <button type="button" disabled={!scopeHistory.length} onClick={() => { invalidateCandidates(); setMask(scopeHistory.at(-1)!); setScopeHistory(value => value.slice(0, -1)) }}>撤销范围笔画</button>
        <button type="button" onClick={() => { invalidateCandidates(); setMask(null); setScopeHistory([]) }}>清空范围</button>
        <label><input type="checkbox" checked={showScope} onChange={event => setShowScope(event.target.checked)}/>显示处理范围</label>
        <span role="status">已涂 {selectedPixels} 个像素</span>
      </fieldset>}
      <div className="image-enhancement-view-controls"><label>检查背景<select aria-label="画质检查背景" value={background} onChange={event => setBackground(event.target.value)}><option value="checker">棋盘格</option><option value="white">白色</option><option value="black">黑色</option></select></label>
        <label>同步缩放<select aria-label="画质对照缩放" value={zoom} onChange={event => { cancelStroke(); setZoom(event.target.value as Zoom) }}><option value="fit">适应宽度</option><option value="100">100%</option><option value="200">200%</option><option value="400">400%</option></select></label>
        <button type="button" className="primary" disabled={!source || editing || stale || strokeActive || scope === 'local' && !selectedPixels} onClick={() => void generate()}>生成 {count} 个候选</button>
      </div>
      {source && <div className="image-enhancement-comparison" data-background={background}>
        <figure><figcaption>{basis === 'original' ? '保留原图' : '本轮输入'} · {source.pixels.width} × {source.pixels.height}{scope === 'local' && showScope && ' · 绿色为处理范围'}</figcaption>
          <div ref={sourceViewport} className={`image-enhancement-pixel-view${scope === 'local' ? ' is-painting' : ''}`} onScroll={event => syncScroll(event.currentTarget, candidateViewport.current)}>
            <PixelCanvas pixels={sourcePixels!} baseWidth={source.pixels.width} zoom={zoom} label="画质原图与范围画布" mask={scope === 'local' && showScope ? mask : null} brush={scope === 'local' && !batch && cursor ? { point: cursor, radius } : null}
              onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={() => setCursor(null)}
              onPointerCancel={event => { if (stroke.current?.pointerId === event.pointerId) cancelStroke() }} onLostPointerCapture={event => { if (stroke.current?.pointerId === event.pointerId) cancelStroke() }}/>
          </div>
        </figure>
        <figure><figcaption>{selectedCandidate ? `${selectedCandidate.label} · ${selectedCandidate.pixels.width} × ${selectedCandidate.pixels.height}` : '选择一个候选进行对照'}</figcaption>
          <div ref={candidateViewport} className="image-enhancement-pixel-view" onScroll={event => syncScroll(event.currentTarget, sourceViewport.current)}>{selectedCandidate ? <PixelCanvas pixels={selectedCandidate.pixels} baseWidth={source.pixels.width} zoom={zoom} label="画质候选对照画布"/> : <p>候选采用前，场景保持原样。</p>}</div>
        </figure>
      </div>}
      {batch && <div role="group" aria-label="画质候选列表" className="image-enhancement-candidates">{batch.candidates.map(candidate => <button type="button" key={candidate.id} aria-pressed={selected === candidate.id} disabled={!!pending} onClick={() => setSelected(candidate.id)}>
        <strong>{candidate.label}</strong><span>{candidate.description}</span><span className="image-enhancement-candidate-status">{candidate.duplicateOf ? '与另一候选结果相同' : candidate.metrics.changedPixels === 0 ? '未检测到像素变化' : `${candidate.recipe.scale}× 输出 · 可预览比较`}</span>
      </button>)}</div>}
      {batch && <div className="image-enhancement-actions"><button type="button" className="primary" disabled={editing || stale || !selectedCandidate || selectedCandidate.metrics.changedPixels === 0} onClick={() => void preview()}>{previewContext === 'asset' ? '放入编辑草稿' : '在场景中预览'}</button><button type="button" disabled={pending === 'preview'} onClick={discard}>都不采用</button></div>}
      {notice && <p role="status" className="image-enhancement-hint">{notice}</p>}
      <p className="image-enhancement-hint">原件保留，采用后可撤销并继续编辑。此处查看素材原色，场景预览保留已有外观设置。</p>
    </div>}
  </section>
  return embedded ? content : createPortal(content, document.body)
}
