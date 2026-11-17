import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { parseForestServerArguments } from './forest-server.mjs'
import { digest } from './io.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
test('forest MCP requires existing CLI authorization, budget and independent absolute output', () => {
  const args = ['--input', path.resolve('input.json'), '--output', path.resolve('new-output'), '--allow', 'forest-building', '--budget', 'standard']
  assert.equal(parseForestServerArguments(args).budget, 'standard')
  assert.equal(parseForestServerArguments(['--help']), null)
  for (const invalid of [args.slice(0, -2), [...args, '--resume', path.resolve('prior.json')], args.map(value => value === 'standard' ? 'unbounded' : value)]) assert.throws(() => parseForestServerArguments(invalid))
})

function host(input, output, children) {
  const child = spawn(process.execPath, ['tools/harness/forest-server.mjs', '--input', input, '--output', output, '--allow', 'forest-building', '--budget', 'standard'], {
    cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  children.add(child)
  let id = 0, stderr = ''
  const pending = new Map()
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  child.stdin.on('error', () => {})
  readline.createInterface({ input: child.stdout }).on('line', line => {
    const response = JSON.parse(line), record = pending.get(response.id)
    if (!record) return
    pending.delete(response.id); clearTimeout(record.timer)
    response.error ? record.reject(new Error(JSON.stringify(response.error))) : record.resolve(response.result)
  })
  const closed = new Promise(resolve => child.once('exit', code => {
    for (const record of pending.values()) { clearTimeout(record.timer); record.reject(new Error(stderr || `Host exit ${code}`)) }
    pending.clear(); resolve({ code, stderr })
  }))
  const call = (method, params) => new Promise((resolve, reject) => {
    const next = ++id, timer = setTimeout(() => { child.kill(); reject(new Error('Forest MCP timeout: ' + stderr)) }, 390000)
    pending.set(next, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n')
  })
  return { call, rawTool: (name, args = {}) => call('tools/call', { name, arguments: args }),
    tool: async (name, args = {}) => {
      const result = await call('tools/call', { name, arguments: args })
      assert.notEqual(result.isError, true, JSON.stringify(result.content))
      return JSON.parse(result.content.find(block => block.type === 'text').text)
    }, close: async () => { child.stdin.end(); return closed } }
}

test('real forest MCP discovers, generates through CLI, preserves cold files and refuses stale actions', { timeout: 420000 }, async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-forest-host-')), children = new Set()
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) child.kill()
    const checked = path.resolve(directory)
    assert.equal(path.dirname(checked), path.resolve(tmpdir()))
    assert.ok(path.basename(checked).startsWith('sceneweave-forest-host-'))
    await fs.rm(checked, { recursive: true, force: true })
  })
  const request = { capabilityId: 'sceneweave-forest-building@1', target: 'new-project', parameters: {
    title: 'Real forest MCP integration', environment: 'forest', widthMm: 40000, heightMm: 32000,
    seed: 'forest-outpost-1', roomCount: 2, purpose: '哨站休息室', furniture: true, vegetationMultiplier: 1,
  } }
  const input = path.join(directory, 'input.json'), output = path.join(directory, 'output')
  await fs.writeFile(input, JSON.stringify(request))
  const first = host(input, output, children)
  assert.equal((await first.call('initialize', {})).serverInfo.name, 'sceneweave-forest-building')
  const tools = (await first.call('tools/list')).tools
  assert.deepEqual(tools.map(tool => tool.name), ['sceneweave_forest_state', 'sceneweave_forest_action', 'sceneweave_workflow'])
  const discovery = await first.tool('sceneweave_workflow', { action: 'read', workflowId: 'sceneweave-forest-building' })
  assert.equal(discovery.host, 'harness')
  assert.equal(discovery.steps.find(step => step.id === 'generate').requirements[0].state, 'available')
  const before = await first.tool('sceneweave_forest_state')
  assert.equal(before.attemptsUsed, 0)
  const generated = await first.tool('sceneweave_forest_action', { kind: 'generate', stateHash: before.stateHash, seed: request.parameters.seed, reason: 'Execute fixed first candidate and read actual diagnostics.' })
  assert.equal(generated.attemptsUsed, 1)
  assert.equal(generated.receipts.length, 1)
  assert.equal(generated.receipts[0].entities.rooms, 2)
  assert.equal(generated.candidates.length, 1)
  const actual = generated.candidates[0]
  assert.equal(actual.diskVerification.changedPixels, 0)
  assert.ok(Array.isArray(actual.notes))
  assert.equal(actual.diagnostics.deficit, 4)
  assert.equal(actual.diagnostics.rooms.length, 2)
  assert.ok(actual.diagnostics.rooms.every(room => room.roles.some(role => role.deficit > 0 && role.rejections.length > 0)))
  const frozen = await fs.readFile(actual.files.project.path)
  assert.equal(digest(frozen), actual.files.project.sha256)
  const stale = await first.rawTool('sceneweave_forest_action', { kind: 'generate', stateHash: before.stateHash, seed: 'different-seed', reason: 'This stale action must not execute.' })
  assert.equal(stale.isError, true)
  const afterStale = await first.tool('sceneweave_forest_state')
  assert.equal(afterStale.attemptsUsed, 1)
  assert.equal(afterStale.stateHash, generated.stateHash)
  assert.deepEqual((await fs.readdir(output)).filter(name => /^candidate-/.test(name)), ['candidate-1'])
  let repairState = afterStale, selected = actual
  for (let index = 0; index < 2; index++) {
    const target = repairState.repairTargets.find(row => !repairState.receipts.some(receipt => receipt.repairRoomId === row.roomId))
    assert.ok(target, 'A distinct room with unmet furniture targets must be repairable')
    const parent = repairState.candidates.find(row => row.candidateId === target.candidateId)
    const parentBytes = await fs.readFile(parent.files.project.path)
    const beforeDocument = JSON.parse(new TextDecoder().decode(unzipSync(parentBytes)['scene.json']))
    repairState = await first.tool('sceneweave_forest_action', { kind: 'repair-furniture', stateHash: repairState.stateHash,
      candidateId: target.candidateId, roomId: target.roomId, reason: 'Repair only this actual room while keeping building geometry and other rooms.' })
    selected = repairState.candidates.at(-1)
    assert.equal(selected.parentCandidateId, parent.candidateId)
    assert.equal(selected.repairRoomId, target.roomId)
    assert.equal(selected.diskVerification.changedPixels, 0)
    assert.equal(selected.diagnostics.structureHash, actual.diagnostics.structureHash)
    assert.ok(selected.diagnostics.deficit < parent.diagnostics.deficit)
    assert.deepEqual(await fs.readFile(parent.files.project.path), parentBytes)
    const afterDocument = JSON.parse(new TextDecoder().decode(unzipSync(await fs.readFile(selected.files.project.path))['scene.json']))
    for (const field of ['rooms', 'walls', 'openings', 'vertices', 'terrainAreas', 'paths']) assert.deepEqual(afterDocument[field], beforeDocument[field], field)
    for (const prop of Object.values(beforeDocument.props).filter(prop => prop.roomId !== target.roomId)) assert.deepEqual(afterDocument.props[prop.id], prop)
    assert.equal(selected.files.project.sha256, digest(await fs.readFile(selected.files.project.path)))
  }
  assert.equal(repairState.attemptsUsed, 3)
  assert.ok(selected.diagnostics.deficit < actual.diagnostics.deficit)
  assert.deepEqual(repairState.nextActions, ['finish'])
  const completed = await first.tool('sceneweave_forest_action', { kind: 'finish', stateHash: repairState.stateHash, candidateId: selected.candidateId, reason: 'Keep this actual cold-verified candidate and report the remaining deficit honestly.' })
  assert.equal(completed.status, 'finished')
  assert.equal(completed.selected.files.project.path, selected.files.project.path)
  assert.equal(completed.decisionsUsed, 4)
  assert.equal((await first.close()).code, 0)
  assert.deepEqual(await fs.readFile(actual.files.project.path), frozen)
  const persisted = JSON.parse(await fs.readFile(path.join(output, 'result.json'), 'utf8'))
  assert.equal(persisted.state.status, 'finished')
  assert.equal(persisted.selected.candidateId, selected.candidateId)
  assert.equal(persisted.cumulative.generatedCandidates, 3)
  assert.equal(persisted.cumulative.modelRequests, 0)
  assert.equal(persisted.resumeSupported, false)
  const refusal = host(input, output, children)
  await assert.rejects(refusal.call('initialize', {}), /EEXIST/)
  assert.notEqual((await refusal.close()).code, 0)
  assert.deepEqual(await fs.readFile(actual.files.project.path), frozen)
  const independentOutput = path.join(directory, 'closed-host')
  const closedHost = host(input, independentOutput, children)
  await closedHost.call('initialize', {})
  assert.equal((await closedHost.close()).code, 0)
  const stopped = JSON.parse(await fs.readFile(path.join(independentOutput, 'result.json'), 'utf8'))
  assert.equal(stopped.state.status, 'stopped')
  assert.equal(stopped.state.attemptsUsed, 0)
})
