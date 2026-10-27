import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shared = join(root, 'src/shared')
const files = []
async function walk(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, item.name)
    if (item.isDirectory()) await walk(path)
    else if (item.name.endsWith('.ts') && !item.name.endsWith('.test.ts')) files.push(path)
  }
}
await walk(shared)
for (const path of files) {
  const source = await readFile(path, 'utf8')
  const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const inspectImport = specifier => {
    // Pure, deterministic geometry dependency. Its runtime has no DOM or
    // platform access and is covered by the shared-layer smoke test below.
    if (specifier === 'zod' || specifier === 'fflate' || specifier === 'polygon-clipping') return
    if (!specifier.startsWith('.') || !specifier.endsWith('.js') || relative(shared, resolve(dirname(path), specifier)).startsWith('..')) throw new Error(`共享层越界依赖：${relative(root, path)} → ${specifier}`)
  }
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspectImport(node.moduleSpecifier.text)
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(syntax)
      if (/^(?:crypto\.randomUUID|Date\.now|Math\.random|performance\.now|structuredClone)$/.test(callee)) throw new Error(`共享层含未注入的平台调用：${relative(root, path)}`)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error('共享层不接受动态模块路径。')
        inspectImport(node.arguments[0].text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
}

const temporary = await mkdtemp(join(tmpdir(), 'sceneweave-shared-node-'))
try {
  const compiled = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.shared.json', '--noEmit', 'false', '--outDir', temporary], { cwd: root, encoding: 'utf8' })
  if (compiled.status !== 0) throw new Error(compiled.stdout + compiled.stderr)
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}\n')
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir')
  const entry = pathToFileURL(join(temporary, 'index.js')).href
  const smoke = `
    import assert from 'node:assert/strict';
    for (const name of ['window','document','ImageBitmap','OffscreenCanvas','createImageBitmap']) Object.defineProperty(globalThis,name,{value:undefined});
    const shared = await import(${JSON.stringify(entry)});
    let counter=0;
    const context={ids:{nextId:()=> 'node-'+(++counter)},clock:{now:()=> '2026-10-24T00:00:00.000Z'}};
    const bounds={x:0,y:0,width:20000,height:20000};
    const document={format:'sceneweave-scene',schemaVersion:1,sceneId:'node-scene',revision:0,title:'Node共享核心',createdAt:context.clock.now(),updatedAt:context.clock.now(),
      units:{world:'mm',display:'m',gridSizeMm:1000,snapMm:100,gridVisible:false},exportBoundsMm:bounds,
      floors:{floor:{id:'floor',name:'Floor',boundsMm:bounds}},vertices:{},rooms:{},walls:{},openings:{},props:{},regions:{},notes:{},assets:{},
      propDefinitions:{},materials:{},terrainAreas:{},terrainEdges:{},terrainConnections:{},paths:{},prefabDefinitions:{},prefabInstances:{},scatterGroups:{},styleThemes:{},activeStyleThemeRef:null,
      userLayers:{layer:{id:'layer',floorId:'floor',name:'默认',order:0,editLocked:false}},entityLayers:{},
      presetSnapshot:{presetId:'node',presetVersion:1,distanceMode:'metric',source:'Sceneweave smoke',gridSizeMm:1000},constraints:{entranceOpeningIds:[],wallEndClearanceMm:0,pathChecks:[]}};
    assert.equal(shared.validateSceneDocument(document).ok,true);
    const content=shared.createCompositionContent(document,context);
    const candidate=shared.applyCompositionCommands(content,[{type:'setSceneDisplay',display:'ft',distanceMode:'grid',gridSizeMm:1524,snapMm:254,gridVisible:true}],context);
    assert.equal(candidate.document.units.display,'ft');assert.equal(content.document.units.display,'m');
    const project={format:'sceneweave-complete-project',schemaVersion:1,...candidate,assets:{},licenses:{},licenseBindings:[],authoringSources:{}};
    assert.equal(shared.validateProjectData(project).historyIdentity.version,1);
    assert.match(shared.projectContentHash(project),/^[a-f0-9]{64}$/);
    assert.equal(shared.projectScene(candidate.document,'player').audience,'player');
    const unavailable=async()=>{throw new Error('Node smoke has no image decoder');};
    const options={images:{decode:unavailable,transform:unavailable,encodePng:unavailable}};
    const bundle={project,resources:shared.createMemoryResources({})};
    const encoded=await shared.exportProject(bundle,options);
    const decoded=await shared.importProject(encoded,options);
    assert.deepEqual(decoded.project,project);
    assert.equal(shared.getVerifiedProjectBundle(decoded),decoded);
    const summary={id:'node-snapshot',ownerSceneId:project.document.sceneId,lineageId:project.historyIdentity.lineageId,
      sourceRevision:project.document.revision,name:'Node snapshot',kind:'named',createdAt:context.clock.now(),contentHash:shared.projectContentHash(project)};
    const archive=await shared.importHistoryArchive(await shared.exportHistoryArchive({current:bundle,snapshots:[{...summary,bundle}]},options),options);
    assert.equal(archive.snapshots.length,1);assert.deepEqual(archive.current.project,project);
    assert.deepEqual(archive.snapshots[0].bundle.project,project);
    const fingerprint=shared.projectContentHash(project), raw=shared.encodeUtf8(shared.canonicalJson(project));
    const backup=await shared.exportMigrationSet({setId:'node-backup',createdAt:context.clock.now(),converterVersion:shared.CONVERTER_VERSION,
      scope:{kind:'project-family',repository:'node-smoke',sourceSceneId:project.document.sceneId},sourceFingerprint:fingerprint,
      records:[{role:'current',recordKey:'node-current',sourceFormat:'node-smoke',contentHash:fingerprint,bytes:raw}]});
    const reread=await shared.importMigrationSet(backup.index,backup.volumes);
    assert.equal(shared.assertBackupReceipt(reread.receipt,{setId:'node-backup',sourceFingerprint:fingerprint}).sourceFingerprint,fingerprint);
    assert.deepEqual(reread.records[0].bytes,raw);
    assert.throws(()=>shared.assertBackupReceipt({...reread.receipt},{sourceFingerprint:fingerprint}));
    const catalogKey=JSON.stringify([1,'a'.repeat(64),'prop','node-uninstalled',1,'b'.repeat(64)]);
    const organizations={[catalogKey]:{tags:[' Node label '],colors:['蓝','灰'],favorite:true}};
    const libraryBackup=await shared.exportLibraryBackup({entries:[],organizations},options);
    const libraryResult=await shared.importLibraryBackup(libraryBackup,options);
    assert.deepEqual(libraryResult,{entries:[],organizations});
    assert.equal(JSON.parse(new TextDecoder().decode(libraryBackup)).format,'sceneweave-asset-library');
    await assert.rejects(shared.importLibraryBackup(new TextEncoder().encode(JSON.stringify({format:'sceneweave-library',schemaVersion:1,records:[]})),options));
    console.log('Node原生ESM导入、场景命令/身份/投影、无图片当前/所选历史ZIP、保全set重读/receipt及未安装素材整理的新库备份往返通过；未使用DOM或真实图片适配器。');
  `
  const executed = spawnSync(process.execPath, ['--input-type=module', '-e', smoke], { cwd: root, encoding: 'utf8' })
  if (executed.status !== 0) throw new Error(executed.stdout + executed.stderr)
  process.stdout.write(`共享边界与无DOM编译通过（${files.length}个源码模块）。\n${executed.stdout}`)
} finally { await rm(temporary, { recursive: true, force: true }) }
