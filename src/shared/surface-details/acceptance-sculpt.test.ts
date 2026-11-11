import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createThemePackSampleDocument } from '../../platform/browser/content/theme-pack-catalog.js'
import { terrainSculptCommands } from '../../editor/main/terrain-sculpt-tools.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { applyCommands } from '../commands/commands.js'
import { MANUAL_TRANSACTION_BUDGET } from '../budget/command-budget.js'
import { checkTerrainTravel } from '../geometry/terrain-travel.js'
import { supportSurfaceAt } from '../geometry/geometry.js'
import { validateCompositionContent } from '../validation/content.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { projectScene } from '../projection/projection.js'
import type { MaterialPaint, SurfaceStyle } from '../model/scene.js'
import { buildRoadCampPatchPlan } from './road-camp-patches.js'

const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, w: number, h: number) => [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)]
let sequence = 0
const runtime = { ids: { nextId: () => `acceptance-sculpt-token-${++sequence}` }, clock: { now: () => '2026-11-10T09:30:00.000Z' } }
function fixture(offset = p(7300, 9100), suffix = '甲') {
  const scene = createShoreBlankDocument('island', { sceneId: `验收/局部塑形 ${suffix}`, title: '组合塑形与失败保全', now: runtime.clock.now(), widthMm: 70000, heightMm: 60000, preset: 'narrative' })
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0], areaId = `原面/${suffix} Δ`, point = (x: number, y: number) => p(offset.x + x, offset.y + y)
  const material = Object.values(scene.materials).find(value => value.applicableSurfaces.includes('terrain'))!
  const base: MaterialPaint = { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 1777, height: 2311 }, rotationDeg: 37,
    alignment: 'world', originMm: p(-487, 2391), tint: null, opacity: 1 }
  const style: SurfaceStyle = { base, overlays: [
    { id: `人工U带 ${suffix}`, boundaryMm: [point(2000, 2000), point(16000, 2000), point(16000, 14000), point(12000, 14000), point(12000, 4000), point(6000, 4000), point(6000, 14000), point(2000, 14000)],
      paint: { ...base, tileSizeMm: { width: 2001, height: 1489 }, rotationDeg: 113, originMm: p(419, -997), opacity: .42 }, blendWidthMm: 137, renderOrder: 3 },
    { id: `人工横带 ${suffix}`, boundaryMm: [point(1000, 7000), point(19000, 7000), point(19000, 8000), point(1000, 8000)],
      paint: { ...base, rotationDeg: 271, originMm: p(-2119, 683), opacity: .73 }, blendWidthMm: 83, renderOrder: 11 },
    { id: `范围外手绘 ${suffix}`, boundaryMm: [point(18000, 15000), point(20000, 15000), point(20000, 16000), point(18000, 16000)], paint: { ...base, opacity: .61 }, blendWidthMm: 91, renderOrder: 19 },
  ] }
  const document = applyCommands(scene, [{ type: 'createTerrainArea', id: areaId, floorId, layerId, boundaryMm: rect(offset.x, offset.y, 24000, 18000), groundElevationMm: 250, coveragePriority: 7, surfaceStyle: style }], runtime)
  const original = createCompositionContent(document, runtime), derivedStyle = cloneJson(style)
  derivedStyle.base.rotationDeg = 41
  const content = applyCompositionCommands(original, [{ type: 'setVisualSurface', kind: 'terrainArea', id: areaId, style: derivedStyle }], runtime, { budget: MANUAL_TRANSACTION_BUDGET })
  const selection = [point(3000, 6000), point(14000, 6000), point(14000, 9000), point(9000, 9000), point(9000, 11000), point(3000, 11000)]
  return { content, original, areaId, floorId, layerId, style: derivedStyle, selection, point, base }
}

describe('formal acceptance: world overlays, local raised/depressed surfaces and atomic refusal', () => {
  it.each([[1450, 7300, 9100, '甲'], [-650, 21300, 17300, '乙']] as const)('creates %imm real relief on a new concave scope with all disconnected paint pieces and ancestry', (height, x, y, name) => {
    const f = fixture(p(x, y), name), before = canonicalJson(f.content)
    const plan = terrainSculptCommands(f.content, [f.areaId], f.selection, height, `正式塑形 ${name}/${height}`)
    expect(plan.overlayFragmentCount).toBe(3)
    const next = applyCompositionCommands(f.content, plan.commands, runtime, { budget: MANUAL_TRANSACTION_BUDGET }), fresh = next.document.terrainAreas[plan.createdAreaId]
    expect(next.document.terrainAreas[f.areaId]).toEqual(f.content.document.terrainAreas[f.areaId])
    expect(next.historyIdentity.outdoorTokens[f.areaId]).toEqual(f.content.historyIdentity.outdoorTokens[f.areaId])
    expect(fresh.groundElevationMm).toBe(height); expect(fresh.coveragePriority).toBe(8)
    expect(fresh.surfaceStyle!.base).toEqual(f.style.base)
    expect(fresh.surfaceStyle!.overlays.map(overlay => overlay.renderOrder)).toEqual([3, 3, 11])
    expect(fresh.surfaceStyle!.overlays.map(overlay => overlay.paint)).toEqual([f.style.overlays[0].paint, f.style.overlays[0].paint, f.style.overlays[1].paint])
    expect(fresh.surfaceStyle!.overlays.map(overlay => overlay.blendWidthMm)).toEqual([137, 137, 83])
    const oldIds = new Set(f.style.overlays.map(overlay => overlay.id)), freshIds = fresh.surfaceStyle!.overlays.map(overlay => overlay.id)
    expect(freshIds.every(id => !oldIds.has(id))).toBe(true); expect(new Set(freshIds).size).toBe(3)
    for (const id of freshIds) expect(next.historyIdentity.presentationTokens![id].kind).toBe('surfaceOverlay')
    for (const [id, source] of Object.entries(f.content.appearance.sources)) expect(next.appearance.sources[id]).toEqual(source)
    expect(next.appearance.surfaceSources[f.areaId]).toBe(f.content.appearance.surfaceSources[f.areaId])
    expect(next.appearance.sources[next.appearance.surfaceSources[plan.createdAreaId]]).toMatchObject({ kind: 'surface', snapshot: fresh.surfaceStyle })
    expect(supportSurfaceAt(next.document, f.point(4000, 6500), f.floorId)).toEqual({ kind: 'terrainArea', id: fresh.id })
    expect(supportSurfaceAt(next.document, f.point(1000, 6500), f.floorId)).toEqual({ kind: 'terrainArea', id: f.areaId })
    expect(checkTerrainTravel(next.document, { floorId: f.floorId, from: f.point(1000, 6500), to: f.point(4000, 6500), widthMm: 200 }).ok).toBe(false)
    expect(Object.values(next.document.terrainEdges).filter(edge => edge.source.areaId === fresh.id).every(edge => edge.blocksMovement)).toBe(true)
    for (const audience of ['gm', 'player'] as const) {
      const edges = projectScene(next.document, audience).edges.filter(edge => edge.sourceAreaId === fresh.id)
      expect(edges).toHaveLength(6)
      expect(edges.every(edge => edge.elevationMm === height && edge.neighborElevationMm === 250)).toBe(true)
    }
    expect(validateCompositionContent(JSON.parse(canonicalJson(next))).document).toEqual(next.document)
    expect(canonicalJson(f.content)).toBe(before)
  })

  it('rejects a fractional last overlay after earlier valid fragments without changing any source or identity', () => {
    const f = fixture(), document = cloneJson(f.content.document), style = cloneJson(f.style)
    style.overlays.push({ ...cloneJson(style.overlays[0]), id: '最后才遇到的分数交点', renderOrder: 29,
      boundaryMm: [f.point(1000, 1000), f.point(17000, 1001), f.point(1000, 16000)] })
    const content = applyCompositionCommands(f.content, [{ type: 'setVisualSurface', kind: 'terrainArea', id: f.areaId, style }], runtime, { budget: MANUAL_TRANSACTION_BUDGET }), before = canonicalJson(content)
    expect(() => terrainSculptCommands(content, [f.areaId], f.selection, 1650, '分数失败/整笔')).toThrow(/非整数毫米交点/)
    expect(canonicalJson(content)).toBe(before); expect(document.terrainAreas[f.areaId]).toEqual(f.content.document.terrainAreas[f.areaId])
  })

  it('rejects a real effective support hole after an earlier valid camp patch without partly appending paint', () => {
    const f = fixture(), occupied = applyCompositionCommands(f.content, [{ type: 'createTerrainArea', id: '洞心实际高优先级面', floorId: f.floorId, layerId: f.layerId,
      boundaryMm: [f.point(10000, 11000), f.point(12000, 11000), f.point(12000, 13000), f.point(10000, 13000)], groundElevationMm: 250, coveragePriority: 8 }], runtime, { budget: MANUAL_TRANSACTION_BUDGET })
    const before = canonicalJson(occupied)
    expect(() => buildRoadCampPatchPlan(occupied, { operationId: '先合法后孔洞/营地', paint: { ...f.base, opacity: .57 }, roads: [], patches: [
      { targetAreaId: f.areaId, selectionMm: [f.point(500, 500), f.point(1500, 500), f.point(1500, 1500), f.point(500, 1500)], blendWidthMm: 51 },
      { targetAreaId: f.areaId, selectionMm: [f.point(8000, 9000), f.point(14000, 9000), f.point(14000, 15000), f.point(8000, 15000)], blendWidthMm: 79 },
    ] })).toThrow(/孔洞/)
    expect(canonicalJson(occupied)).toBe(before)
  })

  it('rejects an actual road support even when the selected local ring does not touch the road', () => {
    const f = fixture(), complex = applyCompositionCommands(f.content, [{ type: 'createPath', id: '原面远侧人工路', floorId: f.floorId, layerId: f.layerId,
      centerlineMm: [f.point(17000, 3000), f.point(20000, 3000)], widthMm: 900, supportRefs: [{ kind: 'terrainArea', id: f.areaId }] }], runtime, { budget: MANUAL_TRANSACTION_BUDGET }), before = canonicalJson(complex)
    expect(() => terrainSculptCommands(complex, [f.areaId], f.selection, -900, '不能隐式改支撑')).toThrow(/道路|路径|支撑/)
    expect(canonicalJson(complex)).toBe(before)
  })

  it('rejects an actual aggregate member without erasing its terrain or source records', () => {
    const f = fixture(), owned = cloneJson(f.content)
    owned.document.aggregateCoordinates = { encoding: 'world', groups: { '实际自然组/甲': { id: '实际自然组/甲', floorId: f.floorId, parentId: null,
      frame: { translationMm: p(0, 0), quarterTurns: 0 }, editLocked: false, members: [{ kind: 'terrainArea', id: f.areaId }] } } }
    const before = canonicalJson(owned)
    expect(() => terrainSculptCommands(owned, [f.areaId], f.selection, 800, '不重绑自然组')).toThrow(/自然组/)
    expect(canonicalJson(owned)).toBe(before)
  })

  it('rejects a complex wilderness sample without erasing managed content', () => {
    const sample = createCompositionContent(createThemePackSampleDocument('wilderness', 0), runtime), sampleBefore = canonicalJson(sample)
    const area = Object.values(sample.document.terrainAreas)[0]
    expect(() => terrainSculptCommands(sample, [area.id], [p(3000, 3000), p(5000, 3000), p(5000, 5000), p(3000, 5000)], 1700, '复杂样板不特许')).toThrow()
    expect(canonicalJson(sample)).toBe(sampleBefore)
  })

  it('refuses a new 48-corner scope on the complete expanded budget and retains every old fragment/source', () => {
    const f = fixture(), scope = Array.from({ length: 48 }, (_, i) => f.point(Math.round(4500 + 700 * Math.cos(i * Math.PI / 24)), Math.round(9500 + 600 * Math.sin(i * Math.PI / 24))))
    const before = canonicalJson(f.content)
    expect(() => terrainSculptCommands(f.content, [f.areaId], scope, -450, '预算含全片段')).toThrow(/256|预算/)
    expect(canonicalJson(f.content)).toBe(before)
  })
})
