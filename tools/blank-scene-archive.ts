import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zipSync } from 'fflate'
import type { Plugin, ResolvedConfig } from 'vite'
import { PACKAGE_LIMITS } from '../src/shared/project/limits.js'
import { extractTemplateFixedContent } from '../src/shared/library/content.js'
import type { ProjectData } from '../src/shared/model/project.js'
import { fixedDownloadManifest } from './fixed-download-manifest.js'

const moduleId = 'virtual:sceneweave-blank-scene'
const catalogId = 'virtual:sceneweave-starter-catalog'
const downloadsId = 'virtual:sceneweave-fixed-downloads'
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export function blankSceneArchive(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'sceneweave-blank-scene-archive',
    configResolved: value => { config = value },
    resolveId: id => [moduleId, catalogId, downloadsId].includes(id) ? '\0' + id : undefined,
    async load(id) {
      if (![moduleId, catalogId, downloadsId].some(name => id === '\0' + name)) return undefined

      const metadataFile = resolve(config.root, 'src/platform/browser/content/scenes-data.json')
      this.addWatchFile(metadataFile)
      const metadata = JSON.parse(await readFile(metadataFile, 'utf8')) as typeof import('../src/platform/browser/content/scenes-data.json')
      const template = metadata.scenes.blank as unknown as ProjectData
      const paths: Record<string, string> = metadata.paths
      if (id === '\0' + downloadsId) {
        const builtinFile = resolve(config.root, 'src/platform/browser/content/builtin-data.json')
        this.addWatchFile(builtinFile)
        const builtin = JSON.parse(await readFile(builtinFile, 'utf8')) as { project: ProjectData; paths: Record<string, string> }
        const scenes = Object.values(metadata.scenes) as unknown as ProjectData[]
        return 'export default ' + JSON.stringify(fixedDownloadManifest([builtin.project, ...scenes], { ...paths, ...builtin.paths }))
      }
      const embedded: Record<string, string> = metadata.embedded
      const locations = (project: ProjectData) => Object.fromEntries(Object.keys(project.assets).map(hash => {
        if (!paths[hash]) throw new Error(`Missing starter catalog image ${hash}`)
        return [hash, paths[hash]]
      }))
      if (id === '\0' + catalogId) {
        return 'export default ' + JSON.stringify({ project: template, paths: locations(template) })
      }
      const fixed = extractTemplateFixedContent(template, [
        { kind: 'material', definitionId: 'm1d-m-01' }, { kind: 'material', definitionId: 'b2-m-02' },
      ])
      const project: ProjectData = { ...fixed, historyIdentity: template.historyIdentity, document: { ...template.document,
        assets: fixed.document.assets, materials: fixed.document.materials, propDefinitions: fixed.document.propDefinitions,
        prefabDefinitions: fixed.document.prefabDefinitions, styleThemes: fixed.document.styleThemes, activeStyleThemeRef: null,
      } }
      if (config.command !== 'build') {
        return 'export default null; export const development = ' + JSON.stringify({ project, paths: locations(project) })
      }
      const rows = await Promise.all(Object.entries(project.assets).map(async ([hash, record]) => {
        const path = paths[hash]
        if (path && !/^assets\/sceneweave-handdrawn(?:-outdoor|-outpost|-content)?\/[a-z0-9-]+\.png$/.test(path)) {
          throw new Error(`Invalid blank scene resource path ${path}`)
        }
        const file = path && resolve(config.publicDir || resolve(config.root, 'public'), path)
        if (file) this.addWatchFile(file)
        const bytes = file ? await readFile(file) : Buffer.from(embedded[hash] ?? '', 'base64')
        if (bytes.byteLength !== record.sizeBytes || sha256(bytes) !== hash) throw new Error(`Blank scene resource differs from its metadata ${hash}`)
        return [`assets/${hash}.png`, bytes] as const
      }))
      const archive = zipSync({ 'template.json': Buffer.from(JSON.stringify(project)), ...Object.fromEntries(rows) },
        { level: 6, mtime: new Date(1980, 0, 1) })
      if (archive.byteLength > PACKAGE_LIMITS.imageBytes) throw new Error('Blank scene archive exceeds download budget')
      const reference = this.emitFile({ type: 'asset', name: 'blank-scene.zip', source: archive })
      return `export const development = null; export default { url: import.meta.ROLLUP_FILE_URL_${reference}, bytes: ${archive.byteLength}, sha256: '${sha256(archive)}' }`
    },
  }
}
