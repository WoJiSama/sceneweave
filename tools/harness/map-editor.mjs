/** Exercise the same browser page a user opens, in a disposable context. */
export async function checkMapInEditor(browser, origin, archive, oblique) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try {
    await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort('blockedbyclient'))
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(45000)
    await page.goto(`${origin}/#home`)
    await page.getByRole('button', { name: '打开工程文件', exact: true }).waitFor()
    await page.getByTestId('native-project-file').setInputFiles({ name: 'map.sceneweave', mimeType: 'application/octet-stream', buffer: archive })
    const opened = await page.waitForFunction(() => {
      const notice = document.querySelector('.workspace-notice')?.textContent
      if (notice) return { failure: notice }
      if (document.querySelector('.asset-save')?.textContent?.trim() === '本地已保存'
        && !document.querySelector('.asset-busy')
        && document.querySelector('.asset-map-wrap')?.getAttribute('aria-busy') === 'false') return { saved: true }
    }).then(handle => handle.jsonValue())
    if (opened.failure) throw new Error(opened.failure)
    if (oblique) {
      await page.getByRole('button', { name: '斜俯视', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '斜俯视', exact: true })
      await dialog.locator('canvas[data-ready="true"]').or(dialog.getByRole('alert')).first().waitFor()
      const failure = await dialog.getByRole('alert').allTextContents()
      if (failure.length) throw new Error(failure.join('\n'))
    }
    if (errors.length) throw new Error(errors[0])
    return { imported: true, locallySaved: true, topReady: true, ...(oblique ? { obliqueReady: true } : {}) }
  } finally {
    await context.close()
  }
}
