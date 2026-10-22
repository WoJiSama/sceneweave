import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Archive, Armchair, ArrowDownToLine, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, DoorOpen, Download, Eye, EyeOff, FileDown, FolderOpen, Gauge, Grid2X2, Hand, House, Layers, LoaderCircle, Lock, Map, MoreHorizontal, MousePointer2, Plus, Redo2, RotateCw, Search, Settings2, ShieldCheck, StickyNote, Undo2, Unlock, Upload, X, AlertTriangle } from 'lucide-react'
import CanvasView from './editor/CanvasView'
import { bootEditor, entityLabel, flushSave, listSnapshots, newHouse, openBenchmark, openNewDocument, propNames, reloadPersisted, retrySave, saveAsCopy, useEditorStore } from './editor/store'
import type { Selection } from './editor/store'
import { collectionFor } from './core/types'
import type { SceneDocument, Visibility } from './core/types'
import { validateScene } from './core/schema'
import { importProject, exportProject } from './io/project-file'
import { renderPng } from './rendering/png'
import { projectScene } from './rendering/projection'
import { getMetrics, resetMetrics } from './editor/metrics'
import AssetWorkbench from './editor/v2/AssetWorkbench'
import LayerWorkbench from './editor/v3/LayerWorkbench'
import HistoryWorkbench from './editor/v4/HistoryWorkbench'
import type { CompleteProjectV2 } from './io/v2/types'
import type { CompleteProjectV3 } from './io/v3/types'

function Logo({small=false}:{small?:boolean}) {
  return <svg width={small?27:32} height={small?27:32} viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M5 12 18 4l13 8v13l-13 8L5 25V12Z" stroke="currentColor" strokeWidth="1.4"/><path d="m5 12 13 8 13-8M18 20v13M11 8l13 8v12M25 8l-13 8v12" stroke="currentColor" strokeWidth="1.4"/></svg>
}
function IconButton({label,children,onClick,active,disabled=false}:{label:string;children:ReactNode;onClick?:()=>void;active?:boolean;disabled?:boolean}) {
  return <button className={`icon-button ${active?'active':''}`} type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}
function Toggle({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:()=>void;disabled?:boolean}) {
  return <button type="button" className={`switch ${checked?'on':''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange} disabled={disabled}><i/></button>
}
function NumericField({label,value,onCommit,unit='m',disabled=false,step=0.1}:{label:string;value:number;onCommit:(value:number)=>void;unit?:string;disabled?:boolean;step?:number}) {
  const [draft,setDraft]=useState(String(Number(value.toFixed(3))))
  useEffect(()=>setDraft(String(Number(value.toFixed(3)))),[value])
  const cancel=useRef(false)
  return <label className="numeric-field"><span>{label}</span><div><input type="number" aria-label={label} step={step} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){cancel.current=true;setDraft(String(value));e.currentTarget.blur()}}} onBlur={()=>{
    if(cancel.current){cancel.current=false;return}
    const n=Number(draft)
    if(draft.trim()!==''&&Number.isFinite(n)&&n!==value)onCommit(n)
    setDraft(String(Number(value.toFixed(3))))
  }}/><b>{unit}</b></div></label>
}
function VisibilityControl({visibility,onChange,disabled=false}:{visibility:Visibility;onChange:(v:Visibility)=>void;disabled?:boolean}) {
  return <div className="visibility-control"><button className={visibility==='public'?'selected':''} onClick={()=>onChange('public')} disabled={disabled}><Eye size={14}/>玩家可见</button><button className={visibility==='gm'?'selected secret':''} onClick={()=>onChange('gm')} disabled={disabled}><EyeOff size={14}/>仅主持人</button></div>
}
function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDivElement>(null)
  const closeRef=useRef(onClose)
  closeRef.current=onClose
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement
    const shell=document.querySelector('.app-shell') as HTMLElement|null
    if(shell)shell.inert=true
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape')closeRef.current()
      if(e.key==='Tab'){
        const items=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea:not(:disabled)')??[])
        const first=items[0],last=items[items.length-1]
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
        if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
      }
    }
    window.addEventListener('keydown',key)
    return ()=>{if(shell)shell.inert=false;window.removeEventListener('keydown',key);previous?.focus()}
  },[])
  return <div className="modal-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={ref} className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><IconButton label="关闭对话框" onClick={onClose}><X size={18}/></IconButton></div>{children}</div></div>
}

function LayerPanel() {
  const {document:scene,selection,select,audience}=useEditorStore()
  const [query,setQuery]=useState('')
  if(!scene)return null
  let playerProjection: ReturnType<typeof projectScene> | null=null
  if(audience==='player') {try{playerProjection=projectScene(scene,'player')}catch{/* Unsafe preview exposes no layer contents. */}}
  const row=(s:Selection,icon:ReactNode,sub?:string,privateItem=false)=>{
    let label=entityLabel(scene,s)
    if(audience==='player'&&s.kind==='room')label=Object.values(scene.notes).find(n=>n.kind==='label'&&n.anchor.type==='entity'&&n.anchor.entityId===s.id&&playerProjection?.notes.some(p=>p.id===n.id))?.text??'房间'
    if(audience==='player'&&s.kind==='opening')label='房门'
    if(query&&!`${label}${sub??''}`.includes(query))return null
    return <button key={`${s.kind}-${s.id}`} className={`entity-row ${selection?.id===s.id?'selected':''}`} onClick={()=>select(s)} aria-label={`选择${label}`}>
      <span className={`entity-icon ${privateItem?'secret':''}`}>{icon}</span><span className="entity-name"><span>{label}</span>{sub&&<small>{sub}</small>}</span>{privateItem?<EyeOff size={13} className="muted-gold"/>:scene[collectionFor[s.kind]][s.id]?.editLocked?<Lock size={12}/>:null}
    </button>
  }
  const rooms=Object.values(scene.rooms).filter(r=>audience==='gm'||playerProjection?.rooms.some(p=>p.id===r.id))
  const props=Object.values(scene.props).filter(p=>audience==='gm'||playerProjection?.props.some(item=>item.id===p.id))
  const notes=Object.values(scene.notes).filter(n=>n.kind!=='label'&&(audience==='gm'||playerProjection?.notes.some(p=>p.id===n.id)))
  return <aside className="layers-panel">
    <div className="panel-title"><h2>场景内容</h2><Layers size={16}/></div>
    <label className="layer-search"><Search size={14}/><input aria-label="搜索场景内容" placeholder="查找房间、物件…" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>/</kbd></label>
    <div className="floor-row"><span><ChevronDown size={13}/><Layers size={15}/>一层</span><span className="tiny-tag">平面</span></div>
    <div className="layer-scroll">
      {rooms.length>0&&<><div className="section-heading"><span>房间</span><span>{rooms.length.toString().padStart(2,'0')}</span></div>{rooms.map(r=>row({kind:'room',id:r.id},<House size={16}/>,r.visibility==='gm'?'隐藏空间':'可探索区域',r.visibility==='gm'))}</>}
      <div className="section-heading"><span>家具与物件</span><span>{props.length.toString().padStart(2,'0')}</span></div>
      {props.slice(0,query?60:8).map(p=>row({kind:'prop',id:p.id},<Armchair size={16}/>,p.footprintMm.width/1000+' × '+p.footprintMm.height/1000+' m',p.visibility==='gm'))}
      {props.length>8&&!query&&<p className="more-objects">另有 {props.length-8} 个物件，点击画布选择</p>}
      {Object.keys(scene.openings).length>0&&<><div className="section-heading"><span>墙与门</span><span>{audience==='gm'?Object.keys(scene.openings).length:playerProjection?.walls.reduce((n,w)=>n+w.openings.length,0)??0}</span></div>{Object.values(scene.openings).filter(o=>audience==='gm'||playerProjection?.walls.some(w=>w.openings.some(p=>p.id===o.id))).map(o=>row({kind:'opening',id:o.id},<DoorOpen size={16}/>,o.state==='open'?'已打开':'已关闭',o.secret&&!o.revealed))}{audience==='gm'&&scene.walls['w-6a']&&row({kind:'wall',id:'w-6a'},<Map size={16}/>, '两间房共用一份墙体')}</>}
      {notes.length>0&&<><div className="section-heading"><span>线索与注记</span><span>{notes.length}</span></div>{notes.map(n=>row({kind:'note',id:n.id},<StickyNote size={16}/>,n.discovered?'已发现':'待发现',n.visibility==='gm'))}</>}
    </div>
    <div className="layer-footnote"><span className="small-dot"/>所有改动保存在此浏览器</div>
  </aside>
}

function Inspector() {
  const {document:scene,selection,execute,audience,select}=useEditorStore()
  const [tab,setTab]=useState<'properties'|'secrets'>('properties')
  if(!scene)return null
  const entity=selection?scene[collectionFor[selection.kind]][selection.id]:undefined
  const locked=entity?.editLocked??false
  const entityTitle=selection&&entity?entityLabel(scene,selection):'场景概览'
  const prop=selection?.kind==='prop'?scene.props[selection.id]:undefined
  const room=selection?.kind==='room'?scene.rooms[selection.id]:undefined
  const opening=selection?.kind==='opening'?scene.openings[selection.id]:undefined
  const wall=selection?.kind==='wall'?scene.walls[selection.id]:undefined
  const note=selection?.kind==='note'?scene.notes[selection.id]:undefined
  const visibility=prop?.visibility??room?.visibility??note?.visibility
  const setVisibility=(v:Visibility)=>{
    if(!selection)return
    if(prop)execute([{type:'updateProp',id:prop.id,changes:{visibility:v}}],'更改物件可见性')
    if(room)execute([{type:'updateRoom',id:room.id,changes:{visibility:v}}],'更改房间可见性')
    if(note)execute([{type:'updateNote',id:note.id,changes:{visibility:v}}],'更改注记可见性')
  }
  return <aside className="inspector"><div className="inspector-tabs"><button className={tab==='properties'?'active':''} onClick={()=>setTab('properties')}>属性</button><button className={tab==='secrets'?'active':''} onClick={()=>setTab('secrets')}>主持人笔记<span className="tab-dot"/></button></div>
    <div className="inspector-scroll">
      {audience==='player'?<div className="preview-info"><div className="illustrated-shield"><ShieldCheck size={30}/></div><h3>玩家会看到的世界</h3><p>私密线索与隐藏空间已过滤。未揭示的暗门呈现为普通墙体。</p><div className="subtle-card"><Eye size={16}/><span>导出图片沿用此预览的内容规则。</span></div><button className="secondary full" onClick={()=>useEditorStore.getState().setAudience('gm')}>返回主持人编辑</button></div>:tab==='secrets'?<>
        <div className="inspector-heading"><span className="eyebrow">KEEPER'S NOTES</span><h3>藏在场景里的故事</h3><p>发现线索不会自动公开文字。</p></div>
        {Object.values(scene.notes).filter(n=>n.visibility==='gm').map(n=><button className="secret-note-card" key={n.id} onClick={()=>{select({kind:'note',id:n.id});setTab('properties')}}><span><StickyNote size={14}/>{n.title??'地点注记'}<EyeOff size={12}/></span><p>{n.text}</p><small>{n.discovered?'已发现':'仅主持人可见'}</small></button>)}
        <div className="hint-box"><Lock size={15}/><p>切换到玩家预览，检查故事的秘密是否妥善隐藏。</p></div>
      </>:<>
        <div className="inspector-heading"><span className="eyebrow">{prop?'SCENE OBJECT':room?'ROOM':opening?'PORTAL':note?'STORY NOTE':'SCENE DETAILS'}</span><div className="inspector-title-row"><h3>{entityTitle}</h3>{selection&&entity&&<IconButton label={locked?'解锁编辑':'锁定编辑'} active={locked} onClick={()=>execute([{type:'setEditLock',entityKind:selection.kind,id:selection.id,locked:!locked}],locked?'解锁对象':'锁定对象')}><span>{locked?<Lock size={15}/>:<Unlock size={15}/>}</span></IconButton>}</div><p>{prop?'原创符号物件 · 实际占地':room?'正交空间 · 墙体中心线边界':opening?'附着于墙的开口':note?'线索文字与公开状态单独控制':'单层调查场景 · 完整结构存档'}</p></div>
        {!selection&&<><div className="overview-grid"><div><strong>{Object.keys(scene.rooms).length}</strong><span>个房间</span></div><div><strong>{Object.keys(scene.props).length}</strong><span>件物品</span></div></div><p className="inspector-text">在画布或左侧列表选中对象，调整位置、状态和玩家可见性。</p>{scene.openings['o-c3']&&<button className="story-link" onClick={()=>select({kind:'opening',id:'o-c3'})}><BookOpen size={18}/><span>书架后面，还有什么？<small>查看暗门与密道设置</small></span><ChevronRight size={15}/></button>}</>}
        {locked&&<div className="inline-warning"><Lock size={14}/>已锁定编辑，解锁后可修改。</div>}
        {prop&&<>
          <div className="property-section"><h4>位置</h4><div className="two-fields"><NumericField label="X 坐标" value={prop.positionMm.x/1000} disabled={locked} onCommit={n=>execute([{type:'moveProp',id:prop.id,positionMm:{...prop.positionMm,x:Math.round(n*1000)}}],'调整家具位置')}/><NumericField label="Y 坐标" value={prop.positionMm.y/1000} disabled={locked} onCommit={n=>execute([{type:'moveProp',id:prop.id,positionMm:{...prop.positionMm,y:Math.round(n*1000)}}],'调整家具位置')}/></div></div>
          <div className="property-section"><h4>占地与朝向</h4><div className="two-fields"><NumericField label="宽度" value={prop.footprintMm.width/1000} disabled onCommit={()=>{}}/><NumericField label="深度" value={prop.footprintMm.height/1000} disabled onCommit={()=>{}}/></div><div className="rotation-row"><NumericField label="旋转角度" unit="°" value={prop.rotationDeg} step={15} disabled={locked} onCommit={n=>execute([{type:'updateProp',id:prop.id,changes:{rotationDeg:((n%360)+360)%360}}],'旋转家具')}/><IconButton label="顺时针旋转90度" disabled={locked} onClick={()=>execute([{type:'updateProp',id:prop.id,changes:{rotationDeg:(prop.rotationDeg+90)%360}}],'旋转家具')}><RotateCw size={16}/></IconButton></div></div>
          <div className="property-section"><h4>空间影响</h4><div className="property-toggle"><span>阻挡移动</span><Toggle label="物件阻挡移动" checked={prop.blocksMovement} disabled={locked} onChange={()=>execute([{type:'updateProp',id:prop.id,changes:{blocksMovement:!prop.blocksMovement}}],'修改阻挡标记')}/></div><div className="property-toggle"><span>阻挡视线</span><Toggle label="物件阻挡视线" checked={prop.blocksSight} disabled={locked} onChange={()=>execute([{type:'updateProp',id:prop.id,changes:{blocksSight:!prop.blocksSight}}],'修改阻挡标记')}/></div></div>
        </>}
        {room&&<><div className="property-section"><h4>空间尺寸</h4><div className="room-size-card">{(()=>{const points=room.boundaryVertexIds.map(id=>scene.vertices[id]);const width=Math.max(...points.map(p=>p.xMm))-Math.min(...points.map(p=>p.xMm));const height=Math.max(...points.map(p=>p.yMm))-Math.min(...points.map(p=>p.yMm));return <><strong>{width/1000} × {height/1000} <small>m</small></strong><span>中心线尺寸 · 墙厚 0.10 m</span></>})()}</div></div><div className="property-section"><h4>用途</h4><p className="inspector-text">{room.purpose}</p><div className="small-badge"><Check size={13}/>结构连接：{room.accessExpectation==='required'?'必须连通入口':'允许草稿'}</div>{room.visibility==='gm'&&<p className="inspector-text muted-gold">密道中心线宽 1.30 m，扣除两侧墙厚后净宽为 1.20 m。</p>}</div></>}
        {opening&&<><div className="property-section"><h4>开口位置</h4><div className="two-fields"><NumericField label="沿墙偏移" value={opening.offsetMm/1000} disabled={locked} onCommit={n=>execute([{type:'moveOpening',id:opening.id,offsetMm:Math.round(n*1000)}],'移动门的位置')}/><NumericField label="门洞宽度" value={opening.widthMm/1000} disabled={locked} onCommit={n=>execute([{type:'updateOpening',id:opening.id,changes:{widthMm:Math.round(n*1000)}}],'调整开口宽度')}/></div></div><div className="property-section"><h4>通行状态</h4><div className="property-toggle"><span>门已打开</span><Toggle label="门已打开" checked={opening.state==='open'} disabled={locked} onChange={()=>execute([{type:'updateOpening',id:opening.id,changes:{state:opening.state==='open'?'closed':'open'}}],'切换门的开关')}/></div><div className="property-toggle"><span>上锁</span><Toggle label="门已上锁" checked={opening.locked} disabled={locked} onChange={()=>execute([{type:'updateOpening',id:opening.id,changes:{locked:!opening.locked}}],'切换门锁')}/></div></div><div className="property-section"><h4>主持人秘密</h4><div className="property-toggle"><span>秘密门</span><Toggle label="秘密门" checked={opening.secret} disabled={locked} onChange={()=>execute([{type:'updateOpening',id:opening.id,changes:{secret:!opening.secret}}],'设置秘密门')}/></div>{opening.secret&&<><div className="property-toggle"><span>向玩家揭示位置</span><Toggle label="揭示秘密门" checked={opening.revealed} disabled={locked} onChange={()=>execute([{type:'updateOpening',id:opening.id,changes:{revealed:!opening.revealed}}],'揭示暗门位置')}/></div><p className="inspector-text">揭示门的位置后，密道与私密注记仍分别保持隐藏。</p></>}</div></>}
        {wall&&<><div className="property-section"><h4>共用墙线</h4>{(()=>{const a=scene.vertices[wall.startVertexId],b=scene.vertices[wall.endVertexId],vertical=a.xMm===b.xMm;return <NumericField label={vertical?'墙线 X 坐标':'墙线 Y 坐标'} value={(vertical?a.xMm:a.yMm)/1000} disabled={locked} onCommit={n=>execute([{type:'moveVertices',positions:{[a.id]:{x:vertical?Math.round(n*1000):a.xMm,y:vertical?a.yMm:Math.round(n*1000)},[b.id]:{x:vertical?Math.round(n*1000):b.xMm,y:vertical?b.yMm:Math.round(n*1000)}}}],'移动共用墙')}/>})()}<p className="inspector-text">相邻房间与附着的门一起更新；几何冲突时整次修改会被拒绝。</p><div className="small-badge">墙厚 {wall.thicknessMm/1000} m</div></div><button className="secondary full" disabled={locked} onClick={()=>execute([{type:'reverseWall',id:wall.id}],'反转墙体方向')}>反转墙体方向</button></>}
        {note&&<NoteFields key={note.id} scene={scene} id={note.id}/>}
        {visibility&&<div className="property-section"><h4>可见性</h4><VisibilityControl visibility={visibility} onChange={setVisibility} disabled={locked}/><p className="inspector-text">{visibility==='gm'?'这项内容只出现在主持人视图中。':'玩家图片会包含此对象；私密锚点上的文字仍会被过滤。'}</p></div>}
        <div className="inspector-tip"><MousePointer2 size={15}/><p>{prop?'拖动调整位置，按方向数值精确定位。一次操作可以完整撤销。':'先安排空间，再把故事藏进细节。'}</p></div>
      </>}
    </div>
    <div className="inspector-bottom"><ShieldCheck size={14}/><span>主持人掌握每一处秘密</span></div>
  </aside>
}
function NoteFields({scene,id}:{scene:SceneDocument;id:string}) {
  const note=scene.notes[id],execute=useEditorStore(s=>s.execute)
  const [text,setText]=useState(note.text)
  useEffect(()=>setText(note.text),[note.text])
  return <div className="property-section"><h4>线索内容</h4><textarea aria-label="注记内容" rows={5} value={text} disabled={note.editLocked} onChange={e=>setText(e.target.value)} onBlur={()=>{if(text!==note.text&&!execute([{type:'updateNote',id,changes:{text}}],'编辑线索文字'))setText(note.text)}}/><div className="property-toggle"><span>线索已发现</span><Toggle label="线索已发现" checked={note.discovered??false} disabled={note.editLocked} onChange={()=>execute([{type:'updateNote',id,changes:{discovered:!note.discovered}}],'记录线索发现状态')}/></div></div>
}

const downloadBlob=(blob:Blob,filename:string)=>{
  const url=URL.createObjectURL(blob),a=document.createElement('a')
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30_000)
}
type Dialog='export'|'help'|'lab'|'history'|'reload'|null
function GeometryApp({onOpenAssets}:{onOpenAssets:()=>void}) {
  const state=useEditorStore(),{document:scene,save,history,audience,tool,grid}=state
  const [dialog,setDialog]=useState<Dialog>(null),[busy,setBusy]=useState(false)
  const [candidate,setCandidate]=useState<SceneDocument|null>(null)
  const [snapshots,setSnapshots]=useState<SceneDocument[]>([])
  const [exportAudience,setExportAudience]=useState<'gm'|'player'>('player'),[exportEdge,setExportEdge]=useState(4096),[exportGrid,setExportGrid]=useState(true),[exportLabels,setExportLabels]=useState(true)
  const file=useRef<HTMLInputElement>(null)
  const notify=state.notify
  useEffect(()=>{void bootEditor()},[])
  useEffect(()=>{
    // Dev-only instrumentation points at the live editor instance, including after Vite HMR.
    if(import.meta.env.DEV)(window as unknown as Record<string,unknown>).__sceneweaveDev={store:useEditorStore,openBenchmark,flushSave,getMetrics,resetMetrics}
  })
  useEffect(()=>{
    if(!state.message)return
    const timer=setTimeout(()=>state.clearMessage(),state.message.kind==='error'?9000:5000)
    return ()=>clearTimeout(timer)
  },[state.message])
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')||document.querySelector('[role="dialog"]'))return
      if(useEditorStore.getState().audience==='player'&&(e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase()))return
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?state.redo():state.undo()}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();state.redo()}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void flushSave().then(()=>notify('当前修改已保存在此浏览器。')).catch(e=>notify(String(e.message),'error'))}
      else if(e.key.toLowerCase()==='v')state.setTool('select')
      else if(e.key.toLowerCase()==='h')state.setTool('pan')
      else if(e.key.toLowerCase()==='g')state.toggleGrid()
      else if(e.key==='/'){e.preventDefault();document.querySelector<HTMLInputElement>('[aria-label="搜索场景内容"]')?.focus()}
    }
    const unload=(e:BeforeUnloadEvent)=>{if(useEditorStore.getState().save.status!=='saved'){e.preventDefault();e.returnValue=''}}
    window.addEventListener('keydown',key);window.addEventListener('beforeunload',unload)
    return ()=>{window.removeEventListener('keydown',key);window.removeEventListener('beforeunload',unload)}
  },[state.undo,state.redo])
  const attempt=async(action:()=>Promise<unknown>)=>{try{setBusy(true);await action()}catch(e){notify(e instanceof Error?e.message:String(e),'error')}finally{setBusy(false)}}
  const backup=()=>{if(scene)void attempt(async()=>{downloadBlob(await exportProject(scene),'sceneweave-gm-project.sceneweave');notify('主持人工程已生成，包含完整场景与私密线索。')})}
  const exportImage=()=>{if(scene)void attempt(async()=>{
    const result=await renderPng(scene,exportAudience,{longEdge:exportEdge,grid:exportGrid,labels:exportLabels})
    downloadBlob(result.blob,exportAudience==='player'?'sceneweave-player-map.png':'sceneweave-gm-map.png')
    setDialog(null);notify(`已生成${exportAudience==='player'?'玩家':'主持人'} PNG · ${result.width} × ${result.height} · ${(result.durationMs/1000).toFixed(2)} 秒 · 来源 r${result.sourceRevision}`)
  })}
  const showHistory=()=>void attempt(async()=>{setSnapshots(await listSnapshots());setDialog('history')})
  const savedLabel={saved:'本地已保存',saving:'正在保存',unsaved:'等待保存',error:'保存失败',conflict:'存在版本冲突'}[save.status]
  return <>
    <div className="app-shell" data-revision={scene?.revision}>
      <nav className="app-rail" aria-label="主导航"><div className="rail-logo" title="织境 Sceneweave"><Logo/></div><button className="rail-item active" aria-label="场景工坊"><Map size={22}/><span>场景</span></button><button className="rail-item" aria-label="素材工坊" disabled={busy} onClick={()=>void attempt(async()=>{const before=useEditorStore.getState().document;await flushSave();const after=useEditorStore.getState().document;if(before?.sceneId!==after?.sceneId||before?.revision!==after?.revision)throw new Error('保存期间场景已有修改，请重新打开素材工坊。');onOpenAssets()})}><Layers size={20}/><span>素材</span></button><button className="rail-item" aria-label="历史快照" onClick={showHistory}><Archive size={20}/><span>快照</span></button><div className="rail-spacer"/><button className="rail-item" aria-label="技术验证面板" onClick={()=>setDialog('lab')}><Gauge size={20}/><span>实验</span></button><button className="rail-help" aria-label="使用说明" title="使用说明" onClick={()=>setDialog('help')}><CircleHelp size={21}/></button><div className="rail-avatar" title="本地主持人">GM</div></nav>
      <div className="app-main">
        <header className="topbar"><div className="brand-title"><span>织境</span><b>Sceneweave</b><span className="prototype-tag">M0 原型</span></div><div className="topbar-right"><span className={`save-indicator ${save.status}`} role="status">{save.status==='saved'?<CheckCircle2 size={14}/>:save.status==='saving'?<LoaderCircle className="spin" size={14}/>:<span className="small-dot"/>}{savedLabel}</span><span className="topbar-divider"/><button className="text-button" onClick={()=>file.current?.click()} disabled={busy}><Upload size={15}/>打开工程</button><button className="text-button" onClick={backup} disabled={busy||!scene}><FileDown size={15}/>主持人工程</button><button className="primary export-main" onClick={()=>{setExportAudience('player');setExportGrid(grid);setDialog('export')}} disabled={busy||!scene}><ArrowDownToLine size={16}/>导出地图<ChevronDown size={13}/></button></div></header>
        <div className="document-bar"><div className="breadcrumb"><FolderOpen size={15}/><span>我的场景</span><ChevronRight size={13}/><h1>{scene?.title??'正在打开场景'}</h1><span className="document-format">调查场景</span></div><div className="document-actions"><button className="text-button muted" onClick={()=>void attempt(newHouse)} disabled={busy}><Plus size={15}/>新建样例</button><IconButton label="另存场景副本" onClick={()=>void attempt(()=>saveAsCopy())} disabled={busy||!scene}><Copy size={16}/></IconButton><IconButton label="使用说明" onClick={()=>setDialog('help')}><MoreHorizontal size={18}/></IconButton></div></div>
        {(save.status==='conflict'||save.status==='error')&&<div className="storage-banner" role="alert"><AlertTriangle size={16}/><span>{save.status==='conflict'?'另一标签已保存此场景。这里的修改已保留，自动写入已暂停。':`本地保存失败：${save.error??'浏览器存储不可用'}。当前修改仍在内存中。`}</span><button onClick={backup}>下载备份</button><button onClick={()=>void attempt(()=>saveAsCopy())}>另存副本</button>{save.status==='error'?<button onClick={retrySave}>重试</button>:<button onClick={()=>setDialog('reload')}>载入最新版本</button>}</div>}
        <div className="editor-workspace"><LayerPanel/><main className="center-panel" aria-label="地图编辑区"><div className="canvas-toolbar"><div className="tool-cluster"><IconButton label="选择工具 V" active={tool==='select'} onClick={()=>state.setTool('select')}><MousePointer2 size={17}/></IconButton><IconButton label="平移工具 H" active={tool==='pan'} onClick={()=>state.setTool('pan')}><Hand size={17}/></IconButton><span className="toolbar-divider"/><IconButton label={history?.canUndo?`撤销 ${history.undoLabel??''}`:'撤销'} onClick={state.undo} disabled={audience==='player'||!history?.canUndo}><Undo2 size={17}/></IconButton><IconButton label={history?.canRedo?`重做 ${history.redoLabel??''}`:'重做'} onClick={state.redo} disabled={audience==='player'||!history?.canRedo}><Redo2 size={17}/></IconButton><span className="toolbar-divider"/><IconButton label="显示网格 G" active={grid} onClick={state.toggleGrid}><Grid2X2 size={17}/></IconButton></div><div className="audience-switch" aria-label="视图"><button className={audience==='gm'?'active':''} onClick={()=>state.setAudience('gm')}><Eye size={14}/>主持人</button><button className={audience==='player'?'active':''} onClick={()=>state.setAudience('player')}><ShieldCheck size={14}/>玩家预览</button></div></div><CanvasView/></main><Inspector/></div>
        <footer className="statusbar"><div><span className="small-dot green"/><span>本地工坊</span><b>·</b><span>毫米精度</span><b>·</b><span>吸附 {scene?.units.snapMm??100} mm</span></div><div><span data-testid="document-revision">r{scene?.revision??0}</span><span className="status-divider"/><button onClick={()=>{if(scene){const r=validateScene(scene);notify(r.ok?'场景校验通过：引用、墙门关系与几何结构有效。':r.errors.map(e=>e.message).join('；'),r.ok?'info':'error')}}}><CheckCircle2 size={12}/>校验场景</button><span className="status-divider"/><span>0.1 · 单层原型</span></div></footer>
      </div>
    </div>
    <input type="file" accept=".sceneweave" ref={file} hidden aria-label="选择主持人工程" onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void attempt(async()=>{setCandidate(await importProject(selected))})}}/>
    {state.message&&<div className={`toast ${state.message.kind}`} role={state.message.kind==='error'?'alert':'status'}>{state.message.kind==='error'?<AlertTriangle size={17}/>:<CheckCircle2 size={17}/>}<span>{state.message.text}</span><button aria-label="关闭提示" onClick={state.clearMessage}><X size={14}/></button></div>}
    {dialog==='export'&&<Modal title="把场景带到桌上" onClose={()=>{if(!busy)setDialog(null)}}><p className="modal-intro">导出一张图片，让故事从这里开始。</p><div className="export-audiences"><button className={exportAudience==='player'?'chosen':''} onClick={()=>setExportAudience('player')}><ShieldCheck size={23}/><strong>玩家地图</strong><small>隐藏秘密与主持人线索</small>{exportAudience==='player'&&<CheckCircle2 size={16}/>}</button><button className={exportAudience==='gm'?'chosen':''} onClick={()=>setExportAudience('gm')}><Eye size={23}/><strong>主持人地图</strong><small>包含密道、暗门与私密标记</small>{exportAudience==='gm'&&<CheckCircle2 size={16}/>}</button></div><div className="export-form"><label>图片尺寸<select aria-label="图片尺寸" value={exportEdge} onChange={e=>setExportEdge(Number(e.target.value))}><option value={2048}>2K · 长边 2048 px</option><option value={4096}>4K · 长边 4096 px</option></select></label><div className="property-toggle"><span>绘制方格</span><Toggle label="导出绘制方格" checked={exportGrid} onChange={()=>setExportGrid(!exportGrid)}/></div><div className="property-toggle"><span>绘制地点标签与标记</span><Toggle label="导出绘制标签" checked={exportLabels} onChange={()=>setExportLabels(!exportLabels)}/></div></div><div className={`hint-box ${exportAudience==='gm'?'warm':''}`}><ShieldCheck size={17}/><p>{exportAudience==='player'?'沿用玩家预览的内容规则，PNG 不包含可编辑工程或私密元数据。':'主持人地图含剧情秘密，请仅保存自用。完整线索正文保存在主持人工程中。'}</p></div><div className="modal-actions"><button className="secondary" onClick={()=>{state.setAudience(exportAudience);setDialog(null)}} disabled={busy}>先查看预览</button><button className="primary" onClick={exportImage} disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}生成 PNG</button></div></Modal>}
    {candidate&&<Modal title="打开主持人工程" onClose={()=>{if(!busy)setCandidate(null)}}><div className="import-summary"><FolderOpen size={32}/><h3>{candidate.title}</h3><p>{Object.keys(candidate.rooms).length} 个房间 · {Object.keys(candidate.props).length} 个物件 · 单层几何工程</p></div><div className="hint-box warm"><Lock size={16}/><p>这个文件可能包含主持人的剧情秘密。将作为新场景打开，现有场景保留在此浏览器中。</p></div><div className="modal-actions"><button className="secondary" disabled={busy} onClick={()=>setCandidate(null)}>取消</button><button className="primary" disabled={busy} onClick={()=>void attempt(async()=>{await openNewDocument(candidate);setCandidate(null);notify('工程已作为新场景打开。')})}><FolderOpen size={16}/>打开副本</button></div></Modal>}
    {dialog==='help'&&<Modal title="欢迎来到织境" onClose={()=>setDialog(null)}><div className="welcome-brand"><Logo/><span>把故事画成可以探索的地方。</span></div><p className="modal-intro">当前提供一份简化雾灯宅，供你验证场景编辑与出图流程。</p><ol className="help-steps"><li><span>01</span><div><strong>调整你的场景</strong><p>选中家具拖动，或在属性中输入位置。共用墙与门的位置也可调整。</p></div></li><li><span>02</span><div><strong>安排秘密与线索</strong><p>打开书架暗门属性或主持人笔记。发现、揭示位置与公开文字是独立操作。</p></div></li><li><span>03</span><div><strong>预览、备份与出图</strong><p>修改自动保存在浏览器。下载主持人工程作备份，将玩家 PNG 带到跑团桌上。</p></div></li></ol><div className="shortcut-grid"><span><kbd>V</kbd>选择</span><span><kbd>H</kbd>平移</span><span><kbd>G</kbd>网格</span><span><kbd>0</kbd>适应画布</span><span><kbd>⌘ Z</kbd>撤销</span><span><kbd>Esc</kbd>取消拖动</span></div><p className="fine-print">这是技术原型。房间自由绘制、外部素材、AI 辅助与 VTT 导出将在后续阶段提供。首次加载需要本地开发服务，尚无 PWA 离线冷启动。</p><div className="modal-actions"><button className="primary" onClick={()=>setDialog(null)}>开始探索<ChevronRight size={15}/></button></div></Modal>}
    {dialog==='lab'&&<Modal title="M0 技术验证" onClose={()=>setDialog(null)}><p className="modal-intro">负载场景使用原创程序符号，不包含图片纹理。打开新负载前会先保存当前场景。</p><div className="lab-cards"><button onClick={()=>void attempt(async()=>{await openBenchmark(500);setDialog(null)})} disabled={busy}><Gauge size={21}/><strong>500 个物件</strong><span>50 × 50 格 · 基线</span></button><button onClick={()=>void attempt(async()=>{await openBenchmark(2000);setDialog(null)})} disabled={busy}><Gauge size={21}/><strong>2000 个物件</strong><span>50 × 50 格 · 压力</span></button></div><div className="hint-box"><Clock3 size={16}/><p>性能报告区分绘制、交互帧间隔、事务与存储耗时。此面板仅切换负载，不自动判定性能通过。</p></div><p className="fine-print">M0 工程仅支持单层几何与内置符号，ZIP 压缩上限 5 MiB。完整纹理、空间路线检查与其他浏览器仍待验证。</p><div className="modal-actions"><button className="secondary" onClick={()=>void attempt(async()=>{await newHouse();setDialog(null)})}>打开雾灯宅样例</button><button className="primary" onClick={()=>setDialog(null)}>返回工坊</button></div></Modal>}
    {dialog==='history'&&<Modal title="本地历史快照" onClose={()=>setDialog(null)}><p className="modal-intro">保留最近 20 次成功保存。恢复会创建副本，当前工程保持原样。</p><div className="snapshot-list">{snapshots.length?snapshots.map(s=><div className="snapshot-row" key={s.revision}><Clock3 size={16}/><div><strong>修订 r{s.revision}</strong><small>{new Date(s.updatedAt).toLocaleString('zh-CN')}</small></div><button className="secondary small" onClick={()=>void attempt(async()=>{await saveAsCopy(s);setDialog(null)})}>恢复为副本</button></div>):<p className="empty-state">当前场景尚无成功保存的快照。</p>}</div><div className="modal-actions"><button className="primary" onClick={()=>setDialog(null)}>完成</button></div></Modal>}
    {dialog==='reload'&&<Modal title="载入最新本地版本" onClose={()=>setDialog(null)}><p className="modal-intro">此标签尚未保存的修改会被替换。建议先下载主持人工程，或另存为副本保留当前分支。</p><div className="modal-actions"><button className="secondary" onClick={backup}>先下载当前工程</button><button className="primary" onClick={()=>void attempt(async()=>{await reloadPersisted();setDialog(null);notify('已载入最新的本地完整快照。')})}>放弃本地分支并载入</button></div></Modal>}
  </>
}

export default function App() {
  const readMode = () => window.location.hash === '#history' ? 'history' : window.location.hash === '#layers' ? 'layers' : window.location.hash === '#assets' ? 'assets' : 'geometry'
  const [mode, setMode] = useState(readMode), [layerSource, setLayerSource] = useState<CompleteProjectV2 | null>(null), [historySource, setHistorySource] = useState<CompleteProjectV3 | null>(null)
  useEffect(() => { const change = () => { setLayerSource(null); setHistorySource(null); setMode(readMode()) }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [])
  const open = (value: string) => { window.history.replaceState(null, '', value === 'geometry' ? window.location.pathname : `#${value}`); setMode(value) }
  return mode === 'history' ? <HistoryWorkbench source={historySource} onBack={() => { setHistorySource(null); open('layers') }}/>
    : mode === 'layers' ? <LayerWorkbench source={layerSource} onBack={() => { setLayerSource(null); open('assets') }} onOpenHistory={source => { setHistorySource(source); setLayerSource(null); open('history') }}/>
    : mode === 'assets' ? <AssetWorkbench onBack={() => open('geometry')} onOpenLayers={source => { setLayerSource(source); open('layers') }}/>
      : <GeometryApp onOpenAssets={() => open('assets')}/>
}
