import { expect, test } from '@playwright/test'

test('C2 SCN-01 real 4K output matches an independent public reference and hides private variants', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c2-fixtures.ts', rendererPath = '/src/render/v3/renderer.ts', projectionPath = '/src/render/v3/projection.ts'
    const { createScn01ProjectC2, c2ProjectView } = await import(fixturePath)
    const { renderProjectV3, exportPngV3 } = await import(rendererPath), { projectSceneV3 } = await import(projectionPath)
    const source = createScn01ProjectC2(), reference = createScn01ProjectC2({ publicReference: true })
    const variant = structuredClone(source)
    variant.document.props['HS-old-wires'].positionMm.x = 6800
    variant.document.props['HS-old-wires'].rotationDeg = 47
    variant.document.notes.C1.text = '背板后藏有另一段仅主持人可见的灯线'
    variant.document.notes.C2.text = '修灯账单另记一笔秘密借款'
    const hashBytes = async (value: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(n => n.toString(16).padStart(2, '0')).join('')
    const pixels = async (canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      const result = { width: canvas.width, height: canvas.height, hash: await hashBytes(data.buffer) }
      canvas.width = canvas.height = 0; return result
    }
    const pngPixels = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close()
      return pixels(canvas)
    }
    const pngMetadata = async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), chunks: string[] = []
      for (let offset = 8; offset < bytes.length;) { const size = view.getUint32(offset, false); chunks.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))); offset += 12 + size }
      const text = new TextDecoder('latin1').decode(bytes)
      const forbidden = ['historyIdentity', 'SCN-01', 'H5-HS', 'H6-HS', source.historyIdentity.lineageId, ...Object.values(source.historyIdentity.propTokens)]
      return { chunks, privateMetadata: forbidden.some(value => text.includes(value)), byteLength: bytes.length }
    }
    const outputs: Record<string, { width: number; height: number; hash: string }> = {}
    for (const [name, project, audience] of [['gm', source, 'gm'], ['player', source, 'player'], ['variantGm', variant, 'gm'],
      ['variantPlayer', variant, 'player'], ['referencePlayer', reference, 'player']] as const) {
      outputs[name] = await pixels(await renderProjectV3(c2ProjectView(project), { audience, longEdgePx: 4096 }))
    }
    const playerPng = await exportPngV3(c2ProjectView(source), { audience: 'player', longEdgePx: 4096 })
    const gmPng = await exportPngV3(c2ProjectView(source), { audience: 'gm', longEdgePx: 4096 })
    const png = { player: await pngPixels(playerPng), gm: await pngPixels(gmPng), playerMetadata: await pngMetadata(playerPng), gmMetadata: await pngMetadata(gmPng) }
    const dataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
    const playerProjection = projectSceneV3(source.document, 'player'), gmProjection = projectSceneV3(source.document, 'gm')
    return { outputs, png, playerRooms: playerProjection.rooms.map((room: { id: string }) => room.id),
      gmRooms: gmProjection.rooms.map((room: { id: string }) => room.id),
      playerOpenings: playerProjection.walls.flatMap((wall: { openings: { id: string }[] }) => wall.openings).length,
      gmOpenings: gmProjection.walls.flatMap((wall: { openings: { id: string }[] }) => wall.openings).length,
      fixedBounds: playerProjection.bounds, playerNotes: playerProjection.notes.length, gmNotes: gmProjection.notes.length,
      playerPng: await dataUrl(playerPng), gmPng: await dataUrl(gmPng) }
  })
  expect(report.outputs.player).toEqual(report.outputs.referencePlayer)
  expect(report.outputs.player).toEqual(report.outputs.variantPlayer)
  expect(report.outputs.gm.hash).not.toBe(report.outputs.variantGm.hash)
  expect(report.outputs.gm.hash).not.toBe(report.outputs.player.hash)
  expect(report.png.player).toEqual(report.outputs.player); expect(report.png.gm).toEqual(report.outputs.gm)
  for (const output of Object.values(report.outputs)) { expect(output.width).toBe(4096); expect(output.height).toBe(3234) }
  for (const metadata of [report.png.playerMetadata, report.png.gmMetadata]) {
    expect(metadata.privateMetadata).toBe(false)
    expect(metadata.chunks.some(chunk => ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(chunk))).toBe(false)
  }
  expect(report.gmRooms).toContain('HS'); expect(report.playerRooms).not.toContain('HS')
  expect(report.gmOpenings).toBe(12); expect(report.playerOpenings).toBe(10)
  expect(report.playerNotes).toBe(0); expect(report.gmNotes).toBe(3)
  expect(report.fixedBounds).toEqual({ x: -500, y: -500, width: 19000, height: 15000 })
  await info.attach('c2-scn01-player-4k.png', { body: Buffer.from(report.playerPng.split(',')[1], 'base64'), contentType: 'image/png' })
  await info.attach('c2-scn01-gm-4k.png', { body: Buffer.from(report.gmPng.split(',')[1], 'base64'), contentType: 'image/png' })
  const { playerPng: _player, gmPng: _gm, ...summary } = report
  await info.attach('c2-scn01-4k-privacy.json', { body: JSON.stringify({ method: 'Real Chrome Canvas2D, command-built SCN-01; independent H1-H6 public reference contains no HS or secret doors. Fixed opaque mask and export bounds identical for all variants. This does not prove complete SCN-01 UI authoring or full route/pathfinding.', ...summary }, null, 2), contentType: 'application/json' })
})

test('C2 SCN-01 bundled resource project roundtrips offline with exact native geometry and audience pixels', async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const packed = await page.evaluate(async () => {
    const fixturePath = '/tests/c2-fixtures.ts', ioPath = '/src/io/v4/project-file.ts', rendererPath = '/src/render/v3/renderer.ts'
    const { createScn01BitmapProjectC2, c2ProjectView } = await import(fixturePath), { exportProjectV4 } = await import(ioPath)
    const { renderProjectV3 } = await import(rendererPath), project = await createScn01BitmapProjectC2()
    const hash = async (value: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(n => n.toString(16).padStart(2, '0')).join('')
    const hashes: Record<string, string> = {}
    for (const audience of ['gm', 'player']) {
      const canvas = await renderProjectV3(c2ProjectView(project), { audience, longEdgePx: 1600 })
      hashes[audience] = await hash(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.buffer)
      canvas.width = canvas.height = 0
    }
    const blob = await exportProjectV4(project)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
    return { data: btoa(binary), document: project.document, identity: project.historyIdentity, hashes,
      resources: Object.keys(project.assets).length, bindings: project.licenseBindings.length, licenses: Object.keys(project.licenses).length, size: blob.size }
  })
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage(); await fresh.goto('/')
    // Load only code first; all map bitmaps and licenses below come from the ZIP.
    await fresh.evaluate(async () => {
      const paths = ['/src/io/v4/project-file.ts', '/src/render/v3/renderer.ts', '/src/core/v3/commands.ts']
      const [io, render, commands] = await Promise.all(paths.map(path => import(path)))
      Reflect.set(window, '__c2OfflineModules', { io, render, commands })
    })
    await context.setOffline(true)
    const reopened = await fresh.evaluate(async packed => {
      const { io, render, commands } = Reflect.get(window, '__c2OfflineModules')
      const bytes = Uint8Array.from(atob(packed.data), character => character.charCodeAt(0)), project = await io.importProjectV4(new Blob([bytes]))
      const hash = async (value: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(n => n.toString(16).padStart(2, '0')).join('')
      const hashes: Record<string, string> = {}
      for (const audience of ['gm', 'player']) {
        const canvas = await render.renderProjectV3(io.toCompleteProjectV3(project), { audience, longEdgePx: 1600 })
        hashes[audience] = await hash(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.buffer)
        canvas.width = canvas.height = 0
      }
      const adjusted = commands.applyCommandsV3(project.document, [{ type: 'updateOpening', id: 'H1-H2', changes: { state: 'open' } }])
      return { document: project.document, identity: project.historyIdentity, hashes, resources: Object.keys(project.assets).length,
        licenses: Object.keys(project.licenses).length, bindings: project.licenseBindings.length, editedDoorState: adjusted.openings['H1-H2'].state,
        untouchedSecret: adjusted.openings['H5-HS'] }
    }, packed)
    expect(reopened.document).toEqual(packed.document); expect(reopened.identity).toEqual(packed.identity)
    expect(reopened.hashes).toEqual(packed.hashes); expect(reopened.resources).toBe(18)
    expect(reopened.resources).toBe(packed.resources); expect(reopened.bindings).toBe(packed.bindings); expect(reopened.licenses).toBe(packed.licenses)
    expect(reopened.editedDoorState).toBe('open'); expect(reopened.untouchedSecret).toMatchObject({ secret: true, revealed: false, state: 'closed' })
    const { document: _document, identity: _identity, data: _data, ...sourceSummary } = packed
    const { document: _reopenedDocument, identity: _reopenedIdentity, ...reopenedSummary } = reopened
    await info.attach('c2-scn01-offline-package.json', { body: JSON.stringify({ method: 'Fresh browser context, code preloaded, network offline before strict ZIP import, actual bundled image decode and both native Canvas2D outputs; no cached sample images reused.', source: sourceSummary, reopened: reopenedSummary }, null, 2), contentType: 'application/json' })
  } finally { await context.close() }
})

test('C2 revealing one secret entrance keeps the other door, corridor and clues private and unsafe masks fail closed', async ({ page }, info) => {
  await page.goto('/')
  const report = await page.evaluate(async () => {
    const fixturePath = '/tests/c2-fixtures.ts', commandsPath = '/src/core/v3/commands.ts', projectionPath = '/src/render/v3/projection.ts', rendererPath = '/src/render/v3/renderer.ts'
    const { createScn01ProjectC2, c2ProjectView } = await import(fixturePath), { applyCommandsV3 } = await import(commandsPath)
    const { projectSceneV3 } = await import(projectionPath), { exportPngV3 } = await import(rendererPath)
    const project = createScn01ProjectC2(), next = applyCommandsV3(project.document, [{ type: 'updateOpening', id: 'H5-HS', changes: { revealed: true } }])
    const projected = projectSceneV3(next, 'player'), gm = projectSceneV3(next, 'gm')
    const broken = structuredClone(next); broken.regions['SCN01-fixed-mask'].boundaryMm = [{ x: 6000, y: 12700 }, { x: 18000, y: 12700 }, { x: 18000, y: 14000 }, { x: 6000, y: 14000 }]
    let unsafeError = ''
    try { await exportPngV3(c2ProjectView({ ...project, document: broken }), { audience: 'player', longEdgePx: 1000 }) } catch (error) { unsafeError = String(error) }
    return { secretA: next.openings['H5-HS'], secretB: next.openings['H6-HS'], playerRoomIds: projected.rooms.map((room: { id: string }) => room.id),
      playerNoteCount: projected.notes.length, gmSecretOpeningCount: gm.walls.flatMap((wall: { openings: { secret: boolean }[] }) => wall.openings).filter((opening: { secret: boolean }) => opening.secret).length,
      playerOpeningCount: projected.walls.flatMap((wall: { openings: unknown[] }) => wall.openings).length, unsafeError }
  })
  expect(report.secretA).toMatchObject({ secret: true, revealed: true }); expect(report.secretB).toMatchObject({ secret: true, revealed: false })
  expect(report.playerRoomIds).not.toContain('HS'); expect(report.playerNoteCount).toBe(0)
  expect(report.gmSecretOpeningCount).toBe(2); expect(report.playerOpeningCount).toBe(11)
  expect(report.unsafeError).toMatch(/固定遮罩未覆盖/)
  await info.attach('c2-reveal-and-mask-guard.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
})
