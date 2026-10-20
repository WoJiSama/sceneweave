import { writeFile } from 'node:fs/promises'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { PrivacyCaseB4, PrivacyObservationB4 } from './b4-privacy-fixtures'

const fixturePath = '/tests/b4-privacy-fixtures.ts'
const cases: PrivacyCaseB4[] = ['VIS-01-S01', 'VIS-02-S01', 'VIS-02-S02']

async function setup(page: Page, name: PrivacyCaseB4) {
  await page.goto('/#assets')
  return page.evaluate(async ({ name, fixturePath }) => {
    const helpers = await import(fixturePath), pair = await helpers.createPrivacyPairB4(name)
    ;(window as any).__b4pair = pair
    const projectionPath = '/src/render/v2/projection.ts', { projectSceneV2 } = await import(projectionPath)
    const a = projectSceneV2(pair.a.document, 'player'), b = projectSceneV2(pair.b.document, 'player')
    return { name, originalPropCount: pair.originalPropIds.length, retainedOriginalProps: ['a', 'b'].map(variant => pair.originalPropIds.filter((id: string) => pair[variant].document.props[id]).length), totalProps: ['a', 'b'].map(variant => Object.keys(pair[variant].document.props).length),
      publicRelocations: pair.publicRelocations, publicProjectionEqual: JSON.stringify(a) === JSON.stringify(b), bounds: pair.a.document.exportBoundsMm, masksEqual: JSON.stringify(a.masks) === JSON.stringify(b.masks), revision: [a.sourceRevision, b.sourceRevision],
      originalScatterMemberCounts: Object.values(pair.a.document.scatterGroups).filter((group: any) => !group.id.startsWith('b4-')).map((group: any) => Object.keys(group.members).length),
      projectedPublicPropCount: a.props.length, projectedEdges: a.edges.length, privateMaterialAbsent: !a.materials['b4-private-material'], privatePropsAbsent: a.props.every((prop: any) => !prop.id.startsWith('b4-')), dependentNotesAbsent: a.notes.every((note: any) => !note.id.startsWith('b4-')) }
  }, { name, fixturePath })
}

async function observe(page: Page, variant: 'a' | 'b', audience: 'gm' | 'player', mode: 'preview' | 'png', label: string, longEdgePx: number) {
  return page.evaluate(async options => {
    const { observePrivacyB4 } = await import(options.fixturePath)
    return observePrivacyB4((window as any).__b4pair, options.variant, options.audience, options.mode, options.label, options.longEdgePx)
  }, { fixturePath, variant, audience, mode, label, longEdgePx }) as Promise<PrivacyObservationB4>
}

async function savePng(page: Page, label: string, testInfo: TestInfo) {
  const downloading = page.waitForEvent('download')
  await page.evaluate(async ({ fixturePath, label }) => {
    const { privacyPngsB4 } = await import(fixturePath), url = URL.createObjectURL(privacyPngsB4[label]), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${label}.png`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, { fixturePath, label })
  const download = await downloading, path = testInfo.outputPath(`${label}.png`)
  await download.saveAs(path); await testInfo.attach(`${label}.png`, { path, contentType: 'image/png' })
}

for (const name of cases) test(`B4 ${name}: cold/warm real Canvas privacy, fixed 4K PNG, and private decoder isolation`, async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  const contextA = await browser.newContext({ viewport: { width: 1512, height: 982 } }), contextB = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  const contextGmA = await browser.newContext({ viewport: { width: 1512, height: 982 } }), contextGmB = await browser.newContext({ viewport: { width: 1512, height: 982 } })
  try {
    const pageA = await contextA.newPage(), pageB = await contextB.newPage(), pageGmA = await contextGmA.newPage(), pageGmB = await contextGmB.newPage()
    // Independent browser contexts and disabled HTTP cache make first-use byte/module loading explicit.
    // The renderer intentionally has no persistent decoded bitmap cache: every call must decode and close its own set.
    for (const page of [pageA, pageB, pageGmA, pageGmB]) { const session = await page.context().newCDPSession(page); await session.send('Network.enable'); await session.send('Network.setCacheDisabled', { cacheDisabled: true }) }
    const fixtureA = await setup(pageA, name), fixtureB = await setup(pageB, name), fixtureGmA = await setup(pageGmA, name), fixtureGmB = await setup(pageGmB, name), observations: PrivacyObservationB4[] = []
    observations.push(await observe(pageA, 'a', 'player', 'preview', `${name}-cold-a-preview`, 1024))
    observations.push(await observe(pageA, 'a', 'player', 'png', `${name}-cold-a-player-4096`, 4096))
    observations.push(await observe(pageB, 'b', 'player', 'preview', `${name}-cold-b-preview`, 1024))
    observations.push(await observe(pageB, 'b', 'player', 'png', `${name}-cold-b-player-4096`, 4096))
    observations.push(await observe(pageGmA, 'a', 'gm', 'preview', `${name}-cold-a-gm-preview`, 1024))
    observations.push(await observe(pageGmA, 'a', 'gm', 'png', `${name}-cold-a-gm-4096`, 4096))
    observations.push(await observe(pageGmB, 'b', 'gm', 'preview', `${name}-cold-b-gm-preview`, 1024))
    observations.push(await observe(pageGmB, 'b', 'gm', 'png', `${name}-cold-b-gm-4096`, 4096))
    // Warm here means same JS modules and Blob bytes, never a claim of decoded-cache reuse.
    observations.push(await observe(pageA, 'a', 'gm', 'png', `${name}-warm-a-gm-4096`, 4096))
    observations.push(await observe(pageA, 'a', 'gm', 'preview', `${name}-warm-a-gm-preview`, 1024))
    observations.push(await observe(pageA, 'b', 'player', 'png', `${name}-after-gm-a-player-b-4096`, 4096))
    observations.push(await observe(pageA, 'b', 'player', 'preview', `${name}-warm-b-preview`, 1024))
    observations.push(await observe(pageA, 'b', 'gm', 'png', `${name}-warm-b-gm-4096`, 4096))
    observations.push(await observe(pageA, 'b', 'gm', 'preview', `${name}-warm-b-gm-preview`, 1024))
    observations.push(await observe(pageA, 'a', 'player', 'png', `${name}-after-gm-b-player-a-4096`, 4096))
    observations.push(await observe(pageA, 'a', 'player', 'preview', `${name}-warm-a-preview`, 1024))
    const missing = await pageA.evaluate(async fixturePath => {
      const pair = (window as any).__b4pair, project = { ...pair.a, assets: { ...pair.a.assets } }
      for (const id of pair.secretAssetIds) delete project.assets[project.document.assets[id].sha256]
      const renderPath = '/src/render/v2/renderer.ts', { exportPngV2 } = await import(renderPath)
      const player = await exportPngV2(project, { audience: 'player', longEdgePx: 256 }); let gmError = ''
      try { await exportPngV2(project, { audience: 'gm', longEdgePx: 256 }) } catch (error) { gmError = String(error) }
      return { playerBytes: player.size, gmError, fixturePath }
    }, fixturePath)
    for (const fixture of [fixtureA, fixtureB, fixtureGmA, fixtureGmB]) {
      expect(fixture.originalPropCount).toBe(name === 'VIS-01-S01' ? 13 : 39); expect(fixture.retainedOriginalProps).toEqual([fixture.originalPropCount, fixture.originalPropCount])
      expect(fixture.publicProjectionEqual).toBe(true); expect(fixture.masksEqual).toBe(true); expect(fixture.revision).toEqual([41, 41]); expect(fixture.privateMaterialAbsent).toBe(true); expect(fixture.privatePropsAbsent).toBe(true); expect(fixture.dependentNotesAbsent).toBe(true)
      if (name !== 'VIS-01-S01') expect(fixture.originalScatterMemberCounts).toEqual([6, 12, 18])
    }
    const playerPngs = observations.filter(item => item.audience === 'player' && item.mode === 'png'), playerPreviews = observations.filter(item => item.audience === 'player' && item.mode === 'preview')
    expect(new Set(playerPngs.map(item => item.rgbaHash)).size).toBe(1); expect(new Set(playerPreviews.map(item => item.rgbaHash)).size).toBe(1)
    for (const mode of ['preview', 'png']) {
      const a = observations.filter(item => item.audience === 'gm' && item.variant === 'a' && item.mode === mode), b = observations.filter(item => item.audience === 'gm' && item.variant === 'b' && item.mode === mode)
      expect(a).toHaveLength(2); expect(b).toHaveLength(2); expect(a[0].rgbaHash).toBe(a[1].rgbaHash); expect(b[0].rgbaHash).toBe(b[1].rgbaHash); expect(a[0].rgbaHash).not.toBe(b[0].rgbaHash)
    }
    for (const item of observations) {
      expect(item.sourceUnchanged).toBe(true); expect(item.sourceRevision).toBe(41); expect(item.opaquePixels).toBe(item.pixels)
      expect([...item.actualDecodeHashes].sort()).toEqual(item.expectedDecodeHashes); expect(item.closed).toBe(item.actualDecodeHashes.length)
      expect(item.privateMetadataChunks).toEqual([]); expect(item.plaintextSentinelMatches).toEqual([])
      if (item.mode === 'png') { expect(item.width).toBe(4096); expect(item.height).toBe(name === 'VIS-01-S01' ? 2926 : 3686) }
      if (item.audience === 'player') { expect(item.hiddenAssetsRequested).toEqual([]); expect(item.maskCenter).toEqual([216, 213, 197, 255]) }
      else expect(item.hiddenAssetsRequested).toEqual(['b4-private-object-image', 'b4-private-texture-image'])
    }
    expect(missing.playerBytes).toBeGreaterThan(1000); expect(missing.gmError).toContain('缺失')
    await savePng(pageA, `${name}-cold-a-player-4096`, testInfo); await savePng(pageA, `${name}-warm-a-gm-4096`, testInfo); await savePng(pageA, `${name}-warm-b-gm-4096`, testInfo)
    const report = { case: name, method: { cold: 'Four independent new Chrome contexts, separate A/B and player/GM first use; HTTP cache disabled; first Canvas call uses newly loaded sample bytes/modules. PNG after first preview still starts a fresh decode set.', warm: 'Repeated independent render/export calls reuse same loaded JS modules and Blob bytes, alternating GM/player. No persistent ImageBitmap cache exists or is claimed.', pixels: 'SHA-256 over full real Canvas/decoded PNG sRGB RGBA; all alpha bytes counted; no projection-only pixel substitute.', fixedRevision: 41, matrix: '2 variants x 2 audiences x 2 outputs (1024 preview/4096 PNG) x 2 states (new context/repeated modules and bytes) = 16 observations per case' }, fixtureA, fixtureB, observations, missing }
    const path = testInfo.outputPath(`${name}-privacy-matrix.json`); await writeFile(path, JSON.stringify(report, null, 2)); await testInfo.attach(`${name}-privacy-matrix.json`, { path, contentType: 'application/json' })
  } finally { await contextA.close(); await contextB.close(); await contextGmA.close(); await contextGmB.close() }
})
