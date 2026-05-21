const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_NAME = 'viewer-e2e-fixtures'
const SESSION_ID = 'today-force-delete-session'
const MARKER = 'VIEWER_TEST:today-force-delete'

const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures', 'claude-projects', PROJECT_NAME)
const FILE_PATH = path.join(FIXTURES_ROOT, `${SESSION_ID}.jsonl`)

function writeTodaySession() {
  const now = new Date()
  const t = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString()
  const lines = [
    {
      sessionId: SESSION_ID,
      timestamp: t(0),
      type: 'user',
      message: { id: 'tfd-u1', role: 'user', content: `${MARKER}\nForce-delete fixture.` }
    },
    {
      timestamp: t(1000),
      type: 'assistant',
      parentUuid: 'tfd-u1',
      message: { id: 'tfd-a1', role: 'assistant', content: 'Acknowledged.' }
    },
    {
      timestamp: t(2000),
      type: 'assistant',
      parentUuid: 'tfd-u1',
      message: { id: 'tfd-a2', role: 'assistant', content: `${MARKER} complete` }
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

async function locateTodayDeleteButton(page) {
  const card = page.locator('.session-card').filter({ hasText: MARKER }).first()
  await expect(card).toBeVisible({ timeout: 15000 })
  const row = card.locator('xpath=ancestor::*[contains(@class, "session-row")]')
  const btn = row.locator('.delete-btn.today')
  await expect(btn).toBeVisible({ timeout: 5000 })
  return btn
}

test.describe('today force-delete', () => {
  test.beforeEach(async ({ page }) => {
    writeTodaySession()
    // Keep delete buttons hit-testable without relying on row hover.
    await page.addInitScript(() => {
      const style = document.createElement('style')
      style.textContent = '.delete-btn, .copy-cmd-btn { opacity: 1 !important; }'
      document.documentElement.appendChild(style)
    })
  })

  test.afterEach(() => {
    removeFixture()
  })

  test('short click shows hint, no confirm dialog', async ({ page }) => {
    await page.goto('/')
    await ensureFixtureProject(page, PROJECT_NAME)
    const btn = await locateTodayDeleteButton(page)

    await btn.click()

    await expect(page.locator('.el-message').first()).toContainText('Long-press the × button', { timeout: 5000 })
    await expect(page.locator('.el-message-box')).toHaveCount(0)
  })

  test('1 second hold does not open dialog', async ({ page }) => {
    await page.goto('/')
    await ensureFixtureProject(page, PROJECT_NAME)
    const btn = await locateTodayDeleteButton(page)

    const box = await btn.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(1000)
    await page.mouse.up()
    await page.waitForTimeout(500)

    await expect(page.locator('.el-message-box')).toHaveCount(0)
  })

  test('3.2 second hold opens force-delete confirm; cancel keeps session', async ({ page }) => {
    await page.goto('/')
    await ensureFixtureProject(page, PROJECT_NAME)
    const btn = await locateTodayDeleteButton(page)

    const box = await btn.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(3200)
    await page.mouse.up()

    const dialog = page.locator('.el-message-box')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.locator('.el-message-box__title')).toHaveText('Force Delete')
    await expect(dialog.locator('.el-message-box__message')).toContainText('Force-delete anyway')

    await dialog.locator('.el-message-box__btns .el-button').filter({ hasText: /^Cancel$/ }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })

    await expect(page.locator('.session-card').filter({ hasText: MARKER })).toBeVisible()
    expect(fs.existsSync(FILE_PATH)).toBe(true)
  })

  test('3.2 second hold → confirm deletes the session', async ({ page }) => {
    await page.goto('/')
    await ensureFixtureProject(page, PROJECT_NAME)
    const btn = await locateTodayDeleteButton(page)

    const box = await btn.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(3200)
    await page.mouse.up()

    const dialog = page.locator('.el-message-box')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.locator('.el-message-box__btns .el-button--primary').filter({ hasText: 'Force Delete' }).click()

    await expect(page.locator('.session-card').filter({ hasText: MARKER })).toHaveCount(0, { timeout: 10000 })
    await expect.poll(() => fs.existsSync(FILE_PATH), { timeout: 5000 }).toBe(false)
  })
})
