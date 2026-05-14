#!/usr/bin/env node
/**
 * Playwright helper for visual testing.
 * Usage:
 *   node scripts/browser.js screenshot [url] [output]
 *   node scripts/browser.js screenshot [url] [output] --fullpage
 *   node scripts/browser.js click [url] [selector]
 *   node scripts/browser.js type [url] [selector] [text]
 *   node scripts/browser.js evaluate [url] [js-code]
 */

const { chromium } = require('playwright');

const SCREENSHOT_DIR = '/tmp/pw-screenshots';
const DEFAULT_URL = 'http://localhost:6174';
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

async function getBrowser() {
  return chromium.launch({ headless: true });
}

async function screenshot(url, outputPath, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({
    path: outputPath,
    fullPage: options.fullPage || false,
  });
  await browser.close();
  return outputPath;
}

async function click(url, selector) {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.click(selector);
  // Wait a bit for any UI updates
  await page.waitForTimeout(500);
  const outputPath = `${SCREENSHOT_DIR}/after-click.png`;
  await page.screenshot({ path: outputPath });
  await browser.close();
  return outputPath;
}

async function type(url, selector, text) {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.fill(selector, text);
  await page.waitForTimeout(300);
  const outputPath = `${SCREENSHOT_DIR}/after-type.png`;
  await page.screenshot({ path: outputPath });
  await browser.close();
  return outputPath;
}

async function evaluate(url, jsCode) {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
  await page.goto(url, { waitUntil: 'networkidle' });
  const result = await page.evaluate(jsCode);
  await browser.close();
  return result;
}

// CLI entry point
const [,, command, ...args] = process.argv;

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  switch (command) {
    case 'screenshot': {
      const url = args[0] || DEFAULT_URL;
      const output = args[1] || `${SCREENSHOT_DIR}/screenshot.png`;
      const fullPage = args.includes('--fullpage');
      const path = await screenshot(url, output, { fullPage });
      console.log(path);
      break;
    }
    case 'click': {
      const url = args[0] || DEFAULT_URL;
      const selector = args[1];
      if (!selector) { console.error('Provide a CSS selector'); process.exit(1); }
      const path = await click(url, selector);
      console.log(path);
      break;
    }
    case 'type': {
      const url = args[0] || DEFAULT_URL;
      const selector = args[1];
      const text = args[2];
      if (!selector || !text) { console.error('Provide selector and text'); process.exit(1); }
      const path = await type(url, selector, text);
      console.log(path);
      break;
    }
    case 'evaluate': {
      const url = args[0] || DEFAULT_URL;
      const jsCode = args.slice(1).join(' ');
      if (!jsCode) { console.error('Provide JS code'); process.exit(1); }
      const result = await evaluate(url, jsCode);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.log('Usage: node scripts/browser.js <screenshot|click|type|evaluate> [args]');
  }
})();
