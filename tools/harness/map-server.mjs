import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, MAX_MAP_REQUEST_BYTES } from './io.mjs'
import { executeMap, mapBudget, mapPreviews, mapStage, readMapFlags, useMapDefinitions } from './map.mjs'
import { openSavedMap } from './map-verification.mjs'

const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const name = { type: 'string', description: 'A name under the local folder selected when starting the map server.' }
const projectPath = { type: 'string', description: 'Workspace-relative .sceneweave file. Use the result’s relativeProject for a generated candidate.' }
const stage = { type: 'string', enum: ['draft', 'complete'], default: 'complete',
  description: 'Draft returns a real saved preview for review. Complete also performs independent delivery verification.' }
const spelling = /^[\p{L}\p{N}_-][\p{L}\p{N}_. -]{0,119}$/u
const device = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i
export const MAX_MAP_RPC_BYTES = MAX_MAP_REQUEST_BYTES + 16 * 1024

/** Keep at most one bounded frame. Discard the rest of an oversized line. */
export function readMapRpcFrames(input, onFrame) {
  const buffer = Buffer.alloc(MAX_MAP_RPC_BYTES), utf8 = new TextDecoder('utf-8', { fatal: true })
  let length = 0, oversized = false
  const emit = () => {
    let value
    try { if (!oversized) value = utf8.decode(buffer.subarray(0, length)) } catch { /* Invalid UTF-8 frame. */ }
    length = 0; oversized = false
    onFrame(value)
  }
  const read = chunk => {
    for (let start = 0; start < chunk.length;) {
      const newline = chunk.indexOf(10, start), end = newline < 0 ? chunk.length : newline
      if (length + end - start > buffer.length) oversized = true
      if (!oversized) {
        chunk.copy(buffer, length, start, end)
        length += end - start
      }
      if (newline >= 0) emit()
      start = end + 1
    }
  }
  const flush = () => { if (length || oversized) emit() }
  input.on('data', read)
  input.on('end', flush)
  return () => { input.off('data', read); input.off('end', flush); input.pause() }
}

function safeName(value) {
  assert(typeof value === 'string' && spelling.test(value) && !device.test(value) && !/[. ]$/.test(value), 'Use a simple workspace filename or directory name.')
  return value
}

function confined(workspace, candidate) {
  const relative = path.relative(workspace, candidate)
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Path escapes the authorized map directory.')
  return candidate
}

async function scopedFile(workspace, value) {
  assert(typeof value === 'string', 'Provide a workspace-relative .sceneweave path.')
  const parts = value.split(/[\\/]/).map(safeName)
  assert(parts.at(-1).endsWith('.sceneweave'), 'Select a .sceneweave file.')
  return confined(workspace, await fs.realpath(path.join(workspace, ...parts)))
}

export function parseMapServerArgs(args) {
  const flags = readMapFlags(args, ['--workspace', '--allow', '--budget'])
  const workspace = flags.get('--workspace')
  assert(flags.get('--allow') === 'map-authoring' && workspace && path.isAbsolute(workspace), 'Use --workspace ABS_DIR --allow map-authoring [--budget standard].')
  return { workspace: path.resolve(workspace), budget: mapBudget(flags.get('--budget')) }
}

function defineTools(definitions, discovery) {
  const { examples, schemas } = definitions.mapAuthoringCapabilities()
  // Use the actual JSON carried by MCP, excluding non-enumerable metadata
  // attached by Zod's converter before the shared catalogue hashes the tools.
  const { generate, inspect, edit } = JSON.parse(JSON.stringify(schemas))
  return [
    { name: discovery.name, description: discovery.description, inputSchema: discovery.parameters },
    { name: 'sceneweave_map_example', description: 'Return a small runnable generation request for a map recipe or free layout.',
      inputSchema: objectSchema({ kind: { type: 'string', enum: examples } }) },
    { name: 'sceneweave_map_generate', description: 'Create a map candidate in a new authorized folder. Returns the editable project, preview paths and actual diagnostics.',
      inputSchema: objectSchema({ output: name, request: generate, stage }, ['output', 'request']) },
    { name: 'sceneweave_map_inspect', description: 'Read public geometry, stable object IDs and the baseline hash from a local map.',
      inputSchema: objectSchema({ project: projectPath, request: inspect }, ['project']) },
    { name: 'sceneweave_map_edit', description: 'Apply one validated local edit to the exact input project and deliver a separate editable candidate.',
      inputSchema: objectSchema({ project: projectPath, output: name, request: edit, stage }, ['project', 'output', 'request']) },
    { name: 'sceneweave_map_verify', description: 'Independently reopen a saved candidate and verify the exact project and all of its saved preview pixels in a separate delivery directory.',
      inputSchema: objectSchema({ candidate: name, output: name,
        previews: { enum: ['keep', 'redraw'], type: 'string', default: 'keep', description: 'Redraw missing or broken previews from the existing project, then verify the redraw.' },
        editor: { type: 'boolean', default: false, description: 'Also open the exact file through the regular editor in a disposable browser.' } }, ['candidate', 'output']) },
    { name: 'sceneweave_map_preview', description: 'View a verified map preview, or explicitly opt into viewing an unverified draft.',
      inputSchema: objectSchema({ output: name, view: { type: 'string', enum: ['top', 'oblique', 'diagnostic'], default: 'top' },
        draft: { type: 'boolean', default: false } }, ['output']) },
  ]
}

const content = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })

export async function openMapToolHost(options) {
  const workspace = await fs.realpath(options.workspace)
  assert((await fs.stat(workspace)).isDirectory(), 'The authorized map workspace must be a directory.')
  const { definitions, catalog } = await useMapDefinitions((definitions, catalog) => ({ definitions, catalog }))
  const tools = defineTools(definitions, catalog.WORKFLOW_DISCOVERY_TOOL)
  const host = catalog.mapMcpWorkflowHost(tools.map(({ name, inputSchema }) => ({ name, parameters: inputSchema })))
  const allowed = new Map(tools.map(tool => [tool.name, tool.inputSchema]))
  return { tools, async call(tool, args = {}, signal) {
    const schema = allowed.get(tool)
    assert(schema && args && typeof args === 'object' && !Array.isArray(args), 'Unknown map tool or invalid arguments.')
    assert(Object.keys(args).every(key => Object.hasOwn(schema.properties, key)), 'Unexpected tool argument.')
    assert((schema.required ?? []).every(key => Object.hasOwn(args, key)), 'Missing required tool argument.')
    switch (tool) {
      case 'sceneweave_workflow':
        return content(catalog.queryWorkflow(args, host))
      case 'sceneweave_map_example':
        assert(args.kind === undefined || typeof args.kind === 'string', 'Invalid example kind.')
        return content(definitions.mapAuthoringExample(args.kind))
      case 'sceneweave_map_preview': {
        const view = args.view ?? 'top', draft = args.draft ?? false
        assert(view === 'top' || view === 'oblique' || view === 'diagnostic', 'Choose top, oblique or diagnostic.')
        assert(typeof draft === 'boolean', 'Draft preview permission must be a boolean.')
        const directory = confined(workspace, await fs.realpath(path.join(workspace, safeName(args.output))))
        const { record, file } = await openSavedMap(directory)
        const key = view === 'top' ? 'preview' : view
        assert(record.files?.[key] && (record.status === 'complete'
          || draft && record.candidateReadyAt && ['draft', 'verifying', 'failed'].includes(record.status)),
        'This candidate has no verified preview for the requested view. For an unverified candidate, explicitly request a draft preview.')
        const bytes = await file(key)
        assert(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'The candidate does not contain a PNG preview.')
        return { content: [{ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }] }
      }
      default: {
        const action = tool.slice('sceneweave_map_'.length)
        const project = action === 'inspect' || action === 'edit' ? await scopedFile(workspace, args.project) : undefined
        const candidate = action === 'verify' ? confined(workspace, await fs.realpath(path.join(workspace, safeName(args.candidate)))) : undefined
        const outputName = action !== 'inspect' ? safeName(args.output) : undefined
        const output = outputName === undefined ? undefined : path.join(workspace, outputName)
        const result = await executeMap({ action, request: action === 'inspect' ? args.request ?? {} : args.request,
          output, project, candidate, stage: mapStage(args.stage), previews: mapPreviews(args.previews), editor: args.editor, budget: options.budget, signal })
        return content(outputName === undefined ? result : { ...result, relativeProject: outputName + '/map.sceneweave' })
      }
    }
  } }
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('node tools/harness/map-server.mjs --workspace ABS_DIR --allow map-authoring [--budget standard]\n')
    return
  }
  const host = await openMapToolHost(parseMapServerArgs(args))
  let running
  let stop
  const closing = new Promise(resolve => { stop = resolve })
  const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  const onCancel = () => { running?.controller.abort(); stop() }
  process.once('SIGINT', onCancel)
  process.once('SIGTERM', onCancel)
  const close = readMapRpcFrames(process.stdin, line => {
    let request
    try {
      assert(line !== undefined, `MCP frame limit: ${MAX_MAP_RPC_BYTES} UTF-8 bytes.`)
      request = JSON.parse(line)
      assert(request && request.jsonrpc === '2.0' && typeof request.method === 'string', 'Invalid JSON-RPC request.')
    } catch (error) {
      send({ id: null, error: { code: -32600, message: `Invalid MCP request. ${error.message}` } })
      return
    }
    const { id, method, params } = request
    if (method === 'notifications/cancelled' && params?.requestId === running?.id) running?.controller.abort()
    if (id === undefined) return
    const response = result => send({ id, result })
    if (method === 'initialize') {
      response({ protocolVersion: protocolVersions.includes(params?.protocolVersion) ? params.protocolVersion : protocolVersions[0],
        capabilities: { tools: {} }, serverInfo: { name: 'sceneweave-map', version: '1.0.0' } })
    } else if (method === 'ping') response({})
    else if (method === 'tools/list') response({ tools: host.tools })
    else if (method === 'tools/call') {
      if (running) { response({ ...content({ message: 'A map tool call is already running.' }), isError: true }); return }
      const controller = new AbortController()
      const done = host.call(params?.name, params?.arguments, controller.signal)
        .then(response, error => response({ ...content({ code: error.code ?? 'map_tool_failed', message: error.message,
          ...(error.issues ? { issues: error.issues } : {}), ...(error.details ? { details: error.details } : {}) }), isError: true }))
        .finally(() => { running = undefined })
      running = { id, controller, done }
    } else send({ id, error: { code: -32601, message: 'Method not found.' } })
  })
  process.stdin.once('end', stop)
  await closing
  close()
  process.stdin.removeListener('end', stop)
  running?.controller.abort()
  await running?.done
  process.removeListener('SIGINT', onCancel)
  process.removeListener('SIGTERM', onCancel)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(error.message + '\n')
    process.exitCode = 1
  })
}
