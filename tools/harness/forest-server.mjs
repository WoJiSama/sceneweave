import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assert, parseArguments, readRequest, readBounded, writeVerified, replaceResult, digest, MAX_ARCHIVE_BYTES } from './io.mjs'
import { startHarnessTooling } from './tooling.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024
const loopLimits = Object.freeze({ maxCandidates: 3, maxDecisions: 4 })
const hostDeadlineMs = 1080000
export const usage = `Usage:
  node tools/harness/forest-server.mjs --input ABS_REQUEST --output NEW_ABS_DIR --allow forest-building --budget small|standard|expanded
  node tools/harness/forest-server.mjs --resume ABS_LOOP_DIR --allow forest-building --budget SAME_PROFILE

JSONL stdio MCP host. Fixed new forest-building request, at most three candidates
and four decisions. First seed is fixed; later attempts may change only seed or
repair managed furniture in one specified room of a real existing candidate.
Each candidate uses the explicitly selected registered budget. All receipts and
files survive finish, cancellation and failure. No model/provider requests, main
project access, automatic retries or old-session authorization restoration.
Read sceneweave_forest_state, then sceneweave_forest_action generate/repair-furniture/finish with
the exact current stateHash. Inspect actual diagnostics and preview files; finish
selects a complete candidate for later page import, not visual approval or P3.
New output must not exist and its parent must exist. Resume checks result.json,
the workflow binding and candidate files in the saved loop directory. EOF or
MCP cancellation stops an active generation. Install Chrome or set the existing
harness browser channel before generation.`

export function parseForestServerArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null
  const resumeIndex = args.indexOf('--resume')
  if (resumeIndex !== -1) {
    const directory = args[resumeIndex + 1]
    assert(directory && path.isAbsolute(directory), 'Expected --resume ABS_LOOP_DIR')
    const generationArgs = [...args]
    generationArgs[resumeIndex] = '--output'
    return { ...parseArguments(['generate', ...generationArgs, '--input', path.join(directory, 'request.json')]), resume: true }
  }
  return parseArguments(['generate', ...args])
}

const emptyParameters = { type: 'object', properties: {}, additionalProperties: false }
const STATE_TOOL = { name: 'sceneweave_forest_state', description: 'Read the actual bounded forest-building state, fixed requirements, current stateHash, diagnostics and all saved candidate paths. Reading grants no new authorization.', inputSchema: emptyParameters }
const textResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
const errorResult = message => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'forest_host_action', message } }) }] })

export async function serveForest(options) {
  let tooling, lines, state, record, currentChild, busy = false, stopped = false, stopReason = null, activeRequestId = null
  let checkpointHash, priorElapsedMs = 0, inFlight = Promise.resolve()
  const started = performance.now()
  const checkpointPath = path.join(options.output, 'result.json')
  const readCheckpoint = () => readBounded(checkpointPath, MAX_CHECKPOINT_BYTES)
  const send = value => { if (!process.stdout.destroyed) process.stdout.write(JSON.stringify(value) + '\n') }
  const sendError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })
  let loop, sdk, workflows, workflow
  const elapsed = () => Math.round(priorElapsedMs + performance.now() - started)
  async function assertCurrentCheckpoint() {
    assert(digest(await readCheckpoint()) === checkpointHash, 'Saved loop checkpoint changed; reconnect with --resume.')
  }
  async function persist() {
    try {
      await replaceResult(options.output, { ...record, state, updatedAt: new Date().toISOString(), elapsedMs: elapsed() })
      checkpointHash = digest(await readCheckpoint())
    } catch (error) {
      stop('Checkpoint write failed; reconcile the saved files before continuing.')
      throw error
    }
  }
  async function runWithCheckpoint(execute) {
    // A host can be replaced while idle. Reserve each action exclusively and
    // recheck the exact saved baseline before spending an attempt.
    const lockPath = path.join(options.output, `.forest-action-${checkpointHash}.lock`)
    let lock
    try { lock = await fs.open(lockPath, 'wx', 0o600) }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another action owns this checkpoint or was interrupted. Saved candidates are preserved.')
      throw error
    }
    try {
      await assertCurrentCheckpoint()
      assert(!stopped, stopReason)
      return await execute()
    } finally {
      await lock.close()
      await fs.unlink(lockPath)
    }
  }
  async function stopChild() {
    const child = currentChild
    if (!child || child.exitCode !== null) return
    if (process.platform === 'win32') {
      await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()))
    } else {
      child.kill('SIGTERM')
      const force = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 2000)
      force.unref()
    }
  }
  const stop = reason => {
    stopped = true; stopReason ??= reason
    void stopChild()
  }
  const interrupted = () => { stop('Host interrupted; existing files are preserved.'); lines?.close() }
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted)
  let hostTimer
  try {
    const raw = await readRequest(options.input)
    const stdinEndListeners = new Set(process.stdin.listeners('end'))
    tooling = await startHarnessTooling(root)
    // This process owns EOF so it can stop children and persist its final state.
    // Vite's CLI convenience listener would otherwise exit before finally runs.
    for (const listener of process.stdin.listeners('end')) {
      if (!stdinEndListeners.has(listener)) process.stdin.removeListener('end', listener)
    }
    sdk = await tooling.sdk(); loop = await tooling.forestLoop(); workflows = await tooling.workflows()
    const request = sdk.parseSemanticGenerationRequest(raw)
    workflow = workflows.workflowBinding('sceneweave-forest-building')
    const authorization = { capabilityId: request.capabilityId, contentId: sdk.SEMANTIC_GENERATION_CONTENT,
      fixedRequestHash: sdk.semanticGenerationRequestHash(request), mutableFields: ['seed'], furnitureRepair: 'seating-v1' }
    const budget = { perCandidate: options.budget, ...loopLimits, totalHostDeadlineMs: hostDeadlineMs }
    const { assertTaskBudget, taskBudgetProfile } = await tooling.budget()
    const profile = taskBudgetProfile(options.budget)
    assert(!stopped, stopReason)
    record = { format: 'sceneweave-forest-loop-host', version: 1, workflow, startedAt: new Date().toISOString(),
      authorization, budget,
      candidates: [], attempts: [], cumulative: { generatedCandidates: 0, generationMs: 0, modelRequests: 0, usage: {} },
      resumeSupported: true, formalAcceptance: false, visualReview: 'unverified', userAcceptance: 'unverified', selected: null }
    if (options.resume) await restoreCheckpoint()
    else {
      state = loop.createForestLoop(request, loopLimits, `forest-${randomUUID()}`)
      await fs.mkdir(options.output, { mode: 0o700 })
      await writeVerified(options.output, 'request.json', Buffer.from(JSON.stringify(request, null, 2) + '\n'))
      await fs.writeFile(checkpointPath, '{}\n', { flag: 'wx', mode: 0o600 })
      await persist()
    }
    assert(!stopped, stopReason)
    const remainingMs = hostDeadlineMs - elapsed()
    if (remainingMs > 0) hostTimer = setTimeout(() => { stop('Host deadline reached; existing candidates are preserved.'); lines?.close() }, remainingMs)
    else {
      stop('Host deadline reached; existing candidates are preserved.')
      state = loop.stopForestLoop(state, stopReason)
    }
    const actionDefinition = { name: loop.FOREST_ACTION_TOOL.name,
      description: 'Execute one authorized forest candidate, repair managed furniture in one specified room of an actual candidate, or finish. Fixed requirements, structure, manual edits and locks are preserved. Calls are not retried. Complete CLI results include disk/cold-read pixel checks; preview quality and final page import require review.',
      inputSchema: loop.FOREST_ACTION_TOOL.parameters }
    const definitions = [STATE_TOOL, actionDefinition, { name: workflows.WORKFLOW_DISCOVERY_TOOL.name,
      description: workflows.WORKFLOW_DISCOVERY_TOOL.description, inputSchema: workflows.WORKFLOW_DISCOVERY_TOOL.parameters }]
    const stateValue = () => ({ ...loop.forestLoopContext(state), workflow, hostBudget: record.budget,
      cumulative: record.cumulative, candidates: record.candidates, selected: record.selected,
      checkpoint: checkpointPath, resumeSupported: true,
      visualReview: 'unverified', userAcceptance: 'unverified',
      next: state.status === 'finished' ? 'Read the selected preview, then import the complete project through the normal page for review and further editing.'
        : 'Read actual notes and remaining nextActions. Generation is local; this host makes no model requests. No image was visually reviewed by the host.' })
    const workflowHost = () => {
      const host = workflows.harnessWorkflowHost()
      host.tools = definitions.map(tool => ({ name: tool.name, parameters: tool.inputSchema }))
      host.capabilities['forest-parameters'] = { state: 'available', entry: STATE_TOOL.name, reason: 'Fixed explicit input is loaded. Only seed may change; furniture repair keeps the same targets.', toolNames: [STATE_TOOL.name] }
      host.capabilities['forest-generation'] = { state: loop.forestLoopContext(state).nextActions.some(kind => kind === 'generate' || kind === 'repair-furniture') ? 'available' : 'budget-exhausted',
        entry: actionDefinition.name, reason: 'Read nextActions and repairTargets. The CLI executes a new or repaired independent candidate only after a current-hash action; original goals stay fixed.', toolNames: [actionDefinition.name] }
      host.capabilities['project-preview'] = { state: record.candidates.length ? 'available' : 'missing-input', entry: 'Saved candidate preview.png paths', reason: 'Host verifies bytes and cold pixels; image viewing depends on the assistant actual visual capability.', toolNames: [STATE_TOOL.name] }
      host.capabilities['project-delivery'] = { state: state.receipts.length ? 'available' : 'missing-input', entry: actionDefinition.name, reason: 'finish selects a saved complete candidate; normal page import/adoption remains separate.', toolNames: [actionDefinition.name] }
      host.progress = { taskId: state.runId, generation: state.decisionsUsed, status: state.status, baselineHash: sdk.semanticGenerationRequestHash(state.request),
        draftRevision: null, lastTool: null, unknown: false, remainingToolCalls: state.limits.maxDecisions - state.decisionsUsed }
      return host
    }
    async function runCli(input, directory, roomId) {
      assert(!stopped, stopReason)
      const args = [path.join(root, 'tools/harness/sceneweave.mjs'), roomId ? 'repair-furniture' : 'generate', '--input', input,
        ...(roomId ? ['--room', roomId] : []), '--output', directory, '--allow', 'forest-building', '--budget', options.budget]
      const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      currentChild = child
      let stdout = '', stderr = '', overLimit = false
      const capture = (kind, chunk) => {
        if (kind === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString()
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 256 * 1024) { overLimit = true; stop('CLI log limit exceeded; no automatic retry.'); void stopChild() }
      }
      child.stdout.on('data', chunk => capture('stdout', chunk)); child.stderr.on('data', chunk => capture('stderr', chunk))
      const timeout = setTimeout(() => { stop('CLI delivery deadline reached; no automatic retry.'); void stopChild() }, 365000)
      const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) }).finally(() => { clearTimeout(timeout); if (currentChild === child) currentChild = null })
      assert(!stopped, stopReason)
      assert(!overLimit && result.code === 0, `CLI generation failed (${result.code ?? result.signal}); original files remain. ${stderr.slice(-1024)}`)
    }
    async function verifyCandidate(directory, expectedRequest, expectedCandidate) {
      const result = JSON.parse((await readBounded(path.join(directory, 'result.json'), 256 * 1024)).toString('utf8'))
      assert(result.format === 'sceneweave-local-generation-result' && result.version === 1 && result.status === 'complete', 'CLI has no complete result')
      const repairing = !!result.parentCandidateId
      assert(result.authorization?.requestHash === result.requestHash, 'CLI authorization is bound to another request')
      assert(result.modelRequests === 0 && result.target === (repairing ? 'candidate-repair' : 'new-project') && result.budget === options.budget
        && isDeepStrictEqual(result.profile, profile), 'CLI result does not match the explicit local host authorization and budget')
      assert(isDeepStrictEqual(workflows.assertWorkflowBinding(result.workflow), workflow), 'CLI result belongs to a different workflow')
      assert(result.diskVerification?.projectHash === result.projectHash && result.diskVerification?.changedPixels === 0, 'CLI disk cold read/pixel proof missing')
      assert(/^[a-f0-9]{64}$/.test(result.projectHash), 'CLI project hash is invalid')
      if (expectedCandidate?.candidateId) assert(result.projectHash === expectedCandidate.candidateId, 'Saved candidate identity changed after the receipt')
      const expectedNames = { request: 'request.json', project: 'map.sceneweave', preview: 'preview.png' }, files = {}
      for (const [key, name] of Object.entries(expectedNames)) {
        const file = result.files?.[key]
        assert(file?.file === name && Number.isSafeInteger(file.byteLength) && file.byteLength > 0, `Invalid CLI ${key} file record`)
        const bytes = await readBounded(path.join(directory, name), MAX_ARCHIVE_BYTES)
        assert(bytes.length === file.byteLength && digest(bytes) === file.sha256, `CLI ${key} bytes changed after delivery`)
        if (expectedCandidate?.files) {
          const saved = expectedCandidate.files[key]
          assert(saved?.sha256 === file.sha256 && saved.byteLength === file.byteLength, `CLI ${key} differs from the checkpoint`)
        }
        files[key] = { path: path.join(directory, name), sha256: file.sha256, byteLength: file.byteLength }
      }
      const savedRequest = await readRequest(files.request.path)
      if (repairing) {
        const parent = record.candidates.find(row => row.candidateId === result.parentCandidateId)
        assert(parent && parent.directory !== directory, 'Repair parent is not a real earlier candidate')
        assert(expectedCandidate?.parentCandidateId === parent.candidateId && expectedCandidate.repairRoomId === result.repairRoomId, 'Repair receipt differs from the selected action')
        await verifyCandidate(parent.directory, expectedRequest, parent)
        const expectedRepair = { version: 1, operation: 'forest-furniture-repair', parentArchiveSha256: parent.files.project.sha256,
          parentArchiveBytes: parent.files.project.byteLength, roomId: expectedCandidate.repairRoomId,
          variation: 'forest-repair-seating-v1', strategy: 'seating-v1' }
        assert(JSON.stringify(savedRequest) === JSON.stringify(expectedRepair) && result.requestHash === digest(Buffer.from(JSON.stringify(expectedRepair))), 'Saved repair request differs from its exact parent and room')
        assert(result.parentArchiveSha256 === parent.files.project.sha256 && result.strategy === expectedRepair.strategy && result.variation === expectedRepair.variation, 'Repair provenance does not match the exact parent archive')
      } else {
        assert(!expectedCandidate?.parentCandidateId, 'Expected repair was replaced by a new-project delivery')
        assert(sdk.semanticGenerationRequestHash(sdk.parseSemanticGenerationRequest(savedRequest)) === result.requestHash
          && result.requestHash === sdk.semanticGenerationRequestHash(expectedRequest), 'Saved generation request differs from CLI receipt')
      }
      return { result, files }
    }
    function requestWithSeed(seed) {
      return sdk.parseSemanticGenerationRequest({ ...state.request, parameters: { ...state.request.parameters, seed } })
    }
    function candidateFromResult({ result, files }, directory, pending, parent, previous) {
      const receipt = loop.ForestGenerationReceiptSchema.parse({ candidateId: result.projectHash, requestHash: pending.requestHash, seed: pending.seed,
        entities: { rooms: result.entities.rooms, props: result.entities.props }, notes: result.notes, diagnostics: result.diagnostics,
        ...(parent ? { parentCandidateId: result.parentCandidateId, repairRoomId: result.repairRoomId } : {}) })
      const usage = assertTaskBudget(profile, result.usage)
      const chainUsage = parent ? assertTaskBudget(profile, sdk.combineForestCandidateUsage(parent.chainUsage, usage)) : usage
      const candidate = { ...receipt, directory, files, chainUsage, resultPath: path.join(directory, 'result.json'),
        diskVerification: result.diskVerification, limitations: result.limitations,
        differenceFromPrevious: previous ? { previousCandidateId: previous.candidateId,
          rooms: receipt.entities.rooms - previous.entities.rooms, props: receipt.entities.props - previous.entities.props,
          resolvedNotes: previous.notes.filter(note => !receipt.notes.includes(note)), newNotes: receipt.notes.filter(note => !previous.notes.includes(note)) } : null }
      return { receipt, candidate, usage }
    }
    function addUsage(usage) {
      record.cumulative.generatedCandidates++
      for (const [key, value] of Object.entries(usage)) record.cumulative.usage[key] = (record.cumulative.usage[key] ?? 0) + value
    }
    async function restoreCheckpoint() {
      const bytes = await readCheckpoint()
      const saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      assert(saved?.format === record.format && saved.version === record.version, 'Expected a saved forest loop result.json')
      assert(isDeepStrictEqual(workflows.assertWorkflowBinding(saved.workflow), workflow), 'Saved checkpoint belongs to a different workflow')
      assert(isDeepStrictEqual(saved.authorization, authorization), 'Saved request differs from the fixed checkpoint request')
      assert(isDeepStrictEqual(saved.budget, budget), 'Resume requires the original budget profile and limits')
      const context = loop.forestLoopContext(saved.state)
      assert(isDeepStrictEqual(context.limits, loopLimits) && sdk.semanticGenerationRequestHash(context.request) === authorization.fixedRequestHash,
        'Checkpoint state does not match the fixed request or limits')
      assert(!context.pending, 'The last action was interrupted. Only independently complete candidate archives can be used; no action is replayed.')
      assert(saved.attempts?.length === context.attemptsUsed && Array.isArray(saved.attempts)
        && saved.candidates?.length === context.receipts.length && Array.isArray(saved.candidates), 'Checkpoint attempt or candidate count changed')
      assert(Number.isSafeInteger(saved.elapsedMs) && saved.elapsedMs >= 0
        && Number.isSafeInteger(saved.cumulative?.generationMs) && saved.cumulative.generationMs >= 0, 'Invalid checkpoint timing')
      state = saved.state
      let receiptIndex = 0, failureIndex = 0
      for (const [index, attempt] of saved.attempts.entries()) {
        const sequence = index + 1, directory = path.join(options.output, `candidate-${sequence}`)
        assert(attempt?.sequence === sequence && ['complete', 'failed'].includes(attempt.status), 'Checkpoint attempt is incomplete or out of order')
        const expected = attempt.status === 'complete' ? context.receipts[receiptIndex] : context.failures[failureIndex++]
        assert(expected && attempt.seed === expected.seed && attempt.requestHash === expected.requestHash
          && attempt.parentCandidateId === expected.parentCandidateId && attempt.repairRoomId === expected.repairRoomId
          && attempt.kind === (expected.parentCandidateId ? 'repair-furniture' : 'generate'), 'Checkpoint attempt does not match its outcome')
        record.attempts.push({ ...attempt, directory })
        if (attempt.status === 'failed') continue
        const savedCandidate = saved.candidates[receiptIndex++]
        assert(attempt.candidateId === expected.candidateId && savedCandidate?.candidateId === expected.candidateId && savedCandidate.files,
          'Checkpoint candidate does not match its receipt')
        const verified = await verifyCandidate(directory, requestWithSeed(expected.seed), { ...expected, files: savedCandidate.files })
        const parent = record.candidates.find(candidate => candidate.candidateId === expected.parentCandidateId)
        const restored = candidateFromResult(verified, directory, attempt, parent, record.candidates.at(-1))
        assert(isDeepStrictEqual(restored.receipt, expected) && isDeepStrictEqual(restored.candidate.chainUsage, savedCandidate.chainUsage),
          'Candidate receipt or budget differs from the checkpoint')
        record.candidates.push(restored.candidate)
        addUsage(restored.usage)
      }
      record.cumulative.generationMs = saved.cumulative.generationMs
      assert(isDeepStrictEqual(saved.cumulative, record.cumulative), 'Checkpoint cumulative budget changed')
      record.selected = record.candidates.find(candidate => candidate.candidateId === context.selectedCandidateId) ?? null
      assert((saved.selected?.candidateId ?? null) === context.selectedCandidateId, 'Checkpoint selected a different candidate')
      record.startedAt = saved.startedAt
      priorElapsedMs = saved.elapsedMs
      checkpointHash = digest(bytes)
      await assertCurrentCheckpoint()
      // Older hosts marked an idle close as stopped. A complete checkpoint
      // with no failed attempt can continue under the new explicit grant.
      if (state.status === 'stopped' && context.failures.length === 0) state = { ...state, status: 'ready', stopReason: null }
    }
    async function executeAction(rawAction) {
      const previous = state.receipts.at(-1)
      const action = loop.validateForestAction(loop.forestLoopContext(state), rawAction)
      if (action.kind === 'finish') {
        const candidate = record.candidates.find(value => value.candidateId === action.candidateId)
        assert(candidate, 'Selected candidate files are missing')
        try { await verifyCandidate(candidate.directory, requestWithSeed(candidate.seed), candidate) }
        catch (error) {
          state = loop.stopForestLoop(state, error instanceof Error ? error.message : 'Selected candidate verification failed')
          await persist()
          throw error
        }
        assert(!stopped, stopReason)
        state = loop.beginForestAction(state, action)
        record.selected = candidate
        await persist()
        return stateValue()
      }
      state = loop.beginForestAction(state, action)
      const pending = state.pending
      assert(pending, 'No generation action is pending')
      const sequence = state.attemptsUsed, directory = path.join(options.output, `candidate-${sequence}`)
      const request = requestWithSeed(pending.seed)
      const parent = action.kind === 'repair-furniture' ? record.candidates.find(row => row.candidateId === action.candidateId) : undefined
      const attempt = { sequence, kind: action.kind, seed: pending.seed, requestHash: pending.requestHash,
        ...(parent ? { parentCandidateId: parent.candidateId, repairRoomId: action.roomId } : {}), directory, status: 'running', startedAt: new Date().toISOString() }
      record.attempts.push(attempt); await persist()
      const candidateStarted = performance.now()
      try {
        const saved = await writeVerified(options.output, `request-${sequence}.json`, Buffer.from(JSON.stringify(request, null, 2) + '\n'))
        if (parent) await verifyCandidate(parent.directory, request, parent)
        await runCli(parent ? parent.files.project.path : path.join(options.output, saved.record.file), directory, parent ? action.roomId : undefined)
        const expectedRepair = parent ? { parentCandidateId: parent.candidateId, repairRoomId: action.roomId } : undefined
        const verified = await verifyCandidate(directory, request, expectedRepair)
        const { receipt, candidate, usage } = candidateFromResult(verified, directory, pending, parent, previous)
        assert(!stopped, stopReason)
        state = loop.completeForestGeneration(state, receipt)
        record.candidates.push(candidate)
        addUsage(usage)
        record.cumulative.generationMs += Math.round(performance.now() - candidateStarted)
        attempt.status = 'complete'; attempt.candidateId = receipt.candidateId
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 512) : 'Local generation failed'
        if (state.pending) state = loop.failForestGeneration(state, message)
        state = loop.stopForestLoop(state, message)
        attempt.status = 'failed'; attempt.error = message
        throw error
      } finally { attempt.completedAt = new Date().toISOString(); await persist() }
      return stateValue()
    }
    async function handleLine(line) {
      if (!line.trim()) return
      if (Buffer.byteLength(line) > 64 * 1024) { sendError(null, -32600, 'Request exceeds 64KiB'); return }
      let request
      try { request = JSON.parse(line) } catch { sendError(null, -32700, 'Invalid JSON'); return }
      if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
        || request.id !== undefined && request.id !== null && !['string', 'number'].includes(typeof request.id)
        || typeof request.id === 'number' && !Number.isFinite(request.id)) { sendError(null, -32600, 'Invalid JSON-RPC request'); return }
      if (request.method === 'notifications/cancelled') {
        if (busy && request.params?.requestId === activeRequestId) stop('MCP request cancelled; saved candidates are preserved.')
        return
      }
      if (request.id === undefined) return
      if (request.method === 'initialize') { send({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sceneweave-forest-building', version: '1.0.0' },
        instructions: 'Read sceneweave_forest_state. Fixed goals, max 3 candidates and 4 decisions. Generate changes only seed; repair-furniture targets one listed room in an actual candidate and preserves structure/manual edits/locks. Compare actual per-room expected/actual counts and bounded rejection diagnostics. Do not repeat ineffective actions. Actions execute the local CLI and return real files. Finish selects a complete file for page review/import. Resume a saved checkpoint with the original budget. EOF cancels active generation.',
      } }); return }
      if (request.method === 'ping') { send({ jsonrpc: '2.0', id: request.id, result: {} }); return }
      if (request.method === 'tools/list') { send({ jsonrpc: '2.0', id: request.id, result: { tools: definitions } }); return }
      if (request.method !== 'tools/call') { sendError(request.id, -32601, 'Unsupported MCP method'); return }
      const params = request.params
      if (!params || !definitions.some(tool => tool.name === params.name)) { sendError(request.id, -32602, 'Unknown forest tool'); return }
      if (busy) { send({ jsonrpc: '2.0', id: request.id, result: errorResult('Another action is executing; concurrent tools are refused. Read state after its result.') }); return }
      if (stopped && params.name === actionDefinition.name) { send({ jsonrpc: '2.0', id: request.id, result: errorResult(stopReason ?? 'Host stopped; existing files remain.') }); return }
      busy = true; activeRequestId = request.id
      try {
        workflows.assertWorkflowBinding(workflow)
        let value
        if (params.name === STATE_TOOL.name) {
          assert(params.arguments === undefined || params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) && Object.keys(params.arguments).length === 0, 'State tool takes an empty object')
          await assertCurrentCheckpoint()
          value = stateValue()
        } else if (params.name === workflows.WORKFLOW_DISCOVERY_TOOL.name) {
          await assertCurrentCheckpoint()
          value = workflows.queryWorkflow(params.arguments ?? {}, workflowHost())
        } else value = await runWithCheckpoint(() => executeAction(params.arguments))
        send({ jsonrpc: '2.0', id: request.id, result: textResult(value) })
      } catch (error) {
        send({ jsonrpc: '2.0', id: request.id, result: errorResult(error instanceof Error ? error.message : 'Forest tool failed') })
      } finally { busy = false; activeRequestId = null }
    }
    lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    await new Promise((resolve, reject) => {
      lines.on('line', line => {
        // Start immediately so concurrent requests are rejected rather than silently queued.
        const operation = handleLine(line)
        inFlight = Promise.allSettled([inFlight, operation]).then(() => {})
        operation.catch(reject)
      })
      lines.once('close', () => { if (busy) stop('MCP input closed during execution; saved files are preserved.'); resolve() })
      lines.once('error', reject)
    })
    await inFlight
  } finally {
    clearTimeout(hostTimer); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
    await stopChild()
    lines?.close(); await tooling?.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseForestServerArguments(process.argv.slice(2))
    if (options) await serveForest(options)
    else process.stdout.write(usage + '\n')
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : 'Forest host could not start') + '\n')
    process.exitCode = 1
  }
}
