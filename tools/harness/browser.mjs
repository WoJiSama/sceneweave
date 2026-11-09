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
  const { generateSemanticProject } = await import(semanticPath)
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
  const document = cold.project.document
  return { archiveBase64: base64(archive), previewBase64: base64(png),
    result: { requestHash: generated.requestHash, resultHash: candidate.resultHash, projectHash,
      sceneId: document.sceneId, title: document.title, target: generated.kind,
      entities: Object.fromEntries(['rooms', 'walls', 'openings', 'props', 'terrainAreas', 'paths', 'decorations', 'surfaceRules'].map(key => [key, Object.keys(document[key]).length])),
      notes: candidate.report.notes, limitations: generated.limitations, profile: candidate.profile, usage: candidate.usage,
      timings: { generationMs, packageExportMs, memoryColdImportMs, previewMs, browserTotalMs: elapsed(started) } } }
}

/** Native cold validation uses bytes reread from disk in a fresh page. Neither
 * the generated project object nor its validation certificate survives here. */
export async function verifyDiskDelivery({ archiveBase64, previewBase64, expectedProjectHash }) {
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
  const coldImportMs = performance.now() - started, canvas = await renderProject(bundle, { audience: 'player', longEdgePx: 2048 })
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
    let changedPixels = 0
    for (let index = 0; index < saved.length; index += 4) {
      if (saved[index] !== current[index] || saved[index + 1] !== current[index + 1] || saved[index + 2] !== current[index + 2] || saved[index + 3] !== current[index + 3]) changedPixels++
    }
    if (changedPixels !== 0) throw new Error(`Disk preview differs from cold render: ${changedPixels} pixels`)
    const coldImportAndPixelComparisonMs = Math.round((performance.now() - started) * 1000) / 1000
    return { projectHash, coldImportMs: Math.round(coldImportMs * 1000) / 1000,
      coldImportAndPixelComparisonMs,
      width: canvas.width, height: canvas.height, changedPixels }
  } finally { bitmap.close() }
}
