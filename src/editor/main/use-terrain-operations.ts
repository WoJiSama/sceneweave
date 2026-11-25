import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AtomicAdoptionResult } from '../../application/workspace/atomic'
import type { BaseMapPreparationOptions } from '../../application/workspace/base-map'
import type { CanvasGenerationTarget } from '../../application/workspace/canvas-generation'
import type { TerrainPreview } from '../../application/workspace/terrain'
import type { TerrainEditPreview } from '../../application/workspace/terrain-edit'
import type { TerrainLocalPreview } from '../../application/workspace/terrain-local'
import type { CompositionPreview, Workspace } from '../../application/workspace/workspace'
import { selectBrowserGenerationBudget } from '../../platform/browser/budget'
import type { BaseMapGenerationClient, BaseMapGenerationExecution } from '../../platform/browser/terrain-generation/base-map-client'
import { sketchGeneratedFloor } from '../../platform/browser/generation/drawing'
import type { TerrainEditClient } from '../../platform/browser/terrain-generation/edit-client'
import type { PreparationContext } from '../../shared/ports/runtime'
import type { CompositionPresetInput } from '../../shared/terrain-generation/composition-presets'
import type { TerrainEditRequest } from '../../shared/terrain-generation/edit'
import { captureJson } from '../../shared/validation/json'
import type { BaseMapGenerationSettingsValue } from './BaseMapGenerationSettings'
import type { PreparedCatalogEntryV1 } from './catalog'
import { DomainOperationSession } from './domain-operation-session'
import type { TerrainEditCanvasSession } from './TerrainEditingPanel'
import type { TerrainGenerationRequest } from './TerrainGenerationPanel'

type TerrainOperations = { generation: TerrainPreview; edit: TerrainEditPreview; refresh: TerrainLocalPreview }
export type TerrainOperation = keyof TerrainOperations
export type TerrainGenerationIntent = { kind: 'terrain'; input: TerrainGenerationRequest }
  | { kind: 'composition'; input: Omit<CompositionPresetInput, 'sceneId'> }

export function useTerrainOperations({ workspace, runtime, sourceKey, onReleaseGeneration }: {
  workspace: Workspace
  runtime: PreparationContext
  sourceKey: string
  onReleaseGeneration: (preview: TerrainPreview) => void
}) {
  const [placements] = useState(() => new WeakMap<TerrainPreview, CompositionPreview>())
  const release = useRef(onReleaseGeneration)
  release.current = onReleaseGeneration
  const releaseGeneration = (preview: TerrainPreview) => {
    const placed = placements.get(preview)
    if (placed) workspace.cancelPreview(placed)
    placements.delete(preview)
    workspace.cancelTerrainGeneration(preview)
    release.current(preview)
  }
  const [operations] = useState(() => new DomainOperationSession<TerrainOperations>({
    domains: ['generation', 'edit', 'refresh'], sourceKey, checkpoint: workspace.checkpoint, revisionBoundDrafts: ['edit'],
    release: {
      generation: releaseGeneration,
      edit: preview => workspace.cancelTerrainEdit(preview),
      refresh: preview => workspace.cancelTerrainLocalRefresh(preview),
    },
  }))
  const state = useSyncExternalStore(operations.subscribe, operations.getSnapshot)
  const checkpoint = workspace.checkpoint()
  useEffect(() => operations.invalidateSource(checkpoint, sourceKey), [operations, checkpoint, sourceKey])
  const generationClient = useRef<BaseMapGenerationClient | null>(null)
  const editClient = useRef<TerrainEditClient | null>(null)
  useEffect(() => () => {
    operations.dispose()
    generationClient.current?.dispose()
    editClient.current?.dispose()
    generationClient.current = null
    editClient.current = null
  }, [operations])

  const editReset = state.edit.resetKey
  const [canvas, setCanvas] = useState<{ value: TerrainEditCanvasSession; resetKey: number } | null>(null)
  const setEditCanvas = useCallback((value: TerrainEditCanvasSession | null) => {
    setCanvas(value === null ? null : { value, resetKey: editReset })
  }, [editReset])
  const setEditDraft = useCallback((dirty: boolean) => {
    const { phase } = operations.getSnapshot().edit
    if (dirty && phase === 'idle') operations.change('edit')
    if (!dirty && phase === 'draft') operations.cancel('edit', { reset: false })
  }, [operations])

  const prepareGeneration = (generation: TerrainGenerationIntent, settings: BaseMapGenerationSettingsValue, target?: CanvasGenerationTarget) => {
    const owned = captureJson(generation), connection = { ...settings }
    return operations.run('generation', async lease => {
      const workspaceSceneId = workspace.getState().project?.document.sceneId ?? 'empty-workspace'
      const sceneId = runtime.ids.nextId(), input = owned.input
      const palette = owned.kind === 'terrain' && owned.input.kind === 'coast' ? 'coast' : 'island'
      const surfaceVersion = connection.surfacePalette === 'classic' ? 4 : connection.surfacePalette === 'highland-v7' ? 7 : connection.surfacePalette === 'surface-rules' ? 6 : 5
      const blankOptions = { title: '程序底图候选', widthMm: input.widthMm, heightMm: input.heightMm, preset: 'narrative' as const, gridVisible: false, sceneId }
      const coastalAscent = surfaceVersion === 5 && owned.kind === 'terrain' && (owned.input.kind === 'island' || owned.input.kind === 'coast')
      const basePromise = surfaceVersion >= 5
        ? import('../../platform/browser/content/shore-blank').then(({ createShoreBlankProject, createCoastalAscentBlankProject }) => coastalAscent
          ? createCoastalAscentBlankProject(palette, blankOptions, lease.signal)
          : createShoreBlankProject(palette, blankOptions, lease.signal, surfaceVersion >= 6, surfaceVersion === 7))
        : import('../../platform/browser/content/refined-blank').then(({ createRefinedBlankProject }) => createRefinedBlankProject(palette, blankOptions, lease.signal))
      const [base, { prepareBaseMapRequestV3, terrainAlgorithmForPalette }, { createBaseMapGenerationClient }] = await Promise.all([
        basePromise, import('../../shared/terrain-generation/base-map-v3'), import('../../platform/browser/terrain-generation/base-map-client'),
      ])
      lease.assertCurrent()
      const quality = connection.quality ?? 'standard'
      const profile = selectBrowserGenerationBudget({ widthMm: input.widthMm, heightMm: input.heightMm, quality, ...(surfaceVersion >= 5 ? { surfaceRecipe: 1 as const } : {}), mode: connection.budgetMode })
      const { ocean: wantsOcean, ...terrainInput } = owned.input as TerrainGenerationRequest
      const normalized = owned.kind === 'terrain'
        ? { kind: 'terrain' as const, input: { ...terrainInput, sceneId, algorithmVersion: terrainAlgorithmForPalette(terrainInput.kind, surfaceVersion), budgetProfileId: profile.profileId, quality } }
        : { kind: 'composition' as const, input: { ...owned.input, sceneId, recipeVersion: surfaceVersion, budgetProfileId: profile.profileId, quality } }
      const request = prepareBaseMapRequestV3({ requestId: runtime.ids.nextId(), flowId: runtime.ids.nextId(), profile,
        workspaceSceneId, checkpoint: lease.checkpoint, operationEpoch: lease.epoch, base: base.document, generation: normalized })
      generationClient.current ??= createBaseMapGenerationClient()
      let execution: BaseMapGenerationExecution | undefined
      const response = await generationClient.current.generate(request, {
        signal: lease.signal, isCurrent: lease.isCurrent, onExecution: result => { execution = result },
        ...(connection.mode === 'server' ? { server: { baseUrl: connection.baseUrl, token: connection.token } } : {}),
      })
      lease.assertCurrent()
      if (!execution?.generationCalls) throw new Error('程序底图缺少本次真实执行记录，请重新准备。')
      const ocean = wantsOcean && owned.kind === 'terrain' ? await prepareOcean(input.seed, lease.signal) : undefined
      lease.assertCurrent()
      const preview = await workspace.previewBaseMapGeneration(base, request, response, { signal: lease.signal, source: connection.mode, generationExecution: execution, ocean })
      try {
        lease.assertCurrent()
        lease.showDrawing(sketchGeneratedFloor(preview.project.document), target?.boundsMm)
        if (target) placements.set(preview, await workspace.previewCanvasGeneration(preview, target, { signal: lease.signal }))
        return preview
      } catch (error) {
        releaseGeneration(preview)
        throw error
      }
    })
  }
  const adoptGeneration = (ready: () => Promise<void>) => operations.adopt('generation', async preview => {
    await ready()
    const placed = placements.get(preview)
    if (!placed) return workspace.adoptTerrainGeneration(preview)
    await workspace.adoptPreview(placed)
    placements.delete(preview)
    workspace.releaseCanvasGenerationSource(preview)
  })

  const prepareEdit = (input: TerrainEditRequest) => operations.run('edit', async lease => {
    const base = workspace.getState().project
    if (!base || base.document.mapMode !== 'scene') return null
    const owned = captureJson(input)
    const { selectTerrainEditBudget } = await import('../../application/workspace/terrain-edit')
    lease.assertCurrent()
    const budget = selectTerrainEditBudget(base.document)
    let result
    if (!budget) {
      const { createTerrainEditClient } = await import('../../platform/browser/terrain-generation/edit-client')
      lease.assertCurrent()
      editClient.current ??= createTerrainEditClient()
      result = await editClient.current.edit({ sceneId: base.document.sceneId, checkpoint: lease.checkpoint, operationEpoch: lease.epoch, base: base.document, input: owned },
        { signal: lease.signal, isCurrent: lease.isCurrent })
    }
    lease.assertCurrent()
    return workspace.previewTerrainEdit(owned, { result, budget, signal: lease.signal })
  })
  const adoptEdit = async (ready: () => Promise<void>): Promise<AtomicAdoptionResult | undefined> => {
    let result: AtomicAdoptionResult | undefined
    if (await operations.adopt('edit', async preview => { await ready(); result = await workspace.adoptTerrainEdit(preview) })) return result
  }

  const prepareRefresh = () => operations.run('refresh', lease => {
    const base = workspace.getState().project
    const transition = base?.document.visual?.version === 3 ? Object.values(base.document.visual.transitions)[0] : undefined
    if (!base || base.document.mapMode !== 'scene' || !transition) throw new Error('当前工程没有可用的地形过渡范围。')
    return workspace.previewTerrainLocalRefresh({ sceneId: base.document.sceneId, scopeMm: transition.distanceSource.clipMm, transitionIds: [transition.id] }, { signal: lease.signal })
  })
  const adoptRefresh = async (): Promise<AtomicAdoptionResult | undefined> => {
    let result: AtomicAdoptionResult | undefined
    if (await operations.adopt('refresh', async preview => { result = await workspace.adoptTerrainLocalRefresh(preview) })) return result
  }

  return { operations, state, placementFor: (preview: TerrainPreview) => placements.get(preview),
    editCanvas: canvas?.resetKey === editReset ? canvas.value : null, setEditCanvas, setEditDraft,
    prepareGeneration, adoptGeneration, prepareEdit, adoptEdit, prepareRefresh, adoptRefresh }
}

async function prepareOcean(seed: string, signal: AbortSignal): Promise<NonNullable<BaseMapPreparationOptions['ocean']>> {
  const [{ createSceneCollectionSelectionDocument, materializeSceneCollectionDocument }, { OCEAN_DRESSING_ITEMS }, { describeCatalogItems, prepareCatalogEntry }] = await Promise.all([
    import('../../platform/browser/content/scene-collection-catalog'), import('../../shared/ocean/generation'), import('./catalog'),
  ])
  signal.throwIfAborted()
  const provider = await materializeSceneCollectionDocument(createSceneCollectionSelectionDocument(OCEAN_DRESSING_ITEMS.map(item => item.id)), [], signal)
  const entries: PreparedCatalogEntryV1[] = []
  for (const item of describeCatalogItems(provider).filter(item => item.selector.kind === 'prop')) entries.push(await prepareCatalogEntry(provider, item.selector, signal))
  return { settings: { recipeVersion: 2, seed, preset: 'calm', boat: true, creatures: true }, entries }
}
