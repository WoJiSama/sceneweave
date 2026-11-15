// Complements the main raster/PNG matrix with the actual visible refinement layer.
import{expect,test,type Page}from'@playwright/test'
import{readFile,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import{createRequire}from'node:module'
import{keyboardProjectBackup,keyboardWorkspaceSaved}from'./keyboard-ux-helpers'
const{PNG}=createRequire(import.meta.url)('../node_modules/playwright-core/lib/utilsBundle.js')
const root=process.env.SCENEWEAVE_PRIVACY_ARTIFACT??'work/fixed-sample-privacy-20261114'
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const facts=(b:Buffer)=>{const im=PNG.sync.read(b);return{width:im.width,height:im.height,rgbaSha256:sha(im.data)}}
async function ready(page:Page){
 await keyboardWorkspaceSaved(page)
 const viewport=page.getByRole('group',{name:'地图视口',exact:true})
 await expect(viewport).toHaveAttribute('data-refinement-pending','false')
 await expect.poll(async()=>Number(await viewport.getAttribute('data-refinement-count'))).toBeGreaterThan(0)
 await expect(page.locator('.asset-detail-preview')).toBeVisible()
}
for(const name of['VIS-01-S01','VIS-02-S01','VIS-02-S02','SCN-04-S02'])test(`${name} actual visible refinement and composited player viewport remain exact`,async({browser},info)=>{
 test.setTimeout(120000)
 const input=JSON.parse(await readFile(root+'/inputs.json','utf8')).cases.filter((r:any)=>r.name===name),results:any[]=[]
 for(const row of input){
  const context=await browser.newContext({viewport:{width:1512,height:982}}),page=await context.newPage(),errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  try{
   await page.goto('./#home');const chooser=page.waitForEvent('filechooser')
   await page.getByTestId('workspace-home').getByRole('button',{name:'打开工程文件',exact:true}).click();await(await chooser).setFiles(row.path);await ready(page)
   const saved=await keyboardProjectBackup(page,info.outputPath(row.variant+'-imported.sceneweave')),observations:any[]=[]
   for(const phase of['imported','repeated','reopened']){
    if(phase==='reopened'){
     await page.reload();await page.getByRole('button',{name:'回到首页',exact:true}).click()
     await page.locator(`[data-project-key="native:${saved.document.sceneId}"]`).getByRole('button',{name:'打开',exact:true}).click();await ready(page)
    }
    for(const audience of['gm','player']){
     await page.getByRole('group',{name:'预览受众',exact:true}).getByRole('button',{name:audience==='gm'?'主持人':'玩家',exact:true}).click();await ready(page)
     // Audience chrome can resize the viewport while preserving pixels/mm.
     // Freeze the actual view through the public fit command before comparison.
     await page.getByRole('button',{name:'适应全图',exact:true}).click();await ready(page)
     await expect(page.getByRole('group',{name:'地图视口',exact:true})).toHaveAttribute('data-zoom','1')
     const detail=page.locator('.asset-detail-preview'),bounds=JSON.parse((await detail.getAttribute('data-refinement-bounds'))!)
     const bytes=Buffer.from(await detail.evaluate((c:HTMLCanvasElement)=>c.toDataURL('image/png').split(',')[1]),'base64')
     await writeFile(info.outputPath(`${row.variant}-${phase}-${audience}-detail.png`),bytes)
     const screenshot=await page.locator('.asset-viewport-image').screenshot({path:info.outputPath(`${row.variant}-${phase}-${audience}-visible.png`),animations:'disabled'})
     observations.push({phase,audience,bounds,viewport:await page.getByRole('group',{name:'地图视口',exact:true}).boundingBox(),image:await page.locator('.asset-viewport-image').boundingBox(),detail:facts(bytes),visible:facts(screenshot)})
    }
   }
   expect(errors).toEqual([]);results.push({variant:row.variant,observations,pageErrors:errors})
  }finally{await context.close()}
 }
 await writeFile(info.outputPath('observations.json'),JSON.stringify({name,results},null,2)+'\n')
 for(const phase of['imported','repeated','reopened'])for(const mode of['detail','visible']){
  const at=(i:number,audience:string)=>results[i].observations.find((o:any)=>o.phase===phase&&o.audience===audience)
  expect(at(0,'player').bounds).toEqual(at(1,'player').bounds)
  expect(at(0,'player')[mode]).toEqual(at(1,'player')[mode])
  expect(at(0,'gm')[mode].rgbaSha256).not.toBe(at(1,'gm')[mode].rgbaSha256)
 }
 for(const r of results)for(const audience of['gm','player'])for(const mode of['detail','visible']){
  const images=r.observations.filter((o:any)=>o.audience===audience).map((o:any)=>o[mode]);for(const im of images)expect(im).toEqual(images[0])
 }
 await writeFile(info.outputPath('facts.json'),JSON.stringify({passed:true,name,browserVersion:browser.version(),backend:'--disable-accelerated-2d-canvas',results,userP3:false},null,2)+'\n')
})
