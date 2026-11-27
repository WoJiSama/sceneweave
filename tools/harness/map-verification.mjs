import fs from 'node:fs/promises'
import path from 'node:path'
import { assert, digest, MAX_ARCHIVE_BYTES, MAX_MAP_REQUEST_BYTES, readBounded } from './io.mjs'
import { readCachedMapPreview } from './map-preview-cache.mjs'

const filenames = { request: 'request.json', project: 'map.sceneweave', preview: 'preview.png', oblique: 'oblique.png', diagnostic: 'diagnostic.png', overlay: 'overlay.png' }

export async function openSavedMap(directory, workspace) {
  const folder = await fs.realpath(directory)
  const read = async (parent, name, maximum) => {
    const resolved = await fs.realpath(path.join(parent, name))
    assert(path.dirname(resolved) === parent && path.basename(resolved) === name, '候选各文件须位于其目录内，使用原文件名。')
    return { directory: parent, path: resolved, bytes: await readBounded(resolved, maximum) }
  }
  const { bytes: resultBytes } = await read(folder, 'result.json', 2 * 1024 * 1024)
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resultBytes))
  assert(record.format === 'sceneweave-map-authoring-result' && record.version === 1, '请选择地图工具生成的候选目录。')
  const artifact = async key => {
    assert(Object.hasOwn(filenames, key), '未知候选文件。')
    const name = filenames[key], entry = record.files?.[key]
    assert(entry?.file === name, `候选文件与回执不符：${name}。`)
    let parent = folder
    if (entry.sourceDirectory !== undefined) {
      assert(typeof entry.sourceDirectory === 'string', '复验来源须使用文件目录。')
      parent = await fs.realpath(path.resolve(folder, entry.sourceDirectory))
      const relative = path.relative(workspace ?? path.dirname(folder), parent)
      assert(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        '复验来源须位于已授权制图目录。可以选原候选，或使用独立交付目录。')
    }
    if (entry.storage === 'cache') {
      assert(['preview', 'oblique', 'diagnostic', 'overlay'].includes(key), '只有预览、叠图或诊断可使用缓存。')
      return { directory: parent, ...await readCachedMapPreview(parent, entry) }
    }
    assert(entry.storage === undefined, '未知制图产物存储类型。')
    const captured = await read(parent, name, key === 'request' ? MAX_MAP_REQUEST_BYTES : MAX_ARCHIVE_BYTES)
    assert(entry.byteLength === captured.bytes.length && entry.sha256 === digest(captured.bytes), `候选文件与回执不符：${name}。`)
    return { ...captured, record: entry }
  }
  return { folder, record, receiptSha256: digest(resultBytes), artifact, file: async key => (await artifact(key)).bytes }
}

export async function captureMapCandidate(directory, previews = 'keep', workspace) {
  const source = await openSavedMap(directory, workspace), { record } = source
  const deferred = record.previewState === 'deferred' && record.action === 'generate' && record.status === 'draft'
  assert(['draft', 'verifying', 'complete', 'failed'].includes(record.status) && (record.candidateReadyAt || record.status === 'failed' && record.topReadyAt)
    && record.files?.project && (record.files?.preview || deferred) && (record.action === 'generate' || record.action === 'edit' || record.action === 'verify')
    && /^[a-f0-9]{64}$/.test(record.projectHash ?? '') && typeof record.floorId === 'string',
  '候选还没有完整落盘。请选择工具已保存的草稿或已完成目录。')
  assert(record.error?.code !== 'operation_budget', '原候选超出预算，请调整输入并建立新候选。')
  assert(!record.reference?.issues?.some(issue => issue.kind === 'design'), '参考图草稿仍有未解决的设计标记，请按叠图调整后建立新候选。')
  const action = record.action === 'verify' ? record.source?.action : record.action
  assert(action === 'generate' || action === 'edit', '候选缺少原始制图动作。')
  const request = await source.artifact('request')
  const project = await source.artifact('project')
  let cacheMiss = deferred
  const previewArtifact = async key => {
    if (previews !== 'keep' || !record.files[key]) return
    try { return await source.artifact(key) }
    catch (error) {
      if (error.code !== 'map_preview_evicted') throw error
      cacheMiss = true
    }
  }
  const preview = await previewArtifact('preview'), oblique = await previewArtifact('oblique')
  return { source: { action, receiptSha256: source.receiptSha256 }, request, project, preview, oblique, cacheMiss,
    previews: { preview: record.files.preview, oblique: record.files.oblique },
    expectedOblique: record.expectedOblique === true || !!record.files.oblique, projectHash: record.projectHash, floorId: record.floorId,
    ascentChecks: Array.isArray(record.ascentChecks) ? record.ascentChecks : [] }
}

// Cold review confirms the saved width. Keep generation search evidence only
// for the same successful ascent and the same width requirements.
export function retainAscentWidthAttempts(checks, previous = []) {
  return checks?.map(check => {
    if (!check.ok || !check.reduction) return check
    const original = previous.find(row => row?.ok === true && row.id === check.id
      && row.preferredWidthMm === check.preferredWidthMm && row.minimumWidthMm === check.minimumWidthMm
      && row.actualWidthMm === check.actualWidthMm)
    const rejected = original?.reduction?.rejected
    if (!Array.isArray(rejected)) return check
    const attempts = rejected.slice(0, 3).filter(row => Number.isInteger(row?.widthMm)
      && row.widthMm > check.actualWidthMm && row.widthMm <= check.preferredWidthMm
      && Number.isInteger(row.graded) && row.graded >= 0 && Array.isArray(row.issues))
    return attempts.length ? { ...check, reduction: { ...check.reduction, rejected: attempts } } : check
  })
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
