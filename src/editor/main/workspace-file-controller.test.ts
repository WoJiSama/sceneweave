import { describe, expect, it, vi } from 'vitest'
import { prepareCompositionCommands } from '../../application/workspace/prepare'
import { fromBundle, toBundle, type EditableProject } from '../../application/workspace/project'
import { fixture, NOW, pixelPng, runtime, validation } from '../../application/workspace/test-fixtures'
import type { WorkspaceState } from '../../application/workspace/workspace'
import { sha256Bytes } from '../../shared/project/binary'
import { exportHistoryArchive, exportProject } from '../../shared/project/file'
import type { HistoryArchive } from '../../shared/project/history'
import { projectContentHash } from '../../shared/project/validate'
import { encodeUtf8 } from '../../shared/validation/json'
import type { WorkspaceBackupAttempt } from './WorkspaceBackupFeedback'
import { createWorkspaceFileController, type WorkspaceFilePorts } from './workspace-file-controller'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function pauseAtPort<T>() {
  const entered = deferred<void>()
  const result = deferred<T>()
  return {
    run() {
      entered.resolve()
      return result.promise
    },
    async waitForCall(operation: Promise<void>) {
      const reached = await Promise.race([entered.promise.then(() => true), operation.then(() => false)])
      expect(reached, 'operation completed before reaching the deferred port').toBe(true)
    },
    resolve: result.resolve,
    reject: result.reject,
  }
}

const completeFilename = 'sceneweave-complete.sceneweave'
const historyFilename = 'sceneweave-history.sceneweave'
const checkpointError = new Error('workspace checkpoint changed')
const saveFailures = ['error', 'conflict'] as const
const staleChanges = [
  { change: 'checkpoint', detail: checkpointError.message },
  { change: 'scene', detail: /切换/ },
] as const

function editableFixture() {
  return fromBundle(fixture({ image: true }), validation)
}

function setup(project: EditableProject, status: WorkspaceState['status'] = 'saved') {
  let current = project
  let checkpoint = 1
  const ports = {
    workspace: {
      getState: () => ({ project: current, status }),
      checkpoint: () => checkpoint,
      assertCheckpoint(expected: number) {
        if (expected !== checkpoint) throw checkpointError
      },
      flush: vi.fn<WorkspaceFilePorts['workspace']['flush']>().mockResolvedValue(undefined),
    },
    exportArchive: vi.fn<WorkspaceFilePorts['exportArchive']>(),
    exportProject: vi.fn<WorkspaceFilePorts['exportProject']>(),
    exportHistoryArchive: vi.fn<WorkspaceFilePorts['exportHistoryArchive']>(),
    exportPng: vi.fn<WorkspaceFilePorts['exportPng']>(),
    download: vi.fn<WorkspaceFilePorts['download']>(),
  } satisfies WorkspaceFilePorts
  const controller = createWorkspaceFileController(ports)
  const onAttempt = vi.fn<(attempt: WorkspaceBackupAttempt) => void>()
  const onSuccess = vi.fn<(message: string) => void>()
  const sceneId = project.document.sceneId
  return {
    ports, controller, onAttempt, onSuccess,
    setStatus(value: WorkspaceState['status']) { status = value },
    backup: (snapshotIds?: readonly string[]) => controller.backup({ project, sceneId, snapshotIds }, onAttempt),
    async invalidate(change: 'checkpoint' | 'scene') {
      // Change one input at a time so each stale-result guard is observable.
      if (change === 'checkpoint') checkpoint++
      else current = await editableFixture()
    },
  }
}

type FileFixture = ReturnType<typeof setup>

function historyArchive(project: EditableProject, snapshotIds: readonly string[]): HistoryArchive {
  const current = toBundle(project)
  const contentHash = projectContentHash(current.project)
  return {
    current,
    snapshots: snapshotIds.map(id => ({
      id,
      name: id,
      ownerSceneId: project.document.sceneId,
      lineageId: project.historyIdentity.lineageId,
      sourceRevision: project.document.revision,
      kind: 'named',
      createdAt: NOW,
      contentHash,
      bundle: current,
    })),
  }
}

function expectAttempt({ onAttempt }: FileFixture, project: EditableProject, kind: WorkspaceBackupAttempt['kind'], detail: string | RegExp) {
  expect(onAttempt).toHaveBeenCalledOnce()
  const [attempt] = onAttempt.mock.calls[0]
  expect(attempt).toMatchObject({ sceneId: project.document.sceneId, kind })
  expect(attempt.baseline).toBeInstanceOf(WeakRef)
  expect(attempt.baseline.deref()).toBe(project)
  expect(attempt.detail).toMatch(detail)
}

async function expectArchiveDownload({ ports, onAttempt }: FileFixture, bytes: Uint8Array, filename: string) {
  expect(ports.download).toHaveBeenCalledOnce()
  const [blob, name] = ports.download.mock.calls[0]
  expect(name).toBe(filename)
  expect(blob.type).toBe('application/octet-stream')
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  expect(ports.download.mock.results[0].type).toBe('return')
  expect(ports.download.mock.invocationCallOrder[0]).toBeLessThan(onAttempt.mock.invocationCallOrder[0])
}

function pngFixture() {
  return new Blob([pixelPng([61, 90, 121, 255]).slice().buffer], { type: 'image/png' })
}

describe('complete workspace backup', () => {
  it('waits for the save and export, then passes the exact byte range to download before reporting success', async () => {
    const project = await editableFixture()
    const client = setup(project, 'unsaved')
    const { ports, onAttempt } = client
    const bytes = await exportProject(toBundle(project), validation)
    const largerBuffer = new Uint8Array(bytes.length + 2).fill(255)
    largerBuffer.set(bytes, 1)
    const saving = pauseAtPort<void>()
    const writing = pauseAtPort<Uint8Array>()
    ports.workspace.flush.mockImplementationOnce(saving.run)
    ports.exportProject.mockImplementationOnce(writing.run)

    const operation = client.backup()
    await saving.waitForCall(operation)
    expect(ports.exportProject).not.toHaveBeenCalled()
    expect(onAttempt).not.toHaveBeenCalled()
    saving.resolve()

    await writing.waitForCall(operation)
    expect(ports.exportProject).toHaveBeenCalledExactlyOnceWith(toBundle(project))
    expect(ports.exportArchive).not.toHaveBeenCalled()
    expect(ports.download).not.toHaveBeenCalled()
    expect(onAttempt).not.toHaveBeenCalled()
    writing.resolve(largerBuffer.subarray(1, -1))

    await operation
    expectAttempt(client, project, 'download-started', '含全部资源、许可和秘密')
    await expectArchiveDownload(client, bytes, completeFilename)
  })

  it.each(saveFailures)('preserves the complete in-memory branch while the save status is %s', async status => {
    const input = fixture({ image: true })
    const clickedProject = await fromBundle(input, validation)
    input.project.document.title = '尚未保存的分支'
    input.project.document.revision++
    const project = await fromBundle(input, validation)
    const client = setup(project, status)
    const { controller, ports, onAttempt } = client
    const bytes = await exportProject(toBundle(project), validation)
    const writing = pauseAtPort<Uint8Array>()
    ports.workspace.flush.mockRejectedValueOnce(new Error('save blocked'))
    ports.exportProject.mockImplementationOnce(writing.run)

    const operation = controller.backup({ project: clickedProject, sceneId: project.document.sceneId }, onAttempt)
    await writing.waitForCall(operation)
    expect(ports.workspace.flush).not.toHaveBeenCalled()
    expect(ports.exportArchive).not.toHaveBeenCalled()
    expect(ports.exportProject).toHaveBeenCalledExactlyOnceWith(toBundle(project))
    expect(ports.download).not.toHaveBeenCalled()
    expect(onAttempt).not.toHaveBeenCalled()
    writing.resolve(bytes)

    await operation
    expectAttempt(client, project, 'download-started', '含全部资源、许可和秘密')
    await expectArchiveDownload(client, bytes, completeFilename)
  })

  it.each(saveFailures)('downloads the current project on the first attempt when saving enters %s', async status => {
    const project = await editableFixture()
    const client = setup(project, 'unsaved')
    const bytes = await exportProject(toBundle(project), validation)
    client.ports.workspace.flush.mockImplementationOnce(async () => {
      client.setStatus(status)
      throw new Error('write could not finish')
    })
    client.ports.exportProject.mockResolvedValueOnce(bytes)

    await client.backup()

    expect(client.ports.workspace.flush).toHaveBeenCalledOnce()
    expect(client.ports.exportProject).toHaveBeenCalledExactlyOnceWith(toBundle(project))
    expect(client.ports.exportArchive).not.toHaveBeenCalled()
    expectAttempt(client, project, 'download-started', '当前页面的最新编辑')
    await expectArchiveDownload(client, bytes, completeFilename)
  })

  it('still refuses a history backup when its save could not finish', async () => {
    const project = await editableFixture()
    const client = setup(project, 'unsaved')
    client.ports.workspace.flush.mockImplementationOnce(async () => {
      client.setStatus('error')
      throw new Error('history baseline could not be saved')
    })

    await client.backup(['named'])

    expect(client.ports.exportArchive).not.toHaveBeenCalled()
    expect(client.ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', 'history baseline could not be saved')
  })

  it('reports an export rejection without calling download', async () => {
    const project = await editableFixture()
    const client = setup(project)
    const writing = pauseAtPort<Uint8Array>()
    client.ports.exportProject.mockImplementationOnce(writing.run)
    const operation = client.backup()
    await writing.waitForCall(operation)
    writing.reject(new Error('resource validation failed'))

    await operation
    expect(client.ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', 'resource validation failed')
  })

  it('reports a thrown download setup as failed and a later successful download as started', async () => {
    const project = await editableFixture()
    const client = setup(project)
    const { ports, onAttempt } = client
    const bytes = await exportProject(toBundle(project), validation)
    ports.exportProject.mockResolvedValue(bytes)
    const failure = new Error('could not create download URL')
    ports.download.mockImplementationOnce(() => { throw failure })

    await client.backup()
    expect(ports.download.mock.results).toEqual([{ type: 'throw', value: failure }])
    expectAttempt(client, project, 'failed', failure.message)

    ports.download.mockClear()
    onAttempt.mockClear()
    await client.backup()
    expectAttempt(client, project, 'download-started', '含全部资源、许可和秘密')
    await expectArchiveDownload(client, bytes, completeFilename)
  })
})

describe('selected-history workspace backup', () => {
  it('freezes the selected IDs before saving and reports the selected archive after download starts', async () => {
    const project = await editableFixture()
    const client = setup(project, 'unsaved')
    const { ports, onAttempt } = client
    const originalIds = ['before-lighting', 'after-layout']
    const selection = [...originalIds]
    const reloaded = await fromBundle(toBundle(project), validation)
    const archive = historyArchive(reloaded, originalIds)
    const bytes = await exportHistoryArchive(archive, validation)
    const saving = pauseAtPort<void>()
    const reading = pauseAtPort<HistoryArchive>()
    const writing = pauseAtPort<Uint8Array>()
    ports.workspace.flush.mockImplementationOnce(saving.run)
    ports.exportArchive.mockImplementationOnce(reading.run)
    ports.exportHistoryArchive.mockImplementationOnce(writing.run)

    const operation = client.backup(selection)
    selection.splice(0, selection.length, 'later-selection')
    await saving.waitForCall(operation)
    expect(ports.exportArchive).not.toHaveBeenCalled()
    saving.resolve()

    await reading.waitForCall(operation)
    expect(ports.exportArchive).toHaveBeenCalledExactlyOnceWith(project.document.sceneId, originalIds)
    expect(ports.exportHistoryArchive).not.toHaveBeenCalled()
    reading.resolve(archive)

    await writing.waitForCall(operation)
    expect(ports.exportHistoryArchive).toHaveBeenCalledExactlyOnceWith(archive)
    expect(ports.exportProject).not.toHaveBeenCalled()
    expect(ports.download).not.toHaveBeenCalled()
    expect(onAttempt).not.toHaveBeenCalled()
    writing.resolve(bytes)

    await operation
    expectAttempt(client, project, 'download-started', '所选 2 份历史快照')
    await expectArchiveDownload(client, bytes, historyFilename)
  })

  it('rejects an empty selection before saving or reading history', async () => {
    const project = await editableFixture()
    const client = setup(project)
    await client.backup([])

    expect(client.ports.workspace.flush).not.toHaveBeenCalled()
    expect(client.ports.exportArchive).not.toHaveBeenCalled()
    expect(client.ports.exportProject).not.toHaveBeenCalled()
    expect(client.ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', /勾选.*快照/)
  })

  it.each(saveFailures)('requires a successful flush when the save status is %s', async status => {
    const project = await editableFixture()
    const client = setup(project, status)
    const failure = new Error('selected history requires a saved branch')
    client.ports.workspace.flush.mockRejectedValueOnce(failure)

    await client.backup(['before-lighting'])
    expect(client.ports.workspace.flush).toHaveBeenCalledOnce()
    expect(client.ports.exportArchive).not.toHaveBeenCalled()
    expect(client.ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', failure.message)
  })

  it('rejects saved history with a different license closure at the same scene and revision', async () => {
    const project = await editableFixture()
    const client = setup(project)
    const current = toBundle(project)
    const text = 'Different complete license text for the same scene fixture'
    const hash = sha256Bytes(encodeUtf8(text))
    const different = await fromBundle({
      project: {
        ...current.project,
        licenses: { [hash]: { sha256: hash, text } },
        licenseBindings: current.project.licenseBindings.map(binding => ({ ...binding, licensePath: `licenses/${hash}.txt` })),
      },
      resources: current.resources,
    }, validation)
    expect(different.document).toEqual(project.document)
    client.ports.exportArchive.mockResolvedValueOnce(historyArchive(different, ['before-lighting']))

    await client.backup(['before-lighting'])
    expect(client.ports.exportHistoryArchive).not.toHaveBeenCalled()
    expect(client.ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', /已保存版本已变化/)
  })
})

describe.each(staleChanges)('workspace $change changes during a file operation', ({ change, detail }) => {
  it('stops before complete export when the workspace changes during flush', async () => {
    const project = await editableFixture()
    const client = setup(project)
    const saving = pauseAtPort<void>()
    client.ports.workspace.flush.mockImplementationOnce(saving.run)
    const operation = client.backup()
    await saving.waitForCall(operation)

    await client.invalidate(change)
    saving.resolve()
    await operation
    expect(client.ports.exportProject).not.toHaveBeenCalled()
    expect(client.ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', detail)
  })

  it('stops before formal export when the workspace changes during archive read', async () => {
    const project = await editableFixture()
    const client = setup(project)
    const selection = ['before-lighting']
    const archive = historyArchive(project, selection)
    const reading = pauseAtPort<HistoryArchive>()
    client.ports.exportArchive.mockImplementationOnce(reading.run)
    const operation = client.backup(selection)
    await reading.waitForCall(operation)

    await client.invalidate(change)
    reading.resolve(archive)
    await operation
    expect(client.ports.exportHistoryArchive).not.toHaveBeenCalled()
    expect(client.ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', detail)
  })

  it.each(['complete', 'history'] as const)('rejects a stale result after formal %s export', async mode => {
    const project = await editableFixture()
    const client = setup(project)
    const { ports } = client
    const writing = pauseAtPort<Uint8Array>()
    const selection = mode === 'history' ? ['before-lighting'] : undefined
    const archive = selection ? historyArchive(project, selection) : undefined
    const bytes = archive ? await exportHistoryArchive(archive, validation) : await exportProject(toBundle(project), validation)
    if (archive) {
      ports.exportArchive.mockResolvedValueOnce(archive)
      ports.exportHistoryArchive.mockImplementationOnce(writing.run)
    } else {
      ports.exportProject.mockImplementationOnce(writing.run)
    }
    const operation = client.backup(selection)
    await writing.waitForCall(operation)

    await client.invalidate(change)
    writing.resolve(bytes)
    await operation
    expect(ports.download).not.toHaveBeenCalled()
    expectAttempt(client, project, 'failed', detail)
  })

  it('rejects the pending PNG without announcing success', async () => {
    const project = await editableFixture()
    const { controller, ports, onSuccess, invalidate } = setup(project)
    const rendering = pauseAtPort<Blob>()
    ports.exportPng.mockImplementationOnce(rendering.run)
    const operation = controller.exportImage({ project, audience: 'player', floorId: 'blank-floor' }, onSuccess)
    await rendering.waitForCall(operation)

    await invalidate(change)
    rendering.resolve(pngFixture())
    await expect(operation).rejects.toThrow(detail)
    expect(ports.download).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('workspace PNG export', () => {
  it.each([
    { audience: 'gm', label: '主持人' },
    { audience: 'player', label: '玩家' },
  ] as const)('downloads a 4096 px $audience PNG for the clicked project and floor', async ({ audience, label }) => {
    const input = fixture({ image: true })
    input.project.document.revision = 7
    const project = await prepareCompositionCommands(await fromBundle(input, validation), [{
      type: 'createFloor', id: 'upper-floor', name: '上层', newLayerId: 'upper-floor-layer', layerName: '上层地面',
      boundsMm: { x: 0, y: 0, width: 12000, height: 15000 },
      outputBoundsMm: { x: 1000, y: 1000, width: 9000, height: 12000 },
    }], { runtime, validation })
    const differentProject = await editableFixture()
    const { controller, ports, onSuccess } = setup(project)
    const rendering = pauseAtPort<Blob>()
    ports.exportPng.mockImplementationOnce(rendering.run)
    const request: Parameters<typeof controller.exportImage>[0] = { project, audience, floorId: 'upper-floor' }

    const operation = controller.exportImage(request, onSuccess)
    request.project = differentProject
    request.audience = audience === 'gm' ? 'player' : 'gm'
    request.floorId = 'blank-floor'
    await rendering.waitForCall(operation)
    expect(ports.exportPng).toHaveBeenCalledExactlyOnceWith(toBundle(project), { audience, floorId: 'upper-floor', longEdgePx: 4096 })
    expect(ports.download).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    const png = pngFixture()
    rendering.resolve(png)

    await operation
    expect(ports.download).toHaveBeenCalledExactlyOnceWith(png, `sceneweave-${audience}-map.png`)
    expect(ports.download.mock.calls[0][0]).toBe(png)
    expect(ports.download.mock.results[0].type).toBe('return')
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith(`${label} PNG 已生成 · r7 · 上层固定范围 · 长边 4096 px`)
    expect(ports.download.mock.invocationCallOrder[0]).toBeLessThan(onSuccess.mock.invocationCallOrder[0])
  })

  it.each(['renderer', 'download'] as const)('propagates a %s failure to the shared action without announcing success', async source => {
    const project = await editableFixture()
    const { controller, ports, onSuccess } = setup(project)
    const failure = new Error(`${source} failed`)
    if (source === 'renderer') {
      ports.exportPng.mockRejectedValueOnce(failure)
    } else {
      ports.exportPng.mockResolvedValueOnce(pngFixture())
      ports.download.mockImplementationOnce(() => { throw failure })
    }

    await expect(controller.exportImage({ project, audience: 'gm', floorId: 'blank-floor' }, onSuccess)).rejects.toBe(failure)
    expect(ports.download).toHaveBeenCalledTimes(source === 'download' ? 1 : 0)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
