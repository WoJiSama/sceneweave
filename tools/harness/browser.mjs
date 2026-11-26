/** These functions run in the isolated browser and consume existing application
 * and platform ports. No generation algorithm or package validator lives here. */
export async function generateInBrowser({ request, authorization, budget }) {
  const semanticPath = '/src/application/workspace/semantic-generation.ts'
  const contentPath = '/src/platform/browser/content/generation-intent.ts'
  const validationPath = '/src/platform/browser/project-validation.ts'
  const projectPath = '/src/application/workspace/project.ts'
  const budgetPath = '/src/shared/budget/task-budget.ts'
  const filePath = '/src/shared/project/file.ts'
  const hashPath = '/src/shared/project/validate.ts'
  const rendererPath = '/src/platform/browser/render/renderer.ts'
  const { generateSemanticProject, forestFurnitureNotes } = await import(semanticPath)
  const { browserGenerationContent } = await import(contentPath)
  const { browserProjectValidation } = await import(validationPath)
  const { toBundle } = await import(projectPath)
  const { taskBudgetProfile } = await import(budgetPath)
  const { exportProject, importProject } = await import(filePath)
  const { projectContentHash } = await import(hashPath)
  const { exportPng } = await import(rendererPath)
  const elapsed = start => Math.round((performance.now() - start) * 1000) / 1000
  const runtime = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => new Date().toISOString() } }
  const started = performance.now()
  const generated = await generateSemanticProject(request, { authorization, runtime, content: browserGenerationContent,
    profile: taskBudgetProfile(budget), validation: browserProjectValidation })
  const generationMs = elapsed(started), candidate = generated.candidate, bundle = toBundle(candidate.project)
  const projectHash = projectContentHash(bundle.project)
  const exportStarted = performance.now(), archive = await exportProject(bundle, browserProjectValidation)
  const packageExportMs = elapsed(exportStarted), coldStarted = performance.now()
  const cold = await importProject(archive, browserProjectValidation)
  if (projectContentHash(cold.project) !== projectHash) throw new Error('In-memory package roundtrip changed project content')
  const memoryColdImportMs = elapsed(coldStarted), previewStarted = performance.now()
  const png = new Uint8Array(await (await exportPng(cold, { audience: 'player', longEdgePx: 2048 })).arrayBuffer())
  const previewMs = elapsed(previewStarted)
  const base64 = bytes => {
    let value = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    return btoa(value)
  }
  const document = cold.project.document, diagnostics = candidate.furnitureDiagnostics
  return { archiveBase64: base64(archive), previewBase64: base64(png),
    result: { requestHash: generated.requestHash, resultHash: candidate.resultHash, projectHash,
      sceneId: document.sceneId, title: document.title, target: generated.kind,
      entities: Object.fromEntries(['rooms', 'walls', 'openings', 'props', 'terrainAreas', 'paths', 'decorations', 'surfaceRules'].map(key => [key, Object.keys(document[key]).length])),
      notes: forestFurnitureNotes(diagnostics, candidate.report.notes), diagnostics, limitations: generated.limitations, profile: candidate.profile, usage: candidate.usage,
      timings: { generationMs, packageExportMs, memoryColdImportMs, previewMs, browserTotalMs: elapsed(started) } } }
}

/** Repairs only generated furniture in one exact cold-imported candidate. The
 * application helper owns managed/manual/lock protection and full validation. */
export async function repairInBrowser({ archiveBase64, roomId, budget }) {
  const semanticPath = '/src/application/workspace/semantic-generation.ts'
  const validationPath = '/src/platform/browser/project-validation.ts'
  const projectPath = '/src/application/workspace/project.ts'
  const budgetPath = '/src/shared/budget/task-budget.ts'
  const filePath = '/src/shared/project/file.ts'
  const hashPath = '/src/shared/project/validate.ts'
  const rendererPath = '/src/platform/browser/render/renderer.ts'
  const { prepareForestFurnitureRepair, forestFurnitureNotes } = await import(semanticPath)
  const { browserProjectValidation } = await import(validationPath)
  const { fromVerifiedBundle, toBundle } = await import(projectPath)
  const { taskBudgetProfile } = await import(budgetPath)
  const { exportProject, importProject } = await import(filePath)
  const { projectContentHash } = await import(hashPath)
  const { exportPng } = await import(rendererPath)
  const elapsed = start => Math.round((performance.now() - start) * 1000) / 1000
  const runtime = { ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => new Date().toISOString() } }
  const started = performance.now()
  const parent = await importProject(Uint8Array.from(atob(archiveBase64), character => character.charCodeAt(0)), browserProjectValidation)
  const parentCandidateId = projectContentHash(parent.project)
  const candidate = await prepareForestFurnitureRepair(fromVerifiedBundle(parent), roomId, {
    runtime, profile: taskBudgetProfile(budget), validation: browserProjectValidation,
  })
  const generationMs = elapsed(started), bundle = toBundle(candidate.project), projectHash = projectContentHash(bundle.project)
  const exportStarted = performance.now(), archive = await exportProject(bundle, browserProjectValidation)
  const packageExportMs = elapsed(exportStarted), coldStarted = performance.now()
  const cold = await importProject(archive, browserProjectValidation)
  if (projectContentHash(cold.project) !== projectHash) throw new Error('In-memory repaired package roundtrip changed project content')
  const memoryColdImportMs = elapsed(coldStarted), previewStarted = performance.now()
  const png = new Uint8Array(await (await exportPng(cold, { audience: 'player', longEdgePx: 2048 })).arrayBuffer())
  const previewMs = elapsed(previewStarted)
  const base64 = bytes => {
    let value = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) value += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    return btoa(value)
  }
  const document = cold.project.document, diagnostics = candidate.furnitureDiagnostics
  return { archiveBase64: base64(archive), previewBase64: base64(png),
    result: { resultHash: candidate.result.resultHash, projectHash, parentCandidateId, repairRoomId: roomId,
      sceneId: document.sceneId, title: document.title, target: 'candidate-repair',
      entities: Object.fromEntries(['rooms', 'walls', 'openings', 'props', 'terrainAreas', 'paths', 'decorations', 'surfaceRules'].map(key => [key, Object.keys(document[key]).length])),
      notes: forestFurnitureNotes(diagnostics, candidate.result.notes), diagnostics,
      limitations: ['Furniture-only bounded repair; preserved manual edits and locks may leave unmet targets.', 'Preview pixels were checked; visual quality and user acceptance remain unverified.'],
      profile: candidate.budgetProfile, usage: candidate.usage,
      timings: { generationMs, packageExportMs, memoryColdImportMs, previewMs, browserTotalMs: elapsed(started) } } }
}

/** Native cold validation uses bytes reread from disk in a fresh page. Neither
 * the generated project object nor its validation certificate survives here. */
export async function verifyDiskDelivery({ archiveBase64, previewBase64, expectedProjectHash, floorId, oblique = false, reportDifference = false }) {
  const filePath = '/src/shared/project/file.ts', hashPath = '/src/shared/project/validate.ts'
  const validationPath = '/src/platform/browser/project-validation.ts', rendererPath = '/src/platform/browser/render/renderer.ts'
  const { importProject } = await import(filePath)
  const { projectContentHash } = await import(hashPath)
  const { browserProjectValidation } = await import(validationPath)
  const { renderProject } = await import(rendererPath)
  const bytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0))
  const started = performance.now(), bundle = await importProject(bytes(archiveBase64), browserProjectValidation)
  const projectHash = projectContentHash(bundle.project)
  if (projectHash !== expectedProjectHash) throw new Error('Disk package cold import changed project content')
  const coldImportMs = performance.now() - started, view = { audience: 'player', ...(floorId ? { floorId } : {}) }
  const obliquePath = '/src/platform/browser/render/oblique-renderer.ts'
  const canvas = oblique
    ? await (await import(obliquePath)).renderObliqueProject(bundle, { ...view, longEdgePx: 1440 })
    : await renderProject(bundle, { ...view, longEdgePx: 2048 })
  const bitmap = await createImageBitmap(new Blob([bytes(previewBase64)], { type: 'image/png' }))
  try {
    if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) throw new Error('Disk preview dimensions differ from cold render')
    const savedCanvas = document.createElement('canvas')
    savedCanvas.width = bitmap.width; savedCanvas.height = bitmap.height
    const savedContext = savedCanvas.getContext('2d'), currentContext = canvas.getContext('2d')
    if (!savedContext || !currentContext) throw new Error('Actual Canvas2D pixel comparison unavailable')
    savedContext.drawImage(bitmap, 0, 0)
    const saved = savedContext.getImageData(0, 0, bitmap.width, bitmap.height).data
    const current = currentContext.getImageData(0, 0, canvas.width, canvas.height).data
    let changedPixels = 0, firstDifference
    for (let index = 0; index < saved.length; index += 4) {
      if (saved[index] === current[index] && saved[index + 1] === current[index + 1] && saved[index + 2] === current[index + 2] && saved[index + 3] === current[index + 3]) continue
      changedPixels++
      firstDifference ??= { x: index / 4 % canvas.width, y: Math.floor(index / 4 / canvas.width),
        savedRgba: Array.from(saved.subarray(index, index + 4)), redrawnRgba: Array.from(current.subarray(index, index + 4)) }
    }
    if (changedPixels !== 0 && !reportDifference) throw new Error(`Disk preview differs from cold render: ${changedPixels} pixels`)
    const coldImportAndPixelComparisonMs = Math.round((performance.now() - started) * 1000) / 1000
    return { projectHash, coldImportMs: Math.round(coldImportMs * 1000) / 1000,
      coldImportAndPixelComparisonMs,
      width: canvas.width, height: canvas.height, changedPixels, ...(firstDifference ? { firstDifference } : {}) }
  } finally { bitmap.close(); canvas.width = 0 }
}

export async function runMapInBrowser({ action, request, archiveBase64, budget, draft = false, verify }) {
  const elapsed = start => Math.round((performance.now() - start) * 1000) / 1000
  const base64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(blob)
  })
  const location = '/src/platform/browser/content/map-authoring.ts'
  const { generateMapCandidate, editMapCandidate, inspectMapCandidate, reviewSavedMap } = await import(location)
  const bytes = archiveBase64 && Uint8Array.from(atob(archiveBase64), character => character.charCodeAt(0))
  const started = performance.now()
  try {
    if (action === 'inspect') return { result: await inspectMapCandidate(bytes, request) }
    const budgetPath = '/src/shared/budget/task-budget.ts', projectPath = '/src/application/workspace/project.ts'
    const validationPath = '/src/platform/browser/project-validation.ts', filePath = '/src/shared/project/file.ts'
    const hashPath = '/src/shared/project/validate.ts', rendererPath = '/src/platform/browser/render/renderer.ts'
    const { taskBudgetProfile } = await import(budgetPath)
    const profile = taskBudgetProfile(budget)
    const { browserProjectValidation } = await import(validationPath)
    const { exportProject, importProject } = await import(filePath)
    const { projectContentHash } = await import(hashPath)
    const { exportPng } = await import(rendererPath)
    const render = async (bundle, floorId, oblique, keepTop = false) => {
      const view = { audience: 'player', floorId }
      const preview = await exportPng(bundle, { ...view, longEdgePx: 2048 })
      if (!oblique) return { preview }
      const obliquePath = '/src/platform/browser/render/oblique-renderer.ts'
      try {
        const { exportObliquePng } = await import(obliquePath)
        return { preview, obliquePreview: await exportObliquePng(bundle, { ...view, longEdgePx: 1440 }) }
      } catch (error) {
        if (!keepTop) throw error
        return { preview, previewFailure: { code: 'oblique_render_failed', message: error.message || '斜俯视出图失败。' } }
      }
    }
    if (action === 'verify') {
      const coldStarted = performance.now(), bundle = await importProject(bytes, browserProjectValidation)
      const projectHash = projectContentHash(bundle.project)
      if (projectHash !== verify.projectHash) throw new Error('磁盘工程冷读后的内容摘要与候选不符。')
      const coldImportMs = elapsed(coldStarted)
      const review = verify.sourceAction ? reviewSavedMap(bundle, verify.sourceAction, request, verify.floorId, profile) : undefined
      if (review && !verify.redraw && review.oblique !== verify.oblique) throw new Error('保存的视角与原请求及实际场景不符。')
      const { preview, obliquePreview } = await render(bundle, verify.floorId, verify.redraw ? review.oblique : verify.oblique)
      return { projectHash, coldImportMs, renderMs: elapsed(coldStarted),
        ...(review ? { review, profile } : {}),
        previewBase64: await base64(preview), ...(obliquePreview ? { obliqueBase64: await base64(obliquePreview) } : {}) }
    }
    const { project, oblique, ...result } = action === 'generate'
      ? await generateMapCandidate(request, profile, !draft) : await editMapCandidate(bytes, request, profile, !draft)
    const candidateMs = performance.now() - started
    const { toBundle } = await import(projectPath)
    const bundle = toBundle(project), projectHash = projectContentHash(bundle.project)
    const exportStarted = performance.now()
    const archive = await exportProject(bundle, browserProjectValidation)
    // Both official views use the normal package read path and the exact
    // exported object order. Another browser context independently checks it.
    const delivery = await importProject(archive, browserProjectValidation)
    if (projectContentHash(delivery.project) !== projectHash) throw new Error('生成工程导出后内容摘要变化。')
    const packageExportMs = performance.now() - exportStarted
    const previewStarted = performance.now()
    const { preview, obliquePreview, previewFailure } = await render(delivery, result.floorId, oblique, true)
    const diagnosticMarkers = draft ? [
      ...result.routeChecks.flatMap(check => check.ok ? [] : check.issues.flatMap(issue => issue.atMm
        ? [{ id: check.id, atMm: issue.atMm, message: issue.message }] : [])),
      ...result.heightChecks.flatMap(check => check.ok ? [] : [{ id: check.id, atMm: check.highMm,
        message: `实际高差 ${check.riseMm ?? '未知'} mm，目标至少 ${check.minRiseMm} mm。` }]),
      ...(result.landmarks ?? []).flatMap(landmark => landmark.issue
        ? [{ id: landmark.id, atMm: landmark.atMm, message: landmark.issue }] : []),
    ].slice(0, 12) : []
    let diagnosticPreview
    if (diagnosticMarkers.length) {
      // Annotate the player-visible top image. The unmarked export remains
      // the exact official preview checked during delivery.
      const { projectScene } = await import('/src/shared/projection/projection.ts')
      const { bounds } = projectScene(delivery.project.document, 'player', delivery.project.appearance, { floorId: result.floorId })
      const bitmap = await createImageBitmap(preview)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(bitmap, 0, 0)
        ctx.font = 'bold 21px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (const [index, marker] of diagnosticMarkers.entries()) {
          const x = (marker.atMm.x - bounds.x) / bounds.width * canvas.width
          const y = (marker.atMm.y - bounds.y) / bounds.height * canvas.height
          const cx = Math.max(19, Math.min(canvas.width - 19, x)), cy = Math.max(19, Math.min(canvas.height - 19, y))
          ctx.beginPath()
          ctx.arc(cx, cy, 17, 0, Math.PI * 2)
          ctx.fillStyle = '#872F29'
          ctx.strokeStyle = '#FFFFFF'
          ctx.lineWidth = 3
          ctx.fill(); ctx.stroke()
          ctx.fillStyle = '#FFFFFF'
          ctx.fillText(String(index + 1), cx, cy + 1)
        }
        diagnosticPreview = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        canvas.width = canvas.height = 0
      } finally {
        bitmap.close()
      }
    }
    const previewMs = performance.now() - previewStarted
    return {
      archiveBase64: await base64(new Blob([archive])), previewBase64: await base64(preview),
      ...(obliquePreview ? { obliqueBase64: await base64(obliquePreview) } : {}),
      ...(diagnosticPreview ? { diagnosticBase64: await base64(diagnosticPreview) } : {}),
      ...(previewFailure ? { previewFailure } : {}),
      result: { ...result, ...(diagnosticPreview ? { diagnosticMarkers } : {}), projectHash, profile, expectedOblique: oblique, title: project.document.title, revision: project.document.revision,
        timings: { candidateMs, packageExportMs, previewMs } },
    }
  } catch (error) {
    return { failure: { code: error.code ?? 'map_authoring_failed', message: error instanceof Error ? error.message : String(error),
      ...(error.details ? { details: error.details } : {}) } }
  }
}
