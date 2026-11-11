import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DecorationCluster, SceneDocument, SurfaceRule } from '../src/shared/model/scene.js'
import type { Projection } from '../src/shared/projection/types.js'

test('v6 automatic island rules, connection landings, package cold read, and public projections stay aligned', async ({ page }, info) => {
  test.setTimeout(300_000)
  await page.goto('/')
  const proof = await page.evaluate(async () => {
    const paths = {
      blank: '/src/platform/browser/content/shore-blank.ts', protocol: '/src/shared/terrain-generation/base-map-v3.ts',
      prepare: '/src/application/workspace/base-map.ts', runtime: '/src/platform/browser/runtime.ts', project: '/src/application/workspace/project.ts',
      hash: '/src/shared/project/validate.ts', file: '/src/shared/project/file.ts', renderer: '/src/platform/browser/render/renderer.ts',
      pixels: '/src/shared/validation/hash.ts', projection: '/src/shared/projection/projection.ts',
      geometry: '/src/shared/geometry/geometry.ts', landings: '/src/shared/geometry/connection-landings.ts',
      decorationGeneration: '/src/shared/decorations/generate.ts', budget: '/src/shared/budget/task-budget.ts',
    }
    const { createShoreBlankProject } = await import(paths.blank)
    const { prepareBaseMapRequestV3, executeBaseMapRequestV3 } = await import(paths.protocol)
    const { prepareBaseMapProject } = await import(paths.prepare)
    const { runtime, validation } = await import(paths.runtime)
    const { toBundle } = await import(paths.project)
    const { projectContentHash } = await import(paths.hash)
    const { exportProject, importProject } = await import(paths.file)
    const { renderProject } = await import(paths.renderer)
    const { projectScene } = await import(paths.projection)
    const { pointOnSurface } = await import(paths.geometry)
    const { connectionLandingBlend } = await import(paths.landings)
    const { estimateSurfaceRegionInstances } = await import(paths.decorationGeneration)
    const { sha256Bytes } = await import(paths.pixels)
    const base = await createShoreBlankProject('island', {
      sceneId: runtime.ids.nextId(), title: 'v6 自动规则岩岛收口', now: '2026-11-04T00:00:00.000Z',
      widthMm: 24000, heightMm: 18000, preset: 'narrative', gridVisible: false,
    }, undefined, true)
    const profile = (await import(paths.budget)).taskBudgetProfile('standard')
    const request = prepareBaseMapRequestV3({ requestId: runtime.ids.nextId(), flowId: runtime.ids.nextId(), workspaceSceneId: base.document.sceneId,
      checkpoint: 0, operationEpoch: 1, profile, base: base.document,
      generation: { kind: 'terrain', input: { sceneId: base.document.sceneId, kind: 'island', seed: 'terrain-v6-closure-20261104',
        widthMm: 24000, heightMm: 18000, algorithmVersion: 6, budgetProfileId: profile.profileId, quality: 'standard' } } })
    const response = executeBaseMapRequestV3(request)
    const prepared = await prepareBaseMapProject(base, request, response, { runtime, validation })
    const bundle = toBundle(prepared.project), contentHash = projectContentHash(bundle.project)
    const roundTrip = await importProject(await exportProject(bundle, validation), validation)
    const document = bundle.project.document as SceneDocument
    const rules = Object.values(document.surfaceRules ?? {}) as SurfaceRule[]
    const ruleCounts = Object.fromEntries(['material', 'trees', 'shrubs', 'grass'].map(field => [field, rules.filter(rule => rule.field === field).length]))
    const clusters = document.decorationClusters ?? {}
    const memberCounts = Object.values(clusters).map(cluster => Object.values((cluster as DecorationCluster).members).filter(member => member.entityId && member.state !== 'deleted').length)
    const rulesBySupport = rules.filter(rule => rule.field !== 'material').map(rule => {
      const cluster = rule.clusterId ? clusters[rule.clusterId] : undefined
      return { field: rule.field, supportId: rule.supportRef.id,
        members: cluster ? Object.values(cluster.members).filter(member => member.entityId && member.state !== 'deleted').length : 0,
        predicted: cluster ? estimateSurfaceRegionInstances(document, cluster.palette, { polygons: rule.regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm })), coveragePpm: rule.coveragePpm ?? 0 }) : 0,
        coveragePpm: rule.coveragePpm ?? 0 }
    })
    const render = async (audience: 'gm' | 'player') => {
      const canvas = await renderProject(bundle, { audience, longEdgePx: 1600 })
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      return { width: canvas.width, height: canvas.height, pixelHash: sha256Bytes(new Uint8Array(pixels.buffer)), png: canvas.toDataURL('image/png').split(',')[1] }
    }
    const outputs = { gm: await render('gm'), player: await render('player') }
    const projection = projectScene(document, 'gm') as Projection
    const connectionSummary = projection.connections.map(connection => {
      const source = document.terrainConnections[connection.id]
      const landings = (['start', 'end'] as const).map(end => connectionLandingBlend(connection, end))
      return { surfaceIds: connection.surfaceIds ?? [], widthMm: connection.widthMm,
        supportedEnds: [pointOnSurface(document, source.from.positionMm, source.from.surfaceRef, source.floorId),
          pointOnSurface(document, source.to.positionMm, source.to.surfaceRef, source.floorId)],
        landingDepthsMm: landings.map(landing => landing?.depthMm ?? 0),
        landingStylesAvailable: landings.every(landing => !!landing && projection.terrain.some(area => area.id === landing.surfaceId && area.style)),
        routed: !!connection.route }
    })
    return { contentHash, roundTripHash: projectContentHash(roundTrip.project), schemaVersion: bundle.project.schemaVersion,
      ruleCounts, memberCounts, rulesBySupport, terrainAreas: Object.keys(document.terrainAreas).length, connections: Object.keys(document.terrainConnections).length,
      styledAreas: Object.values(document.terrainAreas).filter(area => !!area.surfaceStyle?.base).length,
      connectionSummary,
      outputs, resultHash: response.resultHash }
  })
  expect(proof.schemaVersion).toBe(1)
  expect(proof.roundTripHash).toBe(proof.contentHash)
  expect(proof.styledAreas).toBeGreaterThan(0)
  expect(proof.ruleCounts.trees).toBeGreaterThan(0)
  expect(proof.ruleCounts.shrubs).toBeGreaterThan(0)
  expect(proof.ruleCounts.grass).toBeGreaterThan(0)
  expect(proof.memberCounts.some(value => value > 0)).toBe(true)
  expect(proof.terrainAreas).toBeGreaterThan(1)
  expect(proof.connections).toBeGreaterThan(0)
  expect(proof.connectionSummary.some(connection => connection.surfaceIds.length === 2 && connection.surfaceIds[0] !== connection.surfaceIds[1]
    && connection.supportedEnds.every(Boolean) && connection.landingDepthsMm.every(depth => depth > 0) && connection.landingStylesAvailable)).toBe(true)
  expect(proof.outputs.gm.width).toBe(1600)
  expect(proof.outputs.player.width).toBe(1600)
  expect(proof.outputs.gm.pixelHash).toBe(proof.outputs.player.pixelHash)
  const outputDir = resolve('work/round-20261104/closure-output')
  await mkdir(outputDir, { recursive: true })
  await writeFile(resolve(outputDir, 'v6-island-gm.png'), Buffer.from(proof.outputs.gm.png, 'base64'))
  await writeFile(resolve(outputDir, 'v6-island-player.png'), Buffer.from(proof.outputs.player.png, 'base64'))
  await writeFile(resolve(outputDir, 'v6-island-proof.json'), JSON.stringify({ ...proof, outputs: Object.fromEntries(Object.entries(proof.outputs).map(([key, value]) => [key, { ...value, png: undefined }])) }, null, 2))
  await info.attach('v6-island-gm.png', { body: Buffer.from(proof.outputs.gm.png, 'base64'), contentType: 'image/png' })
  await info.attach('v6-island-player.png', { body: Buffer.from(proof.outputs.player.png, 'base64'), contentType: 'image/png' })
  await info.attach('v6-island-proof.json', { body: JSON.stringify({ ...proof, outputs: Object.fromEntries(Object.entries(proof.outputs).map(([key, value]) => [key, { ...value, png: undefined }])) }, null, 2), contentType: 'application/json' })
})
