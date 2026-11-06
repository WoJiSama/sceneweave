import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { EditableProject } from '../../application/workspace/project'
import { MANUAL_TRANSACTION_BUDGET, manualTransactionBudget } from '../../shared/budget/command-budget'
import { emptyBudgetUsage } from '../../shared/budget/task-budget'
import builtin from '../../platform/browser/content/builtin-data.json'
import CompositionChangesPanel from './CompositionChangesPanel'
import SceneInspector from './SceneInspector'
import { fixture } from '../../application/workspace/test-fixtures'

describe('manual transaction budget review', () => {
  const current = builtin.project as unknown as EditableProject

  it('keeps object count independent from geometry, dependencies and resource limits in folded details', () => {
    const budgetUsage = { ...emptyBudgetUsage(), semanticTargets: 5, geometryPoints: 300, geometrySegments: 280,
      dependencyRefs: 600, metadataRecords: 25, assetBytes: 1024, decodePixels: 4096 }
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, { current, candidate: current, commands: [], budgetUsage }))
    expect(html).toContain('<details aria-label="普通事务保护详情">')
    expect(html).toContain('<dt>编辑目标</dt><dd>5 / 256</dd>')
    expect(html).toContain(`<dt>几何点 / 段</dt><dd>300 / ${MANUAL_TRANSACTION_BUDGET.limits.geometryPoints} · 280 / ${MANUAL_TRANSACTION_BUDGET.limits.geometrySegments}</dd>`)
    expect(html).toContain(`<dt>依赖引用</dt><dd>600 / ${MANUAL_TRANSACTION_BUDGET.limits.dependencyRefs}</dd>`)
    expect(html).toContain(`<dt>内部记录</dt><dd>25 / ${MANUAL_TRANSACTION_BUDGET.limits.metadataRecords}</dd>`)
    expect(html).toContain(`<dt>资源字节 / 解码像素</dt><dd>1024 / ${MANUAL_TRANSACTION_BUDGET.limits.assetBytes} · 4096 / ${MANUAL_TRANSACTION_BUDGET.limits.decodePixels}</dd>`)
    expect(html).toContain('各项分别检查，不折算为同一种编辑次数')
    expect(html).not.toContain('<dt>组内影响</dt>')
    expect(html).not.toContain('<dt>组外依赖</dt>')
    expect(html).not.toContain('操作量：')
  })

  it('does not present an absent meter as an empty successful transaction', () => {
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, { current, candidate: current, commands: [] }))
    expect(html).not.toContain('普通事务保护详情')
  })

  it('shows the frozen preview tier instead of the default 256 ceiling', () => {
    const budgetProfile = manualTransactionBudget('expanded')
    const budgetUsage = { ...emptyBudgetUsage(), semanticTargets: 800 }
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, { current, candidate: current, commands: [], budgetUsage, budgetProfile }))
    expect(html).toContain('<dt>编辑目标</dt><dd>800 / 1024</dd>')
    expect(html).toContain(`<dt>依赖引用</dt><dd>0 / ${budgetProfile.limits.dependencyRefs}</dd>`)
    expect(html).not.toContain('800 / 256')
  })

  it('shows a rigid group core separately from its bounded members and external dependencies', () => {
    const budgetProfile = manualTransactionBudget('standard')
    const budgetUsage = { ...emptyBudgetUsage(), semanticTargets: 1, groupMembers: 500, externalDependencies: 3,
      geometryPoints: 2000, geometrySegments: 1500, dependencyRefs: 3600 }
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, { current, candidate: current, commands: [], budgetUsage, budgetProfile }))
    expect(html).toContain('<dt>编辑目标</dt><dd>1 / 512</dd>')
    expect(html).toContain('<dt>组内影响</dt><dd>500 / 16384</dd>')
    expect(html).toContain('<dt>组外依赖</dt><dd>3</dd>')
    expect(html).toContain(`<dt>几何点 / 段</dt><dd>2000 / ${budgetProfile.limits.geometryPoints} · 1500 / ${budgetProfile.limits.geometrySegments}</dd>`)
    expect(html).toContain('组内成员与组外依赖仍完整检查')
  })

  it('preserves measured zero group impact without implying an absent reading', () => {
    const budgetUsage = { ...emptyBudgetUsage(), semanticTargets: 2, groupMembers: 0, externalDependencies: 0 }
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, { current, candidate: current, commands: [], budgetUsage }))
    expect(html).toContain('<dt>组内影响</dt><dd>0 / 4096</dd>')
    expect(html).toContain('<dt>组外依赖</dt><dd>0</dd>')
    expect(html).not.toContain('按组核心计编辑目标')
  })

  it('lets a small-map fill request grow past 256 before selecting its actual transaction tier', () => {
    const project = fixture().project as unknown as EditableProject
    const html = renderToStaticMarkup(createElement(SceneInspector, { project, selected: 'item', busy: false,
      workspace: { execute: () => {}, updateProp: () => {}, rotateRoomMaterial: () => {} },
      onSelect: () => {}, onCommit: () => {}, onPreview: () => {}, onFillCopy: () => {} }))
    expect(html).toContain('aria-label="填充副本数量" type="number" min="1" max="1024"')
    expect(html).toContain('组合内每个实际成员分别计量')
  })
})
