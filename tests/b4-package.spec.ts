import { expect, test, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { CompleteProjectV2 } from '../src/io/v2/types'
import type { ProjectDiagnosticV2 } from '../src/io/v2/project-file'

type Sample = 'VIS-01' | 'VIS-02'
type Files = Record<string, Uint8Array>
type Failure = { name: string; message: string; issues: ProjectDiagnosticV2[] }
declare global {
  interface Window {
    __b4Package: {
      io: typeof import('../src/io/v2/project-file')
      resources: typeof import('../src/io/v2/resources')
      limits: typeof import('../src/io/v2/limits')
      zip: typeof import('../src/io/v2/zip')
      create(sample: Sample): Promise<CompleteProjectV2>
      unpack(file: Blob): Promise<Files>
      pack(files: Files, stored?: boolean): Blob
      updateScene(files: Files, update: (scene: CompleteProjectV2['document']) => void): Promise<void>
      replaceImage(files: Files, oldHash: string, bytes: Uint8Array): Promise<{ path: string; sha256: string }>
      reject(action: () => Promise<unknown>): Promise<Failure>
      probe<T>(action: () => Promise<T>): Promise<{ result: T; calls: number; peak: number; active: number; closed: number; rejected: number }>
    }
  }
}

async function evidence(info: TestInfo, name: string, result: unknown): Promise<void> {
  const path = info.outputPath(name)
  await writeFile(path, JSON.stringify(result, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const ioPath = '/src/io/v2/project-file.ts', resourcesPath = '/src/io/v2/resources.ts', limitsPath = '/src/io/v2/limits.ts', zipPath = '/src/io/v2/zip.ts'
    const studyPath = '/src/editor/v2/study-sample.ts', islandPath = '/src/editor/v2/island-sample.ts', fflatePath = '/node_modules/.vite/deps/fflate.js'
    const [io, resources, limits, zip, study, island, fflate] = await Promise.all([
      import(ioPath) as Promise<typeof import('../src/io/v2/project-file')>, import(resourcesPath) as Promise<typeof import('../src/io/v2/resources')>,
      import(limitsPath) as Promise<typeof import('../src/io/v2/limits')>, import(zipPath) as Promise<typeof import('../src/io/v2/zip')>,
      import(studyPath) as Promise<typeof import('../src/editor/v2/study-sample')>, import(islandPath) as Promise<typeof import('../src/editor/v2/island-sample')>,
      import(fflatePath) as Promise<typeof import('fflate')>,
    ])
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const readManifest = (files: Files) => JSON.parse(new TextDecoder().decode(files['manifest.json']))
    const updateScene = async (files: Files, update: (scene: CompleteProjectV2['document']) => void) => {
      const scene = JSON.parse(new TextDecoder().decode(files['scene.json']))
      update(scene); files['scene.json'] = encode(scene)
      const manifest = readManifest(files), entry = manifest.entries.find((item: { role: string }) => item.role === 'scene')
      entry.sha256 = await resources.sha256Bytes(files['scene.json']); entry.sizeBytes = files['scene.json'].length
      files['manifest.json'] = encode(manifest)
    }
    window.__b4Package = {
      io, resources, limits, zip,
      create: sample => sample === 'VIS-01' ? study.createStudyProject() : island.createIslandProject(),
      unpack: async file => fflate.unzipSync(new Uint8Array(await file.arrayBuffer())),
      pack: (files, stored = false) => new Blob([fflate.zipSync(files, { level: stored ? 0 : 6 }).slice().buffer]),
      updateScene,
      async replaceImage(files, oldHash, bytes) {
        const manifest = readManifest(files), entry = manifest.entries.find((item: { role: string; sha256: string }) => item.role === 'asset' && item.sha256 === oldHash)
        const hash = await resources.sha256Bytes(bytes)
        delete files[entry.path]; entry.sha256 = hash; entry.path = `assets/${hash}.png`; entry.sizeBytes = bytes.length
        files[entry.path] = bytes; files['manifest.json'] = encode(manifest)
        await updateScene(files, scene => { for (const ref of Object.values(scene.assets)) if (ref.sha256 === oldHash) ref.sha256 = hash })
        return { path: entry.path, sha256: hash }
      },
      async reject(action) {
        try { await action() } catch (error) {
          const failure = error as Error & { issues?: ProjectDiagnosticV2[] }
          return { name: failure.name, message: failure.message, issues: failure.issues ?? [] }
        }
        throw new Error('Fault injection unexpectedly produced a complete candidate.')
      },
      async probe(action) {
        const native = window.createImageBitmap.bind(window)
        let calls = 0, active = 0, peak = 0, closed = 0, rejected = 0
        window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
          calls++; active++; peak = Math.max(peak, active)
          try {
            const bitmap = await native(source, options), close = bitmap.close.bind(bitmap)
            bitmap.close = () => { closed++; active--; close() }
            return bitmap
          } catch (error) { active--; rejected++; throw error }
        }) as typeof createImageBitmap
        try { const result = await action(); return { result, calls, peak, active, closed, rejected } }
        finally { window.createImageBitmap = native }
      },
    }
  })
})

for (const sample of ['VIS-01', 'VIS-02'] as const) {
  test(`${sample} complete package lists missing fixed dependencies and refuses incomplete export before decode`, async ({ page, browser }, info) => {
    const result = await page.evaluate(async sample => {
      const h = window.__b4Package, project = await h.create(sample), original = await h.io.exportProjectV2(project)
      const originalHash = await h.resources.sha256Bytes(new Uint8Array(await original.arrayBuffer()))
      const originalDocument = JSON.stringify(project.document)
      const failures: { label: string; expected: string; failure: Failure; decodes: number }[] = []
      const mutate = async (label: string, expected: string, change: (files: Files) => Promise<void> | void) => {
        const files = await h.unpack(original); await change(files)
        const probe = await h.probe(() => h.reject(() => h.io.importProjectV2(h.pack(files))))
        failures.push({ label, expected, failure: probe.result, decodes: probe.calls })
      }
      const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
      const editManifest = (files: Files, change: (manifest: any) => void) => {
        const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])); change(manifest); files['manifest.json'] = encode(manifest)
      }
      const assetId = Object.keys(project.document.assets)[0], materialId = Object.keys(project.document.materials)[0], propId = Object.keys(project.document.propDefinitions)[0]
      await mutate('missing AssetRef', 'MISSING_ASSET', files => h.updateScene(files, scene => { delete scene.assets[assetId] }))
      await mutate('missing fixed material', 'MISSING_DEFINITION', files => h.updateScene(files, scene => { delete scene.materials[materialId] }))
      await mutate('mismatched material version', 'DEFINITION_VERSION', files => h.updateScene(files, scene => { scene.materials[materialId].version = 2 }))
      await mutate('missing fixed prop definition', 'MISSING_DEFINITION', files => h.updateScene(files, scene => { delete scene.propDefinitions[propId] }))
      await mutate('mismatched prop version', 'DEFINITION_VERSION', files => h.updateScene(files, scene => { scene.propDefinitions[propId].version = 2 }))
      const prefabId = Object.keys(project.document.prefabDefinitions)[0]
      if (prefabId) {
        await mutate('missing fixed Prefab', 'MISSING_DEFINITION', files => h.updateScene(files, scene => { delete scene.prefabDefinitions[prefabId] }))
        await mutate('mismatched Prefab version', 'DEFINITION_VERSION', files => h.updateScene(files, scene => { scene.prefabDefinitions[prefabId].version = 2 }))
      }
      const firstHashes = Object.keys(project.assets).sort().slice(0, 2)
      await mutate('two absent declared bitmap files', 'MISSING_PACKAGE_ENTRY', files => {
        for (const hash of firstHashes) delete files[`assets/${hash}.png`]
      })
      await mutate('two absent complete bitmap dependencies', 'MISSING_BITMAP', files => {
        for (const hash of firstHashes) delete files[`assets/${hash}.png`]
        editManifest(files, manifest => { manifest.entries = manifest.entries.filter((entry: { sha256: string }) => !firstHashes.includes(entry.sha256)) })
      })
      await mutate('two absent license bindings', 'MISSING_LICENSE_BINDING', files => editManifest(files, manifest => { manifest.licenseBindings.splice(0, 2) }))
      await mutate('missing license text', 'MISSING_PACKAGE_ENTRY', files => { delete files[Object.keys(files).find(path => path.startsWith('licenses/'))!] })
      await mutate('embedding denied for bitmap and material', 'EMBEDDING_FORBIDDEN', files => h.updateScene(files, scene => { scene.assets[assetId].origin.canEmbed = false; scene.materials[materialId].origin.canEmbed = false }))
      await mutate('unknown container version', 'INVALID_PROJECT', files => editManifest(files, manifest => { manifest.containerVersion = 99 }))
      await mutate('unknown manifest schema version', 'INVALID_PROJECT', files => editManifest(files, manifest => { manifest.documentSchemaVersion = 99 }))
      await mutate('unknown document schema version', 'SCHEMA', files => h.updateScene(files, scene => { (scene as unknown as { schemaVersion: number }).schemaVersion = 99 }))
      await mutate('unknown document extension', 'SCHEMA', files => h.updateScene(files, scene => { (scene as unknown as Record<string, unknown>).unknownTerrainExtension = { secret: 'B4-GM-body-must-not-be-in-errors' } }))
      const missing = structuredClone(project)
      for (const hash of firstHashes) delete missing.assets[hash]
      const exportProbe = await h.probe(() => h.reject(() => h.io.exportProjectV2(missing)))
      const reportProbe = await h.probe(() => h.io.diagnoseCompleteProjectV2(missing))
      const summary = await h.io.diagnoseCompleteProjectV2(project)
      return { sample, packageBytes: original.size, originalHash, unchangedPackageHash: await h.resources.sha256Bytes(new Uint8Array(await original.arrayBuffer())),
        memoryDocumentUnchanged: JSON.stringify(project.document) === originalDocument, failures, exportFailure: exportProbe.result, exportDecodes: exportProbe.calls,
        incompleteReport: reportProbe.result, reportDecodes: reportProbe.calls, summary, prefabCases: prefabId ? 2 : 0 }
    }, sample)
    for (const failure of result.failures) {
      expect(failure.failure.name, failure.label).toBe('ProjectValidationErrorV2')
      expect(failure.failure.issues.some(issue => issue.code === failure.expected), failure.label).toBe(true)
      expect(failure.decodes, failure.label).toBe(0)
      expect(failure.failure.message, failure.label).not.toContain('B4-GM-body-must-not-be-in-errors')
    }
    expect(result.failures.find(item => item.label === 'two absent declared bitmap files')?.failure.issues).toHaveLength(2)
    expect(result.failures.find(item => item.label === 'two absent complete bitmap dependencies')?.failure.issues.filter(issue => issue.code === 'MISSING_BITMAP')).toHaveLength(2)
    expect(result.failures.find(item => item.label === 'embedding denied for bitmap and material')?.failure.issues.filter(issue => issue.code === 'EMBEDDING_FORBIDDEN')).toHaveLength(2)
    const versionIssue = result.failures.find(item => item.label === 'mismatched material version')?.failure.issues.find(issue => issue.code === 'DEFINITION_VERSION')
    expect(versionIssue).toMatchObject({ expectedVersion: 1, actualVersion: 2 })
    expect(versionIssue?.dependencyId).toBeTruthy(); expect(versionIssue?.entityId).toBeTruthy()
    expect(result.exportFailure.issues.filter(issue => issue.code === 'MISSING_BITMAP')).toHaveLength(2)
    expect(result.exportDecodes).toBe(0); expect(result.reportDecodes).toBe(0)
    expect(result.incompleteReport).toMatchObject({ complete: false, summary: null })
    expect(result.summary.complete).toBe(true); expect(result.summary.issues).toEqual([])
    expect(result.summary.summary?.bitmapBlobs).toBe(sample === 'VIS-01' ? 15 : 13)
    expect(result.memoryDocumentUnchanged).toBe(true); expect(result.unchangedPackageHash).toBe(result.originalHash)
    expect(result.prefabCases).toBe(sample === 'VIS-01' ? 2 : 0)
    await evidence(info, `${sample}-dependency-failure-matrix.json`, { browserVersion: browser.version(), ...result })
  })

  test(`${sample} CRC hash metadata and native decode faults remain bounded and do not produce partial projects`, async ({ page, browser }, info) => {
    const result = await page.evaluate(async sample => {
      const h = window.__b4Package, project = await h.create(sample), original = await h.io.exportProjectV2(project)
      const originalHash = await h.resources.sha256Bytes(new Uint8Array(await original.arrayBuffer())), hash = Object.keys(project.assets).sort()[0]
      const path = `assets/${hash}.png`, sourceBytes = new Uint8Array(await project.assets[hash].blob.arrayBuffer())
      const chunk = (type: string, data: Uint8Array) => {
        const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
        view.setUint32(0, data.length); result.set(new TextEncoder().encode(type), 4); result.set(data, 8)
        view.setUint32(result.length - 4, h.limits.crc32(result.subarray(4, result.length - 4))); return result
      }
      const concat = (pieces: Uint8Array[]) => {
        const result = new Uint8Array(pieces.reduce((sum, item) => sum + item.length, 0)); let offset = 0
        for (const piece of pieces) { result.set(piece, offset); offset += piece.length }; return result
      }
      const failures: { label: string; expected: string; failure: Failure; calls: number; path?: string; sha256?: string }[] = []
      const hashFiles = await h.unpack(original); hashFiles[path] = sourceBytes.slice(); hashFiles[path][hashFiles[path].length - 1] ^= 1
      const hashProbe = await h.probe(() => h.reject(() => h.io.importProjectV2(h.pack(hashFiles))))
      failures.push({ label: 'actual encoded SHA-256 mismatch', expected: 'PACKAGE_HASH_MISMATCH', failure: hashProbe.result, calls: hashProbe.calls, path, sha256: hash })
      const crcFiles = await h.unpack(original), stored = h.pack(crcFiles, true), archive = new Uint8Array(await stored.arrayBuffer()), indexed = await h.zip.inspectZipV2(stored)
      archive[indexed.entries.get(path)!.dataStart + 20] ^= 1
      const crcProbe = await h.probe(() => h.reject(() => h.io.importProjectV2(new Blob([archive]))))
      failures.push({ label: 'ZIP CRC damage', expected: 'ZIP_ENTRY_INVALID', failure: crcProbe.result, calls: crcProbe.calls, path, sha256: hash })
      const pngCrcFiles = await h.unpack(original), damagedPng = sourceBytes.slice(); damagedPng[20] ^= 1
      const damagedIdentity = await h.replaceImage(pngCrcFiles, hash, damagedPng)
      const pngCrcProbe = await h.probe(() => h.reject(() => h.io.importProjectV2(h.pack(pngCrcFiles))))
      failures.push({ label: 'PNG CRC with valid outer hash and ZIP CRC', expected: 'IMAGE_ENCODING_INVALID', failure: pngCrcProbe.result, calls: pngCrcProbe.calls, ...damagedIdentity })
      const metadataFiles = await h.unpack(original), metadataBytes = concat([sourceBytes.subarray(0, 33), chunk('tEXt', new TextEncoder().encode('Comment\0B4-private-source-metadata')), sourceBytes.subarray(33)])
      const metadataIdentity = await h.replaceImage(metadataFiles, hash, metadataBytes)
      const metadataProbe = await h.probe(() => h.reject(() => h.io.importProjectV2(h.pack(metadataFiles))))
      failures.push({ label: 'metadata with valid hashes and CRCs', expected: 'IMAGE_ENCODING_INVALID', failure: metadataProbe.result, calls: metadataProbe.calls, ...metadataIdentity })
      // Keep real dimensions and valid PNG chunks, CRC and outer hashes. Only the
      // IDAT stream is invalid, so Chrome's actual decoder must make the decision.
      const pieces = [sourceBytes.subarray(0, 8)], view = new DataView(sourceBytes.buffer)
      let replaced = false
      for (let cursor = 8; cursor < sourceBytes.length;) {
        const length = view.getUint32(cursor), type = String.fromCharCode(...sourceBytes.subarray(cursor + 4, cursor + 8))
        if (type === 'IDAT') { if (!replaced) pieces.push(chunk('IDAT', new Uint8Array([1, 2, 3]))); replaced = true }
        else pieces.push(sourceBytes.subarray(cursor, cursor + length + 12))
        cursor += length + 12
      }
      const badDecodeFiles = await h.unpack(original), badDecodeIdentity = await h.replaceImage(badDecodeFiles, hash, concat(pieces)), badFile = h.pack(badDecodeFiles)
      const decodeProbe = await h.probe(async () => {
        const [failure, good] = await Promise.all([h.reject(() => h.io.importProjectV2(badFile)), h.io.diagnoseCompleteProjectV2(project)])
        return { failure, good: good.complete }
      })
      return { sample, originalHash, unchangedPackageHash: await h.resources.sha256Bytes(new Uint8Array(await original.arrayBuffer())), failures,
        nativeDecode: { ...decodeProbe, ...badDecodeIdentity }, resourceCount: Object.keys(project.assets).length }
    }, sample)
    for (const fault of result.failures) {
      expect(fault.failure.name).toBe('ProjectValidationErrorV2'); expect(fault.calls, fault.label).toBe(0)
      expect(fault.failure.issues).toContainEqual(expect.objectContaining({ code: fault.expected, path: fault.path, sha256: fault.sha256 }))
      expect(fault.failure.message).not.toContain('B4-private-source-metadata')
    }
    expect(result.failures.find(fault => fault.label === 'ZIP CRC damage')?.failure.message).toContain('CRC')
    expect(result.failures.find(fault => fault.label.startsWith('PNG CRC'))?.failure.message).toContain('CRC')
    expect(result.nativeDecode.result.failure.issues).toContainEqual(expect.objectContaining({ code: 'IMAGE_INVALID', sha256: result.nativeDecode.sha256 }))
    expect(result.nativeDecode.result.failure.message).toContain('实际解码失败')
    expect(result.nativeDecode.result.good).toBe(true)
    expect(result.nativeDecode.rejected).toBe(1); expect(result.nativeDecode.peak).toBe(1); expect(result.nativeDecode.active).toBe(0)
    expect(result.nativeDecode.closed + result.nativeDecode.rejected).toBe(result.nativeDecode.calls)
    expect(result.unchangedPackageHash).toBe(result.originalHash)
    await evidence(info, `${sample}-byte-and-native-decoder-failures.json`, { browserVersion: browser.version(), ...result })
  })

  test(`${sample} cancellation closes real decoded bitmaps and cumulative budget rejects before decode`, async ({ page, browser }, info) => {
    const result = await page.evaluate(async sample => {
      const h = window.__b4Package, project = await h.create(sample), original = await h.io.exportProjectV2(project)
      const documentBefore = JSON.stringify(project.document), inputHash = await h.resources.sha256Bytes(new Uint8Array(await original.arrayBuffer()))
      const controller = new AbortController(), native = window.createImageBitmap.bind(window)
      let nativeCalls = 0, closed = 0
      window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
        const bitmap = await native(source, options), close = bitmap.close.bind(bitmap)
        nativeCalls++; bitmap.close = () => { closed++; close() }; controller.abort(); return bitmap
      }) as typeof createImageBitmap
      let cancelled: Failure
      try { cancelled = await h.reject(() => h.io.importProjectV2(original, { signal: controller.signal })) }
      finally { window.createImageBitmap = native }
      const overBudget = structuredClone(project)
      for (const ref of Object.values(overBudget.document.assets).slice(0, 3)) {
        ref.pixelWidth = 8192; ref.pixelHeight = 3906
        overBudget.assets[ref.sha256].pixelWidth = 8192; overBudget.assets[ref.sha256].pixelHeight = 3906
      }
      const budgetProbe = await h.probe(() => h.io.diagnoseCompleteProjectV2(overBudget))
      const preAborted = new AbortController(); preAborted.abort()
      const cancelledDiagnosis = await h.reject(() => h.io.diagnoseCompleteProjectV2(project, { signal: preAborted.signal }))
      const recovery = await h.io.importProjectV2(original)
      return { sample, nativeCalls, closed, cancelled, cancelledDiagnosis, budget: budgetProbe, inputHash,
        unchangedInputHash: await h.resources.sha256Bytes(new Uint8Array(await original.arrayBuffer())), memoryDocumentUnchanged: JSON.stringify(project.document) === documentBefore,
        recoveryDocumentEqual: JSON.stringify(recovery.document) === documentBefore, recoveryAssets: Object.keys(recovery.assets).length }
    }, sample)
    expect(result.cancelled.name).toBe('AbortError'); expect(result.cancelled.issues).toEqual([])
    expect(result.cancelledDiagnosis.name).toBe('AbortError')
    expect(result.nativeCalls).toBe(1); expect(result.closed).toBe(1)
    expect(result.budget.calls).toBe(0); expect(result.budget.result.complete).toBe(false)
    expect(result.budget.result.issues.some(issue => issue.code === 'IMAGE_PIXEL_BUDGET')).toBe(true)
    expect(result.memoryDocumentUnchanged).toBe(true); expect(result.unchangedInputHash).toBe(result.inputHash)
    expect(result.recoveryDocumentEqual).toBe(true); expect(result.recoveryAssets).toBe(sample === 'VIS-01' ? 15 : 13)
    await evidence(info, `${sample}-cancellation-and-pixel-budget.json`, { browserVersion: browser.version(), ...result })
  })
}
