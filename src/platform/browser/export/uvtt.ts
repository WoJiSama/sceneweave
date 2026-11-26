import { strToU8, zipSync } from 'fflate'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { buildUvttPlan, UVTT_TARGET as sourceTarget, type UvttPlan } from '../../../shared/export/uvtt.js'
import { uvttWallRuns } from '../../../shared/export/uvtt-wall-runs.js'
import { createBrowserImagePort } from '../images/adapter.js'
import { createBrowserSvgPort } from '../ai/svg-port.js'
import { encodePng, renderRasterProjection } from '../render/canvas-renderer.js'

export const UVTT_TARGET = Object.freeze({
  software: `Foundry VTT ${sourceTarget.foundryMajor}`, importer: `${sourceTarget.importer} ${sourceTarget.version}`,
  source: sourceTarget.source,
  verification: '源码映射与本地自检；尚未在真实目标软件中导入验证',
})

function base64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x6000) chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 0x6000))))
  return chunks.join('')
}

function validateBundle(input: ProjectBundle, signal?: AbortSignal) {
  return validateProjectBundle(input, { images: createBrowserImagePort(), svg: createBrowserSvgPort(), signal })
}

async function renderFloor(bundle: ProjectBundle, plan: UvttPlan, filename: string, signal?: AbortSignal) {
  checkCancelled(signal)
  if (plan.report.blocked.length || !plan.geometry || !plan.projection) throw new Error(plan.report.blocked.join(' ') || '无法生成安全的 VTT 导入包。')
  const scene = bundle.project.document
  const output = await renderRasterProjection({ assetRefs: scene.assets, assets: bundle.project.assets, resources: bundle.resources, vectorSources: bundle.project.authoringSources }, plan.projection,
    { audience: 'player', longEdgePx: Math.max(plan.widthPx, plan.heightPx), signal }, undefined, undefined, undefined, plan.sourceBoundsMm)
  if (output.width !== plan.widthPx || output.height !== plan.heightPx) {
    output.width = output.height = 1
    throw new Error('VTT 图片尺寸与比例映射不一致。')
  }
  const png = await encodePng(output, signal), bytes = new Uint8Array(await png.arrayBuffer())
  checkCancelled(signal)
  const data = { ...plan.geometry, line_of_sight: uvttWallRuns(plan.geometry.line_of_sight), image: base64(bytes) }
  const { wallSegments, portals, lights, blockingProps } = plan.report.counts
  const report = { target: UVTT_TARGET, image: { widthPx: plan.widthPx, heightPx: plan.heightPx },
    sourceBoundsMm: plan.sourceBoundsMm, paddedBoundsMm: plan.boundsMm, units: plan.units, resolution: plan.geometry.resolution,
    targetSettings: { grid: { distance: plan.units.distancePerGrid, units: plan.units.distanceUnit }, lights: plan.geometry.lights.map(light => ({
      position: light.position, dim: light.range * plan.units.distancePerGrid, bright: light.range * plan.units.distancePerGrid / 2, alpha: light.intensity * .05,
    })) }, blocked: [], warnings: plan.report.warnings, counts: { wallSegments, portals, lights, blockingProps } }
  const instructions = [
    'Sceneweave — 主持人 VTT 导入包',
    `${UVTT_TARGET.software} / ${UVTT_TARGET.importer}`, UVTT_TARGET.verification,
    '', '1. 解压。先阅读 mapping-report.json 中的全部降级说明。',
    `2. 在 Universal Battlemap Importer 选择 ${filename}。采用文件内每格像素，墙线偏移设为 0，墙线精度设为最高。`,
    `3. 导入后将每格距离设为 ${plan.units.distancePerGrid} ${plan.units.distanceUnit}。原图格线${plan.units.gridVisible ? '显示' : '隐藏'}；底图不烘焙格线，按需在目标场景显示格线。`,
    '4. 按报告校正门的开关/锁及窗口，检查原点、比例、墙线、灯光和玩家角色视角，保存后重开复查。',
    '   导入器按规则系统默认距离生成灯半径；修改场景每格距离后，须将每盏灯的 dim/bright 校正为 mapping-report.json 的 targetSettings.lights 值。',
    '5. 未揭示的秘密门按连续墙交付。固定遮罩覆盖区域使用不透明底图，只有公开区域的墙、门和灯作为原生结构导入。',
    '6. 此包不是可编辑完整工程，也不是直接交给玩家的文件。保留原 .sceneweave。',
    '7. 不使用原生墙/灯时，请回到 Sceneweave 导出普通玩家 PNG；本包 map.png 未烘焙点光与门符号。',
    '', '映射参考：', UVTT_TARGET.source, '', ...plan.report.warnings.map(value => `- ${value}`),
  ].join('\n')
  return { [filename]: strToU8(JSON.stringify(data)), 'map.png': bytes,
    'mapping-report.json': strToU8(JSON.stringify(report, null, 2)), 'README.txt': strToU8(instructions) }
}

function packVtt(entries: Record<string, Uint8Array>, signal?: AbortSignal): Blob {
  checkCancelled(signal)
  const archive = zipSync(entries, { level: 0, mtime: new Date(2000, 0, 1) })
  checkCancelled(signal)
  return new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' })
}

/** A new export validates the complete captured bundle, including actual bytes and pixels. */
export async function exportUvtt(input: ProjectBundle, signal?: AbortSignal, floorId?: string, wideMap = false): Promise<Blob> {
  const bundle = await validateBundle(input, signal)
  const plan = buildUvttPlan(bundle.project.document, bundle.project.appearance, floorId, wideMap)
  return packVtt(await renderFloor(bundle, plan, 'scene.dd2vtt', signal), signal)
}

/** Separate scene files retain each Floor's own range and scale. */
export async function exportUvttFloors(input: ProjectBundle, signal?: AbortSignal, wideMap = false): Promise<Blob> {
  const bundle = await validateBundle(input, signal), { document, appearance } = bundle.project
  const plans = Object.keys(document.floors).map(floorId => buildUvttPlan(document, appearance, floorId, wideMap))
  const blocked = plans.find(plan => plan.report.blocked.length)
  if (blocked) throw new Error(blocked.report.blocked.join(' '))
  const entries: Record<string, Uint8Array> = {
    'README.txt': strToU8('按编号分别导入各目录中的 .dd2vtt 文件。每个文件有自己的格距、范围和导入报告。跨层入口须在目标场景中建立。'),
  }
  let bytes = entries['README.txt'].byteLength
  for (const [i, plan] of plans.entries()) {
    const name = `floor-${String(i + 1).padStart(2, '0')}`
    const files = await renderFloor(bundle, plan, `${name}.dd2vtt`, signal)
    for (const [path, data] of Object.entries(files)) {
      bytes += data.byteLength
      if (bytes > 128 * 1024 * 1024) throw new Error('全部楼层的 VTT 导入包超过 128 MiB。请选择当前楼层分别导出。')
      entries[`${name}/${path}`] = data
    }
  }
  return packVtt(entries, signal)
}
