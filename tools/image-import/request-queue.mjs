const maxConcurrentReads = 2
const snapshotReads = new Set([
  'sceneweave_workflow', 'image_import_workflow', 'image_import_inspect',
  'image_import_item_preview', 'image_import_preview', 'image_import_vision_boundary',
])

export function imageToolEffect(name, args) {
  if (snapshotReads.has(name) || name === 'image_import_guided_selection' && !args?.target) return 'read'
  if (name !== 'image_import_build_project' && Object.hasOwn(args ?? {}, 'generation')) return 'checkpoint'
  return 'serial'
}

function decode(line) {
  if (!line.trim()) return null
  if (Buffer.byteLength(line) > 8 * 1024 * 1024) return { error: { code: -32600, message: 'Tool request exceeds 8MiB' } }
  let request
  try { request = JSON.parse(line) } catch { return { error: { code: -32700, message: 'Invalid JSON' } } }
  if (!request || Array.isArray(request) || typeof request !== 'object'
    || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
    || (request.id !== undefined && request.id !== null && !['string', 'number'].includes(typeof request.id))
    || (typeof request.id === 'number' && !Number.isFinite(request.id))) {
    return { error: { code: -32600, message: 'Invalid JSON-RPC request' } }
  }
  return { request }
}

export async function runImageRequestQueue(lines, handle) {
  const reads = []
  async function drainReads() {
    const results = await Promise.all(reads.splice(0))
    const failure = results.find(result => !result.ok)
    if (failure) throw failure.error
  }
  try {
    for await (const line of lines) {
      const entry = decode(line)
      if (!entry) continue
      const request = entry.request
      const isRead = request?.method === 'tools/call' && request.id !== undefined
        && imageToolEffect(request.params?.name, request.params?.arguments) === 'read'
      if (isRead) {
        reads.push(Promise.resolve().then(() => handle(entry)).then(() => ({ ok: true }), error => ({ ok: false, error })))
        if (reads.length === maxConcurrentReads) await drainReads()
      } else {
        await drainReads()
        await handle(entry)
      }
    }
  } finally {
    // Input can end while the browser is still completing the last snapshot reads.
    await drainReads()
  }
}
