const { test, expect } = require('@playwright/test')

const PROJECT_NAME = 'mermaid-e2e-fixtures'

const SESSIONS = {
  basicRender: 'MERMAID_TEST:basic-render',
  specialChars: 'MERMAID_TEST:special-chars',
  markdownRegression: 'MERMAID_TEST:markdown-regression',
  rawHtml: 'MERMAID_TEST:raw-html',
  brokenMermaid: 'MERMAID_TEST:broken-mermaid',
  wideDiagram: 'MERMAID_TEST:wide-diagram',
  tallDiagram: 'MERMAID_TEST:tall-diagram',
  multipleBlocks: 'MERMAID_TEST:multiple-blocks',
  nonMermaidBaseline: 'MERMAID_TEST:non-mermaid-baseline'
}

async function ensureFixtureProject(page) {
  const selector = page.locator('.project-selector').first()
  await expect(selector).toBeVisible({ timeout: 15000 })

  const selectorText = (await selector.textContent()) || ''
  if (selectorText.includes(PROJECT_NAME)) return

  await page.locator('.el-select').first().click()
  const option = page.locator('.el-select-dropdown__item').filter({ hasText: PROJECT_NAME }).first()
  await expect(option).toBeVisible({ timeout: 10000 })
  await option.click()
}

async function openSession(page, marker) {
  await page.goto('/')
  await ensureFixtureProject(page)

  const sessionBtn = page.locator('.session-card').filter({ hasText: marker }).first()
  await expect(sessionBtn).toBeVisible({ timeout: 15000 })
  await sessionBtn.click()

  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.user-preview').filter({ hasText: marker }).first()).toBeVisible({ timeout: 15000 })
}

async function waitForMermaidSvgCount(page, count = 1, timeout = 15000) {
  const svgLocator = page.locator('[data-testid="mermaid-svg"] svg')
  await expect.poll(async () => svgLocator.count(), { timeout }).toBeGreaterThanOrEqual(count)
  await expect(page.locator('[data-testid="mermaid-svg"]').first()).toBeVisible()
}

async function openFullscreen(page, { mobile = false } = {}) {
  const fullscreenBtn = page.locator('[data-testid="mermaid-fullscreen"]').first()

  await fullscreenBtn.scrollIntoViewIfNeeded()
  await expect(fullscreenBtn).toBeVisible()

  if (mobile) await fullscreenBtn.tap()
  else await fullscreenBtn.click({ force: true })

  const dialog = page.locator('[data-testid="mermaid-dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 5000 })
  return dialog
}

function collectConsoleErrors(page) {
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

function firstRenderedContent(page) {
  return page.locator('.message-renderer').nth(1)
}

test('1 - Basic mermaid renders as SVG, not raw code', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await openSession(page, SESSIONS.basicRender)
  await waitForMermaidSvgCount(page)

  const svgContainer = page.locator('[data-testid="mermaid-svg"]').first()
  await expect(svgContainer.locator('svg')).toBeVisible()

  const body = await firstRenderedContent(page).textContent()
  expect(body).not.toContain('```mermaid')

  const mermaidErrors = errors.filter((entry) =>
    entry.toLowerCase().includes('mermaid') && !entry.includes('favicon')
  )
  expect(mermaidErrors).toHaveLength(0)
})

test('2 - Special chars < > & preserved correctly', async ({ page }) => {
  await openSession(page, SESSIONS.specialChars)
  await waitForMermaidSvgCount(page)

  const allText = await firstRenderedContent(page).textContent()
  expect(allText).not.toContain('&lt;')
  expect(allText).not.toContain('&gt;')
  expect(allText).not.toContain('&amp;')
})

test('3 - Non-mermaid markdown renders correctly', async ({ page }) => {
  await openSession(page, SESSIONS.markdownRegression)

  const content = page.locator('.message-renderer').filter({ hasText: 'Heading 1' }).first()
  await expect(content.locator('h1')).toBeVisible()
  await expect(content.locator('h2')).toBeVisible()
  await expect(content.locator('ul li')).toHaveCount(3)
  await expect(content.locator('blockquote')).toBeVisible()
  await expect(content.locator('table')).toBeVisible()
  await expect(content.locator('strong')).toBeVisible()
  await expect(content.locator('em')).toBeVisible()
  await expect(content.locator('ol li')).toHaveCount(3)
  expect(await content.locator('pre code').count()).toBeGreaterThanOrEqual(2)
})

test('4 - Raw HTML is sanitized, not injected as DOM', async ({ page }) => {
  await openSession(page, SESSIONS.rawHtml)

  const content = firstRenderedContent(page)
  expect(await content.locator('div[style="color:red"]').count()).toBe(0)
  expect(await content.locator('script').count()).toBe(0)
  expect(await content.locator('img[onerror]').count()).toBe(0)

  const text = await content.textContent()
  expect(text).toContain('<div style="color:red">unsafe div</div>')
})

test('5 - Broken mermaid shows error and fallback source', async ({ page }) => {
  await openSession(page, SESSIONS.brokenMermaid)

  const errorBlock = page.locator('[data-testid="mermaid-error"]').first()
  await expect(errorBlock).toBeVisible({ timeout: 15000 })
  await expect(errorBlock.locator('.mermaid-warning')).toContainText('Mermaid syntax error')
  await expect(errorBlock.locator('.mermaid-fallback')).toContainText('graph TD')

  await waitForMermaidSvgCount(page)
})

test('6 - Fullscreen opens and closes correctly', async ({ page }) => {
  await openSession(page, SESSIONS.basicRender)
  await waitForMermaidSvgCount(page)

  const dialog = await openFullscreen(page)
  await expect(dialog.locator('svg')).toBeVisible()

  await page.locator('[data-testid="mermaid-dialog-close"]').first().click()
  await expect(dialog).toBeHidden()

  await openFullscreen(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('7 - Zoom in/out/reset works correctly', async ({ page }) => {
  await openSession(page, SESSIONS.basicRender)
  await waitForMermaidSvgCount(page)

  const dialog = await openFullscreen(page)
  const zoomLabel = page.locator('.mermaid-zoom-label').first()
  const zoomInBtn = page.locator('[data-testid="mermaid-dialog-zoom-in"]').first()

  await expect(zoomLabel).toContainText('100%')
  await zoomInBtn.click()
  await expect(zoomLabel).toContainText('125%')
  await zoomInBtn.click()
  await expect(zoomLabel).toContainText('150%')

  await page.locator('[data-testid="mermaid-dialog-zoom-out"]').first().click()
  await expect(zoomLabel).toContainText('125%')

  await page.locator('[data-testid="mermaid-dialog-zoom-reset"]').first().click()
  await expect(zoomLabel).toContainText('100%')

  await page.locator('[data-testid="mermaid-dialog-close"]').first().click()
  await expect(dialog).toBeHidden()

  await openFullscreen(page)
  await expect(zoomLabel).toContainText('100%')
})

test('8 - Wide diagram scrollable inline', async ({ page }) => {
  await openSession(page, SESSIONS.wideDiagram)
  await waitForMermaidSvgCount(page)

  const svgContainer = page.locator('[data-testid="mermaid-svg"]').first()
  const overflow = await svgContainer.evaluate((el) => getComputedStyle(el).overflowX)
  expect(['auto', 'scroll']).toContain(overflow)
})

test('8b - Tall diagram fullscreen scrollable', async ({ page }) => {
  await openSession(page, SESSIONS.tallDiagram)
  await waitForMermaidSvgCount(page)

  const dialog = await openFullscreen(page)
  await expect(page.locator('[data-testid="mermaid-dialog-scroll"]').first()).toBeVisible()
  await expect(dialog.locator('[data-testid="mermaid-dialog-canvas"] svg')).toBeVisible()
})

test('9 - Multiple mermaid blocks render independently', async ({ page }) => {
  await openSession(page, SESSIONS.multipleBlocks)
  await waitForMermaidSvgCount(page, 2)

  const mermaidSvgs = page.locator('[data-testid="mermaid-svg"]')
  expect(await mermaidSvgs.count()).toBeGreaterThanOrEqual(2)

  for (let index = 0; index < Math.min(await mermaidSvgs.count(), 4); index += 1) {
    await expect(mermaidSvgs.nth(index).locator('svg')).toBeVisible()
  }
})

test('10 - Non-mermaid session loads without Mermaid UI', async ({ page }) => {
  await openSession(page, SESSIONS.nonMermaidBaseline)

  const messages = page.locator('.assistant-card')
  await expect(messages.first()).toBeVisible({ timeout: 8000 })
  expect(await messages.count()).toBeGreaterThanOrEqual(4)
  expect(await page.locator('[data-testid="mermaid-svg"]').count()).toBe(0)
  expect(await page.locator('[data-testid="mermaid-error"]').count()).toBe(0)
})

test('11 - Mobile viewport: toolbar visible and tappable', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true
  })
  const page = await context.newPage()

  await openSession(page, SESSIONS.basicRender)
  await waitForMermaidSvgCount(page)

  const dialog = await openFullscreen(page, { mobile: true })
  await expect(page.locator('[data-testid="mermaid-dialog-zoom-in"]').first()).toBeVisible()
  await expect(page.locator('[data-testid="mermaid-dialog-zoom-out"]').first()).toBeVisible()

  await page.locator('[data-testid="mermaid-dialog-close"]').first().tap()
  await expect(dialog).toBeHidden()

  await context.close()
})
