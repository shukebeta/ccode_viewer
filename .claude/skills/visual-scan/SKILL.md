---
name: visual-scan
description: Scan the running dev server with Playwright to find rendering issues, unknown message blocks, and UI problems. Use this skill after making changes to MessageRenderer or fsHelpers to verify all message types render correctly. Also use when the user asks to "check for unknown blocks", "scan for rendering issues", "verify UI", or "find unrendered content". Can scan across all projects and sessions automatically.
---

# Visual Scan with Playwright

Automatically scan the Rewind viewer for rendering issues using Playwright. Detects unknown message blocks, raw JSON dumps, and other rendering problems without manual screenshot review.

## Prerequisites

- Dev server running at `http://localhost:6174`
- Playwright installed globally via pnpm
- All commands need `NODE_PATH=$(pnpm root -g)` prefix

## Scan Patterns

### Pattern 1: Scan for unknown blocks across all projects

The app renders unrecognized message types as `.unknown-block` elements. Scan all projects and sessions to find them:

```bash
NODE_PATH=$(pnpm root -g) node -e '
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:6174", { waitUntil: "networkidle" });

  // Get project list from dropdown
  const sel = await page.$(".project-selector .el-select__wrapper");
  await sel.click();
  await page.waitForTimeout(300);
  const projectNames = await page.$$eval(".el-select-dropdown__item", els =>
    els.map(e => e.textContent.trim().split(" - ")[0].trim())
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const types = new Map();

  for (const projName of projectNames) {
    const sel = await page.$(".project-selector .el-select__wrapper");
    await sel.click(); await page.waitForTimeout(300);
    const options = await page.$$(".el-select-dropdown__item");
    for (const opt of options) {
      const text = await opt.textContent();
      if (text.includes(projName)) { await opt.click(); break; }
    }
    await page.waitForTimeout(800);

    const sessions = await page.$$(".session-item");
    const count = Math.min(sessions.length, 5);

    for (let si = 0; si < count; si++) {
      const cur = await page.$$(".session-item");
      if (si >= cur.length) break;
      await cur[si].click();
      await page.waitForTimeout(1500);

      // Scroll through entire conversation
      const unknowns = await page.evaluate(async () => {
        const viewer = document.querySelector(".main-panel");
        if (!viewer) return [];
        const scrollEl = viewer.querySelector(".el-scrollbar__wrap") || viewer;
        for (let i = 0; i < 20; i++) {
          scrollEl.scrollTop += 500;
          await new Promise(r => setTimeout(r, 100));
        }
        return Array.from(new Set(
          Array.from(document.querySelectorAll(".unknown-block")).map(el => el.textContent.trim())
        ));
      });

      unknowns.forEach(u => {
        const type = u.replace("Unknown block: ", "").replace("Unknown tool: ", "");
        types.set(type, (types.get(type) || 0) + 1);
      });
    }
  }

  console.log("=== Unknown Blocks ===");
  types.forEach((count, type) => console.log(`  ${type}: ${count} occurrences`));
  if (types.size === 0) console.log("  None found - all message types handled!");

  await browser.close();
})();
'
```

### Pattern 2: Screenshot a specific session

```bash
NODE_PATH=$(pnpm root -g) node -e '
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:6174", { waitUntil: "networkidle" });
  // Select project and session, then screenshot...
  await page.screenshot({ path: "/tmp/pw-screenshots/shot.png" });
  // Read the screenshot file with the Read tool to see it visually
  await browser.close();
})();
'
```

### Pattern 3: Check raw JSON dumps

Count `<pre>` blocks that look like raw JSON (indicates a block fell through to renderJson):

```javascript
const jsonCount = await page.evaluate(() => {
  const viewer = document.querySelector('.main-panel');
  const scrollEl = viewer.querySelector('.el-scrollbar__wrap') || viewer;
  // Scroll through all content first
  let pres = scrollEl.querySelectorAll('pre');
  let count = 0;
  pres.forEach(pre => {
    const text = pre.textContent.trim();
    if (text.startsWith('{') && text.includes('"type"')) count++;
  });
  return count;
});
```

## Key Detection Classes

- `.unknown-block` — blocks that have a type/name but no specific renderer
- `pre` with JSON starting with `{"type":` — blocks that fell through to renderJson (truly unknown structure)
- `.json-content` — rendered JSON blocks (from renderJson)

## Workflow

1. Make changes to message rendering (fsHelpers.js or MessageRenderer.vue)
2. Run the unknown block scanner
3. If unknown blocks found, note their types
4. Add renderers for each type (see the `block-renderer` skill)
5. Re-scan to verify 0 unknown blocks

## Screenshots directory

All screenshots go to `/tmp/pw-screenshots/` (auto-created).

## DOM structure reference

- Project selector: `.project-selector .el-select__wrapper` (click to open) → `.el-select-dropdown__item`
- Session list: `.session-item` elements
- Message viewer: `.main-panel` → `.el-scrollbar__wrap` (scrollable container)
