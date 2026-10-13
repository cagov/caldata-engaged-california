// Headless reproduction of the "phase 2 blip" between beats 1 and 2.
// Requires the sketches/ static server on 127.0.0.1:8765 and the sketch's ?debug hook.
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright-core'); // npm i --no-save playwright-core
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const dirs = fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort();
const shellDir = path.join(cache, dirs[dirs.length - 1]);
const exe = fs.readdirSync(shellDir).map(d => path.join(shellDir, d)).flatMap(d => {
  try { return fs.readdirSync(d).map(f => path.join(d, f)); } catch (e) { return []; } })
  .find(f => /\/chrome-headless-shell$/.test(f));
if (!exe) throw new Error('no headless_shell in ' + shellDir);

(async () => {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', m => { const t = m.text(); if (/whirl/.test(t)) console.log('  [page]', t.slice(0, 120)); });
  await page.goto('http://127.0.0.1:8765/policy-ideas-whirl-v1.html?debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__whirlLog !== undefined || document.fonts.status === 'loaded', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500); // fonts + layout candidates

  async function wheel(dy, steps, pause){ for (let i = 0; i < steps; i++){ await page.mouse.move(800, 450); await page.mouse.wheel(0, dy); await page.waitForTimeout(pause); } }
  const mark = async (label) => page.evaluate(l => { (window.__whirlLog = window.__whirlLog || []).push({ ev: 'MARK ' + l, t: performance.now()|0 }); }, label);

  await mark('pass1 down');
  await wheel(120, 90, 40);          // through all three beats
  await page.waitForTimeout(1500);
  await mark('back to top');
  await wheel(-160, 90, 30);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await mark('pass2 down');
  await wheel(100, 110, 40);
  await page.waitForTimeout(1500);

  const log = await page.evaluate(() => window.__whirlLog || []);
  console.log(`log entries: ${log.length}`);
  // print callbacks + marks, and renders only when what they draw changes
  let prev = '';
  for (const e of log){
    if (e.ev === 'render'){
      const key = `${e.activeStep}|${e.scrollBack}|${e.activeStep === 2 ? Math.round(e.step2 * 10) / 10 : e.activeStep === 1 ? Math.round(e.step1 * 10) / 10 : ''}`;
      if (key === prev) continue; prev = key;
      console.log(`  ${e.t} render  step=${e.activeStep} scrollBack=${e.scrollBack} step1=${e.step1} step2=${e.step2} scrollY=${e.scrollY}`);
    } else {
      console.log(`${e.t} ${e.ev}${e.p !== undefined ? ' p=' + e.p : ''}  step=${e.activeStep} scrollBack=${e.scrollBack} step2=${e.step2} scrollY=${e.scrollY}`);
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
