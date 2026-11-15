import {test,expect} from '@playwright/test'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {keyboardProjectBackup,keyboardWorkspaceSaved,openKeyboardPanel} from './keyboard-ux-helpers'
import {mapExportButton} from './workspace-ux-helpers'
import {openSceneObjects} from './workspace-navigation-helpers'
const inputRoot=resolve(process.env.SCENEWEAVE_NOTE_PRIVACY_INPUTS??'work/current-map-privacy-20261113/authored-verified')
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
test.use({actionTimeout:15000})
test.skip(!process.env.SCENEWEAVE_NOTE_PRIVACY_INPUTS, 'Requires explicitly selected frozen QA inputs and their sibling production PNG baselines; see tests/README.md.')
for(const name of ['fantasy','island']as const)test(`${name} GM notice reflects actual public note filtering, stays out of player view and preserves exports`,async({page},info)=>{
  test.setTimeout(150000)
  const input=`${inputRoot}/${name}/after/candidate.sceneweave`,errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const response=await page.goto('./#home');expect(response?.ok()).toBe(true);expect(await response!.text()).not.toContain('/@vite/client')
  await page.getByTestId('native-project-file').setInputFiles(input);await keyboardWorkspaceSaved(page)
  const notice=page.getByTestId('note-privacy-notice')
  await expect(notice).toBeVisible();await expect(notice.locator('summary')).toHaveText(`${name==='fantasy'?3:2} 条公开注记未向玩家显示`)
  await notice.locator('summary').click();await expect(notice.getByRole('button',{name:'QA_ANCHORED_B_7583',exact:true})).toBeVisible()
  const before=await keyboardProjectBackup(page,info.outputPath('before-select.sceneweave'))
  await notice.getByRole('button',{name:'QA_ANCHORED_B_7583',exact:true}).click()
  await expect(page.getByLabel('编辑注记内容',{exact:true})).toHaveValue('QA_ANCHORED_B_7583')
  const selected=await keyboardProjectBackup(page,info.outputPath('after-select.sceneweave'));expect(selected.hashes).toEqual(before.hashes)
  if(info.project.name.includes('390')){
    const panel=page.getByTestId('workspace-inspector');if(await panel.getAttribute('data-open')==='true')await panel.getByRole('button',{name:'关闭当前详情',exact:true}).click()
  }
  await page.getByRole('group',{name:'预览受众',exact:true}).getByRole('button',{name:'玩家',exact:true}).click();await keyboardWorkspaceSaved(page)
  await expect(notice).toHaveCount(0)
  await page.getByRole('group',{name:'预览受众',exact:true}).getByRole('button',{name:'主持人',exact:true}).click();await keyboardWorkspaceSaved(page)
  await expect(notice).toBeVisible()
  const previousRoot=resolve(inputRoot,'../production/results');let previousFolder=''
  for(const entry of await readdir(previousRoot,{withFileTypes:true}))if(entry.isDirectory()){
    const folder=resolve(previousRoot,entry.name)
    try{const facts=JSON.parse(await readFile(resolve(folder,'facts.json'),'utf8'));if(facts.rows.some((r:any)=>r.name===name))previousFolder=folder}catch{}
  }
  expect(previousFolder).not.toBe('')
  for(const audience of ['gm','player']as const){
    const pending=page.waitForEvent('download');await(await mapExportButton(page,audience)).click();const download=await pending
    expect(download.suggestedFilename()).toBe(`sceneweave-${audience}-map.png`)
    await download.saveAs(info.outputPath(`${audience}.png`));await keyboardWorkspaceSaved(page);await page.locator('.workspace-export-menu > summary').click()
    const old=await readFile(resolve(previousFolder,`after-${audience}.png`)),actual=await readFile(info.outputPath(`${audience}.png`))
    expect(sha(actual)).toBe(sha(old))
  }
  let restored=selected
  if(name==='fantasy'){
    const navigation=await openSceneObjects(page,'结构')
    await navigation.getByLabel('搜索场景对象',{exact:true}).fill('space-entrance')
    await navigation.locator('[data-entity-id="space-entrance"]').click();await openKeyboardPanel(page,'inspector')
    await page.getByLabel('揭示秘密开口',{exact:true}).check();await page.getByRole('button',{name:'预览门窗修改',exact:true}).click()
    const review=page.getByRole('region',{name:'候选审阅',exact:true}).and(page.locator('.workspace-candidate-review'))
    await review.getByLabel('确认完整影响范围',{exact:true}).check();await review.getByRole('button',{name:'采用结构修改',exact:true}).click();await keyboardWorkspaceSaved(page)
    await expect(notice.locator('summary')).toHaveText('2 条公开注记未向玩家显示')
    await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(page);await expect(notice.locator('summary')).toHaveText('3 条公开注记未向玩家显示')
    await page.getByRole('button',{name:'重做编辑',exact:true}).click();await keyboardWorkspaceSaved(page);await expect(notice.locator('summary')).toHaveText('2 条公开注记未向玩家显示')
    await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await keyboardWorkspaceSaved(page);await expect(notice.locator('summary')).toHaveText('3 条公开注记未向玩家显示')
    restored=await keyboardProjectBackup(page,info.outputPath('restored.sceneweave'))
    expect(restored.document.openings).toEqual(before.document.openings)
  }
  await page.reload();await page.getByRole('button',{name:'回到首页',exact:true}).click()
  await page.locator(`[data-project-key="native:${before.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await keyboardWorkspaceSaved(page)
  const cold=await keyboardProjectBackup(page,info.outputPath('cold.sceneweave'));expect(cold.hashes).toEqual(restored.hashes);await expect(notice).toBeVisible()
  await page.screenshot({path:info.outputPath('gm-notice.png')})
  expect(errors).toEqual([])
  await writeFile(info.outputPath('facts.json'),JSON.stringify({name,input,viewport:page.viewportSize(),revision:cold.document.revision,selectionDidNotMutateProject:true,coldHashEqual:true,gmPlayerActualPngBytesPreserved:true,playerNoticeAbsent:true,errors},null,2)+'\n')
})
