import { useEffect, useRef } from 'react'
import type { ImagePixels, PixelBounds } from '../../shared/image-import/pixels'
import type { analyzeImageImportRepair } from '../../shared/image-import/neighborhood-analysis'
import type { NeighborhoodRepairConflict } from '../../shared/image-import/neighborhood-repair'
import './image-repair-neighborhood-review.css'

type Analysis = ReturnType<typeof analyzeImageImportRepair>
interface Props {
  evidence: ImagePixels
  current: ImagePixels
  analysis: Analysis
  targetName: string
  disabled: boolean
  onLocate: (bounds: PixelBounds, label: string, view: 'source' | 'floor') => void
  onAssist: (surfaceId: string, conflict: NeighborhoodRepairConflict) => void
  onSample: (surfaceId: string, bounds: PixelBounds) => void
}
const coordinates = (b: PixelBounds) => `原图 (${b.x}, ${b.y}) · ${b.width} × ${b.height} px`

function PixelPatch({ image, bounds, label }: { image: ImagePixels; bounds: PixelBounds; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const context = target.getContext('2d')!, pixels = context.createImageData(bounds.width, bounds.height)
    for (let y = 0; y < bounds.height; y++) {
      const start = ((bounds.y + y) * image.width + bounds.x) * 4
      pixels.data.set(image.data.subarray(start, start + bounds.width * 4), y * bounds.width * 4)
    }
    context.putImageData(pixels, 0, 0)
  }, [image, bounds])
  return <figure className="image-neighborhood-patch"><figcaption>{label}</figcaption>
    <div><canvas ref={canvas} width={bounds.width} height={bounds.height} style={{ width: bounds.width * 4, height: bounds.height * 4 }} data-source-bounds={JSON.stringify(bounds)} aria-label={label}/></div>
    <small>{coordinates(bounds)}</small>
  </figure>
}

/** Reports remain a review of exact inputs, never an automatic visual approval. */
export default function ImageRepairNeighborhoodReview({ evidence, current, analysis, targetName, disabled, onLocate, onAssist, onSample }: Props) {
  return <section className="image-neighborhood-review" aria-label="补底与邻域分析" data-import-target="neighborhood" tabIndex={-1}>
    <h3>{targetName} · 补底与邻域</h3>
    <p>以下小图均为原尺寸像素放大到400%。参考来自此物件拆出前的可信区域；当前补底图不包含后续物件的移除结果。</p>
    <ul>{analysis.summary.map((message, index) => <li key={index}>{message}</li>)}</ul>
    {analysis.unassignedBoundsPx && <p className="image-neighborhood-guidance">这部分移除范围没有可解释的底材表面。<button type="button" disabled={disabled} onClick={() => onLocate(analysis.unassignedBoundsPx!, '待标底材范围', 'source')}>定位待标范围</button></p>}
    {analysis.surfaces.map(({ surfaceId, surfaceName, report }) => <section key={surfaceId} aria-label={`邻域底材 ${surfaceName}`}>
      <h4>{surfaceName} · {report.status === 'needs-guidance' ? '需要补充判断' : '需要看图复核'}</h4>
      <ul>{report.summary.map((message, index) => <li key={index}>{message}</li>)}</ul>
      <p>可信像素 {report.counts.trustedPixels} · 候选参考块 {report.counts.candidatePatches} · 排除的前序推断像素 {report.counts.excludedInferencePixels}</p>
      {report.conflicts.length ? <div className="image-neighborhood-conflicts"><h4>需要你判断的小范围 · {report.conflicts.length} 处</h4>{report.conflicts.map((conflict, index) => <details key={conflict.id} open={index === 0} aria-label={`邻域冲突 ${conflict.id}`}>
        <summary>{conflict.severity === 'uncertain' ? '依据不足' : '发现冲突'}：{conflict.message}</summary>
        <p>{coordinates(conflict.boundsPx)}。{conflict.instruction}</p>
        <div className="image-neighborhood-actions"><button type="button" disabled={disabled} onClick={() => onLocate(conflict.boundsPx, conflict.message, 'floor')}>定位冲突区域</button>
          <button type="button" disabled={disabled} onClick={() => onAssist(surfaceId, conflict)}>{({ 'choose-sample': '去补充干净取样', 'exclude-evidence': '去标记不可信区域', 'mark-material': '去修正底材范围', 'confirm-structure': '去对照板缝并取样' })[conflict.action]}</button></div>
      </details>)}</div> : <p>当前比较没有触发局部冲突提示，仍需检查纹理自然度和隐藏结构。</p>}
      <div className="image-neighborhood-sites">{report.sites.map((site, siteIndex) => <details key={siteIndex} open={siteIndex === 0}>
        <summary>比较小块 {siteIndex + 1} · {coordinates(site.boundsPx)} · {site.candidates.length} 份参考</summary>
        <PixelPatch image={current} bounds={site.boundsPx} label={`小块${siteIndex + 1}当前补底`}/>
        <button type="button" disabled={disabled} onClick={() => onLocate(site.boundsPx, `比较小块 ${siteIndex + 1}`, 'floor')}>定位当前小块</button>
        {site.candidates.map((candidate, candidateIndex) => <article key={candidateIndex} aria-label={`小块${siteIndex + 1}参考${candidateIndex + 1}`}>
          <PixelPatch image={evidence} bounds={candidate.sourceBoundsPx} label={`小块${siteIndex + 1}同组参考${candidateIndex + 1}`}/>
          <strong>这块为什么合适</strong><ul>{candidate.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          <strong>与周围的冲突</strong>{candidate.conflicts.length ? <ul>{candidate.conflicts.map((conflict, index) => <li key={index}>{conflict}</li>)}</ul> : <p>未触发该参考块的冲突提示，隐藏部分仍不能由此确认。</p>}
          <div className="image-neighborhood-actions"><button type="button" disabled={disabled} onClick={() => onLocate(candidate.sourceBoundsPx, `同组参考 ${candidateIndex + 1}`, 'source')}>定位同组参考</button>
            <button type="button" disabled={disabled} onClick={() => onSample(surfaceId, candidate.sourceBoundsPx)}>以此处为起点重新取样</button></div>
          <details><summary>查看比较依据</summary><p>比较代价 {candidate.score}；数值越小越匹配，不是画质通过率。</p><p>颜色差 {candidate.metrics.colorError} · 明暗变化差 {candidate.metrics.gradientError} · 细纹理差 {candidate.metrics.textureDifference} · 结构差 {candidate.metrics.structureError} · 距离 {candidate.metrics.distancePx} px</p></details>
        </article>)}
      </details>)}</div>
      <details><summary>分析限制与证据范围</summary><ul>{report.limitations.map((message, index) => <li key={index}>{message}</li>)}</ul></details>
    </section>)}
    <p>分析和定位不会自动采用参考块，也不会授予视觉通过。补充范围或取样后，按共用底材的更新按钮重放，再重新分析。</p>
  </section>
}
