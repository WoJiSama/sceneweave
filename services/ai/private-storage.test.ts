import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrivateStorage, assertPrivateStorageAccess } from './private-storage.js'

const roots: string[] = []
const temporary = () => { const root = mkdtempSync(join(tmpdir(), 'sceneweave-private-access-')); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function windows(script: string, path: string): string {
  return execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: { ...process.env, SCENEWEAVE_TEST_ACCESS_PATH: path }, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
}
describe('actual OS private storage access', () => {
  it('protects existing content and inherited SQLite sidecars without changing their bytes', () => {
    const root = temporary(), child = join(root, 'existing'); mkdirSync(child)
    const database = join(child, 'tasks.sqlite'); writeFileSync(database, 'retained private data', { mode: 0o666 })
    const storage = new PrivateStorage(root)
    const sidecar = join(child, 'tasks.sqlite-journal'); writeFileSync(sidecar, 'new journal', { mode: 0o600 })
    storage.file(database); storage.file(sidecar)
    expect(() => assertPrivateStorageAccess(root)).not.toThrow()
    expect(readFileSync(database, 'utf8')).toBe('retained private data')
    expect(readFileSync(sidecar, 'utf8')).toBe('new journal')
    if (process.platform === 'win32') {
      // Independent inspection: these are actual NTFS ACEs, not Node mode bits.
      const report = JSON.parse(windows(String.raw`
$ErrorActionPreference = 'Stop'
$acl = (Get-Item -LiteralPath $env:SCENEWEAVE_TEST_ACCESS_PATH).GetAccessControl()
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
@{ protected = $acl.AreAccessRulesProtected; owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid;
   grants = $rules.Count; unexpected = @($rules | Where-Object { $_.IdentityReference.Value -notin @($sid, 'S-1-5-18') -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl' }).Count } | ConvertTo-Json -Compress
`, root))
      expect(report).toEqual({ protected: true, owner: true, grants: 2, unexpected: 0 })
    } else {
      expect(lstatSync(root).mode & 0o777).toBe(0o700)
      expect(lstatSync(database).mode & 0o777).toBe(0o600)
    }
  })
  it('detects a real extra read grant and repairs only the explicitly configured tree', () => {
    const parent = temporary(), root = join(parent, 'private'); mkdirSync(root)
    new PrivateStorage(root)
    const before = process.platform === 'win32' ? windows('(Get-Item -LiteralPath $env:SCENEWEAVE_TEST_ACCESS_PATH).GetAccessControl().Sddl', parent) : lstatSync(parent).mode
    if (process.platform === 'win32') windows(String.raw`
$item = Get-Item -LiteralPath $env:SCENEWEAVE_TEST_ACCESS_PATH
$acl = $item.GetAccessControl()
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), [Security.AccessControl.FileSystemRights]::ReadAndExecute, [Security.AccessControl.AccessControlType]::Allow))
$item.SetAccessControl($acl)
`, root)
    else chmodSync(root, 0o755)
    expect(() => assertPrivateStorageAccess(root)).toThrow('Invalid private storage access')
    new PrivateStorage(root)
    expect(() => assertPrivateStorageAccess(root)).not.toThrow()
    const after = process.platform === 'win32' ? windows('(Get-Item -LiteralPath $env:SCENEWEAVE_TEST_ACCESS_PATH).GetAccessControl().Sddl', parent) : lstatSync(parent).mode
    expect(after).toBe(before)
  })
  it('rejects escaped paths and junctions before reading or altering an outside target', () => {
    const parent = temporary(), root = join(parent, 'private'), outside = join(parent, 'outside')
    mkdirSync(outside); const file = join(outside, 'retained'); writeFileSync(file, 'untouched')
    const storage = new PrivateStorage(root), linked = join(root, 'linked')
    symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => storage.directory(join(linked, 'uncreated'))).toThrow()
    expect(() => storage.file(file)).toThrow()
    expect(() => new PrivateStorage(root)).toThrow()
    expect(() => new PrivateStorage(join(linked, 'uncreated'))).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('untouched')
    expect(() => lstatSync(join(outside, 'uncreated'))).toThrow()
  })
  it('refuses a hard-linked file without changing the outside alias permissions or bytes', () => {
    const parent = temporary(), root = join(parent, 'private'), outside = join(parent, 'outside-file')
    mkdirSync(root); writeFileSync(outside, 'outside original', { mode: 0o644 })
    const before = process.platform === 'win32' ? windows('(Get-Item -LiteralPath $env:SCENEWEAVE_TEST_ACCESS_PATH).GetAccessControl().Sddl', outside) : lstatSync(outside).mode
    linkSync(outside, join(root, 'linked-file'))
    expect(() => new PrivateStorage(root)).toThrow('Invalid private storage access')
    const after = process.platform === 'win32' ? windows('(Get-Item -LiteralPath $env:SCENEWEAVE_TEST_ACCESS_PATH).GetAccessControl().Sddl', outside) : lstatSync(outside).mode
    expect(after).toBe(before); expect(readFileSync(outside, 'utf8')).toBe('outside original')
  })
})
