const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_NAME = 'viewer-e2e-fixtures'
const SESSION_ID = 'sessions-live-refresh-session'
const MARKER = 'VIEWER_TEST:sessions-live-refresh'

const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures', 'claude-projects', PROJECT_NAME)
const FILE_PATH = path.join(FIXTURES_ROOT, `${SESSION_ID}.jsonl`)

function writeLiveSession() {
  const now = new Date()
  const t = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString()
  const lines = [
    {
      sessionId: SESSION_ID,
      timestamp: t(0),
      type: 'user',
      message: { id: 'slr-u1', role: 'user', content: `${MARKER}\nLive-refresh fixture.` }
    },
    {
      timestamp: t(1000),
      type: 'assistant',
      parentUuid: 'slr-u1',
      message: { id: 'slr-a1', role: 'assistant', content: 'Acknowledged.' }
    },
    {
      timestamp: t(2000),
      type: 'assistant',
      parentUuid: 'slr-u1',
      message: { id: 'slr-a2', role: 'assistant', content: `${MARKER} complete` }
    }
  ]
  fs.writeFileSync(FILE_PATH, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

function removeFixture() {
  if (fs.existsSync(FILE_PATH)) fs.unlinkSync(FILE_PATH)
}

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

test.describe('sessions live refresh', () => {
  test.afterEach(() => {
    removeFixture()
  })

  test('SSE-driven refresh does not flash "Loading..." in the sessions sidebar', async ({ page }) => {
    await page.goto('/')
    await ensureFixtureProject(page, PROJECT_NAME)

    // Wait for the initial foreground load to settle so we know "Loading..."
    // has already cleared once. The text check below only catches re-appearances.
    await expect(page.locator('.sessions-list')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.sessions-list .session-card').first()).toBeVisible({ timeout: 15000 })

    // Record every "Loading..." text occurrence within the sessions panel
    // from this point forward. window.__slrLoadingHits will accumulate counts.
    await page.evaluate(() => {
      window.__slrLoadingHits = 0
      const root = document.querySelector('.sessions-list')?.parentElement || document.body
      const observer = new MutationObserver(() => {
        const text = root.innerText || ''
        if (text.includes('Loading...')) window.__slrLoadingHits++
      })
      observer.observe(root, { childList: true, subtree: true, characterData: true })
      window.__slrObserver = observer
    })

    // Trigger a sessions_changed SSE event by adding a new fixture file. The
    // server's listWatcher will debounce ~500ms then emit the event.
    writeLiveSession()

    // Wait until the new session appears — proves the SSE refresh ran.
    await expect(
      page.locator('.session-card').filter({ hasText: MARKER })
    ).toBeVisible({ timeout: 15000 })

    // Give any pending DOM updates a moment to settle, then assert the
    // sidebar never rendered "Loading..." during the SSE-driven refresh.
    await page.waitForTimeout(250)
    const hits = await page.evaluate(() => {
      window.__slrObserver?.disconnect()
      return window.__slrLoadingHits
    })
    expect(hits).toBe(0)

    // Sanity: the sessions list element stayed continuously rendered.
    await expect(page.locator('.sessions-list')).toBeVisible()
  })
})
