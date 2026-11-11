import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import readline from 'node:readline'

const usage = 'node tools/image-import/replay.mjs --image ABS_IMAGE --recipe ABS_RECIPE --license-file ABS_LICENSE --attribution TEXT --output EXISTING_OUTPUT_DIRECTORY'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage + '\n'); process.exit(0) }

async function main() {
  const index = args.indexOf('--recipe'), recipePath = args[index + 1]
  if (index < 0 || !recipePath || !path.isAbsolute(recipePath) || args.lastIndexOf('--recipe') !== index) throw new Error(usage)
  const handle = await fs.open(recipePath, 'r')
  let recipe
  try {
    if ((await handle.stat()).size > 8 * 1024 * 1024) throw new Error('拆解提案超过8MiB。')
    const bytes = await handle.readFile()
    if (bytes.length > 8 * 1024 * 1024) throw new Error('拆解提案超过8MiB。')
    recipe = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally { await handle.close() }
  const server = fileURLToPath(new URL('./server.mjs', import.meta.url))
  const child = spawn(process.execPath, [server, ...args.filter((_, position) => position !== index && position !== index + 1)], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve) })
  const pending = new Map(), lines = readline.createInterface({ input: child.stdout })
  let sequence = 0
  const fail = error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear() }
  child.on('error', fail)
  child.stdin.on('error', fail)
  child.on('exit', code => { if (pending.size) fail(new Error(`图片工具提前退出，状态${code}。`)) })
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { fail(new Error('图片工具返回了无效JSON。')); return }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error || message.result?.isError) waiter.reject(new Error(message.error?.message ?? message.result.content?.map(item => item.text ?? '').join('\n')))
    else waiter.resolve(message.result)
  })
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sceneweave-image-replay', version: '1.0.0' } })
    const applied = await call('tools/call', { name: 'image_import_apply_recipe', arguments: { generation: 0, recipe } })
    const snapshot = JSON.parse(applied.content.find(item => item.type === 'text').text)
    const output = await call('tools/call', { name: 'image_import_build_project', arguments: { generation: snapshot.generation } })
    for (const item of output.content) if (item.type === 'text') process.stdout.write(item.text + '\n')
  } finally {
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) {
      const timeout = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') }, 5000)
      try { await exited } finally { clearTimeout(timeout) }
    }
    lines.close()
  }
}
main().catch(error => { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1 })
