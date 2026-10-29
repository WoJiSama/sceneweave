import { planTerrainComposition } from '../../../shared/terrain-generation/composition-field.js'
import { captureJson } from '../../../shared/validation/json.js'
const scope=globalThis as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(value:unknown)=>void;close:()=>void}
if(typeof document==='undefined'&&typeof scope.postMessage==='function'&&typeof scope.close==='function'){
 let used=false
 scope.onmessage=event=>{if(used)return;used=true;try{scope.postMessage({ok:true,plan:planTerrainComposition(captureJson(event.data))})}catch(error){scope.postMessage({ok:false,error:error instanceof Error?error.message.slice(0,1000):'地貌组合失败。'})}finally{scope.close()}}
}
