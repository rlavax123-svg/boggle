// Capture screenshots of the Boggle Solver app at each key state.
// Run with: node _shoot.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:8765';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  // --- Desktop (1280x900) -------------------------------------------------
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desktop.newPage();
  page.on('console', (msg) => console.log('[page]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[page error]', err.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, '01-initial.png'), fullPage: true });
  console.log('01-initial.png');

  // Fill a well-known grid so results are predictable.
  const grid = [
    ['T','R','E','A'],
    ['I','N','L','K'],
    ['S','P','E','S'],
    ['R','C','S','O'],
  ];
  const inputs = page.locator('.cell input');
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      await inputs.nth(r * 4 + c).fill(grid[r][c]);
    }
  }
  await page.screenshot({ path: path.join(OUT, '02-filled.png'), fullPage: true });
  console.log('02-filled.png');

  // Wait for dictionary to load before solving.
  await page.waitForFunction(
    () => /Dictionary (ready|loaded)/i.test(document.getElementById('status')?.textContent || ''),
    null,
    { timeout: 60_000 }
  ).catch(() => console.log('dict ready timeout — solving anyway'));

  await page.click('#solve');
  await page.waitForFunction(
    () => !document.getElementById('results').hidden && document.querySelectorAll('#wordList li').length > 0,
    null,
    { timeout: 30_000 }
  );
  // Above-the-fold screenshot of the solved state (viewport only).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '03-solved.png') });
  // Scroll to results header and capture the first chunk of the word list.
  await page.locator('#results').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '03b-results.png') });
  console.log('03-solved.png + 03b-results.png');

  // Click a common word so the definition actually resolves.
  const CANDIDATES = ['alertness', 'kernels', 'spineless', 'sirens', 'alert', 'trips', 'stress'];
  let firstWord = null;
  let firstText = null;
  for (const w of CANDIDATES) {
    const loc = page.locator(`#wordList li .word-name:text-is("${w}")`).first();
    if (await loc.count()) {
      firstWord = loc.locator('xpath=..');
      firstText = w;
      break;
    }
  }
  if (!firstWord) {
    firstWord = page.locator('#wordList li').first();
    firstText = (await firstWord.textContent())?.trim();
  }
  await firstWord.click();
  // Wait for at least a handful of inline definitions to resolve.
  await page.waitForFunction(() => {
    return document.querySelectorAll('.entry .wd-def, .entry [data-def-state="loaded"]').length >= 5;
  }, null, { timeout: 20_000 }).catch(() => console.log('def lookup timeout'));
  await page.waitForTimeout(600); // let layout + remaining defs settle

  // First: grid area with highlight
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, '04a-grid-highlight.png') });

  // Then: results area with inline defs
  await page.locator('#results').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '04b-entries.png') });
  console.log('04a + 04b (word =', firstText, ')');

  await desktop.close();

  // --- Mobile (iPhone 13 Pro) --------------------------------------------
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mpage = await mobile.newPage();
  await mpage.goto(URL, { waitUntil: 'networkidle' });
  await mpage.screenshot({ path: path.join(OUT, '05-mobile-initial.png'), fullPage: true });

  // Same fill
  const minputs = mpage.locator('.cell input');
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      await minputs.nth(r * 4 + c).fill(grid[r][c]);
    }
  }
  await mpage.waitForFunction(
    () => /Dictionary (ready|loaded)/i.test(document.getElementById('status')?.textContent || ''),
    null,
    { timeout: 60_000 }
  ).catch(() => {});
  await mpage.click('#solve');
  await mpage.waitForFunction(
    () => !document.getElementById('results').hidden && document.querySelectorAll('#wordList li').length > 0,
    null,
    { timeout: 30_000 }
  );
  // Click a common word
  const mAlert = mpage.locator('#wordList li .word-name:text-is("alertness")').first();
  if (await mAlert.count()) await mAlert.locator('xpath=..').click();
  else await mpage.locator('#wordList li').first().click();
  await mpage.waitForTimeout(800);

  // Viewport-only: top of page (grid + highlight)
  await mpage.evaluate(() => window.scrollTo(0, 0));
  await mpage.screenshot({ path: path.join(OUT, '06a-mobile-grid.png') });
  // Scroll to entries
  await mpage.waitForFunction(() => {
    return document.querySelectorAll('.entry .wd-def').length >= 3;
  }, null, { timeout: 20_000 }).catch(() => {});
  await mpage.locator('#results').scrollIntoViewIfNeeded();
  await mpage.waitForTimeout(400);
  await mpage.screenshot({ path: path.join(OUT, '06b-mobile-entries.png') });
  console.log('06a + 06b mobile');

  await mobile.close();
  await browser.close();
  console.log('done');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
