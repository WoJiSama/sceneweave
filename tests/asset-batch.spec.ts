import { acknowledgeAssetQuality } from './asset-quality-helpers'
import { openWorkspaceModule } from './workspace-navigation-helpers'
import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { crc32 } from '../src/shared/project/binary'

const license='Original asset batch test artwork. Copyright 2026 Sceneweave contributors. Permission is granted to use, copy, modify and embed this test artwork under the MIT License.'
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48">  <path d="M5 8L54 4L60 39L12 43Z" fill="#6b8d58" stroke="#40594a" stroke-width="2"/> </svg>'
const unsafe='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><image href="https://external-asset-test.invalid/never.png" width="64" height="48"/></svg>'
const library=(page:Page)=>page.getByRole('region',{name:'组件素材库',exact:true})
async function settled(page:Page){await expect(page.locator('.asset-busy')).toHaveCount(0,{timeout:90000});await expect(page.locator('.asset-save')).toHaveText('本地已保存',{timeout:90000})}
async function createBlank(page:Page,title:string){await page.goto('/#home');await page.getByTestId('workspace-home').getByRole('button',{name:'新建场景',exact:true}).click();const dialog=page.getByRole('dialog',{name:'新建空白场景',exact:true});await dialog.getByLabel('场景名称',{exact:true}).fill(title);await dialog.getByRole('button',{name:'创建空白场景',exact:true}).click();await expect(dialog).toHaveCount(0);await settled(page)}
async function state(page:Page){return page.evaluate(async()=>{const path='/src/editor/main/Workbench.tsx',hashPath='/src/shared/project/validate.ts',bundlePath='/src/application/workspace/project.ts';const {nativeWorkspace}=await import(path),{projectContentHash}=await import(hashPath),{toBundle}=await import(bundlePath);const project=nativeWorkspace.getState().project!;return {hash:projectContentHash(toBundle(project).project),revision:project.document.revision,document:structuredClone(project.document),sources:structuredClone(project.authoringSources),licenses:structuredClone(project.licenses),bindings:structuredClone(project.licenseBindings)}})}
function withText(png:Buffer){const text=Buffer.from('private-source-comment\0must-not-survive-normalization'),type=Buffer.from('tEXt'),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(text.length);crc.writeUInt32BE(crc32(new Uint8Array(Buffer.concat([type,text]))));return Buffer.concat([png.subarray(0,png.length-12),length,type,text,crc,png.subarray(png.length-12)])}

test('real ZIP and folder selected import preserves SVG source, calibrates roots and publishes one reversible complete batch',async({page},info)=>{
  test.setTimeout(300000)
  const dir=await mkdtemp(join(tmpdir(),'sceneweave-asset-batch-'))
  const external:string[]=[];page.on('request',request=>{if(request.url().includes('external-asset-test.invalid'))external.push(request.url())})
  try{
    await createBlank(page,'批量素材UI证据')
    const images=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;const c=canvas.getContext('2d')!;c.fillStyle='#b49a6c';c.fillRect(0,0,80,60);c.fillStyle='#57724e';c.fillRect(8,9,38,36);const result:Record<string,string>={};for(const [key,type]of [['png','image/png'],['jpg','image/jpeg'],['webp','image/webp']]){const blob=await new Promise<Blob>(resolve=>canvas.toBlob(v=>resolve(v!),type,.91));let text='';const bytes=new Uint8Array(await blob.arrayBuffer());for(const b of bytes)text+=String.fromCharCode(b);result[key]=btoa(text)}return result})
    const png=withText(Buffer.from(images.png,'base64')),zip=zipSync({'pack/':new Uint8Array(0),'pack/01-map.png':png,'pack/02-safe.svg':Buffer.from(svg),'pack/03-copy.png':png,'pack/04-photo.jpg':Buffer.from(images.jpg,'base64'),'pack/05-tile.webp':Buffer.from(images.webp,'base64'),'pack/06-bad.svg':Buffer.from(unsafe),'pack/LICENSE.txt':Buffer.from(license)})
    const zipPath=join(dir,'assets.zip');await writeFile(zipPath,zip)
    await openWorkspaceModule(page, '素材')
    const lib=library(page),form=lib.locator('.asset-batch-import')
    await lib.getByRole('group', { name: '素材库操作', exact: true }).getByRole('button', { name: /^导入\/管理/ }).click()
    await form.locator(':scope > summary').click()
    await form.getByLabel('素材ZIP',{exact:true}).setInputFiles(zipPath)
    await expect(form).toContainText('已读取 6 项素材')
    await form.getByLabel('批次素材署名与来源',{exact:true}).fill('Sceneweave contributors; original batch fixtures')
    await form.getByLabel('批次素材完整许可',{exact:true}).fill(license)
    await form.getByLabel('确认本批素材可嵌入工程',{exact:true}).check()
    const first=form.getByRole('article',{name:'批量素材 pack/01-map.png',exact:true});await first.getByText('名称、尺寸、根锚与许可',{exact:true}).click()
    await first.getByLabel('pack/01-map.png名称',{exact:true}).fill('批量根锚图')
    await first.getByLabel('pack/01-map.png宽度毫米',{exact:true}).fill('1200');await first.getByLabel('pack/01-map.png高度毫米',{exact:true}).fill('900')
    await first.getByLabel('pack/01-map.png根锚X毫米',{exact:true}).fill('350');await first.getByLabel('pack/01-map.png根锚Y毫米',{exact:true}).fill('800')
    const before=await state(page)
    await form.getByRole('button',{name:'预览所选 6 项素材',exact:true}).click()
    await expect(form).toContainText('本批未采用',{timeout:90000});expect((await state(page)).hash).toBe(before.hash)
    await form.getByLabel('选择素材 pack/06-bad.svg',{exact:true}).uncheck()
    const safe=form.getByRole('article',{name:'批量素材 pack/02-safe.svg',exact:true});await safe.getByText('名称、尺寸、根锚与许可',{exact:true}).click();await safe.getByLabel('pack/02-safe.svg独立许可',{exact:true}).check();await safe.getByLabel('pack/02-safe.svg署名与来源',{exact:true}).fill('SVG original author');await safe.getByLabel('pack/02-safe.svg完整许可',{exact:true}).fill(license+' Independent vector source grant.');await safe.getByLabel('pack/02-safe.svg可嵌入工程',{exact:true}).check()
    await form.getByRole('button',{name:'预览所选 5 项素材',exact:true}).click()
    await expect(page.getByRole('button',{name:'采用所选素材',exact:true})).toBeVisible({timeout:90000})
    await expect(form.locator('img')).toHaveCount(5);await expect.poll(()=>form.locator('img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true)
    expect((await state(page)).hash).toBe(before.hash)
    const reviewImage=await form.screenshot();await writeFile(info.outputPath('batch-review.png'),reviewImage);await info.attach('batch-normalized-review.png',{body:reviewImage,contentType:'image/png'})
    await page.getByRole('button',{name:'取消素材导入预览',exact:true}).click()
    await expect(form.getByRole('button',{name:'预览所选 5 项素材',exact:true})).toBeEnabled();await expect(form.locator('img')).toHaveCount(0)
    await form.getByRole('button',{name:'预览所选 5 项素材',exact:true}).click();await expect(page.getByRole('button',{name:'采用所选素材',exact:true})).toBeVisible({timeout:90000});await acknowledgeAssetQuality(page);await page.getByRole('button',{name:'采用所选素材',exact:true}).click();await settled(page)
    const adopted=await state(page),added=Object.values(adopted.document.propDefinitions).filter((d:any)=>!before.document.propDefinitions[d.id]) as any[]
    expect(added).toHaveLength(5);expect(adopted.revision).toBe(before.revision+1);expect(adopted.document.props).toEqual(before.document.props)
    const anchored=added.find(d=>d.name==='批量根锚图')!;expect(anchored.defaultVisualBoundsMm).toEqual({x:-350,y:-800,width:1200,height:900});expect(anchored.defaultFootprintMm).toEqual({width:1000,height:1000})
    expect(Object.keys(adopted.sources).length-Object.keys(before.sources).length).toBe(1)
    const proof=await page.evaluate(async({svg,ids})=>{const path='/src/editor/main/Workbench.tsx',bundlePath='/src/application/workspace/project.ts',filePath='/src/shared/project/file.ts',runtimePath='/src/platform/browser/runtime.ts',hashPath='/src/shared/project/validate.ts',catalogPath='/src/editor/main/catalog.ts';const {nativeWorkspace}=await import(path),{toBundle}=await import(bundlePath),{exportProject,importProject}=await import(filePath),{validation,projectRepository}=await import(runtimePath),{projectContentHash}=await import(hashPath),catalog=await import(catalogPath);const project=nativeWorkspace.getState().project!,bundle=toBundle(project),chunks:Record<string,string[]>={},sources=[]
      for(const id of ids){const d=project.document.propDefinitions[id],asset=project.document.assets[d.defaultAppearance.assetId],bytes=await project.resources.read(asset.sha256),names=[];for(let offset=8;offset<bytes.length;){const view=new DataView(bytes.buffer,bytes.byteOffset+offset,8),n=view.getUint32(0);names.push(String.fromCharCode(...bytes.slice(offset+4,offset+8)));offset+=12+n}chunks[id]=names}
      for(const source of Object.values(project.authoringSources) as any[]){const text=new TextDecoder().decode(await project.resources.read(source.sourceSha256));sources.push(text)}
      if(!sources.includes(svg))throw new Error('Exact external SVG source was lost')
      const bytes=await exportProject(bundle,validation),round=await importProject(bytes,validation),cold=await projectRepository.load(project.document.sceneId)
      if(projectContentHash(round.project)!==projectContentHash(bundle.project)||projectContentHash(cold!.project)!==projectContentHash(bundle.project))throw new Error('Batch package/cold mismatch')
      const entries=[];for(const id of ids)entries.push(await catalog.prepareCatalogEntry(project,{kind:'prop',definitionId:id}))
      const records=entries.map((entry:any)=>({entry,organization:{tags:['批量导入'],colors:[],favorite:false}})),backup=await catalog.exportCatalogBackup(records),restored=await catalog.readCatalogBackup(new File([backup],'batch-library.zip'))
      let binary='';for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768))
      return {chunks,svgExact:sources.includes(svg),sourceCount:sources.length,capsules:restored.records.length,hash:projectContentHash(round.project),package:btoa(binary)}
    },{svg,ids:added.map(d=>d.id)})
    for(const chunks of Object.values(proof.chunks))expect(chunks.every(name=>['IHDR','sRGB','IDAT','IEND'].includes(name))).toBe(true)
    expect(proof.capsules).toBe(5);expect(proof.svgExact).toBe(true)
    await writeFile(info.outputPath('batch.sceneweave'),Buffer.from(proof.package,'base64'));await writeFile(info.outputPath('batch-proof.json'),JSON.stringify({...proof,package:undefined},null,2))
    await page.getByRole('button',{name:'撤销编辑',exact:true}).click();await settled(page);const undone=await state(page);expect(undone.document.propDefinitions).toEqual(before.document.propDefinitions)
    await page.getByRole('button',{name:'重做编辑',exact:true}).click();await settled(page);expect((await state(page)).document.propDefinitions).toEqual(adopted.document.propDefinitions)
    if(!await form.evaluate(element=>(element as HTMLDetailsElement).open))await form.locator(':scope > summary').click()
    const folder=join(dir,'folder');await mkdir(folder);await writeFile(join(folder,'only.png'),png);await writeFile(join(folder,'LICENSE.txt'),license)
    await form.getByLabel('素材文件夹',{exact:true}).setInputFiles(folder);await expect(form).toContainText('已读取 1 项素材')
    await form.getByRole('button',{name:'清空导入批次',exact:true}).click()
    const badZip=zipSync({'../escape.svg':Buffer.from(svg)}),badPath=join(dir,'bad.zip');await writeFile(badPath,badZip)
    await form.getByLabel('素材ZIP',{exact:true}).setInputFiles(badPath);await expect(form.getByRole('alert')).toContainText(/路径|不安全/);expect((await state(page)).document.propDefinitions).toEqual(adopted.document.propDefinitions)
    await expect(form.getByRole('button',{name:'清空导入批次',exact:true})).toBeEnabled();await form.getByRole('button',{name:'清空导入批次',exact:true}).click();await expect(page.getByRole('button',{name:'取消素材导入草稿',exact:true})).toHaveCount(0)
    expect(external).toEqual([])
  }finally{await rm(dir,{recursive:true,force:true})}
})
