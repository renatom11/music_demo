/**
 * End-to-end check through the *real* browser audio path (getUserMedia →
 * AnalyserNode → app): Chromium plays a synthesized WAV as the microphone and
 * we record every chord the app highlights.
 *
 *   npm run e2e        (needs Playwright + Chromium available)
 */
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chordfollow-e2e-'));
  // E2E_HUM=0.005 E2E_GUITAR=0.015 npm run e2e  → quiet guitar in a humming room
  const wav = path.join(dir, 'being-alive.wav');
  execFileSync('npx', ['vite-node', 'scripts/fake-mic-wav.ts', wav, process.env.E2E_HUM ?? '0', process.env.E2E_GUITAR ?? '0.06'], { stdio: 'inherit' });
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  let failed = false;
  try {
    const browser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
    });
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] })).newPage();
    await page.goto('http://localhost:4173/');
    await page.click('text=Being Alive');
    await page.click('button.start');
    const t0 = Date.now();
    const seen = [];
    while (Date.now() - t0 < 108000 && !(await page.isVisible('.done-overlay'))) {
      const idx = Number(await page.evaluate(() => document.querySelector('.pill.current')?.getAttribute('data-index') ?? -1));
      if (seen[seen.length - 1] !== idx) seen.push(idx);
      await page.waitForTimeout(100);
    }
    const expected = Array.from({ length: 31 }, (_, i) => i);
    console.log('highlighted:', seen.join(' '));
    console.log('done screen:', await page.isVisible('.done-overlay'));
    failed = JSON.stringify(seen) !== JSON.stringify(expected);
    console.log(failed ? 'FAIL: did not follow 0..30 in order' : 'PASS: followed all 30 changes in order');
    await browser.close();
  } finally {
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
