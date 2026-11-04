import { strToU8, zipSync } from 'fflate'
import type { ProjectBundle } from '../../../shared/model/project.js'
import { checkCancelled } from '../../../shared/ports/resources.js'
import { validateProjectBundle } from '../../../shared/project/resources.js'
import { buildUvttPlan, UVTT_TARGET as sourceTarget } from '../../../shared/export/uvtt.js'
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

/** A new export validates the complete captured bundle, including actual bytes and pixels. */
export async function exportUvtt(input: ProjectBundle, signal?: AbortSignal): Promise<Blob> {
  checkCancelled(signal)
  const bundle = await validateProjectBundle(input, { images: createBrowserImagePort(), svg: createBrowserSvgPort(), signal })
  const scene = bundle.project.document, plan = buildUvttPlan(scene, bundle.project.appearance)
  if (plan.report.blocked.length || !plan.geometry || !plan.projection) throw new Error(plan.report.blocked.join(' ') || '无法生成安全的 VTT 导入包。')
  const output = await renderRasterProjection({ assetRefs: scene.assets, assets: bundle.project.assets, resources: bundle.resources }, plan.projection,
    { audience: 'player', longEdgePx: Math.max(plan.widthPx, plan.heightPx), signal }, undefined, undefined, undefined, plan.sourceBoundsMm)
  if (output.width !== plan.widthPx || output.height !== plan.heightPx) {
    output.width = output.height = 1
    throw new Error('VTT 图片尺寸与比例映射不一致。')
  }
  const png = await encodePng(output, signal), bytes = new Uint8Array(await png.arrayBuffer())
  checkCancelled(signal)
  const data = { ...plan.geometry, image: base64(bytes) }
  const report = { target: UVTT_TARGET, image: { widthPx: plan.widthPx, heightPx: plan.heightPx },
    sourceBoundsMm: plan.sourceBoundsMm, paddedBoundsMm: plan.boundsMm, units: plan.units, resolution: plan.geometry.resolution,
    targetSettings: { grid: { distance: plan.units.distancePerGrid, units: plan.units.distanceUnit }, lights: plan.geometry.lights.map(light => ({
      position: light.position, dim: light.range * plan.units.distancePerGrid, bright: light.range * plan.units.distancePerGrid / 2, alpha: light.intensity * .05,
    })) }, ...plan.report }
  const instructions = [
    'Sceneweave — 主持人 VTT 导入包',
    `${UVTT_TARGET.software} / ${UVTT_TARGET.importer}`, UVTT_TARGET.verification,
    '', '1. 解压。先阅读 mapping-report.json 中的全部降级说明。',
    '2. 在 Universal Battlemap Importer 选择 scene.dd2vtt。保留文件内 PPG，墙线偏移设 0；不要再叠加手工缩放。',
    `3. 导入后将每格距离设为 ${plan.units.distancePerGrid} ${plan.units.distanceUnit}。原图格线${plan.units.gridVisible ? '显示' : '隐藏'}；底图不烘焙格线，按需在目标场景显示格线。`,
    '4. 按报告校正门的开关/锁及窗口，检查原点、比例、墙线、灯光和玩家角色视角，保存后重开复查。',
    '   导入器按规则系统默认距离生成灯半径；修改场景每格距离后，须将每盏灯的 dim/bright 校正为 mapping-report.json 的 targetSettings.lights 值。',
    '5. 秘密门在此格式中降为连续墙；需要主持人在目标软件中另建秘密门。包中不携带其位置或秘密文字。',
    '6. 此包不是可编辑完整工程，也不是直接交给玩家的文件。保留原 .sceneweave。',
    '7. 不使用原生墙/灯时，请回到 Sceneweave 导出普通玩家 PNG；本包 map.png 未烘焙点光与门符号。',
    '', '映射参考：', UVTT_TARGET.source, '', ...plan.report.warnings.map(value => `- ${value}`),
  ].join('\n')
  const archive = zipSync({ 'scene.dd2vtt': strToU8(JSON.stringify(data)), 'map.png': bytes,
    'mapping-report.json': strToU8(JSON.stringify(report, null, 2)), 'README.txt': strToU8(instructions) }, { level: 0, mtime: new Date(2000, 0, 1) })
  checkCancelled(signal)
  return new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' })
}
