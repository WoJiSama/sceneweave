import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium, firefox, webkit } from '@playwright/test'
import { startNativeFixtureTooling } from '../performance/prepare-native-m2-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const maximumArchiveBytes = 100 * 1024 * 1024
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const usage = `Usage:
  node tools/migration/migrate-legacy-svg.mjs --input ABS_FILE --output NEW_ABS_DIR --mode complete|history [--browser chromium|firefox|webkit] [--channel CHROMIUM_CHANNEL]

Creates an independent current-v1 project with canonical SVG pixels. The input
is read-only. Output must not already exist; its parent directory must exist.
The default browser is bundled Chromium. Select the matching legacy producer
engine/channel explicitly when needed; exact old PNG pixels must still match.
No persistent browser profile, application entry point, or user database opens.
Unsupported generation records, regional/aggregate scenes, or unbound symbol
sources fail explicitly. Old history stays in original.sceneweave.
Only mapping.json with status "complete" confirms both written files were read
back with the expected hashes and the converted archive passed cold validation.
The result is not published; converted.sceneweave can be imported separately.`

function parseArguments(args) {
  const values = new Map(), allowed = new Set(['--input', '--output', '--mode', '--browser', '--channel'])
  for (let i = 0; i < args.length; i += 2) {
    assert(allowed.has(args[i]) && !values.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), `Unknown, repeated, or missing argument: ${args[i]}\n${usage}`)
    values.set(args[i], args[i + 1])
  }
  const input = values.get('--input'), output = values.get('--output'), mode = values.get('--mode'), engine = values.get('--browser') ?? 'chromium', channel = values.get('--channel')
  assert(input && path.isAbsolute(input), 'Expected explicit --input ABS_FILE')
  assert(output && path.isAbsolute(output), 'Expected explicit --output NEW_ABS_DIR')
  assert(mode === 'complete' || mode === 'history', 'Expected explicit --mode complete|history')
  assert(['chromium', 'firefox', 'webkit'].includes(engine), 'Expected --browser chromium|firefox|webkit')
  assert(!channel || engine === 'chromium', '--channel only applies to Chromium')
  assert(path.resolve(input) !== path.resolve(output), 'Input file and output directory must be different')
  return { input: path.resolve(input), output: path.resolve(output), mode, engine, channel }
}

/** Bounded read-only capture; never opens an input for writing or truncation. */
async function readArchive(file) {
  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    assert(stat.isFile() && stat.size > 0 && stat.size <= maximumArchiveBytes, 'Input must be a regular nonempty archive of at most 100 MiB')
    const bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    assert(offset === stat.size, 'Archive size changed during read-only capture')
    return bytes.subarray(0, offset)
  } finally { await handle.close() }
}

async function run(args) {
  const { input, output, mode, engine, channel } = parseArguments(args)
  const originalBytes = await readArchive(input), originalSha256 = digest(originalBytes)
  // Exclusive directory creation prevents overwriting a prior result, including
  // incomplete attempts. A failed run keeps its originals and failure record.
  await fs.mkdir(output, { mode: 0o700 })
  const record = { format: 'sceneweave-legacy-svg-migration', version: 1, status: 'running', startedAt: new Date().toISOString(),
    inputMode: mode, original: { file: 'original.sceneweave', sha256: originalSha256, byteLength: originalBytes.length },
    scope: 'Independent current-v1 copy; original archive and old history retained verbatim. No database writes or publication.',
    limitations: ['Requires actual original native SVG/PNG pixel agreement in the selected engine; cannot guess the producer.',
      'Rejects nonempty generation records, regional scenes, aggregate coordinates, unbound symbol sources without a fresh fixed identity, and SVG sources that are also derivative outputs.',
      'Only the current scene is copied to a new scene/lineage. All selected old snapshots remain in the original archive.',
      'Does not certify visual acceptance, external VTT compatibility, or performance.'],
    browser: { engine, channel: channel ?? null }, preservedSnapshotIds: [], mappings: null }
  let tooling, browser, browserContext, failure
  async function writeVerified(file, bytes, expectedHash) {
    assert(bytes.length > 0 && bytes.length <= maximumArchiveBytes && digest(bytes) === expectedHash, `Transferred archive mismatch: ${file}`)
    await fs.writeFile(path.join(output, file), bytes, { flag: 'wx', mode: 0o600 })
    assert(digest(await readArchive(path.join(output, file))) === expectedHash, `Written archive reread mismatch: ${file}`)
  }
  try {
    await writeVerified('original.sceneweave', originalBytes, originalSha256)
    tooling = await startNativeFixtureTooling({ root })
    browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true, ...(channel ? { channel } : {}) })
    record.browser.version = browser.version()
    browserContext = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' })
    await browserContext.addInitScript(() => {
      for (const name of ['indexedDB', 'localStorage', 'sessionStorage']) Object.defineProperty(globalThis, name, {
        configurable: false, get() { throw new Error(`The standalone SVG migration forbids ${name} access`) },
      })
    })
    await browserContext.route('**/*', route => route.request().url().startsWith(`${tooling.origin}/`) ? route.continue() : route.abort('blockedbyclient'))
    const page = await browserContext.newPage()
    await page.goto(tooling.url)
    const converted = await page.evaluate(async ({ base64, mode }) => {
      const [{ prepareLegacySvgMigrationCandidate }, { createBrowserSvgPort, createLegacyBrowserSvgPort }, { createBrowserImagePort }, { CANONICAL_SVG_PROCESSOR }] = await Promise.all([
        import('/src/shared/project/legacy-svg-migration.ts'), import('/src/platform/browser/ai/svg-port.ts'),
        import('/src/platform/browser/images/index.ts'), import('/src/shared/ai/svg.ts'),
      ])
      const binary = atob(base64), bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      const candidate = await prepareLegacySvgMigrationCandidate(bytes, mode,
        { images: createBrowserImagePort(), svg: createBrowserSvgPort(), legacySvg: createLegacyBrowserSvgPort() },
        { ids: { nextId: () => `svg-copy-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } })
      const archiveBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error)
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.readAsDataURL(new Blob([candidate.archiveBytes]))
      })
      return { originalArchiveSha256: candidate.originalArchiveSha256, archiveSha256: candidate.archiveSha256,
        archiveByteLength: candidate.archiveBytes.length, archiveBase64, mappings: candidate.mappings,
        preservedSnapshotIds: candidate.preservedSnapshotIds, canonicalProcessor: CANONICAL_SVG_PROCESSOR,
        target: { sceneId: candidate.bundle.project.document.sceneId, lineageId: candidate.bundle.project.historyIdentity.lineageId, revision: candidate.bundle.project.document.revision },
        userAgent: navigator.userAgent }
    }, { base64: originalBytes.toString('base64'), mode })
    assert(converted.originalArchiveSha256 === originalSha256, 'Browser original capture differs from the read-only input')
    const convertedBytes = Buffer.from(converted.archiveBase64, 'base64')
    assert(convertedBytes.length === converted.archiveByteLength, 'Converted archive transfer length differs')
    await writeVerified('converted.sceneweave', convertedBytes, converted.archiveSha256)
    assert(digest(await readArchive(input)) === originalSha256, 'Input changed during migration; refusing to mark this candidate complete')
    record.converted = { file: 'converted.sceneweave', sha256: converted.archiveSha256, byteLength: convertedBytes.length, ...converted.target }
    record.browser.userAgent = converted.userAgent; record.canonicalProcessor = converted.canonicalProcessor
    record.preservedSnapshotIds = converted.preservedSnapshotIds; record.mappings = converted.mappings
    record.verification = { originalDiskReread: true, convertedDiskReread: true, originalInputUnchanged: true, canonicalOnlyColdImport: true }
  } catch (error) {
    failure = error
    record.error = { message: error instanceof Error ? error.message : String(error) }
  } finally {
    const cleanupErrors = []
    for (const [owner, close] of [['context', () => browserContext?.close()], ['browser', () => browser?.close()], ['tooling', () => tooling?.close()]]) {
      try { await close() } catch (error) { cleanupErrors.push({ owner, message: error instanceof Error ? error.message : String(error) }) }
    }
    if (cleanupErrors.length) { record.cleanupErrors = cleanupErrors; failure ??= new Error('Migration browser/tooling cleanup failed') }
    record.status = failure ? 'failed' : 'complete'; record.endedAt = new Date().toISOString()
    await fs.writeFile(path.join(output, 'mapping.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  }
  if (failure) throw failure
  console.log(`Migration complete: ${path.join(output, 'converted.sceneweave')}`)
  console.log(`Original and mapping retained in: ${output}`)
}

if (process.argv.length === 3 && process.argv[2] === '--help') console.log(usage)
else try { await run(process.argv.slice(2)) } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
