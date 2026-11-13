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
  onFocus: (surfaceId?: string) => void
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
export default function ImageRepairNeighborhoodReview({ evidence, current, analysis, targetName, disabled, onLocate, onAssist, onSample, onFocus }: Props) {
  return <section className="image-neighborhood-review" aria-label="补底与邻域分析" data-import-target="neighborhood" tabIndex={-1}>
    <h3>{targetName} · 补底与邻域</h3>
    <p>以下小图均为原尺寸像素放大到400%。参考来自此物件拆出前的可信区域；当前补底图不包含后续物件的移除结果。</p>
    {analysis.toneSurfaceId && <label>单独检查底材<select aria-label="单独检查底材" disabled={disabled} value={analysis.requestedSurfaceId ?? ''} onChange={event => onFocus(event.target.value || undefined)}>
      <option value="">自动选择 · 实际移除最多</option>
      {analysis.surfaces.filter(surface => surface.canInspectTone).map(surface => <option key={surface.surfaceId} value={surface.surfaceId}>{surface.surfaceName}</option>)}
    </select><small>每次只额外检查一块底材的原图底色依据及适用的笔迹。其他底材仍需另选检查，选择不改补图。</small></label>}
    <ul>{analysis.summary.map((message, index) => <li key={index}>{message}</li>)}</ul>
    {analysis.unassignedBoundsPx && <p className="image-neighborhood-guidance">这部分移除范围没有可解释的底材表面。<button type="button" disabled={disabled} onClick={() => onLocate(analysis.unassignedBoundsPx!, '待标底材范围', 'source')}>定位待标范围</button></p>}
    {analysis.surfaces.map(({ surfaceId, surfaceName, report, additionalToneFindings, structureReferences, structureEndpoints, boundaryEvidence, structureMotifs }) => <section key={surfaceId} aria-label={`邻域底材 ${surfaceName}`}>
      <h4>{surfaceName} · {report.status === 'needs-guidance' ? '需要补充判断' : '需要看图复核'}</h4>
      <ul>{report.summary.map((message, index) => <li key={index}>{message}</li>)}</ul>
      <p>可信像素 {report.counts.trustedPixels} · 候选参考块 {report.counts.candidatePatches} · 排除的前序推断像素 {report.counts.excludedInferencePixels}</p>
      {structureMotifs && <details aria-label={`补图笔迹角色 ${surfaceName}`}>
        <summary>补图笔迹角色 · {structureMotifs.counts.uncertainComponents} 组需要局部判断</summary>
        <p>颜色接近仍可能换掉板头或带入钉点。下面仅按深色笔迹的局部对比、连通形状和少量原图锚点指出小范围；长线上的分叉另查，不能借长线的锚点通过。不能识别隐藏的真实角色，也不自动补线或擦除。</p>
        {structureMotifs.sites.map((site, index) => <article key={index} aria-label={`补图笔迹 ${surfaceId} ${index + 1}`}>
          <p>{coordinates(site.boundsPx)} · {site.kind === 'branch' ? '长线分叉 · ' : ''}{({ along: '沿纹理伸展', across: '横跨纹理', compact: '集中短笔迹' })[site.extent]} · {site.pixels} px</p>
          <PixelPatch image={current} bounds={site.boundsPx} label={`补图笔迹${index + 1}当前像素`}/>
          <p>{site.instruction}</p>
          <button type="button" disabled={disabled} onClick={() => onLocate(site.boundsPx, `补图笔迹 ${index + 1} 角色待判断`, 'floor')}>定位待判断笔迹</button>
          <button type="button" disabled={disabled} onClick={() => onLocate(site.boundsPx, `补图笔迹 ${index + 1} 的原遮挡`, 'source')}>对照笔迹原遮挡</button>
        </article>)}
        {!!structureMotifs.counts.unlistedComponents && <p>定位只列前六组，另有 {structureMotifs.counts.unlistedComponents} 组／{structureMotifs.counts.unlistedPixels} px已计入总数。</p>}
        {!!structureMotifs.counts.branchScanSkippedComponents && <p>分叉扫描达到有限预算，另有 {structureMotifs.counts.branchScanSkippedComponents} 条长分量未查分叉。</p>}
        <p>{structureMotifs.limitation}</p>
      </details>}
      {boundaryEvidence && <details aria-label={`补区接头依据 ${surfaceName}`}>
        <summary>补区接头依据 · {boundaryEvidence.counts.priorInferencePixels} px来自前序补底</summary>
        <p>只看本次补区外的一圈邻界。仍需核对的原图 {boundaryEvidence.counts.unmarkedOriginalPixels} px；前序补底 {boundaryEvidence.counts.priorInferencePixels} px；保护 {boundaryEvidence.counts.protectionPixels} px；本次其他移除 {boundaryEvidence.counts.otherRemovalPixels} px；取证排除 {boundaryEvidence.counts.excludedPixels} px；底材／画框之外 {boundaryEvidence.counts.outsideMaterialPixels + boundaryEvidence.counts.outsideImagePixels} px。</p>
        <p>前序补底不能作为新的原图依据。先回看对应步骤的露底与可信原图来源，再判断整体衔接；这里不授权扩大移除范围或自动改线。</p>
        {boundaryEvidence.inferenceSites.map((site, index) => <article key={index} aria-label={`前序补底接头 ${surfaceId} ${index + 1}`}>
          <p>{coordinates(site.boundsPx)} · {site.pixels} px · {site.producers.map(producer => `前面第${producer.step}步 ${producer.pixels}px`).join('；')}</p>
          <button type="button" disabled={disabled} onClick={() => onLocate(site.boundsPx, `前序补底接头 ${index + 1}`, 'floor')}>定位前序补底接头</button>
          <button type="button" disabled={disabled} onClick={() => onLocate(site.boundsPx, `前序补底接头 ${index + 1} 的原图`, 'source')}>对照原图遮挡</button>
        </article>)}
        {!!boundaryEvidence.unlistedInferencePixels && <p>定位只列前六处，另有 {boundaryEvidence.unlistedInferencePixels} px前序邻界已计入总数。</p>}
        <p>{boundaryEvidence.limitation}</p>
      </details>}
      {!!structureEndpoints?.length && <details aria-label={`结构端点依据 ${surfaceName}`}>
        <summary>结构路径端点 · {structureEndpoints.length} 处需要判断</summary>
        <p>只检查本次可写补区内的路径末端，沿原方向最多查看32px范围关系，不读取遮挡下颜色。这里也可能是真实板头，提示不授权延长。</p>
        {structureEndpoints.map(endpoint => <article key={`${endpoint.guideIndex}-${endpoint.endpoint}`} aria-label={`结构端点 ${surfaceId} ${endpoint.guideIndex + 1} ${endpoint.endpoint}`}>
          <p>引导 {endpoint.guideIndex + 1} · {endpoint.endpoint === 'start' ? '起点' : '终点'} · 原图 ({endpoint.positionPx.x}, {endpoint.positionPx.y})</p>
          <p>{endpoint.instruction}</p>
          <button type="button" disabled={disabled} onClick={() => onLocate(endpoint.boundsPx, `引导 ${endpoint.guideIndex + 1} 的${endpoint.endpoint === 'start' ? '起点' : '终点'}`, 'floor')}>定位结构端点</button>
        </article>)}
      </details>}
      {!!structureReferences?.length && <details aria-label={`结构参考依据 ${surfaceName}`}>
        <summary>原图结构参考 · {structureReferences.length} 块 · {structureReferences.filter(r => r.status !== 'needs-review').length} 块有疑点</summary>
        <p>这里列出本表面全部已保存引导的笔触来源，部分路径未经过当前移除区。逐截面的最暗位置和半深度线宽只提示曲线、交叉或宽阴影的可能性；没有提示也须看图，隐藏连线仍属推断。</p>
        {structureReferences.map(reference => <details key={reference.guideIndex} aria-label={`结构参考 ${surfaceId} ${reference.guideIndex + 1}`}>
          <summary>引导 {reference.guideIndex + 1} · {reference.status === 'unavailable' ? '无法取证' : reference.status === 'needs-judgment' ? '需要判断' : '需要看图'} · {coordinates(reference.referenceBoundsPx)}</summary>
          {reference.status !== 'unavailable' && <PixelPatch image={evidence} bounds={reference.referenceBoundsPx} label={`引导${reference.guideIndex + 1}原图笔触参考`}/>}
          {reference.metrics && <p>最暗位置差 {reference.metrics.peakDisplacementPx} px · 线宽差 {reference.metrics.widthRangePx} px · 线宽中位数 {reference.metrics.medianWidthPx} px · 明暗差中位数 {reference.metrics.medianContrast}</p>}
          {!!reference.warnings.length && <ul>{reference.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
          <p>原配方理由：{reference.reason}</p>
          <button type="button" disabled={disabled} onClick={() => onLocate(reference.referenceBoundsPx, `结构引导 ${reference.guideIndex + 1} 的原图参考`, 'source')}>定位原图结构参考</button>
        </details>)}
      </details>}
      {report.conflicts.length ? <div className="image-neighborhood-conflicts"><h4>需要你判断的小范围 · {report.conflicts.length} 处</h4>{report.conflicts.map((conflict, index) => <details key={conflict.id} open={index === 0} aria-label={`邻域冲突 ${conflict.id}`}>
        <summary>{conflict.severity === 'uncertain' ? '依据不足' : '发现冲突'}：{conflict.message}</summary>
        <p>{coordinates(conflict.boundsPx)}。{conflict.instruction}</p>
        <div className="image-neighborhood-actions"><button type="button" disabled={disabled} onClick={() => onLocate(conflict.boundsPx, conflict.message, 'floor')}>定位冲突区域</button>
          <button type="button" disabled={disabled} onClick={() => onAssist(surfaceId, conflict)}>{({ 'choose-sample': '去补充干净取样', 'exclude-evidence': '去标记不可信区域', 'mark-material': '去修正底材范围', 'confirm-structure': '去对照板缝并取样' })[conflict.action]}</button></div>
      </details>)}</div> : <p>当前比较没有触发局部冲突提示，仍需检查纹理自然度和隐藏结构。</p>}
      {!!additionalToneFindings?.length && <section className="image-neighborhood-conflicts" aria-label={`补充底色依据 ${surfaceName}`}>
        <h4>原图底色依据 · 另有 {additionalToneFindings.length} 处需要判断</h4>
        <p>常规冲突列表已满，下面保留未列出的取色疑点。它们可能是真实阴影或渐变，先对照原图，再决定是否局部排除取证。</p>
        {additionalToneFindings.map((finding, index) => <details key={finding.id} open={index === 0} aria-label={`底色依据 ${finding.id}`}>
          <summary>底色疑点 {index + 1} · {coordinates(finding.boundsPx)}</summary>
          <p>{finding.instruction}</p>
          <div className="image-neighborhood-actions"><button type="button" disabled={disabled} onClick={() => onLocate(finding.boundsPx, `底色取证疑点 ${index + 1}`, 'source')}>定位底色依据</button>
            <button type="button" disabled={disabled} onClick={() => onAssist(surfaceId, finding)}>去标记不可信区域</button></div>
          <details><summary>查看原图取色与附近差异</summary><p>{finding.message}</p></details>
        </details>)}
      </section>}
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
