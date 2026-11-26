// Run the photo test bench headless and print a summary.
//   npm run bench                       (simple outline, all cases)
//   npm run bench -- --case=chair       (one case)
//   npm run bench -- --json=out.json    (save full results)
//   npm run bench -- --shot=bench.png   (save a screenshot of the report)
// Needs a build first (npm run build) and Playwright with Chromium.
//   npm run bench -- --segmenter=sam    (the real model; needs network for the first download)
//   npm run bench -- --classifier=clip  (recognise the kind with CLIP; needs network the first time)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

// Playwright isn't a dependency of the site; use whichever copy is installed
// (npm i -D playwright && npx playwright install chromium).
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/grainforge\//, '/'));
  try {
    const body = await readFile(join(root, path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
// Progress and model failures from the page, so a stall shows where it is.
page.on('console', (m) => {
  if (m.text().startsWith('[bench]') || m.type() === 'error') console.error(m.text());
});
const q = new URLSearchParams({
  autorun: '1',
  segmenter: args.segmenter ?? 'simple',
  ...(args.classifier ? { classifier: args.classifier } : {}),
  ...(args.case ? { case: args.case } : {}),
});
await page.goto(`http://localhost:${port}/grainforge/bench.html?${q}`);
await page.waitForFunction(() => window.bench?.done, null, { timeout: 15 * 60_000 });
const bench = await page.evaluate(() => window.bench);
if (args.json) await writeFile(args.json, JSON.stringify(bench, null, 2));
if (args.shot) await page.screenshot({ path: args.shot, fullPage: true });
await browser.close();
server.close();

const s = bench.summary;
console.log(`Tests with a model: ${s.tests - s.failed}/${s.tests}`);
console.log(`Kind right first: ${s.kindFirst}%   in top 3: ${s.kindTop3}%`);
console.log(`Size error (read from photos): ${s.dimError}% average, ${s.within10}% within 10%`);
console.log(`Leg/seat/rail error: ${s.paramError}%   Tests with warnings: ${s.withWarnings}`);
console.log(`Photos where a model failed: ${s.modelFailures ?? 0}`);
for (const e of s.modelErrors ?? []) console.log(`  ${e}`);
if (s.weightSweep?.length) {
  console.log('Kind right first / top 3 by outline weight (0 = recognition model only):');
  for (const w of s.weightSweep) console.log(`  ${String(w.weight).padEnd(5)} ${w.kindFirst}% / ${w.kindTop3}%`);
}
const fmt = (d) => (!d ? '   –  ' : d.given ? ' given' : d.guessed ? ' guess' : `${d.error >= 0 ? '+' : ''}${Math.round(d.error * 100)}%`.padStart(6));
for (const r of bench.results) {
  console.log(`\n${r.label} (${r.kind})${r.views.filter((v) => v.autoAngled && v.view !== 'angled').map((v) => `  [${v.view} looks angled]`).join('')}`);
  // What the recognition model saw in each photo, on its own.
  const seen = r.views.filter((v) => v.kindScores).map((v) => {
    const [k, p] = Object.entries(v.kindScores).sort((a, b) => b[1] - a[1])[0];
    return `${v.view} ${k} ${Math.round(p * 100)}%`;
  });
  if (seen.length) console.log(`  model sees: ${seen.join(', ')}`);
  for (const set of r.sets) {
    if (set.error) { console.log(`  ${set.set.padEnd(10)} ERROR ${set.error}`); continue; }
    const p = Object.entries(set.params).map(([k, d]) => `${k} ${fmt(d).trim()}`).join(' ');
    console.log(`  ${set.set.padEnd(10)} kind ${String(set.suggested[0]).padEnd(8)}${set.kindRank === 0 ? '✓' : '✗'}  W ${fmt(set.dims.width)} D ${fmt(set.dims.depth)} H ${fmt(set.dims.height)}  ${p}${set.warnings.length ? '  ⚠ ' + set.warnings.length : ''}`);
  }
}
