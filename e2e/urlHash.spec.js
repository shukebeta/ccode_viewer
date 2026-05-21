const { test, expect } = require('@playwright/test')

const PROJECT_NAME = 'viewer-e2e-fixtures'
const NAV_MARKER = 'VIEWER_TEST:nav-basic'
const MULTI_MARKER = 'VIEWER_TEST:multi-turn'
const NAV_SESSION_ID = 'viewer-nav-basic'
const MULTI_SESSION_ID = 'viewer-multi-turn'
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

async function openSessionByMarker(page, projectName, marker) {
  await page.goto('/')
  await ensureFixtureProject(page, projectName)

  const card = page.locator('.session-card').filter({ hasText: marker }).first()
  await expect(card).toBeVisible({ timeout: 15000 })
  await card.click()

  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
}

function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '')
  const out = {}
  for (const pair of raw.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1))
  }
  return out
}

test('URL hash — clicking a session writes project+session to hash', async ({ page }) => {
  await openSessionByMarker(page, PROJECT_NAME, NAV_MARKER)

  await expect.poll(async () => parseHash(new URL(page.url()).hash).session, { timeout: 10000 }).toBe(NAV_SESSION_ID)
  const parsed = parseHash(new URL(page.url()).hash)
  expect(parsed.project).toBe(PROJECT_NAME)
  expect(parsed.source).toBe('claudecode')
})

test('URL hash — refresh restores the same session', async ({ page }) => {
  await openSessionByMarker(page, PROJECT_NAME, NAV_MARKER)
  const hashBefore = new URL(page.url()).hash

  await page.reload()

  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
  // Active session card matches the restored session
  await expect(page.locator('.session-card.active').filter({ hasText: NAV_MARKER }).first()).toBeVisible({ timeout: 10000 })
  expect(new URL(page.url()).hash).toBe(hashBefore)
})

test('URL hash — hand-crafted hash on cold load restores the session', async ({ page }) => {
  const hash = `#project=${encodeURIComponent(PROJECT_NAME)}&session=${encodeURIComponent(MULTI_SESSION_ID)}&source=claudecode`
  await page.goto('/' + hash)

  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.session-card.active').filter({ hasText: MULTI_MARKER }).first()).toBeVisible({ timeout: 10000 })
  expect(parseHash(new URL(page.url()).hash).session).toBe(MULTI_SESSION_ID)
})

test('URL hash — stale session id falls back to auto-select-first and cleans hash', async ({ page }) => {
  const hash = `#project=${encodeURIComponent(PROJECT_NAME)}&session=does-not-exist-zzz&source=claudecode`
  await page.goto('/' + hash)

  // A session loads (any session — auto-select-first), and the bogus session id is gone from the hash.
  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
  await expect.poll(
    async () => parseHash(new URL(page.url()).hash).session,
    { timeout: 10000 }
  ).not.toBe('does-not-exist-zzz')
})

test('URL hash — clicking a search result writes the result session id to the hash', async ({ page }) => {
  await page.goto('/')
  await ensureFixtureProject(page, PROJECT_NAME)

  const input = page.locator('.search-input').first()
  await expect(input).toBeVisible({ timeout: 10000 })
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/search?q=') && res.status() === 200,
    { timeout: 15000 }
  )
  await input.fill(SEARCH_KEYWORD)
  await responsePromise

  const resultCard = page.locator('.result-card').first()
  await expect(resultCard).toBeVisible({ timeout: 10000 })
  await resultCard.click()

  await expect(page.locator('.assistant-card').first()).toBeVisible({ timeout: 15000 })
  const parsed = parseHash(new URL(page.url()).hash)
  expect(parsed.project).toBe(PROJECT_NAME)
  expect(parsed.session).toBeTruthy()
  expect(parsed.session.length).toBeGreaterThan(0)
})
