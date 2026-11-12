import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

/** Input contains names/counters only. Never request or retain command lines. */
export function parseWindowsProcessSnapshot(input, rootPid) {
  if (!Array.isArray(input)) throw new TypeError('Invalid Windows process snapshot')
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
  const children = new Map()
  for (const row of rows) { const list = children.get(row.ppid) ?? []; list.push(row.pid); children.set(row.ppid, list) }
  const included = new Set([rootPid]), queue = [rootPid]
  for (let i = 0; i < queue.length; i++) for (const pid of children.get(queue[i]) ?? []) if (!included.has(pid)) { included.add(pid); queue.push(pid) }
  const processes = rows.filter(row => included.has(row.pid)).map(row => ({ ...row, type: row.pid === rootPid ? 'browser' : 'child' })).sort((a, b) => a.pid - b.pid)
  // Aggregate background process counts only: no names, IDs or user paths.
  const outside = rows.filter(row => !included.has(row.pid))
  return { rootPresent: processes.some(row => row.pid === rootPid), malformedRows: 0, processes,
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
  let buffer = '', stopped = false, previous = systemCounters(), lastError = false
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
        const value = JSON.parse(line), parsed = parseWindowsProcessSnapshot(value.rows, rootPid), current = systemCounters()
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
