import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

/** Input contains names/counters only. Never request or retain command lines. */
export function parseWindowsProcessSnapshot(input, rootPid, expectedRootStarted) {
  if (!Array.isArray(input)) throw new TypeError('Invalid Windows process snapshot')
  if (expectedRootStarted !== undefined && !/^[1-9]\d*$/.test(expectedRootStarted)) throw new TypeError('Invalid Windows root identity')
  const rows = input.map(row => {
    if (!['pid', 'ppid', 'workingSetBytes', 'privateBytes', 'cpu100ns'].every(key => /^\d+$/.test(String(row[key])))) throw new TypeError('Missing Windows process counters')
    const result = { pid: Number(row.pid), ppid: Number(row.ppid), rssBytes: Number(row.workingSetBytes),
      privateBytes: Number(row.privateBytes), cpuTimeMs: Number(row.cpu100ns) / 10000,
      started: String(row.started), comm: String(row.name) }
    if (![result.pid, result.ppid, result.rssBytes, result.privateBytes].every(value => Number.isSafeInteger(value) && value >= 0)
      || !Number.isFinite(result.cpuTimeMs) || result.cpuTimeMs < 0 || !/^\d+$/.test(result.started)
      || !/^[^\x00-\x1f\\/:]{1,260}$/.test(result.comm)) throw new TypeError('Malformed Windows process counters')
    return result
  })
  const byId = new Map(rows.map(row => [row.pid, row])), children = new Map()
  if (byId.size !== rows.length) throw new TypeError('Duplicate Windows process identity')
  for (const row of rows) { const list = children.get(row.ppid) ?? []; list.push(row.pid); children.set(row.ppid, list) }
  const root = byId.get(rootPid), rootIdentityChanged = !!root && expectedRootStarted !== undefined && root.started !== expectedRootStarted
  const included = new Set(root && !rootIdentityChanged ? [rootPid] : []), queue = [...included]
  let rejectedReusedParentEdges = 0, unknownBirthEdges = 0
  for (let i = 0; i < queue.length; i++) for (const pid of children.get(queue[i]) ?? []) if (!included.has(pid)) {
    const parent = byId.get(queue[i]), child = byId.get(pid)
    // ParentProcessId survives parent exit. A newly recycled PID must not
    // graft older, unrelated processes (and their descendants) into Chrome.
    // Windows ticks exceed Number's exact range, so compare their integers.
    if (parent.started === '0' || child.started === '0') { unknownBirthEdges++; continue }
    if (BigInt(child.started) < BigInt(parent.started)) { rejectedReusedParentEdges++; continue }
    included.add(pid); queue.push(pid)
  }
  const processes = rows.filter(row => included.has(row.pid)).map(row => ({ ...row, type: row.pid === rootPid ? 'browser' : 'child' })).sort((a, b) => a.pid - b.pid)
  // Aggregate background process counts only: no names, IDs or user paths.
  const outside = rows.filter(row => !included.has(row.pid))
  return { rootPresent: processes.some(row => row.pid === rootPid), malformedRows: 0, processes,
    lineage: { rootIdentityChanged, rootBirthKnown: !!root && root.started !== '0', rejectedReusedParentEdges, unknownBirthEdges },
    rssBytes: processes.reduce((sum, row) => sum + row.rssBytes, 0), privateBytes: processes.reduce((sum, row) => sum + row.privateBytes, 0),
    background: { processCount: outside.length, browserProcessCount: outside.filter(row => /^(chrome|msedge|chromium)\.exe$/i.test(row.comm)).length,
      nodeProcessCount: outside.filter(row => /^node\.exe$/i.test(row.comm)).length } }
}

function systemCounters() {
  const times = os.cpus().map(cpu => cpu.times)
  return { idle: times.reduce((sum, value) => sum + value.idle, 0), total: times.reduce((sum, value) => sum + Object.values(value).reduce((a, b) => a + b, 0), 0) }
}

/** One hidden, caller-owned PowerShell process, rather than one spawn per poll. */
export function startWindowsProcessSampling({ rootPid, intervalMs, onSnapshot, onError }) {
  if (process.platform !== 'win32') throw new Error('Windows process sampling requires Windows')
  const actualIntervalMs = Math.max(500, intervalMs)
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); while($true) {
    $watch=[System.Diagnostics.Stopwatch]::StartNew();
    $rows=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime,CreationDate | ForEach-Object {
      @{pid=$_.ProcessId;ppid=$_.ParentProcessId;name=$_.Name;workingSetBytes=[string]$_.WorkingSetSize;privateBytes=[string]$_.PrivatePageCount;
        cpu100ns=[string]([decimal]$_.KernelModeTime+[decimal]$_.UserModeTime);started=if($_.CreationDate){[string]$_.CreationDate.ToUniversalTime().Ticks}else{'0'}}
    });
    [Console]::WriteLine((ConvertTo-Json -InputObject @{durationMs=$watch.Elapsed.TotalMilliseconds;rows=$rows} -Compress -Depth 4));
    Start-Sleep -Milliseconds ${actualIntervalMs};
  }`
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  let buffer = '', stopped = false, previous = systemCounters(), lastError = false, rootStarted
  const fail = error => { if (!stopped && !lastError) { lastError = true; onError(error) } }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    if (buffer.length > 4 * 1024 * 1024) { buffer = ''; fail(new Error('Windows process snapshot exceeded protection bound')); child.kill(); return }
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1)
      if (!line || stopped) continue
      try {
        const value = JSON.parse(line), parsed = parseWindowsProcessSnapshot(value.rows, rootPid, rootStarted), current = systemCounters()
        if (parsed.lineage.rootIdentityChanged) throw new Error('Windows measured browser PID was reused')
        if (parsed.rootPresent && (!parsed.lineage.rootBirthKnown || parsed.lineage.unknownBirthEdges)) throw new Error('Windows process lineage has unknown birth times')
        if (parsed.rootPresent) rootStarted ??= parsed.processes.find(row => row.pid === rootPid).started
        const total = current.total - previous.total, idle = current.idle - previous.idle
        parsed.background.systemCpuBusyFraction = total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : null
        previous = current
        onSnapshot({ ...parsed, nativePollDurationMs: Number(value.durationMs) })
      } catch (error) { fail(error) }
    }
  })
  child.on('error', fail)
  const exited = new Promise(resolve => child.once('close', code => { if (!stopped) fail(new Error(`Windows sampler stopped (${code})`)); resolve() }))
  return { actualIntervalMs, async stop() { if (!stopped) { stopped = true; child.kill() }; await exited } }
}
