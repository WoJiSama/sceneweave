import { chmodSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

const invalid = (): never => { throw new Error('Invalid private storage access') }
const assertOrdinaryTree = (path: string): void => {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isDirectory() && (!info.isFile() || info.nlink !== 1)) invalid()
  if (info.isDirectory()) for (const entry of readdirSync(path)) assertOrdinaryTree(join(path, entry))
}
// Paths are transported as data. No task input or pathname is interpolated
// into PowerShell, and failures never include its potentially private output.
const windowsAclScript = String.raw`
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($env:SCENEWEAVE_PRIVATE_STORAGE_PATH)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$protect = $env:SCENEWEAVE_PRIVATE_STORAGE_ACTION -eq 'protect'
$stack = [Collections.Generic.Stack[string]]::new()
$stack.Push($root)
$count = 0
while ($stack.Count) {
  $path = $stack.Pop()
  if ($path -ne $root -and -not $path.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'outside root' }
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
  $directory = $item -is [IO.DirectoryInfo]
  if ($protect) {
    if ($directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() }
    else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($principal in @($sid, $system)) {
      if ($directory) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($principal, [Security.AccessControl.FileSystemRights]::FullControl,
          [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit', [Security.AccessControl.PropagationFlags]::None,
          [Security.AccessControl.AccessControlType]::Allow)
      } else {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($principal, [Security.AccessControl.FileSystemRights]::FullControl,
          [Security.AccessControl.AccessControlType]::Allow)
      }
      $acl.AddAccessRule($rule)
    }
    $item.SetAccessControl($acl)
  }
  $acl = $item.GetAccessControl()
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner mismatch' }
  $grants = @{}
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $identity = $rule.IdentityReference.Value
    if (($identity -ne $sid.Value -and $identity -ne $system.Value) -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { throw 'unexpected access' }
    if ($directory -and $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit') { throw 'missing inheritance' }
    $grants[$identity] = $true
  }
  if (-not $grants.ContainsKey($sid.Value) -or -not $grants.ContainsKey($system.Value)) { throw 'missing grant' }
  if ($path -eq $root -and -not $acl.AreAccessRulesProtected) { throw 'unprotected root' }
  $count++
  if ($directory) { foreach ($child in [IO.Directory]::GetFileSystemEntries($path)) { $stack.Push($child) } }
}
[Console]::Out.Write($count)
`
function windowsAccess(path: string, action: 'protect' | 'inspect'): void {
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsAclScript, 'utf16le').toString('base64')], {
      env: { ...process.env, SCENEWEAVE_PRIVATE_STORAGE_PATH: path, SCENEWEAVE_PRIVATE_STORAGE_ACTION: action },
      windowsHide: true, timeout: 15000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    })
    if (!/^[1-9]\d*$/.test(output.trim())) invalid()
  } catch { invalid() }
}

/** The service trusts its own account, never POSIX mode bits on Windows. */
export class PrivateStorage {
  readonly root: string
  constructor(path: string) {
    this.root = resolve(path)
    if (this.root === parse(this.root).root) invalid()
    // Do not create the configured root through a junction/symlink ancestor.
    // Ancestors are inspected only; only the explicitly configured root gets
    // new permissions, and traversal of its descendants never follows links.
    let ancestor = parse(this.root).root
    for (const part of this.root.slice(ancestor.length).split(sep).filter(Boolean)) {
      ancestor = join(ancestor, part)
      try { if (lstatSync(ancestor).isSymbolicLink()) invalid() }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const info = lstatSync(this.root)
    if (info.isSymbolicLink() || !info.isDirectory()) invalid()
    // An existing hard link would let chmod/SetAccessControl affect an alias
    // outside the configured tree. Reject all linked files before changing ACLs.
    assertOrdinaryTree(this.root)
    if (process.platform === 'win32') windowsAccess(this.root, 'protect')
    else this.protectPosix(this.root)
  }
  private protectPosix(path: string): void {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) invalid()
    chmodSync(path, info.isDirectory() ? 0o700 : 0o600)
    if (info.isDirectory()) for (const entry of readdirSync(path)) this.protectPosix(join(path, entry))
  }
  private assertPath(path: string, kind: 'directory' | 'file'): void {
    const absolute = resolve(path), suffix = relative(this.root, absolute)
    if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) invalid()
    let current = this.root
    for (const entry of ['', ...suffix.split(sep).filter(Boolean)]) {
      if (entry) current = join(current, entry)
      const info = lstatSync(current)
      if (info.isSymbolicLink() || (current === absolute && kind === 'file' ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) invalid()
    }
  }
  directory(path: string): void {
    // The certified root excludes every other account. Newly created children
    // inherit its user/SYSTEM DACL; no per-tool child process is needed. Every
    // existing descendant was protected and inspected before publishing root.
    const absolute = resolve(path), suffix = relative(this.root, absolute)
    if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) invalid()
    let current = this.root
    this.assertPath(current, 'directory')
    for (const entry of suffix.split(sep).filter(Boolean)) {
      current = join(current, entry)
      try { mkdirSync(current, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      this.assertPath(current, 'directory')
      if (process.platform !== 'win32') chmodSync(current, 0o700)
    }
  }
  file(path: string): void {
    this.assertPath(path, 'file')
    if (process.platform !== 'win32') chmodSync(path, 0o600)
  }
}

/** Read-only OS evidence, also used by storage integration checks. */
export function assertPrivateStorageAccess(path: string): void {
  const root = resolve(path)
  assertOrdinaryTree(root)
  if (process.platform === 'win32') { windowsAccess(root, 'inspect'); return }
  const visit = (entry: string) => {
    const info = lstatSync(entry)
    if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile() || (info.mode & 0o777) !== (info.isDirectory() ? 0o700 : 0o600)) invalid()
    if (info.isDirectory()) for (const child of readdirSync(entry)) visit(join(entry, child))
  }
  visit(root)
}
