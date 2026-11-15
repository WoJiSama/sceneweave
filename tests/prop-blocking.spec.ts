import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createKeyboardProject, placeKeyboardLamp, selectKeyboardProp, keyboardProjectBackup, keyboardWorkspaceSaved, keyboardResourceHashes } from './keyboard-ux-helpers'
import { closeWorkspaceDrawers } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const content = (s: object) => { const { revision: _revision, updatedAt: _updatedAt, ...rest } = s as Record<string, unknown>; return rest }
test('one prop blocking flag is previewed, cancelable, undoable and preserved by cold reopen', async ({ page, browser }, info) => {
  test.setTimeout(150000)
  const errors: string[] = [], events: unknown[] = []; page.on('pageerror', e => errors.push(e.message))
  await createKeyboardProject(page, '单件通行标记'); await placeKeyboardLamp(page)
  const backup = async (label: string) => { const b = await keyboardProjectBackup(page, info.outputPath(label+'.sceneweave')); events.push({ label, revision:b.document.revision }); return b }
  const initial = await backup('initial'), prop = Object.values(initial.document.props)[0]
  expect(prop.blocksMovement).toBe(false); await selectKeyboardProp(page, prop.id)
  const block = page.getByRole('button', { name:'预览改为阻挡移动', exact:true })
  await expect(block).toBeVisible(); await block.click()
  const adopt = page.getByRole('button', { name:/^采用(?:组件修改|室外修改)$/ })
  await expect(adopt).toBeVisible(); await expect(page.locator('.workspace-unified')).toHaveAttribute('data-revision', String(initial.document.revision))
  await page.getByRole('button', { name:/^取消(?:组件|室外)预览$/ }).click(); await keyboardWorkspaceSaved(page)
  expect((await backup('cancelled')).hashes).toEqual(initial.hashes)
  await block.click()
  const check = page.getByLabel('确认完整影响范围', { exact:true }); if (await check.count()) await check.check()
  await adopt.click(); await keyboardWorkspaceSaved(page)
  const applied = await backup('applied')
  expect(applied.document.revision).toBe(initial.document.revision+1)
  expect(content(applied.document)).toEqual(content({ ...initial.document, props:{ ...initial.document.props, [prop.id]:{ ...prop, blocksMovement:true } } }))
  expect(applied.identity).toEqual(initial.identity); expect(applied.appearance).toEqual(initial.appearance)
  expect(keyboardResourceHashes(applied.hashes)).toEqual(keyboardResourceHashes(initial.hashes))
  await selectKeyboardProp(page,prop.id); await page.getByRole('button',{name:'锁定物件编辑',exact:true}).click(); await keyboardWorkspaceSaved(page)
  await expect(page.getByRole('button',{name:'预览改为不阻挡移动',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'解除物件编辑锁',exact:true}).click(); await keyboardWorkspaceSaved(page)
  // Remove the two lock transactions before testing a single obstruction undo.
  for(let i=0;i<2;i++){await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(page)}
  await page.getByRole('button',{name:'撤销编辑',exact:true}).click(); await keyboardWorkspaceSaved(page)
  expect(content((await backup('undone')).document)).toEqual(content(initial.document))
  await page.getByRole('button',{name:'重做编辑',exact:true}).click(); await keyboardWorkspaceSaved(page)
  const redone=await backup('redone'); expect(content(redone.document)).toEqual(content(applied.document))
  await closeWorkspaceDrawers(page); await page.getByRole('button',{name:'回到首页',exact:true}).click(); await page.reload()
  await page.locator(`[data-project-key="native:${redone.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click(); await keyboardWorkspaceSaved(page)
  const cold=await backup('cold'); expect(cold.hashes).toEqual(redone.hashes)
  for(const audience of['gm','player']as const){const pending=page.waitForEvent('download');await(await mapExportButton(page,audience)).click();await(await pending).saveAs(info.outputPath('cold-'+audience+'.png'));await keyboardWorkspaceSaved(page);await page.locator('.workspace-export-menu > summary').click()}
  await page.screenshot({path:info.outputPath('cold-workspace.png')})
  expect(errors).toEqual([]);await writeFile(info.outputPath('facts.json'),JSON.stringify({browserVersion:browser.version(),propId:prop.id,events,errors},null,2)+'\n')
})
