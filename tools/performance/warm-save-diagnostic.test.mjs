import test from 'node:test'
import assert from 'node:assert/strict'
import {intervalUnionMs,summarizeWarmTrace} from './warm-save-diagnostic.mjs'

test('trace interval accounting clips overlapping/nested work without adding it twice',()=>{
  assert.equal(intervalUnionMs([[0,10000],[2000,5000],[8000,12000],[15000,18000]],1000,16000),12)
  assert.equal(intervalUnionMs([],0,10),0)
})

test('warm diagnosis aligns the exact page clock and excludes other threads, out-of-window requests and nested GC',()=>{
  const anchor={name:'anchor',now:100},sample={intent:{captureMs:110},savedReadyMs:130,domainCommittedAtMs:112}
  const event=(name,ts,dur,tid=2)=>({name,ts,dur,tid,pid:1,ph:'X'})
  const events=[{name:'anchor',ts:1000000,pid:1,tid:2},event('RunTask',1009000,16000),event('MinorGC',1011000,5000),
    event('V8.GC_SCAVENGER',1012000,2000),event('MajorGC',1011000,9000,3),event('FunctionCall',1025000,10000)]
  const native={requests:[{atMs:111,method:'get',store:'projects'},{atMs:99,method:'get'}],
    transactions:[{startMs:115,endMs:126,mode:'readwrite'}],timers:[{scheduledMs:113,delayMs:120,firedMs:238}],workers:[]}
  const r=summarizeWarmTrace(events,anchor,sample,native)
  assert.equal(r.mainTaskUnionMs,15);assert.equal(r.mainGcUnionMs,5)
  assert.equal(r.namedEvents.FunctionCall.inclusiveClippedMs,5)
  assert.deepEqual(r.requests,{'projects:get':1});assert.equal(r.transactions[0].durationMs,11)
  assert.equal(r.timers[0].latenessMs,5);assert.equal(r.fullTaskThreadCpuMs,null)
})

test('warm diagnosis rejects missing or ambiguous clock anchors and invalid saved windows',()=>{
  const anchor={name:'anchor',now:100},sample={intent:{captureMs:110},savedReadyMs:130}
  const mark={name:'anchor',ts:1000000,pid:1,tid:2}
  for(const events of [[],[mark,mark]])assert.throws(()=>summarizeWarmTrace(events,anchor,sample,{}),/exactly one/)
  assert.throws(()=>summarizeWarmTrace([mark],anchor,{...sample,savedReadyMs:100},{}),/clock window/)
})
