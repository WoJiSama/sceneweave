import { useEffect, useRef, useState } from 'react'
import { collectAssetFiles, type AssetFileCollection, type AssetFileSource, type CollectedAssetFile } from '../../platform/browser/assets/batch-source'
import type { AssetImportRequest, AssetBatchImportItem } from '../../application/workspace/asset-batch'
import './asset-batch.css'

export interface AssetBatchReview { items: (AssetBatchImportItem & { thumbnail: Blob })[]; addedDefinitions: number; uniqueImageBytes: number }
interface Props {
  disabled: boolean
  candidateActive?: boolean
  onPreview: (requests: AssetImportRequest[], signal: AbortSignal) => Promise<AssetBatchReview>
  onDraftChange?: (dirty: boolean) => void
  onInvalidate?: () => void
}
interface Calibration { width: string; height: string; footWidth: string; footHeight: string; anchorX: string; anchorY: string; movement: boolean; sight: boolean; kind: 'prop'|'material'; tags: string }
interface Row extends Calibration { entry: CollectedAssetFile; selected: boolean; name: string; ownLicense: boolean; license: string; attribution: string; embed: boolean }
const calibration = (): Calibration => ({ width:'1000',height:'1000',footWidth:'1000',footHeight:'1000',anchorX:'500',anchorY:'500',movement:true,sight:false,kind:'prop',tags:'' })
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure)
const size = (bytes:number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`

/** Source files are never displayed as live SVG. Thumbnails only use the
 * normalized PNG bytes returned by complete project preparation. */
export default function AssetBatchImportForm({disabled,candidateActive=true,onPreview,onDraftChange,onInvalidate}:Props) {
  const [rows,setRows]=useState<Row[]>([]),[collection,setCollection]=useState<AssetFileCollection|null>(null)
  const [defaults,setDefaults]=useState(calibration),[license,setLicense]=useState(''),[attribution,setAttribution]=useState(''),[embed,setEmbed]=useState(false)
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[failedKey,setFailedKey]=useState<string|null>(null),[review,setReview]=useState<AssetBatchReview|null>(null),[thumbnails,setThumbnails]=useState<Record<string,string>>({})
  const operation=useRef(0),controller=useRef<AbortController|null>(null),mounted=useRef(true),urls=useRef<string[]>([]),dirtyCallback=useRef(onDraftChange),invalidateCallback=useRef(onInvalidate)
  dirtyCallback.current=onDraftChange;invalidateCallback.current=onInvalidate
  const revoke=()=>{urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current=[];setThumbnails({})}
  const invalidate=()=>{operation.current++;controller.current?.abort();controller.current=null;setPending(false);revoke();setReview(null);setError('');setFailedKey(null);invalidateCallback.current?.()}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current++;controller.current?.abort();urls.current.forEach(url=>URL.revokeObjectURL(url));dirtyCallback.current?.(false)}},[])
  useEffect(()=>{if(review&&!candidateActive&&!pending){revoke();setReview(null);dirtyCallback.current?.(rows.length>0)}},[candidateActive,review,pending])
  const edit=(run:()=>void)=>{invalidate();run();dirtyCallback.current?.(true)}
  const update=(key:string,patch:Partial<Row>)=>edit(()=>setRows(current=>current.map(row=>row.entry.key===key?{...row,...patch}:row)))
  const read=async(files:File[],source:AssetFileSource)=>{
    if(disabled||!files.length)return
    invalidate();dirtyCallback.current?.(true)
    const abort=new AbortController(),epoch=++operation.current;controller.current=abort;setPending(true)
    try {
      const found=await collectAssetFiles(files,{source,signal:abort.signal})
      if(!mounted.current||abort.signal.aborted||epoch!==operation.current)return
      setCollection(found);setRows(found.entries.map(entry=>({...defaults,entry,selected:true,name:Array.from(entry.path.split('/').at(-1)!.replace(/\.[^.]+$/,'')).slice(0,120).join('')||'素材',ownLicense:false,license:'',attribution:'',embed:false})))
    }catch(failure){if(mounted.current&&epoch===operation.current&&!abort.signal.aborted)setError(message(failure))}
    finally{if(mounted.current&&epoch===operation.current){setPending(false);controller.current=null}}
  }
  const selected=rows.filter(row=>row.selected),occupied=disabled||pending
  const request=(row:Row):AssetImportRequest=>{
    const values=[row.width,row.height,...(row.kind==='prop'?[row.footWidth,row.footHeight]:[])].map(Number)
    if(!row.name.trim()||values.some(value=>!Number.isSafeInteger(value)||value<=0||value>1000000))throw new Error(`${row.entry.path}：名称与正整数毫米尺寸必须完整。`)
    const text=row.ownLicense?row.license:license,credit=row.ownLicense?row.attribution:attribution,allowed=row.ownLicense?row.embed:embed
    if(!text.trim()||!credit.trim()||!allowed)throw new Error(`${row.entry.path}：请提供完整许可、署名，并确认有权嵌入工程。`)
    const anchor={x:Number(row.anchorX),y:Number(row.anchorY)}
    if(row.kind==='prop'&&(!Number.isSafeInteger(anchor.x)||!Number.isSafeInteger(anchor.y)||anchor.x<0||anchor.y<0||anchor.x>values[0]||anchor.y>values[1]))throw new Error(`${row.entry.path}：根锚须为图像范围内的整数毫米坐标。`)
    return {file:row.entry.file,name:row.name.trim(),kind:row.kind,widthMm:values[0],heightMm:values[1],...(row.kind==='prop'?{footprintWidthMm:values[2],footprintHeightMm:values[3],rootAnchorMm:anchor,blocksMovement:row.movement,blocksSight:row.sight}:{}),tags:[...new Set(row.tags.split(/[,，\n]/).map(tag=>tag.trim()).filter(Boolean))],licenseText:text.trim(),attribution:credit.trim(),canEmbed:true}
  }
  const preview=async()=>{
    if(occupied||!selected.length)return
    invalidate();const abort=new AbortController(),epoch=++operation.current;controller.current=abort;setPending(true)
    const keys=selected.map(row=>row.entry.key)
    try{
      const requests=selected.map(row=>{try{return request(row)}catch(failure){setFailedKey(row.entry.key);throw failure}})
      const result=await onPreview(requests,abort.signal)
      if(!mounted.current||abort.signal.aborted||epoch!==operation.current)return
      const next:Record<string,string>={}
      for(const item of result.items){const url=URL.createObjectURL(item.thumbnail);urls.current.push(url);next[keys[item.index]]=url}
      setReview(result);setThumbnails(next);dirtyCallback.current?.(false)
    }catch(failure){if(mounted.current&&epoch===operation.current&&!abort.signal.aborted){setError(message(failure));if(failure&&typeof failure==='object'&&'itemIndex'in failure&&typeof failure.itemIndex==='number')setFailedKey(keys[failure.itemIndex]??null)}}
    finally{if(mounted.current&&epoch===operation.current){setPending(false);controller.current=null}}
  }
  const clear=()=>{invalidate();setRows([]);setCollection(null);setLicense('');setAttribution('');setEmbed(false);setDefaults(calibration());dirtyCallback.current?.(false)}
  const choose=(files:FileList|null,source:AssetFileSource)=>{if(files)void read(Array.from(files),source)}
  const calibrationFields=(value:Calibration,set:(patch:Partial<Calibration>)=>void,prefix:string)=><>
    <label>用途<select aria-label={`${prefix}用途`} value={value.kind} onChange={e=>set({kind:e.target.value as Calibration['kind']})}><option value="prop">独立物件</option><option value="material">平铺材质</option></select></label>
    <div className="composition-fields"><label>图像／铺装宽 mm<input aria-label={`${prefix}宽度毫米`} type="number" min="1" max="1000000" step="1" value={value.width} onChange={e=>set({width:e.target.value})}/></label><label>图像／铺装高 mm<input aria-label={`${prefix}高度毫米`} type="number" min="1" max="1000000" step="1" value={value.height} onChange={e=>set({height:e.target.value})}/></label></div>
    {value.kind==='prop'&&<><div className="composition-fields"><label>占地宽 mm<input aria-label={`${prefix}占地宽度毫米`} type="number" min="1" max="1000000" step="1" value={value.footWidth} onChange={e=>set({footWidth:e.target.value})}/></label><label>占地高 mm<input aria-label={`${prefix}占地高度毫米`} type="number" min="1" max="1000000" step="1" value={value.footHeight} onChange={e=>set({footHeight:e.target.value})}/></label></div>
      <div className="composition-fields"><label>根锚 X mm<input aria-label={`${prefix}根锚X毫米`} type="number" min="0" step="1" value={value.anchorX} onChange={e=>set({anchorX:e.target.value})}/></label><label>根锚 Y mm<input aria-label={`${prefix}根锚Y毫米`} type="number" min="0" step="1" value={value.anchorY} onChange={e=>set({anchorY:e.target.value})}/></label></div>
      <small>根锚从图像左上角计，表示物件落在世界坐标上的位置；与占地分别标定。</small><label className="composition-check"><input aria-label={`${prefix}阻挡移动`} type="checkbox" checked={value.movement} onChange={e=>set({movement:e.target.checked})}/>阻挡移动</label><label className="composition-check"><input aria-label={`${prefix}阻挡视线`} type="checkbox" checked={value.sight} onChange={e=>set({sight:e.target.checked})}/>阻挡视线</label></>}
    <label>标签<input aria-label={`${prefix}标签`} value={value.tags} onChange={e=>set({tags:e.target.value})}/></label>
  </>
  return <details className="asset-details composition-import asset-batch-import"><summary>批量导入图片／SVG</summary>
    <p className="asset-muted">选择多文件、文件夹或素材 ZIP。仅所选项进入完整候选，采用前可核对规范 PNG、尺寸、根锚和许可；失败不安装半批。</p>
    <div className="asset-batch-sources"><label>多文件<input type="file" multiple aria-label="批量素材文件" accept=".png,.jpg,.jpeg,.webp,.svg" disabled={occupied} onChange={e=>{choose(e.target.files,'files');e.target.value=''}}/></label>
      <label>文件夹<input type="file" multiple {...{webkitdirectory:''}} aria-label="素材文件夹" disabled={occupied} onChange={e=>{choose(e.target.files,'folder');e.target.value=''}}/></label>
      <label>素材 ZIP<input type="file" accept=".zip,application/zip" aria-label="素材ZIP" disabled={occupied} onChange={e=>{choose(e.target.files,'zip');e.target.value=''}}/></label></div>
    {collection&&<p role="status">已读取 {rows.length} 项素材，来源 {size(collection.totalBytes)}；已选 {selected.length} 项。支持素材最多64项，最终仍检查完整来源与工程预算；超限整批拒绝。</p>}
    <form onSubmit={e=>{e.preventDefault();void preview()}}><fieldset disabled={occupied}>
      <details><summary>批次默认尺寸与占地</summary>{calibrationFields(defaults,patch=>edit(()=>setDefaults(current=>({...current,...patch}))),'批次默认')}
        <button type="button" disabled={!selected.length} onClick={()=>edit(()=>setRows(current=>current.map(row=>row.selected?{...row,...defaults}:row)))}>应用默认设置到所选项</button></details>
      <label>本批署名与来源<input aria-label="批次素材署名与来源" value={attribution} maxLength={500} onChange={e=>edit(()=>setAttribution(e.target.value))}/></label>
      <label>本批完整许可<textarea aria-label="批次素材完整许可" rows={4} value={license} onChange={e=>edit(()=>setLicense(e.target.value))}/></label>
      <label className="composition-check"><input aria-label="确认本批素材可嵌入工程" type="checkbox" checked={embed} onChange={e=>edit(()=>setEmbed(e.target.checked))}/>我确认这份许可适用于继承它的所选素材，并有权将其嵌入、分享于工程</label>
      {!!rows.length&&<><div className="asset-batch-selection"><button type="button" onClick={()=>edit(()=>setRows(current=>current.map(row=>({...row,selected:true}))))}>全选素材</button><button type="button" onClick={()=>edit(()=>setRows(current=>current.map(row=>({...row,selected:false}))))}>清除选择</button></div>
        <div className="asset-batch-rows">{rows.map(row=>{const result=review?.items.find(item=>thumbnails[row.entry.key]&&item.index===selected.findIndex(value=>value.entry.key===row.entry.key));return <article key={row.entry.key} aria-label={`批量素材 ${row.entry.path}`} className={failedKey===row.entry.key?'asset-batch-row failed':'asset-batch-row'}>
          <label className="composition-check"><input aria-label={`选择素材 ${row.entry.path}`} type="checkbox" checked={row.selected} onChange={e=>update(row.entry.key,{selected:e.target.checked})}/><strong>{row.entry.path}</strong> · {row.entry.format==='svg'?'静态 SVG':'图片'}</label>
          {thumbnails[row.entry.key]&&<img loading="lazy" decoding="async" className="asset-batch-thumbnail" src={thumbnails[row.entry.key]} alt={`${row.name}规范PNG预览`}/>}
          {result&&<p>{result.pixelWidth} × {result.pixelHeight} px · {row.width} × {row.height} mm · {result.duplicateOf!==null?'复用本批相同固定定义':result.reusedResource?'复用相同图片字节':'新增固定来源'} · 校验通过</p>}
          {failedKey===row.entry.key&&<p role="alert">此项未通过，本批未采用。可修正或取消勾选后重新预览。</p>}
          <details><summary>名称、尺寸、根锚与许可</summary><label>名称<input aria-label={`${row.entry.path}名称`} value={row.name} maxLength={120} onChange={e=>update(row.entry.key,{name:e.target.value})}/></label>
            {calibrationFields(row,patch=>update(row.entry.key,patch),`${row.entry.path}`)}
            <label className="composition-check"><input aria-label={`${row.entry.path}独立许可`} type="checkbox" checked={row.ownLicense} onChange={e=>update(row.entry.key,{ownLicense:e.target.checked})}/>此项使用独立许可</label>
            {row.ownLicense?<><label>署名与来源<input aria-label={`${row.entry.path}署名与来源`} value={row.attribution} onChange={e=>update(row.entry.key,{attribution:e.target.value})}/></label><label>完整许可<textarea aria-label={`${row.entry.path}完整许可`} value={row.license} onChange={e=>update(row.entry.key,{license:e.target.value})}/></label><label className="composition-check"><input aria-label={`${row.entry.path}可嵌入工程`} type="checkbox" checked={row.embed} onChange={e=>update(row.entry.key,{embed:e.target.checked})}/>我有权嵌入并分享此项</label></>:<p>继承上方本批许可与署名，采用时逐项保存确切绑定。</p>}
          </details></article>})}</div></>}
      {!!collection?.skipped.length&&<details><summary>未作为素材导入 · {collection.skipped.length} 项</summary><ul>{collection.skipped.map(item=><li key={item.path}>{item.path}：{item.reason}</li>)}</ul></details>}
      {error&&<p role="alert" className="asset-form-error">{error}</p>}
      {review&&<p role="status">完整候选已准备：新增 {review.addedDefinitions} 个固定定义，所选图片保留量 {size(review.uniqueImageBytes)}。请在画布上方审阅并一次采用；主工程尚未修改。</p>}
      <button className="primary asset-wide" type="submit" disabled={occupied||!selected.length}>预览所选 {selected.length} 项素材</button>
      <button className="secondary asset-wide" type="button" disabled={occupied} onClick={clear}>清空导入批次</button>
    </fieldset></form>
    {pending&&<div role="status"><span>正在读取或完整校验所选批次…</span><button type="button" onClick={()=>{invalidate();setError('已取消准备，当前工程未修改。')}}>取消批次准备</button></div>}
  </details>
}
