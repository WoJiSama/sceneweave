import fs from 'node:fs/promises'
import path from 'node:path'
import { assert, digest, MAX_ARCHIVE_BYTES, MAX_MAP_REQUEST_BYTES, readBounded } from './io.mjs'

const filenames = { request: 'request.json', project: 'map.sceneweave', preview: 'preview.png', oblique: 'oblique.png', diagnostic: 'diagnostic.png' }

export async function openSavedMap(directory) {
  const folder = await fs.realpath(directory)
  const read = async (name, maximum) => {
    const resolved = await fs.realpath(path.join(folder, name))
    assert(path.dirname(resolved) === folder && path.basename(resolved) === name, '候选各文件须位于其目录内，使用原文件名。')
    return readBounded(resolved, maximum)
  }
  const resultBytes = await read('result.json', 2 * 1024 * 1024)
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resultBytes))
  assert(record.format === 'sceneweave-map-authoring-result' && record.version === 1, '请选择地图工具生成的候选目录。')
  const file = async key => {
    assert(Object.hasOwn(filenames, key), '未知候选文件。')
    const name = filenames[key], entry = record.files?.[key]
    const bytes = await read(name, key === 'request' ? MAX_MAP_REQUEST_BYTES : MAX_ARCHIVE_BYTES)
    assert(entry?.file === name && entry.byteLength === bytes.length && entry.sha256 === digest(bytes), `候选文件与回执不符：${name}。`)
    return bytes
  }
  return { record, receiptSha256: digest(resultBytes), file }
}

export async function captureMapCandidate(directory, previews = 'keep') {
  const source = await openSavedMap(directory), { record } = source
  assert(['draft', 'verifying', 'complete', 'failed'].includes(record.status) && record.candidateReadyAt
    && record.files?.project && record.files?.preview && (record.action === 'generate' || record.action === 'edit' || record.action === 'verify')
    && /^[a-f0-9]{64}$/.test(record.projectHash ?? '') && typeof record.floorId === 'string',
  '候选还没有完整落盘。请选择有工程和预览的生成或编辑目录。')
  assert(record.error?.code !== 'operation_budget', '原候选超出预算，请调整输入并建立新候选。')
  const action = record.action === 'verify' ? record.source?.action : record.action
  assert(action === 'generate' || action === 'edit', '候选缺少原始制图动作。')
  const request = await source.file('request')
  const project = await source.file('project')
  const preview = previews === 'keep' ? await source.file('preview') : undefined
  const oblique = previews === 'keep' && record.files.oblique ? await source.file('oblique') : undefined
  return { source: { action, receiptSha256: source.receiptSha256 }, request, project, preview, oblique,
    expectedOblique: record.expectedOblique === true || !!record.files.oblique, projectHash: record.projectHash, floorId: record.floorId }
}

export function compareMapPng(saved, redrawn, longEdge, decode) {
  const pixels = bytes => {
    assert(bytes.length >= 29 && bytes.readUInt32BE(16) <= longEdge && bytes.readUInt32BE(20) <= longEdge
      && Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) === longEdge, '候选 PNG 尺寸与固定视角不符。')
    return decode(bytes)
  }
  const first = pixels(saved), { width, height } = first
  if (saved.equals(redrawn)) return { width, height, changedPixels: 0 }
  const second = pixels(redrawn)
  assert(width === second.width && height === second.height, '候选 PNG 与重绘尺寸不符。')
  let changedPixels = 0, firstDifference
  for (let i = 0; i < first.rgba.length; i += 4) {
    const a = first.rgba, b = second.rgba
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue
    changedPixels++
    firstDifference ??= { x: i / 4 % width, y: Math.floor(i / 4 / width),
      savedRgba: Array.from(a.subarray(i, i + 4)), redrawnRgba: Array.from(b.subarray(i, i + 4)) }
  }
  return { width, height, changedPixels, ...(firstDifference ? { firstDifference } : {}) }
}
