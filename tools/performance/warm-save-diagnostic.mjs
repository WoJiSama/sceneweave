import fs from 'node:fs/promises'

// Explicit diagnostic observer. No product proof, values, extra DB reads or GC.
export function installWarmSaveDiagnostic() {
  let active = null
  const maximum = 100000
  const append = (field, row) => {
    if (!active) return
    if (active[field].length >= maximum) { active.overflow = true; return }
    active[field].push(row)
  }
  const transaction = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (...args) {
    const native = Reflect.apply(transaction, this, args)
    if (active) {
      const row = {startMs: performance.now(), mode: native.mode, stores: [...native.objectStoreNames]}
      append('transactions', row)
      native.addEventListener('complete', () => { row.endMs = performance.now(); row.outcome = 'complete' }, {once: true})
      native.addEventListener('abort', () => { row.endMs = performance.now(); row.outcome = 'abort' }, {once: true})
    }
    return native
  }
  for (const method of ['get', 'getAll', 'getAllKeys', 'getKey', 'count', 'openCursor', 'openKeyCursor', 'put', 'add', 'delete', 'clear']) {
    for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
      const original = prototype[method]
      if (typeof original !== 'function') continue
      prototype[method] = function (...args) {
        if(active)append('requests', {atMs: performance.now(), method, store: this instanceof IDBObjectStore ? this.name : this.objectStore.name})
        return Reflect.apply(original, this, args)
      }
    }
  }
  for (const method of ['continue', 'advance', 'continuePrimaryKey', 'update', 'delete']) {
    const original = IDBCursor.prototype[method]
    if (typeof original !== 'function') continue
    IDBCursor.prototype[method] = function (...args) {
      if(active)append('requests', {atMs: performance.now(), method: `cursor.${method}`})
      return Reflect.apply(original, this, args)
    }
  }
  const timeout = globalThis.setTimeout
  globalThis.setTimeout = function (callback, delay, ...args) {
    if (!active || delay !== 120 || typeof callback !== 'function') return Reflect.apply(timeout, this, [callback, delay, ...args])
    const row = {scheduledMs: performance.now(), delayMs: delay}
    append('timers', row)
    return Reflect.apply(timeout, this, [function (...values) {
      row.firedMs = performance.now()
      return Reflect.apply(callback, this, values)
    }, delay, ...args])
  }
  const NativeWorker = globalThis.Worker
  globalThis.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args)
      if (active) {
        const row = {startMs: performance.now(), script: new URL(String(args[0]), location.href).pathname.split('/').at(-1)}
        append('workers', row)
        this.addEventListener('message', () => { row.firstResultMs ??= performance.now() })
      }
    }
  }
  Reflect.set(globalThis, '__sceneweaveWarmSaveDiagnostic', {
    arm() { if (active) throw Error('Warm diagnostics already armed'); active = {transactions: [], requests: [], timers: [], workers: [], overflow: false} },
    anchor() {
      if (!active) throw Error('Warm diagnostics not armed')
      const now = performance.now(), name = 'sceneweave-warm-diagnostic-anchor'
      performance.mark(name, {startTime: now})
      return {name, now}
    },
    finish() { const value = active; active = null; if (!value || value.overflow) throw Error('Missing/overflowed warm diagnostic data'); return value },
  })
}

export function intervalUnionMs(intervals, start, end) {
  const clipped = intervals.map(([a,b]) => [Math.max(a,start),Math.min(b,end)]).filter(([a,b]) => b>a).sort((a,b)=>a[0]-b[0])
  let total = 0, left, right
  for (const [a,b] of clipped) {
    if (left === undefined) { left=a; right=b }
    else if (a<=right) right=Math.max(right,b)
    else { total+=right-left; left=a; right=b }
  }
  return (total+(left===undefined?0:right-left))/1000
}

export function summarizeWarmTrace(events, anchor, sample, native) {
  const marks = events.filter(e=>e.name===anchor.name && Number.isFinite(e.ts))
  if (marks.length !== 1) throw Error('Warm trace must contain exactly one page clock anchor')
  const mark=marks[0],offset=mark.ts-anchor.now*1000
  const start=sample.intent.captureMs,end=sample.savedReadyMs
  if (![start,end,offset].every(Number.isFinite) || end<=start) throw Error('Invalid warm trace clock window')
  const a=start*1000+offset,b=end*1000+offset
  const main=events.filter(e=>e.pid===mark.pid && e.tid===mark.tid && e.ph==='X' && Number.isFinite(e.dur) && e.ts<b && e.ts+e.dur>a)
  const gc=main.filter(e=>/^(MinorGC|MajorGC|V8\.GC.*)$/.test(e.name))
  const tasks=main.filter(e=>/^(ThreadControllerImpl::RunTask|RunTask)$/.test(e.name))
  const grouped={}
  for (const e of main) {
    if (!/GC|^(FunctionCall|EventDispatch|TimerFire|FireAnimationFrame|RunMicrotasks|Layout|UpdateLayoutTree|Paint)$/.test(e.name)) continue
    const row=grouped[e.name]??={count:0,inclusiveClippedMs:0,maximumClippedMs:0}
    const ms=(Math.min(b,e.ts+e.dur)-Math.max(a,e.ts))/1000
    row.count++;row.inclusiveClippedMs+=ms;row.maximumClippedMs=Math.max(row.maximumClippedMs,ms)
  }
  const requests={}
  for(const r of native.requests) if(r.atMs>=start && r.atMs<=end) {
    const key=`${r.store??'*'}:${r.method}`;requests[key]=(requests[key]??0)+1
  }
  const transactions=native.transactions.filter(t=>t.startMs>=start && t.startMs<=end).map(t=>({...t,durationMs:t.endMs==null?null:t.endMs-t.startMs}))
  const timers=native.timers.filter(t=>t.scheduledMs>=start && t.scheduledMs<=end).map(t=>({...t,
    latenessMs:t.firedMs==null?null:t.firedMs-t.scheduledMs-t.delayMs,
    domainToScheduledMs:t.scheduledMs-sample.domainCommittedAtMs}))
  const fullCpu=tasks.filter(e=>e.ts>=a && e.ts+e.dur<=b && Number.isFinite(e.tts) && Number.isFinite(e.tdur))
  return {window:{startMs:start,endMs:end,totalMs:end-start,pid:mark.pid,tid:mark.tid},
    mainTaskUnionMs:intervalUnionMs(tasks.map(e=>[e.ts,e.ts+e.dur]),a,b),
    mainGcUnionMs:intervalUnionMs(gc.map(e=>[e.ts,e.ts+e.dur]),a,b),
    fullTaskThreadCpuMs:fullCpu.length?intervalUnionMs(fullCpu.map(e=>[e.tts,e.tts+e.tdur]),-Infinity,Infinity):null,
    fullTaskThreadCpuCount:fullCpu.length,taskCount:tasks.length,gcEventCount:gc.length,
    namedEvents:grouped,requests,transactions,timers,workers:native.workers.filter(w=>w.startMs>=start && w.startMs<=end),
    limitations:['Explicit tracing and native API observation changes costs; never combine with normal timing distributions.',
      'Main-thread GC/task wall intervals use unions, not nested inclusive sums. GC wall time is not a byte allocation measurement.',
      'Thread CPU includes only fully contained tasks with Chrome thread timestamps. Missing thread counters stay null.',
      'Transaction lifetime includes request scheduling and cloning; it is not exact CPU/disk/lock time. Native counts contain no keys or values.',
      'A 120ms timer is observed by delay and scheduling time, not a product identity or semantic save proof.']}
}

export async function createWarmSaveDiagnostic(page, output) {
  await page.addInitScript(installWarmSaveDiagnostic)
  const cdp=await page.context().newCDPSession(page)
  let running=false
  return {
    async measure(stem, measure) {
      if(running) throw Error('Warm traces must run serially')
      running=true
      let observation,native,anchor,ended,failure,started=false
      try {
        await page.evaluate(()=>Reflect.get(globalThis,'__sceneweaveWarmSaveDiagnostic').arm())
        await cdp.send('Tracing.start',{traceConfig:{recordMode:'recordContinuously',includedCategories:['toplevel','devtools.timeline','v8','blink.user_timing','disabled-by-default-v8.gc']},transferMode:'ReturnAsStream'})
        started=true
        anchor=await page.evaluate(()=>Reflect.get(globalThis,'__sceneweaveWarmSaveDiagnostic').anchor())
        observation=await measure()
      } catch(error) { failure=error }
      finally {
        try { native=await page.evaluate(()=>Reflect.get(globalThis,'__sceneweaveWarmSaveDiagnostic').finish()) }
        catch(error){failure??=error}
        finally {
          if(started){
            ended=new Promise((resolve,reject)=>{
              const timer=setTimeout(()=>reject(Error('Warm trace completion timeout')),30000)
              cdp.once('Tracing.tracingComplete',value=>{clearTimeout(timer);resolve(value)})
            })
            await cdp.send('Tracing.end')
          }
          running=false
        }
      }
      if(!started)throw failure??Error('Warm tracing did not start')
      const completion=await ended
      if(completion.dataLossOccurred || !completion.stream) throw Error('Lost/incomplete warm trace')
      const chunks=[]
      try {
        for(;;){const row=await cdp.send('IO.read',{handle:completion.stream,size:1024*1024});chunks.push(Buffer.from(row.data,row.base64Encoded?'base64':'utf8'));if(row.eof)break}
      } finally { await cdp.send('IO.close',{handle:completion.stream}) }
      const bytes=Buffer.concat(chunks),trace=JSON.parse(bytes.toString('utf8'))
      await fs.writeFile(output(stem+'-trace.json'),bytes,{flag:'wx'})
      await fs.writeFile(output(stem+'-native.json'),JSON.stringify({anchor,native},null,2),{flag:'wx'})
      if(failure)throw failure
      const summary=summarizeWarmTrace(trace.traceEvents,anchor,observation.sample,native)
      return {...summary,traceFile:stem+'-trace.json',nativeFile:stem+'-native.json'}
    },
    async close(){await cdp.detach()},
  }
}
