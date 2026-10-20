import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Layer, Line, Rect, Stage, Shape, Circle } from 'react-konva'
import type Konva from 'konva'
import { Maximize, Minus, Plus, Hand, ShieldCheck } from 'lucide-react'
import { projectScene } from '../rendering/projection'
import { drawProjection } from '../rendering/draw'
import { openingEndpoints } from '../core/geometry'
import type { PointMm, SceneDocument, Prop } from '../core/types'
import { entityLabel, useEditorStore } from './store'
import type { Selection } from './store'
import { recordPaint } from './metrics'

const inside = (p: PointMm, polygon: PointMm[]) => {
  let hit = false
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i], b=polygon[j]
    if ((a.y>p.y)!==(b.y>p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit=!hit
  }
  return hit
}
const inProp = (point: PointMm, prop: Prop) => {
  const r=-prop.rotationDeg*Math.PI/180, x=point.x-prop.positionMm.x, y=point.y-prop.positionMm.y
  return Math.abs(x*Math.cos(r)-y*Math.sin(r))<=prop.footprintMm.width/2 && Math.abs(x*Math.sin(r)+y*Math.cos(r))<=prop.footprintMm.height/2
}
const distance = (p: PointMm, a: PointMm, b: PointMm) => {
  const dx=b.x-a.x,dy=b.y-a.y
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)))
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
}
function hitEntity(scene: SceneDocument, p: PointMm): Selection | null {
  const props=Object.values(scene.props).reverse()
  const prop=props.find(v=>v.symbol!=='rug' && inProp(p,v)) ?? props.find(v=>inProp(p,v))
  if (prop) return { kind:'prop',id:prop.id }
  for (const o of Object.values(scene.openings)) if (distance(p,...openingEndpoints(scene,o))<250) return {kind:'opening',id:o.id}
  for (const w of Object.values(scene.walls)) {
    const a=scene.vertices[w.startVertexId],b=scene.vertices[w.endVertexId]
    if (distance(p,{x:a.xMm,y:a.yMm},{x:b.xMm,y:b.yMm})<180) return {kind:'wall',id:w.id}
  }
  for (const room of Object.values(scene.rooms)) if (inside(p,room.boundaryVertexIds.map(id=>({x:scene.vertices[id].xMm,y:scene.vertices[id].yMm})))) return {kind:'room',id:room.id}
  return null
}

type View = { x: number; y: number; scale: number }
type Gesture = { kind:'pan'; start:PointMm; view:View } | {kind:'prop'; id:string; start:PointMm; original:PointMm; current:PointMm; baseRevision:number}

export default function CanvasView() {
  const { document: scene,audience,tool,selection,grid,select,execute }=useEditorStore()
  const holder=useRef<HTMLDivElement>(null), stage=useRef<Konva.Stage>(null)
  const gesture=useRef<Gesture|null>(null)
  const [size,setSize]=useState({width:800,height:650})
  const [view,setView]=useState<View>({x:0,y:0,scale:0.04})
  const [preview,setPreview]=useState<{id:string;positionMm:PointMm}|null>(null)
  const [space,setSpace]=useState(false)
  const [coords,setCoords]=useState<PointMm|null>(null)
  useEffect(()=>{
    const el=holder.current
    if (!el) return
    const observer=new ResizeObserver(([e])=>setSize({width:Math.round(e.contentRect.width),height:Math.round(e.contentRect.height)}))
    observer.observe(el)
    return ()=>observer.disconnect()
  },[])
  const fit=()=>{
    if (!scene) return
    const b=scene.exportBoundsMm
    const scale=Math.min((size.width-70)/b.width,(size.height-95)/b.height)
    setView({x:(size.width-b.width*scale)/2-b.x*scale,y:(size.height-b.height*scale)/2-b.y*scale,scale})
  }
  useEffect(()=>{ fit(); setPreview(null); gesture.current=null },[scene?.sceneId,size.width,size.height]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(gesture.current?.kind==='prop'){gesture.current=null;setPreview(null)}},[scene?.revision])
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return
      if (e.code==='Space') {e.preventDefault();setSpace(true)}
      if (e.key==='Escape') {gesture.current=null;setPreview(null)}
      if (e.key==='0') fit()
    }
    const up=(e:KeyboardEvent)=>{if(e.code==='Space')setSpace(false)}
    const blur=()=>{setSpace(false);gesture.current=null;setPreview(null)}
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur)
    return ()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur)}
  },[scene?.sceneId,size.width,size.height])
  const { projection,error }=useMemo(()=>{
    if (!scene) return {projection:null,error:null}
    try { return {projection:projectScene(scene,audience),error:null} }
    catch(e) { return {projection:null,error:e instanceof Error?e.message:'玩家投影生成失败'} }
  },[scene,audience])
  const drawn=useMemo(()=>projection&&preview?{...projection,props:projection.props.map(p=>p.id===preview.id?{...p,positionMm:preview.positionMm}:p)}:projection,[projection,preview])
  const pointer=()=>stage.current?.getPointerPosition()??{x:0,y:0}
  const world=(p=pointer()):PointMm=>({x:(p.x-view.x)/view.scale,y:(p.y-view.y)/view.scale})
  const zoom=(factor:number,at={x:size.width/2,y:size.height/2})=>{
    const scale=Math.min(0.45,Math.max(0.003,view.scale*factor)), p=world(at)
    setView({scale,x:at.x-p.x*scale,y:at.y-p.y*scale})
  }
  const finish=()=>{
    const g=gesture.current
    gesture.current=null
    if(g?.kind==='prop'&&scene&&g.baseRevision===scene.revision) {
      const snap=scene.units.snapMm
      const p={x:Math.round(g.current.x/snap)*snap,y:Math.round(g.current.y/snap)*snap}
      if(p.x!==g.original.x||p.y!==g.original.y) execute([{type:'moveProp',id:g.id,positionMm:p}],'移动家具')
    }
    setPreview(null)
  }
  const finishRef=useRef(finish)
  finishRef.current=finish
  useEffect(()=>{
    const up=()=>finishRef.current()
    const cancel=()=>{gesture.current=null;setPreview(null)}
    window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel)
    return()=>{window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel)}
  },[])
  const selectedProp=selection?.kind==='prop'&&scene?scene.props[selection.id]:null
  const selectedRoom=selection?.kind==='room'&&scene?scene.rooms[selection.id]:null
  const selectedWall=selection?.kind==='wall'&&scene?scene.walls[selection.id]:null
  const selectedOpening=selection?.kind==='opening'&&scene?scene.openings[selection.id]:null
  const selectedPosition=selectedProp && preview?.id===selectedProp.id?preview.positionMm:selectedProp?.positionMm
  const outline=selectedRoom&&scene?selectedRoom.boundaryVertexIds.flatMap(id=>[scene.vertices[id].xMm,scene.vertices[id].yMm]):null
  const wallLine=selectedWall&&scene?[scene.vertices[selectedWall.startVertexId].xMm,scene.vertices[selectedWall.startVertexId].yMm,scene.vertices[selectedWall.endVertexId].xMm,scene.vertices[selectedWall.endVertexId].yMm]:null
  const openingLine=selectedOpening&&scene?openingEndpoints(scene,selectedOpening).flatMap(p=>[p.x,p.y]):null
  return <div className={`canvas-surface ${tool==='pan'||space||audience==='player'?'is-pan':''}`} ref={holder} data-testid="scene-canvas" data-scale={view.scale} data-view-x={view.x} data-view-y={view.y}>
    <div className="canvas-caption"><span className="floor-chip">1F</span><span>一层平面</span><span className="caption-separator"/><span>{scene?.units.gridSizeMm===1524?'5 ft':'自定义'} 方格</span></div>
    {audience==='player'&&<div className="player-preview-pill"><ShieldCheck size={14}/>玩家预览 · 编辑已暂停</div>}
    {error?<div className="canvas-error" role="alert"><ShieldCheck size={28}/><strong>暂时无法生成安全的玩家视图</strong><p>{error}</p><button onClick={()=>useEditorStore.getState().setAudience('gm')}>返回主持人视图</button></div>:<Stage ref={stage} width={size.width} height={size.height}
      onContextMenu={e=>e.evt.preventDefault()}
      onWheel={e=>{e.evt.preventDefault();zoom(Math.exp(-e.evt.deltaY*0.0015),pointer())}}
      onPointerDown={e=>{
        if(!scene)return
        const p=pointer()
        const target=e.evt.target as HTMLElement
        if('setPointerCapture' in target) target.setPointerCapture(e.evt.pointerId)
        if(tool==='pan'||space||audience==='player'||e.evt.button===1) {gesture.current={kind:'pan',start:p,view};return}
        const hit=hitEntity(scene,world(p));select(hit)
        if(hit?.kind==='prop'&&!scene.props[hit.id].editLocked) {
          const original=scene.props[hit.id].positionMm
          gesture.current={kind:'prop',id:hit.id,start:world(p),original,current:original,baseRevision:scene.revision}
        }
      }}
      onPointerMove={()=>{
        const p=pointer(),w=world(p);setCoords(w)
        const g=gesture.current
        if(g?.kind==='pan')setView({...g.view,x:g.view.x+p.x-g.start.x,y:g.view.y+p.y-g.start.y})
        else if(g?.kind==='prop'){
          g.current={x:Math.round(g.original.x+w.x-g.start.x),y:Math.round(g.original.y+w.y-g.start.y)}
          setPreview({id:g.id,positionMm:g.current})
        }
      }}
      onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;setPreview(null)}}>
      <Layer listening={false}>
        <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
          {scene&&<Rect x={scene.exportBoundsMm.x} y={scene.exportBoundsMm.y} width={scene.exportBoundsMm.width} height={scene.exportBoundsMm.height} fill="#e8dfca" shadowColor="#45513a" shadowBlur={280} shadowOpacity={0.12} shadowOffsetY={70}/>}
          {drawn&&<Shape sceneFunc={ctx=>{const start=performance.now();drawProjection(ctx._context,drawn,{grid,labels:true});recordPaint(performance.now()-start)}}/>}
          {scene&&<Rect x={scene.exportBoundsMm.x} y={scene.exportBoundsMm.y} width={scene.exportBoundsMm.width} height={scene.exportBoundsMm.height} stroke="#9f9785" strokeWidth={1/view.scale} dash={[4/view.scale,5/view.scale]}/>}
          {audience==='gm'&&selectedProp&&selectedPosition&&<Group x={selectedPosition.x} y={selectedPosition.y} rotation={selectedProp.rotationDeg}>
            <Rect x={-selectedProp.footprintMm.width/2-50} y={-selectedProp.footprintMm.height/2-50} width={selectedProp.footprintMm.width+100} height={selectedProp.footprintMm.height+100} stroke="#92713c" strokeWidth={1.5/view.scale}/>
            {[-1,1].flatMap(x=>[-1,1].map(y=><Rect key={`${x},${y}`} x={x*(selectedProp.footprintMm.width/2+50)-3/view.scale} y={y*(selectedProp.footprintMm.height/2+50)-3/view.scale} width={6/view.scale} height={6/view.scale} fill="#fffaf0" stroke="#92713c" strokeWidth={1/view.scale}/>))}
            <Line points={[0,-selectedProp.footprintMm.height/2-50,0,-selectedProp.footprintMm.height/2-18/view.scale]} stroke="#92713c" strokeWidth={1/view.scale}/>
            <Circle x={0} y={-selectedProp.footprintMm.height/2-18/view.scale} radius={3/view.scale} fill="#fffaf0" stroke="#92713c" strokeWidth={1/view.scale}/>
          </Group>}
          {audience==='gm'&&outline&&<Line points={outline} closed stroke="#9b743a" strokeWidth={2/view.scale} dash={[5/view.scale,4/view.scale]}/>}
          {audience==='gm'&&(wallLine||openingLine)&&<Line points={(wallLine||openingLine)!} stroke="#c08d3e" strokeWidth={5/view.scale} opacity={0.65}/>}
        </Group>
      </Layer>
    </Stage>}
    <div className="canvas-bottom-left"><div className="scale-key"><i style={{width:Math.max(24,2000*view.scale)}}/><span>2 m</span></div><span>{audience==='player'?'仅呈现玩家可见内容':selection&&scene?`已选择 ${entityLabel(scene,selection)}`:'点击对象选择 · 拖动家具调整位置'}</span></div>
    <div className="zoom-control"><button aria-label="缩小" title="缩小" onClick={()=>zoom(1/1.2)}><Minus size={15}/></button><span>{Math.round(view.scale/0.05*100)}%</span><button aria-label="放大" title="放大" onClick={()=>zoom(1.2)}><Plus size={15}/></button><b/><button aria-label="适应画布" title="适应画布 · 0" onClick={fit}><Maximize size={15}/></button></div>
    <div className="canvas-coordinates">{coords?`X ${(coords.x/1000).toFixed(2)}　Y ${(coords.y/1000).toFixed(2)} m`:<><Hand size={12}/> 空格拖动画布 · 滚轮缩放</>}</div>
  </div>
}
