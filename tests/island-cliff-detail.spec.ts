import { expect, test } from '@playwright/test'
import type { PointMm } from '../src/shared/model/scene.js'
import type { SceneCommand } from '../src/shared/commands/commands.js'
import type { MaterializedEdge } from '../src/shared/terrain-generation/contracts.js'

test('fixed generated island cliff candidate renders as readable mid-tone rock in the production surface pass', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const paths = {
      blank: '/src/platform/browser/content/shore-blank.ts', budget: '/src/shared/budget/task-budget.ts', composition: '/src/shared/terrain-generation/composition-materialize.ts',
      compose: '/src/shared/terrain-generation/compose.ts', generation: '/src/shared/terrain-generation/surface-generation.ts', cliff: '/src/shared/decorations/island-cliff-detail.ts',
      boundary: '/src/shared/visual/geometry.ts', visual: '/src/shared/visual/base.ts', renderer: '/src/platform/browser/render/visual-renderer.ts', types: '/src/shared/visual/types.ts',
    }
    const { createShoreBlankDocument } = await import(paths.blank), { TASK_BUDGET_PROFILES } = await import(paths.budget)
    const { emptyCompositionDocument } = await import(paths.composition), { composeTerrainDocument } = await import(paths.compose)
    const { generateTerrainDocumentV5 } = await import(paths.generation), { buildIslandCliffDetailCommands } = await import(paths.cliff)
    const { sampleVisualBoundary } = await import(paths.boundary), { visualBase } = await import(paths.visual)
    const { drawVisualBoundaries } = await import(paths.renderer), { emptyVisualSystem } = await import(paths.types)
    const source = createShoreBlankDocument('island', { sceneId: 'island-cliff-pixel-proof', title: '岩岛崖面像素证明', now: '2026-11-03T00:00:00Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
    const generated = generateTerrainDocumentV5(source, { sceneId: source.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000, algorithmVersion: 5, budgetProfileId: 'standard', quality: 'standard' })
    const composed = composeTerrainDocument(source, generated, 'birth', TASK_BUDGET_PROFILES.standard).document
    const scene = { ...emptyCompositionDocument(composed), schemaVersion: 6, decorations: {}, decorationClusters: {} }
    const plan = buildIslandCliffDetailCommands(scene, { nextId: () => 'pixel-proof-edge' })
    const command = plan.commands.find((row: SceneCommand) => row.type === 'upsertMaterializedEdge')
    if (!command || command.type !== 'upsertMaterializedEdge') throw new Error('Fixed island did not produce a materialized cliff candidate.')
    const edge = command.edge, boundary = visualBase(scene).boundaries[edge.boundaryId], bounds = scene.exportBoundsMm
    const sampled = sampleVisualBoundary(boundary)
    const projectedBoundary = { id: boundary.id, ...sampled,
      terrainAreaIds: boundary.binding.kind === 'terrain' ? boundary.binding.sides.map((side: { areaId: string }) => side.areaId) : [] }
    const width = 1200, height = Math.round(width * bounds.height / bounds.width), scale = width / bounds.width
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#C4B486'; ctx.fillRect(0, 0, width, height); ctx.scale(scale, scale)
    const base = emptyVisualSystem(), visual = { environment: base.environment, boundsMm: bounds, boundaries: [projectedBoundary], edgeLooks: [],
      materializedEdges: [edge], transitions: [], lights: [], fogs: [], filters: [], occluderRings: [], contactRings: [], suppressedTerrainEdgeIds: [] }
    const projection = { audience: 'gm', sourceRevision: 0, bounds, gridSizeMm: null, rooms: [], terrain: [], walls: [], props: [], edges: [],
      paths: [], connections: [], notes: [], regions: [], masks: [], theme: null, materials: {}, assetIds: [], limitations: [], diagnostics: [], visual }
    drawVisualBoundaries(ctx, projection as never)
    const polygon = edge.polygons[0]!, count = polygon.length / 2, samples: number[][] = []
    const distanceToSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    }
    for (let index = 1; index < count - 1; index++) {
      const inner = polygon[index]!, outer = polygon[polygon.length - 1 - index]!
      const point = { x: inner.x * .52 + outer.x * .48, y: inner.y * .52 + outer.y * .48 }
      const nearestStroke = Math.min(...edge.strokes.flatMap((stroke: MaterializedEdge['strokes'][number]) => stroke.pointsMm.slice(1)
        .map((end: PointMm, segment: number) => distanceToSegment(point, stroke.pointsMm[segment]!, end))))
      if (nearestStroke < 85) continue
      const pixel = ctx.getImageData(Math.round(point.x * scale), Math.round(point.y * scale), 1, 1).data
      samples.push([...pixel.slice(0, 3)])
    }
    return { samples, fillColor: edge.fillColor, opacity: edge.opacity }
  })

  expect(result.fillColor).not.toBe('#737D76')
  expect(result.opacity).toBeGreaterThan(.9)
  expect(result.samples.length).toBeGreaterThan(6)
  for (const rgb of result.samples) {
    expect(rgb[0]! + rgb[1]! + rgb[2]!, `face pixel ${rgb.join(',')} must remain mid-tone`).toBeGreaterThan(420)
  }
})
