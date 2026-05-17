const { test, expect } = require('@playwright/test')

const PROJECT_NAME = 'viewer-e2e-fixtures'
const OTHER_PROJECT_NAME = 'mermaid-e2e-fixtures'

const SESSIONS = {
  navBasic: 'VIEWER_TEST:nav-basic',
  codeBlocks: 'VIEWER_TEST:code-blocks',
  agentPlain: 'VIEWER_TEST:agent-plain',
  searchTarget: 'VIEWER_TEST:search-target',
  multiTurn: 'VIEWER_TEST:multi-turn',
  structuredCode: 'VIEWER_TEST:structured-code'
}

const SEARCH_KEYWORD = 'UNIQUE_SEARCH_TERM_XYZ'

async function ensureFixtureProject(page, projectName) {
  const selector = page.locator('.project-selector').first()
  await expect(selector).toBeVisible({ timeout: 15000 })

  const selectorText = (await selector.textContent()) || ''
  if (selectorText.includes(projectName)) return

  await page.locator('.el-select').first().click()
  const option = page.locator('.el-select-dropdown__item').filter({ hasText: projectName }).first()
  await expect(option).toBeVisible({ timeout: 10000 })
  await option.click()
}

async function openSession(page, projectName, marker) {
  await page.goto('/')
  await ensureFixtureProject(page, projectName)

  const sessionBtn = page.locator('.session-card').filter({ hasText: marker }).first()
  await expect(sessionBtn).toBeVisible({ timeout: 15000 })
  await sessionBtn.click()

  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
}

async function typeSearch(page, keyword) {
  const input = page.locator('.search-input').first()
  await expect(input).toBeVisible({ timeout: 10000 })
  await input.fill('')
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/search?q=') && res.status() === 200,
    { timeout: 15000 }
  )
  await input.fill(keyword)
  await responsePromise
}

test('1 - Project selector lists both fixture projects', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.project-selector').first()).toBeVisible({ timeout: 15000 })

  await page.locator('.el-select').first().click()
  const viewerOption = page.locator('.el-select-dropdown__item').filter({ hasText: PROJECT_NAME }).first()
  const mermaidOption = page.locator('.el-select-dropdown__item').filter({ hasText: OTHER_PROJECT_NAME }).first()
  await expect(viewerOption).toBeVisible({ timeout: 10000 })
  await expect(mermaidOption).toBeVisible({ timeout: 10000 })
})

test('2 - Switching projects loads its sessions', async ({ page }) => {
  await page.goto('/')
  await ensureFixtureProject(page, PROJECT_NAME)

  const navCard = page.locator('.session-card').filter({ hasText: SESSIONS.navBasic }).first()
  await expect(navCard).toBeVisible({ timeout: 15000 })
})

test('3 - Opening a session renders user and assistant messages', async ({ page }) => {
  await openSession(page, PROJECT_NAME, SESSIONS.navBasic)

  await expect(page.locator('.user-preview').first()).toBeVisible({ timeout: 15000 })
})

test('4 - Code blocks render as <pre><code> with raw fences stripped', async ({ page }) => {
  await openSession(page, PROJECT_NAME, SESSIONS.codeBlocks)

  const renderer = page.locator('.message-renderer').filter({ hasText: 'greet' }).first()
  await expect(renderer).toBeVisible({ timeout: 15000 })

  const codeEl = renderer.locator('pre code').first()
  await expect(codeEl).toBeVisible({ timeout: 15000 })

  const body = (await renderer.textContent()) || ''
  expect(body).not.toContain('```')
})

test('5 - Agent session card carries .agent-session; non-agent does not', async ({ page }) => {
  await page.goto('/')
  await ensureFixtureProject(page, PROJECT_NAME)

  const agentCard = page.locator('.session-card').filter({ hasText: SESSIONS.agentPlain }).first()
  const navCard = page.locator('.session-card').filter({ hasText: SESSIONS.navBasic }).first()

  await expect(agentCard).toBeVisible({ timeout: 15000 })
  await expect(navCard).toBeVisible({ timeout: 15000 })

  await expect(agentCard).toHaveClass(/agent-session/)
  await expect(navCard).not.toHaveClass(/agent-session/)
})

test('6 - Search returns results for known keyword', async ({ page }) => {
  await page.goto('/')
  await ensureFixtureProject(page, PROJECT_NAME)

  await typeSearch(page, SEARCH_KEYWORD)

  const resultItems = page.locator('.result-item')
  await expect(resultItems.first()).toBeVisible({ timeout: 10000 })
  expect(await resultItems.count()).toBeGreaterThanOrEqual(1)
})

test('7 - Clicking a search result opens that session', async ({ page }) => {
  await page.goto('/')
  await ensureFixtureProject(page, PROJECT_NAME)

  await typeSearch(page, SEARCH_KEYWORD)

  const resultCard = page.locator('.result-card').first()
  await expect(resultCard).toBeVisible({ timeout: 10000 })
  await resultCard.click()

  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
  await expect(
    page.locator('.assistant-card').filter({ hasText: SEARCH_KEYWORD }).first()
  ).toBeVisible({ timeout: 15000 })
})

test('8 - Session card shows timestamp and message count', async ({ page }) => {
  await page.goto('/')
  await ensureFixtureProject(page, PROJECT_NAME)

  const card = page.locator('.session-card').filter({ hasText: SESSIONS.navBasic }).first()
  await expect(card).toBeVisible({ timeout: 15000 })
  await expect(card.locator('.muted').first()).toContainText(/\(\d+\)/)
  const timeText = (await card.locator('.session-time').first().textContent()) || ''
  expect(timeText.trim().length).toBeGreaterThan(0)
})

test('9 - Multi-turn session renders all messages', async ({ page }) => {
  await openSession(page, PROJECT_NAME, SESSIONS.multiTurn)

  const assistantCards = page.locator('.assistant-card')
  await expect(assistantCards.first()).toBeVisible({ timeout: 15000 })
  await expect.poll(async () => assistantCards.count(), { timeout: 10000 }).toBeGreaterThanOrEqual(6)
})

test('10 - Structured code block renders via CodeBlock with language class', async ({ page }) => {
  await openSession(page, PROJECT_NAME, SESSIONS.structuredCode)

  const codeEl = page.locator('pre code[class^="language-"]').first()
  await expect(codeEl).toBeVisible({ timeout: 15000 })
  await expect(codeEl).toHaveClass(/language-bash/)
})
