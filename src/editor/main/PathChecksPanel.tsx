import { useState } from 'react'
import type { Anchor, AnchoredEntityKind, PathCheck, SceneDocument } from '../../shared/model/scene'
import type { PathCheckCommand } from '../../shared/commands/path-checks'
import { PATH_CHECK_LIMITS, pathCheckSchema } from '../../shared/geometry/path-check-contracts'
import { createEntityLabeler } from './entity-label'

const collections = { vertex:'vertices',room:'rooms',wall:'walls',opening:'openings',prop:'props',region:'regions',note:'notes',
  terrainArea:'terrainAreas',terrainEdge:'terrainEdges',terrainConnection:'terrainConnections',path:'paths',prefabInstance:'prefabInstances',scatterGroup:'scatterGroups' } as const
type AnchorDraft = { ref:string; x:string; y:string }
const anchorDraft = (anchor:Anchor):AnchorDraft => anchor.type==='point' ? {ref:'point',x:String(anchor.positionMm.x),y:String(anchor.positionMm.y)} : {ref:anchor.entityKind+':'+anchor.entityId,x:'',y:''}
const anchorValue = (draft:AnchorDraft):Anchor => {
  if(draft.ref==='point') {
    if(!draft.x.trim()||!draft.y.trim())throw Error('起点和终点坐标不能为空。')
    return {type:'point',positionMm:{x:Number(draft.x),y:Number(draft.y)}}
  }
  const colon=draft.ref.indexOf(':')
  return {type:'entity',entityKind:draft.ref.slice(0,colon) as AnchoredEntityKind,entityId:draft.ref.slice(colon+1)}
}
export default function PathChecksPanel({scene,disabled,floorId:initialFloor,onDraftChange,onPreview}:{
  scene:SceneDocument;disabled:boolean;floorId:string;onDraftChange:(dirty:boolean)=>void;onPreview:(commands:PathCheckCommand[],description:string)=>void
}) {
  const [selected,setSelected]=useState(''),[floorId,setFloorId]=useState(initialFloor)
  const [checkName,setCheckName]=useState('')
  const bounds=scene.floors[initialFloor].boundsMm
  const [from,setFrom]=useState<AnchorDraft>({ref:'point',x:String(bounds.x+Math.floor(bounds.width/4)),y:String(bounds.y+Math.floor(bounds.height/2))})
  const [to,setTo]=useState<AnchorDraft>({ref:'point',x:String(bounds.x+Math.floor(bounds.width*3/4)),y:String(bounds.y+Math.floor(bounds.height/2))})
  const [width,setWidth]=useState('1000'),[mode,setMode]=useState<PathCheck['mode']>('current'),[doors,setDoors]=useState<string[]>([])
  const [hint,setHint]=useState(''),[error,setError]=useState<string|null>(null),[dirty,setDirty]=useState(false),name=createEntityLabeler(scene)
  const changed=()=>{setDirty(true);onDraftChange(true);setError(null)}
  const endpoint=(label:string,value:AnchorDraft,set:(value:AnchorDraft)=>void)=><fieldset><legend>{label}</legend>
    <label>锚点<select aria-label={`通路${label}锚点`} value={value.ref} onChange={event=>{changed();set({...value,ref:event.target.value})}}>
      <option value="point">明确坐标</option>{Object.entries(collections).flatMap(([kind,collection])=>Object.values(scene[collection]).filter(entity=>entity.floorId===floorId).map(entity=><option key={kind+':'+entity.id} value={kind+':'+entity.id}>{name(entity.id)} · {entity.id}</option>))}
    </select></label>{value.ref==='point'&&<><label>X · mm<input aria-label={`通路${label}X`} type="number" step="1" value={value.x} onChange={event=>{changed();set({...value,x:event.target.value})}}/></label><label>Y · mm<input aria-label={`通路${label}Y`} type="number" step="1" value={value.y} onChange={event=>{changed();set({...value,y:event.target.value})}}/></label></>}
  </fieldset>
  return <details className="path-checks-panel"><summary>保持指定通路 · {scene.constraints.pathChecks.length}/{PATH_CHECK_LIMITS.checks}</summary>
    <p className="asset-muted">明确声明两端与净宽后，每次修改和重新打开均检查通路。未找到路线或搜索超预算时，修改不能采用。没有声明的草稿仍可编辑。</p>
    {scene.mapMode!=='scene'?<p>区域地图不支持场景通路声明。</p>:<fieldset disabled={disabled}>
      <label>已有声明<select aria-label="通路声明" disabled={dirty} value={selected} onChange={event=>{
        const id=event.target.value;setSelected(id);setError(null);onDraftChange(false)
        const check=scene.constraints.pathChecks.find(row=>row.id===id)
        setCheckName(check?.name??'')
        if(check){setFloorId(check.floorId);setFrom(anchorDraft(check.from));setTo(anchorDraft(check.to));setWidth(String(check.clearanceMm));setMode(check.mode);setDoors([...check.assumedOpenDoorIds]);setHint(check.routeHintMm?.map(p=>`${p.x},${p.y}`).join('\n')??'')}
      }}><option value="">新建通路声明</option>{scene.constraints.pathChecks.map((check,index)=><option key={check.id} value={check.id}>{check.name??`未命名通路 ${index+1}`} · {name(check.floorId)} · {check.clearanceMm} mm</option>)}</select></label>
      {selected&&<p className="asset-muted">声明ID：{selected}</p>}
      <label>通路名称 · 可选<input aria-label="通路名称" maxLength={PATH_CHECK_LIMITS.nameCharacters} placeholder="例如：前厅到祭坛" value={checkName} onChange={event=>{changed();setCheckName(event.target.value)}}/></label>
      <p className="asset-muted">名称随工程保存，便于选择和辨认阻断提示；留空可移除名称。名称不作为地图文字输出。</p>
      <label>通路所在楼层<select aria-label="通路所在楼层" value={floorId} onChange={event=>{changed();setFloorId(event.target.value);setFrom({...from,ref:'point'});setTo({...to,ref:'point'});setDoors([])}}>{Object.values(scene.floors).map(floor=><option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label>
      {endpoint('起点',from,setFrom)}{endpoint('终点',to,setTo)}
      <p className="asset-muted">实体使用实际位置或包围盒中心；阻挡物件自身不会被忽略。中心不是整数毫米时，请填写明确坐标。实体删除或跨楼层后须先调整声明。</p>
      <label>通路净宽 · mm<input aria-label="通路净宽" type="number" min="1" step="1" value={width} onChange={event=>{changed();setWidth(event.target.value)}}/></label>
      <label>检查模式<select aria-label="通路检查模式" value={mode} onChange={event=>{changed();setMode(event.target.value as PathCheck['mode']);setDoors([])}}><option value="current">当前通行 · 使用真实门状态</option><option value="structural">结构通行 · 假设门可解锁打开</option></select></label>
      <p className="asset-muted">门状态假设只用于本次检查，保留现场开闭、门锁及秘密。结构模式假设同楼层所有门可开启；水、物件和高差仍需真实通路。</p>
      {mode==='current'&&<fieldset><legend>额外假设可解锁打开的门</legend>{Object.values(scene.openings).filter(door=>door.floorId===floorId&&door.kind==='door').map(door=><label key={door.id}><input type="checkbox" aria-label={`通路假设门 ${door.id}`} checked={doors.includes(door.id)} onChange={event=>{changed();setDoors(event.target.checked?[...doors,door.id]:doors.filter(id=>id!==door.id))}}/>{name(door.id)} · {door.id}</label>)}</fieldset>}
      <label>可选路线提示 · 每行 x,y 毫米<textarea aria-label="通路路线提示" rows={4} value={hint} onChange={event=>{changed();setHint(event.target.value)}}/></label>
      <p className="asset-muted">2–128个整数点，首尾随锚点更新；提示会重新核对完整净宽，失效后寻找替代路线。坐标提示保留世界位置。</p>
      {error&&<p role="alert" className="asset-form-error">{error}</p>}
      <button className="secondary asset-wide" onClick={()=>{try{
        const routeHintMm=hint.trim()?hint.trim().split(/\r?\n/).map(line=>{if(!/^\s*-?\d+\s*,\s*-?\d+\s*$/.test(line))throw Error('路线提示每行须为两个整数毫米：x,y。');const [x,y]=line.split(',').map(Number);return{x,y}}):undefined
        const check=pathCheckSchema.parse({id:selected||crypto.randomUUID(),...(checkName.trim()?{name:checkName.trim()}:{}),floorId,from:anchorValue(from),to:anchorValue(to),clearanceMm:Number(width),mode,assumedOpenDoorIds:doors,...(routeHintMm?{routeHintMm}:{})})
        setError(null);onPreview([{type:'upsertPathCheck',check}],`${selected?'修改':'新增'}${check.name?`「${check.name}」 · `:''}${name(floorId)}的${check.clearanceMm} mm通路声明；${mode==='structural'?'假设同楼层门可解锁打开':`使用当前门状态，额外假设${doors.length}扇门可开启`}。后续修改须重新证明可通。`)
      }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}}}>预览通路声明</button>
      {selected&&<button className="secondary asset-wide" onClick={()=>onPreview([{type:'deletePathCheck',id:selected}],`移除通路声明「${scene.constraints.pathChecks.find(check=>check.id===selected)?.name??selected}」，后续修改不再要求保持这条通路。`)}>预览移除通路声明</button>}
    </fieldset>}
  </details>
}
