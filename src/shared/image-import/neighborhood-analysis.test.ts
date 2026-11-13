import { describe, expect, it, vi } from 'vitest'
import { analyzeImageImportRepair } from './neighborhood-analysis.js'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import type { ImageRepairSurface } from './surfaces.js'
import { encodeSelectionMask } from './selection-mask.js'
import type { ImagePixels, PixelBounds } from './pixels.js'
import * as guided from './guided-surface-repair.js'
import * as neighborhood from './neighborhood-repair.js'
import { imageNeighborhoodReviewSheet } from './neighborhood-review.js'

function mask(bounds: PixelBounds) { return encodeSelectionMask({ width: bounds.width, height: bounds.height, boundsPx: bounds, data: new Uint8Array(bounds.width * bounds.height).fill(255) }) }
function fixture() {
  const image: ImagePixels = { width: 80, height: 60, data: new Uint8ClampedArray(80 * 60 * 4) }
  for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) image.data.set([100 + x % 4, 110 + y % 3, 125 + (x + y) % 5, 255], (y * 80 + x) * 4)
  const surface: ImageRepairSurface = { id: 'rug', name: '蓝毯', kind: 'neighbors-soft', mask: mask({ x: 0, y: 0, width: 80, height: 60 }), donor: { x: 2, y: 2, width: 20, height: 20 } }
  const layer: ImageReplayLayer = { id: 'chair', polygon: [{ x: 30, y: 25 }, { x: 40, y: 25 }, { x: 40, y: 35 }, { x: 30, y: 35 }], selectionMask: mask({ x: 30, y: 25, width: 10, height: 10 }), donor: surface.donor, repair: 'surfaces', repairSurfaceIds: ['rug'], renderLayer: 'object' }
  const future: ImageReplayLayer = { id: 'cabinet', polygon: [{ x: 50, y: 20 }, { x: 65, y: 20 }, { x: 65, y: 40 }, { x: 50, y: 40 }], donor: surface.donor, renderLayer: 'object' }
  return { image, surface, layer, future }
}
function overlap(a: PixelBounds, b: PixelBounds) { return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height }

describe('same-material actual replay analysis', () => {
  it('keeps unanchored motif roles separate from 24 conflicts and exports their locations without changing replay', () => {
    const { image, surface, layer } = fixture()
    for (let y = 12; y < 14; y++) for (let x = 5; x < 14; x++) image.data.set([40, 50, 65, 255], (y * image.width + x) * 4)
    const material: ImageRepairSurface = { ...surface, kind: 'guided', guided: { orientation: 'horizontal', guides: [{ axis: 'horizontal', points: [{ x: 32, y: 30 }, { x: 38, y: 30 }], reference: { x: 5, y: 8, width: 9, height: 10 }, reason: '该短线为显式隐藏推断，须独立判断角色。' }] } }
    const before = replayImageLayers(image, [layer], [material]).remaining, frozen = JSON.stringify(material), original = image.data.slice(), analyze = neighborhood.analyzeImageRepairNeighborhood
    const spy = vi.spyOn(neighborhood, 'analyzeImageRepairNeighborhood').mockImplementation((...args) => ({ ...analyze(...args), conflicts: Array.from({ length: 24 }, (_, i) => ({ id: `existing-${i}`, kind: 'edge-discontinuity' as const, severity: 'attention' as const, boundsPx: { x: 30, y: 25, width: 2, height: 2 }, message: 'Existing boundary', action: 'choose-sample' as const, instruction: 'Review' })) }))
    try {
      const analysis = analyzeImageImportRepair(image, [layer], [material], layer.id), result = analysis.surfaces[0], motifs = result.structureMotifs!
      expect(result.report.conflicts).toHaveLength(24); expect(motifs.counts.uncertainComponents).toBeGreaterThan(0)
      expect(result.report.status).toBe('needs-guidance'); expect(motifs.sites[0].instruction).toContain('局部判断')
      const sheet = imageNeighborhoodReviewSheet(image, before, analysis)
      expect(sheet.layout.structureMotifs).toEqual([{ surfaceId: material.id, ...motifs }])
      expect(sheet.layout.overview[1]).toContain('橙框为角色待判断笔迹')
      expect(sheet.pixels.data.some((v, i, p) => i % 4 === 0 && v === 215 && p[i + 1] === 125 && p[i + 2] === 5)).toBe(true)
      expect(replayImageLayers(image, [layer], [material]).remaining).toEqual(before)
      expect(JSON.stringify(material)).toBe(frozen); expect(image.data).toEqual(original)
      const soft = analyzeImageImportRepair(image, [layer], [{ ...material, guided: { ...material.guided!, orientation: 'soft' } }], layer.id).surfaces[0]
      expect(soft.structureMotifs).toBeUndefined(); expect(soft.report.limitations.join('')).toContain('未执行有明确纹向')
    } finally { spy.mockRestore() }
  })
  it('locates inferred boundary producers without displacing conflicts or changing replay bytes', () => {
    const { image, surface, layer } = fixture()
    const prior: ImageReplayLayer = { id: 'prior', polygon: [{ x: 26, y: 25 }, { x: 30, y: 25 }, { x: 30, y: 35 }, { x: 26, y: 35 }],
      selectionMask: mask({ x: 26, y: 25, width: 4, height: 10 }), removalMask: mask({ x: 26, y: 25, width: 4, height: 10 }), donor: surface.donor, renderLayer: 'object' }
    const layers = [prior, layer], replay = replayImageLayers(image, layers, [surface]), pixels = image.data.slice(), frozen = JSON.stringify(layers)
    const analysis = analyzeImageImportRepair(image, layers, [surface], layer.id), boundary = analysis.surfaces[0].boundaryEvidence!
    expect(boundary.counts.priorInferencePixels).toBe(10)
    expect(boundary.counts.unmarkedOriginalPixels).toBe(30)
    expect(boundary.inferenceSites.flatMap(site => site.producers).every(p => p.step === 1)).toBe(true)
    expect(analysis.surfaces[0].report.summary.join('')).toContain('不能当作新的原图')
    const sheet = imageNeighborhoodReviewSheet(image, replay.remaining, analysis)
    expect(sheet.layout.boundaryEvidence).toEqual([{ surfaceId: surface.id, ...boundary }])
    expect(sheet.layout.boundaryMarkMeaning).toContain('不是原图取证')
    expect(sheet.pixels.data.some((v, i, p) => i % 4 === 0 && v === 20 && p[i + 1] === 155 && p[i + 2] === 175)).toBe(true)
    expect(replayImageLayers(image, layers, [surface]).remaining).toEqual(replay.remaining)
    expect(image.data).toEqual(pixels); expect(JSON.stringify(layers)).toBe(frozen)
  })
  it('keeps endpoint judgments outside the regular conflict limit and exports geometry-only locations without changing repair pixels', () => {
    const { image, surface, layer } = fixture()
    for (let y = 12; y < 14; y++) for (let x = 5; x < 14; x++) image.data.set([40, 50, 65, 255], (y * image.width + x) * 4)
    const material: ImageRepairSurface = { ...surface, kind: 'guided', guided: { orientation: 'soft', guides: [{ axis: 'horizontal', points: [{ x: 29, y: 30 }, { x: 33, y: 30 }], reference: { x: 5, y: 5, width: 9, height: 17 }, reason: '隐藏板头或接续仍需局部判断。' }] } }
    const before = replayImageLayers(image, [layer], [material]).remaining, analyze = neighborhood.analyzeImageRepairNeighborhood
    const spy = vi.spyOn(neighborhood, 'analyzeImageRepairNeighborhood').mockImplementation((...args) => ({ ...analyze(...args), conflicts: Array.from({ length: 24 }, (_, i) => ({ id: `existing-${i}`, kind: 'edge-discontinuity' as const, severity: 'attention' as const, boundsPx: { x: 30, y: 25, width: 2, height: 2 }, message: 'Existing boundary', action: 'choose-sample' as const, instruction: 'Review' })) }))
    try {
      const analysis = analyzeImageImportRepair(image, [layer], [material], layer.id), result = analysis.surfaces[0]
      expect(result.report.conflicts).toHaveLength(24)
      expect(result.structureEndpoints).toHaveLength(1)
      expect(result.structureEndpoints![0]).toMatchObject({ endpoint: 'end', positionPx: { x: 33, y: 30 }, writableContinuationPx: 6 })
      expect(result.structureEndpoints![0].instruction).toContain('不自动延长')
      const sheet = imageNeighborhoodReviewSheet(image, before, analysis)
      expect(sheet.layout.structureEndpoints).toEqual([{ surfaceId: material.id, ...result.structureEndpoints![0] }])
      expect(sheet.layout.overview[1]).toContain('粉框为结构端点')
      expect(replayImageLayers(image, [layer], [material]).remaining).toEqual(before)
    } finally { spy.mockRestore() }
  })
  it('explains actual persisted line references separately from the bounded conflict list without changing output', () => {
    const { image, surface, layer } = fixture()
    for (let y = 10; y < 16; y++) for (let x = 5; x < 14; x++) image.data.set([40, 50, 65, 255], (y * image.width + x) * 4)
    const material: ImageRepairSurface = { ...surface, kind: 'guided', guided: { orientation: 'soft', guides: [{ axis: 'horizontal', points: [{ x: 29, y: 30 }, { x: 41, y: 30 }], reference: { x: 5, y: 5, width: 9, height: 17 }, reason: '人工推断，参考原线可能太宽。' }] } }
    const before = replayImageLayers(image, [layer], [material]).remaining
    const analysis = analyzeImageImportRepair(image, [layer], [material], layer.id), result = analysis.surfaces[0]
    expect(result.structureReferences).toHaveLength(1)
    expect(result.structureReferences![0]).toMatchObject({ guideIndex: 0, sampledPixels: 153, status: 'needs-judgment', metrics: { medianWidthPx: 6 } })
    expect(result.report.status).toBe('needs-guidance')
    expect(result.report.conflicts.length).toBeLessThanOrEqual(24)
    const sheet = imageNeighborhoodReviewSheet(image, before, analysis)
    expect(sheet.layout.structureReferences).toEqual([{ surfaceId: material.id, ...result.structureReferences![0] }])
    expect(sheet.layout.overview[0]).toContain('紫框为结构参考疑点')
    expect(replayImageLayers(image, [layer], [material]).remaining).toEqual(before)
  })
  it('reports captured tone sources and nearby disagreement as uncertain local guidance, preserving actual replay output', () => {
    const { image, surface, layer, future } = fixture()
    const material: ImageRepairSurface = { ...surface, kind: 'guided', guided: { orientation: 'soft', guides: [] } }
    for (let y = 22; y < 39; y++) for (let x = 40; x < 48; x++) image.data.set([30, 32, 35, 255], (y * image.width + x) * 4)
    const beforePixels = image.data.slice(), layers = [layer, future]
    const replayBefore = replayImageLayers(image, [layer], [material], { evidenceLayers: layers })
    const report = analyzeImageImportRepair(image, layers, [material], layer.id).surfaces[0].report
    const tone = report.conflicts.filter(c => c.id.startsWith('tone-observation-'))
    expect(tone.length).toBeGreaterThan(0)
    expect(tone.length).toBeLessThanOrEqual(8)
    expect(report.conflicts.length).toBeLessThanOrEqual(24)
    for (const conflict of tone) {
      expect(conflict.severity).toBe('uncertain')
      expect(conflict.boundsPx.width).toBeLessThanOrEqual(8)
      expect(conflict.message).toContain('实际')
      expect(conflict.message).toContain('个原像素')
      expect(conflict.instruction).toContain('不授权删除')
      expect(conflict.instruction).toContain('真实底材明暗')
    }
    const altered = { ...image, data: image.data.slice() }
    for (const b of [{ x: 30, y: 25, width: 10, height: 10 }, { x: 50, y: 20, width: 15, height: 20 }]) for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) altered.data.set([250, 0, 240, 255], (y * image.width + x) * 4)
    expect(analyzeImageImportRepair(altered, layers, [material], layer.id)).toEqual(analyzeImageImportRepair(image, layers, [material], layer.id))
    expect(replayImageLayers(image, [layer], [material], { evidenceLayers: layers }).remaining).toEqual(replayBefore.remaining)
    expect(image.data).toEqual(beforePixels)
  })

  it('bounds optional tone re-solving to one participating surface and explicitly leaves other guided materials unchecked', () => {
    const { image, surface, layer } = fixture()
    const first: ImageRepairSurface = { ...surface, id: 'first', kind: 'guided', mask: mask({ x: 0, y: 0, width: 36, height: 60 }), guided: { orientation: 'soft', guides: [] } }
    const second: ImageRepairSurface = { ...surface, id: 'second', kind: 'guided', guided: { orientation: 'soft', guides: [] } }
    const inspect = vi.spyOn(guided, 'inspectGuidedImageSurfaceTone')
    try {
      const result = analyzeImageImportRepair(image, [{ ...layer, repairSurfaceIds: ['first', 'second'] }], [first, second], layer.id)
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(result.surfaces.map(s => s.report.counts.repairPixels)).toEqual([60, 40])
      expect(result.surfaces[0].report.summary.join('')).toContain('底色取证检查仅复算')
      expect(result.surfaces[1].report.limitations.join('')).toContain('此表面未执行')
    } finally { inspect.mockRestore() }
  })

  it('preserves all existing conflicts and exposes every actual tone finding when the conflict list is full', () => {
    const { image, surface, layer } = fixture()
    const material: ImageRepairSurface = { ...surface, kind: 'guided', guided: { orientation: 'soft', guides: [] } }
    for (let y = 22; y < 39; y++) for (let x = 40; x < 48; x++) image.data.set([30, 32, 35, 255], (y * image.width + x) * 4)
    const analyze = neighborhood.analyzeImageRepairNeighborhood
    const existing: neighborhood.NeighborhoodRepairConflict[] = Array.from({ length: 24 }, (_, i) => ({ id: `existing-${i}`, kind: 'edge-discontinuity', severity: 'attention', boundsPx: { x: 30, y: 25, width: 2, height: 2 }, message: 'Existing actual boundary finding', action: 'choose-sample', instruction: 'Review original boundary' }))
    const spy = vi.spyOn(neighborhood, 'analyzeImageRepairNeighborhood').mockImplementation((...args) => ({ ...analyze(...args), conflicts: existing.map(c => ({ ...c })) }))
    try {
      const result = analyzeImageImportRepair(image, [layer], [material], layer.id).surfaces[0], report = result.report
      expect(report.conflicts).toEqual(existing)
      expect(report.summary.join('')).toMatch(/发现[1-8]处局部明暗差异，常规冲突列表展示0处，另列[1-8]处原图底色依据/)
      expect(result.additionalToneFindings!.length).toBeGreaterThan(0)
      expect(result.additionalToneFindings!.length).toBeLessThanOrEqual(8)
      for (const finding of result.additionalToneFindings!) {
        expect(finding.id).toMatch(/^tone-observation-/)
        expect(finding.severity).toBe('uncertain')
        expect(finding.action).toBe('exclude-evidence')
        expect(finding.message).toContain('个原像素')
        expect(finding.instruction).toContain('不授权删除')
        expect(report.conflicts.some(conflict => conflict.id === finding.id)).toBe(false)
      }
      const replay = replayImageLayers(image, [layer], [material])
      const sheet = imageNeighborhoodReviewSheet(image, replay.remaining, { target: layer.id, surfaces: [result], summary: [] })
      expect(sheet.layout.additionalToneFindings).toEqual(result.additionalToneFindings!.map(finding => ({ surfaceId: surface.id, id: finding.id, boundsPx: finding.boundsPx })))
      expect(sheet.layout.overview[0]).toContain('黄框为补充底色依据')
      const pixels = sheet.pixels.data
      expect(pixels.some((value, index) => index % 4 === 0 && value === 220 && pixels[index + 1] === 145 && pixels[index + 2] === 20 && pixels[index + 3] === 255)).toBe(true)
    } finally { spy.mockRestore() }
  })

  it('focuses a smaller participating material without a second solve or changing pixels, and rejects an unavailable focus', () => {
    const { image, surface, layer } = fixture()
    const first: ImageRepairSurface = { ...surface, id: 'first', kind: 'guided', mask: mask({ x: 0, y: 0, width: 36, height: 60 }), guided: { orientation: 'soft', guides: [] } }
    const second: ImageRepairSurface = { ...surface, id: 'second', kind: 'guided', guided: { orientation: 'soft', guides: [] } }
    const unused: ImageRepairSurface = { ...second, id: 'unused' }
    const layers = [{ ...layer, repairSurfaceIds: ['first', 'second', 'unused'] }], surfaces = [first, second, unused]
    const original = image.data.slice(), frozenLayers = JSON.stringify(layers), frozenSurfaces = JSON.stringify(surfaces)
    const defaultReport = analyzeImageImportRepair(image, layers, surfaces, layer.id)
    expect(defaultReport.toneSurfaceId).toBe('first')
    const inspect = vi.spyOn(guided, 'inspectGuidedImageSurfaceTone')
    try {
      const selected = analyzeImageImportRepair(image, layers, surfaces, layer.id, undefined, 'second')
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(selected.toneSurfaceId).toBe('second')
      expect(selected.requestedSurfaceId).toBe('second')
      expect(selected.surfaces.map(s => s.report.counts.repairPixels)).toEqual([60, 40])
      expect(selected.surfaces[0].report.limitations.join('')).toContain('此表面未执行')
      expect(selected.surfaces[1].report.summary.join('')).toContain('本次指定的')
      expect(selected.surfaces.every(s => s.canInspectTone)).toBe(true)
      expect(image.data).toEqual(original)
      expect(JSON.stringify(layers)).toBe(frozenLayers); expect(JSON.stringify(surfaces)).toBe(frozenSurfaces)
      inspect.mockClear()
      for (const id of ['missing', 'unused']) expect(() => analyzeImageImportRepair(image, layers, surfaces, layer.id, undefined, id)).toThrow(/底材/)
      expect(() => analyzeImageImportRepair(image, [layer], [surface], layer.id, undefined, surface.id)).toThrow(/底材/)
      expect(inspect).not.toHaveBeenCalled()
      const controller = new AbortController(); controller.abort()
      expect(() => analyzeImageImportRepair(image, layers, surfaces, layer.id, controller.signal, 'second')).toThrow()
      expect(inspect).not.toHaveBeenCalled()
    } finally { inspect.mockRestore() }
    expect(analyzeImageImportRepair(image, layers, surfaces, layer.id)).toEqual(defaultReport)
  })

  it('does not duplicate tone findings when only some fit in the existing conflict list', () => {
    const { image, surface, layer } = fixture()
    const material: ImageRepairSurface = { ...surface, kind: 'guided', guided: { orientation: 'soft', guides: [] } }
    for (let y = 22; y < 39; y++) for (let x = 40; x < 48; x++) image.data.set([30, 32, 35, 255], (y * image.width + x) * 4)
    for (let y = 22; y < 39; y++) for (let x = 22; x < 30; x++) image.data.set([35, 38, 42, 255], (y * image.width + x) * 4)
    const analyze = neighborhood.analyzeImageRepairNeighborhood
    const original = analyzeImageImportRepair(image, [layer], [material], layer.id).surfaces[0]
    const expected = [...original.report.conflicts.filter(c => c.id.startsWith('tone-observation-')), ...original.additionalToneFindings ?? []]
    expect(expected.length).toBeGreaterThan(1)
    const existing: neighborhood.NeighborhoodRepairConflict[] = Array.from({ length: 23 }, (_, i) => ({ id: `existing-${i}`, kind: 'edge-discontinuity', severity: 'attention', boundsPx: { x: 30, y: 25, width: 2, height: 2 }, message: 'Existing boundary finding', action: 'choose-sample', instruction: 'Review original' }))
    const spy = vi.spyOn(neighborhood, 'analyzeImageRepairNeighborhood').mockImplementation((...args) => ({ ...analyze(...args), conflicts: existing.map(c => ({ ...c })) }))
    try {
      const result = analyzeImageImportRepair(image, [layer], [material], layer.id).surfaces[0]
      expect(result.report.conflicts).toHaveLength(24)
      expect(result.report.conflicts.slice(0, 23)).toEqual(existing)
      const findings = [result.report.conflicts[23], ...result.additionalToneFindings ?? []]
      expect(findings).toEqual(expected)
      expect(new Set(findings.map(finding => finding.id)).size).toBe(findings.length)
    } finally { spy.mockRestore() }
  })

  it('keeps tone diagnosis isolated from changed prior inference and protected/excluded originals', () => {
    const { image, surface, layer, future } = fixture()
    const material: ImageRepairSurface = { ...surface, kind: 'guided', guided: { orientation: 'soft', guides: [] }, excludedEvidenceMask: mask({ x: 42, y: 8, width: 5, height: 8 }) }
    const prior: ImageReplayLayer = { id: 'prior', polygon: [{ x: 23, y: 5 }, { x: 29, y: 5 }, { x: 29, y: 12 }, { x: 23, y: 12 }], selectionMask: mask({ x: 23, y: 5, width: 6, height: 7 }), donor: { x: 2, y: 2, width: 10, height: 10 }, renderLayer: 'object' }
    const guarded = { ...layer, protectionMask: mask({ x: 40, y: 20, width: 2, height: 20 }) }, layers = [prior, guarded, future]
    for (let y = 15; y < 25; y++) for (let x = 30; x < 38; x++) image.data.set([30, 32, 35, 255], (y * image.width + x) * 4)
    const before = analyzeImageImportRepair(image, layers, [material], layer.id)
    expect(before.surfaces[0].report.conflicts.some(c => c.id.startsWith('tone-observation-'))).toBe(true)
    const changed = { ...image, data: image.data.slice() }
    for (const b of [{ x: 23, y: 5, width: 6, height: 7 }, { x: 40, y: 20, width: 2, height: 20 }, { x: 42, y: 8, width: 5, height: 8 }]) for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) changed.data.set([0, 250, 245, 255], (y * image.width + x) * 4)
    expect(analyzeImageImportRepair(changed, layers, [material], layer.id)).toEqual(before)
  })

  it('excludes future unremoved objects throughout each source footprint and ignores their RGB', () => {
    const { image, surface, layer, future } = fixture(), layers = [layer, future]
    const before = analyzeImageImportRepair(image, layers, [surface], layer.id)
    const altered = { ...image, data: image.data.slice() }
    for (let y = 20; y < 40; y++) for (let x = 50; x < 65; x++) altered.data.set([255, 0, 245, 255], (y * image.width + x) * 4)
    expect(analyzeImageImportRepair(altered, layers, [surface], layer.id)).toEqual(before)
    for (const site of before.surfaces[0].report.sites) for (const candidate of site.candidates) {
      expect(overlap(candidate.sourceBoundsPx, { x: 50, y: 20, width: 15, height: 20 })).toBe(false)
    }
    const current = replayImageLayers(image, [layer], [surface], { evidenceLayers: layers })
    const changed = replayImageLayers(altered, [layer], [surface], { evidenceLayers: layers })
    for (let y = 25; y < 35; y++) for (let x = 30; x < 40; x++) {
      const at = (y * image.width + x) * 4
      expect(changed.remaining.data.slice(at, at + 4)).toEqual(current.remaining.data.slice(at, at + 4))
    }
  })
  it('requires declared material instead of fabricating a color group', () => {
    const { image, layer } = fixture()
    const result = analyzeImageImportRepair(image, [{ ...layer, repair: 'tile', repairSurfaceIds: undefined }], [], layer.id)
    expect(result.surfaces).toEqual([])
    expect(result.unassignedBoundsPx).toEqual({ x: 30, y: 25, width: 10, height: 10 })
    expect(result.summary.join('')).toContain('先圈同材质')
  })
  it('uses first surface wins for overlapping material scopes and never counts the hidden region twice', () => {
    const { image, surface, layer } = fixture()
    const first = { ...surface, id: 'left', mask: mask({ x: 0, y: 0, width: 35, height: 60 }) }
    const second = { ...surface, id: 'right' }
    const result = analyzeImageImportRepair(image, [{ ...layer, repairSurfaceIds: ['left', 'right'] }], [first, second], layer.id)
    expect(result.surfaces.map(value => value.report.counts.repairPixels)).toEqual([50, 50])
    expect(result.unassignedBoundsPx).toBeUndefined()
  })
  it('keeps old soft output independent of new automatic object evidence', () => {
    const { image, surface, layer, future } = fixture(), old = { ...surface, kind: 'soft' as const }
    expect(replayImageLayers(image, [layer], [old], { evidenceLayers: [layer, future] }).remaining)
      .toEqual(replayImageLayers(image, [layer], [old]).remaining)
    expect(() => analyzeImageImportRepair(image, [layer], [surface], 'missing')).toThrow('目标不存在')
    const controller = new AbortController(); controller.abort()
    expect(() => analyzeImageImportRepair(image, [layer], [surface], layer.id, controller.signal)).toThrow()
  })
})
