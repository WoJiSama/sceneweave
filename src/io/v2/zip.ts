import { Inflate } from 'fflate'
import { checkCancelled, crc32, failV2, PROJECT_LIMITS_V2 } from './limits'
import { utf8Decoder } from './json'

interface ZipEntry { name: string; flags: number; method: number; crc: number; compressed: number; expanded: number; offset: number; dataStart: number }
export interface BoundedZipV2 {
  entries: ReadonlyMap<string, Readonly<ZipEntry>>
  read(name: string): Promise<Uint8Array>
}

function pathBudget(name: string): number {
  if (name === 'manifest.json') return PROJECT_LIMITS_V2.manifestBytes
  if (name === 'scene.json') return PROJECT_LIMITS_V2.sceneBytes
  if (/^assets\/[0-9a-f]{64}\.(?:png|jpg|webp)$/.test(name)) return PROJECT_LIMITS_V2.imageBytes
  if (/^licenses\/[0-9a-f]{64}\.txt$/.test(name)) return PROJECT_LIMITS_V2.licenseBytes
  return failV2('ZIP 包含不安全、未知、目录或嵌套归档路径。')
}

/** Directory and local headers are sliced and checked before resource bodies. */
export async function inspectZipV2(file: Blob, signal?: AbortSignal): Promise<BoundedZipV2> {
  checkCancelled(signal)
  if (!(file instanceof Blob) || file.size < 22 || file.size > PROJECT_LIMITS_V2.compressedBytes) failV2('压缩工程须为有效 ZIP，且不得超过 100 MiB。')
  const slice = async (start: number, length: number): Promise<Uint8Array> => {
    checkCancelled(signal)
    if (!Number.isSafeInteger(start + length) || start < 0 || length < 0 || start + length > file.size) failV2('ZIP 条目越界。')
    const result = new Uint8Array(await file.slice(start, start + length).arrayBuffer())
    checkCancelled(signal)
    if (result.length !== length) failV2('ZIP 文件在读取时截断。')
    return result
  }
  const tailStart = Math.max(0, file.size - 65_557)
  const tail = await slice(tailStart, file.size - tailStart)
  const tailView = new DataView(tail.buffer)
  let end = tail.length - 22
  while (end >= 0 && (tailView.getUint32(end, true) !== 0x06054b50 || end + 22 + tailView.getUint16(end + 20, true) !== tail.length)) end--
  if (end < 0) failV2('缺少有效 ZIP 结束记录。')
  const u16 = (offset: number) => tailView.getUint16(end + offset, true)
  const u32 = (offset: number) => tailView.getUint32(end + offset, true)
  if (u16(4) || u16(6) || u16(8) !== u16(10)) failV2('不支持分卷 ZIP。')
  if (u16(20)) failV2('不接受附加 ZIP 注释。')
  const count = u16(10), centralSize = u32(12), centralStart = u32(16)
  if (count < 2 || count > PROJECT_LIMITS_V2.entries) failV2('ZIP 条目数量超过保护值或缺少必要条目。')
  if (centralStart + centralSize !== tailStart + end || centralSize > count * (46 + 128 + 4096)) failV2('ZIP 中央目录越界、过大或含额外记录。')
  const central = await slice(centralStart, centralSize)
  const view = new DataView(central.buffer)
  const entries = new Map<string, ZipEntry>()
  let cursor = 0, totalExpanded = 0
  const extra = (bytes: Uint8Array): void => {
    const extraView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    while (offset < bytes.length) {
      if (offset + 4 > bytes.length) failV2('ZIP extra 字段截断。')
      const tag = extraView.getUint16(offset, true), length = extraView.getUint16(offset + 2, true)
      if (tag === 1 || offset + 4 + length > bytes.length) failV2('不支持 ZIP64 或无效 extra 字段。')
      offset += 4 + length
    }
  }
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > central.length || view.getUint32(cursor, true) !== 0x02014b50
      || view.getUint16(cursor + 6, true) > 20 || view.getUint16(cursor + 34, true)) failV2('ZIP 中央目录格式或版本不支持。')
    const nameSize = view.getUint16(cursor + 28, true), extraSize = view.getUint16(cursor + 30, true), commentSize = view.getUint16(cursor + 32, true)
    if (!nameSize || nameSize > 128 || extraSize > 4096 || commentSize || cursor + 46 + nameSize + extraSize > central.length) failV2('ZIP 路径、附加字段或注释不支持。')
    let name: string
    try { name = utf8Decoder.decode(central.subarray(cursor + 46, cursor + 46 + nameSize)) } catch { return failV2('ZIP 路径必须为有效 UTF-8。') }
    if (entries.has(name)) failV2('ZIP 包含重复路径。')
    const budget = pathBudget(name)
    extra(central.subarray(cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize))
    const entry: ZipEntry = { name, flags: view.getUint16(cursor + 8, true), method: view.getUint16(cursor + 10, true), crc: view.getUint32(cursor + 16, true), compressed: view.getUint32(cursor + 20, true), expanded: view.getUint32(cursor + 24, true), offset: view.getUint32(cursor + 42, true), dataStart: 0 }
    if (entry.flags & ~0x080e || ![0, 8].includes(entry.method) || (entry.method === 0 && (entry.flags & 6))) failV2('不支持 ZIP 加密、压缩方法或标志。')
    if (!entry.expanded || entry.expanded > budget || entry.compressed > PROJECT_LIMITS_V2.compressedBytes) failV2('ZIP 条目超过展开预算。')
    if ((totalExpanded += entry.expanded) > PROJECT_LIMITS_V2.expandedBytes) failV2('ZIP 总展开量超过 300 MiB。')
    entries.set(name, entry)
    cursor += 46 + nameSize + extraSize
  }
  if (cursor !== central.length || !entries.has('manifest.json') || !entries.has('scene.json')) failV2('ZIP 目录未完整声明必要条目。')
  cursor = 0
  for (const entry of [...entries.values()].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset !== cursor || cursor + 30 > centralStart) failV2('ZIP 本地条目重叠或包含额外数据。')
    const local = await slice(cursor, 30)
    const localView = new DataView(local.buffer)
    if (localView.getUint32(0, true) !== 0x04034b50 || localView.getUint16(4, true) > 20 || localView.getUint16(6, true) !== entry.flags || localView.getUint16(8, true) !== entry.method) failV2('ZIP 本地条目与目录不一致。')
    const nameSize = localView.getUint16(26, true), extraSize = localView.getUint16(28, true)
    if (!nameSize || nameSize > 128 || extraSize > 4096 || cursor + 30 + nameSize + extraSize + entry.compressed > centralStart) failV2('ZIP 本地路径或数据越界。')
    const names = await slice(cursor + 30, nameSize + extraSize)
    let localName: string
    try { localName = utf8Decoder.decode(names.subarray(0, nameSize)) } catch { return failV2('ZIP 本地路径编码无效。') }
    if (localName !== entry.name) failV2('ZIP 本地路径与目录不一致。')
    extra(names.subarray(nameSize))
    if (!(entry.flags & 8)) {
      if (localView.getUint32(14, true) !== entry.crc || localView.getUint32(18, true) !== entry.compressed || localView.getUint32(22, true) !== entry.expanded) failV2('ZIP 本地长度或 CRC 不一致。')
    } else if ((localView.getUint32(14, true) && localView.getUint32(14, true) !== entry.crc)
      || (localView.getUint32(18, true) && localView.getUint32(18, true) !== entry.compressed)
      || (localView.getUint32(22, true) && localView.getUint32(22, true) !== entry.expanded)) failV2('ZIP 数据描述长度不一致。')
    entry.dataStart = cursor + 30 + nameSize + extraSize
    cursor = entry.dataStart + entry.compressed
    if (entry.flags & 8) {
      if (cursor + 12 > centralStart) failV2('ZIP 数据描述截断。')
      const descriptor = await slice(cursor, Math.min(16, centralStart - cursor))
      const descriptorView = new DataView(descriptor.buffer)
      const offset = descriptorView.getUint32(0, true) === 0x08074b50 ? 4 : 0
      if (descriptor.length < offset + 12 || descriptorView.getUint32(offset, true) !== entry.crc
        || descriptorView.getUint32(offset + 4, true) !== entry.compressed || descriptorView.getUint32(offset + 8, true) !== entry.expanded) failV2('ZIP 数据描述不一致。')
      cursor += offset + 12
    }
  }
  if (cursor !== centralStart) failV2('ZIP 本地数据未完整声明。')
  let actualExpanded = 0
  const readNames = new Set<string>()
  return {
    entries,
    async read(name: string): Promise<Uint8Array> {
      checkCancelled(signal)
      const entry = entries.get(name)
      if (!entry) failV2('ZIP 缺少所需条目。')
      if (readNames.has(name)) failV2('ZIP 条目不允许重复解压。')
      readNames.add(name)
      const compressed = await slice(entry.dataStart, entry.compressed)
      let expanded: Uint8Array
      if (entry.method === 0) {
        if (compressed.length !== entry.expanded) failV2('ZIP stored 长度不一致。')
        expanded = compressed
        actualExpanded += expanded.length
      } else {
        const chunks: Uint8Array[] = []
        let size = 0
        const inflater = new Inflate(chunk => {
          checkCancelled(signal)
          size += chunk.length; actualExpanded += chunk.length
          if (size > entry.expanded || actualExpanded > PROJECT_LIMITS_V2.expandedBytes) failV2('ZIP 实际展开量超过声明或保护值。')
          chunks.push(chunk)
        })
        try {
          for (let offset = 0; offset < compressed.length; offset += 1024) {
            checkCancelled(signal)
            inflater.push(compressed.subarray(offset, offset + 1024), offset + 1024 >= compressed.length)
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error
          return failV2(error instanceof Error ? error.message : 'ZIP 解压失败。')
        }
        if (size !== entry.expanded) failV2('ZIP 实际展开长度不匹配。')
        expanded = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { expanded.set(chunk, offset); offset += chunk.length }
      }
      if (actualExpanded > PROJECT_LIMITS_V2.expandedBytes || crc32(expanded) !== entry.crc) failV2('ZIP 实际展开总量超限或 CRC 校验失败。')
      checkCancelled(signal)
      return expanded
    },
  }
}
