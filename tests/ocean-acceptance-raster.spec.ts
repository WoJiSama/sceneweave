import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('ocean privacy raster uses actual assets and filters secret supports before painting', async ({ page }, info) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const [{ createOceanProject }, { projectScene, projectEditorScene }, { renderRasterProjection }, { applyCommands }] = await Promise.all([
      load('/src/platform/browser/content/ocean-sample.ts'), load('/src/shared/projection/projection.ts'),
      load('/src/platform/browser/render/canvas-renderer.ts'), load('/src/shared/commands/commands.ts'),
    ])
    const project = await createOceanProject(), base = structuredClone(project.document)
    const mask = (scene: typeof base, id: string, x: number, y: number, w: number, h: number) => {
      scene.regions[id] = { id, floorId: 'collection-floor', editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1,
        boundaryMm: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }
      scene.entityLayers[id] = 'collection-structure'
    }
    const digest = async (scene: typeof base, audience: 'gm' | 'player', projection = projectScene(scene, audience)) => {
      const canvas = await renderRasterProjection({ assetRefs: scene.assets, assets: project.assets, resources: project.resources }, projection, { audience, longEdgePx: 768 })
      try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data))].map(n => n.toString(16).padStart(2, '0')).join('') }
      finally { canvas.width = canvas.height = 0 }
    }
    const secret = structuredClone(base); secret.props['ocean-serpent'].visibility = 'gm'
    mask(secret, 'secret-creature-mask', 27000, 17500, 13000, 12500)
    const moved = structuredClone(secret); moved.props['ocean-serpent'].rotationDeg += 10; moved.props['ocean-serpent'].waterAppearance.depth = .1
    const secretWater = structuredClone(base); secretWater.terrainAreas['ocean-shallows'].visibility = 'gm'
    mask(secretWater, 'secret-water-mask', 0, 0, 20000, 30000)
    const changedWater = structuredClone(secretWater); changedWater.terrainAreas['ocean-shallows'].waterSurface.color = '#ff0000'
    changedWater.terrainAreas['ocean-shallows'].waterSurface.seed = 'private-water-change'
    const projected = projectScene(secretWater, 'player')
    const hidden = projectEditorScene(base, { floorId: 'collection-floor', hiddenLayerIds: new Set(['collection-structure']) })
    const without = structuredClone(hidden); without.terrain = []; without.props = []
    const zero = structuredClone(base); zero.props['ocean-serpent'].visibility = 'gm'; zero.props['ocean-serpent'].appearance.opacity = 0
    let zeroRejected = false
    try { projectScene(zero, 'player') } catch (e) { zeroRejected = /固定遮罩/.test(String(e)) }
    const floors = applyCommands(base, [{ type: 'createFloor', id: 'dry-upper', name: '同坐标独立层', boundsMm: { x: 0, y: 0, width: 40000, height: 30000 }, outputBoundsMm: { x: 0, y: 0, width: 40000, height: 30000 }, newLayerId: 'dry-layer', layerName: '独立层' }], { ids: { nextId: () => 'unused' }, clock: { now: () => base.updatedAt } })
    const upper = projectScene(floors, 'gm', undefined, { floorId: 'dry-upper' })
    return {
      assets: Object.keys(project.assets).length, secretGm: [await digest(secret, 'gm'), await digest(moved, 'gm')], secretPlayer: [await digest(secret, 'player'), await digest(moved, 'player')],
      waterGm: [await digest(secretWater, 'gm'), await digest(changedWater, 'gm')], waterPlayer: [await digest(secretWater, 'player'), await digest(changedWater, 'player')],
      publicSupports: projected.terrain.map((a: { id: string }) => a.id), publicProps: projected.props.map((p: { id: string }) => p.id),
      hiddenCounts: [hidden.terrain.length, hidden.props.length], hiddenHashes: [await digest(base, 'gm', hidden), await digest(base, 'gm', without)],
      upper: [upper.terrain.length, upper.props.length], zeroRejected,
    }
  })
  await writeFile(info.outputPath('privacy-pixels.json'), JSON.stringify(result, null, 2))
  expect(result.assets).toBeGreaterThan(0)
  expect(result.secretGm[0]).not.toBe(result.secretGm[1]); expect(result.secretPlayer[0]).toBe(result.secretPlayer[1])
  expect(result.waterGm[0]).not.toBe(result.waterGm[1]); expect(result.waterPlayer[0]).toBe(result.waterPlayer[1])
  expect(result.publicSupports).not.toContain('ocean-shallows'); expect(result.publicProps).not.toContain('ocean-manta'); expect(result.publicProps).not.toContain('ocean-school')
  expect(result.hiddenCounts).toEqual([0, 0]); expect(result.hiddenHashes[0]).toBe(result.hiddenHashes[1])
  expect(result.upper).toEqual([0, 0]); expect(result.zeroRejected).toBe(true)
})
