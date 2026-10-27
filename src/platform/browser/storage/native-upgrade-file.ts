import { zipSync } from 'fflate'
import type { ProjectData } from '../../../shared/model/project.js'
import type { ResourceOptions } from '../../../shared/ports/resources.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { canonicalJson, captureJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { captureBytes, decodeUtf8, sha256Bytes } from '../../../shared/project/binary.js'
import { parseBoundedJson } from '../../../shared/project/json.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { inspectBoundedZip, type BoundedZipPolicy } from '../../../shared/project/zip.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import type { StoredAutomatic, StoredBinding, StoredProject, StoredSnapshot } from './database.js'
import type { NativeUpgradeFamily, NativeUpgradeTransfer, StoredNativeUpgradeCapsule } from './native-upgrade.js'

type Role = 'capsule' | 'ancestor' | 'project' | 'binding' | 'resource' | 'legacy' | 'license'
interface Entry { path: string; role: Role; sha256: string; sizeBytes: number }
interface Manifest { format: 'sceneweave-native-upgrade-file'; version: 1; capsulePath: 'capsule.json';
  ancestorPaths: string[]; targetSceneId: string; capsuleContentHash: string; entries: Entry[] }
type FileProject = { projectPath: string }
type FileRow<T extends { project: ProjectData }> = Omit<T, 'project'> & FileProject
type FileCapsule = Omit<StoredNativeUpgradeCapsule, 'family' | 'targetInitialProject'> & { targetInitialProjectPath: string; family: Omit<NativeUpgradeFamily, 'current' | 'automatic' | 'snapshots' | 'importedSnapshots' | 'bindings'> & {
  current: FileRow<StoredProject>; automatic: FileRow<StoredAutomatic>[]; snapshots: FileRow<StoredSnapshot>[]; importedSnapshots: FileRow<StoredSnapshot>[]; bindingPaths: string[] } }
const fail = (message: string): never => { throw new Error(`升级原件保全文件无效：${message}`) }
function exact(input: unknown, fields: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail('须为普通JSON记录。')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Reflect.ownKeys(input).length !== fields.length || !fields.every(key => descriptors[key]?.enumerable && 'value' in descriptors[key])) fail('含未知、缺失、访问器、隐藏或Symbol字段。')
}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== '__proto__'
const safeArray = <T>(input: unknown, maximum: number, capture: (item: unknown, index: number) => T): T[] => {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum || Reflect.ownKeys(input).length !== input.length + 1) return fail('数组超限或含额外字段。')
  return Array.from({ length: input.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail('数组含访问器或空洞。')
    return capture(descriptor.value, index)
  })
}
function pathRole(path: string): Role | 'manifest' {
  if (path === 'manifest.json') return 'manifest'
  if (path === 'capsule.json') return 'capsule'
  if (/^ancestors\/(?:[0-5][0-9]|6[0-3])\.json$/.test(path)) return 'ancestor'
  if (/^projects\/[a-f0-9]{64}\.json$/.test(path)) return 'project'
  if (/^bindings\/[a-f0-9]{64}\.json$/.test(path)) return 'binding'
  if (/^resources\/[a-f0-9]{64}\.bin$/.test(path)) return 'resource'
  if (/^legacy\/[a-f0-9]{64}\.bin$/.test(path)) return 'legacy'
  if (/^licenses\/[a-f0-9]{64}\.txt$/.test(path)) return 'license'
  return fail('不安全、未知、目录或嵌套归档路径。')
}
function pathBudget(path: string): number {
  const role = pathRole(path)
  if (role === 'manifest') return PACKAGE_LIMITS.manifestBytes
  // A complete project combines scene, identity, appearance and source metadata;
  // do not accidentally apply the standalone scene.json limit to that envelope.
  if (role === 'project') return PACKAGE_LIMITS.archiveDocumentBytes
  if (role === 'binding' || role === 'capsule' || role === 'ancestor' || role === 'resource') return PACKAGE_LIMITS.sceneBytes
  if (role === 'legacy') return PACKAGE_LIMITS.archiveDocumentBytes
  return PACKAGE_LIMITS.licenseBytes
}
const policy: BoundedZipPolicy = { pathBudget, requiredPaths: ['manifest.json', 'capsule.json'],
  documentPath: path => ['project', 'binding', 'capsule', 'ancestor'].includes(pathRole(path)) }
function readManifest(input: unknown): Manifest {
  exact(input, ['format', 'version', 'capsulePath', 'ancestorPaths', 'targetSceneId', 'capsuleContentHash', 'entries'])
  if (input.format !== 'sceneweave-native-upgrade-file' || input.version !== 1 || input.capsulePath !== 'capsule.json'
    || !validId(input.targetSceneId) || !hash(input.capsuleContentHash)) return fail('manifest格式、版本或目标绑定无效。')
  const ancestorPaths = safeArray(input.ancestorPaths, 64, (item, index) => {
    if (item !== `ancestors/${String(index).padStart(2, '0')}.json`) return fail('祖先路径与固定索引不一致。')
    return item as string
  })
  const paths = new Set<string>(), entries = safeArray(input.entries, PACKAGE_LIMITS.entries - 1, item => {
    exact(item, ['path', 'role', 'sha256', 'sizeBytes'])
    if (typeof item.path !== 'string' || paths.has(item.path) || item.path === 'manifest.json' || !hash(item.sha256)
      || !Number.isSafeInteger(item.sizeBytes) || Number(item.sizeBytes) <= 0 || Number(item.sizeBytes) > pathBudget(item.path)
      || item.role !== pathRole(item.path)) return fail('manifest条目重复、角色、hash或预算无效。')
    const role = item.role as Role
    if ((role === 'project' || role === 'binding' || role === 'resource' || role === 'legacy' || role === 'license') && !item.path.includes(`/${item.sha256}.`)) return fail('实际内容hash与路径不一致。')
    paths.add(item.path); return { path: item.path, role, sha256: item.sha256, sizeBytes: Number(item.sizeBytes) }
  })
  if (!paths.has('capsule.json') || ancestorPaths.some(path => !paths.has(path))
    || entries.filter(row => row.role === 'ancestor').length !== ancestorPaths.length) return fail('manifest祖先或根原件声明不完整。')
  return { format: input.format, version: input.version, capsulePath: input.capsulePath, ancestorPaths,
    targetSceneId: input.targetSceneId, capsuleContentHash: input.capsuleContentHash, entries }
}
/** Encodes an already independently captured+verified transfer returned by repository.exportNativeUpgradeCapsule. */
export function encodeNativeUpgradeFile(input: NativeUpgradeTransfer, options: ResourceOptions = {}): Uint8Array {
  checkCancelled(options.signal)
  const files: Record<string, Uint8Array> = Object.create(null), entries: Entry[] = []
  let expanded = 0, documentBytes = 0
  const add = (path: string, bytes: Uint8Array) => {
    checkCancelled(options.signal)
    if (Object.hasOwn(files, path) || !bytes.length || bytes.length > pathBudget(path) || entries.length + 2 > PACKAGE_LIMITS.entries) return fail('路径重复、条目或单文件预算超限。')
    if ((expanded += bytes.length) > PACKAGE_LIMITS.expandedBytes) return fail('展开总量超过300MiB。')
    if (policy.documentPath(path) && (documentBytes += bytes.length) > PACKAGE_LIMITS.archiveDocumentBytes) return fail('保全文档累计超过128MiB。')
    files[path] = bytes; entries.push({ path, role: pathRole(path) as Role, sha256: sha256Bytes(bytes), sizeBytes: bytes.length })
  }
  const addJson = (path: string, value: unknown) => {
    const bytes = encodeUtf8(canonicalJson(value)); parseBoundedJson(bytes); add(path, bytes)
  }
  const project = (value: ProjectData): string => {
    const bytes = encodeUtf8(canonicalJson(validateProjectData(value))), path = `projects/${sha256Bytes(bytes)}.json`
    if (!Object.hasOwn(files, path)) { parseBoundedJson(bytes); add(path, bytes) }
    return path
  }
  const toFileCapsule = (value: StoredNativeUpgradeCapsule): FileCapsule => {
    const { family, targetInitialProject, ...metadata } = value
    const row = <T extends { project: ProjectData }>(record: T): FileRow<T> => {
      const { project: content, ...fields } = record
      return { ...captureJson(fields), projectPath: project(content) } as FileRow<T>
    }
    return { ...captureJson(metadata), targetInitialProjectPath: project(targetInitialProject), family: {
      current: row(family.current), automatic: family.automatic.map(record => row(record)), snapshots: family.snapshots.map(record => row(record)),
      importedSnapshots: family.importedSnapshots.map(record => row(record)), bindingPaths: family.bindings.map(record => {
        const bytes = encodeUtf8(canonicalJson(record)), path = `bindings/${sha256Bytes(bytes)}.json`
        if (!Object.hasOwn(files, path)) { parseBoundedJson(bytes); add(path, bytes) }
        return path
      }), metadata: captureJson(family.metadata),
      legacySources: captureJson(family.legacySources), conversionJobs: captureJson(family.conversionJobs),
    } }
  }
  addJson('capsule.json', toFileCapsule(input.capsule))
  const ancestorPaths = input.ancestors.map((value, index) => {
    if (index >= 64) return fail('祖先数量超过64。')
    const path = `ancestors/${String(index).padStart(2, '0')}.json`; addJson(path, toFileCapsule(value)); return path
  })
  for (const row of input.resources) add(`resources/${row.sha256}.bin`, captureBytes(row.bytes, PACKAGE_LIMITS.imageBytes))
  for (const row of input.legacyBlobs) add(`legacy/${row.sha256}.bin`, captureBytes(row.bytes, PACKAGE_LIMITS.archiveDocumentBytes))
  for (const row of input.licenses) add(`licenses/${row.sha256}.txt`, encodeUtf8(row.text))
  const manifest: Manifest = { format: 'sceneweave-native-upgrade-file', version: 1, capsulePath: 'capsule.json', ancestorPaths,
    targetSceneId: input.capsule.targetSceneId, capsuleContentHash: input.capsule.contentHash, entries }
  const manifestBytes = encodeUtf8(canonicalJson(manifest)); readManifest(parseBoundedJson(manifestBytes))
  if (manifestBytes.length > PACKAGE_LIMITS.manifestBytes || expanded + manifestBytes.length > PACKAGE_LIMITS.expandedBytes) return fail('manifest或累计展开量超过预算。')
  files['manifest.json'] = manifestBytes
  const bytes = zipSync(files, { level: 6, mtime: new Date(2000, 0, 1, 0, 0, 0) })
  if (bytes.length > PACKAGE_LIMITS.compressedBytes) return fail('压缩文件超过100MiB。')
  // Apply the same central/local/path checks to our writer output as to a read.
  inspectBoundedZip(bytes, policy, options.signal); return bytes
}
/** Safe byte/JSON decoding only. Repository import must still perform full source/target/pixel/lineage validation. */
export async function decodeNativeUpgradeFile(input: Uint8Array, options: ResourceOptions = {}): Promise<NativeUpgradeTransfer> {
  const zip = inspectBoundedZip(input, policy, options.signal)
  const manifest = readManifest(parseBoundedJson(await zip.read('manifest.json')))
  const declared = new Set(['manifest.json', ...manifest.entries.map(row => row.path)])
  if (declared.size !== zip.entries.size || [...declared].some(path => !zip.entries.has(path))) return fail('ZIP含未声明或缺失的文件。')
  const files = new Map<string, Uint8Array>()
  for (const entry of manifest.entries) {
    if (zip.entries.get(entry.path)!.expanded !== entry.sizeBytes) return fail('manifest与ZIP声明长度不符。')
    const bytes = await zip.read(entry.path)
    if (bytes.length !== entry.sizeBytes || sha256Bytes(bytes) !== entry.sha256) return fail('条目实际长度或SHA256不符。')
    files.set(entry.path, bytes); checkCancelled(options.signal)
  }
  const projects = new Map<string, ProjectData>(), usedProjects = new Set<string>(), usedCapsules = new Set<string>(), usedBindings = new Set<string>()
  const json = (path: string): unknown => {
    const bytes = files.get(path)
    if (!bytes) return fail('原件或完整工程JSON缺失。')
    // Each complete project retains its existing 600000-value boundary. The file
    // has bounded entries and total JSON bytes; aggregate histories can exceed that count.
    return captureJson(parseBoundedJson(bytes))
  }
  const project = (path: unknown): ProjectData => {
    if (typeof path !== 'string' || pathRole(path) !== 'project') return fail('完整工程引用路径无效。')
    usedProjects.add(path)
    let content = projects.get(path)
    if (!content) { content = validateProjectData(json(path)); projects.set(path, content) }
    return content
  }
  const fromFileCapsule = (path: string): StoredNativeUpgradeCapsule => {
    if (usedCapsules.has(path)) return fail('原件JSON路径重复引用。')
    usedCapsules.add(path)
    const raw = json(path)
    exact(raw, ['format', 'version', 'capsuleId', 'sourceSceneId', 'sourceContentHash', 'targetSceneId', 'targetInitialContentHash',
      'targetInitialProjectPath', 'createdAt', 'family', 'resourceHashes', 'licenseHashes', 'legacyHashes', 'parentCapsuleIds', 'contentHash'])
    exact(raw.family, ['current', 'automatic', 'snapshots', 'importedSnapshots', 'bindingPaths', 'metadata', 'legacySources', 'conversionJobs'])
    const family = raw.family
    const row = <T extends { project: ProjectData }>(value: unknown, fields: readonly string[]): T => {
      exact(value, [...fields, 'projectPath'])
      const { projectPath, ...metadata } = value
      return { ...metadata, project: project(projectPath) } as T
    }
    const { family: _family, targetInitialProjectPath, ...metadata } = raw
    return { ...metadata, targetInitialProject: project(targetInitialProjectPath), family: {
      current: row<StoredProject>(family.current, ['sceneId', 'revision', 'savedAt', 'contentHash', 'status', 'conversionJobId']),
      automatic: safeArray(family.automatic, 20, value => row<StoredAutomatic>(value, ['ownerSceneId', 'revision', 'savedAt', 'contentHash'])),
      snapshots: safeArray(family.snapshots, 64, value => row<StoredSnapshot>(value, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash'])),
      importedSnapshots: safeArray(family.importedSnapshots, 20, value => row<StoredSnapshot>(value, ['id', 'ownerSceneId', 'lineageId', 'sourceRevision', 'name', 'kind', 'createdAt', 'contentHash'])),
      bindings: safeArray(family.bindingPaths, 105, path => {
        if (typeof path !== 'string' || pathRole(path) !== 'binding') return fail('资源绑定引用路径无效。')
        usedBindings.add(path); return json(path) as StoredBinding
      }), metadata: family.metadata, legacySources: family.legacySources, conversionJobs: family.conversionJobs,
    } } as StoredNativeUpgradeCapsule
  }
  const capsule = fromFileCapsule(manifest.capsulePath), ancestors = manifest.ancestorPaths.map(fromFileCapsule)
  if (capsule.targetSceneId !== manifest.targetSceneId || capsule.contentHash !== manifest.capsuleContentHash) return fail('manifest与原件目标绑定不符。')
  const resources: NativeUpgradeTransfer['resources'] = [], legacyBlobs: NativeUpgradeTransfer['legacyBlobs'] = [], licenses: NativeUpgradeTransfer['licenses'] = []
  for (const entry of manifest.entries) {
    const bytes = files.get(entry.path)!
    if (entry.role === 'project' && !usedProjects.has(entry.path)) return fail('包含无来源的多余完整工程。')
    if (entry.role === 'binding' && !usedBindings.has(entry.path)) return fail('包含无来源的多余资源绑定。')
    if ((entry.role === 'capsule' || entry.role === 'ancestor') && !usedCapsules.has(entry.path)) return fail('包含多余原件JSON。')
    if (entry.role === 'resource') resources.push({ sha256: entry.sha256, bytes })
    else if (entry.role === 'legacy') legacyBlobs.push({ sha256: entry.sha256, bytes })
    else if (entry.role === 'license') licenses.push({ sha256: entry.sha256, text: decodeUtf8(bytes) })
  }
  return { format: 'sceneweave-native-upgrade-transfer', version: 1, capsule, ancestors, resources, legacyBlobs, licenses }
}
