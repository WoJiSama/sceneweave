import type { TerrainCompositionInput, TerrainCompositionPlan } from '../../../shared/terrain-generation/composition-field.js'
import { captureJson } from '../../../shared/validation/json.js'
/** One worker per candidate; cancellation terminates work and discards every late result. */
export function computeTerrainComposition(input:TerrainCompositionInput,signal:AbortSignal):Promise<TerrainCompositionPlan>{
 return new Promise((resolve,reject)=>{
  signal.throwIfAborted()
  const worker=new Worker(new URL('./composition-worker.ts',import.meta.url),{type:'module'}),timer=setTimeout(()=>finish(new Error('地貌组合计算超过30秒，当前工程保持。')),30000)
  let settled=false
  const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate()}
  const finish=(error:unknown,value?:TerrainCompositionPlan)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve(value!)}
  const abort=()=>finish(new DOMException('已取消地貌组合。','AbortError'))
  signal.addEventListener('abort',abort,{once:true})
  worker.onmessage=event=>{
   try{signal.throwIfAborted();const value=captureJson(event.data) as {ok?:unknown;plan?:TerrainCompositionPlan;error?:unknown}
    if(value.ok!==true||!value.plan)throw new Error(typeof value.error==='string'?value.error:'组合计算响应无效。')
    finish(null,value.plan)
   }catch(error){finish(error)}
  }
  worker.onerror=event=>finish(new Error(event.message||'地貌组合计算中断。'))
  worker.onmessageerror=()=>finish(new Error('地貌组合响应无法解码。'))
  try{worker.postMessage(captureJson(input))}catch(error){finish(error)}
 })
}
