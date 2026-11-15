import ts from 'typescript'
import MagicString from 'magic-string'

export const saveCostTargets={
 'src/platform/browser/storage/repository.ts':['rowCost','runtimeRecord','bytesOf','putResources','addCurrent','checkedContent'],
 'src/platform/browser/storage/incremental-history.ts':['append','version'],
 'src/platform/browser/storage/content-context.ts':['matchingEncodedSnapshot','prepareEncodedSnapshot','snapshotContentPartition'],
 'src/platform/browser/storage/storage-accounting.ts':['changed'],
}
export const hookCopyTargets=['src/platform/browser/storage/database.ts','src/platform/browser/storage/storage-accounting.ts']
export function instrumentHookCopies(input,file){
 let code=input.replaceAll('\r\n','\n')
 const api="Reflect.get(globalThis,'__sceneweaveSaveBoundaries')"
 const replace=(from,to)=>{if(code.split(from).length!==2)throw Error(`Missing/ambiguous hook-copy boundary ${file}`);code=code.replace(from,to)}
 if(file.endsWith('/database.ts')){
  replace('const previous = payload(row), next = structuredClone(row)',`const previous = payload(row), next = ${api}.call('coordinate.cloneOld',()=>structuredClone(row))`)
  replace("return atomic(transaction, () => {\n      const previous",`${api}.shape('coordinate',changes,field);return atomic(transaction, () => {\n      const previous`)
 }else if(file.endsWith('/storage-accounting.ts')){
  if(code.includes('next = structuredClone(envelope)')){
   replace('next = structuredClone(envelope)',`next = ${api}.call('accounting.cloneEnvelope',()=>structuredClone(envelope))`)
   replace('next = structuredClone(value)',`next = ${api}.call('accounting.cloneOld',()=>structuredClone(value))`)
  }else replace('const next = structuredClone(value)',`const next = ${api}.call('accounting.cloneOld',()=>structuredClone(value))`)
  replace("if (!this.pending.has(tx)) {",`${api}.shape('accounting',changes,CONTENT_PAYLOAD_FIELDS[name]);if (!this.pending.has(tx)) {`)
 }else throw Error('Unknown hook-copy file')
 return code
}
export function installSaveBoundaryDiagnostic(){
 let active=null
 Reflect.set(globalThis,'__sceneweaveSaveBoundaries',{
  reset(){if(active)throw Error('Already active');active={functions:{},shapes:{}}},
  shape(name,changes,field){
   if(!active)return
   const keys=Object.keys(changes),last=keys.at(-1),has=field&&Object.hasOwn(changes,field)
   const label=`${name}.${field?'payload':'other'}.${has?'replacement':'diff'}.${has&&last===field?'last':'other-order'}`
   const row=active.shapes[label]??={count:0,changes:0,nested:0};row.count++;row.changes+=keys.length;row.nested+=keys.filter(k=>k.includes('.')).length
  },
  call(name,run){
   if(!active)return run()
   const owner=active,start=performance.now(),finish=()=>{const r=owner.functions[name]??={count:0,inclusiveMs:0,maxMs:0};const ms=performance.now()-start;r.count++;r.inclusiveMs+=ms;r.maxMs=Math.max(r.maxMs,ms)}
   try{const value=run();if(value&&typeof value.then==='function')return value.then(v=>{finish();return v},e=>{finish();throw e});finish();return value}catch(e){finish();throw e}
  },
  finish(){if(!active)throw Error('No diagnostic');const result=active;active=null;return result},
 })
}
export function instrumentSaveCost(code,file){
 const names=saveCostTargets[file];if(!names)throw Error(`Unknown file ${file}`)
 const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true),edits=new MagicString(code),seen=new Set()
 function visit(node){
  const name=(ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node))&&node.name?node.name.getText(ast):ts.isArrowFunction(node)&&ts.isVariableDeclaration(node.parent)?node.parent.name.getText(ast):null
  if(node.body&&names.includes(name)){
   if(seen.has(name)||!ts.isBlock(node.body))throw Error(`Ambiguous boundary ${file}#${name}`)
   seen.add(name)
   const async=node.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)?'async ':''
   edits.appendLeft(node.body.getStart(ast)+1,`return Reflect.get(globalThis,'__sceneweaveSaveBoundaries').call('${file.split('/').at(-1)}#${name}',${async}()=>{`)
   edits.prependLeft(node.body.end-1,'});')
  }
  ts.forEachChild(node,visit)
 }
 visit(ast);for(const name of names)if(!seen.has(name))throw Error(`Missing boundary ${file}#${name}`)
 return edits.toString()
}
