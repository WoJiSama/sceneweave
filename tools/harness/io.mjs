import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const MAX_REQUEST_BYTES = 64 * 1024
export const MAX_MAP_REQUEST_BYTES = 256 * 1024
// Same outer file limit as the browser's complete v1 reader.
export const MAX_ARCHIVE_BYTES = 304 * 1024 * 1024
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const assert = (condition, message) => { if (!condition) throw new Error(message) }

export const usage = `Usage:
  node tools/harness/sceneweave.mjs map --help
  node tools/harness/sceneweave.mjs capabilities
  node tools/harness/sceneweave.mjs example
  node tools/harness/sceneweave.mjs workflows [--query TEXT | --id WORKFLOW_ID [--definition-hash SHA256] [--step STEP_ID | --effects | --schema]]
  node tools/harness/sceneweave.mjs generate --input ABS_JSON --output NEW_ABS_DIR --allow forest-building --budget small|standard|expanded
  node tools/harness/sceneweave.mjs repair-furniture --input ABS_SCENEWEAVE --room ROOM_ID --output NEW_ABS_DIR --allow forest-building --budget small|standard|expanded

The map subcommand exposes shared generation, composition, inspection and local editing.
The forest-building commands create an independent project from the explicitly authorized built-in
forest-building catalogue. Input JSON supplies semantic parameters only. Output
must not exist and its parent must exist. Actual image/pixel checks and rendering
use isolated Chromium; install it with npx playwright install chromium, or set
SCENEWEAVE_BROWSER_CHANNEL=chrome to use installed Chrome with a fresh profile.
No model, external provider, current project, or user browser database is used.
No request is retried automatically. Only result.json status complete confirms
disk reread, native cold import, and matching preview pixels. This is development
tooling, not formal visual/AI acceptance. Import map.sceneweave in the editor to
review and continue editing.`

export function parseArguments(args) {
  const [command, ...rest] = args
  if (command === 'workflows') {
    const values = new Map()
    for (let index = 0; index < rest.length; index++) {
      const key = rest[index]
      assert(['--query', '--id', '--definition-hash', '--step', '--effects', '--schema'].includes(key) && !values.has(key), `Unknown or repeated workflow argument: ${key}`)
      const value = ['--effects', '--schema'].includes(key) ? true : rest[++index]
      assert(value === true || value && !value.startsWith('--'), `Missing workflow argument: ${key}`)
      values.set(key, value)
    }
    const workflowId = values.get('--id'), stepId = values.get('--step'), query = values.get('--query')
    const definitionHash = values.get('--definition-hash')
    const views = ['--step', '--effects', '--schema'].filter(key => values.has(key))
    assert(views.length <= 1 && (!views.length || workflowId) && !(query && workflowId), 'Choose a query or one workflow with one optional detail view')
    assert(!definitionHash || workflowId && /^[a-f0-9]{64}$/.test(definitionHash), 'Expected --id and a SHA-256 for --definition-hash')
    if (!workflowId) return { command, query: { action: 'list', ...(query ? { query } : {}) } }
    const action = stepId ? 'step' : values.has('--effects') ? 'effects' : values.has('--schema') ? 'schema' : 'read'
    return { command, query: { action, workflowId, ...(stepId ? { stepId } : {}), ...(definitionHash ? { definitionHash } : {}) } }
  }
  if (command === 'capabilities' || command === 'example') {
    assert(rest.length === 0, `Unexpected arguments.\n${usage}`)
    return { command }
  }
  assert(command === 'generate' || command === 'repair-furniture', usage)
  const values = new Map(), allowed = new Set(['--input', '--output', '--allow', '--budget', ...(command === 'repair-furniture' ? ['--room'] : [])])
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1]
    assert(allowed.has(key) && !values.has(key) && value && !value.startsWith('--'), `Unknown, repeated, or missing argument: ${key}\n${usage}`)
    values.set(key, value)
  }
  const input = values.get('--input'), output = values.get('--output'), budget = values.get('--budget')
  assert(input && path.isAbsolute(input), 'Expected explicit --input ABS_JSON')
  assert(output && path.isAbsolute(output), 'Expected explicit --output NEW_ABS_DIR')
  assert(values.get('--allow') === 'forest-building', 'Expected explicit --allow forest-building')
  assert(['small', 'standard', 'expanded'].includes(budget), 'Expected explicit --budget small|standard|expanded')
  assert(path.resolve(input) !== path.resolve(output), 'Input file and output directory must be different')
  const roomId = values.get('--room')
  if (command === 'repair-furniture') assert(typeof roomId === 'string' && roomId.length > 0 && roomId.length <= 256 && roomId !== '__proto__', 'Expected explicit --room ROOM_ID')
  return { command, input: path.resolve(input), output: path.resolve(output), budget, ...(roomId ? { roomId } : {}) }
}

/** A regular file is captured read-only and bounded before JSON is interpreted. */
export async function readBounded(file, maximumBytes) {
  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    assert(stat.isFile() && stat.size > 0 && stat.size <= maximumBytes, `Expected a nonempty regular file of at most ${maximumBytes} bytes`)
    const bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    assert(offset === stat.size, 'File size changed during read-only capture')
    return bytes.subarray(0, offset)
  } finally { await handle.close() }
}

export async function readRequest(file, maximumBytes = MAX_REQUEST_BYTES) {
  const bytes = await readBounded(file, maximumBytes)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new Error('Input must be valid UTF-8 JSON') }
}

export async function writeVerified(directory, name, bytes, maximumBytes = MAX_ARCHIVE_BYTES) {
  assert(bytes.length > 0 && bytes.length <= maximumBytes, `Invalid output length: ${name}`)
  const file = path.join(directory, name), sha256 = digest(bytes)
  await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
  const reread = await readBounded(file, maximumBytes)
  assert(digest(reread) === sha256, `Written output reread mismatch: ${name}`)
  return { bytes: reread, record: { file: name, sha256, byteLength: reread.length } }
}

/** Replaces only this invocation's initially exclusive result record. Completion
 * checks straddle the asynchronous rename; its caller owns the commit point. */
export async function replaceResult(directory, record, options = {}) {
  const { checkCurrent = () => {}, onPublished = () => {}, operations = fs } = options
  const pending = path.join(directory, '.result.pending.json')
  let pendingOwned = false
  checkCurrent()
  try {
    await operations.writeFile(pending, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    pendingOwned = true
    checkCurrent()
    await operations.rename(pending, path.join(directory, 'result.json'))
    pendingOwned = false
    checkCurrent()
    // No await between the final cancellation check and this commit callback.
    onPublished()
  } finally {
    if (pendingOwned) await fs.rm(pending, { force: true })
  }
}
