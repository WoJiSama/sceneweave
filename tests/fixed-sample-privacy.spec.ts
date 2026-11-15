// Normal production UI: exact actual canvas and downloaded PNG pair comparisons.
import {expect,test,type Page} from '@playwright/test'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
import {keyboardProjectBackup,keyboardResourceHashes,keyboardWorkspaceSaved} from './keyboard-ux-helpers'
import {mapExportButton} from './workspace-ux-helpers'

const {PNG}=createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const root=process.env.SCENEWEAVE_PRIVACY_ARTIFACT??'work/fixed-sample-privacy-20261114'
const cases=['VIS-01-S01','VIS-02-S01','VIS-02-S02','SCN-04-S02'] as const
const content=(scene:object)=>{
  const {sceneId:_id,revision:_revision,createdAt:_created,updatedAt:_updated,...rest}=scene as Record<string,unknown>;return rest
}
function imageFacts(bytes:Buffer){
  const image=PNG.sync.read(bytes),chunks:string[]=[]
  let end=8
  while(end<bytes.length){const length=bytes.readUInt32BE(end);chunks.push(bytes.toString('ascii',end+4,end+8));end+=length+12}
  expect(end).toBe(bytes.length)
  expect(chunks.every(c=>['IHDR','IDAT','IEND','sRGB'].includes(c))).toBe(true)
  const markers=['PRIVATE-SOURCE-PROMPT','PRIVATE-SEED','SECRET-DEP','SECRET-NESTED','灯架下藏有返航账目','b4-secret-note','generationMetadata','historyIdentity']
  expect(markers.filter(m=>bytes.includes(Buffer.from(m)))).toEqual([])
  return{width:image.width,height:image.height,rgbaSha256:sha(image.data),sha256:sha(bytes),chunks}
}
async function load(page:Page,path:string){
  const response=await page.goto('./#home')
  expect(response?.ok()).toBe(true);expect(await response!.text()).not.toContain('/@vite/client')
  const pending=page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button',{name:'打开工程文件',exact:true}).click()
  await(await pending).setFiles(path);await keyboardWorkspaceSaved(page)
}
async function observe(page:Page,audience:'gm'|'player',prefix:string){
  await page.getByRole('group',{name:'预览受众',exact:true}).getByRole('button',{name:audience==='gm'?'主持人':'玩家',exact:true}).click()
  await keyboardWorkspaceSaved(page)
  const canvas=page.getByLabel(audience==='gm'?'材质场景主持人预览':'材质场景玩家预览',{exact:true})
  await expect(canvas).toBeVisible()
  const data=await canvas.evaluate((node:HTMLCanvasElement)=>node.toDataURL('image/png').split(',')[1])
  const preview=Buffer.from(data,'base64');await writeFile(prefix+'-preview.png',preview)
  const pending=page.waitForEvent('download')
  await(await mapExportButton(page,audience)).click()
  const download=await pending;expect(download.suggestedFilename()).toBe(`sceneweave-${audience}-map.png`)
  await download.saveAs(prefix+'-4096.png');await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  return{audience,preview:imageFacts(preview),png:imageFacts(await readFile(prefix+'-4096.png'))}
}
for(const name of cases)test(`${name} current complete-v1 fixed-mask private pair keeps exact player pixels through repeated preview/export and cold reopen`,async({browser},info)=>{
  test.setTimeout(180000)
  const input=JSON.parse(await readFile(root+'/inputs.json','utf8')).cases.filter((r:any)=>r.name===name)
  expect(input).toHaveLength(2)
  const results:any[]=[]
  for(const row of input){
    const context=await browser.newContext({viewport:{width:1512,height:982}}),page=await context.newPage(),errors:string[]=[]
    page.on('pageerror',e=>errors.push(e.message))
    try{
      expect(sha(await readFile(row.path))).toBe(row.sha256)
      await load(page,row.path)
      const imported=await keyboardProjectBackup(page,info.outputPath(row.variant+'-imported.sceneweave'))
      const {unzipSync}=await import('fflate')
      const files=unzipSync(new Uint8Array(await readFile(row.path)))
      const json=(path:string)=>JSON.parse(new TextDecoder().decode(files[path]))
      expect(content(imported.document)).toEqual(content(json('scene.json')))
      expect(imported.document.sceneId).not.toBe(json('scene.json').sceneId);expect(imported.document.revision).toBe(0)
      expect(imported.identity).toEqual(json('identity.json'));expect(imported.appearance).toEqual(json('appearance.json'))
      const sourceHashes=Object.fromEntries(Object.entries(files).map(([path,bytes])=>[path,sha(bytes)]))
      expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(sourceHashes))
      const observations:any[]=[]
      for(const phase of ['imported','repeated','reopened']){
        if(phase==='reopened'){
          await page.reload();await page.getByRole('button',{name:'回到首页',exact:true}).click()
          await page.locator(`[data-project-key="native:${imported.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click()
          await keyboardWorkspaceSaved(page)
          const cold=await keyboardProjectBackup(page,info.outputPath(row.variant+'-cold.sceneweave'))
          expect(cold.hashes).toEqual(imported.hashes)
        }
        for(const audience of ['gm','player'] as const){
          const record=await observe(page,audience,info.outputPath(`${row.variant}-${phase}-${audience}`))
          expect(record.png.width).toBe(4096);expect(record.png.height).toBe(Math.round(4096*row.bounds.height/row.bounds.width))
          observations.push({phase,...record})
        }
      }
      for(const audience of ['gm','player'])for(const mode of ['preview','png']){
        const images=observations.filter(o=>o.audience===audience).map(o=>o[mode])
        for(const image of images)expect(image).toEqual(images[0])
      }
      expect(errors).toEqual([])
      results.push({variant:row.variant,input:row,importedSceneId:imported.document.sceneId,importRevision:imported.document.revision,fullColdHashesEqual:true,observations,pageErrors:errors})
    }finally{await context.close()}
  }
  for(const phase of ['imported','repeated','reopened'])for(const mode of ['preview','png']){
    const record=(i:number,audience:string)=>results[i].observations.find((o:any)=>o.phase===phase&&o.audience===audience)[mode]
    expect(record(0,'player')).toEqual(record(1,'player'))
    expect(record(0,'gm').rgbaSha256).not.toBe(record(1,'gm').rgbaSha256)
  }
  await writeFile(info.outputPath('facts.json'),JSON.stringify({passed:true,name,engine:'Chrome',version:browser.version(),normalProduction:true,cacheMeaning:'Separate new contexts per variant; imported and repeated toggle/render/export in same module, then actual persisted cold read after reload. No claim of browser/OS disk-cache flush.',results,userP3:false},null,2)+'\n')
})
