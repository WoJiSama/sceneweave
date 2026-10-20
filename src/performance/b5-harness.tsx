import { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import AssetCanvas from '../editor/v2/AssetCanvas'
import { WorkspaceV2 } from '../editor/v2/workspace'
import { validateStudyEditsV2 } from '../editor/v2/study-constraints'
import { validateIslandEditsV2 } from '../editor/v2/island-constraints'
import { terrainPointCommandsV2 } from '../editor/v2/terrain-editing'
import { createPerformanceFixtureV2 } from '../editor/v2/performance-fixtures'
import { SceneRepositoryV2 } from '../io/v2/storage'
import { exportProjectV2, importProjectV2 } from '../io/v2/project-file'
import { exportPngV2 } from '../render/v2/renderer'
import type { RenderMetricsV2 } from '../render/v2/renderer'
import type { SceneCommandV2 } from '../core/v2/commands'
import type { CompleteProjectV2 } from '../io/v2/types'

const now = () => performance.now()
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))
const repository = new SceneRepositoryV2('sceneweave-b5-measurement')
const saves: { startMs: number; endMs: number; durationMs: number; revision: number }[] = []
const workspace = new WorkspaceV2({ save: async (project, expected) => {
  const start = now(); await repository.save(project, expected)
  saves.push({ startMs: start, endMs: now(), durationMs: now() - start, revision: project.document.revision })
} }, document => { validateStudyEditsV2(document); validateIslandEditsV2(document) })
const renders: RenderMetricsV2[] = []
const decoderCalls: { startMs: number; durationMs: number }[] = []
let decoderActive = 0, nativeDecodeConcurrencyPeak = 0
const nativeDecode = globalThis.createImageBitmap.bind(globalThis)
globalThis.createImageBitmap = ((...args: unknown[]) => {
  const startMs = now()
  decoderActive++; nativeDecodeConcurrencyPeak = Math.max(nativeDecodeConcurrencyPeak, decoderActive)
  return (Reflect.apply(nativeDecode, globalThis, args) as Promise<ImageBitmap>).finally(() => { decoderActive--; decoderCalls.push({ startMs, durationMs: now() - startMs }) })
}) as typeof createImageBitmap
const longTasks: { startMs: number; durationMs: number }[] = []
if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
  for (const entry of list.getEntries()) longTasks.push({ startMs: entry.startTime, durationMs: entry.duration })
}).observe({ type: 'longtask', buffered: true })

let selection: string | null = null
let paintWaiter: { resolve: (time: number) => void; revision: number; timer: ReturnType<typeof setTimeout> } | null = null
let copyCompletedMs = 0
let clickStart = 0
let selectionResult: { selected: string | null; handlerMs: number; eventToPaintMs: number } | null = null
let lastRender: RenderMetricsV2 | null = null
const observeRender = (metrics: RenderMetricsV2) => { lastRender = metrics; renders.push(metrics) }
const painted = (revision: number) => {
  const waiter = paintWaiter
  if (!waiter || waiter.revision !== revision) return
  copyCompletedMs = now()
  paintWaiter = null
  clearTimeout(waiter.timer)
  // A display scheduling proxy following the actual product Canvas copy/selection effect.
  void frame().then(frame).then(time => waiter.resolve(time))
}
function waitForPaint(revision: number): Promise<number> {
  if (paintWaiter) throw new Error('An earlier paint observation is still pending')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { paintWaiter = null; reject(new Error(`No product canvas paint for revision ${revision} within 30 seconds`)) }, 30_000)
    paintWaiter = { resolve, revision, timer }
  })
}
const project = () => {
  const value = workspace.getState().project
  if (!value) throw new Error('No project open')
  return value
}
function Harness() {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getState)
  const [selected, setSelected] = useState<string | null>(null)
  return <main><h1>Sceneweave B5 · production module measurement</h1><p>专用测量入口；产品的场景模型、候选校验、Canvas 和存储实现与主页面相同。</p>
    <output id="status">{state.status} · revision {state.project?.document.revision ?? 'empty'} · selected {selected ?? 'none'}</output>
    {state.project && <AssetCanvas project={state.project} selected={selected} onSelect={id => {
      selection = id
      selectionResult = { selected: id, handlerMs: now() - clickStart, eventToPaintMs: 0 }
      setSelected(id)
    }} onRenderMetrics={observeRender} onPaint={painted} />}
  </main>
}
document.addEventListener('click', event => { if (event.target instanceof HTMLCanvasElement) clickStart = now() }, true)
document.head.insertAdjacentHTML('beforeend', '<style>body{font:14px system-ui;background:#e8e5da;color:#30382f;margin:20px}h1{font-size:20px}.asset-map-wrap{width:1200px;position:relative;margin-top:12px}canvas{display:block;width:1200px;height:auto}.asset-preview-message{position:absolute;padding:12px;background:#f6f0dd}</style>')
createRoot(document.getElementById('root')!).render(<Harness />)

const buffers = new Map<string, Blob>()
async function digest(bytes: BufferSource) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const api = {
  async prepare(sample: 'study' | 'island', count: 500 | 2000) {
    const fixture = await createPerformanceFixtureV2(sample, count)
    validateStudyEditsV2(fixture.project.document); validateIslandEditsV2(fixture.project.document)
    buffers.set('fixture', await exportProjectV2(fixture.project))
    return fixture.summary
  },
  download(key: string, name: string) {
    const blob = buffers.get(key)
    if (!blob) throw new Error(`Missing buffer ${key}`)
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = name; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  },
  async coldOpen(file: string) {
    const startMs = now(), response = await fetch(file)
    if (!response.ok) throw new Error(`Fixture HTTP ${response.status}`)
    const blob = await response.blob(), fetchedMs = now(), decodeStart = decoderCalls.length
    const input = await importProjectV2(blob), importedMs = now()
    const pendingPaint = waitForPaint(input.document.revision)
    await workspace.adoptNew(input)
    const adoptedMs = now(), paintedMs = await pendingPaint
    return { startMs, fetchedMs, importedMs, adoptedMs, paintedMs, fetchMs: fetchedMs - startMs,
      strictImportMs: importedMs - fetchedMs, adoptPersistMs: adoptedMs - importedMs,
      fullDisplayMs: paintedMs - startMs, decoderCalls: decoderCalls.slice(decodeStart),
      initialRender: lastRender, propCount: Object.keys(project().document.props).length }
  },
  selectionPoints() {
    return Object.values(project().document.props).filter(prop => !prop.editLocked && prop.visibility === 'public')
      .slice(-12).map(prop => ({ id: prop.id, positionMm: prop.positionMm }))
  },
  selectionBegin() {
    selectionResult = null
    return waitForPaint(project().document.revision)
  },
  selectionRead(startMs: number, endMs: number) {
    if (!selectionResult || selectionResult.selected !== selection) throw new Error('Selection did not reach product handler')
    return { ...selectionResult, eventToCanvasCopyMs: copyCompletedMs - clickStart, eventToPaintMs: endMs - clickStart, automationWindowMs: endMs - startMs }
  },
  bounds() { return project().document.exportBoundsMm },
  selectionState() { return selection },
  async edit(kind: 'prop' | 'contour', ordinal: number) {
    const scene = project().document, props = Object.values(scene.props)
    let commands: SceneCommandV2[]
    if (kind === 'prop') {
      const prop = props.find(prop => prop.id.startsWith('b5-') && prop.id.endsWith('-editable'))!
      commands = [{ type: 'updateProp', id: prop.id, changes: { rotationDeg: ordinal % 2 ? 0 : 1 } }]
    } else if (scene.presetSnapshot.presetId === 'sceneweave-vis01') {
      const vertex = scene.vertices['study-v0']
      commands = [{ type: 'moveVertex', id: vertex.id, positionMm: { x: vertex.xMm + (ordinal % 2 ? -1 : 1), y: vertex.yMm } }]
    } else {
      const area = Object.values(scene.terrainAreas).find(area => area.id.includes('low')) ?? Object.values(scene.terrainAreas)[0]
      const point = area.boundaryMm[0]
      commands = terrainPointCommandsV2(scene, area.id, point.id, { x: point.positionMm.x + (ordinal % 2 ? -1 : 1), y: point.positionMm.y })
    }
    const startMs = now(), before = scene.revision, renderIndex = renders.length
    const pendingPaint = waitForPaint(before + 1)
    workspace.execute(commands)
    const committedMs = now()
    if (project().document.revision !== before + 1) throw new Error('Edit failed to produce exactly one revision')
    const paintedMs = await pendingPaint, flushStartMs = now()
    await workspace.flush()
    return { kind, ordinal, startMs, commitMs: committedMs - startMs, canvasCopyMs: copyCompletedMs - startMs, displayProxyMs: paintedMs - startMs,
      flushMs: now() - flushStartMs, endMs: now(), revision: project().document.revision,
      renders: renders.slice(renderIndex), status: workspace.getState().status }
  },
  async reopen() {
    await workspace.flush()
    const original = project(), startMs = now(), loaded = await repository.load(original.document.sceneId), endMs = now()
    if (!loaded || JSON.stringify(loaded.document) !== JSON.stringify(original.document)) throw new Error('Reload changed complete document')
    if (Object.keys(loaded.assets).join() !== Object.keys(original.assets).join()) throw new Error('Reload changed resources')
    return { durationMs: endMs - startMs, revision: loaded.document.revision, exactDocument: true,
      snapshots: (await repository.listSnapshots(original.document.sceneId)).length }
  },
  async png(audience: 'gm' | 'player') {
    const startMs = now(), renderIndex = renders.length
    const blob = await exportPngV2(project(), { audience, longEdgePx: 4096, onMetrics: observeRender }), exportedMs = now()
    buffers.set(audience, blob)
    return { audience, startMs, endMs: exportedMs, durationMs: exportedMs - startMs,
      render: renders[renderIndex], encodeAndFlushMs: exportedMs - startMs - renders[renderIndex].totalMs, sizeBytes: blob.size }
  },
  async auditPng(audience: 'gm' | 'player') {
    const start = now(), blob = buffers.get(audience)!
    const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, 0, 0)
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return { audience, width: canvas.width, height: canvas.height,
        sha256: await digest(await blob.arrayBuffer()), rgbaSha256: await digest(rgba.data.buffer), auditMs: now() - start }
    } finally { bitmap.close(); canvas.width = 0; canvas.height = 0 }
  },
  async failureRecovery() {
    const before = project(), beforeText = JSON.stringify(before.document)
    let message = ''
    try { await exportPngV2(before, { audience: 'gm', longEdgePx: 4097 }) }
    catch (error) { message = String(error) }
    if (!message || JSON.stringify(project().document) !== beforeText) throw new Error('Limit failure changed the project')
    const prop = Object.values(before.document.props).find(prop => prop.id.startsWith('b5-') && prop.id.endsWith('-editable'))!
    const pendingPaint = waitForPaint(before.document.revision + 2)
    workspace.updateProp(prop.id, { rotationDeg: 2 }); workspace.undo(); await workspace.flush(); await pendingPaint
    if (project().document.revision !== before.document.revision + 2 || workspace.getState().status !== 'saved') throw new Error('Document not editable after failure')
    return { rejected: true, message, editable: true, undo: true, status: workspace.getState().status }
  },
  async complete() { buffers.set('complete', await exportProjectV2(project())) },
  observations() { return { saves, renders, decoderCalls, nativeDecodeConcurrencyPeak, longTasks, timeOrigin: performance.timeOrigin, userAgent: navigator.userAgent, dpr: devicePixelRatio } },
}
declare global { interface Window { __sceneweavePerformance: typeof api } }
window.__sceneweavePerformance = api
