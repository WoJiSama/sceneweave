import type { EditableProject } from '../../../application/workspace/project.js'
import type { PointMm, SceneDocument, SurfaceOverlay, SurfaceStyle } from '../../../shared/model/scene.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { signedVisualArea } from '../../../shared/visual/geometry.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import type { CubicSegment } from '../../../shared/visual/types.js'
import { runtime } from '../runtime.js'
import { createRefinedIslandDocument } from './refined-island.js'
import { applySampleAtmosphere } from './sample-atmosphere.js'
import { materializeVisualArt } from './visual-art-project.js'

export const DETAILED_ISLAND_NAME = '岬湾苔岛 · 地表细化'
export interface DetailedIslandOptions { sceneId?: string; now?: string }

const point = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })
const artId = (key: string) => `refined-art-${key}`
const clone = <T>(value: T): T => structuredClone(value)
const fixed = (points: PointMm[]): PointMm[] => signedVisualArea(points) < 0 ? [...points].reverse() : points

/** Uneven corner cutting retains a saved outline, rather than view-dependent noise. */
function softenedPatch(points: PointMm[], phase: number): PointMm[] {
  const cuts = [.16, .29, .21, .34, .24, .18, .3]
  return fixed(points.flatMap((current, index) => {
    const previous = points[(index + points.length - 1) % points.length], next = points[(index + 1) % points.length]
    const incoming = cuts[(index + phase) % cuts.length], outgoing = cuts[(index + phase + 3) % cuts.length]
    return [point(current.x + (previous.x - current.x) * incoming, current.y + (previous.y - current.y) * incoming),
      point(current.x + (next.x - current.x) * outgoing, current.y + (next.y - current.y) * outgoing)]
  }))
}

function paint(scene: SceneDocument, key: 'moss' | 'strata', opacity: number): SurfaceStyle['base'] {
  const material = scene.materials[`refined-material-island-material-${key}`]
  return { materialRef: { id: material.id, version: material.version }, alignment: 'world', originMm: point(0, 0), rotationDeg: 0,
    tileSizeMm: { width: key === 'moss' ? 3800 : 4200, height: key === 'moss' ? 3800 : 4200 }, tint: null, opacity }
}

function addPatch(scene: SceneDocument, areaId: string, id: string, key: 'moss' | 'strata', coordinates: number[][], blendWidthMm: number, opacity: number): void {
  const style = scene.terrainAreas[areaId].surfaceStyle!
  style.overlays.push({ id, boundaryMm: fixed(coordinates.map(([x, y]) => point(x, y))), paint: paint(scene, key, opacity), blendWidthMm,
    renderOrder: style.overlays.length })
}

/** Patch skirts are saved decoration curves, not a live binding to future paint edits. */
function addPatchSkirt(scene: SceneDocument, overlay: SurfaceOverlay, rockOnGrass: boolean, index: number): void {
  const visual = visualBase(scene)!, id = `detail-island-patch-${index + 1}`
  const points = fixed(overlay.boundaryMm), floorId = Object.keys(scene.floors)[0], layerId = 'visual-layer-details'
  const segments: CubicSegment[] = points.map((start, segmentIndex) => {
    const end = points[(segmentIndex + 1) % points.length]
    return { id: `${id}-segment-${segmentIndex}`, start: clone(start), end: clone(end),
      control1: point(start.x + (end.x - start.x) / 3, start.y + (end.y - start.y) / 3),
      control2: point(start.x + (end.x - start.x) * 2 / 3, start.y + (end.y - start.y) * 2 / 3) }
  })
  visual.boundaries[id] = { id, floorId, layerId, editLocked: false, visibility: 'public', closed: true,
    segments, sampleSpacingMm: 550, toleranceMm: 20, binding: { kind: 'decoration' } }
  const lookId = `${id}-grass`
  visual.edgeLooks[lookId] = { id: lookId, floorId, layerId, editLocked: false, visibility: 'public', boundaryId: id, kind: 'grass',
    side: rockOnGrass ? 'right' : 'left', widthMm: [140, 220, 170, 190, 155, 210, 165, 185][index],
    color: '#718154', accentColor: '#B4BA7A', opacity: .63, intensity: .65, repeatMm: 270 + index % 3 * 40,
    seed: `island-surface-layout-1-patch-${index + 1}`, enabled: true }
}

/** Independent saved surface recipe over the original island's physical model and fixed artwork. */
export function createDetailedIslandDocument(options: DetailedIslandOptions = {}): SceneDocument {
  const scene = createRefinedIslandDocument({ sceneId: options.sceneId ?? 'detailed-island-layout-1', now: options.now ?? '2026-11-10T00:00:00.000Z' })
  scene.title = DETAILED_ISLAND_NAME
  scene.presetSnapshot = { ...scene.presetSnapshot, presetId: 'sceneweave-detailed-island', presetVersion: 1,
    source: '岬湾地表细化布局1：复用Q1固定13项原创素材及800/2600mm真实台地与1500mm台阶；不等宽草岩、崖脚与落地纹理为已保存外观，不自动追随后续轮廓或覆盖编辑；视觉P3待签收' }

  const sourceTheme = scene.styleThemes[scene.activeStyleThemeRef!.id], themeId = 'detailed-island-surface-theme'
  scene.styleThemes[themeId] = { ...clone(sourceTheme), id: themeId, version: 1, catalogId: 'theme.sceneweave.detail.cape-moss-surface-1', name: '岬湾苔墨 · 地表细化',
    outline: { widthMm: 14, color: '#59604D' }, terrainCliff: { ...sourceTheme.terrainCliff, opacity: .17, maxOffsetMm: 400, blurMm: 65 } }
  scene.activeStyleThemeRef = { id: themeId, version: 1 }

  const low = scene.terrainAreas['q1-low'], high = scene.terrainAreas['q1-high']
  const existingPatches = [...low.surfaceStyle!.overlays, ...high.surfaceStyle!.overlays]
  for (const [index, overlay] of existingPatches.entries()) {
    overlay.boundaryMm = softenedPatch(overlay.boundaryMm, index)
    overlay.blendWidthMm = [290, 360, 250, 215, 280, 265, 230, 240][index]
    addPatchSkirt(scene, overlay, index >= low.surfaceStyle!.overlays.length, index)
  }
  // Sparse tongues and isolated islands break the large masses without filling
  // the stair approach or the high central activity clearing with new objects.
  addPatch(scene, low.id, 'detail-island-west-moss-islet', 'moss', [[6510, 7780], [6900, 7580], [7110, 7810], [6930, 8130], [6570, 8090]], 140, .72)
  addPatch(scene, low.id, 'detail-island-south-moss-islet', 'moss', [[10900, 13000], [11340, 12850], [11600, 13150], [11200, 13400], [10800, 13200]], 165, .65)
  addPatch(scene, high.id, 'detail-island-crown-rock-inlet', 'strata', [[13400, 7920], [14050, 8040], [14220, 8370], [13940, 8650], [13530, 8510]], 210, .63)
  // Real stone paint is world-aligned across the unchanged 1500mm stair; only
  // the support-clipped surface pixels change, never its endpoints or net width.
  addPatch(scene, low.id, 'detail-island-stair-low-landing', 'strata', [[6530, 8050], [6950, 7550], [7860, 7660], [8370, 8200], [8140, 8990], [7460, 9180], [6770, 8790]], 330, 1)
  addPatch(scene, high.id, 'detail-island-stair-high-landing', 'strata', [[9600, 7680], [10220, 7510], [10920, 7820], [11250, 8390], [10890, 9020], [10100, 9120], [9650, 8730]], 370, .96)

  const visual = visualBase(scene)!, coast = visual.edgeLooks['q1-coast-cliff'], crown = visual.edgeLooks['q1-crown-cliff']
  Object.assign(coast, { widthMm: 560, color: '#AA9B80', accentColor: '#E1D2B3', opacity: .94, intensity: .86, repeatMm: 300, seed: 'island-surface-layout-1-coast' })
  Object.assign(crown, { widthMm: 870, color: '#9E9075', accentColor: '#E1D2B1', opacity: .98, intensity: 1, repeatMm: 290, seed: 'island-surface-layout-1-crown' })
  Object.assign(visual.edgeLooks['q1-coast-shore'], { widthMm: 260, opacity: .69, repeatMm: 310, seed: 'island-surface-layout-1-shore' })
  Object.assign(visual.edgeLooks['q1-crown-grass'], { widthMm: 145, opacity: .58, repeatMm: 300, seed: 'island-surface-layout-1-crown-grass' })
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`地表细化岩岛无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  return applySampleAtmosphere(checked.document, 'island-daylight')
}

export async function createDetailedIslandProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return materializeVisualArt(createDetailedIslandDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE, artId, signal)
}
