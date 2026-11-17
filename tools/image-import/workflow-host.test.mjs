import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('real MCP discovery, checkpoint export and resume bind the archive and preserve advancing generations', { timeout: 120000 }, async t => {
  const output = await fs.mkdtemp(path.join(tmpdir(), 'sceneweave-workflow-host-')), children = new Set()
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) child.kill()
    const target = path.resolve(output), parent = path.resolve(tmpdir())
    assert.equal(path.dirname(target), parent)
    assert.ok(path.basename(target).startsWith('sceneweave-workflow-host-'))
    await fs.rm(target, { recursive: true, force: true })
  })
  const browser = await chromium.launch({ headless: true, ...(process.env.SCENEWEAVE_BROWSER_CHANNEL ? { channel: process.env.SCENEWEAVE_BROWSER_CHANNEL } : {}) })
  try {
    const page = await browser.newPage()
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
      const context = canvas.getContext('2d'); context.fillStyle = '#e8dfcc'; context.fillRect(0, 0, 64, 64)
      context.fillStyle = '#64492d'; context.fillRect(16, 16, 32, 32)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await fs.writeFile(path.join(output, 'fixture.png'), Buffer.from(png, 'base64'))
    await fs.writeFile(path.join(output, 'license.txt'), 'Synthetic test fixture. CC0-1.0.')
  } finally { await browser.close() }

  function host(args) {
    const child = spawn(process.execPath, ['tools/image-import/server.mjs', ...args, '--output', output], {
      cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    children.add(child)
    const pending = new Map(); let id = 0, stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdin.on('error', () => {})
    readline.createInterface({ input: child.stdout }).on('line', line => {
      const response = JSON.parse(line), handlers = pending.get(response.id)
      if (!handlers) return
      pending.delete(response.id); clearTimeout(handlers.timer)
      response.error ? handlers.reject(new Error(JSON.stringify(response.error))) : handlers.resolve(response.result)
    })
    const closed = new Promise(resolve => child.once('exit', code => {
      for (const handlers of pending.values()) { clearTimeout(handlers.timer); handlers.reject(new Error(stderr || `Exit ${code}`)) }
      pending.clear(); resolve({ code, stderr })
    }))
    const call = (method, params) => new Promise((resolve, reject) => {
      const next = ++id, timer = setTimeout(() => { child.kill(); reject(new Error('MCP timed out: ' + stderr)) }, 60000)
      pending.set(next, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n')
    })
    return { call, tool: async (name, args = {}) => {
      const response = await call('tools/call', { name, arguments: args })
      assert.notEqual(response.isError, true, JSON.stringify(response.content))
      return JSON.parse(response.content.find(block => block.type === 'text').text)
    }, close: async () => { child.stdin.end(); return closed } }
  }
  const first = host(['--image', path.join(output, 'fixture.png'), '--license-file', path.join(output, 'license.txt'), '--attribution', 'Synthetic fixture'])
  await first.call('initialize', {})
  assert.ok((await first.call('tools/list')).tools.some(tool => tool.name === 'sceneweave_workflow'))
  const found = await first.tool('sceneweave_workflow', { action: 'read', workflowId: 'sceneweave-image-items' })
  assert.equal(found.steps[0].requirements[0].state, 'available')
  assert.equal(found.steps[2].requirements[0].state, 'missing-input')
  await first.tool('image_import_set_checkpoint', { generation: 0, notes: 'Unresolved edge', nextAction: 'Review synthetic square', scaleStatus: 'provisional' })
  const exported = await first.tool('image_import_export_work')
  assert.ok(exported.workflowCompanion)
  const companion = JSON.parse(await fs.readFile(exported.workflowCompanion, 'utf8'))
  assert.equal(companion.generation, exported.generation)
  assert.equal((await first.close()).code, 0)

  const resumed = host(['--resume', exported.path])
  const progress = await resumed.tool('sceneweave_workflow', { action: 'progress' })
  assert.equal(progress.resumeBindingStatus, 'bound')
  assert.equal(progress.progress.generation, exported.generation + 1)
  const actual = await resumed.tool('image_import_workflow')
  assert.equal(actual.notes, 'Unresolved edge'); assert.equal(actual.nextAction, 'Review synthetic square')
  assert.equal((await resumed.close()).code, 0)

  await fs.writeFile(exported.workflowCompanion, JSON.stringify({ ...companion, binding: { ...companion.binding, definitionHash: '0'.repeat(64) } }))
  const stale = host(['--resume', exported.path])
  await assert.rejects(stale.call('initialize', {}), /定义已变化/)
  assert.notEqual((await stale.close()).code, 0)
  await fs.writeFile(exported.workflowCompanion, JSON.stringify({ ...companion, generation: exported.generation + 1 }))
  const wrongGeneration = host(['--resume', exported.path])
  await assert.rejects(wrongGeneration.call('initialize', {}), /实际代次不符/)
  assert.notEqual((await wrongGeneration.close()).code, 0)

  await fs.unlink(exported.workflowCompanion)
  const legacy = host(['--resume', exported.path])
  assert.equal((await legacy.tool('sceneweave_workflow', { action: 'progress' })).resumeBindingStatus, 'legacy-unbound')
  assert.equal((await legacy.tool('image_import_workflow')).notes, 'Unresolved edge')
  assert.equal((await legacy.close()).code, 0)
})
