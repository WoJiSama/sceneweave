import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { SceneDocument } from '../src/shared/model/scene'
import { checkTerrainRoute } from '../src/shared/geometry/terrain-travel'
import { createKeyboardProject, keyboardProjectBackup } from './keyboard-ux-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'

test('outpost density choices download distinct saved editable members without changing the open project', async ({ page }, info) => {
  test.setTimeout(240000)
  await createKeyboardProject(page, '新哨站植被密度与当前工程保全')
  const before = await keyboardProjectBackup(page, info.outputPath('before.sceneweave'))
  await openWorkspaceModule(page, '素材')
  const panel = page.getByRole('region', { name: '主题素材包', exact: true })
  await panel.locator(':scope > details > summary').click()
  await panel.getByLabel('选择主题包', { exact: true }).selectOption('wilderness')
  await panel.getByText('两份可编辑代表场景', { exact: true }).click()
  const counts: number[][] = [], scenes: string[] = []
  let resources: Record<string, string> | undefined
  const { createHash } = await import('node:crypto')
  for (const density of ['sparse', 'balanced', 'dense']) {
    await panel.getByLabel('林中哨站植被密度', { exact: true }).selectOption(density)
    const downloading = page.waitForEvent('download'), filename = info.outputPath(`outpost-${density}.sceneweave`)
    await panel.getByRole('button', { name: /^下载场景 ·/ }).first().click()
    await (await downloading).saveAs(filename)
    await expect(panel.getByLabel('林中哨站植被密度', { exact: true })).toBeEnabled()
    const archive = unzipSync(new Uint8Array(await readFile(filename)))
    const document = JSON.parse(new TextDecoder().decode(archive['scene.json'])) as SceneDocument
    scenes.push(document.sceneId)
    expect(document.presetSnapshot.source).toContain(`植被${density}`)
    const groups = Object.values(document.scatterGroups)
    expect(groups).toHaveLength(3)
    counts.push(groups.map(group => Object.values(group.members).length))
    for (const group of groups) for (const member of Object.values(group.members)) {
      expect(member.state).toBe('managed'); expect(document.props[member.propId!]).toBeTruthy()
    }
    for (const path of Object.values(document.paths)) {
      expect(checkTerrainRoute(document, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).issues).toEqual([])
    }
    const current = Object.fromEntries(Object.entries(archive).filter(([name]) => /^(assets\/|sources\/|licenses\/|sources\.json$)/.test(name))
      .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]))
    if (resources) expect(current).toEqual(resources)
    resources = current
  }
  expect(new Set(scenes).size).toBe(3)
  for (let group = 0; group < 3; group++) {
    expect(counts[0][group]).toBeLessThan(counts[1][group])
    expect(counts[1][group]).toBeLessThan(counts[2][group])
  }
  await panel.screenshot({ path: info.outputPath('outpost-density-controls.png') })
  const after = await keyboardProjectBackup(page, info.outputPath('after.sceneweave'))
  expect(after.hashes).toEqual(before.hashes)
  await writeFile(info.outputPath('density-facts.json'), JSON.stringify({ counts, currentProjectUnchanged: true, resources }, null, 2))
})
