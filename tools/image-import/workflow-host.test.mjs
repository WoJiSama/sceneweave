import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { chromium } from '@playwright/test'
import { unzipSync } from 'fflate'
import { digest } from '../harness/io.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('real image MCP extracts, resumes and delivers an editable project under one workflow binding', { timeout: 120000 }, async t => {
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
    return { call, tool: async (name, args = {}, checkpoint) => {
      const response = await call('tools/call', { name, arguments: args })
      assert.notEqual(response.isError, true, JSON.stringify(response.content))
      if (checkpoint) {
        const receipt = response.content.filter(block => block.type === 'text').map(block => JSON.parse(block.text)).find(value => value.checkpoint || value.checkpointError)
        assert.ok(receipt?.checkpoint, JSON.stringify(receipt))
        checkpoint(receipt.checkpoint)
      }
      return JSON.parse(response.content.find(block => block.type === 'text').text)
    }, close: async () => { child.stdin.end(); return closed } }
  }
  const first = host(['--image', path.join(output, 'fixture.png'), '--license-file', path.join(output, 'license.txt'), '--attribution', 'Synthetic fixture'])
  await first.call('initialize', {})
  assert.ok((await first.call('tools/list')).tools.some(tool => tool.name === 'sceneweave_workflow'))
  const found = await first.tool('sceneweave_workflow', { action: 'read', workflowId: 'sceneweave-image-items' })
  assert.equal(found.steps[0].requirements[0].state, 'available')
  assert.equal(found.steps.find(step => step.id === 'review').requirements[0].state, 'missing-input')
  assert.equal(found.steps.find(step => step.id === 'review-repair').requirements[0].state, 'missing-input')
  const source = await first.tool('image_import_workflow')
  const point = (x, y) => ({ x, y })
  const rectangle = (left, top, right, bottom) => [point(left, top), point(right, top), point(right, bottom), point(left, bottom)]
  const beforeScale = first.tool('image_import_inspect')
  const beforeProgress = first.tool('sceneweave_workflow', { action: 'progress' })
  const changeScale = first.tool('image_import_set_scale', { generation: source.generation, first: point(4, 4), second: point(60, 4), distanceMm: 5600 })
  const afterScale = first.tool('image_import_inspect')
  const afterProgress = first.tool('sceneweave_workflow', { action: 'progress' })
  const [before, oldProgress, scaled, after, newProgress] = await Promise.all([beforeScale, beforeProgress, changeScale, afterScale, afterProgress])
  assert.equal(before.generation, source.generation)
  assert.equal(oldProgress.progress.generation, source.generation)
  assert.equal(after.generation, scaled.generation)
  assert.equal(newProgress.progress.generation, scaled.generation)
  const room = await first.tool('image_import_set_room', { generation: scaled.generation, points: rectangle(1, 1, 63, 63) })
  const target = 'synthetic-crate'
  const extracted = await first.tool('image_import_extract_item', { generation: room.generation, id: target,
    name: 'Synthetic crate', polygon: rectangle(16, 16, 48, 48), donor: { x: 1, y: 1, width: 12, height: 12 }, renderLayer: 'object', blocksMovement: true })
  const item = await first.tool('image_import_item_preview', { target })
  assert.equal(item.generation, extracted.generation)
  const enhancement = { target, direction: 'clarity', count: 2 }
  const draftImages = await first.tool('image_import_enhancement_candidates', enhancement)
  const repeatedImages = await first.tool('image_import_enhancement_candidates', enhancement)
  assert.deepEqual(await fs.readdir(path.dirname(draftImages.path)), ['candidates.json'])
  assert.equal(draftImages.source.storage, 'cache')
  assert.deepEqual(draftImages.paths, repeatedImages.paths)
  assert.equal(digest(await fs.readFile(draftImages.paths.source)), draftImages.source.sha256)
  const keptImages = await first.tool('image_import_enhancement_candidates', { ...enhancement, saveImages: true })
  assert.equal(path.dirname(keptImages.paths.source), path.dirname(keptImages.path))
  assert.deepEqual(await fs.readFile(keptImages.paths.source), await fs.readFile(draftImages.paths.source))
  const review = await first.tool('image_import_review_item', { generation: item.generation, target, inputHash: item.inputHash, verdict: 'needs-work', note: 'Synthetic edge awaiting visual review' })
  let localCheckpoint
  await first.tool('image_import_set_checkpoint', { generation: review.generation, notes: 'Unresolved edge', nextAction: 'Review synthetic square', scaleStatus: 'measured' },
    value => { localCheckpoint = value })
  assert.match(localCheckpoint.path, /\.sceneweave-image-checkpoint$/)
  assert(localCheckpoint.storage.reusedBytes > 0)
  assert.equal((await fs.readdir(output)).filter(file => file.endsWith('.sceneweave-image-work')).length, 0)
  const exported = await first.tool('image_import_export_work')
  assert.ok(exported.workflowCompanion)
  assert.equal(localCheckpoint.sha256, exported.sha256)
  const companion = JSON.parse(await fs.readFile(exported.workflowCompanion, 'utf8'))
  assert.equal(companion.generation, exported.generation)
  assert.deepEqual(companion.binding, found.workflow)
  assert.equal((await first.close()).code, 0)

  const oldCheckpoint = JSON.parse(await fs.readFile(localCheckpoint.path, 'utf8'))
  const oldCheckpointPath = path.join(output, 'version-3.sceneweave-image-checkpoint')
  await fs.writeFile(oldCheckpointPath, JSON.stringify({ ...oldCheckpoint, workflow: { id: oldCheckpoint.workflow.id, version: 3,
    definitionHash: '80e1d16a2fd946693efb6371f6ae7ecf8672a6c4fcef267380a710563a1a541c' } }))
  const resumed = host(['--resume', oldCheckpointPath])
  const progress = await resumed.tool('sceneweave_workflow', { action: 'progress' })
  assert.equal(progress.resumeBindingStatus, 'bound')
  assert.equal(progress.progress.generation, exported.generation + 1)
  assert.equal(progress.progress.taskId, source.id)
  const actual = await resumed.tool('image_import_workflow')
  assert.equal(actual.notes, 'Unresolved edge'); assert.equal(actual.nextAction, 'Review synthetic square')
  assert.deepEqual(actual.image, source.image)
  assert.equal(actual.reviews[0].verdict, 'needs-work')
  assert.equal(actual.reviews[0].matchesInput, true)
  const resumedItem = await resumed.tool('image_import_item_preview', { target })
  for (const field of ['inputHash', 'itemSha256', 'backgroundSha256']) assert.equal(resumedItem[field], item[field], field)
  const { id, version, definitionHash, instructions, surfaceAppearance } = actual.workflow
  assert.deepEqual({ id, version, definitionHash }, companion.binding)
  const readStep = stepId => resumed.tool('sceneweave_workflow', { action: 'step', workflowId: id, definitionHash, stepId })
  for (const { id: stepId } of found.steps) {
    const { step } = await readStep(stepId)
    if (stepId === 'refine-surface') assert.equal(surfaceAppearance, step.instructions)
    else assert.ok(instructions.includes(step.instructions), stepId)
  }
  const staleBuild = await resumed.call('tools/call', { name: 'image_import_build_project', arguments: { generation: exported.generation } })
  assert.equal(staleBuild.isError, true)
  const staleReceipt = JSON.parse(staleBuild.content[0].text)
  assert.equal(staleReceipt.code, 'stale_generation')
  assert.equal(staleReceipt.nextAction, 'read_current_context')
  const delivery = await resumed.tool('image_import_build_project', { generation: actual.generation, title: 'Image workflow acceptance fixture' })
  assert.equal(delivery.status, 'complete')
  assert.equal(delivery.taskId, source.id)
  assert.equal(delivery.generation, actual.generation)
  assert.deepEqual(delivery.workflow, companion.binding)
  assert.deepEqual(delivery.source, source.image)
  assert.equal(delivery.verification.projectHash, delivery.projectHash)
  assert.equal(delivery.verification.changedPixels, 0)
  assert.deepEqual((await fs.readdir(delivery.directory)).sort(), ['map.sceneweave', 'recipe.json', 'result.json'])
  assert.equal(delivery.files.preview.storage, 'cache')
  for (const [key, { file, byteLength, sha256 }] of Object.entries(delivery.files)) {
    const bytes = await fs.readFile(delivery.paths[key] ?? path.join(delivery.directory, file))
    assert.equal(bytes.length, byteLength)
    assert.equal(digest(bytes), sha256)
  }
  const { directory: candidateDirectory, paths: _paths, ...deliveryRecord } = delivery
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(candidateDirectory, 'result.json'), 'utf8')), deliveryRecord)
  const archive = unzipSync(await fs.readFile(path.join(candidateDirectory, delivery.files.project.file)))
  const decoder = new TextDecoder()
  const scene = JSON.parse(decoder.decode(archive['scene.json']))
  const manifest = JSON.parse(decoder.decode(archive['manifest.json']))
  const prop = scene.props[target]
  assert.equal(prop.blocksMovement, true)
  const asset = scene.assets[scene.propDefinitions[prop.definitionRef.id].defaultAppearance.assetId]
  const resource = manifest.entries.find(entry => entry.sha256 === asset.sha256)
  assert.equal(digest(archive[resource.path]), asset.sha256)
  assert.equal((await resumed.close()).code, 0)

  await fs.writeFile(exported.workflowCompanion, JSON.stringify({ ...companion, binding: { id: companion.binding.id, version: 2,
    definitionHash: 'a07bc0d66ef8470902074e9883059fd48e8be5d1e14e44ac14d65b55bff272e7' } }))
  const prior = host(['--resume', exported.path])
  assert.equal((await prior.tool('image_import_workflow')).notes, 'Unresolved edge')
  assert.equal((await prior.close()).code, 0)

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
