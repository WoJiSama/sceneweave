// Tool-owned, read-only DOM/event observer. It does not wrap product, React,
// Canvas or IndexedDB functions. All times use the page performance clock.
export function installNativeM2Observer() {
  const now = () => performance.now(), probe = { sample: null, longTasks: [] }
  const number = (node, attribute) => node?.hasAttribute(attribute) ? Number(node.getAttribute(attribute)) : null
  const visible = selector => {
    const node = document.querySelector(selector)
    return !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
  }
  const snapshot = () => {
    const shell = document.querySelector('[data-testid="outdoor-workbench"]'), viewport = document.querySelector('.asset-viewport')
    return {
      nativeFormat: shell?.getAttribute('data-native-format') ?? null, revision: number(shell, 'data-revision'), transactionRevision: number(shell, 'data-transaction-revision'),
      committedAtMs: number(shell, 'data-transaction-committed-at'),
      selection: viewport?.getAttribute('data-selected-ids') ?? '[]',
      renderCount: number(viewport, 'data-render-count'), refinementCount: number(viewport, 'data-refinement-count'), refinementPending: viewport?.getAttribute('data-refinement-pending') === 'true',
      zoom: number(viewport, 'data-zoom'), panX: number(viewport, 'data-pan-x'), panY: number(viewport, 'data-pan-y'),
      viewportWidth: viewport?.clientWidth ?? null, viewportHeight: viewport?.clientHeight ?? null,
      save: document.querySelector('.asset-save')?.textContent.trim() ?? null,
      mapBusy: document.querySelector('.asset-map-wrap')?.getAttribute('aria-busy') ?? null,
      busy: !!document.querySelector('.asset-busy,.native-app-content[inert]'), preview: visible('.asset-structure-preview'),
      menu: visible('[role="menu"]'), primaryCanvas: visible('canvas[aria-label="材质场景主持人预览"],canvas[aria-label="材质场景玩家预览"]'),
      layerOrder: [...document.querySelectorAll('.user-layer-row')].map(node => node.getAttribute('data-layer-id')),
      hiddenLayerIds: [...document.querySelectorAll('.user-layer-row.hidden-layer')].map(node => node.getAttribute('data-layer-id')),
    }
  }
  let longTaskObserver = null
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTaskObserver = new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration }))))
    longTaskObserver.observe({ type: 'longtask', buffered: true })
  }
  const ingest = () => {
    if (longTaskObserver) probe.longTasks.push(...longTaskObserver.takeRecords().map(entry => ({ startTime: entry.startTime, duration: entry.duration })))
  }
  const stamp = event => {
    const captureMs = now(), normalizedEventTimeStamp = event.timeStamp > 1e12 ? event.timeStamp - performance.timeOrigin : event.timeStamp
    return { type: event.type, trusted: event.isTrusted, key: event.key ?? null, button: event.button ?? null,
      eventTimeStamp: event.timeStamp, normalizedEventTimeStamp, captureMs, queuedUntilCaptureMs: captureMs - normalizedEventTimeStamp }
  }
  const matches = (event, spec) => event.type === spec.event && (!spec.selector || event.target instanceof Element && !!event.target.closest(spec.selector))
    && (!spec.label || event.target instanceof Element && (event.target.closest(spec.selector ?? 'button')?.getAttribute('aria-label') ?? event.target.closest(spec.selector ?? 'button')?.textContent ?? '').trim().startsWith(spec.label))
    && (spec.key === undefined || event.key === spec.key) && (spec.button === undefined || event.button === spec.button)
  const ready = (sample, state) => {
    const until = sample.until ?? {}
    if (sample.requireSaved && state.nativeFormat !== 'sceneweave-complete-project@1') return false
    if (sample.expectedRevision !== undefined && state.revision !== sample.expectedRevision) return false
    if (sample.domainCommit && (state.transactionRevision !== sample.expectedRevision || state.committedAtMs === null)) return false
    if (until.selection !== undefined) {
      const overlay = document.querySelector('.asset-selection-overlay')
      if (state.selection !== until.selection || !(overlay instanceof HTMLCanvasElement) || overlay.width <= 0 || overlay.height <= 0) return false
    }
    if (until.text && ![...document.querySelectorAll(until.text.selector)].some(node => node.textContent === until.text.value)) return false
    if (until.visible && !visible(until.visible)) return false
    if (until.absent && document.querySelector(until.absent)) return false
    if (until.menu !== undefined && state.menu !== until.menu) return false
    if (until.preview !== undefined && state.preview !== until.preview) return false
    if (until.viewChanged && state.zoom === sample.before.zoom && state.panX === sample.before.panX && state.panY === sample.before.panY) return false
    if (sample.requireRaster && !(state.renderCount > sample.before.renderCount)) return false
    if (sample.requireSaved && !(state.save === '本地已保存' && !state.busy && state.mapBusy === 'false' && state.primaryCanvas)) return false
    if (sample.endEvent && !sample.endInput) return false
    if (sample.externalEnd && !sample.externalEndMs) return false
    return true
  }
  const check = sample => {
    if (!sample || sample.complete || probe.sample !== sample || !sample.intent) return
    const state = snapshot(), at = now()
    if (sample.expectedRevision !== undefined && state.revision === sample.expectedRevision && sample.domRevisionMs === undefined) sample.domRevisionMs = at
    if (sample.domainCommit && state.revision === sample.expectedRevision && state.transactionRevision === sample.expectedRevision && state.committedAtMs !== null && sample.domainCommittedAtMs === undefined) {
      sample.domainCommittedAtMs = state.committedAtMs; sample.domainStampObservedAtMs = at
    }
    const sameRevision = sample.expectedRevision === undefined || state.revision === sample.expectedRevision
    if (sameRevision && state.renderCount > sample.before.renderCount && state.mapBusy === 'false' && sample.rasterReadyMs === undefined) sample.rasterReadyMs = at
    if (sameRevision && state.save === '本地已保存' && !state.busy && sample.savedReadyMs === undefined) sample.savedReadyMs = at
    if (!ready(sample, state)) return
    sample.domReadyMs ??= at
    if (sample.pendingFrames) return
    sample.pendingFrames = true
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (probe.sample !== sample || sample.complete) return
      if (!ready(sample, snapshot())) { sample.pendingFrames = false; return }
      sample.displayProxyMs = now(); sample.after = snapshot(); sample.complete = true
      sample.clockAtDisplay = { wallMs: Date.now(), monotonicMs: now() }
      cancelAnimationFrame(sample.frameId); delete sample.frameId; delete sample.pendingFrames
      ingest(); sample.longTasks = probe.longTasks.filter(entry => entry.startTime < sample.displayProxyMs && entry.startTime + entry.duration > sample.intent.captureMs)
    }))
  }
  const tick = sample => {
    let previous = null
    const frame = time => {
      if (probe.sample !== sample || sample.complete) return
      if (previous !== null) sample.frameIntervals.push({ startMs: previous, endMs: time, durationMs: time - previous })
      previous = time; check(sample); sample.frameId = requestAnimationFrame(frame)
    }
    sample.frameId = requestAnimationFrame(frame)
  }
  const capture = event => {
    const sample = probe.sample
    if (!sample || sample.complete) return
    if (event.target instanceof Element && (!sample.eventScope || event.target.closest(sample.eventScope))) {
      sample.eventCounts[event.type] = (sample.eventCounts[event.type] ?? 0) + 1
      sample.events.push(stamp(event))
    }
    if (!sample.intent && matches(event, sample.start)) { sample.intent = stamp(event); tick(sample) }
    if (sample.intent && sample.endEvent && matches(event, sample.endEvent)) sample.endInput = stamp(event)
  }
  const bubble = event => {
    const sample = probe.sample
    if (!sample || sample.complete || !sample.intent) return
    if (matches(event, sample.start) && sample.handlerBubbleMs === undefined) sample.handlerBubbleMs = now()
    check(sample)
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'keydown', 'wheel', 'change', 'focusout']) {
    document.addEventListener(type, capture, true); document.addEventListener(type, bubble)
  }
  new MutationObserver(() => check(probe.sample)).observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-revision', 'data-transaction-revision', 'data-transaction-committed-at', 'data-selected-ids', 'data-render-count', 'data-refinement-count', 'data-zoom', 'data-pan-x', 'data-pan-y', 'aria-busy', 'aria-pressed', 'inert'] })
  Reflect.set(window, '__sceneweaveNativeM2Probe', {
    snapshot,
    arm(options) {
      const old = probe.sample
      if (old?.frameId) cancelAnimationFrame(old.frameId)
      ingest(); probe.sample = { ...options, before: snapshot(), armedAtMs: now(), clockAtArm: { wallMs: Date.now(), monotonicMs: now() },
        events: [], eventCounts: {}, frameIntervals: [], complete: false }
    },
    endInputs() { if (probe.sample) { probe.sample.externalEndMs ??= now(); check(probe.sample) } },
    read() { return probe.sample },
  })
}
