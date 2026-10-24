import { Inflate } from 'fflate'
import { failPackage, PACKAGE_LIMITS } from './limits.js'
import { checkCancelled } from '../ports/resources.js'
import type { CancellationSignal } from '../ports/resources.js'
import { captureBytes, crc32, decodeUtf8 } from './binary.js'

interface ZipEntry { name: string; flags: number; method: number; crc: number; compressed: number; expanded: number; offset: number; dataStart: number }
export interface BoundedZip { entries: ReadonlyMap<string, Readonly<ZipEntry>>; read(name: string): Promise<Uint8Array> }
export function zipPathBudget(name: string): number {
  if (name === 'manifest.json' || name === 'history.json') return PACKAGE_LIMITS.manifestBytes
  if (name === 'sources.json' || /^snapshots\/(?:[0-5][0-9]|6[0-3])\.sources\.json$/.test(name)) return PACKAGE_LIMITS.sourcesBytes
  if (/^sources\/[0-9a-f]{64}\.svg$/.test(name)) return PACKAGE_LIMITS.sourceBytes
  if (name === 'scene.json' || name === 'identity.json' || name === 'appearance.json' || /^snapshots\/(?:[0-5][0-9]|6[0-3])\.(?:scene|identity|appearance)\.json$/.test(name)) return PACKAGE_LIMITS.sceneBytes
  if (/^assets\/[0-9a-f]{64}\.(?:png|jpg|webp)$/.test(name)) return PACKAGE_LIMITS.imageBytes
  if (/^licenses\/[0-9a-f]{64}\.txt$/.test(name)) return PACKAGE_LIMITS.licenseBytes
  return failPackage('ZIP包含不安全、未知、目录或嵌套归档路径。')
}

/** Captures the caller bytes synchronously, then validates every directory/local record. */
export function inspectZip(input: Uint8Array, signal?: CancellationSignal): BoundedZip {
  checkCancelled(signal)
  const file = captureBytes(input, PACKAGE_LIMITS.compressedBytes)
  if (file.length < 22 || file.length > PACKAGE_LIMITS.compressedBytes) failPackage('压缩工程须为有效ZIP，且不得超过100 MiB。')
  const slice = (start: number, length: number): Uint8Array => {
    checkCancelled(signal)
    if (!Number.isSafeInteger(start + length) || start < 0 || length < 0 || start + length > file.length) failPackage('ZIP条目越界。')
    const result = file.slice(start, start + length)
    checkCancelled(signal)
    if (result.length !== length) failPackage('ZIP文件在读取时截断。')
    return result
  }
  const tailStart = Math.max(0, file.length - 65_557), tail = slice(tailStart, file.length - tailStart), tailView = new DataView(tail.buffer)
  let end = tail.length - 22
  while (end >= 0 && (tailView.getUint32(end, true) !== 0x06054b50 || end + 22 + tailView.getUint16(end + 20, true) !== tail.length)) end--
  if (end < 0) failPackage('缺少有效ZIP结束记录。')
  const u16 = (offset: number) => tailView.getUint16(end + offset, true), u32 = (offset: number) => tailView.getUint32(end + offset, true)
  if (u16(4) || u16(6) || u16(8) !== u16(10)) failPackage('不支持分卷ZIP。')
  if (u16(20)) failPackage('不接受附加ZIP注释。')
  const count = u16(10), centralSize = u32(12), centralStart = u32(16)
  if (count < 2 || count > PACKAGE_LIMITS.entries) failPackage('ZIP条目数量超过保护值或缺少必要条目。')
  if (centralStart + centralSize !== tailStart + end || centralSize > count * (46 + 128 + 4096)) failPackage('ZIP中央目录越界、过大或含额外记录。')
  const central = slice(centralStart, centralSize), view = new DataView(central.buffer), entries = new Map<string, ZipEntry>()
  let cursor = 0, totalExpanded = 0, documentBytes = 0
  const extra = (bytes: Uint8Array): void => {
    const extraView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    while (offset < bytes.length) {
      if (offset + 4 > bytes.length) failPackage('ZIP extra字段截断。')
      const tag = extraView.getUint16(offset, true), length = extraView.getUint16(offset + 2, true)
      if (tag === 1 || offset + 4 + length > bytes.length) failPackage('不支持ZIP64或无效extra字段。')
      offset += 4 + length
    }
  }
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > central.length || view.getUint32(cursor, true) !== 0x02014b50 || view.getUint16(cursor + 6, true) > 20 || view.getUint16(cursor + 34, true)) failPackage('ZIP中央目录格式或版本不支持。')
    const nameSize = view.getUint16(cursor + 28, true), extraSize = view.getUint16(cursor + 30, true), commentSize = view.getUint16(cursor + 32, true)
    if (!nameSize || nameSize > 128 || extraSize > 4096 || commentSize || cursor + 46 + nameSize + extraSize > central.length) failPackage('ZIP路径、附加字段或注释不支持。')
    let name: string
    try { name = decodeUtf8(central.subarray(cursor + 46, cursor + 46 + nameSize)) } catch { return failPackage('ZIP路径必须为有效UTF-8。') }
    if (entries.has(name)) failPackage('ZIP包含重复路径。')
    const budget = zipPathBudget(name)
    extra(central.subarray(cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize))
    const entry: ZipEntry = { name, flags: view.getUint16(cursor + 8, true), method: view.getUint16(cursor + 10, true), crc: view.getUint32(cursor + 16, true), compressed: view.getUint32(cursor + 20, true), expanded: view.getUint32(cursor + 24, true), offset: view.getUint32(cursor + 42, true), dataStart: 0 }
    if (entry.flags & ~0x080e || ![0, 8].includes(entry.method) || entry.method === 0 && entry.flags & 6) failPackage('不支持ZIP加密、压缩方法或标志。')
    if (!entry.expanded || entry.expanded > budget || entry.compressed > PACKAGE_LIMITS.compressedBytes) failPackage('ZIP条目超过展开预算。')
    if ((totalExpanded += entry.expanded) > PACKAGE_LIMITS.expandedBytes) failPackage('ZIP总展开量超过300 MiB。')
    if ((name === 'scene.json' || name === 'identity.json' || name === 'appearance.json' || name.startsWith('snapshots/')) && (documentBytes += entry.expanded) > PACKAGE_LIMITS.archiveDocumentBytes) failPackage('历史文档与身份累计超过128 MiB。')
    entries.set(name, entry)
    cursor += 46 + nameSize + extraSize
  }
  if (cursor !== central.length || !entries.has('manifest.json') || !entries.has('scene.json') || !entries.has('identity.json') || !entries.has('appearance.json') || !entries.has('sources.json')) failPackage('ZIP目录未完整声明必要条目。')
  cursor = 0
  for (const entry of [...entries.values()].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset !== cursor || cursor + 30 > centralStart) failPackage('ZIP本地条目重叠或包含额外数据。')
    const local = slice(cursor, 30), localView = new DataView(local.buffer)
    if (localView.getUint32(0, true) !== 0x04034b50 || localView.getUint16(4, true) > 20 || localView.getUint16(6, true) !== entry.flags || localView.getUint16(8, true) !== entry.method) failPackage('ZIP本地条目与目录不一致。')
    const nameSize = localView.getUint16(26, true), extraSize = localView.getUint16(28, true)
    if (!nameSize || nameSize > 128 || extraSize > 4096 || cursor + 30 + nameSize + extraSize + entry.compressed > centralStart) failPackage('ZIP本地路径或数据越界。')
    const names = slice(cursor + 30, nameSize + extraSize)
    let localName: string
    try { localName = decodeUtf8(names.subarray(0, nameSize)) } catch { return failPackage('ZIP本地路径编码无效。') }
    if (localName !== entry.name) failPackage('ZIP本地路径与目录不一致。')
    extra(names.subarray(nameSize))
    if (!(entry.flags & 8)) {
      if (localView.getUint32(14, true) !== entry.crc || localView.getUint32(18, true) !== entry.compressed || localView.getUint32(22, true) !== entry.expanded) failPackage('ZIP本地长度或CRC不一致。')
    } else if (localView.getUint32(14, true) && localView.getUint32(14, true) !== entry.crc || localView.getUint32(18, true) && localView.getUint32(18, true) !== entry.compressed || localView.getUint32(22, true) && localView.getUint32(22, true) !== entry.expanded) failPackage('ZIP数据描述长度不一致。')
    entry.dataStart = cursor + 30 + nameSize + extraSize
    cursor = entry.dataStart + entry.compressed
    if (entry.flags & 8) {
      if (cursor + 12 > centralStart) failPackage('ZIP数据描述截断。')
      const descriptor = slice(cursor, Math.min(16, centralStart - cursor)), descriptorView = new DataView(descriptor.buffer)
      const offset = descriptorView.getUint32(0, true) === 0x08074b50 ? 4 : 0
      if (descriptor.length < offset + 12 || descriptorView.getUint32(offset, true) !== entry.crc || descriptorView.getUint32(offset + 4, true) !== entry.compressed || descriptorView.getUint32(offset + 8, true) !== entry.expanded) failPackage('ZIP数据描述不一致。')
      cursor += offset + 12
    }
  }
  if (cursor !== centralStart) failPackage('ZIP本地数据未完整声明。')
  let actualExpanded = 0
  const readNames = new Set<string>()
  return { entries, async read(name: string): Promise<Uint8Array> {
    checkCancelled(signal)
    const entry = entries.get(name)
    if (!entry) failPackage('ZIP缺少所需条目。')
    if (readNames.has(name)) failPackage('ZIP条目不允许重复解压。')
    readNames.add(name)
    const compressed = slice(entry.dataStart, entry.compressed)
    let expanded: Uint8Array
    if (entry.method === 0) {
      if (compressed.length !== entry.expanded) failPackage('ZIP stored长度不一致。')
      expanded = compressed; actualExpanded += expanded.length
    } else {
      const chunks: Uint8Array[] = []; let size = 0
      const inflater = new Inflate(chunk => {
        checkCancelled(signal)
        size += chunk.length; actualExpanded += chunk.length
        if (size > entry.expanded || actualExpanded > PACKAGE_LIMITS.expandedBytes) failPackage('ZIP实际展开量超过声明或保护值。')
        chunks.push(chunk)
      })
      try { for (let offset = 0; offset < compressed.length; offset += 1024) { checkCancelled(signal); inflater.push(compressed.subarray(offset, offset + 1024), offset + 1024 >= compressed.length) } }
      catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; return failPackage(error instanceof Error ? error.message : 'ZIP解压失败。') }
      if (size !== entry.expanded) failPackage('ZIP实际展开长度不匹配。')
      expanded = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { expanded.set(chunk, offset); offset += chunk.length }
    }
    if (actualExpanded > PACKAGE_LIMITS.expandedBytes || crc32(expanded) !== entry.crc) failPackage('ZIP实际展开总量超限或CRC校验失败。')
    checkCancelled(signal)
    return expanded
  } }
}
