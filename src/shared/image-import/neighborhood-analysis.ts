import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import { decodeSelectionMask } from './selection-mask.js'
import { maskCoverage } from './repair-scope.js'
import type { ImageRepairSurface } from './surfaces.js'
import { analyzeImageRepairNeighborhood, type NeighborhoodRepairConflict, type NeighborhoodRepairReport } from './neighborhood-repair.js'
import { imageNeighborhoodExcludedEvidence, imageNeighborhoodObjectEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { inspectGuidedImageSurfaceTone, type GuidedToneObservation } from './guided-surface-repair.js'
import { inspectImageStructureReferences, type StructureReferenceObservation } from './structure-reference-analysis.js'
import { inspectImageStructureEndpoints, type StructureEndpointObservation } from './structure-endpoint-analysis.js'
import { inspectImageRepairBoundaryEvidence, type RepairBoundaryEvidence } from './repair-boundary-evidence.js'
import { inspectImageStructureMotifs, type StructureMotifReport } from './structure-motif-analysis.js'

interface SurfaceAnalysis {
  surfaceId: string; surfaceName: string; report: NeighborhoodRepairReport
  canInspectTone?: true
  /** At most eight actual-source findings that did not fit the unchanged
   * 24-conflict list. Kept separately so existing findings never hide them. */
  additionalToneFindings?: NeighborhoodRepairConflict[]
  structureReferences?: StructureReferenceObservation[]
  structureEndpoints?: StructureEndpointObservation[]
  boundaryEvidence?: RepairBoundaryEvidence
  structureMotifs?: StructureMotifReport
}

/** Read-only analysis of the actual input and output at one replay step. Earlier
 * repairs remain inference; later object silhouettes remain unavailable evidence. */
export function analyzeImageImportRepair(source: ImagePixels, layers: readonly ImageReplayLayer[], surfaces: readonly ImageRepairSurface[], target: string, signal?: ImageNeighborhoodSignal, surfaceId?: string): {
  target: string; surfaces: SurfaceAnalysis[];
  unassignedBoundsPx?: PixelBounds; summary: string[]; requestedSurfaceId?: string; toneSurfaceId?: string
} {
  signal?.throwIfAborted()
  const index = layers.findIndex(layer => layer.id === target)
  if (index < 0) throw new Error('补底分析目标不存在，请先拆出物件。')
  if (surfaceId !== undefined && (!layers[index].repairSurfaceIds?.includes(surfaceId) || surfaces.find(surface => surface.id === surfaceId)?.kind !== 'guided')) throw new Error('单独检查须选择当前物件引用且实际参与移除的结构辅助底材。')
  const context = { evidenceLayers: layers, signal }
  const before = replayImageLayers(source, layers.slice(0, index), surfaces, context)
  const after = replayImageLayers(source, layers.slice(0, index + 1), surfaces, context)
  const layer = layers[index], repair = after.layers[index].extracted.repairMask
  const protection = layer.protectionMask && decodeSelectionMask(layer.protectionMask, source)
  const objects = imageNeighborhoodObjectEvidence(source, layers.slice(index + 1))
  const covered = new Uint8Array(repair.data.length), results: SurfaceAnalysis[] = []
  // Keep existing actual replay semantics. At most one further guided solve
  // inspects one selected material, or the largest when omitted, never all.
  let toneTarget: { surface: ImageRepairSurface; part: ImagePixelMask; count: number; report: NeighborhoodRepairReport; excluded: ImagePixelMask | undefined } | undefined
  let guidedParts = 0
  for (const id of layer.repairSurfaceIds ?? []) {
    signal?.throwIfAborted()
    const surface = surfaces.find(candidate => candidate.id === id)
    if (!surface) throw new Error('物件引用了不存在的补底表面。')
    const mask = decodeSelectionMask(surface.mask, source), data = new Uint8Array(repair.data.length)
    let count = 0
    for (let y = 0; y < repair.height; y++) for (let x = 0; x < repair.width; x++) {
      const at = y * repair.width + x
      if (repair.data[at] && !covered[at] && maskCoverage(mask, x + repair.boundsPx.x, y + repair.boundsPx.y)) { data[at] = 255; covered[at] = 1; count++ }
    }
    if (!count) continue
    const excluded = surface.excludedEvidenceMask && decodeSelectionMask(surface.excludedEvidenceMask, source)
    const unavailableEvidence = imageNeighborhoodExcludedEvidence(mask.boundsPx, [repair, excluded, ...objects])
    const report = analyzeImageRepairNeighborhood(before.remaining, after.remaining,
      { ...repair, data }, surface.donor, { surfaceMask: mask, protectionMask: protection || undefined,
        excludedEvidenceMask: unavailableEvidence,
        priorInference: before.provenance, pattern: surface.kind === 'planks' || surface.kind === 'neighbors-planks' || surface.kind === 'guided' && surface.guided?.orientation !== 'soft' ? 'planks' : 'soft', signal })
    const boundaryEvidence = inspectImageRepairBoundaryEvidence(source, mask, { ...repair, data }, { priorInference: before.provenance,
      protectionMask: protection || undefined, removalMask: repair, excludedEvidenceMask: unavailableEvidence, signal })
    if (boundaryEvidence.counts.priorInferencePixels) report.summary.push(`补区外邻界有${boundaryEvidence.counts.priorInferencePixels}px来自前序补底，不能当作新的原图比色或接线依据；展开接头依据查看来源步骤。`)
    let structureReferences: StructureReferenceObservation[] | undefined
    let structureEndpoints: StructureEndpointObservation[] | undefined
    if (surface.kind === 'guided') {
      report.summary = [`此表面显式使用结构辅助（${surface.guided!.orientation}，${surface.guided!.guides.length}条引导）；它会改变隐藏区域的推断结构。`, ...report.summary]
      report.limitations = [...report.limitations, '结构辅助是人工指定的推断路径；邻域比较分数不能确认引导正确，也不能授予视觉通过。']
      if (surface.guided!.guides.some(guide => guide.stroke === 'original-segment')) {
        report.summary.push('部分路径显式使用原尺寸二维接缝片段，保留原列起伏与断续；每个连续可写段使用一段完整原来源，较短来源拒绝，接头只比较可信原图。')
        report.limitations.push('原尺寸接缝仍沿人工路径定位，来源片段和接头相容分数不证明隐藏真实结构；无可信侧边时只能推断来源相位，重复笔触、错板头和宽暗带须实际审阅。')
      }
      if (surface.guided!.guides.some(guide => guide.paper === 'two-sided')) {
        report.summary.push('部分原尺寸接缝显式以两侧原图底色估计笔迹：每列两端各2行拟合底色，减少把木板明暗差复制为宽墨带。参考横跨至少9px；接头位置和隐藏笔迹仍为推断，宽暗带、真实饰边与两侧受污染情况须看图判断。')
      }
      for (const [i, patch] of (surface.guided!.detailPatches ?? []).entries()) {
        const r = patch.reference, t = patch.target
        report.summary.push(`二维笔迹${i + 1}（${patch.role}）：原图(${r.x},${r.y}) ${r.width}×${r.height}px原尺寸移至(${t.x},${t.y})，${patch.mode === 'replace-ink' ? '仅替换本次生成笔迹，保留分别估计的底色与细纹，来源空隙也会替换旧生成线' : '只在当前获准补区合入深色笔触'}。理由：${patch.reason}`)
        if (patch.blendPx) report.summary.push(`二维笔迹${i + 1}显式过渡${patch.blendPx}px：只混合本次生成墨迹，按当前可写边界与保护空隙衰减，边界保留原生成墨迹，内部保持来源核心；混合不是原图证据，也不能保证线心相容。`)
      }
      if (surface.guided!.detailPatches?.length) report.limitations.push('二维笔迹的角色及位置为人工推断；缺省只加深，显式replace-ink仅替换当前生成墨迹并保留底色与细纹，可能擦断应有长缝或形成双板头、重复钉点、错接。只处理所指小处，不证明隐藏真实结构，也不增加移除或保护权限。')
      guidedParts++
      // Both actual replays above already validated the complete references.
      // Re-check this step's evidence membership before reading each small tile;
      // no additional synthesis and no hidden/prior-inferred RGB is consulted.
      structureReferences = inspectImageStructureReferences(before.remaining, surface.guided!.guides, (x, y) =>
        !!maskCoverage(mask, x, y) && !maskCoverage(protection, x, y) && !maskCoverage(unavailableEvidence, x, y) && !before.provenance[y * source.width + x], signal)
      structureEndpoints = inspectImageStructureEndpoints(surface.guided!.guides, mask, { ...repair, data }, source, signal)
      if (structureEndpoints.length) { report.status = 'needs-guidance'; report.summary.push(`${structureEndpoints.length}个引导端点在本次可写补区内停止；请局部判断板头或接续，不自动延长。`) }
      const uncertain = structureReferences.filter(reference => reference.status !== 'needs-review').length
      if (uncertain) { report.status = 'needs-guidance'; report.summary.push(`结构参考共${structureReferences.length}块，其中${uncertain}块有线宽、位置或完整性疑点；展开原图参考逐块判断，不自动替换。`) }
      report.limitations.push('结构参考逐截面比较原像素的最暗位置、半深度宽度和明暗差；3px差异／5px中位宽／5级弱对比仅为固定提示阈值，不是板缝识别或视觉通过。')
      report.limitations.push('结构参考列出本表面全部已保存引导，部分路径未经过当前物件移除区；参考有疑点不证明它是本次缺陷的原因。')
      if (surfaceId !== undefined ? id === surfaceId : !toneTarget || count > toneTarget.count) toneTarget = { surface, part: { ...repair, data }, count, report,
        excluded: unavailableEvidence }
    }
    results.push({ surfaceId: id, surfaceName: surface.name, report, boundaryEvidence, ...(surface.kind === 'guided' ? { canInspectTone: true as const } : {}), ...(structureReferences?.length ? { structureReferences } : {}), ...(structureEndpoints?.length ? { structureEndpoints } : {}) })
  }
  if (surfaceId !== undefined && !toneTarget) throw new Error('所选底材没有本次实际移除像素，或已由前面的底材覆盖；请另选参与的底材。')
  if (toneTarget) {
    const { surface, part, report, excluded } = toneTarget
    const diagnostic = inspectGuidedImageSurfaceTone(before.remaining, part, surface.donor, {
      surfaceMask: decodeSelectionMask(surface.mask, source), protectionMask: protection || undefined,
      excludedEvidenceMask: excluded, priorInference: before.provenance,
      pattern: surface.guided!.orientation === 'soft' ? 'soft' : 'planks', orientation: surface.guided!.orientation,
      guides: surface.guided!.guides, detailPatches: surface.guided!.detailPatches, signal,
    }).report
    const rgb = (color: number[]) => `[${color.map(value => Math.round(value * 10) / 10).join(',')}]`
    const describe = (observation: GuidedToneObservation) => `(${observation.boundsPx.x},${observation.boundsPx.y}) ${observation.boundsPx.width}×${observation.boundsPx.height}px，实际${observation.usedPixels}个底色样本平均${rgb(observation.rgb)}；展示${observation.samples.length}个原像素：${observation.samples.map(pixel => `(${pixel.x},${pixel.y})${rgb(pixel.rgb)}`).join('、')}`
    // Keep the regular list <=24 without displacing existing findings. Up to
    // eight unlisted source observations stay separately available to UI/MCP.
    const available = Math.max(0, 24 - report.conflicts.length)
    const findings: NeighborhoodRepairConflict[] = diagnostic.observations.map((pair, i) => ({
      id: `tone-observation-${i + 1}`, kind: 'ambiguous-source', severity: 'uncertain', boundsPx: { ...pair.source.boundsPx }, action: 'exclude-evidence',
      message: `真实求解曾把此处原图颜色作为低频底色：${describe(pair.source)}。与24px内同声明材质的原观察冲突：${describe(pair.neighbor)}；最大通道差${Math.round(pair.channelDifference * 10) / 10}。`,
      instruction: '请只判断这一小处是否为家具边线、其他材质或真实底材明暗／阴影；若不适合作此底材依据，局部补充取证排除后重放。原图线可能真实存在，取证排除不授权删除或改写原线；色差门槛只提供线索，不是材质分类、根因确认或视觉通过。',
    }))
    report.conflicts.push(...findings.slice(0, available))
    const additional = findings.slice(available)
    if (additional.length) results.find(result => result.surfaceId === surface.id)!.additionalToneFindings = additional
    if (diagnostic.observations.length) report.status = 'needs-guidance'
    report.summary.push(`底色取证检查仅复算${surfaceId !== undefined ? '本次指定的' : '实际移除最多的'}结构辅助表面“${surface.name}”：发现${diagnostic.observations.length}处局部明暗差异，常规冲突列表展示${Math.min(available, diagnostic.observations.length)}处${additional.length ? `，另列${additional.length}处原图底色依据` : ''}；每处最多8个真实样本。差异可能是原有渐变或阴影，需要局部判断。`)
    report.limitations.push('底色比较仅检查原求解已固定的观察，按18级通道差、12级平均明暗差及24px距离提示；无提示不证明底材正确。保留原修复算法、范围和像素，不自动排除或删除原线。')
    if (surface.guided!.orientation !== 'soft') {
      const mask = decodeSelectionMask(surface.mask, source)
      const structureMotifs = inspectImageStructureMotifs(before.remaining, after.remaining, mask, part, (x, y) =>
        !!maskCoverage(mask, x, y) && !maskCoverage(protection, x, y) && !maskCoverage(excluded, x, y) && !before.provenance[y * source.width + x], surface.guided!.orientation, signal)
      results.find(result => result.surfaceId === surface.id)!.structureMotifs = structureMotifs
      if (structureMotifs.counts.uncertainComponents) report.status = 'needs-guidance'
      report.summary.push(`补图笔迹检查仅查看${surfaceId !== undefined ? '本次指定的' : '当前写入最多的'}结构辅助表面：${structureMotifs.counts.uncertainComponents}组深色笔迹没有足够局部原图锚点，最多定位六处；需判断角色，不自动擦除或补线。`)
      report.limitations.push(structureMotifs.limitation)
    } else {
      report.limitations.push(`本次${surfaceId !== undefined ? '指定的' : '最大'}结构辅助表面采用soft方向，未执行有明确纹向的补图笔迹检查；无笔迹提示不代表结构正确。`)
    }
  }
  if (guidedParts) for (const result of results) if (result.surfaceId !== toneTarget?.surface.id && surfaces.find(surface => surface.id === result.surfaceId)?.kind === 'guided') {
    result.report.limitations.push(`本次底色取证诊断只复算${surfaceId !== undefined ? '指定的' : '实际移除最多的'}一个结构辅助表面；此表面未执行该项检查，不能由未提示推定无冲突。`)
    result.report.limitations.push('本次补图笔迹检查也仅检查同一表面且需要明确横向／纵向；此表面未查，不因未列笔迹授予通过。')
  }
  let x0 = source.width, y0 = source.height, x1 = 0, y1 = 0
  for (let y = 0; y < repair.height; y++) for (let x = 0; x < repair.width; x++) if (repair.data[y * repair.width + x] && !covered[y * repair.width + x]) {
    const sx = x + repair.boundsPx.x, sy = y + repair.boundsPx.y
    x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx + 1); y1 = Math.max(y1, sy + 1)
  }
  const unassignedBoundsPx = x1 > x0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined
  signal?.throwIfAborted()
  return { target, surfaces: results, ...(surfaceId !== undefined ? { requestedSurfaceId: surfaceId } : {}), ...(toneTarget ? { toneSurfaceId: toneTarget.surface.id } : {}), ...(unassignedBoundsPx ? { unassignedBoundsPx } : {}), summary: [
    ...(unassignedBoundsPx ? ['高亮移除区尚未声明下层材质；请先圈同材质范围及干净取样，再分析附近来源。'] : []),
    ...results.flatMap(result => result.report.summary.map(message => `${result.surfaceName}：${message}`)),
    '候选分数用于比较已声明同组来源，不是视觉通过率；遮挡内真实结构仍需人工复核。',
    '已排除当前全部移除区、保护区、声明取证排除、前序推断和后续未移走物件；地面类item可作为显式选择的下层材质，未标出的家具与阴影仍须补排除范围。',
  ] }
}
