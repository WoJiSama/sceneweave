import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const fail = message => { throw new Error(`Archived fixture rejected: ${message}`) }

function validateFixture(item, bytes) {
  const [sample, countText] = item.name.split('-'), count = Number(countText), summary = item.summary
  if (!summary || summary.fixtureVersion !== 'b5-real-assets-v1' || summary.sample !== sample || summary.propCount !== count
    || !Number.isSafeInteger(summary.originalPropCount) || !Number.isSafeInteger(summary.addedPropCount)
    || summary.originalPropCount < 0 || summary.addedPropCount < 0 || summary.originalPropCount + summary.addedPropCount !== count) fail(`${item.name} summary identity/count mismatch`)
  const files = unzipSync(bytes, { filter: file => {
    if (!['manifest.json', 'scene.json'].includes(file.name)) return false
    if (file.originalSize > (file.name === 'scene.json' ? 20 * 1024 * 1024 : 1024 * 1024)) fail(`${item.name} JSON entry exceeds its package budget`)
    return true
  } })
  if (!files['manifest.json'] || !files['scene.json']) fail(`${item.name} package JSON entries missing`)
  const container = JSON.parse(strFromU8(files['manifest.json'])), scene = JSON.parse(strFromU8(files['scene.json']))
  const sceneEntry = container.entries?.find(entry => entry.path === 'scene.json' && entry.role === 'scene')
  if (container.format !== 'sceneweave-project' || container.containerVersion !== 2 || container.documentSchemaVersion !== 2 || container.packageMode !== 'complete'
    || scene.format !== 'sceneweave' || scene.schemaVersion !== 2 || scene.sceneId !== `b5-${item.name}` || scene.revision !== 0
    || container.sceneId !== scene.sceneId || container.revision !== scene.revision
    || sceneEntry?.sha256 !== hash(files['scene.json']) || sceneEntry?.sizeBytes !== files['scene.json'].length) fail(`${item.name} package identity/scene hash mismatch`)
  const counts = { propCount: 'props', assetReferenceCount: 'assets', materialDefinitionCount: 'materials', propDefinitionCount: 'propDefinitions', prefabDefinitionCount: 'prefabDefinitions', prefabInstanceCount: 'prefabInstances', scatterGroupCount: 'scatterGroups' }
  for (const [field, key] of Object.entries(counts)) if (!scene[key] || Object.keys(scene[key]).length !== summary[field]) fail(`${item.name} ${field} differs from package scene`)
  if (!equal(scene.exportBoundsMm, summary.worldBoundsMm) || !equal(scene.props[summary.editablePropId]?.positionMm, summary.selectionPointMm)) fail(`${item.name} summary bounds/selection differs from package scene`)
  const scatterMembers = Object.values(scene.scatterGroups).reduce((n, group) => n + Object.values(group.members).filter(member => member.propId !== null).length, 0)
  if (scatterMembers !== summary.originalScatterMemberCount) fail(`${item.name} scatter member summary differs from package scene`)
  const assets = container.entries.filter(entry => entry.role === 'asset'), alpha = summary.alphaStatistics
  if (!Array.isArray(alpha) || assets.length !== summary.uniqueImageCount || alpha.length !== assets.length
    || new Set(alpha.map(entry => entry.sha256)).size !== alpha.length) fail(`${item.name} unique asset/alpha summary mismatch`)
  for (const entry of assets) {
    const stat = alpha.find(value => value.sha256 === entry.sha256)
    if (!stat || stat.encodedBytes !== entry.sizeBytes) fail(`${item.name} image byte summary differs from package manifest`)
    const refs = Object.values(scene.assets).filter(ref => ref.sha256 === entry.sha256)
    if (!refs.length || refs.some(ref => ref.pixelWidth !== stat.width || ref.pixelHeight !== stat.height)) fail(`${item.name} image pixel summary differs from package scene`)
  }
  if (alpha.reduce((n, entry) => n + entry.width * entry.height, 0) !== summary.uniqueImagePixels
    || assets.reduce((n, entry) => n + entry.sizeBytes, 0) !== summary.uniqueImageEncodedBytes) fail(`${item.name} image totals differ from archive summary`)
}

/** Copy the original package bytes and summary; measured cold-open still uses the full product reader. */
export async function copyArchivedFixtures({ sourceDirectory, outputDirectory, requestedCases }) {
  if (!path.isAbsolute(sourceDirectory)) fail('--fixtures requires an absolute archive directory')
  const source = await fs.realpath(sourceDirectory), destination = await fs.realpath(outputDirectory)
  const relative = path.relative(source, destination)
  if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) fail('output must be independent of the source archive')
  const manifestBytes = await fs.readFile(path.join(source, 'manifest.json'))
  if (manifestBytes.length > 5 * 1024 * 1024) fail('source manifest exceeds 5 MiB')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest.status !== 'complete' || !Array.isArray(manifest.cases) || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision)) fail('source manifest must be a completed measured archive with a source revision')
  const names = manifest.cases.map(item => item.name)
  if (new Set(names).size !== names.length) fail('source manifest contains duplicate cases')
  const copies = []
  for (const name of requestedCases) {
    if (!/^(study|island)-(500|2000)$/.test(name)) fail(`unsupported requested case ${name}`)
    const item = manifest.cases.find(entry => entry.name === name), expectedPath = `fixtures/${name}.sceneweave`
    if (!item || item.artifact?.path !== expectedPath || !Number.isSafeInteger(item.artifact.sizeBytes) || item.artifact.sizeBytes <= 0 || !/^[a-f0-9]{64}$/.test(item.artifact.sha256)) fail(`${name} artifact declaration missing/invalid`)
    const sourcePath = await fs.realpath(path.join(source, expectedPath))
    if (!sourcePath.startsWith(`${source}${path.sep}`)) fail(`${name} source escapes archive directory`)
    const bytes = await fs.readFile(sourcePath)
    if (bytes.length !== item.artifact.sizeBytes || hash(bytes) !== item.artifact.sha256) fail(`${name} package SHA-256/size mismatch`)
    validateFixture(item, bytes)
    await fs.mkdir(path.join(destination, 'fixtures'), { recursive: true })
    const copiedPath = path.join(destination, expectedPath)
    await fs.writeFile(copiedPath, bytes, { flag: 'wx' })
    const copied = await fs.readFile(copiedPath)
    if (!copied.equals(bytes) || hash(copied) !== item.artifact.sha256) fail(`${name} copied bytes differ from archive`)
    copies.push({ name, summary: item.summary, artifact: { ...item.artifact }, sourceSummarySha256: hash(JSON.stringify(item.summary)) })
  }
  return { cases: copies, provenance: { mode: 'archived-original-bytes', sourceManifestSha256: hash(manifestBytes), sourceManifestSizeBytes: manifestBytes.length,
    sourceRevision: manifest.sourceRevision, sourceMeasurementClass: manifest.measurementClass, sourceFinishedAt: manifest.finishedAt,
    verification: 'Original package SHA-256/size, internal scene SHA-256/identity/counts/bounds/asset totals and copied bytes checked; summary copied exactly with its JSON SHA-256, not regenerated. Full product package/resource validation occurs again during every measured cold-open.' } }
}
