import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

// These are app-owned reading aids, not replacements for immutable publisher definitions.
const legacy = {
  'material.sw.wood-dark': [['室内', '地面', '木质', '深色', '书房'], ['棕', '黑']],
  'material.sw.wood-worn': [['室内', '地面', '木质', '磨损', '旧建筑'], ['棕', '灰']],
  'material.sw.stone-paver': [['室外', '地面', '石质', '铺装', '露台'], ['灰', '棕']],
  'material.sw.wall-stone': [['建筑', '墙面', '石质', '浅色'], ['灰', '白']],
  'prop.sw.desk-oak': [['室内', '家具', '书房', '桌子', '木质'], ['棕']],
  'prop.sw.chair-oak': [['室内', '家具', '座椅', '木质'], ['棕']],
  'prop.sw.chair-worn': [['室内', '家具', '座椅', '磨损', '木质'], ['棕', '灰']],
  'prop.sw.book-stack': [['室内', '书房', '书籍', '桌面', '道具'], ['棕', '绿', '红']],
  'prop.sw.papers': [['室内', '书房', '纸张', '桌面', '线索'], ['白', '棕']],
  'prop.sw.bookshelf': [['室内', '家具', '书房', '收纳', '木质'], ['棕']],
  'prop.sw.rug-study': [['室内', '地毯', '布质', '书房', '装饰'], ['红', '灰']],
  'prop.sw.table-round': [['室外', '露台', '家具', '桌子', '木质'], ['棕']],
  'prop.sw.flowerpot': [['室内', '室外', '植被', '盆栽', '装饰'], ['棕', '绿']],
  'prop.sw.lamp-table': [['室内', '照明', '桌面', '金属', '书房'], ['棕', '黄']],
  'prop.sw.envelope': [['室内', '纸张', '桌面', '信件', '线索'], ['白', '红']],
  'material.sw.grass': [['室外', '地面', '植被', '草地', '自然'], ['绿']],
  'material.sw.rock': [['室外', '地面', '岩石', '自然', '裸岩'], ['灰', '绿']],
  'material.sw.cliff-rock': [['室外', '崖面', '岩石', '自然'], ['灰', '绿', '黑']],
  'material.sw.sand': [['室外', '地面', '海岸', '细砂', '自然'], ['黄', '棕']],
  'material.sw.water-shallow': [['室外', '水面', '海岸', '浅水', '自然'], ['青', '蓝']],
  'material.sw.water-deep': [['室外', '水面', '海岸', '深水', '自然'], ['蓝']],
  'prop.sw.tree-broadleaf': [['室外', '植被', '树木', '阔叶', '自然'], ['绿']],
  'prop.sw.tree-sparse': [['室外', '植被', '树木', '疏叶', '自然'], ['绿', '棕']],
  'prop.sw.shrub-round': [['室外', '植被', '灌木', '自然'], ['绿']],
  'prop.sw.shrub-dry': [['室外', '植被', '灌木', '枯叶', '自然'], ['棕', '灰']],
  'prop.sw.rock-small': [['室外', '岩石', '碎石', '自然'], ['灰', '绿']],
  'prop.sw.rock-small-worn': [['室外', '岩石', '碎石', '风化', '自然'], ['灰', '棕']],
  'prop.sw.reef-decoration': [['室外', '岩石', '海岸', '礁石', '装饰'], ['灰', '绿']],
  'material.sw.dirt-gravel': [['室外', '地面', '道路', '泥土', '碎石', '院落'], ['棕', '灰']],
  'prop.sw.crate': [['室内', '室外', '收纳', '木箱', '木质', '补给'], ['棕']],
  'prop.sw.supply-rack': [['室外', '家具', '收纳', '木质', '补给'], ['棕']],
  'prop.sw.campfire': [['室外', '营地', '火焰', '照明', '石质'], ['红', '橙', '灰']],
  'prop.sw.lamp-stand': [['室外', '照明', '金属', '灯具'], ['棕', '黄']],
  'prop.sw.tent': [['室外', '营地', '帐篷', '布质', '遮蔽'], ['棕', '白']],
  'prefab.sw.study-desk': [['室内', '家具', '书房', '桌面布景'], ['棕', '白', '红']],
  'prefab.sw.terrace-table': [['室外', '露台', '家具', '休息'], ['棕']],
  'prefab.sw.outpost-supplies': [['室外', '海岸哨所', '补给', '木质', '收纳'], ['棕', '白']],
  'prefab.sw.graveyard-memorial': [['室外', '墓地', '纪念', '石质', '金属'], ['灰', '绿', '黑']],
  'prefab.sw.volcanic-rock-cluster': [['室外', '火山', '岩石', '熔岩'], ['黑', '灰', '橙', '红']],
}

const root = fileURLToPath(new URL('../', import.meta.url)), destination = new URL('../src/catalog/curation-data.json', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('../assets/sceneweave-handdrawn-content/manifest.json', import.meta.url), 'utf8'))
let server, browser
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4395, strictPort: false }, logLevel: 'error' })
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(server.resolvedUrls.local[0])
  // Browser native createImageBitmap decodes every actual local PNG via the unchanged complete-project validator.
  const { items, assetHashes } = await page.evaluate(async () => {
    const { loadBuiltinCatalogV1 } = await import('/src/catalog/builtin.ts')
    const { describeCatalogItems } = await import('/src/catalog/content.ts')
    const project = await loadBuiltinCatalogV1()
    return { items: describeCatalogItems(project), assetHashes: Object.fromEntries(Object.values(project.document.assets).map(asset => [asset.id, asset.sha256])) }
  })
  const records = items.map(item => {
    const entry = manifest.assets.find(entry => entry.catalogId === item.identity.catalogId && entry.version === item.identity.fixedVersion)
    const intent = legacy[item.identity.catalogId]
    if (!entry && !intent) throw new Error(`Missing curation intent: ${item.identity.catalogId}`)
    const record = { key: item.identity.key, tags: entry ? [...new Set(entry.tags)] : intent[0], colors: entry ? [...new Set(entry.colors)] : intent[1] }
    if (entry?.refines) {
      const original = items.find(candidate => candidate.identity.catalogId === entry.refines.catalogId && candidate.identity.fixedVersion === entry.refines.version)
      if (!original) throw new Error(`Missing exact refined ancestor: ${entry.catalogId}`)
      if (original.thumbnailAssetIds.length !== 1 || assetHashes[original.thumbnailAssetIds[0]] !== entry.refines.assetSha256) throw new Error(`Refined ancestor byte hash mismatch: ${entry.catalogId}`)
      record.refines = original.identity.key
    }
    return record
  }).sort((a, b) => a.key.localeCompare(b.key, 'en'))
  const value = { format: 'sceneweave-catalog-curation', version: 1, records }
  await page.evaluate(async value => { const { validateCatalogCurationV1 } = await import('/src/catalog/curation.ts'); validateCatalogCurationV1(value) }, value)
  const text = JSON.stringify(value, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== text) throw new Error('Curation exact-key index is stale; regenerate it explicitly.')
  } else await writeFile(destination, text)
  console.log(JSON.stringify({ records: records.length, legacy: records.filter(record => !manifest.assets.some(entry => entry.catalogId === JSON.parse(record.key)[3]) && !JSON.parse(record.key)[3].includes('graveyard-memorial') && !JSON.parse(record.key)[3].includes('volcanic-rock-cluster')).length, refined: records.filter(record => record.refines).length, mode: process.argv.includes('--check') ? 'check' : 'write' }))
} finally { await browser?.close(); await server?.close() }
