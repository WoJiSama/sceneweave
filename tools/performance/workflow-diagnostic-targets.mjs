// Function wall-time probes only in a separate build. Recursive clone/freeze
// visitors are intentionally omitted; normal-build CPU profiles attribute them
// without adding a timer and allocation to every JSON scalar.
export const workflowDiagnosticTargets = {
  'src/application/workspace/workspace.ts': ['adoptNew', 'openPersisted', 'execute', 'startSave', 'flush'],
  'src/application/workspace/prepare.ts': ['prepareCompositionCommands', 'materializeProject'],
  'src/application/workspace/project.ts': ['fromBundle', 'validateEditableProject', 'consumeEditableSnapshot', 'tryDeriveEditableProject'],
  'src/shared/project/file.ts': ['pack', 'unpack', 'importProject', 'exportProject'],
  'src/shared/project/history.ts': ['captureArchive', 'validateHistoryArchive', 'consumeHistoryArchive', 'validateArchive'],
  'src/shared/project/resources.ts': ['validateProjectBundles', 'validateProjectBundle', 'validateProjectSnapshot', 'verifyCapturedBundles', 'validatePixels', 'verifyBytes'],
  'src/shared/project/validate.ts': ['readProjectData', 'projectContentHash'],
  'src/shared/project/encoding.ts': ['encodeProjectContentData'],
  'src/shared/validation/json.ts': ['canonicalJson', 'captureJson', 'encodeUtf8'],
  'src/shared/validation/hash.ts': ['sha256Bytes'],
  'src/shared/project/delta.ts': ['createProjectDelta', 'tryCreateLocalProjectDelta', 'applyProjectDeltaChain', 'createProjectDeltaReplay'],
  'src/platform/browser/storage/repository.ts': ['save', 'saveSnapshot', 'saveWithValidation', 'load', 'assembled', 'assembledUnbound', 'ensureHistory', 'atomic', 'scanTotals', 'checkedContent', 'rowCost', 'addCurrent', 'putResources', 'assertBudgets', 'importArchive', 'importSnapshotArchive', 'installArchive'],
  'src/platform/browser/storage/storage-accounting.ts': ['totals', 'run'],
  'src/platform/browser/storage/incremental-history.ts': ['audit', 'append', 'readVersion', 'reconstructVersion', 'historyVersionBytes', 'versionBytes', 'recordJson'],
  'src/platform/browser/storage/content-context.ts': ['prepareEncodedSnapshot', 'matchingEncodedSnapshot'],
  'src/platform/browser/storage/content-blocks.ts': ['encodeProjectContent', 'partitionEncodedProjectContent', 'prepareLocalProjectContent', 'partitionProjectContent', 'materializeProjectContent', 'checkedContentBlock'],
  'src/platform/browser/storage/content-block-middleware.ts': ['readRow', 'readBlocks', 'rawMany', 'writeBlocks'],
  'src/platform/browser/images/adapter.ts': ['decode', 'transform', 'withDecodedRaster'],
  'src/platform/browser/ai/svg-raster.ts': ['rasterizeNormalizedSvg'],
  'src/platform/browser/render/renderer.ts': ['renderInternal', 'exportPng'],
  'src/platform/browser/render/canvas-renderer.ts': ['decodeRequired', 'drawProjection', 'renderRasterProjection', 'encodePng'],
}
