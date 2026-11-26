import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { executeMap, parseMapCli } from './map.mjs'
import { MAX_MAP_RPC_BYTES, parseMapServerArgs, readMapRpcFrames } from './map-server.mjs'
import { digest, MAX_MAP_REQUEST_BYTES, readRequest } from './io.mjs'
import { captureMapCandidate, compareMapPng } from './map-verification.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('CLI and MCP require explicit local scope and accept a bounded default budget', () => {
  const input = path.resolve('request.json'), output = path.resolve('new-map')
  const args = ['generate', '--input', input, '--output', output, '--allow', 'map-authoring']
  assert.equal(parseMapCli(args).budget, 'standard')
  assert.equal(parseMapCli([...args, '--stage', 'draft']).stage, 'draft')
  const referenceInput = ['reference', '--image', path.resolve('guide.png'), '--input', path.resolve('guide.json'),
    '--output', path.resolve('new-outline'), '--allow', 'map-authoring']
  assert.equal(parseMapCli(referenceInput).action, 'reference')
  assert.equal(parseMapCli(referenceInput).referenceStage, undefined)
  assert.equal(parseMapCli([...referenceInput, '--stage', 'draft']).referenceStage, 'draft')
  assert.equal(parseMapCli(['diagnose', '--input', path.resolve('map.json'), '--allow', 'map-authoring']).action, 'diagnose')
  assert.throws(() => parseMapCli(['reference', '--image', 'relative.png', '--input', path.resolve('guide.json'),
    '--output', path.resolve('new-outline'), '--allow', 'map-authoring']), /absolute/i)
  assert.throws(() => parseMapCli(args.slice(0, -2)), /explicit/)
  assert.throws(() => parseMapCli([...args, '--budget', 'unlimited']), /budget/)
  assert.equal(parseMapServerArgs(['--workspace', output, '--allow', 'map-authoring']).workspace, output)
  assert.throws(() => parseMapServerArgs(['--workspace', 'relative', '--allow', 'map-authoring']), /workspace/)
  const verify = ['verify', '--candidate', path.resolve('prior-map'), '--output', output, '--allow', 'map-authoring']
  assert.equal(parseMapCli(verify).action, 'verify')
  assert.equal(parseMapCli([...verify, '--previews', 'redraw']).previews, 'redraw')
  assert.equal(parseMapCli([...verify, '--editor', 'reopen']).editor, true)
  assert.throws(() => parseMapCli([...verify, '--editor', 'yes']), /reopen/)
  assert.throws(() => parseMapCli([...verify, '--stage', 'draft']), /Unknown/)
})

test('MCP frame reader discards overlong lines and keeps split UTF-8 framed correctly', async () => {
  const input = new PassThrough(), actual = []
  const dispose = readMapRpcFrames(input, value => actual.push(value))
  input.write(Buffer.alloc(MAX_MAP_RPC_BYTES - 1, 'a'))
  input.write(Buffer.from('ab\n'))
  const next = Buffer.from('{"path":"海滩"}\n')
  input.write(next.subarray(0, 10))
  input.end(next.subarray(10))
  await new Promise(resolve => input.once('end', resolve))
  dispose()
  assert.deepEqual(actual, [undefined, '{"path":"海滩"}'])
})

test('exact PNG comparison preserves alpha and counts changed pixels once', () => {
  const bytes = n => {
    const data = Buffer.alloc(29, n)
    data.writeUInt32BE(2, 16); data.writeUInt32BE(2, 20)
    return data
  }
  const decode = data => ({ width: 2, height: 2, rgba: new Uint8ClampedArray([
    14, 16, 18, 255, 7, 11, data[0], 0, 9, 20, 30, 255, 2, 4, 8, 255,
  ]) })
  assert.deepEqual(compareMapPng(bytes(1), bytes(1), 2, decode), { width: 2, height: 2, changedPixels: 0 })
  assert.deepEqual(compareMapPng(bytes(1), bytes(2), 2, decode), { width: 2, height: 2, changedPixels: 1,
    firstDifference: { x: 1, y: 0, savedRgba: [7, 11, 1, 0], redrawnRgba: [7, 11, 2, 0] } })
  assert.throws(() => compareMapPng(bytes(3), bytes(3), 1, decode), /尺寸/)
})

function connect(workspace) {
  const host = spawn(process.execPath, ['tools/harness/map-server.mjs', '--workspace', workspace, '--allow', 'map-authoring'], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let id = 0, stderr = ''
  const pending = new Map()
  host.stderr.on('data', bytes => { stderr += bytes.toString() })
  host.stdin.on('error', () => {})
  const lines = readline.createInterface({ input: host.stdout })
  lines.on('line', line => {
    const reply = JSON.parse(line), callback = pending.get(reply.id)
    pending.delete(reply.id)
    callback?.resolve(reply.result)
  })
  const stopped = new Promise(resolve => host.once('close', code => {
    for (const callback of pending.values()) callback.reject(new Error(stderr || `MCP exited with code ${code}`))
    resolve(code)
  }))
  const call = (method, params) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    host.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return {
    call,
    raw: (name, args = {}) => call('tools/call', { name, arguments: args }),
    async tool(name, args) {
      const result = await this.raw(name, args)
      assert.notEqual(result.isError, true, JSON.stringify(result.content))
      return result.structuredContent
    },
    async close() { host.stdin.end(); return stopped },
  }
}

test('CLI and MCP deliver real candidates, preserve a dense contour, and revise only the exact input', { timeout: 540000 }, async t => {
  const workspace = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-map-test-'))
  t.after(async () => {
    const checked = path.resolve(workspace)
    assert.equal(path.dirname(checked), path.resolve(tmpdir()))
    assert.match(path.basename(checked), /^sceneweave-map-test-/)
    await fs.rm(checked, { recursive: true, force: true })
  })
  const host = connect(workspace)
  t.after(() => host.close())
  const init = await host.call('initialize', { protocolVersion: '2025-06-18' })
  assert.equal(init.protocolVersion, '2025-06-18')
  const { tools } = await host.call('tools/list')
  assert(tools.some(tool => tool.name === 'sceneweave_map_edit'))
  assert.equal(tools.find(tool => tool.name === 'sceneweave_map_verify').inputSchema.properties.editor.type, 'boolean')
  assert.deepEqual(tools.find(tool => tool.name === 'sceneweave_map_reference').inputSchema.properties.stage.enum, ['draft', 'complete'])
  const workflow = await host.tool('sceneweave_workflow', { action: 'read', workflowId: 'sceneweave-map-authoring' })
  assert.equal(workflow.host, 'map-mcp')
  assert.equal(workflow.steps.find(step => step.id === 'revise').requirements[1].state, 'available')
  assert.equal(workflow.steps.find(step => step.id === 'deliver').requirements[0].state, 'available')

  const regions = Array.from({ length: 66 }, (_, i) => {
    const x = 500 + i % 11 * 1400, y = 500 + Math.floor(i / 11) * 1400
    return { kind: 'terrain', id: `ground-${i}`, boundary: [
      { x, y }, { x: x + 800, y }, { x: x + 800, y: y + 800 }, { x, y: y + 800 },
    ] }
  })
  const starter = await executeMap({ action: 'generate', request: { title: 'Open ground', operations: regions },
    output: path.join(workspace, 'starter') })
  assert.equal(starter.scene.counts.terrainAreas, 66)
  assert.equal(starter.diskVerification.changedPixels, 0)

  const interior = await host.tool('sceneweave_map_example', { kind: 'interior' })
  const clinicDraft = await executeMap({ action: 'generate', stage: 'draft', request: interior, output: path.join(workspace, 'clinic-draft') })
  assert.equal(clinicDraft.status, 'draft')
  assert.equal((await host.raw('sceneweave_map_preview', { output: 'clinic-draft' })).isError, true)
  const draftPreview = await host.raw('sceneweave_map_preview', { output: 'clinic-draft', draft: true })
  assert.equal(draftPreview.content[0].type, 'image')
  const clinic = await host.tool('sceneweave_map_verify', { candidate: 'clinic-draft', output: 'clinic', editor: true })
  assert.equal(clinic.status, 'complete')
  assert.deepEqual(clinic.files, clinicDraft.files)
  assert.equal(clinic.diskVerification.changedPixels, 0)
  assert.equal(clinic.editorVerification.topReady, true)
  assert.equal(clinic.editorVerification.locallySaved, true)
  assert.equal(clinic.scene.counts.rooms, 2)
  assert(clinic.scene.objects.some(row => row.purpose === '接待室'))
  assert(clinicDraft.recipeReport.connectivity.entranceOpeningId)
  assert.deepEqual(await readRequest(path.join(clinic.output, 'request.json'), MAX_MAP_REQUEST_BYTES), interior)
  await fs.appendFile(clinicDraft.paths.preview, Buffer.from([0]))
  await assert.rejects(captureMapCandidate(clinicDraft.output), /候选文件与回执不符/)
  assert.equal((await captureMapCandidate(clinicDraft.output, 'redraw')).projectHash, clinicDraft.projectHash)

  const reference = await host.tool('sceneweave_map_example', { kind: 'landscape-reference' })
  reference.recipe.density = .08
  reference.recipe.scenery = []
  const headland = await host.tool('sceneweave_map_generate', { output: 'headland', request: reference, stage: 'draft' })
  const oldHeadland = await fs.readFile(headland.paths.project)
  const newHeadland = await host.tool('sceneweave_map_edit', { project: headland.relativeProject, output: 'south-route',
    request: { projectHash: headland.projectHash, floorId: headland.floorId, referenceSizePx: reference.referenceSizePx, referenceMapping: 'fit',
      operations: [
        { kind: 'path-update', id: 'ascent', around: { landmarkId: 'summit', side: 'south' } },
        { kind: 'scenery-zone', id: 'lowland-trees', areaId: 'headland', density: 1,
          region: { at: { x: 239, y: 302 }, radius: { x: 76, y: 42 } } },
        { kind: 'cover-zone', id: 'sand-near-path', areaId: 'headland', cover: 'sand',
          region: { at: { x: 239, y: 302 }, radius: { x: 45, y: 32 } } },
      ] } })
  assert.equal(newHeadland.parentProjectHash, headland.projectHash)
  assert.equal(newHeadland.revision, headland.revision + 1)
  assert(newHeadland.routeChecks.some(check => check.id === 'ascent' && check.ok && check.treadCount > 0))
  assert(newHeadland.changes.some(change => change.id === 'headland' && change.kind === 'terrainAreas'))
  assert(newHeadland.changes.some(change => change.id === 'lowland-trees' && change.kind === 'scatterGroups'))
  assert(newHeadland.changes.some(change => change.kind === 'props' && change.status === 'added'))
  assert.equal(newHeadland.diskVerification.oblique.changedPixels, 0)
  assert.deepEqual(await fs.readFile(headland.paths.project), oldHeadland)
  const tea = await host.tool('sceneweave_map_edit', { project: newHeadland.relativeProject, output: 'south-tea', stage: 'draft',
    request: { projectHash: newHeadland.projectHash, floorId: newHeadland.floorId, operations: [{ kind: 'art-style', style: 'tea' }] } })
  assert.equal(tea.artStyle, 'tea')
  assert.deepEqual(tea.changes, [{ id: 'scene', kind: 'artStyle', status: 'updated' }])
  assert.notEqual(tea.files.preview.sha256, newHeadland.files.preview.sha256)

  const request = await host.tool('sceneweave_map_example', { kind: 'layout' })
  const shoreline = Array.from({ length: 135 }, (_, index) => {
    const angle = index * 2 * Math.PI / 135
    return { x: Math.round(140 + 123 * Math.cos(angle)), y: Math.round(106 + 80 * Math.sin(angle)) }
  })
  request.operations.find(row => row.id === 'land').boundary = shoreline
  delete request.operations.find(row => row.id === 'station').material
  request.operations.push(
    { kind: 'terrain', id: 'terrace', boundary: [{ x: 160, y: 67 }, { x: 230, y: 67 }, { x: 230, y: 131 }, { x: 160, y: 131 }],
      material: 'rock', elevationMm: 1600, priority: 3 },
    { kind: 'connection', id: 'climb', from: { at: { x: 138, y: 101 }, support: { kind: 'terrainArea', id: 'land' } },
      to: { at: { x: 182, y: 101 }, support: { kind: 'terrainArea', id: 'terrace' } }, widthMm: 1400 },
  )
  request.checks.push({ id: 'climb-check', points: [{ x: 130, y: 101 }, { x: 196, y: 101 }], widthMm: 1000 })
  const coast = await host.tool('sceneweave_map_generate', { request, output: 'lookout' })
  assert.equal(coast.scene.counts.connections, 1)
  assert(coast.routeChecks.every(check => check.ok))
  assert.deepEqual(coast.routeChecks.find(check => check.id === 'climb-check').connectionIds, ['climb'])
  assert.equal(coast.usage.curveSegments, 0)
  assert.equal(coast.diskVerification.changedPixels, 0)
  assert.equal(coast.diskVerification.oblique.changedPixels, 0)
  const preview = await host.raw('sceneweave_map_preview', { output: 'lookout', view: 'oblique' })
  assert.equal(preview.content[0].type, 'image')
  assert.equal(digest(Buffer.from(preview.content[0].data, 'base64')), coast.files.oblique.sha256)

  const original = await fs.readFile(coast.paths.project)
  const inspected = await host.tool('sceneweave_map_inspect', { project: coast.relativeProject, request: { query: 'land' } })
  assert.equal(inspected.projectHash, coast.projectHash)
  assert.equal(inspected.objects.find(row => row.id === 'land').boundary.length, 135)
  const edit = { projectHash: inspected.projectHash, floorId: inspected.floorId, oblique: false,
    operations: [{ kind: 'path-update', id: 'track', widthMm: 1400 }] }
  const stale = await host.raw('sceneweave_map_edit', { project: coast.relativeProject, output: 'rejected',
    request: { ...edit, projectHash: '0'.repeat(64) } })
  assert.equal(stale.isError, true)
  assert.equal(stale.structuredContent.code, 'stale_candidate')
  const updated = await host.tool('sceneweave_map_edit', { project: coast.relativeProject, output: 'revision', request: edit })
  assert.equal(updated.parentProjectHash, coast.projectHash)
  assert.equal(updated.revision, coast.revision + 1)
  assert.deepEqual(updated.changes, [{ id: 'track', kind: 'paths', status: 'updated' }])
  assert.equal(updated.scene.objects.find(row => row.id === 'track').widthMm, 1400)
  assert.deepEqual(await fs.readFile(coast.paths.project), original)
  assert.equal((await host.raw('sceneweave_map_inspect', { project: '../other.sceneweave' })).isError, true)

  const landscape = await host.tool('sceneweave_map_example', { kind: 'landscape' })
  landscape.recipe.environment = 'coast'
  landscape.recipe.land[0] = { id: 'upland', boundary: Array.from({ length: 135 }, (_, i) => {
    const a = i * Math.PI * 2 / 135
    return { x: Math.round(505 + 458 * Math.cos(a)), y: Math.round(495 + 431 * Math.sin(a)) }
  }) }
  landscape.recipe.land.push(
    { id: 'shoal-rock', form: 'reef', at: { x: 65, y: 180 }, radius: { x: 20, y: 30 }, elevationMm: 700 },
    { id: 'cut-dock', form: 'flat', shore: 'hard', elevationMm: 480, boundary: [
      { x: 871, y: 42 }, { x: 972, y: 42 }, { x: 972, y: 92 }, { x: 871, y: 92 },
    ] },
  )
  const sculpted = await host.tool('sceneweave_map_generate', { request: landscape, output: 'sculpted' })
  assert.equal(sculpted.usage.curveSegments, 0)
  assert.equal(sculpted.diskVerification.oblique.changedPixels, 0)
  assert(sculpted.routeChecks.some(check => check.source === 'road' && check.ok && check.treadCount > 0 && check.widthMm === 2000))
  const terrain = await host.tool('sceneweave_map_inspect', { project: sculpted.relativeProject, request: { query: 'upland' } })
  const hillside = terrain.objects.find(row => row.id === 'upland')
  assert.equal(hillside.boundary.length, 135)
  assert(hillside.relief.maximumMm - hillside.relief.minimumMm > 4500)
  const dock = sculpted.scene.objects.find(row => row.id === 'cut-dock')
  assert.equal(dock.boundary.length, 4)
  assert.equal(dock.boundary[0].y, dock.boundary[1].y)

  const route = await host.tool('sceneweave_map_inspect', { project: sculpted.relativeProject, request: { query: 'lookout-trail' } })
  const anchors = route.objects.find(row => row.id === 'lookout-trail').anchors
  anchors[2].x += 30
  const switched = await host.tool('sceneweave_map_edit', { project: sculpted.relativeProject, output: 'moved-anchor',
    request: { projectHash: route.projectHash, floorId: route.floorId, operations: [{ kind: 'path-update', id: 'lookout-trail', points: anchors }] } })
  assert.deepEqual(switched.scene.objects.find(row => row.id === 'lookout-trail').anchors, anchors)
  assert.deepEqual(switched.changes, [{ id: 'lookout-trail', kind: 'paths', status: 'updated' }])
  assert(switched.routeChecks.some(check => check.ok && check.widthMm === 2000))
  assert.equal(switched.diskVerification.oblique.changedPixels, 0)
})
